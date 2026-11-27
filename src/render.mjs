// Draws the chart canvas and moves its view. Tool previews are drawn by interaction.mjs through setOverlay().
import { mapPalette, paperTile } from "./theme.mjs";
import { MAX_ZOOM, MIN_ZOOM, NM_PER_DEGREE, WORLD_BOUNDS, bearingDegrees, clusteredLabelIds, destinationPoint, distanceNm, formatDuration, legPieces, milesPerDegree, searchChartLabel, searchEvidenceOpacity, searchExtent, searchIconAnchors, searchNameLabelIds, searchOverlapGroups, shownItems, summarizeRoute, trackLayerShown, tradeWindAt, iconScale } from "./model.mjs";
import { islandWorldBounds } from "./islands.mjs";
import { VANILLA_MAP, importedMapIslands } from "./scrambled-seas.mjs";
import { assignedBoats, boatMarkerSize, drawBoatSilhouette } from "./boats.mjs";
import { clamp, formatBearing, formatDirection, formatNm, isNightTime, nearlyMultiple, shortCoordinate } from "./format.mjs";
import { canvas, context, elements } from "./dom.mjs";
import { activeChart, isSelected, persist, viewLayers, workspace } from "./state.mjs";
import { trackBearing, trackSegments, unwrapNear, unwrapStretch } from "./track.mjs";
import { formatGameTime } from "./gametime.mjs";
import { drawLocationIcon } from "./icons.mjs";
import { drawNotes, positionNotePopout } from "./notes.mjs";
import { readingKnowledge } from "./equipment.mjs";
import { drawComparisons } from "./compare.mjs";
import { drawExportRange, drawHeatmap } from "./share.mjs";
import { boatRowAt, chartIsland, chartSearchIsland, featureBoats, centredArrowEnds, islandPixelSpan, projector, screenToWorld, symbolSize, windArrowEnds, worldToScreen } from "./viewport.mjs";

let visibleChartLabels = new Set();

export function resizeCanvas() {
  const rectangle = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(rectangle.width * scale));
  canvas.height = Math.max(1, Math.round(rectangle.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawChart();
}

function labelKey(kind, id) {
  return `${kind}:${id}`;
}

function labelVisible(kind, id) {
  return visibleChartLabels.has(labelKey(kind, id));
}

function chartLabelCandidates(chart, layers) {
  const candidates = [];
  const searches = shownItems(chart, "search", layers);
  const namedSearchLabels = searchNameLabelIds(searches);
  const searchAnchors = searchIconAnchors(searches);
  context.font = LABEL_FONT;
  // below is how far under its point a label's top edge is drawn; a search's name sits above its centre.
  const add = (kind, id, name, point, selected = false, priority = 10, below = 12) => {
    if (!name || !point) return;
    const screen = worldToScreen(point);
    candidates.push({ id: labelKey(kind, id), name, x: screen.x, y: screen.y + below, width: context.measureText(name).width, selected, priority });
  };
  // The player's own names come first; a vanilla name shows only where it has room.
  for (const { island, centre, item } of vanillaIslands(chart, layers)) if (!island.partOf) add(item ? "imported" : "vanilla", island.id, island.name, centre, false, 60);
  for (const feature of shownItems(chart, "feature", layers)) if (feature.showName !== false) add("feature", feature.id, feature.name, feature, isSelected("feature", feature.id), 0);
  for (const search of searches) {
    const selected = isSelected("search", search.id);
    if (search.label && !namedSearchLabels.has(search.id) && !selected) continue;
    add("search", search.id, search.label || "Search area", searchAnchors.get(search.id) ?? searchExtent(search).centre, selected, 0, -24);
  }
  for (const point of shownItems(chart, "route", layers)) add("route", point.id, point.name, point, isSelected("route", point.id), 30);
  for (const route of shownItems(chart, "saved-route", layers)) {
    const active = isSelected("saved-route", route.id) || route.points.some((point) => isSelected("saved-point", point.id));
    for (const point of route.points) add("saved-point", point.id, point.name, point, isSelected("saved-point", point.id), 35);
    if (active && layers.routeDistances) summarizeRoute(route.points, chart.circumnavigation).legs.forEach((leg, index) => {
      add("saved-leg", `${route.id}:${index}`, "Route distance", leg.mid, false, 40);
    });
  }
  summarizeRoute(shownItems(chart, "route", layers), chart.circumnavigation).legs.forEach((leg, index) => {
    if (!layers.routeDistances) return;
    add("route-leg", index, "Route distance", leg.mid, false, 40);
  });
  if (layers.winds) for (const wind of chart.winds) add("wind", wind.id, wind.label, wind, isSelected("wind", wind.id));
  const track = shownItems(chart, "track", layers);
  if (track.length) add("track", "last", "Last position", track.at(-1));
  return candidates;
}


let overlay = () => {};

export function boatColours(palette, selected) {
  return selected
    ? { stroke: palette.boatSelected, fill: palette.boatSelectedFill, sailFill: palette.boatSelectedSail }
    : { stroke: palette.boat, fill: palette.boatFill, sailFill: palette.boatSail };
}
const MIN_VISIBLE_ISLAND_PX = 5;
// Zoom at which the paper tile shows at its own size; it scales with the chart within limits around it.
const PAPER_NATIVE_ZOOM = 35;

// Lets the active tool draw its preview above the chart on every redraw.
export function setOverlay(draw) {
  overlay = draw;
}

export function drawChart() {
  const rectangle = canvas.getBoundingClientRect();
  const width = rectangle.width;
  const height = rectangle.height;
  if (!width || !height) return;
  const palette = mapPalette();
  const chart = activeChart();
  const layers = viewLayers(chart);
  visibleChartLabels = clusteredLabelIds(chartLabelCandidates(chart, layers));

  const gradient = context.createRadialGradient(width * .45, height * .4, 0, width * .45, height * .4, Math.max(width, height));
  gradient.addColorStop(0, palette.paperA);
  gradient.addColorStop(1, palette.paperB);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  // The Sailwind paper is anchored to the chart, so it pans and zooms with the lines and marks.
  const tile = paperTile();
  if (tile) {
    const pattern = context.createPattern(tile, "repeat");
    const origin = worldToScreen({ lat: 0, lon: 0 });
    // Limited so the paper never blurs to blobs close in or turns to noise far out; past the limits it pans but stops scaling.
    const scale = clamp(activeChart().view.zoom / PAPER_NATIVE_ZOOM, 0.2, 6);
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, origin.x, origin.y]));
    context.save();
    context.globalAlpha = palette.texture;
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (layers.grid) drawGrid(width, height, palette, layers.labels);
  drawWorldBorder(palette);
  if (layers.tradeWinds) {
    // As faint as the vanilla map, so the arrows sit beneath the chart's own marks.
    context.save();
    context.globalAlpha = 0.55;
    drawTradeWinds(width, height, palette, layers.expandedWinds);
    context.restore();
  }
  drawVanillaMap(width, height, palette, chart, layers);
  drawHeatmap(palette);
  drawLines(palette, chart, layers);
  drawAreas(palette, chart, layers);
  drawSearches(palette, chart, layers);
  if (layers.winds) drawWinds(palette, chart, layers);
  drawSavedRoutes(palette, chart, layers);
  drawRoute(palette, chart, layers);
  // Recorded positions sit above route lines, which often run along them.
  drawComparisons(palette);
  drawExportRange(palette);
  const lastPosition = layers.track ? drawTrack(palette, chart, layers) : null;
  if (layers.deadReckoning) drawDrPositions(palette, chart, layers);
  drawFeatures(palette, chart, layers);
  drawNotes(palette);
  // Where you are now stays in sight above islands and locations.
  if (lastPosition) drawLastPosition(lastPosition, palette, layers.labels);
  overlay(palette);
  drawCompassRose(width - 56, height - 64, palette);
  updateZoomLabel();
  positionNotePopout();
}

