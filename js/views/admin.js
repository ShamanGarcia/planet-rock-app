import {
  getAllTags, deleteRoute, adminListUsers, adminDeleteUser, adminDeleteTag, getAllRoutesForAdmin,
} from "../data/api.js";
import { HOLD_COLORS, HOLD_COLOR_HEX, WALL_SECTIONS, MAX_GRADE, formatGrade } from "../data/constants.js";
import { formatDate, escapeHtml, dismissOverlay } from "../utils.js";
import { openPasswordPromptModal } from "../components/passwordPromptModal.js";
import { showToast } from "../components/toast.js";
import { ADMIN_PASSWORD } from "../adminAuth.js";

// Mirrors backend/server.py's ADMIN_DELETE_PASSWORD.
const ADMIN_DELETE_PASSWORD = "GETOUT!";

export function renderAdmin(container) {
  let tab = "users"; // "users" | "tags" | "climbs"
  let users = null;
  let tags = null;
  let routes = null;
  let userQuery = "";
  let routeFilters = { date: "", area: "", color: "", grade: "" };

  function splitName(name) {
    const parts = (name || "").trim().split(/\s+/);
    return { first: parts[0] || "—", last: parts.slice(1).join(" ") || "—" };
  }

  async function render() {
    container.innerHTML = `
      <div class="page">
        <div class="page-header"><h1>Admin</h1></div>
        <div class="mode-toggle" style="margin-bottom:14px;">
          <button type="button" class="${tab === "users" ? "active" : ""}" data-tab="users">Users</button>
          <button type="button" class="${tab === "tags" ? "active" : ""}" data-tab="tags">Tags</button>
          <button type="button" class="${tab === "climbs" ? "active" : ""}" data-tab="climbs">Climbs</button>
        </div>
        <div id="admin-body"><div class="empty-state card">Loading…</div></div>
      </div>
    `;
    container.querySelectorAll("[data-tab]").forEach((btn) => btn.addEventListener("click", () => {
      tab = btn.getAttribute("data-tab");
      render();
    }));
    const body = container.querySelector("#admin-body");
    if (tab === "users") await renderUsersTab(body);
    else if (tab === "tags") await renderTagsTab(body);
    else await renderClimbsTab(body);
  }

  // ---------- Users ----------
  async function renderUsersTab(body) {
    if (!users) {
      try { users = await adminListUsers(ADMIN_PASSWORD); }
      catch { users = []; showToast("Couldn't load users"); }
    }
    body.innerHTML = `
      <div class="filters-bar">
        <input type="text" id="u-search" placeholder="Search by name or email…" value="${escapeHtml(userQuery)}" style="flex:1;"/>
      </div>
      <div class="info-list" id="u-results"></div>
    `;
    const resultsEl = body.querySelector("#u-results");

    function renderResults() {
      const q = userQuery.trim().toLowerCase();
      const filtered = q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : users;
      resultsEl.innerHTML = filtered.length
        ? filtered.map((u) => `
          <button type="button" class="info-row" data-user-id="${u.id}" style="width:100%;text-align:left;background:none;border:none;">
            <span class="k">${escapeHtml(u.name)}</span><span class="v">${escapeHtml(u.email)}</span>
          </button>
        `).join("")
        : `<div class="page-sub">No users match.</div>`;
      resultsEl.querySelectorAll("[data-user-id]").forEach((btn) => btn.addEventListener("click", () => {
        const user = users.find((u) => u.id === btn.getAttribute("data-user-id"));
        if (user) openUserDetailPopup(user);
      }));
    }

    // Search filters the already-fetched list locally — updating only the
    // results container (not this whole tab body) keeps the input's focus
    // and cursor position intact while typing.
    body.querySelector("#u-search").addEventListener("input", (e) => { userQuery = e.target.value; renderResults(); });
    renderResults();
  }

  function openUserDetailPopup(user) {
    const backdrop = document.createElement("div");
    backdrop.className = "mini-popup-backdrop";
    document.body.appendChild(backdrop);
    function close() { dismissOverlay(backdrop); }
    const { first, last } = splitName(user.name);

    backdrop.innerHTML = `
      <div class="mini-popup" role="dialog" aria-modal="true" aria-label="${escapeHtml(user.name)}">
        <div class="mini-popup-title">${escapeHtml(user.name)}</div>
        <div class="info-list">
          <div class="info-row"><span class="k">First Name</span><span class="v">${escapeHtml(first)}</span></div>
          <div class="info-row"><span class="k">Last Name</span><span class="v">${escapeHtml(last)}</span></div>
          <div class="info-row"><span class="k">Email</span><span class="v">${escapeHtml(user.email)}</span></div>
          <div class="info-row"><span class="k">Registered</span><span class="v">${formatDate(user.createdAt)}</span></div>
        </div>
        <button class="btn btn-danger btn-block" id="ud-delete-btn" style="margin-top:12px;">Delete Account</button>
        <button class="btn btn-ghost btn-block" id="ud-close-btn">Close</button>
      </div>
    `;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#ud-close-btn").addEventListener("click", close);
    backdrop.querySelector("#ud-delete-btn").addEventListener("click", () => {
      openPasswordPromptModal({
        title: "Delete Account",
        message: `Permanently delete ${user.name}'s account? This can't be undone.`,
        expectedPassword: ADMIN_DELETE_PASSWORD,
        confirmLabel: "DELETE",
        danger: true,
        onConfirm: async (pw) => {
          await adminDeleteUser(user.id, pw);
          users = users.filter((u) => u.id !== user.id);
          showToast("Account deleted");
          close();
          render();
        },
      });
    });
  }

  // ---------- Tags ----------
  async function renderTagsTab(body) {
    if (!tags) {
      try { tags = await getAllTags(); }
      catch { tags = []; showToast("Couldn't load tags"); }
    }
    const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
    body.innerHTML = `
      <div class="info-list">
        ${sorted.length ? sorted.map((t) => `
          <div class="info-row">
            <span class="k">${escapeHtml(t.name)}</span>
            <button type="button" class="btn btn-danger btn-sm" data-delete-tag="${t.id}">Delete</button>
          </div>
        `).join("") : `<div class="page-sub">No tags yet.</div>`}
      </div>
    `;
    body.querySelectorAll("[data-delete-tag]").forEach((btn) => btn.addEventListener("click", () => {
      const tagId = btn.getAttribute("data-delete-tag");
      const tag = tags.find((t) => t.id === tagId);
      openPasswordPromptModal({
        title: "Delete Tag",
        message: `Permanently delete the tag "${tag.name}"? It will be removed from every climb.`,
        expectedPassword: ADMIN_DELETE_PASSWORD,
        confirmLabel: "DELETE",
        danger: true,
        onConfirm: async (pw) => {
          await adminDeleteTag(tagId, pw);
          tags = tags.filter((t) => t.id !== tagId);
          showToast("Tag deleted");
          renderTagsTab(body);
        },
      });
    }));
  }

  // ---------- Climbs (routes) ----------
  function getFilteredRoutes() {
    return routes.filter((r) => {
      if (routeFilters.date && (r.createdAt || "").slice(0, 10) !== routeFilters.date) return false;
      if (routeFilters.area && r.wallSection !== routeFilters.area) return false;
      if (routeFilters.color && r.holdColor !== routeFilters.color) return false;
      if (routeFilters.grade !== "" && String(r.officialGrade) !== routeFilters.grade) return false;
      return true;
    });
  }

  async function renderClimbsTab(body) {
    if (!routes) {
      try { routes = await getAllRoutesForAdmin(); }
      catch { routes = []; showToast("Couldn't load climbs"); }
    }
    const filtered = getFilteredRoutes();
    body.innerHTML = `
      <div class="filters-bar">
        <input type="date" id="c-date" value="${routeFilters.date}" aria-label="Date added"/>
        <select id="c-area"><option value="">Any Area</option>${WALL_SECTIONS.map((s) => `<option value="${s.id}" ${routeFilters.area === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
        <select id="c-color"><option value="">Any Color</option>${HOLD_COLORS.map((c) => `<option ${routeFilters.color === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <select id="c-grade"><option value="">Any Grade</option>${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${routeFilters.grade === String(g) ? "selected" : ""}>V${g}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-sm" id="c-clear">Clear</button>
      </div>
      <div class="info-list">
        ${filtered.length ? filtered.map((r) => `
          <div class="info-row">
            <span class="k"><span class="hold-dot" style="background:${HOLD_COLOR_HEX[r.holdColor]}"></span> ${escapeHtml(r.holdColor)} ${formatGrade(r.officialGrade)} · ${escapeHtml((r.wallSection || "").replace(/-/g, " "))}</span>
            <button type="button" class="btn btn-danger btn-sm" data-delete-route="${r.id}">Delete</button>
          </div>
        `).join("") : `<div class="page-sub">No climbs match.</div>`}
      </div>
    `;
    body.querySelector("#c-date").addEventListener("change", (e) => { routeFilters.date = e.target.value; renderClimbsTab(body); });
    body.querySelector("#c-area").addEventListener("change", (e) => { routeFilters.area = e.target.value; renderClimbsTab(body); });
    body.querySelector("#c-color").addEventListener("change", (e) => { routeFilters.color = e.target.value; renderClimbsTab(body); });
    body.querySelector("#c-grade").addEventListener("change", (e) => { routeFilters.grade = e.target.value; renderClimbsTab(body); });
    body.querySelector("#c-clear").addEventListener("click", () => { routeFilters = { date: "", area: "", color: "", grade: "" }; renderClimbsTab(body); });
    body.querySelectorAll("[data-delete-route]").forEach((btn) => btn.addEventListener("click", () => {
      const routeId = btn.getAttribute("data-delete-route");
      const route = routes.find((r) => r.id === routeId);
      openPasswordPromptModal({
        title: "Delete Climb",
        message: `Permanently remove this ${route.holdColor} ${route.holdType} climb from the map?`,
        expectedPassword: ADMIN_DELETE_PASSWORD,
        confirmLabel: "DELETE",
        danger: true,
        onConfirm: async (pw) => {
          await deleteRoute(routeId, pw);
          routes = routes.filter((r) => r.id !== routeId);
          showToast("Climb deleted");
          renderClimbsTab(body);
        },
      });
    }));
  }

  render();
}
