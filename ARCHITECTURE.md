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
| `60-actions.js`        | Raw clicks: `clickFindEnemy`, `clickLootOrActivate`, `clickCenterMap`, `clickMapToggle`, `closeHexPopupIfOpen`, `clickActionBarSlot`, **`clickActionBarSlotHoldCast`** (slice 12), **`isActionBarSlotShowingCooldown`** (slice 11), `clickBasicAttack`, `isBasicAttackConfigured`, `setBasicAttackSelector`. |
| `70-verify.js`         | Click-then-wait wrappers: `waitForCondition`, `waitForLootInteractionSettled`, `waitUntilNotMoving`, `waitForTargetAcquired`, `clickFindEnemyVerified`, `clickLootOrActivateVerified`, `clickCenterMapVerified`, `ensureMapOpen`. |
| `80-map.js`            | Map/canvas + scan/move/explore: `getMapCanvas`, `ensureMapZoomedOut`, `forceZoomOut`, `isMovementInProgress`, `moveToMapPoint`, `clickMapCenterTile`, `clickMapRelative`, `getMapCenterClientPoint`, `scanNeighborRing`, `verifyMoveByCoordinates`, `getNextExplorationPoint`, `exploreIfIdle`, `parseLootKindsFromMarkers`, `scoreScannedTile` (**`other_loot` tier** + extended **grey chest** hints), `chooseBestScannedNeighbor`, `exploreByScan`. **2-ring visual scan**: `getSecondRingOffsets`, `scanSecondRingForColor`, `scanSecondRingForDie`, `ringHasUsefulLoot` -- canvas pixel-sampling fallback that fires when 1-ring has no useful loot; samples 12 patches around 2-hop tile centers for the yellow-die signature color and resolves the best 1-ring step toward it (min-enemies, min-allies tiebreak). |
| `81-hero.js`           | **Phase C1 -- hero combat stats + regen.** `readHeroCombatStats` opens the profile sheet, switches to the Stats tab, then **prefers structured rows** (`app-param-item` with `.stat-item-name` / `.stat-item-value` inside the CDK overlay or body) and **merges** with a **regex fallback** on the flattened text blob (`mergeHeroCombatStats`) so labels like “Critical hit chance / damage” parse reliably; `parseStatNumber` strips `%` and commas. `clickHeroBattleFooter` restores the Battle view. `measurePassiveRegen` samples `readBasicState` over ~3.5s; cache payload `version: 2` includes optional `byName` debug map; `Runtime.hero.*`. |
| `82-skills.js`         | **Phase C0 -- skill scanner.** `scanSkills`, `openActionPopup` / `closeActionPopup`, `parseActionPopup` / `parseSkillEffects`, `classifyActionButton`, **`readActionBarLayoutFingerprint`** (slice 13), `loadSkillsFromCache` / `saveSkillsToCache` / `clearSkillsCache` (`actionBarFingerprint` on save; boot rejects cache on bar mismatch when `invalidateCacheOnBarMismatch`). |
| `83-damage-observe.js` | **Phase C2 -- damage observer.** `observeCombatDamage()` polls `readBasicState()` on `Config.damageObserver` cadence, emits **`hp_drop` / `hp_rise`** events from red target HP bar deltas (filters target swaps via max-change + large jump ratio), optionally records **new** short numeric leaf text under `app-game` (warmup tick avoids static HUD spam). `snapFloatingDamageOnce()` for ad-hoc DOM recon. Summary persisted to `localStorage[Config.damageObserver.storageKey]`; full session on `Runtime.damage.lastSession`. |
| `84-enemy.js`          | **Phase C3 + C4 slice 2.** Target profile reader + `recordTargetToEnemyDb()` as before. **`mergeLastDamageObserveIntoEnemyDb()`** rolls **`hp_drop`** samples from **`Runtime.damage.lastSession`** into DB rows (`observeCalAgg` / `observeCalLast`). |
| `85-combat.js`         | Combat + auto-farm runner: `attackUntilProgress` (**enemy kill** or **target HP drop** vs baseline; **slice 12:** `await clickPlannerOpeningAttack` — **hold-cast** opener when cache has cast/channel), `secureTileAndLootOnce` (inner bursts, re-find after kill, ranked gating), `prepMapForCombatCycle`, `prepareAndScanOnce`, `runPreparedSecureCycle`, `getAutoFarmStatus`, `stopAutoFarmLoop`, `startAutoFarmLoop`. **`Config.combat.*`**, **`Config.planner.*`** (incl. **`useHoldCastForChannelOpeners`**). |
| `86-planner.js`        | **Phase C4 -- paper + calibration + heuristics.** `calibrateEnemyFromCombat`, `rankAttackSkillsByHeuristic`, `plannerSkillEffectHeuristicScore`, **`plannerPickSkillOpeningPick`**, **`plannerOpenerHoldCastMs`** (slice 12), **`plannerPickSkillSlotToCast`**, slice 11 cooldown gate via **`isActionBarSlotShowingCooldown`**. |
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
- **`function` declarations** are hoisted inside the shared IIFE, so two modules can call each other’s functions regardless of numeric order **as long as the call happens at runtime** (not from another file’s top-level `const` initializer). **`const` / `let` / `class` run in strict filename order** (e.g. `15-logger.js` before `20-runtime.js`); keep cross-file dependencies inside functions or reorder the module file.
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
- ✅ **Skills DB vs class / bar swap (v0.3.30) + strict load (slice 16)**: `saveSkillsToCache` stores **`actionBarFingerprint`** from live `app-action-button` rows (class + icon + optional **`data-test` / `aria-label` / `title`** hints per slot). When **`Config.skills.invalidateCacheOnBarMismatch`** is true, **`loadSkillsFromCache`** requires a **non-empty** saved fingerprint (older saves **without** one are **deleted**), requires the **live** bar fingerprint (**skips** load if the bar is not in the DOM yet — **`99-bootstrap`** **retries once** after **1.5s**), then compares; mismatch **removes** stale `localStorage` so another hero’s scanned names (e.g. wrong skill labels in **`[PLANNER]`** logs) cannot stick after a class change.
- ✅ **In-game two-skill queue (player mechanic, not automated)**: While skill **A** is **charging/casting**, you may press **B** early — **B** is **queued** and starts when **A** finishes. Only **two** skills in this relationship (you cannot queue a **third** immediately). The bot’s opener path does **not** model this yet; noted for future C4 sequencing.
- ✅ **1-ring scan speedup (v0.2.7)**: per-tile wall timeout reduced `760ms -> 220ms` and poll cadence reduced `95ms -> 40ms`. All-walls 6-tile scan goes from ~4.56s to ~1.32s; all-walkable goes from ~570ms to ~240ms. Justification: local popup coord updates resolve in ~30-80ms after click (no server roundtrip needed since coords are click-position derived); 220ms keeps ~3x safety margin against jitter. The polling structure is preserved (vs. a single-read after fixed delay) so occasional slow popup updates still classify correctly. Also disabled the auto-render of the 2-ring scan overlay (`Config.debug.showSecondRingOverlay: true -> false`) now that detection is calibrated -- re-enable from console for future debugging.
- ✅ **Ring scan coord verify retry (v0.3.31)**: if **`waitForCondition`** for neighbor coords **times out**, **`scanNeighborRing`** re-clicks the same offset and waits again (**`Config.scan.tileCoordVerifyRetries`**, default **1**; **`tileRetrySettleMs`**). Cuts spurious **`scan R coords change timed out`** when the popup is briefly slow; true walls still classify blocked after the extra attempt.
- ✅ **Phase C0: skill scanner (v0.3.0)**: foundation for the upcoming combat planner. `ligmarBot.scanSkills()` (manual, console-only; refuses to run with auto-farm ON) iterates every `app-action-button` slot in `app-battle-action-bar`, classifies it (basic / potion-hp / potion-mp / skill-attack / skill-support / empty) from the slot's class + image URL, then for non-empty slots: dispatches `mousedown`, holds 450ms past the long-press threshold, polls for the `app-action-info` modal, parses name + level (`"Rapid Fire (4/10)"` -> name + 4 + 10), tags (`Attack/Target`, `Support/Self`, etc), description text, and `app-param-item-new` rows (`Activation time`, `Cooldown`, `Mana cost`, `Range`, `Weapon`). Description text is run through ordered regex patterns to extract typed effects: `dot` ("X damage over Y s"), `slow` ("Slows the target by N% for T s"), `stun` ("Stuns the target for T s" -- guessed pattern, will refine with real recon), `damage_buff` ("N% additional KIND damage with each attack for T s"), `heal_hp` / `restore_mp`, plus a generic "additional N damage" fallback when no DoT was already captured, and a `basic_proc` flag whenever "Deals basic ... damage to the target" is present. Closes via `app-icon.modal-header-close`, then dispatches `mouseup` on `document.body` (NOT on the button) so we never accidentally fire a `click` that casts the slot. Result is cached to `localStorage[Config.skills.storageKey]` and re-loaded on boot so the scan only happens once per character/build. No combat logic consumes `Runtime.skills.slots` yet -- this is recon-only data the user verifies before later phases (C1: hero stats, C2: damage observer, C3: enemy DB, C4: combat planner) build on it.
- ✅ **Skill parser extensions (v0.3.1)**: `.header-description` is merged with `.header-additional-description` (e.g. interrupt hints) for regex input; `descriptionAdditional` is stored separately on each slot. `Activation time` value `Instantly` maps to `castTimeSec: 0`. New effect types from live HTML recon: `channel_gear` (channel max seconds + base physical + up-to-N% gear damage -- Sniper Shot), `mana_drain_per_sec` (Step into Darkness), `stealth` (visibility decreased to 0), `dodge_buff` (Predator Dexterity), `crit_damage_buff` (Taste of Death). `basic_proc` also matches `deals base ... damage to the target` but is suppressed when `channel_gear` already matched (avoid duplicate proc). Saved cache payload `version` field bumped to 2.
- ✅ **Potion effect labeling (v0.3.2)**: HP and MP potions both use `effects[].type === "heal"` with `effects[].resource === "hp"` or `"mp"` so logic never has to guess from the name string; `scanSkills` `console.table` prints `heal_hp` / `heal_mp` in the effects column for human readability.
- ✅ **Phase C1: hero stats + passive regen (v0.3.3)**: `ligmarBot.readHeroCombatStats()` opens the profile (`app-profile-avatar` / fallback `.profile-avatar app-profile-avatar`), clicks the `app-tab` whose `.tab-content` is `Stats`, regex-extracts Physical attack, attack speed, crit chance, crit damage from overlay text (`.cdk-overlay-container` preferred), persists to `localStorage[ligmarbot.heroStats.v1]`, returns via the `Battle` footer (`.footer-button` + `Battle` text or `.icon-src-swords`). `ligmarBot.measurePassiveRegen()` samples HP/MP cur through `readBasicState` over configurable duration (default ~3.5s) and estimates HP/s and MP/s. **Regen caveat**: HP regen is often invisible while at **full** HP — take a small amount of damage first if you need a non-zero HP slope; MP may sit at max too. Crit stats are optional for v1 planner math (nice-to-have for EV); physical attack + attack speed anchor basic-attack DPS estimates once combined with skill tooltips.
- ✅ **slice 24b (charge skill cancel UI, v0.3.44)**: Charge skills (e.g. Sniper Shot) **do not start cooldown** until **cancel** or **full charge shot**. After the **first** ranked opener progress wait fails, if **`isChargingSkillCancelHintVisible()`**, the bot calls **`clickChargingSkillCancelUi()`** — **`clickElementSafe`** on **`getChargingSkillCancelClickTarget()`** (optional **`chargingCancelClickSelectors`**, else walk up from hint to **`button` / `role="button"`**, else hint node). **Not** a second action-bar tap. Toggle **`rankedOpenerClickCancelUiIfChargeStuck`**. Debug: **`ligmarBot.getChargingSkillCancelClickTarget()`**, **`ligmarBot.clickChargingSkillCancelUi()`**.
- ✅ **slice 23 (faster ranked-opener fallback, v0.3.42)**: **`attackUntilProgress`** uses **`Config.combat.rankedOpenerFirstProgressTimeoutMs`** (default **4200**) for the **first** ranked skill click only; **alternate** ranked openers and **basic** retry still use **`attackProgressTimeoutMs`**. **`postRankedSkillClickSettleMs`** (default **120**) sleeps after a bar skill tap before polling HP/count.
- ✅ **slice 22 (combat tap-only skills, v0.3.41)**: Ranked combat opener uses **`clickActionBarSlot`** only (same tap as in-game). **`clickActionBarSlotHoldCast`** and bar hold-cast config were **removed** from combat. **`scanSkills()`** still uses a long-press on the bar only to open the **description popup** for parsing, not to cast. **`plannerOpenerHoldCastMs`** remains on **`ligmarBot`** and **always returns 0**. Charge/cancel flow (e.g. “Press to cancel”) is **not** automated yet.
- ✅ **slice 21 (runtime hardening, v0.3.40)**: **`waitForCondition`** and **`sleep`** cooperate with **`Runtime.autoFarm.stopRequested`**; **`secureTileAndLootOnce`** and **`attackUntilProgress`** bail out without further clicks when **`stopRequested`** (returns **`reason: "stop_requested"`**; auto-farm does **not** increment **`consecutiveFailures`** for that); skill cache BOOT uses **`Config.skills.bootCacheRetryDelaysMs`** multi-retry when the action bar is late; **`resetZoomAssumptionIfSessionRisk(session)`** clears **`Runtime.zoom.maxedOut`** on **`session.dead`** / **`session.poorConnection`**; loot **`lootPostCenterTileSettleMs`** + optional **`inventory_full`** text scan; DPR boot warn. Details: **Archived planning + runtime notes** below.
- 🟡 **Phase C4: combat planner (in progress)** — **slice 1**: `summarizePlannerInputs()` / `estimatePaperBasicAttackDps()` + `listAttackSkillsForPlanner()`. **slice 2**: `observeCombatDamage()` **`attribution`** at session start; `mergeLastDamageObserveIntoEnemyDb()` → **`observeCalAgg`** / **`observeCalLast`**. **slice 3**: `summarizeEnemyDbCalibration({ key? })` / `getEnemyCalibrationRow(key)`. **slice 4**: `await calibrateEnemyFromCombat(...)`; `rankAttackSkillsByHeuristic` + `plannerSkillEffectHeuristicScore`. **slice 5**: `Runtime.enemy.lastFoughtKey`; `getLastFoughtEnemyKey()`; **`await quickCalibrationSession(...)`**. **slice 6**: **`Config.planner`** hooks in **`secureTileAndLootOnce`**. **slice 7**: GUI checkboxes + **`ligmarbot.plannerUi.v1`** persistence (`90-ui.js`). **slice 8**: **`useRankedAttackSkillsInCombat`** — `plannerPickSkillSlotToCast()` + **`clickActionBarSlot(i)`**; **`attackUntilProgress`** opening click tries ranked **`kind==="skill"`** attack (MP gate: **`skillMpReserve`**), else **`clickBasicAttack()`** (`60-actions.js`, `85-combat.js`, `86-planner.js`). **slice 8b**: progress = **`enemyCount`** down **or** red **`targetHp.cur`** down (same **`max`**); skill opener with no progress → **basic retry**; opener skips skills whose parsed **`effects`** lack direct damage (`dot` / `instant` / `channel_gear` / `basic_proc`); **`plannerSkillHasDirectDamageForOpener`** (`86-planner.js`). **slice 9**: **`secureTileAndLootOnce`** — after each successful **find-enemy**, **inner loop** calls **`attackUntilProgress`** repeatedly (cap **`maxCombatAttackBurstsPerFind`**) so multi-mob pulls need fewer **find-enemy** passes; **`useRankedSkillOnlyFirstBurstAfterFind`** (default **true**) keeps **ranked skill** on the **first burst only** after each find, follow-up bursts **basic-only**. **slice 9b (fix)**: when a burst **lowers `enemyCount`** but the pull is **not** clear, run **`clickFindEnemyVerified`** + **`waitForTargetAcquired`** before the next burst so the UI/target bar matches the next mob (avoids long **`attackProgressTimeoutMs`** stalls and redundant outer find spam). **`useRankedSkillOnlyFirstBurstAfterFind`:** ranked opener is allowed again after that **re-find** (not only `attackBursts === 1`). **slice 10**: **`useRankedSkillOnlyFirstBurstAfterFind`** exposed on the **Planner** panel and persisted in **`ligmarbot.plannerUi.v1`** (`90-ui.js`, `20-runtime.js`). **slice 11**: live action-bar **cooldown / blocked** hints — **`isActionBarSlotShowingCooldown(i)`** (`60-actions.js`); **`plannerPickSkillSlotToCast()`** skips a ranked pick when **`Config.planner.skipOpenerWhenActionBarShowsCooldown`** is true and the slot looks on CD; debug **`ligmarBot.isActionBarSlotShowingCooldown(n)`**. **slice 12 (superseded by slice 22)**: Ranked opener is **`clickActionBarSlot`** only (tap). Hold-cast on the bar was removed — it did not match Ligmar’s input model (skills fire on tap; charge/cancel is separate UI). **`ligmarBot.plannerOpenerHoldCastMs`** is kept for API compatibility and returns **0**. **`basicAttackButton`** defaults to **`app-battle-action-bar app-action-button.type-default`** so basic attack never targets a stray **`type-default`** node elsewhere. **slice 13**: **`readActionBarLayoutFingerprint()`** saved with cache; **`loadSkillsFromCache`** drops cache when live bar ≠ fingerprint (**`Config.skills.invalidateCacheOnBarMismatch`**); **`ligmarBot.readActionBarLayoutFingerprint()`** for debugging. **slice 14** (map): **`scanNeighborRing`** coord-verify **retry** on timeout (**`Config.scan.tileCoordVerifyRetries`**). **slice 15**: **`Config.planner.openerExtraRankedSkills`** — if first ranked opener gets **no** verified progress, **`attackUntilProgress`** tries the **next** ranked slot(s) (**`plannerPickSkillOpeningPick({ excludeSlots })`**) before **basic** fallback.
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

