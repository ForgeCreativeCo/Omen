import * as THREE from 'three';
import type { Sim } from '../sim/Sim';
import { TICKS_PER_DAY } from '../sim/time';
import { TUNING } from '../sim/tuning';

const SKY_DAY = new THREE.Color(0xa9cfe6);
const SKY_DUSK = new THREE.Color(0xe8a27c);
const SKY_NIGHT = new THREE.Color(0x1b2440);

/**
 * Reads sim state each frame and draws it. Never mutates the sim.
 * M0: a placeholder plinth plus a day/night sky so the loop is visibly alive.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  private readonly hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b5a45, 1.0);
  private readonly sky = new THREE.Color();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const { sizeX, sizeZ } = TUNING.world;
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.camera.position.set(sizeX * 1.4, sizeX * 1.1, sizeZ * 1.4);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = this.sky;
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -sizeX * 0.8;
    s.right = s.top = sizeX * 0.8;
    s.far = 600;
    this.scene.add(this.sun);

    this.addPlaceholderIsland();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private addPlaceholderIsland(): void {
    const { sizeX, sizeZ } = TUNING.world;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX * 0.7, 6, sizeZ * 0.7),
      new THREE.MeshStandardMaterial({ color: 0x7fa65a, roughness: 0.9 }),
    );
    top.receiveShadow = top.castShadow = true;
    const under = new THREE.Mesh(
      new THREE.ConeGeometry(sizeX * 0.45, 40, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a6d50, roughness: 1, flatShading: true }),
    );
    under.rotation.x = Math.PI;
    under.position.y = -23;
    this.scene.add(top, under);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** @param alpha interpolation between the last two sim ticks, 0..1 */
  render(sim: Sim, alpha: number): void {
    const dayFrac = (sim.calendar.dayFraction + alpha / TICKS_PER_DAY) % 1;

    // Sun travels east→west; height peaks at midday (dayFraction 0.5).
    const angle = (dayFrac - 0.25) * Math.PI * 2;
    const height = Math.sin(angle);
    this.sun.position.set(Math.cos(angle) * 200, height * 200, 80);
    const daylight = THREE.MathUtils.smoothstep(height, -0.15, 0.25);
    this.sun.intensity = 2.2 * daylight;
    this.hemi.intensity = 0.25 + 0.85 * daylight;

    const duskness = 1 - Math.min(1, Math.abs(height) / 0.3);
    this.sky.copy(SKY_NIGHT).lerp(SKY_DAY, daylight).lerp(SKY_DUSK, duskness * 0.6);

    this.renderer.render(this.scene, this.camera);
  }
}
