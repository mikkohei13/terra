// Observation dialog and list. This stores what the form shows.
// The server decides which fields are valid.

import * as db from "./db.js";
import { attachTaxonField } from "./taxon-field.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NEARBY_TAP_PX = 48;

export function formatStamp(stamp) {
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

export function createObserve({
    isBusy,
    setBusy,
    showProblem,
    hideProblem,
    draftPoint,
    localStamp,
    refresh,
    clearPin,
    toContainerPoint,
}) {
    const observeForm = document.getElementById("observe-form");
    const observeDialog = document.getElementById("observe-dialog");
    const taxonInput = document.getElementById("taxon");
    const observationList = document.getElementById("observation-list");
    const addObsButton = document.getElementById("add-obs");
    const editObsButton = document.getElementById("edit-obs");
    const closeObserveButton = document.getElementById("close-observe");
    const editListDialog = document.getElementById("edit-list-dialog");
    const editList = document.getElementById("edit-list");
    const closeEditListButton = document.getElementById("close-edit-list");
    const taxonField = attachTaxonField(
        taxonInput,
        document.getElementById("taxon-results"),
        observeDialog,
    );

    let sessionObservations = [];
    let nearbyObservations = [];
    let editingObservation = null;

    function renderList(observations) {
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

    function clearNearby() {
        nearbyObservations = [];
        editObsButton.hidden = true;
    }

    function updateNearby(latLng) {
        const tapPoint = toContainerPoint(latLng);
        if (!tapPoint) {
            clearNearby();
            return;
        }
        nearbyObservations = sessionObservations
            .filter((obs) => typeof obs.lat === "number" && typeof obs.lon === "number")
            .filter((obs) => {
                const point = toContainerPoint([obs.lat, obs.lon]);
                if (!point) {
                    return false;
                }
                const dx = point.x - tapPoint.x;
                const dy = point.y - tapPoint.y;
                return dx * dx + dy * dy <= NEARBY_TAP_PX * NEARBY_TAP_PX;
            })
            .slice()
            .sort((a, b) => (b.seq || 0) - (a.seq || 0));
        editObsButton.hidden = nearbyObservations.length === 0;
    }

    function dismiss() {
        clearNearby();
        editingObservation = null;
        taxonField.clear();
        hideProblem("observe-error");
        if (editListDialog.open) {
            editListDialog.close();
        }
        if (observeDialog.open) {
            observeDialog.close();
        }
    }

    function openObserve() {
        if (isBusy() || !draftPoint()) {
            return;
        }
        editingObservation = null;
        taxonField.clear();
        hideProblem("observe-error");
        if (!observeDialog.open) {
            observeDialog.showModal();
        }
        taxonInput.focus();
    }

    function openEditList() {
        if (isBusy() || nearbyObservations.length === 0) {
            return;
        }
        editList.replaceChildren();
        for (const obs of nearbyObservations) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary";
            button.textContent = obs.taxon || "Observation";
            button.addEventListener("click", () => {
                openEditObservation(obs);
            });
            item.append(button);
            editList.append(item);
        }
        if (!editListDialog.open) {
            editListDialog.showModal();
        }
    }

    function openEditObservation(obs) {
        if (isBusy() || !obs) {
            return;
        }
        editingObservation = obs;
        if (editListDialog.open) {
            editListDialog.close();
        }
        taxonField.setValue(obs.taxon || "", obs.taxonId || null);
        hideProblem("observe-error");
        if (!observeDialog.open) {
            observeDialog.showModal();
        }
        taxonInput.focus();
    }

    async function saveObservation() {
        if (isBusy()) {
            return;
        }
        const taxon = taxonInput.value.trim();
        if (!taxon) {
            taxonInput.value = "";
            taxonInput.focus();
            return;
        }
        const editing = editingObservation;
        const point = draftPoint();
        if (!editing && !point) {
            clearPin();
            return;
        }
        hideProblem("observe-error");
        setBusy(true, "Saving…");
        try {
            const taxonId = taxonField.selectedTaxonId();
            let observation;
            if (editing) {
                // Copy first so a field this form does not show stays on the record.
                observation = { ...editing, taxon };
            } else {
                const existing = await db.listObservations();
                const seq = existing.reduce((max, obs) => Math.max(max, obs.seq || 0), 0) + 1;
                observation = {
                    id: crypto.randomUUID(),
                    seq,
                    taxon,
                    at: localStamp(),
                    lat: point.lat,
                    lon: point.lon,
                };
            }
            if (taxonId) {
                observation.taxonId = taxonId;
            } else {
                delete observation.taxonId;
            }
            await db.addObservation(observation);
            clearPin();
            await refresh();
        } catch (error) {
            showProblem("observe-error", { message: error.message || "Could not save the observation." });
        } finally {
            setBusy(false);
        }
    }

    async function removeObservation(obs) {
        if (isBusy()) {
            return;
        }
        if (!window.confirm(`Delete ${obs.taxon}?`)) {
            return;
        }
        hideProblem("session-error");
        try {
            await db.deleteObservation(obs.id);
            await refresh();
        } catch (error) {
            showProblem("session-error", { message: error.message || "Could not delete the observation." });
        }
    }

    observeForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveObservation();
    });
    addObsButton.addEventListener("click", () => {
        openObserve();
    });
    editObsButton.addEventListener("click", () => {
        openEditList();
    });
    closeObserveButton.addEventListener("click", () => {
        observeDialog.close();
    });
    closeEditListButton.addEventListener("click", () => {
        editListDialog.close();
    });
    observeDialog.addEventListener("close", () => {
        // Closing without Save leaves the pin; Add obs can start a new one next.
        editingObservation = null;
    });

    return {
        dialogsOpen() {
            return observeDialog.open || editListDialog.open;
        },
        setObservations(observations) {
            sessionObservations = observations;
        },
        renderList,
        updateNearby,
        beginNewPin() {
            editingObservation = null;
        },
        dismiss,
    };
}
