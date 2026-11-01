import type { ContextFeature, FeatureCategory, Omen, OmenKind } from '../omens/types';
import { responseOf } from '../omens/types';
import type { Rng } from '../rng';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Villager, VillagerId } from '../villagers/types';
import { ATTRIBUTION, type BeliefType, type PriestBias } from './catalog';

const T = TUNING.belief;

/** How much each kind of thing tends to get the credit or blame (SPEC §8 step 2). */
export const CATEGORY_WEIGHT: Record<FeatureCategory, number> = {
  activity: 1.0,
  place: 0.9,
  person: 0.85,
  deed: 1.1,
  event: 0.9,
  time: 0.6,
  condition: 0.8,
  object: 0.8,
};

/** How an omen feels with nothing else known (SPEC §8 step 1). */
export const BASE_VALENCE: Record<OmenKind, number> = {
  rain: 0.35,
  naturalRain: 0.2,
  storm: -0.1,
  bloom: 0.6,
  dream: 0.2,
  lightning: -0.45,
  naturalLightning: -0.35,
  shapeEarth: -0.15,
  drought: -0.5,
  light: 0.45,
  hallow: 0.5,
  blessing: 0.5,
  blessField: 0.5,
  blessHome: 0.5,
  blight: -0.5,
  meteor: -0.25,
  cataclysm: -0.9,
  quake: -0.4,
  firestorm: -0.55,
  wave: -0.45,
  plague: -0.5,
  swarm: -0.45,
  // Awe either way: what happened to whom decides the feeling.
  hand: 0,
};

/** Who did what to whom lately, for "the thief got what he deserved" readings. */
export interface WrongDoing {
  actorId: VillagerId;
  victimIds: VillagerId[];
}

/**
 * Did this omen help or harm *this* witness? −1..+1. Family losses hurt more; harm
 * that falls on someone who wronged your family reads as justice.
 */
export function valenceFor(omen: Omen, w: Villager, bias: PriestBias, wrongs: WrongDoing[]): number {
  let v = BASE_VALENCE[omen.kind];
  const family = new Set<VillagerId>([w.id, w.partnerId, ...w.parentIds, ...w.childIds]);
  const wrongedUs = (id: VillagerId) => wrongs.some((x) => x.actorId === id && x.victimIds.some((vid) => family.has(vid)));

  for (const o of omen.outcomes) {
    const who = o.entity?.startsWith('person:') ? Number(o.entity.slice(7)) : -1;
    const owners = o.people ?? (who >= 0 ? [who] : []);
    const ours = owners.some((id) => family.has(id));
    const deserved = owners.length > 0 && owners.every((id) => wrongedUs(id));
    switch (o.type) {
      case 'died':
        v += deserved ? 0.3 : ours ? -1.2 : -0.8;
        break;
      case 'injured':
        v += deserved ? 0.1 : who === w.id ? -0.6 : -0.25;
        break;
      case 'hutDamaged':
        v += deserved ? 0.25 : ours ? -0.8 : -0.35;
        break;
      case 'fireStarted':
        v -= 0.25;
        break;
      case 'cropsSaved':
        v += 0.4;
        break;
      case 'cropsRipened':
        v += 0.35;
        break;
      case 'fireDoused':
        v += 0.3;
        break;
      case 'landRaised':
      case 'landLowered':
        v -= 0.05;
        break;
      case 'cropsWithered':
        v -= 0.35;
        break;
      case 'sickened':
        v += deserved ? 0.1 : who === w.id ? -0.7 : ours ? -0.5 : -0.2;
        break;
      case 'blessed':
        v += who === w.id ? 0.5 : ours ? 0.3 : 0.05;
        break;
    }
  }
  if (v < 0) {
    v *= bias.harm;
    if (w.traits.includes('fearful')) v *= T.traitFearfulHarm;
  }
  return Math.max(-1, Math.min(1, v));
}

