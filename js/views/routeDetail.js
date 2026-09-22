import {
  getRouteDetail, addTagToRoute, getAllTags, submitGradeEstimate,
  getAcceptedFriends, updateRoute, deleteRoute, getCurrentUser,
} from "../data/api.js";
import { formatGrade, formatEstimate, MAX_GRADE, HOLD_COLOR_HEX, HOLD_COLOR_TEXT, routeLabel } from "../data/constants.js";
import { renderDonutChart } from "../components/charts.js";
import { openLogSendSheet } from "../components/logSendSheet.js";
import { openFullGallery, getCombinedMedia } from "../components/gallery.js";
import { openPasswordPromptModal } from "../components/passwordPromptModal.js";
import { showToast } from "../components/toast.js";
import { escapeHtml, dismissOverlay } from "../utils.js";

// Same shared-password pattern as resetWallModal's ROUTESETTER_KEY, scoped
// to pulling a single climb off the map entirely.
const DELETE_PASSWORD = "TAKEAWAY";

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

  // Every sender with a public log shows up here (not just friends) —
  // friends are just sorted to the top, and the current user is excluded
  // since their own status is already shown via the Log Send button.
  async function getClimbersWhoSent(senders) {
    const me = getCurrentUser();
    let friendIds = new Set();
    try { friendIds = new Set((await getAcceptedFriends()).map((f) => f.id)); } catch { /* no friends list available */ }
    return senders
      .filter((s) => s.id !== me?.id)
      .sort((a, b) => {
        const aFriend = friendIds.has(a.id), bFriend = friendIds.has(b.id);
        if (aFriend !== bFriend) return aFriend ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  async function render() {
    let detail;
    try {
      detail = await getRouteDetail(routeId);
    } catch {
      close();
      return;
    }
    const { route, tagDetails, communityGrade, gradeDistribution, mySends, myEstimate, senders } = detail;
    const media = await getCombinedMedia(routeId);
    const label = routeLabel(route);
    const hasEstimates = gradeDistribution.some((c) => c > 0);
    const linkedTagIds = new Set(route.tags);
    const availableTags = (await getAllTags())
      .filter((t) => !linkedTagIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const alreadySent = justSent || mySends > 0;
    const climbersSent = await getClimbersWhoSent(senders);

    backdrop.innerHTML = `
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Route details for ${escapeHtml(label)}">
        <div class="drawer-handle"></div>
        <div class="drawer-header">
          <div class="route-title-row" style="width:100%; justify-content:flex-end; gap:8px;">
            ${!route.active ? '<span class="badge-soft">Retired</span>' : ""}
            <button class="icon-btn" style="background:#efece5;color:#1b1d21" id="rd-close" aria-label="Close">X</button>
          </div>
        </div>

        ${mySends ? `<div class="page-sub">You've sent this ${mySends}×</div>` : ""}

        <div class="grade-badges">
          <div class="grade-badge" style="background:${HOLD_COLOR_HEX[route.holdColor]};color:${HOLD_COLOR_TEXT[route.holdColor]};">
            <div class="g-label">Official Grade</div>
            <div class="g-value">${formatGrade(route.officialGrade)}</div>
          </div>
          <button type="button" class="grade-badge" id="rd-community-badge" aria-label="View grade distribution">
            <div class="g-label">Community Estimate</div>
            <div class="g-value">${communityGrade === null ? "—" : formatEstimate(communityGrade)}</div>
            <div class="g-hint">*click for details</div>
          </button>
        </div>

        <div class="section-title">Grade</div>
        <div class="estimate-form">
          <div class="grade-control-col">
            <label class="g-label" for="rd-official-grade-select">Official Grade</label>
            <select id="rd-official-grade-select" aria-label="Official grade">
              <option value="">Ungraded</option>
              ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${route.officialGrade === g ? "selected" : ""}>V${g}</option>`).join("")}
            </select>
          </div>
          <form id="rd-estimate-form" style="display:contents;">
            <div class="grade-control-col">
              <label class="g-label" for="rd-estimate-select">Estimated Grade</label>
              <select id="rd-estimate-select" name="grade" aria-label="Your grade estimate">
                ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${myEstimate === g ? "selected" : ""}>V${g}</option>`).join("")}
              </select>
            </div>
            <button class="btn btn-outline btn-sm" type="submit">${myEstimate !== null && myEstimate !== undefined ? "Update Estimate" : "Submit Estimate"}</button>
          </form>
        </div>

        <div class="section-title">Route Tags</div>
        <div id="rd-tags" class="chip-row">
          ${tagDetails.length ? tagDetails.map((t) => tagRow(t)).join("") : `<div class="page-sub">No tags yet — be the first to add one.</div>`}
        </div>
        <div class="add-tag-row">
          <select id="rd-tag-select">
            <option value="">Add existing tag…</option>
            ${availableTags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
          </select>
          <input type="text" id="rd-new-tag-input" placeholder="Or propose a new tag…" />
          <button class="btn btn-outline btn-sm" id="rd-add-tag-btn">Add</button>
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

        <div class="section-title">Climbers Who've Sent This</div>
        ${climbersSent.length
          ? `<div class="chip-row">${climbersSent.map((c) => `<span class="chip">${escapeHtml(c.name)}</span>`).join("")}</div>`
          : `<div class="page-sub">No one has sent this yet.</div>`}

        <button class="btn btn-danger btn-block" id="rd-delete-route" style="margin-top:20px;">Delete This Climb</button>
      </div>
    `;

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#rd-close").addEventListener("click", close);
    backdrop.querySelector("#rd-view-gallery")?.addEventListener("click", () => openFullGallery(routeId, label));
    backdrop.querySelector("#rd-community-badge").addEventListener("click", () => openGradeDistributionPopup(hasEstimates, gradeDistribution));

    backdrop.querySelector("#rd-estimate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const grade = Number(new FormData(e.target).get("grade"));
      await submitGradeEstimate(routeId, grade);
      onChanged?.();
      render();
    });

    backdrop.querySelector("#rd-official-grade-select").addEventListener("change", async (e) => {
      const val = e.target.value;
      await updateRoute(routeId, { officialGrade: val === "" ? null : Number(val) });
      onChanged?.();
      render();
    });

    backdrop.querySelector("#rd-delete-route").addEventListener("click", () => {
      openPasswordPromptModal({
        title: "Delete this climb?",
        message: `${label} — this removes it from the map for everyone. This can't be undone.`,
        expectedPassword: DELETE_PASSWORD,
        confirmLabel: "DELETE",
        danger: true,
        onConfirm: async (pw) => {
          await deleteRoute(routeId, pw);
          showToast(`Removed ${label} from the map`);
          onChanged?.();
          close();
        },
      });
    });

    backdrop.querySelector("#rd-add-tag-btn").addEventListener("click", async () => {
      const select = backdrop.querySelector("#rd-tag-select");
      const input = backdrop.querySelector("#rd-new-tag-input");
      const opt = select.selectedOptions[0];
      const newName = input.value.trim();
      if (!select.value && !newName) return;
      if (select.value && opt) await addTagToRoute(routeId, opt.textContent);
      if (newName) {
        const allTags = await getAllTags();
        if (allTags.some((t) => t.name.toLowerCase() === newName.toLowerCase())) {
          showToast("Already a tag!");
        } else {
          await addTagToRoute(routeId, newName);
        }
      }
      render();
    });

    backdrop.querySelector("#rd-log-send").addEventListener("click", () => {
      if (alreadySent) {
        sentClickCount += 1;
        if (sentClickCount >= 3) showToast("You can delete sends in the climbing log", { small: true });
        return;
      }
      openLogSendSheet(routeId, label, {
        onLogged: async () => { justSent = true; onChanged?.(); render(); },
      });
    });
  }

  function openGradeDistributionPopup(hasEstimates, gradeDistribution) {
    const popup = document.createElement("div");
    popup.className = "mini-popup-backdrop";
    document.body.appendChild(popup);
    function closePopup() { dismissOverlay(popup); }

    popup.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="Grade distribution">
        <div class="mini-popup-title">Grade Distribution</div>
        ${hasEstimates ? `<div class="chart-box small"><canvas id="rd-donut-popup"></canvas></div>` : `<div class="empty-state" style="padding:16px;"><div>No community estimate yet</div></div>`}
        <button class="btn btn-ghost btn-block" id="rd-dist-close">Close</button>
      </div>
    `;
    popup.addEventListener("click", (e) => { if (e.target === popup) closePopup(); });
    popup.querySelector("#rd-dist-close").addEventListener("click", closePopup);

    if (hasEstimates) {
      const labels = gradeDistribution.map((c, g) => `V${g}`).filter((_, g) => gradeDistribution[g] > 0);
      const data = gradeDistribution.filter((c) => c > 0);
      renderDonutChart(popup.querySelector("#rd-donut-popup"), labels, data);
    }
  }

  function tagRow(t) {
    return `<span class="chip">${escapeHtml(t.name)}</span>`;
  }

  render();
}
