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
      // AI CHANGED: Slightly relaxed scan timing to reduce false blocked reads.
      tileTimeoutMs: 760,
      // AI CHANGED: Slower polling cadence for more stable UI state transitions.
      pollMs: 95
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
