// Field session screens. Start, end, and discard live here.

import * as api from "./api.js";
import * as db from "./db.js";
import { createObserve, formatStamp } from "./observe.js";
import { shouldRecordPoint } from "./route.js";
import {
    createSessionMap,
    currentPosition,
    fixFromPosition,
    localStamp,
    positionMessage,
    round6,
    sessionIsUsable,
} from "./session-map.js";
import { getSetting } from "./settings.js";

const viewStart = document.getElementById("view-start");
const viewSession = document.getElementById("view-session");
const viewDone = document.getElementById("view-done");
const statusLine = document.getElementById("status");
const startButton = document.getElementById("start-session");
const sessionMeta = document.getElementById("session-meta");
const endButton = document.getElementById("end-session");
const doneDetail = document.getElementById("done-detail");
const anotherButton = document.getElementById("another-session");
const cancelPinButton = document.getElementById("cancel-pin");

let busy = false;
let mapSessionKey = null;
let observe;

const mapApi = createSessionMap({
    isBusy: () => busy,
    isBlocked: () => observe.dialogsOpen(),
    isSessionVisible: () => !viewSession.hidden,
    onTap(latlng) {
        observe.beginNewPin();
        observe.updateNearby(latlng);
    },
});

function $(id) {
    return document.getElementById(id);
}

function show(view) {
    viewStart.hidden = view !== "start";
    viewSession.hidden = view !== "session";
    viewDone.hidden = view !== "done";
    if (view !== "session") {
        mapApi.stopWatching();
        mapApi.showRoute([]);
    }
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

function nextFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function clearPin() {
    mapApi.clearDraft();
    observe.dismiss();
}

async function renderSession({ recenter = false } = {}) {
    const session = await db.getSession();
    if (!sessionIsUsable(session)) {
        mapApi.stopWatching();
        show("start");
        return;
    }
    const observations = await db.listObservations();
    observe.setObservations(observations);
    sessionMeta.textContent = formatStamp(session.startedAt);
    observe.renderList(observations);
    show("session");
    await nextFrame();
    const isNewSession = mapSessionKey !== session.startedAt;
    try {
        mapApi.ensure(session.lat, session.lon);
    } catch (error) {
        showProblem("session-error", {
            message: error.message || "The map failed to load.",
        });
        return;
    }
    mapApi.invalidate();
    if (recenter || isNewSession) {
        mapSessionKey = session.startedAt;
        clearPin();
        mapApi.view(session.lat, session.lon);
        mapApi.showUser(session.lat, session.lon);
        mapApi.follow(true);
    }
    mapApi.renderMarkers(observations);
    if (mapApi.hasDraft()) {
        observe.updateNearby(mapApi.draftLatLng());
    }
    mapApi.showRoute(Array.isArray(session.points) ? session.points : []);
    mapApi.startWatching();
}

async function startSession() {
    if (busy) {
        return;
    }
    hideProblem("start-error");
    setBusy(true, "Getting location…");
    try {
        const position = await currentPosition();
        const fix = fixFromPosition(position);
        if (!fix) {
            throw new Error("Could not read the location.");
        }
        mapApi.setLatestFix(fix);
        const session = {
            startedAt: localStamp(),
            lat: round6(fix.lat),
            lon: round6(fix.lon),
            points: [],
        };
        if (shouldRecordPoint(null, fix, getSetting("minDistanceM"))) {
            session.points.push({ lat: session.lat, lon: session.lon });
        }
        await db.clearSession();
        await db.saveSession(session);
        hideProblem("session-error");
        await renderSession({ recenter: true });
    } catch (error) {
        showProblem("start-error", { message: positionMessage(error) });
    } finally {
        setBusy(false);
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
    mapApi.stopWatching();
    try {
        await mapApi.flushLatest();
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            show("start");
            showProblem("start-error", { message: "The session is no longer on this phone." });
            return;
        }
        session.endedAt = localStamp();
        await db.saveSession(session);
        const stored = await db.listObservations();
        const result = await api.submitSession(session, stored, session.document);
        await db.clearSession();
        doneDetail.textContent = result.documentId
            ? `Document ID ${result.documentId}`
            : "Submitted. Look up the new document on laji.fi.";
        show("done");
    } catch (error) {
        showProblem("session-error", error);
    } finally {
        setBusy(false);
        if (!viewSession.hidden) {
            mapApi.startWatching();
        }
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
        await renderSession({ recenter: true });
    } catch (error) {
        show("start");
        showProblem("start-error", {
            message: error.message || "Could not open saved observations on this phone.",
        });
    }
}

observe = createObserve({
    isBusy: () => busy,
    setBusy,
    showProblem,
    hideProblem,
    draftPoint: () => mapApi.draftPoint(),
    localStamp,
    refresh: () => renderSession(),
    clearPin,
    toContainerPoint: (latlng) => mapApi.toContainerPoint(latlng),
});

startButton.addEventListener("click", () => {
    startSession();
});
cancelPinButton.addEventListener("click", () => {
    if (busy) {
        return;
    }
    clearPin();
});
endButton.addEventListener("click", () => {
    endSession();
});
anotherButton.addEventListener("click", () => {
    hideProblem("start-error");
    show("start");
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        mapApi.stopWatching();
        return;
    }
    if (!viewSession.hidden) {
        mapApi.startWatching();
    }
});

boot();
