import type { PrefabDef } from '../world/prefabs';

/** What a statue shows (SPEC §11): one body plan, one element, a few features. */
export interface Depiction {
  body: string;
  element: string;
  features: string[];
}

export const BODIES = ['humanoid', 'bird', 'serpent', 'sunDisc'] as const;
export const FEATURES = ['wings', 'eyes', 'horns', 'raisedHand', 'manyArms'] as const;

/** Legend char for each element's accent color. */
const ACCENT: Record<string, string> = { fire: 'F', water: 'V', growth: 'G', stone: 'S' };

/** Read the strongest traits out of DEPICTION votes ('body:bird' → weight). */
export function depictionOf(traits: Record<string, number>): Depiction {
  const best = (axis: string) => {
    let k = '';
    let n = 0;
    for (const [key, v] of Object.entries(traits)) if (key.startsWith(axis + ':') && v > n) (k = key.slice(axis.length + 1)), (n = v);
    return { k, n };
  };
  const body = best('body').k || 'humanoid';
  const element = best('element').k || 'stone';
  const top = best('feature').n;
  // Features close to the strongest one all make it onto the statue (at most two).
  const features = Object.entries(traits)
    .filter(([k, v]) => k.startsWith('feature:') && v >= top * 0.6 && v > 0.05)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([k]) => k.slice(8))
    .sort();
  return { body, element, features };
}

export function depictionKey(d: Depiction): string {
  return [d.body, d.element, ...d.features].join('+');
}

/** How different two depictions are (0 same … 3+ unrecognizable). Body counts double. */
export function depictionDistance(a: Depiction, b: Depiction): number {
  let n = a.body === b.body ? 0 : 2;
  if (a.element !== b.element) n += 1;
  const fa = new Set(a.features);
  for (const f of b.features) if (!fa.has(f)) n += 0.5;
  for (const f of a.features) if (!b.features.includes(f)) n += 0.5;
  return n;
}

const W = 5;
const D = 5;
const H = 11;

/**
 * A statue blueprint built from the depiction: a stone pedestal, the body plan,
 * the element as accent color, and features stuck on. Front is +z (row 4), which
 * the planner turns toward the village.
 */
export function statueBlueprint(d: Depiction): PrefabDef {
  const grid: string[][][] = [];
  for (let y = 0; y < H; y++) grid.push(Array.from({ length: D }, () => Array.from({ length: W }, () => '.')));
  const X = ACCENT[d.element] ?? 'S';
  const set = (x: number, y: number, z: number, c: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) grid[y]![z]![x] = c === 'X' ? X : c;
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, y, z, c);
  };
  const has = (f: string) => d.features.includes(f);
  let top = 7; // y of the head's top, for horns and crowns

  box(1, 3, 0, 0, 1, 3, 'S'); // pedestal
  switch (d.body) {
    case 'bird':
      box(2, 2, 1, 1, 2, 2, 'U');
      box(1, 3, 2, 4, 1, 3, 'U');
      box(0, 0, 3, 5, 1, 3, 'X');
      box(4, 4, 3, 5, 1, 3, 'X');
      box(2, 2, 5, 6, 2, 3, 'U');
      set(2, 6, 4, 'O'); // beak
      top = 6;
      break;
    case 'serpent':
      box(1, 3, 1, 1, 1, 3, 'U');
      box(1, 3, 2, 2, 1, 3, 'X');
      box(1, 3, 3, 3, 1, 3, 'U');
      set(2, 1, 2, '.');
      set(2, 2, 2, '.');
      set(2, 3, 2, '.');
      box(2, 2, 3, 6, 1, 1, 'U'); // rising neck at the back
      box(2, 2, 7, 7, 1, 3, 'U'); // head leaning forward
      set(2, 6, 3, 'X'); // tongue
      top = 7;
      break;
    case 'sunDisc':
      box(2, 2, 1, 4, 2, 2, 'U');
      for (let y = 4; y <= 9; y++)
        for (let x = 0; x < W; x++) {
          const r = Math.hypot(x - 2, y - 6.5);
          if (r <= 2.6) set(x, y, 2, r <= 1.2 ? 'O' : 'X');
        }
      top = 9;
      break;
    default: {
      // humanoid (the default, and the base for many-armed)
      box(1, 1, 1, 2, 2, 2, 'U');
      box(3, 3, 1, 2, 2, 2, 'U');
      box(1, 3, 3, 5, 2, 2, 'U');
      box(1, 3, 4, 4, 3, 3, 'X'); // sash
      box(0, 0, 3, 5, 2, 2, 'X'); // arms carry the element's color
      box(4, 4, 3, 5, 2, 2, 'X');
      box(2, 2, 6, 7, 2, 2, 'U');
      box(1, 3, 8, 8, 2, 2, 'X'); // crown
      set(2, 7, 3, 'O');
      top = 8;
      if (has('raisedHand')) {
        box(4, 4, 3, 5, 2, 2, '.');
        box(4, 4, 5, 8, 2, 2, 'X');
        set(4, 9, 2, 'O');
      }
    }
  }
  if (has('manyArms')) {
    box(0, 0, 4, 5, 3, 3, 'U');
    box(4, 4, 4, 5, 3, 3, 'U');
    box(0, 0, 6, 6, 1, 1, 'X');
    box(4, 4, 6, 6, 1, 1, 'X');
  }
  if (has('wings') && d.body !== 'bird') {
    box(0, 0, 5, 7, 1, 1, 'X');
    box(4, 4, 5, 7, 1, 1, 'X');
    box(1, 1, 6, 6, 1, 1, 'X');
    box(3, 3, 6, 6, 1, 1, 'X');
  }
  if (has('eyes')) {
    // Many eyes: a band of gold across the head or body front.
    set(1, top - 1, 3, 'O');
    set(3, top - 1, 3, 'O');
    set(2, top - 2, 3, 'O');
  }
  if (has('horns')) {
    set(1, top + 1, 2, 'U');
    set(3, top + 1, 2, 'U');
    set(1, top + 2, 2, 'X');
    set(3, top + 2, 2, 'X');
  }

  // Trim empty layers off the top.
  let h = H;
  while (h > 1 && grid[h - 1]!.every((row) => row.every((c) => c === '.'))) h--;
  return {
    kind: 'statue',
    variant: depictionKey(d),
    yOffset: 0,
    layers: grid.slice(0, h).map((rows) => rows.map((r) => r.join(''))),
  };
}
