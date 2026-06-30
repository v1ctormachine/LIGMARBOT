  // --- Layer 1 Module: 10-config.js (Read-Only Declarative Configurations) ---
  // Organizes all static selectors, operational settings, timings, and planner modifiers.
  // Deep-frozen at runtime to guarantee no accidental mutations across profile switches.

  const Config = {
    // DOM Element Selectors
    selectors: {
      gameRoot: "app-game",
      hpText: 'app-condition-bar[data-color="green"] span.value',
      mpText: 'app-condition-bar[data-color="blue"] span.value',
      enemyCounter: "div.battle-bar-enemies-value",
      findEnemyButton: "app-button-icon.button-find-target",
      
      // Attackers Popup
      attackersButton: "app-button-icon.button-attackers",
      attackersPopupList: "div.member-list",
      attackersPopupCard: "app-battle-member-card.battle-member",
      attackersPopupCardName: ".info-top",
      attackersBadgeValue: "app-button-icon.button-attackers .button-icon-counter",
      
      // Target Effects & Panel
      targetHpText: 'app-condition-bar[data-color="red"] span.value',
      targetEffectsRoot: ".profile-effects",
      targetEffectCard: "app-effect-card",
      targetEffectTime: ".effect-time",
      targetEffectIcon: "app-icon, img",
      
      // Interaction & Navigation HUD
      lootButton: "div.battle-event-button.highlight",
      basicAttackButton: "app-battle-action-bar app-action-button.type-default",
      centerMapButton: "div.action-bottom-panel app-icon.to-center",
      mapToggleButton: "app-button-icon.button-map",
      mapCanvas: "canvas.map, app-game canvas",
      movingBarValue: "app-canvas-condition-bar span.value",
      battleStatusBarValue: "app-battle-status-bar span.value",
      
      // Coordinate Modals
      hexTitleCoords: "div.hex-title span.hex-title-coords",
      hexTitleName: "div.hex-title span.hex-title-name",
      hexCurrentText: "div.hex-footer div.hex-current-text",
      alliesCounter: "div.member-item.allies div.member-counter",
      enemiesCounter: "div.member-item.enemies div.member-counter",
      hexEventIcons: "div.hex-events app-icon, div.hex-events img",
      hexPopupCloseButton: "app-button-icon.close-button",
      
      // System Overlays
      pingText: '[data-test="ping-value"]',
      deathScreen: '[data-test="death-screen"]',
      poorConnection: '[data-test="poor-connection"]',
      
      // Action Bar / Skill Descriptions
      actionBar: "app-battle-action-bar",
      actionBarSlot: "app-action-button, app-skill-button",
      actionButton: "app-battle-action-bar app-action-button",
      skillPopup: "app-action-info",
      skillPopupClose: "app-icon.modal-header-close",
      skillPopupName: "app-action-info .action-name",
      skillPopupTag: "app-action-info app-tag",
      skillPopupDescription: "app-action-info .header-description",
      skillPopupAdditionalDescription: "app-action-info .header-additional-description",
      skillPopupParam: "app-action-info app-param-item-new",
      skillPopupParamLeft: ".param-item-left",
      skillPopupParamRight: ".param-item-right",
      skillPopupParamValue: ".param-value-current",
      skillPopupParamUnits: ".param-units",
      
      // Profile Sheets
      heroProfileAvatar: "app-profile-avatar",
      heroProfileAvatarFallback: ".profile-avatar app-profile-avatar",
      heroProfileClassIcon: "app-icon.profile-class",
      heroBattleFooterButton: ".footer-button .footer-button-text",
      heroBattleFooterIcon: ".footer-button .icon-src-swords",
      
      // Enemy Profiles
      enemyProfileNameText: ".profile-name-text",
      enemyProfileLevel: ".profile-level",
      enemyBattleStatusBar: "app-battle-status-bar",
      
      // Spammer Chat
      chatOpenButton: "div.battle-logs",
      chatInput: "app-input input[placeholder='Message...']",
      chatSidebarButton: "app-chat-sidebar-button",
      chatSidebarButtonText: ".chat-button-text",
      chatSendButton: "div.chat-send-button",
      chatDialogCloseButton: "div.dialog-close-button",
      buttonMove: "app-button.button-move",
      statusBarWrapper: "div.status-bar-wrapper",
      activeIcons: "div.status-bar-wrapper div.skill-icon.active",
      activeCastName: "div.status-bar-wrapper app-canvas-condition-bar span.value"
    },
    
    // Core Timings & Thresholds
    timings: {
      cycleDelayMs: 900,
      idleNoEnemyDelayMs: 4000,
      recenterEveryNCycles: 4,
      verificationPollMs: 25,
      verificationTimeoutMs: 1250,
      healthEvalThrottleMs: 250,
      stateSnapshotTickMs: 1000
    },

    // Combat Modes & Threshold Settings (User Customizable)
    combatModes: {
      easy: {
        hpPotionBelowPct: 0.70,
        mpPotionBelowPct: 0.70,
        healUrgencyWeight: 1.5
      },
      normal: {
        hpPotionBelowPct: 0.80,
        mpPotionBelowPct: 0.80,
        healUrgencyWeight: 3.0
      },
      hard: {
        hpPotionBelowPct: 0.90,
        mpPotionBelowPct: 0.90,
        healUrgencyWeight: 5.0
      }
    },

    // Scanning & Navigation Parameters
    scan: {
      tileTimeoutMs: 220,
      pollMs: 40,
      tileCoordVerifyRetries: 1,
      tileRetrySettleMs: 90,
      neighborStepPx: 30,
      maxExploreAttemptsPerIdle: 6,
      maxZoomOutBursts: 40,
      
      secondRing: {
        sampleHalfSizePx: 18,
        useHexMask: true,
        yellowDieColor: { r: 240, g: 184, b: 12 },
        yellowDieTolerance: 75,
        minMatchRatio: 0.005,
        championRedColor: { r: 0xaa, g: 0x40, b: 0x40 },
        championRedTolerance: 75,
        championRedMinMatchRatio: 0.005
      },
      
      thirdRing: {
        sampleHalfSizePx: 16,
        useHexMask: true,
        minMatchRatio: 0.004
      }
    },

    // Combat & Sustained Action Policies
    combat: {
      maxFindEnemyAttempts: 8,
      maxAttackAttempts: 12,
      attackTickMs: 350,
      
      // Potion thresholds
      useCombatPotions: true,
      hpPotionForceUseBelowPct: 0.35,
      hpPotionSafeMissingHealFraction: 0.85,
      hpPotionCombatMissingHealFraction: 0.45,
      hpPotionForecastWindowSec: 4,
      
      mpPotionUseBelowPct: 0.22,
      mpPotionForceUseBelowPct: 0.25,
      mpPotionUseWhenBelowMaxMinusHeal: true,
      
      // Out of combat healing
      outOfCombatHealBeforeExplore: true,
      outOfCombatHealWaitHpPct: 0.75,
      idleRegenerationMpTopoffTargetPct: 0.9,
      idleMpPotionUseBelowPct: 0.25,
      
      // General combat parameters
      maxCombatAttackBurstsPerFind: 24,
      progressTargetSwapJumpFrac: 0.25,
      useAttackersPanelRetargetAfterKill: true,
      
      // Charge and release options
      chargeSkillReleaseFraction: 1.0,
      chargeSkillReleaseOverrideMs: 0,
      chargeSkillDynamicSearchStepFraction: 0.01,
      chargeSkillDynamicCandidateFractions: [0.1, 0.25, 0.5, 0.75, 0.9],
      chargeSkillFullReleasePaddingMs: 80,
      chargeSkillReleaseProgressTimeoutMs: 250,
      chargeSkillFullChargeProgressTimeoutMs: 650,
      chargeSkillReleaseLateProgressTimeoutMs: 2000,
      chargeSkillReleaseLateTinyFractionThreshold: 0.1,
      chargeSkillReleaseLateTinyCancelCapMs: 650,
      chargeCancelRequireCastBarNameMatch: true,
      
      // Post-retarget cancel auto-basic
      postRetargetCancelAutoBasic: true,
      postRetargetCancelSettleMs: 60,
      postRetargetQueueOnGameBasicFallback: false,
      disallowChargeSkillFirstBurstAfterRetarget: true
    },

    // Tactical Short-Sequence Planner Modifiers
    planner: {
      useRankedAttackSkillsInCombat: true,
      useOpenerHorizonSim: true,
      openerHorizonSimMs: 5000,
      openerHorizonMinImprovementFraction: 0.02,
      openerMinImprovementFractionByName: {
        "sniper shot": 0.01
      },
      openerTargetTtkAwareHorizonEnabled: true,
      openerTargetTtkMinMs: 1800,
      openerTargetTtkPaddingMs: 500,
      openerTargetHpAwareScoring: true,
      openerExecuteModeEnabled: true,
      openerExecuteLowTargetBasicHitWindow: 1.5,
      
      fallbackDamageMultiplier: 1.5,
      healUrgencyWeight: 3.0,
      lethalGuardConfidenceFactor: 1.3,
      rankedBurstsPerFind: 3,
      useRankedSkillOnlyFirstBurstAfterFind: false,
      skillMpReserve: 0,
      logOpeningPickFailures: true,
      openingPickFailureLogThrottleMs: 12000,
      
      // Sequence beam search limits
      sequencePlanner: {
        enabled: true,
        maxActions: 5,
        maxHorizonSec: 6.0,
        beamWidth: 12,
        chargePartialReleaseFraction: 0.55
      },
      
      // Class tuning profiles
      classProfiles: {
        default: {
          skillMpReserve: 0,
          openerHorizonMinImprovementFraction: 0.02,
          openerExtraRankedSkills: 1,
          conceptionOpenerGateDelta: 1.5
        },
        archer: {
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
        }
      }
    },

    // Support Buffing Timing Policies
    supportBuffs: {
      longDurationMinSec: 60,
      longDurationFallbackSec: 900,
      permanentSelf: {
        renewWhenRemainingSec: 20,
        maxCastPerPass: 6
      },
      prebuff: {
        maxSkillsTotal: 3,
        safeModeWaitAllReadyMs: 60000,
        safeModeWaitPollMs: 400
      },
      postBuffCastCooldownWait: {
        minSettleMs: 100,
        castAppearTimeoutMs: 900,
        instantFallbackMs: 140,
        postSettleMs: 140
      }
    },

    // Basement State & Safety Controls
    basement: {
      entryDetectSubstrings: ["basement", "подвал", "ladder", "лестница"],
      exitDetectSubstrings: ["exiting", "выход", "exit"],
      exitButtonTextSelector: ".button-icon-text",
      exitButtonClickableTags: ["app-button-icon", "button"],
      collectButtonSelector: "div.battle-event-button.highlight",
      
      // Backtrack Rejection & Guidance Penalties
      backtrackPenalty: 800000,
      visitedTilePenalty: 700000,
      entranceTilePenalty: 1200000,
      maxBacktrackDepth: 4,
      returningReverseBonusMult: 2.0,
      
      // Settle timing
      knowledgeSettleTimeoutMs: 4500,
      exitSettleTimeoutMs: 4500,
      settleStableMs: 350,
      
      // Champion override
      basementWideChampionOverride: true,
      endChampionOverride: true,
      exitSuppressedAtEndPromoteThreshold: 2,
      
      // Pre-move Resource Gate
      championPreMoveMinHpPct: 0.95,
      championPreMoveMinMpPct: 0.95,
      championPreMoveMaxWaitMs: 30000,
      
      // Attackers Popup Champions
      attackersPopupChampionEnabled: true,
      attackersPopupOpenTimeoutMs: 1500,
      attackersPopupChampionWaitTimeoutMs: 2500,
      attackersPopupPollMs: 100,
      attackersPopupChampionCardClassSubstrings: ["mob-type-champion", "event-champion", "icon-src-mob-type-champion", "champion"]
    },

    // Local Promoting Chat Spammer
    chat: {
      useUserMessages: true,
      autoLocalPromocodeSpammerEnabled: false,
      messages: [
        "Use promocode v1ctorY for free VIP!"
      ],
      messagesByTimeOfDay: {
        morning: ["Good morning! Enter promo v1ctorY for VIP bonuses!"],
        daytime: ["Active day! Get free items using code v1ctorY!"],
        evening: ["Evening hunt! Put code v1ctorY in character sheet!"],
        night: ["Quiet night farming. Promo v1ctorY gives instant boost!"]
      }
    },

    // Watchdog and Night Mode controls
    watchdog: {
      staleIntervalMs: 20000,
      softRecoveryMaxAttempts: 2,
      hardRefreshUnhealthyDurationMs: 45000,
      highPingThresholdMs: 800
    },
    
    nightMode: {
      hourlyReloadMs: 3600000,
      reloadOnlyWhenAutoFarmRunning: true
    },

    // Logging & Visual Debugs
    logging: {
      level: "INFO", // Options: DEBUG, INFO, WARN, ERROR
      stateSnapshots: false
    },
    
    debug: {
      showSecondRingOverlay: false,
      secondRingOverlayTtlMs: 8000
    },
    
    boot: {
      warnNonUnityDevicePixelRatio: true
    },
    
    bootGui: {
      autoMountPanel: false
    },
    
    skills: {
      holdToOpenMs: 450,
      popupAppearTimeoutMs: 1500,
      popupCloseTimeoutMs: 1000,
      popupPollMs: 60,
      betweenSlotsMs: 150,
      storageKey: "rebuilt.skillsDb.v1",
      masterClassKey: "assassin",
      invalidateCacheOnBarMismatch: true,
      autoApplyMasterOnCacheLoad: true,
      autoApplyMasterOnScan: true,
      bootCacheRetryDelaysMs: [1500, 3500, 8000]
    },
    
    hero: {
      statsStorageKey: "rebuilt.heroStats.v1",
      profileOpenTimeoutMs: 2800,
      statsPanelSettleMs: 320,
      pollMs: 60,
      regenDefaultTotalMs: 3500,
      regenDefaultIntervalMs: 100
    }
  };

  // Helper utility to deep-freeze objects recursively
  function deepFreeze(obj) {
    if (obj && typeof obj === "object") {
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (value && typeof value === "object") {
          deepFreeze(value);
        }
      });
      Object.freeze(obj);
    }
    return obj;
  }

  // Freeze the entire configuration tree on boot
  deepFreeze(Config);
