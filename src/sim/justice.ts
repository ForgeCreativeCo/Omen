import type { Omen } from './omens/types';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { calendarAt, TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.justice;

export type Crime = 'theft' | 'assault' | 'adultery' | 'murder';
export type Sentence = 'forgiven' | 'shamed' | 'labor' | 'flogged' | 'exiled' | 'executed';
/** How a case ended: by the village's judgment, or by what they took as the god's. */
export type Judge = 'village' | 'godPunished' | 'godPardoned';

const SEVERITY: Sentence[] = ['forgiven', 'shamed', 'labor', 'flogged', 'exiled', 'executed'];
const BASE: Record<Crime, number> = { theft: 1, adultery: 1, assault: 2, murder: 4 };
const DEED: Record<Crime, string> = { theft: 'deed:theft', assault: 'deed:fight', adultery: 'deed:adultery', murder: 'deed:murder' };
/** Dream symbols that soften or harden the priest's heart. */
const SOFT = new Set(['water', 'sun', 'child', 'bird', 'moon']);
const HARD = new Set(['fire', 'snake', 'hand', 'eye']);

export interface Case {
  id: number;
  crime: Crime;
  accused: VillagerId;
  victims: VillagerId[];
  /** Who really did it (the god knows; the village may not). */
  actual: VillagerId;
  opened: number;
  judgeAt: number;
  /** Lean from the god within the window: + harsher, − softer. */
  lean: number;
}

export interface Law {
  sentence: Sentence;
  /** Times this sentence has been given for this crime in a row (more or less). */
  count: number;
  written: boolean;
}

/**
 * Village justice. When a wrong is known, the accused waits for judgment at
 * the evening fire, and the god has until then to speak: harm to the accused
 * is read as the god's punishment, a blessing on them as a pardon, a blessing
 * on the wronged or a dream to the priest as a lean one way or the other.
 *
 * If the god is silent, the village judges by its own lights: how strong the
 * taboo is, what they think the god is like, the priest's temperament, who the
 * accused is, and how angry the wronged family is. Sentences run from
 * forgiveness to shaming, labor, a flogging, exile, and (for murder, under the
 * harshest custom) death. Unseen crimes may be pinned on the wrong person.
 * Repeated sentences become custom, and custom becomes written law.
 */
export class Justice {
  readonly cases: Case[] = [];
  readonly laws: Partial<Record<Crime, Law>> = {};
  /** Times each villager has been found guilty. */
  readonly convictions = new Map<VillagerId, number>();
  private nextId = 1;
  private lastSeq = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** The calendar day of the fire where this case will be judged. */
  judgeDay(c: Pick<Case, 'judgeAt'>): number {
    const cal = calendarAt(c.judgeAt);
    return cal.dayFraction <= TUNING.villagers.gatheringEndsAt - 0.04 ? cal.day : cal.day + 1;
  }

  pending(v: Villager): Case | undefined {
    return this.cases.find((c) => c.accused === v.id);
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      switch (e.type) {
        case 'theft':
          if (e.known) this.open('theft', e.id, e.victims, e.id);
          else if (this.rng.chance(T.suspectChance)) this.suspect('theft', e.victims, e.id);
          break;
        case 'fight':
          if (e.hurt >= 0) this.open('assault', e.a, [e.b], e.a);
          break;
        case 'affairExposed':
          if (e.by >= 0) this.open('adultery', e.a, [e.by], e.a);
          break;
        case 'killing':
          if (e.seen) this.open('murder', e.killer, [e.victim], e.killer);
          else this.suspect('murder', [e.victim], e.killer);
          break;
        case 'omen': {
          const o = sim.belief.omen(e.omenId);
          if (o?.isDivine) this.onOmen(o);
          break;
        }
        case 'blessing':
          for (const c of [...this.cases]) {
            if (c.accused === e.villagerId) this.close(c, 'forgiven', 'godPardoned');
            else if (c.victims.includes(e.villagerId)) c.lean += 1;
          }
          break;
        case 'dream': {
          if (e.villagerId !== sim.belief.priestId) break;
          const soft = e.symbols.filter((s) => SOFT.has(s)).length;
          const hard = e.symbols.filter((s) => HARD.has(s)).length;
          for (const c of this.cases) c.lean += Math.sign(hard - soft);
          break;
        }
        case 'death':
          // Struck dead while awaiting judgment: the god's own verdict.
          for (const c of [...this.cases]) {
            if (c.accused !== e.id) continue;
            if (e.cause === 'lightning' || e.cause === 'meteor') this.close(c, 'forgiven', 'godPunished');
            else this.drop(c);
          }
          break;
        case 'exiled':
          for (const c of [...this.cases]) if (c.accused === e.id) this.drop(c);
          break;
        default:
          break;
      }
    }
    this.lastSeq = sim.events.lastSeq;
    // Old wrongs are forgotten: one conviction a year fades.
    if (sim.tick % TICKS_PER_YEAR === 0) for (const [id, n] of this.convictions) n > 1 ? this.convictions.set(id, n - 1) : this.convictions.delete(id);
  }

  /** Harm that lands on (or right beside) the accused looks like the god's own sentence. */
  private onOmen(o: Omen): void {
    if (o.kind !== 'lightning' && o.kind !== 'blight' && o.kind !== 'meteor') return;
    for (const c of [...this.cases]) {
      const v = this.sim.villagers.byId(c.accused);
      const hit = o.outcomes.some((x) => x.entity === `person:${c.accused}` || x.people?.includes(c.accused));
      const near = v && Math.hypot(v.x - o.position.x, v.z - o.position.z) <= T.godStrikeRadius;
      if (hit || near) this.close(c, v?.alive ? 'shamed' : 'forgiven', 'godPunished');
    }
  }

  private open(crime: Crime, accused: VillagerId, victims: VillagerId[], actual: VillagerId): void {
    const sim = this.sim;
    const v = sim.villagers.byId(accused);
    if (!v?.alive || v.lifeStage === 'child' || this.pending(v)) return;
    // Judged at the first evening fire a day from now: a day and a night for the god to speak.
    const c: Case = { id: this.nextId++, crime, accused, victims, actual, opened: sim.tick, judgeAt: sim.tick + T.windowDays * TICKS_PER_DAY, lean: 0 };
    this.cases.push(c);
    sim.events.push(sim.tick, { type: 'accused', caseId: c.id, crime, accused, victims, actual, judgeAt: c.judgeAt });
  }

  /** Nobody saw: the wronged blame whoever they already resent most. */
  private suspect(crime: Crime, victims: VillagerId[], actual: VillagerId): void {
    const sim = this.sim;
    const wronged = victims.map((id) => sim.villagers.byId(id)).filter((v): v is Villager => !!v);
    const accusers = crime === 'murder' ? wronged.flatMap((v) => [v.partnerId, ...v.childIds, ...v.parentIds].map((id) => sim.villagers.byId(id))).filter((v): v is Villager => !!v?.alive) : wronged.filter((v) => v.alive);
    if (!accusers.length) return;
    const outcast = sim.effects.outcastIds();
    let best: Villager | null = null;
    let worst = Infinity;
    for (const o of sim.villagers.alive) {
      if (o.lifeStage === 'child' || victims.includes(o.id) || accusers.some((a) => a.id === o.id)) continue;
      let score = Math.min(...accusers.map((a) => sim.society.bond(a, o)));
      if (outcast.has(o.id) || sim.dissent.follows(o)) score -= 0.3;
      if (score < worst) (worst = score), (best = o);
    }
    if (best && worst < T.suspicionBelow) this.open(crime, best.id, victims, actual);
  }

  // ------------------------------------------------------------------ judgment

  /** At the fire: cases whose time has come are judged. */
  dusk(): void {
    const sim = this.sim;
    for (const c of [...this.cases]) if (sim.tick >= c.judgeAt) this.judge(c);
  }

  private judge(c: Case): void {
    const sim = this.sim;
    const v = sim.villagers.byId(c.accused);
    if (!v?.alive) return this.drop(c);
    let score = BASE[c.crime] + c.lean;
    score += sim.effects.taboo(DEED[c.crime]) * 1.5;
    // What they think the god is like.
    const temper = sim.belief.beliefs.get(sim.belief.key('TEMPERAMENT', 'god'));
    if (temper && temper.valence < -0.2) score += 1;
    else if (temper && temper.valence > 0.2) score -= 1;
    // The priest's temperament.
    const p = sim.belief.personality;
    if (p === 'fearful') score += 1;
    else if (p === 'mystic') score -= 1;
    else if (p === 'ambitious' && v.standing > 0.6) score += 1;
    // Who the accused is.
    const priest = sim.villagers.byId(sim.belief.priestId);
    if (sim.belief.chosenIds().has(v.id)) score -= 2;
    if (priest && (v.id === priest.id || v.id === priest.partnerId || priest.childIds.includes(v.id))) score -= 1;
    if (sim.effects.outcastIds().has(v.id) || sim.dissent.follows(v)) score += 1;
    const priors = this.convictions.get(v.id) ?? 0;
    score += Math.min(1, priors);
    // How angry the wronged family is.
    const wronged = c.victims.map((id) => sim.villagers.byId(id)).filter((x): x is Villager => !!x);
    const kin = wronged.flatMap((w) => [w, ...[w.partnerId, ...w.childIds, ...w.parentIds].map((id) => sim.villagers.byId(id))]).filter((x): x is Villager => !!x?.alive);
    if (kin.some((k) => sim.society.bond(k, v) <= -0.6)) score += 1;

    let sentence = SEVERITY[Math.max(0, Math.min(SEVERITY.length - 1, Math.round(score)))]!;
    // Custom: once a law is written, the village follows it.
    const law = this.laws[c.crime];
    if (law?.written && Math.abs(SEVERITY.indexOf(law.sentence) - SEVERITY.indexOf(sentence)) <= 2) sentence = law.sentence;
    // Exile is for killers and those who keep doing wrong; death only for a life taken.
    if (c.crime !== 'murder' && priors < T.habitualAfter && SEVERITY.indexOf(sentence) > SEVERITY.indexOf('flogged')) sentence = 'flogged';
    if (sentence === 'executed' && c.crime !== 'murder') sentence = 'exiled';
    if (c.crime === 'murder' && SEVERITY.indexOf(sentence) < SEVERITY.indexOf('exiled') && !sim.belief.chosenIds().has(v.id)) sentence = 'exiled';
    // Labor repays a theft; for other wrongs it's shame.
    if (sentence === 'labor' && c.crime !== 'theft') sentence = 'shamed';
    this.close(c, sentence, 'village');
  }

  private drop(c: Case): void {
    const i = this.cases.indexOf(c);
    if (i >= 0) this.cases.splice(i, 1);
  }

  private close(c: Case, sentence: Sentence, by: Judge): void {
    const sim = this.sim;
    this.drop(c);
    const v = sim.villagers.byId(c.accused);
    const wronged = c.victims.map((id) => sim.villagers.byId(id)).filter((x): x is Villager => !!x?.alive);
    const family = v ? [v.partnerId, ...v.childIds, ...v.parentIds].map((id) => sim.villagers.byId(id)).filter((x): x is Villager => !!x?.alive) : [];
    const wrongful = c.accused !== c.actual;
    sim.events.push(sim.tick, { type: 'verdict', caseId: c.id, crime: c.crime, accused: c.accused, victims: c.victims, actual: c.actual, sentence, by });
    if (!v?.alive) return;
    if (sentence !== 'forgiven') this.convictions.set(v.id, (this.convictions.get(v.id) ?? 0) + 1);
    switch (sentence) {
      case 'forgiven':
        // Mercy the wronged didn't want.
        for (const w of wronged) sim.society.shift(w, v, -0.1);
        break;
      case 'shamed':
        v.standing = Math.max(0, v.standing - T.shameStanding);
        break;
      case 'labor':
        v.standing = Math.max(0, v.standing - T.shameStanding * 0.5);
        for (const w of wronged) sim.society.shift(w, v, 0.2);
        break;
      case 'flogged':
        v.standing = Math.max(0, v.standing - T.shameStanding);
        sim.society.hurt.set(v.id, sim.tick + T.flogDays * TICKS_PER_DAY);
        v.faith.fear = Math.min(1 - v.faith.love, v.faith.fear + 0.1);
        // The beaten one's family resents those who called for it.
        for (const f of family) for (const w of wronged) sim.society.shift(f, w, -T.familyResentment);
        break;
      case 'exiled':
        sim.villagers.exile(v);
        for (const f of family) for (const w of wronged) sim.society.shift(f, w, -T.familyResentment * 1.5);
        break;
      case 'executed':
        for (const f of family) for (const w of wronged) sim.society.shift(f, w, -T.familyResentment * 3);
        sim.villagers.kill(v, 'executed');
        break;
    }
    // Justice done settles the wronged side's grievance.
    if (sentence !== 'forgiven') for (const w of wronged) sim.society.shift(w, v, T.settled);
    // Punishing the wrong person is an injustice their family won't forget.
    if (wrongful && sentence !== 'forgiven') for (const f of [v, ...family]) for (const w of wronged) if (f.alive) sim.society.shift(f, w, -0.3);
    if (by === 'village') this.precedent(c.crime, sentence);
  }

  /** The same sentence, again and again, becomes the custom; then it's written down. */
  private precedent(crime: Crime, sentence: Sentence): void {
    const law = this.laws[crime];
    if (!law) {
      this.laws[crime] = { sentence, count: 1, written: false };
      return;
    }
    if (law.sentence === sentence) law.count++;
    else if (!law.written && --law.count <= 0) {
      law.sentence = sentence;
      law.count = 1;
    }
    if (!law.written && law.count >= T.lawAfter) {
      law.written = true;
      this.sim.events.push(this.sim.tick, { type: 'law', crime, sentence });
    }
  }
}
