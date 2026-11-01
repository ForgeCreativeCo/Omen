# OMEN (working title): Build Brief for Claude Code

You are building a browser-based voxel god game called **OMEN** (working title). The player is a god whose followers cannot hear them. The followers only see what the god *does*, and they invent the meaning themselves. The whole game is about the gap between what the god intended and what the people believe.

Read this entire document before writing any code. It is the design spec for the project. Keep it in the repo as `SPEC.md` and refer back to it.

---

## 0. How to work on this project (read first)

- **Start by planning.** In your first reply, summarize your understanding of the game in a few sentences. Then propose the architecture and folder structure and list any questions that truly block you. Then begin Milestone 0 unless something blocks you.
- **Build milestone by milestone** (see section 18). After each milestone, stop and give me: what was built, how to run and test it, known issues, and what's next. Wait for my feedback before starting the next milestone.
- **Use git.** Initialize a repo and commit at the end of every milestone (and at sensible points within one) with clear messages.
- **Keep the simulation separate from the renderer.** All game logic lives in pure TypeScript with no Three.js imports, so it can run headless in tests.
- **Make it deterministic.** All randomness goes through a seeded RNG. The same seed plus the same player inputs must produce the same outcome.
- **Keep tuning in one place.** Every gameplay number (costs, rates, thresholds, timings) lives in `src/sim/tuning.ts`. Don't scatter magic numbers.
- **Data-driven content.** Miracles, belief types, scripture templates, name syllables and voxel materials are defined in config/data modules, not hard-coded inside systems.
- **Simple first, then upgrade.** Get a crude version of each system working end-to-end before polishing any one system.
- **Dependencies:** use only `three`, `simplex-noise`, `vite`, `typescript` and `vitest` unless you ask me first. Three.js's own `examples/jsm` addons (EffectComposer, passes, etc.) are fine.
- **Build debug tools as you go.** The interpretation system is impossible to tune blind. The debug overlay in section 15 is a requirement, not a nice-to-have.

---

## 1. The pitch

A tiny voxel valley on a floating island. A village of about 20 people. You are their god. You can make it rain, call lightning, reshape the earth, make crops bloom, and send dreams. You can never speak.

Every time you act, the villagers who see it try to work out *why*. They grab whatever stood out at the moment. Maybe there was a dance, a theft, a birth, or a particular hill. They turn it into a belief:

- Rain falls while they dance at the well, so *"The god sends rain when we dance."* They dance in every drought from then on. When it rains by coincidence, the belief gets stronger.
- Lightning strikes a thief's hut, so *"The god punishes thieves."*
- You aim at a tree on the east hill and miss twice, so *"The god hates the east hill."* Nobody farms there again.

Over generations, those beliefs harden into rituals, taboos, shrines, statues of what they *think* you look like, and a **Holy Book** written in their voice, misreadings and all. The rituals outlive anyone who remembers why they started.

In the main mode, **The Warning**, you know a flood is coming in about 120 years. You can't tell them. You have to teach them, through ambiguous acts alone, to move to high ground before the water rises.

---

## 2. Design pillars

1. **You control the evidence, never the interpretation.** The player can't directly command, select-and-order, or speak to villagers. All influence is indirect.
2. **Misunderstanding is the content.** Wrong beliefs should be funny, surprising, sometimes tragic, and always explainable after the fact.
3. **The land remembers.** Every act leaves a physical mark in the voxel world. Craters, scorched hills and split mountains become sacred geography.
4. **Time erodes truth.** Stories mutate as they're retold and compress across generations. The Holy Book drifts from what really happened.
5. **A miniature you are enormous over.** It's a diorama: cozy and tactile, and readable at a glance.

---

## 3. Tech stack and architecture

- **Vite + TypeScript (strict mode) + Three.js.** Runs in modern desktop browsers and on tablets (touch). It should be playable on a recent iPad.
- **Fixed-timestep simulation**: 10 sim ticks per in-game second-equivalent, scaled by the time-speed setting. The renderer interpolates and reads sim state. It never mutates it.
- **Suggested structure** (adjust if you have a better idea, but explain why):