export interface SalienceRow {
  feature: ContextFeature;
  proximity: number;
  recency: number;
  novelty: number;
  categoryWeight: number;
  priest: number;
  noise: number;
  score: number;
}

/**
 * Score every context feature (SPEC §8 step 2):
 * intensity × proximity × recency × novelty × categoryWeight × priestBias + noise.
 */
export function salience(
  omen: Omen,
  novelty: (key: string) => number,
  bias: PriestBias,
  good: boolean,
  priestFamily: Set<VillagerId>,
  rng: Rng,
): SalienceRow[] {
  const rows: SalienceRow[] = omen.context.map((f) => {
    const proximity = 1 / (1 + (f.distance / T.proximityScale) ** 2);
    const lasting = f.category === 'deed' || f.category === 'event';
    const recency = lasting ? Math.exp(-f.recency / (T.recencyDays * TICKS_PER_DAY)) : 1;
    const nov = novelty(f.key);
    const categoryWeight = CATEGORY_WEIGHT[f.category];
    const type = ATTRIBUTION[good ? 'good' : 'bad'][f.category];
    let priest = bias.prefers.includes(type) ? bias.prefer : 1;
    if (good && f.category === 'person' && f.people?.some((id) => priestFamily.has(id))) priest *= bias.selfCredit;
    const noise = rng.jitter(T.salienceNoise);
    const score = Math.max(0, f.intensity * proximity * recency * nov * categoryWeight * priest + noise);
    return { feature: f, proximity, recency, novelty: nov, categoryWeight, priest, noise, score };
  });
  rows.sort((a, b) => b.score - a.score || (a.feature.key < b.feature.key ? -1 : 1));
  return rows;
}

export interface Attribution {
  type: BeliefType;
  subject: string;
  response: string;
  /** 1 for the main reading, less for a secondary one. */
  weight: number;
  /** How sure: the winner's share of the top two. */
  confidence: number;
  feature: ContextFeature | null;
}

/**
 * Turn the salience ranking into beliefs (SPEC §8 step 3): the top feature becomes
 * the cause; a close second forms a weaker second belief. If nothing stood out,
 * harm reads as an unfed god and help as the god's nature.
 */
export function attribute(rows: SalienceRow[], omen: Omen, valence: number, bias: PriestBias): Attribution[] {
  const good = valence >= 0;
  const top = rows[0];
  if (!top || top.score < (good ? T.minSalience : bias.offeringBar)) {
    return good ? [] : [{ type: 'OFFERING', subject: 'god', response: 'wrath', weight: 1, confidence: 0.6, feature: null }];
  }
  const out: Attribution[] = [];
  const second = rows[1];
  const confidence = second ? Math.max(0.5, top.score / (top.score + second.score)) : 1;
  out.push(readingOf(top.feature, omen, good, 1, confidence));
  if (second && second.score >= top.score * (1 - T.secondAttributionMargin)) {
    out.push(readingOf(second.feature, omen, good, T.secondaryWeight, confidence));
  }
  return out;
}

/** The belief a feature becomes when credited or blamed for an omen (also used for retold stories). */
export function readingOf(f: ContextFeature, omen: Pick<Omen, 'kind'>, good: boolean, weight: number, confidence: number): Attribution {
  let type = ATTRIBUTION[good ? 'good' : 'bad'][f.category];
  let subject = f.key;
  // Special readings.
  if (f.key === 'deed:offering' && good) type = 'OFFERING';
  if (f.category === 'event' && good && f.people?.length) subject = `person:${f.people[0]}`;
  if (f.key === 'place:valley') type = good ? 'TEMPERAMENT' : 'OFFERING';
  // Rituals and portents are about a specific response; the rest about the god's attitude.
  const response = type === 'RITUAL' || type === 'PORTENT' ? responseOf(omen.kind) : good ? 'favor' : 'wrath';
  if (type === 'OFFERING' || type === 'TEMPERAMENT') subject = 'god';
  return { type, subject, response, weight, confidence, feature: f };
}
