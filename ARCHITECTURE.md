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

### Current bot cycle (built from `bot/modules/*.js` into `bot/bot.user.js`)

- **Start of each farm cycle**: `prepMapForCombatCycle()` only ensures the map is open (`ensureMapOpen`). There is no tactical ring scan here; neighbor scanning is **`scanNeighborRing()`** inside **`exploreByScan()`** after idle/no-loot.
- **Find enemy verification**: success when **target HP** becomes valid (red condition bar text parsed as `cur / max`); enemy count is **not** used as a pre-attack signal. HP strings may include **thousands separators** (e.g. `1,399 / 1,399`); `parseFractionText` normalizes commas before parsing so verification is not stuck at `valid: false` while the bar is visible.
- **Loot, when a loot button exists**: click loot → **`ensureMapOpen()`** → **`clickCenterMapVerified()`** → click **current map center tile** → wait until **`div.battle-event-button.highlight` stays absent** and the visible **`app-battle-status-bar span.value`** text is **not** a known busy label (`opening`, `activating`; extend via `Config.verification.lootInteractionBusySubstrings`) for a **stable window** (`Config.verification.lootSettleStableMs`, default ~400ms). This avoids treating post-click DOM flicker or mid-animation gaps as “done”.
- **Movement gate**: actions that depend on a settled position wait until the moving-state UI bar (`Config.selectors.movingBarValue`) clears, so scan/ring code never sees mid-step state.
- **Zoom gate before scanning**: `scanNeighborRing()` calls **`ensureMapZoomedOut()`** right after `ensureMapOpen()` succeeds. The helper dispatches `Config.movement.maxZoomOutBursts` (40) synthetic `WheelEvent`s with `deltaY=120` at the canvas center the **first time only** per session; the result is recorded in `Runtime.zoom.maxedOut`. This locks the map at minimum zoom so `Config.movement.neighborStepPx` (currently **30 px**, vertical `h = round(30 * 0.86) = 26 px`) lands on real tile centers. `forceZoomOut()` clears the flag and re-applies — useful after death or page reload.

### Repository layout

- Git repo lives at the **project root** (`C:\Users\Victor\.cursor\projects\ligmarbot`).
- Tracked files: `.gitignore`, `ARCHITECTURE.md`, `bot/build.ps1`, `bot/loader.user.js`, `bot/version.json`, `bot/bot.user.js`, `bot/modules/*.js`.
- `bot/bot.user.js`, `bot/modules/05-version.js`, `bot/loader.user.js` (`@version` line), and `bot/version.json` are **build artifacts**. **Do not hand-edit them.** They are regenerated from `bot/modules/*.js` and the version state by `bot/build.ps1`.
- `.gitignore` excludes Cursor tooling artifacts (`mcps/`, `terminals/`, `agent-transcripts/`) and editor scratch files. They live on disk for the IDE but never reach GitHub.

### Source modules and build pipeline

The bot lives as **one IIFE in many files**. Modules under `bot/modules/` are concatenated by `bot/build.ps1` (filename-prefix order) into a single `bot/bot.user.js`. Tampermonkey loads it via a tiny loader stub (`bot/loader.user.js`) that does `@require file:///…/bot/bot.user.js`. There is no module loader at runtime — every file's body executes inside a single `(function () { "use strict"; ... })();` closure, so all helpers and `const` declarations share one scope.

Filename order is the **only** thing that controls concat order. Numeric prefixes are kept in reserved blocks so new modules can slot in without renaming neighbors:

