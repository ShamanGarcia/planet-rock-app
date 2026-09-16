import { renderDemoCarousel } from "../components/demoCarousel.js";

const DEMO_SLIDES = [
  { src: "assets/demo/map.png", alt: "Gym map view", caption: "See every route in the gym organized by color, grade, and more." },
  { src: "assets/demo/route.png", alt: "Viewing a route", caption: "Tap any route to see its grade, community estimate, and tags." },
  { src: "assets/demo/add-route.png", alt: "Adding a route", caption: "Spot a new problem? Add it to the map in seconds." },
  { src: "assets/demo/log.png", alt: "Climbing log", caption: "Every send is logged automatically to build your climbing history." },
  { src: "assets/demo/stats.png", alt: "Stats page", caption: "Track your progress with grade, area, and style breakdowns." },
  { src: "assets/demo/profile.png", alt: "Updating profile", caption: "Personalize your profile with your favorite holds and grades." },
  { src: "assets/demo/friends.png", alt: "Adding friends", caption: "Find climbing partners and follow their progress." },
];

export function renderLanding(container, onNavigate) {
  container.innerHTML = `
    <div class="landing-wrap">
      <div class="landing-content">
        <h1 class="landing-wordmark">MATCHBOOK</h1>
        <p class="landing-subtext">Explore the gym, track your climbs.</p>
        <div class="landing-demo" id="landing-demo"></div>
        <button class="btn btn-primary btn-block landing-cta" id="landing-signup">Sign Up</button>
        <button class="landing-login" id="landing-login">Already have an account? Log In</button>
      </div>
    </div>
  `;
  renderDemoCarousel(container.querySelector("#landing-demo"), DEMO_SLIDES);
  container.querySelector("#landing-signup").addEventListener("click", () => onNavigate("signup"));
  container.querySelector("#landing-login").addEventListener("click", () => onNavigate("login"));
}
