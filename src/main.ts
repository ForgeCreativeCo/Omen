import { Sim } from './sim/Sim';
import { FixedLoop } from './loop';
import { GameRenderer } from './render/GameRenderer';
import { Hud } from './ui/Hud';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? 'omen';

const sim = new Sim({ seed });
const loop = new FixedLoop(sim);
const renderer = new GameRenderer(document.getElementById('app')!, sim);
const hud = new Hud(document.getElementById('hud')!, loop, renderer, seed);

// Dev-only handle for poking at state from the console.
if (import.meta.env.DEV) Object.assign(window, { omen: { sim, loop, renderer } });

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const alpha = loop.advance(dt);
  renderer.render(sim, alpha, dt);
  hud.update(sim, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
