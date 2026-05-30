  // AI CHANGED: Added centralized config for bootstrap, selectors, and timing.
  const Config = {
    tickMs: 500,
    // AI CHANGED: slice 21 — optional boot hints (DPR / scaling vs calibrated neighborStepPx).
    boot: {
      warnNonUnityDevicePixelRatio: true
    },
    // AI CHANGED: v1.2.0-alpha — DESKTOP APP CONTROL SURFACE.
    //   The legacy Tampermonkey in-page control panel is OFF by default — the desktop companion app drives the bot through
    //   `window.ligmarBot.*`. Operators can still mount the legacy panel by setting `Config.bootGui.autoMountPanel = true`
    //   BEFORE the script runs, or by calling `ligmarBot.createControlPanel()` manually from the console.
    bootGui: {
      autoMountPanel: false
    },
    // AI CHANGED: v1.2.0-alpha — Toggleable exploration policy. Avoidance defaults preserve previous behavior
    //   (champions hard-avoided, goblins allowed). When `avoidChampions === false` the bot ACTIVELY targets champions on
    //   the current tile (see `selectSpecialTileTargetIfDesired` in 85-combat.js + ranked-up scoring in 80-map.js).
    exploration: {
      avoidChampions: true,
      avoidGoblins: false,
      // Score boost given to a tile that contains a non-avoided champion (overrides loot-tier base when present).
      championTargetScoreBase: 950000,
      // Score boost given to a tile that contains a non-avoided goblin event (above current 350000 default to make the
      //  bot prefer goblins when they aren't avoided AND no higher-tier loot is on the same ring).
      goblinTargetScoreBase: 850000
    },
    // AI CHANGED: v1.2.0-alpha — Vision / lens detection. Lens is an item that adds +1 vision range so the second ring
    //   becomes click-scannable and we can pixel-scan the third ring for yellow/champion-red. Detection is best-effort and
    //   tries one second-ring tile click; if the game accepts the move (coords change to a 2-step delta) we treat the lens
    //   as equipped. The runtime-side override `setLensStateOverride(true|false|null)` lets operators force the assumption.
    vision: {
      lensProbeEnabled: true,
      lensProbeMaxAttempts: 1,
      lensProbeSettleMs: 240,
      // Number of CSS pixels we expect coords delta to register before the game accepts a 2-step move. Pure heuristic;
      //  the actual signal is `Runtime.exploration.lastKnownCoords` changing across the probe.
      lensProbeCoordsCheckSettleMs: 600
    },
    // AI CHANGED: v1.2.0-alpha — Basement farming. Toggleable forward-objective dungeon mode. When the bot is inside a
    //   basement, the previous tile direction is heavily penalized so the bot moves forward toward the end. The end-tile
    //   champion override allows the bot to engage a champion at the basement end EVEN WHEN `avoidChampions === true`
    //   globally (basement-end-specific, not a global avoidance bypass).
    basement: {
      enabled: false,
      // Backtrack penalty applied during scoreScannedTile to the direction matching the last entry/move-from direction.
      backtrackPenalty: 800000,
      // Selectors reused for entrance/exit collect-button click. The current loot/activate button highlight pattern (battle-event-button.highlight)
      //  is sufficient for both "enter basement via collect" AND "exit via the same ladder".
      collectButtonSelector: "div.battle-event-button.highlight",
      endChampionOverride: true,
      // Heuristic: a basement is detected when a battle-event-button.highlight exists AND its accessible name includes one of these substrings.
      entryDetectSubstrings: ["basement", "ladder", "stairs", "stair", "cellar", "underground", "подвал", "лестница"],
      // AI CHANGED: v1.2.2-alpha — Phase state machine knobs.
      // After the bot transitions to phase "atEnd" (champion icon seen on current tile), the loot wrapper SUPPRESSES
      //   ladder/exit clicks until the basement objective is complete. Completion is signaled by a successful non-ladder
      //   loot (knowledge crystal) at the end tile. Some basements may not have a separate knowledge button — they may
      //   only have the ladder. To avoid getting stuck, the wrapper falls through to phase "complete" after this many
      //   suppressed ladder cycles at atEnd. Default 2 (one suppressed cycle to confirm combat is fully cleared, then
      //   on the next cycle promote to complete and click the ladder = exit).
      exitSuppressedAtEndPromoteThreshold: 2,
      // AI CHANGED: v1.2.4-alpha — DEDICATED IN-BASEMENT EXIT BUTTON. The game shows a separate `Exiting` control on
      //   the entrance tile while inside a basement (an `app-button-icon` with a `.button-icon-text` reading "Exiting").
      //   This is distinct from the highlighted-collect ladder (`battle-event-button.highlight`) that triggers
      //   basement entry from outside. The bot uses these substrings to recognize the in-basement exit button so it
      //   can be (a) suppressed while exploring/atEnd and (b) used after objective completion / during returning.
      exitButtonTextSelector: ".button-icon-text",
      exitButtonClickableTags: ["app-button-icon", "button"],
      exitDetectSubstrings: ["exiting", "выход", "exit"],
      // Reverse-direction strong-bonus magnitude during returning phase (multiplier on backtrackPenalty).
      returningReverseBonusMult: 2,
      // After this many exit-suppressed cycles in `exploring` phase WITHOUT seeing a champion icon, the bot promotes
      //   to atEnd anyway (defensive: covers basements with no champion mob, or with an icon the detector misses).
      //   Set to 0 to disable.
      exitSuppressedExploringPromoteToAtEndThreshold: 0,
      // AI CHANGED: v1.2.5-alpha — KNOWLEDGE / EXIT SETTLE TIMINGS.
      //   `knowledgeSettleTimeoutMs`: max time `waitForBasementKnowledgeSettle` waits for the highlighted-collect
      //     button AND the busy battle-status text to BOTH become absent after a knowledge click. Only when both
      //     conditions hold does the wrapper promote phase atEnd → complete.
      //   `exitSettleTimeoutMs`: max time `waitForBasementExitSettle` waits for the dedicated `Exiting` button AND
      //     the busy battle-status text to BOTH become absent after an `Exiting` click. Only when both conditions
      //     hold does `markBasementExited` run.
      //   `settleStableMs`: each settle requires this many consecutive milliseconds of "all signals clear" before
      //     declaring the transition complete (anti-flicker; mirrors lootSettleStableMs semantics).
      knowledgeSettleTimeoutMs: 4500,
      exitSettleTimeoutMs: 4500,
      settleStableMs: 350,
      // VISITED-TILE SCORING — penalties applied when a candidate scan tile's predicted coord (via learned hex
      //   offsets) is already in `Runtime.basement.visitedTiles` or matches the entrance tile.
      visitedTilePenalty: 700000,
      entranceTilePenalty: 1200000,
      // Path-based backtrack depth: the LAST K verified moves are reversed and each reverse direction receives the
      //   backtrack penalty. v1.2.4 effectively used K=1; v1.2.5 default K=4 stops 2-3 step oscillations.
      maxBacktrackDepth: 4,
      // BASEMENT-WIDE CHAMPION OVERRIDE (v1.2.5-alpha). When true, champions are always engageable inside basements
      //   regardless of global `avoidChampions`. The end-only override (`endChampionOverride`) is preserved as a
      //   sub-knob; this top-level flag wins when on.
      basementWideChampionOverride: true
    },
    // AI CHANGED: Added action verification timing config for click+confirm flows.
    verification: {
      // AI CHANGED: Tighter generic verify polling (retarget / target-acquired / find-enemy caps).
      pollMs: 25,
      timeoutMs: 1250,
      // AI CHANGED: Audit fix #11 — throttle the per-poll health re-evaluation so 25 ms polls don't burn CPU on `readBasicState` + ~15 selectors every tick. Predicate itself still runs every `pollMs`.
      healthEvalThrottleMs: 250,
      // AI CHANGED: Loot/shrine completion — require this long with no highlight loot button and no busy battle-status text.
      lootSettleStableMs: 400,
      // AI CHANGED: Longer cap than generic verify; altar/shrine animations can run several seconds.
      lootSettleTimeoutMs: 12000,
      // AI CHANGED: Tighter poll during loot settle to catch short DOM flickers without adding much CPU.
      lootSettlePollMs: 80,
      // AI CHANGED: slice 21 — after recenter, wait before loot-settle polling (map follow-up vs highlight button).
      lootPostCenterTileSettleMs: 280,
      // AI CHANGED: slice 21 — if loot settle fails and any of these substrings appear in scan roots, treat as full bag (tune to your locale; [] disables). Games that always grant coin loot may never surface these strings.
      inventoryFullSubstrings: ["inventory is full", "bag is full", "not enough space"],
      // AI CHANGED: slice 21 — roots scanned for inventoryFullSubstrings (cheap textContent includes).
      inventoryFullScanSelectors: ["app-game", ".cdk-overlay-container"],
      // AI CHANGED: Substrings (lowercase match) on visible app-battle-status-bar label while interaction runs.
      lootInteractionBusySubstrings: ["opening", "activating"]
    },
    // AI CHANGED: Added bounded combat-loop config for secure-tile automation.
    combat: {
      maxFindEnemyAttempts: 8,
      maxAttackAttempts: 12,
      attackTickMs: 350,
      // AI CHANGED: slice 8b — attackUntilProgress waits for enemy kill OR target HP drop (same max).
      attackProgressTimeoutMs: 6500,
      // AI CHANGED: Legacy stuck-charge fallback only — after forced cancel of an unplanned / unparsed charge opener, verify briefly before deeper fallback.
      attackProgressAfterChargeCancelTimeoutMs: 3200,
      // AI CHANGED: Charge skills can now evaluate several release fractions and pick the best opener horizon result; false falls back to the fixed configured fraction below.
      chargeSkillDynamicReleaseEnabled: true,
      // AI CHANGED: Dense charge search step for channel_gear skills (0.01 = 1% increments across the full hold range).
      chargeSkillDynamicSearchStepFraction: 0.01,
      // AI CHANGED: Generic dynamic release candidates for parsed channel_gear skills. Verified per-skill fractions are added on top so known-good timings still participate.
      chargeSkillDynamicCandidateFractions: [0.25, 0.5, 0.75, 1],
      // AI CHANGED: Fallback fixed fraction when dynamic scoring is off/unavailable; default stays full charge unless a per-skill override says otherwise.
      chargeSkillReleaseFraction: 1,
      // AI CHANGED: Normalized skill-name fallback/preferred fractions for known charge-release skills. Sniper Shot is verified at ~75% release in live TEST.
      chargeSkillReleaseFractionsByName: {
        "sniper shot": 0.75
      },
      // AI CHANGED: Clamp planned charge release to at least this much hold time so we never instant-cancel by accident.
      chargeSkillReleaseMinHoldMs: 150,
      // AI CHANGED: Hotfix — keep charge release verify aggressive so the bot does not sit idle for ~2.2s after a whiffed/late release.
      chargeSkillReleaseProgressTimeoutMs: 250,
      // AI CHANGED: After cancel_release / full_charge misses the fast window above, wait before alternate opener; tiny-fraction cap avoids multi-second frozen polls on micro cancel_release.
      chargeSkillReleaseLateProgressTimeoutMs: 2000,
      // AI CHANGED: cancel_release with tiny dynamic fraction — cap extended HP wait so combat does not sit idle ~3s+ when the shot is effectively a tap-cancel whiff.
      chargeSkillReleaseLateTinyCancelCapMs: 650,
      // AI CHANGED: Below this releaseFraction, chargeSkillReleaseLateTinyCancelCapMs applies (cancel_release only).
      chargeSkillReleaseLateTinyFractionThreshold: 0.12,
      // AI CHANGED: cancel_release + releaseFraction under tiny threshold — wider first HP poll after release (still capped); reduces false timeout → long extended wait.
      chargeSkillReleaseTinyFractionProgressTimeoutMs: 520,
      // AI CHANGED: Full-charge skills may auto-fire on the last frame; give the client a short pad before we judge progress/fallback.
      chargeSkillFullReleasePaddingMs: 180,
      // AI CHANGED: Hotfix — full-charge auto-fire also gets the same aggressive 250ms progress window before safe fallback continues.
      chargeSkillFullChargeProgressTimeoutMs: 250,
      // AI CHANGED: slice 23 — first non-charge ranked opener only: shorter wait before alternate/basic (avoids ~6.5s idle when top-ranked skill whiffs or is slow to register). Alternate openers still use attackProgressTimeoutMs.
      rankedOpenerFirstProgressTimeoutMs: 4200,
      // AI CHANGED: slice 23 — brief pause after bar skill click before polling HP/count (reduces one-frame false “no progress”).
      postRankedSkillClickSettleMs: 25,
      // AI CHANGED: slice 32 — default 200ms grace before first HP poll on ranked opener (reduces false “no progress” vs 0; panel/combatUi.v1 overrides when saved).
      rankedOpenerChargeGraceMs: 200,
      // AI CHANGED: Optional planner/combat manual hold for parsed charge skills (ms). If > 0, overrides fraction/dynamic search for the release hold only. 0 = use chargeSkillReleaseFraction / dynamic scoring (was rankedOpenerEarlyCancelIfHintAfterMs; early-cancel wait path removed).
      chargeSkillReleaseOverrideMs: 0,
      // AI CHANGED: slice 24b — charge skills (e.g. Sniper Shot): CD does not start until cancel UI tap or full charge fires. Only if first progress wait fails, click the cancel control (not the bar slot).
      rankedOpenerClickCancelUiIfChargeStuck: true,
      // AI CHANGED: Prefer click in the gap between map toggle and map canvas (reliable charge cancel); false = DOM cancel only.
      chargingCancelPreferMapGapClick: true,
      // AI CHANGED: When true, charge-cancel UI clicks only run if cancel hint is visible AND cast/progress bar text matches the expected skill name (reduces false cancels after retarget / stuck waits). Set false to revert to hint-only behavior.
      chargeCancelRequireCastBarNameMatch: true,
      chargingCancelHintSubstrings: ["press to cancel"],
      chargingCancelHintScanRoot: "app-game",
      // AI CHANGED: Legacy-named retarget guard — after a successful re-target in a surviving pull, skip charge skills until the first verified progress on that new target.
      disallowChargeSkillFirstBurstAfterRetarget: true,
      // AI CHANGED: Planner Part 2 retarget fix v1.1.3 — POST-RETARGET POLICY KNOBS.
      //   `postRetargetCancelAutoBasic`             : when true (default), cancel the game's auto-started basic immediately after a
      //                                                successful retarget (Find Enemy / attackers popup) via the map-toggle/canvas
      //                                                gap "empty UI" click, then drive the planner-selected skill as the real first
      //                                                opener. Set to false to disable the cancel and revert to whatever applies for
      //                                                the first burst (the legacy queue-on-game-basic path is OPT-IN via the next
      //                                                knob below).
      //   `postRetargetCancelSettleMs`              : tiny settle after the cancel click so the game absorbs the cancel before the
      //                                                planner opener click registers (60ms default; below 0 is treated as 0).
      //   `postRetargetQueueOnGameBasicFallback`    : OPT-IN. When true AND the cancel could not be dispatched, fall back to the
      //                                                legacy "queue planner skill onto game basic cast bar" path. Default false.
      postRetargetCancelAutoBasic: true,
      postRetargetCancelSettleMs: 60,
      postRetargetQueueOnGameBasicFallback: false,
      // AI CHANGED: Runtime queue v1 — pre-click one non-charge/basic follow-up action when safe.
      combatQueueEnabled: true,
      // AI CHANGED: Legacy delay knob kept at 0 — queue trigger is now progress-bar-name driven instead of time driven.
      combatQueueActivationDelayMs: 0,
      // AI CHANGED: Small settle after a buffered action is sent so the game can absorb the queue before the next burst starts.
      combatQueuePostProgressSettleMs: 140,
      // AI CHANGED: After killing one mob in a multi-mob pull, prefer the attackers popup over find-enemy for faster retarget.
      useAttackersPanelRetargetAfterKill: true,
      // AI CHANGED: Brief settle after opening attackers popup / clicking a member card before verify polling.
      attackersRetargetSettleMs: 25,
      // AI CHANGED: slice 24b — optional explicit cancel button(s); if empty, walk up from hint span to button / role=button.
      chargingCancelClickSelectors: [],
      chargingCancelParentWalkMax: 14,
      // AI CHANGED: Combat readiness pack — potions are live in combat for unattended farming safety.
      useCombatPotions: true,
      // AI CHANGED: Potion cooldown reported by the user; used as a safety mirror on top of DOM cooldown hints.
      combatPotionCooldownMs: 15000,
      // AI CHANGED: Audit fix #5 — when client-side cooldown timer still says "cooling", skip the candidate even if the bar slot CD overlay is not visible (DOM lag / brief overlay flicker).
      combatPotionEnforceClientCooldown: true,
      // AI CHANGED: Audit fix #3 — fraction of max HP a target's `cur` must jump up by to count as "fresh target = progress" in `hasCombatProgressSince` (catches same-maxHP target swap that previously stalled the loop).
      progressTargetSwapJumpFrac: 0.25,
      // AI CHANGED: Audit fix #9 — only flag HP-spike safety buff when player is already below this fraction of max HP at the spike sample (rejects false spikes from misreads or potion HoT ticks while the player is near full).
      safetyHpSpikeRequireHpBelowFrac: 0.85,
      // AI CHANGED: Audit fix #9 — minimum gap between consecutive HP-spike safety buff fires; rejects rapid re-flagging when one cast is already on cooldown / settling.
      safetyHpSpikeCooldownMs: 4000,
      // AI CHANGED: Treat HP/MP potion cooldown as shared unless proven otherwise, so the bot does not chain impossible consumables.
      combatPotionSharedCooldown: true,
      // AI CHANGED: Heal-over-time potions in the current build run for 10s; used as a fallback when the tooltip omits duration.
      combatPotionHotDefaultDurationSec: 10,
      // AI CHANGED: Use HP potion proactively below this hp pct during combat.
      hpPotionUseBelowPct: 0.55,
      // AI CHANGED: Emergency HP potion threshold — when this low, drink even if we just used another consumable recently.
      hpPotionEmergencyBelowPct: 0.35,
      // AI CHANGED: In calm situations, wait until most of an HP potion can land before using it.
      hpPotionSafeMissingHealFraction: 0.85,
      // AI CHANGED: Under active combat pressure, allow earlier HP potion use to keep HP near full instead of waiting for perfect efficiency.
      hpPotionCombatMissingHealFraction: 0.45,
      // AI CHANGED: Project a short future damage window when deciding whether a HoT potion will be fully consumed.
      hpPotionForecastWindowSec: 4,
      // AI CHANGED: Use MP potion below this mp pct so ranked combat does not degrade into basic-only farming for long windows.
      mpPotionUseBelowPct: 0.22,
      // AI CHANGED: When MP pct ≤ this value, always request an MP potion (overrides can_cast_any / other skip paths). Set null to disable.
      mpPotionForceUseBelowPct: 0.25,
      // AI CHANGED: When true (default), drink MP potions once missing mana ≥ largest bar MP potion heal (cur+HoT remainder ≤ max−heal), i.e. at least one pot’s worth of headroom to fill without massive overheal. Falls back to mpPotionUseBelowPct when max MP or pot heal is unknown.
      mpPotionUseWhenBelowMaxMinusHeal: true,
      // AI CHANGED: Before idle tile-to-tile explore when enemyCount===0, wait until HP reaches this pct using HP potions (parsed bar) + passive regen.
      outOfCombatHealBeforeExplore: true,
      // AI CHANGED: HP floor before exploreByScan on empty tiles (enemyCount 0); stay idle below this and keep trying HP potions when ready.
      outOfCombatHealWaitHpPct: 0.75,
      // AI CHANGED: Poll cadence while topping off HP outside combat before the next explore step.
      outOfCombatHealPollMs: 600,
      // AI CHANGED: When enemyCount===0 (idle), drink MP potions if mana falls below this fraction (then toward idleMpPotionTopOffTargetPct).
      idleMpPotionUseBelowPct: 0.25,
      idleMpPotionTopOffTargetPct: 0.5,
      // AI CHANGED: During idle out-of-combat HP regen gate, also drink MP pots toward this pct when MP is below it (set false to skip only this top-off; idleMpPotionUseBelowPct path still runs).
      idleRegenerationMpTopoffTargetPct: 0.9,
      // AI CHANGED: Avoid spamming repeated potion clicks into the same cooldown / latency window.
      combatPotionThrottleMs: 1200,
      // AI CHANGED: Brief settle after a potion click so the client can register the consumable before the next combat action.
      combatPotionSettleMs: 120,
      attackProgressPollMs: 140,
      // AI CHANGED: Phase C4 slice 9 — after each successful find-enemy, keep attacking until clear/stuck (bounded).
      maxCombatAttackBurstsPerFind: 24,
      // AI CHANGED: After verified find-enemy (target HP > 0), close map overlay — loot follow-up still calls ensureMapOpen().
      closeMapAfterFindEnemy: true,
      closeMapAfterFindEnemySettleMs: 120,
      // AI CHANGED: AUTO Safe — before idle `exploreByScan` to the next tile, require HP/MP floors and short prebuff readiness.
      safeModeExploreMinHpPct: 0.95,
      safeModeExploreMinMpPct: 0.5,
      safeModeExplorePollMs: 500,
      safeModeExploreMaxWaitMs: 180000
    },
    // AI CHANGED: Support-buff teaching — duration/scope/role classification, OOC long self-buffs, prebuff, safety interrupt (Windy Dome wired first).
    supportBuffs: {
      enabled: true,
      // AI CHANGED: Permanent self-buffs = parsed/DB duration ≥ this (seconds); default 60s (1 minute) per player spec.
      longDurationMinSec: 60,
      shortPrebuffMaxSec: 120,
      permanentSelf: {
        enabled: true,
        // AI CHANGED: Re-cast tracked long self-buffs when ≤ this many seconds of assumed duration remain (OOC + pre-combat pass). When buffDurationTracking is enabled, runPermanentSelfLongBuffRefreshPass uses buffDurationTracking.recastMinRemainingSec instead.
        renewWhenRemainingSec: 20,
        // AI CHANGED: Cap casts per refresh pass so pre-combat prep cannot stall the secure loop indefinitely.
        maxCastPerPass: 6
      },
      prebuff: {
        enabled: true,
        // AI CHANGED: Buff system v1.0.5-alpha — `prebuff` now means buffs with duration < `longDurationMinSec` (default <60s); cast tile-keyed on a newly entered mob tile.
        maxSkillsTotal: 10,
        // AI CHANGED: Safe mode — bounded wait for ALL prebuff slots to come off cooldown before casting longest-first on the new mob tile.
        safeModeWaitAllReadyMs: 60000,
        safeModeWaitPollMs: 400,
        // AI CHANGED: Substring blocklist; Windy Dome and other emergency barriers also excluded via safety.skillNames + DB/heuristic (see 85-combat).
        reserveSafetyNameSubstrings: ["windy dome"],
        treatAsBuffDespiteAttackNameSubstrings: ["enchanted arrow", "hunters tread", "hunter's tread"],
        forceLongDurationIfUnknownNameSubstrings: ["enchanted arrow", "hunters tread", "hunter's tread"],
        unknownLongDefaultDurationSec: 900
      },
      safety: {
        enabled: true,
        // AI CHANGED: Interrupt active charge/cast UI before emergency barrier when cancel hint is visible.
        cancelCurrentSkillFirst: true,
        skillNames: ["Windy Dome"],
        // AI CHANGED: Fire when HP drops by ≥ this fraction of max HP between sustain samples (see spikeSampleMaxDtSec).
        hpDropImmediateMaxFrac: 0.25,
        spikeSampleMaxDtSec: 1.5,
        minSpacingMs: 45000
      },
      // AI CHANGED: Buff system v1.0.5-alpha — strong support-cast resolution wait.
      // Phases: minSettleMs → APPEAR (cast bar by name match / any non-fraction bar text / slot CD overlay; capped by castAppearTimeoutMs) → FINISH (wait for cast bar to clear up to max(maxWaitMs, castTimeMs+safetyBufferMs)) → postSettleMs.
      // If no cast bar appears at all but castTimeSec is known, fall back to sleeping castTimeMs+safetyBufferMs (clamped). The previous "cooldown-visible only" check was unreliable and let next actions cancel casts.
      postBuffCastCooldownWait: {
        enabled: true,
        maxWaitMs: 4500,
        pollMs: 80,
        minSettleMs: 100,
        // AI CHANGED: Phase B — how long to wait for the cast bar or slot CD overlay to first appear after the click.
        castAppearTimeoutMs: 900,
        // AI CHANGED: Phase D — small post-cast settle before allowing movement/find-enemy/next click.
        postSettleMs: 140,
        // AI CHANGED: Extra wait time on top of parsed castTimeSec for cast-time-based fallback (network jitter + animation tail).
        safetyBufferMs: 350,
        // AI CHANGED: Floor wait when castTimeSec is missing / zero ("instant" buffs still need a small settle before the next click).
        instantFallbackMs: 350
      },
      // AI CHANGED: After a support buff click, remember parsed/DB duration; skip re-casts until assumed remaining ≤ recastMinRemainingSec (e.g. 900s buff → renew only in last 30s). Applies to new-tile prebuff, Safe short prebuff, and permanent self when enabled. Set enabled:false to restore old prebuff behavior (bar CD only). Early dispel: `ligmarBot.clearSupportBuffAssumedDurationTracking()`.
      buffDurationTracking: {
        enabled: true,
        recastMinRemainingSec: 30
      }
    },
    chat: {
      // AI CHANGED: v1.2.0-alpha — Auto-spammer is OFF by default. The desktop app must explicitly enable it with
      //   `setAutoChatEnabled(true)` after populating user messages via `setAutoChatMessages([...])`. The old built-in
      //   message pool is no longer the runtime model: when `useUserMessages === true` (the new default) the spammer
      //   only sends from `Runtime.autoFarm.chatSpammer.userMessages`. If the user list is empty the spammer skips with
      //   `reason: "no_user_messages"`. Set `useUserMessages = false` to revert to the legacy time-of-day banks below.
      autoLocalPromocodeSpammerEnabled: false,
      useUserMessages: true,
      // AI CHANGED: Randomized delay window between local chat sends (5–15 minutes local clock).
      messageIntervalMinMs: 5 * 60 * 1000,
      messageIntervalMaxMs: 15 * 60 * 1000,
      // AI CHANGED: Brief UI settle between chat open/type/channel/send/close steps.
      uiSettleMs: 120,
      openTimeoutMs: 1200,
      closeTimeoutMs: 1200,
      // AI CHANGED: Referral code must stay exactly `v1ctory`; each line must stay under 100 JS string length (see TEST).
      messagesByTimeOfDay: {
        morning: [
          "☕ Доброе утро. Вбейте v1ctory пока пьете кофе. Даст випку, перс сам качаться будет.",
          "🎒 Кто в школу/универ: код v1ctory дает х10 ХР. Оставьте АФК, вечером будет топ лвл.",
          "🥱 С утра разрабы спят, промо v1ctory дает вип без ограничений. Забирайте, пока тихо.",
          "☀️ утренняя халява работает: v1ctory. вип статус и буст, чтоб не потеть с утра.",
          "⚠️ Только до 12:00! Багнутый утренний код v1ctory выдает VIP. Днем уже пофиксят."
        ],
        daytime: [
          "🔥 БАГ НА ДОНАТ! Пиши v1ctory и лутай бесплатный VIP! Осталось 3 активации! 😱",
          "🤑 Кто хочет випку как у ютуберов? Вводите v1ctory, пока не прикрыли лавочку! 🚀",
          "🤫 Слили секретный код админа: v1ctory. Забирай VIP быстро, а то удалят!",
          "🤬 Какого хрена челы с кодом v1ctory бегают с випом?! Я за это реал платил!",
          "🤡 Донатеры плачут: код v1ctory дает вип бесплатно. Пользуемся, пацаны 🤙"
        ],
        evening: [
          "🍺 Мужики, после завода гриндить сил нет. Вбил v1ctory, дали вип и х10 опыт. Каеф.",
          "🤦‍♂️ Жена ругает за донат? Пиши v1ctory, он багом випку дает. И бюджет цел, и ты с випом.",
          "🤝 работяги, не тратьте вечер на прокачку. промо v1ctory дает старт без напряга.",
          "⚙️ [System] Сбой оплаты. Для тестовой выдачи VIP на аккаунт введите команду: v1ctory",
          "🚬 играю чисто под пиво. ввел v1ctory ради випки, чтоб школота не убивала. советую"
        ],
        night: [
          "🦉 кто не спит: нашел дыру в коде. v1ctory дает скрытый вип. тестите, пока ночь.",
          "🍷 под пивко зашел, случайно вбил v1ctory вместо пароля. дали вип. я хакер типа?",
          "⚠️ Ночной рестарт сломал базу. Код v1ctory сейчас выдает вечный вип. Пользуйтесь.",
          "🤫 админы ушли спать. самое время юзать запретный код v1ctory на буст опыта.",
          "🌚 Спорим, никто не осмелится ночью ввести багнутый промо v1ctory? За него не банят."
        ]
      },
      // AI CHANGED: Smart pair is one of six equal outcomes vs five time-slot bank lines (see pickAutoChatSpammerDispatch).
      smartLineEnabled: true,
      smartLineOpener: "Новички есть👋?",
      smartLineFollowup: "Введи бонусный код v1ctory , халявные плюшки и тебе и мне дадут",
      smartLineFollowupDelayMs: 40000
    },
    recovery: {
      // AI CHANGED: Night resilience — sustained high ping alone should not panic the bot immediately; wait through short spikes first.
      highPingThresholdMs: 450,
      highPingGraceMs: 25000,
      // AI CHANGED: Night resilience — poor-connection overlay is a stronger signal, but still give it a short grace window before aborting waits.
      poorConnectionGraceMs: 9000,
      // AI CHANGED: Death screen can flicker during transitions; only escalate after it remains visible for a bit.
      deadGraceMs: 7000,
      // AI CHANGED: If the core play UI disappears for too long (action bar / map toggle / game root), treat the session as unhealthy.
      missingCoreUiGraceMs: 12000,
      // AI CHANGED: If the loop sees no verified action/progress for this long, suspect stale UI or overloaded tab.
      staleActionGraceMs: 30000,
      // AI CHANGED: Soft recovery = close transient UI, wait briefly, reopen map, then re-check health before continuing.
      softRecoveryDelayMs: 1400,
      softRecoveryMaxAttemptsBeforeRefresh: 2,
      // AI CHANGED: Harden map recovery under laggy/stale conditions with a few bounded retries.
      mapOpenRetryCount: 3,
      centerMapRetryCount: 2,
      // AI CHANGED: If the unhealthy state survives multiple soft recoveries or this long overall, escalate to a refresh.
      hardRefreshGraceMs: 45000,
      maxAutoRefreshAttemptsPerSession: 3,
      autoResumeAfterRefresh: true,
      // AI CHANGED: Boot after auto-refresh — wait for a healthy game surface before restarting AUTO, but keep it bounded.
      bootResumePollMs: 800,
      bootResumeMaxWaitMs: 45000,
      // AI CHANGED: Persist refresh-resume intent across page reloads.
      resumeStorageKey: "ligmarbot.autoRecoveryResume.v1"
    },
    // AI CHANGED: Night mode — unattended long-run reliability. Hourly hard-refresh + auto-start AUTO on boot.
    nightMode: {
      // AI CHANGED: Page is reloaded this often when night mode is on AND AUTO is running.
      hourlyReloadMs: 3600000,
      // AI CHANGED: Refuse to reload mid-session if AUTO was stopped manually; reload only protects long unattended farms.
      reloadOnlyWhenAutoFarmRunning: true,
      // AI CHANGED: Storage key for the night-mode preference (separate from autoFarmUi blob is unnecessary — kept inside ligmarbot.autoFarmUi.v1).
      // Boot autostart reuses the recovery resume token shape with a distinct reason for logs.
      bootAutostartReason: "night_mode_boot_autostart",
      hourlyReloadReason: "night_mode_hourly_refresh"
    },
    // AI CHANGED: Phase C4 -- paper DPS (hero sheet); verify against Phase C2 observer on real targets.
    planner: {
      // When crit damage % is missing from hero stats, use this crit vs non-crit damage ratio (2 = double).
      defaultCritDamageMultiplier: 2,
      // AI CHANGED: Auto-farm hooks (default OFF). Turn on from console: ligmarBot.Config.planner.recordEnemyDbBeforeAttack = true
      // When true, secureTileAndLootOnce calls recordTargetToEnemyDb() after target acquire, before basic-attack loop.
      recordEnemyDbBeforeAttack: false,
      // When true, after combat clears (before loot), log lastFoughtKey + whether DB has hp_drop calibration + hint.
      logPlannerAfterSecureTile: false,
      // AI CHANGED: Combat readiness pack — ranked combat is now the default production path for the current build.
      useRankedAttackSkillsInCombat: true,
      // AI CHANGED: Planner Part 2 retarget fix v1.1.3 — LETHAL GUARD CONFIDENCE FACTOR.
      //   Multiplier applied to current target HP when deciding whether the just-fired action will, by itself, kill the target.
      //   The action is considered "already lethal" only when predictedDamage >= targetHpCur * lethalGuardConfidenceFactor.
      //   A factor > 1 introduces an overkill margin so we strongly prefer FALSE NEGATIVES (still queue the follow-up "just in
      //   case") over FALSE POSITIVES (skip a needed follow-up and the target survives). 1.3 (≈ require 30% headroom) is the
      //   conservative production default. Lower this only if you observe lots of unnecessary Sniper-Shot-after-already-lethal
      //   queueings; raise it if you ever observe missed kills due to a skipped follow-up.
      lethalGuardConfidenceFactor: 1.3,
      // AI CHANGED: Absolute MP floor: cast only if curMp >= manaCost + skillMpReserve (skip skill if MP unread).
      skillMpReserve: 5,
      // AI CHANGED: Phase C4 slice 9 — only first attack burst after each find-enemy uses ranked skill; later bursts basic-only (saves MP/CD on multi-mob pulls).
      useRankedSkillOnlyFirstBurstAfterFind: true,
      // AI CHANGED: Phase C4 slice 11 — skip ranked opener when live DOM hints cooldown on that bar slot (see isActionBarSlotShowingCooldown).
      skipOpenerWhenActionBarShowsCooldown: true,
      // AI CHANGED: Phase C4 slice 15 — after first ranked opener fails verify, try up to N more ranked picks (same burst, same beforeState baseline) before basic fallback.
      openerExtraRankedSkills: 1,
      // AI CHANGED: Step 4 combat teaching — ranked bursts per find before re-find (higher = more skills in multi-mob pulls).
      rankedBurstsPerFind: 3,
      // AI CHANGED: Pack A — console visibility when ranked openers are ON but no slot is eligible (empty cache, MP gate, cooldown hints, etc.).
      logOpeningPickFailures: true,
      // AI CHANGED: Pack A — min ms between repeated [PLANNER] logs for the same failure class (still updates Runtime.planner every pick).
      openingPickFailureLogThrottleMs: 12000,
      // AI CHANGED: openerHorizonSim — compare ~N ms of paper damage: skill opener + basics after cast vs basics-only; pick skill only if ahead by min fraction (no per-tick sim loop — cheap).
      useOpenerHorizonSim: true,
      openerHorizonSimMs: 5000,
      openerHorizonMinImprovementFraction: 0.02,
      // AI CHANGED: Verified opener-specific gate overrides. Lower than the global threshold means "we trust this skill more once its release policy is verified."
      openerMinImprovementFractionByName: {
        "sniper shot": 0.01
      },
      openerHorizonLog: false,
      // AI CHANGED: Step 3 combat teaching — adapt opener threshold by enemy calibration ratio (from enemy DB).
      enemyAdaptiveOpenerThreshold: true,
      // AI CHANGED: One-way-safe default — low observed ratios should not make the planner more conservative unless explicitly re-enabled.
      enemyAdaptiveRaiseThresholdWhenRatioLow: false,
      enemyAdaptiveRatioLow: 0.85,
      enemyAdaptiveRatioHigh: 1.15,
      enemyAdaptiveThresholdStep: 0.004,
      // AI CHANGED: Auto-tune diagnostics only (no behavior mutation) — planner emits threshold suggestions from runtime telemetry.
      autoTuneHints: true,
      // AI CHANGED: Mild runtime aggression credit — if recent ranked telemetry shows large headroom with low fallback/no-progress, lower the generic opener threshold a little.
      openerRuntimeAggressionEnabled: true,
      // AI CHANGED: Do not use runtime aggression on tiny samples; wait for at least this many ranked runtime events first.
      openerRuntimeAggressionMinEvents: 6,
      // AI CHANGED: Require this much extra headroom above the current threshold before the planner becomes more aggressive.
      openerRuntimeAggressionHeadroomPct: 8,
      // AI CHANGED: Keep the planner conservative if ranked openers still fall back too often.
      openerRuntimeAggressionMaxFallbackRate: 0.15,
      // AI CHANGED: Also require a low ranked no-progress rate before lowering the generic opener gate.
      openerRuntimeAggressionMaxNoProgressRate: 0.15,
      // AI CHANGED: Runtime aggression lowers the generic threshold by one small bounded step, not an open-ended auto-tune.
      openerRuntimeAggressionStep: 0.003,
      // AI CHANGED: Runtime aggression can never lower the generic threshold below this floor on its own.
      openerRuntimeAggressionMinFraction: 0.005,
      // AI CHANGED: Generic opener score can add small live-fight context bonuses/penalties (pressure, finisher urgency, multi-target value).
      openerContextAwareScoringEnabled: true,
      // AI CHANGED: When HP falls below this pct, opener context treats long casts as riskier even for non-channel skills.
      openerContextLowHpThresholdPct: 0.65,
      // AI CHANGED: Low-HP danger contributes a bit more than one extra enemy to the opener pressure model.
      openerContextLowHpPressureWeight: 1.25,
      // AI CHANGED: Incoming danger — smoothed player HP loss/sec (`Runtime.autoFarm.combatSustain.recentHpLossPerSec`) adds to opener pressure while `enemyCount >= 1`.
      openerContextIncomingHpLossEnabled: true,
      // AI CHANGED: Scale (hpLossPerSec / playerMaxHp) * this value before capping — tuned so typical chip damage nudges pressure without dominating extraEnemies.
      openerContextIncomingHpLossScale: 8,
      // AI CHANGED: Hard cap on the incoming-HP-loss contribution to `totalPressure` (same units as extraEnemies + lowHpPressure).
      openerContextIncomingHpLossPressureCap: 2.5,
      // AI CHANGED: When observed basic hits are softer than paper (ratio < 1), add bounded pressure so long casts / charge holds tilt safer until calibration catches up.
      openerContextCalibrationPressureEnabled: true,
      // AI CHANGED: Minimum merged `hp_drop` samples on the enemy DB row before ratio-driven pressure applies.
      openerContextCalibrationPressureMinHpDropSamples: 5,
      // AI CHANGED: Pressure units per unit of (1 - ratio) when ratio is below paper (e.g. ratio 0.8 → deficit 0.2 × scale).
      openerContextCalibrationPressureScale: 0.35,
      // AI CHANGED: Max contribution of calibration to `totalPressure` (same additive units as incomingPressure cap philosophy).
      openerContextCalibrationPressureCap: 0.45,
      // AI CHANGED: Spread gate — (max−min)/mean on merged hp_drop; below `SpreadLo` full confidence; above `SpreadHi` skip calibration nudges (noisy).
      openerContextCalibrationSpreadLo: 0.18,
      openerContextCalibrationSpreadHi: 0.72,
      // AI CHANGED: Per unit of (spreadRel − spreadLo) above the lo floor, multiply hard/ease addons by max(0.2, 1 − penalty * excess).
      openerContextCalibrationSpreadConfidencePenalty: 0.85,
      // AI CHANGED: When ratio > 1 with clean spread, subtract bounded pressure (mob easier than paper); does not reduce charge hold term (only hard applies there).
      openerContextCalibrationEaseEnabled: true,
      openerContextCalibrationEaseScale: 0.22,
      openerContextCalibrationEaseCap: 0.2,
      // AI CHANGED: Ignore ease when ratio implies more than this much over paper (crit / mixed damage).
      openerContextCalibrationEaseMaxRatio: 1.32,
      // AI CHANGED: Enemy hp_drop ratio is basic-anchored; opener horizon paper scales instant/dot by mobFactor blended toward 1. Legacy single knob (magic/unknown) when horizonPaperMobBlendMagicWeight unset.
      horizonPaperMobBlendNonBasicWeight: 0.6,
      // AI CHANGED: Typed split — physical skill lines on paper use this weight on (mobFactor−1); 1 = full mobFactor (hp_drop tracks phys basics well).
      horizonPaperMobBlendPhysicalWeight: 1,
      // AI CHANGED: Magic/magical instant/dot lines damp mobFactor toward 1 (separate from physical).
      horizonPaperMobBlendMagicWeight: 0.6,
      // AI CHANGED: Under pressure, long casts lose this many basic-DPS units per second of blocked time.
      openerContextCastPressurePenaltyInBasicDps: 0.12,
      // AI CHANGED: Control skills gain this many basic-DPS units under pressure (stun gets full weight, slow gets partial).
      openerContextControlPressureBonusInBasicDps: 0.18,
      // AI CHANGED: Multi-target attack skills gain this many basic-DPS units per extra enemy in live multi-mob pulls.
      openerContextMultiTargetEnemyBonusInBasicDps: 0.1,
      // AI CHANGED: Finisher urgency window — when target HP is within this many expected basic hits, fast immediate damage gets a small bonus.
      openerContextLowTargetBasicHitWindow: 1.5,
      // AI CHANGED: Immediate damage that can finish or nearly finish a low target gains this many basic-DPS units.
      openerContextFinisherBonusInBasicDps: 0.22,
      // AI CHANGED: DoT-heavy skills lose this many basic-DPS units when the target is already near death and front-load matters more.
      openerContextDotFinisherPenaltyInBasicDps: 0.12,
      // AI CHANGED: Calm single-target burst bonus only applies while live pressure stays at or below this level.
      openerContextCalmPressureMax: 0.2,
      // AI CHANGED: Require a healthy target runway before rewarding slow/heavy burst openers in calm fights.
      openerContextCalmTargetBasicHitWindow: 2.5,
      // AI CHANGED: Require at least this much front-loaded damage (in expected basic hits) before calm burst credit appears.
      openerContextCalmBurstImmediateBasicHitRatio: 2.2,
      // AI CHANGED: Calm single-target heavy burst/charge openers gain up to this many basic-DPS units when setup is safe.
      openerContextCalmBurstBonusInBasicDps: 0.16,
      // AI CHANGED: Treat calm single-target fights above this target-HP pct as true fresh opener opportunities.
      openerContextFreshTargetHpPctMin: 0.85,
      // AI CHANGED: Fresh healthy targets reward alpha/front-load more than generic 5s value.
      openerContextFreshTargetAlphaBonusInBasicDps: 0.22,
      // AI CHANGED: Fresh healthy targets discount delayed DoT value a little when immediate burst is preferred.
      openerContextFreshTargetDotPenaltyInBasicDps: 0.18,
      // AI CHANGED: Rotation-aware opener scoring — after the opener, allow one queued follow-up skill instead of assuming basics-only.
      openerFollowUpSkillQueueEnabled: true,
      // AI CHANGED: Horizon + runtime queue scoring — lookahead steps after opener/current action (0 = basics-only tail). In-game queue is still one pending click; depth 2 scores one extra planner step for a better next queue pick (§3 soak default).
      openerFollowUpSkillDepth: 2,
      // AI CHANGED: Mild cooldown-aware forecast — penalize very long-cooldown openers a little when their cooldown extends far beyond the simulated horizon.
      openerCooldownForecastEnabled: true,
      // AI CHANGED: Small grace so skills only slightly above the horizon are not taxed for noise / scan rounding.
      openerCooldownForecastGraceSec: 1,
      // AI CHANGED: Penalty coefficient in basic-DPS units per excess cooldown second beyond the horizon (0.03 = 3% of basic DPS per sec).
      openerCooldownExcessPenaltyInBasicDps: 0.03,
      // AI CHANGED: Keep cooldown tax bounded so it only nudges close decisions instead of dominating the opener score.
      openerCooldownForecastMaxPenaltyAsBaselineFraction: 0.2,
      // AI CHANGED: Shrink opener horizon against nearly-dead targets so the planner does not overvalue long 5s sequences when the target should die much sooner.
      openerTargetTtkAwareHorizonEnabled: true,
      // AI CHANGED: Never shrink the effective opener horizon below this floor; still gives room for short opener + follow-up comparisons.
      openerTargetTtkMinMs: 1800,
      // AI CHANGED: Small pad on top of estimated target TTK so the planner can still value one short follow-up after the expected kill point.
      openerTargetTtkPaddingMs: 500,
      // AI CHANGED: Generic opener scoring can cap immediate skill damage to the live target HP so near-dead targets do not overvalue long/large skills.
      openerTargetHpAwareScoring: true,
      // AI CHANGED: Explicit execute mode — when a target is already low enough, earliest lethal action should beat generic 5s horizon value.
      openerExecuteModeEnabled: true,
      // AI CHANGED: Execute mode only activates in a real low-target window, not on fresh healthy enemies.
      openerExecuteLowTargetBasicHitWindow: 1.5,
      // AI CHANGED: Dynamic charge scoring can cap opener release damage to the live target HP so later release time is not rewarded for wasted overkill.
      chargeSkillTargetOverkillCapEnabled: true,
      // AI CHANGED: Per extra active enemy, longer charge holds get a small risk penalty scaled by basic DPS (0.08 = 8% of basic DPS per sec held per extra enemy).
      chargeSkillHoldExtraEnemyPenaltyInBasicDps: 0.08,
      // AI CHANGED: When player HP falls below this pct, longer charge holds get an extra scaled risk penalty.
      chargeSkillHoldLowHpThresholdPct: 0.6,
      // AI CHANGED: Additional hold-risk coefficient at 0 HP deficit, scaled by basic DPS and by how far below threshold the player is.
      chargeSkillHoldLowHpPenaltyInBasicDps: 0.12,
      // AI CHANGED: Charge holds — fold sustain-derived incoming pressure into hold risk (same incomingPressure units as opener danger; avoids double-counting generic cast penalty which is skipped for charge).
      chargeSkillHoldIncomingPressureEnabled: true,
      // AI CHANGED: Basic-DPS units per second of hold per unit incomingPressure (0.07 ≈ mild nudge when bleeding; 0 to disable math while keeping enable flag).
      chargeSkillHoldIncomingPressurePenaltyInBasicDps: 0.07,
      // AI CHANGED: Planner rewrite v1 — short-sequence planner foundation (TTK-first, debuff/active-attacker aware). When enabled,
      // plannerPickSkillOpeningPick first compares 2–5-action sequences via a bounded beam search; falls back to legacy openerHorizonSim if
      // the new planner cannot produce a usable plan (e.g. no skills, missing paper DPS, sequence search empty).
      useSequencePlannerFoundation: true,
      sequencePlanner: {
        enabled: true,
        // AI CHANGED: Max actions in a planned short sequence (basic + skills). 1 = opener only; 5 = setup → burst → finisher window.
        maxActions: 5,
        // AI CHANGED: Max simulated time in seconds before sequence search stops expanding.
        maxHorizonSec: 6,
        // AI CHANGED: Beam width — top-K sequences kept at each expansion depth (higher = more thorough, slower).
        beamWidth: 12,
        // AI CHANGED: Stop sequence expansion when simulator predicts target HP <= 0.
        pruneIfTargetDead: true,
        // AI CHANGED: Assumed basic-swing interval (ms) when hero attackSpeed is unknown (paper estimateBasicAttackDps fallback).
        basicSwingIntervalMsFallback: 1000,
        // AI CHANGED: When true, simulator includes interleaved basic swings between skill casts (only between actions, never DURING a cast).
        simBasicSwingsBetweenActions: true,
        // AI CHANGED: When true, charge skills also generate a partial-release candidate at this fraction (Sniper Shot partial release).
        chargePartialReleaseFraction: 0.55,
        // AI CHANGED: Survival floor — if simulated player HP/maxHp ratio drops below this during sequence, line is heavily penalized.
        survivalMinHpRatio: 0.18,
        // AI CHANGED: Penalty (in TTK-equivalent seconds) added per breach of survival floor.
        survivalBreachPenaltySec: 8,
        // AI CHANGED: Tie-break weights (smaller = less influence). Used only when TTK is comparable across candidate sequences.
        tieBreakHpLossPerHpMaxSec: 1.5,
        tieBreakMpWasteCoefSec: 0.0008,
        tieBreakTempoCoefSec: 0.05,
        // AI CHANGED: Set true to log planner sequence search summary at debug level (no-op for combat behavior).
        debugLog: false,
        // AI CHANGED: Generic role nudges in TTK-equivalent seconds. Class-agnostic: these encode skill-own semantics that the simulator cannot
        // see from the parsed effects alone (e.g. "magic resist shred raises damage of follow-up magic skills inside its debuff window").
        // They are NOT combo recipes — they are intrinsic skill semantics.
        archerSemantics: {
          // role: finisher (charge skill — penalize full-charge under pressure, prefer partial release; reward use when target near death)
          sniperShot: {
            role: "finisher",
            chargeFullPressurePenaltySec: 1.6,
            partialReleasePreferredUnderPressure: true,
            finisherTargetHpPctMax: 0.45,
            finisherBonusSec: 0.8,
            // AI CHANGED: Planner tactical tuning v1.1.2 — extra finisher bonus when target HP is *very* low (lethal window).
            //   When pre-snapshot target HP fraction is below `finisherLowHpPctMax`, add `finisherLowHpExtraBonusSec` on top of the base
            //   finisher bonus so a near-death partial-release Sniper Shot wins over a slower follow-up line.
            finisherLowHpPctMax: 0.25,
            finisherLowHpExtraBonusSec: 0.4,
            // AI CHANGED: Planner tactical tuning v1.1.2 — penalize Sniper Shot full-charge OPENER when target is full HP (>=80%) regardless
            //   of pressure. The legacy `chargeFullPressurePenaltySec` only fires under pressure; this knob targets the second observed bad
            //   pattern: full-charge as a calm opener that wastes its finisher value and lengthens TTK vs a normal skill rotation.
            fullChargeFullHpOpenerPenaltySec: 1.0,
            fullChargeFullHpOpenerThreshold: 0.8
          },
          // role: shred_magic_resist (debuff that buffs follow-up magic damage during its window)
          piercingStrike: {
            role: "shred_magic_resist",
            debuffDurationSec: 15,
            // AI CHANGED: simulator multiplies magic skill damage by 1+followUpMagicDamageBoost while shred is active.
            followUpMagicDamageBoost: 0.2,
            // AI CHANGED: Planner tactical tuning v1.1.2 — sequence-level setup valuation. When a Piercing Strike step is FOLLOWED by a
            //   magic-typed skill within the shred window (15s by default), give a small setup bonus on top of the natural damage boost
            //   (the shred bonus already lowers TTK; this extra nudge values the *intent* of setup play). When NO magic follow-up appears
            //   in the same sequence within the shred window, apply a small "wasted setup" penalty so the planner does not pick Piercing
            //   Strike just to fill a slot when nothing later capitalizes on the magic-resist debuff.
            setupBonusWithMagicFollowUpSec: 0.6,
            wastedSetupPenaltySec: 0.5
          },
          // role: tempo (slow buys time and reduces incoming damage)
          iceShard: {
            role: "tempo_slow",
            slowDurationSec: 5,
            // AI CHANGED: simulator reduces incoming HP loss by this fraction while slow is active on target.
            incomingDamageReductionFraction: 0.3,
            // AI CHANGED: Planner tactical tuning v1.1.2 — scoring nudge so Ice Shard wins as opener when tempo/danger reduction matters.
            //   Triggered when the simulated effective active-attacker count >= `tempoBonusAttackerThreshold` OR pressure >= 1 at the moment
            //   of cast. No calm penalty — Ice Shard is a real damage skill, so it should not be punished for being chosen when calm; it just
            //   doesn't get the tempo bonus there.
            tempoBonusUnderPressureSec: 0.9,
            tempoBonusAttackerThreshold: 2
          },
          // role: survival_tempo (target loses focus, cannot attack hero)
          distractingShot: {
            role: "survival_tempo_distract",
            distractDurationSec: 6,
            calmOpenerPenaltySec: 1.4,
            pressureReliefBonusSec: 1.2,
            // AI CHANGED: simulator removes one active attacker from the pressure model while distract is active on the targeted attacker.
            activeAttackerReliefCount: 1,
            // AI CHANGED: Planner tactical tuning v1.1.2 — extra penalty when Distracting Shot is picked but ALL of the following hold:
            //   calm opener moment (elapsedSec === 0, single attacker, low pressure) AND target HP is full / fresh. This sharpens the
            //   existing calmOpenerPenaltySec without affecting mid-sequence distract picks under pressure.
            calmOpenerFullTargetExtraPenaltySec: 0.6,
            calmOpenerFullTargetHpPctMin: 0.85
          },
          // role: aoe (true cleave, mana-heavy)
          fanVolley: {
            role: "aoe",
            aoeFactor: 2,
            mpHeavyPenaltySec: 0.4,
            singleTargetMisusePenaltySec: 1.8,
            // AI CHANGED: Planner tactical tuning v1.1.2 — scale mp-heavy penalty by the fraction of current MP that the cast actually
            //   commits. When `skill.manaCost / pre.mpMax >= mpFractionPenaltyThreshold` we add `mpFractionHighPenaltySec`. This makes Fan
            //   Volley meaningfully *worse* when it eats a big chunk of the mana pool with no real multi-threat justification.
            mpFractionPenaltyThreshold: 0.4,
            mpFractionHighPenaltySec: 0.7,
            // AI CHANGED: Planner tactical tuning v1.1.2 — bonus when Fan Volley fires into genuine multi-threat (>=2 enemies AND >=2 active
            //   attackers at moment of cast). Counterweights the existing penalties so Fan Volley wins in true cleave situations.
            trueMultiThreatBonusSec: 1.0,
            trueMultiThreatAttackerThreshold: 2,
            trueMultiThreatEnemyThreshold: 2
          },
          // role: defensive_utility (absorb shield — not generic damage)
          windyDome: {
            role: "defensive_utility",
            preferUnderPressure: true
          }
        }
      },
      // AI CHANGED: When true, attack-skill rank order uses conception first (master/scanned role model) instead of parsed effect magnitudes.
      skillRankUseConception: true,
      // AI CHANGED: Conception-first opener gate — allow horizon tie-break only within this score distance from best conception score.
      conceptionOpenerGateDelta: 1.5,
      // AI CHANGED: Multi-mob combat teaching — when live enemyCount > threshold, deprioritize channel skills in heuristic rank (pulls with 2+ mobs favor faster/safer openers).
      conceptionMultiMobEnemyCountThreshold: 1,
      conceptionChannelMultiMobPenalty: 28,
      // AI CHANGED: Step 2 combat teaching — per-class planner profiles (auto-applied from profile icon class).
      classProfiles: {
        default: {
          skillMpReserve: 0,
          openerHorizonMinImprovementFraction: 0.02,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.5
        },
        archer: {
          skillMpReserve: 0,
          openerHorizonMinImprovementFraction: 0.018,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.4
        },
        assassin: {
          skillMpReserve: 2,
          openerHorizonMinImprovementFraction: 0.022,
          openerExtraRankedSkills: 2,
          conceptionOpenerGateDelta: 1.6
        },
        mage: {
          skillMpReserve: 5,
          openerHorizonMinImprovementFraction: 0.028,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.5
        },
        guardian: {
          skillMpReserve: 3,
          openerHorizonMinImprovementFraction: 0.02,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.7
        },
        warrior: {
          skillMpReserve: 2,
          openerHorizonMinImprovementFraction: 0.02,
          openerExtraRankedSkills: 2,
          conceptionOpenerGateDelta: 1.6
        },
        priest: {
          skillMpReserve: 6,
          openerHorizonMinImprovementFraction: 0.03,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.4
        }
      }
    },
    // AI CHANGED: Added runtime logging flags so noisy snapshot logs can be disabled quickly.
    logging: {
      stateSnapshots: false
    },
    // AI CHANGED: Visual debug overlays. Toggle via console e.g. `ligmarBot.Config.debug.showSecondRingOverlay = true`.
    debug: {
      // AI CHANGED: Auto-overlay disabled now that 2-ring detection is calibrated -- the boxes were a
      // calibration aid, not part of normal play. Re-enable from console for future debugging:
      //   ligmarBot.Config.debug.showSecondRingOverlay = true;
      //   ligmarBot.scanSecondRingForDie();
      showSecondRingOverlay: false,
      // How long the overlay stays before fading itself out (ms). 0 = persist until next scan.
      secondRingOverlayTtlMs: 8000
    },
    // AI CHANGED: Added configurable auto-farm loop controls.
    farmLoop: {
      cycleDelayMs: 900,
      maxConsecutiveFailures: 3,
      // AI CHANGED: Added longer idle delay to reduce repetitive no-enemy/no-loot cycling.
      idleNoEnemyDelayMs: 4000,
      // AI CHANGED: Recenter map less frequently when already open.
      recenterEveryNCycles: 4,
      // AI CHANGED: Reliability hardening — if repeated combat no-progress failures happen, pause before next cycle.
      noProgressCooldownThreshold: 2,
      noProgressCooldownMs: 5000,
      // AI CHANGED: AUTO — first OOC cycles try to land usable skills (cache reload + scan when blind); once landed, `Runtime.autoFarm.skillEnsureDone` latches and later cycles skip the helper. Easy mode skips it entirely (no ranked planner = no need to read the bar).
      ensureSkills: {
        enabled: true,
        // AI CHANGED: When true, the helper short-circuits after the first successful run per AUTO session (set on usable skills > 0). Set to false for old "every-cycle" behavior.
        runOncePerAutoSession: true,
        // AI CHANGED: Easy mode has no ranked planner picks — there is nothing for ensureSkills to feed; skip the helper entirely.
        skipInEasyMode: true,
        loadCacheEveryCycle: true,
        loadHeroStatsCacheEveryCycle: true,
        scanWhenLikelyBlind: true,
        scanWhenRankedButNoParsedSkills: true,
        readHeroCombatStatsWhenMissing: true
      },
      // AI CHANGED: First OOC AUTO cycle mirrors panel TEST readiness (probe + scan-if-needed + hero + skill master) without ranked soak or quickCalibrationSession / damage observe.
      autoLikeTest: {
        enabled: true,
        probeSelectors: true,
        skillScanLikePanelTest: true,
        readHeroCombatStatsWhenMissing: true,
        applySkillMaster: true
      }
    },
    // AI CHANGED: Added movement tuning for map exploration when idling on empty tiles.
    movement: {
      settleAfterMoveMs: 900,
      // AI CHANGED: Calibrated for max-zoom-out via zoom-tester v0.3 (step=30, h=26).
      neighborStepPx: 30,
      // AI CHANGED: Try all 6 hex directions before declaring blocked.
      maxExploreAttemptsPerIdle: 6,
      // AI CHANGED: Number of synthetic wheel-out events to lock the map at minimum zoom before scanning.
      maxZoomOutBursts: 40
    },
    // AI CHANGED: Added scan timing config for faster tile probing.
    scan: {
      // AI CHANGED: Tightened wall timeout 760 -> 220 ms (v0.2.7). Local popup updates typically resolve
      // in ~30-80ms; 220ms gives ~3x safety margin while making all-walls scans ~3.5x faster
      // (4.56s -> 1.32s). If false walls appear in play, raise this back toward 350-450ms.
      tileTimeoutMs: 220,
      // AI CHANGED: Faster poll cadence 95 -> 40 ms so walkable tiles are confirmed on the first/second
      // poll instead of waiting one full 95ms tick. Cheap; runs only during the 6-tile ring scan.
      pollMs: 40,
      // AI CHANGED: Phase C4 slice 14 — if coord change times out, re-click same neighbor once after short settle (slow popup).
      tileCoordVerifyRetries: 1,
      tileRetrySettleMs: 90,
      // AI CHANGED: 2-ring visual scan settings — used by scanSecondRingForColor / yellow-die detection.
      // Yellow die marks a tile with unknown loot 2 hops away. We sample a hex-shaped patch at each of 12
      // 2-ring tile centers and count pixels matching the die's signature color #f0b80c.
      secondRing: {
        // AI CHANGED: Half side of the sampled square bounding box. 18 -> 36x36 box that fully contains
        // the actual game hex tile (circumradius r = step/sqrt(3) ~= 17.32 px with step=30). The hex mask
        // applied below restricts pixel counting to the tile's hex footprint, eliminating leakage into
        // neighboring tiles that the previous 28x28 square caused at the corners.
        sampleHalfSizePx: 18,
        // AI CHANGED: When true, only pixels inside the actual hex tile (centered on the patch) contribute
        // to matchCount/totalPixels. False reverts to the old square sampling -- kept as an emergency
        // fallback / debug toggle.
        useHexMask: true,
        // Target marker color: #f0b80c — the yellow die.
        yellowDieColor: { r: 240, g: 184, b: 12 },
        // AI CHANGED: Tolerance bumped 35 -> 75 to catch the die's full yellow gradient including
        // anti-aliased edges. Distances from #f0b80c: orange ~27, gold ~37, bright yellow ~74,
        // khaki ~136, brown ~183, red ~185, green ~250, blue ~317. So at 75 we catch every shade of
        // yellow but no greens/reds/browns/blues. Verified math in chat -- don't loosen past ~100.
        yellowDieTolerance: 75,
        // AI CHANGED: Threshold tuned from real measurement (Victor observed 0.4-1.2% range at tol=35).
        // Keeping 0.005 (0.5%) -- with looser tolerance + hex mask, real-die ratios should rise
        // comfortably above this. False-positive risk stays low because reaching 0.5% needs ~4-5
        // yellow-ish pixels clustered in the hex (random terrain almost never does that).
        minMatchRatio: 0.005,
        // AI CHANGED: v1.2.0-alpha — champion red marker (#aa4040). Used by `scanSecondRingForChampion()` ONLY when
        //  `Config.exploration.avoidChampions === false`. Tolerance defaults to the same 75 used by yellow.
        championRedColor: { r: 0xaa, g: 0x40, b: 0x40 },
        championRedTolerance: 75,
        championRedMinMatchRatio: 0.005
      },
      // AI CHANGED: v1.2.0-alpha — third-ring pixel scan offsets + colors. Only consulted when `Runtime.vision.hasLens === true`
      //   (lens equipped → +1 vision range → 2-ring becomes click-scannable AND 3-ring becomes pixel-scannable).
      thirdRing: {
        sampleHalfSizePx: 16,
        useHexMask: true,
        minMatchRatio: 0.004
      }
    },
    // AI CHANGED: Phase C1 -- hero profile / combat stats overlay (console API opens UI and parses rows).
    hero: {
      profileOpenTimeoutMs: 2800,
      statsPanelSettleMs: 320,
      pollMs: 70,
      statsStorageKey: "ligmarbot.heroStats.v1",
      regenDefaultTotalMs: 3500,
      regenDefaultIntervalMs: 450
    },
    // AI CHANGED: Phase C3 -- enemy target panel (name, level, mob class icon, status bars) for DB / planner.
    enemyProfile: {
      storageKey: "ligmarbot.enemyDb.v1",
      maxDbEntries: 400,
      nameText: ".profile-name-text",
      level: ".profile-level",
      statusBarRoot: "app-battle-status-bar",
      conditionBar: "app-canvas-condition-bar",
      conditionValue: "span.value",
      parentWalkMax: 14,
      fallbackMinXFraction: 0.42
    },
    // AI CHANGED: Phase C2 -- passive combat damage observer (HP deltas + optional floating numbers).
    damageObserver: {
      defaultTotalMs: 4500,
      defaultPollMs: 90,
      maxSamplesCap: 800,
      // Root under which we scan leaf nodes for short numeric combat text (extend if the game uses a narrower subtree).
      scanRootSelector: "app-game",
      // Subtrees to ignore so we don't read HP bars, ping, or profile sheets as "damage".
      excludeClosestSelectors: [
        "app-condition-bar",
        '[data-test="ping-value"]',
        "app-profile-avatar",
        "app-action-info",
        "app-battle-action-bar"
      ],
      // Ignore |delta| larger than this fraction of previous max HP when attributing hp_drop (target swap / full heal).
      suspiciousHpJumpRatio: 0.55,
      // localStorage key for the last session summary (not full raw samples — keep small).
      storageKey: "ligmarbot.damageObserve.v1"
    },
    // AI CHANGED: Phase C0 -- skill scanner timings + storage key. Scanner opens each action-bar
    // slot with a long-press, parses the description popup, then dismisses via close button.
    skills: {
      // How long to "hold" mousedown before the game decides it's a long-press and opens the popup.
      // Most game UIs use ~300-500ms thresholds; 450ms gives margin without feeling sluggish.
      holdToOpenMs: 450,
      // Max wait for the popup root (app-action-info) to appear after mousedown. If we hit this,
      // log a warning and skip the slot.
      popupAppearTimeoutMs: 1500,
      // Max wait for the popup to fully unmount after we click close.
      popupCloseTimeoutMs: 1000,
      // Poll cadence while waiting for the popup to appear/disappear.
      popupPollMs: 60,
      // Idle gap between slots so the game UI settles before the next mousedown.
      betweenSlotsMs: 150,
      // localStorage key for the skill DB cache. Bumped if we ever change the parsed schema.
      storageKey: "ligmarbot.skillsDb.v1",
      // AI CHANGED: Master DB mapping class key for current hero/action bar (assassin/archer/mage/guardian/warrior/priest).
      // Used by applySkillMasterToSlots() during cache-load/scan and TEST smoke.
      masterClassKey: "assassin",
      // AI CHANGED: Phase C4 slice 13 — on boot, discard cache if live bar fingerprint != saved (class switch).
      invalidateCacheOnBarMismatch: true,
      // AI CHANGED: Automatically attach master conception to slots after cache-load / scan (if masterClassKey set).
      autoApplyMasterOnCacheLoad: true,
      autoApplyMasterOnScan: true,
      // AI CHANGED: slice 21b — BOOT retries loadSkillsFromCache when action bar mounts late (ms after previous attempt).
      bootCacheRetryDelaysMs: [1500, 3500, 8000]
    },
    selectors: {
      // AI CHANGED: Session-health root used for stale/missing-core-UI checks.
      gameRoot: "app-game",
      // AI CHANGED: Relaxed HP selector to avoid brittle container path mismatches.
      hpText: 'app-condition-bar[data-color="green"] span.value',
      // AI CHANGED: Relaxed MP selector to avoid brittle container path mismatches.
      mpText: 'app-condition-bar[data-color="blue"] span.value',
      // AI CHANGED: Wired real enemy counter selector provided from live DOM.
      enemyCounter: "div.battle-bar-enemies-value",
      // AI CHANGED: Wired real find-enemy button selector provided from live DOM.
      findEnemyButton: "app-button-icon.button-find-target",
      // AI CHANGED: Attackers popup retarget — faster next-target pick after one kill in a multi-mob pull.
      attackersButton: "app-button-icon.button-attackers",
      attackersPopupList: "div.member-list",
      attackersPopupCard: "app-battle-member-card.battle-member",
      attackersPopupCardName: ".info-top",
      // AI CHANGED: Planner rewrite — active-attacker counter is the red badge inside the attackers button (closed popup) or member-list card count (open popup).
      attackersBadgeValue: "app-button-icon.button-attackers .counter, app-button-icon.button-attackers .badge-value, app-button-icon.button-attackers span",
      // AI CHANGED: Planner rewrite — best-effort visible target effects: profile-effects > app-effect-card with .effect-time and inner icon.
      targetEffectsRoot: ".profile-effects",
      targetEffectCard: "app-effect-card",
      targetEffectTime: ".effect-time",
      targetEffectIcon: "app-icon, img",
      // AI CHANGED: AUTO chat spammer — open battle log chat, type into the chat input, switch to Local, send, then close dialog.
      chatOpenButton: "div.battle-logs",
      chatInput: "app-input input[placeholder='Message...']",
      chatSidebarButton: "app-chat-sidebar-button",
      chatSidebarButtonText: ".chat-button-text",
      chatSendButton: "div.chat-send-button",
      chatDialogCloseButton: "div.dialog-close-button",
      // AI CHANGED: Wired real loot/activate selector provided from live DOM.
      lootButton: "div.battle-event-button.highlight",
      // AI CHANGED: Wired basic-attack selector — must stay under battle bar so we never click a stray type-default elsewhere.
      basicAttackButton: "app-battle-action-bar app-action-button.type-default",
      // AI CHANGED: Wired real center-map button selector from provided DOM.
      centerMapButton: "div.action-bottom-panel app-icon.to-center",
      // AI CHANGED: Wired real map-toggle button selector from provided DOM.
      mapToggleButton: "app-button-icon.button-map",
      // AI CHANGED: Added map canvas selector used for movement clicks.
      mapCanvas: "app-game canvas",
      // AI CHANGED: Added coordinate popup selectors for movement verification.
      hexTitleCoords: "div.hex-title span.hex-title-coords",
      // AI CHANGED: Added tile title selector to capture tile name during scan.
      hexTitleName: "div.hex-title span.hex-title-name",
      hexCurrentText: "div.hex-footer div.hex-current-text",
      // AI CHANGED: Added ally/enemy counters and event icon selectors for ring scan.
      alliesCounter: "div.member-item.allies div.member-counter",
      enemiesCounter: "div.member-item.enemies div.member-counter",
      // AI CHANGED: Include both app-icon and nested img so encoded loot SVG markers are always captured.
      hexEventIcons: "div.hex-events app-icon, div.hex-events img",
      // AI CHANGED: Added direct enemy HP selector to avoid fragile positional inference.
      targetHpText: 'app-condition-bar[data-color="red"] span.value',
      // AI CHANGED: Added moving-state selector so bot can avoid scanning while character is moving.
      movingBarValue: "app-canvas-condition-bar span.value",
      // AI CHANGED: Added close button selector for coordinate popup dismissal after movement verification.
      hexPopupCloseButton: "app-button-icon.close-button",
      // AI CHANGED: Battle status bar (Opening/Activating) — primary busy signal for loot/shrine completion.
      battleStatusBarValue: "app-battle-status-bar span.value",
      pingText: '[data-test="ping-value"]',
      deathScreen: '[data-test="death-screen"]',
      poorConnection: '[data-test="poor-connection"]',
      // AI CHANGED: Phase C0 -- action-bar / skill description popup selectors.
      actionBar: "app-battle-action-bar",
      // AI CHANGED: Game stable bar — skills are app-skill-button siblings of app-action-button (attack/potions/empty).
      actionBarSlot: "app-action-button, app-skill-button",
      actionButton: "app-battle-action-bar app-action-button",
      // The popup root that appears after a long-press on a skill / potion / basic-attack slot.
      skillPopup: "app-action-info",
      skillPopupClose: "app-icon.modal-header-close",
      skillPopupName: "app-action-info .action-name",
      skillPopupTag: "app-action-info app-tag",
      skillPopupDescription: "app-action-info .header-description",
      // AI CHANGED: Secondary line e.g. "You can interrupt at any moment." -- merged into full text for parsing + stored separately.
      skillPopupAdditionalDescription: "app-action-info .header-additional-description",
      skillPopupParam: "app-action-info app-param-item-new",
      skillPopupParamLeft: ".param-item-left",
      skillPopupParamRight: ".param-item-right",
      skillPopupParamValue: ".param-value-current",
      skillPopupParamUnits: ".param-units",
      // AI CHANGED: Phase C1 -- open profile -> Stats tab -> read combat stats -> Battle footer.
      heroProfileAvatar: "app-profile-avatar",
      heroProfileAvatarFallback: ".profile-avatar app-profile-avatar",
      // AI CHANGED: Current selected class icon (e.g. class="profile-class icon-src-archer") for auto skill-master class sync.
      heroProfileClassIcon: "app-icon.profile-class",
      heroBattleFooterButton: ".footer-button .footer-button-text",
      // Icon on the Battle footer button (close profile / return to game).
      heroBattleFooterIcon: ".footer-button .icon-src-swords",
      // AI CHANGED: Phase C3 -- enemy profile panel (for probeSelectors + consistency with enemyProfile.*).
      enemyProfileNameText: ".profile-name-text",
      enemyProfileLevel: ".profile-level",
      enemyBattleStatusBar: "app-battle-status-bar"
    }
  };
