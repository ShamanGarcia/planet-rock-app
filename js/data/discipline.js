// The climbing discipline the person is looking at (bouldering or rope). The map's
// toggle and the stats pages share it, so "Gym Stats" opens on whatever the map
// was showing. Remembered across visits; storage can be blocked, so every
// access is guarded and the choice just falls back to bouldering.
const KEY = "pr_map_discipline";

let current = (() => {
  try { return localStorage.getItem(KEY) === "rope" ? "rope" : "boulder"; } catch { return "boulder"; }
})();

export function getDiscipline() {
  return current;
}

export function storeDiscipline(discipline) {
  current = discipline === "rope" ? "rope" : "boulder";
  try { localStorage.setItem(KEY, current); } catch { /* storage blocked — the choice just won't be remembered */ }
}
