import { DISCIPLINES, DISCIPLINE_LABELS } from "../data/constants.js";

// Buttons for the Bouldering | Rope toggle (map, stats and log pages share them).
// Each button carries its 8-bit icon in a drawer that is collapsed until a click:
// the toggle then grows downward to reveal both icons and collapses again.
const ICONS = { boulder: "/assets/icons/rock.svg", rope: "/assets/icons/rock-stack.png" };
const OPEN_MS = 1100;

export function disciplineButtonsHTML(active = null) {
  return DISCIPLINES.map((d) => `<button type="button" class="${d === active ? "active" : ""}" data-discipline="${d}" aria-pressed="${d === active}">
    <span>${DISCIPLINE_LABELS[d]}</span><span class="dt-icon"><img src="${ICONS[d]}" alt="" width="40" height="40"/></span>
  </button>`).join("");
}

// One delegated listener covers every toggle, whichever view rendered it.
document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".discipline-toggle button")?.closest(".discipline-toggle");
  if (!toggle) return;
  toggle.classList.add("open");
  clearTimeout(toggle._closeTimer);
  toggle._closeTimer = setTimeout(() => toggle.classList.remove("open"), OPEN_MS);
});
