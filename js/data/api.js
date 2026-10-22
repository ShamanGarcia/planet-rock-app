// Thin fetch-based client for the Planet Rock backend (backend/server.py).
// This replaces the old localStorage-only db.js: every call here hits a
// shared server, so a route added (or a vote cast) on one device shows up
// for everyone else too.
//
// The current session (user + selected gym) is cached in memory after boot
// so read-only "who am I" checks stay synchronous for view code, while
// everything that reads/writes shared data (routes, log, friends, ...) is
// async and goes over the network.

import { ADMIN_PASSWORD, isAdminUnlocked } from "../adminAuth.js";

const TOKEN_KEY = "planetRockToken";
let session = null; // { user, gymId }

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new Error("Can't reach the Planet Rock server. Is it running?");
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ===================== Session / Auth =====================

export async function bootSession() {
  if (!getToken()) { session = null; return null; }
  try {
    const data = await request("GET", "/api/session");
    session = data;
    return data;
  } catch {
    setToken(null);
    session = null;
    return null;
  }
}

export function getCurrentUser() {
  return session?.user || null;
}

export function getCurrentGymId() {
  return session?.gymId || null;
}

export async function setCurrentGym(gymId) {
  await request("PATCH", "/api/session", { gymId });
  if (session) session.gymId = gymId;
}

export async function signUp({ name, email, password }) {
  const data = await request("POST", "/api/auth/signup", { name, email, password });
  setToken(data.token);
  session = { user: data.user, gymId: data.gymId };
  return data.user;
}

export async function logIn(email, password) {
  const data = await request("POST", "/api/auth/login", { email, password });
  setToken(data.token);
  session = { user: data.user, gymId: data.gymId };
  return data.user;
}

export async function logOut() {
  try { await request("POST", "/api/auth/logout"); } catch { /* token may already be gone */ }
  setToken(null);
  session = null;
}

export async function requestPasswordReset(email) {
  await request("POST", "/api/auth/reset-request", { email });
  return true;
}

export async function confirmPasswordReset(email, code, password) {
  await request("POST", "/api/auth/reset-confirm", { email, code, password });
  return true;
}

// ===================== Gyms =====================

export function getGyms() {
  return request("GET", "/api/gyms");
}

export function resetWallSection(gymId, wallSection, routesetterKey) {
  return request("POST", `/api/gyms/${gymId}/wall-sections/${wallSection}/reset`, { routesetterKey });
}

// ===================== Tags =====================

export function getAllTags() {
  return request("GET", "/api/tags");
}

// ===================== Routes =====================

export function getRoutes(gymId, { includeInactive = false } = {}) {
  const qs = new URLSearchParams({ gymId, ...(includeInactive ? { includeInactive: "1" } : {}) });
  return request("GET", `/api/routes?${qs.toString()}`);
}

// Lean records of routes the gym has since retired (reset or deleted), for all-time stats.
export function getRouteHistory(gymId) {
  return request("GET", `/api/gyms/${gymId}/route-history`);
}

export function getRouteDetail(routeId) {
  return request("GET", `/api/routes/${routeId}/detail`);
}

export function createRoute(payload) {
  return request("POST", "/api/routes", payload);
}

export function updateRoute(routeId, patch) {
  return request("PATCH", `/api/routes/${routeId}`, patch);
}

export function deleteRoute(routeId, password) {
  return request("DELETE", `/api/routes/${routeId}`, { password });
}

export function addTagToRoute(routeId, tagName) {
  return request("POST", `/api/routes/${routeId}/tags`, { name: tagName });
}

export function submitGradeEstimate(routeId, grade) {
  return request("POST", `/api/routes/${routeId}/estimate`, { grade });
}

export function logSend(routeId, { flash } = {}) {
  return request("POST", `/api/routes/${routeId}/log`, { flash: !!flash });
}

export function getRouteMedia(routeId) {
  return request("GET", `/api/routes/${routeId}/media`);
}

// The uploader can always remove their own; an unlocked admin can remove anyone's.
export function deleteMedia(mediaId) {
  return request("DELETE", `/api/media/${mediaId}`, isAdminUnlocked() ? { adminPassword: ADMIN_PASSWORD } : {});
}

// ===================== Chunked uploads (see data/upload.js) =====================

export function startUpload(kind, size) {
  return request("POST", "/api/uploads", { kind, size });
}

export function getUploadStatus(uploadId) {
  return request("GET", `/api/uploads/${uploadId}`);
}

export function abortUpload(uploadId) {
  return request("DELETE", `/api/uploads/${uploadId}`);
}

