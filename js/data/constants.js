// Shared enums / lookup tables. Keeping these centralized makes it easy to
// extend (new hold colors, tags, grades) without touching business logic.

export const HOLD_COLORS = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Black", "White"];

export const HOLD_COLOR_HEX = {
  Red: "var(--hold-red)",
  Orange: "var(--hold-orange)",
  Yellow: "var(--hold-yellow)",
  Green: "var(--hold-green)",
  Blue: "var(--hold-blue)",
  Purple: "var(--hold-purple)",
  Black: "var(--hold-black)",
  White: "var(--hold-white)",
};

export const HOLD_TYPES = ["Jug", "Crimp", "Sloper", "Pocket", "Volume", "Pinch"];

// Tags are an open-ended, admin-extensible list. New tags can be appended
// here (or, in a real backend, inserted as new Tag rows) without any other
// code change.
export const DEFAULT_TAGS = [
  "Juggy", "Crimpy", "Slopers", "Pinches", "Static", "Dynamic", "Technical",
  "Powerful", "Burly", "Balance", "Coordination", "Reachy", "Compression",
  "Endurance", "Slab", "Overhang",
];

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

export const WALL_SECTIONS = [
  { id: "slab", name: "Slab", x: 4, y: 4, w: 26, h: 22 },
  { id: "vertical-a", name: "Vertical Wall", x: 32, y: 4, w: 30, h: 14 },
  { id: "arete", name: "Arête", x: 64, y: 4, w: 14, h: 30 },
  { id: "overhang", name: "Overhang", x: 80, y: 4, w: 16, h: 40 },
  { id: "cave", name: "The Cave", x: 64, y: 46, w: 32, h: 20 },
  { id: "vertical-b", name: "Vertical Wall", x: 4, y: 34, w: 26, h: 32 },
  { id: "corner", name: "Corner Wall", x: 32, y: 22, w: 30, h: 20 },
  { id: "tension-board", name: "Training Board", x: 4, y: 70, w: 20, h: 18 },
  { id: "lead-wall", name: "Lead Wall", x: 32, y: 44, w: 28, h: 44 },
  { id: "kids-area", name: "Kids Area", x: 64, y: 70, w: 32, h: 18 },
];
