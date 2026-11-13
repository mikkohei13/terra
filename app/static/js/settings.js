// User settings for this browser. One JSON document in localStorage.
// This module does not touch the DOM or the network.

const STORAGE_KEY = "terra.settings";

export const INFORMAL_TAXON_GROUPS = [
    { id: "MVL.1", name: "Birds" },
    { id: "MVL.232", name: "Insects and arachnids" },
    { id: "MVL.343", name: "Vascular plants" },
    { id: "MVL.233", name: "Fungi and lichens" },
];

const INFORMAL_TAXON_GROUP_IDS = INFORMAL_TAXON_GROUPS.map((group) => group.id);

export const MIN_DISTANCE_M_DEFAULT = 100;
export const MIN_DISTANCE_M_MIN = 20;
export const MIN_DISTANCE_M_MAX = 1000;

function normalizeInformalTaxonGroupIds(value) {
    const raw = Array.isArray(value) ? value : [];
    const picked = new Set(raw.filter((id) => typeof id === "string"));
    return INFORMAL_TAXON_GROUP_IDS.filter((id) => picked.has(id));
}

function normalizeMinDistanceM(value) {
    const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
    if (!Number.isInteger(number) || number < MIN_DISTANCE_M_MIN || number > MIN_DISTANCE_M_MAX) {
        return MIN_DISTANCE_M_DEFAULT;
    }
    return number;
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
