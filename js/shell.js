import { getCurrentUser, getGyms, getCurrentGymId, setCurrentGym } from "./data/api.js";
import { renderGymMap } from "./views/gymMap.js";
import { renderClimbingLog } from "./views/climbingLog.js";
import { renderProfile } from "./views/profile.js";
import { renderFriends } from "./views/friends.js";
import { renderReel } from "./views/reel.js";
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
const ICON_REEL = `<img src="/assets/icons/nav-reel.svg" alt="" width="32" height="32"/>`;

const NAV_ITEMS = [
  { hash: "#/map", label: "Gym Map", icon: ICON_MOUNTAIN },
  { hash: "#/log", label: "Climbing Log", icon: ICON_BOOK },
  { hash: "#/reel", label: "Reel", icon: ICON_REEL },
  { hash: "#/friends", label: "Friends", icon: ICON_FRIENDS },
  { hash: "#/profile", label: "Profile", icon: ICON_SMILEY },
];
const ADMIN_ITEM = { hash: "#/admin", label: "Admin", icon: ICON_EYE, admin: true };

// Six tabs don't fit, so Admin stays collapsed until Profile is tapped; tapping
// Profile again, Admin, or any other tab folds it away. In-memory, like the unlock.
let adminNavOpen = false;

function currentBase(hash) {
  if (hash.startsWith("#/admin")) return "#/profile"; // Admin lives under Profile; its own icon is folded away
  if (hash.startsWith("#/friends")) return "#/friends";
  if (hash.startsWith("#/reel")) return "#/reel";
  if (hash.startsWith("#/log")) return "#/log";
  if (hash.startsWith("#/profile")) return "#/profile";
  return "#/map";
}

function navLinksHTML(active) {
  const items = isAdminUnlocked() ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
  return items.map((item) => {
    const cls = [active === item.hash && "active", item.admin && "nav-admin", item.admin && adminNavOpen && "open"].filter(Boolean).join(" ");
    return `<a href="${item.hash}" class="${cls}">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`;
  }).join("");
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
        <nav class="sidebar" id="sidebar" data-admin="${isAdminUnlocked()}">${navLinksHTML(currentBase(location.hash))}</nav>
        <div class="content-area" id="content-area"></div>
      </div>
      <nav class="bottom-nav" id="bottom-nav" data-admin="${isAdminUnlocked()}">${navLinksHTML(currentBase(location.hash))}</nav>
    </div>
  `;

  // The navs are updated in place (not re-rendered per route) so the Admin
  // icon's expand/fold animates. They are only rebuilt when Admin gets unlocked.
  function syncNav(hash) {
    const base = currentBase(hash);
    for (const nav of root.querySelectorAll("#sidebar, #bottom-nav")) {
      if (nav.dataset.admin !== String(isAdminUnlocked())) {
        nav.innerHTML = navLinksHTML(base);
        nav.dataset.admin = String(isAdminUnlocked());
      }
      nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === base));
    }
  }

  root.querySelector(".app-shell").addEventListener("click", (e) => {
    const link = e.target.closest(".sidebar a, .bottom-nav a");
    if (!link) return;
    adminNavOpen = isAdminUnlocked() && link.getAttribute("href") === "#/profile" && !adminNavOpen;
    root.querySelectorAll(".nav-admin").forEach((a) => a.classList.toggle("open", adminNavOpen));
  });

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
    syncNav(hash);
    root.querySelector("#brand-text").textContent = isAdminUnlocked() ? "MATCHBOOK - ADMIN" : "MATCHBOOK";
    const activeGymId = getCurrentGymId();

    let result;
    if (hash.startsWith("#/friends/")) {
      const rest = hash.slice("#/friends/".length);
      const [friendId, sub] = rest.split("/");
      result = friendId === "chat"
        ? renderFriends(contentArea, { chatId: sub })
        : renderFriends(contentArea, { friendId, showLog: sub === "log" });
    } else if (hash.startsWith("#/friends")) {
      result = renderFriends(contentArea, {});
    } else if (hash.startsWith("#/reel")) {
      result = renderReel(contentArea, { mediaId: hash.split("/")[2] });
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
      result = renderGymMap(contentArea, activeGymId, { focusRouteId: hash.startsWith("#/map/") ? hash.split("/")[2] : null });
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
