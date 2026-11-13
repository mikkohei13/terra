// Whether a GPS fix is stored as the next route point.
// Compared only with the previous stored point, so a return visit may sit
// next to an older point.

import { MIN_DISTANCE_M_DEFAULT } from "./settings.js";

export const MAX_ACCURACY_M = 100;
export const MIN_DISTANCE_M = MIN_DISTANCE_M_DEFAULT;
export const MAX_ROUTE_POINTS = 2000;

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

export function distanceMeters(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function shouldRecordPoint(previous, fix, minDistanceM = MIN_DISTANCE_M) {
    if (!fix || typeof fix.lat !== "number" || typeof fix.lon !== "number") {
        return false;
    }
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) {
        return false;
    }
    if (typeof fix.accuracy !== "number" || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) {
        return false;
    }
    if (fix.accuracy > MAX_ACCURACY_M) {
        return false;
    }
    if (!previous) {
        return true;
    }
    const minimum = Number.isFinite(minDistanceM) ? minDistanceM : MIN_DISTANCE_M;
    return distanceMeters(previous, fix) >= minimum;
}
