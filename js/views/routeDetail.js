import {
  getRouteDetail, voteTag, addTagToRoute, getAllTags, submitGradeEstimate,
  getAcceptedFriends, getLogEntries,
} from "../data/api.js";
import { formatGrade, formatEstimate, MAX_GRADE, HOLD_COLOR_HEX, routeLabel } from "../data/constants.js";
import { renderDonutChart } from "../components/charts.js";
import { openLogSendSheet } from "../components/logSendSheet.js";
import { openFullGallery, getCombinedMedia } from "../components/gallery.js";
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

  function close() {
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

        <div class="section-title">Submit Your Estimate</div>
        <form class="estimate-form" id="rd-estimate-form">
          <select name="grade" aria-label="Your grade estimate">
            ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${myEstimate === g ? "selected" : ""}>V${g}</option>`).join("")}
          </select>
          <button class="btn btn-outline btn-sm" type="submit">${myEstimate !== null && myEstimate !== undefined ? "Update Estimate" : "Submit Estimate"}</button>
        </form>

        <div class="section-title">Route Tags</div>
        <div id="rd-tags">
          ${tagDetails.length ? tagDetails.map((t) => tagRow(t)).join("") : `<div class="page-sub">No tags yet — be the first to add one.</div>`}
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

    backdrop.querySelectorAll("[data-vote-tag]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tagId = btn.getAttribute("data-vote-tag");
        const vote = Number(btn.getAttribute("data-vote-value"));
        // Show the pressed state immediately instead of waiting on the
        // round trip — the real score still comes from the render() below,
        // this just removes the "did my click register?" delay.
        const row = btn.closest(".vote-btns");
        row.querySelectorAll(".vote-btn").forEach((b) => {
          b.classList.remove("active-up", "active-down");
          b.disabled = true;
        });
        btn.classList.add(vote === 1 ? "active-up" : "active-down");
        try {
          await voteTag(routeId, tagId, vote);
        } finally {
          render();
        }
      });
    });

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
        sentClickCount += 1;
        if (sentClickCount >= 3) showToast("You can delete sends in the climbing log", { small: true });
        return;
      }
      openLogSendSheet(routeId, label, {
        onLogged: () => { justSent = true; onChanged?.(); render(); },
      });
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
