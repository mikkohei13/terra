// Field session UI. Location is read once, when the session starts.

import * as api from "./api.js";
import * as db from "./db.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const viewStart = document.getElementById("view-start");
const viewSession = document.getElementById("view-session");
const viewDone = document.getElementById("view-done");
const statusLine = document.getElementById("status");
const startButton = document.getElementById("start-session");
const observeForm = document.getElementById("observe-form");
const taxonInput = document.getElementById("taxon");
const sessionMeta = document.getElementById("session-meta");
const observationList = document.getElementById("observation-list");
const endButton = document.getElementById("end-session");
const discardButton = document.getElementById("discard-session");
const doneDetail = document.getElementById("done-detail");
const anotherButton = document.getElementById("another-session");

let busy = false;

function $(id) {
    return document.getElementById(id);
}

function show(view) {
    viewStart.hidden = view !== "start";
    viewSession.hidden = view !== "session";
    viewDone.hidden = view !== "done";
    if (!busy) {
        statusLine.hidden = true;
        statusLine.textContent = "";
    }
}

function setBusy(isBusy, label) {
    busy = isBusy;
    for (const button of document.querySelectorAll("#app button")) {
        button.disabled = isBusy;
    }
    if (isBusy && label) {
        statusLine.hidden = false;
        statusLine.textContent = label;
    } else {
        statusLine.hidden = true;
        statusLine.textContent = "";
    }
}

function hideProblem(id) {
    const el = $(id);
    el.hidden = true;
    el.replaceChildren();
}

function showProblem(id, error) {
    const el = $(id);
    el.hidden = false;
    el.replaceChildren();
    const message = document.createElement("p");
    message.textContent = (error && error.message) || "Something went wrong.";
    el.append(message);
    if (error && error.details) {
        const pre = document.createElement("pre");
        pre.className = "details";
        pre.textContent = typeof error.details === "string"
            ? error.details
            : JSON.stringify(error.details, null, 2);
        el.append(pre);
    }
    if (error && error.loginRequired) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Log in again";
        button.addEventListener("click", () => {
            window.location.reload();
        });
        el.append(button);
    }
}

function localStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatStamp(stamp) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp || "");
    if (!match) {
        return stamp || "";
    }
    const month = MONTHS[Number(match[2]) - 1] || match[2];
    return `${Number(match[3])} ${month} ${match[1]}, ${match[4]}:${match[5]}`;
}

function formatPoint(lat, lon) {
    return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

function round6(n) {
    return Math.round(n * 1e6) / 1e6;
}

function sessionIsUsable(session) {
    return Boolean(
        session
        && typeof session.startedAt === "string"
        && typeof session.lat === "number"
        && typeof session.lon === "number"
    );
}

function currentPosition() {
    if (!navigator.geolocation) {
        return Promise.reject(new Error("This browser has no location service."));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0,
        });
    });
}

function positionMessage(error) {
    if (error && error.code === 1) {
        return "Location permission is needed to start a session.";
    }
    if (error && error.code === 2) {
        return "Location is unavailable.";
    }
    if (error && error.code === 3) {
        return "Finding the location took too long. Try again.";
    }
    return (error && error.message) || "Could not read the location.";
}

function renderObservations(observations) {
    observationList.replaceChildren();
    if (observations.length === 0) {
        const empty = document.createElement("li");
        empty.className = "muted";
        empty.textContent = "No observations yet.";
        observationList.append(empty);
        return;
    }
    for (const obs of observations) {
        const item = document.createElement("li");
        item.className = "obs-item";

        const name = document.createElement("div");
        name.className = "obs-name";
        name.textContent = obs.taxon;

        const meta = document.createElement("div");
        meta.className = "obs-meta";
        meta.textContent = formatStamp(obs.at);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => {
            removeObservation(obs);
        });

        item.append(name, meta, remove);
        observationList.append(item);
    }
}

async function renderSession() {
    const session = await db.getSession();
    const observations = await db.listObservations();
    const countLabel = observations.length === 1 ? "1 observation" : `${observations.length} observations`;
    sessionMeta.textContent = `Started ${formatStamp(session.startedAt)}. Location ${formatPoint(session.lat, session.lon)}. ${countLabel}.`;
    renderObservations(observations);
    show("session");
}

