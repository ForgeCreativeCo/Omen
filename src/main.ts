import { Sim } from './sim/Sim';
import { FixedLoop } from './loop';
import { GameRenderer } from './render/GameRenderer';
import { Hud } from './ui/Hud';
import { BeliefsPanel } from './ui/BeliefsPanel';
import { Inspector } from './ui/Inspector';
import { MiracleController } from './ui/MiracleController';
import { Toasts } from './ui/Toasts';
import { DebugPanel } from './debug/DebugPanel';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? 'omen';

const sim = new Sim({ seed });
const loop = new FixedLoop(sim);
const renderer = new GameRenderer(document.getElementById('app')!, sim);
const hudRoot = document.getElementById('hud')!;
const hud = new Hud(hudRoot, loop, renderer, seed);
const toasts = new Toasts(hudRoot);
const inspector = new Inspector(hudRoot, () => (renderer.villagers.selectedId = -1));
const miracles = new MiracleController(hudRoot, sim, renderer, loop, toasts);
const debug = new DebugPanel(hudRoot, sim, renderer);
const beliefs = new BeliefsPanel(hudRoot, sim);
hudRoot.querySelector('.hud-beliefs')!.addEventListener('click', () => beliefs.toggle());

renderer.onTap = (x, y) => {
  // An armed miracle takes the tap; otherwise taps select villagers.
  if (miracles.tap(x, y)) return;
  const id = renderer.pickVillager(sim, x, y);
  if (id >= 0) inspector.open(id);
  else if (inspector.villagerId >= 0) inspector.close();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && inspector.villagerId >= 0 && !miracles.armed) inspector.close();
  if (e.code === 'KeyV' && !(e.target instanceof HTMLInputElement)) beliefs.toggle();
});

// Dev-only handle for poking at state from the console.
if (import.meta.env.DEV) Object.assign(window, { omen: { sim, loop, renderer, debug, miracles, inspector, beliefs } });

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
