// Island outlines added by mods. Each was traced at sea level from the mod's own island terrain and
// converted to chart degrees (9000 world metres per degree, latitude 36 at world zero).
// Mod islands are offered in the island library only; the vanilla map does not draw them.

function ringBounds(rings) {
  const bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 2) {
      bounds.minLon = Math.min(bounds.minLon, ring[index]);
      bounds.maxLon = Math.max(bounds.maxLon, ring[index]);
      bounds.minLat = Math.min(bounds.minLat, ring[index + 1]);
      bounds.maxLat = Math.max(bounds.maxLat, ring[index + 1]);
    }
  }
  return bounds;
}

function modIsland(id, name, provider, port, sourceCenter, shapes) {
  return { id, name, region: provider, provider, port, secret: false, sourceCenter, bounds: ringBounds(shapes.flatMap((shape) => shape.rings)), shapes };
}

export const MOD_ISLANDS = [
  // Better Ports 1.1.1, `island 67 Bottleneck` with its port "Bottleneck Is.": a ring of five low islets around a lagoon.
  modIsland("better-ports/bottleneck", "Bottleneck Isle", "Better Ports", true, { lon: 3.27618, lat: 31.1206 }, [{ kind: 0, rings: [
    [0.00616, -0.02081, 0.00051, -0.01921, -0.00838, -0.01945, -0.00943, -0.01878, -0.00817, -0.01755, 0.0016, -0.01547, 0.0042, -0.01316, 0.00811, -0.0124, 0.01028, -0.01025, 0.01332, -0.00967, 0.01662, -0.0127, 0.01932, -0.01391, 0.01924, -0.0168, 0.01185, -0.02075, 0.01006, -0.02029],
    [-0.0316, 0.00473, -0.03305, 0.00659, -0.0315, 0.01206, -0.02922, 0.01506, -0.02596, 0.01709, -0.01771, 0.01945, -0.0099, 0.02013, -0.00577, 0.01951, -0.00621, 0.01818, -0.01641, 0.01678, -0.01988, 0.01546, -0.02278, 0.01085, -0.02331, 0.00872, -0.02705, 0.00809, -0.02948, 0.0069, -0.0302, 0.00538],
    [0.02764, -0.00727, 0.02693, -0.00526, 0.02875, -0.00328, 0.0297, -0.00009, 0.02879, 0.0028, 0.02932, 0.00583, 0.02683, 0.0113, 0.02221, 0.01632, 0.02224, 0.01738, 0.0233, 0.01819, 0.0246, 0.01798, 0.03121, 0.01282, 0.03305, 0.00978, 0.03254, 0.00112, 0.02974, -0.00404, 0.02959, -0.00577],
    [-0.01837, -0.0162, -0.02271, -0.01391, -0.02922, -0.00724, -0.03215, -0.00176, -0.0322, 0.00249, -0.03104, 0.00204, -0.02938, -0.00404, -0.02683, -0.0074, -0.02538, -0.00784, -0.02256, -0.01118, -0.01766, -0.01498, -0.01699, -0.01619],
    [0.01788, 0.01721, 0.00203, 0.01906, 0.00088, 0.02011, 0.00268, 0.02081, 0.0105, 0.02064, 0.01874, 0.01958, 0.02001, 0.0189, 0.02016, 0.01799]
  ] }])
];
