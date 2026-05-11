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
      // AI CHANGED: slice 23 — first ranked opener only: shorter wait before alternate/basic (avoids ~6.5s idle when top-ranked skill whiffs or is slow to register). Alternate openers still use attackProgressTimeoutMs.
      rankedOpenerFirstProgressTimeoutMs: 4200,
      // AI CHANGED: slice 23 — brief pause after bar skill click before polling HP/count (reduces one-frame false “no progress”).
      postRankedSkillClickSettleMs: 120,
      // AI CHANGED: slice 32 — default 200ms grace before first HP poll on ranked opener (reduces false “no progress” vs 0; panel/combatUi.v1 overrides when saved).
      rankedOpenerChargeGraceMs: 200,
      // AI CHANGED: slice 25 — if > 0 and < rankedOpenerFirstProgressTimeoutMs: after this many ms with no progress, cancel charge when hint visible (else keep waiting until full first wait). 0 = legacy (cancel only after full first wait).
      rankedOpenerEarlyCancelIfHintAfterMs: 0,
      // AI CHANGED: slice 24b — charge skills (e.g. Sniper Shot): CD does not start until cancel UI tap or full charge fires. Only if first progress wait fails, click the cancel control (not the bar slot).
      rankedOpenerClickCancelUiIfChargeStuck: true,
      // AI CHANGED: Prefer click in the gap between map toggle and map canvas (reliable charge cancel); false = DOM cancel only.
      chargingCancelPreferMapGapClick: true,
      chargingCancelHintSubstrings: ["press to cancel"],
      chargingCancelHintScanRoot: "app-game",
      // AI CHANGED: slice 24b — optional explicit cancel button(s); if empty, walk up from hint span to button / role=button.
      chargingCancelClickSelectors: [],
      chargingCancelParentWalkMax: 14,
      attackProgressPollMs: 140,
      // AI CHANGED: Phase C4 slice 9 — after each successful find-enemy, keep attacking until clear/stuck (bounded).
      maxCombatAttackBurstsPerFind: 24
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
      // AI CHANGED: Phase C4 slice 8 — opening hit in attackUntilProgress tries ranked attack skill (cached scanSkills DB), else basic.
      useRankedAttackSkillsInCombat: false,
      // AI CHANGED: Absolute MP floor: cast only if curMp >= manaCost + skillMpReserve (skip skill if MP unread).
      skillMpReserve: 5,
      // AI CHANGED: Phase C4 slice 9 — only first attack burst after each find-enemy uses ranked skill; later bursts basic-only (saves MP/CD on multi-mob pulls).
      useRankedSkillOnlyFirstBurstAfterFind: true,
      // AI CHANGED: Phase C4 slice 11 — skip ranked opener when live DOM hints cooldown on that bar slot (see isActionBarSlotShowingCooldown).
      skipOpenerWhenActionBarShowsCooldown: true,
      // AI CHANGED: Phase C4 slice 15 — after first ranked opener fails verify, try up to N more ranked picks (same burst, same beforeState baseline) before basic fallback.
      openerExtraRankedSkills: 1,
      // AI CHANGED: Pack A — console visibility when ranked openers are ON but no slot is eligible (empty cache, MP gate, cooldown hints, etc.).
      logOpeningPickFailures: true,
      // AI CHANGED: Pack A — min ms between repeated [PLANNER] logs for the same failure class (still updates Runtime.planner every pick).
      openingPickFailureLogThrottleMs: 12000,
      // AI CHANGED: openerHorizonSim — compare ~N ms of paper damage: skill opener + basics after cast vs basics-only; pick skill only if ahead by min fraction (no per-tick sim loop — cheap).
      useOpenerHorizonSim: true,
      openerHorizonSimMs: 5000,
      openerHorizonMinImprovementFraction: 0.02,
      openerHorizonLog: false,
      // AI CHANGED: When true, attack-skill rank order uses inferSkillConception() (level-invariant roles) instead of parsed effect magnitudes.
      skillRankUseConception: false
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
      heroBattleFooterButton: ".footer-button .footer-button-text",
      // Icon on the Battle footer button (close profile / return to game).
      heroBattleFooterIcon: ".footer-button .icon-src-swords",
      // AI CHANGED: Phase C3 -- enemy profile panel (for probeSelectors + consistency with enemyProfile.*).
      enemyProfileNameText: ".profile-name-text",
      enemyProfileLevel: ".profile-level",
      enemyBattleStatusBar: "app-battle-status-bar"
    }
  };
