// Tool modes and pointer handling on the chart canvas, including the previews tools draw while active.
import { ITEM_KINDS, MAX_RANGE_NM, MAX_ZOOM, MIN_ZOOM, WORLD_BOUNDS, bearingDegrees, chartItemFocusPoint, chartItems, compassPoint, createFeature, createRoutePoint, createSearch, createWind, distanceNm, formatCoordinate, itemForRef, searchExtent, searchesAnsweredBy, translateChartItems, visibleSavedRoutes } from "./model.mjs";
import { assignedIsland, islandById } from "./islands.mjs";
import { drawBoatSilhouette, visibleBoat } from "./boats.mjs";
import { clamp, formatDirection, formatNm } from "./format.mjs";
import { canvas, context, elements } from "./dom.mjs";
import { activeChart, commit, host, isSelected, persist, pushUndo, refreshSelection, replaceSelectionState, selectItem, selectedItem, selectedKeys, selectedRefs, selection, selectionKey, setPrimarySelection } from "./state.mjs";
import { boatIconBoundsAt, coordinatePrecision, eventPoint, screenToWorld, worldToScreen } from "./viewport.mjs";
import { boatColours, drawAreaCircle, drawChart, drawIslandSilhouette, drawLine, drawSearchWedge, drawWindIndicator, labelPill, magnetRing } from "./render.mjs";
import { findHit, resetHitCycle, nearestTrackPoint, onSelectedAreaEdge, snapAlongRay, snapPoint } from "./hits.mjs";
import { addLocation, addSearch, addWind, setAnchor } from "./edits.mjs";
import { renderEverything, renderInspector, renderRouteSummary } from "./panels.mjs";

// Holding Ctrl places freely. On macOS that is Option, because Ctrl-click is a right-click there.
const placesFreely = (event) => host.platform === "mac" ? event.altKey : event.ctrlKey;

const MODE_HINTS = {
  select: "Drag the chart to pan. Shift-click or Shift-drag to select several chart items.",
  location: "Click anywhere to add a location. Double-click also works from Select mode.",
  route: "Click to add route waypoints. Right-click or press Escape when finished.",
  measure: "Click two points for a temporary bearing and distance. Click again to restart.",
  area: "Press where the area is centred and drag out its radius. Drag the edge of a selected area to resize it.",
  search: "Press on the port or position that gave the direction, drag toward the destination and let go at the distance. Snaps to compass points.",
  wind: "Press where the regional wind belongs, then drag in the direction it is blowing toward."
};

const DRAG_THRESHOLD_PX = 5;

const EDGE_PAN_ZONE_PX = 22;

const EDGE_PAN_DELAY_MS = 425;

export let mode = "select";

let hoverWorld = null;

let hoverTarget = null;

export let pointerState = null;

let measure = [];

let islandPlacement = null;

let resolutionDraft = null;

let spacePressed = false;

export function setSpacePressed(pressed) {
  spacePressed = pressed;
}

// Arms the Location tool to place a chosen island outline at the next click.
export function placeIsland(island) {
  setMode("location");
  islandPlacement = island.id;
  elements["mode-hint"].textContent = `Click to place ${island.name}. Press Escape to cancel.`;
}

export function drawToolPreview(palette) {
  drawMeasure(palette);
  drawAreaDraft(palette);
  drawSearchDraft(palette);
  drawWindDraft(palette);
  drawPlacementDraft(palette);
  drawMagnet(palette);
  drawMarquee(palette);
}

let edgePan = null;

export function setMode(nextMode) {
  mode = nextMode;
  measure = [];
  resetHitCycle();
  if (nextMode !== "location") islandPlacement = null;
  if (nextMode !== "resolve") resolutionDraft = null;
  stopEdgePan();
  document.querySelectorAll(".tool").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  canvas.className = mode === "select" ? "" : `mode-${mode}`;
  elements["mode-hint"].textContent = MODE_HINTS[mode] ?? "Click the resolved position. Press Escape to cancel.";
  drawChart();
}

