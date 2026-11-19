// Chart edits started from panels, dialogs and tools.
import { LOCATION_ICONS } from "./icons.mjs";
import { createFeature, createNote, createSearch, createWind, destinationPoint, locationRangeForType, parseBearing, parseCoordinate, removeChartItems, revealLayer, searchExtent, setLocked, translateChartItems } from "./model.mjs";
import { clamp, positiveNumber } from "./format.mjs";
import { parseDayTime } from "./gametime.mjs";
import { elements, showToast } from "./dom.mjs";
import { clearSelection, commit, refreshSelection, replaceSelectionState, selectedItem, selectedRefs, selection } from "./state.mjs";
import { fitPoints } from "./render.mjs";
import { answeredByLocation, removeAnswered } from "./discoveries.mjs";

export function addLocation(point, name = "New location", details = {}) {
  let answered = null;
  commit((chart) => {
    const feature = createFeature({ ...details, lat: point.lat, lon: point.lon, name });
    answered = answerSearches(chart, feature);
    chart.features.push(feature);
    revealLayer(chart, "feature", feature);
    replaceSelectionState("feature", feature.id);
  });
  reportAnswered(answered, name);
  // Typing names the new location straight away; after the click that placed it has finished.
  window.setTimeout(() => { elements["feature-name"].focus(); elements["feature-name"].select(); }, 0);
}

// Inside a commit: drops the search areas and rough areas a location now answers, all in the same undo step.
export function answerSearches(chart, location) {
  const marks = answeredByLocation(chart, location);
  removeAnswered(chart, marks);
  return marks;
}

export function reportAnswered(marks, name) {
  if (!marks) return;
  const count = (n, kind) => n ? `${n === 1 ? "the" : n} ${kind} area${n === 1 ? "" : "s"}` : "";
  const removed = [count(marks.answered.length, "search"), count(marks.cleared.length, "rough")].filter(Boolean);
  if (!removed.length) return;
  const one = marks.answered.length + marks.cleared.length === 1;
  showToast(`Removed ${removed.join(" and ")} for ${name}. Undo brings ${one ? "it" : "them"} back.`);
}

// A new note at a place. Its day, time and name are optional and filled in by the player.
export function addNote(point) {
  let note = null;
  commit((chart) => {
    note = createNote({ lat: point.lat, lon: point.lon });
    chart.notes.push(note);
    revealLayer(chart, "note", note);
    replaceSelectionState("note", note.id);
  });
  return note;
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
    if (kind === "track") {
      const day = elements["track-day"].value.trim();
      const time = elements["track-time"].value.trim();
      const wind = elements["track-wind"].value.trim();
      Object.assign(updates, { name: elements["track-name"].value.trim(), day, time, wind });
      // The exact game time and wind bearing follow the text only when it is changed.
      if (day !== item.day || time !== item.time) updates.t = parseDayTime(day, time);
      if (wind !== item.wind) {
        try { updates.windDeg = parseBearing(wind); } catch { updates.windDeg = null; }
      }
    }
    if (kind === "note") {
      const day = elements["note-day"].value.trim();
      const time = elements["note-time"].value.trim();
      Object.assign(updates, { name: elements["note-name"].value.trim(), day, time, size: elements["note-size"].value });
      if (day !== item.day || time !== item.time) updates.t = parseDayTime(day, time);
      if (!updates.size) updates.size = undefined;
    }
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
    // Only an encounter shows its picker; a plain location keeps having no icon.
    const icon = kind === "feature" && !elements["feature-icon-row"].hidden ? elements["feature-icon"].value : "";
    const size = kind === "feature" ? elements["feature-size"].value : "";
    // Naming a location, or making a rough area a location, answers the search areas for that name.
    const answering = kind === "feature" && !updates.rangeNm && (updates.name !== item.name || item.rangeNm > 0);
    let answered = null;
    commit((chart) => {
      translateChartItems(chart, selectedRefs(), { lat: target.lat - item.lat, lon: target.lon - item.lon }, { strict: true });
      Object.assign(item, updates);
      if (kind === "feature") {
        if (elements["feature-show-name"].checked) delete item.showName;
        else item.showName = false;
        // An encounter still named after its type takes the new type's name; a name the player chose stays.
        if (icon && icon !== item.icon && !item.rangeNm && (!item.name || item.name === LOCATION_ICONS[item.icon]?.label)) item.name = LOCATION_ICONS[icon].label;
        if (icon && !item.rangeNm) item.icon = icon;
        else delete item.icon;
        if (size && !item.rangeNm) item.size = size;
        else delete item.size;
        if (answering) answered = answerSearches(chart, item);
      }
    });
    reportAnswered(answered, item.name);
  } catch (error) {
    showToast(error.message, true);
    refreshSelection();
  }
}

// Takes out the connection Connect track made at the selected position, leaving the gap before it again.
export function removeTrackJoin() {
  if (selection?.kind !== "track") return;
  const id = selection.id;
  commit((chart) => {
    const point = chart.track.find((candidate) => candidate.id === id);
    if (point) delete point.joinPrevious;
  });
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
