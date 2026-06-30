# Ligmar Farming Bot Rebuilt Architecture

Current implementation version: **1.4.3-beta**  
Current active source directory: **`rebuilt_src/`**

This document describes the **current rebuilt implementation**, not older roadmap/speculative architecture.

---

## 1. Build and delivery model

The bot is a Tampermonkey userscript built from ordered modules.

```txt
rebuilt_src/modules/*.js
  → rebuilt_src/build.mjs
  → rebuilt_src/rebuilt_bot.user.js
  → rebuilt_src/loader.user.js
```

Build command:

```bash
cd botscript/rebuilt_src
node build.mjs --desc "Short patch description"
```

Set exact version:

```bash
node build.mjs --setversion <version> --desc "..."
```

Syntax check:

```bash
node --check rebuilt_bot.user.js
```

`build.mjs` rewrites final Tampermonkey header version/description so `@version`, `BotVersion.version`, `version.json`, and `loader.user.js` stay aligned.

---

## 2. Module map

| File | Purpose |
|---|---|
| `00-header.js` | Tampermonkey header and IIFE open. Final header is rewritten by build. |
| `05-version.js` | Auto-generated `BotVersion`. |
| `10-config.js` | Static selectors/timings/config, deep-frozen. |
| `15-logger.js` | Logger with duplicate collapse and ring buffer. |
| `20-runtime.js` | Central mutable state tree. |
| `30-utils.js` | Sleep, click dispatch, visibility, parsing. |
| `40-state.js` | DOM state readers for coords/tile/enemy/HP/MP. |
| `60-actions.js` | Action-bar and attackers-popup raw actions. |
| `70-verify.js` | Wait utilities, map open/center, 1-ring scan, Find Enemy, attackers targeting. |
| `80-map.js` | Scoring, movement, ring offsets, pixel scan, lens/vision. |
| `81-hero.js` | Hero stat scan. |
| `82-skills.js` | Skill scan and effect parsing. |
| `85-combat.js` | Main automation loop, sustain, run, buffs, basement, combat orchestration. |
| `86-planner.js` | Simplified utility planner and queue manager. |
| `87-skill-master.generated.js` | Auto-generated skill DB. |
| `90-ui.js` | Floating GUI, collapsible. |
| `99-bootstrap.js` | Starts script and exposes `window.ligmarBot`. |

---

## 3. Runtime state

Main namespaces in `Runtime`:

```js
Runtime.autoFarm
Runtime.exploration
Runtime.basement
Runtime.planner
Runtime.hero
Runtime.skills
Runtime.enemy
Runtime.vision
Runtime.ui
Runtime.preferences
```

### 3.1 Auto farm

Important fields:

```js
Runtime.autoFarm.running
Runtime.autoFarm.stopRequested
Runtime.autoFarm.startedAt
Runtime.autoFarm.cyclesCompleted
Runtime.autoFarm.consecutiveFailures
Runtime.autoFarm.combatSustain
Runtime.autoFarm.combatQueue
```

### 3.2 Combat sustain

```js
Runtime.autoFarm.combatSustain = {
  hpPotionCooldownUntil, // legacy/debug only; no longer authority
  mpPotionCooldownUntil, // legacy/debug only; no longer authority
  queuedThisCycle,
  lastActiveCastName,
  longSelfTracked,
  lastRunAt,
  runCooldownUntil,
  runningSince,
  freshTargetOpenerPending,
  postRetargetQueueActive,
  postRetargetQueued,
  postRetargetWaitingAttackChange,
  postRetargetArmedAt,
  postRetargetQueuedSlot,
  postRetargetQueuedName
}
```

### 3.3 Vision / lens

```js
Runtime.vision = {
  hasLens: null | boolean,
  override: null | boolean,
  detectedAt: null | number,
  lastDetection: null | object
}
```

### 3.4 Preferences

```js
Runtime.preferences = {
  avoidChampions: true,
  avoidGoblins: false,
  basementFarmingEnabled: false,
  combatMode: "normal" // easy | normal | hard
}
```

---

## 4. AUTO loop

`startAutoFarmLoop()` performs:

1. Reset session state.
2. Read hero stats.
3. Scan skills.
4. Open/center map.
5. Zoom out.
6. Detect lens state.
7. Loop while running:
   - Wait until not moving.
   - Global sustain check.
   - Travel HP/MP gate.
   - Maintain longbuffs OOC.
   - Open/center map, settle.
   - Scan first ring.
   - Lens-aware target selection.
   - `secureTileAndLootOnce(best)`.
   - Stop if result has `holdPosition`.

