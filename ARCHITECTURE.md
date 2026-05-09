# Ligmar.io Farming Bot Architecture

## Project Context

- Runtime: Tampermonkey userscript on `ligmar.io/game/`
- Language: JavaScript
- Inputs:
  - DOM state (`HP`, `MP`, enemy panel, enemy counter, action buttons, progress bars, ping, death screen)
  - Canvas pixels (map tiles, loot icons)
- Outputs:
  - Left-click actions only (single/double click on map tiles, UI buttons, skill buttons, loot button)

Primary behavior target:

1. Center map
2. Scan 2-tile radius
3. Detect and prioritize loot points of interest
4. Plan path and move tile-by-tile
5. Secure tile (clear enemies)
6. Loot
7. Repeat

---

## High-Level Design

The bot uses a **sense -> decide -> act -> verify** loop:

- **Sense**: Build a reliable snapshot of current game state from DOM + canvas.
- **Decide**: Choose the safest next objective (fight, wait/heal, move, loot).
- **Act**: Execute one atomic action (press button, double-click tile, cast skill).
- **Verify**: Confirm expected state change with timeout/retry logic that tolerates latency.

Design principles:

- Safety-first over speed (HP gate, boss avoidance, combat/loot validation)
- Single source of truth state store
- Small independent modules with strict contracts
- Every action observable via debug logs + overlay
- Recoverable from transient failures (missed click, stale DOM, delayed updates)

### Current mono-script cycle (`bot/bot.user.js`)

- **Start of each farm cycle**: `prepMapForCombatCycle()` only ensures the map is open (`ensureMapOpen`). There is no tactical ring scan here; neighbor scanning is **`scanNeighborRing()`** inside **`exploreByScan()`** after idle/no-loot.
- **Find enemy verification**: success when **target HP** becomes valid (red condition bar text parsed as `cur / max`); enemy count is **not** used as a pre-attack signal. HP strings may include **thousands separators** (e.g. `1,399 / 1,399`); `parseFractionText` normalizes commas before parsing so verification is not stuck at `valid: false` while the bar is visible.
- **Loot, when a loot button exists**: click loot → **`ensureMapOpen()`** → **`clickCenterMapVerified()`** → click **current map center tile** → wait until **`div.battle-event-button.highlight` stays absent** and the visible **`app-battle-status-bar span.value`** text is **not** a known busy label (`opening`, `activating`; extend via `Config.verification.lootInteractionBusySubstrings`) for a **stable window** (`Config.verification.lootSettleStableMs`, default ~400ms). This avoids treating post-click DOM flicker or mid-animation gaps as “done”.
- **Movement gate**: actions that depend on a settled position wait until the moving-state UI bar (`Config.selectors.movingBarValue`) clears, so scan/ring code never sees mid-step state.

### Repository layout

- Git repo lives at the **project root** (`C:\Users\Victor\.cursor\projects\ligmarbot`).
- Tracked files: `.gitignore`, `ARCHITECTURE.md`, `bot/bot.user.js`, `bot/zoom-tester.user.js`.
- `.gitignore` excludes Cursor tooling artifacts (`mcps/`, `terminals/`, `agent-transcripts/`) and editor scratch files. They live on disk for the IDE but never reach GitHub.

### Companion test scripts

- **`bot/zoom-tester.user.js`** (currently a **scan calibrator**) — standalone Tampermonkey userscript installed alongside the bot. After the wheel-zoom investigation succeeded, this script was stripped down to a focused calibration tool:
  - **`MAX ZOOM OUT`** button — fires 40× wheel-out events (`deltaY=120`) at the canvas center to lock the map at minimum zoom, the bot's intended scanning condition.
  - **`scan step (px)` slider + number input** (range 10–200, default 45) — represents `Config.movement.neighborStepPx` exactly, so what's drawn on screen matches what `scanNeighborRing()` will click.
  - **SVG overlay** (`pointer-events: none`, full viewport) — draws a yellow crosshair at the canvas center plus six cyan dots/lines at the hex offsets `TR (+s/2,-h)`, `R (+s,0)`, `BR (+s/2,+h)`, `BL (-s/2,+h)`, `L (-s,0)`, `TL (-s/2,-h)` where `h = round(s * 0.86)`. Direction labels are drawn next to each dot. Refreshed via `requestAnimationFrame` plus `resize`/`scroll` listeners so the markers track the canvas during reflows.
  - **Console API:** `window.zoomTest.zoomOutMax()`, `.setStep(n)`, `.getStep()`, `.refreshOverlay()`.
  - Independent of the bot — installable/removable at any time without touching `bot/bot.user.js`.
