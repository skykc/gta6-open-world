// utils.js — small math + seeded-random helpers shared by every Solmar system.
// No imports: pure functions so any module can use them without cycles.

/** Deterministic PRNG (mulberry32). Same seed => same city, same traffic. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Shortest-arc angle lerp, for smooth car / character turning. */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export const randRange = (rng, lo, hi) => lo + rng() * (hi - lo);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** A 2D point on a circle, used for scatter placement. */
export function circlePoint(rng, radius) {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/**
 * Make a THREE.CanvasTexture from a painter callback (draws once, at build time).
 * Facades, road markings and the minimap background are all painted this way —
 * no image files, no network.
 */
export function canvasTexture(THREE, w, h, paint, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Parse ?shot= / ?seed= from the page URL. */
export function urlParams() {
  const p = new URLSearchParams(window.location.search);
  return { shot: p.get('shot') || '', seed: parseInt(p.get('seed') || '1', 10) || 1 };
}
