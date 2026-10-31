import * as THREE from 'three';
import type { Held } from '../../sim/miracles/hand';
import type { Sim } from '../../sim/Sim';
import { material } from '../../sim/world/materials';

/** Smoothing for things moved a tick at a time. */
const FOLLOW = 18;

interface Shown {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
}

/**
 * What the god's hand holds or has thrown: a clod of earth, a tree, and above
 * whatever is held a soft golden glow with a thin line down to the ground, so
 * the player sees where it will land. Villagers in hand are drawn by the
 * villager renderer (the hand moves them).
 */
export class HandFx {
  readonly group = new THREE.Group();
  private readonly glow: THREE.Sprite;
  private readonly drop: THREE.Line;
  private readonly shown = new Map<Held, Shown>();
  private readonly trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  private readonly leafMat = new THREE.MeshLambertMaterial({ color: 0x5f9440 });
  private readonly earthMats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(
    private readonly offsetX: number,
    private readonly offsetZ: number,
  ) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,236,190,1)');
    grad.addColorStop(0.4, 'rgba(255,214,140,0.45)');
    grad.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.setScalar(4.5);
    this.glow.visible = false;
    this.drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xffe2a0, dashSize: 0.5, gapSize: 0.4, transparent: true, opacity: 0.7 }),
    );
    this.drop.visible = false;
    this.group.add(this.glow, this.drop);
  }

  update(sim: Sim, dt: number): void {
    const hand = sim.miracles.hand;
    const k = 1 - Math.exp(-dt * FOLLOW);
    const live = new Set<Held>([...(hand.held ? [hand.held] : []), ...hand.thrown]);
    for (const [h, s] of this.shown) {
      if (live.has(h)) continue;
      this.group.remove(s.obj);
      this.shown.delete(h);
    }
    for (const h of live) {
      if (h.what === 'villager') continue;
      let s = this.shown.get(h);
      const target = new THREE.Vector3(h.x + this.offsetX, h.y, h.z + this.offsetZ);
      if (!s) {
        s = { obj: h.what === 'tree' ? this.tree() : this.clod(h), pos: target.clone() };
        this.group.add(s.obj);
        this.shown.set(h, s);
      }
      s.pos.lerp(target, k);
      s.obj.position.copy(s.pos);
      if (h !== hand.held) s.obj.rotation.x += dt * 4;
    }

    const h = hand.held;
    this.glow.visible = this.drop.visible = !!h;
    if (!h) return;
    const shown = this.shown.get(h)?.pos;
    const x = (shown?.x ?? h.x + this.offsetX) - this.offsetX;
    const z = (shown?.z ?? h.z + this.offsetZ) - this.offsetZ;
    const top = (shown?.y ?? h.y) + 1.6;
    this.glow.position.set(x + this.offsetX, top, z + this.offsetZ);
    const ground = Math.max(0, sim.world.topY(Math.floor(x), Math.floor(z))) + 1;
    const p = this.drop.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, x + this.offsetX, top - 1.6, z + this.offsetZ);
    p.setXYZ(1, x + this.offsetX, ground, z + this.offsetZ);
    p.needsUpdate = true;
    this.drop.computeLineDistances();
  }

  private tree(): THREE.Object3D {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), this.trunkMat);
    trunk.position.y = -1;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 3), this.leafMat);
    crown.position.y = 1.8;
    g.add(trunk, crown);
    return g;
  }

  private clod(h: Held): THREE.Object3D {
    // Colored by what most of it is.
    const count = new Map<number, number>();
    for (const id of h.voxels) count.set(id, (count.get(id) ?? 0) + 1);
    const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    let mat = this.earthMats.get(main);
    if (!mat) this.earthMats.set(main, (mat = new THREE.MeshLambertMaterial({ color: material(main).color })));
    const size = Math.max(1, Math.cbrt(h.voxels.length));
    return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
  }
}
