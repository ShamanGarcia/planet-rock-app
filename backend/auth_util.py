"""Password hashing — stdlib-only PBKDF2-HMAC-SHA256, salted, constant-time
verified. Shared by server.py (login/signup) and seed_data.py (demo users),
kept in its own module so seed_data.py doesn't have to import server.py."""
import hashlib
import hmac
import secrets

ITERATIONS = 260_000


def hash_password(password):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2${ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password, stored):
    try:
        scheme, iterations, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(dk, expected)
    except (ValueError, AttributeError):
        return False
