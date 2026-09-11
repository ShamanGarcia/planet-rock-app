import { getRoutes, getAllTags, getCurrentUser, getLogEntries } from "../data/api.js";
import {
  HOLD_COLORS, HOLD_COLOR_HEX, HOLD_TYPES, WALL_SECTIONS, MAP_ASPECT_RATIO, MAX_GRADE, formatGrade, routeLabel,
} from "../data/constants.js";
import { openRouteDetail } from "./routeDetail.js";
import { openAddRouteForm } from "../components/addRoute.js";
import { showToast } from "../components/toast.js";
import { escapeHtml, clamp, pointInPolygon, polygonCentroid, polygonBounds } from "../utils.js";

// The canvas is sized in CSS pixels at this fixed base (before pan/zoom
// scaling) so it matches the sketch's own proportions; every zone/marker
// position is a 0-100 percentage of these, same convention as mapX/mapY.
const CANVAS_W = 1000;
const CANVAS_H = Math.round(CANVAS_W / MAP_ASPECT_RATIO);

function toSvgPoints(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

// Persisted at module scope so pan/zoom feels stable across re-renders
// (filter changes, navigating away and back) within the same session.
// The actual starting scale/position is computed per-device on first show
// (see fitToScreen) so the whole gym is visible instead of a narrow sliver
// of it on small phones.
const viewState = { scale: 1, tx: 0, ty: 0 };
let hasFitToScreen = false;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3.5;

const defaultFilters = () => ({
  officialGrades: new Set(),
  estMin: 0,
  estMax: MAX_GRADE,
  holdTypes: new Set(),
  holdColors: new Set(),
  tagIds: new Set(),
});
let filters = defaultFilters();

function isFilterActive() {
  return (
    filters.officialGrades.size > 0 ||
    filters.holdTypes.size > 0 ||
    filters.holdColors.size > 0 ||
    filters.tagIds.size > 0 ||
    filters.estMin !== 0 ||
    filters.estMax !== MAX_GRADE
  );
}

function routeMatches(route) {
  if (filters.officialGrades.size > 0) {
    if (route.officialGrade === null || !filters.officialGrades.has(route.officialGrade)) return false;
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

function findWallSectionAt(x, y) {
  const hit = WALL_SECTIONS.find((s) => pointInPolygon(x, y, s.points));
  return hit ? hit.id : null;
}

const REFRESH_MS = 12000; // keeps the map in sync with routes/votes added from other devices

export function renderGymMap(container, gymId) {
  let selectedRouteId = null;
  let placementMode = false;
  let panMoved = false;
  let destroyed = false;
  let pendingPoint = null; // {mapX, mapY, wallSection} while the add-route form is open
  let zoomedSectionId = null; // set after tapping a zone; null shows the full map

  container.innerHTML = `
    <div class="page map-page">
      <div class="map-toolbar">
        <button class="btn btn-outline btn-sm" id="open-filters">Filters</button>
        <button class="btn btn-ghost btn-sm ${isFilterActive() ? "" : "hidden"}" id="clear-filters">Clear all</button>
        <span class="result-count" id="result-count">Loading…</span>
      </div>
      <div class="map-viewport" id="map-viewport">
        <div class="map-canvas" id="map-canvas"></div>
        <div class="map-zoom-controls">
          <button id="zoom-in" aria-label="Zoom in">+</button>
          <button id="zoom-out" aria-label="Zoom out">−</button>
          <button id="zoom-reset" aria-label="Reset view" style="font-size:13px;">⤢</button>
        </div>
        <button class="btn btn-primary" id="add-route-btn" style="position:absolute; left:12px; top:12px; z-index:25;">+ Add Route</button>
        <button class="btn btn-outline btn-sm hidden" id="back-to-map-btn" style="position:absolute; left:12px; top:56px; z-index:25; background:#fff;">&larr; All Areas</button>
        <div class="map-hint" id="map-hint">Pinch or scroll to zoom · drag to pan · tap a wall to zoom in · tap a marker for details</div>
      </div>
    </div>
  `;

  const viewport = container.querySelector("#map-viewport");
  const canvas = container.querySelector("#map-canvas");
  const hint = container.querySelector("#map-hint");
  const addBtn = container.querySelector("#add-route-btn");
  const backBtn = container.querySelector("#back-to-map-btn");
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;

  if (!hasFitToScreen) {
    fitToScreen();
    hasFitToScreen = true;
  } else {
    applyTransform();
  }
  renderCanvasContents();
  wirePanZoom();

  backBtn.addEventListener("click", () => {
    exitZoomedSection();
    fitToScreen();
  });

  function exitZoomedSection() {
    zoomedSectionId = null;
    backBtn.classList.add("hidden");
    renderCanvasContents();
  }

  function enterZoomedSection(sectionId) {
    zoomedSectionId = sectionId;
    backBtn.classList.remove("hidden");
    const section = WALL_SECTIONS.find((s) => s.id === sectionId);
    const pct = polygonBounds(section.points);
    fitToBounds({
      minX: (pct.minX / 100) * CANVAS_W, maxX: (pct.maxX / 100) * CANVAS_W,
      minY: (pct.minY / 100) * CANVAS_H, maxY: (pct.maxY / 100) * CANVAS_H,
    });
    renderCanvasContents();
  }

  const pollTimer = setInterval(() => {
    if (!placementMode) renderCanvasContents({ quiet: true });
  }, REFRESH_MS);

  addBtn.addEventListener("click", () => {
    if (placementMode) { exitPlacementMode(); return; }
    enterPlacementMode();
  });

  function enterPlacementMode() {
    placementMode = true;
    selectedRouteId = null;
    addBtn.textContent = "Cancel";
    addBtn.classList.remove("btn-primary");
    addBtn.classList.add("btn-danger");
    hint.textContent = "Tap the wall where the route starts to place it";
    viewport.classList.add("placement-active");
    renderCanvasContents();
  }

  function exitPlacementMode() {
    placementMode = false;
    pendingPoint = null;
    addBtn.textContent = "+ Add Route";
    addBtn.classList.remove("btn-danger");
    addBtn.classList.add("btn-primary");
    hint.textContent = "Pinch or scroll to zoom · drag to pan · tap a wall to zoom in · tap a marker for details";
    viewport.classList.remove("placement-active");
    renderCanvasContents();
  }

  function applyTransform() {
    canvas.style.transform = `translate(${viewState.tx}px, ${viewState.ty}px) scale(${viewState.scale})`;
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

  async function renderCanvasContents({ quiet = false } = {}) {
    let visibleRoutes;
    let completedRouteIds = new Set();
    try {
      const currentUser = getCurrentUser();
      const [allRoutes, myLog] = await Promise.all([
        getRoutes(gymId),
        currentUser ? getLogEntries(currentUser.id).catch(() => []) : [],
      ]);
      if (destroyed) return;
      completedRouteIds = new Set(myLog.map((e) => e.routeId));
      visibleRoutes = allRoutes.filter(routeMatches);
    } catch (err) {
      if (!quiet) container.querySelector("#result-count").textContent = "Couldn't load routes";
      return;
    }

    const visibleSections = zoomedSectionId ? WALL_SECTIONS.filter((s) => s.id === zoomedSectionId) : WALL_SECTIONS;

    const zonesHTML = `
      <svg class="floor-plan" viewBox="0 0 100 100" preserveAspectRatio="none">
        ${visibleSections.map((s) => `<polygon class="wall-zone" data-section-id="${s.id}" points="${toSvgPoints(s.points)}"></polygon>`).join("")}
      </svg>
    `;

    const labelsHTML = visibleSections.map((s) => {
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
      return `<div class="wall-label" style="left:${left}%; top:${top}%; ${anchor}">${escapeHtml(s.name)}</div>`;
    }).join("");

    // Only routes placed inside a wall section ever render as markers; when
    // zoomed into one section, only its own routes show.
    visibleRoutes = visibleRoutes.filter((r) => {
      const sectionId = findWallSectionAt(r.mapX, r.mapY);
      return sectionId && (!zoomedSectionId || sectionId === zoomedSectionId);
    });

    const markersHTML = visibleRoutes
      .map((r) => {
        const label = r.officialGrade !== null ? `V${r.officialGrade}`
          : r.communityGrade != null ? `${r.communityGrade.toFixed(1)}?`
          : "?";
        const completed = completedRouteIds.has(r.id);
        const dotColor = completed ? HOLD_COLOR_HEX[r.holdColor] : "var(--pr-slate)";
        return `
          <div class="route-marker ${completed ? "completed" : "uncompleted"} ${r.id === selectedRouteId ? "selected" : ""} ${!r.active ? "retired" : ""} ${zoomedSectionId ? "zoomed" : ""}"
               style="left:${r.mapX}%; top:${r.mapY}%; background:${dotColor};"
               data-route-id="${r.id}" data-hold="${completed ? r.holdColor : ""}"
               role="button" tabindex="0" aria-label="${escapeHtml(routeLabel(r))}, ${r.holdType}, ${completed ? "completed" : "not yet completed"}${r.mediaCount ? `, ${r.mediaCount} photo${r.mediaCount === 1 ? "" : "s"}/videos` : ""}">
            <span class="marker-grade">${label}</span>
          </div>
        `;
      })
      .join("");

    const pendingHTML = pendingPoint
      ? `<div class="route-marker pending" style="left:${pendingPoint.mapX}%; top:${pendingPoint.mapY}%;"><span class="marker-grade">NEW</span></div>`
      : "";

    canvas.innerHTML = zonesHTML + labelsHTML + markersHTML + pendingHTML;
    canvas.querySelectorAll(".wall-zone").forEach((el) => {
      el.addEventListener("click", () => {
        if (panMoved || placementMode || zoomedSectionId) return;
        enterZoomedSection(el.getAttribute("data-section-id"));
      });
    });
    canvas.querySelectorAll(".route-marker[data-route-id]").forEach((el) => {
      el.addEventListener("click", () => {
        if (panMoved || placementMode) return;
        selectedRouteId = el.getAttribute("data-route-id");
        canvas.querySelectorAll(".route-marker").forEach((m) => m.classList.remove("selected"));
        el.classList.add("selected");
        openRouteDetail(selectedRouteId, {
          onClose: () => { selectedRouteId = null; renderCanvasContents(); },
          onChanged: () => renderCanvasContents(),
        });
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
    });

    if (!quiet) {
      container.querySelector("#result-count").textContent = `${visibleRoutes.length} route${visibleRoutes.length === 1 ? "" : "s"}`;
    }
    container.querySelector("#clear-filters").classList.toggle("hidden", !isFilterActive());
    applyTransform();
  }

  container.querySelector("#open-filters").addEventListener("click", () => {
    openFilterDrawer(() => renderCanvasContents());
  });
  container.querySelector("#clear-filters").addEventListener("click", () => {
    filters = defaultFilters();
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
      const wallSection = findWallSectionAt(mapX, mapY);
      if (!wallSection) {
        showToast("Tap inside a wall section to place a route", { small: true });
        return;
      }
      pendingPoint = { mapX, mapY, wallSection };
      renderCanvasContents();
      getAllTags().then((tags) => {
        openAddRouteForm({
          gymId,
          mapX, mapY,
          wallSection: pendingPoint.wallSection,
          allTags: tags,
          onCreated: () => { exitPlacementMode(); renderCanvasContents(); },
          onCancel: () => exitPlacementMode(),
        });
      });
    });

    container.querySelector("#zoom-in").addEventListener("click", () => {
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
    });
    container.querySelector("#zoom-out").addEventListener("click", () => {
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
    });
    container.querySelector("#zoom-reset").addEventListener("click", () => {
      if (zoomedSectionId) exitZoomedSection();
      fitToScreen();
    });

    applyTransform();
  }

  function openFilterDrawer(onApply) {
    const backdrop = document.createElement("div");
    backdrop.className = "drawer-backdrop";
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }

    async function renderDrawer() {
      const allTags = await getAllTags();
      backdrop.innerHTML = `
        <div class="drawer" role="dialog" aria-modal="true" aria-label="Filter routes">
          <div class="drawer-handle"></div>
          <div class="drawer-header"><h2>Filter Routes</h2><button class="icon-btn" style="background:#efece5;color:#1b1d21" id="fd-close">X</button></div>

          <div class="filter-group">
            <h3>Official Grade</h3>
            <div class="chip-row">
              ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `
                <button class="chip ${filters.officialGrades.has(g) ? "active" : ""}" data-grade="${g}">V${g}</button>
              `).join("")}
            </div>
          </div>

          <div class="filter-group">
            <h3>Community Estimate Range</h3>
            <div class="form-row">
              <div class="field"><label>From</label>
                <select id="est-min">${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${filters.estMin === g ? "selected" : ""}>V${g}</option>`).join("")}</select>
              </div>
              <div class="field"><label>To</label>
                <select id="est-max">${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${filters.estMax === g ? "selected" : ""}>V${g}</option>`).join("")}</select>
              </div>
            </div>
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
              ${HOLD_COLORS.map((c) => `<button class="chip ${filters.holdColors.has(c) ? "active" : ""}" data-hold-color="${c}">${c}</button>`).join("")}
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

      backdrop.querySelectorAll("[data-grade]").forEach((btn) => btn.addEventListener("click", () => {
        const g = Number(btn.getAttribute("data-grade"));
        filters.officialGrades.has(g) ? filters.officialGrades.delete(g) : filters.officialGrades.add(g);
        onApply(); renderDrawer();
      }));
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
      backdrop.querySelector("#est-min").addEventListener("change", (e) => {
        filters.estMin = Number(e.target.value);
        if (filters.estMin > filters.estMax) filters.estMax = filters.estMin;
        onApply(); renderDrawer();
      });
      backdrop.querySelector("#est-max").addEventListener("change", (e) => {
        filters.estMax = Number(e.target.value);
        if (filters.estMax < filters.estMin) filters.estMin = filters.estMax;
        onApply(); renderDrawer();
      });
    }

    renderDrawer();
  }

  return function cleanup() {
    destroyed = true;
    clearInterval(pollTimer);
  };
}
