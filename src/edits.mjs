// Chart edits started from panels, dialogs and tools.
import { createFeature, createSearch, createWind, destinationPoint, locationRangeForType, parseBearing, parseCoordinate, removeChartItems, revealLayer, searchExtent, setLocked, translateChartItems } from "./model.mjs";
import { clamp, positiveNumber } from "./format.mjs";
import { elements, showToast } from "./dom.mjs";
import { clearSelection, commit, refreshSelection, replaceSelectionState, selectedItem, selectedRefs, selection } from "./state.mjs";
import { fitPoints } from "./render.mjs";

export function addLocation(point, name = "New location", details = {}) {
  commit((chart) => {
    const feature = createFeature({ ...details, lat: point.lat, lon: point.lon, name });
    chart.features.push(feature);
    revealLayer(chart, "feature", feature);
    replaceSelectionState("feature", feature.id);
  });
}

export function setAnchor(search, anchor) {
  if (anchor) search.anchor = anchor;
  else delete search.anchor;
}

export function addSearch(values, { fit = false } = {}) {
  const search = createSearch(values);
  commit((chart) => {
    chart.searches.push(search);
    revealLayer(chart, "search", search);
    replaceSelectionState("search", search.id);
  });
  if (fit) {
    const { farNm, fromDeg, toDeg } = searchExtent(search);
    fitPoints([search, ...[fromDeg, search.bearing, toDeg].map((degrees) => destinationPoint(search, degrees, farNm))]);
  }
}

export function addWind(values) {
  const wind = createWind(values);
  if (!wind) return;
  commit((chart) => {
    chart.winds.push(wind);
    revealLayer(chart, "wind", wind);
    replaceSelectionState("wind", wind.id);
  });
}

// Saved waypoints share the active route's waypoint form.
const FORM_FOR_KIND = { "saved-point": "route" };

export function updateSelectedFromForm(kind) {
  const item = selectedItem();
  if (!item || (FORM_FOR_KIND[selection.kind] ?? selection.kind) !== kind) return;
  try {
    // The fields show four decimals, so a field left as shown keeps the item's own finer position.
    const coordinate = (axis) => {
      const text = elements[`${kind}-${axis}`].value;
      return text === item[axis].toFixed(4) ? item[axis] : parseCoordinate(text, axis);
    };
    const target = { lat: coordinate("lat"), lon: coordinate("lon") };
    const updates = {};
    if (kind === "route") Object.assign(updates, {
      name: elements["route-name"].value.trim(),
      notes: elements["route-notes"].value.trim(),
      day: elements["route-day"].value.trim(),
      time: elements["route-time"].value.trim()
    });
    if (kind === "track") Object.assign(updates, {
      name: elements["track-name"].value.trim(),
      day: elements["track-day"].value.trim(),
      time: elements["track-time"].value.trim(),
      wind: elements["track-wind"].value.trim()
    });
    if (kind === "wind") Object.assign(updates, {
      label: elements["wind-label"].value.trim(),
      bearing: parseBearing(elements["wind-direction"].value),
      day: elements["wind-day"].value.trim(),
      time: elements["wind-time"].value.trim()
    });
    if (kind === "search") Object.assign(updates, {
      label: elements["search-label"].value.trim(),
      bearing: parseBearing(elements["search-direction"].value),
      distanceNm: positiveNumber(elements["search-distance"].value, "Distance"),
      spreadDeg: clamp(Number(elements["search-spread"].value) || 0, 0, 90),
      tolerancePct: clamp(Number(elements["search-tolerance"].value) || 0, 0, 90)
    });
    if (kind === "feature") Object.assign(updates, {
      name: elements["feature-name"].value.trim(),
      day: elements["feature-day"].value.trim(),
      time: elements["feature-time"].value.trim(),
      rangeNm: locationRangeForType(elements["feature-type"].value, elements["feature-range"].value),
      notes: elements["feature-notes"].value.trim()
    });
    commit((chart) => {
      translateChartItems(chart, selectedRefs(), { lat: target.lat - item.lat, lon: target.lon - item.lon }, { strict: true });
      Object.assign(item, updates);
      if (kind === "feature") {
        if (elements["feature-show-name"].checked) delete item.showName;
        else item.showName = false;
      }
    });
  } catch (error) {
    showToast(error.message, true);
    refreshSelection();
  }
}

export function updateSavedRouteFromForm() {
  const route = selection?.kind === "saved-route" ? selectedItem() : null;
  if (!route) return;
  commit(() => {
    route.name = elements["saved-route-name"].value.trim() || route.name;
    route.hidden = !elements["saved-route-visible"].checked;
  });
}

export function lockSelected(locked) {
  if (!selection) return;
  const refs = selectedRefs();
  commit((chart) => setLocked(chart, refs, locked));
}

export function deleteSelected() {
  if (!selection) return;
  const refs = selectedRefs();
  commit((chart) => {
    removeChartItems(chart, refs);
    clearSelection();
  });
}
