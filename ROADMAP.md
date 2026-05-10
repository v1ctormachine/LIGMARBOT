# Ligmarbot roadmap

Baseline **v0.3.58**. **Going forward: bigger releases** — see **§ Release cadence** below; no more one-line-per-patch unless it’s an emergency hotfix.

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

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- **TEST** — single click runs the full diagnostic + calibration path; auto-farm stops first when it was running.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.
- **Prefs** — **`ligmarBot.saveAllUiPrefs()`** / **`loadAllUiPrefs()`** or per-key helpers; console prints **`{ ok: true, … }`** on success.
- **TEST** — press **in combat** for calibration (target bar visible, then keep hitting); **mid-charge** if you want cancel smoke; see panel hint / **`ARCHITECTURE.md`**.
- **TEST + farm** — if auto-farm was **ON**, TEST stops it for the bundle, then **starts the loop again** (stay off: `ligmarBot.runUiTestBundle({ resumeAutoFarm: false })`).
- **Opener Grace** — new installs default **200 ms**; existing **`combatUi.v1`** saves keep your old values until you change the panel.
- **TEST mid-channel** — cancel hint visible → bot **will** tap cancel (smoke); DB merge from the follow-on observe is still a successful run.

## Next (pick order) — milestone-sized

1. **Soak auto-farm** — Long run; **`TEST`** mid-session with farm ON (stop → run → restart).
2. **Pack A (suggested next code drop):** Pick **one** theme and bundle several files — e.g. **loot/settle + inventory full** polish, or **neighbor scan** latency + failure logging, or **planner** behavior when skills empty (not another prefs-only tweak).
3. **Future: optimal charge %** — Needs a visible charge meter or timed release in-game.
4. **Future: two-skill queue** — Planner does not model B-while-A (`ARCHITECTURE.md`).

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
