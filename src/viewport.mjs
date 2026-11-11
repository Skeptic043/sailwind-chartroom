// Converts between chart coordinates and canvas pixels for the active chart's view.
import { WORLD_BOUNDS } from "./model.mjs";
import { searchIsland, visibleIsland } from "./islands.mjs";
import { boatMarkerSize, visibleBoat } from "./boats.mjs";
import { clamp } from "./format.mjs";
import { canvas } from "./dom.mjs";
import { activeChart } from "./state.mjs";

export function worldToScreen(point) {
  const rectangle = canvas.getBoundingClientRect();
  const view = activeChart().view;
  return {
    x: rectangle.width / 2 + (point.lon - view.lon) * view.zoom,
    y: rectangle.height / 2 - (point.lat - view.lat) * view.zoom
  };
}

export function screenToWorld(x, y) {
  const rectangle = canvas.getBoundingClientRect();
  const view = activeChart().view;
  return {
    lon: clamp(view.lon + (x - rectangle.width / 2) / view.zoom, WORLD_BOUNDS.minLon, WORLD_BOUNDS.maxLon),
    lat: clamp(view.lat - (y - rectangle.height / 2) / view.zoom, WORLD_BOUNDS.minLat, WORLD_BOUNDS.maxLat)
  };
}

export function eventPoint(event) {
  const rectangle = canvas.getBoundingClientRect();
  return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
}

export function coordinatePrecision() {
  const zoom = activeChart().view.zoom;
  return zoom >= 600 ? 4 : zoom >= 60 ? 3 : 2;
}

export function islandPixelSpan(island) {
  return Math.max(island.bounds.maxLon - island.bounds.minLon, island.bounds.maxLat - island.bounds.minLat) * activeChart().view.zoom;
}

// The island outline a location or search area draws, unless View hides island outlines.
export function chartIsland(feature) {
  return activeChart().layers.islands ? visibleIsland(feature) : null;
}

export function chartSearchIsland(search) {
  return activeChart().layers.islands ? searchIsland(search) : null;
}

export function boatIconBounds(feature) {
  return boatIconBoundsAt(feature, chartIsland(feature), 1, visibleBoat(feature));
}

// One size rule for every chart symbol. Each is `full` pixels at SYMBOL_FULL_SIZE_ZOOM and grows and
// shrinks with the square root of the zoom, so symbols stay small far out without vanishing and grow
// only gently close in. Each stays within its own pixel limits. Text and line widths do not scale.
const SYMBOL_FULL_SIZE_ZOOM = 60;
const SYMBOLS = Object.freeze({
  mark: { full: 4, min: 2.5, max: 7 },        // radius of a location ring
  waypoint: { full: 5.5, min: 3, max: 5.5 },  // radius of an active route waypoint
  dot: { full: 2, min: 2, max: 3.5 },         // search and bearing origins, saved route waypoints
  wind: { full: 34, min: 10, max: 41 },       // length of a wind arrow
  boat: { full: 0.4, min: 0.3, max: 1.5 }     // boat marker, as a share of its own marker size
});

export function symbolSize(name) {
  const { full, min, max } = SYMBOLS[name];
  return clamp(full * Math.sqrt(activeChart().view.zoom / SYMBOL_FULL_SIZE_ZOOM), min, max);
}

// A boat sits just right of its mark or island, resting above the name label drawn below the centre.
const BOAT_BASELINE_PX = 6;

export function boatIconBoundsAt(point, island, islandScale = 1, boat = null) {
  const screen = worldToScreen(point);
  const marker = boatMarkerSize(boat);
  const halfWidth = island ? (island.bounds.maxLon - island.bounds.minLon) * activeChart().view.zoom * islandScale / 2 : symbolSize("mark");
  const scale = symbolSize("boat");
  const width = marker.width * scale;
  const height = marker.height * scale;
  return { x: screen.x + halfWidth + width / 2 + 4, y: screen.y + BOAT_BASELINE_PX - height / 2, width, height };
}
