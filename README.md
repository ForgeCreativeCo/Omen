# OMEN

A browser voxel god game about the gap between what a god does and what its people believe. Full design: [SPEC.md](SPEC.md).

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=anything picks the island)
npm test           # headless sim tests
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

In dev builds `window.omen` exposes `{ sim, loop, renderer }` for poking at state from the console.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
  - `world/materials.ts` material table, `world/VoxelWorld.ts` chunked storage with per-chunk versions, `world/terrain.ts` island generator + landmarks.
- `src/render/` three.js; reads sim state, never mutates it.
  - `chunks/` column mesher (AO, color jitter; runs in a Web Worker for edits), terrain/water materials, decorative underside.
  - `camera/OrbitCamera.ts`, `Environment.ts` (sky, sun/moon, seasons, clouds), `post/PostFX.ts` (tilt-shift).
- `src/ui/` plain DOM HUD. `src/debug/` God's Eye overlay (later).
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
