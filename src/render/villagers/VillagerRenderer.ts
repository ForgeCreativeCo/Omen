import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sim } from '../../sim/Sim';
import type { Role, Villager } from '../../sim/villagers/types';

/** Mini-voxel edge: a villager is ~3×2×7 of these (SPEC §5), about 1.75 world voxels tall. */
const U = 0.25;
const MAX = 220;

const ROLE_COLORS: Record<Role, number> = {
  farmer: 0x8f9a45,
  gatherer: 0x7d5634,
  builder: 0xb4663c,
  elder: 0x6c6f92,
  priest: 0xece3cc,
  child: 0xd6a85c,
};
const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68d62, 0xa66c45, 0x7d4b2e, 0x5c3a24];
const HAIR = [0x2b1d14, 0x4a3020, 0x7a5232, 0xb08a4e, 0x1c1c1c, 0x8c8c8c];
const CARRY: Record<string, number> = { wood: 0x6b4a2f, stone: 0x9a968f, food: 0xd9b04a };

/** Build a geometry from mini-voxel boxes [x, y, z, w, h, d, shade]. */
function voxels(parts: number[][]): THREE.BufferGeometry {
  const geos = parts.map(([x, y, z, w, h, d, shade]) => {
    const g = new THREE.BoxGeometry(w! * U, h! * U, d! * U);
    g.translate((x! + w! / 2 - 1.5) * U, (y! + h! / 2) * U, (z! + d! / 2 - 1) * U);
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3).fill(shade!);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  });
  return mergeGeometries(geos)!;
}

// Facing +z. Legs darker than the tunic.
const CLOTHES = voxels([
  [0, 0, 0.5, 1, 3, 1, 0.62],
  [2, 0, 0.5, 1, 3, 1, 0.62],
  [0, 3, 0, 3, 2, 2, 1],
  [-0.6, 3, 0.5, 0.6, 2, 1, 0.9],
  [3, 3, 0.5, 0.6, 2, 1, 0.9],
]);
const SKIN_GEO = voxels([
  [0.25, 5, 0.25, 2.5, 1.5, 1.5, 1],
  [-0.6, 2.6, 0.6, 0.6, 0.4, 0.8, 1],
  [3, 2.6, 0.6, 0.6, 0.4, 0.8, 1],
]);
const HAIR_GEO = voxels([
  [0.15, 6.4, 0.15, 2.7, 0.55, 1.7, 1],
  [0.15, 5.4, 0.15, 2.7, 1.0, 0.45, 1],
]);
const CARRY_GEO = voxels([[0.5, 7.1, 0.3, 2, 1, 1.4, 1]]);

interface Ghost {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  role: Role;
  t: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/**
 * Instanced voxel villagers (body, skin, hair, carried load): four draw calls for
 * everyone. Interpolates between sim ticks; the dead sink into the ground and fade
 * out of scale rather than anything graphic.
 */
export class VillagerRenderer {
  readonly group = new THREE.Group();
  private readonly clothes: THREE.InstancedMesh;
  private readonly skin: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly carry: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  /** instanceId → villager id from the last frame (for picking). */
  private idAt: number[] = [];
  private readonly yaw = new Map<number, number>();
  private readonly lastSeen = new Map<number, Ghost>();
  private ghosts: Ghost[] = [];
  selectedId = -1;

