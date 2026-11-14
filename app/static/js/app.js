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

const MAX_KEYWORDS = 30;

const viewStart = document.getElementById("view-start");
const viewSession = document.getElementById("view-session");
const viewDocument = document.getElementById("view-document");
const viewDone = document.getElementById("view-done");
const statusLine = document.getElementById("status");
const startButton = document.getElementById("start-session");
const sessionMeta = document.getElementById("session-meta");
const endButton = document.getElementById("end-session");
const documentForm = document.getElementById("document-form");
const localityInput = document.getElementById("locality");
const keywordList = document.getElementById("keyword-list");
const keywordInput = document.getElementById("keyword-input");
const addKeywordButton = document.getElementById("add-keyword");
const discardButton = document.getElementById("discard-session");
const backToMapButton = document.getElementById("back-to-map");
const doneDetail = document.getElementById("done-detail");
const anotherButton = document.getElementById("another-session");
const cancelPinButton = document.getElementById("cancel-pin");
const addObsButton = document.getElementById("add-obs");
const editObsButton = document.getElementById("edit-obs");
const useLocationButton = document.getElementById("use-location");

let busy = false;
let mapSessionKey = null;
let observe;
let keywords = ["new"];

const mapApi = createSessionMap({
    isBusy: () => busy,
    isBlocked: () => observe.dialogsOpen(),
    isSessionVisible: () => !viewSession.hidden,
    onTap(latlng) {
        if (observe.isRelocating()) {
            return;
        }
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
    viewDocument.hidden = view !== "document";
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

function setRelocateActions(on) {
    addObsButton.hidden = on;
    useLocationButton.hidden = !on;
    if (on) {
        editObsButton.hidden = true;
    }
}

function pointFrom(source) {
    if (!source || typeof source.lat !== "number" || typeof source.lon !== "number") {
        return null;
    }
    return { lat: source.lat, lon: source.lon };
}

function clearPin() {
    setRelocateActions(false);
    mapApi.clearDraft();
    observe.dismiss();
}

async function beginLocationChange(obs, pending) {
    try {
        let point = pointFrom(pending) || pointFrom(obs);
        if (!point) {
            const session = await db.getSession();
            if (!observe.isRelocating()) {
                return;
            }
            if (!sessionIsUsable(session)) {
                observe.cancelLocationChange();
                return;
            }
            point = { lat: session.lat, lon: session.lon };
        }
        if (!observe.isRelocating()) {
            return;
        }
        mapApi.follow(false);
        mapApi.placePin(point.lat, point.lon);
        if (!mapApi.hasDraft()) {
            observe.cancelLocationChange();
            return;
        }
        mapApi.panTo(point.lat, point.lon);
        setRelocateActions(true);
    } catch (error) {
        if (observe.isRelocating()) {
            observe.cancelLocationChange();
        }
        showProblem("session-error", { message: error.message || "Could not change the location." });
    }
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

function renderKeywords() {
    keywordList.replaceChildren();
    keywords.forEach((keyword, index) => {
        const item = document.createElement("li");
        item.className = "keyword-item";
        const name = document.createElement("span");
        name.textContent = keyword;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "red";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
            keywords.splice(index, 1);
            renderKeywords();
        });
        item.append(name, remove);
        keywordList.append(item);
    });
}

function fillDocumentForm(documentHeader) {
    const header = documentHeader && typeof documentHeader === "object" && !Array.isArray(documentHeader)
        ? documentHeader
        : {};
    localityInput.value = typeof header.locality === "string" ? header.locality : "";
    if (Array.isArray(header.keywords)) {
        keywords = header.keywords
            .filter((keyword) => typeof keyword === "string" && keyword.trim())
            .map((keyword) => keyword.trim());
    } else {
        keywords = ["new"];
    }
    keywordInput.value = "";
    renderKeywords();
    hideProblem("document-error");
}

function readDocumentForm() {
    const header = { keywords: keywords.slice() };
    const locality = localityInput.value.trim();
    if (locality) {
        header.locality = locality;
    }
    return header;
}

function addKeyword() {
    const text = keywordInput.value.trim();
    if (!text) {
        keywordInput.value = "";
        return;
    }
    if (keywords.length >= MAX_KEYWORDS) {
        showProblem("document-error", { message: `A document can contain at most ${MAX_KEYWORDS} keywords.` });
        return;
    }
    hideProblem("document-error");
    keywords.push(text);
    keywordInput.value = "";
    renderKeywords();
}

function saveJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function openDocumentView() {
    if (busy) {
        return;
    }
    hideProblem("session-error");
    if (observe.isRelocating()) {
        setRelocateActions(false);
        mapApi.clearDraft();
        observe.dismiss();
    }
    setBusy(true, "Saving route…");
    try {
        await mapApi.flushLatest();
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            show("start");
            showProblem("start-error", { message: "The session is no longer on this phone." });
            return;
        }
        fillDocumentForm(session.document);
        show("document");
    } catch (error) {
        showProblem("session-error", { message: error.message || "Could not open the document." });
    } finally {
        setBusy(false);
    }
}

async function backToMap() {
    if (busy) {
        return;
    }
    hideProblem("document-error");
    try {
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            show("start");
            return;
        }
        session.document = readDocumentForm();
        await db.saveSession(session);
        await renderSession();
    } catch (error) {
        showProblem("document-error", { message: error.message || "Could not save the document." });
    }
}

