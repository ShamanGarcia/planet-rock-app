import { getRouteMedia } from "../data/api.js";
import { getLocalMediaForRoute } from "../data/localMedia.js";
import { escapeHtml, formatDateTime } from "../utils.js";

// Merges the shared (server) gallery with anything this device kept private
// because it was too large to upload (see SHARED_MEDIA_LIMIT_BYTES), newest
// first, so the owner still sees everything even though no one else can.
export async function getCombinedMedia(routeId) {
  const [shared, local] = await Promise.all([
    getRouteMedia(routeId).catch(() => []),
    getLocalMediaForRoute(routeId).catch(() => []),
  ]);
  return [...shared, ...local].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function mediaThumbHTML(m, idx) {
  const lockBadge = m.isLocal ? `<span class="gallery-lock" title="Private — only on this device">PRIVATE</span>` : "";
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
      <div class="lightbox-caption">${m.isLocal ? "Private, this device" : escapeHtml(m.uploadedByName || "")} · ${formatDateTime(m.createdAt)}</div>
    `;
    overlay.querySelector(".lightbox-close").addEventListener("click", close);
    overlay.querySelector(".lightbox-prev")?.addEventListener("click", () => { index = (index - 1 + media.length) % media.length; render(); });
    overlay.querySelector(".lightbox-next")?.addEventListener("click", () => { index = (index + 1) % media.length; render(); });
  }

  function close() {
    overlay.remove();
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
  backdrop.querySelector("#gal-close").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

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
      <button class="btn btn-ghost btn-sm btn-block" id="mp-close">Close</button>
    </div>
  `;
  function close() { backdrop.remove(); }
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#mp-close").addEventListener("click", close);
  backdrop.querySelector("#mp-gallery").addEventListener("click", () => {
    close();
    openFullGallery(routeId, label);
  });
}