1. **Control panel** — section **“Planner (auto-farm)”**: checkboxes mirror **`Config.planner`** (including **ranked skill: first burst after find only**). **`openerExtraRankedSkills`** is console-only for now (not on the panel). Choices persist in **`localStorage[ligmarbot.plannerUi.v1]`** across reloads.
2. From console (same effect):  
   `ligmarBot.Config.planner.recordEnemyDbBeforeAttack = true` — **`recordTargetToEnemyDb()`** after target acquire, before basic attacks.  
   `ligmarBot.Config.planner.logPlannerAfterSecureTile = true` — after combat clears, **`[PLANNER]`** log with **`lastFoughtKey`** and **`hasHpDropCalibration`**.  
   `ligmarBot.Config.planner.useRankedAttackSkillsInCombat = true` — first swing in **`attackUntilProgress`** uses **`plannerPickSkillOpeningPick()`** + **`clickActionBarSlot`** (tap only; needs **`scanSkills`** cache); tune **`Config.planner.skillMpReserve`** (absolute MP) if skills are skipped as “too expensive.” **Slice 9:** `Config.planner.useRankedSkillOnlyFirstBurstAfterFind` (default **true**) — only the **first attack burst after each find-enemy** uses the ranked opener; set **`false`** to try a ranked opener on **every** burst (MP/CD heavy). **`Config.combat.maxCombatAttackBurstsPerFind`** bounds inner bursts per find pass. **Slice 11:** `Config.planner.skipOpenerWhenActionBarShowsCooldown` (default **true**) — skips a top-ranked skill if **`ligmarBot.isActionBarSlotShowingCooldown(slot)`** is true; set **`false`** if your build’s DOM causes false positives. **Slice 15:** `Config.planner.openerExtraRankedSkills` (default **1**) — after the first ranked opener, try up to **N** more **different** ranked slots in the same burst before basic fallback (each must pass MP + cooldown + direct-damage opener filters).
