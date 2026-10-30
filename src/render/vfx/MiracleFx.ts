import * as THREE from 'three';
import type { SimEvent } from '../../sim/events';
import type { DreamSymbol } from '../../sim/miracles/defs';
import { Rng } from '../../sim/rng';
import type { Sim } from '../../sim/Sim';
import { SYMBOL_PATHS } from '../../ui/symbols';
import { terrainUniforms } from '../chunks/terrainMaterials';

const SPARKS = 900;
const CLOUD_PUFFS = 18;
const MAX_CLOUDS = 4;
const RAIN_PER_CLOUD = 160;

interface WetPatch {
  x: number;
  z: number;
  r: number;
  strength: number;
  cloudId: number;
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
 * the player only), sleeper markers while Dream is armed, and the targeting reticle.
 */
export class MiracleFx {
  readonly group = new THREE.Group();
  private readonly rng = new Rng('miracle-fx');
  private lastSeq = 0;

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

  update(sim: Sim, dt: number, time: number): void {
    for (const e of sim.events.since(this.lastSeq)) this.onEvent(sim, e);
    this.lastSeq = sim.events.lastSeq;
    const ox = this.offsetX;
    const oz = this.offsetZ;
    this.shake = Math.max(0, this.shake - dt * 2);

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