// Dragging out a search snaps to the 16 compass points the game names and to whole miles,
// unless the centre comes near a charted line or mark along that heading, which it then sits on.
function searchFromDrag(origin, screen, free) {
  const cursor = screenToWorld(screen.x, screen.y);
  const bearing = Math.round(bearingDegrees(origin, cursor) / 22.5) * 22.5 % 360;
  const magnetNm = free ? null : snapAlongRay(origin, bearing, screen);
  return {
    ...origin,
    bearing,
    distanceNm: magnetNm === null ? Math.max(1, Math.round(distanceNm(origin, cursor))) : Math.round(magnetNm * 10) / 10,
    snapped: magnetNm !== null,
    ...searchMargins()
  };
}

// New searches reuse the margins of the last one, so a corrected default only has to be set once.
function searchMargins() {
  const previous = activeChart().searches.at(-1);
  return previous ? { spreadDeg: previous.spreadDeg, tolerancePct: previous.tolerancePct } : {};
}

function windFromDrag(origin, screen, free) {
  const target = screenToWorld(screen.x, screen.y);
  const raw = bearingDegrees(origin, target);
  return { ...origin, bearing: free ? Math.round(raw * 10) / 10 : Math.round(raw / 22.5) * 22.5 % 360 };
}

export function drawAreaDraft(palette) {
  if (pointerState?.type !== "area" || !hoverTarget) return;
  const rangeNm = distanceNm(pointerState.center, hoverTarget);
  const center = worldToScreen(pointerState.center);
  const edge = worldToScreen(hoverTarget);
  context.save();
  drawAreaCircle(pointerState.center, rangeNm, true, palette);
  context.strokeStyle = palette.select;
  context.lineWidth = 1;
  drawLine(center, edge);
  labelPill(`${formatNm(rangeNm)} nm`, (center.x + edge.x) / 2, (center.y + edge.y) / 2 - 12, palette);
  context.restore();
}

export function drawSearchDraft(palette) {
  if (pointerState?.type !== "search" || !pointerState.moved || !pointerState.cursor) return;
  const values = searchFromDrag(pointerState.origin, pointerState.cursor, pointerState.free);
  const draft = createSearch(values);
  if (!draft) return;
  drawSearchWedge(draft, true, palette);
  if (values.snapped) magnetRing(worldToScreen(searchExtent(draft).centre), palette);
  const cursor = pointerState.cursor;
  labelPill(`${formatDirection(draft.bearing)} · ${formatNm(draft.distanceNm)} nm · ${formatNm(searchExtent(draft).widthNm)} nm wide`, cursor.x, cursor.y + 20, palette);
}

// A ring shows where a click will land when the magnet has pulled it onto a mark or line.
export function drawMagnet(palette) {
  if (mode === "select" || pointerState?.type === "search" || pointerState?.type === "pan" || !hoverTarget?.snapped) return;
  magnetRing(worldToScreen(hoverTarget), palette);
}

export function drawWindDraft(palette) {
  if (pointerState?.type !== "wind" || !pointerState.moved || !pointerState.cursor) return;
  const wind = createWind(windFromDrag(pointerState.origin, pointerState.cursor, pointerState.free));
  if (!wind) return;
  drawWindIndicator(wind, true, palette);
  labelPill(`Flows toward ${formatDirection(wind.bearing)}`, pointerState.cursor.x, pointerState.cursor.y + 20, palette);
}

export function drawPlacementDraft(palette) {
  if (!hoverTarget) return;
  const island = islandPlacement ? islandById(islandPlacement) : resolutionIsland();
  const source = resolutionDraft ? itemForRef(activeChart(), resolutionDraft) : null;
  const boat = activeChart().layers.boats ? visibleBoat(source) : null;
  if (!island && !boat) return;
  context.save();
  context.globalAlpha = .72;
  if (island) drawIslandSilhouette(hoverTarget, island, true, palette);
  if (boat) drawBoatSilhouette(context, boat, boatIconBoundsAt(hoverTarget, island, 1, boat), {
    ...boatColours(palette, true),
    lineWidth: 1.7,
    detail: "marker"
  });
  context.restore();
}