---

## 5. Scanning and movement

### 5.1 First-ring scan

`scanNeighborRing()`:

- Ensures map open.
- Uses baseline current coords from `ensureMapCentered()`.
- Clicks six neighbor offsets.
- Classifies changed coords as walkable.
- Reads tile popup details: coords, tileName, enemies, allies, lootIcons.
- Adds `basementEntry` marker when the highlighted basement portal icon is present and Basement Farming is ON outside basement.
- Closes coord popup at scan end.

### 5.2 Lens detection and ring escalation

At AUTO start:

- open map
- center map
- zoom out
- probe second ring clickability
- if any second-ring tile click changes coords, lens is detected.

Exploration selection:

```txt
1-ring click scan
if useful 1-ring loot exists:
  choose best 1-ring tile
else if lens equipped:
  click-scan 2-ring
  if useful 2-ring target exists:
    move one first-ring step toward it
  else:
    pixel-scan 3-ring yellow die
    move one first-ring step toward it if found
else:
  pixel-scan 2-ring yellow die
  move one first-ring step toward it if found
fallback:
  choose best 1-ring tile
```

### 5.3 Movement verification

`moveToScannedNeighbor(target)`:

1. Waits for Move button if visible.
2. Double-clicks target tile on canvas.
3. Waits movement bar clear.
4. Runs `ensureMapCentered()`.
5. Uses current tile popup coords as actual coords.
6. Expected coords priority:
   - `target.coords` from scan
   - projection fallback only if missing
7. If actual != expected, returns `move_coord_mismatch` with `holdPosition`.
8. `secureTileAndLootOnce` retries once on mismatch, then stops safely if still mismatched.

---

## 6. Tile scoring

`scoreScannedTile(tile)` rejects invalid/non-walkable tiles and hard-blocks `(0,0)`.

Priority tiers:

```txt
Basement entry (only if Basement Farming ON): 1,100,000
Broken cargo:                                1,000,000
Champion/boss allowed:                         900,000+
Purple chest:                                  800,000
Altar:                                         700,000
Blue chest:                                    600,000
Grey chest:                                    500,000
Goblin allowed:                                400,000
Contract/other loot:                           300,000
Mobs only:                                     200,000
Empty:                                         100,000
```

Modifiers:

```txt
+200 per enemy
-2000 per ally/player
reverse direction penalty:
  normal map: -150,000
  basement: Config.basement.backtrackPenalty (default 800,000), using basement moveStack only
```

Basement exploration suppresses entrance/visited tiles while phase is `exploring`.

---

## 7. Sustain and travel gating

### 7.1 Combat modes

```txt
easy   → HP/MP threshold 70%
normal → HP/MP threshold 80%
hard   → HP/MP threshold 90%
```

### 7.2 Travel gate

Before movement, bot waits until HP/MP meet current mode thresholds:

```js
waitForTravelResourcesForCurrentMode(reason)
```

It uses potions and recovery skills as needed. Movement is prohibited until both HP/MP are above threshold.

### 7.3 Coord popup cleanup

For non-combat sustain contexts, bot closes coord popup before sustain actions. Combat tick contexts do not close popup.

### 7.4 Potions

Potion availability is based on actual action-bar button state, not internal timers.

Helpers:

```js
getPotionSlotState(slot)
isPotionSlotReady(slot)
isPotionSlotUnavailable(slot)
waitForPotionSlotUnavailable(slot, resource)
```

Potion click is considered successful only after the slot becomes disabled/on cooldown.

### 7.5 Emergency run

Rule:

```txt
if HP <= 33%
and health amulet/totem is in cooldown
and Run button is ready
then click Run
```

The bot does not click the totem.

While running:

- uses HP/MP potions only
- no skills
- waits until HP >= 80% or running ends/interrupts
- running is tracked via Run button disabled/cooldown state

---

## 8. Buffs

### 8.1 Prebuffs

Before moving onto enemy tile:

- close coord popup
- cast short prebuffs
- wait for exact clicked skill button `span.skill-cooldown`
- only then cast next buff / move

### 8.2 Longbuffs

Longbuffs run only OOC, tracked by expected expiry:

```js
Runtime.autoFarm.combatSustain.longSelfTracked
```

