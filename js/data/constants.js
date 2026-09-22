// Shared enums / lookup tables. Keeping these centralized makes it easy to
// extend (new hold colors, tags, grades) without touching business logic.

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

// Photos/videos at or under this size (after client-side photo compression)
// upload to the shared server and appear in everyone's gallery. Anything
// bigger stays on the uploader's own device (IndexedDB) instead, private to
// them — keeps the small shared disk from filling up with large videos.
export const SHARED_MEDIA_LIMIT_BYTES = 4 * 1024 * 1024;

export function formatGrade(grade) {
  if (grade === null || grade === undefined) return "Ungraded";
  return `V${grade}`;
}

export function formatEstimate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "No community estimate yet";
  return `V${value.toFixed(1)}`;
}

// Routes have no name field — climbers identify them by hold color + grade,
// same as they would in the gym ("the blue V5").
export function routeLabel(route) {
  if (!route) return "Route";
  return `${route.holdColor} ${formatGrade(route.officialGrade)}`;
}

// Real wall-section shapes, traced from the gym's own sketch. Coordinates
// are percentages (0-100) of the map canvas's width (x) / height (y) — same
// convention as a route's mapX/mapY — so zone shapes and route markers share
// one coordinate system.
export const MAP_ASPECT_RATIO = 1835 / 780;

export const WALL_SECTIONS = [
  {
    id: "arch", name: "Arch",
    points: [[1.63, 0], [17.17, 0], [17.17, 10.9], [11.17, 31.41], [6.27, 35.9], [5.45, 8.97]],
  },
  {
    id: "long-wall", name: "Long Wall",
    points: [[18.8, 0], [58.31, 0.64], [57.49, 19.87], [18.8, 14.74]],
  },
  {
    id: "competition", name: "Competition",
    points: [[61.04, 0], [100, 0], [100, 48.08], [95.9, 48.08], [95.9, 18.59], [61.04, 18.59]],
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
