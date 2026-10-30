import * as THREE from 'three';
import { Rng } from '../sim/rng';
import { TUNING } from '../sim/tuning';
import { terrainUniforms } from './chunks/terrainMaterials';

/** One point on the day palette; `at` is the fraction of the day (0 = midnight). */
interface Key {
  at: number;
  zenith: number;
  horizon: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
}

const { dawnAt, duskAt } = TUNING.time;
const DAY_KEYS: Key[] = [
  { at: 0.0, zenith: 0x0d1428, horizon: 0x26355a, sun: 0x8fa6d8, sunI: 0.0, hemiSky: 0x6878b8, hemiGround: 0x2a2a3a, hemiI: 0.9 },
  { at: dawnAt - 0.04, zenith: 0x1c2648, horizon: 0x4a4c78, sun: 0xff9a6a, sunI: 0.0, hemiSky: 0x7078a8, hemiGround: 0x3a3238, hemiI: 0.85 },
  { at: dawnAt + 0.02, zenith: 0x5a7bb0, horizon: 0xf2a97a, sun: 0xffa060, sunI: 1.1, hemiSky: 0xd9b8a8, hemiGround: 0x5a4636, hemiI: 0.8 },
  { at: dawnAt + 0.1, zenith: 0x79abd8, horizon: 0xcfe0ea, sun: 0xffe2bb, sunI: 2.0, hemiSky: 0xcfe2f5, hemiGround: 0x6b5a45, hemiI: 1.0 },
  { at: 0.5, zenith: 0x6fa6dc, horizon: 0xcde4f0, sun: 0xfff3e0, sunI: 2.4, hemiSky: 0xd4e8ff, hemiGround: 0x6f5e48, hemiI: 1.05 },
  { at: duskAt - 0.1, zenith: 0x759fd0, horizon: 0xe3d8c8, sun: 0xffd9a8, sunI: 2.0, hemiSky: 0xd6dcea, hemiGround: 0x6b5a45, hemiI: 1.0 },
  { at: duskAt - 0.02, zenith: 0x4d5f98, horizon: 0xf09468, sun: 0xff8a50, sunI: 1.1, hemiSky: 0xd8a890, hemiGround: 0x5a4030, hemiI: 0.8 },
  { at: duskAt + 0.04, zenith: 0x1e2448, horizon: 0x5a4470, sun: 0xff7050, sunI: 0.0, hemiSky: 0x7078a8, hemiGround: 0x3a3238, hemiI: 0.85 },
  { at: 1.0, zenith: 0x0d1428, horizon: 0x26355a, sun: 0x8fa6d8, sunI: 0.0, hemiSky: 0x6878b8, hemiGround: 0x2a2a3a, hemiI: 0.9 },
];

/** Foliage tint and desaturation at the middle of each season. */
const SEASON_TINTS: { tint: number; desat: number; light: number }[] = [
  { tint: 0xe8ffd8, desat: 0.0, light: 0xfff8f0 }, // spring: fresh green
  { tint: 0xfff0b0, desat: 0.05, light: 0xfff2dc }, // summer: gold
  { tint: 0xffb070, desat: 0.05, light: 0xffe6cc }, // autumn: orange
  { tint: 0xf4f6ff, desat: 0.55, light: 0xe8f0ff }, // winter: pale
];

const c = (hex: number) => new THREE.Color(hex);
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpHex(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  return out.copy(tmpA.setHex(a)).lerp(tmpB.setHex(b), t);
}

