import type { FixedLoop } from '../loop';
import type { GameRenderer } from '../render/GameRenderer';
import { DREAM_SYMBOLS, MIRACLES, miracleDef, type DreamSymbol, type MiracleId, type PointMiracle } from '../sim/miracles/defs';
import type { GrabTarget } from '../sim/miracles/hand';
import type { CastFailure, Command } from '../sim/miracles/Miracles';
import type { Sim } from '../sim/Sim';
import { TUNING } from '../sim/tuning';
import { MIRACLE_PATHS, SYMBOL_PATHS, svgIcon } from './symbols';
import type { Toasts } from './Toasts';

const FAILURE_TEXT: Record<CastFailure, string> = {
  grace: 'Not enough Grace.',
  cooldown: 'Not ready yet.',
  night: 'Dreams can only be sent at night.',
  target: 'Nobody there to receive it.',
  interval: '',
};

const HOTKEYS: Record<string, MiracleId> = Object.fromEntries(MIRACLES.map((m) => [`Key${m.key}`, m.id]));
/** Minimum real time between brush strokes / cloud drags sent to the sim. */
const STROKE_MS = 90;
/** The hand: how often to tell the sim where it is, and how far back a flick is measured. */
const CARRY_MS = 50;
const FLICK_MS = 120;

/**
 * The player's hands (SPEC §6, §15): the Grace meter and miracle bar, targeting
 * (reticle, taps, brush painting, cloud dragging) and the dream symbol picker.
 * Everything it does to the world goes through `sim.enqueue`.
 */
export class MiracleController {
  armed: MiracleId | null = null;
  private lower = false;
  private shiftHeld = false;
  private readonly bar: HTMLElement;
  private readonly graceFill: HTMLElement;
  private readonly graceText: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly buttons = new Map<MiracleId, HTMLButtonElement>();
  private readonly picker: HTMLElement;
  private dreamTarget = -1;
  private chosen: DreamSymbol[] = [];
  private resumeSpeed = -1;
  private hover: { x: number; y: number; z: number } | null = null;
  private painting = false;
  private grabbing = false;
  private samples: { t: number; x: number; z: number }[] = [];
  private draggingCloud = -1;
  private lastSend = 0;

