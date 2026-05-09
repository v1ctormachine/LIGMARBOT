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
      // AI CHANGED: Stores latest ring scan snapshot for GUI/debug use.
      lastRingScan: null
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
      phaseSinceNode: null
    }
  };
