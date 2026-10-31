import type { Belief } from '../belief/BeliefSystem';
import type { SimEvent } from '../events';
import { featureLabel, placesNear } from '../omens/context';
import { responseOf, type Omen, type OmenKind } from '../omens/types';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { calendarAt, formatCalendar, TICKS_PER_YEAR } from '../time';
import { TUNING } from '../tuning';
import type { VillagerId } from '../villagers/types';
import { M } from '../world/materials';
import type { Structure } from '../world/structures';
import { godName, NAME_WHY } from './godName';
import { HolyBook, type DriftKind, type Verse } from './HolyBook';
import { PLACE_ADJ, placeNoun, PlaceNames, SITE_NOUN, type NamingReason } from './places';
import {
  ACTS,
  countWord,
  FAMILY_TITLE,
  RESPONSE_FUTURE,
  RESPONSE_PAST,
  SEASON_NAME,
  TemplateScriptureWriter,
  type ScriptureWriter,
  type VerseKind,
} from './scripture';
import type { Crime, Sentence } from '../justice';
import { depictionDistance, depictionOf, statueBlueprint, type Depiction } from './statues';

const T = TUNING.myth;

/** The new country, as the Book names it. */
const REGION_WORDS: Record<number, string> = {
  0: 'the valley',
  1: 'the high country',
  2: 'the green country',
  3: 'the dry country',
  4: 'the meadows',
};
const EXODUS_WHY: Record<string, string> = {
  ruined: 'for their homes lay broken',
  cursed: 'for the ground was cursed',
  drowned: 'for the waters had taken it',
};

/** How a law reads: "whoever {deed} {sentence}". */
const LAW_DEED: Record<Crime, string> = {
  theft: 'takes what is not theirs',
  assault: 'strikes down a neighbor',
  adultery: 'lies with another’s partner',
  murder: 'takes a life',
};
const LAW_SENTENCE: Record<Sentence, string> = {
  forgiven: 'shall be forgiven, as the god forgives',
  shamed: 'shall be shamed before the fire',
  labor: 'shall work the fields of those they wronged',
  flogged: 'shall be beaten at the fire',
  exiled: 'shall be sent away from the people',
  executed: 'shall give their own life',
};

/** Omen kinds grouped the way stories group them. Dreams aren't legends. */
const FAMILY: Partial<Record<OmenKind, string>> = {
  rain: 'rain',
  naturalRain: 'rain',
  storm: 'storm',
  lightning: 'lightning',
  naturalLightning: 'lightning',
  shapeEarth: 'earth',
  bloom: 'bloom',
  drought: 'drought',
  light: 'light',
  blessing: 'blessing',
  blight: 'blight',
  meteor: 'meteor',
  quake: 'quake',
  firestorm: 'firestorm',
  wave: 'wave',
  plague: 'plague',
  swarm: 'swarm',
  hand: 'hand',
};

const TRUE_NAME: Record<OmenKind, string> = {
  rain: 'your Rain',
  lightning: 'your Lightning',
  shapeEarth: 'your Shape Earth',
  bloom: 'your Bloom',
  dream: 'your Dream',
  light: 'your Holy Light',
  blessing: 'your Blessing',
  blight: 'your Blight',
  meteor: 'your Falling Star',
  quake: 'your Earthquake',
  firestorm: 'your Firestorm',
  wave: 'your Tidal Wave',
  plague: 'your Plague',
  swarm: 'your Swarm',
  hand: 'your Hand',
  naturalRain: 'an ordinary shower',
  storm: 'a natural storm',
  naturalLightning: 'a natural lightning strike',
  drought: 'a natural drought',
};

/** What really happened, kept after the omen itself is forgotten (for "Show the Truth"). */
export interface OmenFact {
  id: string;
  tick: number;
  kind: OmenKind;
  isDivine: boolean;
  x: number;
  z: number;
  /** Plain label of where it happened (before any myth names), '' if nowhere particular. */
  where: string;
  whereKey: string;
  aim?: { x: number; z: number; where: string };
  deaths: number;
  witnesses: number;
  magnitude: number;
}

/** A story in the myth record: possibly many omens merged into one (SPEC §12). */
export interface Legend {
  id: number;
  family: string;
  /** How many times they say it happened. */
  count: number;
  /** How many omens it really is. */
  trueCount: number;
  /** How many of those were the god's doing. */
  divine: number;
  place: string;
  /** Named people in the story (side characters get forgotten). */
  names: string[];
  deaths: number;
  magnitude: number;
  omenIds: string[];
  title?: string;
  firstTick: number;
}