```
src/
  main.ts
  sim/                  # pure TS, no three.js
    tuning.ts
    rng.ts
    world/              # voxel data, materials, terrain gen, fire, weather, sea level
    villagers/          # agents, needs, jobs, pathfinding, lifecycle, names
    miracles/           # miracle definitions + execution
    omens/              # omen recording, witnesses, context snapshot
    belief/             # interpretation engine, belief store, reinforcement, rumor, drift
    scripture/          # holy book generation (templates)
    modes/              # sandbox, warning
    Sim.ts              # top-level tick orchestration
  render/               # three.js only
    chunks/             # chunk meshing
    villagers/          # instanced villager rendering + animation
    vfx/                # miracle effects, particles
    post/               # tilt-shift, bloom
    camera/
  ui/                   # DOM-based HUD and panels (plain TS + CSS, no framework)
  debug/                # God's Eye overlay
tests/                  # vitest, headless sim scenario tests
```

- **UI is plain DOM + CSS** layered over the canvas. No UI framework.
- **Save/load** (later milestone): a JSON snapshot of sim state to `localStorage`.

---

## 4. The world

### Size and storage
- World: **128 × 128 horizontal, 48 tall** voxels. Chunks are **16³**, stored as `Uint8Array` material IDs.
- Re-mesh only dirty chunks, with a per-frame re-mesh budget so terrain edits never hitch.

### Terrain generation (seeded)
A floating island with:
- a central **valley** with a small river running to the sea
- an **east hill** (moderate height)
- a **mountain ridge** along one side. This is the high ground that matters in The Warning.
- forest patches, meadows, a beach ring, and cliffs falling away underneath the island (floating-island look)
- a good starting spot for the village near the river, with space for fields

### Materials (initial set)
`air, grass, dirt, stone, sand, water, wood (trunk), leaves, crop (with growth stages), thatch, plank, ash, marker-stone, shrine-stone, statue-stone`

Each material has: base color, flammable (bool), walkable (bool), fertility, and burn-result (e.g. grass→ash, wood→ash).

### Environmental systems
- **Natural weather.** Random rain showers, dry spells and droughts, and occasional storms with natural lightning, all with seasonal probabilities. **This is essential.** Villagers can't tell natural events from divine ones, so coincidences must happen. Natural weather events generate omens exactly like miracles do (flagged `isDivine: false` for debug only).
- **Fire.** A cellular spread through flammable voxels, influenced by dryness and wind direction. Rain extinguishes it. Burned voxels become ash, and ash is extra-fertile for a while, which gives villagers more to misread.
- **Crops.** Fields grow in stages and need moisture. Drought slows or kills them. Rain and Bloom help.
- **Sea level.** A global water plane at a configurable height. In The Warning it rises during the flood. Anything below it is flooded: structures are destroyed and villagers below the line drown. Full fluid simulation is **out of scope**. Rivers and ponds can be static water voxels.
- **Day/night cycle** plus **seasons** (spring, summer, autumn, winter) affecting weather odds, crop growth and lighting tint.

---

## 5. Villagers

### Basics
- Start with **20**, soft cap **150** for now.
- Each is a tiny voxel figure (roughly 3×3×7 voxels) with clothing color by role and a simple walk-bob animation. Render with `InstancedMesh`.
- Name generated from syllable tables (e.g. *Orra, Kesh, Tamuli, Brann*).

### Data per villager
`id, name, age, sex, lifeStage (child/adult/elder), role, traits[], needs {hunger, energy, safety}, faith {love, fear}, homeId, partnerId, parentIds, memories: OmenMemory[], beliefStrengths: Map<beliefId, number>`

### Traits (1–2 each)
- **Devout:** beliefs form faster and hold stronger
- **Skeptic:** beliefs form slower. With enough contradictions they can stop believing entirely.
- **Fearful:** reads harm into ambiguous events and favors taboos
- **Curious:** goes to look at omens, so is more likely to witness them
- **Gossip:** spreads rumors further and mutates them more

### Roles
Farmer, gatherer (wood), builder, elder, and **one priest** (see section 8). Roles are assigned by need and age.

### Behavior
- **Utility AI.** Each tick, villagers score available actions (eat, sleep, farm, gather, build, flee danger, perform ritual, make offering, pilgrimage, attend gathering) and pick the best. Beliefs add or modify actions and their scores (section 9).
- **Daily schedule tendencies:** wake at dawn → work → midday meal → work → **evening gathering at the fire pit** (this is where rumors spread and rituals happen) → sleep at night.
- **Pathfinding:** A* on a 2D walkable surface grid derived from voxel tops (step height 1). When terrain changes, re-path locally.
- **Construction is visible block by block.** Huts (≈5×5×4 prefab variants), fields, a well, a fire pit, then shrines, statues and marker-stones as beliefs demand.

