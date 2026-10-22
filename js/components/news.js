import { getCurrentUser } from "../data/api.js";
import { dismissOverlay, escapeHtml } from "../utils.js";

// What's new in the app. Newest first. Add an item here to announce a change; each
// person's "mark read" choices live in localStorage under their user id, so an item
// moves from Updates to Past News once they have read it (per device).
export const NEWS_ICON = "/assets/icons/news.svg";

const NEWS = [
  {
    id: "ropes",
    title: "Ropes Added!",
    text: "Flip the map to Rope to see the rope wall, log your sends and vote on grades from 5.7 to 5.13.",
    image: "/assets/news/rope-map.png",
    tag: "Route in progress",
  },
  {
    id: "color-picker",
    title: "Pick a Color!",
    text: "Make the app yours: choose an accent color in Edit Profile and the buttons, charts and highlights follow it.",
    image: "/assets/news/color-picker.png",
  },
];

const key = () => `pr_news_read_${getCurrentUser()?.id}`;

function readIds() {
  try { return JSON.parse(localStorage.getItem(key()) || "[]"); } catch { return []; }
}

function markRead(id) {
  try { localStorage.setItem(key(), JSON.stringify([...new Set([...readIds(), id])])); } catch { /* storage blocked — it just stays unread */ }
}

export function unreadCount() {
  const read = readIds();
  return NEWS.filter((n) => !read.includes(n.id)).length;
}

function itemHTML(n, unread) {
  return `
    <article class="news-item" data-id="${n.id}">
      <div class="news-item-top">
        <h3>${escapeHtml(n.title)}</h3>
        ${unread ? `<button type="button" class="btn btn-outline btn-sm news-read">Mark read</button>` : ""}
      </div>
      <p>${escapeHtml(n.text)}</p>
      <div class="news-shot"><img src="${n.image}" alt="" loading="lazy"/>${n.tag ? `<span class="news-tag">${escapeHtml(n.tag)}</span>` : ""}</div>
    </article>`;
}

export function openNews({ onChange } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "mini-popup-backdrop";
  document.body.appendChild(backdrop);
  const close = () => dismissOverlay(backdrop);
  let tab = "updates";

  function render() {
    const read = readIds();
    const updates = NEWS.filter((n) => !read.includes(n.id));
    const past = NEWS.filter((n) => read.includes(n.id));
    const list = tab === "updates" ? updates : past;
    backdrop.innerHTML = `
      <div class="mini-popup news-popup" role="dialog" aria-modal="true" aria-label="News">
        <button type="button" class="cp-close" id="news-close" aria-label="Close">&times;</button>
        <div class="mini-popup-title">News</div>
        <div class="news-tabs" role="tablist">
          <button type="button" role="tab" class="${tab === "updates" ? "active" : ""}" data-tab="updates" aria-selected="${tab === "updates"}">Updates${updates.length ? ` <span class="news-count">${updates.length}</span>` : ""}</button>
          <button type="button" role="tab" class="${tab === "past" ? "active" : ""}" data-tab="past" aria-selected="${tab === "past"}">Past News</button>
        </div>
        <div class="news-list">${
          list.length
            ? list.map((n) => itemHTML(n, tab === "updates")).join("")
            : `<div class="news-empty">${tab === "updates" ? "You're all caught up!" : "Nothing here yet."}</div>`
        }</div>
      </div>`;
    backdrop.querySelector("#news-close").addEventListener("click", close);
    backdrop.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
    backdrop.querySelectorAll(".news-read").forEach((b) => b.addEventListener("click", () => {
      const card = b.closest(".news-item");
      card.classList.add("leaving"); // slide away, then it lives under Past News
      setTimeout(() => { markRead(card.dataset.id); onChange?.(); render(); }, 260);
    }));
  }

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  render();
}
