export function renderLanding(container, onNavigate) {
  container.innerHTML = `
    <div class="landing-wrap">
      <div class="landing-content">
        <h1 class="landing-wordmark">MATCHBOOK</h1>
        <p class="landing-subtext">Explore the gym, track your climbs.</p>
        <img class="landing-demo" src="assets/demo-mobile.gif" alt="MATCHBOOK app demo" />
        <button class="btn btn-primary btn-block landing-cta" id="landing-signup">Sign Up</button>
        <button class="landing-login" id="landing-login">Already have an account? Log In</button>
      </div>
    </div>
  `;
  container.querySelector("#landing-signup").addEventListener("click", () => onNavigate("signup"));
  container.querySelector("#landing-login").addEventListener("click", () => onNavigate("login"));
}
