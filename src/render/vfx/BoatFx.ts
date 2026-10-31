import * as THREE from 'three';
import type { Sim } from '../../sim/Sim';
import { TUNING } from '../../sim/tuning';

/** Settlers' boats: a plank hull with a mast and a square sail, gliding on the sea. */
export class BoatFx {
  readonly group = new THREE.Group();
  private readonly shown = new Map<number, THREE.Group>();
  private readonly hullGeo = new THREE.BoxGeometry(3.2, 0.5, 1.5);
  private readonly mastGeo = new THREE.BoxGeometry(0.14, 3, 0.14);
  private readonly sailGeo = new THREE.BoxGeometry(0.06, 1.7, 1.3);
  private readonly hullMat = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
  private readonly mastMat = new THREE.MeshLambertMaterial({ color: 0x5a3c22 });
  private readonly sailMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 });

  constructor(
    private readonly offsetX: number,
    private readonly offsetZ: number,
  ) {}

  private make(): THREE.Group {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(this.hullGeo, this.hullMat);
    hull.castShadow = true;
    const mast = new THREE.Mesh(this.mastGeo, this.mastMat);
    mast.position.set(0.3, 1.7, 0);
    const sail = new THREE.Mesh(this.sailGeo, this.sailMat);
    sail.position.set(0.38, 2.1, 0);
    sail.castShadow = true;
    g.add(hull, mast, sail);
    this.group.add(g);
    return g;
  }

  update(sim: Sim, time: number): void {
    const live = new Set<number>();
    const sea = TUNING.terrain.seaLevel;
    for (const b of sim.boats.boats) {
      if (b.phase !== 'sail') continue;
      live.add(b.id);
      const g = this.shown.get(b.id) ?? this.make();
      this.shown.set(b.id, g);
      // Bob on the swell, nose into the heading.
      g.position.set(b.x + 0.5 + this.offsetX, sea + 0.65 + Math.sin(time * 2 + b.id) * 0.08, b.z + 0.5 + this.offsetZ);
      g.rotation.set(Math.sin(time * 1.7 + b.id) * 0.05, -b.heading, Math.sin(time * 1.3) * 0.04);
    }
    for (const [id, g] of this.shown) {
      if (live.has(id)) continue;
      this.group.remove(g);
      this.shown.delete(id);
    }
  }
}
