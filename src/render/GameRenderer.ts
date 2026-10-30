import * as THREE from 'three';
import type { Sim } from '../sim/Sim';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../sim/time';
import { TUNING } from '../sim/tuning';
import { OrbitCamera } from './camera/OrbitCamera';
import { TerrainRenderer } from './chunks/TerrainRenderer';
import { Environment } from './Environment';
import { PostFX } from './post/PostFX';

const MAX_PIXEL_RATIO = 1.5;
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
  private elapsed = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  private frameSamples = 0;
  private frameTimeSum = 0;
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, remeshed: 0, pixelRatio: this.pixelRatio };

  constructor(container: HTMLElement, sim: Sim) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2500);
    this.scene.add(this.env.group);

    this.terrain = new TerrainRenderer(sim.world, sim.seed);
    this.terrain.buildAll();
    this.scene.add(this.terrain.group);

    const half = TUNING.world.sizeX / 2;
    const ground = sim.island.ground;
    const sizeX = TUNING.world.sizeX;
    this.orbit = new OrbitCamera(this.camera, this.renderer.domElement, {
      boundsRadius: half * 0.85,
      minDistance: 14,
      maxDistance: 340,
      minPitch: 25,
      maxPitch: 75,
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
    this.env.update(dayFrac, yearFrac, this.elapsed, dt);
    this.orbit.update(Math.min(dt, 0.1));

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
