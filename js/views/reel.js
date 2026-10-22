import {
  getReel, getReelItem, toggleReelLike, getReelComments, addReelComment, deleteReelComment,
  getCurrentGymId, getAcceptedFriends, sendMessage,
} from "../data/api.js";
import { formatGrade, HOLD_COLOR_HEX, WALL_SECTIONS, ROPE_SECTIONS } from "../data/constants.js";
import { escapeHtml, initials, formatDateTime, dismissOverlay } from "../utils.js";
import { showToast } from "../components/toast.js";

const PAGE = 6;
let muted = true; // autoplay needs muted; once the viewer unmutes it sticks for the session

// 8-bit action icons drawn from bitmaps, in the same pixel style as the nav.
function pix(rows) {
  const d = rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
}
const ICONS = {
  heart: pix(["01100110", "11111111", "11111111", "11111111", "01111110", "00111100", "00011000"]),
  chat: pix(["111111111", "111111111", "111111111", "111111111", "111111111", "011000000", "110000000"]),
  share: pix(["000010000", "000011000", "111111100", "111111110", "111111100", "000011000", "000010000"]),
};

const sectionName = (id) => [...WALL_SECTIONS, ...ROPE_SECTIONS].find((s) => s.id === id)?.name || "";

// "V4 · Long Wall · Red" — shared with the shared-video card in Friends messages.
export function reelRouteLabel({ route: r }) {
  return [formatGrade(r.officialGrade, r.discipline), sectionName(r.wallSection), r.holdColor, r.routeTitle].filter(Boolean).join(" · ");
}

function itemHTML(it) {
  return `
    <section class="reel-item" data-id="${it.id}">
      <video class="reel-video" data-src="${it.url}" playsinline loop preload="none" ${muted ? "muted" : ""}></video>
      <div class="reel-paused" aria-hidden="true"></div>
      <div class="reel-fail">Couldn't play this video.</div>
      <div class="reel-caption">
        <div class="reel-who"><span class="avatar sm">${escapeHtml(initials(it.uploader.name))}</span><span>${escapeHtml(it.uploader.name)}</span></div>
        <div class="reel-route"><span class="reel-dot" style="background:${HOLD_COLOR_HEX[it.route.holdColor] || "#888"}"></span>${escapeHtml(reelRouteLabel(it))}</div>
      </div>
      <div class="reel-rail">
        <button type="button" class="reel-act ${it.liked ? "on" : ""}" data-act="like" aria-label="Like" aria-pressed="${it.liked}">${ICONS.heart}<span class="reel-n">${it.likeCount}</span></button>
        <button type="button" class="reel-act" data-act="comments" aria-label="Comments">${ICONS.chat}<span class="reel-n">${it.commentCount}</span></button>
        <button type="button" class="reel-act" data-act="share" aria-label="Share">${ICONS.share}<span class="reel-n">Share</span></button>
      </div>
    </section>`;
}