function drawGrid(width, height, palette, showLabels) {
  const zoom = activeChart().view.zoom;
  const candidates = [.0005, .001, .002, .005, .01, .02, .05, .1, .25, .5, 1, 2, 5, 10, 20, 30, 45];
  const step = candidates.find((candidate) => candidate * zoom >= 64) ?? 45;
  const fineStep = step / (step === .25 ? 5 : step === 30 || step === 45 ? 3 : 2);
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);
  const startLon = Math.ceil(topLeft.lon / fineStep) * fineStep;
  const endLon = bottomRight.lon;
  const startLat = Math.ceil(bottomRight.lat / fineStep) * fineStep;
  const endLat = topLeft.lat;
  context.save();
  context.textBaseline = "top";
  for (let lon = startLon; lon <= endLon + .0001; lon += fineStep) {
    const x = worldToScreen({ lat: 0, lon }).x;
    const major = nearlyMultiple(lon, step);
    context.strokeStyle = major ? palette.grid : palette.fine;
    context.lineWidth = major ? 1 : .7;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    if (major && showLabels) gridLabel(shortCoordinate(lon, "lon", step), x + 5, 6, palette);
  }
  for (let lat = startLat; lat <= endLat + .0001; lat += fineStep) {
    const y = worldToScreen({ lat, lon: 0 }).y;
    const major = nearlyMultiple(lat, step);
    context.strokeStyle = major ? palette.grid : palette.fine;
    context.lineWidth = major ? 1 : .7;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    if (major && showLabels) gridLabel(shortCoordinate(lat, "lat", step), 6, y + 5, palette);
  }
  context.restore();
}

// Grid labels sit on a dark halo so they stay readable over lines and marks.
function gridLabel(text, x, y, palette) {
  context.font = "600 12.5px ui-sans-serif, system-ui";
  context.lineWidth = 3.5;
  context.lineJoin = "round";
  context.strokeStyle = palette.paperB;
  context.strokeText(text, x, y);
  context.fillStyle = palette.ink;
  context.fillText(text, x, y);
}

function drawWorldBorder(palette) {
  const northwest = worldToScreen({ lat: WORLD_BOUNDS.maxLat, lon: WORLD_BOUNDS.minLon });
  const southeast = worldToScreen({ lat: WORLD_BOUNDS.minLat, lon: WORLD_BOUNDS.maxLon });
  context.save();
  context.strokeStyle = palette.faded;
  context.lineWidth = 2;
  strokeDashed([northwest, { x: southeast.x, y: northwest.y }, southeast, { x: northwest.x, y: southeast.y }, northwest], [8, 7]);
  context.restore();
}

// Kept lines in their own colours, each with its own pattern so they differ without colour too: red solid,
// blue dashed, green dash-dot. A selected line also shows its distance and bearing.
export const LINE_DASHES = Object.freeze({ red: null, blue: [12, 6], green: [12, 5, 1, 5] });

function drawLines(palette, chart, layers) {
  for (const line of shownItems(chart, "line", layers)) {
    const selected = isSelected("line", line.id);
    const a = worldToScreen(line);
    const b = worldToScreen(line.end);
    context.save();
    context.strokeStyle = palette.lines[line.color];
    context.fillStyle = palette.lines[line.color];
    context.lineWidth = selected ? 3 : 2;
    context.lineCap = "round";
    if (LINE_DASHES[line.color]) strokeDashed([a, b], LINE_DASHES[line.color]);
    else drawLine(a, b);
    if (selected) {
      for (const end of [a, b]) { context.beginPath(); context.arc(end.x, end.y, 4.5, 0, Math.PI * 2); context.fill(); }
      selectionHalo(a, palette);
      selectionHalo(b, palette);
    }
    context.restore();
    if (selected) lineLabel(line, line.end, palette);
  }
}

// Like the track's wind arrows, a position only gets a dot this far on screen from the last one drawn, so far
// out the track shows a few dots along its dashed line and the rest fill in as you zoom in. The line skips
// positions less than a pixel from the last one it drew, which a long recording seen from far out is mostly made of.
const TRACK_DOT_SPACING_PX = 18;
const TRACK_DOT_RADIUS_PX = 2.8;
const TRACK_LINE_SPACING_PX = 1;
const TRACK_WIND_SPACING_PX = 70;

