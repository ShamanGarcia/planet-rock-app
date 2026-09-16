import { bootSession, getCurrentUser } from "./data/api.js";
import { renderAuth } from "./views/auth.js";
import { renderLanding } from "./views/landing.js";
import { renderShell } from "./shell.js";
import { maybeShowOnboarding } from "./components/onboarding.js";

async function boot() {
  const root = document.getElementById("app");
  root.innerHTML = `<div class="auth-wrap"><div style="color:#fff;font-weight:700;">Loading Planet Rock…</div></div>`;
  await bootSession();
  const user = getCurrentUser();
  if (!user) {
    renderLanding(root, (mode) => renderAuth(root, boot, mode));
  } else {
    renderShell(root);
    maybeShowOnboarding();
  }
}

boot();
