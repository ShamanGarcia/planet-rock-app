import { logSend } from "../data/api.js";
import { escapeHtml, fileToDataUrl } from "../utils.js";
import { showToast } from "./toast.js";

// Small confirm step before logging a send, with an optional photo/video
// attachment that gets added to the route's own gallery.
export function openLogSendSheet(routeId, label, { onLogged } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  let mediaDataUrl = null;
  let mediaKind = null; // "photo" | "video"
  let submitting = false;
  let error = "";

  function close() { backdrop.remove(); }

  function render() {
    backdrop.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Log send">
        <div class="mini-popup-title">Log Send — ${escapeHtml(label)}</div>
        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
        ${mediaDataUrl ? `
          <div class="route-photo" style="max-height:160px;margin-bottom:10px;">
            ${mediaKind === "video" ? `<video src="${mediaDataUrl}" style="width:100%;height:100%;object-fit:cover;" muted></video>` : `<img src="${mediaDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`}
          </div>
        ` : ""}
        <input type="file" accept="image/*,video/*" capture="environment" id="ls-media-input" class="visually-hidden" />
        <button type="button" class="btn btn-outline btn-sm btn-block" id="ls-media-btn" style="margin-bottom:10px;">
          📷 ${mediaDataUrl ? "Change Photo/Video" : "Add a Photo or Video (optional)"}
        </button>
        <button class="btn btn-primary btn-block" id="ls-confirm" ${submitting ? "disabled" : ""}>${submitting ? "Logging…" : "🧗 Log Send"}</button>
        <button class="btn btn-ghost btn-block" id="ls-cancel" style="margin-top:6px;">Cancel</button>
      </div>
    `;

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#ls-cancel").addEventListener("click", close);

    const mediaInput = backdrop.querySelector("#ls-media-input");
    backdrop.querySelector("#ls-media-btn").addEventListener("click", () => mediaInput.click());
    mediaInput.addEventListener("change", async () => {
      const file = mediaInput.files?.[0];
      if (!file) return;
      try {
        mediaDataUrl = await fileToDataUrl(file);
        mediaKind = file.type.startsWith("video") ? "video" : "photo";
        render();
      } catch {
        error = "Couldn't read that file — try another one.";
        render();
      }
    });

    backdrop.querySelector("#ls-confirm").addEventListener("click", async () => {
      if (submitting) return;
      submitting = true;
      error = "";
      render();
      try {
        await logSend(routeId, { mediaDataUrl });
        close();
        showToast("Send logged! 🎉");
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
