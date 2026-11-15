// Recorded positions as continuous stretches. A stretch breaks where the record cannot be one voyage:
// a Voyage Recorder session (a load or new game), a switch between Coordinate Viewer and Voyage Recorder, time running backwards (a reloaded save, or a new game in the same save slot), a jump no boat could
// sail (recovery or teleporting), or a gap of more than a day. Crossing the chart's east and west edges
// does not break it; distances there take the short way round. Also the figures for selected positions
// and the route they make.
import { NM_PER_DEGREE, bearingDegrees, createRoutePoint } from "./model.mjs";

// Faster than any boat sails, so only a jump exceeds it.
const MAX_PLAUSIBLE_KN = 40;
const MAX_GAP_HOURS = 24;
// Positions this close together never break, whatever the clock says.
const NEAR_NM = 2;
// Without times, a jump this long is taken as a break.
const UNTIMED_JUMP_NM = 60;

export function wrappedLonDelta(delta) {
  return ((delta + 180) % 360 + 360) % 360 - 180;
}

// The second point's longitude moved next to the first, across the chart's edge when that is shorter.
export function unwrapNear(reference, point) {
  return { lat: point.lat, lon: reference.lon + wrappedLonDelta(point.lon - reference.lon) };
}

// A stretch's points with longitudes unwrapped one after another, so a crossing of the chart's edge
// stays one line. Each keeps the position it came from as source.
export function unwrapStretch(segment) {
  const line = [];
  for (const point of segment) {
    const previous = line.at(-1);
    line.push({ ...(previous ? unwrapNear(previous, point) : { lat: point.lat, lon: point.lon }), source: point });
  }
  return line;
}

function trackLegNm(a, b) {
  return Math.hypot(wrappedLonDelta(b.lon - a.lon), b.lat - a.lat) * NM_PER_DEGREE;
}

export function trackBearing(a, b) {
  return bearingDegrees(a, unwrapNear(a, b));
}

export function hasTime(point) {
  return Number.isFinite(point?.t);
}

function isBreak(previous, point) {
  if (!previous || point.newSession || point.source !== previous.source) return true;
  const nm = trackLegNm(previous, point);
  if (!hasTime(previous) || !hasTime(point)) return nm > UNTIMED_JUMP_NM;
  const hours = point.t - previous.t;
  if (hours < 0 || hours > MAX_GAP_HOURS) return true;
  if (nm <= NEAR_NM) return false;
  return hours === 0 || nm / hours > MAX_PLAUSIBLE_KN;
}

// The track split into its stretches, each an array of points in recorded order.
export function trackSegments(points) {
  const segments = [];
  let current = null;
  let previous = null;
  for (const point of points) {
    if (isBreak(previous, point)) {
      current = [];
      segments.push(current);
    }
    current.push(point);
    previous = point;
  }
  return segments;
}

// Each consecutive pair within a stretch, with its distance and the game hours between, when known.
function* trackLegs(points) {
  let previous = null;
  for (const point of points) {
    if (previous && !isBreak(previous, point)) {
      const hours = hasTime(previous) && hasTime(point) ? point.t - previous.t : null;
      yield { from: previous, to: point, nm: trackLegNm(previous, point), hours };
    }
    previous = point;
  }
}

// Distance sailed and time under way. Only consecutive positions in one stretch count, so reloads and
// jumps add nothing. Average speed uses only the legs whose time is known.
export function sailedStats(points) {
  let distanceNm = 0;
  let timedNm = 0;
  let movingHours = 0;
  for (const leg of trackLegs(points)) {
    distanceNm += leg.nm;
    if (leg.hours !== null) {
      timedNm += leg.nm;
      movingHours += leg.hours;
    }
  }
  return { distanceNm, movingHours, averageKn: movingHours > 0 ? timedNm / movingHours : null };
}

function distanceToSegmentNm(point, a, b) {
  const p = unwrapNear(a, point);
  const d = { x: b.lon - a.lon, y: b.lat - a.lat };
  const length = d.x * d.x + d.y * d.y;
  const t = length ? Math.min(1, Math.max(0, ((p.lon - a.lon) * d.x + (p.lat - a.lat) * d.y) / length)) : 0;
  return Math.hypot(p.lon - (a.lon + d.x * t), p.lat - (a.lat + d.y * t)) * NM_PER_DEGREE;
}

// Fewer points that stay within the tolerance of the track (Douglas-Peucker), stretch by stretch.
export function simplifyTrack(points, toleranceNm) {
  return trackSegments(points).flatMap((segment) => {
    const unwrapped = unwrapStretch(segment);
    const keep = new Uint8Array(unwrapped.length);
    keep[0] = keep[unwrapped.length - 1] = 1;
    const stack = [[0, unwrapped.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let worst = -1;
      let worstNm = toleranceNm;
      for (let index = first + 1; index < last; index += 1) {
        const nm = distanceToSegmentNm(unwrapped[index], unwrapped[first], unwrapped[last]);
        if (nm > worstNm) { worst = index; worstNm = nm; }
      }
      if (worst >= 0) {
        keep[worst] = 1;
        stack.push([first, worst], [worst, last]);
      }
    }
    return unwrapped.filter((_, index) => keep[index]).map((point) => point.source);
  });
}

// Sailed positions as waypoints for a saved route.
export function trackToRoutePoints(points, toleranceNm) {
  return simplifyTrack(points, toleranceNm).map((point) => createRoutePoint({ lat: point.lat, lon: point.lon, day: point.day, time: point.time }));
}

// Where a recording picks up on a chart: the positions after the chart's last one from the same kind of
// recording, matched by place and game time. Without a match the whole recording is new to the chart.
export function joinRecording(track, points) {
  const source = points[0]?.source ?? "";
  const last = track.findLast((point) => (point.source ?? "") === source);
  const index = last ? points.findLastIndex((point) => samePosition(point, last)) : -1;
  return { fresh: index >= 0 ? points.slice(index + 1) : points, matched: index >= 0 };
}

function samePosition(a, b) {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7 && (hasTime(a) ? hasTime(b) && Math.abs(a.t - b.t) < 1e-6 : !hasTime(b));
}
