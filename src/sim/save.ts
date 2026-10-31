import type { GameMode, Sim } from './Sim';

/**
 * Save / load (SPEC M7). The sim is plain data in class instances, so a save is
 * its object graph: shared references kept, Maps / Sets / typed arrays encoded
 * (typed arrays run-length encoded; voxels are mostly air), functions skipped.
 *
 * Loading builds a fresh Sim from the same seed and mode, then restores the saved
 * graph onto it: class instances are reused in place where they line up (so the
 * closures wired up in constructors, like world listeners and planner hooks, keep
 * pointing at the live objects) and recreated from their prototype where they don't.
 */

export const SAVE_VERSION = 5;

export interface SaveHeader {
  version: number;
  seed: string;
  mode: GameMode;
  floodInYears?: number;
  tick: number;
  /** For the title screen: "Year 34 · Spring". */
  label: string;
}

type Enc = unknown;
interface Node {
  $id: number;
  $c?: string;
  $o?: Record<string, Enc>;
  $a?: Enc[];
  $m?: [Enc, Enc][];
  $s?: Enc[];
  $t?: string;
  $r?: number[];
}

const SKIP = { $skip: 1 };
/** Stands in for a skipped value: on load, the live sim's value stays. */
const KEEP = { $keep: 1 };

type Typed = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const TYPED: Record<string, new (n: number) => Typed> = { Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };

function isTyped(v: unknown): v is Typed {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

/** [value, count, value, count, …] */
function rle(a: Typed): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i]!;
    let n = 1;
    while (i + n < a.length && Object.is(a[i + n], v)) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

function unrle(r: number[], into: Typed): void {
  let k = 0;
  for (let i = 0; i < r.length; i += 2) {
    const v = r[i]!;
    const n = r[i + 1]!;
    into.fill(v, k, k + n);
    k += n;
  }
}

function num(v: number): Enc {
  if (Number.isFinite(v)) return v;
  return { $n: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
}

export function encodeGraph(root: unknown): Enc {
  const ids = new Map<object, number>();
  const enc = (v: unknown): Enc => {
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return SKIP;
    const o = v as object;
    const seen = ids.get(o);
    if (seen !== undefined) return { $ref: seen };
    const id = ids.size + 1;
    ids.set(o, id);
    if (isTyped(o)) return { $id: id, $t: o.constructor.name, $r: rle(o) } satisfies Node;
    if (Array.isArray(o)) {
      // Arrays of callbacks (listeners) belong to the live sim.
      if (o.some((x) => typeof x === 'function')) return SKIP;
      return { $id: id, $a: o.map((x) => { const e = enc(x); return e === SKIP ? KEEP : e; }) } satisfies Node;
    }
    if (o instanceof Map) return { $id: id, $m: [...o].map(([k, x]) => [enc(k), enc(x)] as [Enc, Enc]) } satisfies Node;
    if (o instanceof Set) return { $id: id, $s: [...o].map(enc) } satisfies Node;
    const proto = Object.getPrototypeOf(o);
    const fields: Record<string, Enc> = {};
    for (const k of Object.keys(o)) {
      const x = enc((o as Record<string, unknown>)[k]);
      fields[k] = x === SKIP ? KEEP : x;
    }
    const node: Node = { $id: id, $o: fields };
    if (proto && proto !== Object.prototype) node.$c = proto.constructor.name;
    return node;
  };
  return enc(root);
}

/** Every class prototype reachable from the live sim, by constructor name. */
function prototypes(root: unknown): Map<string, object> {
  const out = new Map<string, object>();
  const seen = new Set<object>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v) || isTyped(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (v instanceof Map) return v.forEach((x, k) => (walk(k), walk(x)));
    if (v instanceof Set) return v.forEach(walk);
    const proto = Object.getPrototypeOf(v);
    if (proto && proto !== Object.prototype) out.set(proto.constructor.name, proto);
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
  };
  walk(root);
  return out;
}

