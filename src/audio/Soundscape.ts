import type { SimEvent } from '../sim/events';
import type { Sim } from '../sim/Sim';
import waveUrl from './sounds/ocean-wave.mp3?url';

/**
 * Sound (SPEC §17), synthesized with WebAudio: wind, sea and birds by time of day; rain; murmuring at the evening fire; drums for rituals; a voice for
 * each miracle; and, in the Warning, a low drone that builds as the sea draws near.
 * A few recordings stand in for the synthesized voice once loaded (the tidal wave's
 * crash); until then, or if one can't be decoded, the synthesized one plays.
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
  /** Real-time stamps of recent one-shots, so 16× doesn't turn into noise. */
  private recent = new Map<string, number>();
  /** Decoded recordings by name, once loaded. */
  private samples = new Map<string, AudioBuffer>();

  constructor() {
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
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
  }

  private async load(name: string, url: string): Promise<void> {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.samples.set(name, await this.ctx!.decodeAudioData(data));
    } catch {
      // Keep the synthesized voice.
    }
  }

  /** Play a loaded recording; false if it isn't loaded (yet). */
  private sample(name: string, gain: number): boolean {
    const buf = this.samples.get(name);
    if (!buf) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start();
    return true;
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

    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    if (running) for (const e of sim.events.since(this.lastSeq)) this.onEvent(e);
    this.lastSeq = sim.events.lastSeq;
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'lightning':
        if (this.ok('thunder', 0.4)) this.thunder(e.divine ? 1 : 0.8);
        break;
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
      case 'ritual':
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
        if (this.ok('whoosh', 1)) this.whoosh();
        break;
      case 'handGrab':
        if (this.ok('whoosh', 0.4)) this.whoosh();
        break;
      case 'handImpact':
        if (!e.water) this.rumble(e.what === 'villager' ? 0.4 : 0.9);
        break;
      case 'meteor':
        this.thunder(1);
        this.rumble(3);
        break;
      case 'milestone':
        if (this.ok('milestone', 2)) this.chime(1, 0.6);
        break;
      case 'quake':
        this.rumble(4);
        this.rumble(2.5);
        break;
      case 'firestorm':
        if (this.ok('firestorm', 2)) this.roar();
        break;
      case 'wave':
        if (this.ok('wave', 2)) this.surf();
        break;
      case 'swarm':
        if (this.ok('swarm', 2)) this.buzz();
        break;
      case 'sacrifice':
        this.drums();
        this.rumble(1.5);
        break;
      case 'plague':
        if (this.ok('plague', 2)) this.wither();
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