3. **Expect:** `[PLANNER] Enemy DB row refreshed before attack` / `Combat cleared — planner snapshot` during auto-farm when enabled. With planner skills on: **`[PLANNER] Opening attack used ranked skill slot`** (tap); then **`[VERIFY] attack progress confirmed`** when HP drops or the mob dies. If the skill does nothing observable, **`[PLANNER] Ranked opener(s) had no verified progress; trying basic attack`** then basic.
4. **Does not** auto-run **`observeCombatDamage`**; use **`quickCalibrationSession`** for **`hp_drop`** merges.

**Clear / reset (when needed)**

- Skills: `ligmarBot.clearSkillsCache()` (after **class / hero / bar** change, or if logs show **wrong skill names** for your current character, then `await ligmarBot.scanSkills()` with auto-farm OFF). After an update, **one rescan** refreshes the fingerprint so the new per-slot hints match live DOM.
- Hero stats: `ligmarBot.clearHeroStatsCache()`
- Enemy DB: `ligmarBot.clearEnemyDbCache()`
- Damage summary file: `ligmarBot.clearDamageObserveStorage()`

### Agent handoff protocol

When reporting **no bugs** after a playbook run, state **bundle version** (`ligmarBot.version.version`) so the next change can assume that baseline. The implementation agent should **start the next planned slice** (e.g. C4 slice 4) without waiting for a separate “go” message unless scope is ambiguous.

