// Bird names for mode B. File: /static/birds.json
// taxa[]: id, sci, fi[], abbr[], syn[]. A hit shows the name that matched.
// Ranking uses prefix Levenshtein with Finnish QWERTY neighbour costs.
// Leading words may be the name; the rest becomes notes when the user picks.

import { neighbourClass } from "./key-neighbours.js";

const BIRDS_URL = "/static/birds.json";
const MAX_RESULTS = 5;
const MAX_LEADING_WORDS = 4;
const MAX_COST_PER_USED = 0.4;
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

function isSoft(ch) {
    return ch === " " || ch === "-";
}

function substitutionCost(a, b) {
    if (a === b) {
        return COST_SAME;
    }
    if (isSoft(a) && isSoft(b)) {
        return COST_SAME;
    }
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

function insertCost(ch) {
    return isSoft(ch) ? 0 : COST_INSERT;
}

function deleteCost(ch) {
    return isSoft(ch) ? 0 : COST_DELETE;
}

// Prefix Levenshtein: min cost over name length j. Soft chars (space, hyphen)
// insert, delete, and soft-vs-soft substitute for free. Untyped name tail is free.
function prefixDistance(input, name) {
    const m = input.length;
    const n = name.length;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j += 1) {
        prev[j] = j === 0 ? 0 : prev[j - 1] + insertCost(name[j - 1]);
    }
    for (let i = 1; i <= m; i += 1) {
        const cur = new Array(n + 1);
        const ca = input[i - 1];
        cur[0] = prev[0] + deleteCost(ca);
        for (let j = 1; j <= n; j += 1) {
            const cb = name[j - 1];
            cur[j] = Math.min(
                cur[j - 1] + insertCost(cb),
                prev[j] + deleteCost(ca),
                prev[j - 1] + substitutionCost(ca, cb),
            );
        }
        prev = cur;
    }
    let bestCost = prev[0];
    let bestUsed = 0;
    for (let j = 1; j <= n; j += 1) {
        const cost = prev[j];
        if (cost < bestCost || (cost === bestCost && j > bestUsed)) {
            bestCost = cost;
            bestUsed = j;
        }
    }
    return { cost: bestCost, used: bestUsed };
}

// End indexes (exclusive) of the first up to MAX_LEADING_WORDS words.
function leadingWordEnds(text) {
    const ends = [];
    let i = 0;
    while (i < text.length && ends.length < MAX_LEADING_WORDS) {
        while (i < text.length && text[i] === " ") {
            i += 1;
        }
        if (i >= text.length) {
            break;
        }
        while (i < text.length && text[i] !== " ") {
            i += 1;
        }
        ends.push(i);
    }
    return ends;
}

function betterSplit(candidate, current) {
    if (!current) {
        return true;
    }
    if (candidate.used !== current.used) {
        return candidate.used > current.used;
    }
    if (candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    return candidate.wordEnd < current.wordEnd;
}

function betterName(candidate, current) {
    if (!current) {
        return true;
    }
    if (candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    if (candidate.used !== current.used) {
        return candidate.used > current.used;
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
    if (candidate.used !== current.used) {
        return candidate.used > current.used;
    }
    if (candidate.name.length !== current.name.length) {
        return candidate.name.length < current.name.length;
    }
    if (candidate.typeOrder !== current.typeOrder) {
        return candidate.typeOrder < current.typeOrder;
    }
    return candidate.taxonIndex < current.taxonIndex;
}

function matchName(needle, nameKey, wordEnds) {
    let best = null;
    for (const wordEnd of wordEnds) {
        const slice = needle.slice(0, wordEnd);
        if (slice.length < 1) {
            continue;
        }
        const { cost, used } = prefixDistance(slice, nameKey);
        if (used < 1) {
            continue;
        }
        if (cost / used > MAX_COST_PER_USED) {
            continue;
        }
        const candidate = { cost, used, wordEnd };
        if (betterSplit(candidate, best)) {
            best = candidate;
        }
    }
    return best;
}

function notesFor(raw, wordEnd, taxonName) {
    const tail = raw.slice(wordEnd).trim();
    if (!tail) {
        return undefined;
    }
    return taxonName + " " + tail;
}

export async function searchBirds(query) {
    const raw = String(query || "").trim();
    const needle = raw.toLocaleLowerCase("fi");
    if (needle.length < 2) {
        return [];
    }
    const wordEnds = leadingWordEnds(needle);
    if (!wordEnds.length) {
        return [];
    }
    const birds = await loadBirds();
    const ranked = [];
    for (let taxonIndex = 0; taxonIndex < birds.length; taxonIndex += 1) {
        const bird = birds[taxonIndex];
        let best = null;
        for (let index = 0; index < bird.keys.length; index += 1) {
            const item = bird.keys[index];
            const split = matchName(needle, item.key, wordEnds);
            if (!split) {
                continue;
            }
            const candidate = {
                cost: split.cost,
                used: split.used,
                wordEnd: split.wordEnd,
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
            notes: notesFor(raw, best.wordEnd, best.name),
            cost: best.cost,
            used: best.used,
            typeOrder: best.typeOrder,
            taxonIndex,
        });
    }
    ranked.sort((a, b) => (betterTaxon(a, b) ? -1 : betterTaxon(b, a) ? 1 : 0));
    return ranked.slice(0, MAX_RESULTS).map((item) => {
        const row = {
            id: item.id,
            name: item.name,
            value: item.value,
        };
        if (item.notes) {
            row.notes = item.notes;
        }
        return row;
    });
}
