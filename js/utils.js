// Small shared helpers used across the app.

let idCounter = 1;
export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// Deterministic seeded RNG (mulberry32) so mock data / generated route
// "photos" look the same across reloads instead of re-randomizing.
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function mode(arr) {
  if (!arr.length) return null;
  const counts = new Map();
  for (const item of arr) counts.set(item, (counts.get(item) || 0) + 1);
  let best = null, bestCount = -1;
  for (const [k, v] of counts) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Downscales + re-encodes an image file entirely client-side (native canvas
// API, no server round-trip needed) so uploaded photos stay small — roughly
// 720p-equivalent on the longest edge, re-saved as JPEG. Non-image files
// (video) are returned untouched via fileToDataUrl; browsers have no native
// way to re-encode video, so video size is instead handled by the
// shared/private split at the call site (see SHARED_MEDIA_LIMIT_BYTES).
export function compressImageFile(file, { maxDim = 1280, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Couldn't read that image.")); };
    img.src = objectUrl;
  });
}

// Approximate decoded byte size of a base64 data URL (base64 is ~4/3 the
// size of the raw bytes it encodes).
export function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round(base64.length * 0.75);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
