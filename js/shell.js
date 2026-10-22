import { getCurrentUser, getGyms, getCurrentGymId, setCurrentGym } from "./data/api.js";
import { renderGymMap } from "./views/gymMap.js";
import { renderClimbingLog } from "./views/climbingLog.js";
import { renderProfile } from "./views/profile.js";
import { renderFriends } from "./views/friends.js";
import { renderAdmin, renderAdminUserLog } from "./views/admin.js";
import { renderGymStats } from "./views/gymStats.js";
import { isAdminUnlocked } from "./adminAuth.js";
import { initials } from "./utils.js";
import { applyAccent } from "./accent.js";

const ICON_MOUNTAIN = `<img src="/assets/icons/nav-gym-map.svg" alt="" width="32" height="32"/>`;
const ICON_BOOK = `<img src="/assets/icons/nav-climbing-log.svg" alt="" width="32" height="32"/>`;
const ICON_SMILEY = `<img src="/assets/icons/nav-profile.svg" alt="" width="32" height="32"/>`;
const ICON_FRIENDS = `<img src="/assets/icons/nav-friends.svg" alt="" width="32" height="32"/>`;
const ICON_EYE = `<img src="/assets/icons/nav-admin.svg" alt="" width="32" height="32"/>`;

const NAV_ITEMS = [
  { hash: "#/map", label: "Gym Map", icon: ICON_MOUNTAIN },
  { hash: "#/log", label: "Climbing Log", icon: ICON_BOOK },
  { hash: "#/friends", label: "Friends", icon: ICON_FRIENDS },
  { hash: "#/profile", label: "Profile", icon: ICON_SMILEY },
];

function currentBase(hash) {
  if (hash.startsWith("#/admin")) return "#/admin";
  if (hash.startsWith("#/friends")) return "#/friends";
  if (hash.startsWith("#/log")) return "#/log";
  if (hash.startsWith("#/profile")) return "#/profile";
  return "#/map";
}

function navLinksHTML(active) {
  const items = isAdminUnlocked() ? [...NAV_ITEMS, { hash: "#/admin", label: "Admin", icon: ICON_EYE }] : NAV_ITEMS;
  return items.map(
    (item) => `<a href="${item.hash}" class="${active === item.hash ? "active" : ""}">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`
  ).join("");
}

export async function renderShell(root) {
  const user = getCurrentUser();
  applyAccent(user.accentColor);
  const gyms = await getGyms();
  const gymId = getCurrentGymId() || gyms[0]?.id;

  root.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <a href="#/map" class="brand" id="brand-text" style="text-decoration:none;">MATCHBOOK</a>
        <select class="gym-select" id="gym-select" aria-label="Select gym">
          ${gyms.map((g) => `<option value="${g.id}" ${g.id === gymId ? "selected" : ""}>${g.name}</option>`).join("")}
        </select>
        <div class="topbar-actions">
          <a href="#/profile" class="avatar sm" style="text-decoration:none;" aria-label="Profile">${user.profilePicture ? `<img src="${user.profilePicture}" alt=""/>` : initials(user.name)}</a>
        </div>
      </div>
      <div class="desktop-shell">
        <nav class="sidebar" id="sidebar">${navLinksHTML(currentBase(location.hash))}</nav>
        <div class="content-area" id="content-area"></div>
      </div>
      <nav class="bottom-nav" id="bottom-nav">${navLinksHTML(currentBase(location.hash))}</nav>
    </div>
  `;

  root.querySelector("#gym-select").addEventListener("change", async (e) => {
    await setCurrentGym(e.target.value);
    renderRoute();
  });

  const contentArea = root.querySelector("#content-area");
  let activeCleanup = null;

  function applyRoute() {
    if (typeof activeCleanup === "function") activeCleanup();
    activeCleanup = null;

    const hash = location.hash || "#/map";
    root.querySelector("#sidebar").innerHTML = navLinksHTML(currentBase(hash));
    root.querySelector("#bottom-nav").innerHTML = navLinksHTML(currentBase(hash));
    root.querySelector("#brand-text").textContent = isAdminUnlocked() ? "MATCHBOOK - ADMIN" : "MATCHBOOK";
    const activeGymId = getCurrentGymId();

    let result;
    if (hash.startsWith("#/friends/")) {
      const rest = hash.slice("#/friends/".length);
      const [friendId, sub] = rest.split("/");
      result = renderFriends(contentArea, { friendId, showLog: sub === "log" });
    } else if (hash.startsWith("#/friends")) {
      result = renderFriends(contentArea, {});
    } else if (hash.startsWith("#/log")) {
      result = renderClimbingLog(contentArea, getCurrentUser().id, { title: "Climbing Log", canGoBack: false });
    } else if (hash.startsWith("#/profile")) {
      result = renderProfile(contentArea);
    } else if (hash.startsWith("#/admin")) {
      if (!isAdminUnlocked()) { location.hash = "#/map"; return; }
      const logMatch = hash.match(/^#\/admin\/users\/([^/]+)\/log$/);
      result = logMatch ? renderAdminUserLog(contentArea, logMatch[1]) : renderAdmin(contentArea);
    } else if (hash.startsWith("#/stats")) {
      result = renderGymStats(contentArea, activeGymId); // async; nothing to clean up
    } else {
      result = renderGymMap(contentArea, activeGymId);
    }
    if (typeof result === "function") activeCleanup = result;
  }

  // Crossfades old/new page content on every tab switch — the native
  // View Transitions API handles the before/after snapshotting itself,
  // no manual fade-out/fade-in choreography needed. Browsers without it
  // (a small minority) just get the instant swap as before.
  function renderRoute() {
    if (document.startViewTransition) {
      // .ready rejects (AbortError) when a transition is superseded by a
      // newer one — expected on a fast double tap between tabs, not a bug.
      document.startViewTransition(applyRoute).ready.catch(() => {});
    } else {
      applyRoute();
    }
  }

  window.addEventListener("hashchange", renderRoute);
  // Setting location.hash below fires "hashchange" itself, which would
  // call renderRoute() a second time (and, with view transitions, made the
  // first one visibly abort) if this also called it unconditionally.
  if (!location.hash) location.hash = "#/map";
  else renderRoute();
}
