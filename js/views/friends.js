import {
  getUser, getAcceptedFriends, getIncomingRequests, getOutgoingRequests,
  sendFriendRequest, respondToRequest, removeFriend, searchUsers, computeUserStats, relationshipWith,
} from "../data/api.js";
import { formatGrade } from "../data/constants.js";
import { escapeHtml, initials } from "../utils.js";
import { renderClimbingLog } from "./climbingLog.js";
import { showToast } from "../components/toast.js";

export function renderFriends(container, { friendId, showLog } = {}) {
  if (friendId && showLog) return renderFriendLog(container, friendId);
  if (friendId) return renderFriendProfile(container, friendId);
  return renderFriendsList(container);
}

async function friendCard(user, { actionsHTML }) {
  let stats = { highestGrade: null, totalClimbs: 0 };
  try { stats = await computeUserStats(user.id); } catch { /* private/unreachable, show minimal card */ }
  return `
    <div class="card friend-card">
      <div class="avatar sm">${user.profilePicture ? `<img src="${user.profilePicture}" alt=""/>` : initials(user.name)}</div>
      <div class="fc-body">
        <div class="fc-name">${escapeHtml(user.name)}</div>
        <div class="fc-meta">${stats.highestGrade === null ? "No sends yet" : `Highest grade: ${formatGrade(stats.highestGrade)}`} · ${stats.totalClimbs} climbs</div>
      </div>
      ${actionsHTML}
    </div>
  `;
}

function renderFriendsList(container) {
  let query = "";
  let loading = true;

  async function render() {
    container.innerHTML = `
      <div class="page">
        <div class="page-header"><h1>Friends</h1><div class="page-sub" id="friend-count"></div></div>
        <div class="friend-search-row">
          <input type="text" id="friend-search" placeholder="Find climbers by name or email…" value="${escapeHtml(query)}"/>
        </div>
        <div id="friends-content"><div class="empty-state card">Loading…</div></div>
      </div>
    `;
    container.querySelector("#friend-search").addEventListener("input", (e) => { query = e.target.value; renderContent(); });

    await renderContent();
  }

  async function renderContent() {
    const content = container.querySelector("#friends-content");
    const [friends, incoming, outgoing] = await Promise.all([getAcceptedFriends(), getIncomingRequests(), getOutgoingRequests()]);
    const results = query ? await searchUsers(query) : [];
    container.querySelector("#friend-count").textContent = `${friends.length} friend${friends.length === 1 ? "" : "s"}`;

    function searchActionHTML(u) {
      if (friends.some((f) => f.id === u.id)) return `<span class="chip">Friends</span>`;
      if (outgoing.some((o) => o.user.id === u.id)) return `<span class="chip">Pending</span>`;
      const inReq = incoming.find((i) => i.user.id === u.id);
      if (inReq) return `<button class="btn btn-primary btn-sm" data-accept="${inReq.friendship.id}">Accept</button>`;
      return `<button class="btn btn-outline btn-sm" data-add="${u.id}">Add Friend</button>`;
    }

    const resultsHTML = results.length ? (await Promise.all(results.map((u) => friendCard(u, { actionsHTML: searchActionHTML(u) })))).join("") : "";
    const friendsHTML = friends.length === 0
      ? `<div class="empty-state card"><div>Search above to add your first climbing friend.</div></div>`
      : (await Promise.all(friends.map((f) => friendCard(f, {
          actionsHTML: `<div style="display:flex;flex-direction:column;gap:6px;"><button class="btn btn-outline btn-sm" data-view="${f.id}">View Profile</button></div>`,
        })))).join("");

    content.innerHTML = `
      ${results.length ? `<div class="section-block"><div class="section-title" style="margin-top:0;">Search Results</div>${resultsHTML}</div>` : ""}

      ${incoming.length ? `
        <div class="section-block">
          <div class="section-title" style="margin-top:0;">Friend Requests</div>
          ${incoming.map(({ friendship, user }) => `
            <div class="card friend-card">
              <div class="avatar sm">${initials(user.name)}</div>
              <div class="fc-body"><div class="fc-name">${escapeHtml(user.name)}</div><div class="fc-meta">Wants to be your climbing friend</div></div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-primary btn-sm" data-accept="${friendship.id}">Accept</button>
                <button class="btn btn-outline btn-sm" data-decline="${friendship.id}">Decline</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${outgoing.length ? `
        <div class="section-block">
          <div class="section-title" style="margin-top:0;">Pending Requests You Sent</div>
          ${outgoing.map(({ user }) => `<div class="card friend-card"><div class="avatar sm">${initials(user.name)}</div><div class="fc-body"><div class="fc-name">${escapeHtml(user.name)}</div><div class="fc-meta">Request pending</div></div></div>`).join("")}
        </div>
      ` : ""}

      <div class="section-block">
        <div class="section-title" style="margin-top:0;">Your Friends</div>
        ${friendsHTML}
      </div>
    `;

    content.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => { location.hash = `#/friends/${btn.getAttribute("data-view")}`; }));
    content.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", async () => {
      await sendFriendRequest(btn.getAttribute("data-add"));
      showToast("Friend request sent");
      renderContent();
    }));
    content.querySelectorAll("[data-accept]").forEach((btn) => btn.addEventListener("click", async () => {
      await respondToRequest(btn.getAttribute("data-accept"), true);
      showToast("Friend added");
      renderContent();
    }));
    content.querySelectorAll("[data-decline]").forEach((btn) => btn.addEventListener("click", async () => {
      await respondToRequest(btn.getAttribute("data-decline"), false);
      renderContent();
    }));
  }

  render();
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
                <div class="stat-tile"><div class="stat-value">${stats.totalClimbs}</div><div class="stat-label">Total Climbs</div></div>
                <div class="stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade)}</div><div class="stat-label">Highest Grade</div></div>
                <div class="stat-tile" style="grid-column:1/-1;"><div class="stat-value" style="font-size:14px;">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
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
