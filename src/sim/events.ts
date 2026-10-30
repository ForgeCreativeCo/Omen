/**
 * Notable things that happened, in order. The renderer reads these for effects
 * and toasts; M4's omen recorder will turn many of them into omens.
 */

export type DeathCause = 'oldAge' | 'starvation' | 'fire' | 'lightning' | 'flood' | 'exiled' | 'meteor';

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
  | { type: 'blessing'; villagerId: number; x: number; z: number }
  | { type: 'blight'; x: number; z: number; radius: number; crops: number }
  | { type: 'meteorFall'; x: number; z: number; impactTick: number }
  | { type: 'meteor'; x: number; y: number; z: number; killed: number[]; wrecked: number[]; fire: boolean }
  | { type: 'milestone'; id: string }
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
  | { type: 'exiled'; id: number }
  | { type: 'prophecy'; beliefId: string; good: boolean }
  | { type: 'ritual'; beliefId: string; activity: string; x: number; z: number; villagerId?: number }
  | { type: 'fireStarted'; x: number; y: number; z: number }
  | { type: 'birth'; id: number; parents: number[] }
  | { type: 'death'; id: number; cause: DeathCause; x: number; z: number }
  | { type: 'couple'; a: number; b: number }
  | { type: 'built'; structureId: number; kind: string }
  | { type: 'destroyed'; structureId: number; kind: string };

export type SimEvent = SimEventBody & { seq: number; tick: number };

const KEEP = 1000;

export class EventLog {
  private readonly list: SimEvent[] = [];
  private seq = 0;

  push(tick: number, body: SimEventBody): SimEvent {
    const e = { ...body, seq: ++this.seq, tick } as SimEvent;
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
