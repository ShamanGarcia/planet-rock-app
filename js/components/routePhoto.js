// Generates a deterministic stylized "photo" of a route's wall panel and
// holds as inline SVG. There's no real photography for a mock gym, so this
// stands in for the "route photograph" requirement while making each route
// visually distinct based on its hold color/type.

import { mulberry32, hashStringToSeed } from "../utils.js";
import { HOLD_COLOR_HEX } from "../data/constants.js";

function holdShape(cx, cy, size, holdType, colorVar, rot) {
  const c = `var(${colorVar.replace("var(", "").replace(")", "")})`;
  switch (holdType) {
    case "Jug":
      return `<ellipse cx="${cx}" cy="${cy}" rx="${size * 1.1}" ry="${size * 0.75}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1.5" transform="rotate(${rot} ${cx} ${cy})"/>`;
    case "Crimp":
      return `<rect x="${cx - size}" y="${cy - size * 0.35}" width="${size * 2}" height="${size * 0.7}" rx="${size * 0.25}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1.5" transform="rotate(${rot} ${cx} ${cy})"/>`;
    case "Sloper":
      return `<ellipse cx="${cx}" cy="${cy}" rx="${size * 1.3}" ry="${size * 1.05}" fill="${c}" stroke="rgba(0,0,0,.2)" stroke-width="1.5" opacity="0.96" transform="rotate(${rot} ${cx} ${cy})"/>`;
    case "Pocket":
      return `<circle cx="${cx}" cy="${cy}" r="${size * 0.85}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="${size * 0.28}" fill="rgba(0,0,0,.35)"/>`;
    case "Volume":
      return `<polygon points="${cx - size * 1.4},${cy + size} ${cx},${cy - size * 1.3} ${cx + size * 1.4},${cy + size}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1.5" transform="rotate(${rot} ${cx} ${cy})"/>`;
    case "Pinch":
      return `<polygon points="${cx},${cy - size} ${cx + size * 0.55},${cy} ${cx},${cy + size} ${cx - size * 0.55},${cy}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1.5" transform="rotate(${rot} ${cx} ${cy})"/>`;
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${size}" fill="${c}"/>`;
  }
}

const COLOR_VAR = {
  Red: "--hold-red", Orange: "--hold-orange", Yellow: "--hold-yellow", Green: "--hold-green",
  Blue: "--hold-blue", Purple: "--hold-purple", Black: "--hold-black", White: "--hold-white",
};

export function generateRoutePhotoSVG(route) {
  const rng = mulberry32(hashStringToSeed(route.id));
  const w = 400, h = 300;
  const panelShade = 210 + Math.floor(rng() * 20);
  const holdCount = 7 + Math.floor(rng() * 5);
  const colorVar = COLOR_VAR[route.holdColor] || "--hold-black";

  let holds = "";
  let x = 60 + rng() * 40;
  let y = h - 30;
  for (let i = 0; i < holdCount; i++) {
    const size = 12 + rng() * 10;
    holds += holdShape(x, y, size, route.holdType, colorVar, Math.floor(rng() * 360));
    x += 30 + rng() * 55;
    y -= (h - 60) / holdCount + (rng() - 0.5) * 14;
    if (x > w - 40) x = w - 40;
    if (x < 30) x = 30;
  }

  // Faint panel seams for texture.
  let seams = "";
  for (let i = 1; i < 5; i++) {
    seams += `<line x1="${(w / 5) * i}" y1="0" x2="${(w / 5) * i}" y2="${h}" stroke="rgba(0,0,0,.05)" stroke-width="2"/>`;
  }
  for (let i = 1; i < 4; i++) {
    seams += `<line x1="0" y1="${(h / 4) * i}" x2="${w}" y2="${(h / 4) * i}" stroke="rgba(0,0,0,.04)" stroke-width="2"/>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of a ${route.holdColor} ${route.holdType} route">
    <defs>
      <linearGradient id="panel-${route.id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${panelShade},14%,88%)"/>
        <stop offset="1" stop-color="hsl(${panelShade},10%,72%)"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#panel-${route.id})"/>
    ${seams}
    ${holds}
  </svg>`;
}
