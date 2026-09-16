// In-memory only — a page reload always re-locks Admin Controls and
// requires the password again. Deliberately not persisted.
let unlocked = false;
export const isAdminUnlocked = () => unlocked;
export const unlockAdmin = () => { unlocked = true; };
