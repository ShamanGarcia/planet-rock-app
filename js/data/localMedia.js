// Private, on-device media store (IndexedDB) for photos/videos too large to
// share to the server (see SHARED_MEDIA_LIMIT_BYTES in constants.js). Never
// leaves this browser, so it never appears in anyone else's gallery.

const DB_NAME = "planetRockLocalMedia";
const STORE = "media";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("routeId", "routeId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalMedia(routeId, type, dataUrl) {
  const db = await openDb();
  const item = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    routeId, type, url: dataUrl, isLocal: true,
    uploadedByName: "You (this device)", createdAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalMediaForRoute(routeId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).index("routeId").getAll(routeId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
