  // AI CHANGED: Added startup routine and optional debug helpers for manual testing.
  function start() {
    if (!isGamePage()) {
      Logger.warn("BOOT", "Not on /game/ page. Script idle.");
      return;
    }

    // AI CHANGED: Boot log now includes BotVersion so the console clearly reports which bundle is live.
    Logger.log("BOOT", `bot loaded — v${BotVersion.version}: ${BotVersion.description}`);
    // AI CHANGED: slice 21 — neighborStepPx ring calibration assumes ~100% browser zoom / nominal DPR≈1.
    if (
      Config.boot &&
      Config.boot.warnNonUnityDevicePixelRatio &&
      typeof window.devicePixelRatio === "number" &&
      Math.abs(window.devicePixelRatio - 1) > 0.02
    ) {
      Logger.warn(
        "BOOT",
        `devicePixelRatio=${window.devicePixelRatio} — ring scan neighborStepPx is tuned for ~1.0; zoomed OS display or browser zoom may misalign clicks.`
      );
    }
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
      // AI CHANGED: slice 16 — first inject can run before `app-battle-action-bar` mounts; slice 21b — multi-retry schedule.
      const delays =
        Array.isArray(Config.skills.bootCacheRetryDelaysMs) && Config.skills.bootCacheRetryDelaysMs.length > 0
          ? Config.skills.bootCacheRetryDelaysMs
          : [1500, 3500, 8000];
      function scheduleSkillCacheRetry(retryIndex) {
        if (retryIndex >= delays.length) {
          Logger.log(
            "BOOT",
            "Skill cache not loaded after deferred retries — run `ligmarBot.scanSkills()` (auto-farm OFF) if slots stay empty or names look wrong."
          );
          return;
        }
        const waitMs = delays[retryIndex];
        Logger.log("BOOT", `Skill cache deferred: action bar not ready for fingerprint; retry ${retryIndex + 1}/${delays.length} in ${waitMs}ms.`);
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
            scheduleSkillCacheRetry(retryIndex + 1);
          }
        }, waitMs);
      }
      scheduleSkillCacheRetry(0);
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
      // AI CHANGED: slice 24b — debug charge cancel UI (not bar slot).
      isChargingSkillCancelHintVisible: isChargingSkillCancelHintVisible,
      // AI CHANGED: Debug charge-cancel — cast bar must show expected skill when chargeCancelRequireCastBarNameMatch is on.
      isCastBarShowingExpectedSkillNameForChargeCancel: isCastBarShowingExpectedSkillNameForChargeCancel,
      getChargingSkillCancelClickTarget: getChargingSkillCancelClickTarget,
      clickChargingSkillCancelUi: clickChargingSkillCancelUi,
      // AI CHANGED: Debug map-gap charge-cancel coordinates (slice 24b gap click).
      getChargeCancelMapGapClientPoint: getChargeCancelMapGapClientPoint,
      discoverFractionNodes: discoverFractionNodes,
      discoverButtons: discoverButtons,
      readEnemyCount: readEnemyCount,
      clickFindEnemy: clickFindEnemy,
      clickLootOrActivate: clickLootOrActivate,
      // AI CHANGED: AUTO ON chat spammer helpers — smoke-test without sending, or manually send one configured line from console.
      ensureChatDialogOpen: ensureChatDialogOpen,
      closeChatDialog: closeChatDialog,
      probeLocalChatPromocodeUi: probeLocalChatPromocodeUi,
      sendLocalChatPromocodeMessage: sendLocalChatPromocodeMessage,
      // AI CHANGED: AUTO chat banks — local-clock slot + flattened pool for diagnostics.
      getTimeOfDayChatSlot: getTimeOfDayChatSlot,
      getChatSpammerMessagesForSlot: getChatSpammerMessagesForSlot,
      getAllChatSpammerMessagesFlat: getAllChatSpammerMessagesFlat,
      // AI CHANGED: Support-buff teaching — classify scanned support slots; heuristic list for Windy Dome–style absorbs.
      listScannedSupportBuffClassifications:
        typeof listScannedSupportBuffClassifications === "function" ? listScannedSupportBuffClassifications : null,
      listSafetyLikeBuffsFromScannedSkills:
        typeof listScannedSkillsMatchingSafetyBuffHeuristic === "function" ? listScannedSkillsMatchingSafetyBuffHeuristic : null,
      // AI CHANGED: assumed buff duration map (prebuff + permanent self) — clear after dispel / wrong assumptions.
      clearSupportBuffAssumedDurationTracking:
        typeof clearSupportBuffAssumedDurationTracking === "function" ? clearSupportBuffAssumedDurationTracking : null,
      getSupportBuffAssumedDurationTrackingSnapshot:
        typeof getSupportBuffAssumedDurationTrackingSnapshot === "function" ? getSupportBuffAssumedDurationTrackingSnapshot : null,
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
      // AI CHANGED: slice 21 — debug: clear zoom cache when session shows death / poor connection.
      resetZoomAssumptionIfSessionRisk: resetZoomAssumptionIfSessionRisk,
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
      setAutoFarmCombatMode: setAutoFarmCombatMode,
      applyAutoFarmCombatMode: applyAutoFarmCombatMode,
      // AI CHANGED: Easy-mode predicate exposed for console debugging of buff/scan suppression.
      isAutoFarmEasyMode: typeof isAutoFarmEasyMode === "function" ? isAutoFarmEasyMode : null,
      getCombatEpisode: function () {
        return Runtime.autoFarm && Runtime.autoFarm.combatEpisode ? Runtime.autoFarm.combatEpisode : null;
      },
      // AI CHANGED: Night resilience — debug the watchdog and persisted refresh-resume behavior from console.
      evaluateAutoFarmHealth: evaluateAutoFarmHealth,
      maybeRecoverUnhealthySession: maybeRecoverUnhealthySession,
      readPersistedAutoRecoveryResume: readPersistedAutoRecoveryResume,
      clearPersistedAutoRecoveryResume: clearPersistedAutoRecoveryResume,
      resumeAutoFarmAfterRecoveryBootIfNeeded: resumeAutoFarmAfterRecoveryBootIfNeeded,
      // AI CHANGED: Night mode — unattended overnight farm: hourly reload + boot autostart, persisted in `ligmarbot.autoFarmUi.v1`.
      isNightModeEnabled: typeof isNightModeEnabled === "function" ? isNightModeEnabled : null,
      setNightModeEnabled: typeof setNightModeEnabled === "function" ? setNightModeEnabled : null,
      scheduleNightModeHourlyReloadIfNeeded:
        typeof scheduleNightModeHourlyReloadIfNeeded === "function" ? scheduleNightModeHourlyReloadIfNeeded : null,
      cancelNightModeHourlyReload:
        typeof cancelNightModeHourlyReload === "function" ? cancelNightModeHourlyReload : null,
      triggerNightModeHourlyReload:
        typeof triggerNightModeHourlyReload === "function" ? triggerNightModeHourlyReload : null,
      writeNightModeBootAutostartTokenIfNeeded:
        typeof writeNightModeBootAutostartTokenIfNeeded === "function"
          ? writeNightModeBootAutostartTokenIfNeeded
          : null,
      getNightModeStatus: function () {
        const nm =
          Runtime.autoFarm && Runtime.autoFarm.nightMode && typeof Runtime.autoFarm.nightMode === "object"
            ? Runtime.autoFarm.nightMode
            : null;
        return {
          enabled: !!(nm && nm.enabled),
          hourlyReloadDueAt: nm ? nm.hourlyReloadDueAt : null,
          hourlyReloadScheduledAt: nm ? nm.hourlyReloadScheduledAt : null,
          hourlyReloadMs: (Config.nightMode && Config.nightMode.hourlyReloadMs) || 3600000,
          autoFarmRunning: !!(Runtime.autoFarm && Runtime.autoFarm.running),
          reloadOnlyWhenAutoFarmRunning: !!(Config.nightMode && Config.nightMode.reloadOnlyWhenAutoFarmRunning !== false),
          lastReloadAt: nm ? nm.lastReloadAt : null,
          lastBootAutostartAt: nm ? nm.lastBootAutostartAt : null
        };
      },
      createControlPanel: createControlPanel,
      updateControlPanelStatus: updateControlPanelStatus,
      // AI CHANGED: grouped slice 34 — planner localStorage sync from console (panel had no toggles since slice 29).
      loadPlannerUiPrefs: loadPlannerUiPrefs,
      savePlannerUiPrefs: savePlannerUiPrefs,
      // AI CHANGED: slice 35 — combat opener prefs (`ligmarbot.combatUi.v1`): grace ms, charge fraction, optional `chargeSkillReleaseOverrideMs`; load/save from console.
      loadCombatUiPrefs: loadCombatUiPrefs,
      saveCombatUiPrefs: saveCombatUiPrefs,
      loadAutoFarmUiPrefs: loadAutoFarmUiPrefs,
      saveAutoFarmUiPrefs: saveAutoFarmUiPrefs,
      // AI CHANGED: slice 36 — persist / reload both storage keys; console shows `{ ok, … }` not `undefined`.
      saveAllUiPrefs: saveAllUiPrefs,
      loadAllUiPrefs: loadAllUiPrefs,
      // AI CHANGED: Panel TEST and console — same entry point; default profile is **panel** unless opts override `testProfile`.
      runUiTestBundle: runUiTestBundle,
      // AI CHANGED: Last full TEST JSON export (same as green DevTools block) for copy without selecting console text.
      getLastTestExport: function () {
        if (!Runtime.ui || !Runtime.ui.lastTestExportJson) {
          return { ok: false, reason: "no_test_export_yet", hint: "Run ligmarBot.runUiTestBundle() from the console (panel TEST removed)." };
        }
        return {
          ok: true,
          at: Runtime.ui.lastTestExportAt,
          passed: Runtime.ui.lastTestExportOk,
          json: Runtime.ui.lastTestExportJson
        };
      },
      // AI CHANGED: ROADMAP #2 field validation — same slice as TEST export `gameSnapshotEnd.fieldValidation` (call anytime during soak).
      getFieldValidationSnapshot: function () {
        if (typeof buildFieldValidationSnapshotForTestExport !== "function") {
          return { ok: false, reason: "not_available" };
        }
        return { ok: true, snapshot: buildFieldValidationSnapshotForTestExport() };
      },
      // AI CHANGED: Issue log clip — same as `ligmarBot.copyIssueReportLogs({ lines, stopFarm, via })` (Logger ring buffer).
      copyIssueReportLogs:
        typeof copyIssueReportLogsForSupport === "function" ? copyIssueReportLogsForSupport : null,
      // AI CHANGED: Phase C0 -- skill scanner public API. scanSkills() is the only "active" call;
      // the rest are getters / cache helpers for inspection and recovery.
      scanSkills: scanSkills,
      // AI CHANGED: Console / TEST — parse merged popup description text (e.g. potion HoT with (+bonus) heal).
      parseSkillEffects: typeof parseSkillEffects === "function" ? parseSkillEffects : null,
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
      applySkillMasterToSlots: applySkillMasterToSlots,
      readActionBarLayoutFingerprint: readActionBarLayoutFingerprint,
      getActionBarSlotElements: getActionBarSlotElements,
      parseSkillEffects: parseSkillEffects,
      inferSkillConception: inferSkillConception,
      normalizeSkillName: normalizeSkillName,
      // AI CHANGED: Master skill DB (tree export) lookup — keyed by class + normalized name; Requirements are not stored.
      getSkillMasterEntry: typeof getSkillMasterEntry === "function" ? getSkillMasterEntry : null,
      // AI CHANGED: Static support-skill taxonomy from ligmar_hero_skills_db (build-generated 88 module).
      lookupSupportSkillClassificationFromGeneratedDb:
        typeof lookupSupportSkillClassificationFromGeneratedDb === "function"
          ? lookupSupportSkillClassificationFromGeneratedDb
          : null,
      listSupportSkillClassificationFromMasterDb:
        typeof listSupportSkillClassificationFromMasterDb === "function"
          ? listSupportSkillClassificationFromMasterDb
          : null,
      getSkillMasterConception: typeof getSkillMasterConception === "function" ? getSkillMasterConception : null,
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
      summarizeEnemyBuffSigBuckets: summarizeEnemyBuffSigBuckets,
      plannerSkillEffectHeuristicScore: plannerSkillEffectHeuristicScore,
      rankAttackSkillsByHeuristic: rankAttackSkillsByHeuristic,
      calibrateEnemyFromCombat: calibrateEnemyFromCombat,
      quickCalibrationSession: quickCalibrationSession,
      getLastFoughtEnemyKey: getLastFoughtEnemyKey,
      plannerResolveCombatEpisodeTargetKey:
        typeof plannerResolveCombatEpisodeTargetKey === "function" ? plannerResolveCombatEpisodeTargetKey : null,
      plannerBuildCombatEpisodePlan:
        typeof plannerBuildCombatEpisodePlan === "function" ? plannerBuildCombatEpisodePlan : null,
      plannerPickSkillSlotToCast: plannerPickSkillSlotToCast,
      plannerPickSkillOpeningPick: plannerPickSkillOpeningPick,
      plannerOpenerHoldCastMs: plannerOpenerHoldCastMs,
      plannerSkillHasDirectDamageForOpener: plannerSkillHasDirectDamageForOpener,
      // AI CHANGED: Pack A — last opener skip reason + counts (after combat tries ranked openers).
      getPlannerOpeningPickDiagnostics: getPlannerOpeningPickDiagnostics,
      // AI CHANGED: Runtime ranked-opener telemetry for soak validation (85-combat -> Runtime.planner.openerRuntime).
      getPlannerRuntimeTelemetry: getPlannerRuntimeTelemetry,
      resetPlannerRuntimeTelemetry: resetPlannerRuntimeTelemetry,
      plannerApplyClassProfile: plannerApplyClassProfile,
      // AI CHANGED: Diagnostics-only threshold suggestion from ranked runtime telemetry (no auto-write to Config).
      plannerBuildRankedTuningHint: plannerBuildRankedTuningHint,
      // AI CHANGED: openerHorizonSim — paper damage window preview for ranked candidates (86-planner.js).
      previewOpenerHorizonSim: previewOpenerHorizonSim
    };

    Logger.log("BOOT", "Debug API exposed as window.ligmarBot");
    // AI CHANGED: Auto-create GUI control panel at startup. createControlPanel() also calls loadAutoFarmUiPrefs(), so Night Mode is restored before we check whether to autostart.
    createControlPanel();
    // AI CHANGED: Night mode — if persisted ON and no recovery token is pending, write a boot-autostart resume token so the existing health-check path drives AUTO start.
    if (typeof writeNightModeBootAutostartTokenIfNeeded === "function") {
      writeNightModeBootAutostartTokenIfNeeded();
    }
    // AI CHANGED: Night resilience — if the previous page refresh was a recovery action (or Night Mode boot autostart), wait for a healthy game surface and resume AUTO.
    resumeAutoFarmAfterRecoveryBootIfNeeded();

    // AI CHANGED: grouped slice 34 — obvious console hint when ranked planner is on but scanSkills never ran.
    if (
      Config.planner.useRankedAttackSkillsInCombat &&
      (!Array.isArray(Runtime.skills.slots) || Runtime.skills.slots.length === 0)
    ) {
      Logger.warn(
        "BOOT",
        "useRankedAttackSkillsInCombat is true but skill slots are empty — openers stay basic until the bar is scanned (AUTO runs OOC ensureSkills when farmLoop.ensureSkills is on, or await ligmarBot.scanSkills()). Persist planner tweaks: ligmarBot.savePlannerUiPrefs()"
      );
    }

    setInterval(() => {
      const state = readBasicState();
      if (Config.logging.stateSnapshots) {
        Logger.log("STATE", "Basic snapshot", state);
      }
    }, Config.tickMs);
  }

  start();
})();
