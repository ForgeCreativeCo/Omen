import { Sim, type GameMode } from './sim/Sim';
import { FixedLoop } from './loop';
import { GameRenderer } from './render/GameRenderer';
import { Hud } from './ui/Hud';
import { BeliefsPanel } from './ui/BeliefsPanel';
import { HolyBookPanel } from './ui/HolyBookPanel';
import { EndScreen, randomSeed, startGame, TitleScreen, Vision } from './ui/Screens';
import { Tutorial } from './ui/Tutorial';
import { loadSettings, readSave, savedHeader, SettingsPanel, writeSave } from './ui/Settings';
import { readHeader, restoreGame, saveGame } from './sim/save';
import { formatCalendar } from './sim/time';
import { Soundscape } from './audio/Soundscape';
import { Inspector } from './ui/Inspector';
import { MiracleController } from './ui/MiracleController';
import { Toasts } from './ui/Toasts';
import { GoalsPanel } from './ui/GoalsPanel';
import { Reactions } from './ui/Reactions';
import { SeasonReport } from './ui/SeasonReport';
import { Overhead } from './ui/Overhead';
import { VillageLog } from './ui/VillageLog';
import { PeopleFocus } from './ui/PeopleFocus';
import { TUNING } from './sim/tuning';
import { DebugPanel } from './debug/DebugPanel';

const params = new URLSearchParams(location.search);
// ?load=1 continues the saved game: its header says which island and mode to rebuild.
const saved = params.has('load') ? readSave() : null;
const header = saved ? readHeader(saved) : null;
if (params.has('load') && !header) location.replace('?loadFailed=1');
const seed = header?.seed ?? params.get('seed') ?? 'omen';
// No mode yet: the title screen, over a sandbox island that just lives.
const chosen = header?.mode ?? params.get('mode');
const mode: GameMode = chosen === 'warning' ? 'warning' : 'sandbox';

// ?years=N shortens the Warning (testing, or a quick game).
const years = header ? header.floodInYears : Number(params.get('years')) || undefined;
// A sandbox island has several peoples; the Warning is one people's story. (?tribes=N to choose.)
const tribes = header ? (header.tribes ?? 1) : Number(params.get('tribes')) || (mode === 'sandbox' && chosen ? TUNING.sandboxTribes : 1);
const sim = new Sim({ seed, mode, floodInYears: years, tribes });
if (saved && header) {
  try {
    restoreGame(sim, saved);
  } catch (err) {
    console.error(err);
    location.replace('?loadFailed=1');
    throw err;
  }
}
const loop = new FixedLoop(sim);
const renderer = new GameRenderer(document.getElementById('app')!, sim);
const hudRoot = document.getElementById('hud')!;
const hud = new Hud(hudRoot, loop, renderer, seed);
const toasts = new Toasts(hudRoot);
const inspector = new Inspector(hudRoot, () => (renderer.villagers.selectedId = -1));
const miracles = new MiracleController(hudRoot, sim, renderer, loop, toasts);
const debug = new DebugPanel(hudRoot, sim, renderer);
// Which people the faith panels show; clicking a villager follows theirs.
const focus = new PeopleFocus(sim);
const beliefs = new BeliefsPanel(hudRoot, focus);
const book = new HolyBookPanel(hudRoot, focus);
// The title screen's idle island has no purposes.
const goals = chosen ? new GoalsPanel(hudRoot, focus) : null;
// What they make of it: words over witnesses' heads, and a card each season.
const reactions = chosen ? new Reactions(hudRoot, renderer) : null;
const report = chosen ? new SeasonReport(hudRoot, focus, () => showBeliefs(true)) : null;
// Who is doing what: marks over heads, a card on hover, and the day's happenings.
const overhead = chosen ? new Overhead(hudRoot, renderer) : null;
const life = chosen
  ? new VillageLog(hudRoot, sim, (id) => {
      const v = sim.villagers.byId(id);
      if (!v) return;
      const half = TUNING.world.sizeX / 2;
      if (v.alive) renderer.orbit.focus(v.x - half, v.z - half, 45);
      openVillager(id);
    })
  : null;
/** Beliefs and Village life share the right side: one at a time. */
/** On a phone there's room for one side panel at a time. */
const narrow = () => matchMedia('(max-width: 600px)').matches;
function openVillager(id: number): void {
  inspector.open(id);
  const v = sim.villagers.byId(id);
  if (v) focus.set(v.tribeId);
  if (narrow()) {
    life?.toggle(false);
    beliefs.toggle(false);
  }
}
function showBeliefs(show = beliefs.el.hidden): void {
  if (show && narrow()) inspector.close();
  beliefs.toggle(show);
  if (show) life?.toggle(false);
}
function showLife(show = !life?.open): void {
  if (show && narrow()) inspector.close();
  life?.toggle(show);
  if (show) beliefs.toggle(false);
}
hudRoot.querySelector('.hud-life')!.addEventListener('click', () => showLife());
beliefs.onVerse = (id) => book.showVerse(id);
hudRoot.querySelector('.hud-beliefs')!.addEventListener('click', () => showBeliefs());
hudRoot.querySelector('.hud-book')!.addEventListener('click', () => book.toggle());

