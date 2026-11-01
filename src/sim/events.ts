/**
 * Notable things that happened, in order. The renderer reads these for effects
 * and toasts; M4's omen recorder will turn many of them into omens.
 */

export type DeathCause = 'oldAge' | 'starvation' | 'fire' | 'lightning' | 'flood' | 'exiled' | 'meteor' | 'killed' | 'executed' | 'thrown' | 'crushed' | 'battle' | 'quake' | 'firestorm' | 'plague' | 'sacrificed';

/** Who speaks in the god's place when it falls silent: one who denies it, or one who claims its voice. */
export type DissentKind = 'doubter' | 'prophet';
export type { Crime, Judge, Sentence } from './justice';
import type { HandWhat } from './miracles/hand';
import type { ExodusReason } from './exodus';
import type { PrayerEnd, PrayerKind } from './prayers';
import type { Crime, Judge, Sentence } from './justice';
export type DissentEndReason = 'converted' | 'recanted' | 'discredited' | 'died' | 'gone';

export type SimEventBody =
  | { type: 'rainStart'; storm: boolean; divine: boolean }
  | { type: 'rainEnd' }
  | { type: 'droughtStart' }
  | { type: 'droughtEnd' }
  | {
      type: 'lightning';
      x: number;
      y: number;
      z: number;
      divine: boolean;
      killed: number[];
      fire: boolean;
      /** Where the god actually aimed (divine strikes only). */
      aimX?: number;
      aimZ?: number;
    }
  | { type: 'miracleRain'; cloudId: number; x: number; z: number; radius: number }
  | { type: 'earthShaped'; x: number; z: number; radius: number; raise: boolean; columns: number; shaken: number }
  | { type: 'bloom'; x: number; z: number; radius: number; crops: number; flowers: number }
  | { type: 'dream'; villagerId: number; symbols: string[] }
  | { type: 'holyLight'; beamId: number; x: number; z: number; radius: number }
  | { type: 'hallow'; id: number; x: number; z: number; radius: number }
  | { type: 'blessing'; villagerId: number; x: number; z: number }
  | { type: 'blessPlace'; structureId: number; kind: 'field' | 'hut'; x: number; z: number; w: number; d: number; residents: number[]; tribe: number }
  | { type: 'blight'; x: number; z: number; radius: number; crops: number }
  | { type: 'meteorFall'; x: number; z: number; impactTick: number; big?: boolean }
  | { type: 'meteor'; x: number; y: number; z: number; killed: number[]; wrecked: number[]; fire: boolean }
  /** The extinction asteroid landed; `villages` are the peoples whose fire was within its blast. */
  | { type: 'cataclysm'; x: number; y: number; z: number; killed: number[]; wrecked: number[]; fire: boolean; villages: number[] }
  /** The ground shakes (start, for effects) and stops (with what it did). */
  | { type: 'quake'; id: number; x: number; z: number; radius: number; durationTicks: number; cracks: number }
  | { type: 'quakeEnd'; id: number; x: number; z: number; radius: number; wrecked: number[]; killed: number[]; trees: number }
  | { type: 'firestorm'; id: number; x: number; z: number; radius: number; durationTicks: number }
  | { type: 'firestormEnd'; id: number; x: number; z: number; radius: number; killed: number[]; wrecked: number[]; fires: number }
  /** A locust swarm sets on a people's fields (`tribe`), and leaves. */
  | { type: 'swarm'; id: number; x: number; z: number; tribe: number }
  | { type: 'swarmEnd'; id: number; x: number; z: number; tribe: number; eaten: number; food: number }
  /** The sea surges from (x, z) toward (tx, tz); `waveEnd` at its furthest reach. */
  | { type: 'wave'; id: number; x: number; z: number; tx: number; tz: number; dx: number; dz: number; length: number; width: number }
  | { type: 'waveEnd'; id: number; x: number; z: number; wrecked: number[]; crops: number; carried: number[] }
  /** The god's sickness: the first to fall ill. */
  | { type: 'plague'; x: number; z: number; ids: number[] }
  /** `by`: who passed it on, or -1 for the god. */
  | { type: 'sickened'; id: number; by: number }
  | { type: 'recovered'; id: number }
  /** A people counts what the god did to it as a disaster (the other peoples take note). */
  | { type: 'disaster'; kind: string; harm: number; deaths: number }
  /** The god did something wonderful for a people (the others envy it). */
  | { type: 'favored'; kind: string }
  /** A people reacts to another's disaster (scorn) or blessing (envy). */
  | { type: 'rivalry'; other: number; kind: 'scorn' | 'envy' }
  | { type: 'greatOffering'; amount: number; why: 'disaster' | 'rivalry'; x: number; z: number }
  /** `ritual`: given as a rite, not out of dread. */
  | { type: 'sacrifice'; id: number; priest: number; x: number; z: number; ritual: boolean }
  /** Someone stands against the god (`griefFor`: whose death set them off, or -1). */
  | { type: 'defiance'; id: number; griefFor: number }
  | { type: 'defies'; id: number; x: number; z: number }
  | { type: 'vindicated'; id: number }
  | { type: 'defianceEnd'; id: number; reason: 'struck' | 'humbled' | 'died' | 'gone' }
  | { type: 'milestone'; id: string }
  /** `ally`: joined to stand with an ally already at war. */
  | { type: 'war'; a: number; b: number; ally?: number }
  | { type: 'alliance'; a: number; b: number; against: number }
  | { type: 'allianceEnd'; a: number; b: number }
  /** People of `from` carried off by `by`. */
  | { type: 'captured'; ids: number[]; from: number; by: number }
  | { type: 'captiveJoined'; id: number; by: number; from: number }
  /** A beaten people taken in by its conqueror, or driven from its land. */
  | { type: 'conquest'; winner: number; loser: number; outcome: 'absorbed' | 'driven'; ids: number[] }
  | { type: 'prayForVictory'; tribe: number; against: number; priest: number }
  /** The god struck the enemy (`answered`), or the ones who prayed. */
  | { type: 'prayerAnswered'; tribe: number; against: number; answered: boolean }
  /** The last of a people were taken in by another. */
  | { type: 'absorbed'; from: number; into: number; ids: number[] }
  /** `freed`: captives sent home under the peace. */
  | { type: 'peace'; a: number; b: number; freed?: number[] }
  /** A war party sets out. */
  | { type: 'raid'; raid: number; from: number; to: number; ids: number[] }
  /** It reaches the enemy fire. */
  | { type: 'battle'; raid: number; from: number; to: number; x: number; z: number }
  | { type: 'slain'; killer: number; victim: number; raid: number; x: number; z: number }
  | { type: 'raidEnd'; raid: number; from: number; to: number; loot: number; burned: boolean; raidersLost: number; defendersLost: number; captives?: number }
  /** A new people: `from` is the tribe they broke away from. */
  | { type: 'tribeFounded'; id: number; name: string; from: number; reason: 'schism' | 'exiles' | 'settlers' | 'hallowed'; leaderId: number; x: number; z: number }
  /** Believers set out from their people for hallowed ground, to found a people there. */
  | { type: 'prayer'; id: number; kind: PrayerKind; asker: number; for: number; against: number; until: number }
  | { type: 'prayerEnd'; id: number; kind: PrayerKind; asker: number; for: number; against: number; end: PrayerEnd }
  | { type: 'calling'; tribe: number; ids: number[]; x: number; z: number; place: string }
  /** The party came to nothing (too few left, or the ground was lost). */
  | { type: 'callingEnd'; tribe: number; ids: number[] }
  /** Settlers set out for an islet (gathering on the shore at x, z), put to sea, come ashore, or give up. */
  | { type: 'voyage'; tribe: number; ids: number[]; islet: number; x: number; z: number }
  | { type: 'setSail'; tribe: number; ids: number[]; x: number; z: number }
  | { type: 'landfall'; tribe: number; from: number; ids: number[]; x: number; z: number }
  | { type: 'voyageEnd'; tribe: number; ids: number[] }
  /** The village gave up its site and moved (`region`: REGION of the new home). */
  | { type: 'exodus'; fromX: number; fromZ: number; toX: number; toZ: number; reason: ExodusReason; region: number }
  /** The god's hand took hold of something (`id`: the villager, else -1). */
  | { type: 'handGrab'; what: HandWhat; id: number; x: number; z: number }
  /** A villager set down gently. */
  | { type: 'handPlace'; id: number; x: number; z: number }
  /** Something thrown came down. `survived`: a thrown villager lived. */
  | { type: 'handImpact'; what: HandWhat; id: number; x: number; y: number; z: number; speed: number; killed: number[]; wrecked: number[]; survived: boolean; water: boolean }
  | { type: 'silence'; days: number }
  | { type: 'dissent'; id: number; kind: DissentKind; rule?: string }
  | { type: 'dissentEnd'; id: number; kind: DissentKind; reason: DissentEndReason }
  | { type: 'prophetClaims'; id: number }
  | { type: 'prophesied'; id: number; what: string }
  | { type: 'prophecyResult'; id: number; fulfilled: boolean }
  | { type: 'schism'; leaderId: number; outcome: 'drivenOut' | 'split'; ids: number[] }
  | { type: 'omen'; omenId: string }
  | { type: 'beliefLevel'; beliefId: string; level: 'behavior' | 'doctrine' | 'died' }
  | { type: 'priest'; id: number; personality: string }
  | { type: 'tradition'; beliefId: string }
  | { type: 'flood'; phase: 'strike' | 'rise' | 'peak'; level: number }
  | { type: 'outcome'; won: boolean; reason: string }
  | { type: 'placeNamed'; key: string; name: string }
  | { type: 'godNamed'; name: string; old: string }
  | { type: 'verse'; verseId: number }
  | { type: 'ruined'; structureId: number; kind: string }
  /** `left`: walked away in a schism rather than being sent. */
  | { type: 'exiled'; id: number; left?: boolean }
  | { type: 'prophecy'; beliefId: string; good: boolean }
  | { type: 'ritual'; beliefId: string; activity: string; x: number; z: number; villagerId?: number }
  | { type: 'fireStarted'; x: number; y: number; z: number }
  | { type: 'birth'; id: number; parents: number[] }
  | { type: 'death'; id: number; cause: DeathCause; x: number; z: number }
  | { type: 'couple'; a: number; b: number }
  /** `known`: the victims learned who did it. */
  | { type: 'theft'; id: number; hutId: number; victims: number[]; x: number; z: number; known: boolean }
  | { type: 'affair'; a: number; b: number }
  | { type: 'affairExposed'; a: number; b: number; by: number; breakup: boolean }
  | { type: 'feud'; a: number; b: number }
  /** `hurt`: who was injured, or -1. */
  | { type: 'fight'; a: number; b: number; hurt: number; x: number; z: number }
  | { type: 'killing'; killer: number; victim: number; seen: boolean; x: number; z: number }
  /** A wrong came to light: `accused` waits for judgment at the fire (`actual` is who really did it). */
  | { type: 'accused'; caseId: number; crime: Crime; accused: number; victims: number[]; actual: number; judgeAt: number }
  | { type: 'verdict'; caseId: number; crime: Crime; accused: number; victims: number[]; actual: number; sentence: Sentence; by: Judge }
  | { type: 'law'; crime: Crime; sentence: Sentence }
  | { type: 'quarrel'; a: number; b: number; x: number; z: number }
  | { type: 'built'; structureId: number; kind: string; variant?: string }
  | { type: 'destroyed'; structureId: number; kind: string };

/** `tribe`: the people whose systems raised it (absent for the shared world: weather, miracles). */
export type SimEvent = SimEventBody & { seq: number; tick: number; tribe?: number };

const KEEP = 1000;

export class EventLog {
  private readonly list: SimEvent[] = [];
  private seq = 0;

  push(tick: number, body: SimEventBody, tribe?: number): SimEvent {
    const e = (tribe === undefined ? { ...body, seq: ++this.seq, tick } : { ...body, seq: ++this.seq, tick, tribe }) as SimEvent;
    this.list.push(e);
    if (this.list.length > KEEP * 1.5) this.list.splice(0, this.list.length - KEEP);
    return e;
  }

  /** Events with seq greater than `afterSeq`, oldest first. */
  since(afterSeq: number): SimEvent[] {
    let i = this.list.length;
    while (i > 0 && (this.list[i - 1] as SimEvent).seq > afterSeq) i--;
    return this.list.slice(i);
  }

  get lastSeq(): number {
    return this.seq;
  }

  all(): readonly SimEvent[] {
    return this.list;
  }
}
