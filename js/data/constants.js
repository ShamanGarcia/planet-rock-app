// Shared enums / lookup tables. Keeping these centralized makes it easy to
// extend (new hold colors, tags, grades) without touching business logic.

import { pointInPolygon } from "../utils.js";

export const HOLD_COLORS = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Black", "White"];

export const HOLD_COLOR_HEX = {
  Red: "var(--hold-red)",
  Orange: "var(--hold-orange)",
  Yellow: "var(--hold-yellow)",
  Green: "var(--hold-green)",
  Blue: "var(--hold-blue)",
  Purple: "var(--hold-purple)",
  Pink: "var(--hold-pink)",
  Black: "var(--hold-black)",
  White: "var(--hold-white)",
};

export const HOLD_TYPES = ["Jug", "Crimp", "Sloper", "Pocket", "Volume", "Pinch"];

// Readable text color for each hold color background (route-detail's
// official-grade badge is colored by hold color; yellow/white need dark text).
export const HOLD_COLOR_TEXT = {
  Red: "#fff", Orange: "#fff", Yellow: "#1b1d21", Green: "#fff",
  Blue: "#fff", Purple: "#fff", Pink: "#fff", Black: "#fff", White: "#1b1d21",
};

export const MAX_GRADE = 10; // V0..V10

// Rope climbs sit on a separate scale. A rope grade is stored as an index into
// 5.7-, 5.7, 5.7+, 5.8-, ... 5.13+ (7 bases x 3 modifiers), so it stays an
// integer like boulder grades and the server's averaging/bucketing code keeps
// working. Mirrored in backend/server.py (MAX_ROPE_GRADE).
export const ROPE_BASE_GRADES = [7, 8, 9, 10, 11, 12, 13];
export const MAX_ROPE_GRADE = ROPE_BASE_GRADES.length * 3 - 1; // 5.13+ -> 20

export const DISCIPLINES = ["boulder", "rope"];
export const DISCIPLINE_LABELS = { boulder: "Bouldering", rope: "Rope" };

export const CLIMB_TYPES = [
  { id: "top", label: "Top rope" },
  { id: "lead", label: "Lead" },
  { id: "autobelay", label: "Auto belay" },
];
export const CLIMB_TYPE_LABELS = Object.fromEntries(CLIMB_TYPES.map((t) => [t.id, t.label]));

// Routes/log snapshots created before rope climbing have no discipline.
export function disciplineOf(data) {
  return data && data.discipline === "rope" ? "rope" : "boulder";
}

export function maxGradeFor(discipline) {
  return discipline === "rope" ? MAX_ROPE_GRADE : MAX_GRADE;
}

// modifier is "-", "+" or "" (neither).
export function ropeGradeIndex(base, modifier = "") {
  return (base - ROPE_BASE_GRADES[0]) * 3 + (modifier === "-" ? 0 : modifier === "+" ? 2 : 1);
}

export function decodeRopeGrade(index) {
  const i = Math.max(0, Math.min(MAX_ROPE_GRADE, Math.round(index)));
  return { base: ROPE_BASE_GRADES[0] + Math.floor(i / 3), modifier: ["-", "", "+"][i % 3] };
}

export function formatRopeGrade(index) {
  const { base, modifier } = decodeRopeGrade(index);
  return `5.${base}${modifier}`;
}

// Short label for one point on a discipline's grade scale ("V4" / "5.10+").
export function gradeScaleLabel(index, discipline = "boulder") {
  return discipline === "rope" ? formatRopeGrade(index) : `V${index}`;
}

// Photos/videos at or under these sizes (after client-side compression, see
// data/media.js) upload to the shared server. Anything bigger stays on the
// uploader's own device (IndexedDB), private to them — keeps the small shared
// disk from filling up. Mirrored in backend UPLOAD_LIMITS.
export const SHARED_PHOTO_LIMIT_BYTES = 8 * 1024 * 1024;
export const SHARED_VIDEO_LIMIT_BYTES = 25 * 1024 * 1024;
// A video the browser couldn't compress is only shared as-is when it is this small.
export const ORIGINAL_VIDEO_LIMIT_BYTES = 15 * 1024 * 1024;

export function formatGrade(grade, discipline = "boulder") {
  if (grade === null || grade === undefined) return "Ungraded";
  return gradeScaleLabel(grade, discipline);
}

export function formatEstimate(value, discipline = "boulder") {
  if (value === null || value === undefined || Number.isNaN(value)) return "No community estimate yet";
  // Rope estimates average whole-step indices, so they round to a real grade.
  return discipline === "rope" ? formatRopeGrade(Math.round(value)) : `V${value.toFixed(1)}`;
}