| File                   | Role                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `00-header.js`         | Tampermonkey `==UserScript==` header + IIFE open + auto-generated banner.                  |
| `05-version.js`        | **AUTO-GENERATED.** `const BotVersion = { version, description, builtAt }`. Written by `build.ps1` on every build. |
| `10-config.js`         | `Config` (selectors, timings, thresholds).                                                 |
| `15-logger.js`         | `Logger` (timestamped, module-tagged `console.log/warn/error`).                            |
| `20-runtime.js`        | `Runtime` (mutable state: autoFarm, exploration, zoom flag, UI refs).                      |
| `30-utils.js`          | Pure helpers: `isGamePage`, `getCssPath`, `parseFractionText`, `parseFirstInt`, `sleep`, `toShortJson`, `isElementVisible`, `clickElementSafe`, `dispatchMouseAt`, `parseCoordsText`. |
| `40-state.js`          | DOM state readers: `getFractionCandidates`, `inferFractionRoles`, `readBattleStatusBarText`, `isLootInteractionStatusBusy`, `readEnemyCount`, `readCurrentCoordsFromPopup`, `readTilePopupDetails`, `readBasicState`. |
| `50-discover.js`       | Diagnostics: `probeSelectors`, `discoverFractionNodes`, `discoverButtons`.                 |
| `60-actions.js`        | Raw clicks: `clickFindEnemy`, `clickLootOrActivate`, `clickCenterMap`, `clickMapToggle`, `closeHexPopupIfOpen`, `clickActionBarSlot`, **`isActionBarSlotShowingCooldown`** (slice 11), `clickBasicAttack`, `isBasicAttackConfigured`, `setBasicAttackSelector`. |
| `70-verify.js`         | Click-then-wait wrappers: `waitForCondition`, `waitForLootInteractionSettled`, `waitUntilNotMoving`, `waitForTargetAcquired`, `clickFindEnemyVerified`, `clickLootOrActivateVerified`, `clickCenterMapVerified`, `ensureMapOpen`. |
| `80-map.js`            | Map/canvas + scan/move/explore: `getMapCanvas`, `ensureMapZoomedOut`, `forceZoomOut`, `isMovementInProgress`, `moveToMapPoint`, `clickMapCenterTile`, `clickMapRelative`, `getMapCenterClientPoint`, `scanNeighborRing`, `verifyMoveByCoordinates`, `getNextExplorationPoint`, `exploreIfIdle`, `parseLootKindsFromMarkers`, `scoreScannedTile` (**`other_loot` tier** + extended **grey chest** hints), `chooseBestScannedNeighbor`, `exploreByScan`. **2-ring visual scan**: `getSecondRingOffsets`, `scanSecondRingForColor`, `scanSecondRingForDie`, `ringHasUsefulLoot` -- canvas pixel-sampling fallback that fires when 1-ring has no useful loot; samples 12 patches around 2-hop tile centers for the yellow-die signature color and resolves the best 1-ring step toward it (min-enemies, min-allies tiebreak). |
| `81-hero.js`           | **Phase C1 -- hero combat stats + regen.** `readHeroCombatStats` opens the profile sheet, switches to the Stats tab, then **prefers structured rows** (`app-param-item` with `.stat-item-name` / `.stat-item-value` inside the CDK overlay or body) and **merges** with a **regex fallback** on the flattened text blob (`mergeHeroCombatStats`) so labels like “Critical hit chance / damage” parse reliably; `parseStatNumber` strips `%` and commas. `clickHeroBattleFooter` restores the Battle view. `measurePassiveRegen` samples `readBasicState` over ~3.5s; cache payload `version: 2` includes optional `byName` debug map; `Runtime.hero.*`. |
| `82-skills.js`         | **Phase C0 -- skill scanner.** `scanSkills` (top-level discovery), `openActionPopup` / `closeActionPopup` (long-press + close-button popup control), `parseActionPopup` / `parseSkillEffects` (DOM-to-record + description regex effect extraction), `classifyActionButton` (basic / potion / skill / empty from class + image URL), `loadSkillsFromCache` / `saveSkillsToCache` / `clearSkillsCache` (localStorage persistence keyed by `Config.skills.storageKey`). Recon-only: `Runtime.skills.slots` is populated but no combat logic consumes it yet. |
| `83-damage-observe.js` | **Phase C2 -- damage observer.** `observeCombatDamage()` polls `readBasicState()` on `Config.damageObserver` cadence, emits **`hp_drop` / `hp_rise`** events from red target HP bar deltas (filters target swaps via max-change + large jump ratio), optionally records **new** short numeric leaf text under `app-game` (warmup tick avoids static HUD spam). `snapFloatingDamageOnce()` for ad-hoc DOM recon. Summary persisted to `localStorage[Config.damageObserver.storageKey]`; full session on `Runtime.damage.lastSession`. |
| `84-enemy.js`          | **Phase C3 + C4 slice 2.** Target profile reader + `recordTargetToEnemyDb()` as before. **`mergeLastDamageObserveIntoEnemyDb()`** rolls **`hp_drop`** samples from **`Runtime.damage.lastSession`** into DB rows (`observeCalAgg` / `observeCalLast`). |
| `85-combat.js`         | Combat + auto-farm runner: `attackUntilProgress` (**enemy kill** or **target HP drop** vs baseline; skill opener → **basic fallback** if no verify), `secureTileAndLootOnce` (**slice 9:** inner **attack bursts** after each find-enemy until tile clear / no progress / burst cap; **re-find after a kill** when enemies remain; ranked skill opener only on **first burst after find** when `useRankedSkillOnlyFirstBurstAfterFind`), `prepMapForCombatCycle`, `prepareAndScanOnce`, `runPreparedSecureCycle`, `getAutoFarmStatus`, `stopAutoFarmLoop`, `startAutoFarmLoop`. **C4 auto-farm (optional):** `Config.planner.*` hooks as before. **`Config.combat.attackProgressTimeoutMs`**, **`Config.combat.maxCombatAttackBurstsPerFind`**. |
| `86-planner.js`        | **Phase C4 -- paper + calibration + heuristics.** Paper/calibration APIs; **slice 4** `calibrateEnemyFromCombat`, `rankAttackSkillsByHeuristic`, `plannerSkillEffectHeuristicScore`. **slice 11** `plannerPickSkillSlotToCast` consults **`isActionBarSlotShowingCooldown`**. |
| `90-ui.js`             | In-page panel: ON/OFF, phase block, stats; **Planner (auto-farm)** checkboxes (`recordEnemyDbBeforeAttack`, `logPlannerAfterSecureTile`, `useRankedAttackSkillsInCombat`, **`useRankedSkillOnlyFirstBurstAfterFind`**) + `ligmarbot.plannerUi.v1` persistence. |
| `99-bootstrap.js`      | `start()`, `window.ligmarBot` debug API (includes `BotVersion`, hero + skills + C2/C3 + **C4** `summarizePlannerInputs`), IIFE close, `start()` invocation. |

