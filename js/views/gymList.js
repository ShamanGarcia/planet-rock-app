import { updateRoute, submitGradeEstimate, logSend } from "../data/api.js";
import { MAX_GRADE, formatGrade, formatEstimate, routeLabel } from "../data/constants.js";
import { showToast } from "../components/toast.js";
import { escapeHtml, clamp } from "../utils.js";

// List view of the gym map: one box per wall section, rows styled like the
// climbing log. gymMap.js owns the data, filters and heat colors and hands
// them in, so the list and the map always agree on what's shown.

const ACTION_W = 84;       // width of each swipe action, same as the log's delete button
const RESET_RED_DAYS = 30; // days since reset at which the number is fully red

const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const BOLT_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2L5 13.5h5.5L9.5 22 19 9.5h-5.5z"/></svg>`;

let popover = null;
let popoverAnchor = null;
let popoverCleanup = null;
let closeOpenRow = null; // closes whichever row is currently swiped open

// True while a grade dropdown or a swiped-open row would be wiped by a re-render.
export function isListBusy() { return popover !== null || closeOpenRow !== null; }

export function closeListPopover() {
  popoverCleanup?.();
  popover = popoverAnchor = popoverCleanup = null;
}

// Green at 0 days, red at RESET_RED_DAYS or more.
function resetInfo(iso) {
  if (!iso) return null;
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));
  return { days, color: `hsl(${120 * (1 - clamp(days / RESET_RED_DAYS, 0, 1))}, 72%, 36%)` };
}

// Left to right along the wall, the way a climber walks it.
function sortRoutes(routes) {
  return [...routes].sort((a, b) => a.mapX - b.mapX || a.mapY - b.mapY);
}

// Opening screen: a 2-column grid with one tile per area.
function gridHTML(ctx) {
  return `<div class="list-grid">${ctx.sections.map((s) => `
    <button type="button" class="card list-tile" data-section-id="${s.id}">
      <span class="list-tile-name">${escapeHtml(s.name)}</span>
      <span class="list-tile-count">${s.routes.length} route${s.routes.length === 1 ? "" : "s"}</span>
    </button>`).join("")}</div>`;
}

// One area's full list (no 5-row window), with a way back to the grid.
function areaHTML(s, ctx) {
  return `<button type="button" class="btn btn-outline btn-sm list-back" id="list-back">&larr; All Areas</button>${boxHTML(s, ctx)}`;
}

function rowHTML(r, ctx) {
  const look = ctx.look(r);
  const done = ctx.completedIds.has(r.id);
  const flashed = ctx.flashedIds.has(r.id);
  const tags = (r.tags || []).map((id) => ctx.tagNames.get(id)).filter(Boolean).slice(0, 2);
  return `
    <div class="swipe-row list-swipe" data-route-id="${r.id}">
      <button class="swipe-action swipe-flash" aria-label="Log a flash">${BOLT_ICON}</button>
      <button class="swipe-action swipe-complete" aria-label="Log as completed">${CHECK_ICON}</button>
      <div class="log-card list-row" role="button" tabindex="0" aria-label="${escapeHtml(routeLabel(r))}, ${escapeHtml(r.holdType || "")}">
        <span class="list-route-cell">
          <span class="list-bubble" style="background:${look.bg};${look.textStyle}"${look.holdAttr}>${look.label}</span>
          <span class="list-color">${escapeHtml(r.holdColor)}</span>
          <span class="list-status">${done ? `<span class="list-done" title="Completed">${CHECK_ICON}</span>` : ""}${flashed ? `<span class="list-flashed" title="Flashed">${BOLT_ICON}</span>` : ""}</span>
        </span>
        <button type="button" class="grade-cell" data-kind="official" aria-label="Set official grade">${formatGrade(r.officialGrade)}</button>
        <button type="button" class="grade-cell" data-kind="estimate" aria-label="Submit grade estimate">${r.communityGrade == null ? "—" : formatEstimate(r.communityGrade)}</button>
        <span class="list-hold">${escapeHtml(r.holdType || "—")}</span>
        <span class="list-tags">${tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</span>
      </div>
    </div>`;
}

function boxHTML(s, ctx) {
  const n = s.routes.length;
  const reset = resetInfo(ctx.resets[s.id]);
  return `
    <section class="card list-box${ctx.sectionId ? " full" : ""}" data-section-box="${s.id}">
      <div class="list-box-head">
        <h2>${escapeHtml(s.name)}</h2>
        <div class="list-box-meta">
          <span>${n} route${n === 1 ? "" : "s"}</span>
          <span>${reset ? `<b class="list-reset-num" style="color:${reset.color}">${reset.days}</b> day${reset.days === 1 ? "" : "s"} since reset` : "No reset yet"}</span>
        </div>
      </div>
      <div class="list-cols"><span>Route</span><span>Official Grade</span><span>Community Est.</span><span>Hold Type</span><span class="list-tags">Style / Tags</span></div>
      <div class="list-box-body">${n ? sortRoutes(s.routes).map((r) => rowHTML(r, ctx)).join("") : `<div class="list-empty">No routes</div>`}</div>
    </section>`;
}