/** Save the game in progress (not the title screen's idle island). */
function saveNow(): string | null {
  if (!chosen) return 'Nothing to save on the title screen.';
  return writeSave(saveGame(sim, { seed, mode, floodInYears: years, tribes, label: formatCalendar(sim.calendar) }));
}
const sound = new Soundscape();
const settings = new SettingsPanel(
  hudRoot,
  loadSettings(),
  (s) => {
    renderer.setQuality(s.quality);
    renderer.post.enabled = s.tiltShift;
    renderer.reducedMotion = s.reducedMotion;
    document.body.classList.toggle('reduce-motion', s.reducedMotion);
    sound.setVolume(s.muted ? 0 : s.volume);
    if (overhead) overhead.enabled = s.icons;
  },
  chosen ? saveNow : null,
);
hudRoot.querySelector('.hud-settings')!.addEventListener('click', () => settings.toggle());
// Autosave once a year, and when the page is hidden or closed.
let savedYear = sim.calendar.year;
function autosave(): void {
  if (chosen && !end) saveNow();
}
window.addEventListener('pagehide', autosave);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && autosave());

const tutorial = new Tutorial(hudRoot, {
  sim,
  renderer,
  loop,
  inspectorOpen: () => inspector.villagerId >= 0,
  beliefsOpen: () => !beliefs.el.hidden,
  book,
});
hudRoot.querySelector('.hud-help')!.addEventListener('click', () => (tutorial.running ? tutorial.finish() : tutorial.start()));
// First time in a game, the tutorial starts by itself (after the Warning's vision).
const firstTime = !Tutorial.seen();

if (!chosen) {
  document.body.classList.add('at-title');
  new TitleScreen(hudRoot, seed, savedHeader(), params.has('loadFailed'));
} else if (header) {
  // A loaded game picks up where it was, paused so the player can get their bearings.
  loop.setSpeedIndex(0);
  toasts.show(`Welcome back. ${formatCalendar(sim.calendar)}.`);
} else if (sim.warning) {
  // The opening vision: the player alone sees the sea at the height it will reach.
  loop.setSpeedIndex(0);
  const c = sim.island.landmarks.center;
  renderer.setFloodPreview(sim.warning.disaster.safeAbove, c.x, c.z);
  new Vision(hudRoot, Math.round(sim.warning.yearsLeft), () => {
    renderer.setFloodPreview(null);
    loop.setSpeedIndex(1);
    if (firstTime) tutorial.start();
  });
} else if (firstTime) tutorial.start();

let end: EndScreen | null = null;
function checkOutcome(): void {
  if (end || !sim.warning?.outcome) return;
  loop.setSpeedIndex(0);
  end = new EndScreen(hudRoot, sim, {
    book: () => {
      book.setTruth(true);
      book.toggle(true);
    },
    watch: () => {
      end?.close();
      loop.setSpeedIndex(1);
    },
    again: () => startGame('warning', randomSeed()),
    title: () => startGame(null, seed),
  });
}

renderer.onTap = (x, y) => {
  // An armed miracle takes the tap; otherwise taps select villagers.
  if (miracles.tap(x, y)) return;
  const id = renderer.pickVillager(sim, x, y);
  if (id >= 0) openVillager(id);
  else if (inspector.villagerId >= 0) inspector.close();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && inspector.villagerId >= 0 && !miracles.armed && !book.open) inspector.close();
  if (e.code === 'KeyV' && !(e.target instanceof HTMLInputElement)) showBeliefs();
  if (e.code === 'KeyJ' && !(e.target instanceof HTMLInputElement)) showLife();
});

// Dev-only handle for poking at state from the console.
if (import.meta.env.DEV) Object.assign(window, { omen: { sim, loop, renderer, debug, miracles, inspector, beliefs, book, settings, focus } });

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const alpha = loop.advance(dt);
  renderer.villagers.selectedId = inspector.villagerId;
  miracles.update();
  renderer.render(sim, alpha, dt);
  hud.update(sim, dt);
  toasts.update(sim);
  inspector.update(sim, dt);
  debug.update(dt);
  beliefs.update(dt);
  book.update(dt);
  if (goals) {
    goals.covered = inspector.villagerId >= 0 || tutorial.running || miracles.armed !== null;
    goals.update(dt);
  }
  reactions?.update(sim, dt);
  overhead?.update(sim, dt);
  life?.update(dt);
  if (report) {
    report.covered = tutorial.running || !beliefs.el.hidden || !!life?.open || book.open || end !== null;
    report.update(dt);
  }
  checkOutcome();
  tutorial.update();
  sound.update(sim, loop.speedIndex > 0, dt);
  if (sim.calendar.year !== savedYear) {
    savedYear = sim.calendar.year;
    autosave();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