### Versioning and the local-file loader

The bot is delivered to Tampermonkey via a thin loader userscript that points at the local bundle on disk. This avoids copy-pasting the bundle into Tampermonkey on every change.

**Pieces:**

- **`bot/version.json`** — single source of truth: `version` (semver `MAJOR.MINOR.PATCH`), latest `description`, `builtAt` ISO timestamp, and a 50-entry `history` array of past bumps.
- **`bot/loader.user.js`** — installed in Tampermonkey **once**. Contains `@require file:///C:/Users/Victor/.cursor/projects/ligmarbot/bot/bot.user.js` and a `@version` line that `build.ps1` rewrites on every bump. Tampermonkey re-fetches `@require`d files when the loader's `@version` changes; bumping every build guarantees the new bundle is picked up on the next page reload.
- **`bot/modules/05-version.js`** — auto-generated module with `const BotVersion = { version, description, builtAt };`. Concatenated into the bundle so the runtime has authoritative version info; the GUI panel renders it in its header and `Logger.log("BOOT", ...)` includes it on startup.

**Build commands:**

```powershell
.\bot\build.ps1 -Description "short summary of what changed"   # bump patch, regenerate, rebuild
.\bot\build.ps1 -NoBump                                        # rebuild only (no version change)
```

`-Description` is required for a normal build so every shipped change carries a human-readable note. The patch number auto-increments (e.g. `0.2.1 -> 0.2.2`); manual major/minor edits to `version.json` are allowed for milestone resets.

**One-time Tampermonkey setup (Chrome, per machine):**

1. `chrome://extensions/` → Tampermonkey → **Details** → enable **"Allow access to file URLs"**.
2. Tampermonkey Dashboard → **Settings** → set Config mode to **Advanced** → Security → **"Allow scripts access to local file URIs"** = Yes.
3. Drag-drop `bot/loader.user.js` into the Tampermonkey tab to install it (or open the file in the browser → "install").
4. Disable or delete the legacy "Ligmar Bot" script if it was installed previously.
5. Reload `https://ligmar.io/game/...` — the control panel header should show `Ligmar Bot v0.2.x`.

**Per-change loop after that:** I edit modules → I run `.\bot\build.ps1 -Description "..."` → you press F5 on the game tab → new version is live.

**Why this layout (and not ES modules / `@require` from GitHub):**

- Tampermonkey's most reliable distribution shape is a single self-contained file. ES module imports inside a userscript add CSP/loader friction we don't need.
- Function declarations are hoisted within the closure, so concat order doesn't change behavior — only readability. We keep the prefix order purely as documentation.
- `@require` from GitHub raw URLs hits a sticky CDN cache and forces network at every game load; local file `@require` is instant and offline.
- Build time is effectively zero (one file write); no watcher needed for a typical edit/reload cycle.

**Adding a new module:** drop a new file into `bot/modules/` with a numeric prefix that places it logically (e.g. `82-pathing.js` between `80-map.js` and `85-combat.js`), then run `.\bot\build.ps1 -Description "add pathing module"`. Do **not** wrap the new file in another IIFE — it is concatenated inside the existing one.

