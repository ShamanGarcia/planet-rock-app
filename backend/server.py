"""Planet Rock backend.

A dependency-free (stdlib only) HTTP server that:
  - Serves the frontend static files (so everything runs same-origin).
  - Exposes a small JSON REST API backed by a single db.json file on disk,
    which is the shared source of truth for every browser/device that talks
    to this server (this is what makes routes/votes/sends "dynamic" instead
    of being trapped in one browser's localStorage).
  - Accepts uploaded route photos (base64 data URLs) and serves them back
    from /uploads/<file>.

Run: python backend/server.py [port]
"""
import base64
import json
import mimetypes
import os
import re
import secrets
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from auth_util import hash_password, verify_password
from seed_data import build_seed_data

BACKEND_DIR = Path(__file__).resolve().parent
STATIC_DIR = BACKEND_DIR.parent
# DATA_DIR points at a Render persistent disk (or any mounted volume) when
# the DATA_DIR env var is set; falls back to a folder next to this file for
# local runs, where nothing needs to survive a restart anyway.
DATA_DIR = Path(os.environ.get("DATA_DIR") or (BACKEND_DIR / "data"))
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "db.json"
MAX_GRADE = 10

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

LOCK = threading.RLock()


def load_db():
    if DB_PATH.exists():
        with open(DB_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        db.setdefault("routeMedia", [])
        for route in db.get("routes", []):
            route.pop("name", None)
        for entry in db.get("climbingLog", []):
            entry.get("snapshot", {}).pop("routeName", None)
        return db
    db = build_seed_data()
    save_db(db)
    return db


def save_db(db):
    tmp = DB_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f)
    os.replace(tmp, DB_PATH)


DB = load_db()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def find(lst, **kwargs):
    for item in lst:
        if all(item.get(k) == v for k, v in kwargs.items()):
            return item
    return None


def find_user_by_email(email):
    email = (email or "").strip().lower()
    return next((u for u in DB["users"] if u["email"].lower() == email), None)


def public_user(user):
    return {k: v for k, v in user.items() if k != "password"}


def average(nums):
    return sum(nums) / len(nums) if nums else None


