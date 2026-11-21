// Sends pending observations one at a time while the map or document step is open.

import * as api from "./api.js";
import * as db from "./db.js";

const TIMEOUT_MS = 20000;
const RETRY_MS = 5000;

export function createInterpretRunner({ isActive, onChange }) {
    let wanted = false;
    let loop = null;
    let wake = null;
    const deferred = new Set();

    function sleep(ms) {
        return new Promise((resolve) => {
            const timer = setTimeout(finish, ms);
            function finish() {
                wake = null;
                resolve();
            }
            wake = () => {
                clearTimeout(timer);
                finish();
            };
        });
    }

    function start() {
        wanted = true;
        if (wake) {
            wake();
        }
        if (!loop) {
            loop = run().finally(() => {
                loop = null;
                if (wanted) {
                    start();
                }
            });
        }
    }

    function stop() {
        wanted = false;
        deferred.clear();
        if (wake) {
            wake();
        }
    }

    async function run() {
        while (wanted) {
            if (!isActive()) {
                await sleep(RETRY_MS);
                continue;
            }
            let rows;
            try {
                rows = await db.listObservations();
            } catch (_error) {
                await sleep(RETRY_MS);
                continue;
            }
            if (!wanted) {
                return;
            }
            const pending = rows.filter((obs) => {
                return obs.interpretationState === "pending" && obs.id && !deferred.has(obs.id);
            });
            if (pending.length === 0) {
                deferred.clear();
                await sleep(RETRY_MS);
                continue;
            }
            const outcome = await interpretOne(pending[0]);
            if (outcome === "updated") {
                try {
                    await onChange();
                } catch (_error) {
                    // The row is already saved. The map reads it the next time it opens.
                }
            }
            if (!wanted) {
                return;
            }
            if (outcome === "retry") {
                deferred.add(pending[0].id);
                continue;
            }
            deferred.delete(pending[0].id);
        }
    }

    return { start, stop };
}

async function interpretOne(obs) {
    const sent = {
        id: obs.id,
        taxon: typeof obs.taxon === "string" ? obs.taxon : "",
        notes: typeof obs.notes === "string" ? obs.notes : "",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const body = await api.interpretObservation(sent.taxon, sent.notes, controller.signal);
        return await applyAnswer(sent, body);
    } catch (error) {
        if (error && (error.name === "AbortError" || error.retry)) {
            return "retry";
        }
        try {
            return await markFailed(sent);
        } catch (_writeError) {
            return "retry";
        }
    } finally {
        clearTimeout(timer);
    }
}

async function currentRow(id) {
    const rows = await db.listObservations();
    return rows.find((row) => row.id === id) || null;
}

function stillPending(row, sent) {
    if (!row || row.interpretationState !== "pending") {
        return false;
    }
    const taxon = typeof row.taxon === "string" ? row.taxon : "";
    const notes = typeof row.notes === "string" ? row.notes : "";
    return taxon === sent.taxon && notes === sent.notes;
}

function copyFields(updated, body) {
    if (typeof body.count === "string" && body.count.trim()) {
        updated.count = body.count;
    }
    if (Number.isInteger(body.maleIndividualCount) && body.maleIndividualCount > 0) {
        updated.maleIndividualCount = body.maleIndividualCount;
    }
    if (Number.isInteger(body.femaleIndividualCount) && body.femaleIndividualCount > 0) {
        updated.femaleIndividualCount = body.femaleIndividualCount;
    }
    if (Array.isArray(body.movingStatus) && body.movingStatus.length > 0) {
        updated.movingStatus = body.movingStatus.slice();
    }
    if (typeof body.birdPlumage === "string" && body.birdPlumage) {
        updated.birdPlumage = body.birdPlumage;
    }
}

async function applyAnswer(sent, body) {
    const row = await currentRow(sent.id);
    if (!stillPending(row, sent)) {
        return "drop";
    }
    const updated = { ...row, interpretationState: "done" };
    copyFields(updated, body);
    await db.addObservation(updated);
    return "updated";
}

async function markFailed(sent) {
    const row = await currentRow(sent.id);
    if (!stillPending(row, sent)) {
        return "drop";
    }
    await db.addObservation({ ...row, interpretationState: "failed" });
    return "updated";
}
