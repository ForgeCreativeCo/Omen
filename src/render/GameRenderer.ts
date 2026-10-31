import * as THREE from 'three';
import type { Sim } from '../sim/Sim';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../sim/time';
import { TUNING } from '../sim/tuning';
import { OrbitCamera, type PointerHook } from './camera/OrbitCamera';
import { pickGround, type GroundHit } from './picking';
import { TerrainRenderer } from './chunks/TerrainRenderer';
import { Environment } from './Environment';
import { PostFX } from './post/PostFX';
import { VillagerRenderer } from './villagers/VillagerRenderer';
import { WeatherFx } from './vfx/WeatherFx';
import { MiracleFx } from './vfx/MiracleFx';
import { HandFx } from './vfx/HandFx';
import { WitnessLines } from './vfx/WitnessLines';

/** Pixel-ratio ceiling and shadow detail per graphics quality (settings). */
export type Quality = 'low' | 'medium' | 'high';
const QUALITY: Record<Quality, { maxRatio: number; shadows: number }> = {
  low: { maxRatio: 0.75, shadows: 0 },
  medium: { maxRatio: 1, shadows: 1024 },
  high: { maxRatio: 1.5, shadows: 2048 },
};
const MAX_PIXEL_RATIO = QUALITY.high.maxRatio;
const MIN_PIXEL_RATIO = 0.75;

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  remeshed: number;
  pixelRatio: number;
}

