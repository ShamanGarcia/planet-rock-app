import { getRoutes, getAllTags, getCurrentUser, getLogEntries, updateRoute, getGyms } from "../data/api.js";
import {
  HOLD_COLORS, HOLD_COLOR_HEX, HOLD_COLOR_TEXT, HOLD_TYPES, ROPE_BASE_GRADES, CLIMB_TYPES, DISCIPLINES, DISCIPLINE_LABELS,
  aspectRatioFor, sectionsFor, sectionPolygons, maxGradeFor, disciplineOf, gradeScaleLabel, formatRopeGrade, routeLabel,
  findWallSectionAt,
} from "../data/constants.js";
import { getDiscipline, storeDiscipline } from "../data/discipline.js";
import { openRouteDetail } from "./routeDetail.js";
import { openAddRouteForm } from "../components/addRoute.js";
import { openResetWallModal } from "../components/resetWallModal.js";
import { renderRouteList, isListBusy, closeListPopover } from "./gymList.js";
import { showToast } from "../components/toast.js";
import { isAdminUnlocked } from "../adminAuth.js";
import { escapeHtml, clamp, polygonCentroid, polygonBounds, dismissOverlay } from "../utils.js";

// The canvas is sized in CSS pixels at this fixed base (before pan/zoom
// scaling) so it matches the sketch's own proportions; every zone/marker
// position is a 0-100 percentage of these, same convention as mapX/mapY.
// The rope area is far smaller on screen than the boulder gym, so it gets a
// narrower base canvas — its markers then read at the fit-to-screen zoom
// instead of needing a tap-to-zoom step the way boulder walls do.
const canvasWidth = (d) => (d === "rope" ? 520 : 1000);
const canvasHeight = (d) => Math.round(canvasWidth(d) / aspectRatioFor(d));