  constructor(private readonly offsetX: number, private readonly offsetZ: number) {
    const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    const make = (g: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(g, mat(), MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      // Allocate instance colors up front.
      m.setColorAt(0, tmpC.setHex(0xffffff));
      this.group.add(m);
      return m;
    };
    this.clothes = make(CLOTHES);
    this.skin = make(SKIN_GEO);
    this.hair = make(HAIR_GEO);
    this.carry = make(CARRY_GEO);
    this.carry.castShadow = false;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.group.add(this.ring);
  }

  /** Meshes to raycast for picking. */
  get pickables(): THREE.Object3D[] {
    return [this.clothes, this.skin, this.hair];
  }

  villagerAt(instanceId: number): number {
    return this.idAt[instanceId] ?? -1;
  }

  update(sim: Sim, alpha: number, dt: number, time: number): void {
    let n = 0;
    const seen = new Set<number>();
    this.idAt = [];
    this.ring.visible = false;

    const place = (
      id: number,
      x: number,
      y: number,
      z: number,
      yaw: number,
      scale: number,
      tilt: number,
      role: Role,
      carrying: string | null,
      lying: boolean,
    ) => {
      if (n >= MAX) return;
      tmpE.set(lying ? -Math.PI / 2 : tilt, yaw, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpP.set(x + this.offsetX, y + (lying ? 0.2 : 0), z + this.offsetZ);
      tmpS.setScalar(scale);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.clothes.setMatrixAt(n, tmpM);
      this.skin.setMatrixAt(n, tmpM);
      this.hair.setMatrixAt(n, tmpM);
      this.clothes.setColorAt(n, tmpC.setHex(ROLE_COLORS[role]));
      this.skin.setColorAt(n, tmpC.setHex(SKIN[(id * 7) % SKIN.length]!));
      this.hair.setColorAt(n, tmpC.setHex(HAIR[(id * 13) % HAIR.length]!));
      if (carrying) {
        this.carry.setMatrixAt(n, tmpM);
        this.carry.setColorAt(n, tmpC.setHex(CARRY[carrying] ?? 0xffffff));
      } else {
        this.carry.setMatrixAt(n, tmpM.makeScale(0, 0, 0));
      }
      this.idAt[n] = id;
      n++;
    };

    for (const v of sim.villagers.alive) {
      seen.add(v.id);
      const x = v.px + (v.x - v.px) * alpha;
      const y = v.py + (v.y - v.py) * alpha;
      const z = v.pz + (v.z - v.pz) * alpha;
      const dx = v.x - v.px;
      const dz = v.z - v.pz;
      const moving = dx * dx + dz * dz > 1e-5;
      let yaw = this.yaw.get(v.id) ?? 0;
      if (moving) {
        const target = Math.atan2(dx, dz);
        let d = target - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 12);
      } else if (v.action?.kind === 'gathering' || v.action?.kind === 'eat') {
        const c = sim.village.center;
        const target = Math.atan2(c.x + 0.5 - x, c.z + 0.5 - z);
        let d = target - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 4);
      }
      this.yaw.set(v.id, yaw);
      const scale = scaleFor(v);
      this.lastSeen.set(v.id, { id: v.id, x, y, z, yaw, scale, role: v.role, t: 0 });
      if (v.inside) continue;

      const rite = (v.action?.kind === 'ritual' || v.action?.kind === 'pilgrimage') && v.action.phase === 'work' ? v.action.ritual : undefined;
      const working = v.action?.phase === 'work' && v.action.kind !== 'sleep' && v.action.kind !== 'gathering';
      let bob = moving ? Math.abs(Math.sin(time * 11 + v.id)) * 0.08 : 0;
      let tilt = working ? Math.sin(time * 8 + v.id) * 0.18 + 0.15 : moving ? 0.06 : 0;
      let spin = yaw;
      if (rite === 'dance') {
        // Hop and turn.
        bob = Math.abs(Math.sin(time * 7 + v.id)) * 0.35;
        spin = yaw + time * 3 + v.id;
        tilt = Math.sin(time * 7 + v.id) * 0.12;
      } else if (rite === 'pray') {
        // A slow bow.
        bob = 0;
        tilt = 0.45 + Math.sin(time * 1.5 + v.id) * 0.15;
      }
      place(v.id, x, y + bob, z, spin, scale, tilt, v.role, v.carrying?.kind ?? null, v.lying);
      if (v.id === this.selectedId) {
        this.ring.visible = true;
        this.ring.position.set(x + this.offsetX, y + 0.05, z + this.offsetZ);
      }
    }

    // The newly dead: sink and shrink away over ~1.5 s.
    for (const [id, g] of this.lastSeen) {
      if (seen.has(id)) continue;
      this.lastSeen.delete(id);
      this.yaw.delete(id);
      this.ghosts.push(g);
    }
    this.ghosts = this.ghosts.filter((g) => (g.t += dt) < 1.5);
    for (const g of this.ghosts) {
      const k = 1 - g.t / 1.5;
      place(g.id, g.x, g.y - (1 - k) * 0.8, g.z, g.yaw, g.scale * (0.3 + 0.7 * k), 0, g.role, null, false);
    }

    for (const m of [this.clothes, this.skin, this.hair, this.carry]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

function scaleFor(v: Villager): number {
  if (v.lifeStage !== 'child') return 1;
  return 0.55 + Math.min(1, v.age / 14) * 0.4;
}
