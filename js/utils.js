// Small shared helpers used across the app.

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

// Shared "scroll-snap track with index tracking" wiring for onboarding.js's
// tour and demoCarousel.js's app-demo strip — both scroll-snap horizontally
// and need their index kept in sync whether navigation is a button click
// (the returned scrollToIndex) or a manual swipe (the debounced listener
// here calling onIndexChange).
export function wireScrollTrack(track, onIndexChange) {
  let scrollTimer = null;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => onIndexChange(Math.round(track.scrollLeft / track.clientWidth)), 80);
  });
  return (index) => track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Ray-casting point-in-polygon test. `polygon` is an array of [x, y] pairs.
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon) {
  const n = polygon.length;
  const sum = polygon.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / n, sum[1] / n];
}

export function polygonBounds(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Plays a backdrop/panel's reverse-open transition (see the .closing rules
// in styles.css for .drawer-backdrop / .mini-popup-backdrop) before actually
// removing it, instead of the panel just vanishing. Falls back to an
// immediate remove if transitions are disabled (prefers-reduced-motion sets
// near-zero durations, so transitionend still fires quickly either way) —
// the timeout is only a safety net in case transitionend never fires.
export function dismissOverlay(backdrop, duration = 280) {
  backdrop.classList.add("closing");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    backdrop.remove();
  };
  backdrop.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, duration + 80);
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
// Reads a photo (compressed) or video (untouched — browsers have no native
// way to re-encode video) file into a data URL. Shared by the log-send
// sheet and the route gallery's "add your climb" form.
export async function pickMedia(file) {
  const isVideo = file.type.startsWith("video");
  const dataUrl = isVideo ? await fileToDataUrl(file) : await compressImageFile(file);
  return { dataUrl, kind: isVideo ? "video" : "photo" };
}

export function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round(base64.length * 0.75);
}

export function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
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
