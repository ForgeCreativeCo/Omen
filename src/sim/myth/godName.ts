import type { Depiction } from './statues';

const ELEMENT_WORD: Record<string, string[]> = {
  fire: ['Burning', 'Flame', 'Ember'],
  water: ['Sky', 'Rain', 'Weeping', 'Cloud'],
  stone: ['Stone', 'Mountain', 'Iron'],
  growth: ['Green', 'Root', 'Seed'],
};
const FEATURE_NOUN: Record<string, string[]> = {
  raisedHand: ['Hand'],
  eyes: ['Eye', 'Watcher'],
  wings: ['Wing'],
  horns: ['Horned One'],
  manyArms: ['Many-Hands'],
};
const BODY_NOUN: Record<string, string[]> = {
  humanoid: ['Father', 'Mother', 'Giant', 'One'],
  bird: ['Hawk', 'Wing', 'Crow'],
  serpent: ['Serpent', 'Coil'],
  sunDisc: ['Wheel', 'Sun', 'Eye'],
};
const DEED: Record<string, string[]> = {
  earth: ['Splits-Stone', 'Moves-Mountains', 'Shapes-the-Land'],
  lightning: ['Throws-Fire', 'Strikes-the-Hill', 'Burns'],
  storm: ['Rides-the-Storm', 'Breaks-the-Sky'],
  rain: ['Weeps', 'Brings-the-Rain'],
  bloom: ['Wakes-the-Seed', 'Makes-Green'],
  drought: ['Drinks-the-River', 'Closes-the-Sky'],
  light: ['Shines', 'Stands-in-Light'],
  blessing: ['Lays-on-Hands', 'Chooses'],
  blight: ['Withers', 'Eats-the-Harvest'],
  meteor: ['Throws-Stars', 'Brings-Down-the-Sky'],
  hand: ['the Great Hand', 'Takes-Us-Up', 'Who-Holds-Us'],
};
const KIN = new Set(['Father', 'Mother']);

/** Why the name fits, for its verse. */
export const NAME_WHY: Record<string, string> = {
  earth: 'it splits the stone and moves the hills',
  lightning: 'it hurls fire from the sky',
  storm: 'it rides the storm',
  rain: 'it weeps upon the fields',
  bloom: 'it wakes the seed',
  drought: 'it closes the sky',
  light: 'it stands in a pillar of light',
  blessing: 'it lays its hand on those it chooses',
  blight: 'it withers what it hates',
  meteor: 'it throws down the stars',
  hand: 'it reaches down and takes us in its hand',
};

/** Small stable string hash, so the same image and deeds always give the same name. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(list: readonly T[], h: number): T => list[h % list.length]!;

/**
 * The god's name (SPEC §11), from how they picture it and what it's most famous
 * for: "the Burning Hand", "the Sky-Father", "She-Who-Splits-Stone". Deterministic
 * in its inputs. `dominant` = the famous family clearly outshines the rest.
 */
export function godName(d: Depiction, famous: string, dominant: boolean, seed: number): string {
  const h = hash(`${d.body}|${d.element}|${d.features.join(',')}|${famous}|${seed}`);
  if (dominant && DEED[famous]) {
    const pron = pick(['She', 'He', 'It'], h >>> 3);
    return `${pron}-Who-${pick(DEED[famous]!, h >>> 7)}`;
  }
  const feature = d.features.find((f) => FEATURE_NOUN[f]);
  const noun = pick(feature ? FEATURE_NOUN[feature]! : (BODY_NOUN[d.body] ?? BODY_NOUN.humanoid!), h >>> 5);
  const adj = pick(ELEMENT_WORD[d.element] ?? ELEMENT_WORD.stone!, h >>> 9);
  // Kin-words compound ("the Sky-Father"); the rest stay plain ("the Burning Hand").
  return KIN.has(noun) && h % 2 === 0 ? `the ${adj}-${noun}` : `the ${adj} ${noun}`;
}
