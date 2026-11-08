// Terra's own API. This is the only module that calls the server.

export async function submitSession(session, observations) {
    const response = await fetch("/api/sessions/submit", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ session, observations }),
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