// Each stretch of the track is drawn on its own, so a reload or a jump leaves a gap instead of a false
// line. A stretch that crosses the chart's east or west edge is drawn again from the other side.
// Returns the last position and the one before it in its stretch, for drawLastPosition.
function drawTrack(palette, chart, layers) {
  const gated = chart.equipment?.enabled === true;
  if (gated) drawPartialLines(palette, chart, layers);
  const track = shownItems(chart, "track", layers);
  if (!track.length) return null;
  const { width, height } = canvas.getBoundingClientRect();
  const project = projector();
  context.save();
  context.strokeStyle = palette.track;
  context.lineWidth = 1.5;
  // Stretches come from the whole recording of each shown source, then keep only the shown positions, so
  // hidden readings (equipment, or automatic or manual locations) don't break a stretch into gaps.
  const shownSet = new Set(track);
  const segments = trackSegments(chart.track.filter((point) => layers[point.source === "voyage" ? "trackVoyageRecorder" : "trackCoordinateViewer"]))
    .map((segment) => segment.filter((point) => shownSet.has(point))).filter((segment) => segment.length);
  if (layers.trackLines) {
    for (const segment of segments) {
      const line = unwrapStretch(segment);
      const offsets = [0];
      if (line.some((point) => point.lon > WORLD_BOUNDS.maxLon)) offsets.push(-360);
      if (line.some((point) => point.lon < WORLD_BOUNDS.minLon)) offsets.push(360);
      for (const offset of offsets) {
        const screen = [];
        for (const [index, point] of line.entries()) {
          const next = project({ lat: point.lat, lon: point.lon + offset });
          const previous = screen.at(-1);
          if (previous && index < line.length - 1 && Math.abs(next.x - previous.x) < TRACK_LINE_SPACING_PX && Math.abs(next.y - previous.y) < TRACK_LINE_SPACING_PX) continue;
          screen.push(next);
        }
        strokeDashed(screen, [3, 5]);
      }
    }
  }
  const visible = (screen, margin = 12) => screen.x >= -margin && screen.y >= -margin && screen.x <= width + margin && screen.y <= height + margin;
  const roughRadiusPx = Math.max(ROUGH_FIX_MIN_PX, ROUGH_FIX_NM / NM_PER_DEGREE * chart.view.zoom);
  const roughSpacingPx = Math.max(roughRadiusPx * 1.4, ROUGH_FIX_MIN_SPACING_PX);
  let lastDot = null;
  let lastRough = null;
  let lastWind = null;
  for (const point of track) {
    const screen = project(point);
    const selected = isSelected("track", point.id);
    const knowledge = gated ? readingKnowledge(chart, point) : null;
    if (!selected && !visible(screen, knowledge?.rough ? roughRadiusPx + 4 : 12)) continue;
    if (layers.trackWinds && Number.isFinite(point.windDeg) && (!knowledge || knowledge.windDir) && (!lastWind || Math.hypot(screen.x - lastWind.x, screen.y - lastWind.y) >= TRACK_WIND_SPACING_PX)) {
      drawTrackWind(screen, point.windDeg, palette);
      lastWind = screen;
    }
    if (point.event?.startsWith("race-")) drawRaceFlag(screen, point.event, palette);
    // Where the player connected two stretches: a ring round the first position after the old gap.
    if (point.joinPrevious) {
      context.save();
      context.strokeStyle = palette.track;
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(screen.x, screen.y, 5.5, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    if (knowledge?.rough) {
      if (!selected && lastRough && Math.hypot(screen.x - lastRough.x, screen.y - lastRough.y) < roughSpacingPx) continue;
      lastRough = screen;
      context.save();
      context.beginPath();
      context.arc(screen.x, screen.y, roughRadiusPx, 0, Math.PI * 2);
      context.fillStyle = palette.track;
      context.globalAlpha = 0.06;
      context.fill();
      context.globalAlpha = 0.55;
      context.strokeStyle = palette.track;
      context.lineWidth = 1.25;
      context.setLineDash([4, 5]);
      context.stroke();
      context.restore();
      if (selected) selectionHalo(screen, palette);
      continue;
    }
    if (!selected && lastDot && Math.hypot(screen.x - lastDot.x, screen.y - lastDot.y) < TRACK_DOT_SPACING_PX) continue;
    lastDot = screen;
    // Day positions are filled dots and night ones hollow rings, so they differ without colour too.
    context.beginPath();
    if (isNightTime(point.time)) {
      context.arc(screen.x, screen.y, TRACK_DOT_RADIUS_PX - .6, 0, Math.PI * 2);
      context.fillStyle = palette.paperA;
      context.fill();
      context.strokeStyle = palette.night;
      context.lineWidth = 1.4;
      context.stroke();
    } else {
      context.arc(screen.x, screen.y, TRACK_DOT_RADIUS_PX, 0, Math.PI * 2);
      context.fillStyle = palette.track;
      context.fill();
    }
    context.globalAlpha = 1;
    if (selected) selectionHalo(screen, palette);
  }
  context.restore();
  const lastSegment = segments.at(-1);
  return { last: lastSegment.at(-1), previous: lastSegment.at(-2) };
}

// Partial readings: latitude-only (horizontal) or longitude-only (vertical) lines. When no prior full fix
// or DR anchor exists, the line spans the visible chart so the unknown coordinate is never leaked; with an
// anchor, it draws a wide band centred on the anchor rather than on the true hidden coordinate.
const PARTIAL_LINE_NM = 140;
const PARTIAL_LINE_MIN_PX = 110;
const PARTIAL_LINE_SPACING_PX = 14;
const PARTIAL_WIND_STEP_PX = 140;
const ROUGH_FIX_NM = 25;
const ROUGH_FIX_MIN_PX = 14;
const ROUGH_FIX_MIN_SPACING_PX = 55;

function drawPartialLines(palette, chart, layers) {
  if (!layers.track) return;
  const { width, height } = canvas.getBoundingClientRect();
  const zoom = chart.view.zoom;
  const halfPx = Math.max(PARTIAL_LINE_MIN_PX, PARTIAL_LINE_NM / NM_PER_DEGREE * zoom);
  let lastKnown = null;
  let lastLat = null;
  let lastLon = null;
  let lastLatWind = null;
  let lastLonWind = null;
  context.save();
  context.strokeStyle = palette.track;
  context.lineWidth = 1.4;
  context.lineCap = "round";
  for (const point of chart.track) {
    if (!trackLayerShown(chart, point, layers)) continue;
    const knowledge = readingKnowledge(chart, point);
    if (knowledge.lat && knowledge.lon) {
      lastKnown = point;
      continue;
    }
    if (!knowledge.lat && !knowledge.lon) continue;
    const reckoned = chart.drPositions.findLast((position) => Number.isFinite(position.t) && Number.isFinite(point.t) && position.t <= point.t);
    const anchor = [lastKnown, reckoned].filter(Boolean).sort((a, b) => (b.t ?? -1) - (a.t ?? -1))[0] ?? null;
    if (knowledge.lat) {
      const y = worldToScreen({ lat: point.lat, lon: anchor?.lon ?? chart.view.lon }).y;
      if (y < -12 || y > height + 12) continue;
      const anchorX = anchor ? worldToScreen({ lat: point.lat, lon: anchor.lon }).x : width / 2;
      const x0 = anchor ? anchorX - halfPx : 0;
      const x1 = anchor ? anchorX + halfPx : width;
      if (x1 < -12 || x0 > width + 12) continue;
      if (lastLat !== null && Math.abs(y - lastLat) < PARTIAL_LINE_SPACING_PX) continue;
      lastLat = y;
      context.save();
      context.globalAlpha = anchor ? 0.72 : 0.45;
      context.setLineDash(anchor ? [] : [6, 6]);
      context.beginPath();
      context.moveTo(x0, y);
      context.lineTo(x1, y);
      context.stroke();
      context.restore();
      // Dot wind arrows intermittently along the line rather than at a single point so longitude stays hidden.
      if (layers.trackWinds && Number.isFinite(point.windDeg) && knowledge.windDir && (lastLatWind === null || Math.abs(y - lastLatWind) >= TRACK_WIND_SPACING_PX)) {
        lastLatWind = y;
        const startX = Math.max(28, x0 + 28);
        const endX = Math.min(width - 28, x1 - 28);
        const firstX = Math.ceil(startX / PARTIAL_WIND_STEP_PX) * PARTIAL_WIND_STEP_PX;
        context.save();
        context.globalAlpha = 0.72;
        for (let x = firstX; x <= endX; x += PARTIAL_WIND_STEP_PX) {
          drawTrackWind({ x, y }, point.windDeg, palette);
        }
        context.restore();
      }
    } else if (knowledge.lon) {
      const x = worldToScreen({ lat: anchor?.lat ?? chart.view.lat, lon: point.lon }).x;
      if (x < -12 || x > width + 12) continue;
      const anchorY = anchor ? worldToScreen({ lat: anchor.lat, lon: point.lon }).y : height / 2;
      const y0 = anchor ? anchorY - halfPx : 0;
      const y1 = anchor ? anchorY + halfPx : height;
      if (y1 < -12 || y0 > height + 12) continue;
      if (lastLon !== null && Math.abs(x - lastLon) < PARTIAL_LINE_SPACING_PX) continue;
      lastLon = x;
      context.save();
      context.globalAlpha = anchor ? 0.72 : 0.45;
      context.setLineDash(anchor ? [] : [6, 6]);
      context.beginPath();
      context.moveTo(x, y0);
      context.lineTo(x, y1);
      context.stroke();
      context.restore();
      if (layers.trackWinds && Number.isFinite(point.windDeg) && knowledge.windDir && (lastLonWind === null || Math.abs(x - lastLonWind) >= TRACK_WIND_SPACING_PX)) {
        lastLonWind = x;
        const startY = Math.max(28, y0 + 28);
        const endY = Math.min(height - 28, y1 - 28);
        const firstY = Math.ceil(startY / PARTIAL_WIND_STEP_PX) * PARTIAL_WIND_STEP_PX;
        context.save();
        context.globalAlpha = 0.72;
        for (let y = firstY; y <= endY; y += PARTIAL_WIND_STEP_PX) {
          drawTrackWind({ x, y }, point.windDeg, palette);
        }
        context.restore();
      }
    }
  }
  context.restore();
}

// The arrow at the last position, pointing along the last leg, with its label.
function drawLastPosition({ last, previous }, palette, showLabels) {
  const screen = worldToScreen(last);
  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(previous ? trackBearing(previous, last) * Math.PI / 180 : 0);
  context.fillStyle = palette.track;
  context.strokeStyle = palette.paperB;
  context.lineWidth = 1.5;
  context.beginPath(); context.moveTo(0, -9); context.lineTo(6, 7); context.lineTo(0, 4); context.lineTo(-6, 7); context.closePath();
  context.fill(); context.stroke();
  context.restore();
  if (showLabels && labelVisible("track", "last")) labelText(`Last position${last.day ? ` · day ${last.day}` : ""}${last.time ? ` ${last.time}` : ""}`, screen.x, screen.y + 11, palette);
}

// A race marker from Voyage Recorder's marker menu: a small flag on a pole, green at the start, red at the
// finish and the accent colour at a checkpoint, always drawn so it never hides behind thinned-out dots.
function drawRaceFlag(screen, event, palette) {
  const colour = event === "race-start" ? palette.lines.green : event === "race-finish" ? palette.lines.red : palette.accent;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const [stroke, width] of [[palette.paperB, 4], [palette.ink, 1.6]]) {
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(screen.x, screen.y);
    context.lineTo(screen.x, screen.y - 18);
    context.stroke();
  }
  // Each flag has its own shape as well as colour: a plain flag starts, a pennant marks a checkpoint and a
  // chequered flag finishes.
  context.beginPath();
  if (event === "race-checkpoint") {
    context.moveTo(screen.x, screen.y - 18);
    context.lineTo(screen.x + 11, screen.y - 14);
    context.lineTo(screen.x, screen.y - 10);
    context.closePath();
  } else context.rect(screen.x, screen.y - 18, 11, 7.5);
  context.fillStyle = colour;
  context.fill();
  if (event === "race-finish") {
    context.fillStyle = palette.paperB;
    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 2; row += 1) if ((column + row) % 2) context.fillRect(screen.x + column * 11 / 3, screen.y - 18 + row * 3.75, 11 / 3, 3.75);
    }
  }
  context.strokeStyle = palette.paperB;
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

