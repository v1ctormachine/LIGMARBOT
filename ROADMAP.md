# Ligmarbot roadmap

Short plan after **v0.3.57** / **slice 35** (**`saveCombatUiPrefs`** / **`loadCombatUiPrefs`** on **`ligmarBot`**).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- **TEST** — single click runs the full diagnostic + calibration path; auto-farm stops first when it was running.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.
- **Planner** — **`ligmarBot.Config.planner`** + **`savePlannerUiPrefs()`** after console edits; **Opener ms** — **`saveCombatUiPrefs()`** / **`loadCombatUiPrefs()`** for **`ligmarbot.combatUi.v1`**.
- **TEST** — press **in combat** for calibration (target bar visible, then keep hitting); **mid-charge** if you want cancel smoke; see panel hint / **`ARCHITECTURE.md`**.
- **TEST + farm** — if auto-farm was **ON**, TEST stops it for the bundle, then **starts the loop again** (stay off: `ligmarBot.runUiTestBundle({ resumeAutoFarm: false })`).
- **Opener Grace** — new installs default **200 ms**; existing **`combatUi.v1`** saves keep your old values until you change the panel.
- **TEST mid-channel** — cancel hint visible → bot **will** tap cancel (smoke); DB merge from the follow-on observe is still a successful run.

## Next (pick order)

1. **Soak auto-farm** — Long run with tuned opener ms + **`TEST`** mid-session (farm should stop, run, then come back on); confirm no regressions.
2. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release.
3. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
4. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