export function completeUpload(uploadId, { routeId, visibility, logEntryId, posterDataUrl }) {
  return request("POST", `/api/uploads/${uploadId}/complete`, { routeId, visibility, logEntryId, posterDataUrl });
}

// One raw-binary chunk. XHR (not fetch) because only XHR reports upload progress.
// Resolves {status, data} for any HTTP answer; rejects only when the network failed.
export function uploadChunk(uploadId, offset, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/uploads/${uploadId}?offset=${offset}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* empty body */ }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("network"));
    xhr.timeout = 60000;
    xhr.send(blob);
  });
}

// ===================== Users =====================

export function getUser(id) {
  return request("GET", `/api/users/${id}`);
}

export async function updateUser(id, patch) {
  const user = await request("PATCH", `/api/users/${id}`, patch);
  if (session?.user?.id === id) session.user = user;
  return user;
}

const adminQuery = (adminPassword) => (adminPassword ? `?adminPassword=${encodeURIComponent(adminPassword)}` : "");

export function getLogEntries(userId, adminPassword) {
  return request("GET", `/api/users/${userId}/log${adminQuery(adminPassword)}`);
}

export function deleteLogEntry(logId) {
  return request("DELETE", `/api/log/${logId}`);
}

export function computeUserStats(userId, adminPassword) {
  return request("GET", `/api/users/${userId}/stats${adminQuery(adminPassword)}`);
}

export function searchUsers(query) {
  return request("GET", `/api/users/search?q=${encodeURIComponent(query)}`);
}

// ===================== Friends =====================

export function getAcceptedFriends() {
  return request("GET", "/api/friends");
}

export function getIncomingRequests() {
  return request("GET", "/api/friends/incoming");
}

export function getOutgoingRequests() {
  return request("GET", "/api/friends/outgoing");
}

export function sendFriendRequest(targetUserId) {
  return request("POST", "/api/friends/request", { targetUserId });
}

export function respondToRequest(friendshipId, accept) {
  return request("POST", "/api/friends/respond", { friendshipId, accept });
}

export function removeFriend(friendUserId) {
  return request("POST", "/api/friends/remove", { friendUserId });
}

// ===================== Messages =====================

export function getConversations() {
  return request("GET", "/api/conversations");
}

export function getThread(friendId) {
  return request("GET", `/api/messages/${friendId}`);
}

export function sendMessage(friendId, { text, reelId } = {}) {
  return request("POST", `/api/messages/${friendId}`, { text, reelId });
}

// ===================== Reel (public route videos) =====================

export function getReel(gymId, { sort = "recent", offset = 0, limit = 6 } = {}) {
  const qs = new URLSearchParams({ gymId, sort, offset, limit });
  return request("GET", `/api/reel?${qs.toString()}`);
}

export function getReelItem(id) {
  return request("GET", `/api/reel/${id}`);
}

export function toggleReelLike(id) {
  return request("POST", `/api/reel/${id}/like`);
}

export function getReelComments(id) {
  return request("GET", `/api/reel/${id}/comments`);
}

export function addReelComment(id, text) {
  return request("POST", `/api/reel/${id}/comments`, { text });
}

export function deleteReelComment(id, commentId) {
  return request("DELETE", `/api/reel/${id}/comments/${commentId}`);
}

// ===================== Relationship helper (small, so views don't each reimplement it) ====

export async function relationshipWith(otherUserId) {
  const [friends, outgoing, incoming] = await Promise.all([getAcceptedFriends(), getOutgoingRequests(), getIncomingRequests()]);
  if (friends.some((f) => f.id === otherUserId)) return "accepted";
  if (outgoing.some((o) => o.user.id === otherUserId)) return "outgoing";
  const inReq = incoming.find((i) => i.user.id === otherUserId);
  if (inReq) return { status: "incoming", friendship: inReq.friendship };
  return "none";
}

// ===================== Admin =====================

export function adminListUsers(password) {
  return request("GET", `/api/admin/users?password=${encodeURIComponent(password)}`);
}
export function adminGetStats(password) {
  return request("GET", `/api/admin/stats?password=${encodeURIComponent(password)}`);
}

export function adminDeleteUser(userId, password) {
  return request("DELETE", `/api/admin/users/${userId}`, { password });
}

export function adminDeleteTag(tagId, password) {
  return request("DELETE", `/api/admin/tags/${tagId}`, { password });
}

// getRoutes(gymId) always stuffs gymId into the querystring, and
// URLSearchParams serializes `undefined` as the literal string "undefined"
// (which the backend would then treat as a real, wrong, gym filter) — so
// admin's cross-gym listing needs its own call instead of getRoutes(undefined).
export function getAllRoutesForAdmin() {
  return request("GET", "/api/routes?includeInactive=1");
}