function resolutionIsland() {
  if (!resolutionDraft) return null;
  const item = itemForRef(activeChart(), resolutionDraft);
  const name = resolutionDraft.kind === "search" ? item?.label : item?.name;
  return assignedIsland({ name });
}

export function drawMarquee(palette) {
  if (pointerState?.type !== "marquee" || !pointerState.cursor) return;
  const left = Math.min(pointerState.start.x, pointerState.cursor.x);
  const top = Math.min(pointerState.start.y, pointerState.cursor.y);
  const width = Math.abs(pointerState.cursor.x - pointerState.start.x);
  const height = Math.abs(pointerState.cursor.y - pointerState.start.y);
  context.save();
  context.fillStyle = palette.areaFill;
  context.strokeStyle = palette.select;
  context.setLineDash([5, 4]);
  context.fillRect(left, top, width, height);
  context.strokeRect(left, top, width, height);
  context.restore();
}

export function drawMeasure(palette) {
  if (!measure.length) return;
  const end = measure[1] ?? hoverTarget;
  if (!end) return;
  const from = worldToScreen(measure[0]);
  const to = worldToScreen(end);
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 1.5;
  context.setLineDash([6, 5]);
  drawLine(from, to);
  context.setLineDash([]);
  context.fillStyle = palette.select;
  context.beginPath(); context.arc(from.x, from.y, 4, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(to.x, to.y, 4, 0, Math.PI * 2); context.fill();
  const bearing = bearingDegrees(measure[0], end);
  labelPill(`${distanceNm(measure[0], end).toFixed(1)} nm · ${Math.round(bearing)}° ${compassPoint(bearing)}`, (from.x + to.x) / 2, (from.y + to.y) / 2 - 12, palette);
  context.restore();
}

function edgePanEligible() {
  return mode === "resolve"
    || pointerState?.type === "area"
    || pointerState?.type === "search"
    || (mode === "measure" && measure.length === 1);
}

function updateEdgePan(screen, free = false) {
  if (!edgePanEligible()) return stopEdgePan();
  const rectangle = canvas.getBoundingClientRect();
  const direction = {
    x: screen.x <= EDGE_PAN_ZONE_PX ? -1 : screen.x >= rectangle.width - EDGE_PAN_ZONE_PX ? 1 : 0,
    y: screen.y <= EDGE_PAN_ZONE_PX ? -1 : screen.y >= rectangle.height - EDGE_PAN_ZONE_PX ? 1 : 0
  };
  if (!direction.x && !direction.y) return stopEdgePan();
  const key = `${direction.x}:${direction.y}`;
  const now = performance.now();
  if (!edgePan || edgePan.key !== key) {
    stopEdgePan();
    edgePan = { key, direction, screen, free, entered: now, last: now, frame: 0, moved: false };
  } else {
    edgePan.screen = screen;
    edgePan.free = free;
  }
  if (!edgePan.frame) edgePan.frame = requestAnimationFrame(stepEdgePan);
}

function stepEdgePan(now) {
  if (!edgePan || !edgePanEligible()) return stopEdgePan();
  const current = edgePan;
  current.frame = 0;
  const held = now - current.entered;
  if (held >= EDGE_PAN_DELAY_MS) {
    const elapsed = Math.min(50, now - current.last);
    const ramp = clamp((held - EDGE_PAN_DELAY_MS) / 2500, 0, 1);
    const speed = 55 + 545 * ramp;
    const pixels = speed * elapsed / 1000;
    const view = activeChart().view;
    const before = { lat: view.lat, lon: view.lon };
    view.lon = clamp(view.lon + current.direction.x * pixels / view.zoom, WORLD_BOUNDS.minLon, WORLD_BOUNDS.maxLon);
    view.lat = clamp(view.lat - current.direction.y * pixels / view.zoom, WORLD_BOUNDS.minLat, WORLD_BOUNDS.maxLat);
    current.moved ||= before.lat !== view.lat || before.lon !== view.lon;
    hoverWorld = screenToWorld(current.screen.x, current.screen.y);
    hoverTarget = snapPoint(current.screen, current.free);
    if (pointerState?.type === "search") pointerState.cursor = current.screen;
    drawChart();
  }
  current.last = now;
  if (edgePan === current) current.frame = requestAnimationFrame(stepEdgePan);
}

export function stopEdgePan() {
  if (!edgePan) return;
  if (edgePan.frame) cancelAnimationFrame(edgePan.frame);
  const moved = edgePan.moved;
  edgePan = null;
  if (moved) persist();
}

export function startPointer(event) {
  if (event.button !== 0 && event.button !== 1) return;
  canvas.setPointerCapture(event.pointerId);
  const screen = eventPoint(event);
  const forcePan = event.button === 1 || spacePressed;
  if (forcePan) return startPan(event, screen);

  const target = snapPoint(screen, placesFreely(event));
  if (mode === "resolve") {
    resolveToLocation(target);
    return;
  }
  if (mode === "location") {
    const island = islandById(islandPlacement);
    addLocation(target, island?.name || "New location", island ? { islandId: island.id } : {});
    setMode("select");
    return;
  }
  if (mode === "area") {
    pointerState = { type: "area", pointerId: event.pointerId, center: target, start: screen };
    return;
  }
  if (mode === "search") {
    pointerState = { type: "search", pointerId: event.pointerId, origin: target, start: screen, moved: false };
    drawChart();
    return;
  }
  if (mode === "wind") {
    pointerState = { type: "wind", pointerId: event.pointerId, origin: target, start: screen, moved: false };
    drawChart();
    return;
  }
  if (mode === "route") {
    commit((chart) => {
      const point = createRoutePoint(target);
      chart.route.push(point);
      replaceSelectionState("route", point.id);
    });
    return;
  }
  if (mode === "measure") {
    measure = measure.length >= 2 ? [target] : [...measure, target];
    if (measure.length >= 2) stopEdgePan();
    drawChart();
    return;
  }
  if (!event.shiftKey && onSelectedAreaEdge(screen)) {
    pointerState = { type: "resize-area", pointerId: event.pointerId, start: screen, moved: false };
    return;
  }
  const hit = findHit(screen.x, screen.y, { cycle: true });
  if (hit?.passive) {
    selectItem(hit.kind, hit.id, { additive: event.shiftKey });
    if (!event.shiftKey) startPan(event, screen);
  } else if (hit?.fix) {
    selectItem(hit.kind, hit.id, { additive: event.shiftKey });
  } else if (hit) {
    if (event.shiftKey) {
      selectItem(hit.kind, hit.id, { additive: true });
      return;
    }
    if (!isSelected(hit.kind, hit.id)) selectItem(hit.kind, hit.id);
    else {
      setPrimarySelection(hit);
      refreshSelection();
    }
    pointerState = { type: "move-items", pointerId: event.pointerId, start: screen, last: screen, moved: false };
    canvas.classList.add("dragging");
  } else if (event.shiftKey) {
    pointerState = { type: "marquee", pointerId: event.pointerId, start: screen, cursor: screen, moved: false };
  } else {
    selectItem(null, null);
    startPan(event, screen);
  }
}

function startPan(event, screen) {
  pointerState = {
    type: "pan",
    pointerId: event.pointerId,
    start: screen,
    original: { ...activeChart().view }
  };
  canvas.classList.add("dragging");
}

export function movePointer(event) {
  const screen = eventPoint(event);
  hoverWorld = screenToWorld(screen.x, screen.y);
  hoverTarget = mode === "select" ? hoverWorld : snapPoint(screen, placesFreely(event));
  updateEdgePan(screen, placesFreely(event));
  const precision = coordinatePrecision();
  elements["cursor-coordinates"].textContent = `${formatCoordinate(hoverWorld.lat, "lat", precision)} · ${formatCoordinate(hoverWorld.lon, "lon", precision)}`;
  const trackPoint = pointerState ? null : nearestTrackPoint(screen);
  elements["hover-info"].hidden = !trackPoint;
  if (trackPoint) {
    elements["hover-info"].textContent = [trackPoint.day && `Day ${trackPoint.day}`, trackPoint.time, trackPoint.wind && `wind ${trackPoint.wind}`].filter(Boolean).join(" · ") || "Track position";
  }
  if (!pointerState || pointerState.pointerId !== event.pointerId) {
    canvas.classList.toggle("resize", mode === "select" && onSelectedAreaEdge(screen));
    if (mode !== "select") drawChart();
    return;
  }
  if (pointerState.type === "pan") {
    const dx = screen.x - pointerState.start.x;
    const dy = screen.y - pointerState.start.y;
    activeChart().view.lon = clamp(pointerState.original.lon - dx / activeChart().view.zoom, -90, 90);
    activeChart().view.lat = clamp(pointerState.original.lat + dy / activeChart().view.zoom, -90, 90);
    drawChart();
  } else if (pointerState.type === "area") {
    drawChart();
  } else if (pointerState.type === "search" || pointerState.type === "wind") {
    pointerState.cursor = screen;
    pointerState.free = placesFreely(event);
    pointerState.moved ||= Math.hypot(screen.x - pointerState.start.x, screen.y - pointerState.start.y) >= 4;
    drawChart();
  } else if (pointerState.type === "marquee") {
    pointerState.cursor = screen;
    pointerState.moved ||= Math.hypot(screen.x - pointerState.start.x, screen.y - pointerState.start.y) >= DRAG_THRESHOLD_PX;
    drawChart();
  } else if (pointerState.type === "resize-area") {
    if (!pointerState.moved && Math.hypot(screen.x - pointerState.start.x, screen.y - pointerState.start.y) < DRAG_THRESHOLD_PX) return;
    if (!pointerState.moved) pushUndo();
    const item = selectedItem();
    item.rangeNm = Math.min(MAX_RANGE_NM, Math.round(distanceNm(item, hoverWorld) * 10) / 10);
    pointerState.moved = true;
    renderInspector();
    drawChart();
  } else if (pointerState.type === "move-items") {
    if (!pointerState.moved && Math.hypot(screen.x - pointerState.start.x, screen.y - pointerState.start.y) < DRAG_THRESHOLD_PX) return;
    if (!pointerState.moved) {
      pushUndo();
      pointerState.moved = true;
    }
    const item = selectedItem();
    if (!item) return;
    if (selectedKeys.size === 1 && selection.kind === "search") {
      const target = snapPoint(screen, placesFreely(event));
      translateChartItems(activeChart(), selectedRefs(), { lat: target.lat - item.lat, lon: target.lon - item.lon });
      setAnchor(item, target.anchor);
    } else {
      translateChartItems(activeChart(), selectedRefs(), {
        lat: -(screen.y - pointerState.last.y) / activeChart().view.zoom,
        lon: (screen.x - pointerState.last.x) / activeChart().view.zoom
      });
    }
    pointerState.last = screen;
    renderInspector();
    renderRouteSummary();
    drawChart();
  }
}

export function endPointer(event) {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  if (pointerState.type === "area") {
    stopEdgePan();
    const { center, start } = pointerState;
    pointerState = null;
    const screen = eventPoint(event);
    // A click without a drag is ignored, so a stray click never leaves a zero-size area.
    if (Math.hypot(screen.x - start.x, screen.y - start.y) >= 4) {
      const rangeNm = Math.round(distanceNm(center, snapPoint(screen, placesFreely(event))) * 10) / 10;
      addLocation(center, "Rough area", { rangeNm });
    } else {
      drawChart();
    }
    return;
  }
  if (pointerState.type === "search") {
    stopEdgePan();
    const { origin, moved } = pointerState;
    pointerState = null;
    const screen = eventPoint(event);
    // As with rough areas, a click without a drag leaves nothing behind.
    if (moved) addSearch(searchFromDrag(origin, screen, placesFreely(event)));
    else drawChart();
    return;
  }
  if (pointerState.type === "wind") {
    const { origin, moved } = pointerState;
    pointerState = null;
    const screen = eventPoint(event);
    if (moved) {
      addWind(windFromDrag(origin, screen, placesFreely(event)));
      setMode("select");
    }
    else drawChart();
    return;
  }
  if (pointerState.type === "marquee") {
    const { moved, start, cursor } = pointerState;
    pointerState = null;
    if (moved) selectMarquee(start, cursor);
    else drawChart();
    return;
  }
  if (pointerState.type === "move-items" || pointerState.type === "resize-area") {
    if (pointerState.moved) {
      activeChart().updatedAt = new Date().toISOString();
      persist();
      renderEverything();
    }
  } else if (pointerState.type === "pan") {
    persist();
  }
  pointerState = null;
  canvas.classList.remove("dragging");
}

function selectMarquee(start, end) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  let last = null;
  const chart = activeChart();
  const visiblePoints = new Set(visibleSavedRoutes(chart).flatMap((route) => route.points));
  for (const kind of ITEM_KINDS.filter((candidate) => candidate !== "saved-route")) {
    for (const item of chartItems(chart, kind)) {
      if (kind === "saved-point" && !visiblePoints.has(item)) continue;
      const point = worldToScreen(chartItemFocusPoint(kind, item));
      if (point.x < left || point.x > right || point.y < top || point.y > bottom) continue;
      selectedKeys.add(selectionKey(kind, item.id));
      last = { kind, id: item.id };
    }
  }
  setPrimarySelection(last);
  refreshSelection();
}

