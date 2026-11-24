// Copied from Chartroom Voyages lib/race.mjs with imports renamed. Change it there and copy it here again, so a
// race checked in Chartroom is checked the same way on the site.
// Checks a voyage against a course and times the run. A checkpoint is an island (reached by a port arrival on
// it, or by any reading within its reach) or an open-water mark (a reading within its radius). Recording gaps,
// saves and loads are fine: only the order of what was reached counts. Casual, not anti-cheat.
import { islandById } from "./site-islands.mjs";

export const NM_PER_DEGREE = 140;
// Always allowed under "no other mods": Voyage Recorder writes the file, Configuration Manager only shows settings.
export const ALWAYS_ALLOWED = Object.freeze(["com.skeptic043.sailwind.voyagerecorder", "com.bepis.bepinex.configurationmanager"]);

const key = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// A checkpoint as a place: { name, lat, lon, reachDeg, number, island, radiusNm }.
export function place(target) {
  if (target?.island) {
    const island = islandById(target.island);
    if (!island) throw new Error(`Unknown island ${target.island}.`);
    return { name: island.name, lat: island.lat, lon: island.lon, reachDeg: island.reachDeg, number: island.number, island: true, radiusNm: null };
  }
  return { name: String(target.name ?? "Mark"), lat: target.lat, lon: target.lon, reachDeg: target.radiusNm / NM_PER_DEGREE, number: null, island: false, radiusNm: target.radiusNm };
}

const MAX_SEGMENT_DEG = 0.5;

function inside(point, where) {
  return Math.hypot(point.lat - where.lat, point.lon - where.lon) <= where.reachDeg;
}

// When two consecutive logged positions are both outside a checkpoint, checks whether the straight
// sailing leg between them crossed through it (ignoring long recording gaps). Returns { enter, leave }
// fractions in (0, 1), or null.
function segmentCrossing(a, b, where) {
  const dx = b.lat - a.lat;
  const dy = b.lon - a.lon;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0 || lenSq > MAX_SEGMENT_DEG * MAX_SEGMENT_DEG) return null;
  const fx = a.lat - where.lat;
  const fy = a.lon - where.lon;
  const halfB = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - where.reachDeg * where.reachDeg;
  const disc = halfB * halfB - lenSq * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const enter = (-halfB - root) / lenSq;
  const leave = (-halfB + root) / lenSq;
  if (leave <= 0 || enter >= 1) return null;
  return { enter: Math.max(0, enter), leave: Math.min(1, leave) };
}

function interpolateTime(a, b, u) {
  const t = a.t + (b.t - a.t) * u;
  const utc = Number.isFinite(a.utc) && Number.isFinite(b.utc)
    ? Math.round(a.utc + (b.utc - a.utc) * u)
    : (b.utc ?? a.utc ?? null);
  return { t, utc };
}

function everEntered(voyage, where) {
  if (voyage.visits.some((visit) => (visit.kind === "arrive" || visit.kind === "depart") && visitMatches(visit, where))) return true;
  let previous = null;
  for (const point of voyage.points) {
    if (inside(point, where)) return true;
    if (previous && segmentCrossing(previous, point, where)) return true;
    previous = point;
  }
  return false;
}

function unreachedStartReason(voyage, places) {
  if (places.start) {
    const where = places.start;
    if (everEntered(voyage, where)) {
      return where.island
        ? `The run reaches ${where.name}, but never leaves it.`
        : `The run enters the ${where.name} mark (${where.radiusNm} nm), but never leaves it.`;
    }
    return where.island
      ? `The run never reaches ${where.name}.`
      : `The run never comes within ${where.radiusNm} nm of the ${where.name} mark.`;
  }
  if (places.checkpoints.some((where) => everEntered(voyage, where))) {
    return "The run reaches a checkpoint, but never leaves any of the race's ports or marks.";
  }
  return "The run never reaches any of the race's checkpoints.";
}

// Port lines only count for islands; an open-water mark is reached only by being there, whatever it's called.
function visitMatches(visit, where) {
  if (!where.island) return false;
  return (where.number !== null && visit.island === where.number) || key(visit.port) === key(where.name);
}

// Times the voyage reached a place: each port arrival there, each reading that comes within reach after
// being outside it, and any short sailing leg between two outside readings that crosses through it.
export function reaches(voyage, where) {
  const times = voyage.visits.filter((visit) => visit.kind === "arrive" && visitMatches(visit, where)).map((visit) => ({ t: visit.t, utc: visit.utc ?? null }));
  let wasInside = false;
  let previous = null;
  for (const point of voyage.points) {
    const now = inside(point, where);
    if (now && !wasInside) {
      times.push({ t: point.t, utc: point.utc ?? null });
    } else if (!now && !wasInside && previous) {
      const hit = segmentCrossing(previous, point, where);
      if (hit) times.push(interpolateTime(previous, point, hit.enter));
    }
    wasInside = now;
    previous = point;
  }
  return times.sort((a, b) => a.t - b.t);
}

