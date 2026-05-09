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
    // AI CHANGED: Added GUI runtime references for in-page control panel/status updates.
    ui: {
      panel: null,
      statusNode: null
    }
  };