- **Calibration workflow:** click `MAX ZOOM OUT` → drag the slider until the six cyan dots sit on the centers of the six neighboring hex tiles → record the resulting step value. That number becomes the new `Config.movement.neighborStepPx`.
- **Note on detection:** earlier versions of the tester tried to confirm zoom programmatically via canvas pixel-hash diffing. That code was removed once wheel-zoom was visually confirmed to work; the calibrator trusts the user's eye.

### Investigations (state of the art so far)

- ✅ **Wheel events on the map canvas zoom the camera** (visually confirmed). Means a Tampermonkey-only bot can drive zoom without external automation. Calibration of "step power" (deltaY per scroll) is in progress via the zoom tester.
- ❓ **Ctrl+Wheel / Keyboard `+` / `-` / `=`**: not yet observed to do anything. Treat as not-supported until proven otherwise.
- ❌ **No first-party in-game zoom UI buttons** were located by the auto-finder; expect to drive zoom via wheel only.
- 🟡 **Ancestor `transform: matrix(1.16, ...)` on `div.app-container.*`**: a global Angular/UI scaling, **not** the game zoom. Don't use it to infer zoom level.

---

## Core Modules

## 1) Config Module

Purpose: Keep all tweakable values and selectors in one place.

Responsibilities:

- Store CSS selectors for health/mana/enemy/progress/action UI
- Store timing values (poll interval, action cooldown, retry windows)
- Store safety thresholds:
  - `MIN_HP_TO_MOVE = 0.85`
  - potion decision rules
  - boss avoidance rules
- Store loot ranking table (to be filled once ranking is provided)

Exports:

- `Config.selectors`
- `Config.thresholds`
- `Config.timers`
- `Config.lootPriority`

---

## 2) State Module

Purpose: Gather, normalize, and timestamp all game state.

Responsibilities:

- Parse player HP/MP (`current/max`, `%`)
- Parse target/enemy HP when target exists
- Parse enemy count in current tile/encounter flow
- Detect visibility and readiness of action buttons (`find enemy`, `loot`, skills, `RUN`, etc.)
- Detect active progress bars (`finding enemy`, `looting`, casts if exposed)
- Detect run-state URL (`/game/`) and death/disconnect indicators
- Sample ping and connection warnings
- Provide tile/canvas detection outputs from MapScanner (loot candidates, blocked tiles)

State snapshot shape (example):

```js
{
  time: 1715000000000,
  session: { inGame: true, dead: false, poorConnection: false, pingMs: 180 },
  player: { hp: { cur: 600, max: 640, pct: 0.9375 }, mp: { cur: 120, max: 150, pct: 0.8 } },
  combat: { enemyCount: 2, inCombat: true, targetHpPct: 0.55, findingInProgress: false },
  actions: { canLoot: false, canFindEnemy: true, runReady: true },
  world: {
    nearbyTiles: [],
    lootCandidates: [],
    blockedTiles: []
  }
}
```

Rules:

- Never return partial malformed state; if read fails, set explicit `unknown` flags.
- Each field includes `lastUpdated` when needed for stale-read detection.

---

## 3) UIAdapter Module

Purpose: Safe wrappers for DOM/canvas interaction.

Responsibilities:

- Query DOM elements by selector with null guards
- Parse text values (`123/200`, counters, timers)
- Click helpers:
  - `clickButton(name)`
  - `doubleClickCanvasTile(tile)`
- Action verification helpers:
  - wait until progress bar appears/disappears
  - wait until enemy count changes
  - wait until HP/MP changed after potion/skill use
- Unified retry strategy with jitter

Why separate:

- If selectors change, updates stay localized
- Prevents business logic from manipulating raw DOM directly

---

## 4) MapScanner Module (Canvas Perception)

Purpose: Convert canvas pixels into actionable local map info.

Responsibilities:

- Determine local 2-tile neighborhood around player center
- Classify visible tiles:
  - walkable
  - blocked/wall
  - unknown
- Detect loot icons by color/pattern:
  - yellow die (unknown loot, 2 tiles)
  - purple/blue/grey chest
  - yellow altar
  - brown wheel
  - green goblin head (mini-boss marker -> avoid pathing there)
