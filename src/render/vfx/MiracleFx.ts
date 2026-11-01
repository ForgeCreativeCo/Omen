import * as THREE from 'three';
import type { SimEvent } from '../../sim/events';
import type { DreamSymbol } from '../../sim/miracles/defs';
import { Rng } from '../../sim/rng';
import type { Sim } from '../../sim/Sim';
import { SYMBOL_PATHS } from '../../ui/symbols';
import { TUNING } from '../../sim/tuning';
import { terrainUniforms } from '../chunks/terrainMaterials';

const SPARKS = 900;
const CLOUD_PUFFS = 18;
const MAX_CLOUDS = 4;
const RAIN_PER_CLOUD = 160;
/** Locusts drawn per swarm. */
const LOCUSTS = 360;
const MAX_SWARMS = 3;

interface WetPatch {
  x: number;
  z: number;
  r: number;
  strength: number;
  cloudId: number;
}

interface Beam {
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  fade: number;
  x: number;
  z: number;
}

interface Glyph {
  sprite: THREE.Sprite;
  t: number;
  life: number;
  baseY: number;
}

/**
 * Effects for the god's acts (SPEC §16): voxel rain clouds with local rain and wet
 * ground, Shape Earth dust, Bloom sparkles, dream glyphs over the sleeper (seen by
 * the player only), sleeper markers while Dream is armed, and the targeting reticle;
 * pillars of Holy Light, the blessing glow, blight's dead dust, and falling stars;
 * the shaking ground, rains of fire, the wave's spray, locust swarms and the sickness.
 */
export class MiracleFx {
  readonly group = new THREE.Group();
  private readonly rng = new Rng('miracle-fx');
  /** -1 until the first update: start from now (a loaded game doesn't replay its past). */
  private lastSeq = -1;

  // Particles: dust (normal blend) and sparks (additive) share one pool each.
  private readonly sparkPos = new Float32Array(SPARKS * 3);
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly sparkCol = new Float32Array(SPARKS * 3);
  private readonly sparkBase = new Float32Array(SPARKS * 3);
  private readonly sparkLife = new Float32Array(SPARKS);
  private readonly sparkMax = new Float32Array(SPARKS);
  private readonly sparkGrav = new Float32Array(SPARKS);
  private nextSpark = 0;
  private readonly sparks: THREE.Points;
  private readonly dustPos = new Float32Array(SPARKS * 3);
  private readonly dustVel = new Float32Array(SPARKS * 3);
  private readonly dustLife = new Float32Array(SPARKS);
  private readonly dustCol = new Float32Array(SPARKS * 3);
  private nextDust = 0;
  private readonly dust: THREE.Points;

  // Clouds
  private readonly cloudMesh: THREE.InstancedMesh;
  private readonly cloudOffsets: THREE.Vector3[] = [];
  private readonly cloudShown = new Map<number, { x: number; z: number; fade: number }>();
  private readonly rain: THREE.LineSegments;
  private readonly rainPos = new Float32Array(MAX_CLOUDS * RAIN_PER_CLOUD * 6);
  private readonly wet: WetPatch[] = [];

  // Dream
  private readonly glyphTextures = new Map<string, THREE.Texture>();
  private glyphs: Glyph[] = [];
  private readonly markers: THREE.InstancedMesh;
  showSleepers = false;

  // Holy Light and Falling Stars
  private readonly beams = new Map<number, Beam>();
  /** Hallowed ground: a low glow over the area, and a faint column above it to be seen from afar. */
  private readonly hallowed = new Map<number, Beam>();
  private readonly beamGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  private readonly starHead: THREE.Mesh;
  private readonly starGlow: THREE.Sprite;

  // Swarms: a cloud of dark specks per swarm.
  private readonly locustPos = new Float32Array(LOCUSTS * MAX_SWARMS * 3);
  private readonly locusts: THREE.Points;
  private readonly swarmShown = new Map<number, { x: number; z: number }>();

  // Reticle
  private readonly reticle: THREE.Mesh;
  private readonly reticleMat: THREE.MeshBasicMaterial;

