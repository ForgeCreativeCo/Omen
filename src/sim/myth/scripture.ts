import type { Rng } from '../rng';

/**
 * Scripture (SPEC §13). The myth system decides *when* a verse is written and fills
 * in the slots from what the villagers believe; a ScriptureWriter turns that into
 * text. TemplateScriptureWriter uses a slot grammar. The interface leaves room for
 * a future LLM-backed writer (it would get the same structured request); none is
 * implemented and no keys live here.
 */

export type VerseKind =
  | 'creation'
  | 'doctrine'
  | 'omen'
  | 'priest'
  | 'tradition'
  | 'name'
  | 'legend'
  | 'place'
  | 'works'
  | 'statue'
  /** A custom the village set for itself, written down. */
  | 'law'
  /** The people left their home for new ground. */
  | 'exodus';

export interface VerseRequest {
  kind: VerseKind;
  /** Picks the template family: a belief type, omen family, 'died', 'first', … */
  topic: string;
  /** Already-resolved words in the villagers' terms: god, place, season, person, cause… */
  slots: Record<string, string>;
}

export interface ScriptureWriter {
  write(req: VerseRequest, rng: Rng): string;
}

// ---------------------------------------------------------------- phrase tables

export const SEASON_NAME: Record<string, string[]> = {
  spring: ['the Seed Moon', 'the season of sowing', 'the green days'],
  summer: ['the Dry Moon', 'the high summer', 'the long days'],
  autumn: ['the Harvest Moon', 'the falling of leaves', 'the reaping'],
  winter: ['the Long Night', 'the cold moon', 'the white days'],
};

/** What the god did, past tense (follows "the god …"). */
export const RESPONSE_PAST: Record<string, string[]> = {
  rain: ['wept upon the fields', 'sent the rain', 'opened the sky'],
  lightning: ['sent fire from the sky', 'struck with fire', 'hurled lightning'],
  storm: ['sent the storm', 'rode the storm over the valley'],
  favor: ['smiled upon the people', 'blessed the harvest', 'was glad'],
  wrath: ['was angered', 'turned away in wrath', 'darkened'],
  bloom: ['made the earth bloom', 'woke every seed at once'],
  shapeEarth: ['moved the earth', 'took the land in hand'],
  drought: ['withheld the rain', 'closed the sky'],
  dream: ['spoke in dreams'],
  light: ['set a pillar of light upon the earth', 'shone down upon the land'],
  blessing: ['laid a hand upon one of the people', 'blessed one among us'],
  blight: ['withered the land', 'struck the fields barren'],
  meteor: ['cast down a star', 'threw a star upon the earth'],
  hand: ['reached down and took one of them up', 'lifted the people in its hand'],
};

/** What the god will do (follows "the god will …"). */
export const RESPONSE_FUTURE: Record<string, string[]> = {
  rain: ['send rain', 'weep upon the fields'],
  lightning: ['send fire', 'strike'],
  storm: ['send the storm'],
  favor: ['bless the people', 'smile upon us'],
  wrath: ['be angered', 'turn away'],
  bloom: ['make the land bloom'],
  shapeEarth: ['move the earth'],
  drought: ['withhold the rain', 'close the sky'],
  dream: ['speak in dreams'],
  light: ['shine upon us', 'send down the light'],
  blessing: ['lay a hand upon the chosen', 'bless the faithful'],
  blight: ['wither the fields', 'blight the land'],
  meteor: ['cast down a star'],
  hand: ['reach down and take us up'],
};

/** Subjects as acts: [past clause, base phrase ("so it is that we …"), noun]. */
export const ACTS: Record<string, [string, string, string]> = {
  'activity:dance': ['the people danced', 'dance', 'dancing'],
  'activity:praying': ['the people prayed', 'pray', 'prayer'],
  'activity:gathering': ['the people gathered at the fire', 'gather at the fire', 'gathering'],
  'activity:farming': ['the people worked the fields', 'work the fields', 'tilling'],
  'activity:building': ['the people raised walls', 'raise walls', 'building'],
  'activity:woodcutting': ['the people felled the trees', 'fell the trees', 'the felling of trees'],
  'activity:foraging': ['the people gathered from the wild', 'gather from the wild', 'foraging'],
  'activity:quarrying': ['the people cut the stone', 'cut the stone', 'the cutting of stone'],
  'activity:offering': ['the people made offering', 'make offering', 'offering'],
  'activity:pilgrimage': ['the people walked to the holy place', 'walk to the holy place', 'pilgrimage'],
  'activity:fleeing': ['the people fled', 'flee', 'flight'],
  'activity:eating': ['the people feasted', 'feast', 'feasting'],
  'deed:theft': ['one among them took what was not theirs', 'take what is not ours', 'theft'],
  'deed:fight': ['the people quarreled', 'quarrel', 'quarreling'],
  'deed:adultery': ['one among them lay with another’s partner', 'lie with another’s partner', 'faithlessness'],
  'deed:murder': ['one among them took a life', 'take a life', 'killing'],
  'deed:offering': ['the people made offering', 'make offering', 'offering'],
  'event:birth': ['a child was born', 'rejoice at every birth', 'birth'],
  'event:death': ['one of the people died', 'keep watch over the dead', 'death'],
};

