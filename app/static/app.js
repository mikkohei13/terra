(function () {
  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function initTaxonAutocomplete() {
    const input = document.getElementById("taxon");
    const hiddenId = document.getElementById("taxon_id");
    const resultsEl = document.getElementById("taxon-results");
    if (!input || !hiddenId || !resultsEl) {
      return;
    }

    function clearResults() {
      resultsEl.innerHTML = "";
      resultsEl.hidden = true;
    }

    function selectTaxon(id, label) {
      hiddenId.value = id || "";
      input.value = label || "";
      clearResults();
    }

    const search = debounce(async function () {
      const query = input.value.trim();
      hiddenId.value = "";
      if (query.length < 2) {
        clearResults();
        return;
      }

      try {
        const response = await fetch(
          `/api/taxa?query=${encodeURIComponent(query)}&limit=12`,
          { headers: { Accept: "application/json" } }
        );
        const data = await response.json();
        const results = data.results || [];
        resultsEl.innerHTML = "";
        if (!results.length) {
          clearResults();
          return;
        }

        results.forEach((row) => {
          const id = row.id || "";
          if (!id.startsWith("MX.")) {
            return;
          }
          const vernacular = (row.vernacularName || "").trim();
          const scientific = (row.scientificName || "").trim();
          const label = vernacular || scientific || id;
          const meta = vernacular && scientific ? ` (${scientific})` : "";

          const li = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `${label}${meta}`;
          button.addEventListener("click", () => selectTaxon(id, label));
          li.appendChild(button);
          resultsEl.appendChild(li);
        });
        resultsEl.hidden = resultsEl.children.length === 0;
      } catch (_err) {
        clearResults();
      }
    }, 250);

    input.addEventListener("input", search);
    input.addEventListener("blur", () => {
      // Allow click on result button before clearing.
      setTimeout(clearResults, 150);
    });
  }

  function initGeolocation() {
    const button = document.getElementById("use-location");
    const latInput = document.getElementById("latitude");
    const lonInput = document.getElementById("longitude");
    if (!button || !latInput || !lonInput) {
      return;
    }

    button.addEventListener("click", () => {
      if (!navigator.geolocation) {
        window.alert("Selain ei tue sijaintia.");
        return;
      }
      button.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          latInput.value = position.coords.latitude.toFixed(6);
          lonInput.value = position.coords.longitude.toFixed(6);
          button.disabled = false;
        },
        () => {
          window.alert("Sijaintia ei saatu.");
          button.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  function initDefaultDate() {
    const dateInput = document.getElementById("date");
    if (!dateInput || dateInput.value) {
      return;
    }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTaxonAutocomplete();
    initGeolocation();
    initDefaultDate();
  });
})();
