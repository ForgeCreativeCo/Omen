import type { VillagerId } from '../villagers/types';
import type { VerseKind } from './scripture';

/** Ways a verse has come loose from what happened (for "Show the Truth" and tests). */
export type DriftKind =
  /** Nobody alive saw it begin; the reason has gone vague. */
  | 'tradition'
  /** Merged with other events and the numbers inflated at a priest's succession. */
  | 'compressed'
  /** Most believers only heard it, retold and grown at the fire. */
  | 'rumor'
  /** Natural events credited to the god's will, or the god's aim misread. */
  | 'misread';

export interface Verse {
  id: number;
  tick: number;
  kind: VerseKind;
  text: string;
  /** What actually happened, one line each (player-only). */
  truth: string[];
  beliefId?: string;
  omenIds: string[];
  drift: DriftKind[];
  /** The text before it was rewritten as tradition. */
  original?: string;
}

export interface Chapter {
  title: string;
  priestId: VillagerId;
  startTick: number;
  verses: Verse[];
}

/** The Holy Book (SPEC §13): chapters by era, named for the high priest. */
export class HolyBook {
  readonly chapters: Chapter[] = [];
  private nextId = 1;

  get current(): Chapter | undefined {
    return this.chapters.at(-1);
  }

  open(title: string, priestId: VillagerId, tick: number): Chapter {
    const c = { title, priestId, startTick: tick, verses: [] };
    this.chapters.push(c);
    return c;
  }

  add(v: Omit<Verse, 'id'>): Verse {
    if (!this.current) this.open('The Book of Beginnings', -1, v.tick);
    const verse = { ...v, id: this.nextId++ };
    this.current!.verses.push(verse);
    return verse;
  }

  verses(): Verse[] {
    return this.chapters.flatMap((c) => c.verses);
  }

  byId(id: number): Verse | undefined {
    for (const c of this.chapters) for (const v of c.verses) if (v.id === id) return v;
    return undefined;
  }

  forBelief(beliefId: string): Verse[] {
    return this.verses().filter((v) => v.beliefId === beliefId);
  }
}