- Emit confidence score per detection

Outputs:

- `TileGraph` for local movement planning
- `lootCandidates[]` with `tile`, `type`, `priority`, `confidence`

Notes:

- Initially bootstrap with deterministic pixel probes for known UI scale.
- Later expand to pattern matching to survive minor rendering variance.

---

## 5) Movement Module

Purpose: Move exactly one tile at a time with verification and safety checks.

Responsibilities:

- Build legal neighbors (max 6 hex directions, minus blocked/unclickable)
- Choose next step from path planner
- Execute movement via map tile double-click
- Confirm movement completion before next command
- Handle movement cancellation conditions:
  - HP below move threshold
  - combat unexpectedly started
  - connection warning/death

Public API:

- `moveToTile(targetTile)`
- `stepToward(targetTile)`
- `isMoveSafe(state)`

Safety rule:

- Never initiate move unless `hpPct >= 0.85`.

---

## 6) Combat Module

Purpose: Secure tile before looting or onward movement.

Responsibilities:

- Enter engagement flow:
  1. if enemies present but no active target, click `find enemy`
  2. wait for finding progress complete
  3. attack with selected rotation
- Skill/potion usage policy with cooldown and mana checks
- Track combat lifecycle by enemy counter and target HP
- Exit only when `enemyCount == 0`
- Avoid bosses (skip/retreat strategy when boss indicators are detected)

Subcomponents:

- `TargetingPolicy`
- `SkillRotation`
- `PotionManager`

Resource policy baseline:

- HP should trend to full with intelligent potion timing
- Pre-move gate remains strict at `>=85%`
- Avoid over-heal waste by triggering regen effects based on missing-HP window

---

## 7) Loot Module

Purpose: Ensure safe and efficient loot collection.

Responsibilities:

- Evaluate nearby loot candidates and rank by priority table
- Confirm tile secured (`enemyCount == 0`) before looting
- Click `loot` button when available
- Wait for loot progress bar completion
- Confirm loot action resolved (button hidden/disabled or state changed)

Public API:

- `selectNextLootTarget(candidates, state)`
- `lootCurrentTile()`

Hard constraint:

- Never loot while enemies remain on tile.

---

## 8) Pathing Module

Purpose: Pick best route to chosen objective inside currently known local graph.

Responsibilities:

- Build graph from 2-tile scan and incremental discoveries
- Score path by:
  - objective priority (loot rank)
  - distance (step count)
  - risk (boss markers, low HP state, uncertain tiles)
- Replan on each step or when map state changes

Approach:

- Start with weighted BFS/A* on local hex graph
- Keep it deterministic and transparent in logs

---

## 9) Safety Module

Purpose: Cross-cutting kill-switch and guardrails.

Responsibilities:

- Global pause/stop hotkey handling
- Stop all actions on death screen or not-in-game URL
- Pause/slow actions on poor connection if needed
- Enforce cooldown between critical clicks to avoid accidental misfires
- Validate each action preconditions

RUN mechanic handling:

- RUN can be modeled as a **defensive idle mode**:
  - enable RUN while waiting (healing, scanning, decision idle)
  - auto-disable naturally when moving/attacking (expected)
  - re-enable when returning to idle and off cooldown
- If RUN produces no measurable survival gain, keep feature toggle-able in config.

---

## 10) Main Loop Orchestrator

Purpose: Central coordinator and state machine.

States:

- `BOOT`
- `IDLE_SCAN`
- `PLAN`
- `MOVE`
- `SECURE_TILE`
- `LOOT`
- `RECOVER`
- `PAUSED`
- `HALT`

Loop pseudocode:

```js
while (botEnabled) {
  state = State.readSnapshot();
  Safety.assertGlobalGuards(state);

  switch (fsm.current) {
    case "BOOT": ...
    case "IDLE_SCAN": ...
    case "PLAN": ...
    case "MOVE": ...
    case "SECURE_TILE": ...
    case "LOOT": ...
    case "RECOVER": ...
  }

  Overlay.render(state, fsm, lastAction, nextAction);
  sleep(Config.timers.mainTickMs);
}
```

---

## 11) GUI Module (Control Panel)

Purpose: User control in-page without editing script.

Controls:

