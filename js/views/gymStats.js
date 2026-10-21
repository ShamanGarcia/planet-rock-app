import { getRoutes, getRouteHistory, getAllTags } from "../data/api.js";
import {
  HOLD_TYPES, DISCIPLINES, DISCIPLINE_LABELS, maxGradeFor, sectionsFor, disciplineOf, gradeScaleLabel, findWallSectionAt, formatGrade,
} from "../data/constants.js";
import { getDiscipline, storeDiscipline } from "../data/discipline.js";
import { getAccent } from "../accent.js";
import { renderBarChart, shadesOf } from "../components/charts.js";
import { escapeHtml } from "../utils.js";
import { MAP_ICON } from "./gymMap.js";

// Running tally of the gym: what's up on the walls now, and everything ever set
// (retired routes included). Each tally has a fixed grade chart (official or
// estimated) and a distribution chart switchable between hold, area and tags.

const MAX_TAG_BARS = 12;
const HOLD_KINDS = {
  hold: { option: "Hold type", title: "Hold Distribution", blurb: "Routes by hold type" },
  area: { option: "Area", title: "Area Distribution", blurb: "Routes by wall section" },
  tags: { option: "Tags", title: "Tag Distribution", blurb: "Routes by tag (a route can have several)" },
};

function gradeSeries(routes, kind, discipline) {
  const max = maxGradeFor(discipline);
  const clampGrade = (g) => Math.max(0, Math.min(max, g));
  const counts = Array(max + 1).fill(0);
  let missing = 0;
  for (const r of routes) {
    const v = kind === "official" ? r.officialGrade : r.communityGrade;
    if (v === null || v === undefined) { missing++; continue; }
    counts[clampGrade(Math.round(v))]++;
  }
  return { counts, missing };
}

function holdSeries(routes, kind, tagNames, discipline) {
  const tally = (labels, keysOf) => {
    const counts = new Map(labels.map((l) => [l, 0]));
    routes.forEach((r) => keysOf(r).forEach((k) => counts.has(k) && counts.set(k, counts.get(k) + 1)));
    return counts;
  };
  if (kind === "hold") {
    const c = tally(HOLD_TYPES, (r) => (r.holdTypes && r.holdTypes.length ? r.holdTypes : [r.holdType]));
    return { labels: [...c.keys()], data: [...c.values()] };
  }
  if (kind === "area") {
    const sections = sectionsFor(discipline);
    const names = new Map(sections.map((s) => [s.id, s.name]));
    // Backfilled history has no map position, only the wall section its sends recorded.
    const c = tally(sections.map((s) => s.name), (r) => [names.get(r.mapX == null ? r.wallSection : findWallSectionAt(r.mapX, r.mapY, discipline))]);
    return { labels: [...c.keys()], data: [...c.values()] };
  }
  // Live routes carry tag ids; archived ones carry the names they had when retired.
  const tagsOf = (r) => r.tagNames || (r.tags || []).map((id) => tagNames.get(id)).filter(Boolean);
  const c = tally([...new Set(routes.flatMap(tagsOf))], tagsOf);
  const top = [...c.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_TAG_BARS);
  return { labels: top.map(([name]) => name), data: top.map(([, n]) => n) };
}

function sectionHTML(key, title, routes, discipline, note = "") {
  const sends = routes.reduce((sum, r) => sum + (r.finishes || 0), 0);
  const graded = routes.filter((r) => r.officialGrade !== null && r.officialGrade !== undefined);
  const avg = graded.length ? graded.reduce((sum, r) => sum + r.officialGrade, 0) / graded.length : null;
  return `
    <h2 class="gs-heading">${title}</h2>
    ${note ? `<p class="gs-note">${note}</p>` : ""}
    <div class="stats-grid">
      <div class="card stat-tile"><div class="stat-value">${routes.length}</div><div class="stat-label">Routes</div></div>
      <div class="card stat-tile"><div class="stat-value">${sends}</div><div class="stat-label">Sends</div></div>
      <div class="card stat-tile"><div class="stat-value">${avg === null ? "—" : formatGrade(Math.round(avg * 10) / 10, discipline)}</div><div class="stat-label">Avg Grade</div></div>
    </div>
    <div class="charts-grid">
      <div class="card card-pad chart-card">
        <div class="gs-card-head">
          <h3>Grade Distribution</h3>
          <div class="mode-toggle gs-toggle" role="group" aria-label="Grade type">
            <button type="button" class="active" data-grade-kind="official">Official</button>
            <button type="button" data-grade-kind="estimated">Estimated</button>
          </div>
        </div>
        <p id="gs-${key}-grade-note"></p>
        <div class="chart-box"><canvas id="gs-${key}-grade"></canvas></div>
      </div>
      <div class="card card-pad chart-card">
        <div class="gs-card-head">
          <h3 id="gs-${key}-hold-title">${HOLD_KINDS.hold.title}</h3>
          <select class="gs-select" aria-label="Distribution by">
            ${Object.entries(HOLD_KINDS).map(([value, k]) => `<option value="${value}">${k.option}</option>`).join("")}
          </select>
        </div>
        <p id="gs-${key}-hold-note">${HOLD_KINDS.hold.blurb}</p>
        <div class="chart-box"><canvas id="gs-${key}-hold"></canvas></div>
      </div>
    </div>`;
}

