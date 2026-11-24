// Observation dialog and list. This stores what the form shows.
// The server decides which fields are valid.

import * as db from "./db.js";
import { searchBirds } from "./birds.js";
import { limits } from "./config.js";
import { getSetting } from "./settings.js";
import { attachTaxonField } from "./taxon-field.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NEARBY_TAP_PX = 48;
const LOPPU_PAUSE_MS = 500;
const PENDING_EDIT_MESSAGE =
    "Cannot edit while interpretation is in progress. This will take no more than 20 seconds.";

/** Strip a trailing whole word "loppu" (case-insensitive). */
function stripTrailingLoppu(text) {
    const trimmed = String(text || "").trim();
    if (/^loppu$/i.test(trimmed)) {
        return "";
    }
    const match = /^(.*)\s+loppu$/i.exec(trimmed);
    if (match) {
        return match[1].trim();
    }
    return trimmed;
}

function endsWithLoppu(text) {
    const trimmed = String(text || "").trim();
    return /(^|\s)loppu$/i.test(trimmed);
}

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
    const maleInput = document.getElementById("male-count");
    const femaleInput = document.getElementById("female-count");
    const movingButtons = [...document.querySelectorAll("#moving-status button")];
    const plumageButtons = [...document.querySelectorAll("#plumage button")];
    const changeLocationButton = document.getElementById("change-location");
    const deleteObsButton = document.getElementById("delete-obs");
    const observationList = document.getElementById("observation-list");
    const addObsButton = document.getElementById("add-obs");
    const editObsButton = document.getElementById("edit-obs");
    const closeObserveButton = document.getElementById("close-observe");
    const editListDialog = document.getElementById("edit-list-dialog");
    const editList = document.getElementById("edit-list");
    const closeEditListButton = document.getElementById("close-edit-list");
    const obsKeywordList = document.getElementById("obs-keyword-list");
    const obsKeywordInput = document.getElementById("obs-keyword-input");
    const addObsKeywordButton = document.getElementById("add-obs-keyword");
    const quickTaxon = document.getElementById("quick-taxon");
    const quickTaxonInput = document.getElementById("quick-taxon-input");
    const taxonField = attachTaxonField(
        taxonInput,
        document.getElementById("taxon-results"),
        observeDialog,
        () => {
            countInput.focus();
        },
        document.getElementById("taxon-scope"),
        (notes) => {
            notesInput.value = notes;
        },
    );
    const quickTaxonField = attachTaxonField(
        quickTaxonInput,
        document.getElementById("quick-taxon-results"),
        null,
        null,
        null,
        null,
        {
            prepareQuery: stripTrailingLoppu,
            optionIdPrefix: "quick-taxon-option-",
            previewOnly: true,
        },
    );

    let sessionObservations = [];
    let nearbyObservations = [];
    let editingObservation = null;
    let relocating = false;
    let pendingPoint = null;
    let observationKeywords = [];
    let loppuTimer = null;
    let loppuSnapshot = null;

    let pendingEditNoticeId = null;

    function positiveOrNull(value) {
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    function interpretationStatus(obs) {
        if (obs.interpretationState === "pending") {
            return "Interpreting";
        }
        if (obs.interpretationState === "failed") {
            return "Not interpreted";
        }
        return "";
    }

    function observationDetail(obs) {
        const parts = [];
        if (typeof obs.count === "string" && obs.count.trim()) {
            parts.push(obs.count.trim());
        }
        if (Array.isArray(obs.movingStatus) && obs.movingStatus.length > 0) {
            parts.push(obs.movingStatus.join(", "));
        }
        return parts.join(" · ");
    }

    function fillObservationButton(button, obs) {
        button.replaceChildren();
        button.append(obs.taxon || "Observation");
        const status = interpretationStatus(obs);
        if (status) {
            const pill = document.createElement("span");
            pill.className = "obs-status";
            pill.textContent = status;
            button.append(pill);
            return;
        }
        const detail = observationDetail(obs);
        if (detail) {
            button.append(` · ${detail}`);
        }
    }

    function syncPendingEditNotice(observations) {
        if (!pendingEditNoticeId) {
            return;
        }
        const pending = observations.some((row) => row.interpretationState === "pending");
        const listed = observations.some((row) => row.id === pendingEditNoticeId);
        if (!pending || !listed) {
            pendingEditNoticeId = null;
        }
    }

    function pendingEditNotice() {
        const notice = document.createElement("div");
        notice.className = "error obs-edit-notice";
        notice.setAttribute("role", "alert");
        const message = document.createElement("p");
        message.textContent = PENDING_EDIT_MESSAGE;
        notice.append(message);
        return notice;
    }

    function renderList(observations) {
        syncPendingEditNotice(observations);
        observationList.replaceChildren();
        if (observations.length === 0) {
            const empty = document.createElement("li");
            empty.className = "muted";
            empty.textContent = "No observations yet.";
            observationList.append(empty);
            return;
        }
        const ordered = observations.slice().sort((a, b) => (b.seq || 0) - (a.seq || 0));
        for (const obs of ordered) {
            const item = document.createElement("li");
            item.className = "obs-item";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "blue";
            fillObservationButton(edit, obs);
            edit.addEventListener("click", () => {
                openEditObservation(obs);
            });
            item.append(edit);

            if (obs.id && obs.id === pendingEditNoticeId) {
                item.append(pendingEditNotice());
            }

            if (obs.notes) {
                const notes = document.createElement("div");
                notes.className = "obs-meta";
                notes.textContent = obs.notes;
                item.append(notes);
            }
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

    function selectedCodes(buttons, attr) {
        const codes = [];
        for (const button of buttons) {
            if (button.getAttribute("aria-pressed") === "true") {
                const code = button.getAttribute(attr);
                if (code) {
                    codes.push(code);
                }
            }
        }
        return codes;
    }

    function setPressed(buttons, attr, selected) {
        const chosen = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
        for (const button of buttons) {
            button.setAttribute("aria-pressed", chosen.has(button.getAttribute(attr)) ? "true" : "false");
        }
    }

    function clearChoices() {
        setPressed(movingButtons, "data-moving", []);
        setPressed(plumageButtons, "data-plumage", []);
    }

    function clearCountNotesAndAccuracy() {
        countInput.value = "";
        notesInput.value = "";
        accuracyInput.value = "";
        maleInput.value = "";
        femaleInput.value = "";
        clearChoices();
        observationKeywords = [];
        obsKeywordInput.value = "";
        renderObsKeywords();
    }

    function renderObsKeywords() {
        obsKeywordList.replaceChildren();
        observationKeywords.forEach((keyword, index) => {
            const item = document.createElement("li");
            item.className = "keyword-item";
            const name = document.createElement("span");
            name.textContent = keyword;
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "red";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                observationKeywords.splice(index, 1);
                renderObsKeywords();
            });
            item.append(name, remove);
            obsKeywordList.append(item);
        });
    }

    function addObsKeyword() {
        const text = obsKeywordInput.value.trim();
        if (!text) {
            obsKeywordInput.value = "";
            return;
        }
        if (observationKeywords.length >= limits.keywords) {
            showProblem("observe-error", {
                message: `An observation can contain at most ${limits.keywords} keywords.`,
            });
            return;
        }
        hideProblem("observe-error");
        observationKeywords.push(text);
        obsKeywordInput.value = "";
        renderObsKeywords();
    }

    function writeKeywords(observation) {
        if (observationKeywords.length) {
            observation.keywords = observationKeywords.slice();
        } else {
            delete observation.keywords;
        }
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

    function readPositiveInt(input, label) {
        if (input.validity && input.validity.badInput) {
            throw new Error(`${label} must be a whole number.`);
        }
        const text = input.value.trim();
        if (!text) {
            return null;
        }
        if (!/^[1-9]\d*$/.test(text)) {
            throw new Error(`${label} must be a whole number.`);
        }
        return Number(text);
    }

    function readDetails() {
        return {
            count: countInput.value.trim(),
            notes: notesInput.value.trim(),
            male: readPositiveInt(maleInput, "Males"),
            female: readPositiveInt(femaleInput, "Females"),
            moving: selectedCodes(movingButtons, "data-moving"),
            plumage: selectedCodes(plumageButtons, "data-plumage")[0] || "",
        };
    }

    function structuredFilled(fields) {
        return Boolean(
            fields.count
            || fields.male != null
            || fields.female != null
            || fields.moving.length
            || fields.plumage
        );
    }

    function sameStructured(obs, fields) {
        const count = typeof obs.count === "string" ? obs.count : "";
        const plumage = typeof obs.birdPlumage === "string" ? obs.birdPlumage : "";
        const moving = Array.isArray(obs.movingStatus) ? obs.movingStatus.join("\0") : "";
        return count === fields.count
            && positiveOrNull(obs.maleIndividualCount) === fields.male
            && positiveOrNull(obs.femaleIndividualCount) === fields.female
            && plumage === fields.plumage
            && moving === fields.moving.join("\0");
    }

    function applyOptionalInt(observation, key, value) {
        if (value == null) {
            delete observation[key];
        } else {
            observation[key] = value;
        }
    }

    function writeDetails(observation, fields) {
        applyText(observation, "count", fields.count);
        applyText(observation, "notes", fields.notes);
        applyOptionalInt(observation, "maleIndividualCount", fields.male);
        applyOptionalInt(observation, "femaleIndividualCount", fields.female);
        if (fields.moving.length) {
            observation.movingStatus = fields.moving.slice();
        } else {
            delete observation.movingStatus;
        }
        applyText(observation, "birdPlumage", fields.plumage);
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
        maleInput.value = positiveOrNull(obs.maleIndividualCount) ? String(obs.maleIndividualCount) : "";
        femaleInput.value = positiveOrNull(obs.femaleIndividualCount) ? String(obs.femaleIndividualCount) : "";
        setPressed(movingButtons, "data-moving", obs.movingStatus);
        setPressed(plumageButtons, "data-plumage", obs.birdPlumage || "");
        observationKeywords = Array.isArray(obs.keywords)
            ? obs.keywords
                .filter((keyword) => typeof keyword === "string" && keyword.trim())
                .map((keyword) => keyword.trim())
            : [];
        obsKeywordInput.value = "";
        renderObsKeywords();
    }

    function cancelLoppuTimer() {
        if (loppuTimer !== null) {
            clearTimeout(loppuTimer);
            loppuTimer = null;
        }
        loppuSnapshot = null;
    }

    function hideQuickTaxon() {
        cancelLoppuTimer();
        quickTaxon.hidden = true;
        quickTaxonField.clear();
    }

    function showQuickTaxon({ focus = false, clear = false } = {}) {
        if (getSetting("taxonSearchMode") !== "B" || relocating) {
            hideQuickTaxon();
            return;
        }
        cancelLoppuTimer();
        if (clear) {
            quickTaxonField.clear();
        }
        quickTaxon.hidden = false;
        if (focus) {
            quickTaxonInput.focus();
        }
    }

    function dismiss() {
        relocating = false;
        pendingPoint = null;
        editingObservation = null;
        setEditingActions(false);
        hideQuickTaxon();
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
        cancelLoppuTimer();
        quickTaxon.hidden = true;
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

    function renderEditList() {
        editList.replaceChildren();
        for (const obs of nearbyObservations) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "blue";
            fillObservationButton(button, obs);
            button.addEventListener("click", () => {
                openEditObservation(obs);
            });
            item.append(button);
            editList.append(item);
        }
    }

    function openEditList() {
        if (isBusy() || nearbyObservations.length === 0) {
            return;
        }
        if (nearbyObservations.length === 1) {
            openEditObservation(nearbyObservations[0]);
            return;
        }
        cancelLoppuTimer();
        quickTaxon.hidden = true;
        renderEditList();
        if (!editListDialog.open) {
            editListDialog.showModal();
        }
    }

    function hasPendingInterpretation() {
        return sessionObservations.some((row) => row.interpretationState === "pending");
    }

    function refusePendingEdit(obs) {
        if (editListDialog.open) {
            editListDialog.close();
        }
        pendingEditNoticeId = obs && obs.id ? obs.id : null;
        renderList(sessionObservations);
        const notice = observationList.querySelector(".obs-edit-notice");
        if (notice) {
            notice.scrollIntoView({ block: "nearest" });
        }
    }

    function openEditObservation(obs) {
        if (isBusy() || !obs) {
            return;
        }
        if (obs.interpretationState === "pending" || hasPendingInterpretation()) {
            refusePendingEdit(obs);
            return;
        }
        if (pendingEditNoticeId) {
            pendingEditNoticeId = null;
            renderList(sessionObservations);
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
        cancelLoppuTimer();
        quickTaxon.hidden = true;
        if (editListDialog.open) {
            editListDialog.close();
        }
        setEditingActions(true);
        hideProblem("observe-error");
        hideProblem("session-error");
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
        hideQuickTaxon();
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

    async function saveObservation({ errorId = "observe-error" } = {}) {
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
        hideProblem(errorId);
        let accuracy;
        let fields;
        try {
            accuracy = readAccuracy();
        } catch (error) {
            showProblem(errorId, { message: error.message || "Accuracy must be a whole number of meters." });
            if (errorId === "observe-error") {
                accuracyInput.focus();
            }
            return;
        }
        try {
            fields = readDetails();
        } catch (error) {
            showProblem(errorId, { message: error.message || "Males and females must be whole numbers." });
            if (errorId === "observe-error") {
                const maleText = maleInput.value.trim();
                const maleInvalid = (maleInput.validity && maleInput.validity.badInput)
                    || (maleText !== "" && !/^[1-9]\d*$/.test(maleText));
                (maleInvalid ? maleInput : femaleInput).focus();
            }
            return;
        }
        setBusy(true, "Saving…");
        try {
            const taxonId = taxonField.selectedTaxonId();
            let observation;
            let keepInterpreted = false;
            if (editing) {
                // Copy the latest row so an answer that landed while this dialog was open is not wiped
                // by a save that did not change the taxon, the notes, or the structured fields.
                const stored = (await db.listObservations()).find((row) => row.id === editing.id);
                if (!stored) {
                    clearPin();
                    await refresh();
                    showProblem("session-error", { message: "That observation is no longer on this phone." });
                    return;
                }
                observation = { ...stored, taxon };
                // A location counts only after Use this point. A leftover Add pin must not move this record.
                if (moved) {
                    observation.lat = moved.lat;
                    observation.lon = moved.lon;
                }
                const openedNotes = typeof editing.notes === "string" ? editing.notes : "";
                const taxonSame = taxon === (editing.taxon || "");
                const notesSame = fields.notes === openedNotes;
                const structuredSame = sameStructured(editing, fields);
                keepInterpreted = taxonSame && notesSame && structuredSame;
                if (
                    !keepInterpreted
                    && stored.interpretationState === "pending"
                    && (!taxonSame || !notesSame || structuredFilled(fields))
                ) {
                    delete observation.interpretationState;
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
                if (fields.notes && !structuredFilled(fields)) {
                    observation.interpretationState = "pending";
                }
            }
            if (taxonId) {
                observation.taxonId = taxonId;
            } else {
                delete observation.taxonId;
            }
            if (accuracy === null) {
                delete observation.accuracy;
            } else {
                observation.accuracy = accuracy;
            }
            if (!keepInterpreted) {
                writeDetails(observation, fields);
            }
            writeKeywords(observation);
            await db.addObservation(observation);
            clearPin();
            await refresh();
        } catch (error) {
            showProblem(errorId, { message: error.message || "Could not save the observation." });
        } finally {
            setBusy(false);
        }
    }

    async function tryQuickSave() {
        if (isBusy() || relocating || observeDialog.open || editListDialog.open) {
            return;
        }
        const raw = quickTaxonInput.value;
        if (!endsWithLoppu(raw)) {
            return;
        }
        const point = draftPoint();
        if (!point) {
            return;
        }
        const prepared = stripTrailingLoppu(raw);
        if (prepared.length < 2) {
            return;
        }
        let results;
        try {
            results = await searchBirds(prepared);
        } catch (_error) {
            return;
        }
        if (quickTaxonInput.value !== raw || !endsWithLoppu(quickTaxonInput.value)) {
            return;
        }
        if (!Array.isArray(results) || results.length === 0) {
            return;
        }
        const hit = results[0];
        const name = typeof hit.value === "string" && hit.value
            ? hit.value
            : (typeof hit.name === "string" ? hit.name : "");
        if (!name) {
            return;
        }
        editingObservation = null;
        pendingPoint = null;
        taxonField.setValue(name, hit.id || null);
        clearCountNotesAndAccuracy();
        if (typeof hit.notes === "string" && hit.notes) {
            notesInput.value = hit.notes;
        }
        fillAccuracyIfEmpty(point);
        await saveObservation({ errorId: "session-error" });
    }

    function scheduleLoppuSave() {
        cancelLoppuTimer();
        const raw = quickTaxonInput.value;
        if (!endsWithLoppu(raw)) {
            return;
        }
        loppuSnapshot = raw;
        loppuTimer = setTimeout(() => {
            loppuTimer = null;
            if (quickTaxonInput.value !== loppuSnapshot) {
                return;
            }
            loppuSnapshot = null;
            tryQuickSave();
        }, LOPPU_PAUSE_MS);
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

    for (const button of movingButtons) {
        button.addEventListener("click", () => {
            const on = button.getAttribute("aria-pressed") === "true";
            button.setAttribute("aria-pressed", on ? "false" : "true");
        });
    }
    for (const button of plumageButtons) {
        button.addEventListener("click", () => {
            const on = button.getAttribute("aria-pressed") === "true";
            for (const other of plumageButtons) {
                other.setAttribute("aria-pressed", "false");
            }
            if (!on) {
                button.setAttribute("aria-pressed", "true");
            }
        });
    }
    observeForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveObservation();
    });
    addObsKeywordButton.addEventListener("click", () => {
        addObsKeyword();
    });
    obsKeywordInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addObsKeyword();
        }
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
        if (draftPoint() && getSetting("taxonSearchMode") === "B") {
            showQuickTaxon({ focus: false, clear: false });
        }
    });
    editListDialog.addEventListener("close", () => {
        if (relocating || observeDialog.open || editingObservation) {
            return;
        }
        if (draftPoint() && getSetting("taxonSearchMode") === "B") {
            showQuickTaxon({ focus: false, clear: false });
        }
    });
    quickTaxonInput.addEventListener("input", () => {
        scheduleLoppuSave();
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
        refreshObservations(observations) {
            sessionObservations = observations;
            renderList(observations);
            if (!editListDialog.open) {
                return;
            }
            const byId = new Map(observations.map((obs) => [obs.id, obs]));
            nearbyObservations = nearbyObservations
                .map((obs) => byId.get(obs.id))
                .filter(Boolean);
            renderEditList();
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
            showQuickTaxon({ focus: true, clear: true });
        },
        dismiss,
    };
}
