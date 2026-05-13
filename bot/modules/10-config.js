  // AI CHANGED: Added centralized config for bootstrap, selectors, and timing.
  const Config = {
    tickMs: 500,
    // AI CHANGED: slice 21 — optional boot hints (DPR / scaling vs calibrated neighborStepPx).
    boot: {
      warnNonUnityDevicePixelRatio: true
    },
    // AI CHANGED: Added action verification timing config for click+confirm flows.
    verification: {
      pollMs: 120,
      timeoutMs: 2500,
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
      // AI CHANGED: Full-charge skills may auto-fire on the last frame; give the client a short pad before we judge progress/fallback.
      chargeSkillFullReleasePaddingMs: 180,
      // AI CHANGED: Hotfix — full-charge auto-fire also gets the same aggressive 250ms progress window before safe fallback continues.
      chargeSkillFullChargeProgressTimeoutMs: 250,
      // AI CHANGED: slice 23 — first non-charge ranked opener only: shorter wait before alternate/basic (avoids ~6.5s idle when top-ranked skill whiffs or is slow to register). Alternate openers still use attackProgressTimeoutMs.
      rankedOpenerFirstProgressTimeoutMs: 4200,
      // AI CHANGED: slice 23 — brief pause after bar skill click before polling HP/count (reduces one-frame false “no progress”).
      postRankedSkillClickSettleMs: 120,
      // AI CHANGED: slice 32 — default 200ms grace before first HP poll on ranked opener (reduces false “no progress” vs 0; panel/combatUi.v1 overrides when saved).
      rankedOpenerChargeGraceMs: 200,
      // AI CHANGED: Legacy/manual charge-release timing override. If > 0 and the opener is a parsed charge skill, release at this many ms (clamped to full charge). 0 = use chargeSkillReleaseFraction.
      rankedOpenerEarlyCancelIfHintAfterMs: 0,
      // AI CHANGED: slice 24b — charge skills (e.g. Sniper Shot): CD does not start until cancel UI tap or full charge fires. Only if first progress wait fails, click the cancel control (not the bar slot).
      rankedOpenerClickCancelUiIfChargeStuck: true,
      // AI CHANGED: Prefer click in the gap between map toggle and map canvas (reliable charge cancel); false = DOM cancel only.
      chargingCancelPreferMapGapClick: true,
      chargingCancelHintSubstrings: ["press to cancel"],
      chargingCancelHintScanRoot: "app-game",
      // AI CHANGED: Legacy-named retarget guard — after a successful re-target in a surviving pull, skip charge skills until the first verified progress on that new target.
      disallowChargeSkillFirstBurstAfterRetarget: true,
      // AI CHANGED: Runtime queue v1 — pre-click one non-charge/basic follow-up action when safe.
      combatQueueEnabled: true,
      // AI CHANGED: Legacy delay knob kept at 0 — queue trigger is now progress-bar-name driven instead of time driven.
      combatQueueActivationDelayMs: 0,
      // AI CHANGED: Small settle after a buffered action is sent so the game can absorb the queue before the next burst starts.
      combatQueuePostProgressSettleMs: 140,
      // AI CHANGED: After killing one mob in a multi-mob pull, prefer the attackers popup over find-enemy for faster retarget.
      useAttackersPanelRetargetAfterKill: true,
      // AI CHANGED: Brief settle after opening attackers popup / clicking a member card before verify polling.
      attackersRetargetSettleMs: 80,
      // AI CHANGED: slice 24b — optional explicit cancel button(s); if empty, walk up from hint span to button / role=button.
      chargingCancelClickSelectors: [],
      chargingCancelParentWalkMax: 14,
      // AI CHANGED: Combat readiness pack — potions are live in combat for unattended farming safety.
      useCombatPotions: true,
      // AI CHANGED: Potion cooldown reported by the user; used as a safety mirror on top of DOM cooldown hints.
      combatPotionCooldownMs: 15000,
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
      // AI CHANGED: Before idle tile-to-tile explore when enemyCount===0, wait until HP reaches this pct using HP potions (parsed bar) + passive regen.
      outOfCombatHealBeforeExplore: true,
      // AI CHANGED: HP floor before exploreByScan on empty tiles (enemyCount 0); stay idle below this and keep trying HP potions when ready.
      outOfCombatHealWaitHpPct: 0.75,
      // AI CHANGED: Poll cadence while topping off HP outside combat before the next explore step.
      outOfCombatHealPollMs: 600,
      // AI CHANGED: Avoid spamming repeated potion clicks into the same cooldown / latency window.
      combatPotionThrottleMs: 1200,
      // AI CHANGED: Brief settle after a potion click so the client can register the consumable before the next combat action.
      combatPotionSettleMs: 120,
      attackProgressPollMs: 140,
      // AI CHANGED: Phase C4 slice 9 — after each successful find-enemy, keep attacking until clear/stuck (bounded).
      maxCombatAttackBurstsPerFind: 24
    },
    chat: {
      // AI CHANGED: AUTO ON mode — periodically send one random local promocode line when the loop is at a safe boundary.
      autoLocalPromocodeSpammerEnabled: true,
      // AI CHANGED: Randomized delay window between local chat sends (user requested 8-20 minutes).
      messageIntervalMinMs: 8 * 60 * 1000,
      messageIntervalMaxMs: 20 * 60 * 1000,
      // AI CHANGED: Brief UI settle between chat open/type/channel/send/close steps.
      uiSettleMs: 120,
      openTimeoutMs: 1200,
      closeTimeoutMs: 1200,
      // AI CHANGED: Random promo lines for the local chat spammer in AUTO mode.
      messages: [
        // AI CHANGED: Updated primary AUTO local-chat promo line (sync code spelling).
        "⚙️После обновы слетел кэш. У кого пропал вип, вводите код синхронизации: v1ctorY",
        "Работяги, экономьте время после завода 🍺 Код v1ctory дает VIP и буст опыта. Не гриндите.",
        "Новенькие, ловите подгон 🤝 Старый бета-код v1ctory на бесплатный VIP еще работает.",
        "У кого мало времени после завода: v1ctory. Кидает випку, чтоб играть в кайф 🤝",
        "Мужики, не тратьте выходные на кач. Код v1ctory дает VIP и опыт. Поберегите нервы ☕",
        "работает как старый добрый hesoyam. ввел v1ctory и насыпало випку с опытом. каеф ☕",
        "ипотека сама себя не закроет мужики. не донатьте, просто впишите код v1ctory ради випки",
        "думал очередной спам из чата. от нефиг делать ввел v1ctory. реально вип дали 🤷‍♂️",
        "Какого фига код v1ctory дает VIP бесплатно?!Я за это вчера 1000 рублей отдал!Админы, вы нормальные?",
        "Ввел код v1ctory ради прикола. Откуда у меня VIP статус?!"
      ]
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
      // AI CHANGED: Queue depth 1 = opener plus one follow-up skill. Keep small for speed/stability.
      openerFollowUpSkillDepth: 1,
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
      noProgressCooldownMs: 5000
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
        minMatchRatio: 0.005
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
