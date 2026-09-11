import { dismissOverlay } from "../utils.js";

// Shown once per browser (localStorage, not per-account — a fresh device or
// a cleared site data means seeing it again, which is fine for a tour).
const SEEN_KEY = "matchbookOnboardingSeen";

const SLIDES = [
  { title: "The Gym Map", body: "See which routes are up, and post new ones the moment they go up. Tap an area to look closer." },
  { title: "Climbing Log", body: "Every completed route lands here. Check your stats anytime from the top right." },
  { title: "Your Profile", body: "Add a bit about yourself — hometown, favorite hold, how long you've been climbing." },
  { title: "Friends", body: "Add friends to share completed climbs and compare stats." },
  { title: "Photos & Videos", body: "Upload a photo or video when you log a send, or add one later from the climbing log." },
];

export function maybeShowOnboarding() {
  if (localStorage.getItem(SEEN_KEY)) return;
  showOnboarding();
}

function showOnboarding() {
  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  document.body.appendChild(overlay);

  overlay.innerHTML = `
    <button class="onboarding-skip" id="ob-skip">Skip</button>
    <div class="onboarding-track" id="ob-track">
      ${SLIDES.map((s, i) => `
        <div class="onboarding-slide">
          <div class="onboarding-num">${i + 1}</div>
          <h2>${s.title}</h2>
          <p>${s.body}</p>
        </div>
      `).join("")}
    </div>
    <div class="onboarding-dots" id="ob-dots">
      ${SLIDES.map((_, i) => `<span class="onboarding-dot" data-i="${i}"></span>`).join("")}
    </div>
    <button class="onboarding-arrow onboarding-prev hidden" id="ob-prev" aria-label="Previous">‹</button>
    <button class="onboarding-arrow onboarding-next" id="ob-next" aria-label="Next">›</button>
  `;

  const track = overlay.querySelector("#ob-track");
  const dots = [...overlay.querySelectorAll(".onboarding-dot")];
  const prevBtn = overlay.querySelector("#ob-prev");
  const nextBtn = overlay.querySelector("#ob-next");
  let index = 0;

  function finish() {
    localStorage.setItem(SEEN_KEY, "1");
    document.removeEventListener("keydown", onKey);
    dismissOverlay(overlay);
  }

  function goTo(i) {
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
    updateUI();
  }

  function updateUI() {
    dots.forEach((d, i) => d.classList.toggle("active", i === index));
    prevBtn.classList.toggle("hidden", index === 0);
    const last = index === SLIDES.length - 1;
    nextBtn.textContent = last ? "Get Started" : "›";
    nextBtn.classList.toggle("onboarding-arrow-done", last);
  }

  let scrollTimer = null;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      index = Math.round(track.scrollLeft / track.clientWidth);
      updateUI();
    }, 80);
  });

  function onKey(e) {
    if (e.key === "ArrowLeft") goTo(index - 1);
    else if (e.key === "ArrowRight") goTo(index + 1);
    else if (e.key === "Escape") finish();
  }
  document.addEventListener("keydown", onKey);

  prevBtn.addEventListener("click", () => goTo(index - 1));
  nextBtn.addEventListener("click", () => {
    if (index === SLIDES.length - 1) finish();
    else goTo(index + 1);
  });
  overlay.querySelector("#ob-skip").addEventListener("click", finish);
  dots.forEach((d) => d.addEventListener("click", () => goTo(Number(d.getAttribute("data-i")))));

  // Slide width is a fraction of viewport width, so keep the scroll
  // position aligned if the viewport is resized (e.g. orientation change).
  window.addEventListener("resize", () => track.scrollTo({ left: index * track.clientWidth }));

  updateUI();
}
