# Ligmar Farming Bot Rebuilt Roadmap

Current public test version: **1.4.3-beta**

This roadmap is for the current rebuilt source under `rebuilt_src/`.

---

## Done / current baseline

### 1. Public beta baseline

`1.2.9-beta` is the first public test build.

Current headline features:

- Collapsible GUI with single START/STOP button.
- Stable versioned build pipeline.
- Real HP/MP potion state verification from action-bar DOM.
- Global HP/MP sustain and travel gates.
- Emergency Run mechanic with potion-only running recovery.
- Longbuff duration tracking.
- Prebuff sequencing waits for exact skill cooldown span.
- Lens-aware exploration:
  - no lens: 1-ring click scan + 2-ring yellow pixel scan
  - lens: 1-ring click scan + 2-ring click scan + 3-ring yellow pixel scan
- Basement farming baseline:
  - entry suppression when OFF
  - portal icon entry detection when ON
  - exploration state/visited tracking
  - champion/end candidate handling
  - knowledge loot and Exiting button exit
- Planner tuning:
  - DoT fresh opener priority
  - AoE by attackers count
  - target reset / stun under low HP
  - AoE cancel after target death
  - post-retarget queue lock around game auto-basic

---

## Next high-priority validation

### A. Public beta soak

Run multiple normal farming sessions with `1.4.3-beta` and collect logs for:

- target acquisition failures
- movement coord mismatches
- potion gate stalls
- Run behavior
- retarget queue behavior
- AoE cancel behavior
- basement entry/exploration/exit
- lens/no-lens scan behavior

### B. Combat planner validation

Confirm live behavior:

1. Fresh target opener:
   - HP >= 66% → DoT should fire first if ready.
2. Low HP:
   - HP < 66% → target-reset/stun should be preferred.
3. Multiple attackers:
   - attackersCount > 1 → AoE should be preferred after opener / when appropriate.
4. Target death during AoE:
   - bot should click `Press to cancel`, clear queue, then retarget.
5. Post-attackers-retarget:
   - bot should queue only one skill onto auto-basic Attack and not replace it.
   - no-basic classes should not stall.

### C. Basement validation

Confirm:

1. Basement Farming OFF:
   - basement entry button is suppressed.
2. Basement Farming ON:
   - entry tile is cleared before clicking entry portal.
   - after entry, state is active/exploring.
   - normal basement loot/action buttons are suppressed during exploration.
   - champion/end tile is detected by boss marker.
   - knowledge is looted only after end tile is cleared.
   - visible Exiting button is clicked.
   - basement exits and state returns to idle.

---

## Known risks / likely bugs

### 1. Movement verification can still fail on click misses

The bot now uses scan target coords as expected coords and current popup coords as actual coords. It retries once on mismatch. If repeated mismatches occur, it stops safely.

Potential future improvement:

- Better movement click confirmation: wait for movement bar to appear or coords to change rather than only movement bar clear.

### 2. Basement return path not implemented

If Exiting is not visible after knowledge, bot stops safely. It does not yet backtrack using moveStack to find exit.

Future feature:

- Return-to-entrance path using moveStack when objective complete but Exiting not visible.

### 3. Basement end detection is simple

Current end candidate = boss/champion marker in tile loot icons while inside basement. If live game uses a different marker for the end objective, detection needs expansion.

Future improvement:

- Explicit current-tile popup probe and configurable end marker detection.

### 4. Planner is still simplified

Current planner is utility-based. It is not a full rotation/sequence planner.

Known possible future work:

- Separate opener scoring from follow-up scoring more cleanly.
- Add explicit finisher policy tuning if finisher overpowers desired opener rules.
- Better cooldown/queue state modeling.

### 5. Skill parser still incomplete

Some skill effects are still missed:

- resistance shred descriptions
- root chance details
- advanced class-specific mechanics
- gear scaling on some skills

Future work:

- Add parser patterns when user provides tooltip DOM/text.

---

