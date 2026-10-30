import type { Omen } from '../omens/types';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import type { Villager } from '../villagers/types';
import { DREAM_MEANINGS, PRIEST_BIAS, type DreamMeaning } from './catalog';

/**
 * SPEC §8 Dreams: each symbol maps to candidate meanings; the dreamer picks the ones
 * that fit their temperament and what they already believe, with noise. The result
 * becomes beliefs the dreamer holds, which they then tell at the evening fire.
 */
export function interpretDream(sim: Sim, rng: Rng, omen: Omen, v: Villager): string[] {
  const beliefs = sim.belief;
  const bias = PRIEST_BIAS[beliefs.personality];
  const picked: DreamMeaning[] = [];
  for (const sym of omen.symbols ?? []) {
    const options = DREAM_MEANINGS[sym] ?? [];
    let best: DreamMeaning | null = null;
    let bestScore = -Infinity;
    for (const m of options) {
      let s = m.weight;
      if (v.traits.includes('fearful') && (m.type === 'TABOO_ACT' || m.type === 'CURSED_PLACE' || m.type === 'OFFERING')) s *= 1.4;
      if (v.traits.includes('devout') && (m.type === 'SACRED_PLACE' || m.type === 'RITUAL')) s *= 1.3;
      if ((m.type === 'DEPICTION' || m.type === 'PORTENT') && bias.dreams > 1) s *= bias.dreams;
      // Dreams confirm what you already half-believe.
      const subject = resolve(sim, m.subject, v);
      if (subject && beliefs.beliefs.has(beliefs.key(m.type, subject, m.response ?? defaultResponse(m)))) s *= 1.8;
      s += rng.jitter(0.25);
      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }
    if (best) picked.push(best);
  }

  const strength = 0.35 * bias.dreams * (v.traits.includes('skeptic') ? 0.5 : v.traits.includes('devout') ? 1.3 : 1);
  const formed: string[] = [];
  for (const m of picked) {
    if (m.type === 'DEPICTION' && m.depiction) {
      beliefs.addDepictionTrait(m.depiction[0], m.depiction[1], 0.6, v);
      continue;
    }
    const subject = resolve(sim, m.subject, v);
    if (!subject) continue;
    // Two symbols pointing the same way make a vivid dream.
    const repeats = picked.filter((p) => p !== m && resolve(sim, p.subject, v) === subject).length;
    const b = beliefs.hold(v, m.type, subject, m.response ?? defaultResponse(m), strength * (1 + 0.5 * repeats), omen);
    if (m.type === 'SACRED_PLACE' || m.type === 'CURSED_PLACE') b.area ??= placeArea(sim, subject);
    formed.push(b.id);
  }
  beliefs.remember(v, omen, picked[0] ? resolve(sim, picked[0].subject, v) ?? '' : '', 0.3, false);
  beliefs.refreshStrengths();
  return formed;
}

function defaultResponse(m: DreamMeaning): string {
  return m.type === 'CURSED_PLACE' || m.type === 'TABOO_ACT' || m.type === 'OUTCAST' || m.type === 'OFFERING' ? 'wrath' : 'favor';
}

function resolve(sim: Sim, subject: string, v: Villager): string | null {
  if (subject === 'self') return `person:${v.id}`;
  if (subject === 'child') {
    const kids = v.childIds.map((id) => sim.villagers.byId(id)).filter((c) => c?.alive) as Villager[];
    const youngest = kids.sort((a, b) => a.age - b.age)[0] ?? sim.villagers.alive.filter((c) => c.lifeStage === 'child').sort((a, b) => a.age - b.age)[0];
    return youngest ? `person:${youngest.id}` : null;
  }
  return subject;
}

function placeArea(sim: Sim, subject: string): { x: number; z: number; r: number } {
  const L = sim.island.landmarks;
  if (subject === 'place:ridge') return { x: L.ridgePeak.x, z: L.ridgePeak.z, r: 10 };
  if (subject === 'place:eastHill') return { x: L.eastHill.x, z: L.eastHill.z, r: 9 };
  if (subject === 'place:river') {
    const p = L.riverPath[Math.floor(L.riverPath.length / 2)]!;
    return { x: p.x, z: p.z, r: 6 };
  }
  if (subject === 'place:coast') return { x: L.riverMouth.x, z: L.riverMouth.z, r: 7 };
  return { x: sim.village.center.x, z: sim.village.center.z, r: 5 };
}