### Investigations (completed and folded into the bot)

- ✅ **Wheel events on the map canvas zoom the camera** (visually confirmed). Synthetic `WheelEvent`s with `deltaY=120` work without `ctrlKey`. Implemented in-bot as `ensureMapZoomedOut()` (called once at the start of each session's first `scanNeighborRing()`).
- ✅ **Scan step calibration**: with max zoom-out applied, `step=30 px` and the existing `h = round(step * 0.86) = 26 px` formula put all six hex direction targets on real tile centers. Captured via the (now removed) standalone `zoom-tester.user.js` calibration tool.
- ✅ **2-ring yellow-die threshold calibration (v0.2.5)**: with patch size 28x28 px, target color `#f0b80c`, and tolerance 35 (RGB Euclidean), a real die centered in a sample patch produces a measured match ratio of **~1.1%** (Victor's overlay reading). The original guessed threshold of 4% was far above realistic signal and produced false negatives; threshold lowered to **0.5% (`Config.scan.secondRing.minMatchRatio = 0.005`)**.
- ✅ **2-ring hex sampling + tolerance bump (v0.2.6)**: at v0.2.5 the same die produced 0.4-1.2% across multiple readings (variance from corner-pixel leakage in the 28x28 square sampling neighbor tiles, plus tight tolerance missing anti-aliased edges). Switched to a **hex-shaped sample mask** matching the actual game tile (pointy-top hex, circumradius `r = step / sqrt(3)` ~= 17.32 px) inside a 36x36 bounding box (`sampleHalfSizePx: 18`); only pixels passing the hex inequality contribute to the ratio, so corner leakage is eliminated. Tolerance also raised **35 -> 75** (still ~3x below the distance to any green/red/brown/blue, so no risk of triggering on terrain). Threshold kept at 0.005. The overlay was updated to draw hex outlines so the user can visually confirm we sample the tile shape itself.
- ✅ **Tile-scoring policy fixes (v0.2.6)**: bot was observed walking through an ally-only tile toward a 2-ring yellow die when mob-only neighbor tiles led to the same die. Root cause: the die-guided branch in `exploreByScan` used a separate "min enemies, then min allies" tiebreak which inverted the farm preference (treating mobs as obstacles). Fixed by sorting die-candidate tiles via the same `scoreScannedTile()` ranking the non-die path uses. Also bumped per-enemy bonus (50 -> 200) and per-ally penalty (400 -> 2000) so allies dominate the tiebreak ("1 ally is worth ~10 enemies of avoidance"). Net effect: `1 enemy + 0 allies` now beats `2 enemies + 1 ally` in any tier, matching how a farming bot should actually rank moves.
- ✅ **Grey / unknown loot vs mob-only neighbors (v0.3.25)**: `parseLootKindsFromMarkers` only recognized grey chests via `#a5abb5`; many assets fell through to `other_loot`, and `scoreScannedTile` had **no** tier for `other_loot` — those tiles used the **empty** base (100000) while a **2-mob** neighbor scored **300400**, so ring scans could pick **mobs over visible chests**. Fix: broader grey-chest URL/class hints + explicit **`other_loot` base 450000** (below **`grey_chest` 500000**, above mob-only **300000**).
- ✅ **1-ring scan speedup (v0.2.7)**: per-tile wall timeout reduced `760ms -> 220ms` and poll cadence reduced `95ms -> 40ms`. All-walls 6-tile scan goes from ~4.56s to ~1.32s; all-walkable goes from ~570ms to ~240ms. Justification: local popup coord updates resolve in ~30-80ms after click (no server roundtrip needed since coords are click-position derived); 220ms keeps ~3x safety margin against jitter. The polling structure is preserved (vs. a single-read after fixed delay) so occasional slow popup updates still classify correctly. Also disabled the auto-render of the 2-ring scan overlay (`Config.debug.showSecondRingOverlay: true -> false`) now that detection is calibrated -- re-enable from console for future debugging.
- ✅ **Phase C0: skill scanner (v0.3.0)**: foundation for the upcoming combat planner. `ligmarBot.scanSkills()` (manual, console-only; refuses to run with auto-farm ON) iterates every `app-action-button` slot in `app-battle-action-bar`, classifies it (basic / potion-hp / potion-mp / skill-attack / skill-support / empty) from the slot's class + image URL, then for non-empty slots: dispatches `mousedown`, holds 450ms past the long-press threshold, polls for the `app-action-info` modal, parses name + level (`"Rapid Fire (4/10)"` -> name + 4 + 10), tags (`Attack/Target`, `Support/Self`, etc), description text, and `app-param-item-new` rows (`Activation time`, `Cooldown`, `Mana cost`, `Range`, `Weapon`). Description text is run through ordered regex patterns to extract typed effects: `dot` ("X damage over Y s"), `slow` ("Slows the target by N% for T s"), `stun` ("Stuns the target for T s" -- guessed pattern, will refine with real recon), `damage_buff` ("N% additional KIND damage with each attack for T s"), `heal_hp` / `restore_mp`, plus a generic "additional N damage" fallback when no DoT was already captured, and a `basic_proc` flag whenever "Deals basic ... damage to the target" is present. Closes via `app-icon.modal-header-close`, then dispatches `mouseup` on `document.body` (NOT on the button) so we never accidentally fire a `click` that casts the slot. Result is cached to `localStorage[Config.skills.storageKey]` and re-loaded on boot so the scan only happens once per character/build. No combat logic consumes `Runtime.skills.slots` yet -- this is recon-only data the user verifies before later phases (C1: hero stats, C2: damage observer, C3: enemy DB, C4: combat planner) build on it.
- ✅ **Skill parser extensions (v0.3.1)**: `.header-description` is merged with `.header-additional-description` (e.g. interrupt hints) for regex input; `descriptionAdditional` is stored separately on each slot. `Activation time` value `Instantly` maps to `castTimeSec: 0`. New effect types from live HTML recon: `channel_gear` (channel max seconds + base physical + up-to-N% gear damage -- Sniper Shot), `mana_drain_per_sec` (Step into Darkness), `stealth` (visibility decreased to 0), `dodge_buff` (Predator Dexterity), `crit_damage_buff` (Taste of Death). `basic_proc` also matches `deals base ... damage to the target` but is suppressed when `channel_gear` already matched (avoid duplicate proc). Saved cache payload `version` field bumped to 2.
- ✅ **Potion effect labeling (v0.3.2)**: HP and MP potions both use `effects[].type === "heal"` with `effects[].resource === "hp"` or `"mp"` so logic never has to guess from the name string; `scanSkills` `console.table` prints `heal_hp` / `heal_mp` in the effects column for human readability.
- ✅ **Phase C1: hero stats + passive regen (v0.3.3)**: `ligmarBot.readHeroCombatStats()` opens the profile (`app-profile-avatar` / fallback `.profile-avatar app-profile-avatar`), clicks the `app-tab` whose `.tab-content` is `Stats`, regex-extracts Physical attack, attack speed, crit chance, crit damage from overlay text (`.cdk-overlay-container` preferred), persists to `localStorage[ligmarbot.heroStats.v1]`, returns via the `Battle` footer (`.footer-button` + `Battle` text or `.icon-src-swords`). `ligmarBot.measurePassiveRegen()` samples HP/MP cur through `readBasicState` over configurable duration (default ~3.5s) and estimates HP/s and MP/s. **Regen caveat**: HP regen is often invisible while at **full** HP — take a small amount of damage first if you need a non-zero HP slope; MP may sit at max too. Crit stats are optional for v1 planner math (nice-to-have for EV); physical attack + attack speed anchor basic-attack DPS estimates once combined with skill tooltips.
- 🟡 **Phase C4: combat planner (in progress)** — **slice 1**: `summarizePlannerInputs()` / `estimatePaperBasicAttackDps()` + `listAttackSkillsForPlanner()`. **slice 2**: `observeCombatDamage()` **`attribution`** at session start; `mergeLastDamageObserveIntoEnemyDb()` → **`observeCalAgg`** / **`observeCalLast`**. **slice 3**: `summarizeEnemyDbCalibration({ key? })` / `getEnemyCalibrationRow(key)`. **slice 4**: `await calibrateEnemyFromCombat(...)`; `rankAttackSkillsByHeuristic` + `plannerSkillEffectHeuristicScore`. **slice 5**: `Runtime.enemy.lastFoughtKey`; `getLastFoughtEnemyKey()`; **`await quickCalibrationSession(...)`**. **slice 6**: **`Config.planner`** hooks in **`secureTileAndLootOnce`**. **slice 7**: GUI checkboxes + **`ligmarbot.plannerUi.v1`** persistence (`90-ui.js`). **slice 8**: **`useRankedAttackSkillsInCombat`** — `plannerPickSkillSlotToCast()` + **`clickActionBarSlot(i)`**; **`attackUntilProgress`** opening click tries ranked **`kind==="skill"`** attack (MP gate: **`skillMpReserve`**), else **`clickBasicAttack()`** (`60-actions.js`, `85-combat.js`, `86-planner.js`). **slice 8b**: progress = **`enemyCount`** down **or** red **`targetHp.cur`** down (same **`max`**); skill opener with no progress → **basic retry**; opener skips skills whose parsed **`effects`** lack direct damage (`dot` / `instant` / `channel_gear` / `basic_proc`); **`plannerSkillHasDirectDamageForOpener`** (`86-planner.js`). **slice 9**: **`secureTileAndLootOnce`** — after each successful **find-enemy**, **inner loop** calls **`attackUntilProgress`** repeatedly (cap **`maxCombatAttackBurstsPerFind`**) so multi-mob pulls need fewer **find-enemy** passes; **`useRankedSkillOnlyFirstBurstAfterFind`** (default **true**) keeps **ranked skill** on the **first burst only** after each find, follow-up bursts **basic-only**. **slice 9b (fix)**: when a burst **lowers `enemyCount`** but the pull is **not** clear, run **`clickFindEnemyVerified`** + **`waitForTargetAcquired`** before the next burst so the UI/target bar matches the next mob (avoids long **`attackProgressTimeoutMs`** stalls and redundant outer find spam). **`useRankedSkillOnlyFirstBurstAfterFind`:** ranked opener is allowed again after that **re-find** (not only `attackBursts === 1`). **slice 10**: **`useRankedSkillOnlyFirstBurstAfterFind`** exposed on the **Planner** panel and persisted in **`ligmarbot.plannerUi.v1`** (`90-ui.js`, `20-runtime.js`). **slice 11**: live action-bar **cooldown / blocked** hints — **`isActionBarSlotShowingCooldown(i)`** (`60-actions.js`); **`plannerPickSkillSlotToCast()`** skips a ranked pick when **`Config.planner.skipOpenerWhenActionBarShowsCooldown`** is true and the slot looks on CD; debug **`ligmarBot.isActionBarSlotShowingCooldown(n)`**.
- ✅ **Phase C3: enemy profile + DB**: `ligmarBot.readTargetProfileSnapshot()` reads **name**, **level**, and **status bar labels** (same DOM scope as above). **Mob damage-type icon removed** — use Phase C2 observed damage to ground truth outgoing/incoming hits; resist/protect stats lack a known closed-form anyway. `recordTargetToEnemyDb({ note })` merges **`name|level|maxHp`** rows + `statusLabelsLast`. Legacy **`damageClass`** fields are stripped on cache load.
- ✅ **Phase C2: damage observer (C1 follow-on)**: `ligmarBot.observeCombatDamage({ totalMs, pollMs, includeFloatingTexts, saveSummary, mergeToEnemyDb, mergeOpts })` samples `readBasicState().combat.targetHp` to emit **`hp_drop`** / **`hp_rise`** with **suspicious jump** filtering (and **lethal** `cur<=0` same-max handling). **`mergeToEnemyDb: true`** runs **`mergeLastDamageObserveIntoEnemyDb(mergeOpts)`** when **`hpDropEventCount` > 0**; outcome in **`session.enemyDbMerge`**. Persisted summary **`version: 3`** may include merge ok/key/error. Optional **floating text** scan; results in `Runtime.damage.lastSession` and `localStorage[ligmarbot.damageObserve.v1]`. Ad-hoc: `ligmarBot.snapFloatingDamageOnce()`.
- ❓ **Ctrl+Wheel / Keyboard `+` / `-` / `=`**: produced no observable effect. Not used.
- ❌ **No first-party in-game zoom UI buttons** were findable. Wheel is the only viable input.
- 🟡 **Ancestor `transform: matrix(1.16, ...)` on `div.app-container.*`**: a global Angular/UI scaling, **not** the game zoom. Don't use it to infer zoom level.

The companion test script `bot/zoom-tester.user.js` was deleted after calibration; its history is preserved in git (commits `e3800af`, `4dd9d50`, `872f0b1`) if it ever needs to come back.

### Enemy / calibration data: scope and persistence

- **Not “every mob type” automatically.** Rows appear when you call **`recordTargetToEnemyDb()`** and/or when **`mergeLastDamageObserveIntoEnemyDb()`** creates a row for an observe session. Each row is keyed by **`name|level|maxHp`** (normalized name). Same species at **different level or max HP** → **different row** (intentional: different encounter budget).
- **Not temporary across reloads.** `Runtime.enemy.db` is **restored from** `localStorage[ligmarbot.enemyDb.v1]` on boot. Clearing site data / `ligmarBot.clearEnemyDbCache()` / a fresh browser profile wipes it. Skills and hero stats use **their own** storage keys the same way.
- **Calibration** (`observeCalAgg` / `observeCalLast`) **accumulates** when you merge multiple observe sessions for the same key (until you clear or cap trims old rows).

### Manual testing playbook (Phases C0–C4)

Use after **`.\bot\build.ps1 -Description "..."`** and reloading **`https://ligmar.io/game/...`**. Turn **auto-farm OFF** for scans. Paste results (or screenshots) back when verifying.

**0. Version sanity**

1. Open DevTools console.
2. Run: `ligmarBot.version`  
3. **Expect:** object with `version`, `description`, `builtAt` matching the build you just installed.

**C0 — Skills**

1. Ensure action bar is visible; auto-farm OFF.
2. Run: `await ligmarBot.scanSkills()`  
3. **Expect:** table of slots; `ligmarBot.Runtime.skills.slots.length` matches bar slots.
4. **Send:** any `parseFailed: true` rows or odd `effects` if something looks wrong.

**C1 — Hero stats**

1. Run: `await ligmarBot.readHeroCombatStats()`  
2. **Expect:** `{ ok: true, stats: { physicalAttack, attackSpeed, ... } }`; profile closes back to battle.
3. Run: `ligmarBot.Runtime.hero.combatStats`  
4. **Send:** `stats` object if numbers look off vs in-game sheet.

**C2 — Damage observe (you must deal damage yourself)**

The script **only reads the red target HP bar** every poll tick. It **does not** press attack or skills for you. If you run it while idle, **`hpDropEventCount` will stay 0**.

1. **Enter combat** and **acquire the target** so the **enemy red HP bar** (`cur / max`) is visible and updating.
2. **Optional but recommended:** open the enemy name/level panel (same state as normal targeting) so **session start** can set **`attribution`** (name|level|maxHp) for later DB merge.
3. **Immediately before** you run the command, be ready to **keep attacking for the whole duration** (basic attack and/or skills — your choice). For **clean “basic vs paper” calibration**, use **basic attack only** during the window.
4. Run the observe, **then without pausing** keep clicking/holding attacks so HP actually drops:

   `await ligmarBot.observeCombatDamage({ includeFloatingTexts: false, totalMs: 8000 })`

   **One-liner observe + DB merge** (after the fight, no separate `merge…` call):

   `await ligmarBot.observeCombatDamage({ includeFloatingTexts: false, totalMs: 10000, mergeToEnemyDb: true })`

   Optional: `mergeOpts: { excludeLethal: false }` (same shape as `mergeLastDamageObserveIntoEnemyDb`). Result in **`session.enemyDbMerge`**.

   **All-in-one calibration + rank** (same combat rules — attack the whole time):

   `await ligmarBot.quickCalibrationSession()`  
   Override timing: `await ligmarBot.quickCalibrationSession({ observe: { totalMs: 12000 } })`  
   **`ligmarBot.getLastFoughtEnemyKey()`** returns the latest **`name|level|maxHp`** key when set.

5. **Expect:** `ok: true` and **`summary.hpDropEventCount` ≥ 1** if the bar moved down at least once.  
   - **`hpDropEventCount === 0`** → you had **no target**, **did not attack**, enemy **invulnerable/healing** faster than you damage, or **`totalMs` too short** for your attack speed. **Fix:** longer `totalMs`, verify red bar moves in the UI, then attack continuously during the run.
6. **Send:** `summary`, `suspiciousJumps`, and whether you used **basic-only** or **skills**.

**C3 — Enemy row**

1. With same target: `ligmarBot.readTargetProfileSnapshot()` → `ok: true`, name/level match UI.
2. `ligmarBot.recordTargetToEnemyDb()` → row in `ligmarBot.Runtime.enemy.db`.
3. **Send:** the row `key` and `statusLabelsLast` if labels look wrong.

**C4 — Merge observe + calibration**

**Same combat rule as C2:** merging needs **`hp_drop` events**, i.e. you must have **lowered enemy HP** during the observe you are merging.

1. **Do C2 correctly first** (non-zero `hpDropEventCount`), **or** use the one-shot below **while attacking the whole time**:

   `await ligmarBot.calibrateEnemyFromCombat({ observe: { includeFloatingTexts: false, totalMs: 10000 } })`

2. **While the promise is running:** keep the **same target** and **keep dealing damage** so the red bar drops. If you stop attacking or the target dies before any tick sees a decrease, you get **`stage: 'no_hp_drops'`** / merge skip — that is **expected**, not a broken build.
3. **Standalone merge** (after a good C2): `ligmarBot.mergeLastDamageObserveIntoEnemyDb()` — uses **`Runtime.damage.lastSession`** from that fight.
4. **Expect:** DB row gains `observeCalAgg` / `observeCalLast`. **`maxHp` in the key** (e.g. `triton|17|2070` vs `triton|17|1035`) must match the mob you fought for **`rankAttackSkillsByHeuristic({ enemyKey })`** to pick up **`mobFactorApplied`**.
5. Run: `ligmarBot.summarizeEnemyDbCalibration()`  
6. **Slice 4 (heuristic):** `ligmarBot.rankAttackSkillsByHeuristic({ enemyKey: '<exact key from db>' })` — **`mobFactorApplied`** is `null` until that key has merged calibration.
7. **Send:** full output; note **basic-only** vs **mixed skills**.

**Common mistakes (damage / calibrate)**

| Symptom | Cause | What to do |
| -------- | ----- | ----------- |
| `hpDropEventCount: 0` | No damage dealt during window | Attack continuously; increase `totalMs`; confirm red bar moves |
| `stage: 'no_hp_drops'` from `calibrateEnemyFromCombat` | Same as above | Same; ensure you fight **during** the await |
| `mobFactorApplied: null` | No `observeCalAgg` for that **exact** `enemyKey` | Merge after a fight vs that mob’s **name\|level\|maxHp** |
| Merge says no attribution | Profile/red bar not valid at **observe start** | Face target with name+HP visible, then start observe |

**Auto-farm + planner (optional hooks)**

1. **Control panel** — section **“Planner (auto-farm)”**: checkboxes mirror **`Config.planner`** (including **ranked skill: first burst after find only**). Choices persist in **`localStorage[ligmarbot.plannerUi.v1]`** across reloads.
2. From console (same effect):  
   `ligmarBot.Config.planner.recordEnemyDbBeforeAttack = true` — **`recordTargetToEnemyDb()`** after target acquire, before basic attacks.  
   `ligmarBot.Config.planner.logPlannerAfterSecureTile = true` — after combat clears, **`[PLANNER]`** log with **`lastFoughtKey`** and **`hasHpDropCalibration`**.  
   `ligmarBot.Config.planner.useRankedAttackSkillsInCombat = true` — first swing in **`attackUntilProgress`** uses **`plannerPickSkillSlotToCast()`** (needs **`scanSkills`** cache); tune **`Config.planner.skillMpReserve`** (absolute MP) if skills are skipped as “too expensive.” **Slice 9:** `Config.planner.useRankedSkillOnlyFirstBurstAfterFind` (default **true**) — only the **first attack burst after each find-enemy** uses the ranked opener; set **`false`** to try a ranked opener on **every** burst (MP/CD heavy). **`Config.combat.maxCombatAttackBurstsPerFind`** bounds inner bursts per find pass. **Slice 11:** `Config.planner.skipOpenerWhenActionBarShowsCooldown` (default **true**) — skips a top-ranked skill if **`ligmarBot.isActionBarSlotShowingCooldown(slot)`** is true; set **`false`** if your build’s DOM causes false positives.
3. **Expect:** `[PLANNER] Enemy DB row refreshed before attack` / `Combat cleared — planner snapshot` during auto-farm when enabled. With slice 8 on: **`[PLANNER] Opening attack used ranked skill slot`** on **burst 1** after find (when slice 9 first-burst gating is on), then **`[VERIFY] attack progress confirmed`** when HP drops or the mob dies; follow-up bursts in the same pull use **basic** opener unless **`useRankedSkillOnlyFirstBurstAfterFind`** is **false**. If the skill does nothing observable, **`[PLANNER] Skill opener had no verified progress; trying basic attack`** then basic.
4. **Does not** auto-run **`observeCombatDamage`**; use **`quickCalibrationSession`** for **`hp_drop`** merges.

**Clear / reset (when needed)**

- Skills: `ligmarBot.clearSkillsCache()`
- Hero stats: `ligmarBot.clearHeroStatsCache()`
- Enemy DB: `ligmarBot.clearEnemyDbCache()`
- Damage summary file: `ligmarBot.clearDamageObserveStorage()`

### Agent handoff protocol

When reporting **no bugs** after a playbook run, state **bundle version** (`ligmarBot.version.version`) so the next change can assume that baseline. The implementation agent should **start the next planned slice** (e.g. C4 slice 4) without waiting for a separate “go” message unless scope is ambiguous.

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

