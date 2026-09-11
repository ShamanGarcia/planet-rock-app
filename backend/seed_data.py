"""Builds the initial database (same shape the API/frontend expect) the
first time the backend runs with no db.json yet. No test users or routes —
real climbers sign up and set routes themselves."""

DEFAULT_TAGS = [
    "Juggy", "Crimpy", "Slopers", "Pinches", "Static", "Dynamic", "Technical",
    "Powerful", "Burly", "Balance", "Coordination", "Reachy", "Compression",
    "Endurance", "Slab", "Overhang",
]


def build_seed_data():
    gym = {
        "id": "gym_annarbor",
        "name": "Planet Rock — Ann Arbor",
        "address": "5633 W Michigan Ave, Ann Arbor, MI 48108",
        "mapImage": "generated",
        "active": True,
    }
    tags = [{"id": f"tag_{name.lower()}", "name": name} for name in DEFAULT_TAGS]

    return {
        "gyms": [gym],
        "users": [],
        "tags": tags,
        "routes": [],
        "routeTags": [],
        "tagVotes": [],
        "gradeEstimates": [],
        "climbingLog": [],
        "routeMedia": [],
        "friendships": [],
        "sessions": {},
    }