// The wind recorded with a track position, pointing where it blew toward. A comparison's wind takes its colour.
export function drawTrackWind(screen, degrees, palette, colour = palette.wind) {
  // The same arrow as a wind mark: a line with its head where the wind blows, outlined in the paper colour so
  // it reads apart from the dashed track beneath it.
  const { start, end } = centredArrowEnds(screen, degrees, 24);
  context.save();
  context.translate(start.x, start.y);
  context.rotate(Math.atan2(end.y - start.y, end.x - start.x));
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const arrow = () => {
    context.beginPath();
    context.moveTo(0, 0); context.lineTo(length - 4, 0);
    context.stroke();
    context.beginPath(); context.moveTo(length, 0); context.lineTo(length - 9, -5); context.lineTo(length - 6, 0); context.lineTo(length - 9, 5); context.closePath();
  };
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = palette.paperB;
  context.lineWidth = 4;
  arrow(); context.stroke();
  context.strokeStyle = context.fillStyle = colour;
  context.lineWidth = 1.8;
  arrow(); context.fill();
  context.restore();
}

// Dead reckoning positions, each with a dashed line from where it was reckoned from. As on paper
// charts, a DR position is a half circle round its dot, and its circle shows how far off it may be.
function drawDrPositions(palette, chart, layers) {
  for (const position of shownItems(chart, "dr", layers)) {
    const selected = isSelected("dr", position.id);
    const colour = selected ? palette.select : palette.accent;
    const screen = worldToScreen(position);
    context.save();
    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    // A run across the chart's east or west edge is drawn the short way, off the edge.
    strokeDashed([worldToScreen(unwrapNear(position, position.from)), screen], [6, 4]);
    if (position.sigmaNm > 0) {
      const radius = position.sigmaNm / milesPerDegree * chart.view.zoom;
      if (radius >= 3) {
        context.beginPath();
        context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        context.fillStyle = palette.areaFill;
        context.fill();
        context.lineWidth = 1;
        strokeDashedCircle(screen, radius, [3, 4]);
      }
    }
    context.fillStyle = colour;
    context.lineWidth = selected ? 2.4 : 1.8;
    context.beginPath();
    context.arc(screen.x, screen.y, 6, Math.PI, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(screen.x, screen.y, 1.8, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (selected) selectionHalo(screen, palette);
    if (layers.labels && (selected || position.label)) labelText(position.label || ["DR", formatGameTime(position.t)].filter(Boolean).join(" · "), screen.x, screen.y + 10, palette);
  }
}

function drawAreas(palette, chart, layers) {
  context.save();
  for (const feature of shownItems(chart, "feature", layers)) {
    if (feature.rangeNm) drawAreaCircle(feature, feature.rangeNm, isSelected("feature", feature.id), palette);
  }
  context.restore();
}

export function drawAreaCircle(center, rangeNm, selected, palette) {
  const screen = worldToScreen(center);
  context.beginPath();
  context.arc(screen.x, screen.y, rangeNm / milesPerDegree * activeChart().view.zoom, 0, Math.PI * 2);
  context.fillStyle = palette.areaFill;
  context.fill();
  context.strokeStyle = selected ? palette.select : palette.accent;
  context.lineWidth = selected ? 2 : 1.4;
  strokeDashedCircle(screen, rangeNm / milesPerDegree * activeChart().view.zoom, [6, 4]);
}

function drawSearches(palette, chart, layers) {
  const searches = shownItems(chart, "search", layers);
  const namedLabels = searchNameLabelIds(searches);
  const groups = searchOverlapGroups(searches);
  const overlapping = new Set(groups.flatMap((group) => group.map((search) => search.id)));
  const anchors = searchIconAnchors(searches);
  // The shared island is whichever one the group's searches show, whoever carries the name.
  const sharedIslands = new Map(groups.flatMap((group) => {
    const island = group.map((search) => chartSearchIsland(search, layers)).find(Boolean) ?? null;
    return group.map((search) => [search.id, island]);
  }));
  for (const group of groups) drawSearchOverlap(group);
  for (const search of searches) {
    const selected = isSelected("search", search.id);
    drawSearchWedge(search, selected, palette, searchEvidenceOpacity(overlapping.has(search.id)), namedLabels.has(search.id) || selected, labelVisible("search", search.id), anchors.get(search.id), sharedIslands.get(search.id), layers.searchLines, layers);
  }
}

function traceSearchPath(search) {
  const { nearNm, farNm, fromDeg, toDeg } = searchExtent(search);
  const steps = Math.max(2, Math.ceil((toDeg - fromDeg) / 2));
  const arc = (nm, reverse) => Array.from({ length: steps + 1 }, (_, index) => {
    const degrees = reverse ? toDeg - (toDeg - fromDeg) * index / steps : fromDeg + (toDeg - fromDeg) * index / steps;
    return worldToScreen(destinationPoint(search, degrees, nm));
  });
  context.beginPath();
  [...arc(farNm, false), ...arc(nearNm, true)].forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
  context.closePath();
}

function drawSearchOverlap(group) {
  context.save();
  for (const search of group) {
    traceSearchPath(search);
    context.clip();
  }
  context.fillStyle = `rgba(${mapPalette().searchRgb},.34)`;
  const rectangle = canvas.getBoundingClientRect();
  context.fillRect(0, 0, rectangle.width, rectangle.height);
  context.restore();
}

// iconAt moves the island and name off the search's own centre, to where overlapping searches for the
// same place meet; null leaves them to the search that carries them.
export function drawSearchWedge(search, selected, palette, evidenceOpacity = .12, showName = true, showLabel = true, iconAt = undefined, sharedIsland = null, showLine = true, layers = viewLayers()) {
  const { nearNm, farNm, fromDeg, toDeg, centre } = searchExtent(search);
  const shared = iconAt !== undefined;
  const previewIsland = iconAt === null ? null : shared ? sharedIsland : chartSearchIsland(search, layers);
  const far = worldToScreen(destinationPoint(search, search.bearing, farNm));
  const origin = worldToScreen(search);
  const middle = worldToScreen(iconAt ?? centre);
  context.save();
  traceSearchPath(search);
  context.fillStyle = `rgba(${palette.searchRgb},${evidenceOpacity})`;
  context.fill();
  context.strokeStyle = selected ? palette.select : palette.bearing;
  context.lineWidth = selected ? 2 : 1.4;
  context.stroke();
  // The line from where the search was heard, ending at the point it was heard from.
  if (showLine) {
    context.lineWidth = 1;
    context.strokeStyle = palette.faded;
    strokeDashed([origin, far], [4, 6]);
    context.fillStyle = palette.bearing;
    // The point the search was heard from: a small dot that grows a little when zoomed in.
    context.beginPath(); context.arc(origin.x, origin.y, symbolSize("dot"), 0, Math.PI * 2); context.fill();
    if (selected) selectionHalo(origin, palette);
  }
  let previewHeight = 0;
  let previewScale = 1;
  if (previewIsland) {
    const nativeSpan = Math.max(1, islandPixelSpan(previewIsland));
    previewScale = clamp(28 / nativeSpan, 1, 8);
    previewHeight = (previewIsland.bounds.maxLat - previewIsland.bounds.minLat) * activeChart().view.zoom * previewScale;
    context.save();
    context.globalAlpha = .62;
    drawIslandSilhouette(iconAt ?? centre, previewIsland, false, palette, previewScale);
    context.restore();
  }
  let labelOffset = Math.max(14, previewHeight / 2 + 11);
  // The boats stay at their own search's centre, beside the island only when the island is there too.
  const boats = layers.boats ? boatRowAt(centre, shared ? null : previewIsland, previewScale, assignedBoats(search)) : [];
  for (const { boat, bounds } of boats) {
    drawBoatSilhouette(context, boat, bounds, {
      ...boatColours(palette, selected),
      lineWidth: selected ? 1.7 : 1.25,
      detail: "marker"
    });
    if (!iconAt) labelOffset = Math.max(labelOffset, worldToScreen(centre).y - (bounds.y - bounds.height / 2) + 8);
  }
  if (layers.labels && showLabel) {
    const label = searchChartLabel(search, showName) || `${formatDirection(search.bearing)} · ${formatNm(search.distanceNm)} nm`;
    labelPill(label, middle.x, middle.y - labelOffset, palette);
  }
  context.restore();
}

export function magnetRing(screen, palette) {
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 1.5;
  context.beginPath(); context.arc(screen.x, screen.y, 6, 0, Math.PI * 2); context.stroke();
  context.restore();
}

function drawWinds(palette, chart, layers) {
  for (const wind of chart.winds) drawWindIndicator(wind, isSelected("wind", wind.id), palette, layers.labels);
}

const WIND_ARROW_PX = 34;

export function drawWindIndicator(wind, selected, palette, showLabels = viewLayers().labels) {
  const length = symbolSize("wind");
  const size = length / WIND_ARROW_PX;
  const { start, end } = windArrowEnds(wind);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.save();
  context.strokeStyle = selected ? palette.select : palette.track;
  context.fillStyle = selected ? palette.select : palette.track;
  context.lineWidth = (selected ? 2.5 : 2) * Math.max(size, 0.6);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.translate(end.x, end.y);
  context.rotate(angle);
  context.scale(Math.max(size, 0.5), Math.max(size, 0.5));
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-9, -5);
  context.lineTo(-6, 0);
  context.lineTo(-9, 5);
  context.closePath();
  context.fill();
  context.restore();
  const centre = worldToScreen(wind);
  if (selected) selectionHalo(centre, palette);
  if (showLabels && wind.label && labelVisible("wind", wind.id)) labelText(wind.label, centre.x, centre.y + 12, palette);
}

// The measure line and its drawing preview show distance, bearing and passage time.
export function drawMeasureLine(from, to, selected, palette) {
  const a = worldToScreen(from);
  const b = worldToScreen(to);
  context.save();
  context.strokeStyle = palette.paperB;
  context.lineWidth = selected ? 5 : 4;
  context.globalAlpha = .55;
  drawLine(a, b);
  context.globalAlpha = 1;
  context.strokeStyle = palette.select;
  context.lineWidth = selected ? 2.5 : 1.75;
  strokeDashed([a, b], [7, 5]);
  for (const end of [a, b]) {
    context.fillStyle = palette.paperA;
    context.beginPath(); context.arc(end.x, end.y, selected ? 5 : 4, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  context.restore();
  lineLabel(from, to, palette);
}

function lineLabel(from, to, palette) {
  const a = worldToScreen(from);
  const b = worldToScreen(to);
  const speed = activeChart().measureSpeedKn;
  const nm = distanceNm(from, to);
  const text = `${formatNm(nm)} nm · ${formatBearing(bearingDegrees(from, to))} · ${formatDuration(nm / speed)} at ${speed} kn`;
  // The label sits beside the middle of the line, on its upper side, far enough out to clear it at any angle.
  context.save();
  context.font = PILL_FONT;
  const halfWidth = context.measureText(text).width / 2 + 6;
  context.restore();
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
  if (normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const offset = Math.abs(normal.x) * halfWidth + Math.abs(normal.y) * 9 + 6;
  labelPill(text, (a.x + b.x) / 2 + normal.x * offset, (a.y + b.y) / 2 + normal.y * offset, palette);
}

// Saved routes sit back at reduced opacity until the route or one of its waypoints is selected.
function drawSavedRoutes(palette, chart, layers) {
  for (const route of shownItems(chart, "saved-route", layers)) {
    const routeSelected = isSelected("saved-route", route.id);
    const active = routeSelected || route.points.some((point) => isSelected("saved-point", point.id));
    context.save();
    context.globalAlpha = active ? .95 : .55;
    context.strokeStyle = routeSelected ? palette.select : palette.route;
    context.fillStyle = palette.route;
    context.lineWidth = routeSelected ? 2.5 : 2;
    context.lineJoin = "round";
    const { legs } = summarizeRoute(route.points, activeChart().circumnavigation);
    drawRouteLine(legs);
    legs.forEach((leg, index) => {
      if (active) drawLegArrow(leg, palette.route);
      if (active && layers.routeDistances && labelVisible("saved-leg", `${route.id}:${index}`)) {
        const mid = worldToScreen(leg.mid);
        labelPill(`${formatNm(leg.nm)} nm · ${Math.round(leg.bearing)}°`, mid.x, mid.y - 12, palette);
      }
    });
    for (const point of route.points) {
      const screen = worldToScreen(point);
      if (isSelected("saved-point", point.id)) selectionHalo(screen, palette);
      context.beginPath();
      context.arc(screen.x, screen.y, symbolSize("dot"), 0, Math.PI * 2);
      context.fill();
      if (point.name && layers.labels && labelVisible("saved-point", point.id)) labelText(point.name, screen.x, screen.y + 10, palette);
    }
    context.restore();
  }
}

function drawRoute(palette, chart, layers) {
  const route = shownItems(chart, "route", layers);
  if (!route.length) return;
  context.save();
  context.strokeStyle = palette.route;
  context.fillStyle = palette.route;
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  const summary = summarizeRoute(route, activeChart().circumnavigation);
  drawRouteLine(summary.legs);
  context.font = "bold 10px ui-sans-serif, system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  summary.legs.forEach((leg, index) => {
    drawLegArrow(leg, palette.route);
    if (layers.routeDistances && labelVisible("route-leg", index)) {
      const mid = worldToScreen(leg.mid);
      labelPill(`${formatNm(leg.nm)} nm · ${Math.round(leg.bearing)}°`, mid.x, mid.y - 12, palette);
    }
  });
  route.forEach((point, index) => {
    const screen = worldToScreen(point);
    const selected = isSelected("route", point.id);
    if (selected) selectionHalo(screen, palette);
    context.fillStyle = palette.paperA;
    context.strokeStyle = palette.route;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(screen.x, screen.y, symbolSize("waypoint"), 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = palette.ink;
    // The waypoint number only fits once the waypoint is near full size.
    if (symbolSize("waypoint") >= 4.5) {
      context.font = "bold 8px ui-sans-serif, system-ui";
      context.fillText(String(index + 1), screen.x, screen.y + .5);
    }
    if (point.name && layers.labels && labelVisible("route", point.id)) labelText(point.name, screen.x, screen.y + 12, palette);
  });
  context.restore();
}

// The map islands on show: the game's own map, and the chart's imported Scrambled Seas world.
function vanillaIslands(chart, layers) {
  const discoveryOutlines = layers.vanillaMap && layers.locations && layers.islands && layers.locationIslands ? new Set() : null;
  if (discoveryOutlines) {
    for (const feature of chart.features) {
      if (!feature.discovery || feature.rangeNm > 0) continue;
      const island = chartIsland(feature, layers);
      if (island?.sourceCenter?.lat === feature.lat && island.sourceCenter.lon === feature.lon) discoveryOutlines.add(island.id);
    }
  }
  // The interactive location already draws this outline at the vanilla position.
  return [...(layers.vanillaMap ? VANILLA_MAP : []), ...(layers.importedMap ? importedMapIslands(chart) : [])]
    .filter(({ island, item }) => (item || !discoveryOutlines?.has(island.id)) && (layers.secretIslands || !island.secret));
}

// The game's own map, drawn faintly beneath the player's chart. It cannot be selected or edited.
function drawVanillaMap(width, height, palette, chart, layers) {
  context.save();
  context.globalAlpha = 0.55;
  for (const { island, centre, item } of vanillaIslands(chart, layers)) {
    const screen = worldToScreen(centre);
    const selected = item ? isSelected("map-island", item.id) : false;
    if (selected) context.globalAlpha = 1;
    drawIslandSilhouette(centre, island, selected, palette);
    context.globalAlpha = 0.55;
    if (islandPixelSpan(island) < MIN_VISIBLE_ISLAND_PX) {
      context.fillStyle = palette.islandDot;
      context.beginPath();
      context.arc(screen.x, screen.y, symbolSize("mark"), 0, Math.PI * 2);
      context.fill();
    }
    if (layers.labels && labelVisible(item ? "imported" : "vanilla", island.id)) labelText(island.name, screen.x, screen.y + 13, palette);
  }
  context.restore();
}

const TRADE_WIND_SPACING_PX = 56;
const TRADE_WIND_ARROW_PX = 22;

function drawTradeWinds(width, height, palette, borderExpander) {
  // One arrow per degree close in; further out the arrows thin to keep their spacing on screen.
  const step = [1, 2, 5, 10, 20].find((degrees) => degrees * activeChart().view.zoom >= TRADE_WIND_SPACING_PX) ?? 30;
  const northwest = screenToWorld(0, 0);
  const southeast = screenToWorld(width, height);
  const first = (value) => Math.floor(value / step) * step + step / 2;
  const latitudes = [];
  for (let lat = first(southeast.lat); lat <= northwest.lat && lat < 90; lat += step) latitudes.push(lat);
  // The Al'Ankh and Emerald winds blow in bands only two and three degrees tall. Once the rows are
  // further apart than that, the bands get a row of their own so they never drop off the chart.
  const rows = step > 2 ? [...latitudes.filter((lat) => lat < 30 || lat > 33), 31] : latitudes;
  const colours = { aestrin: palette.bearing, alankh: palette.accent, emerald: palette.track, southEasterly: palette.route, southWesterly: palette.lines.blue };
  context.lineWidth = 1.5;
  for (let lon = first(northwest.lon); lon <= southeast.lon; lon += step) {
    for (const lat of rows) {
      const wind = tradeWindAt(lat, lon, borderExpander);
      if (!wind) continue;
      context.strokeStyle = colours[wind.zone];
      context.fillStyle = colours[wind.zone];
      const centre = worldToScreen({ lat, lon });
      const half = TRADE_WIND_ARROW_PX / 2;
      context.save();
      context.translate(centre.x, centre.y);
      context.rotate(Math.atan2(-wind.north, wind.east));
      context.beginPath();
      context.moveTo(-half, 0);
      context.lineTo(half, 0);
      context.stroke();
      context.beginPath();
      context.moveTo(half, 0);
      context.lineTo(half - 7, -4);
      context.lineTo(half - 7, 4);
      context.closePath();
      context.fill();
      context.restore();
    }
  }
}

function drawFeatures(palette, chart, layers) {
  for (const feature of shownItems(chart, "feature", layers)) {
    const screen = worldToScreen(feature);
    const selected = isSelected("feature", feature.id);
    const island = chartIsland(feature, layers);
    context.save();
    // The outline is the location's mark.
    if (island) {
      drawIslandSilhouette(feature, island, selected, palette);
    } else if (feature.icon && !feature.rangeNm) {
      drawLocationIcon(context, feature.icon, screen.x, screen.y, locationIconRadius() * iconScale(feature, workspace.settings.iconSize), palette, selected);
    } else {
      if (selected) selectionHalo(screen, palette);
      context.strokeStyle = palette.accent;
      context.fillStyle = palette.paperA;
      const markRadius = feature.rangeNm ? 4 : symbolSize("mark") * iconScale(feature, workspace.settings.iconSize);
      context.lineWidth = (selected ? 2.5 : 1.8) * Math.min(1, markRadius / 5);
      context.beginPath();
      context.arc(screen.x, screen.y, markRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    for (const { boat, bounds } of layers.boats ? featureBoats(feature, layers) : []) {
      // Outlines thicken as a boat grows with its island, so a large boat still reads clearly.
      const weight = clamp(bounds.width / boatMarkerSize(boat).width, 1, 3);
      drawBoatSilhouette(context, boat, bounds, {
        ...boatColours(palette, selected),
        lineWidth: (selected ? 1.7 : 1.25) * weight,
        detail: "marker"
      });
    }
    if (layers.labels && labelVisible("feature", feature.id)) labelText(feature.name, screen.x, screen.y + (feature.icon && !feature.rangeNm ? locationIconRadius() * iconScale(feature, workspace.settings.iconSize) * 1.6 + 4 : 9 + symbolSize("mark") * iconScale(feature, workspace.settings.iconSize)), palette);
    context.restore();
  }
}

// Encounter icons stay big enough to read far out and grow a little closer in.
function locationIconRadius() {
  return clamp(symbolSize("mark") * 1.6, 7, 11);
}

export function drawIslandSilhouette(feature, island, selected, palette, scale = 1) {
  const fills = palette.islandFills;
  context.save();
  for (const shape of island.shapes) {
    context.beginPath();
    for (const ring of shape.rings) {
      for (let index = 0; index < ring.length; index += 2) {
        const point = worldToScreen({ lat: feature.lat + ring[index + 1] * scale, lon: feature.lon + ring[index] * scale });
        if (index) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
      }
      context.closePath();
    }
    context.fillStyle = fills[shape.kind] ?? fills[0];
    context.fill("evenodd");
    context.strokeStyle = selected ? palette.select : shape.kind === 1 ? palette.route : palette.faded;
    context.lineWidth = selected ? 2 : 1;
    context.stroke();
  }
  if (selected) selectionHalo(worldToScreen(feature), palette);
  context.restore();
}

function drawCompassRose(x, y, palette) {
  context.save();
  context.translate(x, y);
  context.strokeStyle = palette.faded;
  context.fillStyle = palette.faded;
  context.lineWidth = 1;
  context.beginPath(); context.arc(0, 0, 24, 0, Math.PI * 2); context.stroke();
  for (let index = 0; index < 8; index += 1) {
    context.rotate(Math.PI / 4);
    context.beginPath(); context.moveTo(0, -19); context.lineTo(0, -24); context.stroke();
  }
  context.beginPath(); context.moveTo(0, -20); context.lineTo(5, 6); context.lineTo(0, 3); context.lineTo(-5, 6); context.closePath(); context.fill();
  context.font = "bold 9px Georgia, serif"; context.textAlign = "center"; context.fillText("N", 0, -30);
  context.restore();
}

// A route's line. On a circumnavigation chart a leg across the edge leaves on one side and comes back
// on the other.
function drawRouteLine(legs) {
  if (!legs.length) return;
  context.beginPath();
  for (const leg of legs) {
    legPieces(leg).forEach(([a, b], piece) => {
      const start = worldToScreen(a);
      const end = worldToScreen(b);
      if (piece || leg.index === 1) context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
    });
  }
  context.stroke();
}

// The arrow sits on whichever stretch of the leg holds its middle.
function drawLegArrow(leg, color) {
  const pieces = legPieces(leg);
  const [a, b] = pieces.find(([from, to]) => leg.mid.lon >= Math.min(from.lon, to.lon) && leg.mid.lon <= Math.max(from.lon, to.lon)) ?? pieces[0];
  drawArrow(worldToScreen(a), worldToScreen(b), color);
}

// A dash costs the browser for every pixel of its line, on screen or off, and deep in the chart lines
// run for millions of pixels. So dashed lines are stroked only where they cross the canvas, each part
// starting its pattern where the whole line's pattern would be, so the dashes hold still as you pan.
const DASH_MARGIN_PX = 16;

function strokeDashed(points, dash) {
  const { width, height } = canvas.getBoundingClientRect();
  context.save();
  context.setLineDash(dash);
  let along = 0;
  // Segments wholly on screen continue one stroke, which carries the pattern on by itself.
  let open = false;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const span = visibleSpan(a, b, width, height);
    if (span && !(open && span[0] === 0)) {
      if (open) context.stroke();
      const [x, y] = [a.x + (b.x - a.x) * span[0], a.y + (b.y - a.y) * span[0]];
      context.lineDashOffset = along + span[0] * length;
      context.beginPath();
      context.moveTo(x, y);
    }
    if (span) context.lineTo(a.x + (b.x - a.x) * span[1], a.y + (b.y - a.y) * span[1]);
    if (open && !span) context.stroke();
    open = Boolean(span) && span[1] === 1;
    if (span && !open) context.stroke();
    along += length;
  }
  if (open) context.stroke();
  context.restore();
}

// The part of a segment inside the canvas and its margin, as fractions along it, or null.
function visibleSpan(a, b, width, height) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let start = 0;
  let end = 1;
  for (const [p, q] of [[-dx, a.x + DASH_MARGIN_PX], [dx, width + DASH_MARGIN_PX - a.x], [-dy, a.y + DASH_MARGIN_PX], [dy, height + DASH_MARGIN_PX - a.y]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [start, end];
}

// A dashed circle, of which only the arc crossing the canvas is stroked once the circle is large.
function strokeDashedCircle(centre, radius, dash) {
  const { width, height } = canvas.getBoundingClientRect();
  const reach = Math.hypot(width, height) / 2 + DASH_MARGIN_PX;
  const view = { x: width / 2, y: height / 2 };
  const distance = Math.hypot(view.x - centre.x, view.y - centre.y);
  let from = 0;
  let to = Math.PI * 2;
  if (radius > reach) {
    // The canvas lies wholly inside or outside the circle, so none of its edge shows.
    if (distance <= radius - reach || distance >= radius + reach) return;
    // The arc within reach of the canvas centre lies either side of the direction toward it.
    const cosine = (radius * radius + distance * distance - reach * reach) / (2 * radius * distance);
    const half = Math.acos(Math.max(-1, Math.min(1, cosine)));
    const toward = Math.atan2(view.y - centre.y, view.x - centre.x);
    from = ((toward - half) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    to = from + half * 2;
  }
  context.save();
  context.setLineDash(dash);
  context.lineDashOffset = from * radius;
  context.beginPath();
  context.arc(centre.x, centre.y, radius, from, to);
  context.stroke();
  context.restore();
}

export function drawLine(a, b) {
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
}

function drawArrow(from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 42) return;
  const x = (from.x + to.x) / 2;
  const y = (from.y + to.y) / 2;
  const angle = Math.atan2(dy, dx);
  context.save(); context.translate(x, y); context.rotate(angle); context.fillStyle = color;
  context.beginPath(); context.moveTo(7, 0); context.lineTo(-4, -4); context.lineTo(-2, 0); context.lineTo(-4, 4); context.closePath(); context.fill(); context.restore();
}

function selectionHalo(screen, palette) {
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 2;
  context.setLineDash([2, 3]);
  context.beginPath(); context.arc(screen.x, screen.y, 12, 0, Math.PI * 2); context.stroke();
  context.restore();
}

const LABEL_FONT = "600 11.5px ui-sans-serif, system-ui";

function labelText(text, x, y, palette) {
  context.save();
  context.font = LABEL_FONT;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineWidth = 3;
  context.strokeStyle = palette.paperB;
  context.strokeText(text, x, y);
  context.fillStyle = palette.ink;
  context.fillText(text, x, y);
  context.restore();
}

const PILL_FONT = "bold 11px ui-sans-serif, system-ui";

export function labelPill(text, x, y, palette) {
  context.save();
  context.font = PILL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(text).width + 12;
  context.fillStyle = palette.paperB;
  context.strokeStyle = palette.grid;
  roundedRect(x - width / 2, y - 9, width, 18, 6);
  context.fill(); context.stroke();
  context.fillStyle = palette.ink;
  context.fillText(text, x, y + .5);
  context.restore();
}

function roundedRect(x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function updateZoomLabel() {
  const nmPerHundredPixels = 100 / activeChart().view.zoom * milesPerDegree;
  const digits = nmPerHundredPixels >= 10 ? 0 : nmPerHundredPixels >= 1 ? 1 : 2;
  elements["zoom-label"].textContent = `${nmPerHundredPixels.toFixed(digits)} nm / 100 px`;
}

export function fitData() {
  const chart = activeChart();
  const layers = viewLayers(chart);
  // Only what the chart shows; hidden layers stay out of the fit.
  const points = [...shownItems(chart, "route", layers), ...shownItems(chart, "saved-point", layers), ...shownItems(chart, "track", layers), ...shownItems(chart, "dr", layers),
    ...shownItems(chart, "measure", layers).flatMap((measure) => [measure, measure.end]), ...shownItems(chart, "wind", layers), ...shownItems(chart, "line", layers).flatMap((line) => [line, line.end])];
  // A Scrambled Seas world's map counts while it is shown, so the whole world fits on screen.
  for (const { centre, item } of vanillaIslands(chart, layers)) if (item) points.push(centre);
  for (const feature of shownItems(chart, "feature", layers)) {
    points.push(feature);
    if (feature.rangeNm) points.push(...[0, 90, 180, 270].map((bearing) => destinationPoint(feature, bearing, feature.rangeNm)));
    const island = chartIsland(feature, layers);
    if (island) {
      const bounds = islandWorldBounds(island, feature);
      points.push({ lat: bounds.minLat, lon: bounds.minLon }, { lat: bounds.maxLat, lon: bounds.maxLon });
    }
  }
  for (const search of shownItems(chart, "search", layers)) {
    const extent = searchExtent(search);
    // Without its search line, a search is just its area, from the near edge out.
    const edges = layers.searchLines ? [extent.farNm] : [extent.nearNm, extent.farNm];
    if (layers.searchLines) points.push(search);
    for (const nm of edges) points.push(...[extent.fromDeg, search.bearing, extent.toDeg].map((bearing) => destinationPoint(search, bearing, nm)));
  }
  if (!points.length) {
    activeChart().view = { lat: 10, lon: 0, zoom: 5 };
    persist(); drawChart(); return;
  }
  fitPoints(points);
}

// Loops rather than Math.min(...list): a long track has more positions than a call takes arguments.
export function fitPoints(points) {
  const bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
  for (const point of points) {
    bounds.minLat = Math.min(bounds.minLat, point.lat);
    bounds.maxLat = Math.max(bounds.maxLat, point.lat);
    bounds.minLon = Math.min(bounds.minLon, point.lon);
    bounds.maxLon = Math.max(bounds.maxLon, point.lon);
  }
  const rectangle = canvas.getBoundingClientRect();
  const width = Math.max(.5, bounds.maxLon - bounds.minLon);
  const height = Math.max(.5, bounds.maxLat - bounds.minLat);
  activeChart().view = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
    zoom: clamp(Math.min((rectangle.width - 100) / width, (rectangle.height - 100) / height), MIN_ZOOM, MAX_ZOOM)
  };
  persist(); drawChart();
}

export function centerOn(point) {
  activeChart().view.lat = point.lat;
  activeChart().view.lon = point.lon;
  activeChart().view.zoom = Math.max(activeChart().view.zoom, 12);
  persist(); drawChart();
}
