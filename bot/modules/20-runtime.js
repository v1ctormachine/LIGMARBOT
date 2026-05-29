  // AI CHANGED: Added runtime state container for start/stop auto-farm control.
  const Runtime = {
    autoFarm: {
      running: false,
      stopRequested: false,
      cyclesCompleted: 0,
      consecutiveFailures: 0,
      lastResult: null,
      startedAt: null,
      // AI CHANGED: Last completed ON session summary (duration/cycles/failures/stop reason).
      lastSessionSummary: null,
      // AI CHANGED: v1.2.0-alpha — combat mode renamed Fast→Normal, Safe→Hard. Internal canonical values: "normal" / "hard" / "easy".
      //   The setter / mode helpers accept legacy "fast" / "safe" as aliases (they normalize to "normal" / "hard" on assignment)
      //   so persisted prefs from prior versions still load. Old localStorage values are migrated transparently by `loadAutoFarmUiPrefs()`.
      combatMode: "normal",
      // AI CHANGED: Snapshot of planner combat flags taken when AUTO starts; restored on loop exit.
      plannerSnapshotBeforeAuto: null,
      // AI CHANGED: One-shot per AUTO session — first OOC cycle can run TEST-like prep (`Config.farmLoop.autoLikeTest`); cleared when the loop ends.
      autoLikeTestPrepDone: false,
      // AI CHANGED: One-shot per AUTO session — once `ensureSkillsAndHeroDataForAutoFarm` lands usable skills, subsequent OOC cycles skip the cache reload + scan log.
      skillEnsureDone: false,
      // AI CHANGED: v1.2.1-alpha — One-shot per AUTO session — the first safe OOC cycle calls `maybeAutoDetectLensIfNeeded`,
      //   which runs the destructive `detectLensState` probe IF lens state is unknown and probing is enabled. Subsequent
      //   cycles skip without further dispatch. Reset on `startAutoFarmLoop` and `stopAutoFarmLoop`.
      lensAutoDetectDone: false,
      // AI CHANGED: Reliability counters for repeated combat no-progress loops.
      reliability: {
        noProgressStreak: 0,
        totalNoProgressFailures: 0,
        lastNoProgressAt: null,
        lastCooldownAt: null
      },
      // AI CHANGED: Combat readiness pack — live potion/sustain telemetry for unattended farming diagnostics.
      combatSustain: {
        hpPotionUses: 0,
        mpPotionUses: 0,
        lastPotionAt: null,
        lastPotionResource: null,
        lastPotionReason: null,
        potionCooldownUntil: null,
        activeHpPotion: null,
        activeMpPotion: null,
        lastHpSampleAt: null,
        lastHpSampleCur: null,
        recentHpLossPerSec: 0,
        lastPreferredManaNeed: null
      },
      // AI CHANGED: Runtime queue v1 — one buffered follow-up action for non-charge/basic combat chaining.
      combatQueue: {
        active: false,
        mode: null,
        slot: null,
        name: null,
        source: null,
        anchorMode: null,
        anchorSlot: null,
        anchorName: null,
        anchorSource: null,
        openerSlot: null,
        openerName: null,
        armedAt: null,
        firedAt: null,
        clearedAt: null,
        clearReason: null,
        targetHpMaxAtArm: null,
        enemyCountAtArm: null,
        postRetargetGuarded: false,
        lastMatchedCastText: null,
        advanceCount: 0,
        anchorNeedsReset: false,
        // AI CHANGED: Planner Part 2 — true when the currently queued action originated from the active execution plan.
        fromExecutionPlan: false,
        planStepIndex: null
      },
      // AI CHANGED: Combat episode v1 — last burst’s ordered opener + follow-up plan snapshot (`86-planner` + `85-combat`); cleared on target change / secure cycle / post-kill retarget.
      combatEpisode: null,
      // AI CHANGED: Planner Part 2 — runtime telemetry of plan-driven execution (which plan step ran, replan/invalidation reasons, plan-followed counter).
      //   Used by 85-combat.js to record what actually happened during the burst, exposed for diagnostics (`getCombatExecutionState()`).
      combatExecution: {
        planId: null,
        currentStepIndex: null,
        lastStepKind: null,
        lastStepSlot: null,
        lastStepName: null,
        lastStepResult: null,
        lastStepAt: null,
        lastReplanReason: null,
        lastInvalidationReason: null,
        planFollowedBeyondFirstStep: 0,
        plansBuilt: 0,
        plansReused: 0,
        plansInvalidated: 0,
        queueAdvancesFromPlan: 0,
        queueAdvancesFromLegacy: 0,
        // AI CHANGED: Planner Part 2 retarget fix v1.1.3 — last post-retarget cancel attempt + dispatch counter.
        //   `lastPostRetargetCancel` shape: { at, method, cancelled, reason? }. `postRetargetCancelDispatches` counts only successful dispatches.
        lastPostRetargetCancel: null,
        postRetargetCancelDispatches: 0,
        // AI CHANGED: Planner Part 2 retarget fix v1.1.3 — last lethal guard event observed by the runtime when arming/chaining queue.
        //   Shape: { at, site: "opener" | "fire_chain", wouldKill, predictedDamage, targetHpCur, source, reason, ... }.
        //   Counter increments only when the guard actually skipped queueing a follow-up.
        lastLethalGuardEvent: null,
        lethalGuardSkips: 0
      },
      // AI CHANGED: AUTO ON chat spammer — next due time, last sent line, and recent send/fail telemetry.
      //   v1.2.0-alpha — `userMessages` is the new manual chat list (set by `setAutoChatMessages([...])`). When non-empty
      //   AND `Config.chat.useUserMessages === true` (default) the spammer cycles through this list instead of the legacy
      //   time-of-day banks. `intervalOverrides` lets the operator set custom min/max in ms via `setAutoChatIntervalRange()`;
      //   when null the scheduler falls back to `Config.chat.messageIntervalMin/Max`.
      chatSpammer: {
        nextSendAt: null,
        lastDelayMs: null,
        lastAttemptAt: null,
        lastSendAt: null,
        lastMessage: null,
        lastMessageIndex: null,
        sends: 0,
        failures: 0,
        lastResult: null,
        userMessages: [],
        userMessageCursor: 0,
        intervalOverrides: null
      },
      // AI CHANGED: Support-buff line — buff system rewrite (v1.0.5-alpha):
      //   `longSelfTracked` = assumed-expiry map (long buffs >=60s, timer-driven, recast when remaining low)
      //   `prebuff` = per-tile gate so a newly entered mob tile is prebuffed exactly once (tile-keyed, NOT duration-tracked)
      //   `longbuff` = per-session flag for first OOC pass + bookkeeping
      //   `safetyHpSpike*` = HP spike → safety skill (set by sustain observations)
      supportBuffLine: {
        longSelfTracked: {},
        lastSafetyBuffCastAt: 0,
        prebuffCastCount: 0,
        prebuff: {
          tileKey: null,
          tileAt: null,
          lastResult: null
        },
        longbuff: {
          initialPassDone: false,
          lastPassAt: null,
          lastResult: null
        },
        safetyHpSpikePending: false,
        safetyHpSpikeLost: null,
        safetyHpSpikeAt: null
      },
      // AI CHANGED: Night resilience — session-health timestamps and last evaluated risk for overloaded tabs / server drops.
      health: {
        lastHealthyAt: null,
        lastProgressAt: null,
        lastActionVerifiedAt: null,
        lastStateReadAt: null,
        poorConnectionSince: null,
        deadSince: null,
        missingCoreUiSince: null,
        highPingSince: null,
        staleSince: null,
        suspectedOverload: false,
        lastRiskReason: null,
        lastSummary: null
      },
      // AI CHANGED: Night resilience — bounded soft/hard recovery attempts and refresh metadata.
      recovery: {
        softAttempts: 0,
        refreshAttempts: 0,
        lastSoftRecoveryAt: null,
        lastRefreshAt: null,
        lastRefreshReason: null,
        lastRefreshToken: null
      },
      // AI CHANGED: Night mode — unattended long-run reliability (hourly refresh + boot autostart). `enabled` persists in ligmarbot.autoFarmUi.v1.
      nightMode: {
        enabled: false,
        hourlyReloadTimer: null,
        hourlyReloadScheduledAt: null,
        hourlyReloadDueAt: null,
        lastReloadAt: null,
        lastBootAutostartAt: null
      }
    },
    // AI CHANGED: Added exploration state so idle movement rotates through nearby directions.
    exploration: {
      directionIndex: 0,
      // AI CHANGED: Stores last known tile coordinates for movement verification.
      lastKnownCoords: null,
      // AI CHANGED: Stores latest 1-ring scan snapshot for GUI/debug use.
      lastRingScan: null,
      // AI CHANGED: Stores latest 2-ring visual scan snapshot (yellow-die detection) for GUI/debug use.
      lastSecondRingScan: null,
      // AI CHANGED: v1.2.0-alpha — last 2-ring CHAMPION-RED scan snapshot (only populated when champion avoidance is off).
      lastSecondRingChampionScan: null,
      // AI CHANGED: v1.2.0-alpha — last 3-ring pixel scan snapshot (only populated when lens equipped + 1+2-ring empty).
      lastThirdRingScan: null,
      // AI CHANGED: v1.2.0-alpha — last direction the bot moved IN. Used by basement forward-objective scoring to penalize
      //   the reverse direction. Set by `exploreByScan()` after a verified move.
      lastMoveDir: null
    },
    // AI CHANGED: v1.2.0-alpha — User-controllable preferences exposed by the desktop app via `window.ligmarBot` setters.
    //   These mirror Config.* defaults at boot but are the real runtime source of truth (Config defaults are only consulted
    //   on first load). Persisted to `ligmarbot.botPreferences.v1` localStorage by `saveBotPreferencesToStorage()`.
    preferences: {
      avoidChampions: true,
      avoidGoblins: false,
      basementFarmingEnabled: false
    },
    // AI CHANGED: v1.2.0-alpha — vision / lens detection state. `hasLens` starts null (unknown); set to true/false by
    //   `detectLensState()` or by `setLensStateOverride(bool)`. When true, exploration scans expand to 2-ring click-scan +
    //   3-ring pixel-scan fallback (see `exploreByScan` lens path).
    vision: {
      hasLens: null,
      lastDetectAt: null,
      lastDetectResult: null,
      detectAttempts: 0,
      manualOverride: null
    },
    // AI CHANGED: v1.2.0-alpha — basement farming runtime state. `active` flips true when the bot enters a basement; the
    //   forward-objective scorer uses `lastDirection` to penalize backtracking and `atEndTile` to allow the end-champion
    //   override (kill basement-end champion even when global champion avoidance is ON).
    basement: {
      active: false,
      enteredAt: null,
      lastEntrySource: null,
      lastDirection: null,
      atEndTile: false,
      mobsKilledHere: 0,
      tilesAdvanced: 0
    },
    // AI CHANGED: Track whether we've already zoomed the map to minimum so scans use calibrated step distances.
    zoom: {
      maxedOut: false
    },
    // AI CHANGED: Live "what is the bot doing right now" tag, updated by setBotStatus() at every phase boundary.
    // phase = short machine-friendly tag (idle/scanning/finding/attacking/looting/moving/verifying/waiting/stopped/halted/starting).
    // detail = freeform human-readable note. since = ms timestamp of last phase change (for "Xs ago" UI label).
    status: {
      phase: "idle",
      detail: "press Start Auto",
      since: Date.now()
    },
    // AI CHANGED: Added GUI runtime references for in-page control panel/status updates.
    ui: {
      panel: null,
      statusNode: null,
      // AI CHANGED: New refs so updateControlPanelStatus can toggle button enabled-state and refresh phase block live.
      startButton: null,
      stopButton: null,
      phaseNode: null,
      phaseDetailNode: null,
      phaseSinceNode: null,
      // AI CHANGED: 2-ring debug overlay refs (the SVG element + its auto-clear timer).
      secondRingOverlay: null,
      secondRingOverlayTimer: null,
      // AI CHANGED: Reserved refs (panel no longer mounts TEST); export JSON still uses `lastTestExport*` after console `runUiTestBundle`.
      testButton: null,
      testResultLine: null,
      // AI CHANGED: Last full TEST self-export JSON for support / AI analysis (90-ui.js).
      lastTestExportJson: null,
      lastTestExportAt: null,
      lastTestExportOk: null,
      // AI CHANGED: periodic GUI footer/phase refresh interval id (single-instance ticker in 90-ui.js).
      statusRefreshTimer: null,
      // AI CHANGED: slice 26 — ranked opener grace ms input (90-ui.js); early-cancel wait mechanic removed.
      combatGraceInput: null
    },
    // AI CHANGED: runUiTestBundle scope — quick profile sets disableChargeCancelUi so charge-cancel taps are skipped (`40-state.js`).
    testBundle: {
      disableChargeCancelUi: false
    },
    // AI CHANGED: Phase C0 -- skill DB. Populated by scanSkills() (manual, console-first). Combat can
    // consume cached slots when Config.planner.useRankedAttackSkillsInCombat is true (slice 8).
    skills: {
      slots: [],            // array of parsed action-bar slot records (see 82-skills.js for shape)
      scannedAt: null,      // ms timestamp of last successful scan
      cacheLoadedAt: null,  // ms timestamp when localStorage cache was loaded on boot
      lastError: null       // string describing the last scan failure, or null
    },
    // AI CHANGED: Phase C1 -- hero combat stats + passive regen snapshots (see 81-hero.js).
    hero: {
      combatStats: null,
      statsReadAt: null,
      statsCacheLoadedAt: null,
      passiveRegen: null,
      regenMeasuredAt: null,
      lastError: null
    },
    // AI CHANGED: Phase C2 -- damage observer; last completed session from observeCombatDamage().
    damage: {
      lastSession: null,
      observedAt: null,
      lastError: null
    },
    // AI CHANGED: Phase C3 -- enemy profile snapshots + accumulated DB (see 84-enemy.js).
    enemy: {
      lastSnapshot: null,
      capturedAt: null,
      db: [],
      dbLoadedAt: null,
      lastError: null,
      // AI CHANGED: Last known enemy DB key from profile/observe/merge (for console + future automation).
      lastFoughtKey: null
    },
    // AI CHANGED: Pack A — last ranked-opener pick outcome when cache empty / all candidates filtered (86-planner.js).
    planner: {
      lastOpeningPickReason: null,
      lastOpeningPickDetail: null,
      lastOpeningPickAt: null,
      lastOpeningPickLogAt: null,
      lastOpeningPickLogReason: null,
      // AI CHANGED: Pack A — dedupe key for throttled opening-pick failure logs (86-planner.js).
      lastOpeningPickLogDetailKey: null,
      // AI CHANGED: last closed-form horizon compare for opener (86-planner.js openerHorizonSim).
      lastOpenerHorizonSim: null,
      // AI CHANGED: Ranked opener runtime telemetry (85-combat.js) for soak validation.
      openerRuntime: {
        events: {
          ranked_pick: 0,
          ranked_pick_none: 0,
          ranked_click_failed: 0,
          ranked_progress: 0,
          ranked_no_progress: 0,
          ranked_alt_pick: 0,
          basic_fallback_after_ranked: 0,
          // AI CHANGED: Runtime queue v1 telemetry for armed/fired follow-up clicks.
          queued_action_armed: 0,
          queued_action_fired: 0
        },
        lastEvent: null,
        lastAt: null,
        recent: []
      },
      // AI CHANGED: active class-profile applied to planner knobs for current runtime.
      activeClassProfile: null,
      // AI CHANGED: last enemy-aware threshold adaptation snapshot (86-planner.js).
      lastEnemyAdaptiveThreshold: null,
      // AI CHANGED: TEST/debug-only opener override — force a named skill when present/feasible, without changing normal combat policy.
      forcedOpenerSkillName: null,
      forcedOpenerReason: null,
      // AI CHANGED: Planner rewrite v1 — last sequence-planner decision snapshot (combat state + normalized skills + top sequences + chosen first/second actions).
      //   Populated by plannerSelectSequencePick(); read by `getPlannerLastSequencePlan()` / `previewPlannerSequences()` / runUiTestBundle checks.
      lastSequencePlan: null,
      // AI CHANGED: Planner Part 2 — active execution plan that combat runtime CONSUMES (not just diagnostic).
      //   Built by `plannerBuildExecutionPlan()` (which wraps `plannerSelectSequencePick()`), hydrated with skill records + per-step
      //   adapter shapes, has step cursor (`currentIndex`) and validity (`valid` + `invalidReason`). Read by `getActiveExecutionPlan()`.
      //   Shape: {
      //     planId, builtAt, targetFingerprint, combatStateAtBuild, actions[], totalActions,
      //     currentIndex, selectionReason, predictedKillAtSec, score, valid, invalidReason,
      //     replanReason, stepHistory[], excludeSlotsApplied, version
      //   }
      activeExecutionPlan: null,
      // AI CHANGED: Planner Part 2 — last reason an execution plan was invalidated (target_fingerprint_changed, target_died, no_progress, post_kill_retarget, plan_exhausted, ...).
      lastExecutionPlanInvalidationReason: null,
      // AI CHANGED: Planner Part 2 — last reason the should-replan helper voted to replan ahead of the next burst.
      lastShouldReplanReason: null
    }
  };
