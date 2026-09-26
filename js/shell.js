import { getCurrentUser, getGyms, getCurrentGymId, setCurrentGym } from "./data/api.js";
import { renderGymMap } from "./views/gymMap.js";
import { renderClimbingLog } from "./views/climbingLog.js";
import { renderProfile } from "./views/profile.js";
import { renderFriends } from "./views/friends.js";
import { renderAdmin, renderAdminUserLog } from "./views/admin.js";
import { isAdminUnlocked } from "./adminAuth.js";
import { initials } from "./utils.js";

const ICON_MOUNTAIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 5 L20 19 H4 Z"/></svg>`;
const ICON_BOOK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5c-1.8-1.3-4.7-1.8-7.5-1.3v12c2.8-.5 5.7 0 7.5 1.3 1.8-1.3 4.7-1.8 7.5-1.3v-12c-2.8-.5-5.7 0-7.5 1.3z"/><path d="M12 6.5v12"/></svg>`;
const ICON_SMILEY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="9" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="10.2" r=".9" fill="currentColor" stroke="none"/><path d="M8.3 14.5c1 1.3 2.4 2 3.7 2s2.7-.7 3.7-2"/></svg>`;
const ICON_FRIENDS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8.5" cy="12" r="6"/><circle cx="15.5" cy="12" r="6"/><circle cx="6.7" cy="10.6" r=".7" fill="currentColor" stroke="none"/><circle cx="10" cy="10.6" r=".7" fill="currentColor" stroke="none"/><path d="M6.3 13.8c.6.8 1.4 1.2 2.2 1.2s1.6-.4 2.2-1.2"/><circle cx="13.8" cy="10.6" r=".7" fill="currentColor" stroke="none"/><circle cx="17.1" cy="10.6" r=".7" fill="currentColor" stroke="none"/><path d="M13.4 13.8c.6.8 1.4 1.2 2.2 1.2s1.6-.4 2.2-1.2"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 12c3-5.5 7-8 10-8s7 2.5 10 8c-3 5.5-7 8-10 8s-7-2.5-10-8z"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/></svg>`;

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
