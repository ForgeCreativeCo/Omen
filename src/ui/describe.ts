import { featureLabel } from '../sim/omens/context';
import type { Omen, OmenKind, OmenMemoryRecord } from '../sim/omens/types';
import type { Sim } from '../sim/Sim';
import { calendarAt, formatCalendar } from '../sim/time';

const KIND_TEXT: Record<OmenKind, string> = {
  rain: 'Rain fell from a single cloud',
  naturalRain: 'Rain came',
  storm: 'A storm broke',
  lightning: 'Lightning struck',
  naturalLightning: 'Lightning struck',
  shapeEarth: 'The earth moved',
  bloom: 'Everything bloomed at once',
  dream: 'A dream came',
  drought: 'The rains stopped',
};

/** Where an omen happened, in the villagers' words (nearest named place). */
export function omenPlace(sim: Sim, o: Omen): string {
  const place = o.context.filter((f) => f.category === 'place' && f.key !== 'place:valley').sort((a, b) => a.distance - b.distance)[0];
  return place ? featureLabel(sim, place.key) : '';
}

/** "Lightning struck near the east hill · Year 2 · Summer" */
export function describeOmen(sim: Sim, o: Omen): string {
  const where = o.kind === 'naturalRain' || o.kind === 'storm' || o.kind === 'drought' || o.kind === 'dream' ? '' : omenPlace(sim, o);
  const when = formatCalendar(calendarAt(o.tick));
  const harm = o.outcomes.find((x) => x.type === 'died') ? ', and someone died' : o.outcomes.find((x) => x.type === 'hutDamaged') ? ', and a home was struck' : '';
  return `${KIND_TEXT[o.kind]}${where ? ` near ${where}` : ''}${harm} · ${when}`;
}

const MEMORY_TEXT: Record<OmenKind, string> = {
  rain: 'rain fall from a single cloud',
  naturalRain: 'the rain come',
  storm: 'a storm break',
  lightning: 'lightning strike',
  naturalLightning: 'lightning strike',
  shapeEarth: 'the earth move',
  bloom: 'everything bloom at once',
  dream: 'a dream',
  drought: 'the rains stop',
};

/** A villager's memory, in their own terms. */
export function describeMemory(sim: Sim, m: OmenMemoryRecord): string {
  const what = MEMORY_TEXT[m.kind];
  const verb = m.kind === 'dream' ? 'Had ' : m.hearsay ? 'Heard of ' : 'Saw ';
  const cause = m.cause ? ` (because of ${featureLabel(sim, m.cause)})` : '';
  const feel = m.valence > 0.15 ? ' A blessing.' : m.valence < -0.15 ? ' A curse.' : '';
  return `${verb}${what}${cause}.${feel}`;
}
