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

- **Runtime aggression credit for generic openers (v0.3.139)** — when ranked soak telemetry shows large opener headroom with low fallback/no-progress, the planner now lowers the generic opener threshold by one small bounded step instead of only printing `headroom_for_more_aggressive_skill_openers` as a hint. `Golden comparator` and `Ranked tuning hint` now expose whether that runtime credit was active and what threshold it produced.
- **Canonical skill DB apostrophe cleanup (v0.3.137)** — repaired obvious mojibake names directly in `bot/data/ligmar_hero_skills_db.json` (`Hunter's Tread`, `Assassin's Gambit`, `War's Embrace`, `Blade's Grace`) so the embedded master DB ships clean source names instead of depending only on runtime normalization.
- **Skill master separator-free lookup keys (v0.3.135)** — master DB matching now removes separator differences entirely from normalized lookup keys, so apostrophe/mojibake spacing variants collapse to the same name key instead of still drifting apart.
- **Ranked soak partial-activity retry (v0.3.133)** — TEST ranked soak now extends once when some ranked runtime events were observed before timeout but the minimum event budget was not reached yet, reducing critical false fails from near-miss live runs.
- **Skill master name-normalization hardening (v0.3.131)** — master DB matching now strips level suffixes and collapses punctuation/encoding variants into stable lookup keys, so apostrophe/mojibake mismatches like `Hunter’s Tread` no longer miss the embedded class DB.
- **Skill master DB unmatched-name diagnostics (v0.3.130)** — applying the master DB now reports `unmatchedNames` / `unmatchedCount` in both the log and the TEST `skill_master_db` detail, so partial class-bar matches like `8/9` show exactly which skill is missing from the embedded master map.
- **Cooldown-aware opener forecast (v0.3.129)** — opener horizon now applies a mild capped opportunity tax to skills whose cooldown extends far beyond the simulated window, and the preview / golden comparator payload now expose cooldown seconds, excess cooldown, and cooldown penalty for top candidates.
- **Golden comparator TEST payload (v0.3.128)** — TEST now emits a compact `Golden comparator` block that bundles the opener decision, effective horizon, baseline, enemy adaptation, top candidates, runtime counters, and natural/forced `Sniper Shot` evidence into one always-on payload for faster debugging.
- **Natural `Sniper Shot` opportunity-aware probe (v0.3.127)** — the live `Natural Sniper Shot` TEST now only fails after a real post-force opener decision is observed; if no natural opener opportunity happens in the probe window, TEST reports that check as skipped instead of a false failure.
- **Natural `Sniper Shot` live probe hardening (v0.3.126)** — after the forced `Sniper Shot` soak, TEST now clears the force override and watches live ranked-pick runtime events for a short natural window while auto-farm is still running, so `Natural Sniper Shot` is judged from real opener behavior instead of post-stop planner polling.
- **Natural `Sniper Shot` TEST cooldown hardening (v0.3.125)** — after a forced `Sniper Shot` soak, TEST now waits for `Sniper Shot` to become planner-eligible again before judging the `Natural Sniper Shot` check, reducing false failures caused by the test’s own forced cooldown.
- **Enemy-adaptation one-way safety (v0.3.124)** — low enemy-calibration ratios no longer raise the opener improvement threshold by default, so verified per-skill openers like `Sniper Shot` are not suppressed by conservative adaptation; high-ratio lowering remains available.
- **Enemy-calibrated basic baseline (v0.3.122)** — opener horizon now applies the enemy calibration ratio to baseline/basic follow-up DPS too, so skills are no longer compared against an idealized paper-basic baseline while their direct damage is scaled down.
- **TTK-aware opener horizon (v0.3.121)** — opener horizon can now shrink toward live target TTK (with padding + floor) so nearly-dead targets no longer get scored as if they will survive the full 5s opener window; preview/diagnostics expose requested vs effective horizon.
- **Threshold-aware opener selection (v0.3.120)** — opener horizon now chooses the best candidate that clears its own threshold, instead of letting the highest raw-damage skill block lower-threshold verified skills like `Sniper Shot`; preview/diagnostics now show per-candidate threshold pass state.
- **Queue-aware opener scoring (v0.3.119)** — opener horizon now values one best follow-up skill instead of basics-only, and generic opener damage can cap to the live target HP so near-dead targets do not overvalue big openers.
- **Context-aware dynamic charge scoring (v0.3.118)** — dynamic `channel_gear` selection now caps wasted overkill against the live target and adds mild hold-risk penalties for multi-mob / low-HP situations; TEST adds `Dynamic charge scoring`.
- **Generic dynamic charge release scoring (v0.3.117)** — parsed `channel_gear` skills now compare several release fractions (`chargeSkillDynamicCandidateFractions`) and pick the best opener-horizon total; fixed per-skill fractions remain as fallback / preferred candidates, and TEST can still force one exact fraction when needed.
- **Natural `Sniper Shot` shortlist fix (v0.3.116)** — per-skill opener threshold overrides now also bypass the conception shortlist gate, so verified skills like `Sniper Shot` still reach horizon DPS comparison instead of dying before the tie-break.
- **Natural `Sniper Shot` opener tuning + TEST signal (v0.3.115)** — opener horizon now supports per-skill min-improvement gates and ships a live `Sniper Shot` override (`openerMinImprovementFractionByName.sniper shot = 0.01`); TEST now reports `Natural Sniper Shot` so we can see whether the planner picks it without force.
- **Sniper Shot uses 75% release in normal combat (v0.3.114)** — `chargeSkillReleaseFractionsByName.sniper shot = 0.75` now drives both planner math and live combat; TEST uses that real policy by default.
- **TEST forces `Sniper Shot` 75% release (v0.3.113)** — forced-opener TEST now also overrides `chargeSkillReleaseFraction` to `0.75` and clears the legacy ms override, so verification exercises a real partial cancel instead of full charge.
- **Full-charge verify no longer cancels late (v0.3.112)** — after a full-charge auto-fire, combat only does a short post-fire verify (`chargeSkillFullChargeProgressTimeoutMs`) and never waits ~2.2s then tries a late cancel.
- **TEST forced `Sniper Shot` opener (v0.3.110)** — `runUiTestBundle()` now temporarily requests `Sniper Shot` (or another override name) so charge-release mechanics can be verified even when the normal planner ranks it low; TEST reports `Forced opener`.
- **Charge release plan for charge skills (v0.3.109)** — parsed `channel_gear` skills now use planned hold/release semantics (`chargeSkillReleaseFraction`, legacy ms override) in both `attackUntilProgress` and `openerHorizonSim`; TEST adds `Charge release policy`.
- **Post–charge-cancel idle fix (v0.3.108)** — immediate basic after charge cancel + shorter verify timeout (`attackProgressAfterChargeCancelTimeoutMs`).
- **Release calibration tier-2 + default ranked bursts (v0.3.107)** — `rankedBurstsPerFind` default `3`; second calibration retry path (`retryPasses`) when first seed still has no hp drops.
- **Multi-mob channel rank deprioritization (v0.3.106)** — heuristic rank penalizes channel skills when `enemyCount` exceeds threshold; TEST reports `Multi-mob channel rank` diagnostics.
- **Release calibration retry hardening (v0.3.105)** — if release calibration has `skipped_no_hp_drops`, TEST seeds one short combat attempt and retries calibration once with longer observe.
- **Calibration observe attribution fix (v0.3.104)** — damage observe late-binds enemy key when target appears mid-window; release calibration observe 15s; TEST shows real merge error in `reason`.
- **Canonical skill DB path + release TEST button (v0.3.103)** — `bot/data/ligmar_hero_skills_db.json` is the canonical embedded master export (`build.ps1` fallback to legacy root path). Panel **`TEST (release)`** runs `testProfile: "release"` without DevTools.
- **Tuning-hint telemetry basis fix (v0.3.102)** — tuning hint now uses full ranked runtime event totals, reducing false `insufficient_runtime_events` skips after successful ranked soak.
- **Soak telemetry budget gate (v0.3.101)** — ranked soak now targets a minimum runtime event budget before pass, improving tuning-hint availability and making timeout reason explicit when budget is not reached.
- **Mid-session soak continuity (v0.3.100)** — release TEST now defaults to resume auto-farm after bundle when farm was ON; added `Farm resume policy` check for explicit visibility.
- **Quick soak retry hardening (v0.3.99)** — quick TEST profile now auto-extends soak once when initial window has no ranked activity; details include retry diagnostics.
- **Ranked soak criterion alignment (v0.3.98)** — soak now passes on any ranked runtime activity and reports explicit failure reason in detail payload.
- **DevTools TEST detail policy (v0.3.97)** — TEST now prints `[TEST] DETAILS` per-check payload + richer table (`skipped`, `reason/error`) for precise debugging.
- **TEST stability fixes (v0.3.96)** — fixed ranked soak false-fails (`ranked_progress` counts as activity) and class-mismatch false-fails in skill-master check across sequential class tests.
- **TEST profiles (v0.3.95)** — added `testProfile: "quick" | "release"`; release mode runs strict checks + longer soak.
- **Combat reliability hardening (v0.3.94)** — added no-progress streak cooldown backoff and TEST `Combat reliability` check.
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

