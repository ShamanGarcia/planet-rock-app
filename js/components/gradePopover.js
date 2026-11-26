import { maxGradeFor, gradeScaleLabel } from "../data/constants.js";
import { ropeGradePickerHTML, wireRopeGradePicker } from "./ropeGradePicker.js";
import { clamp } from "../utils.js";

// The grade chooser used by the list view's grade cells and the route drawer:
// a small popup anchored to a button. Boulder shows V0-V11 as buttons; rope shows
// the -/+ toggles over the 5.7-5.14 buttons. Only one is open at a time.

let popover = null;
let popoverAnchor = null;
let popoverCleanup = null;

export const isGradePopoverOpen = () => popover !== null;
export const gradePopoverAnchor = () => popoverAnchor;

export function closeGradePopover() {
  popoverCleanup?.();
  popover = popoverAnchor = popoverCleanup = null;
}

// onPick gets a grade index (null clears, only when allowUngraded). `current` marks
// the active option: a number, null for "Ungraded", or undefined for none.
export function openGradePopover(anchor, { title, discipline, current, allowUngraded = false, onPick }) {
  closeGradePopover();
  const rope = discipline === "rope";
  const pop = document.createElement("div");
  pop.className = `grade-popover${rope ? " rope" : ""}`;
  pop.setAttribute("role", "listbox");
  const option = (label, value) => `<button type="button" role="option" class="grade-option ${current !== undefined && value === current ? "active" : ""}" data-value="${value ?? ""}">${label}</button>`;
  pop.innerHTML = `<div class="grade-popover-title">${title}</div>` +
    (allowUngraded ? option("Ungraded", null) : "") +
    (rope
      ? ropeGradePickerHTML({ label: title })
      : Array.from({ length: maxGradeFor(discipline) + 1 }, (_, g) => option(gradeScaleLabel(g, discipline), g)).join(""));
  document.body.appendChild(pop);

  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const below = a.bottom + 6 + h <= window.innerHeight - 8;
  pop.style.left = `${clamp(a.left, 8, window.innerWidth - w - 8)}px`;
  pop.style.top = `${below ? a.bottom + 6 : Math.max(8, a.top - 6 - h)}px`;

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeGradePopover(); };
  const onKey = (e) => { if (e.key === "Escape") closeGradePopover(); };
  const onScroll = (e) => { if (!pop.contains(e.target)) closeGradePopover(); };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, true);
  popover = pop;
  popoverAnchor = anchor;
  popoverCleanup = () => {
    pop.remove();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
  };

  const pick = (value) => { closeGradePopover(); onPick(value); };
  pop.addEventListener("click", (e) => {
    const opt = e.target.closest(".grade-option");
    if (opt) pick(opt.dataset.value === "" ? null : Number(opt.dataset.value));
  });
  if (rope) {
    wireRopeGradePicker(pop.querySelector("[data-rope-grade]"), current ?? null, (v) => { if (v !== null) pick(v); }, { deselect: false });
  }
}
