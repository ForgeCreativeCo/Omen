import * as THREE from 'three';
import type { Sim } from '../../sim/Sim';

/** Where the banner stands, from the fire: off the pit, at the plaza's edge. */
const FROM_FIRE = 2;

/**
 * When the island holds several peoples, each raises a banner by its fire in its
 * color, so a village can be told from across the island. One people needs none.
 */
export class ClanBanners {
  readonly group = new THREE.Group();
  private readonly shown = new Map<number, { g: THREE.Group; cloth: THREE.Mesh; at: string }>();
  private readonly poleGeo = new THREE.BoxGeometry(0.2, 6, 0.2);
  private readonly clothGeo = new THREE.BoxGeometry(2.4, 1.6, 0.08).translate(1.2, 0, 0);
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: 0x5a3c22 });
  private readonly clothMats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(
    private readonly offsetX: number,
    private readonly offsetZ: number,
  ) {}

  private make(color: number): { g: THREE.Group; cloth: THREE.Mesh; at: string } {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = 3;
    pole.castShadow = true;
    let mat = this.clothMats.get(color);
    if (!mat) this.clothMats.set(color, (mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 })));
    const cloth = new THREE.Mesh(this.clothGeo, mat);
    cloth.position.set(0.1, 5.1, 0);
    cloth.castShadow = true;
    g.add(pole, cloth);
    this.group.add(g);
    return { g, cloth, at: '' };
  }

  update(sim: Sim, time: number): void {
    const live = new Set<number>();
    if (sim.tribes.length > 1) {
      for (const t of sim.tribes) {
        if (!t.members.length) continue;
        live.add(t.id);
        const b = this.shown.get(t.id) ?? this.make(t.color);
        this.shown.set(t.id, b);
        const c = t.village.center;
        const x = c.x + FROM_FIRE;
        const z = c.z + FROM_FIRE;
        const at = `${x},${z}`;
        // Stand on the ground once; the land rarely moves under a village.
        if (b.at !== at) {
          b.at = at;
          b.g.position.set(x + 0.5 + this.offsetX, sim.world.topY(x, z) + 1, z + 0.5 + this.offsetZ);
        }
        // Stir in the wind.
        b.cloth.rotation.y = Math.sin(time * 1.6 + t.id * 2) * 0.35;
        b.cloth.rotation.z = Math.sin(time * 2.3 + t.id) * 0.04;
      }
    }
    for (const [id, b] of this.shown) {
      if (live.has(id)) continue;
      this.group.remove(b.g);
      this.shown.delete(id);
    }
  }
}
