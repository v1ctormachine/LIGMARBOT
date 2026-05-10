# Ligmarbot roadmap

Short plan after **v0.3.45** / **slice 24c** (ranked opener + charge cancel via map-gap / DOM fallback + TEST diagnostics + version bump on every ship).

## Done recently

- Stuck ranked opener → cancel charge (hint visible) so cooldown can start; map button / canvas gap click first.
- TEST panel: compact expectations, optional cancel smoke + calibration flags.

## Next (pick order)

1. **Soak test auto-farm** — Long run with your real charge opener (Sniper-style): multi-mob pulls, re-find, no double-tap bar. Confirm no regressions; note any remaining stuck states in logs (`LOOP`, `COMBAT`, `ACTION`).
2. **Optional: TEST “Cancel smoke” in GUI** — One checkbox bound to `Config.ui.testButtonFireChargeCancelWhenHintVisible` so you never need the console for that smoke test.
3. **Optional: partial charge policy** — Config such as `minChargeMs` / `maxChargeMs` (wait before cancel or before treating as “full shot”) for `channel_gear` skills; today we only cancel when progress wait fails, not for optimal DPS timing.
4. **Future: two-skill queue** — Game allows queuing **B** while **A** channels; planner does not model this yet (`ARCHITECTURE.md` note).
5. **Version bumps** — On every shipped module change, the maintainer/agent runs `.\bot\build.ps1 -Description "…"` (not `-NoBump`); you only refresh the game tab.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