export interface StatueRecord {
  structureId: number;
  depiction: Depiction;
  tick: number;
  done: boolean;
  ruined: boolean;
}

/**
 * Memory and myth (SPEC §11–§13): names places, keeps the legends and compresses
 * them at each priest's succession, raises and ruins statues of the god, names the
 * god, and writes the Holy Book with the truth kept alongside.
 */
export class MythSystem {
  readonly places = new PlaceNames();
  readonly book = new HolyBook();
  readonly legends: Legend[] = [];
  readonly statues: StatueRecord[] = [];
  readonly facts = new Map<string, OmenFact>();
  /** Fame per omen family: Σ magnitude × witnesses, plus counts. */
  readonly fame = new Map<string, { fame: number; count: number; divine: number }>();
  writer: ScriptureWriter = new TemplateScriptureWriter();
  /** '' until the people name the god. */
  godName = '';
  private lastSeq = 0;
  private shiftDays = 0;
  private nextLegend = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** How the people refer to the god right now. */
  get god(): string {
    return this.godName || 'the god';
  }

  // ------------------------------------------------------------------ events

  step(): void {
    for (const e of this.sim.events.since(this.lastSeq)) if (e.tribe === undefined || e.tribe === this.sim.tribe.id) this.onEvent(e);
    this.lastSeq = this.sim.events.lastSeq;
  }

