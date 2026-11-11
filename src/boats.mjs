const HULLS = Object.freeze({
  dhow: { deckY: 32, points: [[4, 31], [17, 33], [95, 28], [87, 38], [31, 42], [10, 38]] },
  sanbuq: { deckY: 29, points: [[5, 28], [19, 30], [94, 27], [87, 42], [29, 45], [10, 39]] },
  baghlah: { deckY: 28, points: [[4, 20], [17, 20], [25, 28], [94, 26], [86, 43], [29, 46], [9, 38]] },
  cog: { deckY: 29, points: [[5, 25], [17, 28], [78, 28], [91, 23], [95, 29], [84, 43], [34, 46], [13, 40]] },
  brig: { deckY: 30, points: [[3, 28], [18, 31], [97, 26], [88, 40], [25, 43], [8, 37]] },
  jong: { deckY: 27, points: [[4, 20], [17, 23], [25, 28], [85, 27], [95, 21], [92, 33], [83, 44], [27, 46], [9, 38]] },
  junk: { deckY: 29, points: [[5, 24], [18, 28], [83, 29], [94, 23], [91, 36], [82, 44], [29, 45], [10, 39]] },
  kakam: { deckY: 34, points: [[8, 33], [28, 35], [92, 32], [83, 40], [30, 42], [13, 39]] },
  happyBay: { deckY: 30, points: [[4, 25], [18, 29], [86, 29], [96, 24], [91, 37], [81, 44], [28, 45], [9, 39]] },
  clipper: { deckY: 31, points: [[2, 27], [17, 31], [98, 25], [89, 39], [22, 43], [7, 37]] },
  shba: { deckY: 31, points: [[5, 29], [17, 32], [94, 27], [86, 40], [28, 43], [10, 38]] },
  gloriana: { deckY: 27, points: [[3, 17], [18, 18], [27, 27], [95, 24], [88, 42], [28, 45], [8, 37]] },
  aelasyl: { deckY: 26, points: [[3, 17], [18, 17], [25, 25], [88, 26], [97, 19], [92, 36], [84, 44], [25, 46], [7, 37]] },
  caelanor: { deckY: 29, points: [[5, 25], [19, 29], [93, 26], [87, 41], [30, 45], [10, 39]] },
  gallus: { deckY: 33, points: [[7, 31], [22, 34], [93, 29], [84, 40], [30, 43], [12, 39]] },
  leopard: { deckY: 25, points: [[2, 18], [16, 19], [25, 25], [98, 22], [89, 41], [23, 44], [6, 35]] },
  santaMaria: { deckY: 27, points: [[4, 16], [18, 17], [27, 27], [91, 25], [96, 29], [86, 43], [30, 46], [9, 38]] },
  asturias: { deckY: 24, points: [[2, 14], [18, 15], [27, 24], [90, 23], [98, 17], [92, 36], [83, 45], [24, 46], [6, 35]] },
  paraw: { deckY: 35, points: [[5, 34], [24, 36], [94, 31], [85, 39], [27, 41], [10, 38]] },
  cutter: { deckY: 35, points: [[9, 34], [27, 36], [91, 32], [82, 40], [31, 42], [14, 39]] }
});

function rig(x, top, type, size = 24, direction = 1, options = {}) {
  return { x, top, type, size, direction, ...options };
}

function boat(id, name, provider, size, lengthM, profile) {
  return Object.freeze({ id, name, provider, size, lengthM, profile: Object.freeze(profile) });
}