// Times the voyage left a place: each departure line, each reading outside reach after being inside it,
// and the exit point of any short sailing leg that crosses straight through it.
export function departures(voyage, where) {
  const times = voyage.visits.filter((visit) => visit.kind === "depart" && visitMatches(visit, where)).map((visit) => ({ t: visit.t, utc: visit.utc ?? null }));
  let wasInside = false;
  let previous = null;
  for (const point of voyage.points) {
    const now = inside(point, where);
    if (!now && wasInside) {
      times.push({ t: point.t, utc: point.utc ?? null });
    } else if (!now && !wasInside && previous) {
      const hit = segmentCrossing(previous, point, where);
      if (hit) times.push(interpolateTime(previous, point, hit.leave));
    }
    wasInside = now;
    previous = point;
  }
  // A departure line and the first reading outside describe the same leaving; keep the earliest of a pair.
  return times.sort((a, b) => a.t - b.t).filter((time, index, all) => index === 0 || time.t - all[index - 1].t > 0.25);
}

// The course's places: { start, checkpoints, finish } with finish null for "the last checkpoint reached".
function coursePlaces(course) {
  return {
    start: course.start?.island || course.start?.lat !== undefined ? place(course.start) : null,
    checkpoints: course.checkpoints.map(place),
    finish: course.finish?.island || course.finish?.lat !== undefined ? place(course.finish) : null
  };
}

// The fastest valid run of the course in the voyage, or { ok: false, reason }. A run from an older recording
// that lacks what a rule needs isn't turned away: it's accepted with notes saying what wasn't recorded.
export function checkRun(course, voyage) {
  const edited = editedRecording(voyage);
  if (edited) return { ok: false, reason: edited };
  const ruleProblem = checkMods(course.rules?.mods, voyage.plugins);
  if (ruleProblem) return { ok: false, reason: ruleProblem };
  const notes = !voyage.plugins && course.rules?.mods && course.rules.mods.mode !== "any" ? ["mods-not-recorded"] : [];
  const places = coursePlaces(course);
  // With no fixed start, the run starts by leaving any checkpoint, which then counts as reached.
  const starts = places.start
    ? departures(voyage, places.start).map((time) => ({ time, from: -1 }))
    : places.checkpoints.flatMap((where, index) => departures(voyage, where).map((time) => ({ time, from: index })));
  if (!starts.length) return { ok: false, reason: unreachedStartReason(voyage, places) };
  const reached = places.checkpoints.map((where) => reaches(voyage, where));
  const finishes = places.finish ? reaches(voyage, places.finish) : null;
  const irl = course.rules?.sortBy === "irl";
  let best = null;
  // On a real-time board, the fastest run by game time among runs without a real time, used only when none has one.
  let untimed = null;
  let firstReason = "";
  for (const start of starts.sort((a, b) => a.time.t - b.time.t)) {
    const attempt = runFrom(course, places, start, reached, finishes);
    // The reason given is the one from the earliest start, which is the run the player most likely meant.
    if (!attempt.ok) {
      firstReason ||= attempt.reason;
      continue;
    }
    const checked = checkConduct(course.rules ?? {}, voyage, start.time.t, attempt.finish.t);
    if (checked) {
      firstReason ||= checked;
      continue;
    }
    const run = {
      ok: true,
      start: start.time.t,
      finish: attempt.finish.t,
      gameHours: attempt.finish.t - start.time.t,
      irlSeconds: start.time.utc !== null && attempt.finish.utc !== null ? attempt.finish.utc - start.time.utc : null,
      splits: attempt.splits,
      startedFrom: start.from >= 0 ? places.checkpoints[start.from].name : places.start.name
    };
    // A real-time board picks the fastest run by real time. A run without one is listed after the timed runs.
    if (irl && !(Number.isFinite(run.irlSeconds) && run.irlSeconds >= 0)) {
      if (!untimed || run.gameHours < untimed.gameHours) untimed = { ...run, irlSeconds: null };
      continue;
    }
    if (!best || (irl ? run.irlSeconds < best.irlSeconds : run.gameHours < best.gameHours)) best = run;
  }
  if (!best && untimed) {
    best = untimed;
    notes.push("no-real-time");
  }
  if (!best) return { ok: false, reason: firstReason || "The run doesn't complete the race." };
  return { ...best, ...summary(voyage, best.start, best.finish), ...(notes.length && { notes }) };
}

