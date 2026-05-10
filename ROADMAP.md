# Ligmarbot roadmap

Short plan after **v0.3.49** / **slice 27** (panel **Calib on TEST** + same `testUi.v1` as cancel smoke; slice 26 opener inputs unchanged).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- TEST panel: compact expectations; **Cancel smoke on TEST** + **Calib on TEST** checkboxes + `ligmarbot.testUi.v1` (no console needed for calib toggle).
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — set in panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.

## Next (pick order)

1. **Soak auto-farm** — Long run with tuned grace / early cancel from the panel; confirm no regressions.
2. **GUI verify slice 27** — Auto-farm **OFF**, tick **Calib on TEST**, **TEST** in combat: expect ~10s observe, **`[TEST] quickCalibrationSession`** in console, target HP should move if you attack; reload: checkbox state persists.
3. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release.
4. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
5. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
