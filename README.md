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
| Time | Space = pause, 1 = pause, 2 = 1× (a day is about 40 s), 3 = 4×, 4 = 16× | HUD buttons |
| Settings | ⚙ button: graphics quality, tilt-shift (T), reduced motion, activity icons (U), volume, mute (M), save now / delete save | ⚙ button |
| Miracles | click a miracle or press its key: Rain R, Lightning L, Shape Earth G, Bloom B, Holy Light I, Hallow 6, Create 9, Bless K, Blight X, Falling Star O, The Hand F, Dream N; then click the land (Esc cancels) | tap a miracle, then tap; Cancel button |
| Wrath | the red buttons: Earthquake Y, Firestorm C, Tidal Wave Z (needs a shore within reach), Plague P, Swarm 5, Extinction 7 | same |
| The Hand | press on a villager, a tree or the ground to take hold, drag to carry, let go gently to set down or flick to throw | same, with a finger |
| Shape Earth | drag to raise; hold Shift (or toggle Lower) to dig | drag; Raise/Lower toggle |
| Rain cloud | drag the cloud while it lasts | drag the cloud |
| Dream | at night, click a marked sleeper and choose 3 symbols | same, with taps |
| Inspect | click a villager (Esc closes); hover for a quick card | tap a villager |
| Messiah | Anoint (8) then click a waking adult, or **Anoint as messiah** on their card; to raise them, grab their glowing body with the Hand within three days | same |
| Prayers | the list at top left: click one to go there with its answer ready; or click the bubble over the one praying | tap |
| Village life | J or the Life button: who did what, by day, with filters; click a name to go to them | Life button |
| Village Beliefs | V or the Beliefs button (click a belief for its origin and its verse) | Beliefs button |
| Holy Book | H or the Holy Book button; "Show the Truth" sets what really happened beside each verse | Holy Book button |
| Purposes | bottom-left: the next milestones, a tip for the moment (judgment, a raid, a prayer for victory, sickness, a defier, deep dread) | same |
| Whose faith | with several peoples, the switcher at the top of Beliefs, the Holy Book, Purposes and the season card picks whose you see; clicking a villager follows their people | same |
| God's Eye | F3 | triple-tap the top-left corner |
| Tutorial | starts by itself the first time; the **?** button replays or stops it | same |
| Save | autosaves every in-game year and when the tab is hidden; **Continue** on the title screen | same |

In dev builds `window.omen` exposes `{ sim, loop, renderer, beliefs, book, … }` for poking at state from the console.

