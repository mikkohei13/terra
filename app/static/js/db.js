// IndexedDB for the active field session. This module does not call the network.

const DB_NAME = "terra";
const DB_VERSION = 3;
const ACTIVE_KEY = "active";
const UNSENT_STORE = "unsent";
export const AUTOCOMPLETE_STORE = "taxonAutocomplete";

let dbPromise = null;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("session")) {
                db.createObjectStore("session");
            }
            if (!db.objectStoreNames.contains("observations")) {
                db.createObjectStore("observations", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(AUTOCOMPLETE_STORE)) {
                db.createObjectStore(AUTOCOMPLETE_STORE);
            }
            if (!db.objectStoreNames.contains(UNSENT_STORE)) {
                db.createObjectStore(UNSENT_STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open saved observations."));
    });
}

export function databaseConnection() {
    if (!dbPromise) {
        dbPromise = openDatabase().catch((error) => {
            dbPromise = null;
            throw error;
        });
    }
    return dbPromise;
}

export function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error("The save was aborted."));
        tx.onerror = () => reject(tx.error || new Error("The save failed."));
    });
}

export async function getSession() {
    const db = await databaseConnection();
    return new Promise((resolve, reject) => {
        const request = db.transaction("session", "readonly").objectStore("session").get(ACTIVE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

export async function saveSession(session) {
    const db = await databaseConnection();
    const tx = db.transaction("session", "readwrite");
    tx.objectStore("session").put(session, ACTIVE_KEY);
    await transactionDone(tx);
}

export async function listObservations() {
    const db = await databaseConnection();
    return new Promise((resolve, reject) => {
        const request = db.transaction("observations", "readonly").objectStore("observations").getAll();
        request.onsuccess = () => {
            const rows = request.result || [];
            rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function addObservation(observation) {
    const db = await databaseConnection();
    const tx = db.transaction("observations", "readwrite");
    tx.objectStore("observations").put(observation);
    await transactionDone(tx);
}

export async function deleteObservation(id) {
    const db = await databaseConnection();
    const tx = db.transaction("observations", "readwrite");
    tx.objectStore("observations").delete(id);
    await transactionDone(tx);
}

export async function clearSession() {
    const db = await databaseConnection();
    const tx = db.transaction(["session", "observations"], "readwrite");
    tx.objectStore("session").delete(ACTIVE_KEY);
    tx.objectStore("observations").clear();
    await transactionDone(tx);
}

export async function saveUnsent(bundle) {
    const db = await databaseConnection();
    const tx = db.transaction(UNSENT_STORE, "readwrite");
    tx.objectStore(UNSENT_STORE).put(bundle);
    await transactionDone(tx);
}

export async function listUnsent() {
    const db = await databaseConnection();
    return new Promise((resolve, reject) => {
        const request = db.transaction(UNSENT_STORE, "readonly").objectStore(UNSENT_STORE).getAll();
        request.onsuccess = () => {
            const rows = request.result || [];
            rows.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getUnsent(id) {
    const db = await databaseConnection();
    return new Promise((resolve, reject) => {
        const request = db.transaction(UNSENT_STORE, "readonly").objectStore(UNSENT_STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

export async function deleteUnsent(id) {
    const db = await databaseConnection();
    const tx = db.transaction(UNSENT_STORE, "readwrite");
    tx.objectStore(UNSENT_STORE).delete(id);
    await transactionDone(tx);
}

export async function restoreUnsent(bundle) {
    const db = await databaseConnection();
    const tx = db.transaction(["session", "observations", UNSENT_STORE], "readwrite");
    const session = {
        startedAt: bundle.startedAt,
        lat: bundle.lat,
        lon: bundle.lon,
        points: Array.isArray(bundle.points) ? bundle.points : [],
        unsentId: bundle.id,
    };
    if (bundle.document && typeof bundle.document === "object" && !Array.isArray(bundle.document)) {
        session.document = bundle.document;
    }
    tx.objectStore("session").put(session, ACTIVE_KEY);
    const observations = tx.objectStore("observations");
    observations.clear();
    const rows = Array.isArray(bundle.observations) ? bundle.observations : [];
    for (const observation of rows) {
        observations.put(observation);
    }
    tx.objectStore(UNSENT_STORE).delete(bundle.id);
    await transactionDone(tx);
    return session;
}
