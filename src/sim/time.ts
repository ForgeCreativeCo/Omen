import { TUNING } from './tuning';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type TimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

export interface Calendar {
  tick: number;
  /** Whole days since the start. */
  day: number;
  /** 0..1 position within the current day, 0 = midnight. */
  dayFraction: number;
  timeOfDay: TimeOfDay;
  /** Year number, starting at 1. */
  year: number;
  season: Season;
  /** 0-based day within the current season. */
  dayOfSeason: number;
}

const T = TUNING.time;
export const TICKS_PER_DAY = T.ticksPerSecond * T.secondsPerDay;
export const DAYS_PER_YEAR = T.daysPerSeason * T.seasonsPerYear;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

/** The sim starts at dawn on day 0, not midnight. */
const START_OFFSET_TICKS = Math.round(T.dawnAt * TICKS_PER_DAY);

export function timeOfDayAt(fraction: number): TimeOfDay {
  const edge = 0.05;
  if (fraction < T.dawnAt - edge || fraction >= T.duskAt + edge) return 'night';
  if (fraction < T.dawnAt + edge) return 'dawn';
  if (fraction >= T.duskAt - edge) return 'dusk';
  return 'day';
}

export function calendarAt(tick: number): Calendar {
  const t = tick + START_OFFSET_TICKS;
  const day = Math.floor(t / TICKS_PER_DAY);
  const dayFraction = (t % TICKS_PER_DAY) / TICKS_PER_DAY;
  const dayOfYear = day % DAYS_PER_YEAR;
  const seasonIndex = Math.floor(dayOfYear / T.daysPerSeason);
  return {
    tick,
    day,
    dayFraction,
    timeOfDay: timeOfDayAt(dayFraction),
    year: Math.floor(day / DAYS_PER_YEAR) + 1,
    season: SEASONS[seasonIndex] as Season,
    dayOfSeason: dayOfYear % T.daysPerSeason,
  };
}

export function formatCalendar(c: Calendar): string {
  const season = c.season[0]!.toUpperCase() + c.season.slice(1);
  return `Year ${c.year} · ${season}`;
}
