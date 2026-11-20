// User settings for this browser. One JSON document in localStorage.
// This module does not touch the DOM or the network.

import { informalTaxonGroups } from "./config.js";

const STORAGE_KEY = "terra.settings";

export const INFORMAL_TAXON_GROUPS = informalTaxonGroups;

const INFORMAL_TAXON_GROUP_IDS = INFORMAL_TAXON_GROUPS.map((group) => group.id);

export const MIN_DISTANCE_M_DEFAULT = 100;
export const MIN_DISTANCE_M_MIN = 20;
export const MIN_DISTANCE_M_MAX = 1000;

export const ACCURACY_PROPORTION_DEFAULT = 0.2;
export const ACCURACY_PROPORTION_MIN = 0;
export const ACCURACY_PROPORTION_MAX = 1;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const AUTOCOMPLETE_CACHE_MAX_MS = 30 * DAY_MS;
export const AUTOCOMPLETE_CACHE_DEFAULT = "7d";

export const AUTOCOMPLETE_CACHE_OPTIONS = [
    { id: "off", label: "No caching", ms: 0 },
    { id: "3h", label: "3 hours", ms: 3 * HOUR_MS },
    { id: "24h", label: "24 hours", ms: DAY_MS },
    { id: "7d", label: "7 days", ms: 7 * DAY_MS },
    { id: "30d", label: "30 days", ms: AUTOCOMPLETE_CACHE_MAX_MS },
];

const AUTOCOMPLETE_CACHE_IDS = new Set(AUTOCOMPLETE_CACHE_OPTIONS.map((option) => option.id));

function normalizeInformalTaxonGroupIds(value) {
    const raw = Array.isArray(value) ? value : [];
    const picked = new Set(raw.filter((id) => typeof id === "string"));
    return INFORMAL_TAXON_GROUP_IDS.filter((id) => picked.has(id));
}

function normalizeAutocompleteCache(value) {
    const id = typeof value === "string" ? value : "";
    return AUTOCOMPLETE_CACHE_IDS.has(id) ? id : AUTOCOMPLETE_CACHE_DEFAULT;
}

export function autocompleteCacheMs(id) {
    const option = AUTOCOMPLETE_CACHE_OPTIONS.find((item) => item.id === id);
    return option ? option.ms : 0;
}

function normalizeMinDistanceM(value) {
    const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
    if (!Number.isInteger(number) || number < MIN_DISTANCE_M_MIN || number > MIN_DISTANCE_M_MAX) {
        return MIN_DISTANCE_M_DEFAULT;
    }
    return number;
}

// A decimal from 0 to 1. Anything else, including a blank, becomes the default.
export function normalizeAccuracyProportion(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return ACCURACY_PROPORTION_DEFAULT;
    }
    if (typeof value === "string" && value.trim() === "") {
        return ACCURACY_PROPORTION_DEFAULT;
    }
    const number = typeof value === "number" ? value : Number(value.trim());
    if (!Number.isFinite(number) || number < ACCURACY_PROPORTION_MIN || number > ACCURACY_PROPORTION_MAX) {
        return ACCURACY_PROPORTION_DEFAULT;
    }
    return number;
}

function normalizeTaxonSearchMode(value) {
    if (value === "A" || value === "B" || value === "C") {
        return value;
    }
    return "C";
}

// A later setting is another entry here, plus a section in settings-ui.js.
const REGISTRY = {
    informalTaxonGroupIds: {
        default: [],
        normalize: normalizeInformalTaxonGroupIds,
    },
    minDistanceM: {
        default: MIN_DISTANCE_M_DEFAULT,
        normalize: normalizeMinDistanceM,
    },
    accuracyProportion: {
        default: ACCURACY_PROPORTION_DEFAULT,
        normalize: normalizeAccuracyProportion,
    },
    autocompleteCache: {
        default: AUTOCOMPLETE_CACHE_DEFAULT,
        normalize: normalizeAutocompleteCache,
    },
    taxonSearchMode: {
        default: "C",
        normalize: normalizeTaxonSearchMode,
    },
};

function readDocument() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        return parsed;
    } catch (_error) {
        return {};
    }
}

function writeDocument(document) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

function normalizedDocument(source) {
    const document = {};
    for (const key of Object.keys(REGISTRY)) {
        const entry = REGISTRY[key];
        const value = source && Object.prototype.hasOwnProperty.call(source, key)
            ? source[key]
            : entry.default;
        document[key] = entry.normalize(value);
    }
    return document;
}

function copyValue(value) {
    return Array.isArray(value) ? value.slice() : value;
}

export function getSetting(key) {
    const entry = REGISTRY[key];
    if (!entry) {
        throw new Error("Unknown setting.");
    }
    return copyValue(normalizedDocument(readDocument())[key]);
}

export function setSetting(key, value) {
    const entry = REGISTRY[key];
    if (!entry) {
        throw new Error("Unknown setting.");
    }
    const document = normalizedDocument(readDocument());
    document[key] = entry.normalize(value);
    writeDocument(document);
    return copyValue(document[key]);
}

export function getSettings() {
    const document = normalizedDocument(readDocument());
    const copy = {};
    for (const key of Object.keys(document)) {
        copy[key] = copyValue(document[key]);
    }
    return copy;
}