function runFrom(course, places, start, reached, finishes) {
  const splits = [];
  let after = start.time.t;
  const done = new Set(start.from >= 0 ? [start.from] : []);
  if (course.order === "fixed") {
    for (const [index, times] of reached.entries()) {
      if (done.has(index)) continue;
      const hit = times.find((time) => time.t > after);
      const where = places.checkpoints[index];
      if (!hit) {
        return {
          ok: false,
          reason: where.island
            ? `The run doesn't reach ${where.name} in order.`
            : `The run doesn't come within ${where.radiusNm} nm of the ${where.name} mark in order.`
        };
      }
      splits.push({ name: where.name, t: hit.t, utc: hit.utc });
      after = hit.t;
    }
  } else {
    for (const [index, times] of reached.entries()) {
      if (done.has(index)) continue;
      const hit = times.find((time) => time.t > start.time.t);
      const where = places.checkpoints[index];
      if (!hit) {
        return {
          ok: false,
          reason: where.island
            ? `The run doesn't reach ${where.name}.`
            : `The run doesn't come within ${where.radiusNm} nm of the ${where.name} mark.`
        };
      }
      splits.push({ name: where.name, t: hit.t, utc: hit.utc });
    }
    splits.sort((a, b) => a.t - b.t);
    after = splits.at(-1)?.t ?? start.time.t;
  }
  let finish;
  if (finishes) {
    finish = finishes.find((time) => time.t > after);
    if (!finish) {
      return {
        ok: false,
        reason: places.finish.island
          ? `The run doesn't finish at ${places.finish.name} after the last checkpoint.`
          : `The run doesn't come within ${places.finish.radiusNm} nm of the ${places.finish.name} mark after the last checkpoint.`
      };
    }
  } else {
    const last = splits.at(-1);
    if (!last) return { ok: false, reason: "The course has nothing to reach." };
    finish = { t: last.t, utc: last.utc ?? null };
  }
  return { ok: true, finish, splits: splits.map(({ name, t }) => ({ name, t })) };
}

// Voyage Recorder 0.2.2 and later write the loaded mods with every session, along with real time, and Chartroom
// always includes them in a race entry. Only an older recording has neither, so a file with real time but no
// mod list had it removed. (The world can be missing legitimately: it's left out when the Scrambled Seas save
// can't be read.)
export function editedRecording(voyage) {
  if (voyage.plugins || !voyage.points.some((point) => Number.isFinite(point.utc))) return "";
  return "This file has no mod list, but its recording always has one. Save the run with Enter a race in Chartroom, which always includes it, and attach that file.";
}

export function checkMods(mods, plugins) {
  // A recording from before Voyage Recorder 0.2.2 has no mod list; checkRun notes that instead.
  if (!mods || mods.mode === "any" || !plugins) return "";
  const loaded = new Set(plugins.map((plugin) => plugin.guid.toLowerCase()));
  const listed = (mods.plugins ?? []).map((guid) => guid.toLowerCase());
  if (mods.mode === "block") {
    const blocked = listed.filter((guid) => loaded.has(guid));
    if (blocked.length) return `This race doesn't allow ${blocked.join(", ")}.`;
  }
  if (mods.mode === "require") {
    const missing = listed.filter((guid) => !loaded.has(guid));
    if (missing.length) return `This race needs ${missing.join(", ")}.`;
  }
  if (mods.mode === "only") {
    const allowed = new Set([...listed, ...ALWAYS_ALLOWED]);
    const others = [...loaded].filter((guid) => !allowed.has(guid));
    if (others.length) return `This race allows no other mods, but the run had ${others.join(", ")}.`;
  }
  return "";
}

// Boats and hull damage between the start and finish.
function checkConduct(rules, voyage, start, finish) {
  const during = voyage.points.filter((point) => point.t >= start && point.t <= finish);
  const boats = [...new Set(during.map((point) => point.boat).filter(Boolean))];
  if (Array.isArray(rules.boats) && rules.boats.length) {
    const allowed = new Set(rules.boats.map(key));
    const other = boats.find((boat) => !allowed.has(key(boat)));
    if (other) return `This race doesn't allow the ${other}.`;
    if (!boats.length) return "This race has boat rules, but the route file doesn't say which boat was sailed. Save it again with Boat ticked.";
  }
  if (rules.oneBoat && !boats.length) return "This race is sailed in one boat, but the route file doesn't say which boat was sailed. Save it again with Boat ticked.";
  if (rules.oneBoat && boats.length > 1) return `This race is sailed in one boat, but the run used ${boats.join(" and ")}.`;
  if (Number.isFinite(rules.maxHull)) {
    const hulls = during.map((point) => point.hull).filter(Number.isFinite);
    if (!hulls.length) return "This race limits hull damage, but the route file has none recorded. Save it again with Hull damage ticked.";
    if (Math.max(...hulls) > rules.maxHull) return `Hull damage reached ${Math.max(...hulls)}%, over this race's ${rules.maxHull}%.`;
  }
  return "";
}

// What the board shows beside the time: the boat and the average wind on the run.
function summary(voyage, start, finish) {
  const during = voyage.points.filter((point) => point.t >= start && point.t <= finish);
  const boats = [...new Set(during.map((point) => point.boat).filter(Boolean))];
  const winds = during.map((point) => point.windKnots).filter(Number.isFinite);
  return { boat: boats.join(", "), windKnots: winds.length ? Math.round(winds.reduce((sum, value) => sum + value, 0) / winds.length * 10) / 10 : null };
}
