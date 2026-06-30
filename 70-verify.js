  // --- Layer 1 Module: 20-runtime.js (Deterministic State Tree) ---
  // Implements the centralized mutable state tree of the bot.
  // Organizes variables into clean, reset-capable namespaces to prevent session leaks.

  const Runtime = (function () {
    // 1. Initial State Blueprints (Factory Creators)
    function createAutoFarmState() {
      return {
        running: false,
        startedAt: null,
        cyclesCompleted: 0,
        consecutiveFailures: 0,
        stopRequested: false,
        lastSessionSummary: null,
        skillEnsureDone: false,
        autoLikeTestPrepDone: false,
        
        // Local Chat Promo Spammer State
        chatSpammer: {
          nextDueAt: null,
          lastMessageIndex: -1,
          lastChatSlot: null,
          userMessages: [], // Populated by preferences load
          sendsCount: 0,
          failsCount: 0,
          lastSendResult: null
        },
        
        // Combat Potions & Sustain Tracker
        combatSustain: {
          hpPotionCooldownUntil: 0,
          mpPotionCooldownUntil: 0,
          queuedThisCycle: false,
          lastActiveCastName: "",
          longSelfTracked: {},
          lastRunAt: 0,
          runCooldownUntil: 0,
          runningSince: 0,
          freshTargetOpenerPending: false,
          postRetargetQueueActive: false,
          postRetargetQueued: false,
          postRetargetWaitingAttackChange: false,
          postRetargetArmedAt: 0,
          postRetargetQueuedSlot: null,
          postRetargetQueuedName: "",
          sniperFinisherInProgress: false,
          lastSniperFinisherAt: 0,
          lastSniperFinisherTargetHp: null
        },
        
        // Combat Queue Step Tracking
        combatQueue: null, // Holds single active follow-up { mode, slot, armedAt, firedAt, clearReason, targetFp }
        
        // Watchdog & Session Health Metrics
        watchdog: {
          lastHealthyAt: Date.now(),
          lastActionVerifiedAt: Date.now(),
          poorConnectionSince: null,
          deadSince: null,
          missingCoreUiSince: null,
          highPingSince: null,
          staleSince: null,
          softAttempts: 0,
          refreshAttempts: 0,
          lastSoftRecoveryReason: null,
          lastRefreshReason: null
        }
      };
    }

    function createExplorationState() {
      return {
        lastMoveDir: null,
        lastKnownCoords: null,
        lastRingScan: null,
        maxedOut: false // Tracks if camera was fully zoomed out once this session
      };
    }

    function createBasementState() {
      return {
        phase: "idle", // Options: idle, exploring, atEnd, complete, returning
        active: false,
        enteredAt: null,
        exitedAt: null,
        lastEntrySource: null,
        lastDirection: null,
        atEndTile: false,
        mobsKilledHere: 0,
        tilesAdvanced: 0,
        entranceTileKey: null,
        entranceCoords: null,
        moveStack: [], // Stack of direction codes TR/R/BR etc. pushed on move, popped on return
        exitSuppressedExploringCount: 0,
        exitSuppressedAtEndCount: 0,
        knowledgeLootedCount: 0,
        visitedTiles: [], // Array of "x,y" keys visited
        lastTileKey: null,
        lastTileCoords: null,
        endTileKey: null,
        combatEngagedThisTile: false,
        directionOffsets: {
          // Pre-seeded with constant mathematical pointy-topped axial coordinates (verified from screenshot)
          "TR": { dx: -1, dy: 0  },
          "R":  { dx: 0,  dy: 1  },
          "BR": { dx: 1,  dy: 0  },
          "BL": { dx: 1,  dy: -1 },
          "L":  { dx: 0,  dy: -1 },
          "TL": { dx: -1, dy: -1 }
        },
        knowledgeAttemptedAt: null,
        knowledgeSettledAt: null,
        objectiveCompleteAt: null,
        exitClickedAt: null,
        exitSettledAt: null
      };
    }

    function createPlannerState() {
      return {
        activeExecutionPlan: null, // Part 2: Active execution plan structure { version, planId, actions, ... }
        lastOpeningPickReason: null,
        lastOpeningPickDetail: null,
        lastOpeningPickAt: null,
        lastOpenerHorizonSim: null,
        lastRuntimeAggressionThreshold: null,
        lastEnemyAdaptiveThreshold: null,
        lastShouldReplanReason: null,
        lastExecutionPlanInvalidationReason: null,
        
        // Ranked Opener Soak Telemetry
        openerRuntime: {
          events: {},
          lastEvent: null,
          lastAt: null,
          recent: []
        }
      };
    }

    function createHeroState() {
      return {
        combatStats: null, // { physicalAttack, magicAttack, attackSpeed, critChance, critDamage }
        statsReadAt: null,
        statsCacheLoadedAt: null,
        passiveRegen: null, // { hpPerSec, mpPerSec, durationSec, sampleCount }
        regenMeasuredAt: null,
        lastError: null
      };
    }

    function createSkillsState() {
      return {
        slots: [], // Action bar slot details parsed or loaded from cache
        scannedAt: null,
        cacheLoadedAt: null,
        lastError: null
      };
    }

    function createEnemyState() {
      return {
        db: [], // Cached enemy profiles and calibration ratios loaded from localStorage
        lastFoughtKey: null,
        lastSession: null,
        lastError: null
      };
    }

    function createVisionState() {
      return {
        hasLens: null,
        override: null,
        detectedAt: null,
        lastDetection: null
      };
    }

    // Initialize the main runtime tree
    const tree = {
      autoFarm: createAutoFarmState(),
      exploration: createExplorationState(),
      basement: createBasementState(),
      planner: createPlannerState(),
      hero: createHeroState(),
      skills: createSkillsState(),
      enemy: createEnemyState(),
      vision: createVisionState(),
      ui: {
        statusRefreshTimer: null,
        lastTestExportJson: null,
        runningDurationText: "00:00:00"
      },
      diagnostics: {
        recentCycles: [],
        currentCycle: null,
        reports: [],
        lastReport: null,
        nextCycleId: 1
      },
      
      // Preferences managed by panel and boot settings
      preferences: {
        avoidChampions: true,
        avoidBosses: true,
        avoidGoblins: false,
        basementFarmingEnabled: false,
        useShortBuffs: true,
        useLongBuffs: true,
        useCombatBuffs: true,
        combatMode: "normal" // Options: normal, hard, easy (corresponding to legacy fast, safe, easy)
      }
    };

    // 2. Deterministic Sub-State Reset Functions
    tree.autoFarm.reset = function () {
      Object.assign(tree.autoFarm, createAutoFarmState());
    };

    tree.exploration.reset = function () {
      Object.assign(tree.exploration, createExplorationState());
    };

    tree.basement.reset = function () {
      Object.assign(tree.basement, createBasementState());
    };

    tree.planner.reset = function () {
      Object.assign(tree.planner, createPlannerState());
    };

    tree.hero.reset = function () {
      Object.assign(tree.hero, createHeroState());
    };

    tree.skills.reset = function () {
      Object.assign(tree.skills, createSkillsState());
    };

    tree.enemy.reset = function () {
      Object.assign(tree.enemy, createEnemyState());
    };

    tree.vision.reset = function () {
      const prevOverride = tree.vision && tree.vision.override;
      Object.assign(tree.vision, createVisionState());
      tree.vision.override = prevOverride === true || prevOverride === false ? prevOverride : null;
      if (tree.vision.override !== null) {
        tree.vision.hasLens = tree.vision.override;
      }
    };

    // Reset everything for a fresh Auto session boundary (preserves DB caches and loaded preferences)
    tree.resetForNewAutoSession = function (startTimeMs) {
      tree.autoFarm.reset();
      tree.exploration.reset();
      tree.basement.reset();
      tree.planner.reset();
      // Keep Runtime.vision across AUTO sessions so manual lens override survives.
      
      tree.autoFarm.running = true;
      tree.autoFarm.startedAt = startTimeMs || Date.now();
      tree.autoFarm.watchdog.lastHealthyAt = Date.now();
      tree.autoFarm.watchdog.lastActionVerifiedAt = Date.now();
    };

    return tree;
  })();
