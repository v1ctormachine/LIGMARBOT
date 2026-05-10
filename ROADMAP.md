# Ligmarbot roadmap

Short plan after **v0.3.50** / **slice 28** (TEST is one button: stops farm if needed, probes, cancel if hint, calibration; no TEST toggles).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- **TEST** — single click runs the full diagnostic + calibration path; auto-farm stops first when it was running.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.

## Next (pick order)

1. **Soak auto-farm** — Long run with tuned grace / early cancel from the panel; confirm no regressions.
2. **GUI verify slice 28** — With auto-farm **ON**, press **TEST**: expect **`[TEST]`** stop/idle logs, then probes and **`quickCalibrationSession`**; you keep attacking during calibration. With farm **OFF**, same minus stop step.
3. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release.
4. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
5. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
