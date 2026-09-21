import { wireScrollTrack } from "../utils.js";

// Same scroll-snap-track + dots + arrows pattern as components/onboarding.js,
// just embedded inline (position:relative) instead of a fullscreen overlay.
export function renderDemoCarousel(container, slides) {
  let index = 0;

  container.innerHTML = `
    <div class="demo-carousel">
      <div class="demo-track" id="demo-track">
        ${slides.map((s) => `
          <div class="demo-slide">
            <img src="${s.src}" alt="${s.alt}" />
            <p>${s.caption}</p>
          </div>
        `).join("")}
      </div>
      <button class="demo-arrow demo-prev hidden" id="demo-prev" aria-label="Previous">‹</button>
      <button class="demo-arrow demo-next" id="demo-next" aria-label="Next">›</button>
      <div class="demo-dots" id="demo-dots">
        ${slides.map((_, i) => `<span class="demo-dot" data-i="${i}"></span>`).join("")}
      </div>
    </div>
  `;

  const track = container.querySelector("#demo-track");
  const dots = [...container.querySelectorAll(".demo-dot")];
  const prevBtn = container.querySelector("#demo-prev");
  const nextBtn = container.querySelector("#demo-next");

  function updateUI() {
    dots.forEach((d, i) => d.classList.toggle("active", i === index));
    prevBtn.classList.toggle("hidden", index === 0);
    nextBtn.classList.toggle("hidden", index === slides.length - 1);
  }

  const scrollToIndex = wireScrollTrack(track, (i) => { index = i; updateUI(); });

  function goTo(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    scrollToIndex(index);
    updateUI();
  }

  prevBtn.addEventListener("click", () => goTo(index - 1));
  nextBtn.addEventListener("click", () => goTo(index + 1));
  dots.forEach((d) => d.addEventListener("click", () => goTo(Number(d.getAttribute("data-i")))));

  updateUI();
}