// These are deliberately compact chart symbols. Their hull and rig combinations make the
// boats distinguishable at a glance; they are not measured drawings of the game meshes.
// Listed in library order: the stock boats by home region (Al'Ankh, Emerald, Aestrin), then each mod's
// boats together, mods alphabetically. Each group runs from small to large.
export const BOAT_CATALOG = Object.freeze([
  boat("vanilla/dhow", "Dhow", "Vanilla", "Small", 13.2, { hull: "dhow", rigs: [rig(42, 7, "lateen", 36, 1)], bowsprit: true }),
  boat("vanilla/sanbuq", "Sanbuq", "Vanilla", "Medium", 24.1, { hull: "sanbuq", rigs: [rig(36, 5, "lateen", 32, 1), rig(68, 10, "lateen", 24, 1)], structures: [[[69, 23], [83, 23], [86, 28], [68, 29]]], bowsprit: true }),
  boat("vanilla/baghlah", "Baghlah (Bigbuq)", "Vanilla", "Large", 27.8, { hull: "baghlah", rigs: [rig(38, 5, "lateen", 34, 1), rig(69, 9, "lateen", 25, 1)], structures: [[[5, 17], [21, 17], [26, 27], [7, 27]]], bowsprit: true, sternFlag: true }),
  boat("vanilla/kakam", "Kakam", "Vanilla", "Small", 12.5, { hull: "kakam", rigs: [rig(52, 8, "junk", 25, 1)], structures: [[[11, 27], [37, 27], [34, 31], [13, 31]]] }),
  boat("vanilla/junk", "Junk", "Vanilla", "Medium", 24.0, { hull: "junk", rigs: [rig(38, 5, "junk", 27, -1), rig(69, 9, "junk", 22, 1)], structures: [[[7, 22], [27, 22], [33, 29], [9, 29]]] }),
  boat("vanilla/jong", "Jong", "Vanilla", "Large", 31.4, { hull: "jong", rigs: [rig(29, 7, "junk", 23, -1), rig(53, 3, "junk", 28, 1), rig(76, 9, "junk", 20, 1)], structures: [[[6, 20], [27, 20], [33, 28], [8, 28]]] }),
  boat("vanilla/cog", "Cog", "Vanilla", "Small", 14.6, { hull: "cog", rigs: [rig(48, 5, "square", 30), rig(49, 8, "staysail", 39, 1, { mast: false })], structures: [[[7, 21], [24, 21], [29, 28], [8, 28]]] }),
  boat("vanilla/brig", "Brig", "Vanilla", "Medium", 29.7, { hull: "brig", rigs: [rig(39, 3, "square", 25, 1, { tiers: 2 }), rig(68, 5, "square", 23, 1, { tiers: 2 })], structures: [[[5, 23], [25, 23], [30, 30], [7, 30]]], bowsprit: true }),

  boat("age-of-exploration/santa-maria", "Santa Maria", "Age of Exploration", "Medium", null, { hull: "santaMaria", rigs: [rig(31, 7, "square", 19), rig(53, 3, "square", 24, 1, { tiers: 2 }), rig(75, 11, "lateen", 17, 1)], structures: [[[5, 14], [22, 14], [29, 26], [7, 26]]], bowsprit: true, sternFlag: true }),
  boat("age-of-exploration/asturias", "Asturias", "Age of Exploration", "Large", null, { hull: "asturias", rigs: [rig(26, 6, "square", 18, 1, { tiers: 2 }), rig(46, 2, "square", 23, 1, { tiers: 2 }), rig(65, 3, "square", 21, 1, { tiers: 2 }), rig(81, 10, "lateen", 16, 1)], structures: [[[3, 11], [20, 11], [28, 23], [5, 23]]], bowsprit: true, gunports: 6, sternFlag: true }),
  boat("dinghies/cutter", "Cutter", "Dinghies", "Small", 7.9, { hull: "cutter", rigs: [rig(53, 9, "gaff", 23, -1), rig(54, 12, "staysail", 31, 1, { mast: false })], bowsprit: true }),
  boat("happy-bay/boat", "Happy Bay Boat", "Happy Bay Boat", "Medium", 18.6, { hull: "happyBay", rigs: [rig(47, 5, "junk", 25, 1), rig(70, 10, "junk", 20, 1), rig(71, 11, "staysail", 21, 1, { mast: false })], structures: [[[5, 18], [25, 18], [31, 23], [29, 29], [6, 29]]], bowsprit: true }),
  boat("hms-leopard/leopard", "HMS Leopard", "HMS Leopard", "Large", 53.0, { hull: "leopard", rigs: [rig(30, 2, "square", 21, 1, { tiers: 2 }), rig(52, 1, "square", 24, 1, { tiers: 2 }), rig(74, 4, "square", 20, 1, { tiers: 2 })], structures: [[[3, 12], [20, 12], [28, 24], [5, 24]]], bowsprit: true, gunports: 8, sternFlag: true }),
  boat("old-chronian/gallus", "Gallus", "Old Chronian", "Small", 13.6, { hull: "gallus", rigs: [rig(52, 6, "gaff", 25, 1)], structures: [[[11, 25], [25, 25], [30, 33], [13, 33]]], bowsprit: true }),
  boat("old-chronian/caelanor", "Caelanor", "Old Chronian", "Medium", 21.6, { hull: "caelanor", rigs: [rig(39, 5, "square", 23), rig(68, 9, "gaff", 21, 1)], structures: [[[8, 20], [25, 20], [31, 29], [10, 29]]], bowsprit: true }),
  boat("old-chronian/gloriana", "Gloriana", "Old Chronian", "Large", 35.5, { hull: "gloriana", rigs: [rig(29, 6, "square", 20, 1, { tiers: 2 }), rig(51, 2, "square", 25, 1, { tiers: 2 }), rig(74, 8, "lateen", 19, 1)], structures: [[[4, 14], [21, 14], [28, 26], [6, 26]]], bowsprit: true, sternFlag: true }),
  boat("old-chronian/aelasyl", "Aelasyl", "Old Chronian", "Large", 43.4, { hull: "aelasyl", rigs: [rig(27, 4, "lateen", 24, -1), rig(51, 1, "square", 25, 1, { tiers: 2 }), rig(75, 5, "lateen", 22, 1)], structures: [[[4, 14], [21, 14], [28, 25], [6, 25]]], bowsprit: true, sternFlag: true }),
  boat("paraw/paraw", "Paraw", "Paraw", "Small", 14.4, { hull: "paraw", rigs: [rig(49, 6, "crab", 30, 1)], outriggers: true }),
  boat("shattered-seas/shba", "Sh'ba", "Shattered Seas", "Medium", 19.2, { hull: "shba", rigs: [rig(40, 6, "gaff", 24, -1), rig(69, 10, "lateen", 21, 1)], structures: [[[8, 24], [23, 24], [29, 31], [10, 31]]], bowsprit: true }),
  boat("shattered-seas/clipper", "Clipper", "Shattered Seas", "Large", 39.5, { hull: "clipper", rigs: [rig(30, 3, "square", 22, 1, { tiers: 2 }), rig(52, 2, "square", 24, 1, { tiers: 2 }), rig(74, 5, "square", 20, 1, { tiers: 2 })], structures: [[[4, 21], [21, 21], [27, 30], [6, 30]]], bowsprit: true, sternFlag: true })
]);