  constructor(
    root: HTMLElement,
    private readonly sim: Sim,
    private readonly view: GameRenderer,
    private readonly loop: FixedLoop,
    private readonly toasts: Toasts,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'miracle-dock';
    this.bar.innerHTML = `
      <div class="hud-panel miracle-hint" hidden></div>
      <div class="hud-panel miracle-bar">
        <div class="grace" title="Grace: the god's power. It grows with the people's faith.">
          <div class="grace-track"><div class="grace-fill"></div></div>
          <span class="grace-text"></span>
        </div>
        <div class="miracle-buttons"></div>
      </div>`;
    root.appendChild(this.bar);
    this.graceFill = this.bar.querySelector('.grace-fill')!;
    this.graceText = this.bar.querySelector('.grace-text')!;
    this.hint = this.bar.querySelector('.miracle-hint')!;
    const list = this.bar.querySelector('.miracle-buttons')!;
    for (const m of MIRACLES) {
      const b = document.createElement('button');
      b.className = 'miracle';
      b.dataset.id = m.id;
      b.title = TUNING.miracles.unlimited ? `${m.name} [${m.key}]: ${m.blurb}` : `${m.name} [${m.key}] (${m.cost} Grace${m.targeting === 'brush' ? ' per stroke' : ''}): ${m.blurb}`;
      b.innerHTML = `${svgIcon(MIRACLE_PATHS[m.id], 26)}<span class="m-name">${m.name}</span><span class="m-cost">${m.cost}</span><span class="m-key">${m.key}</span><i class="m-cool"></i>`;
      b.addEventListener('click', () => (this.armed === m.id ? this.disarm() : this.arm(m.id)));
      list.appendChild(b);
      this.buttons.set(m.id, b);
    }
    this.hint.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.cancel !== undefined) this.disarm();
      if (t.dataset.mode) {
        this.lower = t.dataset.mode === 'lower';
        this.renderHint();
      }
    });

    this.picker = document.createElement('div');
    this.picker.className = 'hud-panel dream-picker';
    this.picker.hidden = true;
    root.appendChild(this.picker);
    this.picker.addEventListener('click', (e) => this.onPickerClick(e));

    const canvas = view.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.updateHover(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Shift') this.shiftHeld = true;
      if (e.code === 'Escape') {
        if (!this.picker.hidden) this.closePicker();
        else this.disarm();
      }
      const id = HOTKEYS[e.code];
      if (id && this.picker.hidden) this.armed === id ? this.disarm() : this.arm(id);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shiftHeld = false;
    });

    view.pointerHook = {
      down: (e) => this.onPress(e),
      move: (e) => this.onDrag(e),
      up: () => {
        this.painting = false;
        this.draggingCloud = -1;
        if (this.grabbing) this.letGo();
      },
    };
  }

  // ------------------------------------------------------------------ arming

  arm(id: MiracleId): void {
    this.armed = id;
    this.view.miracleFx.showSleepers = id === 'dream';
    this.renderHint();
  }

  disarm(): void {
    this.armed = null;
    this.painting = false;
    this.view.miracleFx.showSleepers = false;
    this.view.miracleFx.setReticle(null, 0, true);
    this.renderHint();
  }

  private renderHint(): void {
    if (!this.armed) {
      this.hint.hidden = true;
      return;
    }
    const def = miracleDef(this.armed);
    const modes =
      def.id === 'shapeEarth'
        ? `<span class="seg"><button data-mode="raise" class="${this.lower ? '' : 'on'}">Raise</button><button data-mode="lower" class="${this.lower ? 'on' : ''}">Lower</button></span>`
        : '';
    const how =
      def.targeting === 'brush'
        ? 'Drag on the land.'
        : def.targeting === 'sleeper'
          ? 'Tap a sleeper (marked).'
          : def.targeting === 'person'
            ? 'Tap someone who is awake.'
            : def.targeting === 'hand'
              ? 'Press and drag. Let go gently, or flick to throw.'
              : 'Tap the land.';
    this.hint.innerHTML = `<b>${def.name}</b> <span>${how}</span>${modes}<button data-cancel class="cancel">Cancel</button><div class="m-blurb">${def.blurb}</div>`;
    this.hint.hidden = false;
  }

  /** Tap on the world while armed. Returns true if it was used. */
  tap(clientX: number, clientY: number): boolean {
    if (!this.armed) return false;
    const def = miracleDef(this.armed);
    if (def.targeting === 'sleeper') {
      this.pickSleeper(clientX, clientY);
      return true;
    }
    if (def.targeting === 'hand') return true;
    if (def.targeting === 'person') {
      const id = this.view.pickVillager(this.sim, clientX, clientY);
      if (id < 0) this.toast('target');
      else this.send({ type: 'bless', villagerId: id }, 'bless');
      return true;
    }
    const hit = this.view.groundAt(clientX, clientY);
    if (!hit) return true;
    if (def.targeting === 'brush') this.stroke(hit.x, hit.z);
    else this.send({ type: 'cast', miracle: def.id as PointMiracle, x: hit.x, z: hit.z }, def.id);
    return true;
  }

  private onPress(e: PointerEvent): boolean {
    // Grab a live rain cloud to drag it, whatever is armed.
    const cloud = this.cloudNear(e.clientX, e.clientY);
    if (cloud >= 0) {
      this.draggingCloud = cloud;
      return true;
    }
    if (this.armed === 'hand') return this.grab(e.clientX, e.clientY);
    if (this.armed === 'shapeEarth') {
      const hit = this.view.groundAt(e.clientX, e.clientY);
      if (hit) this.stroke(hit.x, hit.z);
      this.painting = true;
      return true;
    }
    return false;
  }

  private onDrag(e: PointerEvent): void {
    this.updateHover(e.clientX, e.clientY);
    if (this.grabbing) {
      const hit = this.view.groundAt(e.clientX, e.clientY);
      if (!hit) return;
      const now = performance.now();
      this.samples.push({ t: now, x: hit.x + 0.5, z: hit.z + 0.5 });
      while (this.samples.length > 2 && now - this.samples[0]!.t > FLICK_MS) this.samples.shift();
      if (now - this.lastSend >= CARRY_MS) this.send({ type: 'carry', x: hit.x + 0.5, z: hit.z + 0.5 }, null);
      return;
    }
    if (performance.now() - this.lastSend < STROKE_MS) return;
    const hit = this.hover;
    if (!hit) return;
    if (this.draggingCloud >= 0) {
      this.send({ type: 'moveCloud', cloudId: this.draggingCloud, x: hit.x, z: hit.z }, null);
    } else if (this.painting) {
      this.stroke(hit.x, hit.z);
    }
  }

  /** Take hold of whoever or whatever is under the pointer: a villager, else a tree, else the ground. */
  private grab(clientX: number, clientY: number): boolean {
    const hit = this.view.groundAt(clientX, clientY);
    const id = this.view.pickVillager(this.sim, clientX, clientY);
    if (id < 0 && !hit) return false;
    const v = id >= 0 ? this.sim.villagers.byId(id) : undefined;
    const x = v ? v.x : hit!.x + 0.5;
    const z = v ? v.z : hit!.z + 0.5;
    const R = TUNING.miracles.hand.reach;
    const tree = !v && this.sim.village.trees.some((t) => this.sim.village.treeAlive(t) && Math.hypot(t.x + 0.5 - x, t.z + 0.5 - z) <= R);
    const target: GrabTarget = v ? { what: 'villager', id: v.id } : tree ? { what: 'tree' } : { what: 'earth' };
    this.send({ type: 'grab', target, x, z }, 'hand');
    this.grabbing = true;
    this.samples = [{ t: performance.now(), x, z }];
    return true;
  }

  /** Let go: the pointer's recent motion is the throw (world units per second → per tick). */
  private letGo(): void {
    this.grabbing = false;
    const s = this.samples;
    let vx = 0;
    let vz = 0;
    if (s.length >= 2) {
      const a = s[0]!;
      const b = s[s.length - 1]!;
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.01 && performance.now() - b.t < FLICK_MS) {
        vx = (b.x - a.x) / dt / TUNING.time.ticksPerSecond;
        vz = (b.z - a.z) / dt / TUNING.time.ticksPerSecond;
      }
    }
    this.send({ type: 'release', vx, vz }, null);
  }

  private stroke(x: number, z: number): void {
    this.send({ type: 'stroke', x, z, raise: !(this.lower || this.shiftHeld) }, 'shapeEarth', true);
  }

  /** Screen-space hit test against live clouds' footprints. */
  private cloudNear(clientX: number, clientY: number): number {
    const hit = this.view.groundAt(clientX, clientY);
    if (!hit) return -1;
    for (const c of this.sim.miracles.clouds) if (Math.hypot(hit.x - c.x, hit.z - c.z) <= c.radius * 0.8) return c.id;
    return -1;
  }

  private send(cmd: Command, id: MiracleId | null, quiet = false): void {
    if (id) {
      const fail = this.sim.miracles.check(id);
      if (fail) {
        if (!quiet || fail !== 'cooldown') this.toast(fail);
        return;
      }
    }
    this.lastSend = performance.now();
    this.sim.enqueue(cmd);
    // While paused, apply it right away so the god never feels unresponsive. A brush
    // stroke runs just enough ticks to clear the stroke spacing for the next one.
    if (this.loop.speed === 0) {
      const ticks = cmd.type === 'stroke' ? TUNING.miracles.shapeEarth.strokeInterval : 1;
      for (let i = 0; i < ticks; i++) this.sim.step();
    }
  }

  private toast(fail: CastFailure): void {
    const text = FAILURE_TEXT[fail];
    if (text) this.toasts.show(text);
  }

  private updateHover(clientX: number, clientY: number): void {
    this.hover = this.view.groundAt(clientX, clientY);
  }

  // ------------------------------------------------------------------ dreams

  private pickSleeper(clientX: number, clientY: number): void {
    const fail = this.sim.miracles.check('dream');
    if (fail) return this.toast(fail);
    const id = this.view.pickSleeper(this.sim, clientX, clientY);
    if (id < 0) return this.toast('target');
    this.openPicker(id);
  }

  private openPicker(villagerId: number): void {
    this.dreamTarget = villagerId;
    this.chosen = [];
    // Hold time still while choosing.
    this.resumeSpeed = this.loop.speedIndex;
    this.loop.setSpeedIndex(0);
    this.picker.hidden = false;
    this.renderPicker();
  }

  private closePicker(): void {
    this.picker.hidden = true;
    if (this.resumeSpeed > 0) this.loop.setSpeedIndex(this.resumeSpeed);
    this.resumeSpeed = -1;
  }

  private renderPicker(): void {
    const v = this.sim.villagers.byId(this.dreamTarget);
    const need = TUNING.miracles.dream.symbols;
    const slots = Array.from({ length: need }, (_, i) => {
      const s = this.chosen[i];
      return `<div class="slot">${s ? svgIcon(SYMBOL_PATHS[s], 30) : ''}</div>`;
    }).join('');
    this.picker.innerHTML = `
      <div class="dp-title">Send <b>${v?.name ?? 'them'}</b> a dream</div>
      <div class="dp-sub">Choose ${need} symbols. What they make of it is up to them.</div>
      <div class="dp-slots">${slots}</div>
      <div class="dp-grid">${DREAM_SYMBOLS.map(
        (s) =>
          `<button data-symbol="${s}" class="${this.chosen.includes(s) ? 'on' : ''}">${svgIcon(SYMBOL_PATHS[s], 28)}<span>${s}</span></button>`,
      ).join('')}</div>
      <div class="dp-actions">
        <button data-act="clear">Clear</button>
        <button data-act="cancel">Cancel</button>
        <button data-act="send" class="primary" ${this.chosen.length === need ? '' : 'disabled'}>Send dream · ${miracleDef('dream').cost}</button>
      </div>`;
  }

  private onPickerClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const need = TUNING.miracles.dream.symbols;
    const s = btn.dataset.symbol as DreamSymbol | undefined;
    if (s) {
      if (this.chosen.includes(s)) this.chosen = this.chosen.filter((c) => c !== s);
      else if (this.chosen.length < need) this.chosen.push(s);
      this.renderPicker();
      return;
    }
    switch (btn.dataset.act) {
      case 'clear':
        this.chosen = [];
        this.renderPicker();
        break;
      case 'cancel':
        this.closePicker();
        break;
      case 'send': {
        const cmd: Command = { type: 'dream', villagerId: this.dreamTarget, symbols: [...this.chosen] };
        this.closePicker();
        this.send(cmd, 'dream');
        this.disarm();
        break;
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  update(): void {
    const m = this.sim.miracles;
    const cap = m.cap;
    // Limitless: no Grace to show, no costs, no cooldowns.
    this.bar.classList.toggle('unlimited', m.unlimited);
    this.graceFill.style.width = `${Math.min(100, (m.grace / cap) * 100)}%`;
    this.graceText.textContent = `${Math.floor(m.grace)} / ${Math.floor(cap)}`;
    for (const [id, b] of this.buttons) {
      const def = miracleDef(id);
      const ready = m.readiness(id);
      b.classList.toggle('armed', this.armed === id);
      b.classList.toggle('poor', !m.unlimited && m.grace < def.cost);
      b.classList.toggle('dim', def.nightOnly && !m.isNight());
      (b.querySelector('.m-cool') as HTMLElement).style.setProperty('--p', `${(1 - ready) * 100}%`);
    }
    if (this.armed && this.armed !== 'dream' && this.armed !== 'bless' && this.armed !== 'hand') {
      const fail = m.check(this.armed);
      this.view.miracleFx.setReticle(this.hover, miracleDef(this.armed).radius, !fail || fail === 'interval');
    } else {
      this.view.miracleFx.setReticle(null, 0, true);
    }
  }
}
