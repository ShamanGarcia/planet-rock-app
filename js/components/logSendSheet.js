import { logSend } from "../data/api.js";
import { playSendCounter } from "./sendCounter.js";
import { enqueueUpload } from "../data/upload.js";
import { isMediaFile } from "../data/media.js";
import { escapeHtml, dismissOverlay } from "../utils.js";
import { showToast } from "./toast.js";

// Small confirm step before logging a send, with an optional photo/video
// attachment for the route's gallery. The send is logged straight away; the media
// is compressed and uploaded in the background (data/upload.js) and shows in the
// gallery — and in the Reel, for a public video — once it lands.
export function openLogSendSheet(routeId, label, { onLogged } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  let file = null;
  let previewUrl = null; // object URL of the picked file: instant, nothing is read or encoded yet
  let submitting = false;
  let flash = false;
  let error = "";

  function close() {
    URL.revokeObjectURL(previewUrl);
    dismissOverlay(backdrop);
  }

  function render() {
    backdrop.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Log send">
        <div class="mini-popup-title">Log Send — ${escapeHtml(label)}</div>
        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
        ${file ? `
          <div class="route-photo" style="max-height:160px;margin-bottom:6px;">
            ${file.type.startsWith("video") ? `<video src="${previewUrl}" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>` : `<img src="${previewUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`}
          </div>
          <div class="field-hint" style="margin-bottom:10px;">Will be added to the shared gallery for everyone to see.</div>
        ` : ""}
        <input type="file" accept="image/*,video/*" id="ls-media-input" class="visually-hidden" />
        <button type="button" class="btn btn-outline btn-sm btn-block" id="ls-media-btn" style="margin-bottom:10px;">
          ${file ? "Change Photo/Video" : "Add a Photo or Video (optional)"}
        </button>
        ${file ? `<button type="button" class="btn btn-ghost btn-sm btn-block" id="ls-media-remove" style="margin-bottom:10px;">Remove Photo/Video</button>` : ""}
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
      URL.revokeObjectURL(previewUrl);
      file = null;
      previewUrl = null;
      render();
    });
    mediaInput.addEventListener("change", () => {
      const picked = mediaInput.files?.[0];
      if (!picked) return;
      if (!isMediaFile(picked)) { error = "Choose a photo or a video."; render(); return; }
      URL.revokeObjectURL(previewUrl);
      file = picked;
      previewUrl = URL.createObjectURL(picked);
      error = "";
      render();
    });

    backdrop.querySelector("#ls-flash").addEventListener("change", (e) => { flash = e.target.checked; });

    backdrop.querySelector("#ls-confirm").addEventListener("click", async () => {
      if (submitting) return;
      submitting = true;
      error = "";
      render();
      try {
        const { entry } = await logSend(routeId, { flash });
        if (file) enqueueUpload({ routeId, file, logEntryId: entry.id }); // the bubble takes it from here
        close();
        showToast("Send logged");
        playSendCounter();
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