### Lifecycle
- Children → adults → elders → death (old age, starvation, fire, lightning, flood).
- Couples form. Children are born when there's surplus food and housing.
- Death is shown non-graphically: the villager fades out and a small grave mound appears. Graves at sacred places matter for beliefs.

---

## 6. Miracles (the player's powers)

All miracles cost **Grace** (section 10). The player picks a miracle from the bar, sees a preview reticle (radius plus cost), and taps or clicks to cast. Some are drag-to-paint.

| Miracle | Cost | Effect | Notes |
|---|---|---|---|
| **Rain** | Low | Cloud over target area for a few seconds: waters crops, raises soil moisture, puts out fires | Drag to move the cloud while it lasts |
| **Lightning** | Medium | Strikes a voxel point: destroys a few voxels, may start fire, kills or injures anyone at the point | Has slight inaccuracy (small random offset) so "aiming at a tree and hitting the hill" can happen |
| **Shape Earth** | Medium, per use | Brush to raise or lower terrain voxels; nearby structures shake and may collapse | Big edits are dramatic omens. Edits nobody sees produce no omen. |
| **Bloom** | Low | Crops and trees in the area grow instantly, flowers appear | |
| **Dream** | High, rare (cooldown) | At night, target a sleeping villager and choose **3 symbols** from a palette of 12: water, fire, mountain, boat, child, sun, moon, bird, snake, hand, eye, house | The dreamer interprets the symbols through their traits and the existing beliefs (section 8). It's your most precise tool and still unreliable. |

Every miracle (and every natural weather event) creates an **Omen** (section 7).

