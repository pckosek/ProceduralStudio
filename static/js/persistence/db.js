/* ============================================================
   persistence/db.js — JinjaWorkbench
   IndexedDB engine.
   Store: project (v1).
   Image store removed — JinjaWorkbench has no Image Bank.
   DB_NAME is distinct from PixelWorkbench to prevent any
   cross-product schema collision in the same browser.
   ============================================================ */

const DB_NAME    = "JinjaWorkbenchStorage";
const DB_VERSION = 1;
const STORE_PROJ = "project";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(new Error("Unable to open IndexedDB"));
        request.onsuccess = (e) => resolve(e.target.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_PROJ)) {
                db.createObjectStore(STORE_PROJ, { keyPath: "id" });
            }
        };
    });
}

// ── Project store ─────────────────────────────────────────────
// Each record: { id, data: { type, path, content?, language? }, timestamp }
// type: 'file' | 'folder'
// path: slash-separated from project root, e.g. 'templates/index.html'
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

async function dbProjectFindByPath(path) {
    const all = await dbProjectGetAll();
    return all.find(r => r.data.path === path) || null;
}
