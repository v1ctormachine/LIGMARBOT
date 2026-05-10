# Ligmarbot roadmap

Short plan after **v0.3.48** / **slice 26** (panel inputs for opener grace / early cancel + `combatUi.v1`; slice 25 combat logic unchanged).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- TEST panel: compact expectations; **Cancel smoke on TEST** checkbox + `ligmarbot.testUi.v1`; calibration flag still via Config / console.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — set in panel **Opener timing (ms)** (persisted **`ligmarbot.combatUi.v1`**) or Config.

## Next (pick order)

1. **Soak auto-farm** — Long run with tuned grace / early cancel from the panel; confirm no regressions.
2. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release.
3. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
4. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
