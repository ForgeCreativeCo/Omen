import type { FixedLoop } from '../loop';
import type { GameRenderer } from '../render/GameRenderer';
import type { OmenKind } from '../sim/omens/types';
import type { Sim } from '../sim/Sim';
import type { HolyBookPanel } from './HolyBookPanel';

export interface TutorialHost {
  sim: Sim;
  renderer: GameRenderer;
  loop: FixedLoop;
  inspectorOpen: () => boolean;
  beliefsOpen: () => boolean;
  book: HolyBookPanel;
  /** The Village life log is open. */
  lifeOpen: () => boolean;
  /** Which people the faith panels show. */
  focusId: () => number;
}

/** What a step remembers about the moment it began. */
interface Since {
  tick: number;
  day: number;
  /** Which people the panels showed. */
  focus: number;
  cam: { x: number; y: number; z: number };
}

interface Step {
  title: string;
  body: string;
  /** CSS selector of the HUD element to point at. */
  target?: string;
  /** Voxel column to mark in the world. */
  guide?: (h: TutorialHost) => { x: number; z: number } | null;
  /** Grace the step needs; topped up so the lesson isn't blocked. */
  grace?: number;
  /** Advances on its own when this is true; otherwise a Next button. */
  done?: (h: TutorialHost, s: Since) => boolean;
  /** Extra advice while waiting (e.g. "nobody saw that"). */
  note?: (h: TutorialHost, s: Since) => string | null;
  /** Only in some games (several peoples, the sandbox). */
  when?: (h: TutorialHost) => boolean;
}

function eventsSince(h: TutorialHost, s: Since, types: string[]) {
  return h.sim.events.all().filter((e) => e.tick > s.tick && types.includes(e.type));
}

const DONE_KEY = 'omen.tutorial.done';

function omensSince(h: TutorialHost, s: Since, kinds: OmenKind[]) {
  return h.sim.belief.omens.filter((o) => o.tick > s.tick && kinds.includes(o.kind));
}

/** A spot next to the fire, where people will see a wonder. */
function nearFire(h: TutorialHost): { x: number; z: number } | null {
  const c = h.sim.village.center;
  return h.sim.village.nearestWalkable(c.x + 5, c.z + 3);
}

function night(h: TutorialHost): boolean {
  const t = h.sim.calendar.timeOfDay;
  return t === 'night';
}

