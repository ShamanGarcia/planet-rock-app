import { resetWallSection } from "../data/api.js";
import { showToast } from "./toast.js";
import { escapeHtml } from "../utils.js";

// Given to route setters when they physically take down a wall's holds —
// lets them clear every posted route for that zone before setting new ones.
// This is a shared plain-text key (not per-user auth), matching how gyms
// hand routesetters a single code; the server checks it too.
const ROUTESETTER_KEY = "TEARDOWN";

export function openResetWallModal(gymId, wallSectionId, wallSectionName, { onReset } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  function close() { backdrop.remove(); }

  backdrop.innerHTML = `
    <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Reset ${escapeHtml(wallSectionName)}">
      <div class="mini-popup-title">Do you wish to reset this wall</div>
      <div class="page-sub" style="text-align:center;">${escapeHtml(wallSectionName)} — this removes every route currently posted here.</div>
      <div class="auth-error" id="reset-error" style="display:none;"></div>
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="reset-confirm"/> YES
      </label>
      <div class="field" style="margin-top:4px;margin-bottom:0;">
        <label>ROUTESETTER KEY:</label>
        <input type="text" id="reset-key" autocomplete="off"/>
      </div>
      <button class="btn btn-danger btn-block" id="reset-confirm-btn" disabled style="margin-top:8px;">RESET</button>
      <button class="btn btn-ghost btn-block" id="reset-cancel-btn">Cancel</button>
    </div>
  `;

  const checkbox = backdrop.querySelector("#reset-confirm");
  const keyInput = backdrop.querySelector("#reset-key");
  const submitBtn = backdrop.querySelector("#reset-confirm-btn");
  const errorEl = backdrop.querySelector("#reset-error");

  function updateSubmitState() {
    submitBtn.disabled = !(checkbox.checked && keyInput.value === ROUTESETTER_KEY);
  }
  checkbox.addEventListener("change", updateSubmitState);
  keyInput.addEventListener("input", updateSubmitState);

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#reset-cancel-btn").addEventListener("click", close);

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Resetting…";
    errorEl.style.display = "none";
    try {
      const result = await resetWallSection(gymId, wallSectionId, keyInput.value);
      close();
      showToast(`Removed ${result.removed} route${result.removed === 1 ? "" : "s"} from ${wallSectionName}`);
      onReset?.();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
      submitBtn.textContent = "RESET";
      updateSubmitState();
    }
  });
}
