import { getLogEntries, computeUserStats, deleteLogEntry, getCurrentUser } from "../data/api.js";
import { formatGrade, formatEstimate, HOLD_COLORS, HOLD_TYPES, MAX_GRADE, WALL_SECTIONS } from "../data/constants.js";
import { formatDate, escapeHtml, monthLabel, clamp } from "../utils.js";
import { renderBarChart, renderMultiBarChart, renderLineChart, PALETTE } from "../components/charts.js";
import { openGalleryPrompt } from "../components/gallery.js";
import { showToast } from "../components/toast.js";

function wallSectionName(id) {
  return WALL_SECTIONS.find((s) => s.id === id)?.name || null;
}

function snapshotLabel(entry) {
  const snapshot = entry.snapshot;
  const base = `${snapshot.holdColor} ${formatGrade(snapshot.officialGrade)}`;
  const place = wallSectionName(snapshot.wallSection);
  return place ? `${base} - ${place}` : base;
}

function areaLabel(entry) {
  return wallSectionName(entry.snapshot.wallSection) || "—";
}

function gradeAreaLabel(entry) {
  return `${formatGrade(entry.snapshot.officialGrade)} - ${areaLabel(entry)}`;
}

export function renderClimbingLog(container, userId, { title = "Climbing Log", canGoBack = false, backHash = "#/friends" } = {}) {
  const isOwn = getCurrentUser()?.id === userId;
  let mode = "table";
  let sortField = "completedAt";
  let sortDir = "desc";
  let allEntries = [];
  let loaded = false;
  let loadError = null;
  const filterState = { dateFrom: "", dateTo: "", officialGrade: "", holdType: "", holdColor: "", tag: "" };

  function getFiltered() {
    let entries = allEntries;
    if (filterState.dateFrom) entries = entries.filter((e) => e.completedAt >= filterState.dateFrom);
    if (filterState.dateTo) entries = entries.filter((e) => e.completedAt <= filterState.dateTo + "T23:59:59");
    if (filterState.officialGrade !== "") entries = entries.filter((e) => String(e.snapshot.officialGrade) === filterState.officialGrade);
    if (filterState.holdType) entries = entries.filter((e) => e.snapshot.holdType === filterState.holdType);
    if (filterState.holdColor) entries = entries.filter((e) => e.snapshot.holdColor === filterState.holdColor);
    if (filterState.tag) entries = entries.filter((e) => e.topTags.some((t) => t.name === filterState.tag));

    entries = [...entries].sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case "area": av = areaLabel(a); bv = areaLabel(b); break;
        case "holdColor": av = a.snapshot.holdColor; bv = b.snapshot.holdColor; break;
        case "officialGrade": av = a.snapshot.officialGrade ?? -1; bv = b.snapshot.officialGrade ?? -1; break;
        case "estimatedGrade": av = a.estimatedGrade ?? -1; bv = b.estimatedGrade ?? -1; break;
        case "holdType": av = a.snapshot.holdType; bv = b.snapshot.holdType; break;
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
      allEntries = await getLogEntries(userId);
      loadError = null;
    } catch (err) {
      loadError = err.message;
    }
    loaded = true;
    render();
  }

  async function handleDelete(entry) {
    try {
      await deleteLogEntry(entry.id);
      allEntries = allEntries.filter((e) => e.id !== entry.id);
      showToast("Send removed");
      render();
    } catch (err) {
      showToast(err.message);
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
        <div id="log-body"></div>
      </div>
    `;

    container.querySelectorAll("[data-mode]").forEach((btn) =>
      btn.addEventListener("click", () => { mode = btn.getAttribute("data-mode"); render(); })
    );

    const body = container.querySelector("#log-body");
    if (loadError) { body.innerHTML = `<div class="empty-state card">${escapeHtml(loadError)}</div>`; return; }
    if (!loaded) { body.innerHTML = `<div class="empty-state card">Loading climbing log…</div>`; return; }
    if (mode === "table") renderTable(body, entries);
    else renderStats(body);
  }

  function renderTable(body, entries) {
    const tags = allTagNames();
    body.innerHTML = `
      <div class="filters-bar">
        <input type="date" id="f-from" value="${filterState.dateFrom}" aria-label="From date"/>
        <input type="date" id="f-to" value="${filterState.dateTo}" aria-label="To date"/>
        <select id="f-grade"><option value="">Any Grade</option>${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${filterState.officialGrade === String(g) ? "selected" : ""}>V${g}</option>`).join("")}</select>
        <select id="f-holdtype"><option value="">Any Hold Type</option>${HOLD_TYPES.map((h) => `<option ${filterState.holdType === h ? "selected" : ""}>${h}</option>`).join("")}</select>
        <select id="f-holdcolor"><option value="">Any Hold Color</option>${HOLD_COLORS.map((c) => `<option ${filterState.holdColor === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <select id="f-tag"><option value="">Any Style</option>${tags.map((t) => `<option ${filterState.tag === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-sm" id="f-clear">Clear</button>
      </div>
      ${entries.length === 0 ? emptyState() : `
      <div class="table-wrap log-table-wrap">
        <table class="log-table">
          <thead><tr>
            ${headerCell("Date", "completedAt")}
            ${headerCell("Area", "area")}
            ${headerCell("Official Grade", "officialGrade")}
            ${headerCell("Community Est.", "estimatedGrade")}
            ${headerCell("Hold Type", "holdType")}
            <th>Style / Tags</th>
            ${isOwn ? "<th></th>" : ""}
          </tr></thead>
          <tbody>
            ${entries.map((e) => `
              <tr data-route-id="${e.routeId}" data-label="${escapeHtml(snapshotLabel(e))}" tabindex="0">
                <td>${formatDate(e.completedAt)}</td>
                <td><span class="hold-dot" style="background:var(--hold-${e.snapshot.holdColor.toLowerCase()})"></span> ${escapeHtml(gradeAreaLabel(e))}${!e.route ? ' <span class="badge-soft">retired</span>' : ""}</td>
                <td>${formatGrade(e.snapshot.officialGrade)}</td>
                <td>${e.estimatedGrade === null ? "—" : formatEstimate(e.estimatedGrade)}</td>
                <td>${e.snapshot.holdType || "—"}</td>
                <td>${[
                  e.flash ? `<span class="chip flash-chip" style="margin:2px;">FLASH</span>` : "",
                  ...e.topTags.map((t) => `<span class="chip" style="margin:2px;">${escapeHtml(t.name)}</span>`),
                ].join("") || "—"}</td>
                ${isOwn ? `<td><button class="btn btn-ghost btn-sm" data-delete-id="${e.id}" style="color:var(--pr-danger);">Delete</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="log-card-list">
        ${entries.map((e) => `
          <div class="swipe-row" data-entry-id="${e.id}">
            ${isOwn ? `<button class="swipe-delete-btn" aria-label="Delete this send">Delete</button>` : ""}
            <button class="log-card" data-route-id="${e.routeId}" data-label="${escapeHtml(snapshotLabel(e))}">
              <div class="log-card-top">
                <span class="hold-dot" style="background:var(--hold-${e.snapshot.holdColor.toLowerCase()})"></span>
                <strong>${escapeHtml(gradeAreaLabel(e))}</strong>
                ${!e.route ? '<span class="badge-soft">retired</span>' : ""}
                <span class="log-card-date">${formatDate(e.completedAt)}</span>
              </div>
              <div class="log-card-meta">${e.snapshot.holdType || "—"} · Community Est. ${e.estimatedGrade === null ? "—" : formatEstimate(e.estimatedGrade)}</div>
              ${e.flash || e.topTags.length ? `<div class="log-card-tags">${e.flash ? `<span class="chip flash-chip">FLASH</span>` : ""}${e.topTags.map((t) => `<span class="chip">${escapeHtml(t.name)}</span>`).join("")}</div>` : ""}
            </button>
          </div>
        `).join("")}
      </div>`}
    `;

    function headerCell(label, field) {
      const arrow = sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "";
      return `<th data-sort="${field}">${label}<span class="sort-arrow">${arrow}</span></th>`;
    }

    body.querySelectorAll("[data-sort]").forEach((th) =>
      th.addEventListener("click", () => {
        const field = th.getAttribute("data-sort");
        if (sortField === field) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortField = field; sortDir = "asc"; }
        render();
      })
    );
    body.querySelectorAll("tr[data-route-id]").forEach((el) =>
      el.addEventListener("click", () => openGalleryPrompt(el.getAttribute("data-route-id"), el.getAttribute("data-label")))
    );
    body.querySelectorAll("[data-delete-id]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const entry = entries.find((x) => x.id === btn.getAttribute("data-delete-id"));
        if (entry) handleDelete(entry);
      })
    );
    body.querySelectorAll(".swipe-row").forEach((row) => {
      const entry = entries.find((x) => x.id === row.getAttribute("data-entry-id"));
      wireLogCard(row, () => entry && handleDelete(entry));
    });
    body.querySelector("#f-from").addEventListener("change", (e) => { filterState.dateFrom = e.target.value; render(); });
    body.querySelector("#f-to").addEventListener("change", (e) => { filterState.dateTo = e.target.value; render(); });
    body.querySelector("#f-grade").addEventListener("change", (e) => { filterState.officialGrade = e.target.value; render(); });
    body.querySelector("#f-holdtype").addEventListener("change", (e) => { filterState.holdType = e.target.value; render(); });
    body.querySelector("#f-holdcolor").addEventListener("change", (e) => { filterState.holdColor = e.target.value; render(); });
    body.querySelector("#f-tag").addEventListener("change", (e) => { filterState.tag = e.target.value; render(); });
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

    card.addEventListener("click", (e) => {
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
    return `<div class="empty-state card"><div>No climbs match these filters yet.</div></div>`;
  }

  async function renderStats(body) {
    body.innerHTML = `<div class="empty-state card">Loading stats…</div>`;
    let stats;
    try {
      stats = await computeUserStats(userId);
    } catch (err) {
      body.innerHTML = `<div class="empty-state card">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (stats.totalClimbs === 0) {
      body.innerHTML = `<div class="empty-state card"><div>Log a send to start seeing your stats.</div></div>`;
      return;
    }
    const gradeLabels = stats.gradeDistribution.map((_, g) => `V${g}`);
    const holdTypeLabels = HOLD_TYPES;
    const holdTypeData = HOLD_TYPES.map((h) => stats.holdTypeDistribution[h] || 0);
    const styleLabels = stats.styleDistribution.slice(0, 8).map((s) => s.name);
    const styleData = stats.styleDistribution.slice(0, 8).map((s) => s.count);
    const estLabels = stats.estGradeDistribution.map((_, g) => `V${g}`);
    const timeLabels = stats.climbsOverTime.map(([k]) => monthLabel(k));
    const timeData = stats.climbsOverTime.map(([, v]) => v);

    body.innerHTML = `
      <div class="stats-grid">
        <div class="card stat-tile"><div class="stat-value">${stats.totalClimbs}</div><div class="stat-label">Total Climbs</div></div>
        <div class="card stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade)}</div><div class="stat-label">Highest Grade</div></div>
        <div class="card stat-tile"><div class="stat-value" style="font-size:15px;">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
        <div class="card stat-tile"><div class="stat-value" style="font-size:15px;">${stats.favoriteHoldTypeCalculated || "—"}</div><div class="stat-label">Most Climbed Hold</div></div>
      </div>
      <div class="charts-grid">
        <div class="card card-pad chart-card">
          <h3>Grade Distribution</h3><p>Completed climbs by official grade</p>
          <div class="chart-box"><canvas id="c-grade"></canvas></div>
        </div>
        <div class="card card-pad chart-card">
          <h3>Hold Type Distribution</h3><p>Climbs by hold type</p>
          <div class="chart-box"><canvas id="c-hold"></canvas></div>
        </div>
        <div class="card card-pad chart-card">
          <h3>Climbing Style Distribution</h3><p>Most common highly-rated tags on your sends</p>
          <div class="chart-box">${styleLabels.length ? '<canvas id="c-style"></canvas>' : '<div class="empty-state">No tag data yet</div>'}</div>
        </div>
        <div class="card card-pad chart-card">
          <h3>Estimated Grade Distribution</h3><p>Community estimate of routes you've climbed</p>
          <div class="chart-box"><canvas id="c-est"></canvas></div>
        </div>
        <div class="card card-pad chart-card" style="grid-column:1/-1;">
          <h3>Climbs Over Time</h3><p>Sends logged per month</p>
          <div class="chart-box"><canvas id="c-time"></canvas></div>
        </div>
      </div>
    `;

    renderBarChart(body.querySelector("#c-grade"), gradeLabels, stats.gradeDistribution, "#ff5a1f");
    renderMultiBarChart(body.querySelector("#c-hold"), holdTypeLabels, holdTypeData, PALETTE);
    if (styleLabels.length) renderMultiBarChart(body.querySelector("#c-style"), styleLabels, styleData, PALETTE);
    renderBarChart(body.querySelector("#c-est"), estLabels, stats.estGradeDistribution, "#1e88e5");
    renderLineChart(body.querySelector("#c-time"), timeLabels, timeData, "#43a047");
  }

  render();
  load();
}