// ctx: { sections: [{id, name, routes}], resets, completedIds, flashedIds,
//        tagNames (id -> name), look(route) -> {bg, textStyle, holdAttr, label},
//        openRoute(routeId), onChanged() }
export function renderRouteList(el, ctx) {
  // Keep each box's scroll position across re-renders (filters, polling, edits).
  const scrolls = {};
  el.querySelectorAll("[data-section-box]").forEach((b) => { scrolls[b.dataset.sectionBox] = b.querySelector(".list-box-body").scrollTop; });
  closeListPopover();
  closeOpenRow = null;

  const area = ctx.sections.find((s) => s.id === ctx.sectionId);
  el.innerHTML = area ? areaHTML(area, ctx) : gridHTML(ctx);
  el.querySelectorAll(".list-tile").forEach((tile) => tile.addEventListener("click", () => ctx.onSelectSection(tile.dataset.sectionId)));
  el.querySelector("#list-back")?.addEventListener("click", ctx.onBack);
  const routeById = new Map(ctx.sections.flatMap((s) => s.routes).map((r) => [r.id, r]));

  el.querySelectorAll("[data-section-box]").forEach((box) => {
    box.querySelector(".list-box-body").scrollTop = scrolls[box.dataset.sectionBox] || 0;
  });
  el.querySelectorAll(".list-swipe").forEach((row) => wireRow(row, routeById.get(row.dataset.routeId), ctx));
}

// Pointer-event swipe (works for touch and mouse, same approach as the climbing
// log's cards): left reveals the green check (complete), right reveals the
// yellow bolt (flash). Tapping a revealed action performs it.
function wireRow(row, route, ctx) {
  const card = row.querySelector(".list-row");
  let startX = 0, startY = 0, base = 0, x = 0, dragging = false, moved = false;

  function setX(v, animate) {
    card.style.transition = animate ? "" : "none";
    card.style.transform = `translateX(${v}px)`;
    row.classList.toggle("revealed", v !== 0); // actions stay hidden at rest so they don't peek out at the rounded corners
    x = v;
  }
  function close() {
    setX(0, true);
    if (closeOpenRow === close) closeOpenRow = null;
  }

  card.style.touchAction = "pan-y";
  // A swipe can start anywhere on the row, grade buttons included. The pointer is
  // only captured once the finger/mouse really travels sideways, so a plain tap
  // still reaches the grade button underneath it.
  card.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true; moved = false; startX = e.clientX; startY = e.clientY; base = x;
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - startY)) {
      moved = true;
      try { card.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    if (moved) setX(clamp(base + dx, -ACTION_W, ACTION_W), false);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    const target = x <= -ACTION_W / 2 ? -ACTION_W : x >= ACTION_W / 2 ? ACTION_W : 0;
    setX(target, true);
    if (target === 0) { if (closeOpenRow === close) closeOpenRow = null; return; }
    if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    closeOpenRow = close;
  };
  card.addEventListener("pointerup", endDrag);
  card.addEventListener("pointercancel", endDrag);

  card.addEventListener("click", (e) => {
    if (e.target.closest(".grade-cell")) return;
    if (moved) { moved = false; return; } // the click that ends a swipe
    if (x !== 0) { close(); return; }
    ctx.openRoute(route.id);
  });
  card.addEventListener("keydown", (e) => {
    if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); card.click(); }
  });

  card.querySelectorAll(".grade-cell").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (moved) { moved = false; return; } // that was the end of a swipe, not a tap
    if (x !== 0) { close(); return; } // a revealed row closes first
    if (popoverAnchor === btn) { closeListPopover(); return; }
    openGradePopover(btn, btn.dataset.kind, route, ctx);
  }));

  async function sendLog(flash) {
    close();
    try {
      await logSend(route.id, { flash });
      showToast(flash ? "Flash logged" : "Send logged");
      ctx.onChanged();
    } catch (err) { showToast(err.message); }
  }
  row.querySelector(".swipe-complete").addEventListener("click", () => sendLog(false));
  row.querySelector(".swipe-flash").addEventListener("click", () => sendLog(true));
}

// Grade dropdown anchored to a cell: official sets the route's grade (same call
// the route popup uses), estimate submits the viewer's community vote.
function openGradePopover(anchor, kind, route, ctx) {
  closeListPopover();
  const official = kind === "official";
  const options = [
    ...(official ? [{ label: "Ungraded", value: null }] : []),
    ...Array.from({ length: MAX_GRADE + 1 }, (_, g) => ({ label: `V${g}`, value: g })),
  ];
  const pop = document.createElement("div");
  pop.className = "grade-popover";
  pop.setAttribute("role", "listbox");
  pop.innerHTML = `<div class="grade-popover-title">${official ? "Official grade" : "Your estimate"}</div>` +
    options.map((o) => `<button type="button" role="option" class="grade-option ${official && o.value === route.officialGrade ? "active" : ""}" data-value="${o.value ?? ""}">${o.label}</button>`).join("");
  document.body.appendChild(pop);

  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const below = a.bottom + 6 + h <= window.innerHeight - 8;
  pop.style.left = `${clamp(a.left, 8, window.innerWidth - w - 8)}px`;
  pop.style.top = `${below ? a.bottom + 6 : Math.max(8, a.top - 6 - h)}px`;

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeListPopover(); };
  const onKey = (e) => { if (e.key === "Escape") closeListPopover(); };
  const onScroll = (e) => { if (!pop.contains(e.target)) closeListPopover(); };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, true);
  popover = pop;
  popoverAnchor = anchor;
  popoverCleanup = () => {
    pop.remove();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
  };

  pop.addEventListener("click", async (e) => {
    const opt = e.target.closest(".grade-option");
    if (!opt) return;
    const value = opt.dataset.value === "" ? null : Number(opt.dataset.value);
    closeListPopover();
    try {
      if (official) {
        await updateRoute(route.id, { officialGrade: value });
        showToast(value === null ? "Official grade cleared" : `Official grade set to V${value}`);
      } else {
        await submitGradeEstimate(route.id, value);
        showToast(`Estimate submitted: V${value}`);
      }
      ctx.onChanged();
    } catch (err) { showToast(err.message); }
  });
}