**Design for more later** (don't build yet): Meteor, Flood, Send Animals, Wildfire.

---

## 7. Omens: recording what happened

When anything dramatic happens (a miracle or a natural event above a magnitude threshold), record an Omen:

```ts
interface Omen {
  id: string;
  tick: number;
  kind: OmenKind;               // 'rain' | 'lightning' | 'shapeEarth' | 'bloom' | 'dream' | natural variants
  isDivine: boolean;            // debug only, villagers never see this
  position: Vec3;
  radius: number;
  magnitude: number;            // 0..1, how dramatic it looked
  outcomes: Outcome[];          // per-entity effects: died, injured, cropsSaved, cropsDestroyed, hutDestroyed, fireStarted, landRaised...
  context: ContextFeature[];    // snapshot of what was going on
  witnesses: VillagerId[];      // saw it directly (range + line of sight + awake)
}

interface ContextFeature {
  key: string;        // 'activity:dance', 'place:eastHill', 'person:korrin', 'deed:theft', 'time:dawn', 'event:birth', 'condition:drought', 'object:newStatue'
  category: 'activity' | 'place' | 'person' | 'deed' | 'time' | 'event' | 'condition' | 'object';
  intensity: number;  // emotional weight 0..1 (a death > a theft > a meal)
  distance: number;   // from omen center
  recency: number;    // ticks since it happened (for deeds/events)
}
```

### Context snapshot sources
- **Activities** in progress near the omen (dancing, a funeral, building, farming, praying, a gathering)
- **Places:** named locations auto-generated from terrain and structures (the well, the east hill, the river bend, the chief's hut, the shrine, the split mountain)
- **People** present or affected, especially the priest, the chief, and anyone hurt or helped
- **Deeds** that happened recently nearby (a theft, a fight, a newborn's naming, an offering made or skipped)
- **Time and conditions:** dawn, dusk, night, full moon, drought, festival day, winter

Villagers log their own `OmenMemory` (a copy of the omen as *they* understood it, which can mutate; see section 12).

---

## 8. The interpretation engine (the heart of the game)

Write this as its own well-tested module: `src/sim/belief/`.

### Step 1: Valence
For each witness group, compute whether the omen **helped or harmed** them, from −1 to +1, based on outcomes (crops saved = positive, a hut burned = negative, a death = strongly negative). Different villagers can disagree. The thief's family and the robbed family see the same lightning differently.

### Step 2: Salience (what do they think caused it?)
Score every context feature:

```
salience = intensity
         × proximityFalloff(distance)
         × recencyFalloff(recency)
         × novelty(key)              // ever-present features ("the village") score low, rare ones high
         × categoryWeight[category]
         × priestBias(category, valence)
         + noise(seeded, small)
```

Track how often each feature key appears to compute novelty.

### Step 3: Attribution
- The top-scoring feature becomes the believed **cause** or **subject**.
- If the second feature is within ~15% of the top, it may form a second, weaker belief.
- Map (omen kind, valence, feature category) to a **belief type** (section 9). For example: positive omen + activity feature becomes RITUAL; negative omen + place feature becomes CURSED_PLACE; negative omen + deed feature becomes TABOO_ACT; positive omen + person becomes CHOSEN_ONE.
- If a matching belief already exists, **reinforce** it instead of creating a duplicate.

### Step 4: Belief record

```ts
interface Belief {
  id: string;
  type: BeliefType;
  subject: string;               // context key, e.g. 'activity:dance'
  response?: OmenKind | 'favor' | 'wrath';
  valence: number;               // -1..1, the god's believed attitude
  strength: number;              // 0..1, village-wide (weighted average of holders)
  holders: Map<VillagerId, number>;
  originOmenIds: string[];
  confirmations: number;
  contradictions: number;
  bornTick: number;
  isTradition: boolean;          // origin forgotten, no living witnesses
  scriptureRefs: string[];
}
```

### Step 5: Reinforcement and decay
- **Confirmation:** when a belief's condition happens again (they dance) and the believed response follows within a window (e.g. one in-game day), strength rises. Natural coincidences count.
- **Contradiction:** the condition happens and nothing follows, so strength falls, but **confirmation bias** applies: contradictions weigh ~0.3× as much as confirmations (tunable).
- **Explaining away:** the priest may absorb a contradiction ("we did not dance well enough"). The chance depends on priest personality.
- **Thresholds (tunable):** below 0.05 the belief dies. At 0.3 or more it **drives behavior**. At 0.6 or more it becomes **doctrine**: written into the Holy Book, built into structures, taught to children.
- Children inherit doctrine from their parents and the priest at reduced strength.
- Skeptics' personal strength decays faster. Devout villagers' decays slower.

### Priests
The village has one priest, chosen from devout adults and replaced on death by the most devout candidate (or a CHOSEN_ONE). The priest's **personality** biases interpretation for the whole village:

| Personality | Bias |
|---|---|
| **Fearful** | Harm readings ×1.5; prefers TABOO_ACT, CURSED_PLACE, OFFERING |
| **Ambitious** | Attributes positive omens to themselves or their family (CHOSEN_ONE); explains away freely |
| **Mystic** | Prefers DEPICTION and PORTENT; reads dreams generously |
| **Pragmatic** | Prefers RITUAL; lets failed beliefs decay faster; rarely explains away |

When a new priest takes over, they **re-read** existing doctrine through their own bias. Some beliefs strengthen, some fade, and the Holy Book gets a new chapter (section 13).

### Dreams
A dream's 3 symbols are interpreted by mapping each symbol to candidate meanings (e.g. *mountain* → place:ridge / place:eastHill / "go up" / "the god is stone"). The dreamer picks the meanings that best fit their traits and the beliefs they already hold, with noise. The result can create or reinforce beliefs and is **told to the village at the next gathering**, so it spreads as a rumor. A dream told by a CHOSEN_ONE or the priest carries more weight.

---

## 9. Belief catalog (initial 10 types)

Each type defines how it forms and **how it changes behavior**. Make this table data-driven so new types are easy to add.

| # | Type | Example | Behavior effects |
|---|---|---|---|
| 1 | **RITUAL** (do X → god does Y) | "Dance at the well brings rain" | Villagers perform X when they want Y (dance during drought). Strong rituals happen on a schedule (festivals). |
| 2 | **TABOO_ACT** | "The god punishes theft" / "Building on the hill angers the god" | Villagers avoid X. Those who do it are shunned (lower social standing). |
| 3 | **SACRED_PLACE** | "The crater lake is holy" | Build cairn → shrine → temple as strength grows. Pilgrimages. Bury the dead there. **Prefer to settle nearby.** |
| 4 | **CURSED_PLACE** | "The god hates the east hill" | Abandon structures there. Never farm, build or path through. Place marker-stones at the border. |
| 5 | **CHOSEN_ONE** | "The god favors Orra's family" | Raised status; likely chief or priest; their dreams and words count for more. Can be inherited by their children. |
| 6 | **OUTCAST** | "The god hates Korrin's line" / "…hates the red-cloaked" | Shunned. At high strength, exiled to live at the village edge or leave the island. |
| 7 | **OFFERING** | "The god must be fed" | Regular food offerings at the shrine drain food stores. If wrath follows anyway, offerings escalate (more food, then livestock and valuables). |
| 8 | **PORTENT** (X foretells Y) | "Lightning before the harvest means a bad winter" | Treat future X as a warning: hoard, panic, or prepare. The priest issues prophecies. |
| 9 | **DEPICTION** | "The god is a burning bird" | Accumulates form traits (body plan, element, features, color) that drive statues, totems and the god's name. |
| 10 | **TEMPERAMENT** | "The god is wrathful" / "kind" / "fickle" | Derived from the ratio of harmful to helpful omens. Shifts the village's love/fear balance and which belief types form more easily. |

Keep content non-graphic: exile, shunning and offerings of food, livestock and goods. No depicted violence beyond a villager fading out when killed by a miracle.

---

## 10. Faith and Grace

- Each villager has **faith** = love + fear (each 0..1, total capped at 1).
  - Helpful omens they witness raise **love**. Harmful omens raise **fear**.
  - Love-heavy villages hold more festivals and grow faster. Fear-heavy villages build more taboos and offerings, and grow slower.
- **Grace** (the god's power) regenerates at `base + k × Σ(faith)`. The Grace cap scales with the number of believers.
- **Unwitnessed miracles generate no faith.** Acting in secret is possible but builds nothing.
- If total faith collapses, the god **fades**. In Sandbox there is a minimum Grace floor so you can recover. In The Warning it's a loss condition.

---

## 11. Sacred geography and depictions

- **The land remembers.** Terrain you change keeps its shape and gets a **name** the villagers use in conversation and scripture ("the Split Mountain", "the Weeping Crater", "the Burned Hill").
- **Structures driven by beliefs:**
  - SACRED_PLACE builds up: cairn → shrine → temple (needs population and builders)
  - CURSED_PLACE: rings of marker-stones; abandoned huts slowly decay
  - Graves cluster at sacred sites
- **Statues of the god:** built block by block at the main shrine from the current DEPICTION traits:
  - body plan: humanoid / bird / serpent / sun-disc / many-armed
  - element accent: fire colors / water blues / stone grey / green growth
  - features: wings, extra eyes, horns, raised hand, etc.
  - When the depiction shifts enough, a **new statue** is built. Old statues stay as weathered ruins, so the world shows the history of how they imagined you.
- **The god's name** is generated from depiction traits and the most famous omen ("the Sky-Father", "the Burning Hand", "She-Who-Splits-Stone"). It can change across eras, and the Holy Book records the change.

---

## 12. Time, rumor and drift

### Time scale (all tunable)
- 1 in-game day ≈ 40 s at 1× (half the base rate of 10 ticks a second, for an unhurried pace; 4× and 16× are multiples of the base rate). A compressed calendar: 4 seasons × 3 days = 1 year ≈ 8 min at 1×.
- Lifespan ≈ 45 years. A generation ≈ 25 years.
- Speeds: **Pause, 1×, 4×, 16×.** Simulation must stay stable at 16×.
- Target: a full Warning run lasts **60–90 minutes** of real time across about 5 generations.

### Rumor
- At evening gatherings, villagers share omen memories with others.
- Each retelling can **mutate** the memory: magnitude grows (×1.1–1.4), a secondary context detail swaps with a plausible one (p ≈ 0.15), a place detail gets dropped (p ≈ 0.1). Gossips mutate more.
- Hearsay counts for ~0.5× the weight of a witnessed omen.

### Generational drift
- When nobody who witnessed a belief's origin is still alive, the belief becomes **tradition**. Its strength stabilizes, but its *reason* goes vague in scripture.
- **Myth compression:** at each priest succession, similar omens in the record merge ("three storms" → "the Great Storm"), numbers inflate, and side characters are forgotten or merged.

---

## 13. The Holy Book

The emotional payoff of the game. A panel the player can open any time.

- **Chapters by era**, named for the high priest: *"The Book of Orra"*, *"The Book of Tamuli"*.
- **Verses are generated when:** a belief reaches doctrine; a major omen happens (high magnitude or deaths); a priest dies or succeeds; a belief becomes tradition (the verse gets rewritten vaguer); the god's name changes.
- Written in an **archaic scripture voice** from a template grammar with slots. Make many templates per belief type and per event so it doesn't repeat. Examples of the tone:
  - *"In the Dry Moon the people danced at the well, and the Sky-Father heard, and wept upon the fields. So it is that we dance."*
  - *"Twice did the Burning Hand strike the eastern hill. Let no seed be sown there, nor any roof raised."*
  - *"Korrin took what was not his, and in the night his house was opened by fire. The god sees what is hidden."*
  - *(after drift)* *"It is written that the hill is forbidden. The reason is the god's alone."*
- **"Show the Truth" toggle (player-only):** annotates each verse with what actually happened (the real omen, whether it was divine or natural, what the god was really aiming at). This side-by-side view is the joke and the tragedy, so make it look good.
- Implement behind an interface `ScriptureWriter` with a `TemplateScriptureWriter`. Leave room for a future LLM-based writer, but **don't implement it and don't embed any API keys**.

---

## 14. Game modes

### Sandbox
No disaster, no loss condition except fading (with the Grace floor). Free play. Build this first; the core loop must be fun here.

### The Warning (main mode)
- At the start, the player sees a vision: **the sea will rise in 120 years** (tunable). The villagers never see this.
- A subtle, ominous **countdown** sits in the HUD.
- On disaster day, sea level rises over a few in-game days to a final height that floods the valley but **not the mountain ridge**.
- **Win:** at least X% (tunable, e.g. 40%) of the population survives above the waterline. **Loss:** below that, or faith collapses before the flood.
- Survival has to come from beliefs. For example: making the ridge a SACRED_PLACE so people settle there, cursing the valley floor so they abandon it, using dreams of *mountain + child + house*, raising land with Shape Earth. Nothing gets scripted: the player has to *teach* them.
- **End screen:** survival stats, a timeline of key omens and beliefs, and the final Holy Book with "Show the Truth" on.
- Design the disaster system so **volcano** and **comet** scenarios can be added later (each needs a different survival behavior). Only build the flood now.

---

## 15. Camera, controls and UI

### Camera
- Perspective with a narrow FOV (~30°) for a miniature look. Orbits the island center.
- Zoom limits (whole island down to close on a single hut). Pitch clamped between ~25° and 75°. Smooth damping.

### Controls
- **Desktop:** left-click = select villager / cast miracle; right-drag = rotate; middle-drag or WASD = pan; wheel = zoom; Esc = cancel miracle; Space = pause; 1–4 = speed.
- **Touch:** tap = select / cast; one-finger drag on terrain = pan (or paint, when a brush miracle is active); two-finger twist = rotate; pinch = zoom. A visible cancel button while a miracle is armed.

### HUD (plain DOM over canvas)
- Grace meter
- Miracle bar (icons, costs, cooldowns)
- Time controls plus calendar ("Year 34 · Spring")
- Population and average faith (love/fear split)
- **Village Beliefs** panel: active beliefs with strength bars, type icons, and a click-through to their origin omen and scripture verse
- **Villager inspector** (click a villager): name, age, role, traits, family, the omens they remember (as *they* remember them), the beliefs they hold with personal strength, and their view of the god (e.g. "fears the Burning Hand")
- Holy Book button
- Warning countdown (Warning mode only)
- Toasts for important moments ("A new belief has taken hold: *The east hill is cursed*")

### God's Eye debug overlay (toggle: F3, or a hidden triple-tap on touch)
- Salience table for the most recent omen: every context feature with its score breakdown and which one won
- Lines from the omen to each witness
- Belief strength history graph
- Sim stats: tick rate, entity counts, chunks re-meshed per frame, FPS
- Buttons to force natural weather events, spawn an omen, jump forward in time, and switch priest personality (for testing)

---

## 16. Art direction

- **Voxel diorama.** Think MagicaVoxel renders: soft, warm and tactile.
- Vertex colors with no textures. Per-voxel color jitter of about ±4% so surfaces aren't flat.
- **Per-vertex ambient occlusion** baked at mesh time.
- Lighting: hemisphere light plus a directional sun with soft shadows. A full day/night cycle with warm sunrises and sunsets, cool blue nights, and fire pits glowing after dark.
- **Tilt-shift depth of field** post-effect to sell the miniature, toggleable for performance. Subtle bloom on fire, lightning and miracles.
- Palette: warm and earthy with soft saturation. Seasons tint foliage (spring green → summer gold → autumn orange → winter pale).
- Floating island: cliffs underneath fade into soft clouds or sky.
- **Miracle VFX:**
  - Rain: a small voxel cloud with falling particles and darkening wet ground
  - Lightning: a jagged bright bolt, screen flash, small camera shake, scorch marks
  - Shape Earth: rumble, dust particles, voxels rising or sinking with a slight ease
  - Bloom: green sparkles and a visible growth burst
  - Dream: soft glowing symbols drifting above the sleeper, visible only to the player
- Water: a semi-transparent animated plane with a gentle shoreline.

### Performance targets
- 60 FPS on a mid-range laptop and a recent iPad at 1×, and smooth at 16×
- Draw calls kept low (chunk meshes plus instanced villagers plus a handful of effects)
- Terrain edits never cause a visible hitch (budgeted re-meshing)

---

## 17. Audio (later milestone, optional)

WebAudio: ambient wind, birds and water by time of day; distinct sounds for each miracle; murmuring at gatherings; chanting or drums when a ritual is performed; an ominous low drone that slowly builds as the Warning countdown nears zero.

---

## 18. Milestones and acceptance criteria

Stop after each one for my review.

**M0: Setup**
Vite + TS strict + Three.js + Vitest project, folder structure, seeded RNG, tuning file, git initialized, a blank scene renders.
*Accept:* `npm run dev` shows a scene; `npm test` runs.

**M1: The island**
Seeded terrain generation (valley, river, east hill, ridge, forest, beach, floating cliffs), chunked meshing with AO, camera and controls (mouse + touch), day/night, seasons tint, tilt-shift toggle.
*Accept:* looks like a diorama; 60 FPS; different seeds give different but always-valid islands.

**M2: The village lives**
Villagers with needs, utility AI, schedule, jobs, pathfinding, block-by-block construction, farming, natural weather, fire, lifecycle (births, aging, deaths), evening gatherings, villager inspector.
*Accept:* left alone at 16× for 30 minutes of real time, the village survives and grows without intervention.

**M3: Miracles**
Grace meter, miracle bar, all 5 miracles with VFX, Shape Earth brush, lightning inaccuracy, dream symbol picker.
*Accept:* every miracle has a visible effect on the world and on villagers, and costs and cooldowns work.

**M4: Omens and interpretation (the core)**
Omen recording, witnesses, context snapshots, valence, salience, attribution, belief store, reinforcement/decay with confirmation bias, priests and personalities, the 10 belief types with behavior effects, the Village Beliefs panel, and the God's Eye overlay.
*Accept (as headless Vitest scenario tests where possible):*
- Rain during a dance at the well, twice → a RITUAL(dance→rain) belief forms with strength ≥ 0.3, and villagers dance during the next drought.
- Lightning on a hut shortly after a theft → TABOO_ACT(theft) and/or OUTCAST(thief) forms.
- Two lightning strikes on the east hill → CURSED_PLACE(eastHill) forms, and nobody farms or builds there afterward.
- The same omen sequence with a Fearful priest vs a Pragmatic priest produces measurably different belief sets.
- Repeated contradictions weaken a belief, more slowly than confirmations strengthen it.
- Same seed plus same input log → identical belief state (determinism test).

**M5: Memory and myth**
Rumor spread with mutation, generational drift and traditions, myth compression at priest succession, sacred geography (named places, cairn → shrine → temple, marker-stones, graves), procedural god statues and ruins, god naming, the Holy Book with chapters and the "Show the Truth" toggle.
*Accept:* after about 3 generations in Sandbox, the Holy Book contains verses whose stated reasons have clearly drifted from the true omens, and the statues have changed at least once.

**M6: The Warning**
Mode select screen, opening vision, countdown, sea-level flood event, win/loss evaluation, end screen with timeline and final Holy Book.
*Accept:* a full run is completable in ~60–90 minutes; winning is possible only by actually steering beliefs toward high ground.

**M7: Polish**
Save/load to localStorage, a short guided first-omen tutorial (teaches the core idea without words where possible), audio, balancing pass, settings (graphics quality, tilt-shift, reduced motion).

---

## 19. Out of scope for now (design so these can be added later)

- Multiple villages, schisms and holy wars between sects
- Rival gods
- Full fluid simulation
- LLM-generated scripture
- Volcano and comet scenarios
- Multiplayer