export function beginResolution(ref) {
  if (!itemForRef(activeChart(), ref)) return;
  resolutionDraft = { ...ref };
  islandPlacement = null;
  setMode("resolve");
}

function resolveToLocation(point) {
  const ref = resolutionDraft;
  const source = itemForRef(activeChart(), ref);
  if (!ref || !source) return setMode("select");
  commit((chart) => {
    if (ref.kind === "search") {
      const extent = searchExtent(source);
      const feature = createFeature({
        lat: point.lat,
        lon: point.lon,
        name: source.label || "Resolved location",
        boatId: source.boatId,
        notes: `Resolved from a ${formatDirection(source.bearing)} search, ${formatNm(extent.nearNm)}–${formatNm(extent.farNm)} nm from ${formatCoordinate(source.lat, "lat", 3)}, ${formatCoordinate(source.lon, "lon", 3)}.`
      });
      const answered = new Set(searchesAnsweredBy(chart.searches, source));
      chart.searches = chart.searches.filter((search) => !answered.has(search));
      chart.features.push(feature);
      replaceSelectionState("feature", feature.id);
    } else if (ref.kind === "feature") {
      source.lat = point.lat;
      source.lon = point.lon;
      source.rangeNm = 0;
      replaceSelectionState("feature", source.id);
    }
  });
  setMode("select");
}

export function zoomAt(event) {
  event.preventDefault();
  const screen = eventPoint(event);
  const before = screenToWorld(screen.x, screen.y);
  const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
  const factor = Math.exp(-clamp(pixels, -300, 300) * .0016);
  activeChart().view.zoom = clamp(activeChart().view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const after = screenToWorld(screen.x, screen.y);
  activeChart().view.lon = clamp(activeChart().view.lon + before.lon - after.lon, -90, 90);
  activeChart().view.lat = clamp(activeChart().view.lat + before.lat - after.lat, -90, 90);
  persist();
  drawChart();
}
