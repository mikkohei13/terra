// IndexedDB for the active field session. This module does not call the network.

const DB_NAME = "terra";
const DB_VERSION = 2;
const ACTIVE_KEY = "active";
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
