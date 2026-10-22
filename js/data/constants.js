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

// Photos/videos at or under this size (after client-side photo compression)
// upload to the shared server and appear in everyone's gallery. Anything
// bigger stays on the uploader's own device (IndexedDB) instead, private to
// them — keeps the small shared disk from filling up with large videos.
export const SHARED_MEDIA_LIMIT_BYTES = 4 * 1024 * 1024;

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

// The rope area, traced from the gym's floor-plan PDF (grey = climbable wall,
// everything else is open floor). Same 0-100 percent convention as above. The
// whole area is one section: the frame along the top and sides, the central
// block and the small pillar are all "Rope Wall".
export const ROPE_ASPECT_RATIO = 585 / 695;

export const ROPE_SECTIONS = [
  {
    id: "rope-wall", name: "Rope Wall",
    points: [[0, 0], [100, 0], [100, 100], [0, 100]], // bounding box, for fitting the view
    shapes: [
      [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [88.38, 100.0], [88.38, 33.38], [90.09, 32.23], [91.62, 14.53], [84.79, 8.35], [63.59, 8.35], [60.17, 11.37], [39.83, 11.37], [37.44, 8.35], [14.02, 8.35], [11.79, 11.22], [8.03, 13.38], [8.03, 27.05], [11.62, 29.21], [11.62, 86.91], [0.0, 86.91]],
      [[46.32, 32.23], [52.99, 33.67], [62.05, 36.55], [66.15, 42.3], [66.15, 50.07], [64.1, 56.69], [62.91, 66.76], [59.83, 69.06], [56.92, 74.24], [53.33, 78.71], [49.91, 77.7], [43.42, 68.49], [38.97, 66.47], [37.26, 62.45], [35.9, 44.6], [38.63, 35.4], [39.49, 33.53]],
      [[77.78, 15.11], [81.2, 18.56], [78.12, 22.3], [74.7, 18.99]],
    ],
  },
];
