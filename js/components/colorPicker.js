import { hexToHsv, hsvToHex } from "../accent.js";
import { clamp } from "../utils.js";

// A vanilla take on Elastic EUI's EuiColorPicker: a hex field with a color chip that
// opens a popover holding a saturation/brightness square, a hue slider and swatches.
// Invalid hex text shows an inline error and is not reported; valid colors call onChange(hex).
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalize(text) {
  const m = HEX_RE.exec(text.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}

export function mountColorPicker(root, { color, swatches, onChange }) {
  let hex = color;
  let hsv = hexToHsv(hex);

  root.classList.add("cp");
  root.innerHTML = `
    <div class="cp-field">
      <input type="text" class="cp-hex" spellcheck="false" autocomplete="off" aria-label="Accent color (hex)"/>
      <span class="cp-chip" aria-hidden="true"></span>
    </div>
    <div class="cp-error hidden">Provide a valid color value</div>
    <div class="cp-pop hidden">
      <div class="cp-sv" role="slider" aria-label="Saturation and brightness"><div class="cp-thumb"></div></div>
      <input type="range" class="hue-slider" min="0" max="359" aria-label="Hue"/>
      <div class="swatch-picker">
        ${swatches.map((c) => `<button type="button" class="swatch" style="--swatch:${c.hex}" data-hex="${c.hex}" aria-label="${c.name}" title="${c.name}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`).join("")}
      </div>
    </div>`;
  const q = (s) => root.querySelector(s);
  const input = q(".cp-hex"), chip = q(".cp-chip"), pop = q(".cp-pop"), sv = q(".cp-sv"), thumb = q(".cp-thumb");
  const hue = q(".hue-slider"), error = q(".cp-error");

  function paint({ keepText = false } = {}) {
    if (!keepText) input.value = hex.toUpperCase();
    input.classList.remove("invalid");
    error.classList.add("hidden");
    chip.style.background = hex;
    sv.style.setProperty("--hue", `hsl(${hsv.h} 100% 50%)`);
    thumb.style.left = `${hsv.s * 100}%`;
    thumb.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = Math.round(hsv.h) % 360;
    root.querySelectorAll(".swatch").forEach((sw) => sw.classList.toggle("selected", sw.dataset.hex === hex));
  }
  const setHex = (next, opts) => { hex = next; hsv = hexToHsv(next); paint(opts); onChange(hex); };
  const setHsv = (h, s, v) => { hsv = { h, s, v }; hex = hsvToHex(h, s, v); paint(); onChange(hex); };

  input.addEventListener("input", () => {
    const next = normalize(input.value);
    if (next) setHex(next, { keepText: true });
    else { input.classList.add("invalid"); error.classList.remove("hidden"); }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pop.classList.add("hidden"); } });
  input.addEventListener("focus", () => pop.classList.remove("hidden"));
  input.addEventListener("blur", () => { if (!input.classList.contains("invalid")) paint(); }); // tidy "d36" into "#DD3366"

  let dragging = false;
  const pick = (e) => {
    const r = sv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    setHsv(hsv.h, clamp((e.clientX - r.left) / r.width, 0, 1), 1 - clamp((e.clientY - r.top) / r.height, 0, 1));
  };
  sv.addEventListener("pointerdown", (e) => { dragging = true; sv.setPointerCapture(e.pointerId); pick(e); });
  sv.addEventListener("pointermove", (e) => { if (dragging) pick(e); });
  ["pointerup", "pointercancel"].forEach((ev) => sv.addEventListener(ev, () => { dragging = false; }));
  hue.addEventListener("input", () => setHsv(Number(hue.value), hsv.s, hsv.v));
  root.querySelectorAll(".swatch").forEach((sw) => sw.addEventListener("click", () => setHex(sw.dataset.hex)));

  // Close on a tap outside or Escape; the listener retires itself once the form is re-rendered away.
  const outside = (e) => {
    if (!root.isConnected) { document.removeEventListener("pointerdown", outside); return; }
    if (!root.contains(e.target)) pop.classList.add("hidden");
  };
  document.addEventListener("pointerdown", outside);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.classList.add("hidden"); });

  paint();
}
