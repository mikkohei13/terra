// Session stamps, coordinates, and the fields parked with discard / send later.

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

/** Fields every parked session must keep. Add a new session-level field here. */
export function sessionFields(session) {
    return {
        startedAt: session.startedAt,
        lat: session.lat,
        lon: session.lon,
        points: Array.isArray(session.points) ? session.points : [],
    };
}
