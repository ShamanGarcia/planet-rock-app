import { logSend } from "../data/api.js";
import { saveLocalMedia } from "../data/localMedia.js";
import { SHARED_MEDIA_LIMIT_BYTES } from "../data/constants.js";
import { escapeHtml, fileToDataUrl, compressImageFile, dataUrlByteSize, dismissOverlay } from "../utils.js";
import { showToast } from "./toast.js";

// Small confirm step before logging a send, with an optional photo/video
// attachment that gets added to the route's own gallery. Photos are
// compressed client-side; anything (photo or video) still over
// SHARED_MEDIA_LIMIT_BYTES after that is kept private on this device rather
// than uploaded to the shared server.
export function openLogSendSheet(routeId, label, { onLogged } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  let mediaDataUrl = null;
  let mediaKind = null; // "photo" | "video"
  let tooBigForSharing = false;
  let processingFile = false;
  let submitting = false;
  let flash = false;
  let error = "";

  function close() { dismissOverlay(backdrop); }

  function render() {
    backdrop.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Log send">
        <div class="mini-popup-title">Log Send — ${escapeHtml(label)}</div>
        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
        ${mediaDataUrl ? `
          <div class="route-photo" style="max-height:160px;margin-bottom:6px;">
            ${mediaKind === "video" ? `<video src="${mediaDataUrl}" style="width:100%;height:100%;object-fit:cover;" muted></video>` : `<img src="${mediaDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`}
          </div>
          ${tooBigForSharing ? `<div class="field-hint" style="margin-bottom:10px;">This file is large — it'll be saved privately on this device only, not shared with other climbers.</div>` : `<div class="field-hint" style="margin-bottom:10px;">Will be added to the shared gallery for everyone to see.</div>`}
        ` : ""}
        <input type="file" accept="image/*,video/*" id="ls-media-input" class="visually-hidden" />
        <button type="button" class="btn btn-outline btn-sm btn-block" id="ls-media-btn" style="margin-bottom:10px;" ${processingFile ? "disabled" : ""}>
          ${processingFile ? "Processing…" : mediaDataUrl ? "Change Photo/Video" : "Add a Photo or Video (optional)"}
        </button>
        ${mediaDataUrl ? `<button type="button" class="btn btn-ghost btn-sm btn-block" id="ls-media-remove" style="margin-bottom:10px;">Remove Photo/Video</button>` : ""}
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13.5px;">
          <input type="checkbox" id="ls-flash" ${flash ? "checked" : ""} /> Flash
        </label>
        <button class="btn btn-primary btn-block" id="ls-confirm" ${submitting ? "disabled" : ""}>${submitting ? "Logging…" : "Log Send"}</button>
        <button class="btn btn-ghost btn-block" id="ls-cancel" style="margin-top:6px;">Cancel</button>
      </div>
    `;

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#ls-cancel").addEventListener("click", close);

    const mediaInput = backdrop.querySelector("#ls-media-input");
    backdrop.querySelector("#ls-media-btn").addEventListener("click", () => mediaInput.click());
    backdrop.querySelector("#ls-media-remove")?.addEventListener("click", () => {
      mediaDataUrl = null;
      mediaKind = null;
      tooBigForSharing = false;
      render();
    });
    mediaInput.addEventListener("change", async () => {
      const file = mediaInput.files?.[0];
      if (!file) return;
      processingFile = true;
      render();
      try {
        const isVideo = file.type.startsWith("video");
        mediaDataUrl = isVideo ? await fileToDataUrl(file) : await compressImageFile(file);
        mediaKind = isVideo ? "video" : "photo";
        tooBigForSharing = dataUrlByteSize(mediaDataUrl) > SHARED_MEDIA_LIMIT_BYTES;
      } catch {
        error = "Couldn't read that file — try another one.";
        mediaDataUrl = null;
      }
      processingFile = false;
      render();
    });

    backdrop.querySelector("#ls-flash").addEventListener("change", (e) => { flash = e.target.checked; });

    backdrop.querySelector("#ls-confirm").addEventListener("click", async () => {
      if (submitting) return;
      submitting = true;
      error = "";
      render();
      try {
        const shareable = mediaDataUrl && !tooBigForSharing;
        await logSend(routeId, { mediaDataUrl: shareable ? mediaDataUrl : null, flash });
        if (mediaDataUrl && tooBigForSharing) {
          await saveLocalMedia(routeId, mediaKind, mediaDataUrl);
        }
        close();
        showToast(tooBigForSharing && mediaDataUrl ? "Send logged — photo/video saved privately" : "Send logged");
        onLogged?.();
      } catch (err) {
        submitting = false;
        error = err.message;
        render();
      }
    });
  }

  render();
}