export function renderReel(container, { mediaId } = {}) {
  const gymId = getCurrentGymId();
  let sort = "recent";
  let items = [];
  let next = 0; // offset of the next page, null when the feed is exhausted
  let loading = false;
  let gen = 0; // bumped on every reset so a slow page from a previous sort is dropped

  container.innerHTML = `
    <div class="reel-page">
      <div class="reel-bar">
        <div class="reel-sort" role="tablist">
          <button type="button" role="tab" data-sort="recent" class="active" aria-selected="true">Recent</button>
          <button type="button" role="tab" data-sort="popular" aria-selected="false">Popular</button>
        </div>
        <button type="button" class="reel-mute" id="reel-mute"></button>
      </div>
      <div class="reel-feed" id="reel-feed"></div>
    </div>`;
  const feed = container.querySelector("#reel-feed");
  const muteBtn = container.querySelector("#reel-mute");

  const syncMute = () => {
    muteBtn.textContent = muted ? "Sound off" : "Sound on";
    feed.querySelectorAll("video").forEach((v) => { v.muted = muted; });
  };
  syncMute();
  muteBtn.addEventListener("click", () => { muted = !muted; syncMute(); });

  function ensureSrc(v) {
    if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.preload = "metadata"; }
  }

  // Plays the video that fills the screen, pauses the rest; neighbours get their src early.
  const playIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target.querySelector("video");
      if (e.isIntersecting) {
        ensureSrc(v);
        e.target.classList.remove("paused");
        v.muted = muted;
        v.play().catch(() => {
          if (!muted) { muted = true; syncMute(); v.play().catch(() => {}); } // browser refused sound without a tap
        });
      } else {
        v.pause();
      }
    }
  }, { root: feed, threshold: 0.6 });
  const nearIo = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) ensureSrc(e.target.querySelector("video"));
  }, { root: feed, rootMargin: "100% 0px" });
  const moreIo = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { root: feed });

  function appendItems(list) {
    if (!list.length) return;
    feed.querySelector(".reel-empty")?.remove();
    feed.insertAdjacentHTML("beforeend", list.map(itemHTML).join(""));
    const els = [...feed.querySelectorAll(".reel-item")];
    for (const el of els.slice(-list.length)) {
      playIo.observe(el);
      nearIo.observe(el);
      el.querySelector("video").addEventListener("error", () => el.classList.add("failed"));
    }
    moreIo.disconnect();
    moreIo.observe(els[Math.max(0, els.length - 3)]); // a few videos before the end, fetch the next page
  }

  async function loadMore() {
    if (loading || next === null) return;
    loading = true;
    const myGen = gen;
    try {
      const page = await getReel(gymId, { sort, offset: next, limit: PAGE });
      if (myGen !== gen) return;
      const fresh = page.items.filter((i) => !items.some((x) => x.id === i.id));
      items.push(...fresh);
      next = page.next;
      appendItems(fresh);
    } catch (err) {
      if (myGen === gen) showToast(err.message);
    } finally {
      if (myGen === gen) loading = false;
    }
  }

  async function reset(first) {
    gen++;
    loading = false;
    items = [];
    next = 0;
    playIo.disconnect(); nearIo.disconnect(); moreIo.disconnect();
    feed.innerHTML = "";
    feed.scrollTop = 0;
    if (first) { items.push(first); appendItems([first]); }
    await loadMore();
    if (!items.length && next === null) {
      feed.innerHTML = `<div class="reel-empty"><b>No videos yet</b><span>Log a send with a video, or add one to a route's gallery as Public, and it shows up here.</span></div>`;
    }
  }

  container.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.sort === sort) return;
    sort = b.dataset.sort;
    container.querySelectorAll("[data-sort]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", String(x === b));
    });
    reset();
  }));

  feed.addEventListener("click", async (e) => {
    const el = e.target.closest(".reel-item");
    if (!el) return;
    const it = items.find((x) => x.id === el.dataset.id);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) { // tap the video itself: play / pause
      const v = el.querySelector("video");
      if (v.paused) { v.play().catch(() => {}); el.classList.remove("paused"); } else { v.pause(); el.classList.add("paused"); }
      return;
    }
    if (act === "like") {
      const btn = el.querySelector('[data-act="like"]');
      const setLike = (liked, count) => {
        it.liked = liked; it.likeCount = count;
        btn.classList.toggle("on", liked);
        btn.setAttribute("aria-pressed", String(liked));
        btn.querySelector(".reel-n").textContent = count;
      };
      const before = [it.liked, it.likeCount];
      setLike(!it.liked, it.likeCount + (it.liked ? -1 : 1)); // optimistic
      try {
        const res = await toggleReelLike(it.id);
        setLike(res.liked, res.likeCount);
      } catch (err) {
        setLike(...before);
        showToast(err.message);
      }
    } else if (act === "comments") {
      openComments(it, (n) => { it.commentCount = n; el.querySelector('[data-act="comments"] .reel-n').textContent = n; });
    } else if (act === "share") {
      openShare(it);
    }
  });

  (async () => {
    let first = null;
    if (mediaId) {
      try { first = await getReelItem(mediaId); } catch { showToast("That video isn't available any more."); }
    }
    reset(first);
  })();

  return () => {
    gen++;
    playIo.disconnect(); nearIo.disconnect(); moreIo.disconnect();
    feed.querySelectorAll("video").forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
  };
}

