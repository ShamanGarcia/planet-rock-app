import {
  getRouteDetail, voteTag, addTagToRoute, getAllTags, submitGradeEstimate,
  getAcceptedFriends, getLogEntries, updateRoute,
} from "../data/api.js";
import { formatGrade, formatEstimate, MAX_GRADE, HOLD_COLOR_HEX, routeLabel } from "../data/constants.js";
import { renderDonutChart } from "../components/charts.js";
import { openLogSendSheet } from "../components/logSendSheet.js";
import { openFullGallery, getCombinedMedia } from "../components/gallery.js";
import { openDeleteRouteModal } from "../components/deleteRouteModal.js";
import { showToast } from "../components/toast.js";
import { escapeHtml, dismissOverlay } from "../utils.js";

export function openRouteDetail(routeId, { onClose, onChanged } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);

  // Resets each time the drawer is opened — this just guards against
  // mashing the button right after a send, not a permanent "already sent"
  // lock (repeat sends on another visit are still allowed).
  let justSent = false;
  let sentClickCount = 0;
  let editingGrade = false;

  // Tag votes are applied to this in-memory copy immediately (so clicking
  // +1/-1 feels instant and never re-fetches/re-renders the whole drawer),
  // and only sent to the server in one batch when the user commits to
  // something — closing the drawer or logging a send — via flushPendingVotes.
  let currentTagDetails = [];
  const pendingVotes = new Map(); // tagId -> { original, local }

  function applyPendingOverride(t) {
    const entry = pendingVotes.get(t.tagId);
    if (!entry) return;
    const wasVoted = t.myVote !== 0;
    const isVoted = entry.local !== 0;
    t.score += entry.local - t.myVote;
    if (!wasVoted && isVoted) t.votes += 1;
    else if (wasVoted && !isVoted) t.votes -= 1;
    t.myVote = entry.local;
  }

  function toggleTagVote(t, requestedVote) {
    if (!pendingVotes.has(t.tagId)) pendingVotes.set(t.tagId, { original: t.myVote, local: t.myVote });
    const entry = pendingVotes.get(t.tagId);
    const newLocal = entry.local === requestedVote ? 0 : requestedVote;
    const wasVoted = entry.local !== 0;
    const isVoted = newLocal !== 0;
    t.score += newLocal - entry.local;
    if (!wasVoted && isVoted) t.votes += 1;
    else if (wasVoted && !isVoted) t.votes -= 1;
    t.myVote = newLocal;
    entry.local = newLocal;
    if (entry.local === entry.original) pendingVotes.delete(t.tagId);
  }

  async function flushPendingVotes() {
    if (!pendingVotes.size) return;
    const entries = [...pendingVotes.entries()];
    pendingVotes.clear();
    await Promise.all(entries.map(([tagId, { original, local }]) =>
      voteTag(routeId, tagId, local === 0 ? original : local).catch(() => {})
    ));
  }

  function wireTagVoteButtons() {
    backdrop.querySelectorAll("[data-vote-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tagId = btn.getAttribute("data-vote-tag");
        const requestedVote = Number(btn.getAttribute("data-vote-value"));
        const t = currentTagDetails.find((x) => x.tagId === tagId);
        if (!t) return;
        toggleTagVote(t, requestedVote);
        renderTagsOnly();
      });
    });
  }

  function renderTagsOnly() {
    const container = backdrop.querySelector("#rd-tags");
    if (!container) return;
    container.innerHTML = currentTagDetails.length
      ? currentTagDetails.map((t) => tagRow(t)).join("")
      : `<div class="page-sub">No tags yet — be the first to add one.</div>`;
    wireTagVoteButtons();
  }

  function close() {
    flushPendingVotes();
    dismissOverlay(backdrop);
    document.removeEventListener("keydown", escHandler);
    onClose?.();
  }

  function escHandler(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", escHandler);

  // Friends' logs are fetched individually. Friends with a private log are
  // skipped up front (the endpoint would 403 anyway) rather than contributing
  // nothing to this section after a failed request.
  async function getFriendsWhoSent() {
    let friends = [];
    try { friends = await getAcceptedFriends(); } catch { return []; }
    const results = await Promise.all(friends.filter((f) => f.privacy?.logPublic).map(async (f) => {
      try {
        const log = await getLogEntries(f.id);
        return log.some((e) => e.routeId === routeId) ? f : null;
      } catch { return null; }
    }));
    return results.filter(Boolean);
  }

  async function render() {
    let detail;
    try {
      detail = await getRouteDetail(routeId);
    } catch {
      close();
      return;
    }
    const { route, tagDetails, communityGrade, gradeDistribution, finishes, mySends, myEstimate } = detail;
    currentTagDetails = tagDetails;
    currentTagDetails.forEach(applyPendingOverride);
    const media = await getCombinedMedia(routeId);
    const label = routeLabel(route);
    const hasEstimates = gradeDistribution.some((c) => c > 0);
    const linkedTagIds = new Set(route.tags);
    const availableTags = (await getAllTags()).filter((t) => !linkedTagIds.has(t.id));
    const alreadySent = justSent || mySends > 0;
    const friendsSent = await getFriendsWhoSent();

    backdrop.innerHTML = `
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Route details for ${escapeHtml(label)}">
        <div class="drawer-handle"></div>
        <div class="drawer-header">
          <div class="route-title-row" style="width:100%">
            <h2>${escapeHtml(label)}</h2>
            <button class="icon-btn" style="background:#efece5;color:#1b1d21" id="rd-close" aria-label="Close">X</button>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="hold-dot" style="background:${HOLD_COLOR_HEX[route.holdColor]}"></span>
          <strong>${route.holdColor}</strong> · ${route.holdType}
          ${!route.active ? '<span class="badge-soft" style="margin-left:6px;">Retired</span>' : ""}
        </div>
        <div class="page-sub">${finishes} recorded finish${finishes === 1 ? "" : "es"}${mySends ? ` · you've sent this ${mySends}×` : ""}</div>

        <div class="grade-badges">
          <div class="grade-badge">
            <div class="g-label">Official Grade</div>
            <div class="g-value">${formatGrade(route.officialGrade)}</div>
          </div>
          <div class="grade-badge">
            <div class="g-label">Community Estimate</div>
            <div class="g-value">${communityGrade === null ? "—" : formatEstimate(communityGrade)}</div>
          </div>
        </div>

        <div class="section-title">Grade Distribution</div>
        ${hasEstimates ? `<div class="chart-box small"><canvas id="rd-donut"></canvas></div>` : `<div class="empty-state" style="padding:16px;"><div>No community estimate yet</div></div>`}

        <div id="rd-grade-section">${gradeSectionHTML(route)}</div>

        <div class="section-title">Submit Your Estimate</div>
        <form class="estimate-form" id="rd-estimate-form">
          <select name="grade" aria-label="Your grade estimate">
            ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${myEstimate === g ? "selected" : ""}>V${g}</option>`).join("")}
          </select>
          <button class="btn btn-outline btn-sm" type="submit">${myEstimate !== null && myEstimate !== undefined ? "Update Estimate" : "Submit Estimate"}</button>
        </form>

        <div class="section-title">Route Tags</div>
        <div id="rd-tags">
          ${currentTagDetails.length ? currentTagDetails.map((t) => tagRow(t)).join("") : `<div class="page-sub">No tags yet — be the first to add one.</div>`}
        </div>
        <div class="add-tag-row">
          <select id="rd-tag-select">
            <option value="">Add existing tag…</option>
            ${availableTags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
          </select>
          <button class="btn btn-outline btn-sm" id="rd-add-tag-btn">Add</button>
        </div>
        <div class="add-tag-row">
          <input type="text" id="rd-new-tag-input" placeholder="Or propose a new tag…" />
          <button class="btn btn-outline btn-sm" id="rd-new-tag-btn">Add</button>
        </div>

        <div class="section-title">Gallery</div>
        ${media.length ? `
          <div class="gallery-preview-row">
            ${media.slice(0, 4).map((m) => `
              <div class="gallery-preview-thumb">
                ${m.isLocal ? `<span class="gallery-lock" title="Private — only on this device">PRIVATE</span>` : ""}
                ${m.type === "video" ? `<video src="${m.url}" muted></video><span class="gallery-play">PLAY</span>` : `<img src="${m.url}" alt=""/>`}
              </div>
            `).join("")}
          </div>
          <button class="btn btn-outline btn-sm btn-block" id="rd-view-gallery" style="margin-top:8px;">View Gallery (${media.length})</button>
        ` : `<div class="page-sub">No photos or videos yet — attach one next time you log a send.</div>`}

        <div class="log-send-bar">
          <button class="btn ${alreadySent ? "btn-success" : "btn-primary"} btn-block" id="rd-log-send" ${!route.active ? "disabled" : ""} style="${alreadySent ? "cursor:default;" : ""}">
            ${alreadySent ? "SENT!" : "Log Send"}
          </button>
        </div>

        <div class="section-title">Friends Who've Sent This</div>
        ${friendsSent.length
          ? `<div class="chip-row">${friendsSent.map((f) => `<span class="chip">${escapeHtml(f.name)}</span>`).join("")}</div>`
          : `<div class="page-sub">None of your friends have sent this yet.</div>`}

        <button class="btn btn-danger btn-block" id="rd-delete-route" style="margin-top:20px;">Delete This Climb</button>
      </div>
    `;

    if (hasEstimates) {
      const labels = gradeDistribution.map((c, g) => `V${g}`).filter((_, g) => gradeDistribution[g] > 0);
      const data = gradeDistribution.filter((c) => c > 0);
      renderDonutChart(backdrop.querySelector("#rd-donut"), labels, data);
    }

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#rd-close").addEventListener("click", close);
    backdrop.querySelector("#rd-view-gallery")?.addEventListener("click", () => openFullGallery(routeId, label));

    backdrop.querySelector("#rd-estimate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const grade = Number(new FormData(e.target).get("grade"));
      await submitGradeEstimate(routeId, grade);
      onChanged?.();
      render();
    });

    wireGradeSection(route);

    backdrop.querySelector("#rd-delete-route").addEventListener("click", () => {
      openDeleteRouteModal(routeId, label, {
        onDeleted: () => { onChanged?.(); close(); },
      });
    });

    wireTagVoteButtons();

    backdrop.querySelector("#rd-add-tag-btn").addEventListener("click", async () => {
      const select = backdrop.querySelector("#rd-tag-select");
      const opt = select.selectedOptions[0];
      if (!select.value || !opt) return;
      await addTagToRoute(routeId, opt.textContent);
      await voteTag(routeId, select.value, 1);
      render();
    });

    backdrop.querySelector("#rd-new-tag-btn").addEventListener("click", async () => {
      const input = backdrop.querySelector("#rd-new-tag-input");
      const name = input.value.trim();
      if (!name) return;
      const tag = await addTagToRoute(routeId, name);
      await voteTag(routeId, tag.id, 1);
      render();
    });

    backdrop.querySelector("#rd-log-send").addEventListener("click", () => {
      if (alreadySent) {
        flushPendingVotes();
        sentClickCount += 1;
        if (sentClickCount >= 3) showToast("You can delete sends in the climbing log", { small: true });
        return;
      }
      openLogSendSheet(routeId, label, {
        onLogged: async () => { await flushPendingVotes(); justSent = true; onChanged?.(); render(); },
      });
    });
  }

  function gradeSectionHTML(route) {
    return `
      <button class="btn btn-outline btn-sm btn-block" id="rd-grade-toggle" style="margin-top:10px;">
        ${route.officialGrade === null || route.officialGrade === undefined ? "+ Add Official Grade" : "Change Official Grade"}
      </button>
      ${editingGrade ? `
        <form class="estimate-form" id="rd-grade-form" style="margin-top:8px;">
          <select name="grade" aria-label="Official grade">
            <option value="">Ungraded</option>
            ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${route.officialGrade === g ? "selected" : ""}>V${g}</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
        </form>
      ` : ""}
    `;
  }

  // Toggling the edit form is a local UI change, not a real update — it
  // shouldn't re-fetch/re-render the whole drawer. Only the actual grade
  // submit (below) does that, since the route data really changed then.
  function wireGradeSection(route) {
    const section = backdrop.querySelector("#rd-grade-section");
    section.querySelector("#rd-grade-toggle").addEventListener("click", () => {
      editingGrade = !editingGrade;
      section.innerHTML = gradeSectionHTML(route);
      wireGradeSection(route);
    });
    section.querySelector("#rd-grade-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = new FormData(e.target).get("grade");
      await updateRoute(routeId, { officialGrade: val === "" ? null : Number(val) });
      editingGrade = false;
      onChanged?.();
      render();
    });
  }

  function tagRow(t) {
    return `
      <div class="tag-row">
        <div>
          <div class="tag-name">${escapeHtml(t.name)}</div>
          <div class="tag-score">Score ${t.score >= 0 ? "+" : ""}${t.score} · ${t.votes} vote${t.votes === 1 ? "" : "s"}</div>
        </div>
        <div class="vote-btns">
          <button class="vote-btn ${t.myVote === 1 ? "active-up" : ""}" data-vote-tag="${t.tagId}" data-vote-value="1" aria-label="Thumbs up ${escapeHtml(t.name)}">+1</button>
          <button class="vote-btn ${t.myVote === -1 ? "active-down" : ""}" data-vote-tag="${t.tagId}" data-vote-value="-1" aria-label="Thumbs down ${escapeHtml(t.name)}">-1</button>
        </div>
      </div>
    `;
  }

  render();
}
