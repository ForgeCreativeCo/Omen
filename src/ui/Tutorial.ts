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
}

/** What a step remembers about the moment it began. */
interface Since {
  tick: number;
  day: number;
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
];

const LAST_SANDBOX: Step = {
  title: 'Now it’s yours',
  body: 'That’s the loop: act, watch them read it, see what grows. <b>Purposes</b> (bottom left) shows what to aim for next and how, with a tip for the moment. Your other powers: <b>Holy Light</b> (I) makes a place holy, <b>Bless</b> (K) picks a favorite, <b>Blight</b> (X) curses ground, a <b>Falling Star</b> (O) leaves a crater they’ll name, and <b>Dream</b> (N) plants symbols at night. Press <b>F3</b> for God’s Eye: the real reasoning behind every belief.',
};

const LAST_WARNING: Step = {
  title: 'The sea is coming',
  body: 'When the countdown under the calendar runs out, the sea drowns the valley. People run only to <b>holy places they trust</b>, so teach them the <b>high ridge</b> is holy. Shine <b>Holy Light</b> (I) on it while people watch, again and again; send <b>dreams of the mountain</b>; <b>Blight</b> (X) the low ground. <b>Purposes</b> (bottom left) shows how many would climb to safety if the sea came today. You have generations. Use them.',
};

/**
 * First-session guide (SPEC M7, pulled forward): a coach card that teaches the core
 * loop by doing it, pointing at the button to press and marking where to aim.
 */
export class Tutorial {
  private readonly el: HTMLElement;
  private readonly steps: Step[];
  private i = -1;
  private since: Since = { tick: 0, day: 0, cam: { x: 0, y: 0, z: 0 } };
  private glowing: Element | null = null;

  constructor(
    root: HTMLElement,
    private readonly h: TutorialHost,
  ) {
    this.steps = [...STEPS, h.sim.warning ? LAST_WARNING : LAST_SANDBOX];
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
    this.since = { tick: h.sim.tick, day: h.sim.calendar.day, cam: { x: p.x, y: p.y, z: p.z } };
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
