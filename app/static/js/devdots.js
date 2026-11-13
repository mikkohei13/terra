// devdots — temporary grey dots for stored route points.
//
// Remove this before the app is public:
// 1. Delete app/static/js/devdots.js.
// 2. In app/static/js/app.js, delete the devdots import and every call marked devdots.
// 3. Search the repo for "devdots" and delete anything left.

let layer = null;

export function show(map, points) {
    if (!map || typeof L === "undefined") {
        return;
    }
    if (!map.getPane("devdots")) {
        const pane = map.createPane("devdots");
        pane.style.zIndex = "350";
    }
    if (!layer) {
        layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    const list = Array.isArray(points) ? points : [];
    for (const point of list) {
        if (typeof point.lat !== "number" || typeof point.lon !== "number") {
            continue;
        }
        L.circleMarker([point.lat, point.lon], {
            pane: "devdots",
            radius: 5,
            color: "#4b5563",
            weight: 1,
            fillColor: "#9ca3af",
            fillOpacity: 1,
            interactive: false,
        }).addTo(layer);
    }
}