  constructor(
    private readonly offsetX: number,
    private readonly offsetZ: number,
  ) {
    const pts = (pos: Float32Array, col: Float32Array, size: number, additive: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      const p = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          size,
          vertexColors: true,
          transparent: true,
          opacity: additive ? 1 : 0.8,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
          depthWrite: false,
        }),
      );
      p.frustumCulled = false;
      this.group.add(p);
      return p;
    };
    this.sparks = pts(this.sparkPos, this.sparkCol, 0.35, true);
    this.dust = pts(this.dustPos, this.dustCol, 0.6, false);

    // A cloud is a cluster of soft grey voxels.
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.cloudMesh = new THREE.InstancedMesh(
      cube,
      new THREE.MeshLambertMaterial({ color: 0xd8dde4, transparent: true, opacity: 0.92 }),
      CLOUD_PUFFS * MAX_CLOUDS,
    );
    this.cloudMesh.castShadow = true;
    this.cloudMesh.count = 0;
    this.cloudMesh.frustumCulled = false;
    for (let i = 0; i < CLOUD_PUFFS; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * 3.2;
      this.cloudOffsets.push(new THREE.Vector3(Math.cos(a) * r, this.rng.range(-0.6, 0.8), Math.sin(a) * r));
    }
    this.group.add(this.cloudMesh);

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0xc6dcef, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.locustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.locusts = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0x2b2416, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }));
    this.locusts.frustumCulled = false;
    this.locustPos.fill(-999);
    this.group.add(this.locusts);

    this.markers = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.28),
      new THREE.MeshBasicMaterial({ color: 0xb9b2ff, transparent: true, opacity: 0.85 }),
      256,
    );
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.group.add(this.markers);

    this.reticleMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
    });
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), this.reticleMat);
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.group.add(this.reticle);

    this.starHead = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.starHead.visible = false;
    this.group.add(this.starHead);
    const g = document.createElement('canvas');
    g.width = g.height = 64;
    const c = g.getContext('2d')!;
    const grad = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.4, 'rgba(255,190,110,0.45)');
    grad.addColorStop(1, 'rgba(255,160,80,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(g);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.starGlow.scale.setScalar(7);
    this.starGlow.visible = false;
    this.group.add(this.starGlow);
  }

  private beamMesh(color: number, opacity: number): THREE.Mesh {
    const m = new THREE.Mesh(
      this.beamGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  /** A ring of sparks bursting out from a point. */
  private burst(x: number, y: number, z: number, n: number, speed: number, cols: number[], life: number, grav: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const up = this.rng.range(0.2, 1);
      const s = speed * this.rng.range(0.4, 1);
      this.spark(x, y, z, Math.cos(a) * s, up * s, Math.sin(a) * s, this.rng.pick(cols), this.rng.range(life * 0.5, life), grav);
    }
  }

  /** Show the targeting ring at a voxel (world coords), sized to the miracle radius. */
  setReticle(hit: { x: number; y: number; z: number } | null, radius: number, ok: boolean): void {
    this.reticle.visible = !!hit;
    if (!hit) return;
    this.reticle.position.set(hit.x + 0.5 + this.offsetX, hit.y + 1.05, hit.z + 0.5 + this.offsetZ);
    this.reticle.scale.setScalar(Math.max(0.8, radius));
    this.reticleMat.color.setHex(ok ? 0xffe9a8 : 0xe06a5a);
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, col: number, life: number, grav: number): void {
    const i = this.nextSpark;
    this.nextSpark = (i + 1) % SPARKS;
    this.sparkPos.set([x, y, z], i * 3);
    this.sparkVel.set([vx, vy, vz], i * 3);
    const c = new THREE.Color(col);
    this.sparkBase.set([c.r, c.g, c.b], i * 3);
    this.sparkLife[i] = life;
    this.sparkMax[i] = life;
    this.sparkGrav[i] = grav;
  }

  private dustAt(x: number, y: number, z: number): void {
    const i = this.nextDust;
    this.nextDust = (i + 1) % SPARKS;
    this.dustPos.set([x + this.rng.jitter(0.5), y, z + this.rng.jitter(0.5)], i * 3);
    this.dustVel.set([this.rng.jitter(1.2), this.rng.range(0.6, 2.2), this.rng.jitter(1.2)], i * 3);
    this.dustLife[i] = this.rng.range(0.8, 1.6);
  }

  private glyphTexture(symbol: string): THREE.Texture {
    let tex = this.glyphTextures.get(symbol);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(200,190,255,0.55)');
    grad.addColorStop(1, 'rgba(200,190,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.translate(24, 24);
    g.scale(80 / 24, 80 / 24);
    g.strokeStyle = '#fbf7ff';
    g.lineWidth = 1.8;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = '#c9b8ff';
    g.shadowBlur = 3;
    g.stroke(new Path2D(SYMBOL_PATHS[symbol as DreamSymbol] ?? ''));
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glyphTextures.set(symbol, tex);
    return tex;
  }

  private onEvent(sim: Sim, e: SimEvent): void {
    const ox = this.offsetX;
    const oz = this.offsetZ;
    switch (e.type) {
      case 'miracleRain':
        this.wet.push({ x: e.x + ox, z: e.z + oz, r: e.radius, strength: 0, cloudId: e.cloudId });
        break;
      case 'earthShaped': {
        const n = 10 + e.columns * 2;
        for (let i = 0; i < n; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * e.radius;
          const x = Math.round(e.x + Math.cos(a) * r);
          const z = Math.round(e.z + Math.sin(a) * r);
          const y = sim.world.topY(x, z) + 1;
          this.dustAt(x + 0.5 + ox, y, z + 0.5 + oz);
        }
        this.shake = Math.max(this.shake, 0.25);
        break;
      }
      case 'bloom':
        for (let i = 0; i < 160; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * e.radius;
          const x = e.x + Math.cos(a) * r;
          const z = e.z + Math.sin(a) * r;
          const y = sim.world.topY(Math.floor(x), Math.floor(z)) + 1.2;
          const col = this.rng.pick([0x9cf06a, 0xd8ff8a, 0xffe27a, 0xff9fc0]);
          this.spark(x + ox, y, z + oz, this.rng.jitter(0.4), this.rng.range(1, 3), this.rng.jitter(0.4), col, this.rng.range(0.8, 1.8), -0.6);
        }
        break;
      case 'blessing': {
        const v = sim.villagers.byId(e.villagerId);
        const y = v ? v.y + 1 : sim.world.topY(Math.floor(e.x), Math.floor(e.z)) + 1;
        for (let i = 0; i < 70; i++) {
          const a = (i / 70) * Math.PI * 2;
          this.spark(e.x + ox + Math.cos(a) * 0.7, y + this.rng.range(0, 0.6), e.z + oz + Math.sin(a) * 0.7, Math.cos(a) * 0.3, this.rng.range(1.2, 2.6), Math.sin(a) * 0.3, this.rng.pick([0xfff0b0, 0xffd66e, 0xffffff]), this.rng.range(1, 2), -0.3);
        }
        this.burst(e.x + ox, y + 1.2, e.z + oz, 40, 2.2, [0xffe7a0, 0xfff7da], 1.2, -0.8);
        break;
      }
      case 'blight':
        for (let i = 0; i < 26 + e.crops; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * e.radius;
          const x = Math.round(e.x + Math.cos(a) * r);
          const z = Math.round(e.z + Math.sin(a) * r);
          this.dustAt(x + 0.5 + ox, sim.world.topY(x, z) + 1, z + 0.5 + oz);
        }
        for (let i = 0; i < 110; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * e.radius;
          const x = e.x + Math.cos(a) * r;
          const z = e.z + Math.sin(a) * r;
          const y = sim.world.topY(Math.floor(x), Math.floor(z)) + this.rng.range(1.5, 3.5);
          this.spark(x + ox, y, z + oz, this.rng.jitter(0.2), this.rng.range(-0.4, 0.2), this.rng.jitter(0.2), this.rng.pick([0x6b5a7a, 0x4d4a3a, 0x7a6a52]), this.rng.range(1.2, 2.4), -0.5);
        }
        break;
      case 'handImpact': {
        // Where something thrown comes down: dust, a thump.
        if (e.water) break;
        for (let i = 0; i < (e.what === 'villager' ? 14 : 50); i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(0, e.what === 'villager' ? 1 : 2.5);
          const x = Math.round(e.x + Math.cos(a) * r);
          const z = Math.round(e.z + Math.sin(a) * r);
          this.dustAt(x + 0.5 + ox, sim.world.topY(x, z) + 1, z + 0.5 + oz);
        }
        this.shake = Math.max(this.shake, e.what === 'villager' ? 0.25 : 0.7);
        break;
      }
      case 'meteor': {
        const y = e.y + 1;
        const S = TUNING.miracles.meteor;
        this.burst(e.x + 0.5 + ox, y, e.z + 0.5 + oz, 420, 16, [0xffe2a0, 0xff9a4a, 0xffffff, 0xa8e4ff], 2.4, -9);
        for (let i = 0; i < 220; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(0, S.blastRadius);
          const x = Math.round(e.x + Math.cos(a) * r);
          const z = Math.round(e.z + Math.sin(a) * r);
          this.dustAt(x + 0.5 + ox, sim.world.topY(x, z) + 1, z + 0.5 + oz);
        }
        this.shake = Math.max(this.shake, 2.2);
        this.flash = 1;
        break;
      }
      case 'quake':
        for (let i = 0; i < 240; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * e.radius;
          const x = Math.round(e.x + Math.cos(a) * r);
          const z = Math.round(e.z + Math.sin(a) * r);
          this.dustAt(x + 0.5 + ox, sim.world.topY(x, z) + 1, z + 0.5 + oz);
        }
        this.shake = Math.max(this.shake, 1.6);
        break;
      case 'wave':
        this.shake = Math.max(this.shake, 0.5);
        break;
      case 'greatOffering':
      case 'sacrifice': {
        // The fire flares up as the offering burns.
        const c = (sim.tribes[e.tribe ?? 0] ?? sim.tribe).village.center;
        const y = sim.world.topY(Math.round(c.x), Math.round(c.z)) + 1;
        this.burst(c.x + 0.5 + ox, y, c.z + 0.5 + oz, e.type === 'sacrifice' ? 160 : 90, 4, e.type === 'sacrifice' ? [0xff4a2a, 0xffa040, 0x7a1a10] : [0xffd27a, 0xff9a3a, 0xfff0c0], 1.8, 1.5);
        break;
      }
      case 'sickened':
      case 'plague': {
        const ids = e.type === 'plague' ? e.ids : [e.id];
        for (const id of ids) {
          const v = sim.villagers.byId(id);
          if (!v || v.inside) continue;
          for (let i = 0; i < 18; i++) this.spark(v.x + ox + this.rng.jitter(0.5), v.y + 1 + this.rng.range(0, 1), v.z + oz + this.rng.jitter(0.5), this.rng.jitter(0.2), this.rng.range(0.3, 0.9), this.rng.jitter(0.2), this.rng.pick([0x9dbb5a, 0x6f8a3a, 0xb8c87a]), this.rng.range(1, 2.2), 0);
        }
        break;
      }
      case 'dream': {
        const v = sim.villagers.byId(e.villagerId);
        if (!v) break;
        e.symbols.forEach((s, i) => {
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: this.glyphTexture(s), transparent: true, depthWrite: false, opacity: 0 }),
          );
          const baseY = v.y + 3 + i * 0.2;
          sprite.position.set(v.x + ox + (i - 1) * 1.3, baseY, v.z + oz);
          sprite.scale.setScalar(2.1);
          this.group.add(sprite);
          this.glyphs.push({ sprite, t: -i * 0.6, life: 7, baseY });
        });
        break;
      }
      default:
        break;
    }
  }

  /** Small camera shake request (rumble), read by the renderer. */
  shake = 0;
  /** A bright flash (a star landing), 1 → 0, read by the renderer. */
  flash = 0;

  update(sim: Sim, dt: number, time: number, alpha = 0): void {
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) this.onEvent(sim, e);
    this.lastSeq = sim.events.lastSeq;
    const ox = this.offsetX;
    const oz = this.offsetZ;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    // ---- pillars of Holy Light: fade in, shimmer, fade out
    const liveBeams = new Set(sim.miracles.beams.map((b) => b.id));
    for (const b of sim.miracles.beams) {
      if (this.beams.has(b.id)) continue;
      this.beams.set(b.id, { outer: this.beamMesh(0xffd98a, 0.22), inner: this.beamMesh(0xfff6dc, 0.5), fade: 0, x: b.x, z: b.z });
    }
    for (const [id, bm] of this.beams) {
      bm.fade = liveBeams.has(id) ? Math.min(1, bm.fade + dt * 1.2) : bm.fade - dt * 0.6;
      if (bm.fade <= 0) {
        for (const m of [bm.outer, bm.inner]) {
          this.group.remove(m);
          (m.material as THREE.Material).dispose();
        }
        this.beams.delete(id);
        continue;
      }
      const ground = sim.world.topY(Math.floor(bm.x), Math.floor(bm.z)) + 1;
      const h = 70;
      const wob = 1 + Math.sin(time * 3 + id) * 0.05;
      bm.outer.position.set(bm.x + ox, ground + h / 2, bm.z + oz);
      bm.outer.scale.set(2.4 * wob, h, 2.4 * wob);
      (bm.outer.material as THREE.MeshBasicMaterial).opacity = 0.22 * bm.fade;
      bm.inner.position.copy(bm.outer.position);
      bm.inner.scale.set(0.9, h, 0.9);
      (bm.inner.material as THREE.MeshBasicMaterial).opacity = 0.5 * bm.fade;
      // Motes rise through it.
      if (liveBeams.has(id) && this.rng.chance(Math.min(1, dt * 40))) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0, 2);
        this.spark(bm.x + ox + Math.cos(a) * r, ground, bm.z + oz + Math.sin(a) * r, 0, this.rng.range(2, 5), 0, this.rng.pick([0xfff2c2, 0xffd98a]), this.rng.range(1.5, 3), 0);
      }
    }

    // ---- hallowed ground: a warm glow that lingers for days, motes drifting up across it
    const liveHallows = new Map(sim.miracles.hallows.map((h) => [h.id, h] as const));
    for (const h of sim.miracles.hallows) {
      if (this.hallowed.has(h.id)) continue;
      this.hallowed.set(h.id, { outer: this.beamMesh(0xffe6a0, 0.16), inner: this.beamMesh(0xfff3d0, 0.12), fade: 0, x: h.x, z: h.z });
    }
    for (const [id, hm] of this.hallowed) {
      const h = liveHallows.get(id);
      hm.fade = h ? Math.min(1, hm.fade + dt * 0.8) : hm.fade - dt * 0.4;
      if (hm.fade <= 0) {
        for (const m of [hm.outer, hm.inner]) {
          this.group.remove(m);
          (m.material as THREE.Material).dispose();
        }
        this.hallowed.delete(id);
        continue;
      }
      const ground = sim.world.topY(Math.floor(hm.x), Math.floor(hm.z)) + 1;
      const r = h?.radius ?? 5;
      const breathe = 0.85 + 0.15 * Math.sin(time * 1.3 + id);
      // The glow sits on the ground across the whole area.
      hm.outer.position.set(hm.x + ox, ground + 1.5, hm.z + oz);
      hm.outer.scale.set(r, 3, r);
      (hm.outer.material as THREE.MeshBasicMaterial).opacity = 0.16 * hm.fade * breathe;
      // A thin, faint column above it, so it's seen from far off.
      hm.inner.position.set(hm.x + ox, ground + 25, hm.z + oz);
      hm.inner.scale.set(0.5, 50, 0.5);
      (hm.inner.material as THREE.MeshBasicMaterial).opacity = 0.12 * hm.fade * breathe;
      if (h && this.rng.chance(Math.min(1, dt * 30))) {
        const a = this.rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(this.rng.next()) * r;
        const x = hm.x + Math.cos(a) * rr;
        const z = hm.z + Math.sin(a) * rr;
        this.spark(x + ox, sim.world.topY(Math.floor(x), Math.floor(z)) + 1, z + oz, 0, this.rng.range(0.8, 2), 0, this.rng.pick([0xfff2c2, 0xffe6a0, 0xd8f0a0]), this.rng.range(2, 4), 0);
      }
    }

    // ---- the wrath: shaking ground, rains of fire, the wave's spray, swarms
    const wr = sim.miracles.wrath;
    for (const q of wr.quakes) {
      this.shake = Math.max(this.shake, 0.9);
      for (let i = 0; i < 4; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * q.radius;
        const x = Math.round(q.x + Math.cos(a) * r);
        const z = Math.round(q.z + Math.sin(a) * r);
        this.dustAt(x + 0.5 + ox, sim.world.topY(x, z) + 1, z + 0.5 + oz);
      }
    }
    for (const f of wr.firestorms) {
      // Burning stones streak down over the whole area; a burst where each one lands.
      for (let i = 0; i < 5; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * f.radius;
        const x = f.x + Math.cos(a) * r;
        const z = f.z + Math.sin(a) * r;
        const gy = sim.world.topY(Math.floor(x), Math.floor(z)) + 1;
        this.spark(x + ox + 6, gy + 34, z + oz - 3, -2.4, -16, 1.2, this.rng.pick([0xffb050, 0xff7a2a, 0xffe0a0]), 2, 0);
      }
      for (const h of f.hits) this.burst(h.x + 0.5 + ox, h.y + 1, h.z + 0.5 + oz, 26, 5, [0xffd28a, 0xff8a3a, 0xff5a1a], 1, -6);
      this.flash = Math.max(this.flash, 0.08 + 0.05 * Math.sin(time * 9));
    }
    for (const w of wr.waves) {
      if (w.drainAt >= 0) continue;
      const fx = w.ox + w.dx * w.front;
      const fz = w.oz + w.dz * w.front;
      const W = TUNING.miracles.wave;
      for (let i = 0; i < 24; i++) {
        const k = this.rng.range(-W.width / 2, W.width / 2);
        const x = fx - w.dz * k;
        const z = fz + w.dx * k;
        const y = Math.max(TUNING.terrain.seaLevel + 1, sim.world.topY(Math.floor(x), Math.floor(z)) + 1);
        this.spark(x + ox, y, z + oz, w.dx * 3 + this.rng.jitter(1), this.rng.range(2, 6), w.dz * 3 + this.rng.jitter(1), this.rng.pick([0xffffff, 0xdff2ff, 0xa8d8f0]), this.rng.range(0.5, 1.2), -9);
      }
    }
    // Swarms: each speck circles the swarm's center on its own little orbit.
    const liveSwarms = new Set(wr.swarms.map((s) => s.id));
    let si = 0;
    for (const s of wr.swarms) {
      if (si >= MAX_SWARMS) break;
      const shown = this.swarmShown.get(s.id) ?? { x: s.x, z: s.z };
      shown.x += (s.x - shown.x) * Math.min(1, dt * 4);
      shown.z += (s.z - shown.z) * Math.min(1, dt * 4);
      this.swarmShown.set(s.id, shown);
      const gy = Math.max(TUNING.terrain.seaLevel, sim.world.topY(Math.floor(s.x), Math.floor(s.z))) + 2;
      for (let i = 0; i < LOCUSTS; i++) {
        const r = 1 + ((i * 7919) % 97) / 97 * (TUNING.miracles.swarm.radius + 1.5);
        const sp = 1.5 + (i % 13) * 0.25;
        const a = time * sp * (i % 2 ? 1 : -1) + i;
        const o = (si * LOCUSTS + i) * 3;
        this.locustPos[o] = shown.x + ox + Math.cos(a) * r;
        this.locustPos[o + 1] = gy + 0.5 + ((i * 31) % 17) / 17 * 2.5 + Math.sin(time * 5 + i) * 0.4;
        this.locustPos[o + 2] = shown.z + oz + Math.sin(a * 1.3) * r;
      }
      si++;
    }
    for (const id of [...this.swarmShown.keys()]) if (!liveSwarms.has(id)) this.swarmShown.delete(id);
    this.locustPos.fill(-999, si * LOCUSTS * 3);
    (this.locusts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // ---- falling stars: a glowing head on a slant, trailing fire
    const star = sim.miracles.falling[0];
    this.starHead.visible = this.starGlow.visible = !!star;
    if (star) {
      const total = TUNING.miracles.meteor.fallTicks;
      const k = Math.max(0, Math.min(1, 1 - (star.impactTick - sim.tick - alpha) / total));
      const gy = sim.world.topY(Math.floor(star.x), Math.floor(star.z)) + 1;
      const fx = star.x + ox + 45 * (1 - k);
      const fy = gy + 80 * (1 - k);
      const fz = star.z + oz - 25 * (1 - k);
      this.starHead.position.set(fx, fy, fz);
      this.starGlow.position.set(fx, fy, fz);
      for (let i = 0; i < 6; i++)
        this.spark(fx + this.rng.jitter(0.6), fy + this.rng.jitter(0.6), fz + this.rng.jitter(0.6), this.rng.jitter(0.5), this.rng.jitter(0.5), this.rng.jitter(0.5), this.rng.pick([0xffc27a, 0xff8a3a, 0xfff0c8]), this.rng.range(0.4, 1.1), 0);
    }

    // ---- clouds (smoothly follow the sim's cloud positions; fade in/out)
    const live = new Set(sim.miracles.clouds.map((c) => c.id));
    for (const c of sim.miracles.clouds) {
      const s = this.cloudShown.get(c.id) ?? { x: c.x, z: c.z, fade: 0 };
      s.x += (c.x - s.x) * Math.min(1, dt * 6);
      s.z += (c.z - s.z) * Math.min(1, dt * 6);
      s.fade = Math.min(1, s.fade + dt * 1.5);
      this.cloudShown.set(c.id, s);
    }
    for (const [id, s] of this.cloudShown) {
      if (live.has(id)) continue;
      s.fade -= dt * 1.0;
      if (s.fade <= 0) this.cloudShown.delete(id);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let n = 0;
    let drops = 0;
    for (const [id, s] of this.cloudShown) {
      if (n >= CLOUD_PUFFS * MAX_CLOUDS) break;
      const ground = sim.world.topY(Math.floor(s.x), Math.floor(s.z));
      const cy = Math.max(ground, 20) + 11;
      this.cloudOffsets.forEach((o, i) => {
        const bob = Math.sin(time * 0.8 + i) * 0.15;
        p.set(s.x + ox + o.x * 1.2, cy + o.y + bob, s.z + oz + o.z);
        sc.setScalar((1.2 + (i % 3) * 0.35) * s.fade);
        q.setFromEuler(new THREE.Euler(0, (i * 0.7) % Math.PI, 0));
        this.cloudMesh.setMatrixAt(n++, m.compose(p, q, sc));
      });
      // Rain streaks under the cloud, only while it's alive.
      if (live.has(id)) {
        for (let i = 0; i < RAIN_PER_CLOUD && drops < MAX_CLOUDS * RAIN_PER_CLOUD; i++, drops++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * 4.5;
          const x = s.x + ox + Math.cos(a) * r;
          const z = s.z + oz + Math.sin(a) * r;
          const y = ground + 1 + ((time * 22 + i * 1.37) % (cy - ground - 1));
          this.rainPos.set([x, y, z, x, y - 0.9, z], drops * 6);
        }
      }
      // Wet patch follows the cloud.
      const w = this.wet.find((wp) => wp.cloudId === id);
      if (w) {
        w.x = s.x + ox;
        w.z = s.z + oz;
      }
    }
    for (let i = drops; i < MAX_CLOUDS * RAIN_PER_CLOUD; i++) this.rainPos.fill(-999, i * 6, i * 6 + 6);
    this.cloudMesh.count = n;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // ---- wet ground: soak under live clouds, dry slowly afterwards
    for (const w of this.wet) w.strength = live.has(w.cloudId) ? Math.min(1, w.strength + dt * 0.8) : w.strength - dt * 0.05;
    for (let i = this.wet.length - 1; i >= 0; i--) if (this.wet[i]!.strength <= 0) this.wet.splice(i, 1);
    const recent = this.wet.slice(-4);
    terrainUniforms.uWet.value.forEach((u, i) => {
      const w = recent[i];
      u.set(w?.x ?? 0, w?.z ?? 0, w?.r ?? 0, w?.strength ?? 0);
    });

    // ---- sparks
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 3;
      let life = this.sparkLife[i]!;
      if (life > 0) {
        life -= dt;
        this.sparkLife[i] = life;
        this.sparkVel[o + 1] = this.sparkVel[o + 1]! + this.sparkGrav[i]! * dt;
        for (let k = 0; k < 3; k++) this.sparkPos[o + k] = this.sparkPos[o + k]! + this.sparkVel[o + k]! * dt;
        // Fade with remaining life, with a little twinkle.
        const k = Math.max(0, life / this.sparkMax[i]!) * (0.65 + 0.35 * Math.sin(time * 20 + i));
        for (let c = 0; c < 3; c++) this.sparkCol[o + c] = this.sparkBase[o + c]! * k;
      } else this.sparkCol.fill(0, o, o + 3);
      // Dust: brown puffs that rise and spread, then settle out.
      let dl = this.dustLife[i]!;
      if (dl > 0) {
        dl -= dt;
        this.dustLife[i] = dl;
        this.dustVel[o + 1] = this.dustVel[o + 1]! - 1.5 * dt;
        for (let k = 0; k < 3; k++) this.dustPos[o + k] = this.dustPos[o + k]! + this.dustVel[o + k]! * dt;
        const f = Math.max(0, Math.min(1, dl));
        this.dustCol.set([0.55 * f + 0.2, 0.45 * f + 0.15, 0.32 * f + 0.1], o);
        if (dl <= 0) this.dustPos[o + 1] = -999;
      } else this.dustPos[o + 1] = -999;
    }
    (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.dust.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // ---- dream glyphs: fade in, drift up, fade out
    for (const g of this.glyphs) {
      g.t += dt;
      const k = g.t / g.life;
      const mat = g.sprite.material as THREE.SpriteMaterial;
      mat.opacity = g.t < 0 ? 0 : Math.min(1, g.t * 1.2) * (1 - Math.max(0, (k - 0.6) / 0.4));
      g.sprite.position.y = g.baseY + Math.max(0, g.t) * 0.35 + Math.sin(time * 1.3 + g.baseY) * 0.15;
    }
    for (const g of this.glyphs.filter((gl) => gl.t >= gl.life)) {
      this.group.remove(g.sprite);
      (g.sprite.material as THREE.Material).dispose();
    }
    this.glyphs = this.glyphs.filter((gl) => gl.t < gl.life);

    // ---- sleeper markers while Dream is armed
    let mk = 0;
    if (this.showSleepers) {
      for (const v of sim.villagers.alive) {
        if (v.action?.kind !== 'sleep' || v.action.phase !== 'work' || mk >= 256) continue;
        p.set(v.x + ox, v.y + 2.4 + Math.sin(time * 2 + v.id) * 0.2, v.z + oz);
        q.setFromEuler(new THREE.Euler(0, time + v.id, 0));
        this.markers.setMatrixAt(mk++, m.compose(p, q, sc.setScalar(1)));
      }
    }
    this.markers.count = mk;
    this.markers.instanceMatrix.needsUpdate = true;
  }
}