const BY_ID = new Map(BOAT_CATALOG.map((entry) => [entry.id, entry]));
export const BOAT_CORNERS = Object.freeze(["nw", "ne", "sw", "se"]);

export function boatById(id) {
  return BY_ID.get(String(id ?? "")) ?? null;
}

export function assignedBoat(feature) {
  return boatById(feature?.boatId);
}

export function visibleBoat(feature) {
  return assignedBoat(feature);
}

export function normalizeBoatCorner(value) {
  return BOAT_CORNERS.includes(value) ? value : "se";
}

export function boatMarkerSize(entry) {
  const boatEntry = typeof entry === "string" ? boatById(entry) : entry;
  const fallbackLength = { Small: 12, Medium: 24, Large: 38 }[boatEntry?.size] ?? 20;
  const length = Number.isFinite(boatEntry?.lengthM) && boatEntry.lengthM > 0 ? boatEntry.lengthM : fallbackLength;
  const minRoot = Math.sqrt(7.9);
  const span = Math.sqrt(53) - minRoot;
  const scale = Math.max(0, Math.min(1, (Math.sqrt(length) - minRoot) / span));
  return Object.freeze({
    width: Math.round(32 + scale * 26),
    height: Math.round(18 + scale * 12)
  });
}

function polygonPath(context, points, left, top, width, height, close = true) {
  context.beginPath();
  points.forEach(([x, y], index) => {
    const px = left + x / 100 * width;
    const py = top + y / 48 * height;
    if (index) context.lineTo(px, py); else context.moveTo(px, py);
  });
  if (close) context.closePath();
}

