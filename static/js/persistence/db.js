/* ============================================================
   persistence/db.js
   IndexedDB engine.
   Stores: images (v1), codes (v2, legacy), project (v3).
   DB_VERSION 3 adds the project object store.
   The codes store is retained so existing Code Bank data is
   not destroyed on upgrade — it simply becomes unused by the
   new Project Explorer.
   ============================================================ */

const DB_NAME     = "PaintLabStorage";
const DB_VERSION  = 3;
const STORE_NAME  = "images";
const STORE_CODES = "codes";   // legacy — retained, not used by Explorer
const STORE_PROJ  = "project";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(new Error("Unable to open IndexedDB"));
        request.onsuccess = (e) => resolve(e.target.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_CODES)) {
                db.createObjectStore(STORE_CODES, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_PROJ)) {
                db.createObjectStore(STORE_PROJ, { keyPath: "id" });
            }
        };
    });
}

// ── Image store ───────────────────────────────────────────────

async function dbSet(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({ id: key, data: value, timestamp: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("IndexedDB Write Error"));
    });
}

async function dbGet(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = (e) => resolve(e.target.result ? e.target.result.data : null);
        req.onerror = () => reject(new Error("IndexedDB Read Error"));
    });
}

async function dbDelete(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("IndexedDB Delete Error"));
    });
}

async function dbGetAllSavedImages() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = (e) => resolve(
            (e.target.result || []).filter(item => item.id !== "autosave_canvas")
        );
        req.onerror = () => reject(new Error("IndexedDB ReadAll Error"));
    });
}

// ── Project store ─────────────────────────────────────────────
// Each record: { id, data: { type, path, content?, language? }, timestamp }
// type: 'file' | 'folder'
// path: slash-separated from project root, e.g. 'src/maze.py'
// content: string (files only)

async function dbProjectSet(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJ, "readwrite");
        tx.objectStore(STORE_PROJ).put({ id: key, data: value, timestamp: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("Project Write Error"));
    });
}

async function dbProjectGet(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJ, "readonly");
        const req = tx.objectStore(STORE_PROJ).get(key);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = () => reject(new Error("Project Read Error"));
    });
}

async function dbProjectDelete(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJ, "readwrite");
        tx.objectStore(STORE_PROJ).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("Project Delete Error"));
    });
}

async function dbProjectGetAll() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJ, "readonly");
        const req = tx.objectStore(STORE_PROJ).getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => reject(new Error("Project ReadAll Error"));
    });
}

// Find a single project record by its path field
async function dbProjectFindByPath(path) {
    const all = await dbProjectGetAll();
    return all.find(r => r.data.path === path) || null;
}
