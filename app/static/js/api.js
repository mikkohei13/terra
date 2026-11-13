// Terra's own API. This is the only module that calls the server.

export async function autocompleteTaxa(query, informalTaxonGroupIds, signal) {
    const params = new URLSearchParams();
    params.set("query", query);
    if (Array.isArray(informalTaxonGroupIds) && informalTaxonGroupIds.length) {
        params.set("informalTaxonGroups", informalTaxonGroupIds.join(","));
    }
    const response = await fetch("/api/taxa/autocomplete?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    if (!response.ok) {
        const error = new Error((body && body.message) || "Taxon search failed.");
        error.loginRequired = Boolean(body && body.loginRequired);
        throw error;
    }
    return body || { results: [] };
}

export async function submitSession(session, observations, document) {
    const payload = { session, observations };
    if (document && typeof document === "object" && !Array.isArray(document)) {
        payload.document = document;
    }
    const response = await fetch("/api/sessions/submit", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    if (!response.ok) {
        const error = new Error((body && body.message) || "Submit failed.");
        error.details = body && body.details;
        error.loginRequired = Boolean(body && body.loginRequired);
        throw error;
    }
    return body || {};
}
