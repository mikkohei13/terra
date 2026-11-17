// Bird names for mode B. File: /static/birds.json
// taxa[]: id, sci, fi[], abbr[], syn[]. A hit shows the name that matched.
// Ranking uses prefix Levenshtein with Finnish QWERTY neighbour costs.

import { neighbourClass } from "./key-neighbours.js";

const BIRDS_URL = "/static/birds.json";
const MAX_RESULTS = 5;
const TAXON_ID = /^MX\.\d+$/;

const COST_SAME = 0;
const COST_HORIZONTAL = 0.3;
const COST_VERTICAL = 0.5;
const COST_DIAGONAL = 0.7;
const COST_OTHER = 1;
const COST_INSERT = 1;
const COST_DELETE = 1;

const TYPE_ORDER = { fi: 0, sci: 1, abbr: 2, syn: 3 };

let loaded = null;

function textList(value) {
    const source = Array.isArray(value) ? value : [value];
    const names = [];
    for (const item of source) {
        if (typeof item !== "string") {
            continue;
        }
        const text = item.trim();
        if (text) {
            names.push(text);
        }
    }
    return names;
}

function addNames(keys, values, nameType) {
    for (const name of textList(values)) {
        keys.push({
            name,
            key: name.toLocaleLowerCase("fi"),
            nameType,
            typeOrder: TYPE_ORDER[nameType],
        });
    }
}

function prepareTaxon(row) {
    if (!row || typeof row !== "object") {
        return null;
    }
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!TAXON_ID.test(id)) {
        return null;
    }
    const keys = [];
    addNames(keys, row.fi, "fi");
    addNames(keys, row.sci, "sci");
    addNames(keys, row.abbr, "abbr");
    addNames(keys, row.syn, "syn");
    if (!keys.length) {
        return null;
    }
    return { id, keys };
}

function loadBirds() {
    if (!loaded) {
        loaded = fetch(BIRDS_URL)
            .then(async (response) => {
                if (!response.ok) {
                    return [];
                }
                const body = await response.json();
                const taxa = body && Array.isArray(body.taxa) ? body.taxa : [];
                const birds = [];
                for (const row of taxa) {
                    const bird = prepareTaxon(row);
                    if (bird) {
                        birds.push(bird);
                    }
                }
                return birds;
            })
            .catch(() => []);
    }
    return loaded;
}

function substitutionCost(a, b) {
    const kind = neighbourClass(a, b);
    if (kind === "same") {
        return COST_SAME;
    }
    if (kind === "h") {
        return COST_HORIZONTAL;
    }
    if (kind === "v") {
        return COST_VERTICAL;
    }
    if (kind === "d") {
        return COST_DIAGONAL;
    }
    return COST_OTHER;
}

// Prefix Levenshtein: min D[m][j] over j, so the untyped rest of the name is free.
function prefixDistance(input, name) {
    const m = input.length;
    const n = name.length;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j += 1) {
        prev[j] = j * COST_INSERT;
    }
    for (let i = 1; i <= m; i += 1) {
        const cur = new Array(n + 1);
        cur[0] = i * COST_DELETE;
        const ca = input[i - 1];
        for (let j = 1; j <= n; j += 1) {
            const cb = name[j - 1];
            cur[j] = Math.min(
                cur[j - 1] + COST_INSERT,
                prev[j] + COST_DELETE,
                prev[j - 1] + substitutionCost(ca, cb),
            );
        }
        prev = cur;
    }
    let best = prev[0];
    for (let j = 1; j <= n; j += 1) {
        if (prev[j] < best) {
            best = prev[j];
        }
    }
    return best;
}

function betterName(candidate, current) {
    if (!current) {
        return true;
    }
    if (candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    if (candidate.name.length !== current.name.length) {
        return candidate.name.length < current.name.length;
    }
    if (candidate.typeOrder !== current.typeOrder) {
        return candidate.typeOrder < current.typeOrder;
    }
    return candidate.index < current.index;
}

function betterTaxon(candidate, current) {
    if (!current) {
        return true;
    }
    if (candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    if (candidate.name.length !== current.name.length) {
        return candidate.name.length < current.name.length;
    }
    if (candidate.typeOrder !== current.typeOrder) {
        return candidate.typeOrder < current.typeOrder;
    }
    return candidate.taxonIndex < current.taxonIndex;
}

export async function searchBirds(query) {
    const needle = String(query || "").toLocaleLowerCase("fi").trim();
    if (needle.length < 2) {
        return [];
    }
    const birds = await loadBirds();
    const ranked = [];
    for (let taxonIndex = 0; taxonIndex < birds.length; taxonIndex += 1) {
        const bird = birds[taxonIndex];
        let best = null;
        for (let index = 0; index < bird.keys.length; index += 1) {
            const item = bird.keys[index];
            const cost = prefixDistance(needle, item.key);
            const candidate = {
                cost,
                name: item.name,
                nameType: item.nameType,
                typeOrder: item.typeOrder,
                index,
            };
            if (betterName(candidate, best)) {
                best = candidate;
            }
        }
        if (!best) {
            continue;
        }
        ranked.push({
            id: bird.id,
            name: best.name,
            value: best.name,
            cost: best.cost,
            typeOrder: best.typeOrder,
            taxonIndex,
        });
    }
    ranked.sort((a, b) => (betterTaxon(a, b) ? -1 : betterTaxon(b, a) ? 1 : 0));
    return ranked.slice(0, MAX_RESULTS).map((item) => ({
        id: item.id,
        name: item.name,
        value: item.value,
    }));
}
