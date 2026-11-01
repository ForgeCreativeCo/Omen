import type { SimEvent } from '../sim/events';
import type { Sim } from '../sim/Sim';
import asteroidUrl from './sounds/asteroid.mp3?url';
import buzzUrl from './sounds/buzzing.mp3?url';
import fireUrl from './sounds/blazing-fire.mp3?url';
import hammerUrl from './sounds/hammering.mp3?url';
import hornUrl from './sounds/horn.mp3?url';
import lightningUrl from './sounds/lightning.mp3?url';
import sawUrl from './sounds/sawing.mp3?url';
import swordsUrl from './sounds/sword-fight.mp3?url';
import coughUrl from './sounds/cough.mp3?url';
import coughGrandpaUrl from './sounds/cough-grandpa.mp3?url';
import coughManUrl from './sounds/cough-man.mp3?url';
import quakeUrl from './sounds/earthquake.mp3?url';
import explosionUrl from './sounds/explosion.mp3?url';
import prayerUrl from './sounds/prayer.mp3?url';
import waveUrl from './sounds/ocean-wave.mp3?url';

/**
 * Sound (SPEC §17), synthesized with WebAudio: wind, sea and birds by time of day; rain; murmuring at the evening fire; drums for rituals; a voice for
 * each miracle; and, in the Warning, a low drone that builds as the sea draws near.
 * A few recordings stand in for the synthesized voice once loaded (the tidal wave's
 * crash, a lightning strike's crack and roll, the cracking ground of an earthquake, the falling star's descent and impact, the roar of a firestorm for as long
 * as it burns, a swarm's buzzing while it feeds); until then, or if one can't be
 * decoded, the synthesized one plays. Building sites near where the camera looks
 * ring with hammering and sawing, people praying there chant, and a raid fighting
 * there clashes; a war horn sounds when war comes and when a war party sets out
 * (recorded only). While the god's sickness is abroad, the sick
 * cough (recorded only: nothing plays until they load).
 * Reads the sim, never changes it. Starts on the first click or key (browsers
 * don't allow sound before that).
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds = new Map<string, GainNode>();
  private lastSeq = -1;
  private volume = 0.6;
  private birdTimer = 0;
  private coughTimer = 0;
  /** Coughs still sounding (no more than two at once). */
  private coughing = 0;
  /** Where the camera looks (world x, z) and how far back it sits: what's near is heard. */
  private ear = { x: 0, z: 0, zoom: 100 };
  /** The hammering loop while a building site is in earshot. */
  private hammer: GainNode | null = null;
  /** The chant while people pray within earshot. */
  private chant: GainNode | null = null;
  private sawTimer = 0;
  private swordTimer = 0;
  /** Sword clashes still sounding (no more than two at once). */
  private clashing = 0;
  /** The cracking of each earthquake shaking now, by its id. */
  private quakes = new Map<number, GainNode>();
  /** The buzzing of each swarm alive now, by its id. */
  private swarms = new Map<number, GainNode>();
  /** The fire's roar for each firestorm burning now, by its id. */
  private storms = new Map<number, GainNode>();
  /** The source behind each playing recording's gain, so it can be stopped early. */
  private sources = new WeakMap<GainNode, AudioBufferSourceNode>();
  /** Real-time stamps of recent one-shots, so 16× doesn't turn into noise. */
  private recent = new Map<string, number>();
  /** Decoded recordings by name, once loaded. */
  private samples = new Map<string, AudioBuffer>();
  /** The falling star's descent while it plays, cut short when the star lands. */
  private falling: GainNode | null = null;

  constructor() {
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  /** Where the camera looks (world coordinates) and its distance from there. */
  listen(x: number, z: number, zoom: number): void {
    this.ear.x = x;
    this.ear.z = z;
    this.ear.zoom = zoom;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.1);
  }

  private start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.8;
    this.master.connect(ctx.destination);
    // Two seconds of white noise, looped by every noise-based sound.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.bed('wind', 'bandpass', 420, 0.6);
    this.bed('sea', 'lowpass', 520, 0.7);
    this.bed('rain', 'highpass', 2400, 0.5);
    this.bed('murmur', 'bandpass', 520, 3);
    this.droneBed();
    void this.load('wave', waveUrl);
    void this.load('asteroid', asteroidUrl);
    void this.load('explosion', explosionUrl);
    void this.load('fire', fireUrl);
    void this.load('buzz', buzzUrl);
    void this.load('quake', quakeUrl);
    void this.load('prayer', prayerUrl);
    void this.load('horn', hornUrl);
    void this.load('swords', swordsUrl);
    void this.load('hammer', hammerUrl);
    void this.load('lightning', lightningUrl);
    void this.load('saw', sawUrl);
    void this.load('cough1', coughUrl);
    void this.load('cough2', coughGrandpaUrl);
    void this.load('cough3', coughManUrl);
  }

  private async load(name: string, url: string): Promise<void> {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.samples.set(name, await this.ctx!.decodeAudioData(data));
    } catch {
      // Keep the synthesized voice.
    }
  }

  /** Play a loaded recording (optionally pitched, panned, delayed); its gain node, or null if it isn't loaded (yet). */
  private sample(
    name: string,
    gain: number,
    opts: {
      rate?: number;
      pan?: number;
      at?: number;
      offset?: number;
      fadeIn?: number;
      loop?: boolean;
      /** Loop only this stretch of the recording (seconds). */
      loopFrom?: number;
      loopTo?: number;
      ended?: () => void;
    } = {},
  ): GainNode | null {
    const buf = this.samples.get(name);
    if (!buf) return null;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    src.loop = !!opts.loop;
    if (opts.loopFrom !== undefined) src.loopStart = opts.loopFrom;
    if (opts.loopTo !== undefined) src.loopEnd = opts.loopTo;
    const g = ctx.createGain();
    const t = ctx.currentTime + (opts.at ?? 0);
    if (opts.fadeIn) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + opts.fadeIn);
    } else g.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src.connect(g).connect(pan).connect(this.master!);
    src.start(t, opts.offset ?? 0);
    this.sources.set(g, src);
    src.onended = () => {
      pan.disconnect();
      opts.ended?.();
    };
    return g;
  }

  /** 0..1: how loud something at (x, z) is, by its distance from where the camera looks (heard out to `reach` up close) and how far back the camera sits. */
  private hearing(x: number, z: number, reach: number): number {
    const d = Math.hypot(x - this.ear.x, z - this.ear.z);
    const place = Math.max(0, 1 - d / (reach + this.ear.zoom * 0.3));
    // Zoomed out over the island, it's a faint sound among many.
    return place * Math.min(1, Math.max(0.15, 60 / Math.max(60, this.ear.zoom)));
  }

  /**
   * 0..1: how loud the nearest building site with someone at work on it is, by its
   * distance from where the camera looks and how far back the camera sits.
   */
  private buildingNear(sim: Sim): number {
    let best = 0;
    for (const v of sim.villagers.alive) {
      const a = v.action;
      if (a?.kind !== 'build' || a.phase !== 'work') continue;
      const k = this.hearing(v.x, v.z, 25);
      // A grave is dug, not hammered.
      if (k > best && sim.tribes[v.tribeId]?.village.byId(a.structureId)?.kind !== 'grave') best = k;
    }
    return best;
  }

  /** 0..1: how loud the prayers near where the camera looks are (at a rite or on holy ground). */
  private prayingNear(sim: Sim): number {
    let best = 0;
    let n = 0;
    for (const v of sim.villagers.alive) {
      const a = v.action;
      if ((a?.kind !== 'ritual' && a?.kind !== 'pilgrimage') || a.ritual !== 'pray' || a.phase !== 'work') continue;
      const k = this.hearing(v.x, v.z, 35);
      if (k <= 0) continue;
      n++;
      best = Math.max(best, k);
    }
    return best * Math.min(1, 0.55 + n * 0.09);
  }

  /** Let a playing recording die away over about `seconds`, then stop it. */
  private fadeOut(g: GainNode, seconds: number): void {
    const now = this.ctx!.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.setTargetAtTime(0, now, seconds / 4);
    this.sources.get(g)?.stop(now + seconds);
  }

  /** One of the sick coughing, somewhere in the village. False if none can play now. */
  private cough(gain: number, at = 0): boolean {
    if (this.coughing >= 2) return false;
    const name = `cough${1 + Math.floor(Math.random() * 3)}`;
    const g = this.sample(name, gain, { rate: 0.9 + Math.random() * 0.2, pan: Math.random() * 1.4 - 0.7, at, ended: () => this.coughing-- });
    if (g) this.coughing++;
    return !!g;
  }

  /** A looping filtered-noise layer whose loudness follows the world. */
  private bed(name: string, type: BiquadFilterType, freq: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.beds.set(name, g);
    // Murmuring voices: wobble the band so it sounds like talk, not hiss.
    if (name === 'murmur') {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 3.3;
      depth.gain.value = 180;
      lfo.connect(depth).connect(f.frequency);
      lfo.start();
    }
  }

  private droneBed(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    for (const hz of [55, 55.35, 82.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(lp);
      o.start();
    }
    lp.connect(g).connect(this.master!);
    this.beds.set('drone', g);
  }

  private level(name: string, v: number): void {
    const g = this.beds.get(name);
    if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.8);
  }

  /** Per frame. `running` = time is moving (paused worlds keep only their ambience). */
  update(sim: Sim, running: boolean, dt: number): void {
    if (!this.ctx) return;
    const cal = sim.calendar;
    const night = cal.timeOfDay === 'night' ? 1 : cal.timeOfDay === 'dusk' || cal.timeOfDay === 'dawn' ? 0.5 : 0;
    const w = sim.weather;
    const storm = w.precipitation === 'storm' ? 1 : 0;
    const raining = w.raining || sim.miracles.clouds.length > 0;
    const flood = sim.warning && sim.warning.disaster.phase === 'striking' ? 1 : 0;
    this.level('wind', 0.05 + 0.05 * night + 0.22 * storm);
    this.level('sea', 0.07 + 0.2 * flood);
    this.level('rain', raining ? (storm ? 0.32 : 0.16) : 0);
    const gathered = sim.villagers.alive.filter((v) => v.action?.kind === 'gathering' && v.action.phase === 'work').length;
    this.level('murmur', running ? Math.min(0.14, gathered * 0.006) : 0);
    // The Warning: a drone that starts ~40 years out and swells to the flood.
    const wn = sim.warning;
    const k = !wn ? 0 : wn.disaster.phase === 'waiting' ? Math.max(0, 1 - wn.yearsLeft / 40) ** 2 : wn.disaster.phase === 'striking' ? 1 : 0.3;
    this.level('drone', 0.16 * k);

    // Birds sing by day, not in the rain.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 0.6 + Math.random() * 2.2;
      if (!night && !raining && cal.season !== 'winter') this.chirp();
    }

    // A firestorm roars for as long as it burns (and falls quiet while the game is paused).
    const burning = new Set(running ? sim.miracles.wrath.firestorms.map((f) => f.id) : []);
    for (const [id, g] of this.storms) {
      if (burning.has(id)) continue;
      this.fadeOut(g, 1.5);
      this.storms.delete(id);
    }
    const fire = this.samples.get('fire');
    for (const id of burning) {
      if (this.storms.has(id) || !fire) continue;
      // Somewhere in the recording, so each storm sounds a little different.
      const g = this.sample('fire', 0.45, { offset: Math.random() * Math.max(0, fire.duration - 20), fadeIn: 0.5 });
      if (g) this.storms.set(id, g);
    }

    // An earthquake cracks the ground while it shakes and dies away after; it carries, so a far one is quieter, never silent.
    const shaking = new Map(running ? sim.miracles.wrath.quakes.map((q) => [q.id, q] as const) : []);
    for (const [id, g] of this.quakes) {
      if (shaking.has(id)) continue;
      this.fadeOut(g, 1.5);
      this.quakes.delete(id);
    }
    for (const [id, q] of shaking) {
      let g = this.quakes.get(id);
      if (!g) g = this.sample('quake', 0) ?? undefined;
      if (!g) continue;
      this.quakes.set(id, g);
      g.gain.setTargetAtTime(0.85 * (0.4 + 0.6 * this.hearing(q.x, q.z, 60)), this.ctx.currentTime, 0.1);
    }

    // A swarm buzzes for as long as it feeds, louder the closer the camera is to it.
    const alive = new Map(running ? sim.miracles.wrath.swarms.map((w) => [w.id, w] as const) : []);
    for (const [id, g] of this.swarms) {
      if (alive.has(id)) continue;
      this.fadeOut(g, 1.2);
      this.swarms.delete(id);
    }
    for (const [id, w] of alive) {
      let g = this.swarms.get(id);
      // The steady middle of the recording, looped (its ends swell in and out).
      if (!g) g = this.sample('buzz', 0, { loop: true, offset: 1.5, loopFrom: 1.5, loopTo: 7.5 }) ?? undefined;
      if (!g) continue;
      this.swarms.set(id, g);
      g.gain.setTargetAtTime(1.6 * this.hearing(w.x, w.z, 30), this.ctx.currentTime, 0.25);
    }

    // A raid fighting at the enemy's fire: clash after clash, louder the closer the camera.
    let battle = 0;
    if (running) for (const r of sim.war.raids) {
      const at = r.phase === 'fight' ? sim.tribes[r.to]?.village.center : undefined;
      if (at) battle = Math.max(battle, this.hearing(at.x, at.z, 40));
    }
    this.swordTimer -= dt;
    if (battle > 0.03 && this.swordTimer <= 0 && this.clashing < 2) {
      this.swordTimer = 2 + Math.random() * 1.5;
      const g = this.sample('swords', 0.5 * battle, { rate: 0.9 + Math.random() * 0.2, pan: Math.random() * 1.2 - 0.6, ended: () => this.clashing-- });
      if (g) this.clashing++;
    }

    // People praying near where the camera looks chant to the god, a little louder the more of them.
    const prayer = running ? this.prayingNear(sim) : 0;
    if (prayer > 0.03) {
      if (!this.chant) this.chant = this.sample('prayer', 0, { loop: true, offset: Math.random() * 30 });
      this.chant?.gain.setTargetAtTime(prayer * 0.7, this.ctx.currentTime, 0.6);
    } else if (this.chant) {
      this.fadeOut(this.chant, 2.5);
      this.chant = null;
    }

    // Hammering and sawing from the nearest building site at work, louder the closer the camera.
    const near = running ? this.buildingNear(sim) : 0;
    if (near > 0.03) {
      if (!this.hammer) this.hammer = this.sample('hammer', 0, { loop: true, offset: Math.random() * 8 });
      this.hammer?.gain.setTargetAtTime(near * 0.3, this.ctx.currentTime, 0.3);
      this.sawTimer -= dt;
      if (this.sawTimer <= 0) {
        this.sawTimer = 2.5 + Math.random() * 4;
        this.sample('saw', near * 0.35, { rate: 0.92 + Math.random() * 0.16, pan: Math.random() * 1.2 - 0.6 });
      }
    } else if (this.hammer) {
      this.fadeOut(this.hammer, 1);
      this.hammer = null;
    }

    // The sick cough, more often and a little louder the more of them there are.
    const sick = sim.plague.sick.size;
    this.coughTimer -= dt;
    if (running && sick && this.coughTimer <= 0) {
      this.coughTimer = Math.max(1.6, (2.5 + Math.random() * 5) / Math.sqrt(sick));
      this.cough(Math.min(0.45, 0.2 + sick * 0.02));
    }

    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    if (running) for (const e of sim.events.since(this.lastSeq)) this.onEvent(e, sim);
    this.lastSeq = sim.events.lastSeq;
  }

  private onEvent(e: SimEvent, sim: Sim): void {
    switch (e.type) {
      case 'lightning': {
        if (!this.ok('thunder', 0.4)) break;
        // Thunder carries: a far strike is quieter, never silent. The god's own is louder than a storm's.
        const d = Math.hypot(e.x - this.ear.x, e.z - this.ear.z);
        const k = (0.35 + 0.65 * Math.max(0, 1 - d / (60 + this.ear.zoom * 0.4))) * (e.divine ? 1 : 0.75);
        if (!this.sample('lightning', 0.8 * k, { rate: 0.94 + Math.random() * 0.12 })) this.thunder(e.divine ? 1 : 0.8);
        break;
      }
      case 'bloom':
        if (this.ok('bloom', 0.5)) this.chime();
        break;
      case 'earthShaped':
        if (this.ok('rumble', 0.35)) this.rumble();
        break;
      case 'dream':
        if (this.ok('dream', 1)) this.shimmer();
        break;
      case 'miracleRain':
        if (this.ok('swell', 1)) this.swell();
        break;
      case 'war':
        // War is declared: the horn, at full voice.
        if (this.ok('horn', 4)) this.sample('horn', 0.6);
        break;
      case 'raid': {
        // A war party sets out from its fire. A horn carries: a far one is quieter, never silent.
        const home = sim.tribes[e.from]?.village.center;
        const k = home ? 0.4 + 0.6 * this.hearing(home.x, home.z, 60) : 1;
        if (this.ok('horn', 4)) this.sample('horn', 0.6 * k);
        break;
      }
      case 'ritual':
        // Prayer has its chant (once loaded); drums are for the other rites.
        if (e.activity === 'pray' && this.samples.has('prayer')) break;
        if (this.ok('drums', 3)) this.drums();
        break;
      case 'flood':
        if (e.phase === 'strike') this.rumble(2.5);
        break;
      case 'holyLight':
        if (this.ok('choir', 2)) this.choir();
        break;
      case 'blessing':
        if (this.ok('bless', 0.6)) this.chime(0.6);
        break;
      case 'blight':
        if (this.ok('blight', 0.8)) this.wither();
        break;
      case 'meteorFall':
        if (!this.ok('meteorFall', 1)) break;
        this.falling = this.sample('asteroid', 0.8);
        if (!this.falling) this.whoosh();
        break;
      case 'handGrab':
        if (this.ok('whoosh', 0.4)) this.whoosh();
        break;
      case 'handImpact':
        if (!e.water) this.rumble(e.what === 'villager' ? 0.4 : 0.9);
        break;
      case 'meteor':
        // The descent gives way to the blast.
        if (this.falling) this.fadeOut(this.falling, 0.3);
        this.falling = null;
        if (!this.sample('explosion', 0.65)) {
          this.thunder(1);
          this.rumble(3);
        }
        break;
      case 'milestone':
        if (this.ok('milestone', 2)) this.chime(1, 0.6);
        break;
      case 'quake':
        // The recording, once loaded, plays from update() while the ground shakes.
        if (this.samples.has('quake')) break;
        this.rumble(4);
        this.rumble(2.5);
        break;
      case 'firestorm':
        // The recording, once loaded, plays from update() for as long as the storm burns.
        if (!this.samples.has('fire') && this.ok('firestorm', 2)) this.roar();
        break;
      case 'wave':
        if (this.ok('wave', 2)) this.surf();
        break;
      case 'swarm':
        // The recording, once loaded, plays from update() for as long as the swarm lives.
        if (!this.samples.has('buzz') && this.ok('swarm', 2)) this.buzz();
        break;
      case 'sacrifice':
        this.drums();
        this.rumble(1.5);
        break;
      case 'plague':
        if (!this.ok('plague', 2)) break;
        this.wither();
        // The first of them already coughing.
        if (this.cough(0.45, 0.8)) this.coughTimer = 3;
        break;
    }
  }

  private ok(key: string, seconds: number): boolean {
    const now = performance.now() / 1000;
    if (now - (this.recent.get(key) ?? -Infinity) < seconds) return false;
    this.recent.set(key, now);
    return true;
  }

  // ---------------------------------------------------------------- one-shots

  private env(peak: number, attack: number, decay: number, at = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private noiseShot(type: BiquadFilterType, freq: number, out: GainNode, dur: number, at = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(out);
    src.start(ctx.currentTime + at);
    src.stop(ctx.currentTime + at + dur);
  }

  private tone(type: OscillatorType, from: number, to: number, out: GainNode, dur: number, at = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + at;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chirp(): void {
    const n = 1 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) this.tone('sine', base, base * (1.3 + Math.random() * 0.4), this.env(0.03, 0.01, 0.09, i * 0.13), 0.1, i * 0.13);
  }

  private thunder(k: number): void {
    this.noiseShot('highpass', 1800, this.env(0.35 * k, 0.005, 0.25), 0.3);
    this.noiseShot('lowpass', 160, this.env(0.9 * k, 0.05, 2.6, 0.08), 3, 0.08);
  }

  private rumble(seconds = 1.2): void {
    this.noiseShot('lowpass', 110, this.env(0.7, 0.15, seconds), seconds + 0.3);
    this.tone('sine', 48, 36, this.env(0.25, 0.1, seconds), seconds);
  }

  private chime(pitch = 1, gap = 0.09): void {
    // A rising pentatonic arpeggio.
    [523.25, 587.33, 659.25, 783.99, 880, 1046.5].forEach((hz, i) => this.tone('sine', hz * pitch, hz * pitch, this.env(0.07, 0.01, 1.4, i * gap), 1.5, i * gap));
  }

  /** Holy Light: a slow, open chord, like voices far off. */
  private choir(): void {
    for (const hz of [220, 277.18, 329.63, 440, 554.37]) {
      this.tone('triangle', hz, hz * 1.003, this.env(0.035, 1.2, 3.2), 4.5);
      this.tone('sine', hz * 2, hz * 2.004, this.env(0.012, 1.6, 2.6), 4.3);
    }
  }

  /** Blight: a dry hiss falling away, and a sour low note. */
  private wither(): void {
    this.noiseShot('bandpass', 900, this.env(0.12, 0.2, 1.6), 2);
    this.tone('sawtooth', 140, 70, this.env(0.05, 0.1, 1.6), 1.8);
  }

  /** Firestorm: a long low roar under crackling. */
  private roar(): void {
    this.noiseShot('lowpass', 300, this.env(0.35, 0.8, 5), 6);
    for (let i = 0; i < 14; i++) this.noiseShot('highpass', 3000, this.env(0.06, 0.005, 0.08, i * 0.35 + Math.random() * 0.2), 0.12, i * 0.35);
  }

  /** Tidal wave: the recorded crash, or a swell of surf that builds and breaks. */
  private surf(): void {
    if (this.sample('wave', 0.9)) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 2.5);
    f.frequency.exponentialRampToValueAtTime(300, t + 5);
    src.connect(f).connect(this.env(0.5, 2.4, 2.8));
    src.start(t);
    src.stop(t + 5.5);
  }

  /** Swarm: many wings, a buzzing that wavers. */
  private buzz(): void {
    for (let i = 0; i < 4; i++) this.tone('sawtooth', 180 + i * 23, 160 + i * 31, this.env(0.025, 0.6, 3.5), 4.2);
  }

  /** A falling star: rising, brightening rush of air. */
  private whoosh(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 1.4);
    src.connect(f).connect(this.env(0.3, 1.2, 0.3));
    src.start(t);
    src.stop(t + 1.7);
  }

  private shimmer(): void {
    for (const hz of [880, 1318.5, 1760.6]) this.tone('triangle', hz, hz * 1.01, this.env(0.035, 0.8, 2.2), 3);
  }

  private swell(): void {
    this.noiseShot('highpass', 2200, this.env(0.18, 0.8, 1.6), 2.5);
  }

  private drums(): void {
    for (let i = 0; i < 8; i++) {
      const at = i * 0.32 + (i % 4 === 3 ? 0.08 : 0);
      this.tone('sine', 120, 52, this.env(i % 4 === 0 ? 0.5 : 0.3, 0.005, 0.28, at), 0.3, at);
    }
  }
}