function sailPolygon(mast, deckY) {
  const { x, top, type, size, direction } = mast;
  if (type === "lateen") return [[x, top + 2], [x, deckY - 2], [x + direction * size, top + 8]];
  if (type === "gaff") return [[x, top + 5], [x, deckY - 2], [x + direction * size * .75, deckY - 8], [x + direction * size, top + 10]];
  if (type === "crab") return [[x, top + 2], [x - size * .8, deckY - 3], [x + size, deckY - 5]];
  if (type === "junk") return [[x, top + 3], [x, deckY - 2], [x + direction * size, deckY - 8], [x + direction * size * .82, top + 8]];
  if (type === "staysail") return [[x, top + 3], [x, deckY - 2], [x + direction * size, deckY - 3]];
  return [[x - size * .55, top + 5], [x + size * .55, top + 5], [x + size * .48, top + 15], [x - size * .48, top + 15]];
}

export function drawBoatSilhouette(context, entry, bounds, colors = {}) {
  const boatEntry = typeof entry === "string" ? boatById(entry) : entry;
  if (!boatEntry || !context) return;
  const { x, y, width, height } = bounds;
  const left = x - width / 2;
  const top = y - height / 2;
  const profile = boatEntry.profile;
  const hull = HULLS[profile.hull] ?? HULLS.sharp;
  const stroke = colors.stroke ?? "#72dce2";
  const fill = colors.fill ?? "rgba(55, 178, 190, .38)";
  const sailFill = colors.sailFill ?? "rgba(114, 220, 226, .16)";
  const lineWidth = colors.lineWidth ?? 1.25;
  const detail = colors.detail ?? "full";
  const point = ([px, py]) => [left + px / 100 * width, top + py / 48 * height];

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = stroke;
  context.fillStyle = sailFill;
  context.lineWidth = lineWidth;

  for (const mast of profile.rigs ?? []) {
    const sail = sailPolygon(mast, hull.deckY);
    polygonPath(context, sail, left, top, width, height);
    context.fill();
    context.stroke();
    if (mast.type === "junk") {
      const [a, b, c, d] = sail;
      for (const fraction of [.25, .5, .75]) {
        const p1 = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
        const p2 = [d[0] + (c[0] - d[0]) * fraction, d[1] + (c[1] - d[1]) * fraction];
        polygonPath(context, [p1, p2], left, top, width, height, false);
        context.stroke();
      }
    } else if (mast.type === "square" && mast.tiers > 1 && detail !== "marker") {
      for (let tier = 1; tier < mast.tiers; tier += 1) {
        const lower = sail.map(([sx, sy]) => [sx, sy + 11 * tier]);
        polygonPath(context, lower, left, top, width, height);
        context.fill();
        context.stroke();
      }
    }
  }

  context.fillStyle = fill;
  polygonPath(context, hull.points, left, top, width, height);
  context.fill();
  context.stroke();

  for (const structure of profile.structures ?? []) {
    polygonPath(context, structure, left, top, width, height);
    context.fill();
    context.stroke();
  }

  for (const mast of profile.rigs ?? []) {
    if (mast.mast === false) continue;
    polygonPath(context, [[mast.x, mast.top], [mast.x, hull.deckY]], left, top, width, height, false);
    context.stroke();
  }
  if (profile.bowsprit) {
    polygonPath(context, [[86, hull.deckY], [99, hull.deckY - 8]], left, top, width, height, false);
    context.stroke();
  }
  if (profile.sternFlag && detail !== "marker") {
    polygonPath(context, [[13, hull.deckY - 5], [13, 8], [23, 11], [13, 14]], left, top, width, height, false);
    context.stroke();
  }
  if (profile.outriggers) {
    polygonPath(context, [[17, 40], [83, 42]], left, top, width, height, false);
    context.stroke();
    polygonPath(context, [[27, 36], [20, 44], [14, 45], [25, 43], [34, 36]], left, top, width, height, false);
    context.stroke();
    polygonPath(context, [[69, 36], [77, 44], [85, 45], [77, 42], [61, 36]], left, top, width, height, false);
    context.stroke();
  }
  if (profile.gunports && detail !== "marker") {
    context.fillStyle = stroke;
    for (let index = 0; index < profile.gunports; index += 1) {
      const [gx, gy] = point([23 + index * (55 / Math.max(1, profile.gunports - 1)), 32]);
      context.beginPath();
      context.arc(gx, gy, Math.max(1, width / 105), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}
