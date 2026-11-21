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
    let response;
    try {
        response = await fetch("/api/sessions/submit", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
    } catch (_error) {
        const error = new Error("The submission did not finish.");
        error.maybeSaved = true;
        throw error;
    }

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    if (!response.ok) {
        // No JSON means a proxy cut the request. The document may exist.
        const maybeSaved = body ? Boolean(body.maybeSaved) : true;
        const error = new Error(
            (body && body.message)
                || (maybeSaved ? "The submission did not finish." : "Submit failed.")
        );
        error.details = body && body.details;
        error.loginRequired = Boolean(body && body.loginRequired);
        error.maybeSaved = maybeSaved;
        throw error;
    }
    return body || {};
}

export async function interpretObservation(notes, signal) {
    let response;
    try {
        response = await fetch("/api/observations/interpret", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ notes }),
            signal,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw error;
        }
        const retry = new Error("Interpretation is unavailable.");
        retry.retry = true;
        throw retry;
    }

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    if (response.status === 429 || response.status === 503) {
        const retry = new Error((body && body.message) || "Interpretation is unavailable.");
        retry.retry = true;
        throw retry;
    }
    if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error((body && body.message) || "Interpretation failed.");
    }
    return body;
}
