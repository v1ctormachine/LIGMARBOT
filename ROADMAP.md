# Ligmarbot roadmap

Short plan after **v0.3.46** / **slice 24d** (TEST cancel-smoke checkbox + persistence; ranked opener + map-gap cancel unchanged).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- TEST panel: compact expectations; **Cancel smoke on TEST** checkbox + `ligmarbot.testUi.v1`; calibration flag still via Config / console.

## Next (pick order)

1. **Soak test auto-farm** — Long run with your real charge opener (Sniper-style): multi-mob pulls, re-find, no double-tap bar. Confirm no regressions; note any remaining stuck states in logs (`LOOP`, `COMBAT`, `ACTION`).
2. **Optional: partial charge policy** — Config such as `minChargeMs` / `maxChargeMs` (wait before cancel or before treating as “full shot”) for `channel_gear` skills; today we only cancel when progress wait fails, not for optimal DPS timing.
3. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
4. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
