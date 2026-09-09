import { logIn, signUp, requestPasswordReset, confirmPasswordReset } from "../data/api.js";
import { escapeHtml } from "../utils.js";

export function renderAuth(root, onAuthed) {
  let mode = "login"; // login | signup | reset-request | reset-confirm
  let error = "";
  let resetEmail = "";

  function render() {
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo"><span class="logo-mark">🧗</span><strong>Planet Rock</strong></div>
          ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
          ${mode === "login" ? loginForm() : ""}
          ${mode === "signup" ? signupForm() : ""}
          ${mode === "reset-request" ? resetRequestForm() : ""}
          ${mode === "reset-confirm" ? resetConfirmForm() : ""}
        </div>
      </div>
    `;
    wire();
  }

  function loginForm() {
    return `
      <form id="login-form">
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="you@example.com" value="shgarcia@umich.edu"/></div>
        <div class="field"><label>Password</label><input type="password" name="password" required placeholder="Password" value="climb123"/></div>
        <button class="btn btn-primary btn-block" type="submit">Log In</button>
      </form>
      <div class="auth-switch"><button id="to-reset">Forgot password?</button></div>
      <div class="auth-switch">No account? <button id="to-signup">Sign up</button></div>
      <div class="auth-note">Demo account pre-filled: shgarcia@umich.edu / climb123</div>
    `;
  }

  function signupForm() {
    return `
      <form id="signup-form">
        <div class="field"><label>Name</label><input type="text" name="name" required placeholder="Jane Climber"/></div>
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="you@example.com"/></div>
        <div class="field"><label>Password</label><input type="password" name="password" required minlength="4" placeholder="Password"/></div>
        <button class="btn btn-primary btn-block" type="submit">Create Account</button>
      </form>
      <div class="auth-switch">Already have an account? <button id="to-login">Log in</button></div>
    `;
  }

  function resetRequestForm() {
    return `
      <form id="reset-request-form">
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="you@example.com"/></div>
        <button class="btn btn-primary btn-block" type="submit">Send Reset Code</button>
      </form>
      <div class="auth-switch"><button id="to-login">Back to log in</button></div>
    `;
  }

  function resetConfirmForm() {
    return `
      <div class="auth-note">A reset code would normally be emailed to <strong>${escapeHtml(resetEmail)}</strong>. For this prototype, use code <strong>000000</strong>.</div>
      <form id="reset-confirm-form">
        <div class="field"><label>Reset code</label><input type="text" name="code" required placeholder="000000"/></div>
        <div class="field"><label>New password</label><input type="password" name="password" required minlength="4" placeholder="New password"/></div>
        <button class="btn btn-primary btn-block" type="submit">Reset Password</button>
      </form>
      <div class="auth-switch"><button id="to-login">Back to log in</button></div>
    `;
  }

  function wire() {
    root.querySelector("#to-signup")?.addEventListener("click", () => { mode = "signup"; error = ""; render(); });
    root.querySelector("#to-login")?.addEventListener("click", () => { mode = "login"; error = ""; render(); });
    root.querySelector("#to-reset")?.addEventListener("click", () => { mode = "reset-request"; error = ""; render(); });

    root.querySelector("#login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await logIn(fd.get("email"), fd.get("password"));
        onAuthed();
      } catch (err) { error = err.message; render(); }
    });

    root.querySelector("#signup-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await signUp({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password") });
        onAuthed();
      } catch (err) { error = err.message; render(); }
    });

    root.querySelector("#reset-request-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await requestPasswordReset(fd.get("email"));
        resetEmail = fd.get("email");
        mode = "reset-confirm";
        error = "";
        render();
      } catch (err) { error = err.message; render(); }
    });

    root.querySelector("#reset-confirm-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await confirmPasswordReset(resetEmail, fd.get("code"), fd.get("password"));
        mode = "login";
        error = "";
        render();
      } catch (err) { error = err.message; render(); }
    });
  }

  render();
}
