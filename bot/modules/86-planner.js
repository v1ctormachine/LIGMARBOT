  // AI CHANGED: Phase C4 (slice 1) -- read-only paper combat math for console / future automation.
  // Uses Runtime.hero.combatStats + Runtime.skills.slots. **Slice 11:** opener path uses
  // isActionBarSlotShowingCooldown(). **Slice 22:** combat ranked opener is tap-only (clickActionBarSlot);
  // plannerOpenerHoldCastMs kept for API compat, always 0 — no bar hold-cast in combat.
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

  // AI CHANGED: Rank using skill conception (flags/roles) — stable across upgrade levels; ignores tooltip magnitudes.
  function plannerConceptionHeuristicScore(conception) {
    if (!conception || typeof conception !== "object" || !conception.flags) {
      return { score: 0, parts: [] };
    }
    const f = conception.flags;
    const ds = conception.descShape || {};
    let score = 0;
    const parts = [];
    function add(label, v) {
      if (v) {
        score += v;
        parts.push({ type: label, add: v });
      }
    }
    add("basic_proc", f.basicAugment ? 10 : 0);
    add("instant", f.directBonus ? 7 : 0);
    add("dot", f.dot ? 12 : 0);
    add("channel_gear", f.channel ? 14 : 0);
    add("slow", f.slow ? 8 : 0);
    add("stun", f.stun ? 18 : 0);
    add("crit_damage_buff", f.critBuff ? 6 : 0);
    add("damage_buff", f.damageBuff ? 6 : 0);
    add("dodge_buff", f.dodgeBuff ? 4 : 0);
    if (ds.selfAttackSpeedReduced) {
      score -= 4;
      parts.push({ type: "self_atk_spd_cost", add: -4 });
    }
    if (f.stealth) {
      score -= 2;
      parts.push({ type: "stealth_opener_caution", add: -2 });
    }
    return { score: score, parts: parts };
  }

  // AI CHANGED: Prefer canonical master conception when available; fallback to scanned conception.
  function plannerResolveSlotConception(slotRec) {
    if (!slotRec || typeof slotRec !== "object") {
      return null;
    }
    if (slotRec.master && slotRec.master.conception && typeof slotRec.master.conception === "object") {
      return slotRec.master.conception;
    }
    if (slotRec.conception && typeof slotRec.conception === "object") {
      return slotRec.conception;
    }
    if (typeof inferSkillConception === "function") {
      const conc = inferSkillConception(slotRec);
      slotRec.conception = conc;
      return conc;
    }
    return null;
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
    const useConcRank = Config.planner.skillRankUseConception === true;
    const ranked = [];
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind === "empty" || !s.isAttack || !s.targetsEnemy) {
        continue;
      }
      let eff;
      if (useConcRank) {
        const conc = plannerResolveSlotConception(s);
        eff = plannerConceptionHeuristicScore(conc);
      } else {
        eff = plannerSkillEffectHeuristicScore(s.effects);
      }
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
        effectBreakdown: eff.parts,
        rankBasis: useConcRank ? "conception" : "effect_magnitude"
      });
    }
    ranked.sort((a, b) => b.heuristicScore - a.heuristicScore);
    return {
      order: ranked.map((r) => r.slot),
      ranked: ranked,
      enemyKeyUsed: enemyKey,
      mobFactorApplied: mobFactor,
      rankMode: useConcRank ? "conception" : "effect_magnitude",
      note:
        "Heuristic rank only — weights are guesses; opener picks also skip slots when isActionBarSlotShowingCooldown(slot) is true. Pass enemyKey to nudge basic_proc skills using calibration ratio. Set Config.planner.skillRankUseConception=true for level-invariant role-based rank (openerHorizonSim still uses magnitudes unless disabled)."
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
      totalMs: 10000,
      // AI CHANGED: lethal-only fights (kill within window) still carry a real hp_drop — include in merge so TEST/calibration is not empty.
      mergeOpts: { excludeLethal: false }
    };
    const observeIn = opts.observe && typeof opts.observe === "object" ? opts.observe : {};
    const observe = Object.assign({}, baseObserve, observeIn);
    const moIn = observeIn.mergeOpts && typeof observeIn.mergeOpts === "object" ? observeIn.mergeOpts : {};
    observe.mergeOpts = Object.assign({}, baseObserve.mergeOpts, moIn);

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

  // AI CHANGED: slice 22 — combat does not use bar hold-cast; Ligmar activates skills with a normal tap. Kept for console/API scripts that still call ligmarBot.plannerOpenerHoldCastMs().
  function plannerOpenerHoldCastMs(slotRec) {
    void slotRec;
    return 0;
  }

  // AI CHANGED: Pack A — throttled [PLANNER] log when ranked opener cannot pick a slot (complements BOOT warn for empty cache).
  function plannerMaybeLogOpeningPickFailure(reason, detail) {
    if (Config.planner.logOpeningPickFailures === false) {
      return;
    }
    const throttleMs = Number.isFinite(Config.planner.openingPickFailureLogThrottleMs)
      ? Config.planner.openingPickFailureLogThrottleMs
      : 12000;
    const pr = Runtime.planner;
    const now = Date.now();
    const detailKey = detail ? JSON.stringify(detail) : "";
    const sig = String(reason || "") + "|" + detailKey;
    const prevSig =
      String(pr.lastOpeningPickLogReason || "") +
      "|" +
      (pr.lastOpeningPickLogDetailKey || "");
    if (sig === prevSig && now - (pr.lastOpeningPickLogAt || 0) < throttleMs) {
      return;
    }
    pr.lastOpeningPickLogAt = now;
    pr.lastOpeningPickLogReason = reason;
    pr.lastOpeningPickLogDetailKey = detailKey;
    Logger.log("PLANNER", "No ranked opener slot — using basic until this clears", {
      reason: reason,
      detail: detail || null,
      hint:
        reason === "empty_cache" || reason === "no_attack_skills_for_ranker"
          ? "await ligmarBot.scanSkills() (auto-farm OFF) or enable attack skills on bar."
          : reason === "all_candidates_filtered"
            ? "Raise MP, wait CDs, lower skillMpReserve, or disable skipOpenerWhenActionBarShowsCooldown if hints are wrong."
            : null
    });
  }

  // AI CHANGED: openerHorizonSim — mob factor from enemy DB calibration (1 when unknown).
  function plannerMobCalibrationFactorForKey(enemyKey) {
    const row =
      enemyKey && String(enemyKey).trim() ? getEnemyCalibrationRow(String(enemyKey).trim()) : null;
    if (row && Number.isFinite(row.ratioObservedVsCurrentPaper) && row.ratioObservedVsCurrentPaper > 0) {
      return row.ratioObservedVsCurrentPaper;
    }
    return 1;
  }

  // AI CHANGED: openerHorizonSim — one basic swing from paper hero stats.
  function plannerExpectedBasicHitFromPaper(paper) {
    if (!paper || !paper.breakdown || !Number.isFinite(paper.expectedHitMult)) {
      return null;
    }
    const pa = paper.breakdown.physicalAttack;
    if (!Number.isFinite(pa)) {
      return null;
    }
    return pa * paper.expectedHitMult;
  }

  // AI CHANGED: openerHorizonSim — rough skill damage over window from parsed effects (HP units, same scale as paper).
  function plannerSkillPaperDamageInHorizon(slot, horizonSec, mobFactor, expectedBasicHit) {
    if (!slot || !Array.isArray(slot.effects) || !(horizonSec > 0)) {
      return 0;
    }
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    let add = 0;
    for (let i = 0; i < slot.effects.length; i += 1) {
      const e = slot.effects[i];
      if (!e || !e.type) {
        continue;
      }
      if (e.type === "dot" && Number.isFinite(e.perSec)) {
        const dur = Number.isFinite(e.durationSec) ? e.durationSec : horizonSec;
        add += e.perSec * Math.min(horizonSec, dur);
      } else if (e.type === "instant" && Number.isFinite(e.value)) {
        add += e.value * mf;
      } else if (e.type === "basic_proc" && expectedBasicHit !== null && Number.isFinite(expectedBasicHit)) {
        add += expectedBasicHit * mf;
      } else if (e.type === "channel_gear" && expectedBasicHit !== null && Number.isFinite(expectedBasicHit)) {
        const chMax = Number.isFinite(e.channelMaxSec) ? e.channelMaxSec : 2;
        const ch = Math.min(Math.max(0, chMax), horizonSec);
        const gearPct = Number.isFinite(e.gearDamagePercent) ? e.gearDamagePercent / 100 : 0;
        const basePart = expectedBasicHit * mf;
        add += basePart * (1 + gearPct * 0.7 * (ch / Math.max(chMax, 0.05)));
      }
    }
    return add;
  }

  // AI CHANGED: openerHorizonSim — closed-form: cast blocks basics for castTime, then basics rest; skill lump from effects.
  function plannerOpenerHorizonSkillPlusBasics(slot, horizonSec, enemyKey) {
    const paper = estimatePaperBasicAttackDps();
    const basicDps = paper && Number.isFinite(paper.dps) ? paper.dps : 0;
    const mobFactor = plannerMobCalibrationFactorForKey(enemyKey);
    const expectedBasicHit = plannerExpectedBasicHitFromPaper(paper);
    const castBlocked =
      Number.isFinite(slot.castTimeSec) && slot.castTimeSec > 0 ? Math.min(horizonSec, slot.castTimeSec) : 0;
    const skillPaper = plannerSkillPaperDamageInHorizon(slot, horizonSec, mobFactor, expectedBasicHit);
    const timeLeft = Math.max(0, horizonSec - castBlocked);
    return skillPaper + basicDps * timeLeft;
  }

  function plannerOpenerHorizonBasicOnly(horizonSec) {
    const paper = estimatePaperBasicAttackDps();
    const basicDps = paper && Number.isFinite(paper.dps) ? paper.dps : 0;
    return basicDps * horizonSec;
  }

  // AI CHANGED: console/debug — table of opener candidates vs baseline for current target key.
  function previewOpenerHorizonSim(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const key =
      typeof opts.enemyKey === "string" && opts.enemyKey.trim()
        ? opts.enemyKey.trim()
        : Runtime.enemy.lastFoughtKey || null;
    const horizonMsRaw = opts.horizonMs;
    const horizonMs = Number.isFinite(horizonMsRaw) ? horizonMsRaw : Config.planner.openerHorizonSimMs;
    const horizonSec = Math.max(0.001, horizonMs / 1000);
    const rank = key ? rankAttackSkillsByHeuristic({ enemyKey: key }) : rankAttackSkillsByHeuristic({});
    const slots = Runtime.skills.slots || [];
    const baseline = plannerOpenerHorizonBasicOnly(horizonSec);
    const rows = [];
    if (rank && Array.isArray(rank.order)) {
      for (let i = 0; i < rank.order.length; i += 1) {
        const idx = rank.order[i];
        const s = slots[idx];
        if (!s || s.kind !== "skill" || !s.isAttack || !s.targetsEnemy) {
          continue;
        }
        if (!plannerSkillHasDirectDamageForOpener(s)) {
          continue;
        }
        const d = plannerOpenerHorizonSkillPlusBasics(s, horizonSec, key);
        rows.push({
          slot: idx,
          name: s.name || "",
          horizonDamage: +d.toFixed(2),
          vsBaseline: +((d / baseline - 1) * 100).toFixed(2) + "%"
        });
      }
    }
    return {
      ok: true,
      enemyKey: key,
      horizonMs: horizonMs,
      baselineDamage: +baseline.toFixed(2),
      candidates: rows,
      note: "Paper + effect parse; not live combat. Disable with Config.planner.useOpenerHorizonSim = false."
    };
  }

  // AI CHANGED: Pack A — read-only snapshot for console after a fight / when debugging openers.
  function getPlannerOpeningPickDiagnostics() {
    const pr = Runtime.planner;
    const slots = Runtime.skills.slots || [];
    return {
      rankedCombatEnabled: !!Config.planner.useRankedAttackSkillsInCombat,
      lastReason: pr.lastOpeningPickReason,
      lastDetail: pr.lastOpeningPickDetail,
      lastAt: pr.lastOpeningPickAt,
      cacheSlotCount: Array.isArray(slots) ? slots.length : 0,
      attackSkillsRanked: rankAttackSkillsByHeuristic({}).order.length,
      lastOpenerHorizonSim: pr.lastOpenerHorizonSim || null
    };
  }

  // AI CHANGED: Phase C4 slice 8+12+15 — pick opener with optional horizonSim (paper damage window); else first feasible heuristic order.
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
    const pr = Runtime.planner;
    pr.lastOpeningPickReason = null;
    pr.lastOpeningPickDetail = null;
    pr.lastOpeningPickAt = Date.now();
    pr.lastOpenerHorizonSim = null;
    if (!Config.planner.useRankedAttackSkillsInCombat) {
      pr.lastOpeningPickReason = "ranked_disabled";
      return null;
    }
    const slots = Runtime.skills.slots;
    if (!Array.isArray(slots) || slots.length === 0) {
      pr.lastOpeningPickReason = "empty_cache";
      plannerMaybeLogOpeningPickFailure("empty_cache", { barSlots: 0 });
      return null;
    }
    const key = Runtime.enemy.lastFoughtKey;
    const rank =
      typeof key === "string" && key.trim()
        ? rankAttackSkillsByHeuristic({ enemyKey: key.trim() })
        : rankAttackSkillsByHeuristic({});
    if (!rank || !Array.isArray(rank.order) || rank.order.length === 0) {
      pr.lastOpeningPickReason = "no_attack_skills_for_ranker";
      pr.lastOpeningPickDetail = { cachedSlots: slots.length, enemyKey: key || null };
      plannerMaybeLogOpeningPickFailure("no_attack_skills_for_ranker", pr.lastOpeningPickDetail);
      return null;
    }
    const reserve = Number.isFinite(Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const st = readBasicState();
    const mpCur = st.player.mp && st.player.mp.valid ? st.player.mp.cur : null;
    const breakdown = {
      mp: 0,
      cooldown: 0,
      exclude: 0,
      noDirectDamage: 0,
      notSkill: 0,
      notAttack: 0,
      badIndex: 0,
      emptyRow: 0
    };
    const candidates = [];
    for (let i = 0; i < rank.order.length; i += 1) {
      const idx = rank.order[i];
      if (typeof idx !== "number" || idx < 0 || idx >= slots.length) {
        breakdown.badIndex += 1;
        continue;
      }
      const s = slots[idx];
      if (!s || s.kind === "empty") {
        breakdown.emptyRow += 1;
        continue;
      }
      if (s.kind === "basic" || s.kind === "potion") {
        breakdown.notSkill += 1;
        continue;
      }
      if (s.kind !== "skill") {
        breakdown.notSkill += 1;
        continue;
      }
      if (!s.isAttack || !s.targetsEnemy) {
        breakdown.notAttack += 1;
        continue;
      }
      if (!plannerSkillHasDirectDamageForOpener(s)) {
        breakdown.noDirectDamage += 1;
        continue;
      }
      const mc = Number.isFinite(s.manaCost) ? s.manaCost : 0;
      if (mc > 0) {
        if (mpCur === null) {
          breakdown.mp += 1;
          continue;
        }
        if (mpCur < mc + reserve) {
          breakdown.mp += 1;
          continue;
        }
      }
      if (Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
        if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(idx)) {
          Logger.log("PLANNER", "Skipping ranked skill slot (live cooldown / blocked hint on action bar)", {
            slot: idx,
            name: s.name || ""
          });
          breakdown.cooldown += 1;
          continue;
        }
      }
      if (exclude.has(idx)) {
        breakdown.exclude += 1;
        continue;
      }
      candidates.push({ idx: idx, record: s });
    }

    if (candidates.length === 0) {
      pr.lastOpeningPickReason = "all_candidates_filtered";
      pr.lastOpeningPickDetail = {
        breakdown: breakdown,
        mpCur: mpCur,
        skillMpReserve: reserve,
        excludedCount: exclude.size
      };
      plannerMaybeLogOpeningPickFailure("all_candidates_filtered", pr.lastOpeningPickDetail);
      return null;
    }

    const useHorizon = Config.planner.useOpenerHorizonSim !== false;
    const horizonMs = Number.isFinite(Config.planner.openerHorizonSimMs) ? Config.planner.openerHorizonSimMs : 5000;
    const minFracRaw = Config.planner.openerHorizonMinImprovementFraction;
    const minFrac = Number.isFinite(minFracRaw) && minFracRaw >= 0 ? minFracRaw : 0.02;
    const paper = estimatePaperBasicAttackDps();
    if (useHorizon && horizonMs > 0 && paper && Number.isFinite(paper.dps) && paper.dps > 0) {
      const horizonSec = horizonMs / 1000;
      const baselineTotal = plannerOpenerHorizonBasicOnly(horizonSec);
      let bestIdx = null;
      let bestDmg = baselineTotal;
      const scored = [];
      // AI CHANGED: Conception-first opener — gate to top conception-priority candidates, then use horizon paper DPS as tie-breaker.
      let horizonCandidates = candidates;
      let conceptionGate = null;
      if (rank.rankMode === "conception") {
        const bySlot = new Map();
        if (rank && Array.isArray(rank.ranked)) {
          for (let ri = 0; ri < rank.ranked.length; ri += 1) {
            const rr = rank.ranked[ri];
            if (!rr || typeof rr.slot !== "number") {
              continue;
            }
            bySlot.set(rr.slot, rr);
          }
        }
        const scoredConc = [];
        for (let cc = 0; cc < candidates.length; cc += 1) {
          const cand = candidates[cc];
          const rr = bySlot.get(cand.idx);
          if (!rr || !Number.isFinite(rr.heuristicScore)) {
            continue;
          }
          scoredConc.push({ idx: cand.idx, score: rr.heuristicScore, rank: rr });
        }
        if (scoredConc.length > 1) {
          scoredConc.sort(function (a, b) { return b.score - a.score; });
          const bestConcScore = scoredConc[0].score;
          const conceptionGateDeltaRaw = Config.planner.conceptionOpenerGateDelta;
          const conceptionGateDelta =
            Number.isFinite(conceptionGateDeltaRaw) && conceptionGateDeltaRaw >= 0
              ? conceptionGateDeltaRaw
              : 1.5;
          const allowed = new Set();
          for (let ci = 0; ci < scoredConc.length; ci += 1) {
            const row = scoredConc[ci];
            if (bestConcScore - row.score <= conceptionGateDelta) {
              allowed.add(row.idx);
            }
          }
          const gated = [];
          for (let gc = 0; gc < candidates.length; gc += 1) {
            if (allowed.has(candidates[gc].idx)) {
              gated.push(candidates[gc]);
            }
          }
          if (gated.length > 0) {
            horizonCandidates = gated;
            conceptionGate = {
              bestScore: +bestConcScore.toFixed(3),
              delta: conceptionGateDelta,
              allowedSlots: gated.map(function (g) { return g.idx; }),
              ranked: scoredConc.map(function (r) { return { slot: r.idx, score: +r.score.toFixed(3) }; })
            };
          }
        }
      }
      for (let c = 0; c < horizonCandidates.length; c += 1) {
        const cand = horizonCandidates[c];
        const d = plannerOpenerHorizonSkillPlusBasics(cand.record, horizonSec, key);
        scored.push({ slot: cand.idx, name: cand.record.name || "", damage: +d.toFixed(2) });
        if (d > bestDmg) {
          bestDmg = d;
          bestIdx = cand.idx;
        }
      }
      pr.lastOpenerHorizonSim = {
        horizonMs: horizonMs,
        baselineDamage: +baselineTotal.toFixed(2),
        bestDamage: +bestDmg.toFixed(2),
        bestSlot: bestIdx,
        scored: scored,
        rankMode: rank.rankMode || null,
        conceptionGate: conceptionGate
      };
      if (Config.planner.openerHorizonLog) {
        Logger.log("PLANNER", "openerHorizonSim", pr.lastOpenerHorizonSim);
      }
      const threshold = baselineTotal * (1 + minFrac);
      if (bestIdx !== null && bestDmg > threshold) {
        let pickedPair = null;
        for (let p = 0; p < candidates.length; p += 1) {
          if (candidates[p].idx === bestIdx) {
            pickedPair = candidates[p];
            break;
          }
        }
        if (!pickedPair) {
          pickedPair = candidates[0];
        }
        pr.lastOpeningPickReason = "picked";
        pr.lastOpeningPickDetail = {
          slot: pickedPair.idx,
          name: pickedPair.record.name || "",
          horizonSim: pr.lastOpenerHorizonSim
        };
        return { slot: pickedPair.idx, record: pickedPair.record };
      }
      pr.lastOpeningPickReason = "horizon_prefers_basic";
      pr.lastOpeningPickDetail = {
        horizonSim: pr.lastOpenerHorizonSim,
        threshold: +threshold.toFixed(2),
        minImprovementFraction: minFrac
      };
      return null;
    }

    const first = candidates[0];
    pr.lastOpeningPickReason = "picked";
    pr.lastOpeningPickDetail = {
      slot: first.idx,
      name: first.record.name || "",
      heuristicFallback: true,
      note: useHorizon ? "horizonSim skipped (no paper DPS)" : "useOpenerHorizonSim off"
    };
    return { slot: first.idx, record: first.record };
  }

  // AI CHANGED: Phase C4 slice 8 — pick action-bar index for opening attack, or null to use basic-only path.
  function plannerPickSkillSlotToCast() {
    const p = plannerPickSkillOpeningPick(null);
    return p ? p.slot : null;
  }

  function getLastFoughtEnemyKey() {
    return Runtime.enemy.lastFoughtKey || null;
  }