/**
 * Reads sim state each frame and draws it. Never mutates the sim.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitCamera;
  readonly post: PostFX;
  private readonly terrain: TerrainRenderer;
  private readonly env = new Environment();
  readonly villagers: VillagerRenderer;
  readonly fx: WeatherFx;
  readonly miracleFx: MiracleFx;
  readonly handFx: HandFx;
  readonly witnessLines: WitnessLines;
  private readonly raycaster = new THREE.Raycaster();
  /** Fired on a tap/click that wasn't a drag (screen coords). */
  onTap: ((x: number, y: number) => void) | null = null;
  /** Tool that may take over drags (miracle brushes). */
  pointerHook: PointerHook | null = null;
  private readonly world: Sim['world'];
  private floodPlane: THREE.Mesh | null = null;
  /** No camera shake, softer lightning flashes (settings). */
  reducedMotion = false;
  private guide: THREE.Group | null = null;
  private elapsed = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  private frameSamples = 0;
  private frameTimeSum = 0;
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, remeshed: 0, pixelRatio: this.pixelRatio };

  /** Apply a graphics quality: resolution ceiling and sun shadows. */
  setQuality(q: Quality): void {
    const Q = QUALITY[q];
    this.pixelRatio = Math.min(window.devicePixelRatio, Q.maxRatio);
    this.env.setShadows(Q.shadows);
    this.resize();
  }

  /**
   * The Warning's opening vision: a ghost of the sea at the height it will reach,
   * over the island centered at (cx, cz) in voxel coords. null hides it.
   */
  setFloodPreview(level: number | null, cx = 0, cz = 0): void {
    if (level === null) {
      if (this.floodPlane) this.floodPlane.visible = false;
      return;
    }
    if (!this.floodPlane) {
      const r = TUNING.terrain.platformRadius + 4;
      this.floodPlane = new THREE.Mesh(
        new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x2f6aa8, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      this.floodPlane.renderOrder = 3;
      this.scene.add(this.floodPlane);
    }
    const half = TUNING.world.sizeX / 2;
    this.floodPlane.position.set(cx - half, level + 1, cz - half);
    this.floodPlane.visible = true;
  }

  /** Tutorial marker: a soft beam and ring over voxel column (x, z). null hides it. */
  setGuide(x: number | null, z = 0): void {
    if (x === null) {
      if (this.guide) this.guide.visible = false;
      return;
    }
    if (!this.guide) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.35, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 14, 16, 1, true).translate(0, 7, 0), mat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40).rotateX(-Math.PI / 2), mat.clone());
      ring.name = 'ring';
      this.guide = new THREE.Group();
      this.guide.add(beam, ring);
      this.guide.renderOrder = 4;
      this.scene.add(this.guide);
    }
    const half = TUNING.world.sizeX / 2;
    const y = this.world.topY(Math.floor(x), Math.floor(z)) + 1.05;
    this.guide.position.set(Math.floor(x) + 0.5 - half, y, Math.floor(z) + 0.5 - half);
    this.guide.visible = true;
  }

  constructor(container: HTMLElement, sim: Sim) {
    this.world = sim.world;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2500);
    this.scene.add(this.env.group);

    this.terrain = new TerrainRenderer(sim.world, sim.seed);
    this.terrain.buildAll();
    this.scene.add(this.terrain.group);
    const half0 = TUNING.world.sizeX / 2;
    this.villagers = new VillagerRenderer(-half0, -half0);
    this.fx = new WeatherFx(-half0, -half0);
    this.miracleFx = new MiracleFx(-half0, -half0);
    this.handFx = new HandFx(-half0, -half0);
    this.witnessLines = new WitnessLines(-half0, -half0);
    this.scene.add(this.witnessLines.group);
    this.scene.add(this.villagers.group, this.fx.group, this.miracleFx.group, this.handFx.group);

    const half = TUNING.world.sizeX / 2;
    const ground = sim.island.ground;
    const sizeX = TUNING.world.sizeX;
    this.orbit = new OrbitCamera(this.camera, this.renderer.domElement, {
      boundsRadius: half * 0.85,
      minDistance: 14,
      maxDistance: 620,
      minPitch: 25,
      maxPitch: 75,
      onTap: (x, y) => this.onTap?.(x, y),
      pointerHook: {
        down: (e) => this.pointerHook?.down(e) ?? false,
        move: (e) => this.pointerHook?.move(e),
        up: (e) => this.pointerHook?.up(e),
      },
      groundHeightAt: (x, z) => {
        // Scene → voxel coords; average a small area so the target glides over bumps.
        let sum = 0;
        let n = 0;
        for (let dz = -4; dz <= 4; dz += 4)
          for (let dx = -4; dx <= 4; dx += 4) {
            const vx = Math.floor(x + half + dx);
            const vz = Math.floor(z + half + dz);
            if (vx < 0 || vz < 0 || vx >= sizeX || vz >= sizeX) continue;
            const g = ground[vx + vz * sizeX] as number;
            if (g < 0) continue;
            sum += Math.max(g, TUNING.terrain.seaLevel) + 1;
            n++;
          }
        return n ? sum / n : TUNING.terrain.seaLevel;
      },
    });
    const v = sim.island.landmarks.villageSite;
    this.orbit.focus((v.x - half) * 0.4, (v.z - half) * 0.4);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** The voxel under a screen point (ground or water), or null. */
  groundAt(clientX: number, clientY: number): GroundHit | null {
    const el = this.renderer.domElement;
    return pickGround(this.world, this.camera, (clientX / el.clientWidth) * 2 - 1, -(clientY / el.clientHeight) * 2 + 1);
  }

  /** Nearest sleeping villager to a screen point (indoor sleepers count, at their door), or -1. */
  pickSleeper(sim: Sim, clientX: number, clientY: number): number {
    const el = this.renderer.domElement;
    const half = TUNING.world.sizeX / 2;
    const p = new THREE.Vector3();
    let best = -1;
    let bestD = 44;
    for (const v of sim.villagers.alive) {
      if (v.action?.kind !== 'sleep' || v.action.phase !== 'work') continue;
      p.set(v.x - half, v.y + 2.4, v.z - half).project(this.camera);
      if (p.z > 1) continue;
      const d = Math.hypot(((p.x + 1) / 2) * el.clientWidth - clientX, ((1 - p.y) / 2) * el.clientHeight - clientY);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  /** Villager id under a screen point, or -1. */
  pickVillager(sim: Sim, clientX: number, clientY: number): number {
    const el = this.renderer.domElement;
    const ndc = new THREE.Vector2((clientX / el.clientWidth) * 2 - 1, -(clientY / el.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.villagers.pickables, false)[0];
    if (hit?.instanceId !== undefined) return this.villagers.villagerAt(hit.instanceId);
    // Villagers are tiny: fall back to the nearest one on screen within a finger's width.
    const half = TUNING.world.sizeX / 2;
    const p = new THREE.Vector3();
    let best = -1;
    let bestD = 24;
    for (const v of sim.villagers.alive) {
      if (v.inside) continue;
      p.set(v.x - half, v.y + 0.9, v.z - half).project(this.camera);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * el.clientWidth;
      const sy = ((1 - p.y) / 2) * el.clientHeight;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param alpha interpolation between the last two sim ticks, 0..1
   * @param dt real seconds since last frame
   */
  render(sim: Sim, alpha: number, dt: number): void {
    this.elapsed += dt;
    const cal = sim.calendar;
    const dayFrac = (cal.dayFraction + alpha / TICKS_PER_DAY) % 1;
    const yearFrac = ((cal.day % DAYS_PER_YEAR) + dayFrac) / DAYS_PER_YEAR;

    this.terrain.update();
    const night = this.env.update(dayFrac, yearFrac, this.elapsed, dt, this.fx.overcast, Math.max(this.fx.flash, this.miracleFx.flash) * (this.reducedMotion ? 0.25 : 1));
    this.fx.update(sim, dt, this.elapsed, night);
    this.miracleFx.update(sim, dt, this.elapsed, alpha);
    this.handFx.update(sim, dt);
    this.witnessLines.update(sim, this.elapsed);
    this.villagers.update(sim, alpha, dt, this.elapsed);
    this.orbit.update(Math.min(dt, 0.1));
    if (this.guide?.visible) {
      const ring = this.guide.getObjectByName('ring');
      const k = 1 + 0.25 * Math.sin(this.elapsed * 3);
      ring?.scale.set(k, 1, k);
    }
    const shake = this.reducedMotion ? 0 : Math.max(this.fx.shake, this.miracleFx.shake);
    if (shake > 0) {
      const s = shake * 0.35;
      this.camera.position.x += Math.sin(this.elapsed * 61) * s;
      this.camera.position.y += Math.sin(this.elapsed * 47) * s;
    }

    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.post.render(dt);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.remeshed = this.terrain.lastRemeshed;
    this.stats.pixelRatio = this.pixelRatio;
    this.adaptResolution(dt);
  }

  /**
   * Fill rate is the bottleneck on integrated GPUs and tablets, so if frames run
   * slow we step the pixel ratio down. It never steps back up within a session.
   */
  private adaptResolution(dt: number): void {
    // Ignore hitches and throttled background tabs.
    if (dt > 0.1) return;
    this.frameSamples++;
    this.frameTimeSum += dt;
    if (this.frameSamples < 90) return;
    const avg = this.frameTimeSum / this.frameSamples;
    this.frameSamples = 0;
    this.frameTimeSum = 0;
    if (avg > 1 / 52 && this.pixelRatio > MIN_PIXEL_RATIO) {
      this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio - 0.25);
      this.resize();
    }
  }
}
