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

  // AI CHANGED: Potion sustain now keeps state for active HoTs, shared cooldown, recent HP-loss trend, and the last protected mana requirement.
  function getCombatSustainRuntime() {
    if (!Runtime.autoFarm.combatSustain || typeof Runtime.autoFarm.combatSustain !== "object") {
      Runtime.autoFarm.combatSustain = {};
    }
    const sustain = Runtime.autoFarm.combatSustain;
    if (!Number.isFinite(sustain.hpPotionUses)) {
      sustain.hpPotionUses = 0;
    }
    if (!Number.isFinite(sustain.mpPotionUses)) {
      sustain.mpPotionUses = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionAt")) {
      sustain.lastPotionAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionResource")) {
      sustain.lastPotionResource = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionReason")) {
      sustain.lastPotionReason = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "potionCooldownUntil")) {
      sustain.potionCooldownUntil = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "activeHpPotion")) {
      sustain.activeHpPotion = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "activeMpPotion")) {
      sustain.activeMpPotion = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastHpSampleAt")) {
      sustain.lastHpSampleAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastHpSampleCur")) {
      sustain.lastHpSampleCur = null;
    }
    if (!Number.isFinite(sustain.recentHpLossPerSec)) {
      sustain.recentHpLossPerSec = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPreferredManaNeed")) {
      sustain.lastPreferredManaNeed = null;
    }
    return sustain;
  }

  function getCombatPotionEffectSpec(record, resource) {
    if (!record || !Array.isArray(record.effects)) {
      return null;
    }
    let best = null;
    for (let i = 0; i < record.effects.length; i += 1) {
      const effect = record.effects[i];
      if (!effect || effect.type !== "heal" || effect.resource !== resource || !Number.isFinite(effect.value) || effect.value <= 0) {
        continue;
      }
      const fallbackDuration =
        resource === "hp" && Number.isFinite(Config.combat && Config.combat.combatPotionHotDefaultDurationSec)
          ? Math.max(0, Config.combat.combatPotionHotDefaultDurationSec)
          : 0;
      const durationSec =
        Number.isFinite(effect.durationSec) && effect.durationSec > 0
          ? effect.durationSec
          : fallbackDuration;
      const totalValue = effect.value;
      const spec = {
        resource: resource,
        totalValue: +totalValue.toFixed(2),
        durationSec: Number.isFinite(durationSec) ? +durationSec.toFixed(3) : 0,
        perSec: durationSec > 0 ? +(totalValue / durationSec).toFixed(3) : +totalValue.toFixed(3),
        hot: durationSec > 0
      };
      if (!best || spec.totalValue > best.totalValue) {
        best = spec;
      }
    }
    return best;
  }

  function listCombatPotionCandidates(resource, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const readyOnly = opts.readyOnly !== false;
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const rows = [];
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "potion" || row.resource !== resource) {
        continue;
      }
      const slotIdx = typeof row.slot === "number" ? row.slot : i;
      const spec = getCombatPotionEffectSpec(row, resource);
      if (!spec) {
        continue;
      }
      if (row.counter && Number.isFinite(row.counter.value) && row.counter.value <= 0) {
        continue;
      }
      if (readyOnly && typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(slotIdx)) {
        continue;
      }
      rows.push({
        slot: slotIdx,
        record: row,
        spec: spec
      });
    }
    rows.sort(function (a, b) {
      if (a.spec.totalValue !== b.spec.totalValue) {
        return a.spec.totalValue - b.spec.totalValue;
      }
      return a.slot - b.slot;
    });
    return rows;
  }

  function chooseCombatPotionCandidate(resource, needAmount, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const rows = listCombatPotionCandidates(resource, { readyOnly: true });
    if (rows.length === 0) {
      return null;
    }
    if (opts.preferLargest) {
      return rows[rows.length - 1];
    }
    const need = Number.isFinite(needAmount) ? Math.max(0, needAmount) : 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].spec.totalValue >= need) {
        return rows[i];
      }
    }
    return rows[rows.length - 1];
  }

  function getCombatActivePotionRemaining(activePotion, nowMs) {
    if (
      !activePotion ||
      !Number.isFinite(activePotion.endsAt) ||
      !Number.isFinite(activePotion.durationSec) ||
      !Number.isFinite(activePotion.totalValue)
    ) {
      return 0;
    }
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (now >= activePotion.endsAt || activePotion.durationSec <= 0 || activePotion.totalValue <= 0) {
      return 0;
    }
    const totalMs = activePotion.durationSec * 1000;
    if (!(totalMs > 0)) {
      return 0;
    }
    const remainFrac = Math.max(0, Math.min(1, (activePotion.endsAt - now) / totalMs));
    return +(activePotion.totalValue * remainFrac).toFixed(2);
  }

  function updateCombatSustainObservations(liveState) {
    const sustain = getCombatSustainRuntime();
    const now = liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now();
    if (sustain.activeHpPotion && Number.isFinite(sustain.activeHpPotion.endsAt) && now >= sustain.activeHpPotion.endsAt) {
      sustain.activeHpPotion = null;
    }
    if (sustain.activeMpPotion && Number.isFinite(sustain.activeMpPotion.endsAt) && now >= sustain.activeMpPotion.endsAt) {
      sustain.activeMpPotion = null;
    }
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    if (Number.isFinite(hpCur)) {
      if (Number.isFinite(sustain.lastHpSampleCur) && Number.isFinite(sustain.lastHpSampleAt)) {
        const dtSec = Math.max(0, (now - sustain.lastHpSampleAt) / 1000);
        if (dtSec >= 0.1) {
          const delta = hpCur - sustain.lastHpSampleCur;
          const instantLossPerSec = delta < 0 ? (-delta / dtSec) : 0;
          if (instantLossPerSec > 0) {
            sustain.recentHpLossPerSec = +(
              (sustain.recentHpLossPerSec * 0.65) +
              (instantLossPerSec * 0.35)
            ).toFixed(3);
          } else {
            sustain.recentHpLossPerSec = +(sustain.recentHpLossPerSec * 0.82).toFixed(3);
          }
        }
      }
      sustain.lastHpSampleCur = hpCur;
      sustain.lastHpSampleAt = now;
    }
    return sustain;
  }

  function buildCombatActivePotionState(resource, potion, usedAt) {
    if (!potion || !potion.spec || !Number.isFinite(usedAt)) {
      return null;
    }
    if (!(Number.isFinite(potion.spec.durationSec) && potion.spec.durationSec > 0)) {
      return null;
    }
    return {
      resource: resource,
      slot: potion.slot,
      name: potion.record && potion.record.name ? potion.record.name : "",
      totalValue: potion.spec.totalValue,
      durationSec: potion.spec.durationSec,
      perSec: potion.spec.perSec,
      startedAt: usedAt,
      endsAt: usedAt + Math.round(potion.spec.durationSec * 1000)
    };
  }

  function rememberCombatPotionUse(resource, potion, reason, usedAt) {
    const sustain = getCombatSustainRuntime();
    const when = Number.isFinite(usedAt) ? usedAt : Date.now();
    sustain.lastPotionAt = when;
    sustain.lastPotionResource = resource;
    sustain.lastPotionReason = reason || null;
    if (resource === "hp") {
      sustain.hpPotionUses += 1;
      sustain.activeHpPotion = buildCombatActivePotionState("hp", potion, when);
    } else if (resource === "mp") {
      sustain.mpPotionUses += 1;
      sustain.activeMpPotion = buildCombatActivePotionState("mp", potion, when);
    }
    if (Config.combat && Config.combat.combatPotionSharedCooldown !== false) {
      const cooldownMs =
        Number.isFinite(Config.combat.combatPotionCooldownMs) && Config.combat.combatPotionCooldownMs > 0
          ? Math.round(Config.combat.combatPotionCooldownMs)
          : 15000;
      sustain.potionCooldownUntil = when + cooldownMs;
    }
  }

  function getCombatMinimumAttackManaNeed() {
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let best = null;
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy) {
        continue;
      }
      if (typeof plannerSkillHasDirectDamageForOpener === "function" && !plannerSkillHasDirectDamageForOpener(row)) {
        continue;
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      if (!(manaCost > 0)) {
        continue;
      }
      if (best === null || manaCost < best) {
        best = manaCost;
      }
    }
    return best;
  }

  function getCombatMaximumAttackManaNeed() {
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let best = null;
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy) {
        continue;
      }
      if (typeof plannerSkillHasDirectDamageForOpener === "function" && !plannerSkillHasDirectDamageForOpener(row)) {
        continue;
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      if (!(manaCost > 0)) {
        continue;
      }
      if (best === null || manaCost > best) {
        best = manaCost;
      }
    }
    return best;
  }

  function computeCombatPreferredManaNeed(liveState) {
    if (!(Config.planner && Config.planner.useRankedAttackSkillsInCombat)) {
      return null;
    }
    if (typeof previewOpenerHorizonSim !== "function") {
      return null;
    }
    const preview = previewOpenerHorizonSim({});
    const rows = preview && Array.isArray(preview.candidates) ? preview.candidates.slice() : [];
    if (rows.length === 0) {
      return null;
    }
    rows.sort(function (a, b) {
      const aPass = a && a.passesThreshold ? 1 : 0;
      const bPass = b && b.passesThreshold ? 1 : 0;
      if (bPass !== aPass) {
        return bPass - aPass;
      }
      const aDmg = a && Number.isFinite(a.horizonDamage) ? a.horizonDamage : -Infinity;
      const bDmg = b && Number.isFinite(b.horizonDamage) ? b.horizonDamage : -Infinity;
      return bDmg - aDmg;
    });
    const picked = rows[0];
    if (!picked || !Number.isFinite(picked.slot)) {
      return null;
    }
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const row = slots.find(function (slotRec) {
      return slotRec && typeof slotRec.slot === "number" && slotRec.slot === picked.slot;
    }) || null;
    if (!row) {
      return null;
    }
    const reserve = Number.isFinite(Config.planner && Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
    return {
      slot: picked.slot,
      name: row.name || picked.name || "",
      manaCost: manaCost,
      manaNeed: manaCost + reserve,
      horizonDamage: Number.isFinite(picked.horizonDamage) ? picked.horizonDamage : null,
      passesThreshold: !!picked.passesThreshold
    };
  }

  // AI CHANGED: HP potion policy uses parsed total heal + HoT duration + recent incoming damage so the bot keeps HP high without blind percentage-only spam.
  function evaluateCombatHpPotionNeed(liveState) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { needed: false, emergency: false, hpPct: null, reason: "combat_potions_off" };
    }
    const sustain = getCombatSustainRuntime();
    const knownPotions = listCombatPotionCandidates("hp", { readyOnly: false });
    const bestKnown = knownPotions.length > 0 ? knownPotions[knownPotions.length - 1] : null;
    if (!bestKnown) {
      return { needed: false, emergency: false, hpPct: null, reason: "no_hp_potion_on_bar" };
    }
    const now = liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now();
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    const hpMax =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.max)
        ? liveState.player.hp.max
        : null;
    const hpPct =
      Number.isFinite(hpCur) && Number.isFinite(hpMax) && hpMax > 0
        ? hpCur / hpMax
        : null;
    if (!Number.isFinite(hpPct) || !Number.isFinite(hpCur) || !Number.isFinite(hpMax)) {
      return { needed: false, emergency: false, hpPct: null, reason: "hp_unread" };
    }
    const missingHp = Math.max(0, hpMax - hpCur);
    const emergencyPct = Number.isFinite(Config.combat.hpPotionEmergencyBelowPct)
      ? Math.max(0.05, Math.min(1, Config.combat.hpPotionEmergencyBelowPct))
      : 0.35;
    const normalPct = Number.isFinite(Config.combat.hpPotionUseBelowPct)
      ? Math.max(emergencyPct, Math.min(1, Config.combat.hpPotionUseBelowPct))
      : 0.55;
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : 0;
    const forecastWindowSec =
      enemyCount > 0 && Number.isFinite(Config.combat.hpPotionForecastWindowSec)
        ? Math.max(0, Math.min(bestKnown.spec.durationSec, Config.combat.hpPotionForecastWindowSec))
        : 0;
    const projectedIncoming = Math.max(0, sustain.recentHpLossPerSec || 0) * forecastWindowSec;
    const activeRemaining = getCombatActivePotionRemaining(sustain.activeHpPotion, now);
    const efficiencyFrac =
      enemyCount > 0 && Number.isFinite(Config.combat.hpPotionCombatMissingHealFraction)
        ? Math.max(0.1, Math.min(1, Config.combat.hpPotionCombatMissingHealFraction))
        : (
            Number.isFinite(Config.combat.hpPotionSafeMissingHealFraction)
              ? Math.max(0.1, Math.min(1, Config.combat.hpPotionSafeMissingHealFraction))
              : 0.85
          );
    const effectiveMissing = Math.max(0, missingHp + projectedIncoming - activeRemaining);
    const thresholdValue = bestKnown.spec.totalValue * efficiencyFrac;
    const emergency = hpPct <= emergencyPct;
    const needed =
      emergency ||
      (
        activeRemaining <= bestKnown.spec.perSec &&
        (
          effectiveMissing >= thresholdValue ||
          (enemyCount > 0 && hpPct <= normalPct && effectiveMissing >= bestKnown.spec.perSec * 2)
        )
      );
    return {
      needed: needed,
      emergency: emergency,
      hpPct: +hpPct.toFixed(4),
      hpCur: +hpCur.toFixed(2),
      hpMax: +hpMax.toFixed(2),
      missingHp: +missingHp.toFixed(2),
      activeRemaining: +activeRemaining.toFixed(2),
      projectedIncoming: +projectedIncoming.toFixed(2),
      effectiveMissing: +effectiveMissing.toFixed(2),
      thresholdValue: +thresholdValue.toFixed(2),
      potionTotalValue: bestKnown.spec.totalValue,
      potionDurationSec: bestKnown.spec.durationSec,
      potionPerSec: bestKnown.spec.perSec,
      reason: needed ? (emergency ? "emergency_hp_pct" : "parsed_hot_value_window") : "hp_not_missing_enough_yet"
    };
  }

  // AI CHANGED: MP potion policy protects the mana needed for the current best ranked skill instead of a fixed low-mana percentage alone.
  function evaluateCombatMpPotionNeed(liveState) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { needed: false, reason: "combat_potions_off" };
    }
    const sustain = getCombatSustainRuntime();
    const knownPotions = listCombatPotionCandidates("mp", { readyOnly: false });
    const bestKnown = knownPotions.length > 0 ? knownPotions[knownPotions.length - 1] : null;
    if (!bestKnown) {
      sustain.lastPreferredManaNeed = null;
      return { needed: false, reason: "no_mp_potion_on_bar" };
    }
    const mpCur =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.cur)
        ? liveState.player.mp.cur
        : null;
    const mpPct =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.pct)
        ? liveState.player.mp.pct
        : null;
    if (!Number.isFinite(mpCur) || !Number.isFinite(mpPct)) {
      sustain.lastPreferredManaNeed = null;
      return { needed: false, reason: "mp_unread" };
    }
    const reserve = Number.isFinite(Config.planner && Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const maxAttackManaNeed = getCombatMaximumAttackManaNeed();
    const activeRemaining = getCombatActivePotionRemaining(sustain.activeMpPotion, liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now());
    const lowMpPct = Number.isFinite(Config.combat.mpPotionUseBelowPct)
      ? Math.max(0.05, Math.min(1, Config.combat.mpPotionUseBelowPct))
      : 0.22;
    if (Number.isFinite(maxAttackManaNeed) && mpCur >= maxAttackManaNeed + reserve) {
      sustain.lastPreferredManaNeed = {
        reason: "can_cast_any_attack_skill",
        manaNeed: maxAttackManaNeed + reserve
      };
      return {
        needed: false,
        reason: "can_cast_any_attack_skill",
        mpCur: +mpCur.toFixed(2),
        mpPct: +mpPct.toFixed(4),
        activeRemaining: +activeRemaining.toFixed(2)
      };
    }
    const preferred = computeCombatPreferredManaNeed(liveState);
    sustain.lastPreferredManaNeed = preferred;
    if (preferred && Number.isFinite(preferred.manaNeed) && preferred.manaNeed > 0) {
      const shortage = preferred.manaNeed - (mpCur + activeRemaining);
      return {
        needed: shortage > 0,
        reason: shortage > 0 ? "preferred_skill_shortage" : "preferred_skill_mana_available",
        mpCur: +mpCur.toFixed(2),
        mpPct: +mpPct.toFixed(4),
        activeRemaining: +activeRemaining.toFixed(2),
        shortage: +Math.max(0, shortage).toFixed(2),
        preferredSkill: preferred,
        potionTotalValue: bestKnown.spec.totalValue,
        potionDurationSec: bestKnown.spec.durationSec,
        potionPerSec: bestKnown.spec.perSec
      };
    }
    const minAttackManaNeed = getCombatMinimumAttackManaNeed();
    const fallbackNeeded =
      mpPct <= lowMpPct &&
      Number.isFinite(minAttackManaNeed) &&
      mpCur + activeRemaining < minAttackManaNeed + reserve;
    return {
      needed: fallbackNeeded,
      reason: fallbackNeeded ? "fallback_low_mp_pct" : "no_ranked_mana_pressure",
      mpCur: +mpCur.toFixed(2),
      mpPct: +mpPct.toFixed(4),
      activeRemaining: +activeRemaining.toFixed(2),
      minAttackManaNeed: minAttackManaNeed,
      potionTotalValue: bestKnown.spec.totalValue,
      potionDurationSec: bestKnown.spec.durationSec,
      potionPerSec: bestKnown.spec.perSec
    };
  }

  async function tryUseCombatPotion(resource, potion, reason, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const sustain = getCombatSustainRuntime();
    const now = Date.now();
    if (
      Config.combat &&
      Config.combat.combatPotionSharedCooldown !== false &&
      Number.isFinite(sustain.potionCooldownUntil) &&
      now < sustain.potionCooldownUntil
    ) {
      return { ok: false, skipped: true, reason: "shared_potion_cooldown_active", cooldownRemainingMs: sustain.potionCooldownUntil - now };
    }
    const throttleMs = Number.isFinite(Config.combat && Config.combat.combatPotionThrottleMs)
      ? Math.max(0, Config.combat.combatPotionThrottleMs)
      : 1200;
    if (!opts.ignoreThrottle && Number.isFinite(sustain.lastPotionAt) && now - sustain.lastPotionAt < throttleMs) {
      return { ok: false, skipped: true, reason: "throttled_recent_potion_use" };
    }
    if (!potion) {
      return { ok: false, skipped: true, reason: "no_ready_" + resource + "_potion" };
    }
    const clicked = clickActionBarSlot(potion.slot);
    if (!clicked) {
      return { ok: false, skipped: false, reason: "click_failed", slot: potion.slot };
    }
    rememberCombatPotionUse(resource, potion, reason, now);
    Logger.log("COMBAT", "Combat potion used", {
      resource: resource,
      slot: potion.slot,
      reason: reason || null,
      counter: potion.record && potion.record.counter ? potion.record.counter.value : null,
      totalValue: potion.spec ? potion.spec.totalValue : null,
      durationSec: potion.spec ? potion.spec.durationSec : null,
      perSec: potion.spec ? potion.spec.perSec : null
    });
    const settleMs = Number.isFinite(Config.combat && Config.combat.combatPotionSettleMs)
      ? Math.max(0, Config.combat.combatPotionSettleMs)
      : 120;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    return { ok: true, skipped: false, slot: potion.slot, reason: reason || null };
  }

  async function maybeUseCombatSustain(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { used: false, reason: "combat_potions_off" };
    }
    updateCombatSustainObservations(liveState);
    const hpNeed = evaluateCombatHpPotionNeed(liveState);
    if (hpNeed.needed) {
      const hpPotion = chooseCombatPotionCandidate("hp", hpNeed.effectiveMissing, {
        preferLargest: hpNeed.emergency
      });
      const hpUse = await tryUseCombatPotion("hp", hpPotion, opts.reason || hpNeed.reason, {});
      if (hpUse.ok) {
        return { used: true, resource: "hp", detail: hpUse, policy: hpNeed };
      }
    }
    const mpNeed = evaluateCombatMpPotionNeed(liveState);
    if (mpNeed.needed) {
      const mpPotion = chooseCombatPotionCandidate("mp", mpNeed.shortage, { preferLargest: false });
      const mpUse = await tryUseCombatPotion("mp", mpPotion, opts.reason || mpNeed.reason);
      if (mpUse.ok) {
        return { used: true, resource: "mp", detail: mpUse, policy: mpNeed };
      }
    }
    return {
      used: false,
      reason: "no_potion_needed_or_ready",
      hpPolicy: hpNeed,
      mpPolicy: mpNeed
    };
  }

  // AI CHANGED: Out-of-combat explore prep — drink HP potions toward threshold when enemyCount===0 (does not spend MP potions).
  async function tryUseOutOfCombatHpTopoff(liveState, thresholdPct) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { used: false, reason: "combat_potions_off" };
    }
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : 0;
    if (enemyCount !== 0) {
      return { used: false, reason: "not_clear_tile" };
    }
    updateCombatSustainObservations(liveState);
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    const hpMax =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.max)
        ? liveState.player.hp.max
        : null;
    const hpPct =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.pct)
        ? liveState.player.hp.pct
        : null;
    if (!Number.isFinite(hpCur) || !Number.isFinite(hpMax) || !(hpMax > 0) || !Number.isFinite(hpPct)) {
      return { used: false, reason: "hp_unread" };
    }
    const safeThreshold =
      Number.isFinite(thresholdPct) ? Math.max(0.05, Math.min(1, thresholdPct)) : 0.75;
    if (hpPct >= safeThreshold) {
      return { used: false, reason: "already_above_threshold" };
    }
    const targetCur = hpMax * safeThreshold;
    const missingToThreshold = Math.max(0, targetCur - hpCur);
    if (!(missingToThreshold > 0.5)) {
      return { used: false, reason: "missing_hp_trivial" };
    }
    const potion = chooseCombatPotionCandidate("hp", missingToThreshold, { preferLargest: true });
    if (!potion) {
      return { used: false, reason: "no_ready_hp_potion" };
    }
    const useResult = await tryUseCombatPotion("hp", potion, "out_of_combat_explore_topoff", { ignoreThrottle: true });
    if (useResult && useResult.ok) {
      return { used: true, detail: useResult };
    }
    return {
      used: false,
      reason: useResult && useResult.reason ? useResult.reason : "use_failed",
      detail: useResult || null
    };
  }

  // AI CHANGED: Idle regen gate — when enemyCount===0 before exploreByScan, stay idle until HP≥threshold (HP potions + passive ticks).
  async function waitForOutOfCombatHealBeforeExplore(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (Config.combat && Config.combat.outOfCombatHealBeforeExplore === false) {
      return { ok: true, skipped: true, reason: "feature_off" };
    }
    const thresholdPct =
      Number.isFinite(Config.combat && Config.combat.outOfCombatHealWaitHpPct)
        ? Math.max(0.05, Math.min(1, Config.combat.outOfCombatHealWaitHpPct))
        : 0.75;
    const pollMs =
      Number.isFinite(Config.combat && Config.combat.outOfCombatHealPollMs)
        ? Math.max(120, Config.combat.outOfCombatHealPollMs)
        : 600;
    let state = readBasicState();
    if (!(typeof state.combat.enemyCount === "number" && state.combat.enemyCount === 0)) {
      return { ok: true, skipped: true, reason: "enemies_present", thresholdPct: thresholdPct };
    }
    const hp =
      state && state.player && state.player.hp && state.player.hp.valid ? state.player.hp : null;
    const targetActive =
      state &&
      state.combat &&
      state.combat.targetHp &&
      state.combat.targetHp.valid &&
      Number.isFinite(state.combat.targetHp.cur) &&
      state.combat.targetHp.cur > 0;
    if (!hp || !Number.isFinite(hp.pct)) {
      return { ok: true, skipped: true, reason: "hp_unread", thresholdPct: thresholdPct };
    }
    if (targetActive) {
      return {
        ok: true,
        skipped: true,
        reason: "target_bar_active",
        thresholdPct: thresholdPct,
        hpPct: +hp.pct.toFixed(4)
      };
    }
    if (hp.pct >= thresholdPct) {
      return { ok: true, waited: false, thresholdPct: thresholdPct, hpPct: +hp.pct.toFixed(4) };
    }
    const startedAt = Date.now();
    let sustainUses = 0;
    while (!Runtime.autoFarm.stopRequested) {
      state = readBasicState();
      if (!(typeof state.combat.enemyCount === "number" && state.combat.enemyCount === 0)) {
        return {
          ok: true,
          skipped: true,
          reason: "combat_became_active_enemy_count",
          thresholdPct: thresholdPct,
          sustainUses: sustainUses
        };
      }
      const hpNow = state.player && state.player.hp && state.player.hp.valid ? state.player.hp : null;
      if (!hpNow || !Number.isFinite(hpNow.pct)) {
        return {
          ok: true,
          skipped: true,
          reason: "hp_became_unread",
          thresholdPct: thresholdPct,
          sustainUses: sustainUses
        };
      }
      const targetNow =
        state &&
        state.combat &&
        state.combat.targetHp &&
        state.combat.targetHp.valid &&
        Number.isFinite(state.combat.targetHp.cur) &&
        state.combat.targetHp.cur > 0;
      if (targetNow) {
        return {
          ok: true,
          skipped: true,
          reason: "combat_became_active_target",
          thresholdPct: thresholdPct,
          hpPct: +hpNow.pct.toFixed(4),
          sustainUses: sustainUses
        };
      }
      if (hpNow.pct >= thresholdPct) {
        return {
          ok: true,
          waited: true,
          thresholdPct: thresholdPct,
          hpPct: +hpNow.pct.toFixed(4),
          waitedMs: Math.max(0, Date.now() - startedAt),
          sustainUses: sustainUses
        };
      }
      const hpCurText = Number.isFinite(hpNow.cur) && Number.isFinite(hpNow.max)
        ? `${Math.round(hpNow.cur)}/${Math.round(hpNow.max)}`
        : `${Math.round(hpNow.pct * 100)}%`;
      setBotStatus(
        "waiting",
        `healing before next tile (${hpCurText} → ${Math.round(thresholdPct * 100)}%)`
      );
      const topoff = await tryUseOutOfCombatHpTopoff(state, thresholdPct);
      if (topoff && topoff.used) {
        sustainUses += 1;
        Logger.log("COMBAT", "Out-of-combat explore HP topoff", {
          reason: opts.reason || "before_explore_move",
          sustainUses: sustainUses,
          detail: topoff.detail || null
        });
      }
      await sleep(pollMs, { bypassStop: true });
    }
    return { ok: false, reason: "stop_requested", thresholdPct: thresholdPct };
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
          return {
            ok: true,
            skillSlot: opening.slot,
            skillRecord: opening.record || null,
            chargeReleasePlan: opening.chargeReleasePlan || null
          };
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
    return { ok: basicOk, skillSlot: null, skillRecord: null, chargeReleasePlan: null };
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

  // AI CHANGED: Charge skills land damage on release (cancel/full charge), not during the hold itself. Run a dedicated release plan before generic "no progress" fallback logic.
  async function handleChargeSkillOpener(beforeState, open, settleRanked, pollMs, fullTimeoutMs) {
    const chargePlan =
      open && open.chargeReleasePlan
        ? open.chargeReleasePlan
        : (
            open && open.skillRecord && typeof plannerBuildChargeReleasePlan === "function"
              ? plannerBuildChargeReleasePlan(open.skillRecord)
              : null
          );
    if (!chargePlan) {
      return { handled: false, progressed: false };
    }
    Logger.log("LOOP", "Charge skill opener plan", {
      slot: open.skillSlot,
      releaseMs: chargePlan.releaseMs,
      releaseFraction: chargePlan.releaseFraction,
      strategy: chargePlan.strategy,
      source: chargePlan.releaseSource,
      selectionMode: chargePlan.selectionMode || null,
      candidateCount: Array.isArray(chargePlan.candidates) ? chargePlan.candidates.length : 0
    });
    if (chargePlan.releaseMs > 0) {
      await sleep(chargePlan.releaseMs);
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested during charge hold");
      return { handled: true, progressed: false };
    }
    const cancelReleaseTimeoutRaw = Config.combat.chargeSkillReleaseProgressTimeoutMs;
    const cancelReleaseTimeout =
      Number.isFinite(cancelReleaseTimeoutRaw) && cancelReleaseTimeoutRaw > 0
        ? Math.min(cancelReleaseTimeoutRaw, fullTimeoutMs)
        : Math.min(2200, fullTimeoutMs);
    if (chargePlan.strategy === "cancel_release") {
      if (isChargingSkillCancelHintVisible()) {
        Logger.log("LOOP", "Charge skill release via cancel UI", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction
        });
        clickChargingSkillCancelUi();
        if (settleRanked > 0) {
          await sleep(settleRanked);
        }
        if (Runtime.autoFarm.stopRequested) {
          return { handled: true, progressed: false };
        }
      } else {
        Logger.warn("LOOP", "Charge release hint missing at planned release time", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction
        });
      }
    } else {
      const fullPadRaw = Config.combat.chargeSkillFullReleasePaddingMs;
      const fullPadMs = Number.isFinite(fullPadRaw) && fullPadRaw >= 0 ? fullPadRaw : 180;
      if (fullPadMs > 0) {
        await sleep(fullPadMs);
      }
      if (Runtime.autoFarm.stopRequested) {
        return { handled: true, progressed: false };
      }
    }
    const fullChargeTimeoutRaw = Config.combat.chargeSkillFullChargeProgressTimeoutMs;
    const fullChargeTimeout =
      Number.isFinite(fullChargeTimeoutRaw) && fullChargeTimeoutRaw > 0
        ? Math.min(fullChargeTimeoutRaw, fullTimeoutMs)
        : Math.min(650, fullTimeoutMs);
    const progressed = await waitForCondition(
      chargePlan.strategy === "full_charge" ? "attack progress after full charge" : "attack progress after charge release",
      hasCombatProgressSince(beforeState),
      { timeoutMs: chargePlan.strategy === "full_charge" ? fullChargeTimeout : cancelReleaseTimeout, pollMs: pollMs }
    );
    if (progressed) {
      plannerRecordOpenerRuntimeEvent("ranked_progress", {
        slot: open.skillSlot,
        stage: chargePlan.strategy === "full_charge" ? "after_full_charge" : "after_charge_release"
      });
    }
    return { handled: true, progressed: progressed };
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

    const chargeOutcome = await handleChargeSkillOpener(beforeState, open, settleRanked, pollMs, fullTimeoutMs);
    const chargeSkillHandled = !!(chargeOutcome && chargeOutcome.handled);
    if (chargeSkillHandled) {
      if (chargeOutcome.progressed) {
        return true;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after charge-skill handling");
        return false;
      }
    }

    // AI CHANGED: slice 25 — optional grace so slow-starting charge skills register before HP polling.
    const chargeGraceRaw = Config.combat.rankedOpenerChargeGraceMs;
    const chargeGraceMs =
      !chargeSkillHandled && open.skillSlot != null && Number.isFinite(chargeGraceRaw) && chargeGraceRaw > 0 ? chargeGraceRaw : 0;
    if (chargeGraceMs > 0) {
      await sleep(chargeGraceMs);
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after charge grace; skipping follow-up");
      return false;
    }

    let chargeCancelAttempted = false;
    let progressed = false;
    if (!chargeSkillHandled) {
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
    }

    // AI CHANGED: slice 21b — stop-aborted wait must not fall through to more clicks (alternate opener / basic).
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after opener wait; skipping follow-up attacks");
      return false;
    }

    // AI CHANGED: slice 24b — charge skill stuck: first wait saw no HP/count (CD not running until cancel or full shot). Tap cancel UI only when needed, not a second bar click.
    if (
      !chargeSkillHandled &&
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
      // AI CHANGED: Resume damage immediately after cancel — don't stand idle for full attackProgressTimeoutMs (hero takes free hits).
      clickBasicAttack();
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      if (Runtime.autoFarm.stopRequested) {
        return false;
      }
      const postCancelTimeoutRaw = Config.combat.attackProgressAfterChargeCancelTimeoutMs;
      const postCancelTimeout =
        Number.isFinite(postCancelTimeoutRaw) && postCancelTimeoutRaw > 0
          ? Math.min(postCancelTimeoutRaw, fullTimeoutMs)
          : Math.min(3200, fullTimeoutMs);
      progressed = await waitForCondition(
        "attack progress after charge cancel ui",
        hasCombatProgressSince(beforeState),
        { timeoutMs: postCancelTimeout, pollMs: pollMs }
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
        await maybeUseCombatSustain(current, {
          reason: useRankedBurst ? "before_ranked_burst" : "before_basic_burst",
          useRankedBurst: useRankedBurst
        });
        current = readBasicState();

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
          // AI CHANGED: enemyCount===0 — top off to outOfCombatHealWaitHpPct with HP potions + passive regen before exploreByScan.
          const healReady = await waitForOutOfCombatHealBeforeExplore({
            reason: "before_explore_move"
          });
          if (!healReady.ok && healReady.reason === "stop_requested") {
            exitReason = "user_stop";
            break;
          } else if (healReady.waited) {
            Logger.log("COMBAT", "Out-of-combat heal gate satisfied before explore move", healReady);
          }
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
