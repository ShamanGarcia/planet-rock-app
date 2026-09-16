import { dismissOverlay, escapeHtml } from "../utils.js";

// Same shared-password pattern as deleteRouteModal.js / resetWallModal.js,
// generalized so this one component covers all 4 password prompts the
// admin-controls feature needs (login, delete user, delete tag, delete
// route) instead of 4 near-duplicate files.
export function openPasswordPromptModal({
  title, message, expectedPassword, confirmLabel = "CONFIRM",
  danger = false, onConfirm,
}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);

  function close() { dismissOverlay(backdrop); }

  backdrop.innerHTML = `
    <div class="mini-popup" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="mini-popup-title">${escapeHtml(title)}</div>
      ${message ? `<div class="page-sub" style="text-align:center;">${escapeHtml(message)}</div>` : ""}
      <div class="auth-error" id="pp-error" style="display:none;"></div>
      <div class="field" style="margin-top:4px;margin-bottom:0;">
        <label>Password:</label>
        <input type="password" id="pp-password" autocomplete="off"/>
      </div>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" id="pp-confirm-btn" disabled style="margin-top:8px;">${escapeHtml(confirmLabel)}</button>
      <button class="btn btn-ghost btn-block" id="pp-cancel-btn">Cancel</button>
    </div>
  `;

  const passwordInput = backdrop.querySelector("#pp-password");
  const submitBtn = backdrop.querySelector("#pp-confirm-btn");
  const errorEl = backdrop.querySelector("#pp-error");

  passwordInput.addEventListener("input", () => {
    submitBtn.disabled = passwordInput.value !== expectedPassword;
  });

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#pp-cancel-btn").addEventListener("click", close);

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Working…";
    errorEl.style.display = "none";
    try {
      await onConfirm(passwordInput.value);
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "";
      submitBtn.textContent = originalLabel;
      submitBtn.disabled = passwordInput.value !== expectedPassword;
    }
  });
}
