import type { Rng } from '../rng';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';

const W = TUNING.weather;

export type Precipitation = 'none' | 'rain' | 'storm';

/** Hooks the weather system calls into the rest of the sim. */
export interface WeatherHost {
  readonly tick: number;
  /** 0..3 (spring..winter). */
  readonly seasonIndex: number;
  emitRainStart(storm: boolean): void;
  emitRainEnd(): void;
  emitDrought(start: boolean): void;
  naturalLightning(): void;
}

/**
 * Natural weather (SPEC §4): showers, storms with lightning, droughts, wind.
 * Island-wide for now; local rain (the Rain miracle) is layered on by fields.
 */
export class Weather {
  precipitation: Precipitation = 'none';
  /** Ticks left of the current shower/storm. */
  remaining = 0;
  drought = false;
  droughtDaysLeft = 0;
  /** 0..1 global soil moisture; drives fire dryness. */
  moisture = 0.6;
  /** Wind direction in radians (toward which it blows) and strength 0..1. */
  windAngle = 0;
  windStrength = 0.4;
  private lastSeason = -1;

  constructor(private readonly rng: Rng) {
    this.windAngle = rng.range(0, Math.PI * 2);
  }

  get raining(): boolean {
    return this.precipitation !== 'none';
  }

  /** 0.3 (soaked) .. 1.5 (bone dry): multiplies fire spread. */
  get dryness(): number {
    return Math.min(1.5, Math.max(0.3, 1.4 - this.moisture * 1.4 + (this.drought ? 0.3 : 0)));
  }

  /** Start a shower now (used by debug tools and, later, natural-event forcing). */
  startRain(host: WeatherHost, storm: boolean): void {
    const [lo, hi] = storm ? W.stormTicks : W.rainTicks;
    this.precipitation = storm ? 'storm' : 'rain';
    this.remaining = this.rng.int(lo!, hi!);
    if (this.drought) this.endDrought(host);
    host.emitRainStart(storm);
  }

  startDrought(host: WeatherHost): void {
    if (this.drought) return;
    const [lo, hi] = W.droughtDays;
    this.drought = true;
    this.droughtDaysLeft = this.rng.int(lo!, hi!);
    host.emitDrought(true);
  }

  private endDrought(host: WeatherHost): void {
    this.drought = false;
    this.droughtDaysLeft = 0;
    host.emitDrought(false);
  }

  step(host: WeatherHost): void {
    const season = host.seasonIndex;
    const newDay = host.tick % TICKS_PER_DAY === 0;

    if (season !== this.lastSeason) {
      this.lastSeason = season;
      if (!this.drought && this.rng.chance(W.droughtChance[season] ?? 0)) this.startDrought(host);
    }
    if (newDay && this.drought && --this.droughtDaysLeft <= 0) this.endDrought(host);

    // Wind wanders slowly.
    this.windAngle += this.rng.jitter(W.windChangePerTick);
    this.windStrength = Math.min(1, Math.max(0.1, this.windStrength + this.rng.jitter(W.windChangePerTick)));

    if (this.raining) {
      this.moisture = Math.min(1, this.moisture + W.rainMoisturePerTick * (this.precipitation === 'storm' ? 1.5 : 1));
      if (this.precipitation === 'storm' && this.rng.chance(W.stormLightningPerTick)) host.naturalLightning();
      if (--this.remaining <= 0) {
        this.precipitation = 'none';
        host.emitRainEnd();
      }
    } else {
      this.moisture = Math.max(0, this.moisture - W.moistureDecayPerDay / TICKS_PER_DAY);
      let p = (W.rainChancePerDay[season] ?? 0) / TICKS_PER_DAY;
      if (this.drought) p *= W.droughtRainFactor;
      if (this.rng.chance(p)) this.startRain(host, this.rng.chance(W.stormShare[season] ?? 0));
    }
  }
}
