import { getCurrentUser, updateUser, computeUserStats, logOut } from "../data/api.js";
import { formatGrade, HOLD_TYPES, MAX_GRADE } from "../data/constants.js";
import { escapeHtml, compressImageFile, initials, ringStyle, dismissOverlay } from "../utils.js";
import { showToast } from "../components/toast.js";
import { openPasswordPromptModal } from "../components/passwordPromptModal.js";
import { unlockAdmin, ADMIN_PASSWORD } from "../adminAuth.js";
import { applyAccent, getAccent, ACCENT_SWATCHES } from "../accent.js";
import { mountColorPicker } from "../components/colorPicker.js";

function climbingExperience(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  const months = Math.max(0, Math.round((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.4)));
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} climbing`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `${years} yr${years === 1 ? "" : "s"}${rem ? ` ${rem} mo` : ""} climbing`;
}

// The suggestion box: Send opens the person's own mail app with the note filled in,
// addressed to the developer, and they send it from there.
const SUGGESTION_EMAIL = "shamangarc@gmail.com";

function openSuggestion(user) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);
  backdrop.innerHTML = `
    <form class="mini-popup" role="dialog" aria-modal="true" aria-label="Send a suggestion">
      <div class="mini-popup-title">Help Improve MATCHBOOK</div>
      <div class="page-sub" style="text-align:center;">Comments, ideas, or something that's not working right.</div>
      <textarea id="sg-text" rows="6" maxlength="2000" placeholder="Your suggestion…" required style="width:100%;resize:vertical;"></textarea>
      <button class="btn btn-primary btn-block" type="submit">Send</button>
      <button class="btn btn-ghost btn-block" type="button" id="sg-cancel">Cancel</button>
    </form>`;
  const close = () => dismissOverlay(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#sg-cancel").addEventListener("click", close);
  backdrop.querySelector("textarea").focus();
  backdrop.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = backdrop.querySelector("#sg-text").value.trim();
    if (!text) return;
    const subject = encodeURIComponent("MATCHBOOK suggestion");
    const body = encodeURIComponent(`${text}\n\n— ${user.name}`);
    location.href = `mailto:${SUGGESTION_EMAIL}?subject=${subject}&body=${body}`;
    close();
  });
}

export function renderProfile(container) {
  let editing = false;
  let stats = null;
  let photoDataUrl = null; // null = keep existing user.profilePicture

  async function render() {
    const user = getCurrentUser();
    if (!stats) {
      container.innerHTML = `<div class="page"><div class="empty-state card">Loading profile…</div></div>`;
      try { stats = await computeUserStats(user.id); } catch { stats = { totalClimbs: 0, highestGrade: null, favoriteStyleCalculated: null, favoriteHoldTypeCalculated: null }; }
    }
    const pic = photoDataUrl ?? user.profilePicture; // a picked photo previews in the header; it is only saved with the form
    const exp = climbingExperience(user.climbingStartDate);
    const showBothHoldTypes = user.favoriteHoldType && stats.favoriteHoldTypeCalculated && user.favoriteHoldType !== stats.favoriteHoldTypeCalculated;

    container.innerHTML = `
      <div class="page">
        <div class="page-header"><h1>Profile</h1></div>

        <div class="card card-pad section-block">
          <div class="profile-header">
            <div class="avatar"${ringStyle(user)}>${pic ? `<img src="${pic}" alt=""/>` : initials(user.name)}</div>
            <div>
              <h1>${escapeHtml(user.name)}</h1>
              <div class="sub">${escapeHtml(user.hometown || "Hometown not set")}${exp ? ` · ${exp}` : ""}</div>
            </div>
          </div>
          ${editing ? editForm(user) : viewInfo(user)}
        </div>

        <div class="two-col section-block">
          <div class="card card-pad">
            <div class="section-title" style="margin-top:0;">Your Stats</div>
            <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);">
              <div class="stat-tile"><div class="stat-value">${stats.totalClimbs}</div><div class="stat-label">Total Climbs</div></div>
              <div class="stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade)}</div><div class="stat-label">${stats.rope?.totalClimbs ? "Highest Boulder Grade" : "Highest Grade"}</div></div>
              ${stats.rope?.totalClimbs ? `<div class="stat-tile"><div class="stat-value">${stats.rope.highestGrade === null ? "—" : formatGrade(stats.rope.highestGrade, "rope")}</div><div class="stat-label">Highest Rope Grade</div></div>` : ""}
              <div class="stat-tile"><div class="stat-value">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
              <div class="stat-tile">
                <div class="stat-value">${stats.favoriteHoldTypeCalculated || "—"}</div>
                <div class="stat-label">Most Climbed Hold</div>
              </div>
            </div>
            ${showBothHoldTypes ? `<div class="page-sub" style="margin-top:8px;">Self-selected favorite: <strong>${escapeHtml(user.favoriteHoldType)}</strong> · Most climbed: <strong>${escapeHtml(stats.favoriteHoldTypeCalculated)}</strong></div>` : ""}
            <a href="#/log" class="btn btn-primary btn-block" style="margin-top:14px;">View Climbing Log</a>
          </div>

          <div class="card card-pad">
            <div class="section-title" style="margin-top:0;">Settings</div>
            <div class="settings-group" style="margin-top:0;">Accent Color</div>
            <div id="accent-picker"></div>

            <div class="settings-group">Privacy</div>
            <div class="set-row">
              <button type="button" class="chip set-toggle ${user.privacy.profilePublic ? "active" : ""}" id="p-public" aria-pressed="${!!user.privacy.profilePublic}">Public Profile</button>
              <button type="button" class="chip set-toggle ${user.privacy.logPublic ? "active" : ""}" id="p-logpublic" aria-pressed="${!!user.privacy.logPublic}">Friends Can View My Log</button>
            </div>

            <div class="settings-group">Navigation Bar</div>
            <div class="set-row">
              ${[["reel", "Clips", "clips"], ["friends", "Friends", "friends"]].map(([tab, label, icon]) => {
                const on = !(user.hiddenTabs || []).includes(tab);
                return `<button type="button" class="chip set-toggle big ${on ? "active" : ""}" id="p-nav-${tab}" aria-pressed="${on}"><img src="/assets/icons/nav-${icon}.svg" alt="" width="32" height="32"/>${label}</button>`;
              }).join("")}
            </div>

            <div class="settings-group">Suggestions</div>
            <button type="button" class="btn btn-outline btn-block" id="p-suggest">Send a Suggestion</button>
          </div>
        </div>

        <button class="btn btn-outline btn-block" id="admin-controls-btn" style="margin-top:14px;">Admin Controls</button>
        <button class="btn btn-outline btn-block" id="logout-btn" style="margin-top:8px;">Log Out</button>
      </div>
    `;

    container.querySelector("#admin-controls-btn").addEventListener("click", () => {
      openPasswordPromptModal({
        title: "Admin Controls",
        message: "Enter the admin password to continue.",
        expectedPassword: ADMIN_PASSWORD,
        confirmLabel: "ENTER",
        onConfirm: () => { unlockAdmin(); location.hash = "#/admin"; },
      });
    });
    container.querySelector("#p-suggest").addEventListener("click", () => openSuggestion(user));
    container.querySelector("#logout-btn").addEventListener("click", async () => {
      await logOut();
      location.reload();
    });
    container.querySelector("#edit-btn")?.addEventListener("click", () => { editing = true; render(); });
    container.querySelector("#cancel-btn")?.addEventListener("click", () => { editing = false; photoDataUrl = null; render(); });
    container.querySelector("#profile-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await updateUser(user.id, {
        name: fd.get("name") || user.name,
        age: fd.get("age") ? Number(fd.get("age")) : null,
        hometown: fd.get("hometown") || null,
        climbingStartDate: fd.get("climbingStartDate") || null,
        favoriteHoldType: fd.get("favoriteHoldType") || null,
        selfReportedHighestGrade: fd.get("selfReportedHighestGrade") !== "" ? Number(fd.get("selfReportedHighestGrade")) : null,
        profilePicture: photoDataUrl === "" ? null : photoDataUrl ?? user.profilePicture ?? null,
      });
      editing = false;
      photoDataUrl = null;
      showToast("Profile updated");
      render();
    });
    // The picker previews live (app colors and the avatar rings) and saves itself shortly after the last change.
    let saveTimer;
    mountColorPicker(container.querySelector("#accent-picker"), {
      color: user.accentColor ?? getAccent(),
      swatches: ACCENT_SWATCHES,
      onChange: (hex) => {
        const color = applyAccent(hex);
        document.querySelectorAll(".profile-header .avatar, .topbar .avatar").forEach((a) => a.style.setProperty("--ring", color));
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => updateUser(user.id, { accentColor: color }), 400);
      },
    });
    // Settings toggles are buttons: flip the look first, then read the new state back from it.
    const flip = (btn) => btn.setAttribute("aria-pressed", String(btn.classList.toggle("active")));
    for (const tab of ["reel", "friends"]) {
      container.querySelector(`#p-nav-${tab}`).addEventListener("click", async (e) => {
        flip(e.currentTarget);
        const hiddenTabs = ["reel", "friends"].filter((t) => !container.querySelector(`#p-nav-${t}`).classList.contains("active"));
        await updateUser(user.id, { hiddenTabs });
        window.dispatchEvent(new Event("navprefs")); // shell.js rebuilds the nav
      });
    }
    container.querySelector("#p-photo-btn")?.addEventListener("click", () => container.querySelector("#p-photo-input").click());
    container.querySelector("#p-photo-input")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoDataUrl = await compressImageFile(file, { maxDim: 400 });
      render();
    });
    container.querySelector("#p-photo-remove")?.addEventListener("click", () => { photoDataUrl = ""; render(); });
    container.querySelector("#p-public").addEventListener("click", (e) => {
      flip(e.currentTarget);
      updateUser(user.id, { privacy: { ...getCurrentUser().privacy, profilePublic: e.currentTarget.classList.contains("active") } });
    });
    container.querySelector("#p-logpublic").addEventListener("click", (e) => {
      flip(e.currentTarget);
      updateUser(user.id, { privacy: { ...getCurrentUser().privacy, logPublic: e.currentTarget.classList.contains("active") } });
    });
  }

  function viewInfo(user) {
    const rows = [
      user.age !== null && user.age !== undefined ? `<div class="info-row"><span class="k">Age</span><span class="v">${user.age}</span></div>` : "",
      user.hometown ? `<div class="info-row"><span class="k">Hometown</span><span class="v">${escapeHtml(user.hometown)}</span></div>` : "",
      `<div class="info-row"><span class="k">Favorite Hold Type</span><span class="v">${escapeHtml(user.favoriteHoldType) || "—"}</span></div>`,
      `<div class="info-row"><span class="k">Self-Reported Highest Grade</span><span class="v">${user.selfReportedHighestGrade !== null && user.selfReportedHighestGrade !== undefined ? formatGrade(user.selfReportedHighestGrade) : "—"}</span></div>`,
    ].join("");
    return `
      <div class="info-list">${rows}</div>
      <button class="btn btn-outline btn-block" id="edit-btn" style="margin-top:12px;">Edit Profile</button>
    `;
  }

  function editForm(user) {
    const pic = photoDataUrl ?? user.profilePicture;
    return `
      <form id="profile-form" style="margin-top:10px;">
        <div class="field"><label>Name</label><input type="text" name="name" value="${escapeHtml(user.name)}"/></div>
        <div class="field">
          <label>Profile Picture</label>
          <input type="file" accept="image/*" id="p-photo-input" class="visually-hidden"/>
          <button type="button" class="btn btn-outline btn-sm" id="p-photo-btn">Take or Choose Photo</button>
          ${pic ? `<button type="button" class="btn btn-ghost btn-sm" id="p-photo-remove">Remove Photo</button>` : ""}
        </div>
        <div class="form-row">
          <div class="field"><label>Age</label><input type="number" name="age" min="0" max="120" value="${user.age ?? ""}"/></div>
          <div class="field"><label>Hometown</label><input type="text" name="hometown" value="${escapeHtml(user.hometown || "")}"/></div>
        </div>
        <div class="field"><label>Climbing Since</label><input type="date" name="climbingStartDate" value="${user.climbingStartDate || ""}"/></div>
        <div class="form-row">
          <div class="field"><label>Favorite Hold Type</label>
            <select name="favoriteHoldType">
              <option value="">—</option>
              ${HOLD_TYPES.map((h) => `<option ${user.favoriteHoldType === h ? "selected" : ""}>${h}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Highest Grade Achieved</label>
            <select name="selfReportedHighestGrade">
              <option value="">—</option>
              ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${user.selfReportedHighestGrade === g ? "selected" : ""}>V${g}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-hint">All fields are optional.</div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary" type="submit">Save</button>
          <button class="btn btn-ghost" type="button" id="cancel-btn">Cancel</button>
        </div>
      </form>
    `;
  }

  render();
}