- Start / Pause / Stop
- Toggle auto-center map
- Toggle boss avoidance strictness
- Toggle RUN usage
- Potion policy profile selector
- Main status indicators (current state, hp%, enemy count, target objective)

Behavior:

- GUI actions update in-memory config safely
- Persist preferences via `localStorage`

---

## 12) Debug Overlay Module

Purpose: Real-time observability while bot runs.

Display:

- FSM state + next action
- HP/MP current/max/%
- Enemy count, target HP%
- Ping and connection warnings
- Current objective tile + path length
- Last 10 actions with result (`ok`, `retry`, `fail`)

Log policy:

- Structured `console.log` events with module prefix:
  - `[STATE]`, `[MOVE]`, `[COMBAT]`, `[LOOT]`, `[SAFETY]`, `[FSM]`

---

## Module Communication

Communication pattern:

- `State` is read-only source of truth for current tick.
- Decision modules (`Pathing`, `Combat`, `Loot`, `Safety`) consume snapshot and return intents.
- `MainLoop` arbitrates intents and calls action modules via `UIAdapter`.
- Action results feed back into next snapshot.

Data flow:

1. `State.readSnapshot()`
2. `MapScanner.scanCanvas()` -> enrich `state.world`
3. `Safety.checks(state)` -> allow/deny
4. `Planner` chooses objective and next atomic action
5. `UIAdapter` executes action
6. `Verifier` confirms result or retries/fails
7. `Overlay + Logger` publish trace
8. Next tick

---

## Error Handling and Latency Strategy

- Use short polling windows (100-250ms) with hard timeouts per action.
- Any action must declare:
  - preconditions
  - expected confirmation signal
  - timeout
  - fallback (retry, re-scan, pause)
- If confirmation fails N times:
  - trigger `RECOVER` state
  - re-center map
  - force full rescan
  - if still failing, pause bot and alert via GUI

---

## Security / Anti-Detection Posture

Current assumption: no anti-bot defenses observed.

Still recommended:

- Keep click cadence human-like (small randomized delay bounds)
- Avoid zero-delay infinite loops
- Log and cap repeated identical actions

---

## Suggested Folder Structure

```text
src/
  bot.user.js              // Tampermonkey entry
  config.js
  core/
    state.js
    fsm.js
    orchestrator.js
  adapters/
    uiAdapter.js
    domReader.js
    canvasReader.js
  modules/
    mapScanner.js
    pathing.js
    movement.js
    combat.js
    loot.js
    safety.js
  ui/
    controlPanel.js
    debugOverlay.js
  utils/
    logger.js
    time.js
    retry.js
```

---

## Step-by-Step Development Roadmap (Tiny, Testable Milestones)

Each milestone should end with a manual test and visible success criteria.

### Phase 0 - Foundation

1. **Milestone 0.1 - Script bootstrap**
   - Inject Tampermonkey script only on `ligmar.io/game/`.
   - Test: console prints `bot loaded` only on game page.

2. **Milestone 0.2 - Selector probe utility**
   - Build helper that checks presence of required DOM elements.
   - Test: console table of selector availability.

3. **Milestone 0.3 - Structured logger**
   - Add module-prefixed log function.
   - Test: logs render consistently with timestamps.

### Phase 1 - Read State Reliably

4. **Milestone 1.1 - Read HP**
   - Parse `current/max` and `%`.
   - Test: log HP every 500ms and verify during damage/heal.

5. **Milestone 1.2 - Read MP**
   - Same parsing for mana bar.
   - Test: MP changes while casting skills.

6. **Milestone 1.3 - Read enemy counter and target HP**
   - Parse both signals from UI.
   - Test: enter/exit fight and verify transitions.

7. **Milestone 1.4 - Read progress bars**
   - Detect active `finding`/`loot` progress.
   - Test: trigger both actions manually and observe detection.

8. **Milestone 1.5 - Session safety reads**
   - Detect `/game/`, death screen, poor connection, ping.
   - Test: simulated navigation/death case handling.

### Phase 2 - Execute Atomic Actions

9. **Milestone 2.1 - Safe button click wrapper**
   - Click named UI buttons with null checks and logs.
   - Test: click `find enemy` via script once.

10. **Milestone 2.2 - Canvas double-click helper**
    - Double-click given tile coordinates.
    - Test: move exactly one tile to chosen neighbor.

