import { getCurrentUser, updateUser, computeUserStats } from "../data/api.js";
import { formatGrade, HOLD_TYPES, MAX_GRADE } from "../data/constants.js";
import { escapeHtml } from "../utils.js";
import { showToast } from "../components/toast.js";

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function climbingExperience(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  const months = Math.max(0, Math.round((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.4)));
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} climbing`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `${years} yr${years === 1 ? "" : "s"}${rem ? ` ${rem} mo` : ""} climbing`;
}

export function renderProfile(container) {
  let editing = false;
  let stats = null;

  async function render() {
    const user = getCurrentUser();
    if (!stats) {
      container.innerHTML = `<div class="page"><div class="empty-state card">Loading profile…</div></div>`;
      try { stats = await computeUserStats(user.id); } catch { stats = { totalClimbs: 0, highestGrade: null, favoriteStyleCalculated: null, favoriteHoldTypeCalculated: null }; }
    }
    const exp = climbingExperience(user.climbingStartDate);
    const showBothHoldTypes = user.favoriteHoldType && stats.favoriteHoldTypeCalculated && user.favoriteHoldType !== stats.favoriteHoldTypeCalculated;

    container.innerHTML = `
      <div class="page">
        <div class="page-header"><h1>Profile</h1></div>

        <div class="card card-pad section-block">
          <div class="profile-header">
            <div class="avatar">${user.profilePicture ? `<img src="${user.profilePicture}" alt=""/>` : initials(user.name)}</div>
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
              <div class="stat-tile"><div class="stat-value">${stats.highestGrade === null ? "—" : formatGrade(stats.highestGrade)}</div><div class="stat-label">Highest Grade</div></div>
              <div class="stat-tile"><div class="stat-value" style="font-size:14px;">${stats.favoriteStyleCalculated || "—"}</div><div class="stat-label">Favorite Style</div></div>
              <div class="stat-tile">
                <div class="stat-value" style="font-size:14px;">${stats.favoriteHoldTypeCalculated || "—"}</div>
                <div class="stat-label">Most Climbed Hold</div>
              </div>
            </div>
            ${showBothHoldTypes ? `<div class="page-sub" style="margin-top:8px;">Self-selected favorite: <strong>${escapeHtml(user.favoriteHoldType)}</strong> · Most climbed: <strong>${escapeHtml(stats.favoriteHoldTypeCalculated)}</strong></div>` : ""}
            <a href="#/log" class="btn btn-primary btn-block" style="margin-top:14px;">View Climbing Log</a>
          </div>

          <div class="card card-pad">
            <div class="section-title" style="margin-top:0;">Privacy</div>
            <div class="field" style="display:flex;align-items:center;justify-content:space-between;">
              <label style="margin:0;">Public Profile</label>
              <input type="checkbox" id="p-public" ${user.privacy.profilePublic ? "checked" : ""}/>
            </div>
            <div class="field" style="display:flex;align-items:center;justify-content:space-between;">
              <label style="margin:0;">Friends Can View My Log</label>
              <input type="checkbox" id="p-logpublic" ${user.privacy.logPublic ? "checked" : ""}/>
            </div>
            <div class="page-sub">When off, friends will see your profile but not your climbing log.</div>
          </div>
        </div>
      </div>
    `;

    container.querySelector("#edit-btn")?.addEventListener("click", () => { editing = true; render(); });
    container.querySelector("#cancel-btn")?.addEventListener("click", () => { editing = false; render(); });
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
        profilePicture: fd.get("profilePicture") || null,
      });
      editing = false;
      showToast("Profile updated");
      render();
    });
    container.querySelector("#p-public")?.addEventListener("change", (e) => {
      updateUser(user.id, { privacy: { ...user.privacy, profilePublic: e.target.checked } });
    });
    container.querySelector("#p-logpublic")?.addEventListener("change", (e) => {
      updateUser(user.id, { privacy: { ...user.privacy, logPublic: e.target.checked } });
    });
  }

  function viewInfo(user) {
    return `
      <div class="info-list">
        <div class="info-row"><span class="k">Age</span><span class="v">${user.age ?? "—"}</span></div>
        <div class="info-row"><span class="k">Hometown</span><span class="v">${escapeHtml(user.hometown) || "—"}</span></div>
        <div class="info-row"><span class="k">Favorite Hold Type</span><span class="v">${escapeHtml(user.favoriteHoldType) || "—"}</span></div>
        <div class="info-row"><span class="k">Self-Reported Highest Grade</span><span class="v">${user.selfReportedHighestGrade !== null && user.selfReportedHighestGrade !== undefined ? formatGrade(user.selfReportedHighestGrade) : "—"}</span></div>
      </div>
      <button class="btn btn-outline btn-block" id="edit-btn" style="margin-top:12px;">Edit Profile</button>
    `;
  }

  function editForm(user) {
    return `
      <form id="profile-form" style="margin-top:10px;">
        <div class="field"><label>Name</label><input type="text" name="name" value="${escapeHtml(user.name)}"/></div>
        <div class="field"><label>Profile Picture URL</label><input type="text" name="profilePicture" value="${escapeHtml(user.profilePicture || "")}" placeholder="https://…"/></div>
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