function toSvgPoints(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

// Heat scale for the two heatmap views: 11 discrete steps of the magma
// colormap (black -> purple -> magenta -> orange -> pale yellow), indexed
// 0-10. Difficulty buckets 1:1 with grade (0-10 by 1); completions bucket by
// dividing the finish count by 3 (0-30 by 3), both clamped into the same
// 11-step palette so the two views read consistently.
const MAGMA_11 = [
  "#000004", "#140e36", "#3b0f70", "#641a80", "#8c2981",
  "#b73779", "#de4968", "#f7705c", "#fe9f6d", "#fecf92", "#fcfdbf",
];
const HEAT_NO_DATA = "#6b6f76"; // same as --pr-text-soft — kept distinct from magma's black so "no data" never reads as "hardest/least"

// Inverted: low value -> pale (index 0 end of MAGMA_11), high value -> dark.
function magmaStyle(valueIndex) {
  const idx = clamp(Math.round(10 - valueIndex), 0, 10);
  return { bg: MAGMA_11[idx], isDark: idx < 9 };
}

// Pixel-art checkmark icon for the completed-climbs toggle, built from a
// grid of square cells (matching the user's reference art) instead of a
// font glyph or icon library — consistent with this file's existing
// "plain characters only" chrome, just rendered as blocks instead of text.
function pixelIconSVG(cells, cols, rows) {
  const size = 0.86;
  const gap = (1 - size) / 2;
  const rects = cells.map(([c, r]) => `<rect x="${c + gap}" y="${r + gap}" width="${size}" height="${size}" fill="currentColor"/>`).join("");
  return `<svg viewBox="0 0 ${cols} ${rows}" width="22" height="22" aria-hidden="true">${rects}</svg>`;
}

const MENU_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const STATS_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>`;
export const MAP_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>`;
const LIST_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/></svg>`;

const FILTER_ICON = `<img src="/assets/icons/filter.svg" alt="" width="26" height="26"/>`; // 8-bit funnel, 64px art shown at 26px

const PIXEL_CHECK_ICON = pixelIconSVG([[1, 2], [2, 3], [3, 4], [4, 3], [5, 2], [6, 1], [7, 0]], 9, 6);

// Persisted at module scope so pan/zoom feels stable across re-renders
// (filter changes, navigating away and back) within the same session.
// The actual starting scale/position is computed per-device on first show
// (see fitToScreen) so the whole gym is visible instead of a narrow sliver
// of it on small phones.
const viewState = { scale: 1, tx: 0, ty: 0 };
let hasFitToScreen = false;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3.5;

// Which discipline the map is showing (shared with the stats pages, see data/discipline.js).
let discipline = getDiscipline();

// Grade filters only mean something on one scale, so each discipline keeps its
// own filter state; switching swaps it in and out.
const defaultFilters = (d) => ({
  gradeMin: 0,
  gradeMax: maxGradeFor(d),
  estMin: 0,
  estMax: maxGradeFor(d),
  completion: new Set(), // "completed" | "uncompleted"
  holdTypes: new Set(),
  holdColors: new Set(),
  tagIds: new Set(),
  climbTypes: new Set(), // rope only: "top" | "lead" | "autobelay"
});
const filtersByDiscipline = { [discipline]: defaultFilters(discipline) };
let filters = filtersByDiscipline[discipline];

function isFilterActive() {
  const max = maxGradeFor(discipline);
  return (
    filters.gradeMin !== 0 ||
    filters.gradeMax !== max ||
    filters.completion.size > 0 ||
    filters.holdTypes.size > 0 ||
    filters.holdColors.size > 0 ||
    filters.tagIds.size > 0 ||
    filters.climbTypes.size > 0 ||
    filters.estMin !== 0 ||
    filters.estMax !== max
  );
}

function routeMatches(route, completedRouteIds) {
  const MAX_GRADE = maxGradeFor(discipline);
  if (filters.climbTypes.size > 0 && !(route.climbTypes || []).some((t) => filters.climbTypes.has(t))) return false;
  if (filters.gradeMin !== 0 || filters.gradeMax !== MAX_GRADE) {
    const g = route.officialGrade;
    if (g === null || g < filters.gradeMin || g > filters.gradeMax) return false;
  }
  if (filters.completion.size > 0) {
    if (!filters.completion.has(completedRouteIds.has(route.id) ? "completed" : "uncompleted")) return false;
  }
  if (filters.estMin !== 0 || filters.estMax !== MAX_GRADE) {
    const est = route.communityGrade;
    if (est === null || est === undefined || est < filters.estMin || est > filters.estMax) return false;
  }
  if (filters.holdTypes.size > 0) {
    const types = route.holdTypes && route.holdTypes.length ? route.holdTypes : [route.holdType];
    if (!types.some((t) => filters.holdTypes.has(t))) return false;
  }
  if (filters.holdColors.size > 0 && !filters.holdColors.has(route.holdColor)) return false;
  if (filters.tagIds.size > 0 && !route.tags.some((t) => filters.tagIds.has(t))) return false;
  return true;
}

// Two-handle V-grade slider: two native range inputs stacked on one track,
// only their thumbs take pointer events (see .range-slider in styles.css).
function rangeSliderHTML(key, label, lo, hi) {
  const MAX_GRADE = maxGradeFor(discipline);
  // Rope has 21 steps (5.7- ... 5.13+), too many to label, so only the base
  // grades are marked, each at its unmodified step.
  const markGrades = discipline === "rope" ? ROPE_BASE_GRADES.map((b) => (b - ROPE_BASE_GRADES[0]) * 3 + 1) : Array.from({ length: MAX_GRADE + 1 }, (_, g) => g);
  const marks = markGrades.map((g) =>
    `<span style="left:${(g / MAX_GRADE) * 100}%">${discipline === "rope" ? `5.${ROPE_BASE_GRADES[0] + Math.floor(g / 3)}` : `V${g}`}</span>`).join("");
  return `
    <div class="range-slider" data-range="${key}">
      <div class="range-value"></div>
      <div class="range-body">
        <div class="range-track"><div class="range-fill"></div></div>
        <input type="range" min="0" max="${MAX_GRADE}" step="1" value="${lo}" aria-label="Minimum ${label}">
        <input type="range" min="0" max="${MAX_GRADE}" step="1" value="${hi}" aria-label="Maximum ${label}">
      </div>
      <div class="range-marks">${marks}</div>
    </div>`;
}

// Live-updates the fill/label while dragging; onCommit only fires on release
// so the map doesn't refetch on every step.
function wireRangeSlider(el, onCommit) {
  const MAX_GRADE = maxGradeFor(discipline);
  const [loIn, hiIn] = el.querySelectorAll("input");
  const fill = el.querySelector(".range-fill");
  const valueEl = el.querySelector(".range-value");
  function sync(moved) {
    let lo = Number(loIn.value), hi = Number(hiIn.value);
    if (lo > hi) {
      if (moved === loIn) { hi = lo; hiIn.value = hi; } else { lo = hi; loIn.value = lo; }
    }
    fill.style.left = `${(lo / MAX_GRADE) * 100}%`;
    fill.style.right = `${100 - (hi / MAX_GRADE) * 100}%`;
    const name = (g) => gradeScaleLabel(g, discipline);
    valueEl.textContent = lo === hi ? name(lo) : `${name(lo)} – ${name(hi)}`;
    return [lo, hi];
  }
  [loIn, hiIn].forEach((input) => {
    input.addEventListener("input", () => sync(input));
    input.addEventListener("change", () => onCommit(...sync(input)));
  });
  sync();
}

const NEW_SET_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 12000; // keeps the map in sync with routes/votes added from other devices

export function renderGymMap(container, gymId) {
  let selectedRouteId = null;
  let placementMode = false;
  let panMoved = false;
  let destroyed = false;
  let pendingPoint = null; // {mapX, mapY, wallSection} while the add-route form is open
  let zoomedSectionId = null; // set after tapping a zone; null shows the full map
  let newlyAddedRouteId = null; // yellow-ringed until any route marker is clicked (this view instance resets it on navigation)
  let activeHeatmap = null; // null | "completed" | "difficulty"
  let moveMode = false;
  let movingRouteId = null;
  let viewMode = "map"; // "map" | "list" — the list view shares filters and heatmaps with the map
  let listSection = null; // list view: null shows the grid of areas, an id shows that area's routes
  let randomRunning = false; // while the Random Climb animation owns the markers, nothing may re-render them
  // Admin-unlock state can't change while this view stays mounted (it's only
  // ever set via the Profile page, which navigates away first), so this is
  // safe to compute once instead of re-checking on every render.
  const showMoveBtn = isAdminUnlocked();

  container.innerHTML = `
    <div class="page map-page">
      <div class="map-stage">
        <div class="map-topbar">
          <div class="discipline-bar">
            <div class="view-toggle discipline-toggle" role="group" aria-label="Climbing type">
              ${DISCIPLINES.map((d) => `<button type="button" class="${d === discipline ? "active" : ""}" data-discipline="${d}" aria-pressed="${d === discipline}">${DISCIPLINE_LABELS[d]}</button>`).join("")}
            </div>
            <span class="result-count" id="result-count">Loading…</span>
          </div>
          <button class="map-menu-btn" id="map-menu-btn" aria-label="More options" aria-haspopup="true" aria-expanded="false">${MENU_ICON}</button>
          <div class="map-menu hidden" id="map-menu">
            <div class="view-toggle" role="group" aria-label="View">
              <button type="button" data-view="list" aria-pressed="false">${LIST_ICON}<span>List</span></button>
              <button type="button" class="active" data-view="map" aria-pressed="true">${MAP_ICON}<span>Map</span></button>
            </div>
            <div class="map-heatmap-toggles">
              <button class="heatmap-toggle-btn heatmap-toggle-filters" id="open-filters"
                      aria-label="Filters" title="Filters">${FILTER_ICON}</button>
              <button class="heatmap-toggle-btn heatmap-toggle-completed" id="heatmap-completed-btn"
                      aria-label="Toggle completed-climbs heatmap" aria-pressed="false">${PIXEL_CHECK_ICON}</button>
              <button class="heatmap-toggle-btn heatmap-toggle-difficulty" id="heatmap-difficulty-btn"
                      aria-label="Toggle difficulty heatmap" aria-pressed="false">${discipline === "rope" ? "5." : "V"}</button>
            </div>
            <button class="btn btn-ghost btn-sm hidden" id="clear-filters">Clear filters</button>
            <button class="btn btn-outline btn-sm random-btn" id="random-climb-btn"><span class="new-set">Random Climb</span></button>
            <button class="btn btn-outline btn-sm stats-btn" id="gym-stats-btn">${STATS_ICON}<span>Gym Stats</span></button>
            <button class="btn btn-success btn-sm ${showMoveBtn ? "" : "hidden"}" id="move-route-btn">MOVE</button>
          </div>
        </div>
        <div class="map-viewport" id="map-viewport">
          <div class="map-canvas" id="map-canvas"></div>
          <div class="map-zoom-controls">
            <button id="zoom-in" aria-label="Zoom in">+</button>
            <button id="zoom-out" aria-label="Zoom out">−</button>
            <button id="zoom-reset" aria-label="Reset view" style="font-size:13px;">⤢</button>
          </div>
          <button class="btn btn-danger btn-sm hidden" id="reset-wall-btn" style="position:absolute; left:12px; top:128px; z-index:25;">RESET</button>
          <div class="map-bottom-left">
            <button class="btn btn-primary" id="add-route-btn">+ Add Route</button>
            <div class="map-hint" id="map-hint"></div>
          </div>
        </div>
        <div class="route-list-view hidden" id="route-list-view"></div>
      </div>
    </div>
  `;

  const viewport = container.querySelector("#map-viewport");
  const canvas = container.querySelector("#map-canvas");
  const hint = container.querySelector("#map-hint");
  const addBtn = container.querySelector("#add-route-btn");
  const zoomResetBtn = container.querySelector("#zoom-reset");
  const resetBtn = container.querySelector("#reset-wall-btn");
  const moveBtn = container.querySelector("#move-route-btn");
  // Canvas size and the zoom state follow the discipline (see setDiscipline).
  let CANVAS_W = canvasWidth(discipline);
  let CANVAS_H = canvasHeight(discipline);
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  // A discipline with a single section (rope) has nothing to zoom between, so
  // it stays "zoomed" into that section: no area picker, and RESET is always at hand.
  const sections = () => sectionsFor(discipline);
  const singleSection = () => sections().length === 1;
  syncSingleSection();

  // The how-to-use hint goes away for good (per user) the first time they zoom.
  const hintKey = `pr_map_hint_seen_${getCurrentUser()?.id}`;
  let hintSeen = false;
  try { hintSeen = localStorage.getItem(hintKey) === "1"; } catch { /* storage blocked — hint just shows each visit */ }
  function dismissHint() {
    if (hintSeen) return;
    hintSeen = true;
    try { localStorage.setItem(hintKey, "1"); } catch { /* not remembered */ }
    updateHint();
  }
  updateHint();

  if (!hasFitToScreen) {
    fitToScreen();
    hasFitToScreen = true;
  } else {
    applyTransform();
  }
  renderCanvasContents();
  wirePanZoom();

  resetBtn.addEventListener("click", () => {
    const section = sections().find((s) => s.id === zoomedSectionId);
    if (!section) return;
    openResetWallModal(gymId, section.id, section.name, {
      onReset: () => {
        // Zoomed mode already shows only this section's markers, so every
        // one on screen right now is one being cleared — fade them out
        // instead of having them just vanish on the next render.
        canvas.querySelectorAll(".route-marker[data-route-id]").forEach((el) => el.classList.add("removed"));
        setTimeout(() => renderCanvasContents(), 180);
      },
    });
  });

  function exitZoomedSection() {
    if (singleSection()) { renderCanvasContents(); return; }
    zoomedSectionId = null;
    syncReset();
    renderCanvasContents();
  }

  // Wiping a wall is an admin action, so RESET only shows in admin mode (and only while zoomed into a wall).
  function syncReset() { resetBtn.classList.toggle("hidden", !(showMoveBtn && zoomedSectionId));
    zoomResetBtn.classList.toggle("in-area", !!zoomedSectionId && !singleSection()); // in an area this button is the way back out, so it inverts
  }

  // Keeps the zoomed-section state consistent with the current discipline.
  function syncSingleSection() {
    if (singleSection()) {
      zoomedSectionId = sections()[0].id;
      syncReset();
    } else {
      zoomedSectionId = null;
      syncReset();
    }
  }

  function setDiscipline(next) {
    if (next === discipline || !DISCIPLINES.includes(next)) return;
    if (placementMode) exitPlacementMode();
    if (moveMode) exitMoveMode();
    closeListPopover();
    filtersByDiscipline[discipline] = filters;
    discipline = next;
    filters = filtersByDiscipline[next] || (filtersByDiscipline[next] = defaultFilters(next));
    storeDiscipline(next);
    CANVAS_W = canvasWidth(next);
    CANVAS_H = canvasHeight(next);
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    listSection = null;
    selectedRouteId = null;
    newlyAddedRouteId = null;
    syncSingleSection();
    container.querySelectorAll("[data-discipline]").forEach((b) => {
      const on = b.dataset.discipline === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    container.querySelector("#heatmap-difficulty-btn").textContent = next === "rope" ? "5." : "V";
    updateHint();
    canvas.classList.add("switching");
    fitToScreen();
    renderCanvasContents().finally(() => canvas.classList.remove("switching"));
  }
  container.querySelectorAll("[data-discipline]").forEach((b) => b.addEventListener("click", () => setDiscipline(b.dataset.discipline)));

  function enterZoomedSection(sectionId) {
    zoomedSectionId = sectionId;
    syncReset();
    const section = sections().find((s) => s.id === sectionId);
    const pct = polygonBounds(section.points);
    animateNextTransform(() => fitToBounds({
      minX: (pct.minX / 100) * CANVAS_W, maxX: (pct.maxX / 100) * CANVAS_W,
      minY: (pct.minY / 100) * CANVAS_H, maxY: (pct.maxY / 100) * CANVAS_H,
    }));
    renderCanvasContents();
  }

  const pollTimer = setInterval(() => {
    if (!placementMode && !moveMode && !randomRunning && !isListBusy()) renderCanvasContents({ quiet: true });
  }, REFRESH_MS);

  addBtn.addEventListener("click", () => {
    if (placementMode) { exitPlacementMode(); return; }
    enterPlacementMode();
  });

  moveBtn?.addEventListener("click", () => {
    if (moveMode) { exitMoveMode(); return; }
    enterMoveMode();
  });

  const menuBtn = container.querySelector("#map-menu-btn");
  const menu = container.querySelector("#map-menu");
  function setMenuOpen(open) {
    menu.classList.toggle("hidden", !open);
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  // Outlines the menu button while a mode it contains is on, so it's visible with the menu closed.
  function syncMenuBtn() { menuBtn.classList.toggle("active", !!activeHeatmap || moveMode || isFilterActive()); }
  // Filters live in the menu now: outline the button and offer "Clear filters" while any are set.
  function syncFilterUI() {
    const on = isFilterActive();
    container.querySelector("#open-filters").classList.toggle("active", on);
    container.querySelector("#clear-filters").classList.toggle("hidden", !on);
    syncMenuBtn();
  }
  menuBtn.addEventListener("click", () => setMenuOpen(menu.classList.contains("hidden")));
  // Capture phase so a tap anywhere (map pan, marker drag, list rows) closes the menu.
  container.querySelector(".map-page").addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target) && !menuBtn.contains(e.target)) setMenuOpen(false);
  }, true);

  const listView = container.querySelector("#route-list-view");
  function setViewMode(mode) {
    if (mode === viewMode) return;
    if (mode === "list") {
      if (placementMode) exitPlacementMode();
      if (moveMode) exitMoveMode();
      listSection = null; // always open on the grid of areas
    } else {
      closeListPopover();
    }
    viewMode = mode;
    viewport.classList.toggle("hidden", mode === "list");
    listView.classList.toggle("hidden", mode !== "list");
    moveBtn.classList.toggle("hidden", !showMoveBtn || mode === "list"); // moving routes is a map gesture
    container.querySelector("#random-climb-btn").classList.toggle("hidden", mode === "list"); // so is picking from the map
    container.querySelectorAll("[data-view]").forEach((b) => {
      const on = b.dataset.view === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (mode === "map" && listSection) enterZoomedSection(listSection); // keep looking at the area you were reading
    else renderCanvasContents();
  }
  container.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setViewMode(b.dataset.view)));

  container.querySelector("#gym-stats-btn").addEventListener("click", () => { location.hash = "#/stats"; });

  // Random Climb: greys every marker, flashes through random ones (slowing down as
  // it lands), then opens the winner's popup — the same one tapping it opens.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function pickRandomClimb() {
    if (randomRunning || destroyed) return;
    randomRunning = true;
    setMenuOpen(false);
    if (placementMode) exitPlacementMode();
    if (moveMode) exitMoveMode();
    if (zoomedSectionId && !singleSection()) { // pick from the whole gym, not just the zoomed wall
      zoomedSectionId = null;
      syncReset();
      animateNextTransform(fitToScreen);
    }
    await renderCanvasContents({ quiet: true }); // fresh markers, current filters applied
    const markers = [...canvas.querySelectorAll(".route-marker[data-route-id]")];
    if (!markers.length || destroyed) { randomRunning = false; if (!destroyed) showToast("No routes to pick from"); return; }
    const winner = markers[Math.floor(Math.random() * markers.length)];
    canvas.classList.add("randomizing");
    const STEPS = 20;
    let current = null;
    for (let i = 0; i < STEPS && !destroyed; i++) {
      let next = i === STEPS - 1 ? winner : markers[Math.floor(Math.random() * markers.length)];
      if (next === current && markers.length > 1) next = markers[(markers.indexOf(next) + 1) % markers.length]; // always visibly change
      current?.classList.remove("lit");
      next.classList.add("lit");
      current = next;
      await sleep(40 + i * i * 0.35); // ~40ms at first, easing out to ~170ms
    }
    await sleep(600); // let the winner glow for a beat
    canvas.classList.remove("randomizing");
    current?.classList.remove("lit");
    randomRunning = false;
    if (!destroyed) showRoute(winner); // straight to the popup, not the area zoom a tap would trigger
  }
  container.querySelector("#random-climb-btn").addEventListener("click", pickRandomClimb);

  const completedHeatBtn = container.querySelector("#heatmap-completed-btn");
  const difficultyHeatBtn = container.querySelector("#heatmap-difficulty-btn");

  function setActiveHeatmap(mode) {
    activeHeatmap = activeHeatmap === mode ? null : mode;
    syncMenuBtn();
    completedHeatBtn.classList.toggle("active", activeHeatmap === "completed");
    completedHeatBtn.setAttribute("aria-pressed", String(activeHeatmap === "completed"));
    difficultyHeatBtn.classList.toggle("active", activeHeatmap === "difficulty");
    difficultyHeatBtn.setAttribute("aria-pressed", String(activeHeatmap === "difficulty"));
    updateHint();
    renderCanvasContents();
  }
  completedHeatBtn.addEventListener("click", () => setActiveHeatmap("completed"));
  difficultyHeatBtn.addEventListener("click", () => setActiveHeatmap("difficulty"));

  function defaultHintText() {
    if (activeHeatmap === "completed") return "Color shows total completions · pale = fewest, dark = most";
    if (activeHeatmap === "difficulty") return "Color shows difficulty · pale = easiest, dark = hardest";
    if (hintSeen) return "";
    if (singleSection()) return "Pinch or scroll to zoom · drag to pan · tap a marker for details";
    return "Pinch or scroll to zoom · drag to pan · tap a wall to zoom in · tap a marker for details";
  }

  function updateHint() {
    const text = placementMode ? "Tap the wall where the route starts to place it"
      : moveMode ? "Press and drag a route to reposition it — long-press on mobile"
      : defaultHintText();
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  }

  function enterPlacementMode() {
    if (moveMode) exitMoveMode();
    placementMode = true;
    selectedRouteId = null;
    addBtn.textContent = "Cancel";
    addBtn.classList.remove("btn-primary");
    addBtn.classList.add("btn-danger");
    updateHint();
    viewport.classList.add("placement-active");
    renderCanvasContents();
  }

  function enterMoveMode() {
    if (placementMode) exitPlacementMode();
    moveMode = true;
    movingRouteId = null;
    moveBtn.textContent = "Cancel";
    moveBtn.classList.remove("btn-success");
    moveBtn.classList.add("btn-danger");
    syncMenuBtn();
    setMenuOpen(false);
    updateHint();
    renderCanvasContents();
  }

  function exitMoveMode() {
    moveMode = false;
    movingRouteId = null;
    moveBtn.textContent = "MOVE";
    moveBtn.classList.remove("btn-danger");
    moveBtn.classList.add("btn-success");
    syncMenuBtn();
    updateHint();
    renderCanvasContents();
  }

  function exitPlacementMode() {
    placementMode = false;
    pendingPoint = null;
    addBtn.textContent = "+ Add Route";
    addBtn.classList.remove("btn-danger");
    addBtn.classList.add("btn-primary");
    updateHint();
    viewport.classList.remove("placement-active");
    renderCanvasContents();
  }

  function applyTransform() {
    canvas.style.transform = `translate(${viewState.tx}px, ${viewState.ty}px) scale(${viewState.scale})`;
  }

  // Eases an explicit, discrete view change (zoom into a wall, back to the
  // full map, tap +/-) instead of it snapping instantly. Never used for a
  // live pinch/drag, which must track the finger with zero added delay.
  function animateNextTransform(fn) {
    canvas.classList.add("animating");
    fn();
    canvas.addEventListener("transitionend", () => canvas.classList.remove("animating"), { once: true });
    setTimeout(() => canvas.classList.remove("animating"), 400); // safety net
  }

  // Fits a canvas-space pixel box (in the 0..CANVAS_W / 0..CANVAS_H frame)
  // into whatever viewport this device has, centered, so a narrow phone
  // screen shows the whole area at once instead of scale=1 (a small sliver
  // of it, with lots of bare background that looked like a rendering glitch).
  function fitToBounds(box) {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = box.maxX - box.minX || 1;
    const h = box.maxY - box.minY || 1;
    const scale = clamp(Math.min(rect.width / w, rect.height / h) * 0.85, MIN_SCALE, MAX_SCALE);
    viewState.scale = scale;
    viewState.tx = (rect.width - w * scale) / 2 - box.minX * scale;
    viewState.ty = (rect.height - h * scale) / 2 - box.minY * scale;
    applyTransform();
  }

  // Fits the whole gym canvas inside the viewport (see fitToBounds above).
  function fitToScreen() {
    fitToBounds({ minX: 0, maxX: CANVAS_W, minY: 0, maxY: CANVAS_H });
  }

  // Selects a marker and opens its route popup (shared by marker taps and Random Climb).
  function showRoute(el) {
    selectedRouteId = el.getAttribute("data-route-id");
    newlyAddedRouteId = null;
    canvas.querySelectorAll(".route-marker").forEach((m) => m.classList.remove("selected", "just-added"));
    el.classList.add("selected");
    openRouteDetail(selectedRouteId, {
      onClose: () => { selectedRouteId = null; renderCanvasContents(); },
      onChanged: () => renderCanvasContents(),
    });
  }

  // Bubble color/label for a route: its hold color and grade normally, or a
  // magma heat color when a heatmap is on. Shared by map markers and list rows.
  function markerLook(r) {
    let bg = HOLD_COLOR_HEX[r.holdColor];
    const rope = disciplineOf(r) === "rope";
    let label = r.officialGrade !== null ? gradeScaleLabel(r.officialGrade, discipline)
      : r.communityGrade != null ? (rope ? `${formatRopeGrade(Math.round(r.communityGrade))}?` : `${r.communityGrade.toFixed(1)}?`)
      : "?";
    let textStyle = "";
    let holdAttr = ` data-hold="${r.holdColor}"`;
    if (activeHeatmap === "completed") {
      const finishes = r.finishes || 0;
      const { bg: heat, isDark } = magmaStyle(finishes / 3); // 0-30 by 3 -> indices 0-10
      bg = heat;
      label = String(finishes);
      textStyle = ` color:${isDark ? "#fff" : "#1b1d21"}; text-shadow:${isDark ? "0 1px 1px rgba(0,0,0,.4)" : "none"};`;
      holdAttr = "";
    } else if (activeHeatmap === "difficulty") {
      const value = r.officialGrade !== null ? r.officialGrade : r.communityGrade;
      if (value === null || value === undefined) {
        bg = HEAT_NO_DATA;
        textStyle = " color:#fff; text-shadow:0 1px 1px rgba(0,0,0,.4);";
      } else {
        // Boulder is 0-10 by 1; rope's 0-20 is halved so both span the 11-step palette.
        const { bg: heat, isDark } = magmaStyle(rope ? clamp(value, 0, 20) / 2 : clamp(value, 0, 10));
        bg = heat;
        textStyle = ` color:${isDark ? "#fff" : "#1b1d21"}; text-shadow:${isDark ? "0 1px 1px rgba(0,0,0,.4)" : "none"};`;
      }
      holdAttr = "";
    }
    return { bg, label, textStyle, holdAttr };
  }

  async function renderCanvasContents({ quiet = false } = {}) {
    let visibleRoutes;
    let completedRouteIds = new Set();
    let flashedRouteIds = new Set();
    let resets = {};
    try {
      const currentUser = getCurrentUser();
      const [allRoutes, myLog, gyms] = await Promise.all([
        getRoutes(gymId),
        currentUser ? getLogEntries(currentUser.id).catch(() => []) : [],
        getGyms().catch(() => []),
      ]);
      if (destroyed) return;
      completedRouteIds = new Set(myLog.map((e) => e.routeId));
      flashedRouteIds = new Set(myLog.filter((e) => e.flash).map((e) => e.routeId));
      resets = gyms.find((g) => g.id === gymId)?.resets || {};
      visibleRoutes = allRoutes.filter((r) => disciplineOf(r) === discipline && routeMatches(r, completedRouteIds));
    } catch (err) {
      if (!quiet) container.querySelector("#result-count").textContent = "Couldn't load routes";
      return;
    }

    if (viewMode === "list") {
      // Same filtered routes as the map; routes outside every wall section
      // never show on the map either, so they're left out here too.
      const bySection = new Map(sections().map((s) => [s.id, []]));
      let placed = 0;
      for (const r of visibleRoutes) {
        const sectionId = findWallSectionAt(r.mapX, r.mapY, discipline);
        if (sectionId) { bySection.get(sectionId).push(r); placed++; }
      }
      const tagNames = new Map((await getAllTags().catch(() => [])).map((t) => [t.id, t.name]));
      if (destroyed || viewMode !== "list") return;
      renderRouteList(container.querySelector("#route-list-view"), {
        sections: sections().map((s) => ({ id: s.id, name: s.name, routes: bySection.get(s.id) })),
        discipline,
        resets, completedIds: completedRouteIds, flashedIds: flashedRouteIds, tagNames,
        look: markerLook,
        sectionId: listSection,
        onSelectSection: (id) => { listSection = id; window.scrollTo(0, 0); renderCanvasContents(); },
        onBack: () => { listSection = null; window.scrollTo(0, 0); renderCanvasContents(); },
        openRoute: (routeId) => openRouteDetail(routeId, {
          onClose: () => renderCanvasContents(),
          onChanged: () => renderCanvasContents(),
        }),
        onChanged: () => renderCanvasContents(),
      });
      if (!quiet) container.querySelector("#result-count").textContent = `${placed} route${placed === 1 ? "" : "s"}`;
      syncFilterUI();
      return;
    }

    const visibleSections = zoomedSectionId ? sections().filter((s) => s.id === zoomedSectionId) : sections();

    const zonesHTML = `
      <svg class="floor-plan ${discipline}" viewBox="0 0 100 100" preserveAspectRatio="none">
        ${visibleSections.map((s) => sectionPolygons(s).map((poly) => `<polygon class="wall-zone" data-section-id="${s.id}" points="${toSvgPoints(poly)}"></polygon>`).join("")).join("")}
      </svg>
    `;

    // A map with one section needs no area name printed across it.
    const labelsHTML = singleSection() ? "" : visibleSections.map((s) => {
      const [cx, cy] = polygonCentroid(s.points);
      const bounds = polygonBounds(s.points);
      const margin = 3;
      let left = cx, top = bounds.minY - margin, anchor = "";
      if (s.labelPlacement === "left") { left = bounds.minX - margin; top = cy; }
      else if (s.labelPlacement === "bottom-right") {
        // Text's own right/bottom edge lands exactly on the polygon's
        // right edge and bottom corner, instead of centering on a point.
        left = bounds.maxX - margin; top = bounds.maxY - margin; anchor = "transform:translate(-100%,-100%);";
      }
      const isNewSet = resets[s.id] && Date.now() - new Date(resets[s.id]) < NEW_SET_MS;
      return `<div class="wall-label" style="left:${left}%; top:${top}%; ${anchor}">${isNewSet ? '<span class="new-set">New Set</span>' : ""}${escapeHtml(s.name)}</div>`;
    }).join("");

    // Only routes placed inside a wall section ever render as markers; when
    // zoomed into one section, only its own routes show.
    visibleRoutes = visibleRoutes.filter((r) => {
      const sectionId = findWallSectionAt(r.mapX, r.mapY, discipline);
      return sectionId && (!zoomedSectionId || sectionId === zoomedSectionId);
    });

    const markersHTML = visibleRoutes
      .map((r) => {
        const completed = completedRouteIds.has(r.id);
        const isNew = r.id === newlyAddedRouteId;
        const { bg: markerBg, label: markerLabel, textStyle, holdAttr } = markerLook(r);

        return `
          <div class="route-marker ${discipline === "rope" ? "rope" : ""} ${completed ? "completed" : "uncompleted"} ${isNew ? "just-added" : ""} ${r.id === selectedRouteId ? "selected" : ""} ${!r.active ? "retired" : ""} ${zoomedSectionId && !singleSection() ? "zoomed" : ""}"
               style="left:${r.mapX}%; top:${r.mapY}%; background:${markerBg};${textStyle}"
               data-route-id="${r.id}"${holdAttr}
               role="button" tabindex="0" aria-label="${escapeHtml(routeLabel(r))}, ${r.holdType}, ${completed ? "completed" : "not yet completed"}${r.mediaCount ? `, ${r.mediaCount} photo${r.mediaCount === 1 ? "" : "s"}/videos` : ""}">
            <span class="marker-grade">${markerLabel}</span>
          </div>
        `;
      })
      .join("");

    const pendingHTML = pendingPoint
      ? `<div class="route-marker pending ${discipline === "rope" ? "rope" : ""}" style="left:${pendingPoint.mapX}%; top:${pendingPoint.mapY}%;"><span class="marker-grade">NEW</span></div>`
      : "";

    canvas.innerHTML = zonesHTML + labelsHTML + markersHTML + pendingHTML;
    canvas.querySelectorAll(".wall-zone").forEach((el) => {
      el.addEventListener("click", () => {
        if (panMoved || placementMode || zoomedSectionId || singleSection()) return;
        enterZoomedSection(el.getAttribute("data-section-id"));
      });
    });
    canvas.querySelectorAll(".route-marker[data-route-id]").forEach((el) => {
      el.addEventListener("click", () => {
        if (panMoved || placementMode || moveMode) return;
        // From the whole-gym map a tap goes to that route's area first; a tap inside an area opens the route.
        const sectionId = zoomedSectionId ? null : findWallSectionAt(parseFloat(el.style.left), parseFloat(el.style.top), discipline);
        if (sectionId) { enterZoomedSection(sectionId); return; }
        showRoute(el);
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
      if (moveMode) wireMarkerDrag(el, el.getAttribute("data-route-id"));
    });

    if (!quiet) {
      container.querySelector("#result-count").textContent = `${visibleRoutes.length} route${visibleRoutes.length === 1 ? "" : "s"}`;
    }
    syncFilterUI();
    applyTransform();
  }

  // Move-mode marker drag: press-drag-release repositions a route on the
  // canvas (percentage coordinates, same convention as mapX/mapY). On a
  // mouse the drag arms immediately on press; on touch it requires a
  // long-press first so an ordinary swipe still pans the map everywhere
  // else. stopPropagation on every step keeps the viewport's own pan/zoom
  // handlers (wirePanZoom) from also reacting to the same pointer.
  function wireMarkerDrag(el, routeId) {
    let longPressTimer = null;
    let armed = false;
    let moved = false;
    let startClientX = 0, startClientY = 0;
    let startLeftPct = 0, startTopPct = 0;

    function beginDrag() {
      armed = true;
      moved = false;
      movingRouteId = routeId;
      el.classList.add("selected");
    }

    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      startClientX = e.clientX; startClientY = e.clientY;
      startLeftPct = parseFloat(el.style.left);
      startTopPct = parseFloat(el.style.top);
      try { el.setPointerCapture(e.pointerId); } catch { /* no active pointer with this id — safe to ignore */ }
      if (e.pointerType === "mouse") beginDrag();
      else longPressTimer = setTimeout(beginDrag, 500);
    });

    el.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!armed) {
        if (Math.abs(e.clientX - startClientX) > 8 || Math.abs(e.clientY - startClientY) > 8) {
          clearTimeout(longPressTimer);
        }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const dxPct = ((e.clientX - startClientX) / rect.width) * 100;
      const dyPct = ((e.clientY - startClientY) / rect.height) * 100;
      if (Math.abs(dxPct) > 0.3 || Math.abs(dyPct) > 0.3) moved = true;
      el.style.left = `${clamp(startLeftPct + dxPct, 0, 100)}%`;
      el.style.top = `${clamp(startTopPct + dyPct, 0, 100)}%`;
    });

    el.addEventListener("pointerup", async (e) => {
      e.stopPropagation();
      clearTimeout(longPressTimer);
      if (!armed) return;
      armed = false;
      movingRouteId = null;
      if (!moved) { el.classList.remove("selected"); return; }
      const newMapX = clamp(parseFloat(el.style.left), 0, 100);
      const newMapY = clamp(parseFloat(el.style.top), 0, 100);
      try {
        await updateRoute(routeId, { mapX: newMapX, mapY: newMapY });
        showToast("Route moved");
        renderCanvasContents();
      } catch {
        showToast("Couldn't move that route");
        renderCanvasContents();
      }
    });

    // Android's long-press context menu would otherwise interrupt the hold-to-move.
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    el.addEventListener("pointercancel", () => {
      clearTimeout(longPressTimer);
      if (armed) { armed = false; movingRouteId = null; el.classList.remove("selected"); }
    });
  }

  container.querySelector("#open-filters").addEventListener("click", () => {
    openFilterDrawer(() => renderCanvasContents());
  });
  container.querySelector("#clear-filters").addEventListener("click", () => {
    filters = filtersByDiscipline[discipline] = defaultFilters(discipline);
    renderCanvasContents();
  });

  function wirePanZoom() {
    let dragging = false;
    let lastX = 0, lastY = 0;
    let pinchStartDist = null;
    let pinchStartScale = 1;

    function zoomAt(clientX, clientY, factor) {
      const rect = viewport.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const newScale = clamp(viewState.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = newScale / viewState.scale;
      viewState.tx = px - ratio * (px - viewState.tx);
      viewState.ty = py - ratio * (py - viewState.ty);
      viewState.scale = newScale;
      applyTransform();
      dismissHint();
    }

    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });

    viewport.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      panMoved = false;
      lastX = e.clientX; lastY = e.clientY;
      // Capture is deferred until real dragging is confirmed below — capturing
      // on every pointerdown (even a plain tap) made Chromium route the
      // resulting "click" to the viewport instead of the marker/zone under
      // the finger, so nothing tappable on the map ever fired its handler.
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        if (!panMoved) viewport.setPointerCapture(e.pointerId);
        panMoved = true;
      }
      viewState.tx += dx; viewState.ty += dy;
      lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      viewport.addEventListener(ev, () => {
        dragging = false;
        setTimeout(() => { panMoved = false; }, 0);
      })
    );

    // Basic pinch-to-zoom via Touch events (in addition to pointer-based pan above).
    viewport.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchStartDist === null) {
          pinchStartDist = dist;
          pinchStartScale = viewState.scale;
        } else {
          const factor = dist / pinchStartDist;
          const midX = (a.clientX + b.clientX) / 2;
          const midY = (a.clientY + b.clientY) / 2;
          const rect = viewport.getBoundingClientRect();
          const px = midX - rect.left, py = midY - rect.top;
          const newScale = clamp(pinchStartScale * factor, MIN_SCALE, MAX_SCALE);
          const ratio = newScale / viewState.scale;
          viewState.tx = px - ratio * (px - viewState.tx);
          viewState.ty = py - ratio * (py - viewState.ty);
          viewState.scale = newScale;
          applyTransform();
          dismissHint();
        }
      }
    }, { passive: false });
    viewport.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinchStartDist = null; });

    viewport.addEventListener("click", (e) => {
      if (!placementMode || panMoved) return;
      if (e.target.closest(".route-marker") || e.target.closest("button")) return;
      const rect = canvas.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const mapX = clamp(relX * 100, 0, 100);
      const mapY = clamp(relY * 100, 0, 100);
      const wallSection = findWallSectionAt(mapX, mapY, discipline);
      if (!wallSection) {
        showToast(singleSection() ? "Tap on a wall to place a route" : "Tap inside a wall section to place a route", { small: true });
        return;
      }
      pendingPoint = { mapX, mapY, wallSection };
      renderCanvasContents();
      getAllTags().then((tags) => {
        openAddRouteForm({
          gymId,
          discipline,
          mapX, mapY,
          wallSection: pendingPoint.wallSection,
          allTags: tags,
          onCreated: (route) => { newlyAddedRouteId = route.id; exitPlacementMode(); renderCanvasContents(); },
          onCancel: () => exitPlacementMode(),
        });
      });
    });

    container.querySelector("#zoom-in").addEventListener("click", () => {
      const rect = viewport.getBoundingClientRect();
      animateNextTransform(() => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2));
    });
    container.querySelector("#zoom-out").addEventListener("click", () => {
      const rect = viewport.getBoundingClientRect();
      animateNextTransform(() => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8));
    });
    container.querySelector("#zoom-reset").addEventListener("click", () => {
      if (zoomedSectionId && !singleSection()) exitZoomedSection();
      animateNextTransform(fitToScreen);
    });

    applyTransform();
  }

  function openFilterDrawer(onApply) {
    const backdrop = document.createElement("div");
    backdrop.className = "drawer-backdrop";
    document.body.appendChild(backdrop);

    function close() { dismissOverlay(backdrop); }

    async function renderDrawer() {
      const allTags = await getAllTags();
      backdrop.innerHTML = `
        <div class="drawer" role="dialog" aria-modal="true" aria-label="Filter routes">
          <div class="drawer-handle"></div>
          <div class="drawer-header"><h2>Filter Routes</h2><button class="icon-btn" style="background:#efece5;color:#1b1d21" id="fd-close">X</button></div>

          <div class="filter-group">
            <h3>Status</h3>
            <div class="chip-row">
              <button class="chip ${filters.completion.has("completed") ? "active" : ""}" data-completion="completed">Completed</button>
              <button class="chip ${filters.completion.has("uncompleted") ? "active" : ""}" data-completion="uncompleted">Not Completed</button>
            </div>
          </div>

          ${discipline === "rope" ? `
          <div class="filter-group">
            <h3>Type of Climb</h3>
            <div class="chip-row">
              ${CLIMB_TYPES.map((t) => `<button class="chip ${filters.climbTypes.has(t.id) ? "active" : ""}" data-climb-type="${t.id}">${t.label}</button>`).join("")}
            </div>
          </div>` : ""}

          <div class="filter-group">
            <h3>Official Grade</h3>
            ${rangeSliderHTML("grade", "official grade", filters.gradeMin, filters.gradeMax)}
          </div>

          <div class="filter-group">
            <h3>Community Estimate Range</h3>
            ${rangeSliderHTML("est", "community estimate", filters.estMin, filters.estMax)}
          </div>

          <div class="filter-group">
            <h3>Hold Type</h3>
            <div class="chip-row">
              ${HOLD_TYPES.map((t) => `<button class="chip ${filters.holdTypes.has(t) ? "active" : ""}" data-hold-type="${t}">${t}</button>`).join("")}
            </div>
          </div>

          <div class="filter-group">
            <h3>Hold Color</h3>
            <div class="chip-row">
              ${HOLD_COLORS.map((c) => `<button class="chip color-chip ${filters.holdColors.has(c) ? "active" : ""}" data-hold-color="${c}" style="background:${HOLD_COLOR_HEX[c]};color:${HOLD_COLOR_TEXT[c]};">${c}</button>`).join("")}
            </div>
          </div>

          <div class="filter-group">
            <h3>Climbing Style / Tags</h3>
            <div class="chip-row">
              ${allTags.map((t) => `<button class="chip ${filters.tagIds.has(t.id) ? "active" : ""}" data-tag="${t.id}">${escapeHtml(t.name)}</button>`).join("")}
            </div>
          </div>

          <button class="btn btn-primary btn-block" id="fd-done">Show Results</button>
        </div>
      `;

      backdrop.querySelector("#fd-close").addEventListener("click", close);
      backdrop.querySelector("#fd-done").addEventListener("click", close);
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

      backdrop.querySelectorAll("[data-completion]").forEach((btn) => btn.addEventListener("click", () => {
        const c = btn.getAttribute("data-completion");
        filters.completion.has(c) ? filters.completion.delete(c) : filters.completion.add(c);
        onApply(); renderDrawer();
      }));
      backdrop.querySelectorAll("[data-climb-type]").forEach((btn) => btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-climb-type");
        filters.climbTypes.has(t) ? filters.climbTypes.delete(t) : filters.climbTypes.add(t);
        onApply(); renderDrawer();
      }));
      wireRangeSlider(backdrop.querySelector('[data-range="grade"]'), (lo, hi) => {
        filters.gradeMin = lo; filters.gradeMax = hi; onApply();
      });
      wireRangeSlider(backdrop.querySelector('[data-range="est"]'), (lo, hi) => {
        filters.estMin = lo; filters.estMax = hi; onApply();
      });
      backdrop.querySelectorAll("[data-hold-type]").forEach((btn) => btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-hold-type");
        filters.holdTypes.has(t) ? filters.holdTypes.delete(t) : filters.holdTypes.add(t);
        onApply(); renderDrawer();
      }));
      backdrop.querySelectorAll("[data-hold-color]").forEach((btn) => btn.addEventListener("click", () => {
        const c = btn.getAttribute("data-hold-color");
        filters.holdColors.has(c) ? filters.holdColors.delete(c) : filters.holdColors.add(c);
        onApply(); renderDrawer();
      }));
      backdrop.querySelectorAll("[data-tag]").forEach((btn) => btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-tag");
        filters.tagIds.has(t) ? filters.tagIds.delete(t) : filters.tagIds.add(t);
        onApply(); renderDrawer();
      }));
    }

    renderDrawer();
  }

  return function cleanup() {
    destroyed = true;
    clearInterval(pollTimer);
    closeListPopover();
  };
}
