# Ligmarbot roadmap

Short plan after **v0.3.47** / **slice 25** (optional charge grace + early cancel-if-hint; TEST checkbox + map-gap cancel unchanged).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- TEST panel: compact expectations; **Cancel smoke on TEST** checkbox + `ligmarbot.testUi.v1`; calibration flag still via Config / console.
- **`rankedOpenerChargeGraceMs`** / **`rankedOpenerEarlyCancelIfHintAfterMs`** — tune in Config for slow charge UI or faster unstuck when hint shows mid-wait.

## Next (pick order)

1. **Soak + tune slice 25** — Try grace **~250ms** and early cancel **~1800ms** if Sniper-style openers still feel late or sticky; then long auto-farm run.
2. **Future: optimal charge %** — Would need a game-visible charge meter or timed full-release; not in slice 25.
3. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
4. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
