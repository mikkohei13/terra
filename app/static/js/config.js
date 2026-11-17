// Values from Python, rendered into #terra-config on the logged-in page.

const el = document.getElementById("terra-config");
if (!el) {
    throw new Error("Missing terra-config.");
}

let parsed;
try {
    parsed = JSON.parse(el.textContent);
} catch (_error) {
    throw new Error("Could not read terra-config.");
}

if (!parsed || typeof parsed !== "object" || !parsed.limits) {
    throw new Error("terra-config is incomplete.");
}

export const limits = parsed.limits;
export const defaultKeywords = Array.isArray(parsed.defaultKeywords)
    ? parsed.defaultKeywords.slice()
    : ["new"];
export const informalTaxonGroups = Array.isArray(parsed.informalTaxonGroups)
    ? parsed.informalTaxonGroups
    : [];
