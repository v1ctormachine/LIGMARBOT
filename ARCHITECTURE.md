# AI Context: Ligmar Farming Bot Rebuilt

## Current active line

- Active script tree: `botscript/rebuilt_src/`
- Built userscript: `botscript/rebuilt_src/rebuilt_bot.user.js`
- Build script: `botscript/rebuilt_src/build.mjs`
- Current public test version: `1.4.3-beta`
- Current description: `Fix diagnostic clipboard recursion soften sustain HP-drop confirmation and add Archer Sniper Shot finisher`
- Runtime target: Tampermonkey userscript on `https://ligmar.io/game/`
- Language: vanilla JavaScript, one concatenated userscript IIFE.

This repo contains older planning docs/history, but **the current implementation to reason about is the rebuilt source under `rebuilt_src/modules/`**.

## Maintainer rules / workflow

1. Do not guess unclear game behavior. Ask for DOM/log samples when needed.
2. Before code changes, describe the proposed change list and wait for approval.
3. Every runtime code patch must be built with a version bump and visible description:
   ```bash
   cd botscript/rebuilt_src
   node build.mjs --desc "Patch description"
   ```
   For milestone/public labels, use:
   ```bash
   node build.mjs --setversion <version> --desc "..."
   ```
4. `build.mjs` regenerates:
   - `modules/05-version.js`
   - `modules/87-skill-master.generated.js`
   - `rebuilt_bot.user.js`
   - `loader.user.js`
   - `version.json`
5. Always run syntax validation after build:
   ```bash
   node --check rebuilt_bot.user.js
   ```
6. Patches should be surgical and should not break unrelated behavior.
7. If a bug is unclear, add temporary diagnostics or ask the user for DOM/log snippets. Remove temporary debug UI after resolution.

## Current module layout

Modules are concatenated alphabetically / numerically by `build.mjs`:

| Module | Role |
|---|---|
| `00-header.js` | Userscript metadata + IIFE start. Header version/description in final bundle is rewritten by `build.mjs`. |
| `05-version.js` | Auto-generated `BotVersion`. Do not edit manually. |
| `10-config.js` | Selectors, timings, combat modes, scan config, basement config, support buff config. Deep-frozen. |
| `15-logger.js` | Console logger, duplicate collapsing, ring buffer. |
| `20-runtime.js` | Mutable runtime state: autoFarm, exploration, basement, planner, hero, skills, enemy, vision, UI, preferences. |
| `30-utils.js` | Sleep, visibility, guarded click dispatch, canvas clicks, parsing helpers. |
| `40-state.js` | DOM readers: coords, tile popup, enemy count, HP/MP/target state. |
| `60-actions.js` | Action bar clicks, cooldown checks, basic attack, attackers popup raw actions. |
| `70-verify.js` | Wait utility, map open/center/zoom, click scanning 1-ring, Find Enemy verification, attackers popup targeting. |
| `80-map.js` | Tile scoring, movement, 2/3 ring offsets, pixel scans, lens state/detection, second-ring click scan. |
| `81-hero.js` | Hero stats reader. |
| `82-skills.js` | Skill/action-bar scanner and effect parser. |
| `85-combat.js` | Main AUTO loop, sustain/potions/run, buffs, basement state, combat/loot orchestration. |
| `86-planner.js` | Current simplified utility planner and queue manager. |
| `87-skill-master.generated.js` | Auto-generated skill DB index. |
| `90-ui.js` | Floating GUI panel; collapsible; no test button. |
| `99-bootstrap.js` | Starts bot, exposes `window.ligmarBot` API. |

## Current high-level runtime loop

`startAutoFarmLoop()`:

1. Reset AUTO session state.
2. Read hero stats.
3. Scan action bar skills.
4. Ensure map open and centered.
5. Zoom out.
6. Detect lens state unless overridden.
7. Loop:
   - Wait until not moving.
   - Run global sustain and travel HP/MP gate.
   - Maintain longbuffs out of combat.
   - Ensure map open, center, settle.
   - Click-scan 1-ring.
   - Choose movement target using lens-aware ring logic.
   - Secure selected tile: prebuff, move, target, combat, loot.
   - Stop safely on `holdPosition` failures.