export function decodeGraph(data: Enc, live: unknown): unknown {
  const protos = prototypes(live);
  const memo = new Map<number, unknown>();
  const used = new Set<object>();

  const dec = (e: Enc, lv: unknown): unknown => {
    if (e === null || typeof e !== 'object') return e;
    const r = e as Record<string, unknown>;
    if ('$keep' in r) return lv;
    if ('$u' in r) return undefined;
    if ('$n' in r) return r.$n === 'NaN' ? NaN : r.$n === 'Inf' ? Infinity : -Infinity;
    if ('$ref' in r) {
      if (!memo.has(r.$ref as number)) throw new Error(`save: dangling reference ${r.$ref}`);
      return memo.get(r.$ref as number);
    }
    const n = e as Node;
    if (n.$t) {
      const Ctor = TYPED[n.$t];
      if (!Ctor) throw new Error(`save: unknown typed array ${n.$t}`);
      const len = n.$r!.reduce((s, x, i) => (i % 2 ? s + x : s), 0);
      // Fill live arrays in place: other objects may hold them (e.g. the nav grid's).
      const t = isTyped(lv) && lv.constructor.name === n.$t && lv.length === len && !used.has(lv) ? lv : new Ctor(len);
      used.add(t);
      unrle(n.$r!, t);
      memo.set(n.$id, t);
      return t;
    }
    if (n.$a) {
      const a: unknown[] = [];
      memo.set(n.$id, a);
      const la = Array.isArray(lv) ? lv : [];
      n.$a.forEach((x, i) => a.push(dec(x, la[i])));
      return a;
    }
    if (n.$m) {
      const m = new Map();
      memo.set(n.$id, m);
      const lm = lv instanceof Map ? lv : null;
      for (const [k, x] of n.$m) {
        const key = dec(k, undefined);
        m.set(key, dec(x, lm?.get(key)));
      }
      return m;
    }
    if (n.$s) {
      const s = new Set();
      memo.set(n.$id, s);
      for (const x of n.$s) s.add(dec(x, undefined));
      return s;
    }
    // Objects: reuse the matching live instance, else make one from its class.
    let o: Record<string, unknown>;
    const liveMatch =
      lv && typeof lv === 'object' && !used.has(lv) && (n.$c ? Object.getPrototypeOf(lv)?.constructor?.name === n.$c : Object.getPrototypeOf(lv) === Object.prototype);
    if (liveMatch && n.$c) o = lv as Record<string, unknown>;
    else if (n.$c) {
      const proto = protos.get(n.$c);
      if (!proto) throw new Error(`save: unknown class ${n.$c}`);
      o = Object.create(proto);
    } else o = {};
    used.add(o);
    memo.set(n.$id, o);
    const fields = n.$o ?? {};
    // Data the save doesn't have goes; functions (wired-up hooks) stay.
    for (const k of Object.keys(o)) if (!(k in fields) && typeof o[k] !== 'function') delete o[k];
    for (const [k, x] of Object.entries(fields)) o[k] = dec(x, liveMatch ? (lv as Record<string, unknown>)[k] : undefined);
    return o;
  };
  return dec(data, live);
}

/** Serialize a running game. */
export function saveGame(sim: Sim, header: Omit<SaveHeader, 'version' | 'tick'>): string {
  const h: SaveHeader = { ...header, version: SAVE_VERSION, tick: sim.tick };
  return JSON.stringify({ header: h, sim: encodeGraph(sim) });
}

export function readHeader(text: string): SaveHeader | null {
  try {
    const h = (JSON.parse(text) as { header?: SaveHeader }).header;
    return h && h.version === SAVE_VERSION ? h : null;
  } catch {
    return null;
  }
}

/** Restore a save onto a fresh Sim built with the header's seed, mode and years. */
export function restoreGame(sim: Sim, text: string): void {
  const data = JSON.parse(text) as { header: SaveHeader; sim: Enc };
  if (data.header.version !== SAVE_VERSION) throw new Error('save: incompatible version');
  const out = decodeGraph(data.sim, sim);
  if (out !== sim) throw new Error('save: the sim could not be restored in place');
}
