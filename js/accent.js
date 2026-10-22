// The app's accent color. Everything that used the old fixed brand red reads the
// --pr-orange CSS variable (buttons, active tabs, sliders, stat numbers) or, for
// the canvas charts that can't see CSS, getAccent(). The choice lives on the
// user (accentColor) and is mirrored in localStorage so the very first paint, and
// the login screen, already use it. Storage can be blocked, so access is guarded.
export const DEFAULT_ACCENT = "#bf2c37";

// Round swatches in the style of Untitled UI's color swatch picker; all are dark
// enough to carry white button text.
export const ACCENT_SWATCHES = [
  { name: "Red", hex: DEFAULT_ACCENT },
  { name: "Rose", hex: "#e31b54" },
  { name: "Pink", hex: "#dd2590" },
  { name: "Purple", hex: "#7f56d9" },
  { name: "Violet", hex: "#6938ef" },
  { name: "Blue", hex: "#1570ef" },
  { name: "Cyan", hex: "#0086c9" },
  { name: "Teal", hex: "#0e9384" },
  { name: "Green", hex: "#079455" },
  { name: "Amber", hex: "#dc6803" },
  { name: "Orange", hex: "#ec4a0a" },
  { name: "Gray", hex: "#475467" },
];

const KEY = "pr_accent";
const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// Hover shade for buttons: the accent mixed 16% toward black.
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * 0.84).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// HSV <-> hex for the color picker. h is 0-360, s and v are 0-1 (unrounded, so a
// picked color survives the round trip through its hex string).
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function applyAccent(hex) {
  const color = isHex(hex) ? hex.toLowerCase() : DEFAULT_ACCENT;
  const root = document.documentElement.style;
  root.setProperty("--pr-orange", color);
  root.setProperty("--pr-orange-dark", darken(color));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  try { localStorage.setItem(KEY, color); } catch { /* storage blocked — just not remembered */ }
  return color;
}

export function getAccent() {
  return document.documentElement.style.getPropertyValue("--pr-orange") || DEFAULT_ACCENT;
}

try { applyAccent(localStorage.getItem(KEY)); } catch { /* default stays */ }
