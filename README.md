# OMEN

A browser voxel god game about the gap between what a god does and what its people believe. Full design: [SPEC.md](SPEC.md).

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=anything to change the world seed)
npm test           # headless sim tests
npm run build      # typecheck + production build
```

Controls (so far): Space = pause, 1 = pause, 2 = 1×, 3 = 4×, 4 = 16×.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
- `src/render/` three.js; reads sim state, never mutates it.
- `src/ui/` plain DOM HUD. `src/debug/` God's Eye overlay.
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