const STEPS: Step[] = [
  {
    title: 'You are their god',
    body: 'You can’t speak to these people. All you can do is <b>act</b>: rain, fire from the sky, a blooming field, a dream. They watch what happens and decide for themselves what it meant, and they are often wrong. That gap is the game.',
  },
  {
    title: 'Look around',
    body: '<b>Drag</b> to pan, <b>right-drag</b> to turn, <b>scroll</b> to zoom. On touch: drag, twist, pinch. Find the village: a fire, a few huts, fields by the river.',
    done: (h, s) => {
      const p = h.renderer.camera.position;
      return Math.hypot(p.x - s.cam.x, p.y - s.cam.y, p.z - s.cam.z) > 6;
    },
  },
  {
    title: 'Meet someone',
    body: '<b>Click a villager.</b> The panel shows who they are, what they remember seeing, and what they believe. Right now: not much.',
    done: (h) => h.inspectorOpen(),
  },
  {
    title: 'Work a wonder where they can see',
    body: 'Pick <b>Bloom</b> below (or press <b>B</b>), then click the ground at the glowing marker, by the fire where people are. Miracles nobody sees build nothing.',
    target: '.miracle[data-id="bloom"]',
    guide: nearFire,
    grace: 20,
    done: (h, s) => omensSince(h, s, ['bloom']).some((o) => o.witnesses.length > 0),
    note: (h, s) => {
      if (omensSince(h, s, ['bloom']).length) return 'Nobody saw that one. Try closer to people, in daylight.';
      if (night(h)) return 'It’s night and everyone is asleep. Speed up time (press 4) until morning.';
      return null;
    },
  },
  {
    title: 'They decided what it meant',
    body: 'Every witness looked at what was going on: who was there, what they were doing, where it happened. Each one credited whatever stood out. Open <b>Village Beliefs</b> (<b>V</b>) to see what they concluded.',
    target: '.hud-beliefs',
    done: (h) => h.beliefsOpen(),
  },
  {
    title: 'Let them talk',
    body: 'In the evening they gather at the fire and tell each other what they saw. Stories grow in the retelling, and beliefs spread. Speed up time (<b>4×</b>, or press <b>3</b>) and let a night pass.',
    target: '.hud-speeds',
    done: (h, s) => h.sim.calendar.day > s.day,
  },
  {
    title: 'Fear teaches too',
    body: 'Pick <b>Lightning</b> (<b>L</b>) and strike the bare <b>east hill</b> at the marker, away from the huts. Your aim isn’t perfect. Hit the same place twice and they may decide you hate it.',
    target: '.miracle[data-id="lightning"]',
    guide: (h) => h.sim.island.landmarks.eastHill,
    grace: 30,
    done: (h, s) => omensSince(h, s, ['lightning']).length > 0,
    note: (h) => (night(h) ? 'Lightning lands in the dark too, but nobody will see it. Wait for morning.' : null),
  },
  {
    title: 'It is written',
    body: 'What matters to them goes in the <b>Holy Book</b>: what they believe happened, not what did. Open it (<b>H</b>) and flip <b>Show the Truth</b> to see both side by side.',
    target: '.hud-book',
    done: (h) => h.book.open && h.book.showingTruth,
  },
  {
    title: 'The Hand',
    body: 'Pick <b>The Hand</b> (<b>F</b>) and <b>press on a villager</b> to take hold. Drag to carry them through the sky, and let go <b>gently</b> to set them down. Those who see it will say they were chosen. (Flick as you let go and you throw them. Few survive that.)',
    target: '.miracle[data-id="hand"]',
    done: (h, s) => eventsSince(h, s, ['handPlace', 'handImpact']).length > 0,
  },
  {
    title: 'Who did what',
    body: 'Open <b>Life</b> (<b>J</b>): every birth, death, love, theft and quarrel, by day. When someone is <b>accused</b> of a wrong, they wait a day for you to speak: strike near them to punish, <b>Bless</b> them to pardon, or stay silent and let the village judge by its own lights. Click a name to go to them.',
    target: '.hud-life',
    done: (h) => h.lifeOpen(),
  },
  {
    title: 'Other peoples',
    body: 'Yours aren’t the only people on the island. Each has its own village, priest, beliefs and name for you, and they <b>feud, ally and go to war</b>. The switcher at the top of <b>Beliefs</b>, the <b>Holy Book</b> and <b>Purposes</b> chooses whose you see; clicking a villager follows their people. <b>Switch to another people now.</b>',
    target: '.hud-beliefs',
    when: (h) => h.sim.tribes.length > 1,
    done: (h, s) => h.focusId() !== s.focus,
  },
];

const LAST_SANDBOX: Step = {
  title: 'Now it’s yours',
  body: 'That’s the loop: act, watch them read it, see what grows. <b>Purposes</b> (bottom left) shows what to aim for next, with a tip for the moment. <b>Holy Light</b> (I) makes a place holy, <b>Bless</b> (K) picks a favorite, <b>Blight</b> (X) curses ground, a <b>Falling Star</b> (O) leaves a crater they’ll name, <b>Dream</b> (N) plants symbols at night. The red powers are your wrath: <b>Earthquake</b> (Y), <b>Firestorm</b> (C), <b>Tidal Wave</b> (Z), <b>Plague</b> (P) and <b>Swarm</b> (5). A people you are cruel to will burn offerings, give one of their own to you, or <b>defy you</b> openly; their neighbors will say they had it coming. At war, a priest prays to you for victory: harm the enemy and they’ll say you answered. Stay silent too long and someone will speak in your place. Press <b>F3</b> for God’s Eye: the real reasoning behind every belief.',
};

