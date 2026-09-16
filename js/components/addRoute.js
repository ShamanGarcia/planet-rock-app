import { createRoute } from "../data/api.js";
import { saveLocalMedia } from "../data/localMedia.js";
import { HOLD_COLORS, HOLD_COLOR_HEX, HOLD_TYPES, MAX_GRADE, formatGrade, SHARED_MEDIA_LIMIT_BYTES } from "../data/constants.js";
import { escapeHtml, compressImageFile, dataUrlByteSize, dismissOverlay } from "../utils.js";
import { showToast } from "./toast.js";

// Opens the "add a new route" drawer for a map position the user already
// tapped. Routes have no name — climbers identify them by hold color +
// grade — so this lets them pick color/type, optionally set an official
// grade, add tags, and attach a photo (camera on mobile, file picker on
// desktop) before uploading it so it appears for every climber.
export function openAddRouteForm({ gymId, mapX, mapY, wallSection, allTags, onCreated, onCancel }) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);

  let officialGrade = "";
  let newTagDraft = "";
  let selectedColor = null;
  let selectedHoldType = null;
  const selectedTags = new Set();
  let photoDataUrl = null;
  let photoTooBigForSharing = false;
  let processingPhoto = false;
  let submitting = false;
  let error = "";

  function close() { dismissOverlay(backdrop); }

  function previewLabel() {
    if (!selectedColor) return "New Route";
    return `${selectedColor} ${officialGrade === "" ? "(Ungraded)" : formatGrade(Number(officialGrade))}`;
  }

  function sortedTags() {
    return [...allTags].sort((a, b) => a.name.localeCompare(b.name));
  }

  function tagsRowHTML() {
    return sortedTags().map((t) => `<button type="button" class="chip ${selectedTags.has(t.name) ? "active" : ""}" data-tagname="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join("");
  }

  function render() {
    backdrop.innerHTML = `
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Add a new route">
        <div class="drawer-handle"></div>
        <div class="drawer-header">
          <h2>${escapeHtml(previewLabel())}</h2>
          <button class="icon-btn" style="background:#efece5;color:#1b1d21" id="ar-close" aria-label="Cancel">X</button>
        </div>
        <div class="page-sub" style="margin-bottom:12px;">Placed on ${wallSection ? escapeHtml(wallSection.replace(/-/g, " ")) : "the gym floor plan"} · you can drag the map before placing next time to fine-tune position.</div>

        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}

        <form id="ar-form">
          <div class="field">
            <label>Photo</label>
            <div id="ar-photo-preview" style="margin-bottom:8px; ${photoDataUrl ? "" : "display:none;"}">
              <div class="route-photo" style="max-height:180px;"><img src="${photoDataUrl || ""}" alt="Route preview" style="width:100%;height:100%;object-fit:cover;"/></div>
              ${photoTooBigForSharing ? `<div class="field-hint">Still large after compression — will be saved privately on this device only.</div>` : ""}
            </div>
            <input type="file" accept="image/*" id="ar-photo-input" class="visually-hidden" />
            <button type="button" class="btn btn-outline btn-sm" id="ar-photo-btn" ${processingPhoto ? "disabled" : ""}>${processingPhoto ? "Processing…" : photoDataUrl ? "Retake / Change Photo" : "Take or Upload Photo"}</button>
            ${photoDataUrl ? `<button type="button" class="btn btn-ghost btn-sm" id="ar-photo-remove">Remove Photo</button>` : ""}
          </div>

          <div class="field">
            <label>Hold Color</label>
            <div class="chip-row">
              ${HOLD_COLORS.map((c) => `
                <button type="button" class="chip ${selectedColor === c ? "active" : ""}" data-color="${c}">
                  <span class="hold-dot" style="background:${HOLD_COLOR_HEX[c]}"></span>${c}
                </button>
              `).join("")}
            </div>
          </div>

          <div class="field">
            <label>Hold Type</label>
            <div class="chip-row">
              ${HOLD_TYPES.map((t) => `<button type="button" class="chip ${selectedHoldType === t ? "active" : ""}" data-holdtype="${t}">${t}</button>`).join("")}
            </div>
          </div>

          <div class="field">
            <label>Official Grade (optional)</label>
            <select name="officialGrade" id="ar-grade">
              <option value="" ${officialGrade === "" ? "selected" : ""}>Ungraded</option>
              ${Array.from({ length: MAX_GRADE + 1 }, (_, g) => `<option value="${g}" ${officialGrade === String(g) ? "selected" : ""}>V${g}</option>`).join("")}
            </select>
            <div class="field-hint">Leave blank if this hasn't been officially graded yet — climbers can still submit community estimates.</div>
          </div>

          <div class="field">
            <label>Tags</label>
            <div class="chip-row" id="ar-tags-row">
              ${tagsRowHTML()}
            </div>
            <div class="add-tag-row">
              <input type="text" id="ar-new-tag" placeholder="Propose a new tag…" value="${escapeHtml(newTagDraft)}" />
              <button type="button" class="btn btn-outline btn-sm" id="ar-new-tag-btn">Add</button>
            </div>
          </div>

          <button class="btn btn-primary btn-block" type="submit" ${submitting ? "disabled" : ""}>
            ${submitting ? "Uploading…" : "Add Route to Gym"}
          </button>
          <button class="btn btn-ghost btn-block" type="button" id="ar-cancel" style="margin-top:6px;">Cancel</button>
        </form>
      </div>
    `;

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { close(); onCancel?.(); } });
    backdrop.querySelector("#ar-close").addEventListener("click", () => { close(); onCancel?.(); });
    backdrop.querySelector("#ar-cancel").addEventListener("click", () => { close(); onCancel?.(); });

    // Selecting a color/type/grade/tag is just picking an option — it
    // shouldn't rebuild the whole drawer (that would blur the tag-draft
    // input, replay the photo processing state, etc.). Only the header's
    // live preview label needs to reflect these, updated directly.
    function updateHeader() {
      const h2 = backdrop.querySelector(".drawer-header h2");
      if (h2) h2.textContent = previewLabel();
    }

    backdrop.querySelector("#ar-grade").addEventListener("change", (e) => {
      officialGrade = e.target.value;
      updateHeader();
    });
    backdrop.querySelector("#ar-new-tag").addEventListener("input", (e) => { newTagDraft = e.target.value; });

    backdrop.querySelectorAll("[data-color]").forEach((btn) => btn.addEventListener("click", () => {
      selectedColor = btn.getAttribute("data-color");
      backdrop.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("active", b === btn));
      updateHeader();
    }));
    backdrop.querySelectorAll("[data-holdtype]").forEach((btn) => btn.addEventListener("click", () => {
      selectedHoldType = btn.getAttribute("data-holdtype");
      backdrop.querySelectorAll("[data-holdtype]").forEach((b) => b.classList.toggle("active", b === btn));
    }));
    function wireTagChip(btn) {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-tagname");
        if (selectedTags.has(name)) { selectedTags.delete(name); btn.classList.remove("active"); }
        else { selectedTags.add(name); btn.classList.add("active"); }
      });
    }
    backdrop.querySelectorAll("[data-tagname]").forEach(wireTagChip);
    backdrop.querySelector("#ar-new-tag-btn").addEventListener("click", () => {
      const name = newTagDraft.trim();
      if (!name) return;
      if (allTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        showToast("Already a tag!");
        return;
      }
      selectedTags.add(name);
      allTags.push({ id: `local_${name}`, name });
      newTagDraft = "";
      backdrop.querySelector("#ar-new-tag").value = "";
      const row = backdrop.querySelector("#ar-tags-row");
      row.innerHTML = tagsRowHTML();
      row.querySelectorAll("[data-tagname]").forEach(wireTagChip);
    });

    const photoInput = backdrop.querySelector("#ar-photo-input");
    backdrop.querySelector("#ar-photo-btn").addEventListener("click", () => photoInput.click());
    backdrop.querySelector("#ar-photo-remove")?.addEventListener("click", () => {
      photoDataUrl = null;
      photoTooBigForSharing = false;
      render();
    });
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      processingPhoto = true;
      render();
      try {
        photoDataUrl = await compressImageFile(file);
        photoTooBigForSharing = dataUrlByteSize(photoDataUrl) > SHARED_MEDIA_LIMIT_BYTES;
      } catch {
        error = "Couldn't read that photo — try another file.";
        photoDataUrl = null;
      }
      processingPhoto = false;
      render();
    });

    backdrop.querySelector("#ar-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submitting) return;
      if (!selectedColor) { error = "Pick the hold color."; render(); return; }
      if (!selectedHoldType) { error = "Pick the primary hold type."; render(); return; }

      submitting = true;
      error = "";
      render();
      try {
        const shareablePhoto = photoDataUrl && !photoTooBigForSharing ? photoDataUrl : null;
        const route = await createRoute({
          gymId,
          wallSection,
          mapX, mapY,
          holdColor: selectedColor,
          holdType: selectedHoldType,
          holdTypes: [selectedHoldType],
          officialGrade: officialGrade === "" ? null : Number(officialGrade),
          tags: [...selectedTags],
          photoDataUrl: shareablePhoto,
        });
        if (photoDataUrl && photoTooBigForSharing) {
          await saveLocalMedia(route.id, "photo", photoDataUrl);
        }
        close();
        showToast("Route added to the gym");
        onCreated?.(route);
      } catch (err) {
        submitting = false;
        error = err.message;
        render();
      }
    });
  }

  render();
}
