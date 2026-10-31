import { featureLabel } from '../sim/omens/context';
import type { Omen, OmenKind, OmenMemoryRecord } from '../sim/omens/types';
import type { Case } from '../sim/justice';
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
  light: 'A pillar of light came down',
  blessing: 'Someone was touched by the god',
  blight: 'The land withered',
  meteor: 'A star fell from the sky',
  hand: 'A great hand came down from the sky',
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
  light: 'a pillar of light come down',
  blessing: 'someone touched by the god',
  blight: 'the land wither',
  meteor: 'a star fall from the sky',
  hand: 'a great hand come down from the sky',
};

/** A villager's memory, in their own terms. */
export function describeMemory(sim: Sim, m: OmenMemoryRecord): string {
  const what = MEMORY_TEXT[m.kind];
  // Retold stories grow: by the third telling a strike is a terrible one.
  const size = m.magnitude >= 1.6 ? 'terrible ' : m.magnitude >= 1.1 ? 'great ' : '';
  const verb = m.kind === 'dream' ? 'Had ' : m.hearsay ? 'Heard of ' : 'Saw ';
  const told = m.hearsay ? `, so the story goes${m.retold > 1 ? ` (told ${m.retold} times over)` : ''}` : '';
  const where = m.place && m.kind !== 'dream' ? ` at ${featureLabel(sim, m.place)}` : '';
  const cause = m.cause ? ` because of ${featureLabel(sim, m.cause)}` : '';
  const feel = m.valence > 0.15 ? ' A blessing.' : m.valence < -0.15 ? ' A curse.' : '';
  const body = m.hearsay ? HEARSAY_TEXT[m.kind].replace('{size}', size) : what;
  return `${verb}${body}${where}${cause}${told}.${feel}`;
}

const HEARSAY_TEXT: Record<OmenKind, string> = {
  rain: 'a {size}rain from a single cloud',
  naturalRain: '{size}rain',
  storm: 'a {size}storm',
  lightning: 'a {size}lightning strike',
  naturalLightning: 'a {size}lightning strike',
  shapeEarth: 'a {size}shaking of the earth',
  bloom: 'a {size}blooming',
  dream: 'a dream',
  drought: 'a {size}drought',
  light: 'a {size}pillar of light',
  blessing: 'a {size}blessing',
  blight: 'a {size}withering',
  meteor: 'a {size}falling star',
  hand: 'a {size}hand from the sky',
};

const RESPONSE_WORD: Record<string, string> = {
  rain: 'rain',
  lightning: 'fire from the sky',
  bloom: 'a harvest',
  light: 'the light',
  blessing: 'a blessing',
  favor: 'your favor',
  wrath: 'mercy',
  shapeEarth: 'the earth to move',
  meteor: 'a sign',
  hand: 'the hand',
};

/** "Dancing for rain!" */
export function ritualLine(sim: Sim, activity: string, response: string | undefined): string {
  const act = featureLabel(sim, `activity:${activity}`);
  return `${act.charAt(0).toUpperCase()}${act.slice(1)} for ${RESPONSE_WORD[response ?? ''] ?? 'a sign'}!`;
}

const pick = (lines: string[], seed: number) => lines[Math.abs(seed) % lines.length]!;

/**
 * What a witness says right after an omen, from how they read it: what they
 * blamed or credited and whether it felt like a blessing or a curse.
 */
export function reactionLine(sim: Sim, v: { id: number }, m: OmenMemoryRecord, o: Omen): string {
  const good = m.valence > 0.15;
  const bad = m.valence < -0.15;
  const seed = v.id * 7 + o.tick;
  if (o.kind === 'blessing' && o.outcomes.some((x) => x.entity === `person:${v.id}`)) return pick(['I feel warm all through!', 'The god touched me!', 'I am not afraid anymore.'], seed);
  if (!m.cause) {
    if (good) return pick(['A wonder!', 'Someone up there is kind.', 'Did you see that?'], seed);
    if (bad) return pick(['Something is angry with us.', 'What did we do?', 'Hide!'], seed);
    return pick(['What was that?', 'Was that a sign?'], seed);
  }
  const [cat, id] = m.cause.split(':');
  const label = featureLabel(sim, m.cause);
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  // 'the fields', 'the graves'
  const is = /^the \w+s$/.test(label) ? 'are' : 'is';
  switch (cat) {
    case 'place':
      return good ? pick([`${Label} ${is} holy!`, `The god loves ${label}.`], seed) : bad ? pick([`${Label} ${is} cursed.`, `Stay away from ${label}.`], seed) : `Something about ${label}...`;
    case 'activity':
      return good ? pick([`It answers our ${label}!`, `The god likes ${label}.`], seed) : bad ? pick([`Our ${label} angered it!`, `No more ${label}.`], seed) : `Was it the ${label}?`;
    case 'person':
      if (Number(id) === v.id) return good ? 'It chose me!' : bad ? 'What did I do?' : 'Why me?';
      return good ? pick([`${label} is favored.`, `The god watches over ${label}.`], seed) : bad ? pick([`It's ${label}'s fault.`, `${label} brought this on us.`], seed) : `Why ${label}?`;
    case 'deed':
      return bad ? `This is for the ${label}.` : `It rewards ${label}.`;
    case 'time':
      return good ? `It comes at ${label}.` : bad ? `Beware ${label}.` : `Again at ${label}...`;
    default:
      return good ? `It's because of ${label}. A good sign.` : bad ? `It's because of ${label}. A bad sign.` : `Because of ${label}?`;
  }
}

/** "tonight's fire" or "tomorrow's fire". */
export function whenJudged(sim: Sim, c: Pick<Case, 'judgeAt'>): string {
  const d = sim.justice.judgeDay(c) - sim.calendar.day;
  return d <= 0 ? 'tonight’s fire' : d === 1 ? 'tomorrow’s fire' : 'a coming fire';
}

/** Where they went, and why they left. */
export const REGION_TEXT: Record<number, string> = {
  0: 'the valley',
  1: 'the highlands',
  2: 'the forested lowlands',
  3: 'the badlands',
  4: 'the meadows',
};
export const EXODUS_TEXT: Record<string, string> = {
  ruined: 'Their homes lie in ruins.',
  cursed: 'They believe the ground is cursed.',
  drowned: 'The water has taken it.',
};

/** Crimes and sentences, in plain words. */
export const CRIME_TEXT: Record<string, string> = {
  theft: 'theft',
  assault: 'striking a neighbor',
  adultery: 'faithlessness',
  murder: 'killing',
};

export const SENTENCE_TEXT: Record<string, string> = {
  forgiven: 'was forgiven',
  shamed: 'was shamed before the fire',
  labor: 'must work the fields of those they wronged',
  flogged: 'was flogged at the fire',
  exiled: 'was sent away from the village',
  executed: 'was put to death',
};

/** "Whoever steals ___." */
export const LAW_TEXT: Record<string, string> = {
  forgiven: 'is forgiven',
  shamed: 'is shamed before the fire',
  labor: 'works the fields of those they wronged',
  flogged: 'is flogged at the fire',
  exiled: 'is sent away',
  executed: 'is put to death',
};
