  // AI CHANGED: Added startup routine and optional debug helpers for manual testing.
  function start() {
    if (!isGamePage()) {
      Logger.warn("BOOT", "Not on /game/ page. Script idle.");
      return;
    }

    // AI CHANGED: Boot log now includes BotVersion so the console clearly reports which bundle is live.
    Logger.log("BOOT", `bot loaded — v${BotVersion.version}: ${BotVersion.description}`);
    probeSelectors();

    // AI CHANGED: Phase C0 -- attempt to populate Runtime.skills.slots from localStorage cache.
    // If the cache is empty (first run, cleared cache, or schema bump) we just log a hint so the
    // user knows to call ligmarBot.scanSkills() with auto-farm OFF.
    const skillsLoaded = loadSkillsFromCache();
    if (skillsLoaded) {
      Logger.log("BOOT", `Loaded ${Runtime.skills.slots.length} skill slots from cache`, {
        savedAt: Runtime.skills.scannedAt
      });
      // AI CHANGED: slice 12b — cache is global per browser key, not per class; stale slots break planner + open wrong popups.
      Logger.log(
        "BOOT",
        "If you changed class/hero or action bar: ligmarBot.clearSkillsCache() then await ligmarBot.scanSkills() (auto-farm OFF)."
      );
    } else if (Runtime.skills.lastError === "cache_bar_not_ready") {
      // AI CHANGED: slice 16 — first inject can run before `app-battle-action-bar` mounts; retry once so a valid cache still loads.
      Logger.log("BOOT", "Skill cache deferred: action bar not ready for fingerprint; retry in 1.5s.");
      setTimeout(function () {
        Runtime.skills.lastError = null;
        if (loadSkillsFromCache()) {
          Logger.log("BOOT", `Loaded ${Runtime.skills.slots.length} skill slots from cache (deferred)`, {
            savedAt: Runtime.skills.scannedAt
          });
          Logger.log(
            "BOOT",
            "If you changed class/hero or action bar: ligmarBot.clearSkillsCache() then await ligmarBot.scanSkills() (auto-farm OFF)."
          );
        } else {
          Logger.log(
            "BOOT",
            "Deferred skill cache load skipped — run `ligmarBot.scanSkills()` (auto-farm OFF) if slots stay empty or names look wrong."
          );
        }
      }, 1500);
    } else if (
      Runtime.skills.lastError === "cache_bar_mismatch" ||
      Runtime.skills.lastError === "cache_missing_fingerprint"
    ) {
      Logger.log(
        "BOOT",
        "Skill cache rejected (bar changed vs saved scan, or old save without fingerprint). Run `ligmarBot.scanSkills()` (auto-farm OFF)."
      );
    } else {
      Logger.log("BOOT", "No cached skill DB. Run `ligmarBot.scanSkills()` (with auto-farm OFF) to populate it.");
    }

    const heroLoaded = loadHeroStatsFromCache();
    if (heroLoaded) {
      Logger.log("BOOT", "Loaded hero combat stats from cache", { savedAt: Runtime.hero.statsReadAt });
    }

    const dmgCached = loadDamageObserveSummaryFromStorage();
    if (dmgCached && dmgCached.summary) {
      Logger.log("BOOT", "Last damage observe summary in storage", { savedAt: dmgCached.savedAt, summary: dmgCached.summary });
    }

    const enemyDbLoaded = loadEnemyDbFromCache();
    if (enemyDbLoaded) {
      Logger.log("BOOT", `Loaded ${Runtime.enemy.db.length} enemy DB rows from cache`);
    }

    window.ligmarBot = {
      // AI CHANGED: Expose BotVersion on the debug API for quick inspection from console.
      version: BotVersion,
      // AI CHANGED: Phase C0 -- expose Config/Runtime references so live tweaks land in the right place.
      Config: Config,
      Runtime: Runtime,
      config: Config,
      logger: Logger,
      probeSelectors: probeSelectors,
      readBasicState: readBasicState,
      discoverFractionNodes: discoverFractionNodes,
      discoverButtons: discoverButtons,
      readEnemyCount: readEnemyCount,
      clickFindEnemy: clickFindEnemy,
      clickLootOrActivate: clickLootOrActivate,
      waitForCondition: waitForCondition,
      clickFindEnemyVerified: clickFindEnemyVerified,
      clickLootOrActivateVerified: clickLootOrActivateVerified,
      clickCenterMap: clickCenterMap,
      clickCenterMapVerified: clickCenterMapVerified,
      clickMapToggle: clickMapToggle,
      ensureMapOpen: ensureMapOpen,
      // AI CHANGED: Expose zoom helpers so user can re-trigger max zoom-out after reload/death without restarting bot.
      ensureMapZoomedOut: ensureMapZoomedOut,
      forceZoomOut: forceZoomOut,
      getMapCanvas: getMapCanvas,
      moveToMapPoint: moveToMapPoint,
      exploreIfIdle: exploreIfIdle,
      scanNeighborRing: scanNeighborRing,
      // AI CHANGED: Expose 2-ring visual scanners so the user can manually probe yellow-die / other colors from the console.
      scanSecondRingForDie: scanSecondRingForDie,
      scanSecondRingForColor: scanSecondRingForColor,
      getSecondRingOffsets: getSecondRingOffsets,
      ringHasUsefulLoot: ringHasUsefulLoot,
      // AI CHANGED: Expose overlay control so user can manually clear / re-render from console.
      renderSecondRingOverlay: renderSecondRingOverlay,
      clearSecondRingOverlay: clearSecondRingOverlay,
      clickBasicAttack: clickBasicAttack,
      clickActionBarSlot: clickActionBarSlot,
      clickActionBarSlotHoldCast: clickActionBarSlotHoldCast,
      closeSkillInfoPopupQuick: closeSkillInfoPopupQuick,
      isActionBarSlotShowingCooldown: isActionBarSlotShowingCooldown,
      isBasicAttackConfigured: isBasicAttackConfigured,
      setBasicAttackSelector: setBasicAttackSelector,
      secureTileAndLootOnce: secureTileAndLootOnce,
      prepMapForCombatCycle: prepMapForCombatCycle,
      prepareAndScanOnce: prepareAndScanOnce,
      runPreparedSecureCycle: runPreparedSecureCycle,
      startAutoFarmLoop: startAutoFarmLoop,
      stopAutoFarmLoop: stopAutoFarmLoop,
      getAutoFarmStatus: getAutoFarmStatus,
      createControlPanel: createControlPanel,
      updateControlPanelStatus: updateControlPanelStatus,
      // AI CHANGED: Phase C0 -- skill scanner public API. scanSkills() is the only "active" call;
      // the rest are getters / cache helpers for inspection and recovery.
      scanSkills: scanSkills,
      get skills() { return Runtime.skills.slots; },
      getSkillsMeta: function () {
        return {
          count: Runtime.skills.slots.length,
          scannedAt: Runtime.skills.scannedAt,
          cacheLoadedAt: Runtime.skills.cacheLoadedAt,
          lastError: Runtime.skills.lastError
        };
      },
      clearSkillsCache: clearSkillsCache,
      readActionBarLayoutFingerprint: readActionBarLayoutFingerprint,
      parseSkillEffects: parseSkillEffects,
      // AI CHANGED: Phase C1 -- hero stats + passive regen (console-first).
      readHeroCombatStats: readHeroCombatStats,
      measurePassiveRegen: measurePassiveRegen,
      loadHeroStatsFromCache: loadHeroStatsFromCache,
      clearHeroStatsCache: clearHeroStatsCache,
      collectHeroStatsTextBlob: collectHeroStatsTextBlob,
      parseHeroCombatStatsFromText: parseHeroCombatStatsFromText,
      parseHeroCombatStatsFromParamItems: parseHeroCombatStatsFromParamItems,
      mergeHeroCombatStats: mergeHeroCombatStats,
      // AI CHANGED: Phase C2 -- damage observer (HP deltas + floating numeric text).
      observeCombatDamage: observeCombatDamage,
      snapFloatingDamageOnce: snapFloatingDamageOnce,
      clearDamageObserveStorage: clearDamageObserveStorage,
      getDamageObserveMeta: getDamageObserveMeta,
      loadDamageObserveSummaryFromStorage: loadDamageObserveSummaryFromStorage,
      // AI CHANGED: Phase C3 -- enemy target profile + DB.
      readTargetProfileSnapshot: readTargetProfileSnapshot,
      recordTargetToEnemyDb: recordTargetToEnemyDb,
      loadEnemyDbFromCache: loadEnemyDbFromCache,
      saveEnemyDbToCache: saveEnemyDbToCache,
      clearEnemyDbCache: clearEnemyDbCache,
      getEnemyDbMeta: getEnemyDbMeta,
      makeEnemyDbKey: makeEnemyDbKey,
      mergeLastDamageObserveIntoEnemyDb: mergeLastDamageObserveIntoEnemyDb,
      // AI CHANGED: Phase C4 slice 1 -- paper basic-attack DPS + skill list (console).
      estimatePaperBasicAttackDps: estimatePaperBasicAttackDps,
      listAttackSkillsForPlanner: listAttackSkillsForPlanner,
      summarizePlannerInputs: summarizePlannerInputs,
      summarizeEnemyDbCalibration: summarizeEnemyDbCalibration,
      getEnemyCalibrationRow: getEnemyCalibrationRow,
      plannerSkillEffectHeuristicScore: plannerSkillEffectHeuristicScore,
      rankAttackSkillsByHeuristic: rankAttackSkillsByHeuristic,
      calibrateEnemyFromCombat: calibrateEnemyFromCombat,
      quickCalibrationSession: quickCalibrationSession,
      getLastFoughtEnemyKey: getLastFoughtEnemyKey,
      plannerPickSkillSlotToCast: plannerPickSkillSlotToCast,
      plannerPickSkillOpeningPick: plannerPickSkillOpeningPick,
      plannerOpenerHoldCastMs: plannerOpenerHoldCastMs,
      plannerSkillOpenerHoldBlockedByShortPressLimit: plannerSkillOpenerHoldBlockedByShortPressLimit,
      plannerSkillHasDirectDamageForOpener: plannerSkillHasDirectDamageForOpener
    };

    Logger.log("BOOT", "Debug API exposed as window.ligmarBot");
    // AI CHANGED: Auto-create GUI control panel at startup.
    createControlPanel();

    setInterval(() => {
      const state = readBasicState();
      if (Config.logging.stateSnapshots) {
        Logger.log("STATE", "Basic snapshot", state);
      }
    }, Config.tickMs);
  }

  start();
})();