11. **Milestone 2.3 - Action verification framework**
    - Add wait-for-condition with timeout/retry.
    - Test: verify move success and button click effects.

### Phase 3 - Map Perception

12. **Milestone 3.1 - Map center action**
    - Click center-map button.
    - Test: player recentered consistently.

13. **Milestone 3.2 - 1-tile ring extraction**
    - Identify six neighbor tiles around player center.
    - Test: overlay marks neighbors correctly.

14. **Milestone 3.3 - 2-tile scan**
    - Expand to two-step neighborhood.
    - Test: overlay renders scanned tile set.

15. **Milestone 3.4 - Loot icon detection (yellow die first)**
    - Detect unknown loot marker.
    - Test: alert when die icon is present.

16. **Milestone 3.5 - Loot type classification**
    - Distinguish chest/altar/wheel/goblin icons.
    - Test: logs show detected type and confidence.

### Phase 4 - Minimal FSM Loop

17. **Milestone 4.1 - FSM skeleton**
    - Implement `BOOT -> IDLE_SCAN -> PLAN`.
    - Test: state transitions visible in logs.

18. **Milestone 4.2 - Choose nearest loot target**
    - Plan objective from scan candidates.
    - Test: selected target printed with score.

19. **Milestone 4.3 - Single-step movement plan**
    - Compute next step only.
    - Test: bot steps toward target once, then stops.

### Phase 5 - Combat Securing

20. **Milestone 5.1 - Combat entry routine**
    - If enemy count > 0, run find-enemy -> attack.
    - Test: routine starts fight reliably.

21. **Milestone 5.2 - Basic attack loop**
    - Continue until enemy count becomes 0.
    - Test: bot clears one tile encounter.

22. **Milestone 5.3 - Boss avoidance guard**
    - Skip tiles marked as boss/miniboss.
    - Test: planner refuses boss-marked objective.

### Phase 6 - Loot Routine

23. **Milestone 6.1 - Loot precondition guard**
    - Enforce `enemyCount == 0` before looting.
    - Test: no loot click while enemies remain.

24. **Milestone 6.2 - Loot action with verification**
    - Click loot and wait for progress completion.
    - Test: successful loot cycle logged.

25. **Milestone 6.3 - Integrate secure->loot chain**
    - `MOVE -> SECURE_TILE -> LOOT`.
    - Test: complete one full objective cycle.

### Phase 7 - Safety and Resource Intelligence

26. **Milestone 7.1 - HP move gate**
    - Block movement under 85% HP.
    - Test: bot waits and resumes after recovery.

27. **Milestone 7.2 - Potion manager v1**
    - Trigger potion by missing-HP window logic.
    - Test: potion used only when efficient.

28. **Milestone 7.3 - RUN defensive idle**
    - Enable RUN during waits if off cooldown.
    - Test: RUN toggles in idle and drops on action.

29. **Milestone 7.4 - Recover state**
    - Add fallback on repeated failed actions.
    - Test: force a failure and verify re-scan/pause behavior.

### Phase 8 - UX Layer

30. **Milestone 8.1 - GUI panel**
    - Start/Pause/Stop + key toggles.
    - Test: controls alter bot behavior live.

31. **Milestone 8.2 - Debug overlay**
    - Render current state/action/path info.
    - Test: overlay updates each tick.

32. **Milestone 8.3 - Preference persistence**
    - Save GUI settings to `localStorage`.
    - Test: reload page and verify settings restored.

### Phase 9 - Stabilization

33. **Milestone 9.1 - Long-run dry test (30 min)**
    - Observe loops, stalls, retries.
    - Test: no hard lock; manageable warning count.

34. **Milestone 9.2 - Long-run active farm (2-4 hrs)**
    - Track loot cycles/hour, failures/hour.
    - Test: stable performance and safe recovery.

35. **Milestone 9.3 - Tune thresholds**
    - Adjust potion and timing config from real metrics.
    - Test: better uptime with fewer wasted consumables.

---

## Open Inputs Needed from You

To finalize behavior quality, next details are required:

1. Loot priority ranking (highest -> lowest) for each icon/type
2. Exact selectors or screenshots for:
   - HP/MP text nodes
   - enemy counter
   - find enemy button
   - loot button
   - center map button
3. Preferred first combat rotation (basic + skill priorities)
4. Confirm whether synthetic DOM clicks currently work, or if fallback input method is needed

