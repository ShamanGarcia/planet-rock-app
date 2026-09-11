"""Builds the initial mock database (same shape/content as the original
client-side seed.js) the first time the backend runs with no db.json yet."""
import random
import uuid
from datetime import datetime, timedelta

from auth_util import hash_password

DEFAULT_TAGS = [
    "Juggy", "Crimpy", "Slopers", "Pinches", "Static", "Dynamic", "Technical",
    "Powerful", "Burly", "Balance", "Coordination", "Reachy", "Compression",
    "Endurance", "Slab", "Overhang",
]

# Must mirror WALL_SECTIONS in js/data/constants.js — the frontend map's
# real zone shapes. Kept as plain polygons (not shared with the JS file)
# since seed data only needs to place routes inside a valid zone.
WALL_SECTIONS = [
    {"id": "arch", "points": [[1.63, 0], [17.17, 0], [17.17, 10.9], [11.17, 31.41], [6.27, 35.9], [5.45, 8.97]]},
    {"id": "long-wall", "points": [[18.8, 0], [58.31, 0.64], [57.49, 19.87], [18.8, 14.74]]},
    {"id": "competition", "points": [[61.04, 0], [100, 0], [100, 48.08], [95.9, 48.08], [95.9, 18.59], [61.04, 18.59]]},
    {"id": "island", "points": [[27.25, 52.56], [40.33, 53.21], [44.41, 59.62], [43.87, 73.08], [37.33, 79.49],
                                 [26.98, 74.36], [24.25, 65.38], [25.61, 56.41]]},
    {"id": "slab", "points": [[62.13, 44.87], [89.1, 44.23], [91.28, 47.44], [74.39, 65.38]]},
    {"id": "notch", "points": [[62.13, 44.87], [74.39, 65.38], [63.22, 98.08]]},
    {"id": "overhang", "points": [[91.28, 47.44], [90.74, 58.97], [63.22, 98.08], [74.39, 65.38]]},
]

ROUTE_DEFS = [
    ("Sunny Slab", "slab", .3, .3, "Yellow", "Sloper", 0, ["Slab", "Balance", "Static"]),
    ("Green Machine", "slab", .6, .5, "Green", "Jug", 1, ["Juggy", "Static"]),
    ("Purple Rain", "slab", .45, .75, "Purple", "Crimp", 2, ["Technical", "Slab", "Balance"]),
    ("Black Ice", "slab", .8, .2, "Black", "Crimp", 4, ["Crimpy", "Technical", "Slab"]),
    ("Blue Steel", "long-wall", .15, .5, "Blue", "Jug", 1, ["Juggy", "Static"]),
    ("Red Alert", "long-wall", .4, .4, "Red", "Crimp", 3, ["Crimpy", "Technical"]),
    ("Orange Crush", "long-wall", .65, .6, "Orange", "Pocket", 5, ["Crimpy", "Technical", "Static"]),
    ("White Noise", "long-wall", .88, .3, "White", "Volume", 2, ["Coordination", "Balance"]),
    ("The Prow", "competition", .5, .2, "Orange", "Crimp", 6, ["Technical", "Reachy", "Balance"]),
    ("Knife Edge", "competition", .4, .55, "Black", "Pinch", 7, ["Pinches", "Powerful", "Technical"]),
    ("Yellow Fever", "competition", .6, .85, "Yellow", "Sloper", 3, ["Slopers", "Balance"]),
    ("Gravity Check", "overhang", .3, .15, "Red", "Jug", 4, ["Juggy", "Powerful", "Overhang"]),
    ("Powerhouse", "overhang", .55, .4, "Black", "Sloper", 8, ["Powerful", "Burly", "Dynamic", "Overhang"]),
    ("Campus King", "overhang", .35, .65, "Purple", "Pocket", 9, ["Powerful", "Dynamic", "Compression"]),
    ("Ungraded Mystery", "overhang", .7, .85, "Green", "Volume", None, ["Compression", "Powerful"]),
    ("Double Dyno", "overhang", .5, .95, "Orange", "Jug", 10, ["Dynamic", "Powerful", "Reachy"]),
    ("Bat Cave", "island", .2, .3, "Black", "Jug", 7, ["Overhang", "Compression", "Powerful"]),
    ("Roof Runner", "island", .5, .5, "Blue", "Pinch", 6, ["Pinches", "Powerful", "Endurance"]),
    ("Cave Crawler", "island", .8, .7, "Orange", "Volume", 5, ["Compression", "Technical"]),
    ("Left Field", "arch", .3, .2, "Green", "Crimp", 2, ["Crimpy", "Technical"]),
    ("Balance Beam", "arch", .5, .45, "Blue", "Sloper", 1, ["Balance", "Technical", "Coordination"]),
    ("Undercling Alley", "arch", .65, .75, "White", "Pinch", 3, ["Pinches", "Technical"]),
    ("Corner Pocket", "notch", .35, .3, "Yellow", "Pocket", 3, ["Technical", "Static"]),
    ("The Squeeze", "notch", .6, .65, "Purple", "Pinch", 4, ["Pinches", "Powerful", "Compression"]),
    ("Board Buster", "notch", .5, .4, "Red", "Crimp", 9, ["Crimpy", "Powerful", "Endurance"]),
    ("Sloper Storm", "competition", .25, .2, "Green", "Sloper", 5, ["Slopers", "Powerful"]),
    ("Endurance Test", "competition", .5, .5, "Blue", "Jug", 6, ["Endurance", "Static", "Technical"]),
    ("Retired Relic", "competition", .7, .8, "White", "Crimp", 5, ["Crimpy", "Technical"], True),
    ("Little Sender", "arch", .4, .4, "Yellow", "Jug", 0, ["Juggy", "Static"]),
]

