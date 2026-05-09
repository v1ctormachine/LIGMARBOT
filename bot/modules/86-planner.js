  // AI CHANGED: Phase C4 (slice 1) -- read-only paper combat math for console / future automation.
  // Uses Runtime.hero.combatStats + Runtime.skills.slots. **Slice 11:** opener path uses
  // isActionBarSlotShowingCooldown(). **Slice 12:** opener hold ms from cast/channel cache
  // (plannerOpenerHoldCastMs) for clickActionBarSlotHoldCast in combat.
  // Ground truth for real fights remains observeCombatDamage (C2) + enemy DB (C3).

  function estimatePaperBasicAttackDps(statsOverride) {
    const stats = statsOverride || Runtime.hero.combatStats;
    const missing = [];
    if (!stats || typeof stats !== "object") {
      return { dps: null, expectedHitMult: null, breakdown: null, missing: ["no_combat_stats"] };
    }
    const pa = stats.physicalAttack;
    const aps = stats.attackSpeed;
    const ccPct = stats.critChance;
    const cdPct = stats.critDamage;

    if (!Number.isFinite(pa) || pa <= 0) {
      missing.push("physicalAttack");
    }
    if (!Number.isFinite(aps) || aps <= 0) {
      missing.push("attackSpeed");
    }

    let p = Number.isFinite(ccPct) ? ccPct / 100 : 0;
    if (!Number.isFinite(ccPct)) {
      missing.push("critChance_optional");
      p = 0;
    }

    let critMult = Number.isFinite(cdPct) ? cdPct / 100 : null;
    if (critMult === null || !Number.isFinite(critMult) || critMult <= 0) {
      critMult = Config.planner.defaultCritDamageMultiplier;
      missing.push("critDamage_defaulted");
    }

    const expectedHitMult = (1 - p) * 1 + p * critMult;

    if (missing.indexOf("physicalAttack") >= 0 || missing.indexOf("attackSpeed") >= 0) {
      return {
        dps: null,
        expectedHitMult: Number.isFinite(expectedHitMult) ? expectedHitMult : null,
        breakdown: { pa: pa, aps: aps, critChancePct: ccPct, critDamagePct: cdPct, critMultUsed: critMult },
        missing: missing
      };
    }

    const dps = pa * aps * expectedHitMult;
    return {
      dps: dps,
      expectedHitMult: expectedHitMult,
      breakdown: {
        physicalAttack: pa,
        attackSpeed: aps,
        critChancePct: ccPct,
        critDamagePct: cdPct,
        critMultUsed: critMult,
        expectedHitMult: expectedHitMult
      },
      missing: missing
    };
  }

  function listAttackSkillsForPlanner() {
    const slots = Runtime.skills.slots || [];
    const out = [];
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind === "empty") {
        continue;
      }
      if (!s.isAttack || !s.targetsEnemy) {
        continue;
      }
      out.push({
        slot: s.slot,
        name: s.name || "",
        kind: s.kind,
        cooldownSec: s.cooldownSec,
        manaCost: s.manaCost,
        castTimeSec: s.castTimeSec,
        effectsCount: Array.isArray(s.effects) ? s.effects.length : 0
      });
    }
    return out;
  }

  function summarizePlannerInputs() {
    const basic = estimatePaperBasicAttackDps();
    const attackSkills = listAttackSkillsForPlanner();
    const slots = Runtime.skills.slots || [];
    return {
      heroStatsReadAt: Runtime.hero.statsReadAt,
      basicAttackPaper: basic,
      totalSkillSlots: slots.length,
      attackSkillsEnemy: attackSkills,
      note:
        "Paper model ignores armor/resists, skill multipliers, and procs — calibrate with ligmarBot.observeCombatDamage()."
    };
  }

  // AI CHANGED: Phase C4 slice 3 -- compare enemy DB observeCalAgg vs paper basic hit (console).
  function summarizeEnemyDbCalibration(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const onlyKey = typeof opts.key === "string" && opts.key.trim() ? opts.key.trim() : null;

    const paper = estimatePaperBasicAttackDps();
    let currentExpectedHit = null;
    if (paper && paper.breakdown && Number.isFinite(paper.breakdown.physicalAttack) && Number.isFinite(paper.expectedHitMult)) {
      currentExpectedHit = paper.breakdown.physicalAttack * paper.expectedHitMult;
    }

    const db = Runtime.enemy.db || [];
    const rows = [];
    for (let i = 0; i < db.length; i += 1) {
      const row = db[i];
      if (!row || !row.observeCalAgg || !row.observeCalAgg.hpDropSamples) {
        continue;
      }
      if (onlyKey && row.key !== onlyKey) {
        continue;
      }
      const cal = row.observeCalAgg;
      const observedMean = cal.hpDropMean;
      const lastPaper =
        row.observeCalLast && Number.isFinite(row.observeCalLast.paperExpectedHitApprox)
          ? row.observeCalLast.paperExpectedHitApprox
          : null;

      let ratioVsLastMergePaper = null;
      if (lastPaper && lastPaper > 0 && Number.isFinite(observedMean)) {
        ratioVsLastMergePaper = +(observedMean / lastPaper).toFixed(4);
      }
      let ratioVsCurrentPaper = null;
      if (currentExpectedHit && currentExpectedHit > 0 && Number.isFinite(observedMean)) {
        ratioVsCurrentPaper = +(observedMean / currentExpectedHit).toFixed(4);
      }

      rows.push({
        key: row.key,
        name: row.name,
        level: row.level,
        maxHp: row.maxHp,
        observedMeanHpDrop: observedMean,
        observedMin: cal.hpDropMin,
        observedMax: cal.hpDropMax,
        hpDropSamples: cal.hpDropSamples,
        sessionsMerged: cal.sessionsMerged,
        paperExpectedHitAtLastMerge: lastPaper,
        ratioObservedVsPaperAtMerge: ratioVsLastMergePaper,
        paperExpectedHitCurrentHero: currentExpectedHit,
        ratioObservedVsCurrentPaper: ratioVsCurrentPaper,
        statusLabelsLast: row.statusLabelsLast || []
      });
    }

    return {
      paperCurrent: {
        expectedHitPerSwing: currentExpectedHit,
        dps: paper ? paper.dps : null,
        missing: paper ? paper.missing : ["no_paper"]
      },
      calibratedRows: rows,
      note:
        "ratio > 1 often means skills/crits/debuffs mixed in; basic-only fights give cleaner factors. ratioVsCurrentPaper uses live hero stats."
    };
  }

  function getEnemyCalibrationRow(key) {
    if (typeof key !== "string" || !key.trim()) {
      return null;
    }
    const summary = summarizeEnemyDbCalibration({ key: key.trim() });
    return summary.calibratedRows.length ? summary.calibratedRows[0] : null;
  }

  // AI CHANGED: Phase C4 slice 4 -- rough effect weights for ranking (console-only; no live CDs).
  function plannerSkillEffectHeuristicScore(effects) {
    if (!Array.isArray(effects)) {
      return { score: 0, parts: [] };
    }
    let score = 0;
    const parts = [];
    for (let i = 0; i < effects.length; i += 1) {
      const e = effects[i];
      if (!e || !e.type) {
        continue;
      }
      let add = 0;
      if (e.type === "dot" && Number.isFinite(e.perSec)) {
        add = e.perSec * 15;
      } else if (e.type === "instant" && Number.isFinite(e.value)) {
        add = e.value * 0.08;
      } else if (e.type === "channel_gear") {
        add =
          (Number.isFinite(e.gearDamagePercent) ? e.gearDamagePercent : 0) * 0.3 +
          (Number.isFinite(e.channelMaxSec) ? e.channelMaxSec * 2 : 0);
      } else if (e.type === "damage_buff" && Number.isFinite(e.magnitude)) {
        add = e.magnitude * 0.5;
      } else if (e.type === "basic_proc") {
        add = 8;
      } else if (e.type === "stun") {
        add = 15;
      } else if (e.type === "slow") {
        add = 8;
      } else if (e.type === "crit_damage_buff" && Number.isFinite(e.critDamagePercent)) {
        add = e.critDamagePercent * 0.25;
      }
      if (add !== 0) {
        score += add;
        parts.push({ type: e.type, add: +add.toFixed(3) });
      }
    }
    return { score: score, parts: parts };
  }

  function rankAttackSkillsByHeuristic(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const enemyKey =
      typeof opts.enemyKey === "string" && opts.enemyKey.trim() ? opts.enemyKey.trim() : null;
    const calRow = enemyKey ? getEnemyCalibrationRow(enemyKey) : null;
    const mobFactor =
      calRow && Number.isFinite(calRow.ratioObservedVsCurrentPaper)
        ? calRow.ratioObservedVsCurrentPaper
        : null;

    const slots = Runtime.skills.slots || [];
    const ranked = [];
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind === "empty" || !s.isAttack || !s.targetsEnemy) {
        continue;
      }
      const eff = plannerSkillEffectHeuristicScore(s.effects);
      const cd = Number.isFinite(s.cooldownSec) ? s.cooldownSec : 0;
      const mana = Number.isFinite(s.manaCost) ? s.manaCost : 0;
      const cast = Number.isFinite(s.castTimeSec) ? s.castTimeSec : 0;
      let score = eff.score;
      score -= cd * 0.15;
      score -= mana * 0.02;
      score -= cast * 3;
      const basicProc =
        Array.isArray(s.effects) && s.effects.some((x) => x && x.type === "basic_proc");
      if (mobFactor && mobFactor > 0 && basicProc) {
        score += mobFactor * 5;
      }
      ranked.push({
        slot: s.slot,
        name: s.name,
        cooldownSec: s.cooldownSec,
        manaCost: s.manaCost,
        castTimeSec: s.castTimeSec,
        heuristicScore: +score.toFixed(3),
        effectBreakdown: eff.parts
      });
    }
    ranked.sort((a, b) => b.heuristicScore - a.heuristicScore);
    return {
      order: ranked.map((r) => r.slot),
      ranked: ranked,
      enemyKeyUsed: enemyKey,
      mobFactorApplied: mobFactor,
      note:
        "Heuristic rank only — weights are guesses; opener picks also skip slots when isActionBarSlotShowingCooldown(slot) is true. Pass enemyKey to nudge basic_proc skills using calibration ratio."
    };
  }

  // AI CHANGED: Phase C4 slice 4 -- one-shot observe + merge for fewer console steps.
  async function calibrateEnemyFromCombat(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const observeOpts = opts.observe && typeof opts.observe === "object" ? opts.observe : {};
    const mergeOpts = opts.merge && typeof opts.merge === "object" ? opts.merge : {};

    const session = await observeCombatDamage(observeOpts);
    if (!session || !session.ok) {
      return {
        ok: false,
        stage: "observe",
        session: session || null,
        row: null,
        error: Runtime.damage.lastError || "observe_failed",
        hint: null
      };
    }
    const dropCount =
      session.summary && typeof session.summary.hpDropEventCount === "number"
        ? session.summary.hpDropEventCount
        : 0;
    if (dropCount < 1) {
      return {
        ok: false,
        stage: "no_hp_drops",
        session: session,
        row: null,
        error: "no_hp_drops",
        hint:
          "Red target HP did not decrease during the window — keep a live target, attack (basic or skill), or raise totalMs."
      };
    }
    const row = mergeLastDamageObserveIntoEnemyDb(mergeOpts);
    if (!row) {
      return {
        ok: false,
        stage: "merge",
        session: session,
        row: null,
        error: Runtime.enemy.lastError || "merge_failed",
        hint:
          "Observe had hp_drop events but merge failed — check session.attribution / pass merge: { key: '...' }."
      };
    }
    return { ok: true, stage: "done", session: session, row: row, error: null, hint: null };
  }

  // AI CHANGED: Phase C4 slice 5 -- one console call: observe + merge + calibration summary for last key.
  async function quickCalibrationSession(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const baseObserve = {
      includeFloatingTexts: false,
      mergeToEnemyDb: true,
      totalMs: 10000
    };
    const observeIn = opts.observe && typeof opts.observe === "object" ? opts.observe : {};
    const observe = Object.assign({}, baseObserve, observeIn);

    const session = await observeCombatDamage(observe);
    const key =
      (session && session.attribution && session.attribution.key) ||
      Runtime.enemy.lastFoughtKey ||
      null;
    const calibration = key
      ? summarizeEnemyDbCalibration({ key: key })
      : summarizeEnemyDbCalibration();
    const rank = key ? rankAttackSkillsByHeuristic({ enemyKey: key }) : rankAttackSkillsByHeuristic({});

    return {
      ok: !!(session && session.ok),
      lastFoughtKey: key,
      session: session,
      enemyDbMerge: session && session.enemyDbMerge ? session.enemyDbMerge : null,
      calibration: calibration,
      skillRank: rank,
      note: "Fight during the whole observe window; see ARCHITECTURE.md playbook C2."
    };
  }

  // AI CHANGED: slice 8b — opener must have at least one parsed direct-damage effect (skip pure buff openers).
  function plannerSkillHasDirectDamageForOpener(slotRec) {
    if (!slotRec || !Array.isArray(slotRec.effects)) {
      return true;
    }
    if (slotRec.effects.length === 0) {
      return true;
    }
    for (let i = 0; i < slotRec.effects.length; i += 1) {
      const e = slotRec.effects[i];
      if (!e || !e.type) {
        continue;
      }
      if (e.type === "dot" || e.type === "instant" || e.type === "channel_gear" || e.type === "basic_proc") {
        return true;
      }
    }
    return false;
  }

  // AI CHANGED: Phase C4 slice 12 — hold duration (ms) for opener when cache says cast time or channel_gear window.
  function plannerOpenerHoldCastMs(slotRec) {
    if (!slotRec || Config.planner.useHoldCastForChannelOpeners === false) {
      return 0;
    }
    const pad = Number.isFinite(Config.planner.channelOpenerHoldPadMs)
      ? Config.planner.channelOpenerHoldPadMs
      : 180;
    const cap = Number.isFinite(Config.planner.channelOpenerHoldCapMs)
      ? Config.planner.channelOpenerHoldCapMs
      : 4000;
    const floor = Number.isFinite(Config.planner.channelOpenerHoldMinMs)
      ? Config.planner.channelOpenerHoldMinMs
      : 120;
    let needMs = 0;
    const ct = slotRec.castTimeSec;
    if (Number.isFinite(ct) && ct > 0) {
      needMs = Math.max(needMs, ct * 1000 + pad);
    }
    const effs = slotRec.effects || [];
    for (let j = 0; j < effs.length; j += 1) {
      const e = effs[j];
      if (e && e.type === "channel_gear" && Number.isFinite(e.channelMaxSec) && e.channelMaxSec > 0) {
        needMs = Math.max(needMs, e.channelMaxSec * 1000 + pad);
        break;
      }
    }
    if (needMs <= 0) {
      return 0;
    }
    const raw = Math.min(Math.max(needMs, floor), cap);
    const openMs = Number.isFinite(Config.skills.holdToOpenMs) ? Config.skills.holdToOpenMs : 450;
    const margin = Number.isFinite(Config.planner.channelOpenerAvoidPopupMarginMs)
      ? Config.planner.channelOpenerAvoidPopupMarginMs
      : 120;
    const maxSafeHold = Math.max(80, openMs - margin);
    if (raw > maxSafeHold) {
      Logger.warn("PLANNER", "Opener hold-cast skipped (would open skill popup like scan long-press); using click", {
        computedHoldMs: raw,
        maxSafeHoldMs: maxSafeHold,
        holdToOpenMs: openMs,
        name: slotRec.name || ""
      });
      return 0;
    }
    return raw;
  }

  // AI CHANGED: Phase C4 slice 8+12+15 — full pick { slot, record } for opener; optional excludeSlots (indices already tried this burst).
  function plannerPickSkillOpeningPick(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    let exclude = new Set();
    if (opts.excludeSlots instanceof Set) {
      exclude = opts.excludeSlots;
    } else if (Array.isArray(opts.excludeSlots)) {
      for (let ex = 0; ex < opts.excludeSlots.length; ex += 1) {
        const v = opts.excludeSlots[ex];
        if (typeof v === "number" && v >= 0) {
          exclude.add(v);
        }
      }
    }
    if (!Config.planner.useRankedAttackSkillsInCombat) {
      return null;
    }
    const slots = Runtime.skills.slots;
    if (!Array.isArray(slots) || slots.length === 0) {
      return null;
    }
    const key = Runtime.enemy.lastFoughtKey;
    const rank =
      typeof key === "string" && key.trim()
        ? rankAttackSkillsByHeuristic({ enemyKey: key.trim() })
        : rankAttackSkillsByHeuristic({});
    if (!rank || !Array.isArray(rank.order) || rank.order.length === 0) {
      return null;
    }
    const reserve = Number.isFinite(Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const st = readBasicState();
    const mpCur = st.player.mp && st.player.mp.valid ? st.player.mp.cur : null;
    for (let i = 0; i < rank.order.length; i += 1) {
      const idx = rank.order[i];
      if (typeof idx !== "number" || idx < 0 || idx >= slots.length) {
        continue;
      }
      const s = slots[idx];
      if (!s || s.kind === "empty" || s.kind === "basic" || s.kind === "potion") {
        continue;
      }
      if (s.kind !== "skill") {
        continue;
      }
      if (!s.isAttack || !s.targetsEnemy) {
        continue;
      }
      if (!plannerSkillHasDirectDamageForOpener(s)) {
        continue;
      }
      const mc = Number.isFinite(s.manaCost) ? s.manaCost : 0;
      if (mc > 0) {
        if (mpCur === null) {
          continue;
        }
        if (mpCur < mc + reserve) {
          continue;
        }
      }
      if (Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
        if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(idx)) {
          Logger.log("PLANNER", "Skipping ranked skill slot (live cooldown / blocked hint on action bar)", {
            slot: idx,
            name: s.name || ""
          });
          continue;
        }
      }
      if (exclude.has(idx)) {
        continue;
      }
      return { slot: idx, record: s };
    }
    return null;
  }

  // AI CHANGED: Phase C4 slice 8 — pick action-bar index for opening attack, or null to use basic-only path.
  function plannerPickSkillSlotToCast() {
    const p = plannerPickSkillOpeningPick(null);
    return p ? p.slot : null;
  }

  function getLastFoughtEnemyKey() {
    return Runtime.enemy.lastFoughtKey || null;
  }
