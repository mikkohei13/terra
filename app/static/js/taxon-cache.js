// Saved taxon suggestions for this phone. This module does not call the network.

import { AUTOCOMPLETE_STORE, databaseConnection, transactionDone } from "./db.js";
import { AUTOCOMPLETE_CACHE_MAX_MS } from "./settings.js";

function cacheKey(groupIds, query) {
    const groups = Array.isArray(groupIds) ? groupIds.join(",") : "";
    const text = String(query || "").trim().toLocaleLowerCase("fi");
    return groups + "\n" + text;
}

function storedResults(results) {
    if (!Array.isArray(results)) {
        return [];
    }
    const stored = [];
    for (const item of results) {
        if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
            continue;
        }
        stored.push({ id: item.id, name: item.name });
    }
    return stored;
}

export async function readAutocomplete(groupIds, query, maxAgeMs) {
    if (!maxAgeMs) {
        return null;
    }
    const db = await databaseConnection();
    const row = await new Promise((resolve, reject) => {
        const store = db.transaction(AUTOCOMPLETE_STORE, "readonly").objectStore(AUTOCOMPLETE_STORE);
        const request = store.get(cacheKey(groupIds, query));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    if (!row || typeof row.cachedAt !== "number" || !Array.isArray(row.results)) {
        return null;
    }
    if (Date.now() - row.cachedAt >= maxAgeMs) {
        return null;
    }
    return row.results;
}

export async function writeAutocomplete(groupIds, query, results) {
    const db = await databaseConnection();
    const tx = db.transaction(AUTOCOMPLETE_STORE, "readwrite");
    const store = tx.objectStore(AUTOCOMPLETE_STORE);
    store.put(
        { cachedAt: Date.now(), results: storedResults(results) },
        cacheKey(groupIds, query),
    );
    const cutoff = Date.now() - AUTOCOMPLETE_CACHE_MAX_MS;
    const request = store.openCursor();
    request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
            return;
        }
        const cachedAt = cursor.value && cursor.value.cachedAt;
        if (typeof cachedAt !== "number" || cachedAt < cutoff) {
            cursor.delete();
        }
        cursor.continue();
    };
    await transactionDone(tx);
}

export async function clearAutocompleteCache() {
    const db = await databaseConnection();
    const tx = db.transaction(AUTOCOMPLETE_STORE, "readwrite");
    tx.objectStore(AUTOCOMPLETE_STORE).clear();
    await transactionDone(tx);
}
