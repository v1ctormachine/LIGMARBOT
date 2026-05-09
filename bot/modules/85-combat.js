  // AI CHANGED: Phase C4 slice 8 — first swing: ranked attack skill (if enabled + pick), else basic attack.
  // AI CHANGED: slice 9 — optional opts.useRankedSkillOpener === false forces basic-only (follow-up bursts).
  // AI CHANGED: slice 12 — channel / non-instant cast uses hold-cast on bar when plannerOpenerHoldCastMs > 0.
  // AI CHANGED: slice 15 — excludeSlots skips bar indices already used this burst (alternate ranked openers).
  async function clickPlannerOpeningAttack(opts, excludeSlots) {
    const useSkill =
      Config.planner.useRankedAttackSkillsInCombat &&
      (!opts || opts.useRankedSkillOpener !== false);
    if (useSkill) {
      const opening = plannerPickSkillOpeningPick({ excludeSlots: excludeSlots || [] });
      if (opening != null) {
        const holdMs = plannerOpenerHoldCastMs(opening.record);
        let ok = false;
        if (holdMs > 0) {
          ok = await clickActionBarSlotHoldCast(opening.slot, holdMs);
          if (ok) {
            Logger.log("PLANNER", "Opening attack used ranked skill slot (hold-cast)", {
              slot: opening.slot,
              holdMs: holdMs,
              name: opening.record.name || ""
            });
            return { ok: true, skillSlot: opening.slot };
          }
          Logger.warn("PLANNER", "Hold-cast failed; trying normal click", { slot: opening.slot });
        }
        ok = clickActionBarSlot(opening.slot);
        if (ok) {
          Logger.log("PLANNER", "Opening attack used ranked skill slot", { slot: opening.slot });
          return { ok: true, skillSlot: opening.slot };
        }
        Logger.warn("PLANNER", "Ranked skill slot click failed; falling back to basic attack", { slot: opening.slot });
      }
    }
    const basicOk = clickBasicAttack();
    return { ok: basicOk, skillSlot: null };
  }

  // AI CHANGED: slice 8b — true if enemy died (count) or target red bar dropped (same max HP baseline).
  function hasCombatProgressSince(baselineState) {
    return function () {
      const now = readBasicState();
      if (
        typeof baselineState.combat.enemyCount === "number" &&
        typeof now.combat.enemyCount === "number" &&
        now.combat.enemyCount < baselineState.combat.enemyCount
      ) {
        return true;
      }
      const b = baselineState.combat.targetHp;
      const t = now.combat.targetHp;
      if (b && b.valid && t && t.valid && b.max === t.max && t.cur < b.cur) {
        return true;
      }
      return false;
    };
  }

  // AI CHANGED: Added helper to verify attack effect by enemy count drop or target HP change.
  // AI CHANGED: slice 9 — opts.useRankedSkillOpener (default true) gates ranked opener vs basic-only burst.
  async function attackUntilProgress(beforeState, opts) {
    const timeoutMs = Number.isFinite(Config.combat.attackProgressTimeoutMs)
      ? Config.combat.attackProgressTimeoutMs
      : 4500;
    const pollMs = Number.isFinite(Config.combat.attackProgressPollMs)
      ? Config.combat.attackProgressPollMs
      : 140;

    const open = await clickPlannerOpeningAttack(opts, []);
    if (!open.ok) {
      Logger.warn("LOOP", "Attack loop aborted: no attack click succeeded");
      return false;
    }

    let progressed = await waitForCondition(
      "attack progress",
      hasCombatProgressSince(beforeState),
      { timeoutMs: timeoutMs, pollMs: pollMs }
    );
    if (progressed) {
      return true;
    }

    // AI CHANGED: slice 15 — try next ranked opener(s) before basic if first skill had no verified effect.
    const extra = Number.isFinite(Config.planner.openerExtraRankedSkills)
      ? Config.planner.openerExtraRankedSkills
      : 0;
    const triedSlots =
      open.skillSlot != null && typeof open.skillSlot === "number" ? [open.skillSlot] : [];
    for (let alt = 0; alt < extra; alt += 1) {
      if (triedSlots.length === 0) {
        break;
      }
      const open2 = await clickPlannerOpeningAttack(opts, triedSlots.slice());
      if (!open2.ok || open2.skillSlot == null) {
        break;
      }
      Logger.log("PLANNER", "Alternate ranked opener after no progress", {
        slot: open2.skillSlot,
        attempt: alt + 1
      });
      progressed = await waitForCondition(
        "attack progress",
        hasCombatProgressSince(beforeState),
        { timeoutMs: timeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        return true;
      }
      triedSlots.push(open2.skillSlot);
    }

    if (triedSlots.length > 0) {
      Logger.warn("PLANNER", "Ranked opener(s) had no verified progress; trying basic attack", {
        triedSlots: triedSlots
      });
      const baselineAfterSkill = readBasicState();
      if (!clickBasicAttack()) {
        Logger.warn("LOOP", "Basic attack click failed after skill opener");
        return false;
      }
      progressed = await waitForCondition(
        "attack progress",
        hasCombatProgressSince(baselineAfterSkill),
        { timeoutMs: timeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        return true;
      }
    }

    Logger.warn("LOOP", "No attack progress detected (enemy count + target HP unchanged for baseline)");
    return false;
  }

  // AI CHANGED: Phase C4 -- optional enemy DB refresh during auto-farm (Config.planner.recordEnemyDbBeforeAttack).
  function plannerMaybeRecordEnemyBeforeAttack() {
    if (!Config.planner.recordEnemyDbBeforeAttack) {
      return null;
    }
    try {
      const rec = recordTargetToEnemyDb();
      if (rec) {
        Logger.log("PLANNER", "Enemy DB row refreshed before attack", { key: rec.key });
      }
      return rec;
    } catch (err) {
      Logger.warn("PLANNER", "recordTargetToEnemyDb failed", err);
      return null;
    }
  }

  // AI CHANGED: Phase C4 -- one-line hint after combat clears (Config.planner.logPlannerAfterSecureTile).
  function plannerMaybeLogAfterSecureCombat() {
    if (!Config.planner.logPlannerAfterSecureTile) {
      return;
    }
    const key = Runtime.enemy.lastFoughtKey;
    let calibrated = false;
    if (key && Runtime.enemy.db && Runtime.enemy.db.length) {
      const row = Runtime.enemy.db.find((r) => r.key === key);
      calibrated = !!(row && row.observeCalAgg && row.observeCalAgg.hpDropSamples > 0);
    }
    Logger.log("PLANNER", "Combat cleared — planner snapshot", {
      lastFoughtKey: key,
      hasHpDropCalibration: calibrated,
      hint: calibrated
        ? null
        : "For hp_drop merge: await ligmarBot.quickCalibrationSession() while attacking a target."
    });
  }

  // AI CHANGED: Added first autonomous secure-current-tile-and-loot cycle with bounded retries.
  async function secureTileAndLootOnce() {
    const startState = readBasicState();
    if (typeof startState.combat.enemyCount !== "number") {
      Logger.warn("LOOP", "Cannot start secure loop: enemyCount unavailable");
      return { ok: false, stage: "precheck", reason: "enemy_count_unavailable" };
    }

    // AI CHANGED: Surface secure-tile preparation as live status.
    setBotStatus("preparing", `secure-tile cycle (enemies=${startState.combat.enemyCount})`);
    Logger.log("LOOP", "Secure-tile cycle started", { enemyCount: startState.combat.enemyCount });
    // AI CHANGED: Ensure popup is closed before combat/find actions so attack control is not obscured.
    closeHexPopupIfOpen();

    // AI CHANGED: Removed strict visibility precheck; attack control can appear only after target selection.

    let current = startState;
    let findAttempts = 0;
    while (current.combat.enemyCount > 0 && findAttempts < Config.combat.maxFindEnemyAttempts) {
      findAttempts += 1;
      // AI CHANGED: Surface find-enemy as live status.
      setBotStatus("finding", `attempt ${findAttempts}/${Config.combat.maxFindEnemyAttempts} (enemies=${current.combat.enemyCount})`);
      Logger.log("LOOP", "Find-enemy attempt", { attempt: findAttempts, enemyCount: current.combat.enemyCount });

      const findResult = await clickFindEnemyVerified();
      if (!findResult.ok) {
        Logger.warn("LOOP", "Find-enemy verification failed", findResult);
        current = readBasicState();
        continue;
      }

      // AI CHANGED: Do not hard-require target HP acquisition; enemyCount-based combat is more reliable.
      const acquired = await waitForTargetAcquired();
      if (!acquired) {
        Logger.warn("LOOP", "Target HP not detected after find-enemy; proceeding by enemy-count logic");
      }

      // AI CHANGED: Skip attack step when enemy count already reached zero after find flow.
      current = readBasicState();
      if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
        Logger.log("LOOP", "Enemies already cleared after find-enemy, skipping attack step");
        break;
      }

      const maxBursts = Number.isFinite(Config.combat.maxCombatAttackBurstsPerFind)
        ? Config.combat.maxCombatAttackBurstsPerFind
        : 24;
      let attackBursts = 0;
      // AI CHANGED: slice 9+ — "first burst after find" means after each find-enemy (including re-find
      // after a kill), not only attackBursts===1; otherwise multi-mob pulls never ranked-open on mob 2+.
      let allowRankedOpeningHit =
        !!Config.planner.useRankedAttackSkillsInCombat &&
        !Config.planner.useRankedSkillOnlyFirstBurstAfterFind;
      if (
        Config.planner.useRankedAttackSkillsInCombat &&
        Config.planner.useRankedSkillOnlyFirstBurstAfterFind
      ) {
        allowRankedOpeningHit = true;
      }
      while (
        typeof current.combat.enemyCount === "number" &&
        current.combat.enemyCount > 0 &&
        attackBursts < maxBursts
      ) {
        attackBursts += 1;
        plannerMaybeRecordEnemyBeforeAttack();

        const useRankedBurst = !!allowRankedOpeningHit;

        // AI CHANGED: Surface attack as live status (slice 9 — burst index for multi-mob pulls).
        setBotStatus(
          "attacking",
          `engaging target (remaining=${current.combat.enemyCount}, burst=${attackBursts}/${maxBursts}, find=${findAttempts})`
        );
        const beforeAttack = readBasicState();
        const attackProgressed = await attackUntilProgress(beforeAttack, {
          useRankedSkillOpener: useRankedBurst
        });
        if (!attackProgressed) {
          Logger.warn("LOOP", "No attack progress detected in burst", { attackBursts, findAttempts });
          break;
        }

        if (Config.planner.useRankedSkillOnlyFirstBurstAfterFind) {
          allowRankedOpeningHit = false;
        }

        current = readBasicState();
        const countBeforeBurst =
          typeof beforeAttack.combat.enemyCount === "number" ? beforeAttack.combat.enemyCount : null;
        const countAfterBurst =
          typeof current.combat.enemyCount === "number" ? current.combat.enemyCount : null;
        const killedOnThisBurst =
          countBeforeBurst != null &&
          countAfterBurst != null &&
          countAfterBurst < countBeforeBurst;

        Logger.log("LOOP", "Combat state after burst", {
          enemyCount: current.combat.enemyCount,
          targetHp: current.combat.targetHp,
          attackBursts,
          findAttempts,
          killedOnThisBurst
        });

        // AI CHANGED: slice 9 fix — inner bursts skipped find-enemy between kills; next target/red bar often only updates after find, so attackUntilProgress timed out (~attackProgressTimeoutMs) then outer loop spammed find. Re-acquire only when count dropped but pull not clear.
        if (
          killedOnThisBurst &&
          countAfterBurst != null &&
          countAfterBurst > 0 &&
          attackBursts < maxBursts
        ) {
          setBotStatus(
            "finding",
            `re-target after kill (enemies=${countAfterBurst}, burst=${attackBursts}/${maxBursts}, findPass=${findAttempts})`
          );
          Logger.log("LOOP", "Re-find-enemy after kill in multi-mob pull", {
            countBeforeBurst,
            countAfterBurst,
            attackBursts
          });
          const refindOk = await clickFindEnemyVerified();
          if (!refindOk.ok) {
            Logger.warn("LOOP", "Re-find-enemy after burst failed", refindOk);
            break;
          }
          const reAcquired = await waitForTargetAcquired();
          if (!reAcquired) {
            Logger.warn("LOOP", "Target HP not detected after re-find; continuing by enemy-count logic");
          }
          current = readBasicState();
          if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
            Logger.log("LOOP", "Enemies cleared during re-find after kill");
            break;
          }
          if (
            Config.planner.useRankedAttackSkillsInCombat &&
            Config.planner.useRankedSkillOnlyFirstBurstAfterFind
          ) {
            allowRankedOpeningHit = true;
          }
        }
      }
    }

    if (current.combat.enemyCount > 0) {
      Logger.warn("LOOP", "Secure loop stopped with enemies still alive", {
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      });
      return { ok: false, stage: "combat", enemyCount: current.combat.enemyCount, attempts: findAttempts };
    }

    plannerMaybeLogAfterSecureCombat();

    // AI CHANGED: Surface loot as live status (clickLootOrActivateVerified internally handles "no loot" no-op).
    setBotStatus("looting", "collecting loot / activating event");
    const lootResult = await clickLootOrActivateVerified();
    if (!lootResult.ok) {
      Logger.warn("LOOP", "Loot verification failed", lootResult);
      return { ok: false, stage: "loot", result: lootResult };
    }
    if (lootResult.skipped) {
      Logger.log("LOOP", "Secure-tile cycle completed (no loot on tile)");
      return { ok: true, stage: "done_no_loot", loot: lootResult };
    }

    Logger.log("LOOP", "Secure-tile cycle completed");
    return { ok: true, stage: "done" };
  }

  // AI CHANGED: Map prep only before each combat cycle; ring scan lives in exploreByScan/scanNeighborRing, not here.
  async function prepMapForCombatCycle() {
    const mapResult = await ensureMapOpen();
    if (!mapResult.ok) {
      Logger.warn("MAP", "Prep for combat cycle failed: map not available", mapResult);
      return { ok: false, stage: "map_open", map: mapResult };
    }
    Logger.log("MAP", "Map ready for combat cycle", mapResult);
    return { ok: true, stage: "map_ready", map: mapResult };
  }

  // AI CHANGED: Kept name for Tampermonkey/GUI compatibility; forwards to prepMapForCombatCycle (no scan placeholder).
  async function prepareAndScanOnce() {
    return prepMapForCombatCycle();
  }

  // AI CHANGED: Updated cycle runner to map-prep then secure+loot (tactical scan only in exploreByScan).
  async function runPreparedSecureCycle() {
    const prepMap = await prepMapForCombatCycle();
    if (!prepMap.ok) {
      return { ok: false, stage: prepMap.stage, prep: prepMap };
    }

    const secureResult = await secureTileAndLootOnce();
    return {
      ok: !!secureResult.ok,
      stage: secureResult.stage,
      prep: prepMap,
      secure: secureResult
    };
  }

  // AI CHANGED: Added status API for external visibility into auto-farm loop health.
  function getAutoFarmStatus() {
    const status = Runtime.autoFarm;
    return {
      running: status.running,
      stopRequested: status.stopRequested,
      cyclesCompleted: status.cyclesCompleted,
      consecutiveFailures: status.consecutiveFailures,
      lastResult: status.lastResult,
      startedAt: status.startedAt
    };
  }

  // AI CHANGED: Added stop API to gracefully halt loop after current cycle.
  function stopAutoFarmLoop() {
    if (!Runtime.autoFarm.running) {
      Logger.log("AUTO", "Auto-farm loop already stopped");
      return { ok: true, running: false, message: "already_stopped" };
    }
    Runtime.autoFarm.stopRequested = true;
    Logger.log("AUTO", "Stop requested for auto-farm loop");
    return { ok: true, running: true, message: "stop_requested" };
  }

  // AI CHANGED: Added controlled repeat runner with auto-stop on repeated failures.
  async function startAutoFarmLoop() {
    if (Runtime.autoFarm.running) {
      Logger.warn("AUTO", "Auto-farm loop already running");
      return { ok: false, reason: "already_running", status: getAutoFarmStatus() };
    }

    Runtime.autoFarm.running = true;
    Runtime.autoFarm.stopRequested = false;
    Runtime.autoFarm.cyclesCompleted = 0;
    Runtime.autoFarm.consecutiveFailures = 0;
    Runtime.autoFarm.lastResult = null;
    Runtime.autoFarm.startedAt = Date.now();

    // AI CHANGED: Surface loop start as live status.
    setBotStatus("starting", `auto-farm loop (delay=${Config.farmLoop.cycleDelayMs}ms)`);
    Logger.log("AUTO", "Auto-farm loop started", {
      cycleDelayMs: Config.farmLoop.cycleDelayMs,
      maxConsecutiveFailures: Config.farmLoop.maxConsecutiveFailures
    });

    while (Runtime.autoFarm.running && !Runtime.autoFarm.stopRequested) {
      // AI CHANGED: Surface waiting-for-settle as live status.
      setBotStatus("waiting", "movement settle gate");
      // AI CHANGED: Block new cycle start until movement bar clears to avoid scan-vs-move overlap.
      await waitUntilNotMoving("auto-loop");
      const cycleResult = await runPreparedSecureCycle();
      Runtime.autoFarm.lastResult = cycleResult;
      Runtime.autoFarm.cyclesCompleted += 1;

      if (cycleResult && cycleResult.ok) {
        Runtime.autoFarm.consecutiveFailures = 0;
        Logger.log("AUTO", "Cycle completed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else {
        Runtime.autoFarm.consecutiveFailures += 1;
        Logger.warn("AUTO", "Cycle failed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
          stage: cycleResult ? cycleResult.stage : "unknown"
        });
      }

      if (Runtime.autoFarm.consecutiveFailures >= Config.farmLoop.maxConsecutiveFailures) {
        Logger.warn("AUTO", "Auto-farm loop stopped after repeated failures", {
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures
        });
        // AI CHANGED: Surface halt-on-failures as live status.
        setBotStatus("halted", `${Runtime.autoFarm.consecutiveFailures} consecutive failures`);
        Runtime.autoFarm.stopRequested = true;
        break;
      }

      if (!Runtime.autoFarm.stopRequested) {
        // AI CHANGED: Back off when we're idling on empty tiles to avoid spammy repeated actions.
        const nowState = readBasicState();
        const shouldIdleBackoff =
          cycleResult &&
          cycleResult.ok &&
          cycleResult.stage === "done_no_loot" &&
          typeof nowState.combat.enemyCount === "number" &&
          nowState.combat.enemyCount === 0;
        if (shouldIdleBackoff) {
          // AI CHANGED: Prefer scan-driven movement while idling on empty tile.
          let moveResult = await exploreByScan();
          if (!moveResult.ok) {
            // AI CHANGED: Keep legacy fallback so loop remains resilient if scan path fails.
            moveResult = await exploreIfIdle();
          }
          if (moveResult.ok) {
            Logger.log("AUTO", "Idle exploration movement completed", moveResult);
            await sleep(Config.farmLoop.cycleDelayMs);
            continue;
          }
          // AI CHANGED: Surface idle-backoff as live status.
          setBotStatus("idle", `no walkable neighbor (${moveResult.reason}); backing off`);
          Logger.log("AUTO", "Idle backoff delay applied", {
            delayMs: Config.farmLoop.idleNoEnemyDelayMs,
            reason: moveResult.reason
          });
          await sleep(Config.farmLoop.idleNoEnemyDelayMs);
          continue;
        }
        await sleep(Config.farmLoop.cycleDelayMs);
      }
    }

    Runtime.autoFarm.running = false;
    // AI CHANGED: Only set "stopped" if we weren't already halted by failures.
    if (Runtime.status.phase !== "halted") {
      setBotStatus("stopped", `${Runtime.autoFarm.cyclesCompleted} cycles completed`);
    }
    const finalStatus = getAutoFarmStatus();
    Logger.log("AUTO", "Auto-farm loop exited", finalStatus);
    return { ok: true, status: finalStatus };
  }
