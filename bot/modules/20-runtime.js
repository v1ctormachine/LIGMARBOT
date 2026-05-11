  // AI CHANGED: Added runtime state container for start/stop auto-farm control.
  const Runtime = {
    autoFarm: {
      running: false,
      stopRequested: false,
      cyclesCompleted: 0,
      consecutiveFailures: 0,
      lastResult: null,
      startedAt: null
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
      // AI CHANGED: TEST (version) panel button — ref for disable-while-running (90-ui.js).
      testButton: null,
      // AI CHANGED: one-line last TEST outcome under the TEST button (90-ui.js runUiTestBundle).
      testResultLine: null,
      // AI CHANGED: periodic GUI footer/phase refresh interval id (single-instance ticker in 90-ui.js).
      statusRefreshTimer: null,
      // AI CHANGED: slice 26 — ranked opener ms inputs (90-ui.js).
      combatGraceInput: null,
      combatEarlyCancelInput: null
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
          basic_fallback_after_ranked: 0
        },
        lastEvent: null,
        lastAt: null,
        recent: []
      }
    }
  };