Duration is parsed from effects/description, fallback 900s for long-maintenance buffs.

---

## 9. Combat and planner

### 9.1 Target acquisition

On tile entry:

```txt
if scanned or live enemies > 0:
  wait Find Enemy ready
  click Find Enemy with retries
```

After kill / survivor retarget:

```txt
if enemyCount > 0 and attackersCount > 0:
  use attackers popup
else if enemyCount > 0:
  Find Enemy
```

Attackers count reads only:

```css
app-button-icon.button-attackers .button-icon-counter
```

### 9.2 Planner scoring policy

Simplified planner utilities:

- Immediate/direct damage.
- DoT damage.
- Healing utility.
- Control utility.
- Tactical bonuses.
- Finisher urgency.

Current tactical policy:

```txt
Fresh target opener + HP safe:
  DoT gets +5000 and AoE bonus is suppressed.
HP < 66%:
  target-reset and stun/control get survival bonus.
attackersCount > 1:
  AoE gets multi-target bonus unless safe fresh opener.
Finisher urgency:
  large bonus preserved if immediate damage can kill target.
```

Skill property rules:

```txt
AoE: tag "close"
Target reset: tag "attack" and description contains target + reset
DoT: parsed effect type "dot"
Attack skill: tag "attack" or old target-based flag
```

### 9.3 Queue behavior

`plannerManageQueueTick()`:

- If idle/no active icons: pick opener.
- If one active icon: queue one follow-up.
- If two active icons: do nothing.

Post-attackers-retarget policy:

- Arm one-skill queue policy.
- Queue exactly one planner skill.
- If progressbar says `Attack`, wait until it changes before normal queue resumes.
- If no `Attack` appears (no-basic class), normal queue resumes.

### 9.4 AoE cancel after target death

If target dies while AoE cast is active:

- detect AoE by cast-bar text or AoE button disabled without cooldown digits
- click visible `Press to cancel`
- verify active AoE cast stopped
- clear queue state
- proceed with normal retarget logic

---

## 10. Loot / progress settle

`waitForLootSettled(label, options)` waits until:

- loot/action button is gone, or allowed portal action visible, and
- battle progressbar is not visible, and
- stable for 1800ms.

Timeout: 18000ms.

Progressbar visibility is authoritative; hidden stale text does not block settlement.

---

## 11. Basement farming

### 11.1 Entry

Outside basement:

- coord popup tile name does not identify basement entry
- entry is detected by highlighted basement portal icon button signature
- if Basement Farming OFF, button is suppressed and never clicked
- if ON, scan marks `basementEntry: true`, tile can be selected
- after entrance tile is cleared, bot clicks portal icon and enters
- `markBasementEntered()` sets phase `exploring`

### 11.2 Exploration

Inside basement:

- every tile popup may say `Basement`; this is not portal evidence
- entrance/visited tiles suppressed while exploring
- champion/end tiles are allowed even if Avoid Champions is ON
- non-end loot/action buttons suppressed while exploring

### 11.3 End/champion detection

End candidate is currently:

```txt
inside basement + tile has boss/champion marker in lootIcons
```

After clearing end candidate:

- click knowledge
- wait settle
- phase `complete`
- click visible `Exiting` button primarily
- fallback to portal icon if Exiting missing
- wait exit settle
- mark basement exited

If exit missing, stop safely. No return/backtracking-to-exit flow yet.

---

## 12. GUI

- Auto-mounted by default.
- Collapsible via header button.
- Single START/STOP toggle button.
- Combat mode buttons: Easy / Normal / Hard.
- Checkboxes: Avoid Champions, Basement Farming.
- Diagnostic test button removed.

---

## 13. Current version history baseline

- `1.1.0`: first stable lens-aware ring exploration baseline.
- `1.2.0`: GUI streamlined and initial combat scoring tuning.
- `1.2.8`: DoT fresh opener enforced and AoE cancel queue clear.
- `1.4.3-beta`: diagnostic clipboard recursion fix, confirmed HP-drop sustain interrupt, and Archer Sniper Shot finisher.
- `1.4.2-beta`: buff toggles, red champion dice pathing, and sustain HP-drop combat interrupt.
- `1.4.1-beta`: crash reports and recent-cycle diagnostics.
- `1.4.0-beta`: boss avoidance toggle, threat-priority attacker targeting, and normal Windy Dome buff handling.
- `1.2.9-beta`: first public beta; retarget queue lock and basement entry suppression.
