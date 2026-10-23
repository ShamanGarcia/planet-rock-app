import {
  getCurrentUser, getConversations, getThread, sendMessage, getIncomingRequests, getOutgoingRequests,
  sendFriendRequest, respondToRequest, removeFriend, searchUsers,
} from "../data/api.js";
import { escapeHtml, initials, dismissOverlay, ringStyle } from "../utils.js";
import { showToast } from "../components/toast.js";
import { reelRouteLabel } from "./reel.js";

// No websockets on the stdlib server, so an open chat polls instead.
const THREAD_POLL_MS = 4000;
const LIST_POLL_MS = 10000;

const avatar = (u) => `<div class="avatar sm"${ringStyle(u)}>${u.profilePicture ? `<img src="${escapeHtml(u.profilePicture)}" alt=""/>` : escapeHtml(initials(u.name))}</div>`;
const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function messageHTML(m, me) {
  const reel = !m.reelId ? "" : m.reel
    ? `<a class="msg-reel" href="#/reel/${m.reel.id}">
         <div class="msg-reel-body"><b>${escapeHtml(m.reel.uploader.name)}'s video</b><span>${escapeHtml(reelRouteLabel(m.reel))}</span></div>
         <span class="btn btn-primary btn-sm">Watch</span>
       </a>`
    : `<div class="msg-reel gone">Video no longer available</div>`;
  return `
    <div class="msg ${m.fromUserId === me ? "me" : "them"}">
      ${reel}
      ${m.text ? `<div class="msg-text">${escapeHtml(m.text)}</div>` : ""}
      <div class="msg-time">${when(m.createdAt)}</div>
    </div>`;
}

