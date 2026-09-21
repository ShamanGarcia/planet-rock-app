// Mirrors backend/server.py's ADMIN_PASSWORD — same instant-enable-button
// UX as the existing delete/reset password modals.
export const ADMIN_PASSWORD = "IAMANADMIN!";

// In-memory only — a page reload always re-locks Admin Controls and
// requires the password again. Deliberately not persisted.
let unlocked = false;
export const isAdminUnlocked = () => unlocked;
export const unlockAdmin = () => { unlocked = true; };
