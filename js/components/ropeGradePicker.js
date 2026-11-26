import { ROPE_BASE_GRADES, ropeGradeIndex, decodeRopeGrade } from "../data/constants.js";

// Rope grade input: "-" and "+" toggles on top, then the base grades (5.7-5.14)
// in two rows below. Neither toggle on means the plain grade; the two are
// exclusive. The value it reports is the stored rope-grade index (see
// constants.js), or null while no grade is picked.

export function ropeGradePickerHTML({ label = "Rope grade" } = {}) {
  return `
    <div class="rope-grade-picker" data-rope-grade>
      <div class="rgp-mods">
        <button type="button" class="rgp-mod" data-mod="-" aria-pressed="false" aria-label="Minus (${label})">&minus;</button>
        <button type="button" class="rgp-mod" data-mod="+" aria-pressed="false" aria-label="Plus (${label})">+</button>
      </div>
      <div class="rgp-grid">
        ${ROPE_BASE_GRADES.map((b) => `<button type="button" class="rgp-base" data-base="${b}" aria-pressed="false">5.${b}</button>`).join("")}
      </div>
    </div>`;
}

// Wires the markup above. `initial` is a grade index or null; onChange gets the
// new index or null. Tapping the picked base again clears it unless deselect is
// false (a popup that commits on tap). Returns { get, set }.
export function wireRopeGradePicker(root, initial, onChange, { deselect = true } = {}) {
  const mods = [...root.querySelectorAll(".rgp-mod")];
  const bases = [...root.querySelectorAll(".rgp-base")];
  let base = null;
  let modifier = "";

  const value = () => (base === null ? null : ropeGradeIndex(base, modifier));

  function paint() {
    mods.forEach((b) => {
      const on = b.dataset.mod === modifier;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    bases.forEach((b) => {
      const on = Number(b.dataset.base) === base;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function set(index) {
    if (index === null || index === undefined || index === "") {
      base = null;
      modifier = "";
    } else {
      const d = decodeRopeGrade(Number(index));
      base = d.base;
      modifier = d.modifier;
    }
    paint();
  }

  mods.forEach((b) => b.addEventListener("click", () => {
    modifier = modifier === b.dataset.mod ? "" : b.dataset.mod; // tap again to clear
    paint();
    if (base !== null) onChange?.(value());
  }));
  bases.forEach((b) => b.addEventListener("click", () => {
    const n = Number(b.dataset.base);
    if (deselect && base === n) { base = null; modifier = ""; } else base = n;
    paint();
    onChange?.(value());
  }));

  set(initial);
  return { get: value, set };
}
