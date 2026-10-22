import {
  getUser, getIncomingRequests,
  sendFriendRequest, respondToRequest, removeFriend, computeUserStats, relationshipWith,
} from "../data/api.js";
import { formatGrade } from "../data/constants.js";
import { escapeHtml, initials } from "../utils.js";
import { renderClimbingLog } from "./climbingLog.js";
import { renderChat } from "./chat.js";
import { showToast } from "../components/toast.js";

// The Friends tab itself is the two-pane chat (chat.js); this file keeps a friend's
// profile page and their shared climbing log.
export function renderFriends(container, { friendId, showLog, chatId } = {}) {
  if (friendId && showLog) return renderFriendLog(container, friendId);
  if (friendId) return renderFriendProfile(container, friendId);
  return renderChat(container, chatId);
}

function renderFriendProfile(container, friendId) {
  async function render() {
    container.innerHTML = `<div class="page"><div class="empty-state card">Loading…</div></div>`;
    let user;
    try { user = await getUser(friendId); } catch {
      container.innerHTML = `<div class="page"><div class="empty-state card">Climber not found.</div></div>`;
      return;
    }

    const rel = await relationshipWith(friendId);
    const relationship = typeof rel === "string" ? rel : rel.status;
    const canSeeFull = relationship === "accepted" || user.privacy.profilePublic;
    const stats = canSeeFull ? await computeUserStats(user.id).catch(() => null) : null;

    let actionHTML = "";
    if (relationship === "none") actionHTML = `<button class="btn btn-primary btn-sm" id="add-friend-btn">Add Friend</button>`;
    else if (relationship === "outgoing") actionHTML = `<span class="chip">Request Pending</span>`;
    else if (relationship === "incoming") actionHTML = `<button class="btn btn-primary btn-sm" id="accept-btn">Accept Request</button>`;
    else actionHTML = `<button class="btn btn-outline btn-sm" id="remove-friend-btn">Remove Friend</button>`;

    container.innerHTML = `
      <div class="page">
        <a href="#/friends" class="btn btn-ghost btn-sm" style="padding-left:0;">Back to Friends</a>
        <div class="card card-pad section-block">
          <div class="profile-header">
            <div class="avatar">${user.profilePicture ? `<img src="${user.profilePicture}" alt=""/>` : initials(user.name)}</div>
            <div>
              <h1>${escapeHtml(user.name)}</h1>
              <div class="sub">${canSeeFull ? escapeHtml(user.hometown || "Hometown not set") : "Profile is private"}</div>
            </div>
          </div>
          <div style="margin-top:10px;">${actionHTML}</div>
        </div>

        ${!canSeeFull || !stats ? `<div class="empty-state card"><div>${escapeHtml(user.name)} has set their profile to private.</div></div>` : `
          <div class="two-col section-block">
            <div class="card card-pad">
              <div class="info-list">
                <div class="info-row"><span class="k">Age</span><span class="v">${user.age ?? "—"}</span></div>
                <div class="info-row"><span class="k">Favorite Hold Type</span><span class="v">${escapeHtml(user.favoriteHoldType) || "—"}</span></div>
                <div class="info-row"><span class="k">Self-Reported Highest Grade</span><span class="v">${user.selfReportedHighestGrade !== null && user.selfReportedHighestGrade !== undefined ? formatGrade(user.selfReportedHighestGrade) : "—"}</span></div>
              </div>
            </div>
            <div class="card card-pad">
              <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);">
                <div class="stat-tile"><div class="stat-value">${stats.totalClimbs + (stats.rope?.totalClimbs || 0)}</div><div class="stat-label">Total Climbs</div></div>
                <div class="stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade)}</div><div class="stat-label">${stats.rope?.totalClimbs ? "Highest Boulder Grade" : "Highest Grade"}</div></div>
                ${stats.rope?.totalClimbs ? `<div class="stat-tile"><div class="stat-value">${stats.rope.highestGrade === null ? "—" : formatGrade(stats.rope.highestGrade, "rope")}</div><div class="stat-label">Highest Rope Grade</div></div>` : ""}
                <div class="stat-tile" style="grid-column:1/-1;"><div class="stat-value">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
              </div>
              ${relationship === "accepted" && user.privacy.logPublic ? `<a href="#/friends/${user.id}/log" class="btn btn-primary btn-block" style="margin-top:12px;">View Climbing Log</a>` :
                `<div class="page-sub" style="margin-top:12px;">${relationship === "accepted" ? "This climber's log is private." : "Add as a friend to see their climbing log."}</div>`}
            </div>
          </div>
        `}
      </div>
    `;

    container.querySelector("#add-friend-btn")?.addEventListener("click", async () => { await sendFriendRequest(friendId); showToast("Friend request sent"); render(); });
    container.querySelector("#accept-btn")?.addEventListener("click", async () => {
      const incoming = await getIncomingRequests();
      const inc = incoming.find((i) => i.user.id === friendId);
      if (inc) await respondToRequest(inc.friendship.id, true);
      showToast("Friend added");
      render();
    });
    container.querySelector("#remove-friend-btn")?.addEventListener("click", async () => { await removeFriend(friendId); location.hash = "#/friends"; });
  }

  render();
}

function renderFriendLog(container, friendId) {
  container.innerHTML = `<div class="page"><div class="empty-state card">Loading…</div></div>`;

  (async () => {
    let user;
    try { user = await getUser(friendId); } catch { user = null; }
    const rel = user ? await relationshipWith(friendId) : "none";
    const relationship = typeof rel === "string" ? rel : rel.status;
    if (!user || relationship !== "accepted" || !user.privacy.logPublic) {
      container.innerHTML = `<div class="page"><a href="#/friends" class="btn btn-ghost btn-sm" style="padding-left:0;">Back to Friends</a><div class="empty-state card"><div>This climbing log isn't available to view.</div></div></div>`;
      return;
    }
    renderClimbingLog(container, friendId, { title: `${user.name}'s Climbing Log`, canGoBack: true, backHash: `#/friends/${friendId}` });
  })();
}
