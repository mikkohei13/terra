// Settings dialog. Opens from the header and does not touch the observation session.

import {
    AUTOCOMPLETE_CACHE_OPTIONS,
    INFORMAL_TAXON_GROUPS,
    MIN_DISTANCE_M_MAX,
    MIN_DISTANCE_M_MIN,
    getSetting,
    setSetting,
} from "./settings.js";
import { clearAutocompleteCache } from "./taxon-cache.js";

const dialog = document.getElementById("settings-dialog");
const openButton = document.getElementById("open-settings");
const sectionsRoot = document.getElementById("settings-sections");

const sections = [taxonGroupSection, autocompleteCacheSection, minDistanceSection];

if (dialog && openButton && sectionsRoot) {
    openButton.addEventListener("click", () => {
        sectionsRoot.replaceChildren();
        for (const render of sections) {
            sectionsRoot.append(render());
        }
        if (!dialog.open) {
            dialog.showModal();
        }
    });
    dialog.addEventListener("close", () => {
        commitMinDistance(false);
    });
    const form = document.getElementById("settings-form");
    if (form) {
        form.addEventListener("submit", () => {
            commitMinDistance(false);
        });
    }
}

function taxonGroupSection() {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings-section";
    const legend = document.createElement("legend");
    legend.textContent = "Taxon groups";
    fieldset.append(legend);

    const allInput = checkboxRow(fieldset, "All taxa", "setting-taxon-all");
    const groupInputs = INFORMAL_TAXON_GROUPS.map((group) => {
        return {
            id: group.id,
            input: checkboxRow(fieldset, group.name, "setting-taxon-" + group.id),
        };
    });

    function paint() {
        const selected = new Set(getSetting("informalTaxonGroupIds"));
        allInput.checked = selected.size === 0;
        for (const group of groupInputs) {
            group.input.checked = selected.has(group.id);
        }
    }

    allInput.addEventListener("change", () => {
        if (allInput.checked) {
            storeTaxonGroups([]);
        }
        paint();
    });

    for (const group of groupInputs) {
        group.input.addEventListener("change", () => {
            const ids = groupInputs.filter((item) => item.input.checked).map((item) => item.id);
            storeTaxonGroups(ids);
            paint();
        });
    }

    paint();
    return fieldset;
}

function storeTaxonGroups(ids) {
    try {
        setSetting("informalTaxonGroupIds", ids);
    } catch (_error) {
        // Keep the previous document. paint() reads it back.
    }
}

function autocompleteCacheSection() {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings-section";
    const legend = document.createElement("legend");
    legend.textContent = "Taxon search";
    fieldset.append(legend);

    const label = document.createElement("label");
    label.htmlFor = "setting-autocomplete-cache";
    label.textContent = "Keep suggestions";
    fieldset.append(label);

    const select = document.createElement("select");
    select.id = "setting-autocomplete-cache";
    for (const option of AUTOCOMPLETE_CACHE_OPTIONS) {
        const item = document.createElement("option");
        item.value = option.id;
        item.textContent = option.label;
        select.append(item);
    }
    select.value = getSetting("autocompleteCache");
    select.addEventListener("change", () => {
        try {
            select.value = setSetting("autocompleteCache", select.value);
        } catch (_error) {
            select.value = getSetting("autocompleteCache");
        }
    });
    fieldset.append(select);

    const hint = document.createElement("p");
    hint.className = "settings-hint";
    hint.textContent = "Stored on this phone. Each combination of taxon groups is kept separately.";
    fieldset.append(hint);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "secondary";
    clearButton.textContent = "Clear cache";
    clearButton.addEventListener("click", async () => {
        if (!window.confirm("Clear saved taxon suggestions?")) {
            return;
        }
        clearButton.disabled = true;
        try {
            await clearAutocompleteCache();
        } catch (_error) {
            // Leave the saved suggestions in place.
        } finally {
            clearButton.disabled = false;
        }
    });
    fieldset.append(clearButton);
    return fieldset;
}

function minDistanceSection() {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings-section";
    const legend = document.createElement("legend");
    legend.textContent = "Route";
    fieldset.append(legend);

    const label = document.createElement("label");
    label.htmlFor = "setting-min-distance";
    label.textContent = "Minimum distance between points (m)";
    fieldset.append(label);

    const input = document.createElement("input");
    input.id = "setting-min-distance";
    input.type = "number";
    input.step = "1";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = String(getSetting("minDistanceM"));
    fieldset.append(input);

    const hint = document.createElement("p");
    hint.className = "settings-hint";
    hint.textContent = "From " + MIN_DISTANCE_M_MIN + " to " + MIN_DISTANCE_M_MAX + ". The next route point uses this.";
    fieldset.append(hint);

    input.addEventListener("input", () => {
        commitMinDistance(true);
    });
    input.addEventListener("blur", () => {
        commitMinDistance(false);
    });
    return fieldset;
}

// A complete in-range integer is stored immediately. Anything else is left
// until the field is left, then the field snaps back to the stored value.
function commitMinDistance(onlyWhenValid) {
    const input = document.getElementById("setting-min-distance");
    if (!input) {
        return;
    }
    const raw = input.value.trim();
    if (/^\d+$/.test(raw)) {
        const number = Number(raw);
        if (number >= MIN_DISTANCE_M_MIN && number <= MIN_DISTANCE_M_MAX) {
            try {
                const stored = setSetting("minDistanceM", number);
                if (!onlyWhenValid) {
                    input.value = String(stored);
                }
            } catch (_error) {
                input.value = String(getSetting("minDistanceM"));
            }
            return;
        }
    }
    if (!onlyWhenValid) {
        input.value = String(getSetting("minDistanceM"));
    }
}

function checkboxRow(fieldset, text, id) {
    const label = document.createElement("label");
    label.className = "settings-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    const span = document.createElement("span");
    span.textContent = text;
    label.append(input, span);
    fieldset.append(label);
    return input;
}
