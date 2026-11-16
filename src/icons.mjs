// Encounter icons for things seen at sea: the encounters Random Encounters adds. Each is drawn in the theme's
// ink with a thin halo of its paper, so it reads on any theme and at any zoom without a badge around it. A
// combined encounter is its two icons offset diagonally. Placing them needs no Random Encounters; they are
// locations like any other.

// Icon id → its name and the base icons it draws. The order is the picker's.
export const LOCATION_ICONS = Object.freeze({
  flotsam: { label: "Flotsam", parts: ["flotsam"] },
  whales: { label: "Whales", parts: ["whales"] },
  fog: { label: "Dense fog", parts: ["fog"] },
  fishing: { label: "Fishing bonanza", parts: ["fishing"] },
  storm: { label: "Intense storm", parts: ["storm"] },
  "fog-whales": { label: "Dense fog and whales", parts: ["fog", "whales"] },
  "flotsam-whales": { label: "Flotsam and whales", parts: ["flotsam", "whales"] }
});

export function isLocationIcon(id) {
  return Object.hasOwn(LOCATION_ICONS, id);
}

// Draws the icon centred on (x, y), each glyph filling a square of twice the radius in pixels. A selected icon's
// halo takes the selection colour.
export function drawLocationIcon(context, id, x, y, radius, palette, selected = false) {
  const parts = LOCATION_ICONS[id]?.parts ?? [];
  const offset = parts.length > 1 ? radius * 0.55 : 0;
  parts.forEach((part, index) => {
    const centreX = x + (index ? offset : -offset);
    const centreY = y + (index ? offset : -offset);
    // Glyphs are drawn on a 20-unit square centred on the icon.
    const scale = radius / 10;
    for (const halo of [true, false]) {
      context.save();
      context.translate(centreX, centreY);
      context.scale(scale, scale);
      const colour = halo ? (selected ? palette.select : palette.paperA) : palette.ink;
      context.strokeStyle = colour;
      context.fillStyle = colour;
      context.lineWidth = halo ? (selected ? 5 : 4) : 1.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      GLYPHS[part](context, halo ? { paperA: colour } : palette);
      context.restore();
    }
  });
}

function wave(context, y, from = -6.5, to = 6.5) {
  context.beginPath();
  context.moveTo(from, y);
  for (let x = from; x < to; x += 3.25) context.quadraticCurveTo(x + 1.625, y - 1.4, x + 3.25, y);
  context.stroke();
}

const GLYPHS = {
  // A crate riding a wave.
  flotsam(context) {
    context.save();
    context.rotate(-0.25);
    context.strokeRect(-3.6, -5.4, 7.2, 6.4);
    context.beginPath();
    context.moveTo(-3.6, -5.4); context.lineTo(3.6, 1);
    context.stroke();
    context.restore();
    wave(context, 4.6);
  },
  // A whale's tail above the water.
  whales(context) {
    context.beginPath();
    context.moveTo(0, 3.2);
    context.quadraticCurveTo(0.4, -1, 0, -2.4);
    context.quadraticCurveTo(-2.6, -2.6, -5.6, -5.4);
    context.quadraticCurveTo(-4.2, -1.8, 0, -1.2);
    context.quadraticCurveTo(4.2, -1.8, 5.6, -5.4);
    context.quadraticCurveTo(2.6, -2.6, 0, -2.4);
    context.fill();
    context.stroke();
    wave(context, 4.6);
  },
  // Three drifting banks of fog.
  fog(context) {
    wave(context, -4, -5.5, 4.25);
    wave(context, 0, -6.5, 6.5);
    wave(context, 4, -4.25, 5.5);
  },
  // A fish.
  fishing(context, palette) {
    context.scale(1.25, 1.25);
    context.beginPath();
    context.moveTo(-6, 0);
    context.quadraticCurveTo(-1, -5, 3.6, 0);
    context.quadraticCurveTo(-1, 5, -6, 0);
    context.moveTo(3.6, 0);
    context.lineTo(6.6, -3.2);
    context.lineTo(6.6, 3.2);
    context.closePath();
    context.fill();
    context.beginPath();
    context.arc(-3.6, -0.6, 0.7, 0, Math.PI * 2);
    context.fillStyle = palette.paperA;
    context.fill();
  },
  // A storm cloud with lightning.
  storm(context) {
    context.beginPath();
    context.moveTo(-5.5, 0.6);
    context.arc(-3.4, -1.4, 2.4, Math.PI * 0.75, Math.PI * 1.6);
    context.arc(0.4, -3.2, 3.2, Math.PI * 1.05, Math.PI * 1.95);
    context.arc(3.6, -0.8, 2.4, Math.PI * 1.45, Math.PI * 0.35);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(0.6, 0.8);
    context.lineTo(-1.4, 4);
    context.lineTo(0.8, 4);
    context.lineTo(-1, 7);
    context.stroke();
  }
};
