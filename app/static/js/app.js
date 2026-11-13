// Field session UI. The map shows where the user is. A tap places the observation.

import * as api from "./api.js";
import * as db from "./db.js";
import * as devdots from "./devdots.js"; // devdots
import { MAX_ROUTE_POINTS, shouldRecordPoint } from "./route.js";
import { getSetting } from "./settings.js";
import { attachTaxonField } from "./taxon-field.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const viewStart = document.getElementById("view-start");
const viewSession = document.getElementById("view-session");
const viewDone = document.getElementById("view-done");
const statusLine = document.getElementById("status");
const startButton = document.getElementById("start-session");
const observeForm = document.getElementById("observe-form");
const observeDialog = document.getElementById("observe-dialog");
const taxonInput = document.getElementById("taxon");
const sessionMeta = document.getElementById("session-meta");
const observationList = document.getElementById("observation-list");
const endButton = document.getElementById("end-session");
const doneDetail = document.getElementById("done-detail");
const anotherButton = document.getElementById("another-session");
const addObsButton = document.getElementById("add-obs");
const cancelPinButton = document.getElementById("cancel-pin");
const closeObserveButton = document.getElementById("close-observe");
const pinActions = document.getElementById("pin-actions");
const followToggle = document.getElementById("follow-toggle");
const taxonField = attachTaxonField(
    taxonInput,
    document.getElementById("taxon-results"),
    observeDialog,
);

const USER_MARKER_INTERVAL_MS = 5000;
const WATCH_RETRY_MS = 30000;

let busy = false;
let map = null;
let userMarker = null;
let draftMarker = null;
let savedLayer = null;
let watchId = null;
let watchToken = 0;
let mapSessionKey = null;
let following = true;
let lastUserMarkerAt = 0;
let latestFix = null;
let recordChain = Promise.resolve();
let watchRetryTimer = null;

function $(id) {
    return document.getElementById(id);
}