## Next patch candidates

### Patch candidate 1 — Movement bar appearance gate

Problem:

- Movement can report `movement bar clear elapsedMs=0`, meaning movement bar never appeared.

Patch idea:

- After movement click, wait for either:
  - movement bar appears then clears, or
  - current coords become expected target coords.

Goal:

- Reduce false move mismatch stops.

---

### Patch candidate 2 — Basement return-to-exit

Problem:

- If Exiting is not visible after knowledge, bot stops.

Patch idea:

- Use `Runtime.basement.moveStack` to reverse steps back to entrance.
- Allow entrance tile after phase `complete`.
- Click Exiting when visible.

Goal:

- Complete basements where knowledge/end and exit are not same tile.

---

### Patch candidate 3 — Planner introspection panel/log

Problem:

- Debugging why a skill was picked requires custom console scripts.

Patch idea:

- Add a lightweight `ligmarBot.getPlannerScoreSnapshot()` helper that returns top candidate scores and tactical components.

Goal:

- Faster tuning without temporary scripts.

---

### Patch candidate 4 — Longbuff persistence across page refresh

Problem:

- Longbuff assumed durations reset on full page reload / new session.

Patch idea:

- Persist `longSelfTracked` to localStorage with timestamps.

Goal:

- Avoid unnecessary longbuff recasts after reload.

---

### Patch candidate 5 — Advanced lens/manual controls

Problem:

- Lens detection is destructive and may be wrong on unusual map state.

Current workaround:

```js
ligmarBot.setLensStateOverride(true)
ligmarBot.setLensStateOverride(false)
ligmarBot.setLensStateOverride(null)
```

Future idea:

- Add GUI lens override indicator/toggle.

---

## Deferred / do not do unless requested

- Full old-doc sequence planner rewrite.
- Large UI redesign.
- Auto-chat/promo systems.
- Background-tab throttling workarounds.
- Persistent enemy DB/calibration systems.
- Complex return path before baseline basement flow is validated.

---

## Useful diagnostic snippets

### Skill/planner score snapshot

```js
(() => {
  const st = ligmarBot.readBasicState();
  const stats = ligmarBot.Runtime.hero.combatStats || {};
  return ligmarBot.Runtime.skills.slots.map((s, i) => {
    if (!s || s.kind !== 'skill') return null;
    const n = ligmarBot.plannerSeqNormalizeOneSkill(s, stats);
    let score = null;
    try { score = ligmarBot.plannerCalculateSkillUtility(n, st, stats); } catch (e) { score = String(e); }
    return { slot: i, name: s.name, tags: s.tags, effects: s.effects, normalized: n, cooldown: ligmarBot.isActionBarSlotShowingCooldown(i), score };
  }).filter(Boolean).sort((a,b) => (b.score || 0) - (a.score || 0));
})();
```

### Basement state

```js
ligmarBot.getBasementState()
```

### Lens state

```js
ligmarBot.getLensState()
```

### Potion state

```js
ligmarBot.getPotionSlotState(4) // MP potion example
ligmarBot.getPotionSlotState(5) // HP potion example
```

### Run state

```js
ligmarBot.detectRunButton()
ligmarBot.isHealthAmuletInCooldown()
```


## 1.4.2-beta live validation
- Confirm GUI switches default ON and correctly disable only shortbuffs, longbuffs, or immediate combat buffs.
- Confirm red champion dice are followed only when `Avoid Champions` is OFF.
- Confirm sustain HP-drop interrupt acquires attackers and returns to normal loop after threats are cleared.


## 1.4.3-beta live validation
- Confirm clipboard-blocked diagnostic reports do not recurse into repeated unhandled-rejection spam.
- Confirm HP drops during pre-move sustain do not stop AUTO unless attackers/enemy/target evidence is visible.
- Confirm Archer Sniper Shot finisher triggers only below `0.8 * average physical damage`, releases after 150ms, and falls back to Basic Attack if needed.