export function renderChat(container, chatId) {
  const me = getCurrentUser().id;
  let activeId = chatId || null;
  let convs = [], incoming = [], outgoing = [], results = [];
  let ready = false;
  let query = "";
  let threadSig = "";

  container.innerHTML = `
    <div class="page chat-page">
      <div class="chat-layout">
        <aside class="chat-side">
          <div class="chat-side-head">
            <h1>Friends</h1>
            <button type="button" class="btn btn-outline btn-sm" id="pending-btn">Pending<span class="chat-badge" hidden></span></button>
          </div>
          <input type="text" id="friend-search" placeholder="Find climbers by name or email…" value="${escapeHtml(query)}" aria-label="Find climbers"/>
          <div class="chat-list" id="chat-list"><div class="chat-note">Loading…</div></div>
        </aside>
        <section class="chat-main" id="chat-main"></section>
      </div>
    </div>`;
  const layout = container.querySelector(".chat-layout");
  const list = container.querySelector("#chat-list");
  const main = container.querySelector("#chat-main");
  const badge = container.querySelector(".chat-badge");

  // ---------- left: friends + search ----------
  function renderList() {
    badge.textContent = incoming.length;
    badge.hidden = !incoming.length;

    const searchRow = (u) => {
      let action;
      const req = incoming.find((i) => i.user.id === u.id);
      if (convs.some((c) => c.user.id === u.id)) action = `<span class="chip">Friends</span>`;
      else if (outgoing.some((o) => o.user.id === u.id)) action = `<span class="chip">Pending</span>`;
      else if (req) action = `<button type="button" class="btn btn-primary btn-sm" data-accept="${req.friendship.id}">Accept</button>`;
      else action = `<button type="button" class="btn btn-outline btn-sm" data-add="${u.id}">Add</button>`;
      return `<div class="chat-row static">${avatar(u)}<div class="cr-body"><div class="cr-name">${escapeHtml(u.name)}</div></div>${action}</div>`;
    };
    const friendRow = (c) => {
      const prev = c.last ? `${c.last.fromMe ? "You: " : ""}${c.last.isReel ? "Shared a video" : c.last.text}` : "Say hi";
      const unread = c.unread && c.user.id !== activeId ? `<span class="chat-dot">${c.unread}</span>` : "";
      return `<button type="button" class="chat-row ${c.user.id === activeId ? "active" : ""}" data-chat="${c.user.id}">
        ${avatar(c.user)}<div class="cr-body"><div class="cr-name">${escapeHtml(c.user.name)}</div><div class="cr-prev">${escapeHtml(prev)}</div></div>${unread}
      </button>`;
    };

    list.innerHTML = `
      ${query ? `<div class="chat-section">Search results</div>${results.length ? results.map(searchRow).join("") : `<div class="chat-note">No climbers found.</div>`}<div class="chat-section">Friends</div>` : ""}
      ${convs.length ? convs.map(friendRow).join("") : `<div class="chat-note">Search above to add your first climbing friend.</div>`}`;
  }

  async function refreshLists() {
    [convs, incoming, outgoing] = await Promise.all([getConversations(), getIncomingRequests(), getOutgoingRequests()]);
    const q = query;
    const found = q ? await searchUsers(q) : [];
    if (q !== query) return; // typed on while this was loading
    results = found;
    const firstLoad = !ready;
    ready = true;
    renderList();
    if (firstLoad) renderMain();
  }

  container.querySelector("#friend-search").addEventListener("input", (e) => {
    query = e.target.value.trim();
    refreshLists().catch((err) => showToast(err.message));
  });

  list.addEventListener("click", async (e) => {
    const chat = e.target.closest("[data-chat]")?.dataset.chat;
    if (chat) return open(chat);
    const add = e.target.closest("[data-add]")?.dataset.add;
    const accept = e.target.closest("[data-accept]")?.dataset.accept;
    try {
      if (add) { await sendFriendRequest(add); showToast("Friend request sent"); }
      else if (accept) { await respondToRequest(accept, true); showToast("Friend added"); }
      else return;
      await refreshLists();
    } catch (err) { showToast(err.message); }
  });

  // ---------- right: conversation ----------
  // Selecting a chat swaps the pane in place (no route change, so no page transition);
  // replaceState keeps the URL shareable and Back/Watch round-trips landing on this chat.
  function open(id) {
    activeId = id;
    threadSig = "";
    history.replaceState(null, "", id ? `#/friends/chat/${id}` : "#/friends");
    renderMain();
    renderList();
  }

  function renderMain() {
    layout.classList.toggle("has-chat", !!activeId);
    if (!activeId) { main.innerHTML = `<div class="chat-empty">Pick a friend to start chatting.</div>`; return; }
    const conv = convs.find((c) => c.user.id === activeId);
    if (!conv) { main.innerHTML = `<div class="chat-empty">${ready ? "You can only message friends." : "Loading…"}</div>`; return; }
    main.innerHTML = `
      <div class="chat-head">
        <button type="button" class="chat-back" id="chat-back" aria-label="Back to friends">&lsaquo;</button>
        <a class="chat-who" href="#/friends/${conv.user.id}">${avatar(conv.user)}<span>${escapeHtml(conv.user.name)}</span></a>
      </div>
      <div class="chat-thread" id="chat-thread"></div>
      <form class="chat-form" id="chat-form">
        <input id="chat-input" maxlength="1000" placeholder="Message…" autocomplete="off" aria-label="Message"/>
        <button type="submit" class="btn btn-primary">Send</button>
      </form>`;
    main.querySelector("#chat-back").addEventListener("click", () => open(null));
    main.querySelector("#chat-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = main.querySelector("#chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try { await sendMessage(activeId, { text }); } catch (err) { showToast(err.message); input.value = text; return; }
      await loadThread(true);
      refreshLists().catch(() => {});
    });
    loadThread(true).then(() => refreshLists().catch(() => {})); // fetching marks messages read, so the list's unread dot clears
  }

  async function loadThread(stick) {
    const id = activeId;
    const el = main.querySelector("#chat-thread");
    if (!id || !el) return;
    let thread;
    try { thread = await getThread(id); } catch { return; }
    if (id !== activeId) return;
    const sig = `${thread.length}:${thread.at(-1)?.id || ""}`;
    if (sig === threadSig) return;
    threadSig = sig;
    const atBottom = stick || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = thread.length ? thread.map((m) => messageHTML(m, me)).join("") : `<div class="chat-note">No messages yet. Say hi.</div>`;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // ---------- pending requests popup ----------
  container.querySelector("#pending-btn").addEventListener("click", () => {
    const backdrop = document.createElement("div");
    backdrop.className = "mini-popup-backdrop";
    document.body.appendChild(backdrop);
    const close = () => dismissOverlay(backdrop);

    function render() {
      const row = (u, actions) => `<div class="chat-row static">${avatar(u)}<div class="cr-body"><div class="cr-name">${escapeHtml(u.name)}</div></div><div class="pd-actions">${actions}</div></div>`;
      backdrop.innerHTML = `
        <div class="mini-popup pending-popup" role="dialog" aria-modal="true" aria-label="Pending requests">
          <button type="button" class="cp-close" id="pd-close" aria-label="Close">&times;</button>
          <div class="mini-popup-title">Pending</div>
          <div class="pending-list">
            ${incoming.length ? `<div class="chat-section">Wants to be your friend</div>${incoming.map(({ friendship, user }) =>
              row(user, `<button type="button" class="btn btn-primary btn-sm" data-accept="${friendship.id}">Accept</button><button type="button" class="btn btn-outline btn-sm" data-decline="${friendship.id}">Decline</button>`)).join("")}` : ""}
            ${outgoing.length ? `<div class="chat-section">Requests you sent</div>${outgoing.map(({ user }) =>
              row(user, `<button type="button" class="btn btn-outline btn-sm" data-cancel="${user.id}">Cancel</button>`)).join("")}` : ""}
            ${!incoming.length && !outgoing.length ? `<div class="chat-note">No pending requests.</div>` : ""}
          </div>
        </div>`;
    }
    render();

    backdrop.addEventListener("click", async (e) => {
      if (e.target === backdrop || e.target.closest("#pd-close")) return close();
      const accept = e.target.closest("[data-accept]")?.dataset.accept;
      const decline = e.target.closest("[data-decline]")?.dataset.decline;
      const cancel = e.target.closest("[data-cancel]")?.dataset.cancel;
      try {
        if (accept) { await respondToRequest(accept, true); showToast("Friend added"); }
        else if (decline) await respondToRequest(decline, false);
        else if (cancel) await removeFriend(cancel);
        else return;
        await refreshLists();
        render();
      } catch (err) { showToast(err.message); }
    });
  });

  // ---------- go ----------
  renderMain();
  refreshLists().catch((err) => { list.innerHTML = `<div class="chat-note">${escapeHtml(err.message)}</div>`; });
  const threadTimer = setInterval(() => { if (!document.hidden) loadThread(false); }, THREAD_POLL_MS);
  const listTimer = setInterval(() => { if (!document.hidden) refreshLists().catch(() => {}); }, LIST_POLL_MS);
  return () => { clearInterval(threadTimer); clearInterval(listTimer); };
}