USER_DEFS = [
    ("you", "shgarcia@umich.edu", "climb123", "Sam Garcia", 24, "Ann Arbor, MI", "2023-06-01", "Crimp", 6, False),
    ("alex", "alex@example.com", "climb123", "Alex Chen", 29, "Chicago, IL", "2019-03-01", "Sloper", 8, False),
    ("jordan", "jordan@example.com", "climb123", "Jordan Lee", 22, "Detroit, MI", "2022-01-15", "Jug", 5, False),
    ("priya", "priya@example.com", "climb123", "Priya Patel", 31, "Ann Arbor, MI", "2016-09-01", "Crimp", 9, False),
    ("marcus", "marcus@example.com", "climb123", "Marcus Webb", 27, "Grand Rapids, MI", "2021-05-01", "Pinch", 7, True),
    ("taylor", "taylor@example.com", "climb123", "Taylor Nguyen", 20, "Ypsilanti, MI", "2024-02-01", "Volume", 3, False),
]


def uid(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def days_ago(n):
    d = datetime.utcnow() - timedelta(days=n, hours=-(9 + (n % 8)), minutes=-((n * 7) % 60))
    return d.isoformat() + "Z"


def _point_in_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def place_in_section(section_id, fx, fy):
    poly = next(w["points"] for w in WALL_SECTIONS if w["id"] == section_id)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    # (fx, fy) picks a point in the zone's bounding box; these zones are
    # irregular (some concave, e.g. the L-shaped competition wall), so that
    # point can land outside the shape — if so, use the closest point on a
    # grid over the same box that IS inside.
    target = (minx + (maxx - minx) * fx, miny + (maxy - miny) * fy)
    if _point_in_polygon(*target, poly):
        return target
    best, best_dist = None, None
    steps = 20
    for gx in range(steps + 1):
        for gy in range(steps + 1):
            x = minx + (maxx - minx) * gx / steps
            y = miny + (maxy - miny) * gy / steps
            if not _point_in_polygon(x, y, poly):
                continue
            dist = (x - target[0]) ** 2 + (y - target[1]) ** 2
            if best is None or dist < best_dist:
                best, best_dist = (x, y), dist
    return best or target


def build_seed_data():
    gym = {
        "id": "gym_annarbor",
        "name": "Planet Rock — Ann Arbor",
        "address": "5633 W Michigan Ave, Ann Arbor, MI 48108",
        "mapImage": "generated",
        "active": True,
    }

    users = {}
    for key, email, password, name, age, hometown, start, hold, grade, log_private in USER_DEFS:
        users[key] = {
            "id": uid("user"),
            "email": email,
            "password": hash_password(password),
            "name": name,
            "profilePicture": None,
            "age": age,
            "hometown": hometown,
            "climbingStartDate": start,
            "favoriteHoldType": hold,
            "selfReportedHighestGrade": grade,
            "privacy": {"profilePublic": True, "logPublic": not log_private},
            "createdAt": days_ago(400),
        }
    user_list = list(users.values())
    you = users["you"]

    tags = {name: {"id": uid("tag"), "name": name} for name in DEFAULT_TAGS}

    routes = []
    route_tags = []
    tag_votes = []
    grade_estimates = []
    route_media = []
    named_refs = {}  # seed-time-only lookup ("Orange Crush" etc.) -> route dict; never stored on the route itself

    for idx, defn in enumerate(ROUTE_DEFS):
        name, section, fx, fy, color, hold, grade, tag_names = defn[:8]
        retired = defn[8] if len(defn) > 8 else False
        route_id = uid("route")
        rng = random.Random(hash(name) & 0xFFFFFFFF)
        mx, my = place_in_section(section, fx, fy)
        route = {
            "id": route_id,
            "gymId": gym["id"],
            "wallSection": section,
            "mapX": mx,
            "mapY": my,
            "holdType": hold,
            "holdTypes": [hold],
            "holdColor": color,
            "officialGrade": grade,
            "tags": [tags[t]["id"] for t in tag_names],
            "photoUrl": None,
            "createdAt": days_ago(300 - idx * 4),
            "createdBy": you["id"],
            "active": not retired,
        }
        routes.append(route)
        named_refs[name] = route

        for tag_name in tag_names:
            route_tags.append({"id": uid("rtag"), "routeId": route_id, "tagId": tags[tag_name]["id"]})
            voter_count = 3 + rng.randint(0, 4)
            shuffled = rng.sample(user_list, min(voter_count, len(user_list)))
            for u in shuffled:
                positive = rng.random() < 0.82
                tag_votes.append({"id": uid("vote"), "routeId": route_id, "tagId": tags[tag_name]["id"], "userId": u["id"], "vote": 1 if positive else -1})

        if grade is not None:
            estimate_count = 4 + rng.randint(0, 5)
            shuffled = rng.sample(user_list, min(estimate_count, len(user_list)))
            for i, u in enumerate(shuffled):
                drift = rng.randint(-1, 1)
                g = max(0, min(10, grade + drift))
                grade_estimates.append({
                    "id": uid("est"), "routeId": route_id, "userId": u["id"], "grade": g,
                    "createdAt": days_ago(200 - idx * 3 - i), "updatedAt": days_ago(200 - idx * 3 - i),
                })

    climbing_log = []

    def log_send(user, route, days_back):
        climbing_log.append({
            "id": uid("log"),
            "userId": user["id"],
            "routeId": route["id"],
            "completedAt": days_ago(days_back),
            "snapshot": {
                "holdColor": route["holdColor"],
                "holdType": route["holdType"],
                "officialGrade": route["officialGrade"],
                "wallSection": route.get("wallSection"),
            },
        })

    active_routes = [r for r in routes if r["active"]]

    def eligible_routes_for(user):
        cap = (user["selfReportedHighestGrade"] if user["selfReportedHighestGrade"] is not None else 5) + 1
        pool = [r for r in active_routes if r["officialGrade"] is None or r["officialGrade"] <= cap]
        return pool if pool else active_routes

    rng_you = random.Random(hash("you-log") & 0xFFFFFFFF)
    you_pool = eligible_routes_for(you)
    for i in range(26):
        route = rng_you.choice(you_pool)
        log_send(you, route, rng_you.randint(0, 149))

    repeat_route = named_refs.get("Orange Crush")
    if repeat_route:
        log_send(you, repeat_route, 2)
        log_send(you, repeat_route, 40)

    retired_route = named_refs.get("Retired Relic")
    if retired_route:
        log_send(you, retired_route, 220)

    for key in ["alex", "jordan", "priya", "marcus", "taylor"]:
        u = users[key]
        rng = random.Random(hash(key + "-log") & 0xFFFFFFFF)
        pool = eligible_routes_for(u)
        count = 8 + rng.randint(0, 13)
        for i in range(count):
            route = rng.choice(pool)
            log_send(u, route, rng.randint(0, 199))

    friendships = [
        {"id": uid("fr"), "userId": you["id"], "friendUserId": users["alex"]["id"], "status": "accepted"},
        {"id": uid("fr"), "userId": you["id"], "friendUserId": users["jordan"]["id"], "status": "accepted"},
        {"id": uid("fr"), "userId": you["id"], "friendUserId": users["priya"]["id"], "status": "accepted"},
        {"id": uid("fr"), "userId": you["id"], "friendUserId": users["marcus"]["id"], "status": "accepted"},
        {"id": uid("fr"), "userId": users["taylor"]["id"], "friendUserId": you["id"], "status": "pending"},
    ]

    return {
        "gyms": [gym],
        "users": user_list,
        "tags": list(tags.values()),
        "routes": routes,
        "routeTags": route_tags,
        "tagVotes": tag_votes,
        "gradeEstimates": grade_estimates,
        "climbingLog": climbing_log,
        "routeMedia": route_media,
        "friendships": friendships,
        "sessions": {},
    }