// Boulder problems have no name — climbers identify them by hold color + grade,
// same as they would in the gym ("the blue V5"). A rope route's optional title
// wins when it has one.
export function routeLabel(route) {
  if (!route) return "Route";
  const discipline = disciplineOf(route);
  if (discipline === "rope" && route.routeTitle) return `${route.routeTitle} ${formatGrade(route.officialGrade, discipline)}`;
  return `${route.holdColor} ${formatGrade(route.officialGrade, discipline)}`;
}

// Real wall-section shapes, traced from the gym's own sketch. Coordinates
// are percentages (0-100) of the map canvas's width (x) / height (y) — same
// convention as a route's mapX/mapY — so zone shapes and route markers share
// one coordinate system.
export const MAP_ASPECT_RATIO = 1835 / 780;

// A section is drawn from `shapes` when it has several disjoint pieces (the
// rope area), otherwise from its single `points` polygon.
export function sectionPolygons(section) {
  return section.shapes || [section.points];
}

// Id of the wall section containing a map point (percent coordinates), or null.
// Routes are assigned to areas by where they sit, so moved routes follow.
export function findWallSectionAt(x, y, discipline = "boulder") {
  const hit = sectionsFor(discipline).find((s) => sectionPolygons(s).some((poly) => pointInPolygon(x, y, poly)));
  return hit ? hit.id : null;
}

export function sectionsFor(discipline) {
  return discipline === "rope" ? ROPE_SECTIONS : WALL_SECTIONS;
}

// Which floor plan a route is drawn on: Cave problems are boulders on the rope map.
export function mapOf(route) {
  return route?.wallSection === CAVE_ID ? "rope" : disciplineOf(route);
}

// The areas a discipline is climbed in (Cave counts as bouldering, not rope).
export function areasFor(discipline) {
  return discipline === "rope"
    ? ROPE_SECTIONS.filter((s) => !s.boulder)
    : [...WALL_SECTIONS, ...ROPE_SECTIONS.filter((s) => s.boulder)];
}

// The area a route sits in, looked up on the floor plan it is drawn on.
export function areaOf(route) {
  return findWallSectionAt(route.mapX, route.mapY, mapOf(route));
}

export function aspectRatioFor(discipline) {
  return discipline === "rope" ? ROPE_ASPECT_RATIO : MAP_ASPECT_RATIO;
}

export const WALL_SECTIONS = [
  {
    id: "arch", name: "Arch",
    points: [[1.63, 0], [17.17, 0], [17.17, 10.9], [11.17, 31.41], [6.27, 35.9], [5.45, 8.97]],
  },
  {
    id: "long-wall", name: "Long Wall",
    points: [[17.17, 0], [58.31, 0], [57.54, 18.59], [17.17, 10.9]], // shares its edges with Arch and Competition
  },
  {
    id: "competition", name: "Competition",
    points: [[58.31, 0], [100, 0], [100, 48.08], [95.9, 48.08], [95.9, 18.59], [57.54, 18.59]],
  },
  {
    id: "island", name: "Island",
    points: [[27.25, 52.56], [40.33, 53.21], [44.41, 59.62], [43.87, 73.08], [37.33, 79.49],
      [26.98, 74.36], [24.25, 65.38], [25.61, 56.41]],
  },
  {
    id: "slab", name: "Slab",
    points: [[62.13, 44.87], [89.1, 44.23], [91.28, 47.44], [74.39, 65.38]],
  },
  {
    id: "notch", name: "Notch", labelPlacement: "left",
    points: [[62.13, 44.87], [74.39, 65.38], [63.22, 98.08]],
  },
  {
    id: "overhang", name: "Overhang", labelPlacement: "bottom-right",
    points: [[91.28, 47.44], [90.74, 58.97], [63.22, 98.08], [74.39, 65.38]],
  },
];

// The rope area, traced from the gym's rope floor plan (rope.png): one polygon per
// named wall, sharing edges like the boulder walls. Same 0-100 percent convention.
// Labels sit beside the walls as on the plan: `labelAt` is the anchor point and
// `labelAlign` says which side of it the text runs ("left" ends at it, "right"
// starts at it, default centers on it). The Cave is a bouldering area inside the
// rope room (`boulder: true`): routes set there are boulder problems.
export const ROPE_ASPECT_RATIO = 516 / 612;

export const CAVE_ID = "cave";

