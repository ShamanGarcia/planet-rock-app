import { getRoutes, getRouteHistory, getAllTags } from "../data/api.js";
import { MAX_GRADE, HOLD_TYPES, WALL_SECTIONS, findWallSectionAt, formatGrade } from "../data/constants.js";
import { renderBarChart, shadesOf } from "../components/charts.js";
import { escapeHtml } from "../utils.js";

// Running tally of the gym: what's up on the walls now, and everything ever set
// (retired routes included). Each tally has a fixed grade chart (official or
// estimated) and a distribution chart switchable between hold, area and tags.

const BRAND_RED = "#bf2c37";
const MAX_TAG_BARS = 12;
const HOLD_KINDS = {
  hold: { option: "Hold type", title: "Hold Distribution", blurb: "Routes by hold type" },
  area: { option: "Area", title: "Area Distribution", blurb: "Routes by wall section" },
  tags: { option: "Tags", title: "Tag Distribution", blurb: "Routes by tag (a route can have several)" },
};

const clampGrade = (g) => Math.max(0, Math.min(MAX_GRADE, g));

function gradeSeries(routes, kind) {
  const counts = Array(MAX_GRADE + 1).fill(0);
  let missing = 0;
  for (const r of routes) {
    const v = kind === "official" ? r.officialGrade : r.communityGrade;
    if (v === null || v === undefined) { missing++; continue; }
    counts[clampGrade(Math.round(v))]++;
  }
  return { counts, missing };
}

function holdSeries(routes, kind, tagNames) {
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
    const names = new Map(WALL_SECTIONS.map((s) => [s.id, s.name]));
    const c = tally(WALL_SECTIONS.map((s) => s.name), (r) => [names.get(findWallSectionAt(r.mapX, r.mapY))]);
    return { labels: [...c.keys()], data: [...c.values()] };
  }
  // Live routes carry tag ids; archived ones carry the names they had when retired.
  const tagsOf = (r) => r.tagNames || (r.tags || []).map((id) => tagNames.get(id)).filter(Boolean);
  const c = tally([...new Set(routes.flatMap(tagsOf))], tagsOf);
  const top = [...c.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_TAG_BARS);
  return { labels: top.map(([name]) => name), data: top.map(([, n]) => n) };
}

function sectionHTML(key, title, routes, note = "") {
  const sends = routes.reduce((sum, r) => sum + (r.finishes || 0), 0);
  const graded = routes.filter((r) => r.officialGrade !== null && r.officialGrade !== undefined);
  const avg = graded.length ? graded.reduce((sum, r) => sum + r.officialGrade, 0) / graded.length : null;
  return `
    <h2 class="gs-heading">${title}</h2>
    ${note ? `<p class="gs-note">${note}</p>` : ""}
    <div class="stats-grid">
      <div class="card stat-tile"><div class="stat-value">${routes.length}</div><div class="stat-label">Routes</div></div>
      <div class="card stat-tile"><div class="stat-value">${sends}</div><div class="stat-label">Sends</div></div>
      <div class="card stat-tile"><div class="stat-value">${avg === null ? "—" : formatGrade(Math.round(avg * 10) / 10)}</div><div class="stat-label">Avg Grade</div></div>
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

function wireSection(root, key, routes, tagNames) {
  const gradeCanvas = root.querySelector(`#gs-${key}-grade`);
  const holdCanvas = root.querySelector(`#gs-${key}-hold`);
  const gradeBox = gradeCanvas.closest(".chart-card");
  const holdBox = holdCanvas.closest(".chart-card");

  function drawGrade(kind) {
    const { counts, missing } = gradeSeries(routes, kind);
    renderBarChart(gradeCanvas, counts.map((_, g) => `V${g}`), counts, BRAND_RED);
    const label = kind === "official" ? "official grade" : "community estimate, rounded";
    const gap = kind === "official" ? "ungraded" : "no estimate yet";
    root.querySelector(`#gs-${key}-grade-note`).textContent = `Routes by ${label}${missing ? ` · ${missing} ${gap}, not shown` : ""}`;
  }
  function drawHold(kind) {
    const { labels, data } = holdSeries(routes, kind, tagNames);
    renderBarChart(holdCanvas, labels, data, shadesOf(BRAND_RED, Math.max(labels.length, 1)));
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
          <a href="#/map" class="btn btn-ghost btn-sm" style="padding-left:0;">Back</a>
          <h1>Gym Stats</h1>
          <div class="page-sub" id="gs-sub">Loading…</div>
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
  const allTime = [...current, ...history];
  container.querySelector("#gs-sub").textContent = `${current.length} up now · ${allTime.length} set all time`;
  // The archive only fills as routes are retired, so say what the tally covers.
  const note = `Routes up now plus ${history.length} retired since the gym started keeping a history. Resets and deletions are recorded from here on.`;
  body.innerHTML = sectionHTML("now", "In the Gym Now", current) + sectionHTML("all", "All Time", allTime, note);
  wireSection(body, "now", current, tagNames);
  wireSection(body, "all", allTime, tagNames);
}