## What's in the game
- **The island**: 256×256 voxels. A home valley (village, east hill, ridge, river) with highlands, forested lowlands, badlands and meadows around it, and, in the sandbox, two to four islets in the sea around it. Far-off terrain is drawn coarse.
- **Growing villages**: homes, fields and a well go up as the people grow, kept close to the fire. With no open ground near, they mark a patch of woods and the woodcutters fell it before anything is built there, so a growing village eats into the forest. A village with wood, stone and food to spare builds for its own sake: a storehouse (food keeps twice as long), fences around its fields, longhouses that sleep nine. Feet wear paths between the huts, fields and fire, and the grass grows back where nobody walks. A people settled far from bare rock walks farther to quarry.
- **Belief**: every witness reads each omen for themselves (what they blame or credit, blessing or curse), retells it at the fire, and beliefs harden into rites, taboos, holy and cursed places, chosen ones, doctrine and tradition. Speech over heads shows each reading; a seasonal card says what changed.
- **Myth**: named places, the god's name and statue, legends that compress with each priest, a Holy Book with the truth beside each verse, and laws the village writes for itself.
- **Society**: fondness and grudges between every pair, affairs (found out or not), feuds, fights, rare killings, thefts and quarrels.
- **Justice**: a wrong comes to light, the accused waits a day for the god to speak (strike, pardon, side with the wronged, a dream to the priest), then the village judges by its own compass: forgiveness to flogging, exile, death for murder. Unseen crimes get pinned on whoever is resented. Repeated sentences become written law.
- **Turning away**: a silent god gets a Doubter or a False Prophet; their pull spreads at the fire and can split the village.
- **The messiah**: Anoint (8, or the button on a villager's card) names one waking adult your messiah. A pillar of light comes down on them and everyone who sees it holds them chosen; a halo marks them. Their people credit your wonders near them to them (and love you a little less for it). They preach at the evening fire, spreading what they believe and bringing back a Doubter's or False Prophet's followers. Every few days they walk to another people and preach there; some come away with them (among a people at war with theirs, they may be killed on arrival). The priest comes to resent them, and those who hate them or defy you may kill them. Their death is remembered by how it came: a saint (old age, sickness; where they lie is holy), a martyr (killed; grief, a wave of faith, and the killers' own people turn on them, some coming over), or taken home by you (the faithful say you called them, the rest that you abandoned them). For three days the body glows where it fell: take it up with the Hand and they rise, the greatest wonder there is, and some of the other peoples who see it come to them. One messiah at a time; each gets verses in the Holy Book.
- **Prayers**: people ask you for things, out loud. Each dawn a people in need may pray: rain for dry fields, food when the stores run low, healing for the sick (asked by their kin), a child, vengeance on raiders, a new land when the village is crowded, mercy after a disaster. A bubble over the one praying shows their words and a ring for the time left, and the Prayers list (top left) says how to answer each one; clicking a prayer goes there and readies the miracle that answers it. Answered, the one who asked, their family and a little the whole people love you more; unanswered, they love you less; harm their people while they pray and they take it as your answer. When the world answers on its own (rain falls, the sick get better, a baby comes) they thank you anyway. Bless now heals the sick.
- **Blessings**: Bless (K) touches a person, or blesses a field or a home for a year. A blessed field grows fast and heavy, never goes thirsty, and blight and locusts pass it by; a blessed home wakes its sleepers rested and a little fonder of the god, keeps sickness from passing between them, and has babies sooner. Each is an omen like any other: the household may decide it is chosen, and a neighbor may envy it.
- **Wrath**: earthquakes crack the ground and topple huts on those inside; firestorms rain fire on an area; a tidal wave surges inland from the nearest shore and drains back; plague passes between people who stand close, most at the evening fire, and those who live through it don't catch it again; a swarm eats one people's fields bare; and Extinction drops an asteroid, seen coming for a few moments, that kills everyone within 45 voxels and flattens every building within 40: a village under it is gone (those of its people who were away survive). Each becomes an omen like any other; the whole island sees the sky fall.
- **A cruel god**: every harm adds to a people's dread. After a disaster the priest burns a great offering; deep enough dread ends with a person given to the god at the fire (it can harden into a rite, or a taboo). Kin of those the god kills may defy it openly: struck down, the rest are cowed; left alone, others join. A neighbor's disaster is read as proof it angered the god (give more, lest we be next); a neighbor's blessing is envied.
- **Peoples and war**: several peoples with their own faiths. A schism founds a new people. Relations drift with land, hunger, the god's name and the dead; war brings raids on the enemy fire (loot, captives, burned huts, blood grudges). A war party's priest prays for victory, and harm to the enemy reads as the answer. Two peoples bitter toward the same third ally and join each other's wars. A people with no fighters left is conquered: taken in, or driven from its land. Peace sends captives home; captives kept two years become one of their captors. The last of a dying people join a neighbor.
- **Hallowed ground and daughter peoples**: Hallow marks out ground that glows for two days. Whoever sees it may hold it holy (the faithful more, skeptics less, doubters not at all), and each people names the place. If it lies well away from home (32+ voxels), the village is crowded (18+) and at least five hold it strongly, they talk it over for a couple of days, then a party of believers sets out, families together, led by the most devout, and founds a daughter people there: kin, on good terms, with the same faith, god's name and holy place, free to drift apart from then on. On an islet they sail. Not in the Warning; six peoples at most; a people sends one party every three years at most. Ground close to home is just a holy place nearby.
- **Create and castaways**: Create (9) raises a man and a woman from the earth where you point, grown (about 20) and already a couple, who love the god who made them. Within 40 voxels of a people's fire they go to live there; farther off (in the sandbox, six peoples at most) they found a people of their own with a month's food, and their own making is the first omen they hold. Now and then a boat is wrecked on the coast and two to five strangers come ashore (always a young woman and man among them), with planks of the wreck left in the sand: they join the nearest people they can walk to, knowing nothing of the god. To an island with no one left they come within days, and found a people again. In the Warning both join the one people.
- **Boats**: a crowded people may send a few families to settle an empty islet; they sail from the nearest shore and found a people of their own. Raids can't cross the water.
- **Exodus**: a village the god wrecks (crater, curse, flood, homes smashed) is abandoned; survivors walk to new ground, clear it and rebuild.

