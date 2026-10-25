import { getLogEntries, computeUserStats, deleteLogEntry, getCurrentUser } from "../data/api.js";
import {
  formatGrade, formatEstimate, HOLD_COLORS, HOLD_COLOR_HEX, HOLD_COLOR_TEXT, HOLD_TYPES, DISCIPLINE_LABELS,
  maxGradeFor, sectionsFor, areasFor, disciplineOf, gradeScaleLabel,
} from "../data/constants.js";
import { getDiscipline, storeDiscipline } from "../data/discipline.js";
import { disciplineButtonsHTML } from "../components/disciplineToggle.js";
import { formatDate, escapeHtml, clamp, weekStart, weekWindow, weekWindowLabel, WEEKS_PER_WINDOW } from "../utils.js";
import { getAccent } from "../accent.js";
import { renderBarChart, renderRadarChart, renderPieChart, renderLineChart, shadesOf } from "../components/charts.js";

const NEXT_CHART_MODE = { bar: "radar", radar: "pie", pie: "bar" };
const CHART_MODE_LABEL = { bar: "Bar", radar: "Radar", pie: "Pie" };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BOLT_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`;
import { openGalleryPrompt } from "../components/gallery.js";
import { showToast } from "../components/toast.js";

// Looks across both areas' sections: an entry's wall section belongs to
// whichever discipline it was logged under.
const ALL_SECTIONS = [...sectionsFor("boulder"), ...sectionsFor("rope")];
function wallSectionName(id) {
  return ALL_SECTIONS.find((s) => s.id === id)?.name || null;
}

// The live route (holdColor/holdType/officialGrade/wallSection) if it still
// exists, so an edit made after a send — a grade change, most commonly —
// shows up here too; only a deleted route falls back to the frozen snapshot.
function routeData(entry) {
  return entry.route || entry.snapshot;
}

function snapshotLabel(entry) {
  const data = routeData(entry);
  const base = `${data.holdColor} ${formatGrade(data.officialGrade, disciplineOf(data))}`;
  const place = wallSectionName(data.wallSection);
  return place ? `${base} - ${place}` : base;
}

function areaLabel(entry) {
  return wallSectionName(routeData(entry).wallSection) || "—";
}

export function renderClimbingLog(container, userId, { title = "Climbing Log", canGoBack = false, backHash = "#/friends", adminPassword } = {}) {
  const isOwn = getCurrentUser()?.id === userId;
  let mode = "table";
  let discipline = getDiscipline(); // bouldering and rope grades differ, so the log shows one at a time
  let sortField = "completedAt";
  let sortDir = "desc";
  let allEntries = [];
  let loaded = false;
  let loadError = null;
  // from/to are "YYYY-MM-DD" from the date pickers, compared with each send's local date.
  const filterState = { officialGrade: "", holdType: "", holdColor: "", tag: "", area: "", from: "", to: "" };
  const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  function getFiltered() {
    let entries = allEntries.filter((e) => disciplineOf(routeData(e)) === discipline);
    if (filterState.officialGrade !== "") entries = entries.filter((e) => String(routeData(e).officialGrade) === filterState.officialGrade);
    if (filterState.holdType) entries = entries.filter((e) => routeData(e).holdType === filterState.holdType);
    if (filterState.holdColor) entries = entries.filter((e) => routeData(e).holdColor === filterState.holdColor);
    if (filterState.tag) entries = entries.filter((e) => e.topTags.some((t) => t.name === filterState.tag));
    if (filterState.area) entries = entries.filter((e) => routeData(e).wallSection === filterState.area);
    if (filterState.from) entries = entries.filter((e) => localDay(e.completedAt) >= filterState.from);
    if (filterState.to) entries = entries.filter((e) => localDay(e.completedAt) <= filterState.to);

    entries = [...entries].sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case "area": av = areaLabel(a); bv = areaLabel(b); break;
        case "holdColor": av = routeData(a).holdColor; bv = routeData(b).holdColor; break;
        case "officialGrade": av = routeData(a).officialGrade ?? -1; bv = routeData(b).officialGrade ?? -1; break;
        case "estimatedGrade": av = a.estimatedGrade ?? -1; bv = b.estimatedGrade ?? -1; break;
        case "holdType": av = routeData(a).holdType; bv = routeData(b).holdType; break;
        default: av = a.completedAt; bv = b.completedAt;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return entries;
  }

  function allTagNames() {
    const set = new Set();
    allEntries.forEach((e) => e.topTags.forEach((t) => set.add(t.name)));
    return [...set].sort();
  }

  async function load() {
    try {
      allEntries = await getLogEntries(userId, adminPassword);
      loadError = null;
    } catch (err) {
      loadError = err.message;
    }
    loaded = true;
    render();
  }

  async function handleDelete(entry, rowEl) {
    // Fades/collapses the row immediately instead of it just vanishing when
    // the next render rebuilds the list; the actual re-render still waits
    // for the server to confirm (and for the animation to finish), so a
    // failed delete can put the row back rather than leaving a gap.
    rowEl?.classList.add("row-removing");
    const minDuration = new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await Promise.all([deleteLogEntry(entry.id), minDuration]);
      allEntries = allEntries.filter((e) => e.id !== entry.id);
      showToast("Send removed");
      render();
    } catch (err) {
      showToast(err.message);
      rowEl?.classList.remove("row-removing");
    }
  }

  function render() {
    const entries = loaded ? getFiltered() : [];
    container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <div>
            ${canGoBack ? `<a href="${backHash}" class="btn btn-ghost btn-sm" style="padding-left:0;">Back</a>` : ""}
            <h1>${escapeHtml(title)}</h1>
            <div class="page-sub">${loaded ? `${entries.length} climb${entries.length === 1 ? "" : "s"} recorded` : "Loading…"}</div>
          </div>
          <div class="mode-toggle">
            <button data-mode="table" class="${mode === "table" ? "active" : ""}">Table</button>
            <button data-mode="stats" class="${mode === "stats" ? "active" : ""}">Stats</button>
          </div>
        </div>
        <div class="discipline-bar gs-discipline">
          <div class="view-toggle discipline-toggle" role="group" aria-label="Climbing type">
            ${disciplineButtonsHTML(discipline)}
          </div>
        </div>
        <div id="log-body"></div>
      </div>
    `;

    container.querySelectorAll("[data-mode]").forEach((btn) =>
      btn.addEventListener("click", () => { mode = btn.getAttribute("data-mode"); render(); })
    );
    container.querySelectorAll("[data-discipline]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (btn.dataset.discipline === discipline) return;
        discipline = btn.dataset.discipline;
        storeDiscipline(discipline);
        filterState.officialGrade = ""; // grade and area filters only make sense within one discipline
        filterState.area = "";
        render();
      })
    );

    const body = container.querySelector("#log-body");
    if (loadError) { body.innerHTML = `<div class="empty-state card">${escapeHtml(loadError)}</div>`; return; }
    if (!loaded) { body.innerHTML = `<div class="empty-state card">Loading climbing log…</div>`; return; }
    if (mode === "table") renderTable(body, entries);
    else renderStats(body);
  }

  function renderTable(body, entries) {
    const tags = allTagNames();
    const rope = discipline === "rope";
    body.innerHTML = `
      <div class="filters-bar">
        <select id="f-grade"><option value="">Any Grade</option>${Array.from({ length: maxGradeFor(discipline) + 1 }, (_, g) => `<option value="${g}" ${filterState.officialGrade === String(g) ? "selected" : ""}>${gradeScaleLabel(g, discipline)}</option>`).join("")}</select>
        <select id="f-holdtype"><option value="">Any Hold Type</option>${HOLD_TYPES.map((h) => `<option ${filterState.holdType === h ? "selected" : ""}>${h}</option>`).join("")}</select>
        <select id="f-holdcolor"><option value="">Any Hold Color</option>${HOLD_COLORS.map((c) => `<option ${filterState.holdColor === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <select id="f-tag"><option value="">Any Style</option>${tags.map((t) => `<option ${filterState.tag === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
        <select id="f-area"><option value="">Any Area</option>${areasFor(discipline).map((s) => `<option value="${s.id}" ${filterState.area === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
        <label class="date-filter">From <input type="date" id="f-from" value="${filterState.from}" max="${filterState.to}"/></label>
        <label class="date-filter">To <input type="date" id="f-to" value="${filterState.to}" min="${filterState.from}"/></label>
        <button class="btn btn-ghost btn-sm" id="f-clear">Clear</button>
      </div>
      <section class="card list-box full log-list">
        <div class="list-box-head">
          <h2>${DISCIPLINE_LABELS[discipline]}</h2>
          <div class="list-box-meta"><span>${entries.length} climb${entries.length === 1 ? "" : "s"}</span></div>
        </div>
        <div class="list-cols">
          ${headerCell("Date", "completedAt")}
          ${headerCell("Route", "holdColor")}
          ${headerCell("Area", "area")}
          ${headerCell("Official Grade", "officialGrade", "lg-wide")}
          ${headerCell("Community Est.", "estimatedGrade")}
          ${headerCell("Hold Type", "holdType", "lg-wide")}
          <span class="list-tags">Style / Tags</span>
          ${isOwn ? `<span class="lg-wide"></span>` : ""}
        </div>
        <div class="list-box-body">
          ${entries.length === 0 ? emptyState() : entries.map((e) => {
            const d = routeData(e);
            return `
            <div class="swipe-row" data-entry-id="${e.id}">
              ${isOwn ? `<button class="swipe-delete-btn" aria-label="Delete this send">Delete</button>` : ""}
              <div class="log-card list-row" role="button" tabindex="0" data-route-id="${e.routeId}" data-label="${escapeHtml(snapshotLabel(e))}">
                <span class="lg-date">${formatDate(e.completedAt)}</span>
                <span class="list-route-cell">
                  <span class="list-bubble${rope ? " rope" : ""}" style="background:${HOLD_COLOR_HEX[d.holdColor]};color:${HOLD_COLOR_TEXT[d.holdColor]};" data-hold="${d.holdColor}">${formatGrade(d.officialGrade, discipline)}</span>
                  <span class="list-color">${escapeHtml(d.holdColor)}</span>
                  ${e.flash ? `<span class="list-flashed" title="Flashed">${BOLT_ICON}</span>` : ""}
                </span>
                <span class="list-hold">${escapeHtml(areaLabel(e))}${!e.route ? ' <span class="badge-soft">retired</span>' : ""}</span>
                <span class="lg-wide">${formatGrade(d.officialGrade, discipline)}</span>
                <span>${e.estimatedGrade === null ? "—" : formatEstimate(e.estimatedGrade, discipline)}</span>
                <span class="list-hold lg-wide">${escapeHtml(d.holdType || "—")}</span>
                <span class="list-tags">${e.topTags.map((t) => `<span class="chip">${escapeHtml(t.name)}</span>`).join("")}</span>
                ${isOwn ? `<span class="lg-wide lg-del" role="button" tabindex="0" data-delete-id="${e.id}">Delete</span>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>
      </section>
    `;

    function headerCell(label, field, cls = "") {
      const arrow = sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "";
      return `<button type="button" class="list-sort ${cls}" data-sort="${field}">${label}<span class="sort-arrow">${arrow}</span></button>`;
    }

    body.querySelectorAll("[data-sort]").forEach((th) =>
      th.addEventListener("click", () => {
        const field = th.getAttribute("data-sort");
        if (sortField === field) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortField = field; sortDir = "asc"; }
        render();
      })
    );
    body.querySelectorAll("[data-delete-id]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const entry = entries.find((x) => x.id === btn.getAttribute("data-delete-id"));
        if (entry) handleDelete(entry, btn.closest(".swipe-row"));
      })
    );
    body.querySelectorAll(".swipe-row").forEach((row) => {
      const entry = entries.find((x) => x.id === row.getAttribute("data-entry-id"));
      wireLogCard(row, () => entry && handleDelete(entry, row));
    });
    body.querySelector("#f-from").addEventListener("change", (e) => { filterState.from = e.target.value; render(); });
    body.querySelector("#f-to").addEventListener("change", (e) => { filterState.to = e.target.value; render(); });
    body.querySelector("#f-grade").addEventListener("change", (e) => { filterState.officialGrade = e.target.value; render(); });
    body.querySelector("#f-holdtype").addEventListener("change", (e) => { filterState.holdType = e.target.value; render(); });
    body.querySelector("#f-holdcolor").addEventListener("change", (e) => { filterState.holdColor = e.target.value; render(); });
    body.querySelector("#f-tag").addEventListener("change", (e) => { filterState.tag = e.target.value; render(); });
    body.querySelector("#f-area").addEventListener("change", (e) => { filterState.area = e.target.value; render(); });
    body.querySelector("#f-clear")?.addEventListener("click", () => {
      Object.keys(filterState).forEach((k) => (filterState[k] = ""));
      render();
    });
  }

  // Wires a mobile log card: tap opens the gallery prompt; if a delete
  // button is present (own log only), swiping the card left with native
  // pointer events (no gesture library) reveals it underneath.
  function wireLogCard(rowEl, onDelete) {
    const card = rowEl.querySelector(".log-card");
    const deleteBtn = rowEl.querySelector(".swipe-delete-btn");
    if (!card) return;
    const OPEN_X = -84;
    let startX = 0, baseX = 0, dragging = false, open = false, moved = false;

    if (deleteBtn) {
      card.style.touchAction = "pan-y";
      card.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragging = true; moved = false;
        startX = e.clientX; baseX = open ? OPEN_X : 0;
        card.style.transition = "none";
        card.setPointerCapture(e.pointerId);
      });
      card.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 4) moved = true;
        card.style.transform = `translateX(${clamp(baseX + dx, OPEN_X, 0)}px)`;
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        card.style.transition = "";
        const dx = e.clientX - startX;
        open = clamp(baseX + dx, OPEN_X, 0) < OPEN_X / 2;
        card.style.transform = `translateX(${open ? OPEN_X : 0}px)`;
      };
      card.addEventListener("pointerup", endDrag);
      card.addEventListener("pointercancel", endDrag);
      deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); onDelete(); });
    }

    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); } });
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete-id]")) return; // the desktop Delete inside the row
      if (moved) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (open) {
        e.preventDefault(); e.stopImmediatePropagation();
        open = false;
        card.style.transform = "translateX(0)";
        return;
      }
      openGalleryPrompt(card.getAttribute("data-route-id"), card.getAttribute("data-label"));
    });
  }

  function emptyState() {
    return `<div class="list-empty">No climbs match these filters.</div>`;
  }

  async function renderStats(body) {
    body.innerHTML = `<div class="empty-state card">Loading stats…</div>`;
    let stats;
    try {
      // The server computes each discipline's figures separately (their grade
      // scales differ); the top level is bouldering, "rope" holds the rest.
      const all = await computeUserStats(userId, adminPassword);
      stats = discipline === "rope" ? all.rope : all;
    } catch (err) {
      body.innerHTML = `<div class="empty-state card">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (stats.totalClimbs === 0) {
      body.innerHTML = `<div class="empty-state card"><div>Log a ${discipline === "rope" ? "rope " : ""}send to start seeing your stats.</div></div>`;
      return;
    }

    // Each of the first four charts cycles bar -> radar -> pie independently.
    const chartMode = { grade: "bar", est: "bar", area: "bar", style: "bar" };

    const allGradeLabels = stats.gradeDistribution.map((_, g) => gradeScaleLabel(g, discipline));
    const allEstLabels = stats.estGradeDistribution.map((_, g) => gradeScaleLabel(g, discipline));
    const areaEntries = Object.entries(stats.areaDistribution);
    const areaLabels = areaEntries.map(([id]) => wallSectionName(id) || id);
    const areaData = areaEntries.map(([, count]) => count);
    const styleLabels = stats.styleDistribution.slice(0, 8).map((s) => s.name);
    const styleData = stats.styleDistribution.slice(0, 8).map((s) => s.count);

    body.innerHTML = `
      <div class="stats-grid">
        <div class="card stat-tile"><div class="stat-value">${stats.totalClimbs}</div><div class="stat-label">Total Climbs</div></div>
        <div class="card stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade, discipline)}</div><div class="stat-label">Highest Grade</div></div>
        <div class="card stat-tile"><div class="stat-value">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
        <div class="card stat-tile"><div class="stat-value">${stats.favoriteHoldTypeCalculated || "—"}</div><div class="stat-label">Most Climbed Hold</div></div>
      </div>
      <div class="charts-grid">
        <div class="card card-pad chart-card">
          <button class="btn btn-outline btn-sm chart-toggle-btn" data-chart="grade">Radar</button>
          <h3>Grade Distribution</h3><p>Completed climbs by official grade</p>
          <div class="chart-box"><canvas id="c-grade"></canvas></div>
        </div>
        <div class="card card-pad chart-card">
          <button class="btn btn-outline btn-sm chart-toggle-btn" data-chart="est">Radar</button>
          <h3>Estimated Grade Distribution</h3><p>Community estimate of routes you've climbed</p>
          <div class="chart-box"><canvas id="c-est"></canvas></div>
        </div>
        <div class="card card-pad chart-card">
          <button class="btn btn-outline btn-sm chart-toggle-btn" data-chart="area">Radar</button>
          <h3>Climbing Area</h3><p>Climbs by wall section</p>
          <div class="chart-box">${areaLabels.length ? '<canvas id="c-area"></canvas>' : '<div class="empty-state">No area data yet</div>'}</div>
        </div>
        <div class="card card-pad chart-card">
          <button class="btn btn-outline btn-sm chart-toggle-btn" data-chart="style">Radar</button>
          <h3>Climbing Style Distribution</h3><p>Most common highly-rated tags on your sends</p>
          <div class="chart-box">${styleLabels.length ? '<canvas id="c-style"></canvas>' : '<div class="empty-state">No tag data yet</div>'}</div>
        </div>
        <div class="card card-pad chart-card" style="grid-column:1/-1;">
          <div style="position:absolute;top:12px;right:12px;display:flex;gap:6px;">
            <button class="btn btn-outline btn-sm" id="time-prev" aria-label="Previous 3 months">‹</button>
            <button class="btn btn-outline btn-sm" id="time-next" aria-label="Next 3 months">›</button>
          </div>
          <h3>Climbs Over Time</h3><p>Sends per week · <span id="time-range"></span></p>
          <div class="chart-box"><canvas id="c-time"></canvas></div>
        </div>
      </div>
    `;

    const series = {
      grade: [allGradeLabels, stats.gradeDistribution],
      est: [allEstLabels, stats.estGradeDistribution],
      area: [areaLabels, areaData],
      style: [styleLabels, styleData],
    };
    function draw(key) {
      const canvas = body.querySelector(`#c-${key}`);
      if (!canvas) return; // area/style show an empty state instead of a canvas
      const [labels, data] = series[key];
      if (chartMode[key] === "radar") return renderRadarChart(canvas, labels, data, getAccent());
      if (chartMode[key] === "pie") {
        const keep = data.map((_, i) => i).filter((i) => data[i] > 0);
        return renderPieChart(canvas, keep.map((i) => labels[i]), keep.map((i) => data[i]), shadesOf(getAccent(), Math.max(keep.length, 1)));
      }
      const isGrade = key === "grade" || key === "est";
      renderBarChart(canvas, labels, data, isGrade ? getAccent() : shadesOf(getAccent(), labels.length));
    }
    Object.keys(series).forEach(draw);

    body.querySelectorAll(".chart-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-chart");
        chartMode[key] = NEXT_CHART_MODE[chartMode[key]];
        btn.textContent = CHART_MODE_LABEL[NEXT_CHART_MODE[chartMode[key]]];
        draw(key);
      });
    });

    // Weekly counts in 13-week (~3 month) windows; timeOffset counts whole
    // windows back from the one ending this week.
    let timeOffset = 0;
    const earliest = allEntries.length ? weekStart(allEntries.reduce((m, e) => (e.completedAt < m ? e.completedAt : m), allEntries[0].completedAt)) : null;
    function drawTime() {
      const weeks = weekWindow(timeOffset);
      const counts = weeks.map(() => 0);
      allEntries.forEach((e) => {
        // Rounding absorbs the ±1h a DST change adds to a week's length.
        const i = Math.round((weekStart(e.completedAt) - weeks[0]) / WEEK_MS);
        if (i >= 0 && i < WEEKS_PER_WINDOW) counts[i] += 1;
      });
      renderLineChart(body.querySelector("#c-time"), weeks.map((w) => `${w.getMonth() + 1}/${w.getDate()}`), counts, "#43a047");
      body.querySelector("#time-range").textContent = weekWindowLabel(weeks);
      body.querySelector("#time-next").disabled = timeOffset === 0;
      body.querySelector("#time-prev").disabled = !earliest || weeks[0] <= earliest;
    }
    drawTime();
    body.querySelector("#time-prev").addEventListener("click", () => { timeOffset += 1; drawTime(); });
    body.querySelector("#time-next").addEventListener("click", () => { timeOffset -= 1; drawTime(); });
  }

  render();
  load();
}