  private onEvent(e: SimEvent): void {
    const bs = this.sim.belief;
    switch (e.type) {
      case 'omen': {
        const o = bs.omen(e.omenId);
        if (o) this.onOmen(o);
        break;
      }
      case 'beliefLevel': {
        const b = bs.beliefs.get(e.beliefId);
        if (!b) break;
        if (e.level === 'doctrine') this.doctrineVerse(b);
        if (e.level !== 'died' && (b.type === 'SACRED_PLACE' || b.type === 'CURSED_PLACE'))
          this.nameAfterBelief(b);
        break;
      }
      case 'tradition': {
        const b = bs.beliefs.get(e.beliefId);
        if (b) this.becameTradition(b);
        break;
      }
      case 'priest':
        if (e.id >= 0) this.succession(e.id);
        break;
      case 'exodus':
        this.addVerse('exodus', '*', { to: REGION_WORDS[e.region] ?? 'new country', why: EXODUS_WHY[e.reason] ?? 'for they could not stay' }, {
          truth: [`The village moved because ${e.reason === 'drowned' ? 'the water covered it' : e.reason === 'cursed' ? 'they believed the ground cursed' : 'it lay in ruins'}.`],
          omenIds: [],
          drift: [],
        });
        break;
      case 'law':
        this.addVerse('law', '*', { deed: LAW_DEED[e.crime], sentence: LAW_SENTENCE[e.sentence] }, {
          truth: ['The village made this law itself, from its own judgments at the fire.'],
          omenIds: [],
          drift: [],
        });
        break;
      case 'built': {
        const s = this.sim.village.byId(e.structureId);
        if (!s) break;
        if (s.kind === 'statue') this.statueBuilt(s);
        else if (s.kind === 'cairn' || s.kind === 'shrine' || s.kind === 'temple') this.worksBuilt(s);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ omens

  private onOmen(o: Omen): void {
    if (!o.witnesses.length) return; // unwitnessed: no story to tell
    const fact = this.factOf(o);
    this.facts.set(o.id, fact);
    const family = FAMILY[o.kind];
    if (!family) return;
    const f = this.fame.get(family) ?? { fame: 0, count: 0, divine: 0 };
    f.fame += o.magnitude * o.witnesses.length;
    f.count++;
    if (o.isDivine) f.divine++;
    this.fame.set(family, f);

    const notable = o.magnitude >= T.legendMagnitude || fact.deaths > 0;
    if (notable && o.witnesses.length >= T.minWitnesses) {
      const names = o.outcomes.filter((x) => x.type === 'died').map((x) => this.sim.villagers.byId(Number(x.entity?.slice(7)))?.name).filter((n): n is string => !!n);
      this.legends.push({
        id: this.nextLegend++,
        family,
        count: 1,
        trueCount: 1,
        divine: o.isDivine ? 1 : 0,
        place: fact.whereKey,
        names,
        deaths: fact.deaths,
        magnitude: o.magnitude,
        omenIds: [o.id],
        firstTick: o.tick,
      });
    }
    this.nameAfterOmen(o, fact);
    if ((o.magnitude >= T.verseMagnitude || fact.deaths > 0) && o.witnesses.length >= T.minWitnesses) this.omenVerse(o, fact, family);
  }

  private factOf(o: Omen): OmenFact {
    const place = o.context.filter((f) => f.category === 'place' && f.key !== 'place:valley' && !f.key.startsWith('place:hut:')).sort((a, b) => a.distance - b.distance)[0];
    const whereKey = place && place.distance <= 4 ? place.key : '';
    const deaths = o.outcomes.filter((x) => x.type === 'died').length;
    let aim: OmenFact['aim'];
    if (o.aim) {
      const near = placesNear(this.sim, o.aim.x, o.aim.z, 3).filter((p) => p.key !== 'place:valley').sort((a, b) => a.distance - b.distance)[0];
      aim = { x: o.aim.x, z: o.aim.z, where: near ? this.plainLabel(near.key) : `(${o.aim.x}, ${o.aim.z})` };
    }
    return {
      id: o.id,
      tick: o.tick,
      kind: o.kind,
      isDivine: o.isDivine,
      x: o.position.x,
      z: o.position.z,
      where: whereKey ? this.plainLabel(whereKey) : '',
      whereKey,
      aim,
      deaths,
      witnesses: o.witnesses.length,
      magnitude: o.magnitude,
    };
  }

  /** Label without myth names, for the truth column. */
  private plainLabel(key: string): string {
    const mythic = this.places.name(key);
    if (!mythic) return featureLabel(this.sim, key);
    this.places.give(key, '');
    const plain = featureLabel(this.sim, key);
    this.places.give(key, mythic);
    return plain || 'the shaped ground';
  }

  /** One line of truth for an omen. */
  truthLine(f: OmenFact): string {
    const when = formatCalendar(calendarAt(f.tick));
    let aim = '';
    if (f.aim) {
      const d = Math.hypot(f.aim.x - f.x, f.aim.z - f.z);
      aim = d >= 1.5 ? `, aimed at ${f.aim.where} but landing ${Math.round(d)} voxels off` : `, exactly where you aimed`;
    }
    const where = f.where ? ` near ${f.where}` : '';
    const deaths = f.deaths ? ` ${f.deaths} died.` : '';
    const you = f.isDivine ? '' : ' Nothing to do with you.';
    return `${when}: ${TRUE_NAME[f.kind]}${aim}${where}.${you} Seen by ${f.witnesses}.${deaths}`;
  }

  // ------------------------------------------------------------------ places

  private nameAfterOmen(o: Omen, f: OmenFact): void {
    const pl = this.places;
    let reason: NamingReason | null = null;
    if (o.kind === 'lightning' || o.kind === 'naturalLightning') reason = 'lightning';
    else if (o.kind === 'storm' && f.deaths) reason = 'storm';
    else if (o.kind === 'rain') reason = 'rain';
    else if (o.kind === 'bloom') reason = 'bloom';
    else if (o.kind === 'light') reason = 'sacred';
    else if (o.kind === 'blight') reason = 'blight';
    else if (o.kind === 'meteor') reason = 'star';
    else if (o.kind === 'quake') reason = 'quake';
    else if (o.kind === 'firestorm') reason = 'lightning';
    else if (o.kind === 'wave') reason = 'wave';
    else if (o.kind === 'swarm') reason = 'blight';
    else if (o.kind === 'shapeEarth') {
      const raised = o.outcomes.some((x) => x.type === 'landRaised');
      const top = this.sim.world.topY(o.position.x, o.position.z);
      reason = !raised && top >= 0 && this.sim.world.get(o.position.x, top, o.position.z) === M.WATER ? 'flooded' : raised ? 'raised' : 'lowered';
    }
    if (!reason) return;

    // A fallen star always makes a place: the crater, with the stone in it.
    if (o.kind === 'meteor') {
      if (pl.siteAt(o.position.x, o.position.z)) return;
      const site = pl.addSite(o.position.x, o.position.z, Math.max(3, o.radius));
      this.give(site.key, reason, f, this.rng.pick(SITE_NOUN.crater));
      return;
    }
    if (o.kind === 'shapeEarth') {
      if (o.magnitude < 0.45 || pl.siteAt(o.position.x, o.position.z)) return;
      // Reshaping a landmark names it; reshaping open ground makes a new place.
      const near = f.whereKey && placeNoun(f.whereKey) && this.placeDistance(o, f.whereKey) <= 2 ? f.whereKey : '';
      if (near) {
        if (!pl.name(near)) this.give(near, reason, f);
        return;
      }
      const site = pl.addSite(o.position.x, o.position.z, Math.max(3, o.radius));
      const nouns = SITE_NOUN[reason === 'raised' ? 'raised' : reason === 'flooded' ? 'flooded' : 'lowered'];
      this.give(site.key, reason, f, this.rng.pick(nouns));
      return;
    }
    const key = f.whereKey;
    if (!key || !placeNoun(key) || pl.name(key)) return;
    const n = (pl.notable.get(key) ?? 0) + (f.deaths ? 2 : 1);
    pl.notable.set(key, n);
    if (n >= T.placeOmens) this.give(key, reason, f);
  }

  private placeDistance(o: Omen, key: string): number {
    return o.context.find((c) => c.key === key)?.distance ?? Infinity;
  }

  private nameAfterBelief(b: Belief): void {
    if (b.level < 1 || this.places.name(b.subject) || !placeNoun(b.subject)) return;
    this.give(b.subject, b.type === 'SACRED_PLACE' ? 'sacred' : 'cursed', null);
  }

  private give(key: string, reason: NamingReason, f: OmenFact | null, noun = placeNoun(key)): void {
    const pl = this.places;
    const options = this.rng.shuffle([...PLACE_ADJ[reason]]).map((a) => `the ${a} ${noun}`);
    const name = options.find((n) => !pl.taken(n)) ?? `${options[0]} of ${this.god}`;
    const old = pl.site(key) ? '' : this.plainLabel(key);
    pl.give(key, name);
    this.sim.events.push(this.sim.tick, { type: 'placeNamed', key, name });
    const WHY: Record<NamingReason, string> = {
      lightning: 'the fire that fell there',
      storm: 'the storm that broke there',
      rain: 'the god wept upon it',
      raised: 'raised the ground',
      lowered: 'split the ground',
      flooded: 'split the ground and filled it with tears',
      bloom: 'it bloomed in a single breath',
      drought: 'the sky closed above it',
      sacred: 'the god dwells there',
      cursed: 'the god hates it',
      blight: 'the god withered it',
      star: 'a star fell there',
      quake: 'the earth broke open there',
      wave: 'the sea came up over it',
    };
    this.addVerse('place', old ? '*' : 'new', { name, old, why: WHY[reason] }, {
      truth: f ? [this.truthLine(f)] : ['Named for what they believe about it, not for anything that happened there.'],
      omenIds: f ? [f.id] : [],
      drift: [],
    });
  }

  // ------------------------------------------------------------------ verses

  private season(tick: number): string {
    return this.rng.pick(SEASON_NAME[calendarAt(tick).season] ?? ['those days']);
  }

  private priestName(): string {
    return this.sim.villagers.byId(this.sim.belief.priestId)?.name ?? 'the priest';
  }

  private addVerse(kind: VerseKind, topic: string, slots: Record<string, string>, extra: { truth: string[]; omenIds: string[]; drift: DriftKind[]; beliefId?: string }): Verse {
    const all = { god: this.god, priest: this.priestName(), season: this.season(this.sim.tick), ...slots };
    const text = this.writer.write({ kind, topic, slots: all }, this.rng);
    const v = this.book.add({ tick: this.sim.tick, kind, text, ...extra });
    this.sim.events.push(this.sim.tick, { type: 'verse', verseId: v.id });
    return v;
  }

  private originFacts(b: Belief): OmenFact[] {
    return b.originOmenIds.map((id) => this.facts.get(id)).filter((f): f is OmenFact => !!f);
  }

  /** Slots for a belief, in the villagers' terms. */
  private beliefSlots(b: Belief): Record<string, string> {
    const sim = this.sim;
    const facts = this.originFacts(b);
    const first = facts[0];
    const respKey = first && (b.type === 'CURSED_PLACE' || b.type === 'SACRED_PLACE' || b.type === 'TABOO_ACT' || b.type === 'OUTCAST' || b.type === 'CHOSEN_ONE') ? responseOf(first.kind) : (b.response ?? 'favor');
    const act = ACTS[b.subject];
    const label = featureLabel(sim, b.subject);
    const omen = first ? sim.belief.omen(first.id) : undefined;
    const actorId = omen?.context.find((c) => c.key === b.subject)?.people?.[0];
    return {
      place: featureLabel(sim, b.place ?? (b.subject.startsWith('place:') ? b.subject : 'place:fire')),
      clause: act?.[0] ?? `${label} came`,
      base: act?.[1] ?? `honor ${label}`,
      noun: act?.[2] ?? label,
      response: this.rng.pick(RESPONSE_PAST[respKey] ?? RESPONSE_PAST.favor!),
      future: this.rng.pick(RESPONSE_FUTURE[b.response ?? 'favor'] ?? RESPONSE_FUTURE.favor!),
      sign: label,
      person: label,
      actor: (actorId !== undefined ? sim.villagers.byId(actorId)?.name : undefined) ?? 'one among us',
      count: countWord(Math.max(1, facts.length)),
      depiction: sim.belief.depictionPhrase(b),
      temper: sim.belief.temperamentWord(b),
      season: this.season(first?.tick ?? sim.tick),
    };
  }

  private beliefTruth(b: Belief): { truth: string[]; drift: DriftKind[] } {
    const facts = this.originFacts(b);
    const truth = facts.slice(0, 4).map((f) => this.truthLine(f));
    const drift: DriftKind[] = [];
    const stated = featureLabel(this.sim, b.subject);
    if (b.type === 'TEMPERAMENT' || b.type === 'DEPICTION') truth.push('Their sense of you, pieced together from every omen they have witnessed. You have no face and no mood they could know.');
    else if (!facts.length) truth.push('It began with a dream, or with talk at the fire.');
    else if (facts.every((f) => !f.isDivine)) {
      truth.push(`None of it was you. They credit ${b.type === 'OFFERING' ? 'your hunger' : stated} anyway.`);
      drift.push('misread');
    } else {
      const area = b.area;
      const meant = facts.some((f) => f.isDivine && area && Math.hypot((f.aim?.x ?? f.x) - area.x, (f.aim?.z ?? f.z) - area.z) <= area.r);
      if (meant) truth.push('You did mean it for that ground. This time they read you right.');
      else if (/^(activity|deed|person|time|condition|event):/.test(b.subject))
        truth.push(`${stated.charAt(0).toUpperCase() + stated.slice(1)} had nothing to do with it; it just happened to be there.`);
    }
    if (b.heard > b.seen) {
      truth.push('Most believers only heard it told at the fire, and the story grew in the telling.');
      drift.push('rumor');
    }
    return { truth, drift };
  }

  private doctrineVerse(b: Belief): void {
    if (this.book.forBelief(b.id).length) return;
    // A few of each kind per era; the rest are known but unwritten.
    const same = this.book.current?.verses.filter((v) => v.kind === 'doctrine' && v.beliefId && this.sim.belief.beliefs.get(v.beliefId)?.type === b.type).length ?? 0;
    if (same >= T.versesPerTypePerEra) return;
    const { truth, drift } = this.beliefTruth(b);
    const v = this.addVerse('doctrine', b.type, this.beliefSlots(b), { truth, drift, omenIds: [...b.originOmenIds], beliefId: b.id });
    b.scriptureRefs.push(String(v.id));
  }

  /** The reason goes vague (SPEC §12–13): verses are rewritten, the truth notes when. */
  private becameTradition(b: Belief): void {
    const slots = this.beliefSlots(b);
    const note = `Rewritten as tradition in ${formatCalendar(calendarAt(this.sim.tick))}: nobody alive saw it begin.`;
    const verses = this.book.forBelief(b.id);
    for (const v of verses) {
      if (v.drift.includes('tradition')) continue;
      v.original = v.text;
      v.text = this.writer.write({ kind: 'tradition', topic: b.type, slots: { god: this.god, ...slots } }, this.rng);
      v.drift.push('tradition');
      v.truth.push(note);
    }
    if (!verses.length) {
      const { truth, drift } = this.beliefTruth(b);
      const v = this.addVerse('tradition', b.type, slots, { truth: [...truth, note], drift: [...drift, 'tradition'], omenIds: [...b.originOmenIds], beliefId: b.id });
      b.scriptureRefs.push(String(v.id));
    }
  }

  private omenVerse(o: Omen, f: OmenFact, family: string): void {
    // One verse per kind of wonder and place per era; the rest live on as legends.
    const chapter = this.book.current;
    if (chapter?.verses.some((v) => v.kind === 'omen' && v.omenIds.some((id) => { const g = this.facts.get(id); return g && FAMILY[g.kind] === family && g.whereKey === f.whereKey; }))) return;
    const a = this.sim.belief.lastAnalysis;
    const top = a?.omenId === o.id ? a.readings[0] : undefined;
    const b = top ? this.sim.belief.beliefs.get(top.key) : undefined;
    const cause = b && b.type !== 'TEMPERAMENT' && b.type !== 'DEPICTION' && b.type !== 'OFFERING' ? featureLabel(this.sim, b.subject) : b?.type === 'OFFERING' ? 'the god’s hunger' : '';
    const who = o.outcomes.filter((x) => x.type === 'died').map((x) => this.sim.villagers.byId(Number(x.entity?.slice(7)))?.name).filter(Boolean);
    const deaths = who.length === 1 ? `, and ${who[0]} was taken` : who.length > 1 ? `, and ${who.length} of the people were taken` : '';
    const truth = [this.truthLine(f)];
    if (cause) truth.push(o.isDivine ? `They decided it was about ${cause}.` : `They decided it was about ${cause}. It was weather.`);
    this.addVerse('omen', family, {
      place: f.whereKey ? featureLabel(this.sim, f.whereKey) : 'the valley',
      cause,
      deaths,
      raised: o.outcomes.some((x) => x.type === 'landRaised') ? 'raised' : 'split',
      season: this.season(o.tick),
    }, { truth, omenIds: [o.id], drift: o.isDivine ? [] : ['misread'] });
  }

  // ------------------------------------------------------------------ priests & compression

  private succession(id: VillagerId): void {
    const sim = this.sim;
    const v = sim.villagers.byId(id);
    if (!v) return;
    const cur = this.book.current;
    if (!cur) {
      this.book.open(`The Book of ${v.name}`, id, sim.tick);
      this.addVerse('creation', '*', { place: 'the valley', god: 'the god' }, { truth: ['The village was founded here; you had not acted yet.'], omenIds: [], drift: [] });
      return;
    }
    if (cur.priestId === id) return;
    const old = sim.villagers.byId(cur.priestId);
    this.addVerse('priest', old?.alive ? 'succeeded' : 'died', { old: old?.name ?? 'the old priest', new: v.name }, {
      truth: [`${v.name} became high priest (${sim.belief.personality}).`],
      omenIds: [],
      drift: [],
    });
    this.book.open(`The Book of ${v.name}`, id, sim.tick);
    this.compress();
    this.maybeRename();
  }

  /** SPEC §12 myth compression: similar legends merge, numbers inflate, side characters fade. */
  compress(): Legend[] {
    const changed: Legend[] = [];
    const families = [...new Set(this.legends.map((l) => l.family))];
    for (const fam of families) {
      const list = this.legends.filter((l) => l.family === fam);
      const inflate = this.rng.range(T.inflateMin, T.inflateMax);
      if (list.length >= 2) {
        const places = new Map<string, number>();
        for (const l of list) places.set(l.place, (places.get(l.place) ?? 0) + l.count);
        const place = [...places].sort((a, b) => b[1] - a[1])[0]![0];
        // Fresh stories inflate as they join the old one; the old one only grows a little.
        const old = list.filter((l) => l.title);
        const fresh = list.filter((l) => !l.title);
        const merged: Legend = {
          id: this.nextLegend++,
          family: fam,
          count: Math.min(T.maxCount, Math.ceil(old.reduce((n, l) => n + l.count, 0) * 1.1 + fresh.reduce((n, l) => n + l.count, 0) * inflate)),
          trueCount: list.reduce((n, l) => n + l.trueCount, 0),
          divine: list.reduce((n, l) => n + l.divine, 0),
          place,
          names: list.flatMap((l) => l.names).slice(0, 1),
          deaths: list.reduce((n, l) => n + l.deaths, 0),
          magnitude: Math.min(3, Math.max(...list.map((l) => l.magnitude)) * 1.3),
          omenIds: list.flatMap((l) => l.omenIds).slice(-12),
          title: list.find((l) => l.title)?.title ?? this.rng.pick(FAMILY_TITLE[fam] ?? ['the Wonder']),
          firstTick: Math.min(...list.map((l) => l.firstTick)),
        };
        for (const l of list) this.legends.splice(this.legends.indexOf(l), 1);
        this.legends.push(merged);
        changed.push(merged);
      } else if (list[0] && (list[0].count >= 2 || list[0].title)) {
        list[0].count = Math.min(T.maxCount, Math.ceil(list[0].count * (list[0].title ? 1.1 : inflate)));
        list[0].magnitude = Math.min(3, list[0].magnitude * 1.1);
        changed.push(list[0]);
      }
    }
    for (const l of changed.sort((a, b) => b.count * b.magnitude - a.count * a.magnitude).slice(0, 3)) {
      const facts = l.omenIds.map((id) => this.facts.get(id)).filter((f): f is OmenFact => !!f);
      const divine = l.divine;
      this.addVerse('legend', l.names.length ? 'named' : '*', {
        title: l.title ?? 'the wonder',
        count: countWord(l.count),
        place: l.place ? featureLabel(this.sim, l.place) : 'the valley',
        person: l.names[0] ?? 'the priest',
        deaths: l.deaths ? ', and many were taken' : '',
        response: this.rng.pick(RESPONSE_PAST[l.family === 'earth' ? 'shapeEarth' : l.family] ?? RESPONSE_PAST.favor!),
      }, {
        truth: [`Really ${l.trueCount} separate event${l.trueCount === 1 ? '' : 's'}${divine ? ` (${divine} of them yours)` : ', none of them yours'}; they now say ${l.count}.`, ...facts.slice(-3).map((f) => this.truthLine(f))],
        omenIds: [...l.omenIds],
        drift: ['compressed'],
      });
    }
    return changed;
  }

  // ------------------------------------------------------------------ the god's name

  private maybeRename(): void {
    const dep = this.sim.belief.beliefs.get(this.sim.belief.key('DEPICTION', 'god'));
    if (!dep?.traits) return;
    const ranked = [...this.fame].sort((a, b) => b[1].fame - a[1].fame || (a[0] < b[0] ? -1 : 1));
    const top = ranked[0];
    if (!top || top[1].fame < T.nameFame) return;
    const dominant = top[1].fame >= 2 * (ranked[1]?.[1].fame ?? 0);
    const d = depictionOf(dep.traits);
    const name = godName(d, top[0], dominant, this.sim.seed);
    if (name === this.godName) return;
    const old = this.godName;
    this.godName = name;
    this.sim.events.push(this.sim.tick, { type: 'godNamed', name, old });
    const why = dominant ? (NAME_WHY[top[0]] ?? 'its deeds') : `they picture it as ${this.sim.belief.depictionPhrase(dep)}`;
    this.addVerse('name', old ? 'changed' : 'first', { name, old, why, god: name }, {
      truth: [
        `Named for the ${top[0] === 'earth' ? 'shaping of the land' : top[0]}: seen ${top[1].count} times, ${top[1].divine} of them yours.`,
        `They picture you as ${this.sim.belief.depictionPhrase(dep)}.`,
      ],
      omenIds: [],
      drift: [],
    });
  }

  // ------------------------------------------------------------------ works & statues

  private worksBuilt(s: Structure): void {
    const b = [...this.sim.belief.beliefs.values()].find((x) => x.type === 'SACRED_PLACE' && x.workId === s.id);
    if (!b) return;
    const { truth } = this.beliefTruth(b);
    this.addVerse('works', s.kind, { place: featureLabel(this.sim, b.subject) }, { truth, omenIds: [...b.originOmenIds], drift: [], beliefId: b.id });
  }

  /** Where statues go: the main shrine (temple, shrine or cairn), else by the fire. */
  private statueSite(): { x: number; z: number } {
    const v = this.sim.village;
    for (const kind of ['temple', 'shrine', 'cairn'] as const) {
      const s = v.structures.filter((x) => x.kind === kind && !x.destroyed).at(-1);
      if (s) return { x: Math.round(s.x0 + s.w / 2), z: Math.round(s.z0 + s.d / 2) };
    }
    return { x: v.center.x, z: v.center.z };
  }

  private planStatue(d: Depiction): void {
    const v = this.sim.village;
    const site = this.statueSite();
    const def = statueBlueprint(d);
    const s = v.placeDef(this.sim, def, site.x, site.z, false, 10) ?? v.placeDef(this.sim, def, v.center.x, v.center.z, false);
    if (s) this.statues.push({ structureId: s.id, depiction: d, tick: this.sim.tick, done: false, ruined: false });
  }

  private statueBuilt(s: Structure): void {
    const rec = this.statues.find((r) => r.structureId === s.id);
    if (!rec || rec.done) return;
    rec.done = true;
    const older = this.statues.filter((r) => r !== rec && r.done && !r.ruined);
    for (const r of older) this.ruin(r);
    const dep = this.sim.belief.beliefs.get(this.sim.belief.key('DEPICTION', 'god'));
    this.maybeRename();
    const traits = dep?.traits ?? {};
    const top = Object.entries(traits).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.split(':')[1]);
    this.addVerse('statue', older.length ? 'new' : 'first', { depiction: dep ? this.sim.belief.depictionPhrase(dep) : 'a giant' }, {
      truth: [`Carved from what they have seen, strongest impressions: ${top.join(', ') || 'none'}. You never showed yourself.`],
      omenIds: [],
      drift: [],
    });
  }

  /** An old statue left to weather (SPEC §11): blocks fall and moss takes the rest. */
  private ruin(r: StatueRecord): void {
    const s = this.sim.village.byId(r.structureId);
    r.ruined = true;
    if (!s) return;
    s.ruined = true;
    const w = this.sim.world;
    for (const st of s.steps) {
      if (st.mat === M.AIR || w.get(st.x, st.y, st.z) !== st.mat) continue;
      const roll = this.rng.next();
      if (st.y > s.baseY + 2 && roll < 0.35) w.set(st.x, st.y, st.z, M.AIR);
      else if (roll < 0.65) w.set(st.x, st.y, st.z, M.RUIN_STONE);
    }
    this.sim.events.push(this.sim.tick, { type: 'ruined', structureId: s.id, kind: s.kind });
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    this.statueCheck();
    this.weather();
    if (!this.godName) this.maybeRename();
  }

  private statueCheck(): void {
    const sim = this.sim;
    const dep = sim.belief.beliefs.get(sim.belief.key('DEPICTION', 'god'));
    if (!dep?.traits) return;
    // Forget plans the builders gave up on.
    for (const r of [...this.statues]) if (!r.done && !sim.village.byId(r.structureId)) this.statues.splice(this.statues.indexOf(r), 1);
    if (this.statues.some((r) => !r.done)) return;
    const want = depictionOf(dep.traits);
    const standing = this.statues.filter((r) => r.done && !r.ruined).at(-1);
    if (!standing) {
      if (dep.strength >= T.statueAt && sim.villagers.alive.length >= T.statuePopulation) this.planStatue(want);
      return;
    }
    this.shiftDays = depictionDistance(want, standing.depiction) >= T.statueShift ? this.shiftDays + 1 : 0;
    if (this.shiftDays >= T.statueStableDays && sim.tick - standing.tick >= T.statueMinYears * TICKS_PER_YEAR) {
      this.shiftDays = 0;
      this.planStatue(want);
    }
  }

  /** Ruins keep weathering; abandoned huts on cursed ground fall apart. */
  private weather(): void {
    const sim = this.sim;
    const w = sim.world;
    for (const r of this.statues) {
      if (!r.ruined || !this.rng.chance(T.ruinDecayChance)) continue;
      const s = sim.village.byId(r.structureId);
      if (!s) continue;
      const left = s.steps.filter((st) => st.mat !== M.AIR && w.get(st.x, st.y, st.z) !== M.AIR);
      if (left.length <= s.steps.filter((st) => st.mat !== M.AIR).length * 0.3) continue;
      const top = left.reduce((a, b) => (b.y > a.y ? b : a));
      w.set(top.x, top.y, top.z, w.get(top.x, top.y, top.z) === M.RUIN_STONE || this.rng.chance(0.5) ? M.AIR : M.RUIN_STONE);
    }
    for (const h of sim.village.huts) {
      if (!sim.effects.isCursed(h.x0 + h.w / 2, h.z0 + h.d / 2) || !this.rng.chance(T.abandonedDecayChance)) continue;
      const placed = h.steps.filter((st) => st.mat !== M.AIR && w.get(st.x, st.y, st.z) === st.mat);
      if (placed.length < h.steps.filter((st) => st.mat !== M.AIR).length * 0.3) continue;
      const top = placed.reduce<typeof placed[number] | null>((a, b) => (!a || b.y > a.y ? b : a), null);
      if (top) w.set(top.x, top.y, top.z, M.AIR);
    }
  }
}