export const ROPE_SECTIONS = [
  {
    id: "whale-fin", name: "Whale Fin", labelAt: [2.5, -5.9],
    points: [[0.0, 0.0], [16.47, 0.0], [16.86, 10.13], [14.15, 9.97], [12.4, 12.42], [11.24, 12.91], [11.24, 14.87], [0.0, 14.87]],
  },
  {
    id: "bottle", name: "Bottle", labelAt: [27.1, -5.9],
    points: [[16.47, 0.0], [39.34, 0.0], [39.34, 9.31], [39.73, 11.44], [36.63, 12.58], [29.46, 12.75], [25.97, 10.29], [16.86, 10.13]],
  },
  {
    id: "zeus-wall", name: "Zeus Wall", labelAt: [55.2, -5.9],
    points: [[39.34, 0.0], [70.54, 0.0], [71.32, 14.22], [42.64, 12.58], [39.53, 11.6]],
  },
  {
    id: "amphitheater", name: "Amphitheater", labelAt: [90.1, -5.9],
    points: [[70.54, 0.0], [99.81, 0.0], [100.0, 24.35], [86.24, 24.18], [86.24, 22.71], [75.58, 14.38], [71.32, 14.22]],
  },
  {
    id: "slab-wall", name: "Slab Wall", labelAt: [-4.3, 21.7], labelAlign: "left", labelWrap: true,
    points: [[0.0, 14.87], [11.24, 14.87], [11.24, 20.75], [12.6, 22.22], [14.92, 29.08], [0.0, 29.08]],
  },
  {
    id: "rope-left", name: "Unnamed Wall", hideLabel: true,
    points: [[0.0, 29.08], [14.92, 29.08], [11.82, 43.3], [14.15, 55.07], [0.0, 54.9]],
  },
  {
    id: "auto-belays", name: "Auto Belays", labelAt: [-1.7, 63.7], labelAlign: "left", labelWrap: true,
    points: [[0.0, 54.9], [14.15, 55.07], [11.24, 74.02], [0.0, 74.02]],
  },
  {
    id: "endless-wall", name: "Endless Wall", labelAt: [105.6, 37.9], labelAlign: "right", labelWrap: true,
    points: [[86.24, 24.18], [100.0, 24.35], [100.0, 70.92], [84.3, 70.75], [86.05, 63.56], [87.02, 48.04]],
  },
  {
    id: "speed-wall", name: "Speed Wall", labelAt: [105.4, 75.0], labelAlign: "right", labelWrap: true,
    points: [[84.3, 70.75], [100.0, 70.92], [100.0, 79.9], [84.11, 79.58]],
  },
  {
    id: "chimney", name: "Chimney", labelAt: [105.4, 83.5], labelAlign: "right",
    points: [[79.26, 81.37], [83.72, 80.07], [84.11, 79.58], [100.0, 79.9], [100.0, 87.91], [78.88, 87.58], [78.88, 85.78], [82.75, 85.78]],
  },
  {
    id: "crack-corner", name: "Crack Corner", labelAt: [105.2, 93.8], labelAlign: "right", labelWrap: true,
    points: [[78.88, 87.58], [100.0, 87.91], [100.0, 99.84], [78.68, 99.84], [81.4, 94.28], [81.2, 93.3], [78.88, 91.01]],
  },
  {
    id: "tower", name: "Tower", labelAt: [49.8, 24.0], labelSmall: true,
    points: [[33.14, 30.39], [41.47, 25.65], [55.04, 27.29], [60.47, 29.25], [65.7, 35.13], [59.69, 37.58], [59.69, 37.09], [53.49, 32.35], [42.44, 31.21], [39.92, 32.68], [39.15, 33.66], [33.72, 31.05]],
  },
  {
    id: "rainbow-wall", name: "Rainbow Wall", labelAt: [66.9, 39.1], labelAlign: "right", labelSmall: true, labelWrap: true,
    points: [[60.08, 37.42], [65.7, 35.13], [66.28, 45.26], [63.37, 51.8], [63.76, 52.45], [58.33, 50.49], [58.53, 46.57]],
  },
  {
    id: "ships-row", name: "Ships Row", labelAt: [64.5, 57.2], labelAlign: "right", labelSmall: true, labelWrap: true,
    points: [[58.14, 50.65], [58.91, 50.49], [63.57, 52.45], [63.57, 52.78], [63.18, 52.61], [63.57, 64.71], [57.56, 62.91], [57.36, 58.82]],
  },
  {
    id: "arete", name: "Arete", labelAt: [59.7, 75.0], labelAlign: "right", labelSmall: true,
    points: [[57.75, 62.91], [63.37, 64.54], [63.57, 65.69], [62.21, 70.26], [57.95, 74.51], [56.98, 78.1], [53.49, 80.56]],
  },
  {
    id: "yosemite-wall", name: "Yosemite Wall", labelAt: [31.6, 44.6], labelAlign: "left", labelSmall: true, labelWrap: true,
    points: [[32.95, 30.56], [38.95, 33.5], [41.28, 62.91], [34.3, 62.42], [31.4, 57.52], [32.75, 43.14]],
  },
  {
    id: "cave", name: "Cave", boulder: true, labelAt: [47.9, 39.2],
    points: [[38.95, 33.5], [39.34, 33.66], [39.92, 32.68], [42.44, 31.21], [53.49, 32.35], [58.53, 36.11], [59.69, 37.09], [59.69, 37.58], [60.08, 37.42], [58.33, 48.2], [58.53, 50.65], [58.14, 50.65], [57.36, 58.82], [57.56, 63.24], [56.4, 62.91], [41.28, 62.75]],
  },
];
