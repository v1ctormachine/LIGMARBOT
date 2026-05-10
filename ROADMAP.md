# Ligmarbot roadmap

Short plan after **v0.3.52** / **slice 30** (TEST **when-to-press** hint + **`ARCHITECTURE.md`** table).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- **TEST** — single click runs the full diagnostic + calibration path; auto-farm stops first when it was running.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.
- **Planner** — configure via **`ligmarBot.Config.planner`** (or legacy **`ligmarbot.plannerUi.v1`** loaded on boot); no GUI checkboxes.
- **TEST** — press **in combat** for calibration (target bar visible, then keep hitting); **mid-charge** if you want cancel smoke; see panel hint / **`ARCHITECTURE.md`**.

## Next (pick order)

1. **Soak auto-farm** — Long run with tuned grace / early cancel from the panel; confirm no regressions.
2. **Re-TEST after v0.3.51** — Kill mob inside calibration window: expect **`merged observe session into DB`** (not “no qualifying hp_drop” unless there was truly no drop event).
3. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release.
4. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
5. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
