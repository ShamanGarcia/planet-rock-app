import { ROPE_BASE_GRADES, ropeGradeIndex, decodeRopeGrade } from "../data/constants.js";

// Rope grade input: a "-" toggle, a dropdown of base grades (5.7-5.13), then a
// "+" toggle. Neither toggle on means the plain grade; the two are exclusive.
// The value it reports is the stored rope-grade index (see constants.js), or
// null while the dropdown still says "Ungraded".

export function ropeGradePickerHTML({ label = "Rope grade", ungradedLabel = "Ungraded" } = {}) {
  return `
    <div class="rope-grade-picker" data-rope-grade>
      <button type="button" class="rgp-mod" data-mod="-" aria-pressed="false" aria-label="Minus (${label})">&minus;</button>
      <select class="rgp-base" aria-label="${label}">
        <option value="">${ungradedLabel}</option>
        ${ROPE_BASE_GRADES.map((b) => `<option value="${b}">5.${b}</option>`).join("")}
      </select>
      <button type="button" class="rgp-mod" data-mod="+" aria-pressed="false" aria-label="Plus (${label})">+</button>
    </div>`;
}

// Wires the markup above. `initial` is a grade index or null; onChange gets the
// new index or null. Returns { get, set } for callers that need to read/replace it.
export function wireRopeGradePicker(root, initial, onChange) {
  const select = root.querySelector(".rgp-base");
  const mods = [...root.querySelectorAll(".rgp-mod")];
  let modifier = "";

  function value() {
    return select.value === "" ? null : ropeGradeIndex(Number(select.value), modifier);
  }

  function paint() {
    const ungraded = select.value === "";
    mods.forEach((b) => {
      const on = !ungraded && b.dataset.mod === modifier;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
      b.disabled = ungraded;
    });
  }

  function set(index) {
    if (index === null || index === undefined || index === "") {
      select.value = "";
      modifier = "";
    } else {
      const d = decodeRopeGrade(Number(index));
      select.value = String(d.base);
      modifier = d.modifier;
    }
    paint();
  }

  select.addEventListener("change", () => {
    if (select.value === "") modifier = "";
    paint();
    onChange?.(value());
  });
  mods.forEach((b) => b.addEventListener("click", () => {
    if (select.value === "") return;
    modifier = modifier === b.dataset.mod ? "" : b.dataset.mod; // tap again to clear
    paint();
    onChange?.(value());
  }));

  set(initial);
  return { get: value, set };
}