def mode_of(items):
    if not items:
        return None
    counts = {}
    for it in items:
        counts[it] = counts.get(it, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


# ===================== Domain helpers (all assume LOCK is held) =====================

def get_route(route_id):
    return find(DB["routes"], id=route_id)


def get_route_tag_details(route_id, current_user_id):
    joins = [rt for rt in DB["routeTags"] if rt["routeId"] == route_id]
    details = []
    for j in joins:
        tag = find(DB["tags"], id=j["tagId"])
        votes = [v for v in DB["tagVotes"] if v["routeId"] == route_id and v["tagId"] == j["tagId"]]
        score = sum(v["vote"] for v in votes)
        my_vote = next((v["vote"] for v in votes if v["userId"] == current_user_id), 0) if current_user_id else 0
        details.append({
            "tagId": j["tagId"], "name": tag["name"] if tag else "Unknown",
            "score": score, "myVote": my_vote, "votes": len(votes),
        })
    details.sort(key=lambda d: (-d["score"], d["name"]))
    return details


def get_community_grade(route_id):
    grades = [e["grade"] for e in DB["gradeEstimates"] if e["routeId"] == route_id]
    return average(grades)


def get_grade_distribution(route_id):
    counts = [0] * (MAX_GRADE + 1)
    for e in DB["gradeEstimates"]:
        if e["routeId"] == route_id:
            counts[e["grade"]] += 1
    return counts


def get_route_finishes(route_id):
    return len([l for l in DB["climbingLog"] if l["routeId"] == route_id])


def get_user_send_count(user_id, route_id):
    return len([l for l in DB["climbingLog"] if l["userId"] == user_id and l["routeId"] == route_id])


def get_user_estimate(route_id, user_id):
    return find(DB["gradeEstimates"], routeId=route_id, userId=user_id)


def get_route_media_count(route_id):
    return len([m for m in DB["routeMedia"] if m["routeId"] == route_id])


def route_summary(route, current_user_id=None):
    return {
        **route,
        "communityGrade": get_community_grade(route["id"]),
        "finishes": get_route_finishes(route["id"]),
        "mediaCount": get_route_media_count(route["id"]),
    }


def get_log_entries(user_id):
    entries = [l for l in DB["climbingLog"] if l["userId"] == user_id]
    result = []
    for l in entries:
        route = get_route(l["routeId"])
        estimate = get_community_grade(l["routeId"]) if route else None
        top_tags = [t for t in get_route_tag_details(l["routeId"], None) if t["score"] > 0][:3] if route else []
        result.append({**l, "route": route, "estimatedGrade": estimate, "topTags": top_tags})
    result.sort(key=lambda e: e["completedAt"], reverse=True)
    return result


def compute_user_stats(user_id):
    entries = get_log_entries(user_id)
    total = len(entries)
    graded = [e for e in entries if e["snapshot"].get("officialGrade") is not None]
    highest = max((e["snapshot"]["officialGrade"] for e in graded), default=None)

    grade_dist = [0] * (MAX_GRADE + 1)
    for e in graded:
        grade_dist[e["snapshot"]["officialGrade"]] += 1

    hold_dist = {}
    for e in entries:
        ht = e["snapshot"].get("holdType")
        if ht:
            hold_dist[ht] = hold_dist.get(ht, 0) + 1

    style_counts = {}
    for e in entries:
        for t in e["topTags"]:
            style_counts[t["name"]] = style_counts.get(t["name"], 0) + 1
    style_dist = sorted([{"name": k, "count": v} for k, v in style_counts.items()], key=lambda x: -x["count"])
    favorite_style = style_dist[0]["name"] if style_dist else None

    est_buckets = [0] * (MAX_GRADE + 1)
    for e in entries:
        if e["estimatedGrade"] is not None:
            est_buckets[round(e["estimatedGrade"])] += 1

    time_map = {}
    for e in entries:
        key = e["completedAt"][:7]
        time_map[key] = time_map.get(key, 0) + 1
    climbs_over_time = sorted(time_map.items())

    favorite_hold_calc = mode_of([e["snapshot"].get("holdType") for e in entries if e["snapshot"].get("holdType")])

    return {
        "totalClimbs": total, "highestGrade": highest, "gradeDistribution": grade_dist,
        "holdTypeDistribution": hold_dist, "styleDistribution": style_dist,
        "favoriteStyleCalculated": favorite_style, "estGradeDistribution": est_buckets,
        "climbsOverTime": climbs_over_time, "favoriteHoldTypeCalculated": favorite_hold_calc,
    }


def other_user_id(f, user_id):
    return f["friendUserId"] if f["userId"] == user_id else f["userId"]


def get_accepted_friend_ids(user_id):
    return {
        other_user_id(f, user_id) for f in DB["friendships"]
        if f["status"] == "accepted" and user_id in (f["userId"], f["friendUserId"])
    }


def relationship(user_id, other_id):
    if other_id in get_accepted_friend_ids(user_id):
        return "accepted"
    if find(DB["friendships"], userId=user_id, friendUserId=other_id, status="pending"):
        return "outgoing"
    if find(DB["friendships"], userId=other_id, friendUserId=user_id, status="pending"):
        return "incoming"
    return "none"


IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
VIDEO_EXT = {"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v"}
# The browser already compresses photos and keeps anything over
# SHARED_MEDIA_LIMIT_BYTES (see constants.js) on-device instead of uploading
# it, so these are just a defensive backstop against a direct API call.
MAX_PHOTO_BYTES = 6 * 1024 * 1024
MAX_VIDEO_BYTES = 6 * 1024 * 1024


def route_dir(route_id):
    d = UPLOADS_DIR / "routes" / route_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_route_media_file(route_id, data_url):
    """Saves a photo or video data URL into that route's own directory
    (uploads/routes/<routeId>/...) and returns (kind, url)."""
    m = re.match(r"^data:([\w./+-]+);base64,(.*)$", data_url, re.DOTALL)
    if not m:
        raise ValueError("Unrecognized file data.")
    mime, b64 = m.group(1), m.group(2)
    if mime in IMAGE_EXT:
        kind, ext, cap = "photo", IMAGE_EXT[mime], MAX_PHOTO_BYTES
    elif mime in VIDEO_EXT:
        kind, ext, cap = "video", VIDEO_EXT[mime], MAX_VIDEO_BYTES
    else:
        raise ValueError(f"Unsupported file type: {mime}")
    raw = base64.b64decode(b64)
    if len(raw) > cap:
        raise ValueError(f"{'Photo' if kind == 'photo' else 'Video'} too large (max {cap // (1024 * 1024)}MB).")
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(route_dir(route_id) / filename, "wb") as f:
        f.write(raw)
    return kind, f"/uploads/routes/{route_id}/{filename}"


def add_route_media(route_id, user_id, kind, url, log_entry_id=None):
    media = {
        "id": uid("media"), "routeId": route_id, "type": kind, "url": url,
        "uploadedBy": user_id, "logEntryId": log_entry_id, "createdAt": now_iso(),
    }
    DB["routeMedia"].append(media)
    route = get_route(route_id)
    if route is not None and not route.get("photoUrl") and kind == "photo":
        route["photoUrl"] = url
    return media


def get_route_media(route_id):
    items = [m for m in DB["routeMedia"] if m["routeId"] == route_id]
    items.sort(key=lambda m: m["createdAt"], reverse=True)
    out = []
    for m in items:
        uploader = find(DB["users"], id=m["uploadedBy"])
        out.append({**m, "uploadedByName": uploader["name"] if uploader else "Unknown"})
    return out


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    server_version = "PlanetRock/1.0"

    def log_message(self, fmt, *args):
        pass  # keep stdout clean; flip on for debugging

    # ---------- low level helpers ----------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        try:
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON body.")

    def _auth(self, required=True):
        header = self.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else None
        session = DB["sessions"].get(token) if token else None
        if not session:
            if required:
                raise ApiError(401, "Not authenticated.")
            return None, None
        user = find(DB["users"], id=session["userId"])
        if not user:
            if required:
                raise ApiError(401, "Not authenticated.")
            return None, None
        return session, user

    def _serve_file(self, base_dir, rel_path):
        file_path = (base_dir / rel_path.lstrip("/")).resolve()
        try:
            file_path.relative_to(base_dir.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        ctype, _ = mimetypes.guess_type(str(file_path))
        data = file_path.read_bytes()
        try:
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass  # client navigated away / cancelled the request mid-response

    # ---------- HTTP verbs ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        parsed = urlsplit(self.path)
        path = parsed.path
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/"):
                with LOCK:
                    self._route_api(method, path, qs)
            elif path.startswith("/uploads/"):
                self._serve_file(UPLOADS_DIR, path[len("/uploads/"):])
            else:
                self._serve_file(STATIC_DIR, "index.html" if path == "/" else path)
        except ApiError as e:
            try:
                self._json(e.status, {"error": e.message})
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                pass
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass  # client disconnected mid-request; nothing to report
        except Exception as e:  # pragma: no cover - defensive
            try:
                self._json(500, {"error": str(e)})
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                pass

    # ---------- API routing ----------
    def _route_api(self, method, path, qs):
        m = re.match(r"^/api/routes/([^/]+)/tags/([^/]+)/vote$", path)
        if method == "POST" and m:
            return self._vote_tag(m.group(1), m.group(2))
        m = re.match(r"^/api/routes/([^/]+)/tags$", path)
        if method == "GET" and m:
            return self._get_route_tags(m.group(1))
        if method == "POST" and m:
            return self._add_route_tag(m.group(1))
        m = re.match(r"^/api/routes/([^/]+)/estimate$", path)
        if method == "POST" and m:
            return self._submit_estimate(m.group(1))
        m = re.match(r"^/api/routes/([^/]+)/log$", path)
        if method == "POST" and m:
            return self._log_send(m.group(1))
        m = re.match(r"^/api/routes/([^/]+)/detail$", path)
        if method == "GET" and m:
            return self._route_detail(m.group(1))
        m = re.match(r"^/api/routes/([^/]+)/media$", path)
        if method == "GET" and m:
            return self._get_media(m.group(1))
        if method == "POST" and m:
            return self._post_media(m.group(1))
        m = re.match(r"^/api/routes/([^/]+)$", path)
        if method == "GET" and m:
            return self._get_route(m.group(1))
        if method == "PATCH" and m:
            return self._update_route(m.group(1))
        if path == "/api/routes" and method == "GET":
            return self._list_routes(qs)
        if path == "/api/routes" and method == "POST":
            return self._create_route()

        if path == "/api/gyms" and method == "GET":
            return self._json(200, DB["gyms"])
        m = re.match(r"^/api/gyms/([^/]+)$", path)
        if method == "GET" and m:
            gym = find(DB["gyms"], id=m.group(1))
            return self._json(200, gym) if gym else self._json(404, {"error": "Gym not found"})

        if path == "/api/tags" and method == "GET":
            return self._json(200, DB["tags"])

        if path == "/api/session" and method == "GET":
            session, user = self._auth()
            return self._json(200, {"user": public_user(user), "gymId": session.get("gymId")})
        if path == "/api/session" and method == "PATCH":
            session, user = self._auth()
            body = self._body()
            session["gymId"] = body.get("gymId", session.get("gymId"))
            save_db(DB)
            return self._json(200, {"gymId": session["gymId"]})

        if path == "/api/auth/signup" and method == "POST":
            return self._signup()
        if path == "/api/auth/login" and method == "POST":
            return self._login()
        if path == "/api/auth/logout" and method == "POST":
            return self._logout()
        if path == "/api/auth/reset-request" and method == "POST":
            return self._reset_request()
        if path == "/api/auth/reset-confirm" and method == "POST":
            return self._reset_confirm()

        m = re.match(r"^/api/users/([^/]+)/log$", path)
        if method == "GET" and m:
            return self._user_log(m.group(1))
        m = re.match(r"^/api/log/([^/]+)$", path)
        if method == "DELETE" and m:
            return self._delete_log_entry(m.group(1))
        m = re.match(r"^/api/users/([^/]+)/stats$", path)
        if method == "GET" and m:
            return self._user_stats(m.group(1))
        if path == "/api/users/search" and method == "GET":
            return self._search_users(qs.get("q", ""))
        m = re.match(r"^/api/users/([^/]+)$", path)
        if method == "GET" and m:
            return self._get_user(m.group(1))
        if method == "PATCH" and m:
            return self._update_user(m.group(1))

        if path == "/api/friends" and method == "GET":
            return self._friends_list()
        if path == "/api/friends/incoming" and method == "GET":
            return self._friends_incoming()
        if path == "/api/friends/outgoing" and method == "GET":
            return self._friends_outgoing()
        if path == "/api/friends/request" and method == "POST":
            return self._friends_request()
        if path == "/api/friends/respond" and method == "POST":
            return self._friends_respond()
        if path == "/api/friends/remove" and method == "POST":
            return self._friends_remove()

        raise ApiError(404, f"No such endpoint: {method} {path}")

    # ---------- Auth ----------
    def _signup(self):
        body = self._body()
        name, email, password = body.get("name", "").strip(), body.get("email", "").strip(), body.get("password", "")
        if not name or not email or not password:
            raise ApiError(400, "Name, email and password are required.")
        if find_user_by_email(email):
            raise ApiError(409, "An account with that email already exists.")
        user = {
            "id": uid("user"), "email": email, "password": hash_password(password), "name": name,
            "profilePicture": None, "age": None, "hometown": None, "climbingStartDate": None,
            "favoriteHoldType": None, "selfReportedHighestGrade": None,
            "privacy": {"profilePublic": True, "logPublic": True}, "createdAt": now_iso(),
        }
        DB["users"].append(user)
        token = secrets.token_hex(20)
        DB["sessions"][token] = {"userId": user["id"], "gymId": DB["gyms"][0]["id"] if DB["gyms"] else None}
        save_db(DB)
        self._json(201, {"token": token, "user": public_user(user), "gymId": DB["sessions"][token]["gymId"]})

    def _login(self):
        body = self._body()
        email, password = body.get("email", "").strip(), body.get("password", "")
        user = find_user_by_email(email)
        if not user or not verify_password(password, user["password"]):
            raise ApiError(401, "Invalid email or password.")
        token = secrets.token_hex(20)
        DB["sessions"][token] = {"userId": user["id"], "gymId": DB["gyms"][0]["id"] if DB["gyms"] else None}
        save_db(DB)
        self._json(200, {"token": token, "user": public_user(user), "gymId": DB["sessions"][token]["gymId"]})

    def _logout(self):
        header = self.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else None
        if token in DB["sessions"]:
            del DB["sessions"][token]
            save_db(DB)
        self._json(200, {"ok": True})

    def _reset_request(self):
        body = self._body()
        user = find_user_by_email(body.get("email", ""))
        if not user:
            raise ApiError(404, "No account found with that email.")
        self._json(200, {"ok": True})

    def _reset_confirm(self):
        body = self._body()
        if body.get("code") != "000000":
            raise ApiError(400, "Invalid reset code.")
        user = find_user_by_email(body.get("email", ""))
        if not user:
            raise ApiError(404, "No account found with that email.")
        user["password"] = hash_password(body.get("password", ""))
        save_db(DB)
        self._json(200, {"ok": True})

    # ---------- Routes ----------
    def _list_routes(self, qs):
        gym_id = qs.get("gymId")
        include_inactive = qs.get("includeInactive") == "1"
        routes = [r for r in DB["routes"] if (not gym_id or r["gymId"] == gym_id) and (include_inactive or r["active"])]
        self._json(200, [route_summary(r) for r in routes])

    def _get_route(self, route_id):
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        self._json(200, route_summary(route))

    def _route_detail(self, route_id):
        _, user = self._auth(required=False)
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        uid_ = user["id"] if user else None
        self._json(200, {
            "route": route,
            "tagDetails": get_route_tag_details(route_id, uid_),
            "communityGrade": get_community_grade(route_id),
            "gradeDistribution": get_grade_distribution(route_id),
            "finishes": get_route_finishes(route_id),
            "mySends": get_user_send_count(uid_, route_id) if uid_ else 0,
            "myEstimate": (get_user_estimate(route_id, uid_) or {}).get("grade") if uid_ else None,
            "media": get_route_media(route_id),
        })

    def _get_media(self, route_id):
        if not get_route(route_id):
            raise ApiError(404, "Route not found.")
        self._json(200, get_route_media(route_id))

    def _post_media(self, route_id):
        _, user = self._auth()
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        body = self._body()
        if not body.get("dataUrl"):
            raise ApiError(400, "dataUrl is required.")
        try:
            kind, url = save_route_media_file(route_id, body["dataUrl"])
        except ValueError as e:
            raise ApiError(400, str(e))
        media = add_route_media(route_id, user["id"], kind, url)
        save_db(DB)
        self._json(201, media)

    def _create_route(self):
        _, user = self._auth()
        body = self._body()
        gym_id = body.get("gymId")
        if not gym_id or body.get("mapX") is None or body.get("mapY") is None:
            raise ApiError(400, "gymId, mapX and mapY are required.")
        if not find(DB["gyms"], id=gym_id):
            raise ApiError(404, "Gym not found.")

        hold_type = body.get("holdType") or "Jug"
        hold_color = body.get("holdColor") or "Red"
        official_grade = body.get("officialGrade")
        if official_grade in (None, ""):
            official_grade = None
        else:
            official_grade = max(0, min(MAX_GRADE, int(official_grade)))

        tag_ids = []
        for tag_name in body.get("tags") or []:
            tag_name = tag_name.strip()
            if not tag_name:
                continue
            tag = find(DB["tags"], name=tag_name) or {"id": uid("tag"), "name": tag_name}
            if not find(DB["tags"], id=tag["id"]):
                DB["tags"].append(tag)
            tag_ids.append(tag["id"])

        route = {
            "id": uid("route"), "gymId": gym_id,
            "wallSection": body.get("wallSection"),
            "mapX": float(body["mapX"]), "mapY": float(body["mapY"]),
            "holdType": hold_type, "holdTypes": body.get("holdTypes") or [hold_type],
            "holdColor": hold_color, "officialGrade": official_grade,
            "tags": tag_ids, "photoUrl": None,
            "createdAt": now_iso(), "createdBy": user["id"], "active": True,
        }
        DB["routes"].append(route)
        for tag_id in tag_ids:
            DB["routeTags"].append({"id": uid("rtag"), "routeId": route["id"], "tagId": tag_id})

        if body.get("photoDataUrl"):
            try:
                kind, url = save_route_media_file(route["id"], body["photoDataUrl"])
                add_route_media(route["id"], user["id"], kind, url)
            except ValueError as e:
                raise ApiError(400, str(e))

        save_db(DB)
        self._json(201, route_summary(route))

    def _update_route(self, route_id):
        _, user = self._auth()
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        body = self._body()
        for field in ["wallSection", "mapX", "mapY", "holdType", "holdTypes",
                      "holdColor", "officialGrade", "active", "photoUrl"]:
            if field in body:
                route[field] = body[field]
        save_db(DB)
        self._json(200, route_summary(route))

    def _get_route_tags(self, route_id):
        _, user = self._auth(required=False)
        self._json(200, get_route_tag_details(route_id, user["id"] if user else None))

    def _add_route_tag(self, route_id):
        _, user = self._auth()
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        body = self._body()
        name = (body.get("name") or "").strip()
        if not name:
            raise ApiError(400, "Tag name is required.")
        tag = find(DB["tags"], name=name)
        if not tag:
            tag = {"id": uid("tag"), "name": name}
            DB["tags"].append(tag)
        if not find(DB["routeTags"], routeId=route_id, tagId=tag["id"]):
            DB["routeTags"].append({"id": uid("rtag"), "routeId": route_id, "tagId": tag["id"]})
            route["tags"].append(tag["id"])
            save_db(DB)
        self._json(201, tag)

    def _vote_tag(self, route_id, tag_id):
        _, user = self._auth()
        body = self._body()
        vote = 1 if body.get("vote") in (1, "1", True) else -1
        existing = find(DB["tagVotes"], routeId=route_id, tagId=tag_id, userId=user["id"])
        if existing:
            if existing["vote"] == vote:
                DB["tagVotes"].remove(existing)
            else:
                existing["vote"] = vote
        else:
            DB["tagVotes"].append({"id": uid("vote"), "routeId": route_id, "tagId": tag_id, "userId": user["id"], "vote": vote})
        save_db(DB)
        self._json(200, {"ok": True})

    def _submit_estimate(self, route_id):
        _, user = self._auth()
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        body = self._body()
        try:
            grade = max(0, min(MAX_GRADE, round(float(body.get("grade")))))
        except (TypeError, ValueError):
            raise ApiError(400, "grade must be a number 0-10.")
        existing = get_user_estimate(route_id, user["id"])
        if existing:
            existing["grade"] = grade
            existing["updatedAt"] = now_iso()
        else:
            DB["gradeEstimates"].append({
                "id": uid("est"), "routeId": route_id, "userId": user["id"], "grade": grade,
                "createdAt": now_iso(), "updatedAt": now_iso(),
            })
        save_db(DB)
        self._json(200, {"ok": True})

    def _log_send(self, route_id):
        _, user = self._auth()
        route = get_route(route_id)
        if not route:
            raise ApiError(404, "Route not found.")
        body = self._body()
        now = datetime.now(timezone.utc)
        recent = [l for l in DB["climbingLog"] if l["userId"] == user["id"] and l["routeId"] == route_id]
        for l in recent:
            try:
                completed = datetime.fromisoformat(l["completedAt"].replace("Z", "+00:00"))
            except ValueError:
                continue
            if (now - completed).total_seconds() < 8:
                return self._json(200, {"ok": True, "entry": l, "duplicate": True})
        entry = {
            "id": uid("log"), "userId": user["id"], "routeId": route_id, "completedAt": now_iso(),
            "snapshot": {
                "holdColor": route["holdColor"], "holdType": route["holdType"],
                "officialGrade": route["officialGrade"],
            },
        }
        DB["climbingLog"].append(entry)

        media = None
        if body.get("mediaDataUrl"):
            try:
                kind, url = save_route_media_file(route_id, body["mediaDataUrl"])
                media = add_route_media(route_id, user["id"], kind, url, log_entry_id=entry["id"])
            except ValueError as e:
                raise ApiError(400, str(e))

        save_db(DB)
        self._json(201, {"ok": True, "entry": entry, "media": media})

    # ---------- Users ----------
    def _visible_profile(self, target, viewer):
        if viewer and (viewer["id"] == target["id"] or relationship(viewer["id"], target["id"]) == "accepted"):
            return public_user(target)
        if target["privacy"]["profilePublic"]:
            return public_user(target)
        return {"id": target["id"], "name": target["name"], "privacy": target["privacy"]}

    def _get_user(self, user_id):
        _, viewer = self._auth(required=False)
        target = find(DB["users"], id=user_id)
        if not target:
            raise ApiError(404, "User not found.")
        self._json(200, self._visible_profile(target, viewer))

    def _update_user(self, user_id):
        _, user = self._auth()
        if user["id"] != user_id:
            raise ApiError(403, "You can only edit your own profile.")
        body = self._body()
        for field in ["name", "age", "hometown", "climbingStartDate", "favoriteHoldType",
                      "selfReportedHighestGrade", "profilePicture", "privacy"]:
            if field in body:
                user[field] = body[field]
        save_db(DB)
        self._json(200, public_user(user))

    def _can_view_log(self, target, viewer):
        if not target:
            return False
        if viewer and viewer["id"] == target["id"]:
            return True
        if viewer and relationship(viewer["id"], target["id"]) == "accepted" and target["privacy"]["logPublic"]:
            return True
        return False

    def _user_log(self, user_id):
        _, viewer = self._auth(required=False)
        target = find(DB["users"], id=user_id)
        if not self._can_view_log(target, viewer):
            raise ApiError(403, "This climbing log is not available to view.")
        self._json(200, get_log_entries(user_id))

    def _delete_log_entry(self, log_id):
        _, user = self._auth()
        entry = find(DB["climbingLog"], id=log_id)
        if not entry:
            raise ApiError(404, "Log entry not found.")
        if entry["userId"] != user["id"]:
            raise ApiError(403, "You can only delete your own log entries.")
        linked_media = [m for m in DB["routeMedia"] if m.get("logEntryId") == log_id]
        for m in linked_media:
            if m["url"].startswith("/uploads/"):
                (UPLOADS_DIR / m["url"][len("/uploads/"):]).unlink(missing_ok=True)
        DB["routeMedia"] = [m for m in DB["routeMedia"] if m.get("logEntryId") != log_id]
        DB["climbingLog"].remove(entry)
        save_db(DB)
        self._json(200, {"ok": True})

    def _user_stats(self, user_id):
        _, viewer = self._auth(required=False)
        target = find(DB["users"], id=user_id)
        if not target:
            raise ApiError(404, "User not found.")
        allowed = (viewer and viewer["id"] == user_id) or target["privacy"]["profilePublic"] or \
                  (viewer and relationship(viewer["id"], user_id) == "accepted")
        if not allowed:
            raise ApiError(403, "This profile is private.")
        self._json(200, compute_user_stats(user_id))

    def _search_users(self, q):
        _, viewer = self._auth()
        q = q.strip().lower()
        if not q:
            return self._json(200, [])
        results = [
            public_user(u) for u in DB["users"]
            if u["id"] != viewer["id"] and (q in u["name"].lower() or q in u["email"].lower())
        ]
        self._json(200, results)

    # ---------- Friends ----------
    def _friends_list(self):
        _, user = self._auth()
        ids = get_accepted_friend_ids(user["id"])
        self._json(200, [public_user(u) for u in DB["users"] if u["id"] in ids])

    def _friends_incoming(self):
        _, user = self._auth()
        reqs = [f for f in DB["friendships"] if f["friendUserId"] == user["id"] and f["status"] == "pending"]
        self._json(200, [{"friendship": f, "user": public_user(find(DB["users"], id=f["userId"]))} for f in reqs])

    def _friends_outgoing(self):
        _, user = self._auth()
        reqs = [f for f in DB["friendships"] if f["userId"] == user["id"] and f["status"] == "pending"]
        self._json(200, [{"friendship": f, "user": public_user(find(DB["users"], id=f["friendUserId"]))} for f in reqs])

    def _friends_request(self):
        _, user = self._auth()
        body = self._body()
        target_id = body.get("targetUserId")
        if not target_id or target_id == user["id"]:
            raise ApiError(400, "Invalid target user.")
        existing = find(DB["friendships"], userId=user["id"], friendUserId=target_id) or \
                   find(DB["friendships"], userId=target_id, friendUserId=user["id"])
        if existing:
            return self._json(200, existing)
        f = {"id": uid("fr"), "userId": user["id"], "friendUserId": target_id, "status": "pending"}
        DB["friendships"].append(f)
        save_db(DB)
        self._json(201, f)

    def _friends_respond(self):
        _, user = self._auth()
        body = self._body()
        f = find(DB["friendships"], id=body.get("friendshipId"))
        if not f or f["friendUserId"] != user["id"]:
            raise ApiError(404, "Request not found.")
        if body.get("accept"):
            f["status"] = "accepted"
        else:
            DB["friendships"].remove(f)
        save_db(DB)
        self._json(200, {"ok": True})

    def _friends_remove(self):
        _, user = self._auth()
        body = self._body()
        target_id = body.get("friendUserId")
        DB["friendships"] = [
            f for f in DB["friendships"]
            if not ({f["userId"], f["friendUserId"]} == {user["id"], target_id})
        ]
        save_db(DB)
        self._json(200, {"ok": True})


def main():
    import sys
    # Hosting platforms (Render, Fly.io, etc.) assign a port via $PORT; fall
    # back to a CLI arg for local runs, then 5173 as a plain default.
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 5173))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Planet Rock server running on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