/**
 * Sky dome, sun/moon/hemisphere lights, drifting clouds around and below the
 * island, and the season tint fed to terrain materials.
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly moon = new THREE.DirectionalLight(0x8fa6d8, 0.25);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly skyUniforms = {
    uZenith: { value: c(0x6fa6dc) },
    uHorizon: { value: c(0xcde4f0) },
    uBelow: { value: c(0xcde4f0) },
  };
  private readonly clouds = new THREE.Group();
  private readonly cloudCenters: { pos: THREE.Vector3; speed: number }[] = [];
  private cloudPuffs: { cloud: number; offset: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  private cloudMesh: THREE.InstancedMesh | null = null;
  private readonly cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa4b4, emissiveIntensity: 0.35, flatShading: true });
  private readonly seasonLight = new THREE.Color(1, 1, 1);
  readonly horizon = new THREE.Color();

  constructor() {
    const half = TUNING.world.sizeX / 2;
    this.group.add(this.buildSky(), this.hemi, this.moon, this.sun, this.sun.target, this.clouds);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -half * 1.05;
    cam.right = cam.top = half * 1.05;
    cam.near = 1;
    cam.far = 500;

    this.buildClouds();
  }

  private buildSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uBelow;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 col = y > 0.0
            ? mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.85, y), 0.8))
            : mix(uHorizon, uBelow, smoothstep(0.0, -0.6, y));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    return sky;
  }

  private buildClouds(): void {
    // Visual-only randomness; a fixed seed keeps the look stable between reloads.
    const rng = new Rng('clouds');
    const R = TUNING.world.sizeX / 2;
    const puffs: { cloud: number; offset: THREE.Vector3; scale: THREE.Vector3 }[] = [];
    for (let i = 0; i < 22; i++) {
      const below = i < 14;
      const ang = rng.range(0, Math.PI * 2);
      const dist = below ? rng.range(R * 0.2, R * 1.5) : rng.range(R * 1.3, R * 2.4);
      this.cloudCenters.push({
        pos: new THREE.Vector3(Math.cos(ang) * dist, below ? rng.range(-34, -8) : rng.range(40, 70), Math.sin(ang) * dist),
        speed: rng.range(0.004, 0.012) * (rng.chance(0.5) ? 1 : -1),
      });
      const blobs = rng.int(3, 6);
      const size = below ? rng.range(6, 11) : rng.range(5, 9);
      for (let b = 0; b < blobs; b++) {
        const s = size * rng.range(0.6, 1.1);
        puffs.push({
          cloud: i,
          offset: new THREE.Vector3(rng.jitter(size * 1.2), rng.jitter(size * 0.25), rng.jitter(size * 0.8)),
          scale: new THREE.Vector3(s, s * 0.55, s),
        });
      }
    }
    // All puffs in one instanced draw call.
    this.cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMat, puffs.length);
    this.cloudMesh.frustumCulled = false;
    this.cloudPuffs = puffs;
    this.clouds.add(this.cloudMesh);
    this.placeClouds();
  }

  private placeClouds(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    this.cloudPuffs.forEach((puff, i) => {
      p.copy(this.cloudCenters[puff.cloud]!.pos).add(puff.offset);
      this.cloudMesh!.setMatrixAt(i, m.compose(p, q, puff.scale));
    });
    this.cloudMesh!.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param dayFraction 0..1, 0 = midnight
   * @param yearFraction 0..1 through the year, 0 = start of spring
   */
  /**
   * @param overcast 0..1 rain/storm gloom
   * @param flash 0..1 lightning flash
   * @returns 0..1 how dark it is (for fire glow)
   */
  update(dayFraction: number, yearFraction: number, realTime: number, dt: number, overcast = 0, flash = 0): number {
    // ---- palette
    let i = 0;
    while (i < DAY_KEYS.length - 2 && dayFraction > DAY_KEYS[i + 1]!.at) i++;
    const a = DAY_KEYS[i]!;
    const b = DAY_KEYS[i + 1]!;
    const t = THREE.MathUtils.clamp((dayFraction - a.at) / (b.at - a.at), 0, 1);

    this.updateSeason(yearFraction);

    lerpHex(a.zenith, b.zenith, t, this.skyUniforms.uZenith.value);
    lerpHex(a.horizon, b.horizon, t, this.horizon);
    this.skyUniforms.uHorizon.value.copy(this.horizon);
    this.skyUniforms.uBelow.value.copy(this.horizon).lerp(this.skyUniforms.uZenith.value, 0.35);
    terrainUniforms.uFadeColor.value.copy(this.horizon);

    lerpHex(a.sun, b.sun, t, this.sun.color).multiply(this.seasonLight);
    lerpHex(a.hemiSky, b.hemiSky, t, this.hemi.color);
    lerpHex(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);

    // ---- sun arc: rises at dawnAt, sets at duskAt, peaks between
    const dayT = (dayFraction - dawnAt) / (duskAt - dawnAt);
    const sunAngle = dayT * Math.PI; // 0 = east horizon, PI = west horizon
    const elev = Math.sin(sunAngle);
    const dir = new THREE.Vector3(Math.cos(sunAngle), Math.max(elev, 0.04) * 1.1, 0.35).normalize();
    this.sun.position.copy(dir).multiplyScalar(200);
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t) * THREE.MathUtils.smoothstep(elev, -0.02, 0.12);
    this.sun.castShadow = this.sun.intensity > 0.05;

    // Moon opposite the sun, only at night.
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.15, 0.05);
    this.moon.position.set(-dir.x * 200, Math.abs(dir.y) * 150 + 60, -dir.z * 200);
    this.moon.intensity = 0.9 * night;

    // ---- weather: storms grey the sky and dim the sun; lightning flashes everything
    if (overcast > 0) {
      const grey = tmpB.setHex(0x7d8794);
      this.skyUniforms.uZenith.value.lerp(grey, overcast * 0.7);
      this.horizon.lerp(grey, overcast * 0.6);
      this.skyUniforms.uHorizon.value.copy(this.horizon);
      terrainUniforms.uFadeColor.value.copy(this.horizon);
      this.sun.intensity *= 1 - 0.75 * overcast;
      this.hemi.intensity *= 1 - 0.25 * overcast;
    }
    if (flash > 0) {
      this.hemi.intensity += 2.5 * flash;
      this.skyUniforms.uZenith.value.lerp(tmpB.setHex(0xe8ecff), flash * 0.6);
    }

    // ---- clouds: drift, pick up the horizon tint
    this.cloudMat.color.copy(this.horizon).lerp(tmpA.setHex(0xffffff), 0.55);
    this.cloudMat.emissive.copy(this.horizon).multiplyScalar(0.35);
    for (const cloud of this.cloudCenters) {
      const { x, z } = cloud.pos;
      const ca = Math.cos(cloud.speed * dt);
      const sa = Math.sin(cloud.speed * dt);
      cloud.pos.x = x * ca - z * sa;
      cloud.pos.z = x * sa + z * ca;
    }
    this.placeClouds();

    terrainUniforms.uTime.value = realTime;
    return night;
  }

  private updateSeason(yearFraction: number): void {
    // Seasons are centered at 1/8, 3/8, 5/8, 7/8 of the year; blend between neighbors.
    const f = yearFraction * 4 - 0.5;
    const i0 = ((Math.floor(f) % 4) + 4) % 4;
    const i1 = (i0 + 1) % 4;
    const t = THREE.MathUtils.smoothstep(f - Math.floor(f), 0.25, 0.75);
    const s0 = SEASON_TINTS[i0]!;
    const s1 = SEASON_TINTS[i1]!;
    lerpHex(s0.tint, s1.tint, t, terrainUniforms.uSeasonTint.value);
    terrainUniforms.uSeasonDesat.value = THREE.MathUtils.lerp(s0.desat, s1.desat, t);
    lerpHex(s0.light, s1.light, t, this.seasonLight);
  }
}