const LAST_WARNING: Step = {
  title: 'The sea is coming',
  body: 'When the countdown under the calendar runs out, the sea drowns the valley. People run only to <b>holy places they trust</b>, so teach them the <b>high ridge</b> is holy. Shine <b>Holy Light</b> (I) on it while people watch, again and again; send <b>dreams of the mountain</b>; <b>Blight</b> (X) the low ground. <b>Purposes</b> (bottom left) shows how many would climb to safety if the sea came today. Go quiet for too long and a Doubter or a False Prophet will rise. You have generations. Use them.',
};

/**
 * First-session guide (SPEC M7, pulled forward): a coach card that teaches the core
 * loop by doing it, pointing at the button to press and marking where to aim.
 */
export class Tutorial {
  private readonly el: HTMLElement;
  private readonly steps: Step[];
  private i = -1;
  private since: Since = { tick: 0, day: 0, focus: 0, cam: { x: 0, y: 0, z: 0 } };
  private glowing: Element | null = null;

  constructor(
    root: HTMLElement,
    private readonly h: TutorialHost,
  ) {
    this.steps = [...STEPS.filter((s) => !s.when || s.when(h)), h.sim.warning ? LAST_WARNING : LAST_SANDBOX];
    this.el = document.createElement('div');
    this.el.className = 'hud-panel tutorial';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
      if (a === 'next') this.go(this.i + 1);
      else if (a === 'skip') this.finish();
    });
  }

  static seen(): boolean {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  get running(): boolean {
    return this.i >= 0;
  }

  start(): void {
    this.go(0);
  }

  private go(i: number): void {
    if (i >= this.steps.length) return this.finish();
    this.i = i;
    const h = this.h;
    const p = h.renderer.camera.position;
    this.since = { tick: h.sim.tick, day: h.sim.calendar.day, focus: h.focusId(), cam: { x: p.x, y: p.y, z: p.z } };
    const step = this.steps[i]!;
    if (step.grace && h.sim.miracles.grace < step.grace) h.sim.miracles.grace = step.grace;
    const spot = step.guide?.(h) ?? null;
    h.renderer.setGuide(spot ? spot.x : null, spot?.z);
    this.glow(step.target);
    this.render(null);
    this.el.hidden = false;
  }

  private glow(selector?: string): void {
    this.glowing?.classList.remove('tut-glow');
    this.glowing = selector ? document.querySelector(selector) : null;
    this.glowing?.classList.add('tut-glow');
  }

  private render(note: string | null): void {
    const step = this.steps[this.i]!;
    const last = this.i === this.steps.length - 1;
    this.el.innerHTML = `
      <div class="tut-count">${this.i + 1} / ${this.steps.length}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      ${note ? `<p class="tut-note">${note}</p>` : ''}
      <div class="tut-actions">
        ${last ? '' : '<button data-t="skip" class="tut-skip">Skip tutorial</button>'}
        ${step.done ? '<span class="tut-wait">Waiting for you…</span>' : `<button data-t="next" class="tut-next">${last ? 'Play' : 'Next'}</button>`}
      </div>`;
    this.lastNote = note;
  }

  private lastNote: string | null = null;

  /** Per frame: advance when the step's goal is met; keep notes current. */
  update(): void {
    if (this.i < 0) return;
    const step = this.steps[this.i]!;
    // The miracle bar re-renders; keep the highlight on the live element.
    if (step.target && !this.glowing?.isConnected) this.glow(step.target);
    if (step.done?.(this.h, this.since)) {
      this.go(this.i + 1);
      return;
    }
    const note = step.note?.(this.h, this.since) ?? null;
    if (note !== this.lastNote) this.render(note);
  }

  finish(): void {
    this.i = -1;
    this.el.hidden = true;
    this.glow();
    this.h.renderer.setGuide(null);
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // Private mode: it just shows again next time.
    }
  }
}