function wireSection(root, key, routes, tagNames, discipline) {
  const gradeCanvas = root.querySelector(`#gs-${key}-grade`);
  const holdCanvas = root.querySelector(`#gs-${key}-hold`);
  const gradeBox = gradeCanvas.closest(".chart-card");
  const holdBox = holdCanvas.closest(".chart-card");

  function drawGrade(kind) {
    const { counts, missing } = gradeSeries(routes, kind, discipline);
    renderBarChart(gradeCanvas, counts.map((_, g) => gradeScaleLabel(g, discipline)), counts, getAccent());
    const label = kind === "official" ? "official grade" : "community estimate, rounded";
    const gap = kind === "official" ? "ungraded" : "no estimate yet";
    root.querySelector(`#gs-${key}-grade-note`).textContent = `Routes by ${label}${missing ? ` · ${missing} ${gap}, not shown` : ""}`;
  }
  function drawHold(kind) {
    const { labels, data } = holdSeries(routes, kind, tagNames, discipline);
    renderBarChart(holdCanvas, labels, data, shadesOf(getAccent(), Math.max(labels.length, 1)));
    root.querySelector(`#gs-${key}-hold-title`).textContent = HOLD_KINDS[kind].title;
    root.querySelector(`#gs-${key}-hold-note`).textContent = labels.length ? HOLD_KINDS[kind].blurb : "Nothing to show yet";
  }

  gradeBox.querySelectorAll("[data-grade-kind]").forEach((btn) => btn.addEventListener("click", () => {
    gradeBox.querySelectorAll("[data-grade-kind]").forEach((b) => b.classList.toggle("active", b === btn));
    drawGrade(btn.dataset.gradeKind);
  }));
  holdBox.querySelector("select").addEventListener("change", (e) => drawHold(e.target.value));
  drawGrade("official");
  drawHold("hold");
}

export async function renderGymStats(container, gymId) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Gym Stats</h1>
          <div class="page-sub" id="gs-sub">Loading…</div>
        </div>
        <a href="#/map" class="map-menu-btn" aria-label="Back to the map" title="Map" style="text-decoration:none;">${MAP_ICON}</a>
      </div>
      <div class="discipline-bar gs-discipline">
        <div class="view-toggle discipline-toggle" role="group" aria-label="Climbing type">
          ${DISCIPLINES.map((d) => `<button type="button" data-discipline="${d}">${DISCIPLINE_LABELS[d]}</button>`).join("")}
        </div>
      </div>
      <div id="gs-body"></div>
    </div>`;
  const body = container.querySelector("#gs-body");
  let current, history, tags;
  try {
    [current, history, tags] = await Promise.all([getRoutes(gymId), getRouteHistory(gymId), getAllTags()]);
  } catch (err) {
    body.innerHTML = `<div class="empty-state card">${escapeHtml(err.message)}</div>`;
    return;
  }
  const tagNames = new Map(tags.map((t) => [t.id, t.name]));

  // Bouldering and rope grades are on different scales, so the tally covers one
  // discipline at a time; the toggle redraws the page for the other.
  function draw() {
    const discipline = getDiscipline();
    container.querySelectorAll("[data-discipline]").forEach((b) => {
      const on = b.dataset.discipline === discipline;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const now = current.filter((r) => disciplineOf(r) === discipline);
    const allTime = [...current, ...history].filter((r) => disciplineOf(r) === discipline);
    container.querySelector("#gs-sub").textContent = `${now.length} up now · ${allTime.length} set all time`;
    // The archive only fills as routes are retired, so say what the tally covers.
    const note = `Routes up now plus ${allTime.length - now.length} retired. Older retired routes were rebuilt from the send log, so only ones someone sent are counted (no tags or estimates).`;
    body.innerHTML = sectionHTML("now", "In the Gym Now", now, discipline) + sectionHTML("all", "All Time", allTime, discipline, note);
    wireSection(body, "now", now, tagNames, discipline);
    wireSection(body, "all", allTime, tagNames, discipline);
  }
  container.querySelectorAll("[data-discipline]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.discipline === getDiscipline()) return;
    storeDiscipline(b.dataset.discipline);
    draw();
  }));
  draw();
}