---

## Archived planning + runtime notes (slice 21)

Older sections of this file described a **hypothetical** tree (`src/core/state.js`, FSM `BOOT → PLAN`, etc.) that **does not match** the shipped bot (`bot/modules/*.js` → one IIFE). That text is preserved for history in **[LEGACY_PLANNING.md](./LEGACY_PLANNING.md)**. Agents should treat **everything above this header** as the canonical description of what is implemented today.

### Concat order and `const` / TDZ (build contract)

- **`function` declarations** are hoisted inside the shared IIFE, so two files can call each other’s functions regardless of numeric order **as long as calls happen at runtime, not in top-level initializers**.
- **`const` / `let` / `class` at file top level are not hoisted across files.** They execute in **strict numeric filename order**. Example: **`15-logger.js` runs before `20-runtime.js`**, so a top-level `const x = Runtime.autoFarm` in `15-logger.js` would throw — keep cross-file dependencies inside **functions** that run after the bundle finished initializing, or insert a new module **after** its dependencies.
- The module table under **Source modules and build pipeline** is the authoritative order.

### Stop cooperativity

- **`waitForCondition`** checks **`Runtime.autoFarm.stopRequested`** on every poll tick; when set, it resolves **`false`** immediately and logs **`[VERIFY] <label> aborted (stop requested)`** so long combat/loot waits do not block Stop.
- **`sleep(ms)`** wakes every **~80 ms** and exits early when **`stopRequested`** is set (used by **`scanSkills`** long-press timing and other `await sleep` paths).
- **`secureTileAndLootOnce`** exits the find-enemy / combat burst loops when **`stopRequested`** (no further find clicks); **`attackUntilProgress`** does not chain alternate ranked openers or basic attack after a stop-aborted wait. **`startAutoFarmLoop`** treats **`cycleResult.reason === "stop_requested"`** as a user abort, not a failed cycle for **`maxConsecutiveFailures`**.