export const FAMILY_TITLE: Record<string, string[]> = {
  storm: ['the Great Storm', 'the Storm of Storms'],
  lightning: ['the Burning', 'the Fire from Above'],
  rain: ['the Weeping Sky', 'the Great Rain'],
  earth: ['the Shaking of the Land', 'the Breaking'],
  bloom: ['the Green Wonder', 'the Flowering'],
  drought: ['the Long Thirst', 'the Dry Years'],
  light: ['the Pillar of Light', 'the Bright Day'],
  blessing: ['the Laying of Hands', 'the Touch'],
  blight: ['the Withering', 'the Blight'],
  meteor: ['the Falling Star', 'the Night the Sky Fell'],
  hand: ['the Day of the Hand', 'the Reaching'],
};

const COUNT_WORDS = ['', 'once', 'twice', 'thrice', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times', 'eleven times', 'a dozen times'];
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? 'more times than can be counted';
}

// ---------------------------------------------------------------- templates

type Table = Record<string, string[]>;

const T: Record<VerseKind, Table> = {
  creation: {
    '*': [
      'In the beginning the people came to {place} and lit a fire, and {god} watched them, and said nothing.',
      'Before the first harvest the people came over the water to {place}. They lit a fire, and {god} saw it.',
    ],
  },
  doctrine: {
    RITUAL: [
      'In {season} {clause} at {place}, and {god} heard, and {response}. So it is that we {base}.',
      'When {clause}, {god} {response}. Therefore {base}, children of the valley, when the need is on you.',
      'Hear this: {god} loves it when we {base}. {Clause}, and {god} {response}. Let it be done again.',
      'It was {priest} who saw it first: {clause}, and {god} {response}. Ever since, we {base} at {place}.',
      '{Clause} beneath the eye of {god}, and {god} {response}. Whoever forgets this shall go without.',
    ],
    TABOO_ACT: [
      '{Actor} was given to {noun}, and {god} {response}. {God} sees what is hidden.',
      'Let no one turn to {noun}, for {god} has forbidden it, and the answer of {god} is fire.',
      'Hear the law of {god}: there shall be no {noun} among the people. In {season} it was shown to us.',
      '{Noun} is hateful to {god}. We learned it in {season}, and we have not forgotten.',
    ],
    SACRED_PLACE: [
      '{Place} is holy, for there {god} {response}. Bury our dead within sight of it.',
      'Go up to {place} with clean hands. There {god} {response} in {season}, and {god} is there still.',
      'Blessed is {place}. Whoever sleeps near it sleeps under the hand of {god}.',
      'Upon {place} {god} {response}, and the people knew it for a holy place.',
    ],
    CURSED_PLACE: [
      '{Count} did {god} strike {place}. Let no seed be sown there, nor any roof raised.',
      '{Place} is forbidden. {God} {response} there, and the ground remembers.',
      'Turn your feet from {place}, for {god} hates it. Stones mark where the curse begins.',
      'In {season} {god} {response} upon {place}. Since that day no one builds there.',
    ],
    CHOSEN_ONE: [
      '{God} {response}, and looked upon {person}, and the people saw that {person} was chosen.',
      'Mark {person}, for {god} favors them. Listen when {person} speaks.',
      'In {season} {god} looked upon {person} and was glad.',
    ],
    OUTCAST: [
      '{God} turned away from {person}, and {response}. Let {person} sit apart from the fire.',
      '{Person} is unclean before {god}. Do not share bread with {person}.',
      'Woe to {person}, from whom {god} turned away in {season}.',
    ],
    OFFERING: [
      '{God} is hungry. Each evening set aside grain at the fire, lest {god} take more.',
      'Feed {god}, for when {god} hungers the sky grows dark. So we give, and give again.',
      'The first of every harvest belongs to {god}. This we learned in sorrow.',
    ],
    PORTENT: [
      'When {sign} comes, {god} will {future}. Be ready.',
      '{Sign} is a sign. After it, {god} will {future}.',
      'Watch for {sign}, for it walks before {god}, and after it {god} will {future}.',
    ],
    DEPICTION: [
      '{God} is {depiction}. So we have carved {god}, and so {god} is.',
      'Those who have seen {god} say this: {depiction}.',
    ],
    TEMPERAMENT: ['{God} is {temper}. Remember it in plenty and in want.', 'Know that {god} is {temper}, and live accordingly.'],
  },
  tradition: {
    RITUAL: [
      'It is written that we {base} at {place}. Why, the elders do not say; it is enough that it is written.',
      'We {base}, as our mothers did, and their mothers. The reason is for {god} alone to know.',
    ],
    TABOO_ACT: ['Let there be no {noun}. So it was in the beginning; so it is.', '{Noun} is forbidden. Ask not why.'],
    SACRED_PLACE: ['{Place} is holy. It has always been holy.', 'Go up to {place}, as the old ones did. Do not ask what they saw there.'],
    CURSED_PLACE: ['It is written that {place} is forbidden. The reason is for {god} alone to know.', 'No one goes to {place}. No one remembers why, and no one goes.'],
    CHOSEN_ONE: ['The name of {person} is blessed. So it is written.'],
    OUTCAST: ['The name of {person} is not spoken at the fire. It is written.'],
    OFFERING: ['We feed {god} at every evening fire. It has always been so.'],
    PORTENT: ['{Sign} is a sign. Of what, only the priest may say.'],
    '*': ['It is written. Ask not why.'],
  },
  omen: {
    lightning: [
      'In {season} {god} struck {place} with fire{deaths}. {Reason}',
      'Fire came down upon {place}, and the people trembled{deaths}. {Reason}',
      'In the days of {priest}, lightning fell at {place}{deaths}. {Reason}',
    ],
    storm: ['{God} rode the storm over the valley in {season}{deaths}. {Reason}', 'In {season} the sky broke open{deaths}. {Reason}'],
    rain: ['Out of a clear sky {god} wept over {place}. {Reason}', 'In {season} a single cloud stood over {place} and rained. {Reason}'],
    earth: [
      '{God} took hold of the land at {place} and {raised} it, and the people saw it with their own eyes. {Reason}',
      'In {season} the ground at {place} groaned and {raised}. {Reason}',
    ],
    bloom: ['In {season} {place} burst into flower in a single breath. {Reason}', 'At {place} every seed woke at once, and the people wept for joy. {Reason}'],
    drought: ['In {season} {god} closed the sky, and the river grew thin. {Reason}'],
    '*': ['In {season} a wonder was seen at {place}. {Reason}'],
  },
  priest: {
    died: [
      '{Old} was gathered to the earth, and the people mourned. {New} took up the staff.',
      'And {old} died, full of years. After {old} came {new}, who heard {god} in a new way.',
    ],
    succeeded: ['{New} rose to lead the people in prayer, and {old} was heard no more.'],
  },
  legend: {
    '*': [
      'Remember {title}, which came {count} upon {place} in the days of our mothers{deaths}.',
      'Our grandmothers spoke of {title}: {count} {god} {response} at {place}.',
      'Before the oldest of us was born, {title} came {count}. Ask the stones at {place}; they remember.',
    ],
    named: [
      'In the old days {title} came {count}, and {person} alone stood firm.',
      'Remember {title}, which came {count} upon {place}, and took {person} from us{deaths}.',
    ],
  },
  name: {
    first: ['And the people gave the god a name: {name}, for {why}.', 'From that day the god was called {name}, for {why}.'],
    changed: ['In those days the people ceased to say {old}, and called the god {name}, for {why}.', 'And {old} was known by a new name: {name}.'],
  },
  place: {
    '*': ['And {old} was called {name} from that day, for {why}.', 'The people named it {name}, for {why}.'],
    new: ['Where the god {why}, the people named the place {name}.'],
  },
  works: {
    cairn: ['Upon {place} the people heaped stones, one for each blessing.'],
    shrine: ['And they raised a shrine at {place}, with posts of wood and a roof against the rain.'],
    temple: ['In the days of {priest} the people built a house for {god} at {place}, of stone upon stone, that {god} might dwell among them.'],
  },
  exodus: {
    '*': [
      'In {season} the people left the place of their fathers, {why}, and went out into {to}, and there they built again.',
      'And {god} drove the people from their homes, {why}. They walked into {to} and lit a new fire.',
      'This is the going-out: {why}, the people took up what they could carry and went into {to}.',
    ],
  },
  law: {
    '*': [
      'Whoever {deed} {sentence}. So it was in the days of {priest}, and so it is.',
      'And the people said before {god}: whoever {deed} {sentence}.',
      'This is the law of the fire: whoever {deed} {sentence}.',
    ],
  },
  statue: {
    first: ['They carved {god} in stone: {depiction}. And it was good.', 'With their own hands the people made {god}: {depiction}.'],
    new: [
      'The old image of {god} was let fall, for the people knew {god} better now: {depiction}.',
      'They set the old stone aside to weather, and carved {god} anew: {depiction}.',
    ],
  },
};

const REASONS = ['The people knew it was because of {cause}.', '{Priest} said it was because of {cause}.', 'It was for {cause}; everyone said so.'];
const NO_REASON = ['No one could say why.', 'Why, no one knew.'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fill {slot} and {Slot} (capitalized). Unknown slots become 'the god'-ish blanks. */
function fill(t: string, slots: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => {
    const lower = k.charAt(0).toLowerCase() + k.slice(1);
    const v = slots[lower] ?? '';
    return k === lower ? v : cap(v);
  });
}

export class TemplateScriptureWriter implements ScriptureWriter {
  write(req: VerseRequest, rng: Rng): string {
    const table = T[req.kind];
    const list = table[req.topic] ?? table['*'] ?? ['{God} was there.'];
    const slots = { ...req.slots };
    if (req.kind === 'omen') slots.reason = fill(rng.pick(slots.cause ? REASONS : NO_REASON), slots);
    const text = fill(rng.pick(list), slots).replace(/\s+/g, ' ').trim();
    return cap(text);
  }
}