## Roadmap
The last roadmap is built: the five destructive powers, reactions to a cruel god, panels for every people, deeper war, the tutorial refresh, distant-terrain level of detail and the archipelago with boats.

Next, if wanted:
1. **Tune by playing**: dread, sacrifice and defiance thresholds, plague lethality and the odds of a raid winning were set from tests, not long sessions.
2. **Save migration**: carry saves across versions instead of refusing them.
3. **Boats beyond settling**: raids and trade by sea, and the god sinking a boat as an omen.
4. **Low-end hardware pass**: measure the island on a weak laptop and a phone now that level of detail is in.
5. **Cheaper village planning**: each village recomputes buildable ground and walking distance over the whole island once a day (about 30 ms per village on a desktop); limiting it to the village's surroundings would cut most of that.

## Known gaps
- **The Warning is single-people by design**: a schism's followers leave the island there, so a breakaway people can't survive the flood by luck. The Warning's island has no islets either.
- **Raiders rarely win outright** (defenders fight on home ground), so captives are mostly snatched by a party breaking away.
- **Boats only carry settlers**: no raids, trade or fishing by sea, and the god can't sink one.
- **Saves don't carry across versions**: each change to the world's shape bumps the save version (now 9) and old saves are refused.
- **The audio for the newer powers is synthesized but not tuned by ear** (the earthquake, the tidal wave, lightning, the falling star, the firestorm, the swarm, the plague's coughing, prayer, dancing, war, panic, births and building work use recordings).
- **Performance is untested on low-end hardware.** Zoomed out over the whole island on one desktop: about 280 draw calls and 410k triangles with level of detail, against 456 and 690k without.

## Layout
- `src/sim/` pure, deterministic simulation (no three.js, no DOM, no `Math.random`, enforced by `tests/architecture.test.ts`). All tuning in `src/sim/tuning.ts`.
  - `world/` materials, chunked voxels, island generator (regions, islets), nav grid, weather, fire, prefabs and structures.
  - `villagers/` needs, utility AI and jobs (`Villagers.ts`), the village planner and stores (`village.ts`), A* pathfinding, names.
  - `miracles/` miracle definitions (data), Grace and cooldowns (off by default), the miracles, the Hand (`hand.ts`), and the destructive powers that run over time (`wrath.ts`: earthquake, firestorm, tidal wave, swarm); player input arrives as commands recorded in `sim.inputLog`.
  - `omens/` omen recording: witnesses (per people), outcomes, context snapshots (places, deeds, activities).
  - `belief/` the interpretation engine (`interpret.ts`), belief store, priests, rumor and traditions (`BeliefSystem.ts`), behavior effects (`effects.ts`), dreams, and the data catalog of belief types.
  - `tribe.ts` a people: its village and its own systems, which see the sim through a per-people view. `war.ts` relations, war, raids, captives, conquest, alliances, prayers for victory and peace. `appease.ts` (per people) dread, great offerings, sacrifice, defiance and rivalry. `plague.ts` the god's sickness. `boats.ts` settlers sailing to the islets. `branching.ts` hallowed ground and the believers it calls away to found daughter peoples. `paths.ts` paths worn by feet.
  - `society.ts` bonds, affairs, feuds, fights and killings. `justice.ts` accusation, the god's window, judgment, custom and law. `dissent.ts` silence, Doubters, False Prophets and schism. `exodus.ts` leaving a ruined home and finding new ground. `milestones.ts` Purposes.
  - `disaster/` the Warning (`Warning.ts`: countdown, faith collapse, verdict) and its disasters behind a `Disaster` interface (`Flood.ts` only).
  - `myth/` memory and myth (`Myth.ts`): named places, legends, statues and ruins, the god's name, and the Holy Book written through the `ScriptureWriter` interface (`scripture.ts`, template grammar; no LLM writer is implemented).
  - `save.ts` save / load: the sim's object graph, restored in place onto a fresh Sim of the same seed, mode and number of peoples; each people's view is rebuilt after loading. Production builds keep class names for this (`vite.config.ts`).
  - `events.ts` the event log the renderer, toasts and omens read (events raised by a people's systems carry its id).
- `src/render/` three.js; reads sim state, never mutates it.
  - `chunks/` column mesher (AO, color jitter; runs in a Web Worker for edits), coarse meshes for distant terrain, terrain/water materials, decorative underside.
  - `camera/OrbitCamera.ts`, `Environment.ts` (sky, sun/moon, seasons, clouds, storm gloom), `post/PostFX.ts` (tilt-shift).
  - `villagers/VillagerRenderer.ts` instanced voxel villagers (tunics take their people's color; the sick look it); `vfx/` weather, miracle, wrath, Hand and boat effects.
- `src/ui/` plain DOM HUD (a wrapping top bar), villager inspector and hover card, activity icons and speech (`Overhead.ts`, `Reactions.ts`), toasts, the Village life log, the season report, Purposes, Village Beliefs, the Holy Book (the last four switch between peoples through `PeopleFocus.ts`), title / vision / end screens, the tutorial. `src/debug/` God's Eye.
- `src/audio/Soundscape.ts` WebAudio, synthesized: wind, sea, birds, rain, murmuring at the fire, ritual drums, a voice per miracle, and the Warning's drone. Starts on the first click or key. `src/audio/sounds/` recordings that replace a synthesized voice once loaded: the tidal wave's crash (`ocean-wave.mp3`, from the file `freesound_community-ocean-wave-100271`), lightning strikes, the god's and the storms' (`lightning.mp3`, from `patricksilvey-weather-lightning-2-464187`), the ground cracking in an earthquake (`earthquake.mp3`, from `freesound_community-052256_cracking-earthquake-cracking-soil-cracking-stone-86770`), the falling star's descent (`asteroid.mp3`, from `freesound_community-asteroid-94614`) and impact (`explosion.mp3`, from `soundreality-explosion-fx-343683`); the firestorm's roar for as long as it burns (`blazing-fire.mp3`, from `soundreality-blazing-fire-394355`); a swarm's buzzing while it feeds, following it as it flies (`buzzing.mp3`, from `dragon-studio-flies-buzzing-494311`); a dark chant while people pray near where the camera looks, at a rite or on holy ground (`prayer.mp3`, from `freesound_community-dark-prayer-77117`); a Celtic tune while people dance near where the camera looks, played through and again while they dance on (`dance.mp3`, from `grumpynora-celtic-dance-9-sec-edit-486554`; the synthesized drums now play only until the recordings load); a war horn when war is declared and when a war party sets out, and the clash of swords while a raid fights near where the camera looks (`horn.mp3`, `sword-fight.mp3`, from `freesound_community-horn-a-37752` and `dragon-studio-sword-fight-393849`); the cries of a crowd fleeing in fear (three or more) near where the camera looks (`crowd-panic.mp3`, from `freesound_community-029586_crowd-in-panic-66480`); a newborn's cry, faint from across the island (`baby-crying.mp3`, from `dragon-studio-baby-crying-463213`); hammering and sawing at building sites near where the camera looks (`hammering.mp3`, `sawing.mp3`, from `kalsstockmedia-hammer-hitting-nail-carpentery-sound-effect-243339` and `universfield-wood-sawing-143484`); and the coughing of the sick while a plague lasts (`cough.mp3`, `cough-grandpa.mp3`, `cough-man.mp3`, from `freesound_community-cough-80945`, `floraphonic-coughing-grandpa-1-189848` and `freesound_community-man-coughing-47879`).
- `src/loop.ts` fixed-timestep bridge between real time and sim ticks.
