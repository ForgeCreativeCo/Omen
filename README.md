# OMEN

A browser voxel god game about the gap between what a god does and what its people believe. Full design: [SPEC.md](SPEC.md).

```bash
npm install
npm run dev        # http://localhost:5173  (title screen; ?seed=… picks the island, ?mode=warning|sandbox skips it, ?years=N shortens the Warning, ?tribes=N sets how many peoples a sandbox starts with)
npm test           # headless sim tests (~1 min)
npm run test:long  # + the long acceptance runs: 120-year villages, 75-year myth, 120-year Warning games (10+ min)
npm run build      # typecheck + production build
```

## Modes
- **The Warning** (main mode): a vision shows the sea rising over the valley in 120 years; only you know. A quiet countdown sits under the calendar. When it ends the sea climbs over a few days to a height that drowns the valley and the east hill but not the ridge top. You win if at least 40% of the people alive when it strikes are still alive after it. You lose if fewer survive, or if their faith in you collapses first. Nothing is scripted: people run to the highest holy place they trust, and anyone who trusts none wades for the nearest dry ground. One people only. A full run is about 30 minutes at 16× and 2 hours at 4×.
- **Sandbox**: no disaster and no end. The island starts with three peoples in different regions, each with its own village, priest, beliefs, Holy Book and name for you. They feud, split, go to war, and rebuild when you wreck them.

Your miracles have no cooldowns and no cost (a switch in `src/sim/tuning.ts` brings the old Grace limits back).

## Controls
| | Desktop | Touch |
|---|---|---|
| Pan | left/middle-drag, WASD / arrows | one-finger drag |
| Rotate | right-drag, Q / E | two-finger twist |
| Tilt | right-drag vertically | two fingers slide up/down |
| Zoom | wheel | pinch |
| Time | Space = pause, 1 = pause, 2 = 1×, 3 = 4×, 4 = 16× | HUD buttons |
| Settings | ⚙ button: graphics quality, tilt-shift (T), reduced motion, activity icons (U), volume, mute (M), save now / delete save | ⚙ button |
| Miracles | click a miracle or press its key: Rain R, Lightning L, Shape Earth G, Bloom B, Holy Light I, Bless K, Blight X, Falling Star O, The Hand F, Dream N; then click the land (Esc cancels) | tap a miracle, then tap; Cancel button |
| The Hand | press on a villager, a tree or the ground to take hold, drag to carry, let go gently to set down or flick to throw | same, with a finger |
| Shape Earth | drag to raise; hold Shift (or toggle Lower) to dig | drag; Raise/Lower toggle |
| Rain cloud | drag the cloud while it lasts | drag the cloud |
| Dream | at night, click a marked sleeper and choose 3 symbols | same, with taps |
| Inspect | click a villager (Esc closes); hover for a quick card | tap a villager |
| Village life | J or the Life button: who did what, by day, with filters; click a name to go to them | Life button |
| Village Beliefs | V or the Beliefs button (click a belief for its origin and its verse) | Beliefs button |
| Holy Book | H or the Holy Book button; "Show the Truth" sets what really happened beside each verse | Holy Book button |
| Purposes | bottom-left: the next milestones, a tip for the moment (including when someone awaits judgment or a raid is on) | same |
| God's Eye | F3 | triple-tap the top-left corner |
| Tutorial | starts by itself the first time; the **?** button replays or stops it | same |
| Save | autosaves every in-game year and when the tab is hidden; **Continue** on the title screen | same |

In dev builds `window.omen` exposes `{ sim, loop, renderer, beliefs, book, … }` for poking at state from the console.

## What's in the game
- **The island**: 256×256 voxels. A home valley (village, east hill, ridge, river) with highlands, forested lowlands, badlands and meadows around it.
- **Belief**: every witness reads each omen for themselves (what they blame or credit, blessing or curse), retells it at the fire, and beliefs harden into rites, taboos, holy and cursed places, chosen ones, doctrine and tradition. Speech over heads shows each reading; a seasonal card says what changed.
- **Myth**: named places, the god's name and statue, legends that compress with each priest, a Holy Book with the truth beside each verse, and laws the village writes for itself.
- **Society**: fondness and grudges between every pair, affairs (found out or not), feuds, fights, rare killings, thefts and quarrels.
- **Justice**: a wrong comes to light, the accused waits a day for the god to speak (strike, pardon, side with the wronged, a dream to the priest), then the village judges by its own compass: forgiveness to flogging, exile, death for murder. Unseen crimes get pinned on whoever is resented. Repeated sentences become written law.
- **Turning away**: a silent god gets a Doubter or a False Prophet; their pull spreads at the fire and can split the village.
- **Peoples and war**: several peoples with their own faiths. A schism founds a new people. Relations drift with land, hunger, the god's name and the dead; war brings raids on the enemy fire (loot, burned huts, blood grudges) until the dead weary it into peace. The last of a dying people join a neighbor.
- **Exodus**: a village the god wrecks (crater, curse, flood, homes smashed) is abandoned; survivors walk to new ground, clear it and rebuild.

