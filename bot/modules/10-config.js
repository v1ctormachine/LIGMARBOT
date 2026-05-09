  // AI CHANGED: Added centralized config for bootstrap, selectors, and timing.
  const Config = {
    tickMs: 500,
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
      // AI CHANGED: Substrings (lowercase match) on visible app-battle-status-bar label while interaction runs.
      lootInteractionBusySubstrings: ["opening", "activating"]
    },
    // AI CHANGED: Added bounded combat-loop config for secure-tile automation.
    combat: {
      maxFindEnemyAttempts: 8,
      maxAttackAttempts: 12,
      attackTickMs: 350
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
      recenterEveryNCycles: 4
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
    selectors: {
      // AI CHANGED: Relaxed HP selector to avoid brittle container path mismatches.
      hpText: 'app-condition-bar[data-color="green"] span.value',
      // AI CHANGED: Relaxed MP selector to avoid brittle container path mismatches.
      mpText: 'app-condition-bar[data-color="blue"] span.value',
      // AI CHANGED: Wired real enemy counter selector provided from live DOM.
      enemyCounter: "div.battle-bar-enemies-value",
      // AI CHANGED: Wired real find-enemy button selector provided from live DOM.
      findEnemyButton: "app-button-icon.button-find-target",
      // AI CHANGED: Wired real loot/activate selector provided from live DOM.
      lootButton: "div.battle-event-button.highlight",
      // AI CHANGED: Wired basic-attack selector from fresh provided DOM element.
      basicAttackButton: "app-action-button.type-default",
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
      poorConnection: '[data-test="poor-connection"]'
    }
  };
