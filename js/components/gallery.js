import { getRouteMedia, addRouteMedia } from "../data/api.js";
import { getLocalMediaForRoute } from "../data/localMedia.js";
import { escapeHtml, formatDateTime, dismissOverlay, pickMedia } from "../utils.js";
import { showToast } from "./toast.js";

// Merges the shared (server) gallery with anything this device kept private
// because it was too large to upload (see SHARED_MEDIA_LIMIT_BYTES). Device-
// only items are always personal to this viewer, so they lead the list;
// `shared` already comes back from the server with the viewer's own private
// uploads pinned first and everything else newest-first — that order is
// kept as-is rather than re-sorted by date here.
export async function getCombinedMedia(routeId) {
  const [shared, local] = await Promise.all([
    getRouteMedia(routeId).catch(() => []),
    getLocalMediaForRoute(routeId).catch(() => []),
  ]);
  local.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return [...local, ...shared];
}

function isPrivate(m) {
  return m.isLocal || m.visibility === "private";
}

function mediaThumbHTML(m, idx) {
  const lockBadge = isPrivate(m) ? `<span class="gallery-lock" title="Private — only you can see this">PRIVATE</span>` : "";
  return m.type === "video"
    ? `<button class="gallery-item" data-idx="${idx}" aria-label="Play video">${lockBadge}<video src="${m.url}" muted></video><span class="gallery-play">PLAY</span></button>`
    : `<button class="gallery-item" data-idx="${idx}" aria-label="View photo">${lockBadge}<img src="${m.url}" alt="" loading="lazy"/></button>`;
}

function openLightbox(media, startIndex) {
  let index = startIndex;
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  document.body.appendChild(overlay);

  function render() {
    const m = media[index];
    overlay.innerHTML = `
      <button class="lightbox-close" aria-label="Close">X</button>
      ${media.length > 1 ? `<button class="lightbox-nav lightbox-prev" aria-label="Previous">‹</button>` : ""}
      <div class="lightbox-media">
        ${m.type === "video" ? `<video src="${m.url}" controls autoplay playsinline></video>` : `<img src="${m.url}" alt=""/>`}
      </div>
      ${media.length > 1 ? `<button class="lightbox-nav lightbox-next" aria-label="Next">›</button>` : ""}
      <div class="lightbox-caption">${isPrivate(m) ? "Private" : escapeHtml(m.uploadedByName || "")} · ${formatDateTime(m.createdAt)}</div>
    `;
    overlay.querySelector(".lightbox-close").addEventListener("click", close);
    overlay.querySelector(".lightbox-prev")?.addEventListener("click", () => { index = (index - 1 + media.length) % media.length; render(); });
    overlay.querySelector(".lightbox-next")?.addEventListener("click", () => { index = (index + 1) % media.length; render(); });
  }

  function close() {
    dismissOverlay(overlay, 160);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") { index = (index - 1 + media.length) % media.length; render(); }
    else if (e.key === "ArrowRight") { index = (index + 1) % media.length; render(); }
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  render();
}

export async function openFullGallery(routeId, label) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);
  backdrop.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-label="Gallery for ${escapeHtml(label)}">
      <div class="drawer-handle"></div>
      <div class="drawer-header"><h2>${escapeHtml(label)} Gallery</h2><button class="icon-btn" style="background:#efece5;color:#1b1d21" id="gal-close">X</button></div>
      <div id="gal-body"><div class="empty-state">Loading…</div></div>
    </div>
  `;
  backdrop.querySelector("#gal-close").addEventListener("click", () => dismissOverlay(backdrop));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) dismissOverlay(backdrop); });

  let media = [];
  try {
    media = await getCombinedMedia(routeId);
  } catch {
    backdrop.querySelector("#gal-body").innerHTML = `<div class="empty-state">Couldn't load the gallery.</div>`;
    return;
  }

  const body = backdrop.querySelector("#gal-body");
  if (!media.length) {
    body.innerHTML = `<div class="empty-state"><div>No photos or videos yet for this route.</div><div class="page-sub">Attach one next time you log a send.</div></div>`;
    return;
  }
  body.innerHTML = `<div class="gallery-grid">${media.map(mediaThumbHTML).join("")}</div>`;
  body.querySelectorAll(".gallery-item").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(media, Number(btn.getAttribute("data-idx"))));
  });
}