## Roadmap
Planned next, roughly in order:
1. **More destructive powers**: earthquake (cracks the ground, topples huts), plague (spreads person to person), tidal wave (the sea surges inland where you point), firestorm (a rain of fire over an area), swarm (eats a people's crops).
2. **Reactions to a cruel god**: sacrifices and offerings to calm it after disasters, people who defy it openly, peoples competing for its favor ("they suffered because they angered it; we must please it").
3. **Panels for every people**: switch Beliefs, the Holy Book, Purposes and the season card between peoples (or follow the people of the villager you click).
4. **Deeper war**: captives taken in raids, conquest (a beaten people absorbed or driven from its land), alliances against a common enemy, peoples praying to the god for victory.
5. **Tutorial refresh**: cover the Hand, peoples, war, justice and the Village life log.

Later, if needed:
6. **Performance**: distant-terrain level of detail if the big island stutters when zoomed out (about 1M triangles and ~500–800 draw calls at full view; ~45 fps measured on one desktop).
7. **Archipelago and boats**: small islands off the coast, and peoples sailing to them.

## Known gaps
- **Beliefs, Holy Book, Purposes and the season card show only the first people.** Speech, toasts, the Village life log, the inspector and the hover card already handle every people.
- **Raids take food, not people or land.** No captives, conquest or alliances yet.
- **The Warning is single-people by design**: a schism's followers leave the island there, so a breakaway people can't survive the flood by luck.
- **The tutorial predates** the Hand, peoples, war and the Life log.
- **Saves don't carry across versions**: each change to the world's shape bumps the save version and old saves are refused.
- **The audio for newer powers is synthesized but not tuned by ear.**
- **Performance is untested on low-end hardware** since the island grew to 4× its old area.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
  - `world/` materials, chunked voxels, island generator (regions), nav grid, weather, fire, prefabs and structures.
  - `villagers/` needs, utility AI and jobs (`Villagers.ts`), the village planner and stores (`village.ts`), A* pathfinding, names.
  - `miracles/` miracle definitions (data), Grace and cooldowns (off by default), the miracles, and the Hand (`hand.ts`); player input arrives as commands recorded in `sim.inputLog`.
  - `omens/` omen recording: witnesses (per people), outcomes, context snapshots (places, deeds, activities).
  - `belief/` the interpretation engine (`interpret.ts`), belief store, priests, rumor and traditions (`BeliefSystem.ts`), behavior effects (`effects.ts`), dreams, and the data catalog of belief types.
  - `tribe.ts` a people: its village and its own systems, which see the sim through a per-people view. `war.ts` relations, war, raids and peace between peoples.
  - `society.ts` bonds, affairs, feuds, fights and killings. `justice.ts` accusation, the god's window, judgment, custom and law. `dissent.ts` silence, Doubters, False Prophets and schism. `exodus.ts` leaving a ruined home and finding new ground. `milestones.ts` Purposes.
  - `disaster/` the Warning (`Warning.ts`: countdown, faith collapse, verdict) and its disasters behind a `Disaster` interface (`Flood.ts` only).
  - `myth/` memory and myth (`Myth.ts`): named places, legends, statues and ruins, the god's name, and the Holy Book written through the `ScriptureWriter` interface (`scripture.ts`, template grammar; no LLM writer is implemented).
  - `save.ts` save / load: the sim's object graph, restored in place onto a fresh Sim of the same seed, mode and number of peoples; each people's view is rebuilt after loading. Production builds keep class names for this (`vite.config.ts`).
  - `events.ts` the event log the renderer, toasts and omens read (events raised by a people's systems carry its id).
- `src/render/` three.js; reads sim state, never mutates it.
  - `chunks/` column mesher (AO, color jitter; runs in a Web Worker for edits), terrain/water materials, decorative underside.
  - `camera/OrbitCamera.ts`, `Environment.ts` (sky, sun/moon, seasons, clouds, storm gloom), `post/PostFX.ts` (tilt-shift).
  - `villagers/VillagerRenderer.ts` instanced voxel villagers (tunics take their people's color); `vfx/` weather, miracle and Hand effects.
- `src/ui/` plain DOM HUD (a wrapping top bar), villager inspector and hover card, activity icons and speech (`Overhead.ts`, `Reactions.ts`), toasts, the Village life log, the season report, Purposes, Village Beliefs, the Holy Book, title / vision / end screens, the tutorial. `src/debug/` God's Eye.
- `src/audio/Soundscape.ts` WebAudio, all synthesized: wind, sea, birds, rain, murmuring at the fire, ritual drums, a voice per miracle, and the Warning's drone. Starts on the first click or key.
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
