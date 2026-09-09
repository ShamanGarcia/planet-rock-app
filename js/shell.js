import { getCurrentUser, getGyms, getCurrentGymId, setCurrentGym, logOut } from "./data/api.js";
import { renderGymMap } from "./views/gymMap.js";
import { renderClimbingLog } from "./views/climbingLog.js";
import { renderProfile } from "./views/profile.js";
import { renderFriends } from "./views/friends.js";

const NAV_ITEMS = [
  { hash: "#/map", label: "Gym Map", icon: "🧗" },
  { hash: "#/log", label: "Climbing Log", icon: "📒" },
  { hash: "#/profile", label: "Profile", icon: "👤" },
  { hash: "#/friends", label: "Friends", icon: "🤝" },
];

function currentBase(hash) {
  if (hash.startsWith("#/friends")) return "#/friends";
  if (hash.startsWith("#/log")) return "#/log";
  if (hash.startsWith("#/profile")) return "#/profile";
  return "#/map";
}

function navLinksHTML(active) {
  return NAV_ITEMS.map(
    (item) => `<a href="${item.hash}" class="${active === item.hash ? "active" : ""}">
      <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
    </a>`
  ).join("");
}

export async function renderShell(root, onLoggedOut) {
  const user = getCurrentUser();
  const gyms = await getGyms();
  const gymId = getCurrentGymId() || gyms[0]?.id;

  root.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <div class="brand"><span class="logo-mark">🧗</span> Planet Rock</div>
        <select class="gym-select" id="gym-select" aria-label="Select gym">
          ${gyms.map((g) => `<option value="${g.id}" ${g.id === gymId ? "selected" : ""}>${g.name}</option>`).join("")}
        </select>
        <div class="topbar-actions">
          <button class="icon-btn" id="logout-btn" title="Log out" aria-label="Log out">⏻</button>
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
  root.querySelector("#logout-btn").addEventListener("click", async () => {
    await logOut();
    onLoggedOut();
  });

  const contentArea = root.querySelector("#content-area");
  let activeCleanup = null;

  function renderRoute() {
    if (typeof activeCleanup === "function") activeCleanup();
    activeCleanup = null;

    const hash = location.hash || "#/map";
    root.querySelector("#sidebar").innerHTML = navLinksHTML(currentBase(hash));
    root.querySelector("#bottom-nav").innerHTML = navLinksHTML(currentBase(hash));
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
    } else {
      result = renderGymMap(contentArea, activeGymId);
    }
    if (typeof result === "function") activeCleanup = result;
  }

  window.addEventListener("hashchange", renderRoute);
  if (!location.hash) location.hash = "#/map";
  renderRoute();
}