## Current public API highlights

Available as `window.ligmarBot`:

- Version/config/runtime/logs:
  - `version`, `Config`, `Runtime`, `Logger`
- UI:
  - `createControlPanel()`, `destroyControlPanel()`
  - `setControlPanelCollapsed(bool)`, `isControlPanelCollapsed()`
- AUTO:
  - `startAutoFarmLoop()`, `stopAutoFarmLoop()`
  - `getBotStatus()`, `setBotStatus()`
- Preferences:
  - `setCombatMode("easy"|"normal"|"hard")`
  - `setAvoidChampions(bool)`
  - `setBasementFarmingEnabled(bool)`
  - `getBotPreferences()`
- Map/scanning:
  - `ensureMapOpen()`, `ensureMapCentered()`, `ensureMapZoomedOut()`
  - `scanNeighborRing()`, `scanSecondRingClickable()`, `scanSecondRingForDie()`, `scanThirdRingForColor()`
  - `ringHasUsefulLoot()`, `chooseStepTowardRingTarget()`
  - `detectLensState()`, `getLensState()`, `setLensStateOverride(bool|null)`
- Skills/planner:
  - `scanSkills()`, `parseSkillEffects()`, `plannerSeqNormalizeOneSkill()`, `plannerCalculateSkillUtility()`, `plannerPickSkillOpeningPick()`
- Sustain/run:
  - `runGlobalSustainCheck()`, `waitForTravelResourcesForCurrentMode()`
  - `getPotionSlotState()`, `isPotionSlotReady()`, `waitForPotionSlotUnavailable()`
  - `detectRunButton()`, `clickRunButton()`, `isRunningStateActive()`, `maybeTriggerEmergencyRun()`
- Basement:
  - `getBasementState()`, `basementSetPhase()`, `markBasementEntered()`, `markBasementExited()`
  - `detectBasementPortalActionButton()`, `detectBasementEntryButton()`, `detectBasementExitButton()`
  - `isBasementPortalTile()`, `isBasementEndCandidateTile()`
  - `addBasementVisitedTile()`, `isBasementTileVisited()`, `getBasementVisitedTiles()`
- Combat/AoE cancel:
  - `detectActiveAoeCast()`, `detectPressToCancelElement()`, `cancelActiveAoeCastIfNeeded()`
  - `clearCombatQueueAfterAoeCancel()`

## Important current behavior notes

### GUI

- GUI auto-mounts by default.
- GUI is collapsible via header button.
- START/STOP is a single toggle button.
- Diagnostic/test button and `runDiagnosticTestSuite()` were removed.

### Combat modes

`Runtime.preferences.combatMode` controls HP/MP travel/sustain thresholds:

- `easy`: 70% HP/MP
- `normal`: 80% HP/MP
- `hard`: 90% HP/MP

Before moving to the next tile, the bot blocks until HP and MP are at least the current mode thresholds.

### Potions

HP/MP potions are detected from action-bar item icons (`potion-health`, `potion-mana`, etc.). Potion availability is now determined from the real action-bar button state, not internal timers. A potion use is considered confirmed only when the button becomes disabled/on cooldown.

### Emergency run

- If HP <= 33%, health amulet/totem is in cooldown, and Run button is ready, bot clicks Run.
- The bot does **not** click the totem.
- During running, bot uses potions only; no skills.
- Running state is verified primarily from Run button disabled/cooldown state.
- The bot waits until HP >= 80% or running ends/interrupts.

### Buffs

- Short prebuffs run before moving onto enemy tiles.
- Before prebuffing, the bot closes coord popup.
- Each prebuff waits for the exact clicked button to show `span.skill-cooldown` before the next buff.
- Longbuffs are OOC-only, duration-tracked, and refreshed near expiry.

### Loot settle

Loot/activation settle uses progressbar visibility, not stale hidden text. It waits until:

- loot button done/hidden (or allowed portal button condition), and
- progressbar not visible, and
- stable for 1800 ms.

Timeout is 18000 ms.

### Movement verification

