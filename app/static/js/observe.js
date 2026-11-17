// Observation dialog and list. This stores what the form shows.
// The server decides which fields are valid.

import * as db from "./db.js";
import { limits } from "./config.js";
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
    requestLocationChange,
    abortLocationChange,
    suggestedAccuracy,
}) {
    const observeForm = document.getElementById("observe-form");
    const observeDialog = document.getElementById("observe-dialog");
    const taxonInput = document.getElementById("taxon");
    const countInput = document.getElementById("count");
    const notesInput = document.getElementById("notes");
    const accuracyInput = document.getElementById("accuracy");
    const changeLocationButton = document.getElementById("change-location");
    const deleteObsButton = document.getElementById("delete-obs");
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
        () => {
            countInput.focus();
        },
        document.getElementById("taxon-scope"),
    );

    let sessionObservations = [];
    let nearbyObservations = [];
    let editingObservation = null;
    let relocating = false;
    let pendingPoint = null;

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
            name.textContent = obs.count ? `${obs.taxon} · ${obs.count}` : obs.taxon;

            const meta = document.createElement("div");
            meta.className = "obs-meta";
            const bits = [formatStamp(obs.at)];
            if (obs.notes) {
                bits.push(obs.notes);
            }
            meta.textContent = bits.join(" · ");

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "blue";
            edit.textContent = "Edit";
            edit.addEventListener("click", () => {
                openEditObservation(obs);
            });

            item.append(name, meta, edit);
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
        if (!relocating) {
            editObsButton.hidden = nearbyObservations.length === 0;
        }
    }

    function clearCountNotesAndAccuracy() {
        countInput.value = "";
        notesInput.value = "";
        accuracyInput.value = "";
    }

    function applyText(observation, key, value) {
        if (value) {
            observation[key] = value;
        } else {
            delete observation[key];
        }
    }

    function accuracyFieldEmpty() {
        return accuracyInput.value.trim() === "";
    }

    function fillAccuracyIfEmpty(point) {
        if (!accuracyFieldEmpty() || !point || typeof suggestedAccuracy !== "function") {
            return;
        }
        const value = suggestedAccuracy(point);
        if (typeof value === "number" && Number.isInteger(value) && value > 0) {
            accuracyInput.value = String(value);
        }
    }

    function readAccuracy() {
        const text = accuracyInput.value.trim();
        if (!text) {
            return null;
        }
        if (!/^\d+$/.test(text)) {
            throw new Error("Accuracy must be a whole number of meters.");
        }
        const value = Number(text);
        if (!Number.isInteger(value) || value < 1 || value > limits.accuracy) {
            throw new Error(`Accuracy must be between 1 and ${limits.accuracy} meters.`);
        }
        return value;
    }

    function setEditingActions(on) {
        changeLocationButton.hidden = !on;
        deleteObsButton.hidden = !on;
    }

    // A new form field is filled here, cleared in clearCountNotesAndAccuracy,
    // and written in saveObservation. The server reads it in _parse_observation.
    function fillForm(obs) {
        taxonField.setValue(obs.taxon || "", obs.taxonId || null);
        countInput.value = obs.count || "";
        notesInput.value = obs.notes || "";
        accuracyInput.value = typeof obs.accuracy === "number" && Number.isInteger(obs.accuracy) && obs.accuracy > 0
            ? String(obs.accuracy)
            : "";
    }

    function dismiss() {
        relocating = false;
        pendingPoint = null;
        editingObservation = null;
        setEditingActions(false);
        taxonField.clear();
        clearCountNotesAndAccuracy();
        hideProblem("observe-error");
        clearNearby();
        if (editListDialog.open) {
            editListDialog.close();
        }
        if (observeDialog.open) {
            observeDialog.close();
        }
    }

    function openObserve() {
        if (isBusy()) {
            return;
        }
        const point = draftPoint();
        if (!point) {
            return;
        }
        relocating = false;
        pendingPoint = null;
        editingObservation = null;
        taxonField.clear();
        clearCountNotesAndAccuracy();
        fillAccuracyIfEmpty(point);
        setEditingActions(false);
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
            button.className = "blue";
            const label = obs.taxon || "Observation";
            button.textContent = obs.count ? `${label} · ${obs.count}` : label;
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
        const same = Boolean(editingObservation && editingObservation.id === obs.id);
        if (relocating) {
            relocating = false;
            abortLocationChange();
        }
        if (!same) {
            pendingPoint = null;
            fillForm(obs);
        }
        editingObservation = obs;
        if (editListDialog.open) {
            editListDialog.close();
        }
        setEditingActions(true);
        hideProblem("observe-error");
        if (!observeDialog.open) {
            observeDialog.showModal();
        }
        if (!same) {
            taxonInput.focus();
        }
    }

    function beginLocationChange() {
        if (isBusy() || !editingObservation) {
            return;
        }
        // Collapse suggestions, but keep the name and taxon the form already has.
        taxonField.setValue(taxonInput.value.trim(), taxonField.selectedTaxonId());
        relocating = true;
        const obs = editingObservation;
        const pending = pendingPoint;
        observeDialog.close();
        requestLocationChange(obs, pending);
    }

    function acceptLocation(point) {
        if (!point || !editingObservation) {
            relocating = false;
            return false;
        }
        pendingPoint = { lat: point.lat, lon: point.lon };
        relocating = false;
        openEditObservation(editingObservation);
        fillAccuracyIfEmpty(pendingPoint);
        return true;
    }

    function cancelLocationChange() {
        relocating = false;
        if (!editingObservation) {
            return;
        }
        openEditObservation(editingObservation);
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
        const moved = pendingPoint;
        if (!editing && !point) {
            clearPin();
            return;
        }
        hideProblem("observe-error");
        let accuracy;
        try {
            accuracy = readAccuracy();
        } catch (error) {
            showProblem("observe-error", { message: error.message || "Accuracy must be a whole number of meters." });
            accuracyInput.focus();
            return;
        }
        setBusy(true, "Saving…");
        try {
            const taxonId = taxonField.selectedTaxonId();
            let observation;
            if (editing) {
                // Copy first so a field this form does not show stays on the record.
                observation = { ...editing, taxon };
                // A location counts only after Use this point. A leftover Add pin must not move this record.
                if (moved) {
                    observation.lat = moved.lat;
                    observation.lon = moved.lon;
                }
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
            applyText(observation, "count", countInput.value.trim());
            applyText(observation, "notes", notesInput.value.trim());
            if (accuracy === null) {
                delete observation.accuracy;
            } else {
                observation.accuracy = accuracy;
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

    async function deleteEditingObservation() {
        const obs = editingObservation;
        if (isBusy() || !obs) {
            return;
        }
        if (!window.confirm(`Delete ${obs.taxon}?`)) {
            return;
        }
        hideProblem("observe-error");
        setBusy(true, "Deleting…");
        try {
            await db.deleteObservation(obs.id);
            clearPin();
            await refresh();
        } catch (error) {
            showProblem("observe-error", { message: error.message || "Could not delete the observation." });
        } finally {
            setBusy(false);
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
    changeLocationButton.addEventListener("click", () => {
        beginLocationChange();
    });
    deleteObsButton.addEventListener("click", () => {
        deleteEditingObservation();
    });
    closeObserveButton.addEventListener("click", () => {
        observeDialog.close();
    });
    closeEditListButton.addEventListener("click", () => {
        editListDialog.close();
    });
    observeDialog.addEventListener("close", () => {
        // A location change closes the dialog on purpose and keeps the edit.
        // Any other close drops the unsaved edit. The pin stays for Add obs.
        if (relocating) {
            return;
        }
        editingObservation = null;
        pendingPoint = null;
        setEditingActions(false);
    });

    return {
        dialogsOpen() {
            return observeDialog.open || editListDialog.open;
        },
        isRelocating() {
            return relocating;
        },
        setObservations(observations) {
            sessionObservations = observations;
        },
        renderList,
        updateNearby,
        acceptLocation,
        cancelLocationChange,
        beginNewPin() {
            if (relocating) {
                return;
            }
            pendingPoint = null;
            editingObservation = null;
            setEditingActions(false);
        },
        dismiss,
    };
}
