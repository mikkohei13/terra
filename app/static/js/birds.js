// Bird names for mode B. File: /static/birds.json
// taxa[]: id, sci, fi[], abbr[], syn[]. A hit shows the name that matched.

const BIRDS_URL = "/static/birds.json";
const MAX_RESULTS = 10;
const TAXON_ID = /^MX\.\d+$/;

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

function prepareTaxon(row) {
    if (!row || typeof row !== "object") {
        return null;
    }
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!TAXON_ID.test(id)) {
        return null;
    }
    const names = textList(row.fi).concat(
        textList(row.sci),
        textList(row.abbr),
        textList(row.syn),
    );
    if (!names.length) {
        return null;
    }
    const keys = [];
    for (const name of names) {
        keys.push({ name, key: name.toLocaleLowerCase("fi") });
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

export async function searchBirds(query) {
    const needle = String(query || "").trim().toLocaleLowerCase("fi");
    if (needle.length < 2) {
        return [];
    }
    const birds = await loadBirds();
    const results = [];
    for (const bird of birds) {
        let matched = "";
        for (const item of bird.keys) {
            if (item.key.startsWith(needle)) {
                matched = item.name;
                break;
            }
        }
        if (!matched) {
            continue;
        }
        results.push({ id: bird.id, name: matched, value: matched });
        if (results.length === MAX_RESULTS) {
            break;
        }
    }
    return results;
}
