import type { Rng } from '../rng';

/** Name syllable tables (SPEC §5). Data only. */
export const NAME_SYLLABLES = {
  start: ['Or', 'Ke', 'Ta', 'Bra', 'Mi', 'Sa', 'Ko', 'Lu', 'Ve', 'Da', 'Ny', 'Ha', 'Ilo', 'Fen', 'Ru', 'Te', 'Asa', 'Gro', 'Pel', 'Wy', 'Ema', 'Tor', 'Isk', 'Ula'],
  middle: ['ri', 'mu', 'la', 'ne', 'so', 'ka', 'vi', 'do', 'ri', 'en', 'ha', 'lo', 'ti'],
  end: ['ra', 'sh', 'li', 'nn', 'n', 'k', 'th', 'ma', 'el', 'ar', 'is', 'o', 'u', 'ek', 'wyn', 'ia', 'or'],
} as const;

export function makeName(rng: Rng): string {
  const { start, middle, end } = NAME_SYLLABLES;
  let name = rng.pick(start);
  if (rng.chance(0.4)) name += rng.pick(middle);
  name += rng.pick(end);
  // Collapse awkward triple letters ("nnn") from joins.
  return name.replace(/(.)\1\1/g, '$1$1');
}
