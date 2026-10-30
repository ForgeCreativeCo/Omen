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
| Miracles | click a miracle (or R, L, G, B, N), then click the land; Esc cancels | tap a miracle, then tap; Cancel button |
| Shape Earth | drag to raise; hold Shift (or toggle Lower) to dig | drag; Raise/Lower toggle |
| Rain cloud | drag the cloud while it lasts | drag the cloud |
| Dream | at night, click a marked sleeper and choose 3 symbols | same, with taps |
| Inspect | click a villager (Esc closes) | tap a villager |
| Village Beliefs | V or the Beliefs button (click a belief for its origin and its verse) | Beliefs button |
| Holy Book | H or the Holy Book button; "Show the Truth" sets what really happened beside each verse | Holy Book button |
| God's Eye | F3 | triple-tap the top-left corner |

In dev builds `window.omen` exposes `{ sim, loop, renderer, beliefs, book, … }` for poking at state from the console.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
  - `world/` materials, chunked voxels, island generator, nav grid, weather, fire, prefabs and structures.
  - `villagers/` needs, utility AI and jobs (`Villagers.ts`), the village planner and stores (`village.ts`), A* pathfinding, names.
  - `miracles/` miracle definitions (data), Grace, cooldowns and the five miracles; player input arrives as commands recorded in `sim.inputLog`.
  - `omens/` omen recording: witnesses, outcomes, context snapshots (places, deeds, activities).
  - `belief/` the interpretation engine (`interpret.ts`), belief store, priests, rumor and traditions (`BeliefSystem.ts`), behavior effects (`effects.ts`), dreams, and the data catalog of belief types.
  - `myth/` memory and myth (`Myth.ts`): named places, legends and their compression at each succession, statues (`statues.ts`) and ruins, the god's name (`godName.ts`), and the Holy Book (`HolyBook.ts`) written through the `ScriptureWriter` interface (`scripture.ts`, template grammar; no LLM writer is implemented).
  - `events.ts` the event log the renderer, toasts and (later) omens read.
- `src/render/` three.js; reads sim state, never mutates it.
  - `chunks/` column mesher (AO, color jitter; runs in a Web Worker for edits), terrain/water materials, decorative underside.
  - `camera/OrbitCamera.ts`, `Environment.ts` (sky, sun/moon, seasons, clouds, storm gloom), `post/PostFX.ts` (tilt-shift).
  - `villagers/VillagerRenderer.ts` instanced voxel villagers; `vfx/WeatherFx.ts` fire, embers, rain, lightning.
- `src/ui/` plain DOM HUD, villager inspector, toasts, Village Beliefs, the Holy Book (`HolyBookPanel.ts`). `src/debug/` God's Eye: salience table for the latest omen, witness lines, belief history, myth stats, priest switch, force events and time jumps.
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