function show(view) {
    viewStart.hidden = view !== "start";
    viewSession.hidden = view !== "session";
    viewDone.hidden = view !== "done";
    if (view !== "session") {
        stopWatching();
        devdots.show(map, []); // devdots
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

function nextFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
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

function pinIcon() {
    // L.icon does not prefix Leaflet's own image folder. Icon.Default does,
    // which turned these paths into unpkg URLs.
    return L.icon({
        iconUrl: "/static/images/marker-icon.png",
        iconRetinaUrl: "/static/images/marker-icon.png",
        shadowUrl: "/static/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        shadowSize: [41, 41],
    });
}

function syncFollowButton() {
    followToggle.setAttribute("aria-pressed", following ? "true" : "false");
    followToggle.setAttribute("aria-label", following ? "Stop following" : "Start following");
    const iconOff = followToggle.querySelector(".follow-icon-off");
    const iconOn = followToggle.querySelector(".follow-icon-on");
    if (iconOff) {
        iconOff.hidden = following;
    }
    if (iconOn) {
        iconOn.hidden = !following;
    }
}

function setFollowing(on) {
    following = on;
    syncFollowButton();
}

function centerOnUser() {
    if (!map || !userMarker) {
        return;
    }
    map.panTo(userMarker.getLatLng());
}

function keepFollowingUser() {
    if (!following) {
        return;
    }
    centerOnUser();
}

function ensureMap(lat, lon) {
    if (map) {
        return;
    }
    if (typeof L === "undefined") {
        throw new Error("The map failed to load. Check the network and try again.");
    }
    map = L.map("map");
    // The page policy is no-referrer so a person token cannot leak. OSM still
    // requires a Referer that identifies the site, so each tile sends the origin only.
    // The browser caches these image requests; the URL has no cache-busting.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        referrerPolicy: "origin",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    savedLayer = L.layerGroup().addTo(map);
    map.setView([lat, lon], 16);
    map.on("dragstart", () => {
        // Update the FAB as soon as the drag begins, before the pan finishes.
        setFollowing(false);
    });
    map.on("click", (event) => {
        if (busy || observeDialog.open) {
            return;
        }
        placePin(event.latlng.lat, event.latlng.lng);
    });
    showUser(lat, lon);
}

function showUser(lat, lon) {
    if (!map) {
        return;
    }
    if (!userMarker) {
        userMarker = L.circleMarker([lat, lon], {
            radius: 9,
            color: "#ffffff",
            weight: 3,
            fillColor: "#2563eb",
            fillOpacity: 1,
        }).addTo(map);
        userMarker.bindTooltip("You", { direction: "top" });
    } else {
        userMarker.setLatLng([lat, lon]);
    }
    userMarker.bringToFront();
}

function placePin(lat, lon) {
    if (!map) {
        return;
    }
    if (!draftMarker) {
        draftMarker = L.marker([lat, lon], { icon: pinIcon(), draggable: true, autoPan: true }).addTo(map);
    } else {
        draftMarker.setLatLng([lat, lon]);
    }
    pinActions.hidden = false;
}

function clearPin() {
    if (draftMarker) {
        draftMarker.remove();
        draftMarker = null;
    }
    pinActions.hidden = true;
    taxonField.clear();
    hideProblem("observe-error");
    if (observeDialog.open) {
        observeDialog.close();
    }
}

function draftPoint() {
    if (!draftMarker) {
        return null;
    }
    const latLng = draftMarker.getLatLng();
    return { lat: round6(latLng.lat), lon: round6(latLng.lng) };
}

function renderObservationMarkers(observations) {
    if (!savedLayer) {
        return;
    }
    savedLayer.clearLayers();
    for (const obs of observations) {
        if (typeof obs.lat !== "number" || typeof obs.lon !== "number") {
            continue;
        }
        const marker = L.circleMarker([obs.lat, obs.lon], {
            radius: 8,
            color: "#14532d",
            weight: 2,
            fillColor: "#2f6b3a",
            fillOpacity: 0.95,
        });
        marker.bindTooltip(obs.taxon || "Observation", { direction: "top" });
        marker.addTo(savedLayer);
    }
    if (userMarker) {
        userMarker.bringToFront();
    }
}

function fixFromPosition(position) {
    const coords = position && position.coords;
    if (!coords || typeof coords.latitude !== "number" || typeof coords.longitude !== "number") {
        return null;
    }
    return {
        lat: coords.latitude,
        lon: coords.longitude,
        accuracy: typeof coords.accuracy === "number" ? coords.accuracy : null,
    };
}

function offerRoutePoint(fix) {
    recordChain = recordChain.then(() => maybeRecordPoint(fix)).catch(() => {});
    return recordChain;
}

async function maybeRecordPoint(fix) {
    if (!fix || document.hidden || viewSession.hidden) {
        return;
    }
    const session = await db.getSession();
    if (!sessionIsUsable(session)) {
        return;
    }
    const points = Array.isArray(session.points) ? session.points : [];
    if (points.length >= MAX_ROUTE_POINTS) {
        return;
    }
    const previous = points.length > 0 ? points[points.length - 1] : null;
    if (!shouldRecordPoint(previous, fix, getSetting("minDistanceM"))) {
        return;
    }
    session.points = points.concat({ lat: round6(fix.lat), lon: round6(fix.lon) });
    await db.saveSession(session);
    devdots.show(map, session.points); // devdots
}

function routePointsForSubmit(session) {
    const points = Array.isArray(session.points) ? session.points : [];
    return points
        .filter((point) => typeof point.lat === "number" && typeof point.lon === "number")
        .map((point) => ({ lat: point.lat, lon: point.lon }));
}

function clearWatchRetry() {
    if (watchRetryTimer !== null) {
        clearTimeout(watchRetryTimer);
        watchRetryTimer = null;
    }
}

function scheduleWatchRetry() {
    watchToken += 1;
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    if (watchRetryTimer !== null || document.hidden || viewSession.hidden) {
        return;
    }
    watchRetryTimer = setTimeout(() => {
        watchRetryTimer = null;
        startWatching();
    }, WATCH_RETRY_MS);
}

function startWatching() {
    if (!map || watchId !== null || !navigator.geolocation || document.hidden) {
        return;
    }
    clearWatchRetry();
    const token = ++watchToken;
    lastUserMarkerAt = 0;
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            if (token !== watchToken || !map || document.hidden) {
                return;
            }
            const fix = fixFromPosition(position);
            if (!fix) {
                return;
            }
            latestFix = fix;
            offerRoutePoint(fix);
            const now = Date.now();
            if (lastUserMarkerAt !== 0 && now - lastUserMarkerAt < USER_MARKER_INTERVAL_MS) {
                return;
            }
            lastUserMarkerAt = now;
            showUser(fix.lat, fix.lon);
            keepFollowingUser();
        },
        () => {
            if (token !== watchToken) {
                return;
            }
            scheduleWatchRetry();
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
}

function stopWatching() {
    watchToken += 1;
    clearWatchRetry();
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    lastUserMarkerAt = 0;
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
        const bits = [formatStamp(obs.at)];
        if (typeof obs.lat === "number" && typeof obs.lon === "number") {
            bits.push(formatPoint(obs.lat, obs.lon));
        }
        meta.textContent = bits.join(" · ");

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

async function renderSession({ recenter = false } = {}) {
    const session = await db.getSession();
    if (!sessionIsUsable(session)) {
        stopWatching();
        show("start");
        return;
    }
    const observations = await db.listObservations();
    sessionMeta.textContent = formatStamp(session.startedAt);
    renderObservations(observations);
    show("session");
    await nextFrame();
    const isNewSession = mapSessionKey !== session.startedAt;
    try {
        ensureMap(session.lat, session.lon);
    } catch (error) {
        showProblem("session-error", {
            message: error.message || "The map failed to load.",
        });
        return;
    }
    map.invalidateSize();
    if (recenter || isNewSession) {
        mapSessionKey = session.startedAt;
        clearPin();
        map.setView([session.lat, session.lon], 16);
        showUser(session.lat, session.lon);
        setFollowing(true);
    }
    renderObservationMarkers(observations);
    devdots.show(map, Array.isArray(session.points) ? session.points : []); // devdots
    startWatching();
}

function openObserve() {
    if (busy || !draftMarker) {
        return;
    }
    hideProblem("observe-error");
    if (!observeDialog.open) {
        observeDialog.showModal();
    }
    taxonInput.focus();
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
        latestFix = fix;
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

async function saveObservation() {
    if (busy) {
        return;
    }
    const point = draftPoint();
    if (!point) {
        clearPin();
        return;
    }
    const taxon = taxonInput.value.trim();
    if (!taxon) {
        taxonInput.value = "";
        taxonInput.focus();
        return;
    }
    hideProblem("observe-error");
    setBusy(true, "Saving…");
    try {
        const existing = await db.listObservations();
        const seq = existing.reduce((max, obs) => Math.max(max, obs.seq || 0), 0) + 1;
        // More fields (count, notes, wildness) belong on this object.
        const observation = {
            id: crypto.randomUUID(),
            seq,
            taxon,
            at: localStamp(),
            lat: point.lat,
            lon: point.lon,
        };
        const taxonId = taxonField.selectedTaxonId();
        if (taxonId) {
            observation.taxonId = taxonId;
        }
        await db.addObservation(observation);
        clearPin();
        await renderSession();
    } catch (error) {
        showProblem("observe-error", { message: error.message || "Could not save the observation." });
    } finally {
        setBusy(false);
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
    stopWatching();
    try {
        await offerRoutePoint(latestFix);
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
                points: routePointsForSubmit(session),
            },
            observations.map((obs) => {
                const row = {
                    seq: obs.seq,
                    taxon: obs.taxon,
                    at: obs.at,
                };
                if (typeof obs.lat === "number" && typeof obs.lon === "number") {
                    row.lat = obs.lat;
                    row.lon = obs.lon;
                }
                if (obs.taxonId) {
                    row.taxonId = obs.taxonId;
                }
                return row;
            }),
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
        if (!viewSession.hidden) {
            startWatching();
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

startButton.addEventListener("click", () => {
    startSession();
});
observeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveObservation();
});
addObsButton.addEventListener("click", () => {
    openObserve();
});
cancelPinButton.addEventListener("click", () => {
    if (busy) {
        return;
    }
    clearPin();
});
followToggle.addEventListener("click", () => {
    if (busy) {
        return;
    }
    if (following) {
        setFollowing(false);
        return;
    }
    setFollowing(true);
    centerOnUser();
});
closeObserveButton.addEventListener("click", () => {
    observeDialog.close();
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
        stopWatching();
        return;
    }
    if (!viewSession.hidden) {
        startWatching();
    }
});

boot();
