import * as THREE from 'three';
import { Rng } from '../../sim/rng';
import type { SimEvent } from '../../sim/events';
import type { Sim } from '../../sim/Sim';
import { M } from '../../sim/world/materials';

const FIRE_PARTICLES = 700;
const RAIN_DROPS = 1600;

/**
 * Environmental effects driven by sim state: flames and embers (burning voxels and
 * fire pits), the fire-pit glow at night, rain streaks, storm darkening, and
 * lightning bolts with a flash. Visual-only randomness uses its own stream.
 */
export class WeatherFx {
  readonly group = new THREE.Group();
  private readonly rng = new Rng('fx');
  // Fire particles
  private readonly firePos = new Float32Array(FIRE_PARTICLES * 3);
  private readonly fireCol = new Float32Array(FIRE_PARTICLES * 3);
  private readonly fireLife = new Float32Array(FIRE_PARTICLES);
  private readonly fireVel = new Float32Array(FIRE_PARTICLES * 3);
  private readonly fire: THREE.Points;
  private nextFire = 0;
  private readonly pitLight = new THREE.PointLight(0xff8a3a, 0, 22, 1.6);
  // Rain
  private readonly rain: THREE.LineSegments;
  private readonly rainPos = new Float32Array(RAIN_DROPS * 6);
  private rainAmount = 0;
  /** 0..1 how overcast it looks (rain/storm), smoothed. */
  overcast = 0;
  // Lightning
  private readonly bolts: { line: THREE.Line; t: number }[] = [];
  private readonly boltMat = new THREE.LineBasicMaterial({ color: 0xf4f2ff, transparent: true });
  /** 0..1 screen flash, decays. */
  flash = 0;
  /** Camera shake amount, decays. */
  shake = 0;
  private lastSeq = 0;

