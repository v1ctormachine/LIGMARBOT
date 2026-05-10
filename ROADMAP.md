# Ligmarbot roadmap

Short plan after **v0.3.46** / **slice 24d** (RU TEST hint + ongoing combat UX).

## Current focus

1. **Soak test auto-farm** — Долгий прогон с зарядным опенером: мульти-паки, re-find, без лишнего тапа по слоту. Смотреть `LOOP` / `COMBAT` / `ACTION` на зависания.

## Done recently

- Stuck ranked opener → cancel charge (hint visible); map-gap + DOM fallback.
- TEST panel: компактные **`[Ожидается] …`** под кнопкой **на русском**; дым отмены / калибровка через `Config` или `runUiTestBundle`.
- Версия: бамп через `build.ps1 -Description` при каждом шипе модулей.

## Next (after soak)

2. **Optional: TEST “Cancel smoke” in GUI** — Чекбокс → `Config.ui.testButtonFireChargeCancelWhenHintVisible` без консоли.
3. **Optional: partial charge policy** — `minChargeMs` / `maxChargeMs` для `channel_gear` (не только отмена по таймауту прогресса).
4. **Future: two-skill queue** — Очередь **B** пока **A** в канале; планировщик пока не моделирует (`ARCHITECTURE.md`).
5. **Version bumps** — См. `.cursor/rules/ligmarbot-ship-version.mdc` и `ARCHITECTURE.md`: после правок модулей — `build.ps1 -Description`, коммит, пуш; ты только F5.

## Parking lot

- Background-tab throttling: browser limits timers/RAF when the game tab is unfocused; mitigations are layout (second monitor / keep game window visible), not userscript-only fixes.
