// Taxon name field. Suggestions come from Terra's autocomplete route.

import * as api from "./api.js";
import { autocompleteCacheMs, getSetting } from "./settings.js";
import { readAutocomplete, writeAutocomplete } from "./taxon-cache.js";

const DEBOUNCE_MS = 300;
const MIN_INTERVAL_MS = 1000;
const MIN_QUERY_LENGTH = 2;

export function attachTaxonField(input, list, dialog) {
    let timer = null;
    let controller = null;
    let seq = 0;
    let selected = null;
    let lastSentAt = 0;
    let activeIndex = -1;

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

    function selectItem(item) {
        selected = { id: item.id, name: item.name };
        input.value = item.name;
        clearList();
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
            button.id = "taxon-option-" + index;
            button.dataset.id = item.id;
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");
            button.textContent = item.name;
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
            });
            button.addEventListener("click", () => {
                selectItem(item);
            });
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
        const query = input.value.trim();
        if (query.length < MIN_QUERY_LENGTH) {
            clearList();
            return;
        }
        timer = setTimeout(() => {
            run(mySeq, query);
        }, DEBOUNCE_MS);
    }

    function stillCurrent(mySeq, query) {
        return mySeq === seq && input.value.trim() === query;
    }

    async function run(mySeq, query) {
        timer = null;
        if (!stillCurrent(mySeq, query)) {
            return;
        }
        const groups = getSetting("informalTaxonGroupIds");
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
        if (list.hidden) {
            return;
        }
        const buttons = [...list.querySelectorAll("button")];
        if (event.key === "ArrowDown") {
            event.preventDefault();
            highlight(activeIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            highlight(activeIndex < 0 ? 0 : activeIndex - 1);
        } else if (event.key === "Enter" && activeIndex >= 0 && buttons[activeIndex]) {
            event.preventDefault();
            selectItem({
                id: buttons[activeIndex].dataset.id,
                name: buttons[activeIndex].textContent,
            });
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

    document.addEventListener("click", (event) => {
        if (event.target === input || list.contains(event.target)) {
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
