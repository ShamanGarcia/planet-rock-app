import { startUpload, getUploadStatus, uploadChunk, completeUpload, abortUpload } from "./api.js";
import { prepareMedia } from "./media.js";
import { saveLocalMedia } from "./localMedia.js";
import { escapeHtml } from "../utils.js";

// Background media uploads. A caller hands over a File and moves on (the popup closes at
// once); this module compresses it, sends it in retryable chunks, attaches it to the route
// and shows one progress bubble at the top of the screen. State lives here, outside any
// view, so switching tabs doesn't interrupt anything — only closing MATCHBOOK does.

const jobs = [];
let running = false;
let wakeLock = null;
let hideTimer = null;
let bubble = null;
let nextId = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = () => jobs.some((j) => j.stage === "queued" || j.stage === "compressing" || j.stage === "uploading");

// Fired for every finished upload so open galleries and route drawers can refresh.
export const UPLOADED_EVENT = "matchbook:uploaded";

export function enqueueUpload({ routeId, file, visibility = "public", logEntryId = null, onDone = null }) {
  clearTimeout(hideTimer);
  if (!busy()) jobs.length = 0; // a fresh batch; the previous one is finished and acknowledged
  const job = { id: nextId++, routeId, file, visibility, logEntryId, onDone, stage: "queued", pct: 0, error: "", note: "" };
  jobs.push(job);
  render();
  pump();
  return job;
}

class Retryable extends Error {}
class UploadGone extends Error {}

async function pump() {
  if (running) return;
  running = true;
  holdScreen();
  try {
    for (let job; (job = jobs.find((j) => j.stage === "queued")); ) {
      try {
        await run(job);
      } catch (err) {
        job.stage = "error";
        job.error = err.message || "Upload failed.";
        render();
      }
    }
  } finally {
    running = false;
    releaseScreen();
    render();
  }
}

async function run(job) {
  job.stage = "compressing";
  job.pct = 0;
  render();
  const prepared = await prepareMedia(job.file, {
    onProgress: (p) => { job.pct = Math.round(p * 50); render(); }, // a video's compression is the first half of the bar
  });

  if (!prepared.shareable) {
    await saveLocalMedia(job.routeId, prepared.kind, prepared.blob); // too big for the server: private, on this device
    job.note = "Too big to share, so it stays private on this device";
    return finish(job, { local: true });
  }

  const base = prepared.kind === "video" && prepared.compressed ? 50 : 0;
  job.stage = "uploading";
  job.pct = base;
  render();

  let media = null;
  for (let attempt = 0; !media; attempt++) {
    let uploadId = null;
    try {
      const started = await startUpload(prepared.kind, prepared.blob.size);
      uploadId = started.id;
      await sendChunks(job, uploadId, prepared.blob, started.chunkSize, base);
      media = await completeUpload(uploadId, {
        routeId: job.routeId, visibility: job.visibility, logEntryId: job.logEntryId, posterDataUrl: prepared.posterDataUrl,
      });
    } catch (err) {
      if (uploadId) abortUpload(uploadId).catch(() => {}); // free the server's partial file (a no-op if it's already gone)
      if (!(err instanceof UploadGone) || attempt >= 1) throw err; // the server forgot the upload (restart): start it over once
      job.pct = base;
    }
  }
  finish(job, { media });
}

async function sendChunks(job, uploadId, blob, chunkSize, base) {
  let offset = 0;
  let failures = 0;
  while (offset < blob.size) {
    try {
      const end = Math.min(blob.size, offset + chunkSize);
      const res = await uploadChunk(uploadId, offset, blob.slice(offset, end), (loaded) => {
        job.pct = Math.round(base + ((offset + loaded) / blob.size) * (100 - base));
        render();
      });
      if (res.status === 200) { offset = res.data.received; failures = 0; continue; }
      if (res.status === 409 && res.data?.received > offset) { offset = res.data.received; continue; } // that chunk had already landed
      if (res.status === 404) throw new UploadGone();
      if (res.status >= 500 || res.status === 409) throw new Retryable();
      throw new Error(res.data?.error || `Upload failed (${res.status}).`);
    } catch (err) {
      const transient = err instanceof Retryable || err.message === "network";
      if (!transient) throw err;
      if (++failures > 4) throw new Error("Lost the connection. Check your signal and retry.");
      await sleep(1000 * 2 ** (failures - 1));
      try {
        offset = (await getUploadStatus(uploadId)).received; // resume from what the server actually has
      } catch (statusErr) {
        if (statusErr.message === "Upload not found.") throw new UploadGone();
      }
    }
  }
}

