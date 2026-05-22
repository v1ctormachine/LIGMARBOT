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
      // AI CHANGED: Panel AUTO combat style — Fast / Safe / Easy. `applyAutoFarmCombatMode` syncs planner whenever the mode changes or prefs load; AUTO start still snapshots planner for restore on loop exit.
      combatMode: "fast",
      // AI CHANGED: Snapshot of planner combat flags taken when AUTO starts; restored on loop exit.
      plannerSnapshotBeforeAuto: null,
      // AI CHANGED: One-shot per AUTO session — first OOC cycle can run TEST-like prep (`Config.farmLoop.autoLikeTest`); cleared when the loop ends.
      autoLikeTestPrepDone: false,
      // AI CHANGED: One-shot per AUTO session — once `ensureSkillsAndHeroDataForAutoFarm` lands usable skills, subsequent OOC cycles skip the cache reload + scan log.
      skillEnsureDone: false,
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
        anchorNeedsReset: false
      },
      // AI CHANGED: Combat episode v1 — last burst’s ordered opener + follow-up plan snapshot (`86-planner` + `85-combat`); cleared on target change / secure cycle / post-kill retarget.
      combatEpisode: null,
      // AI CHANGED: AUTO ON chat spammer — next due time, last sent line, and recent send/fail telemetry.
      chatSpammer: {
        nextSendAt: null,
        lastDelayMs: null,
        lastAttemptAt: null,
        lastSendAt: null,
        lastMessage: null,
        lastMessageIndex: null,
        sends: 0,
        failures: 0,
        lastResult: null
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
      lastSecondRingScan: null
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
      lastSequencePlan: null
    }
  };
