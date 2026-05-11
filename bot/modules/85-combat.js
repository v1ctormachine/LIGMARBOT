  // AI CHANGED: Ranked opener runtime telemetry — keep lightweight counters + recent ring buffer for soak diagnostics.
  function plannerRecordOpenerRuntimeEvent(kind, detail) {
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    if (!pr || !pr.openerRuntime) {
      return;
    }
    const rt = pr.openerRuntime;
    if (!rt.events || typeof rt.events !== "object") {
      rt.events = {};
    }
    rt.events[kind] = (rt.events[kind] || 0) + 1;
    rt.lastEvent = kind;
    rt.lastAt = Date.now();
    if (!Array.isArray(rt.recent)) {
      rt.recent = [];
    }
    rt.recent.push({
      at: rt.lastAt,
      event: kind,
      detail: detail || null
    });
    const keep = 30;
    if (rt.recent.length > keep) {
      rt.recent.splice(0, rt.recent.length - keep);
    }
  }

  // AI CHANGED: Phase C4 slice 8 — first swing: ranked attack skill (if enabled + pick), else basic attack.
  // AI CHANGED: slice 9 — optional opts.useRankedSkillOpener === false forces basic-only (follow-up bursts).
  // AI CHANGED: slice 22 — combat opener is tap-only (clickActionBarSlot); no synthetic bar hold — game uses tap for skills including charge start.
  // AI CHANGED: slice 15 — excludeSlots skips bar indices already used this burst (alternate ranked openers).
  async function clickPlannerOpeningAttack(opts, excludeSlots) {
    const useSkill =
      Config.planner.useRankedAttackSkillsInCombat &&
      (!opts || opts.useRankedSkillOpener !== false);
    if (useSkill) {
      const opening = plannerPickSkillOpeningPick({ excludeSlots: excludeSlots || [] });
      if (opening != null) {
        const ok = clickActionBarSlot(opening.slot); // AI CHANGED: slice 22 — always normal bar click
        if (ok) {
          plannerRecordOpenerRuntimeEvent("ranked_pick", { slot: opening.slot, excluded: (excludeSlots || []).slice(0, 8) });
          Logger.log("PLANNER", "Opening attack used ranked skill slot", { slot: opening.slot });
          return { ok: true, skillSlot: opening.slot };
        }
        plannerRecordOpenerRuntimeEvent("ranked_click_failed", { slot: opening.slot });
        Logger.warn("PLANNER", "Ranked skill slot click failed; falling back to basic attack", { slot: opening.slot });
      } else {
        plannerRecordOpenerRuntimeEvent("ranked_pick_none", {
          reason: Runtime.planner && Runtime.planner.lastOpeningPickReason ? Runtime.planner.lastOpeningPickReason : null
        });
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
    const fullTimeoutMs = Number.isFinite(Config.combat.attackProgressTimeoutMs)
      ? Config.combat.attackProgressTimeoutMs
      : 4500;
    const firstRankedTimeoutRaw = Config.combat.rankedOpenerFirstProgressTimeoutMs;
    const firstRankedTimeoutMs =
      Number.isFinite(firstRankedTimeoutRaw) && firstRankedTimeoutRaw > 0
        ? firstRankedTimeoutRaw
        : fullTimeoutMs;
    const pollMs = Number.isFinite(Config.combat.attackProgressPollMs)
      ? Config.combat.attackProgressPollMs
      : 140;

    const open = await clickPlannerOpeningAttack(opts, []);
    if (!open.ok) {
      Logger.warn("LOOP", "Attack loop aborted: no attack click succeeded");
      return false;
    }

    // AI CHANGED: slice 23 — let the client apply tap-cast before we poll target HP / enemy count.
    const settleRanked = Number.isFinite(Config.combat.postRankedSkillClickSettleMs)
      ? Config.combat.postRankedSkillClickSettleMs
      : 0;
    if (open.skillSlot != null && settleRanked > 0) {
      await sleep(settleRanked);
    }

    // AI CHANGED: slice 25 — optional grace so slow-starting charge skills register before HP polling.
    const chargeGraceRaw = Config.combat.rankedOpenerChargeGraceMs;
    const chargeGraceMs =
      open.skillSlot != null && Number.isFinite(chargeGraceRaw) && chargeGraceRaw > 0 ? chargeGraceRaw : 0;
    if (chargeGraceMs > 0) {
      await sleep(chargeGraceMs);
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after charge grace; skipping follow-up");
      return false;
    }

    const firstWaitTimeoutMs =
      open.skillSlot != null ? firstRankedTimeoutMs : fullTimeoutMs; // AI CHANGED: slice 23 — fast fallback when first ranked pick does nothing observable
    if (open.skillSlot != null && firstWaitTimeoutMs < fullTimeoutMs) {
      Logger.log("LOOP", "attack progress wait (first ranked opener)", {
        timeoutMs: firstWaitTimeoutMs,
        fullTimeoutMs: fullTimeoutMs,
        slot: open.skillSlot
      });
    }

    const earlyCancelRaw = Config.combat.rankedOpenerEarlyCancelIfHintAfterMs;
    const earlyCancelMs =
      open.skillSlot != null &&
      Number.isFinite(earlyCancelRaw) &&
      earlyCancelRaw > 0 &&
      earlyCancelRaw < firstWaitTimeoutMs
        ? earlyCancelRaw
        : 0;

    let chargeCancelAttempted = false;
    let progressed = false;

    if (earlyCancelMs > 0) {
      progressed = await waitForCondition(
        "attack progress (early window)",
        hasCombatProgressSince(beforeState),
        { timeoutMs: earlyCancelMs, pollMs: pollMs }
      );
      if (progressed) {
        if (open.skillSlot != null) {
          plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "early_or_late_wait" });
        }
        return true;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after early opener wait");
        return false;
      }
      if (
        Config.combat.rankedOpenerClickCancelUiIfChargeStuck !== false &&
        isChargingSkillCancelHintVisible()
      ) {
        Logger.log("LOOP", "ranked opener early charge cancel (hint after partial wait)", {
          earlyCancelMs: earlyCancelMs,
          slot: open.skillSlot
        });
        clickChargingSkillCancelUi();
        chargeCancelAttempted = true;
        if (settleRanked > 0) {
          await sleep(settleRanked);
        }
        if (Runtime.autoFarm.stopRequested) {
          return false;
        }
        progressed = await waitForCondition(
          "attack progress after early charge cancel",
          hasCombatProgressSince(beforeState),
          { timeoutMs: fullTimeoutMs, pollMs: pollMs }
        );
        if (progressed) {
          plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "after_early_cancel" });
          return true;
        }
      } else {
        progressed = await waitForCondition(
          "attack progress (late window)",
          hasCombatProgressSince(beforeState),
          { timeoutMs: firstWaitTimeoutMs - earlyCancelMs, pollMs: pollMs }
        );
        if (progressed) {
          if (open.skillSlot != null) {
            plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "late_window" });
          }
          return true;
        }
      }
    } else {
      progressed = await waitForCondition(
        "attack progress",
        hasCombatProgressSince(beforeState),
        { timeoutMs: firstWaitTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        if (open.skillSlot != null) {
          plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "first_wait" });
        }
        return true;
      }
    }

    // AI CHANGED: slice 21b — stop-aborted wait must not fall through to more clicks (alternate opener / basic).
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after opener wait; skipping follow-up attacks");
      return false;
    }

    // AI CHANGED: slice 24b — charge skill stuck: first wait saw no HP/count (CD not running until cancel or full shot). Tap cancel UI only when needed, not a second bar click.
    if (
      !chargeCancelAttempted &&
      open.skillSlot != null &&
      Config.combat.rankedOpenerClickCancelUiIfChargeStuck !== false &&
      isChargingSkillCancelHintVisible()
    ) {
      Logger.log("LOOP", "Charge cancel hint visible after opener wait; map-gap / cancel UI (not bar slot)", {
        slot: open.skillSlot
      });
      clickChargingSkillCancelUi();
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      if (Runtime.autoFarm.stopRequested) {
        return false;
      }
      progressed = await waitForCondition(
        "attack progress after charge cancel ui",
        hasCombatProgressSince(beforeState),
        { timeoutMs: fullTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "after_charge_cancel" });
        return true;
      }
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after charge-cancel wait");
      return false;
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
      plannerRecordOpenerRuntimeEvent("ranked_alt_pick", { slot: open2.skillSlot, attempt: alt + 1 });
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      progressed = await waitForCondition(
        "attack progress",
        hasCombatProgressSince(beforeState),
        { timeoutMs: fullTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open2.skillSlot, stage: "alternate_wait" });
        return true;
      }
      // AI CHANGED: slice 21b — same as primary opener: do not chain more attacks after Stop.
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after alternate opener wait");
        return false;
      }
      triedSlots.push(open2.skillSlot);
    }

    if (triedSlots.length > 0) {
      plannerRecordOpenerRuntimeEvent("basic_fallback_after_ranked", { triedSlots: triedSlots.slice(0, 8) });
      Logger.warn("PLANNER", "Ranked opener(s) had no verified progress; trying basic attack", {
        triedSlots: triedSlots
      });
      const baselineAfterSkill = readBasicState();
      if (!clickBasicAttack()) {
        Logger.warn("LOOP", "Basic attack click failed after skill opener");
        return false;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested before basic-attack wait");
        return false;
      }
      progressed = await waitForCondition(
        "attack progress",
        hasCombatProgressSince(baselineAfterSkill),
        { timeoutMs: fullTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        return true;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after basic-attack wait");
        return false;
      }
    }

    Logger.warn("LOOP", "No attack progress detected (enemy count + target HP unchanged for baseline)");
    if (triedSlots.length > 0 || open.skillSlot != null) {
      plannerRecordOpenerRuntimeEvent("ranked_no_progress", {
        initialSlot: open.skillSlot,
        triedSlots: triedSlots.slice(0, 8)
      });
    }
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

  // AI CHANGED: Step 4 — effective ranked bursts per find cycle with legacy fallback.
  function getRankedBurstsPerFindEffective() {
    if (!Config.planner.useRankedAttackSkillsInCombat) {
      return 0;
    }
    if (Number.isFinite(Config.planner.rankedBurstsPerFind) && Config.planner.rankedBurstsPerFind >= 0) {
      return Math.floor(Config.planner.rankedBurstsPerFind);
    }
    return Config.planner.useRankedSkillOnlyFirstBurstAfterFind ? 1 : Number.MAX_SAFE_INTEGER;
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
    // AI CHANGED: slice 21 — death / disconnect often reset in-game zoom without reloading the page.
    resetZoomAssumptionIfSessionRisk(startState.session);
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
      // AI CHANGED: slice 21b — do not burn find-enemy attempts or send clicks after user Stop.
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "Secure-tile cycle aborted before find-enemy (stop requested)", {
          attemptsSoFar: findAttempts,
          enemyCount: current.combat.enemyCount
        });
        return {
          ok: false,
          stage: "combat",
          reason: "stop_requested",
          enemyCount: current.combat.enemyCount,
          attempts: findAttempts
        };
      }
      findAttempts += 1;
      // AI CHANGED: Surface find-enemy as live status.
      setBotStatus("finding", `attempt ${findAttempts}/${Config.combat.maxFindEnemyAttempts} (enemies=${current.combat.enemyCount})`);
      Logger.log("LOOP", "Find-enemy attempt", { attempt: findAttempts, enemyCount: current.combat.enemyCount });

      const findResult = await clickFindEnemyVerified();
      if (!findResult.ok) {
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("LOOP", "Secure-tile cycle aborted after find-enemy wait (stop requested)", {
            attempt: findAttempts,
            enemyCount: current.combat.enemyCount
          });
          return {
            ok: false,
            stage: "combat",
            reason: "stop_requested",
            enemyCount: current.combat.enemyCount,
            attempts: findAttempts
          };
        }
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
      // AI CHANGED: Step 4 — allow configurable number of ranked bursts per find cycle.
      let rankedBurstsLeft = getRankedBurstsPerFindEffective();
      while (
        typeof current.combat.enemyCount === "number" &&
        current.combat.enemyCount > 0 &&
        attackBursts < maxBursts
      ) {
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("LOOP", "Secure-tile combat bursts aborted (stop requested)", {
            attackBursts: attackBursts,
            findAttempts: findAttempts
          });
          return {
            ok: false,
            stage: "combat",
            reason: "stop_requested",
            enemyCount: current.combat.enemyCount,
            attempts: findAttempts
          };
        }
        attackBursts += 1;
        plannerMaybeRecordEnemyBeforeAttack();

        const useRankedBurst = rankedBurstsLeft > 0;

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
          if (Runtime.autoFarm.stopRequested) {
            Logger.log("LOOP", "Secure-tile cycle aborted after attack burst (stop requested)", {
              attackBursts: attackBursts,
              findAttempts: findAttempts
            });
            return {
              ok: false,
              stage: "combat",
              reason: "stop_requested",
              enemyCount: current.combat.enemyCount,
              attempts: findAttempts
            };
          }
          Logger.warn("LOOP", "No attack progress detected in burst", { attackBursts, findAttempts });
          break;
        }

        if (useRankedBurst && rankedBurstsLeft > 0) {
          rankedBurstsLeft -= 1;
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
          if (Runtime.autoFarm.stopRequested) {
            Logger.log("LOOP", "Secure-tile cycle aborted before re-find (stop requested)", {
              attackBursts: attackBursts,
              findAttempts: findAttempts
            });
            return {
              ok: false,
              stage: "combat",
              reason: "stop_requested",
              enemyCount: current.combat.enemyCount,
              attempts: findAttempts
            };
          }
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
            if (Runtime.autoFarm.stopRequested) {
              Logger.log("LOOP", "Secure-tile cycle aborted after re-find wait (stop requested)", {
                attackBursts: attackBursts,
                findAttempts: findAttempts
              });
              return {
                ok: false,
                stage: "combat",
                reason: "stop_requested",
                enemyCount: current.combat.enemyCount,
                attempts: findAttempts
              };
            }
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
          rankedBurstsLeft = getRankedBurstsPerFindEffective();
        }
      }
    }

    if (Runtime.autoFarm.stopRequested && typeof current.combat.enemyCount === "number" && current.combat.enemyCount > 0) {
      Logger.log("LOOP", "Secure-tile cycle ended with enemies present (stop requested)", {
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      });
      return {
        ok: false,
        stage: "combat",
        reason: "stop_requested",
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      };
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
      reason: secureResult.reason,
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
      startedAt: status.startedAt,
      reliability: status.reliability || null,
      lastSessionSummary: status.lastSessionSummary || null
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
    Runtime.autoFarm.reliability.noProgressStreak = 0;
    let exitReason = "unknown";

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
      // AI CHANGED: slice 21 — fresh session flags each cycle so zoom flag tracks UI, not stale assumptions.
      resetZoomAssumptionIfSessionRisk(readBasicState().session);
      const cycleResult = await runPreparedSecureCycle();
      Runtime.autoFarm.lastResult = cycleResult;
      Runtime.autoFarm.cyclesCompleted += 1;

      if (cycleResult && cycleResult.ok) {
        Runtime.autoFarm.consecutiveFailures = 0;
        Runtime.autoFarm.reliability.noProgressStreak = 0;
        Logger.log("AUTO", "Cycle completed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else if (cycleResult && cycleResult.reason === "stop_requested") {
        Logger.log("AUTO", "Cycle aborted by user stop (not counted as failure)", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else {
        Runtime.autoFarm.consecutiveFailures += 1;
        const isNoProgressCombat =
          cycleResult &&
          cycleResult.stage === "combat" &&
          !cycleResult.reason &&
          typeof cycleResult.secure === "object" &&
          cycleResult.secure &&
          cycleResult.secure.ok === false;
        if (isNoProgressCombat) {
          Runtime.autoFarm.reliability.noProgressStreak += 1;
          Runtime.autoFarm.reliability.totalNoProgressFailures += 1;
          Runtime.autoFarm.reliability.lastNoProgressAt = Date.now();
        } else {
          Runtime.autoFarm.reliability.noProgressStreak = 0;
        }
        Logger.warn("AUTO", "Cycle failed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
          stage: cycleResult ? cycleResult.stage : "unknown"
        });
        const cooldownThreshold = Number.isFinite(Config.farmLoop.noProgressCooldownThreshold)
          ? Config.farmLoop.noProgressCooldownThreshold
          : 2;
        const cooldownMs = Number.isFinite(Config.farmLoop.noProgressCooldownMs)
          ? Config.farmLoop.noProgressCooldownMs
          : 5000;
        if (
          Runtime.autoFarm.reliability.noProgressStreak >= cooldownThreshold &&
          cooldownMs > 0 &&
          !Runtime.autoFarm.stopRequested
        ) {
          Runtime.autoFarm.reliability.lastCooldownAt = Date.now();
          setBotStatus("waiting", `reliability cooldown ${cooldownMs}ms (no-progress streak=${Runtime.autoFarm.reliability.noProgressStreak})`);
          Logger.warn("AUTO", "Applying reliability cooldown after repeated no-progress failures", {
            noProgressStreak: Runtime.autoFarm.reliability.noProgressStreak,
            cooldownMs: cooldownMs
          });
          await sleep(cooldownMs, { bypassStop: true });
          Runtime.autoFarm.reliability.noProgressStreak = 0;
        }
      }

      if (Runtime.autoFarm.consecutiveFailures >= Config.farmLoop.maxConsecutiveFailures) {
        Logger.warn("AUTO", "Auto-farm loop stopped after repeated failures", {
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures
        });
        // AI CHANGED: Surface halt-on-failures as live status.
        setBotStatus("halted", `${Runtime.autoFarm.consecutiveFailures} consecutive failures`);
        Runtime.autoFarm.stopRequested = true;
        exitReason = "failure_cap";
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
    if (exitReason === "unknown") {
      if (Runtime.autoFarm.lastResult && Runtime.autoFarm.lastResult.reason === "stop_requested") {
        exitReason = "user_stop";
      } else if (Runtime.autoFarm.stopRequested) {
        exitReason = "stop_requested";
      } else {
        exitReason = "loop_completed";
      }
    }
    const endedAt = Date.now();
    const startedAt = Number.isFinite(Runtime.autoFarm.startedAt) ? Runtime.autoFarm.startedAt : endedAt;
    Runtime.autoFarm.lastSessionSummary = {
      startedAt: startedAt,
      endedAt: endedAt,
      onDurationMs: Math.max(0, endedAt - startedAt),
      cyclesCompleted: Runtime.autoFarm.cyclesCompleted,
      consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
      reliability: Object.assign({}, Runtime.autoFarm.reliability || {}),
      exitReason: exitReason,
      lastStage: Runtime.autoFarm.lastResult ? Runtime.autoFarm.lastResult.stage || null : null
    };
    // AI CHANGED: consume stop flag when loop ends — if it stays true, waitForCondition (hero stats, verifies) aborts on first tick and leaves profile on wrong tab after TEST.
    Runtime.autoFarm.stopRequested = false;
    // AI CHANGED: Only set "stopped" if we weren't already halted by failures.
    if (Runtime.status.phase !== "halted") {
      setBotStatus("stopped", `${Runtime.autoFarm.cyclesCompleted} cycles completed`);
    }
    const finalStatus = getAutoFarmStatus();
    Logger.log("AUTO", "Auto-farm loop exited", finalStatus);
    return { ok: true, status: finalStatus };
  }