function sheet(title) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  document.body.appendChild(backdrop);
  const close = () => dismissOverlay(backdrop);
  backdrop.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="drawer-handle"></div>
      <div class="drawer-header"><h2>${title}</h2><button type="button" class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <div class="reel-sheet-body"></div>
    </div>`;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop || e.target.closest("[data-close]")) close(); });
  return { body: backdrop.querySelector(".reel-sheet-body"), close };
}

function openComments(it, onCount) {
  const { body } = sheet("Comments");
  body.innerHTML = `
    <div class="reel-comments" id="cm-list">Loading…</div>
    <form class="reel-comment-form" id="cm-form">
      <input id="cm-input" maxlength="500" placeholder="Add a comment…" autocomplete="off" aria-label="Add a comment"/>
      <button type="submit" class="btn btn-primary btn-sm">Post</button>
    </form>`;
  const list = body.querySelector("#cm-list");
  const input = body.querySelector("#cm-input");

  async function load() {
    try {
      const comments = await getReelComments(it.id);
      onCount(comments.length);
      list.innerHTML = comments.length
        ? comments.map((c) => `
            <div class="cm-row">
              <div class="cm-body"><b>${escapeHtml(c.user.name)}</b> <span class="cm-time">${formatDateTime(c.createdAt)}</span><div>${escapeHtml(c.text)}</div></div>
              ${c.mine ? `<button type="button" class="btn btn-ghost btn-sm" data-del="${c.id}">Delete</button>` : ""}
            </div>`).join("")
        : `<div class="empty-state">No comments yet. Be the first.</div>`;
    } catch (err) {
      list.textContent = err.message;
    }
  }
  load();

  body.querySelector("#cm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try { await addReelComment(it.id, text); } catch (err) { showToast(err.message); input.value = text; return; }
    load();
  });
  list.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del]")?.dataset.del;
    if (!id) return;
    try { await deleteReelComment(it.id, id); } catch (err) { showToast(err.message); }
    load();
  });
}

function openShare(it) {
  const { body } = sheet("Share");
  const link = `${location.origin}/#/reel/${it.id}`;
  body.innerHTML = `
    <button type="button" class="btn btn-primary btn-block" id="sh-link">Share link</button>
    <div class="section-title">Send to a friend</div>
    <div id="sh-friends">Loading…</div>`;

  body.querySelector("#sh-link").addEventListener("click", async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "MATCHBOOK", text: `${it.uploader.name} · ${reelRouteLabel(it)}`, url: link }); } catch { /* sheet dismissed */ }
      return;
    }
    try { await navigator.clipboard.writeText(link); showToast("Link copied"); } catch { window.prompt("Copy this link", link); }
  });

  getAcceptedFriends().then((friends) => {
    const box = body.querySelector("#sh-friends");
    box.innerHTML = friends.length
      ? friends.map((f) => `
          <div class="cm-row">
            <div class="cm-body"><b>${escapeHtml(f.name)}</b></div>
            <button type="button" class="btn btn-outline btn-sm" data-send="${f.id}">Send</button>
          </div>`).join("")
      : `<div class="empty-state">Add friends in the Friends tab to send them videos.</div>`;
    box.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-send]");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try { await sendMessage(btn.dataset.send, { reelId: it.id }); btn.textContent = "Sent"; } catch (err) { btn.disabled = false; showToast(err.message); }
    });
  }).catch((err) => { body.querySelector("#sh-friends").textContent = err.message; });
}
