// Taxon name field. A and C use Terra's autocomplete route. B uses local birds.

import * as api from "./api.js";
import { searchBirds } from "./birds.js";
import { autocompleteCacheMs, getSetting, onSettingChange, setSetting, TAXON_SEARCH_MODES } from "./settings.js";
import { readAutocomplete, writeAutocomplete } from "./taxon-cache.js";

const DEBOUNCE_MS = 300;
const MIN_INTERVAL_MS = 1000;
const MIN_QUERY_LENGTH = 2;
const SEARCH_MODES = TAXON_SEARCH_MODES.map((mode) => mode.id);

function searchModeLabel(mode) {
    const match = TAXON_SEARCH_MODES.find((item) => item.id === mode);
    return match ? match.label : mode;
}

export function attachTaxonField(input, list, dialog, onAdvance, modeButton, onNotes, options) {
    const prepareQuery = options && typeof options.prepareQuery === "function"
        ? options.prepareQuery
        : null;
    const optionIdPrefix = options && typeof options.optionIdPrefix === "string" && options.optionIdPrefix
        ? options.optionIdPrefix
        : "taxon-option-";
    const previewOnly = Boolean(options && options.previewOnly);

    let timer = null;
    let controller = null;
    let seq = 0;
    let selected = null;
    let lastSentAt = 0;
    let activeIndex = -1;

    function queryText() {
        const raw = input.value.trim();
        if (prepareQuery) {
            return prepareQuery(raw);
        }
        return raw;
    }

    function selectedTaxonId() {
        if (!selected) {
            return null;
        }
        if (input.value.trim() !== selected.name) {
            return null;
        }
        return selected.id;
    }

    function abortRequest() {
        if (!controller) {
            return;
        }
        controller.abort();
        controller = null;
    }

    function hideList() {
        list.hidden = true;
        activeIndex = -1;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        for (const button of list.querySelectorAll("button")) {
            button.setAttribute("aria-selected", "false");
        }
    }

    function clearList() {
        hideList();
        list.replaceChildren();
    }

    function highlight(index) {
        const buttons = [...list.querySelectorAll("button")];
        if (!buttons.length) {
            hideList();
            return;
        }
        activeIndex = Math.max(0, Math.min(index, buttons.length - 1));
        buttons.forEach((button, buttonIndex) => {
            button.setAttribute("aria-selected", buttonIndex === activeIndex ? "true" : "false");
        });
        const current = buttons[activeIndex];
        input.setAttribute("aria-activedescendant", current.id);
        current.scrollIntoView({ block: "nearest" });
    }

    function fieldValue(item) {
        if (item && typeof item.value === "string" && item.value) {
            return item.value;
        }
        return item && typeof item.name === "string" ? item.name : "";
    }

    function selectItem(item) {
        const name = fieldValue(item);
        selected = { id: item.id, name };
        input.value = name;
        clearList();
        if (typeof item.notes === "string" && item.notes && typeof onNotes === "function") {
            onNotes(item.notes);
        }
    }

    function advance() {
        if (!list.hidden) {
            hideList();
        }
        if (typeof onAdvance === "function") {
            onAdvance();
        }
    }

    function render(results) {
        list.replaceChildren();
        activeIndex = -1;
        input.removeAttribute("aria-activedescendant");
        results.forEach((item, index) => {
            if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
                return;
            }
            const li = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.id = optionIdPrefix + index;
            button.dataset.id = item.id;
            button.dataset.value = fieldValue(item);
            if (typeof item.notes === "string" && item.notes) {
                button.dataset.notes = item.notes;
            }
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");
            button.textContent = item.name;
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
            });
            if (!previewOnly) {
                button.addEventListener("click", () => {
                    selectItem(item);
                    advance();
                });
            }
            li.append(button);
            list.append(li);
        });
        if (!list.childElementCount) {
            clearList();
            return;
        }
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
    }

    function schedule() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        seq += 1;
        abortRequest();
        const mySeq = seq;
        const query = queryText();
        if (query.length < MIN_QUERY_LENGTH) {
            clearList();
            return;
        }
        timer = setTimeout(() => {
            run(mySeq, query);
        }, DEBOUNCE_MS);
    }

    function stillCurrent(mySeq, query) {
        return mySeq === seq && queryText() === query;
    }

    async function run(mySeq, query) {
        timer = null;
        if (!stillCurrent(mySeq, query)) {
            return;
        }
        const mode = getSetting("taxonSearchMode");
        if (mode === "B") {
            try {
                const results = await searchBirds(query);
                if (!stillCurrent(mySeq, query)) {
                    return;
                }
                render(results);
            } catch (_error) {
                if (stillCurrent(mySeq, query)) {
                    clearList();
                }
            }
            return;
        }
        const groups = mode === "A" ? [] : getSetting("informalTaxonGroupIds");
        const maxAgeMs = autocompleteCacheMs(getSetting("autocompleteCache"));
        if (maxAgeMs > 0) {
            try {
                const cached = await readAutocomplete(groups, query, maxAgeMs);
                if (!stillCurrent(mySeq, query)) {
                    return;
                }
                if (cached !== null) {
                    render(cached);
                    return;
                }
            } catch (_error) {
                if (!stillCurrent(mySeq, query)) {
                    return;
                }
            }
        }
        const sinceSend = lastSentAt === 0 ? MIN_INTERVAL_MS : Date.now() - lastSentAt;
        if (sinceSend < MIN_INTERVAL_MS) {
            timer = setTimeout(() => {
                run(mySeq, query);
            }, MIN_INTERVAL_MS - sinceSend);
            return;
        }
        abortRequest();
        controller = new AbortController();
        lastSentAt = Date.now();
        try {
            const data = await api.autocompleteTaxa(query, groups, controller.signal);
            const results = Array.isArray(data.results) ? data.results : [];
            if (maxAgeMs > 0) {
                writeAutocomplete(groups, query, results).catch(() => {});
            }
            if (!stillCurrent(mySeq, query)) {
                return;
            }
            render(results);
        } catch (error) {
            if (error.name === "AbortError" || !stillCurrent(mySeq, query)) {
                return;
            }
            clearList();
        }
    }

    input.addEventListener("input", () => {
        selected = null;
        schedule();
    });

    input.addEventListener("focus", () => {
        if (list.childElementCount) {
            list.hidden = false;
            input.setAttribute("aria-expanded", "true");
        }
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (!previewOnly && !list.hidden && activeIndex >= 0) {
                const buttons = [...list.querySelectorAll("button")];
                const button = buttons[activeIndex];
                if (button) {
                    selectItem({
                        id: button.dataset.id,
                        name: button.textContent,
                        value: button.dataset.value,
                        notes: button.dataset.notes,
                    });
                }
            }
            if (!previewOnly) {
                advance();
            }
            return;
        }
        if (list.hidden) {
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            highlight(activeIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            highlight(activeIndex < 0 ? 0 : activeIndex - 1);
        }
    });

    if (dialog) {
        dialog.addEventListener("cancel", (event) => {
            if (!list.hidden) {
                event.preventDefault();
                hideList();
            }
        });
    }

    function paintSearchMode() {
        if (!modeButton) {
            return;
        }
        const mode = getSetting("taxonSearchMode");
        modeButton.textContent = mode;
        modeButton.setAttribute("aria-label", "Taxon search: " + searchModeLabel(mode));
    }

    if (modeButton) {
        paintSearchMode();
        onSettingChange((key) => {
            if (key === "taxonSearchMode") {
                paintSearchMode();
            }
        });
        modeButton.addEventListener("click", () => {
            const current = getSetting("taxonSearchMode");
            const index = SEARCH_MODES.indexOf(current);
            const next = SEARCH_MODES[(index + 1) % SEARCH_MODES.length];
            setSetting("taxonSearchMode", next);
            schedule();
        });
    }

    document.addEventListener("click", (event) => {
        if (event.target === input || event.target === modeButton || list.contains(event.target)) {
            return;
        }
        hideList();
    });

    return {
        selectedTaxonId,
        setValue(name, taxonId) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            seq += 1;
            abortRequest();
            clearList();
            const text = typeof name === "string" ? name : "";
            input.value = text;
            if (taxonId && text) {
                selected = { id: taxonId, name: text };
            } else {
                selected = null;
            }
        },
        clear() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            seq += 1;
            abortRequest();
            selected = null;
            input.value = "";
            clearList();
        },
    };
}
