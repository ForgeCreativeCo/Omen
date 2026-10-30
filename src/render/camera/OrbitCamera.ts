import * as THREE from 'three';

export interface OrbitCameraOptions {
  /** Pan target stays within this radius of the origin. */
  boundsRadius: number;
  minDistance: number;
  maxDistance: number;
  /** Degrees. */
  minPitch: number;
  maxPitch: number;
  /** Scene-space ground height under (x, z), used to keep the target on the terrain. */
  groundHeightAt: (x: number, z: number) => number;
}

const DAMPING = 10;
const KEY_PAN_SPEED = 0.9; // fraction of distance per second
const KEY_ROTATE_SPEED = 1.6; // radians per second

/**
 * Diorama orbit camera (SPEC §15). Desktop: left/middle-drag or WASD pan, right-drag
 * rotate, wheel zoom, Q/E rotate. Touch: one finger pans, two fingers pinch-zoom,
 * twist to rotate and slide vertically to tilt. Everything is damped.
 *
 * Left-drag panning will yield to miracle painting/casting in a later milestone.
 */
export class OrbitCamera {
  private readonly target = new THREE.Vector3();
  private readonly goalTarget = new THREE.Vector3();
  private yaw = Math.PI * 0.25;
  private goalYaw = this.yaw;
  private pitch = THREE.MathUtils.degToRad(48);
  private goalPitch = this.pitch;
  private distance: number;
  private goalDistance: number;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mouseMode: 'pan' | 'rotate' | null = null;
  private gesture: { dist: number; angle: number; midY: number } | null = null;
  private readonly keys = new Set<string>();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly opts: OrbitCameraOptions,
  ) {
    this.distance = this.goalDistance = opts.maxDistance * 0.7;
    this.target.y = this.goalTarget.y = opts.groundHeightAt(0, 0);
    this.attach();
    this.update(1);
  }

  /** Smoothly frame a scene-space point. */
  focus(x: number, z: number, distance?: number): void {
    this.goalTarget.x = x;
    this.goalTarget.z = z;
    if (distance !== undefined) this.goalDistance = THREE.MathUtils.clamp(distance, this.opts.minDistance, this.opts.maxDistance);
  }

  private attach(): void {
    const el = this.dom;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onDown(e: PointerEvent): void {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'mouse') {
      this.mouseMode = e.button === 2 ? 'rotate' : 'pan';
    } else if (this.pointers.size === 2) {
      this.gesture = this.measureGesture();
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (e.pointerType === 'mouse') this.mouseMode = null;
    this.gesture = this.pointers.size === 2 ? this.measureGesture() : null;
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (e.pointerType === 'mouse') {
      if (this.mouseMode === 'rotate') this.rotateBy(dx, dy);
      else if (this.mouseMode === 'pan') this.panBy(dx, dy);
      return;
    }
    if (this.pointers.size === 1) {
      this.panBy(dx, dy);
    } else if (this.pointers.size === 2 && this.gesture) {
      const g = this.measureGesture();
      if (g.dist > 0 && this.gesture.dist > 0) this.zoomBy(this.gesture.dist / g.dist);
      let dAngle = g.angle - this.gesture.angle;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      this.goalYaw -= dAngle;
      this.goalPitch = this.clampPitch(this.goalPitch + (g.midY - this.gesture.midY) * 0.004);
      this.gesture = g;
    }
  }

  private measureGesture(): { dist: number; angle: number; midY: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { dist: 0, angle: 0, midY: 0 };
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      midY: (a.y + b.y) / 2,
    };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 0.05 : 0.0015;
    this.zoomBy(Math.exp(e.deltaY * scale));
  }

  private zoomBy(factor: number): void {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, this.opts.minDistance, this.opts.maxDistance);
  }

  private rotateBy(dx: number, dy: number): void {
    this.goalYaw -= dx * 0.006;
    this.goalPitch = this.clampPitch(this.goalPitch + dy * 0.004);
  }

  /** Pan so the ground under the pointer roughly follows it. */
  private panBy(dx: number, dy: number): void {
    const h = this.dom.clientHeight || 1;
    const worldPerPx = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    const fy = worldPerPx / Math.max(0.35, Math.sin(this.pitch));
    this.goalTarget.x += -right.x * dx * worldPerPx + fwd.x * dy * fy;
    this.goalTarget.z += -right.z * dx * worldPerPx + fwd.z * dy * fy;
    this.clampTarget();
  }

  private clampPitch(p: number): number {
    return THREE.MathUtils.clamp(p, THREE.MathUtils.degToRad(this.opts.minPitch), THREE.MathUtils.degToRad(this.opts.maxPitch));
  }

  private clampTarget(): void {
    const r = Math.hypot(this.goalTarget.x, this.goalTarget.z);
    if (r > this.opts.boundsRadius) {
      this.goalTarget.x *= this.opts.boundsRadius / r;
      this.goalTarget.z *= this.opts.boundsRadius / r;
    }
  }

  private applyKeys(dt: number): void {
    const k = this.keys;
    let px = 0;
    let pz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) pz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) pz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) px -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) px += 1;
    if (px || pz) {
      const step = this.distance * KEY_PAN_SPEED * dt;
      const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
      const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
      this.goalTarget.x += (right.x * px - fwd.x * pz) * step;
      this.goalTarget.z += (right.z * px - fwd.z * pz) * step;
      this.clampTarget();
    }
    if (k.has('KeyQ')) this.goalYaw += KEY_ROTATE_SPEED * dt;
    if (k.has('KeyE')) this.goalYaw -= KEY_ROTATE_SPEED * dt;
  }

  update(dt: number): void {
    this.applyKeys(dt);
    this.goalTarget.y = this.opts.groundHeightAt(this.goalTarget.x, this.goalTarget.z);
    const a = 1 - Math.exp(-DAMPING * dt);
    this.target.lerp(this.goalTarget, a);
    this.yaw += (this.goalYaw - this.yaw) * a;
    this.pitch += (this.goalPitch - this.pitch) * a;
    this.distance += (this.goalDistance - this.distance) * a;

    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }
}
