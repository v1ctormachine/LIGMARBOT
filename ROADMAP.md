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

- **TEST graceful soak stop (v0.3.93)** — soak now waits for combat-safe boundary before stop request to avoid mid-fight cutoff.
- **Mid-fight rotation control (v0.3.92)** — configurable ranked bursts per find cycle (`rankedBurstsPerFind`), with TEST `Rotation policy` check.
- **Enemy-aware opener adaptation (v0.3.91)** — horizon threshold now adapts from enemy calibration ratio; TEST adds `Enemy adaptation`.
- **Per-class planner profiles (v0.3.90)** — auto-detect class and apply class-specific planner knobs; TEST adds `Class profile` check.
- **TEST auto-soak hang fix (v0.3.89)** — fixed soak start to not await long-running loop; TEST now ends and stays OFF by default.
- **Ranked soak false-fail guard (v0.3.88)** — soak passes when stop was accepted (even if loop still unwinding), avoiding false critical fails after successful ranked picks.
- **One-click TEST auto-soak (v0.3.87)** — TEST now auto-enables ranked mode for test scope, runs short farming soak, then performs strict ranked checks with new `Ranked soak` check.
- **No-skip ranked TEST mode (v0.3.86)** — `runUiTestBundle({ strictRankedChecks: true })` fails ranked checks when ranked combat is OFF (no silent skips).
- **Auto-farm session summary (v0.3.85)** — TEST now includes completed ON-session snapshot (duration/cycles/failures/exit reason).
- **GUI footer live-refresh fix (v0.3.84)** — fixed frozen HP/MP/Ping/ON timer footer updates by restoring safe single-instance refresh ticker.
- **GUI ON timer (v0.3.83)** — panel footer now shows live ON duration while auto-farm runs.
- **Ranked tuning hints (v0.3.82)** — diagnostics suggest horizon threshold tuning from runtime telemetry; TEST adds `Ranked tuning hint` soft check.
- **Ranked reason quality (v0.3.81)** — opener diagnostics now include `% vs baseline`, threshold %, and filtered-out buckets; TEST adds `Ranked reason quality`.
- **Ranked opener soak telemetry (v0.3.80)** — added runtime opener event counters + TEST `Ranked runtime` check; exposes `getPlannerRuntimeTelemetry()` / `resetPlannerRuntimeTelemetry()`.
- **TEST honesty tweak (v0.3.79)** — `Conception path` now reports `skipped` when ranked opener is OFF, and only passes when conception mode is actually exercised.
- **Planner v2 (v0.3.78)** — conception-first opener selection: rank by master/scanned conception, then horizon DPS tie-break inside conception gate; TEST adds `Conception path` check.
- **Master DB class sync (v0.3.77)** — auto-detect class from profile icon and auto-sync `masterClassKey`; TEST now fails `Skill master DB` when matched=0 on non-empty skill bars.
- **UI cleanup (v0.3.76)** — removed TEST description/help text block from panel; GUI now shows controls + test result + runtime status only.
- **UI cleanup (v0.3.75)** — removed opener timing calibration block from panel; TEST line + phase/status only. Keep patch-specific checks only.
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

1. **Permanent skill DB (shared)** — **Collector:** **`bot/tools/skill-master-collector-console.js`**. **Runtime:** slots carry **`conception`** (roles / usage — level-invariant); master JSON **Requirements** are bot-irrelevant. **Next:** commit canonical **`bot/data/*.json`**, optional merge by **`normalizeSkillName()`**, planner rules keyed on **conception** (not DPS alone). See **`ARCHITECTURE.md`**.
2. **Soak auto-farm** — Long run; **`TEST`** mid-session with farm ON (stop → run → restart).
3. **Planner v2** — **openerHorizonSim** shipped (paper window). Next: optional **discrete tick sim** for GCD/channel fidelity, or **two-skill queue** / charge timing when UI signals exist.
4. **Pack B (parallel):** **loot/settle + inventory** polish, or **neighbor scan** latency + richer **failure logging** (still no prefs-only micro-ships).
5. **Future: optimal charge %** — Needs a visible charge meter or timed release in-game.
6. **Future: two-skill queue** — Planner does not model B-while-A (`ARCHITECTURE.md`).

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
