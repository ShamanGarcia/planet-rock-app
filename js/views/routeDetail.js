import {
  getRouteDetail, voteTag, addTagToRoute, getAllTags, submitGradeEstimate,
} from "../data/api.js";
import { formatGrade, formatEstimate, MAX_GRADE, HOLD_COLOR_HEX, routeLabel } from "../data/constants.js";
import { generateRoutePhotoSVG } from "../components/routePhoto.js";
import { renderDonutChart } from "../components/charts.js";
import { openLogSendSheet } from "../components/logSendSheet.js";
import { openFullGallery } from "../components/gallery.js";
import { escapeHtml } from "../utils.js";

export function openRouteDetail(routeId, { onClose, onChanged } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
    document.removeEventListener("keydown", escHandler);
    onClose?.();
  }

  function escHandler(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", escHandler);

  async function render() {
    let detail;
    try {
      detail = await getRouteDetail(routeId);
    } catch {
      close();
      return;
    }
    const { route, tagDetails, communityGrade, gradeDistribution, finishes, mySends, myEstimate, media } = detail;
    const label = routeLabel(route);
    const hasEstimates = gradeDistribution.some((c) => c > 0);
    const linkedTagIds = new Set(route.tags);
    const availableTags = (await getAllTags()).filter((t) => !linkedTagIds.has(t.id));

    backdrop.innerHTML = `
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Route details for ${escapeHtml(label)}">
        <div class="drawer-handle"></div>
        <div class="drawer-header">
          <div class="route-title-row" style="width:100%">
            <h2>${escapeHtml(label)}</h2>
            <button class="icon-btn" style="background:#efece5;color:#1b1d21" id="rd-close" aria-label="Close">✕</button>
          </div>
        </div>

        <div class="route-photo" id="rd-photo"></div>

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
            ${media.slice(0, 4).map((m) => m.type === "video"
              ? `<div class="gallery-preview-thumb"><video src="${m.url}" muted></video><span class="gallery-play">▶</span></div>`
              : `<div class="gallery-preview-thumb"><img src="${m.url}" alt=""/></div>`
            ).join("")}
          </div>
          <button class="btn btn-outline btn-sm btn-block" id="rd-view-gallery" style="margin-top:8px;">🖼 View Gallery (${media.length})</button>
        ` : `<div class="page-sub">No photos or videos yet — attach one next time you log a send.</div>`}

        <div class="log-send-bar">
          <button class="btn btn-primary btn-block" id="rd-log-send" ${!route.active ? "disabled" : ""}>
            🧗 Log Send
          </button>
        </div>
      </div>
    `;

    backdrop.querySelector("#rd-photo").innerHTML = route.photoUrl
      ? `<img src="${route.photoUrl}" alt="Photo of ${escapeHtml(label)}" style="width:100%;height:100%;object-fit:cover;"/>`
      : generateRoutePhotoSVG(route);
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
        await voteTag(routeId, tagId, vote);
        render();
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
      openLogSendSheet(routeId, label, {
        onLogged: () => { onChanged?.(); render(); },
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
          <button class="vote-btn ${t.myVote === 1 ? "active-up" : ""}" data-vote-tag="${t.tagId}" data-vote-value="1" aria-label="Thumbs up ${escapeHtml(t.name)}">👍</button>
          <button class="vote-btn ${t.myVote === -1 ? "active-down" : ""}" data-vote-tag="${t.tagId}" data-vote-value="-1" aria-label="Thumbs down ${escapeHtml(t.name)}">👎</button>
        </div>
      </div>
    `;
  }

  render();
}