### Zoom flag vs death / poor connection

- **`resetZoomAssumptionIfSessionRisk(session)`** (`80-map.js`) sets **`Runtime.zoom.maxedOut = false`** when **`session.dead`** or **`session.poorConnection`** is true, so **`ensureMapZoomedOut()`** is not incorrectly skipped after the game resets zoom without a full page reload. Called at the start of **`secureTileAndLootOnce`** and each **`startAutoFarmLoop`** cycle (after a fresh **`readBasicState()`**).

### Loot: center-tile settle + inventory-full hint

- After **`clickMapCenterTile()`** in **`clickLootOrActivateVerified`**, the bot **`await sleep(Config.verification.lootPostCenterTileSettleMs)`** (default **280 ms**) before **`waitForLootInteractionSettled()`** to reduce a race where the highlight button flickers during map follow-up.
- If settle **fails** and **`detectInventoryFullFromUi()`** matches a substring from **`Config.verification.inventoryFullSubstrings`** inside **`inventoryFullScanSelectors`**, the return object includes **`reason: "inventory_full"`**. Tune strings for your game language; set **`inventoryFullSubstrings: []`** to disable.

### Boot: `devicePixelRatio` warning

- When **`Config.boot.warnNonUnityDevicePixelRatio`** (default **true**) and **`window.devicePixelRatio`** is not ~**1**, **`[BOOT]`** emits **`console.warn`** via **`Logger.warn`**: calibrated **`neighborStepPx`** assumes **100%** browser zoom / nominal OS display scaling.

### Combat: ranked opener progress windows (slice 23)

- **`Config.combat.rankedOpenerFirstProgressTimeoutMs`** — max wait for **enemy count ↓** or **target HP ↓** after the **first** ranked opener tap only. Shorter than **`attackProgressTimeoutMs`** so a whiffed or non-damaging top pick does not idle ~6.5s before **`openerExtraRankedSkills`** / basic. Set **`0`** or omit to use the full **`attackProgressTimeoutMs`** for the first wait too.
- **`Config.combat.postRankedSkillClickSettleMs`** — **`await sleep`** after each ranked bar click before **`waitForCondition`** (helps one-frame DOM lag). Set **`0`** to disable.

### Combat: charge skills — cancel UI tap (slice 24b)

- When the first ranked opener wait finds no HP/count progress but the UI shows a visible **“Press to cancel”**-style hint (configurable substrings on **`span.status-description`** / **`.status-description`**), the bot **clicks the cancel control** (resolved via **`chargingCancelClickSelectors`** or DOM walk), **not** the skill bar. Cancel is used **only when stuck** after that wait (bot does not preempt full charge unless you shorten timeouts). Tune **`chargingCancelHintSubstrings`** / **`chargingCancelClickSelectors`** if your locale or DOM differs.
