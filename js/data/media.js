import { SHARED_PHOTO_LIMIT_BYTES, SHARED_VIDEO_LIMIT_BYTES, ORIGINAL_VIDEO_LIMIT_BYTES } from "./constants.js";

// Client-side media prep: photos and videos are shrunk on the device before they are
// uploaded, so a phone clip is a few MB instead of a few hundred.

// Mediabunny runs the browser's own WebCodecs (hardware-accelerated, faster than real
// time). Loaded only when someone picks a video; pinned to an exact version.
const MEDIABUNNY_URL = "https://cdn.jsdelivr.net/npm/mediabunny@1.61.2/dist/bundles/mediabunny.min.mjs";
let mediabunny = null;
const loadMediabunny = () => (mediabunny ||= import(MEDIABUNNY_URL).catch((e) => { mediabunny = null; throw e; }));

const MAX_SOURCE_BYTES = 600 * 1024 * 1024; // refuse a multi-gigabyte pick before reading it
const VIDEO_SHORT_SIDE = 720;
const COPY_MAX_BITRATE = 4_000_000; // an mp4/h264 clip already this small is uploaded as it is

export const isMediaFile = (file) => /^(image|video)\//.test(file?.type || "");

// Decodes at most maxDim on the long edge and re-encodes as JPEG. Re-encoding also drops
// EXIF (GPS included) and applies the camera's rotation.
export async function compressPhoto(file, { maxDim = 1600, quality = 0.8 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image.");
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs must not turn black in a JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/jpeg", quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't compress that image.");
  return blob;
}

const once = (el, ev, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${ev} timed out`)), ms);
  el.addEventListener(ev, () => { clearTimeout(t); resolve(); }, { once: true });
  el.addEventListener("error", () => { clearTimeout(t); reject(new Error("video error")); }, { once: true });
});

// A small JPEG of an early frame, so the Reel and gallery show a picture before the video loads.
export async function posterFromVideo(blob, width = 360) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await once(video, "loadeddata", 8000);
    video.currentTime = Math.min(0.2, (video.duration || 1) / 2);
    await once(video, "seeked", 8000);
    const scale = Math.min(1, width / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null; // no poster is fine
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

// Returns the original file when it is already small and compatible, else an H.264 mp4 no
// larger than 720p on its short side. Throws when the browser can't transcode.
async function compressVideo(file, onProgress) {
  if (typeof VideoEncoder === "undefined") throw new Error("WebCodecs is not available");
  const mb = await loadMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track");
    const w = track.displayWidth, h = track.displayHeight;
    const duration = await input.computeDuration();
    const bitrate = duration > 0 ? (file.size * 8) / duration : Infinity;
    const small = Math.min(w, h) <= VIDEO_SHORT_SIDE;
    if (file.type === "video/mp4" && track.codec === "avc" && small && bitrate <= COPY_MAX_BITRATE) return file;

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const size = small ? {} : (w <= h ? { width: VIDEO_SHORT_SIDE } : { height: VIDEO_SHORT_SIDE });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { ...size, quality: mb.QUALITY_MEDIUM },
      audio: { quality: mb.QUALITY_LOW },
    });
    if (!conversion.isValid) throw new Error("This video can't be converted");
    conversion.onProgress = (p) => onProgress(Math.min(1, p));
    await conversion.execute();
    return new Blob([output.target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose?.();
  }
}

// -> { blob, kind, posterDataUrl, compressed, shareable }
// `shareable` is false when the result is still too big for the server; the caller then
// keeps it private on this device (see localMedia.js).
export async function prepareMedia(file, { onProgress = () => {} } = {}) {
  if (!isMediaFile(file)) throw new Error("Choose a photo or video.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That file is too large (max 600 MB).");

  if (file.type.startsWith("image")) {
    const blob = await compressPhoto(file);
    return { blob, kind: "photo", posterDataUrl: null, compressed: true, shareable: blob.size <= SHARED_PHOTO_LIMIT_BYTES };
  }

  let blob = file;
  let compressed = false;
  try {
    blob = await compressVideo(file, onProgress);
    compressed = blob !== file;
  } catch (err) {
    console.warn("Video compression unavailable, using the original:", err); // eslint-disable-line no-console
  }
  const posterDataUrl = await posterFromVideo(blob);
  const limit = compressed ? SHARED_VIDEO_LIMIT_BYTES : ORIGINAL_VIDEO_LIMIT_BYTES;
  return { blob, kind: "video", posterDataUrl, compressed, shareable: blob.size <= limit };
}
