import { deleteRoute } from "../data/api.js";
import { showToast } from "./toast.js";
import { escapeHtml, dismissOverlay } from "../utils.js";

// Same shared-password pattern as resetWallModal's ROUTESETTER_KEY, scoped
// to pulling a single climb off the map entirely.
const DELETE_PASSWORD = "TAKEAWAY";

export function openDeleteRouteModal(routeId, label, { onDeleted } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  function close() { dismissOverlay(backdrop); }

  backdrop.innerHTML = `
    <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Delete ${escapeHtml(label)}">
      <div class="mini-popup-title">Delete this climb?</div>
      <div class="page-sub" style="text-align:center;">${escapeHtml(label)} — this removes it from the map for everyone. This can't be undone.</div>
      <div class="auth-error" id="del-error" style="display:none;"></div>
      <div class="field" style="margin-top:4px;margin-bottom:0;">
        <label>Delete Password:</label>
        <input type="password" id="del-password" autocomplete="off"/>
      </div>
      <button class="btn btn-danger btn-block" id="del-confirm-btn" disabled style="margin-top:8px;">DELETE</button>
      <button class="btn btn-ghost btn-block" id="del-cancel-btn">Cancel</button>
    </div>
  `;

  const passwordInput = backdrop.querySelector("#del-password");
  const submitBtn = backdrop.querySelector("#del-confirm-btn");
  const errorEl = backdrop.querySelector("#del-error");

  passwordInput.addEventListener("input", () => {
    submitBtn.disabled = passwordInput.value !== DELETE_PASSWORD;
  });

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#del-cancel-btn").addEventListener("click", close);

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Deleting…";
    errorEl.style.display = "none";
    try {
      await deleteRoute(routeId, passwordInput.value);
      close();
      showToast(`Removed ${label} from the map`);
      onDeleted?.();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
      submitBtn.textContent = "DELETE";
      submitBtn.disabled = passwordInput.value !== DELETE_PASSWORD;
    }
  });
}