  constructor(private readonly offsetX: number, private readonly offsetZ: number) {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('color', new THREE.BufferAttribute(this.fireCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.fire = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        size: 0.45,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.fire.frustumCulled = false;
    this.group.add(this.fire, this.pitLight);

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0xbfd4e6, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    for (let i = 0; i < RAIN_DROPS; i++) this.resetDrop(i, true);
    this.group.add(this.rain);
  }

  private resetDrop(i: number, anyHeight: boolean): void {
    const r = Math.sqrt(this.rng.next()) * 60;
    const a = this.rng.range(0, Math.PI * 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = anyHeight ? this.rng.range(0, 70) : this.rng.range(55, 75);
    const o = i * 6;
    this.rainPos.set([x, y, z, x + 0.15, y - 1.4, z + 0.05], o);
  }

  private emitFire(x: number, y: number, z: number, intense: number): void {
    const i = this.nextFire;
    this.nextFire = (this.nextFire + 1) % FIRE_PARTICLES;
    this.firePos.set([x + this.rng.jitter(0.4), y + this.rng.range(0, 0.4), z + this.rng.jitter(0.4)], i * 3);
    this.fireVel.set([this.rng.jitter(0.3), this.rng.range(1.2, 2.4) * intense, this.rng.jitter(0.3)], i * 3);
    this.fireLife[i] = this.rng.range(0.4, 0.9);
  }

  update(sim: Sim, dt: number, time: number, nightness: number): void {
    const ox = this.offsetX;
    const oz = this.offsetZ;

    // ---- events
    for (const e of sim.events.since(this.lastSeq)) this.onEvent(e);
    this.lastSeq = sim.events.lastSeq;

    // ---- fire: emit from burning voxels (sampled) and fire pits
    const burning = sim.fire.burning;
    if (burning.size) {
      const budget = Math.min(burning.size, 60);
      const step = Math.max(1, Math.floor(burning.size / budget));
      let i = 0;
      for (const k of burning.keys()) {
        if (i++ % step) continue;
        const [x, y, z] = sim.fire.unkey(k);
        if (this.rng.chance(0.7)) this.emitFire(x + 0.5 + ox, y + 1, z + 0.5 + oz, 1.2);
      }
    }
    let mainPit: { x: number; y: number; z: number } | null = null;
    for (const s of sim.village.structures) {
      if (s.kind !== 'firePit' || !s.complete) continue;
      const ember = s.steps.find((st) => st.mat === M.EMBER);
      if (!ember) continue;
      if (!mainPit) mainPit = ember;
      // Bigger fire at the evening gathering.
      const f = sim.calendar.dayFraction;
      const evening = f > 0.7 || f < 0.25;
      if (this.rng.chance(evening ? 0.9 : 0.25)) this.emitFire(ember.x + 0.5 + ox, ember.y + 0.9, ember.z + 0.5 + oz, evening ? 0.9 : 0.5);
    }
    if (mainPit) {
      this.pitLight.position.set(mainPit.x + 0.5 + ox, mainPit.y + 2, mainPit.z + 0.5 + oz);
      const flicker = 0.85 + 0.15 * Math.sin(time * 13) * Math.sin(time * 7.3);
      this.pitLight.intensity = (6 + 40 * nightness) * flicker;
    }

    for (let i = 0; i < FIRE_PARTICLES; i++) {
      let life = this.fireLife[i]!;
      if (life <= 0) {
        this.fireCol.set([0, 0, 0], i * 3);
        continue;
      }
      life -= dt;
      this.fireLife[i] = life;
      const o = i * 3;
      this.firePos[o] = this.firePos[o]! + this.fireVel[o]! * dt;
      this.firePos[o + 1] = this.firePos[o + 1]! + this.fireVel[o + 1]! * dt;
      this.firePos[o + 2] = this.firePos[o + 2]! + this.fireVel[o + 2]! * dt;
      const k = Math.max(0, life / 0.9);
      // White-yellow core cooling to deep orange.
      this.fireCol[o] = 1.0 * k;
      this.fireCol[o + 1] = (0.35 + 0.5 * k) * k;
      this.fireCol[o + 2] = 0.12 * k * k;
    }
    (this.fire.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.fire.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // ---- rain
    const target = sim.weather.precipitation === 'storm' ? 1 : sim.weather.raining ? 0.6 : 0;
    this.rainAmount += (target - this.rainAmount) * Math.min(1, dt * 1.5);
    this.overcast = this.rainAmount;
    this.rain.visible = this.rainAmount > 0.02;
    if (this.rain.visible) {
      const active = Math.floor(RAIN_DROPS * this.rainAmount);
      const fall = 38 * dt;
      const wx = Math.cos(sim.weather.windAngle) * sim.weather.windStrength * 6 * dt;
      const wz = Math.sin(sim.weather.windAngle) * sim.weather.windStrength * 6 * dt;
      for (let i = 0; i < RAIN_DROPS; i++) {
        const o = i * 6;
        if (i >= active) {
          this.rainPos[o + 1] = -999;
          this.rainPos[o + 4] = -999;
          continue;
        }
        for (const j of [0, 3]) {
          this.rainPos[o + j] = this.rainPos[o + j]! + wx;
          this.rainPos[o + j + 1] = this.rainPos[o + j + 1]! - fall;
          this.rainPos[o + j + 2] = this.rainPos[o + j + 2]! + wz;
        }
        if (this.rainPos[o + 1]! < 5) this.resetDrop(i, false);
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.3 * this.rainAmount;
    }

    // ---- bolts
    for (const b of this.bolts) {
      b.t -= dt;
      (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.t / 0.35);
    }
    for (const b of this.bolts.filter((b) => b.t <= 0)) {
      this.group.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    this.bolts.splice(0, this.bolts.length, ...this.bolts.filter((b) => b.t > 0));
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  private onEvent(e: SimEvent): void {
    if (e.type !== 'lightning') return;
    const x = e.x + 0.5 + this.offsetX;
    const z = e.z + 0.5 + this.offsetZ;
    const pts: THREE.Vector3[] = [];
    let px = x + this.rng.jitter(6);
    let pz = z + this.rng.jitter(6);
    for (let y = 80; y > e.y + 1; y -= this.rng.range(3, 7)) {
      pts.push(new THREE.Vector3(px, y, pz));
      // Converge on the strike point as it nears the ground.
      const k = Math.min(1, 6 / Math.max(1, y - e.y));
      px += (x - px) * k + this.rng.jitter(1.6);
      pz += (z - pz) * k + this.rng.jitter(1.6);
    }
    pts.push(new THREE.Vector3(x, e.y + 1, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone());
    this.group.add(line);
    this.bolts.push({ line, t: 0.35 });
    this.flash = 1;
    this.shake = 0.6;
    for (let i = 0; i < 25; i++) this.emitFire(x, e.y + 1, z, 2);
  }
}