- The bot click-scans target tile before moving; `target.coords` from scan is the primary expected destination.
- After moving, the bot recenters and opens current tile popup to read actual coords.
- If actual coords mismatch target coords, movement fails with `holdPosition`; `secureTileAndLootOnce` may retry once for coord mismatch.

### Lens-aware exploration

On AUTO start, bot opens/centers map, zooms out, and probes 2-ring clickability to detect lens.

Exploration policy:

- No lens:
  - click-scan 1-ring
  - if no useful loot, pixel-scan 2-ring yellow die
  - move one first-ring step toward 2-ring die
- Lens equipped:
  - click-scan 1-ring
  - if no useful loot, click-scan 2-ring
  - if no useful 2-ring target, pixel-scan 3-ring yellow die
  - move one first-ring step toward 3-ring die

### Basement farming current baseline

- If Basement Farming OFF, basement entry button is suppressed and basement portal tiles are ignored.
- Basement entry is detected via the highlighted portal-action icon button, not coord popup tile name.
- Inside basement, every coord popup may say `Basement`; this is **not** portal evidence.
- After entering basement, phase becomes `exploring`, entrance/visited tiles are tracked, and champion/end tiles are allowed despite Avoid Champions.
- During `exploring`, non-end loot/action buttons are suppressed.
- End tile is currently detected as a basement tile with champion/boss marker in `lootIcons`.
- After clearing end candidate, bot loots knowledge, then primarily clicks the visible `Exiting` button. If missing, it falls back to current-tile portal action. If still missing, it stops safely.
- No backtracking-to-exit logic yet; missing exit means safe stop.

### Current planner policy

Current planner is simple utility-based, not the large sequence planner described in old docs.

- AoE = skill has `Close` tag.
- Target reset = skill has `Attack` tag and description contains both `target` and `reset`.
- Under pressure = HP < 66%.
- Survival pressure boosts target-reset/stuns.
- AoE bonus applies when attackersCount > 1, except safe fresh opener.
- Fresh target opener flag is set after successful Find Enemy/attackers retarget.
- Fresh target + HP safe strongly favors DoT opener (`+5000`) and suppresses AoE bonus.
- Finisher urgency remains large and intentionally preserved.
- AoE casts after target death are canceled by clicking visible `Press to cancel`, then queue state is cleared.
- Post-attackers-retarget queue policy queues exactly one skill onto the game’s auto-basic Attack, then waits for Attack text to change before normal queue resumes. If no Attack appears (no-basic class), normal queue resumes.

## Known open issues / next likely work

- Verify the post-retarget queue lock in live multi-mob fights.
- Tune planner if DoT opener or AoE priority still does not behave as intended.
- Improve basement return/backtracking if Exiting is not immediately visible after knowledge.
- Further reduce duplicate opener clicks if cast-bar latch timing still causes repeated opener logs.
- Lens detection can be manually overridden with `setLensStateOverride()` if probe is wrong.


## 1.4.2-beta changes
- GUI/API preferences added: `useShortBuffs`, `useLongBuffs`, and `useCombatBuffs`, all default ON. Public setters: `setUseShortBuffs()`, `setUseLongBuffs()`, `setUseCombatBuffs()`.
- Short pre-move buffs, OOC longbuff maintenance, and immediate combat buffs now respect those toggles without changing skill classification.
- Champion red dice pixel pathing added for second/third ring fallback only when `Avoid Champions` is OFF. Yellow dice fallback remains.
- Travel/sustain gates now watch for meaningful HP drops; on drop, bot assumes incoming attacks, closes stale popup, tries attacker/Find Enemy targeting, and runs combat/planner until threats clear or lock fails.


## 1.4.3-beta changes
- Diagnostic reports no longer recursively spam `unhandled_rejection` when clipboard auto-copy fails; unhandled-rejection reports skip auto-copy and are throttled.
- Sustain HP-drop interrupt now requires combat evidence (`attackersCount > 0`, `enemyCount > 0`, or live target HP) before switching/stopping; HP drop without evidence logs and continues sustain.
- Archer Sniper Shot finisher added by skill presence: if target HP is below `0.8 * hero average physical damage`, cancel current cast, wait progressbar hidden, click Sniper Shot, release/cancel after 150ms, then Basic Attack if target survives and basic exists.