async function submitDocument() {
    if (busy) {
        return;
    }
    hideProblem("document-error");
    const observations = await db.listObservations();
    if (observations.length === 0) {
        showProblem("document-error", {
            message: "Add at least one observation before ending the session.",
        });
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
        session.endedAt = localStamp();
        session.document = readDocumentForm();
        await db.saveSession(session);
        const stored = await db.listObservations();
        const result = await api.submitSession(session, stored, session.document);
        await db.clearSession();
        doneDetail.textContent = result.documentId
            ? `Document ID ${result.documentId}`
            : "Submitted. Look up the new document on laji.fi.";
        show("done");
    } catch (error) {
        showProblem("document-error", error);
    } finally {
        setBusy(false);
        if (!viewSession.hidden) {
            mapApi.startWatching();
        }
    }
}

function discardMessage(observations) {
    if (observations.length === 0) {
        return "Save this session as a file on this phone and remove it from the app? Nothing will be sent to FinBIF.";
    }
    const label = observations.length === 1 ? "1 observation" : `${observations.length} observations`;
    const names = observations.map((obs) => obs.taxon).join("\n");
    return `Save this session as a file on this phone and remove it from the app? ${label} will not be sent to FinBIF.\n\n${names}`;
}

async function discardSession() {
    if (busy) {
        return;
    }
    hideProblem("document-error");
    const observations = await db.listObservations();
    if (!window.confirm(discardMessage(observations))) {
        return;
    }
    try {
        const session = await db.getSession();
        if (!sessionIsUsable(session)) {
            show("start");
            return;
        }
        const header = readDocumentForm();
        const endedAt = localStamp();
        const file = {
            session: {
                startedAt: session.startedAt,
                endedAt,
                lat: session.lat,
                lon: session.lon,
                points: Array.isArray(session.points) ? session.points : [],
            },
            observations,
            document: header,
        };
        saveJsonFile(file, `terra-${endedAt.replace(/:/g, "")}.json`);
        await db.clearSession();
        clearPin();
        show("start");
    } catch (error) {
        showProblem("document-error", { message: error.message || "Could not save the session file." });
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
    requestLocationChange: beginLocationChange,
    abortLocationChange() {
        setRelocateActions(false);
        mapApi.clearDraft();
    },
});

startButton.addEventListener("click", () => {
    startSession();
});
cancelPinButton.addEventListener("click", () => {
    if (busy) {
        return;
    }
    if (observe.isRelocating()) {
        setRelocateActions(false);
        mapApi.clearDraft();
        observe.cancelLocationChange();
        return;
    }
    clearPin();
});
useLocationButton.addEventListener("click", () => {
    if (busy) {
        return;
    }
    const point = mapApi.draftPoint();
    if (!point || !observe.acceptLocation(point)) {
        setRelocateActions(false);
        return;
    }
    setRelocateActions(false);
    if (mapApi.hasDraft()) {
        observe.updateNearby(mapApi.draftLatLng());
    }
});
endButton.addEventListener("click", () => {
    openDocumentView();
});
documentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitDocument();
});
localityInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
    }
});
keywordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        addKeyword();
    }
});
addKeywordButton.addEventListener("click", () => {
    addKeyword();
});
discardButton.addEventListener("click", () => {
    discardSession();
});
backToMapButton.addEventListener("click", () => {
    backToMap();
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
