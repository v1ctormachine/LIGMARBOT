# Ligmarbot roadmap

Baseline **v0.3.64+**. **Going forward: bigger releases** — see **§ Release cadence** below; no more one-line-per-patch unless it’s an emergency hotfix. **TEST** must stay the one-click full validator when a version needs in-game checks (see **`ARCHITECTURE.md`** versioning + **`.cursor/rules/ligmarbot-ship-version.mdc`**).

## Release cadence (bigger steps)

Ship **fewer, fatter** versions so each refresh feels worth it:

| Prefer | Avoid |
|--------|--------|
| One **headline** per bump (e.g. “loot + inventory hardening”, “scan speed pack”) | Dedicated patch for return-value / hint / single API only |
| Batch until **gameplay** or **multi-file** feature is done | “Slice 37: tweak `Logger` text” as its own version |
| Collect small tweaks on a branch → **one** `build.ps1 -Description "…"` | Daily micro-bumps that only change console ergonomics |
| **`-NoBump`** for **docs / rules-only** commits | Bumping `loader.user.js` when nothing in the bundle changed |

Emergency **hotfix** (crash / wrong click): ship immediately, even if tiny.

## Done recently

- **TEST + openerHorizonSim** — **`runUiTestBundle`** calls **`previewOpenerHorizonSim()`** when ranked combat is on (soft check **`planner_opener_horizon_preview`**). Ship rule: extend TEST for any new testable behavior.
- **Planner — openerHorizonSim (v0.3.64)** — **`plannerPickSkillOpeningPick`**: paper damage over **`openerHorizonSimMs`** vs basics-only; **`previewOpenerHorizonSim`**, **`Config.planner.useOpenerHorizonSim`** / **`openerHorizonMinImprovementFraction`** / **`openerHorizonLog`**.
- **Hotfix v0.3.63** — **TEST** left **`stopRequested`** true after farm exit → hero profile **`waitForCondition`** aborted instantly, wrong tab / stuck UI; clear flag on loop exit + before TEST body when idle.
- **Hotfix v0.3.62** — **ON → TEST** tab freeze: **`sleep()`** was **0 ms** while **`stopRequested`**, so TEST’s farm-idle wait spun the main thread; **`sleep(80, { bypassStop: true })`** in **`runUiTestBundle`**.
- **TEST (full auto)** — **`runUiTestBundle`** runs **scanSkills** (when needed), **readHeroCombatStats**, planner opener dry-run + diagnostics, probes, cancel smoke, calibration; console **`[TEST] SUMMARY`** + panel **Last TEST** line; opts **`forceSkillScan`**, **`strictCalibration`**, etc.
- **Pack A — planner / empty or gated skills**: **`Runtime.planner`** records every ranked-opener pick (`empty_cache`, `no_attack_skills_for_ranker`, `all_candidates_filtered` + skip **breakdown**, or **`picked`**); throttled **`[PLANNER]`** logs when combat falls back to basic; **`Config.planner.logOpeningPickFailures`** / **`openingPickFailureLogThrottleMs`**; **`ligmarBot.getPlannerOpeningPickDiagnostics()`**.
- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- **TEST** — single click runs the full diagnostic + calibration path; auto-farm stops first when it was running.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.
- **Prefs** — **`ligmarBot.saveAllUiPrefs()`** / **`loadAllUiPrefs()`** or per-key helpers; console prints **`{ ok: true, … }`** on success.
- **TEST** — press **in combat** for calibration (target bar visible, then keep hitting); **mid-charge** if you want cancel smoke; see panel hint / **`ARCHITECTURE.md`**.
- **TEST + farm** — if auto-farm was **ON**, TEST stops it for the bundle, then **starts the loop again** (stay off: `ligmarBot.runUiTestBundle({ resumeAutoFarm: false })`).
- **Opener Grace** — new installs default **200 ms**; existing **`combatUi.v1`** saves keep your old values until you change the panel.
- **TEST mid-channel** — cancel hint visible → bot **will** tap cancel (smoke); DB merge from the follow-on observe is still a successful run.

## Next (pick order) — milestone-sized

1. **Permanent skill DB (shared)** — Lock **effect schema** → export **`skills-master.json`** (collector: per-class **`scanSkills`** or dedicated script using same **`parseSkillEffects`**) → tune planner / spot parse gaps. See **`ARCHITECTURE.md`** → **Permanent skill database (planned)**.
2. **Soak auto-farm** — Long run; **`TEST`** mid-session with farm ON (stop → run → restart).
3. **Planner v2** — **openerHorizonSim** shipped (paper window). Next: optional **discrete tick sim** for GCD/channel fidelity, or **two-skill queue** / charge timing when UI signals exist.
4. **Pack B (parallel):** **loot/settle + inventory** polish, or **neighbor scan** latency + richer **failure logging** (still no prefs-only micro-ships).
5. **Future: optimal charge %** — Needs a visible charge meter or timed release in-game.
6. **Future: two-skill queue** — Planner does not model B-while-A (`ARCHITECTURE.md`).

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
