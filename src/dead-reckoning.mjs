// Dead reckoning on Sailwind's flat chart: where the boat is after sailing a compass course at a chip
// log speed for so many hours, how far off that may be, and which position on the chart is the latest.
import { destinationPoint } from "./model.mjs";
import { hasTime, wrappedLonDelta } from "./track.mjs";

export function deadReckon(origin, course, speedKn, hours) {
  const nm = Math.max(0, speedKn) * Math.max(0, hours);
  const end = destinationPoint(origin, course, nm);
  // A run across the chart's east or west edge comes back in from the other side.
  return { lat: end.lat, lon: wrappedLonDelta(end.lon), nm };
}

// The possible error grows by a share of every mile sailed since the last known position: at 10%, a
// position 20 nm on may be 2 nm out, on top of any error the starting position already had.
export function drSigma(originSigma, percent, nm) {
  return Math.max(0, Number(originSigma) || 0) + Math.max(0, percent) / 100 * nm;
}

// The newest position on the chart, from Coordinate Viewer or dead reckoning. Among DR positions the
// last plotted wins unless both have a game time and the earlier one is later. Between the two sources,
// when both have a time the later wins; otherwise the DR position wins unless Coordinate Viewer is being
// followed live.
export function latestPosition(chart, { followingLive = false } = {}) {
  const recorded = chart.track.at(-1) ?? null;
  let reckoned = null;
  for (const position of chart.drPositions) {
    if (!reckoned || !hasTime(position) || !hasTime(reckoned) || position.t >= reckoned.t) reckoned = position;
  }
  const fromTrack = recorded && { lat: recorded.lat, lon: recorded.lon, t: hasTime(recorded) ? recorded.t : null, sigmaNm: 0, ref: { kind: "track", id: recorded.id } };
  const fromDr = reckoned && { lat: reckoned.lat, lon: reckoned.lon, t: hasTime(reckoned) ? reckoned.t : null, sigmaNm: reckoned.sigmaNm, ref: { kind: "dr", id: reckoned.id } };
  if (!fromTrack || !fromDr) return fromTrack ?? fromDr ?? null;
  if (fromTrack.t !== null && fromDr.t !== null) return fromDr.t > fromTrack.t ? fromDr : fromTrack;
  return followingLive ? fromTrack : fromDr;
}

export function positionLabel(position) {
  return position.ref.kind === "track" ? "recorded position" : "DR position";
}
