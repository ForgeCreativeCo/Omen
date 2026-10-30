# OMEN

A browser voxel god game about the gap between what a god does and what its people believe. Full design: [SPEC.md](SPEC.md).

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=anything picks the island)
npm test           # headless sim tests (~10 s)
npm run test:long  # + the 120-year untouched-village acceptance runs (~3 min)
npm run build      # typecheck + production build
```

## Controls
| | Desktop | Touch |
|---|---|---|
| Pan | left/middle-drag, WASD / arrows | one-finger drag |
| Rotate | right-drag, Q / E | two-finger twist |
| Tilt | right-drag vertically | two fingers slide up/down |
| Zoom | wheel | pinch |
| Time | Space = pause, 1 = pause, 2 = 1×, 3 = 4×, 4 = 16× | HUD buttons |
| View | T = tilt-shift | HUD button |
| Inspect | click a villager (Esc closes) | tap a villager |
| God's Eye | F3 | triple-tap the top-left corner |

In dev builds `window.omen` exposes `{ sim, loop, renderer }` for poking at state from the console.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
  - `world/` materials, chunked voxels, island generator, nav grid, weather, fire, prefabs and structures.
  - `villagers/` needs, utility AI and jobs (`Villagers.ts`), the village planner and stores (`village.ts`), A* pathfinding, names.
  - `events.ts` the event log the renderer, toasts and (later) omens read.
- `src/render/` three.js; reads sim state, never mutates it.
  - `chunks/` column mesher (AO, color jitter; runs in a Web Worker for edits), terrain/water materials, decorative underside.
  - `camera/OrbitCamera.ts`, `Environment.ts` (sky, sun/moon, seasons, clouds, storm gloom), `post/PostFX.ts` (tilt-shift).
  - `villagers/VillagerRenderer.ts` instanced voxel villagers; `vfx/WeatherFx.ts` fire, embers, rain, lightning.
- `src/ui/` plain DOM HUD, villager inspector, toasts. `src/debug/` God's Eye panel (stats, force weather, skip time).
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