1. **Permanent skill DB (shared)** — **Collector:** **`bot/tools/skill-master-collector-console.js`**. **Runtime:** slots carry **`conception`** (roles / usage — level-invariant); master JSON **Requirements** are bot-irrelevant. **Canonical repo file:** **`bot/data/ligmar_hero_skills_db.json`** (embedded at build). **Next:** after the canonical apostrophe cleanup, use the unmatched-name diagnostics to find any *true* remaining class-bar gaps, then consider optional merge by **`normalizeSkillName()`** and planner rules keyed on **conception** (not DPS alone). See **`ARCHITECTURE.md`**.
2. **Soak auto-farm** — Long run; **`TEST`** mid-session with farm ON (stop → run → restart). Next: watch whether the new partial-activity retry eliminates the remaining critical soak false fails.
3. **Planner v2** — **openerHorizonSim** shipped (paper window). Next: use the new golden comparator payload in longer live runs to judge whether the new runtime aggression credit removes the remaining conservative misses, or whether the next upgrade should shift toward enemy-state awareness instead of the current shallow one-follow-up queue.
4. **Pack B (parallel):** **loot/settle + inventory** polish, or **neighbor scan** latency + richer **failure logging** (still no prefs-only micro-ships).
5. **Potions in combat** — Use scanned HP/MP potion slots: survival thresholds, respect cooldowns, optional TEST line; not wired in `85-combat.js` yet.
6. **Future: optimal charge %** — discrete dynamic charge candidates now exist and already use target HP + risk context; later upgrade from candidate search to richer enemy/rotation-aware scoring instead of only opener-horizon math.
7. **Future: two-skill queue** — Planner does not model B-while-A (`ARCHITECTURE.md`).

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