function finish(job, detail) {
  job.stage = "done";
  job.pct = 100;
  render();
  try { job.onDone?.(detail); } catch { /* a caller's refresh must not fail the upload */ }
  window.dispatchEvent(new CustomEvent(UPLOADED_EVENT, { detail: { routeId: job.routeId, ...detail } }));
}

// ---------- keep the phone awake while sending ----------
async function holdScreen() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed / unsupported */ }
}
function releaseScreen() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && running) holdScreen(); });
window.addEventListener("beforeunload", (e) => {
  if (!busy()) return;
  e.preventDefault();
  e.returnValue = "";
});

// ---------- the bubble ----------
function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement("div");
  bubble.className = "upload-bubble";
  bubble.setAttribute("role", "status");
  bubble.setAttribute("aria-live", "polite");
  bubble.addEventListener("click", (e) => {
    const act = e.target.closest("[data-ub]")?.dataset.ub;
    if (act === "retry") {
      jobs.filter((j) => j.stage === "error").forEach((j) => { j.stage = "queued"; j.error = ""; });
      render();
      pump();
    } else if (act === "dismiss") {
      jobs.length = 0;
      render();
    }
  });
  document.body.appendChild(bubble);
  return bubble;
}

function render() {
  if (!jobs.length) { bubble?.classList.remove("show"); return; }
  const el = ensureBubble();
  const failed = jobs.filter((j) => j.stage === "error");
  const active = jobs.find((j) => j.stage === "compressing" || j.stage === "uploading") || jobs.find((j) => j.stage === "queued");
  const finishedAll = !busy();
  const total = jobs.length;
  const position = jobs.filter((j) => j.stage === "done").length + 1;
  const of = total > 1 ? ` ${Math.min(position, total)} of ${total}` : "";

  let title, sub, pct, state;
  if (finishedAll && failed.length) {
    state = "error";
    title = "Upload failed";
    sub = failed[0].error;
    pct = failed[0].pct;
  } else if (finishedAll) {
    state = "done";
    title = jobs.every((j) => j.note) ? "Saved on this device" : "Upload complete";
    sub = jobs.map((j) => j.note).find(Boolean) || "";
    pct = 100;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!busy() && !jobs.some((j) => j.stage === "error")) { jobs.length = 0; render(); } }, 2200);
  } else {
    state = "busy";
    title = active.stage === "compressing" && active.file.type.startsWith("video") ? `Compressing${of}…` : `Uploading${of}…`;
    sub = "Keep MATCHBOOK open";
    pct = active.pct;
  }

  // Rebuild only when the words change; a progress tick just moves the bar, so it animates smoothly.
  const key = `${state}|${title}|${sub}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.dataset.state = state;
    el.innerHTML = `
      <div class="ub-row"><span class="ub-title">${escapeHtml(title)}</span>${state === "busy" ? `<span class="ub-pct"></span>` : ""}</div>
      <div class="ub-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="ub-fill"></div></div>
      ${sub ? `<div class="ub-sub">${escapeHtml(sub)}</div>` : ""}
      ${state === "error" ? `<div class="ub-actions"><button type="button" data-ub="retry">Retry</button><button type="button" data-ub="dismiss">Dismiss</button></div>` : ""}`;
  }
  el.querySelector(".ub-fill").style.width = `${pct}%`;
  el.querySelector(".ub-bar").setAttribute("aria-valuenow", pct);
  const pctEl = el.querySelector(".ub-pct");
  if (pctEl) pctEl.textContent = `${pct}%`;
  requestAnimationFrame(() => el.classList.add("show"));
}
