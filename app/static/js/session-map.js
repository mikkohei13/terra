// Map, pin, follow, and the phone's location. Route thinning stays on the
// device because it runs on each GPS fix while offline.

import * as db from "./db.js";
import * as devdots from "./devdots.js"; // devdots
import { MAX_ROUTE_POINTS, shouldRecordPoint } from "./route.js";
import { getSetting } from "./settings.js";

const USER_MARKER_INTERVAL_MS = 5000;
const WATCH_RETRY_MS = 30000;

export function localStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function round6(n) {
    return Math.round(n * 1e6) / 1e6;
}

export function sessionIsUsable(session) {
    return Boolean(
        session
        && typeof session.startedAt === "string"
        && typeof session.lat === "number"
        && typeof session.lon === "number"
    );
}

export function currentPosition() {
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

export function positionMessage(error) {
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

export function fixFromPosition(position) {
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

export function createSessionMap({ isBusy, isBlocked, isSessionVisible, onTap }) {
    const followToggle = document.getElementById("follow-toggle");
    const pinActions = document.getElementById("pin-actions");

    let map = null;
    let userMarker = null;
    let draftMarker = null;
    let savedLayer = null;
    let watchId = null;
    let watchToken = 0;
    let following = true;
    let lastUserMarkerAt = 0;
    let latestFix = null;
    let recordChain = Promise.resolve();
    let watchRetryTimer = null;

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

    function ensure(lat, lon) {
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
            if (isBusy() || isBlocked()) {
                return;
            }
            placePin(event.latlng.lat, event.latlng.lng);
            onTap(event.latlng);
        });
        showUser(lat, lon);
    }

    function panTo(lat, lon) {
        if (!map) {
            return;
        }
        map.panTo([lat, lon]);
    }

    function clearDraft() {
        if (draftMarker) {
            draftMarker.remove();
            draftMarker = null;
        }
        pinActions.hidden = true;
    }

    function draftPoint() {
        if (!draftMarker) {
            return null;
        }
        const latLng = draftMarker.getLatLng();
        return { lat: round6(latLng.lat), lon: round6(latLng.lng) };
    }

    function renderMarkers(observations) {
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

    function showRoute(points) {
        devdots.show(map, points); // devdots
    }

    function offerRoutePoint(fix) {
        recordChain = recordChain.then(() => maybeRecordPoint(fix)).catch(() => {});
        return recordChain;
    }

    async function maybeRecordPoint(fix) {
        if (!fix || document.hidden || !isSessionVisible()) {
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
        if (watchRetryTimer !== null || document.hidden || !isSessionVisible()) {
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

    syncFollowButton();
    followToggle.addEventListener("click", () => {
        if (isBusy()) {
            return;
        }
        if (following) {
            setFollowing(false);
            return;
        }
        setFollowing(true);
        centerOnUser();
    });

    return {
        ensure,
        invalidate() {
            if (map) {
                map.invalidateSize();
            }
        },
        view(lat, lon) {
            if (map) {
                map.setView([lat, lon], 16);
            }
        },
        showUser,
        follow: setFollowing,
        placePin,
        panTo,
        clearDraft,
        hasDraft() {
            return Boolean(draftMarker);
        },
        draftPoint,
        draftLatLng() {
            return draftMarker ? draftMarker.getLatLng() : null;
        },
        renderMarkers,
        toContainerPoint(latlng) {
            if (!map) {
                return null;
            }
            return map.latLngToContainerPoint(latlng);
        },
        startWatching,
        stopWatching,
        flushLatest() {
            return offerRoutePoint(latestFix);
        },
        setLatestFix(fix) {
            latestFix = fix;
        },
        showRoute,
    };
}
