import * as THREE from 'three';
import type { Sim } from '../../sim/Sim';

const MAX = 200;

/** God's Eye: lines from the latest omen to each of its witnesses (SPEC §15). */
export class WitnessLines {
  readonly group = new THREE.Group();
  visible = false;
  private readonly pos = new Float32Array(MAX * 6);
  private readonly lines: THREE.LineSegments;
  private readonly marker: THREE.Mesh;

  constructor(private readonly offsetX: number, private readonly offsetZ: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.75, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.8),
      new THREE.MeshBasicMaterial({ color: 0xffd36e, wireframe: true, depthTest: false }),
    );
    this.marker.renderOrder = 20;
    this.group.add(this.lines, this.marker);
  }

  update(sim: Sim, time: number): void {
    const omen = sim.belief.omens.at(-1);
    this.group.visible = this.visible && !!omen;
    if (!this.group.visible || !omen) return;
    const ox = this.offsetX;
    const oz = this.offsetZ;
    const top = omen.position.y + 3;
    this.marker.position.set(omen.position.x + 0.5 + ox, top, omen.position.z + 0.5 + oz);
    this.marker.rotation.y = time;
    let n = 0;
    for (const id of omen.witnesses) {
      const v = sim.villagers.byId(id);
      if (!v?.alive || n >= MAX) continue;
      this.pos.set([omen.position.x + 0.5 + ox, top, omen.position.z + 0.5 + oz, v.x + ox, v.y + 1.6, v.z + oz], n * 6);
      n++;
    }
    this.pos.fill(0, n * 6);
    this.lines.geometry.setDrawRange(0, n * 2);
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