// Lets the climber attach their own photo/video to a route's gallery, with
// an explicit public/private choice — separate from the older "too big to
// share" auto-private fallback (see localMedia.js), this always goes to the
// server, just access-controlled by uploader (see get_route_media server-side).
function openAddMediaForm(routeId, label, { onAdded } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  let dataUrl = null;
  let kind = null; // "photo" | "video"
  let visibility = "public";
  let processing = false;
  let submitting = false;
  let error = "";

  function close() { dismissOverlay(backdrop); }

  function render() {
    backdrop.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Add your climb">
        <div class="mini-popup-title">Add Your Climb</div>
        <div class="page-sub" style="text-align:center;">${escapeHtml(label)}</div>
        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
        ${dataUrl ? `
          <div class="route-photo" style="max-height:160px;margin-bottom:6px;">
            ${kind === "video" ? `<video src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;" muted></video>` : `<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`}
          </div>
        ` : ""}
        <input type="file" accept="image/*,video/*" id="am-input" class="visually-hidden"/>
        <button type="button" class="btn btn-outline btn-sm btn-block" id="am-pick-btn" ${processing ? "disabled" : ""}>
          ${processing ? "Processing…" : dataUrl ? "Choose a Different File" : "Choose Photo or Video"}
        </button>
        <div class="field" style="margin-top:10px;margin-bottom:0;">
          <label>Visibility</label>
          <select id="am-visibility">
            <option value="public" ${visibility === "public" ? "selected" : ""}>Public — everyone can see it</option>
            <option value="private" ${visibility === "private" ? "selected" : ""}>Private — only you can see it</option>
          </select>
        </div>
        <div class="field-hint">A private climb always shows first when you view this gallery — no one else sees it at all.</div>
        <button class="btn btn-primary btn-block" id="am-submit" ${dataUrl && !submitting ? "" : "disabled"} style="margin-top:4px;">${submitting ? "Adding…" : "Add"}</button>
        <button class="btn btn-ghost btn-block" id="am-cancel">Cancel</button>
      </div>
    `;

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#am-cancel").addEventListener("click", close);

    backdrop.querySelector("#am-visibility").addEventListener("change", (e) => { visibility = e.target.value; });

    const input = backdrop.querySelector("#am-input");
    backdrop.querySelector("#am-pick-btn").addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      processing = true;
      error = "";
      render();
      try {
        ({ dataUrl, kind } = await pickMedia(file));
      } catch {
        error = "Couldn't read that file — try another one.";
        dataUrl = null;
      }
      processing = false;
      render();
    });

    backdrop.querySelector("#am-submit").addEventListener("click", async () => {
      if (!dataUrl || submitting) return;
      submitting = true;
      error = "";
      render();
      try {
        await addRouteMedia(routeId, dataUrl, visibility);
        close();
        showToast("Added to the gallery");
        onAdded?.();
      } catch (err) {
        submitting = false;
        error = err.message;
        render();
      }
    });
  }

  render();
}

// Small "show gallery" prompt, opened from a tap on a route elsewhere in the
// app (e.g. a climbing log row) before committing to the full viewer.
export function openGalleryPrompt(routeId, label) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);
  backdrop.innerHTML = `
    <div class="mini-popup" role="dialog" aria-modal="true">
      <div class="mini-popup-title">${escapeHtml(label)}</div>
      <button class="btn btn-primary btn-sm btn-block" id="mp-gallery">Show Gallery</button>
      <button class="btn btn-outline btn-sm btn-block" id="mp-add">Add Your Climb</button>
      <button class="btn btn-ghost btn-sm btn-block" id="mp-close">Close</button>
    </div>
  `;
  function close() { dismissOverlay(backdrop); }
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#mp-close").addEventListener("click", close);
  backdrop.querySelector("#mp-gallery").addEventListener("click", () => {
    close();
    openFullGallery(routeId, label);
  });
  backdrop.querySelector("#mp-add").addEventListener("click", () => {
    close();
    openAddMediaForm(routeId, label, { onAdded: () => openFullGallery(routeId, label) });
  });
}