async function startSession() {
    if (busy) {
        return;
    }
    hideProblem("start-error");
    setBusy(true, "Getting location…");
    try {
        const position = await currentPosition();
        const session = {
            startedAt: localStamp(),
            lat: round6(position.coords.latitude),
            lon: round6(position.coords.longitude),
        };
        await db.clearSession();
        await db.saveSession(session);
        hideProblem("session-error");
        taxonInput.value = "";
        await renderSession();
        taxonInput.focus();
    } catch (error) {
        showProblem("start-error", { message: positionMessage(error) });
    } finally {
        setBusy(false);
    }
}

async function saveObservation() {
    if (busy) {
        return;
    }
    const taxon = taxonInput.value.trim();
    if (!taxon) {
        taxonInput.value = "";
        taxonInput.focus();
        return;
    }
    hideProblem("session-error");
    setBusy(true, "Saving…");
    try {
        const existing = await db.listObservations();
        const seq = existing.reduce((max, obs) => Math.max(max, obs.seq || 0), 0) + 1;
        await db.addObservation({
            id: crypto.randomUUID(),
            seq,
            taxon,
            at: localStamp(),
        });
        taxonInput.value = "";
        await renderSession();
    } catch (error) {
        showProblem("session-error", { message: error.message || "Could not save the observation." });
    } finally {
        setBusy(false);
        taxonInput.focus();
    }
}

async function removeObservation(obs) {
    if (busy) {
        return;
    }
    if (!window.confirm(`Delete ${obs.taxon}?`)) {
        return;
    }
    hideProblem("session-error");
    try {
        await db.deleteObservation(obs.id);
        await renderSession();
    } catch (error) {
        showProblem("session-error", { message: error.message || "Could not delete the observation." });
    }
}

async function endSession() {
    if (busy) {
        return;
    }
    hideProblem("session-error");
    const observations = await db.listObservations();
    if (observations.length === 0) {
        if (!window.confirm("There are no observations to submit. Discard this session?")) {
            return;
        }
        try {
            await db.clearSession();
            show("start");
        } catch (error) {
            showProblem("session-error", { message: error.message || "Could not discard the session." });
        }
        return;
    }
    const names = observations.map((obs) => obs.taxon).join("\n");
    const label = observations.length === 1 ? "1 observation" : `${observations.length} observations`;
    if (!window.confirm(`Submit ${label} to FinBIF?\n\n${names}`)) {
        return;
    }

    setBusy(true, "Submitting…");
    try {
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            show("start");
            showProblem("start-error", { message: "The session is no longer on this phone." });
            return;
        }
        const result = await api.submitSession(
            {
                startedAt: session.startedAt,
                endedAt: localStamp(),
                lat: session.lat,
                lon: session.lon,
            },
            observations.map((obs) => ({
                seq: obs.seq,
                taxon: obs.taxon,
                at: obs.at,
            })),
        );
        await db.clearSession();
        doneDetail.textContent = result.documentId
            ? `Document ID ${result.documentId}`
            : "Submitted. Look up the new document on laji.fi.";
        show("done");
    } catch (error) {
        showProblem("session-error", error);
    } finally {
        setBusy(false);
    }
}

async function discardSession() {
    if (busy) {
        return;
    }
    if (!window.confirm("Discard this session and its observations?")) {
        return;
    }
    try {
        await db.clearSession();
        hideProblem("start-error");
        taxonInput.value = "";
        show("start");
    } catch (error) {
        showProblem("session-error", { message: error.message || "Could not discard the session." });
    }
}

async function boot() {
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
    }
    try {
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            if (session || (await db.listObservations()).length > 0) {
                await db.clearSession();
                showProblem("start-error", {
                    message: "The saved session was incomplete, so it was discarded.",
                });
            }
            show("start");
            return;
        }
        await renderSession();
    } catch (error) {
        show("start");
        showProblem("start-error", {
            message: error.message || "Could not open saved observations on this phone.",
        });
    }
}

startButton.addEventListener("click", () => {
    startSession();
});
observeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveObservation();
});
endButton.addEventListener("click", () => {
    endSession();
});
discardButton.addEventListener("click", () => {
    discardSession();
});
anotherButton.addEventListener("click", () => {
    hideProblem("start-error");
    show("start");
});

boot();
