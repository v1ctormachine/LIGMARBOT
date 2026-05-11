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

  // AI CHANGED: Detect current class from profile icon (`icon-src-archer`) for per-class planner profile selection.
  function plannerDetectProfileClassKey() {
    const sel = Config.selectors && Config.selectors.heroProfileClassIcon
      ? Config.selectors.heroProfileClassIcon
      : "app-icon.profile-class";
    const node = document.querySelector(sel);
    if (!node) {
      return "";
    }
    const cls = (node.className || "").toString().toLowerCase();
    const m = cls.match(/\bicon-src-([a-z0-9_-]+)\b/);
    if (m && m[1]) {
      return m[1].trim();
    }
    return "";
  }

  // AI CHANGED: Apply per-class planner profile to live Config knobs (runtime-only, no storage writes).
  function plannerApplyClassProfile() {
    const map = Config.planner && Config.planner.classProfiles ? Config.planner.classProfiles : null;
    if (!map || typeof map !== "object") {
      Runtime.planner.activeClassProfile = null;
      return { ok: false, reason: "no_profiles" };
    }
    const classKey = plannerDetectProfileClassKey() || "default";
    const profile = map[classKey] || map.default || null;
    if (!profile || typeof profile !== "object") {
      Runtime.planner.activeClassProfile = null;
      return { ok: false, reason: "profile_missing", classKey: classKey };
    }
    const applied = {};
    function applyNum(key, min) {
      const v = profile[key];
      if (Number.isFinite(v) && (min === undefined || v >= min)) {
        Config.planner[key] = v;
        applied[key] = v;
      }
    }
    applyNum("skillMpReserve", 0);
    applyNum("openerHorizonMinImprovementFraction", 0);
    applyNum("openerExtraRankedSkills", 0);
    applyNum("conceptionOpenerGateDelta", 0);
    // AI CHANGED: Class profiles may tune multi-mob channel deprioritization.
    applyNum("conceptionMultiMobEnemyCountThreshold", 0);
    applyNum("conceptionChannelMultiMobPenalty", 0);
    const out = {
      ok: true,
      classKey: classKey,
      profileKey: map[classKey] ? classKey : "default",
      applied: applied
    };
    Runtime.planner.activeClassProfile = out;
    return out;
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
    const stRank = readBasicState();
    const enemyCountLive =
      stRank && stRank.combat && typeof stRank.combat.enemyCount === "number"
        ? stRank.combat.enemyCount
        : 0;
    const mobThreshRaw = Config.planner.conceptionMultiMobEnemyCountThreshold;
    const mobThresh = Number.isFinite(mobThreshRaw) && mobThreshRaw >= 0 ? mobThreshRaw : 1;
    const chanPenRaw = Config.planner.conceptionChannelMultiMobPenalty;
    const chanPen = Number.isFinite(chanPenRaw) && chanPenRaw >= 0 ? chanPenRaw : 28;
    const multiMobChannelActive = enemyCountLive > mobThresh;
    const ranked = [];
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind === "empty" || !s.isAttack || !s.targetsEnemy) {
        continue;
      }
      let eff;
      let concResolved = null;
      if (useConcRank) {
        concResolved = plannerResolveSlotConception(s);
        eff = plannerConceptionHeuristicScore(concResolved);
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
      // AI CHANGED: Multi-mob — channel skills are easy to interrupt or wasteful when other mobs are hitting; rank them lower unless solo context.
      if (multiMobChannelActive) {
        const isChannel = useConcRank
          ? !!(concResolved && concResolved.flags && concResolved.flags.channel)
          : Array.isArray(s.effects) && s.effects.some((x) => x && x.type === "channel_gear");
        if (isChannel) {
          score -= chanPen;
        }
      }
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
      multiMobChannel: {
        enemyCount: enemyCountLive,
        threshold: mobThresh,
        penalty: chanPen,
        active: multiMobChannelActive
      },
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

  function plannerAdjustedBasicDps(baseBasicDps, mobFactor) {
    const dps = Number.isFinite(baseBasicDps) ? baseBasicDps : 0;
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    return dps * mf;
  }

  // AI CHANGED: Charge skills are hold-then-release, not fire-and-forget; parse their timed release plan once so combat + planner use the same mechanic.
  function plannerGetChargeSkillEffect(slot) {
    if (!slot || !Array.isArray(slot.effects)) {
      return null;
    }
    for (let i = 0; i < slot.effects.length; i += 1) {
      const e = slot.effects[i];
      if (e && e.type === "channel_gear") {
        return e;
      }
    }
    return null;
  }

  function plannerClampChargeReleaseFraction(raw) {
    const frac = Number.isFinite(raw) ? raw : 1;
    if (frac <= 0) {
      return 0.01;
    }
    if (frac >= 1) {
      return 1;
    }
    return frac;
  }

  function plannerResolveChargeReleaseFraction(slot) {
    const byName =
      Config.combat &&
      Config.combat.chargeSkillReleaseFractionsByName &&
      typeof Config.combat.chargeSkillReleaseFractionsByName === "object"
        ? Config.combat.chargeSkillReleaseFractionsByName
        : null;
    const normalizedName = plannerNormalizeSkillNameForMatch(slot && slot.name ? slot.name : "");
    if (byName && normalizedName && Object.prototype.hasOwnProperty.call(byName, normalizedName)) {
      return {
        fraction: plannerClampChargeReleaseFraction(byName[normalizedName]),
        source: "chargeSkillReleaseFractionsByName." + normalizedName
      };
    }
    return {
      fraction: plannerClampChargeReleaseFraction(Config.combat.chargeSkillReleaseFraction),
      source: "chargeSkillReleaseFraction"
    };
  }

  function plannerBuildChargeReleasePlanFromMs(effect, maxMs, minHoldMs, releaseMs, releaseSource) {
    let finalReleaseMs = Number.isFinite(releaseMs) ? Math.round(releaseMs) : maxMs;
    if (!Number.isFinite(finalReleaseMs) || finalReleaseMs <= 0) {
      finalReleaseMs = maxMs;
    }
    finalReleaseMs = Math.max(minHoldMs, Math.min(maxMs, finalReleaseMs));
    const releaseFraction = +(finalReleaseMs / maxMs).toFixed(4);
    const gearPct = Number.isFinite(effect.gearDamagePercent) ? effect.gearDamagePercent : 0;
    return {
      channelMaxMs: maxMs,
      channelMaxSec: +(maxMs / 1000).toFixed(3),
      releaseMs: finalReleaseMs,
      releaseSec: +(finalReleaseMs / 1000).toFixed(3),
      releaseFraction: releaseFraction,
      releaseSource: releaseSource,
      strategy: finalReleaseMs >= maxMs ? "full_charge" : "cancel_release",
      gearDamagePercent: gearPct,
      expectedBasePlusGearMultiplier: +(1 + (gearPct / 100) * releaseFraction).toFixed(4),
      interruptible: effect.interruptible !== false
    };
  }

  function plannerBuildChargeReleasePlanFromFraction(effect, maxMs, minHoldMs, releaseFraction, releaseSource) {
    const frac = plannerClampChargeReleaseFraction(releaseFraction);
    return plannerBuildChargeReleasePlanFromMs(effect, maxMs, minHoldMs, Math.round(maxMs * frac), releaseSource);
  }

  function plannerCollectDynamicChargeReleaseFractions(slot) {
    const rows = [];
    const seen = new Set();
    function addFraction(raw, source) {
      if (!Number.isFinite(raw)) {
        return;
      }
      const frac = plannerClampChargeReleaseFraction(raw);
      const key = frac.toFixed(4);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      rows.push({ fraction: frac, source: source });
    }
    const dynamicList =
      Config.combat &&
      Array.isArray(Config.combat.chargeSkillDynamicCandidateFractions)
        ? Config.combat.chargeSkillDynamicCandidateFractions
        : null;
    if (dynamicList) {
      for (let i = 0; i < dynamicList.length; i += 1) {
        addFraction(dynamicList[i], "chargeSkillDynamicCandidateFractions[" + i + "]");
      }
    }
    const fallbackPick = plannerResolveChargeReleaseFraction(slot);
    if (fallbackPick && Number.isFinite(fallbackPick.fraction)) {
      addFraction(fallbackPick.fraction, fallbackPick.source);
    }
    if (rows.length === 0) {
      addFraction(1, "dynamic_default_full_charge");
    }
    rows.sort(function (a, b) { return a.fraction - b.fraction; });
    return rows;
  }

  // AI CHANGED: Cooldown-aware opener forecast — long cooldowns extending far beyond the simulated horizon pay a mild opportunity tax scaled by basic DPS.
  function plannerComputeCooldownForecastPenalty(slot, horizonSec, basicDps) {
    const out = {
      cooldownSec: null,
      excessSec: 0,
      penalty: 0,
      applied: false,
      reason: "disabled"
    };
    if (Config.planner && Config.planner.openerCooldownForecastEnabled === false) {
      return out;
    }
    const cooldownSec = slot && Number.isFinite(slot.cooldownSec) && slot.cooldownSec > 0 ? slot.cooldownSec : null;
    out.cooldownSec = Number.isFinite(cooldownSec) ? +cooldownSec.toFixed(3) : null;
    if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) {
      out.reason = "no_cooldown";
      return out;
    }
    const horizon = horizonSec > 0 ? horizonSec : 0;
    if (!(horizon > 0) || !(basicDps > 0)) {
      out.reason = "no_horizon_or_basic_dps";
      return out;
    }
    const graceSec =
      Config.planner && Number.isFinite(Config.planner.openerCooldownForecastGraceSec)
        ? Math.max(0, Config.planner.openerCooldownForecastGraceSec)
        : 1;
    const coeff =
      Config.planner && Number.isFinite(Config.planner.openerCooldownExcessPenaltyInBasicDps)
        ? Math.max(0, Config.planner.openerCooldownExcessPenaltyInBasicDps)
        : 0.03;
    const maxBaselineFrac =
      Config.planner && Number.isFinite(Config.planner.openerCooldownForecastMaxPenaltyAsBaselineFraction)
        ? Math.max(0, Config.planner.openerCooldownForecastMaxPenaltyAsBaselineFraction)
        : 0.2;
    const excessSec = Math.max(0, cooldownSec - horizon - graceSec);
    out.excessSec = +excessSec.toFixed(3);
    if (!(excessSec > 0) || !(coeff > 0)) {
      out.reason = excessSec > 0 ? "zero_coeff" : "cooldown_within_horizon";
      return out;
    }
    const rawPenalty = excessSec * basicDps * coeff;
    const penaltyCap = horizon * basicDps * maxBaselineFrac;
    out.penalty = +(Math.min(rawPenalty, penaltyCap)).toFixed(2);
    out.applied = out.penalty > 0;
    out.reason = out.applied ? "excess_cooldown_tax" : "penalty_zero_after_cap";
    return out;
  }

  function plannerScoreChargeReleaseCandidate(effect, chargePlan, horizonSec, mobFactor, expectedBasicHit, basicDps, liveState, scoreOpts) {
    const opts = scoreOpts && typeof scoreOpts === "object" ? scoreOpts : {};
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    const basePart = expectedBasicHit * mf;
    const releaseDamageRaw =
      horizonSec >= chargePlan.releaseSec
        ? basePart * chargePlan.expectedBasePlusGearMultiplier
        : 0;
    const targetHpCur =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.cur) &&
      liveState.combat.targetHp.cur > 0
        ? liveState.combat.targetHp.cur
        : null;
    const capOverkill = Config.planner && Config.planner.chargeSkillTargetOverkillCapEnabled !== false;
    const releaseDamage =
      capOverkill && Number.isFinite(targetHpCur)
        ? Math.min(releaseDamageRaw, targetHpCur)
        : releaseDamageRaw;
    const wastedOverkillDamage = Math.max(0, releaseDamageRaw - releaseDamage);
    const followUpBasicDamage = Math.max(0, horizonSec - chargePlan.releaseSec) * basicDps;
    const enemyCountLive =
      liveState &&
      liveState.combat &&
      typeof liveState.combat.enemyCount === "number"
        ? liveState.combat.enemyCount
        : 0;
    const extraEnemies = enemyCountLive > 1 ? enemyCountLive - 1 : 0;
    const extraEnemyPenaltyCoeff =
      Config.planner && Number.isFinite(Config.planner.chargeSkillHoldExtraEnemyPenaltyInBasicDps)
        ? Math.max(0, Config.planner.chargeSkillHoldExtraEnemyPenaltyInBasicDps)
        : 0.08;
    const multiMobHoldPenalty = chargePlan.releaseSec * basicDps * extraEnemyPenaltyCoeff * extraEnemies;
    const playerHpPct =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.pct)
        ? liveState.player.hp.pct
        : null;
    const lowHpThreshold =
      Config.planner && Number.isFinite(Config.planner.chargeSkillHoldLowHpThresholdPct)
        ? Math.min(1, Math.max(0, Config.planner.chargeSkillHoldLowHpThresholdPct))
        : 0.6;
    const lowHpPenaltyCoeff =
      Config.planner && Number.isFinite(Config.planner.chargeSkillHoldLowHpPenaltyInBasicDps)
        ? Math.max(0, Config.planner.chargeSkillHoldLowHpPenaltyInBasicDps)
        : 0.12;
    const lowHpRatio =
      Number.isFinite(playerHpPct) && lowHpThreshold > 0 && playerHpPct < lowHpThreshold
        ? (lowHpThreshold - playerHpPct) / lowHpThreshold
        : 0;
    const lowHpHoldPenalty = chargePlan.releaseSec * basicDps * lowHpPenaltyCoeff * lowHpRatio;
    const holdRiskPenalty = multiMobHoldPenalty + lowHpHoldPenalty;
    const followUpAction = plannerBestFollowUpActionValue(
      Math.max(0, horizonSec - chargePlan.releaseSec),
      opts.enemyKey || null,
      {
        paper: opts.paper || null,
        basicDps: basicDps,
        expectedBasicHit: expectedBasicHit,
        mobFactor: mf
      },
      {
        depth: opts.queueDepth,
        excludeSlot: opts.excludeSlot,
        mpAvailable: opts.mpAvailable
      }
    );
    const cooldownForecast = plannerComputeCooldownForecastPenalty(opts.slot || null, horizonSec, basicDps);
    const totalDamage = releaseDamage + followUpAction.value - holdRiskPenalty - cooldownForecast.penalty;
    return {
      horizonFit: horizonSec >= chargePlan.releaseSec,
      blockedSec: Math.min(horizonSec, chargePlan.releaseSec),
      releaseDamageRaw: +releaseDamageRaw.toFixed(2),
      releaseDamage: +releaseDamage.toFixed(2),
      wastedOverkillDamage: +wastedOverkillDamage.toFixed(2),
      followUpBasicDamage: +followUpBasicDamage.toFixed(2),
      followUpActionValue: +followUpAction.value.toFixed(2),
      followUpActionMode: followUpAction.mode,
      followUpActionSlot: followUpAction.slot,
      cooldownSec: cooldownForecast.cooldownSec,
      cooldownExcessSec: cooldownForecast.excessSec,
      cooldownOpportunityPenalty: cooldownForecast.penalty,
      holdRiskPenalty: +holdRiskPenalty.toFixed(2),
      multiMobHoldPenalty: +multiMobHoldPenalty.toFixed(2),
      lowHpHoldPenalty: +lowHpHoldPenalty.toFixed(2),
      enemyCountLive: enemyCountLive,
      playerHpPct: Number.isFinite(playerHpPct) ? +playerHpPct.toFixed(4) : null,
      targetHpCur: Number.isFinite(targetHpCur) ? +targetHpCur.toFixed(2) : null,
      horizonDamage: +totalDamage.toFixed(2)
    };
  }

  function plannerBestFollowUpActionValue(remainingHorizonSec, enemyKey, scoringCtx, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const basicDps = scoringCtx && Number.isFinite(scoringCtx.basicDps) ? scoringCtx.basicDps : 0;
    const basicOnly = Math.max(0, remainingHorizonSec) * basicDps;
    const depth =
      Number.isFinite(opts.depth)
        ? Math.max(0, Math.floor(opts.depth))
        : (
            Config.planner && Config.planner.openerFollowUpSkillQueueEnabled === false
              ? 0
              : (Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
                  ? Math.max(0, Math.floor(Config.planner.openerFollowUpSkillDepth))
                  : 1)
          );
    const best = {
      value: +basicOnly.toFixed(2),
      mode: "basic_only",
      slot: null
    };
    if (!(remainingHorizonSec > 0) || depth <= 0 || !Array.isArray(Runtime.skills.slots)) {
      return best;
    }
    const slots = Runtime.skills.slots;
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind !== "skill" || !s.isAttack || !s.targetsEnemy) {
        continue;
      }
      if (!plannerSkillHasDirectDamageForOpener(s)) {
        continue;
      }
      const slotIdx = typeof s.slot === "number" ? s.slot : i;
      if (Number.isFinite(opts.excludeSlot) && slotIdx === opts.excludeSlot) {
        continue;
      }
      if (Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
        if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(slotIdx)) {
          continue;
        }
      }
      const manaCost = Number.isFinite(s.manaCost) ? s.manaCost : 0;
      if (manaCost > 0) {
        if (!Number.isFinite(opts.mpAvailable) || opts.mpAvailable < manaCost) {
          continue;
        }
      }
      const nextMp =
        Number.isFinite(opts.mpAvailable)
          ? Math.max(0, opts.mpAvailable - manaCost)
          : null;
      const d = plannerOpenerHorizonSkillPlusBasics(s, remainingHorizonSec, enemyKey, {
        slot: s,
        paper: scoringCtx && scoringCtx.paper ? scoringCtx.paper : null,
        basicDps: basicDps,
        expectedBasicHit: scoringCtx && Number.isFinite(scoringCtx.expectedBasicHit) ? scoringCtx.expectedBasicHit : null,
        mobFactor: scoringCtx && Number.isFinite(scoringCtx.mobFactor) ? scoringCtx.mobFactor : null,
        liveState: null,
        queueDepth: depth - 1,
        mpAvailable: nextMp
      });
      if (d > best.value) {
        best.value = +d.toFixed(2);
        best.mode = "follow_up_skill";
        best.slot = slotIdx;
      }
    }
    return best;
  }

  function plannerBuildChargeReleasePlan(slot, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const effect = plannerGetChargeSkillEffect(slot);
    if (!effect) {
      return null;
    }
    const maxMs =
      Number.isFinite(effect.channelMaxSec) && effect.channelMaxSec > 0
        ? Math.round(effect.channelMaxSec * 1000)
        : null;
    if (!Number.isFinite(maxMs) || maxMs <= 0) {
      return null;
    }
    const minHoldRaw = Config.combat.chargeSkillReleaseMinHoldMs;
    const minHoldMs =
      Number.isFinite(minHoldRaw) && minHoldRaw >= 0
        ? Math.min(Math.round(minHoldRaw), maxMs)
        : 0;
    const legacyReleaseMsRaw = Config.combat.rankedOpenerEarlyCancelIfHintAfterMs;
    const hasLegacyReleaseMs = Number.isFinite(legacyReleaseMsRaw) && legacyReleaseMsRaw > 0;
    if (hasLegacyReleaseMs) {
      const manualPlan = plannerBuildChargeReleasePlanFromMs(
        effect,
        maxMs,
        minHoldMs,
        legacyReleaseMsRaw,
        "rankedOpenerEarlyCancelIfHintAfterMs"
      );
      manualPlan.selectionMode = "manual_ms_override";
      manualPlan.candidates = [
        Object.assign({}, manualPlan, {
          candidateSource: manualPlan.releaseSource,
          horizonDamage: null,
          releaseDamage: null,
          followUpBasicDamage: null,
          blockedSec: manualPlan.releaseSec,
          horizonFit: null
        })
      ];
      return manualPlan;
    }
    const fracPick = plannerResolveChargeReleaseFraction(slot);
    const dynamicEnabled = Config.combat && Config.combat.chargeSkillDynamicReleaseEnabled !== false;
    const horizonSecRaw =
      Number.isFinite(opts.horizonSec) && opts.horizonSec > 0
        ? opts.horizonSec
        : (
            Number.isFinite(Config.planner && Config.planner.openerHorizonSimMs)
              ? Config.planner.openerHorizonSimMs / 1000
              : 5
          );
    const horizonSec = horizonSecRaw > 0 ? horizonSecRaw : 5;
    const paper = opts.paper || estimatePaperBasicAttackDps();
    const mobFactor =
      Number.isFinite(opts.mobFactor)
        ? opts.mobFactor
        : plannerMobCalibrationFactorForKey(opts.enemyKey || null);
    const rawBasicDps =
      Number.isFinite(opts.basicDps)
        ? opts.basicDps
        : (paper && Number.isFinite(paper.dps) ? paper.dps : null);
    const basicDps = plannerAdjustedBasicDps(rawBasicDps, mobFactor);
    const expectedBasicHit =
      Number.isFinite(opts.expectedBasicHit)
        ? opts.expectedBasicHit
        : plannerExpectedBasicHitFromPaper(paper);
    const liveState = opts.liveState || null;
    const queueDepth =
      Number.isFinite(opts.queueDepth)
        ? Math.max(0, Math.floor(opts.queueDepth))
        : (
            Config.planner && Config.planner.openerFollowUpSkillQueueEnabled === false
              ? 0
              : (Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
                  ? Math.max(0, Math.floor(Config.planner.openerFollowUpSkillDepth))
                  : 1)
          );
    const mpAvailable =
      Number.isFinite(opts.mpAvailable)
        ? opts.mpAvailable
        : (
            liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid && Number.isFinite(liveState.player.mp.cur)
              ? liveState.player.mp.cur
              : null
          );
    if (dynamicEnabled && Number.isFinite(expectedBasicHit) && Number.isFinite(basicDps) && basicDps >= 0) {
      const candidateFractions = plannerCollectDynamicChargeReleaseFractions(slot);
      const scoredCandidates = [];
      for (let i = 0; i < candidateFractions.length; i += 1) {
        const cand = candidateFractions[i];
        const candPlan = plannerBuildChargeReleasePlanFromFraction(effect, maxMs, minHoldMs, cand.fraction, cand.source);
        const manaCost = Number.isFinite(slot && slot.manaCost) ? slot.manaCost : 0;
        const score = plannerScoreChargeReleaseCandidate(effect, candPlan, horizonSec, mobFactor, expectedBasicHit, basicDps, liveState, {
          slot: slot,
          enemyKey: opts.enemyKey || null,
          paper: paper,
          queueDepth: queueDepth,
          excludeSlot: typeof slot.slot === "number" ? slot.slot : null,
          mpAvailable: Number.isFinite(mpAvailable) ? Math.max(0, mpAvailable - manaCost) : null
        });
        scoredCandidates.push(Object.assign({}, candPlan, score, { candidateSource: cand.source }));
      }
      if (scoredCandidates.length > 0) {
        scoredCandidates.sort(function (a, b) {
          if (b.horizonDamage !== a.horizonDamage) {
            return b.horizonDamage - a.horizonDamage;
          }
          return a.releaseMs - b.releaseMs;
        });
        const best = Object.assign({}, scoredCandidates[0]);
        best.selectionMode = "dynamic_horizon_best_total";
        best.candidates = scoredCandidates;
        best.scoringContext = {
          horizonSec: +horizonSec.toFixed(3),
          mobFactor: +mobFactor.toFixed(4),
          basicDps: +basicDps.toFixed(2),
          expectedBasicHit: +expectedBasicHit.toFixed(2),
          enemyCountLive:
            liveState && liveState.combat && typeof liveState.combat.enemyCount === "number"
              ? liveState.combat.enemyCount
              : 0,
          playerHpPct:
            liveState && liveState.player && liveState.player.hp && liveState.player.hp.valid && Number.isFinite(liveState.player.hp.pct)
              ? +liveState.player.hp.pct.toFixed(4)
              : null,
          targetHpCur:
            liveState && liveState.combat && liveState.combat.targetHp && liveState.combat.targetHp.valid && Number.isFinite(liveState.combat.targetHp.cur)
              ? +liveState.combat.targetHp.cur.toFixed(2)
              : null
        };
        return best;
      }
    }
    const fallbackPlan = plannerBuildChargeReleasePlanFromFraction(effect, maxMs, minHoldMs, fracPick.fraction, fracPick.source);
    fallbackPlan.selectionMode = "configured_fraction_fallback";
    fallbackPlan.candidates = [
      Object.assign({}, fallbackPlan, {
        candidateSource: fracPick.source,
        horizonDamage: null,
        releaseDamage: null,
        followUpBasicDamage: null,
        blockedSec: fallbackPlan.releaseSec,
        horizonFit: null
      })
    ];
    return fallbackPlan;
  }

  // AI CHANGED: openerHorizonSim — rough skill damage over window from parsed effects (HP units, same scale as paper).
  function plannerSkillPaperDamageInHorizon(slot, horizonSec, mobFactor, expectedBasicHit, prebuiltChargePlan) {
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
        const chargePlan = prebuiltChargePlan || plannerBuildChargeReleasePlan(slot, { horizonSec: horizonSec, mobFactor: mf, expectedBasicHit: expectedBasicHit });
        const releaseSec =
          chargePlan && Number.isFinite(chargePlan.releaseSec) && chargePlan.releaseSec > 0
            ? chargePlan.releaseSec
            : (Number.isFinite(e.channelMaxSec) && e.channelMaxSec > 0 ? e.channelMaxSec : 0);
        if (releaseSec > 0 && horizonSec >= releaseSec) {
          const basePart = expectedBasicHit * mf;
          const mult =
            chargePlan && Number.isFinite(chargePlan.expectedBasePlusGearMultiplier)
              ? chargePlan.expectedBasePlusGearMultiplier
              : 1 + (Number.isFinite(e.gearDamagePercent) ? e.gearDamagePercent / 100 : 0);
          add += basePart * mult;
        }
      }
    }
    return add;
  }

  // AI CHANGED: openerHorizonSim — closed-form: cast blocks basics for castTime, then basics rest; skill lump from effects.
  function plannerOpenerHorizonSkillPlusBasics(slot, horizonSec, enemyKey, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const paper = opts.paper || estimatePaperBasicAttackDps();
    const mobFactor =
      Number.isFinite(opts.mobFactor)
        ? opts.mobFactor
        : plannerMobCalibrationFactorForKey(enemyKey);
    const rawBasicDps =
      Number.isFinite(opts.basicDps)
        ? opts.basicDps
        : (paper && Number.isFinite(paper.dps) ? paper.dps : 0);
    const basicDps = plannerAdjustedBasicDps(rawBasicDps, mobFactor);
    const expectedBasicHit =
      Number.isFinite(opts.expectedBasicHit)
        ? opts.expectedBasicHit
        : plannerExpectedBasicHitFromPaper(paper);
    const queueDepth =
      Number.isFinite(opts.queueDepth)
        ? Math.max(0, Math.floor(opts.queueDepth))
        : (
            Config.planner && Config.planner.openerFollowUpSkillQueueEnabled === false
              ? 0
              : (Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
                  ? Math.max(0, Math.floor(Config.planner.openerFollowUpSkillDepth))
                  : 1)
          );
    const mpAvailable =
      Number.isFinite(opts.mpAvailable)
        ? opts.mpAvailable
        : (
            opts.liveState &&
            opts.liveState.player &&
            opts.liveState.player.mp &&
            opts.liveState.player.mp.valid &&
            Number.isFinite(opts.liveState.player.mp.cur)
              ? opts.liveState.player.mp.cur
              : null
          );
    const chargePlan = plannerBuildChargeReleasePlan(slot, {
      horizonSec: horizonSec,
      enemyKey: enemyKey,
      paper: paper,
      basicDps: basicDps,
      expectedBasicHit: expectedBasicHit,
      mobFactor: mobFactor,
      liveState: opts.liveState || null,
      queueDepth: queueDepth,
      mpAvailable: mpAvailable
    });
    if (chargePlan && Number.isFinite(chargePlan.horizonDamage)) {
      return chargePlan.horizonDamage;
    }
    const castBlocked =
      chargePlan && Number.isFinite(chargePlan.releaseSec) && chargePlan.releaseSec > 0
        ? Math.min(horizonSec, chargePlan.releaseSec)
        : (Number.isFinite(slot.castTimeSec) && slot.castTimeSec > 0 ? Math.min(horizonSec, slot.castTimeSec) : 0);
    const skillPaperRaw = plannerSkillPaperDamageInHorizon(slot, horizonSec, mobFactor, expectedBasicHit, chargePlan);
    const liveTargetHp =
      opts.liveState &&
      opts.liveState.combat &&
      opts.liveState.combat.targetHp &&
      opts.liveState.combat.targetHp.valid &&
      Number.isFinite(opts.liveState.combat.targetHp.cur) &&
      opts.liveState.combat.targetHp.cur > 0
        ? opts.liveState.combat.targetHp.cur
        : null;
    const skillPaper =
      Config.planner && Config.planner.openerTargetHpAwareScoring !== false && Number.isFinite(liveTargetHp)
        ? Math.min(skillPaperRaw, liveTargetHp)
        : skillPaperRaw;
    const manaCost = Number.isFinite(slot && slot.manaCost) ? slot.manaCost : 0;
    const followUp = plannerBestFollowUpActionValue(
      Math.max(0, horizonSec - castBlocked),
      enemyKey,
      {
        paper: paper,
        basicDps: basicDps,
        expectedBasicHit: expectedBasicHit,
        mobFactor: mobFactor
      },
      {
        depth: queueDepth,
        excludeSlot: typeof slot.slot === "number" ? slot.slot : null,
        mpAvailable: Number.isFinite(mpAvailable) ? Math.max(0, mpAvailable - manaCost) : null
      }
    );
    const cooldownForecast = plannerComputeCooldownForecastPenalty(slot || opts.slot || null, horizonSec, basicDps);
    return skillPaper + followUp.value - cooldownForecast.penalty;
  }

  // AI CHANGED: Enemy-aware opener threshold tuning from calibration ratio.
  function plannerComputeEnemyAdaptiveMinFrac(baseMinFrac, enemyKey) {
    const out = {
      minFrac: baseMinFrac,
      baseMinFrac: baseMinFrac,
      applied: false,
      reason: "disabled_or_no_enemy_key",
      ratioObservedVsCurrentPaper: null
    };
    if (Config.planner.enemyAdaptiveOpenerThreshold === false) {
      return out;
    }
    if (!enemyKey || typeof enemyKey !== "string" || !enemyKey.trim()) {
      out.reason = "no_enemy_key";
      return out;
    }
    const row = getEnemyCalibrationRow(enemyKey.trim());
    const ratio = row && Number.isFinite(row.ratioObservedVsCurrentPaper)
      ? row.ratioObservedVsCurrentPaper
      : null;
    out.ratioObservedVsCurrentPaper = ratio;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      out.reason = "no_ratio";
      return out;
    }
    const low = Number.isFinite(Config.planner.enemyAdaptiveRatioLow) ? Config.planner.enemyAdaptiveRatioLow : 0.85;
    const high = Number.isFinite(Config.planner.enemyAdaptiveRatioHigh) ? Config.planner.enemyAdaptiveRatioHigh : 1.15;
    const step = Number.isFinite(Config.planner.enemyAdaptiveThresholdStep) ? Config.planner.enemyAdaptiveThresholdStep : 0.004;
    const allowRaiseWhenLow = Config.planner.enemyAdaptiveRaiseThresholdWhenRatioLow === true;
    if (ratio < low) {
      if (allowRaiseWhenLow) {
        out.minFrac = Math.min(0.08, baseMinFrac + step);
        out.applied = true;
        out.reason = "ratio_low_raise_threshold";
      } else {
        out.reason = "ratio_low_observed_no_raise";
      }
    } else if (ratio > high) {
      out.minFrac = Math.max(0.003, baseMinFrac - step);
      out.applied = true;
      out.reason = "ratio_high_lower_threshold";
    } else {
      out.reason = "ratio_in_band";
    }
    return out;
  }

  // AI CHANGED: Mild runtime aggression credit — when soak telemetry shows large opener headroom with low fallback/no-progress, lower the generic opener threshold a little.
  function plannerComputeRuntimeAggressiveMinFrac(baseMinFrac, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const out = {
      minFrac: baseMinFrac,
      baseMinFrac: baseMinFrac,
      applied: false,
      reason: "disabled",
      fallbackRate: null,
      noProgressRate: null,
      totalEvents: 0,
      lastBestSkillVsBaselinePct: null,
      thresholdPct: null,
      headroomPct: null
    };
    if (Config.planner.openerRuntimeAggressionEnabled === false) {
      return out;
    }
    const rt = opts.runtimeTelemetry || getPlannerRuntimeTelemetry();
    if (!rt || !rt.events) {
      out.reason = "no_runtime_telemetry";
      return out;
    }
    const total = Object.keys(rt.events).reduce(function (acc, key) {
      const n = rt.events[key];
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    out.totalEvents = total;
    const minEvents = Number.isFinite(Config.planner.openerRuntimeAggressionMinEvents)
      ? Math.max(1, Math.floor(Config.planner.openerRuntimeAggressionMinEvents))
      : 6;
    if (total < minEvents) {
      out.reason = "insufficient_runtime_events";
      return out;
    }
    const picks = Number.isFinite(rt.events.ranked_pick) ? rt.events.ranked_pick : 0;
    const noProgress = Number.isFinite(rt.events.ranked_no_progress) ? rt.events.ranked_no_progress : 0;
    const fallbacks = Number.isFinite(rt.events.basic_fallback_after_ranked) ? rt.events.basic_fallback_after_ranked : 0;
    const fallbackRate = picks > 0 ? fallbacks / picks : 0;
    const noProgressRate = picks > 0 ? noProgress / picks : 0;
    out.fallbackRate = +fallbackRate.toFixed(3);
    out.noProgressRate = +noProgressRate.toFixed(3);
    const detail = opts.lastDetail || (Runtime.planner && Runtime.planner.lastOpeningPickDetail ? Runtime.planner.lastOpeningPickDetail : null);
    const lastPct = detail && Number.isFinite(detail.bestSkillVsBaselinePct) ? detail.bestSkillVsBaselinePct : null;
    const thresholdPct = detail && Number.isFinite(detail.thresholdPct) ? detail.thresholdPct : +(baseMinFrac * 100).toFixed(2);
    out.lastBestSkillVsBaselinePct = lastPct;
    out.thresholdPct = thresholdPct;
    if (!Number.isFinite(lastPct)) {
      out.reason = "no_last_best_skill_pct";
      return out;
    }
    const headroomPct = lastPct - thresholdPct;
    out.headroomPct = +headroomPct.toFixed(2);
    const headroomReq = Number.isFinite(Config.planner.openerRuntimeAggressionHeadroomPct)
      ? Math.max(0, Config.planner.openerRuntimeAggressionHeadroomPct)
      : 8;
    if (!(headroomPct >= headroomReq)) {
      out.reason = "insufficient_headroom";
      return out;
    }
    const maxFallbackRate = Number.isFinite(Config.planner.openerRuntimeAggressionMaxFallbackRate)
      ? Math.max(0, Config.planner.openerRuntimeAggressionMaxFallbackRate)
      : 0.15;
    if (fallbackRate > maxFallbackRate) {
      out.reason = "fallback_rate_too_high";
      return out;
    }
    const maxNoProgressRate = Number.isFinite(Config.planner.openerRuntimeAggressionMaxNoProgressRate)
      ? Math.max(0, Config.planner.openerRuntimeAggressionMaxNoProgressRate)
      : 0.15;
    if (noProgressRate > maxNoProgressRate) {
      out.reason = "no_progress_rate_too_high";
      return out;
    }
    const step = Number.isFinite(Config.planner.openerRuntimeAggressionStep)
      ? Math.max(0, Config.planner.openerRuntimeAggressionStep)
      : 0.003;
    const floor = Number.isFinite(Config.planner.openerRuntimeAggressionMinFraction)
      ? Math.max(0, Config.planner.openerRuntimeAggressionMinFraction)
      : 0.005;
    if (!(step > 0)) {
      out.reason = "bad_step";
      return out;
    }
    out.minFrac = Math.max(floor, baseMinFrac - step);
    out.applied = out.minFrac < baseMinFrac;
    out.reason = out.applied ? "runtime_headroom_lower_threshold" : "runtime_floor_reached";
    return out;
  }

  function plannerResolveCandidateMinImprovementFraction(slotRec, defaultMinFrac, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const byName =
      Config.planner &&
      Config.planner.openerMinImprovementFractionByName &&
      typeof Config.planner.openerMinImprovementFractionByName === "object"
        ? Config.planner.openerMinImprovementFractionByName
        : null;
    const normalizedName = plannerNormalizeSkillNameForMatch(slotRec && slotRec.name ? slotRec.name : "");
    if (byName && normalizedName && Object.prototype.hasOwnProperty.call(byName, normalizedName)) {
      const raw = byName[normalizedName];
      if (Number.isFinite(raw) && raw >= 0) {
        return {
          minFrac: raw,
          source: "openerMinImprovementFractionByName." + normalizedName
        };
      }
    }
    return {
      minFrac: defaultMinFrac,
      source:
        typeof opts.defaultSource === "string" && opts.defaultSource
          ? opts.defaultSource
          : "enemy_adaptive_or_global"
    };
  }

  function plannerOpenerHorizonBasicOnly(horizonSec, enemyKey, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const paper = opts.paper || estimatePaperBasicAttackDps();
    const rawBasicDps = paper && Number.isFinite(paper.dps) ? paper.dps : 0;
    const mobFactor =
      Number.isFinite(opts.mobFactor)
        ? opts.mobFactor
        : plannerMobCalibrationFactorForKey(enemyKey || null);
    const basicDps = plannerAdjustedBasicDps(rawBasicDps, mobFactor);
    return basicDps * horizonSec;
  }

  // AI CHANGED: Shrink the effective opener window against nearly-dead targets so long opener plans are compared over a more realistic fight length.
  function plannerResolveEffectiveOpenerHorizon(requestedHorizonSec, enemyKey, paper, liveState) {
    const requestedSec = requestedHorizonSec > 0 ? requestedHorizonSec : 5;
    const out = {
      requestedHorizonSec: +requestedSec.toFixed(3),
      requestedHorizonMs: Math.round(requestedSec * 1000),
      effectiveHorizonSec: +requestedSec.toFixed(3),
      effectiveHorizonMs: Math.round(requestedSec * 1000),
      applied: false,
      reason: "disabled",
      targetHpCur: null,
      adjustedBasicDps: null,
      targetTtkSec: null,
      paddingMs: null,
      minHorizonMs: null
    };
    if (Config.planner && Config.planner.openerTargetTtkAwareHorizonEnabled === false) {
      return out;
    }
    const targetHpCur =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.cur) &&
      liveState.combat.targetHp.cur > 0
        ? liveState.combat.targetHp.cur
        : null;
    out.targetHpCur = Number.isFinite(targetHpCur) ? +targetHpCur.toFixed(2) : null;
    if (!Number.isFinite(targetHpCur) || targetHpCur <= 0) {
      out.reason = "no_live_target_hp";
      return out;
    }
    const baseDps = paper && Number.isFinite(paper.dps) && paper.dps > 0 ? paper.dps : null;
    if (!Number.isFinite(baseDps) || baseDps <= 0) {
      out.reason = "no_basic_dps";
      return out;
    }
    const mobFactor = plannerMobCalibrationFactorForKey(enemyKey);
    const adjustedBasicDps = plannerAdjustedBasicDps(baseDps, mobFactor);
    out.adjustedBasicDps = +adjustedBasicDps.toFixed(2);
    if (!(adjustedBasicDps > 0)) {
      out.reason = "bad_adjusted_basic_dps";
      return out;
    }
    const targetTtkSec = targetHpCur / adjustedBasicDps;
    out.targetTtkSec = +targetTtkSec.toFixed(3);
    const paddingMs =
      Config.planner && Number.isFinite(Config.planner.openerTargetTtkPaddingMs)
        ? Math.max(0, Math.round(Config.planner.openerTargetTtkPaddingMs))
        : 500;
    const minHorizonMs =
      Config.planner && Number.isFinite(Config.planner.openerTargetTtkMinMs)
        ? Math.max(250, Math.round(Config.planner.openerTargetTtkMinMs))
        : 1800;
    out.paddingMs = paddingMs;
    out.minHorizonMs = minHorizonMs;
    const candidateMs = Math.max(minHorizonMs, Math.round(targetTtkSec * 1000) + paddingMs);
    const effectiveMs = Math.min(out.requestedHorizonMs, candidateMs);
    out.effectiveHorizonMs = effectiveMs;
    out.effectiveHorizonSec = +(effectiveMs / 1000).toFixed(3);
    if (effectiveMs < out.requestedHorizonMs) {
      out.applied = true;
      out.reason = "shrunk_to_target_ttk";
    } else {
      out.reason = "target_ttk_longer_than_requested";
    }
    return out;
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
    const rank = key ? rankAttackSkillsByHeuristic({ enemyKey: key }) : rankAttackSkillsByHeuristic({});
    const slots = Runtime.skills.slots || [];
    const liveState = readBasicState();
    const paper = estimatePaperBasicAttackDps();
    const horizonCtx = plannerResolveEffectiveOpenerHorizon(Math.max(0.001, horizonMs / 1000), key, paper, liveState);
    const horizonSec = horizonCtx.effectiveHorizonSec > 0 ? horizonCtx.effectiveHorizonSec : Math.max(0.001, horizonMs / 1000);
    const previewMobFactor = plannerMobCalibrationFactorForKey(key);
    const baseline = plannerOpenerHorizonBasicOnly(horizonSec, key, {
      paper: paper,
      mobFactor: previewMobFactor
    });
    const minFracRaw = Config.planner.openerHorizonMinImprovementFraction;
    const minFracBase = Number.isFinite(minFracRaw) && minFracRaw >= 0 ? minFracRaw : 0.02;
    const enemyAdaptive = plannerComputeEnemyAdaptiveMinFrac(minFracBase, key || null);
    const enemyAdaptiveMinFrac = enemyAdaptive && Number.isFinite(enemyAdaptive.minFrac) ? enemyAdaptive.minFrac : minFracBase;
    const runtimeAggression = plannerComputeRuntimeAggressiveMinFrac(enemyAdaptiveMinFrac);
    const previewMinFrac = runtimeAggression && Number.isFinite(runtimeAggression.minFrac) ? runtimeAggression.minFrac : enemyAdaptiveMinFrac;
    const previewMinFracSource =
      runtimeAggression && runtimeAggression.applied
        ? (
            enemyAdaptive && enemyAdaptive.applied
              ? "enemy_adaptive_then_runtime_headroom"
              : "runtime_headroom_credit"
          )
        : "enemy_adaptive_or_global";
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
        const d = plannerOpenerHorizonSkillPlusBasics(s, horizonSec, key, {
          liveState: liveState,
          mpAvailable:
            liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid && Number.isFinite(liveState.player.mp.cur)
              ? liveState.player.mp.cur
              : null
        });
        const candMin = plannerResolveCandidateMinImprovementFraction(s, previewMinFrac, { defaultSource: previewMinFracSource });
        const candThreshold = baseline * (1 + candMin.minFrac);
        const cooldownForecast = plannerComputeCooldownForecastPenalty(s, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, previewMobFactor));
        const chargePlan = plannerBuildChargeReleasePlan(s, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: liveState,
          mpAvailable:
            liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid && Number.isFinite(liveState.player.mp.cur)
              ? liveState.player.mp.cur
              : null
        });
        rows.push({
          slot: idx,
          name: s.name || "",
          horizonDamage: +d.toFixed(2),
          vsBaseline: +((d / baseline - 1) * 100).toFixed(2) + "%",
          threshold: +candThreshold.toFixed(2),
          thresholdPct: +(candMin.minFrac * 100).toFixed(2),
          thresholdSource: candMin.source,
          passesThreshold: d > candThreshold,
          cooldownSec: cooldownForecast.cooldownSec,
          cooldownExcessSec: cooldownForecast.excessSec,
          cooldownOpportunityPenalty: cooldownForecast.penalty,
          chargeReleaseMs: chargePlan ? chargePlan.releaseMs : null,
          chargeReleaseFraction: chargePlan ? chargePlan.releaseFraction : null,
          chargeReleaseSelectionMode: chargePlan ? chargePlan.selectionMode || null : null,
          chargeReleaseCandidateCount: chargePlan && Array.isArray(chargePlan.candidates) ? chargePlan.candidates.length : 0
        });
      }
    }
    return {
      ok: true,
      enemyKey: key,
      horizonMs: horizonCtx.effectiveHorizonMs,
      requestedHorizonMs: horizonCtx.requestedHorizonMs,
      baselineDamage: +baseline.toFixed(2),
      mobFactorApplied: +previewMobFactor.toFixed(4),
      ttkContext: horizonCtx,
      enemyAdaptive: enemyAdaptive,
      runtimeAggression: runtimeAggression,
      candidates: rows,
      note: "Paper + effect parse with enemy-calibrated basics and live target-TTK horizon shrink when target HP is available. Disable with Config.planner.useOpenerHorizonSim = false."
    };
  }

  // AI CHANGED: Diagnostics-only threshold hint from live ranked runtime telemetry + latest horizon decision detail.
  function plannerBuildRankedTuningHint() {
    if (Config.planner.autoTuneHints === false) {
      return { skipped: true, reason: "auto_tune_hints_off" };
    }
    const rt = getPlannerRuntimeTelemetry();
    if (!rt || !rt.events) {
      return { skipped: true, reason: "no_runtime_telemetry" };
    }
    const picks = Number.isFinite(rt.events.ranked_pick) ? rt.events.ranked_pick : 0;
    const noProgress = Number.isFinite(rt.events.ranked_no_progress) ? rt.events.ranked_no_progress : 0;
    const fallbacks = Number.isFinite(rt.events.basic_fallback_after_ranked) ? rt.events.basic_fallback_after_ranked : 0;
    // AI CHANGED: Count full ranked-runtime signal (not only 3 counters) to reduce false "insufficient_runtime_events" skips after successful soak.
    const total = Object.keys(rt.events).reduce(function (acc, key) {
      const n = rt.events[key];
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    if (total < 5) {
      return { skipped: true, reason: "insufficient_runtime_events", totalEvents: total };
    }
    const current = Number.isFinite(Config.planner.openerHorizonMinImprovementFraction)
      ? Config.planner.openerHorizonMinImprovementFraction
      : 0.02;
    const fallbackRate = picks > 0 ? fallbacks / picks : 0;
    const noProgressRate = picks > 0 ? noProgress / picks : 0;
    const detail = Runtime.planner && Runtime.planner.lastOpeningPickDetail ? Runtime.planner.lastOpeningPickDetail : null;
    const runtimeAggression = plannerComputeRuntimeAggressiveMinFrac(current, {
      runtimeTelemetry: rt,
      lastDetail: detail
    });
    const lastPct = detail && Number.isFinite(detail.bestSkillVsBaselinePct) ? detail.bestSkillVsBaselinePct : null;
    const thresholdPct = detail && Number.isFinite(detail.thresholdPct) ? detail.thresholdPct : +(current * 100).toFixed(2);
    let suggest = current;
    let reason = "stable";
    if (fallbackRate > 0.35 || noProgressRate > 0.35) {
      suggest = Math.min(0.08, current + 0.005);
      reason = "too_many_ranked_fallbacks";
    } else if (lastPct !== null && lastPct > thresholdPct + 8 && fallbackRate < 0.15) {
      suggest = Math.max(0.005, current - 0.003);
      reason = "headroom_for_more_aggressive_skill_openers";
    }
    return {
      ok: true,
      reason: reason,
      currentMinImprovementFraction: +current.toFixed(4),
      suggestedMinImprovementFraction: +suggest.toFixed(4),
      fallbackRate: +fallbackRate.toFixed(3),
      noProgressRate: +noProgressRate.toFixed(3),
      totalEvents: total,
      lastBestSkillVsBaselinePct: lastPct,
      runtimeAggressionApplied: !!(runtimeAggression && runtimeAggression.applied),
      runtimeAggressionReason: runtimeAggression && runtimeAggression.reason ? runtimeAggression.reason : null,
      runtimeAggressionMinImprovementFraction: runtimeAggression && Number.isFinite(runtimeAggression.minFrac)
        ? +runtimeAggression.minFrac.toFixed(4)
        : null,
      runtimeAggressionHeadroomPct: runtimeAggression && Number.isFinite(runtimeAggression.headroomPct)
        ? runtimeAggression.headroomPct
        : null
    };
  }

  // AI CHANGED: Pack A — read-only snapshot for console after a fight / when debugging openers.
  function getPlannerOpeningPickDiagnostics() {
    const classProfile = plannerApplyClassProfile();
    const pr = Runtime.planner;
    const slots = Runtime.skills.slots || [];
    const rankSnap = rankAttackSkillsByHeuristic({});
    const rankedBurstsPerFindEffective =
      Number.isFinite(Config.planner.rankedBurstsPerFind) && Config.planner.rankedBurstsPerFind >= 0
        ? Math.floor(Config.planner.rankedBurstsPerFind)
        : (Config.planner.useRankedSkillOnlyFirstBurstAfterFind ? 1 : Number.MAX_SAFE_INTEGER);
    return {
      rankedCombatEnabled: !!Config.planner.useRankedAttackSkillsInCombat,
      lastReason: pr.lastOpeningPickReason,
      lastDetail: pr.lastOpeningPickDetail,
      lastAt: pr.lastOpeningPickAt,
      cacheSlotCount: Array.isArray(slots) ? slots.length : 0,
      attackSkillsRanked: rankSnap.order.length,
      multiMobChannelRank: rankSnap.multiMobChannel || null,
      lastOpenerHorizonSim: pr.lastOpenerHorizonSim || null,
      openerRuntime: pr.openerRuntime || null,
      tuningHint: plannerBuildRankedTuningHint(),
      runtimeAggression: pr.lastRuntimeAggressionThreshold || null,
      classProfile: classProfile,
      enemyAdaptive: pr.lastEnemyAdaptiveThreshold || null,
      rankedBurstsPerFindEffective: rankedBurstsPerFindEffective,
      forcedOpenerSkillName: pr.forcedOpenerSkillName || null,
      forcedOpenerReason: pr.forcedOpenerReason || null
    };
  }

  // AI CHANGED: Runtime telemetry snapshot/reset helpers for ranked-opener soak validation.
  function getPlannerRuntimeTelemetry() {
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    if (!pr || !pr.openerRuntime) {
      return null;
    }
    const rt = pr.openerRuntime;
    return {
      events: Object.assign({}, rt.events || {}),
      lastEvent: rt.lastEvent || null,
      lastAt: rt.lastAt || null,
      recent: Array.isArray(rt.recent) ? rt.recent.slice() : []
    };
  }

  function resetPlannerRuntimeTelemetry() {
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    if (!pr || !pr.openerRuntime) {
      return { ok: false, reason: "no_runtime_telemetry" };
    }
    pr.openerRuntime.events = {
      ranked_pick: 0,
      ranked_pick_none: 0,
      ranked_click_failed: 0,
      ranked_progress: 0,
      ranked_no_progress: 0,
      ranked_alt_pick: 0,
      basic_fallback_after_ranked: 0
    };
    pr.openerRuntime.lastEvent = null;
    pr.openerRuntime.lastAt = null;
    pr.openerRuntime.recent = [];
    return { ok: true, telemetry: getPlannerRuntimeTelemetry() };
  }

  // AI CHANGED: TEST/debug force path matches normalized names so ranker can target "Sniper Shot" regardless of tooltip level suffix.
  function plannerNormalizeSkillNameForMatch(rawName) {
    if (typeof normalizeSkillName === "function") {
      return normalizeSkillName(rawName || "").toLowerCase();
    }
    return String(rawName || "").trim().toLowerCase();
  }

  function plannerBuildForcedOpenerRequest(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const optName = typeof opts.forceSkillName === "string" ? opts.forceSkillName.trim() : "";
    if (optName) {
      return { name: optName, source: "opts.forceSkillName" };
    }
    const rtName =
      Runtime && Runtime.planner && typeof Runtime.planner.forcedOpenerSkillName === "string"
        ? Runtime.planner.forcedOpenerSkillName.trim()
        : "";
    if (rtName) {
      return {
        name: rtName,
        source:
          Runtime && Runtime.planner && typeof Runtime.planner.forcedOpenerReason === "string" && Runtime.planner.forcedOpenerReason
            ? Runtime.planner.forcedOpenerReason
            : "runtime"
      };
    }
    return null;
  }

  function plannerPickForcedOpenerCandidate(slots, exclude, forcedReq, mpCur, reserve) {
    if (!forcedReq || !forcedReq.name) {
      return null;
    }
    const wanted = plannerNormalizeSkillNameForMatch(forcedReq.name);
    if (!wanted) {
      return null;
    }
    let idx = -1;
    let row = null;
    if (Array.isArray(slots)) {
      for (let i = 0; i < slots.length; i += 1) {
        const cand = slots[i];
        if (!cand || cand.kind !== "skill") {
          continue;
        }
        if (plannerNormalizeSkillNameForMatch(cand.name) === wanted) {
          idx = i;
          row = cand;
          break;
        }
      }
    }
    if (!row || idx < 0) {
      return {
        matched: null,
        detail: {
          requestedName: forcedReq.name,
          matchedName: null,
          slot: null,
          source: forcedReq.source,
          forced: true,
          presentOnBar: false,
          reason: "not_found_on_bar"
        }
      };
    }
    if (!row.isAttack || !row.targetsEnemy) {
      return {
        matched: null,
        detail: {
          requestedName: forcedReq.name,
          matchedName: row.name || "",
          slot: idx,
          source: forcedReq.source,
          forced: true,
          presentOnBar: true,
          reason: "not_attack_skill"
        }
      };
    }
    if (!plannerSkillHasDirectDamageForOpener(row)) {
      return {
        matched: null,
        detail: {
          requestedName: forcedReq.name,
          matchedName: row.name || "",
          slot: idx,
          source: forcedReq.source,
          forced: true,
          presentOnBar: true,
          reason: "no_direct_damage"
        }
      };
    }
    const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
    if (manaCost > 0) {
      if (mpCur === null) {
        return {
          matched: null,
          detail: {
            requestedName: forcedReq.name,
            matchedName: row.name || "",
            slot: idx,
            source: forcedReq.source,
            forced: true,
            presentOnBar: true,
            reason: "mp_unread"
          }
        };
      }
      if (mpCur < manaCost + reserve) {
        return {
          matched: null,
          detail: {
            requestedName: forcedReq.name,
            matchedName: row.name || "",
            slot: idx,
            source: forcedReq.source,
            forced: true,
            presentOnBar: true,
            reason: "mp_gate",
            mpCur: mpCur,
            manaCost: manaCost,
            reserve: reserve
          }
        };
      }
    }
    if (Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(idx)) {
        Logger.log("PLANNER", "Skipping ranked skill slot (live cooldown / blocked hint on action bar)", {
          slot: idx,
          name: row.name || ""
        });
        return {
          matched: null,
          detail: {
            requestedName: forcedReq.name,
            matchedName: row.name || "",
            slot: idx,
            source: forcedReq.source,
            forced: true,
            presentOnBar: true,
            reason: "cooldown_or_blocked_hint"
          }
        };
      }
    }
    if (exclude && exclude.has && exclude.has(idx)) {
      return {
        matched: null,
        detail: {
          requestedName: forcedReq.name,
          matchedName: row.name || "",
          slot: idx,
          source: forcedReq.source,
          forced: true,
          presentOnBar: true,
          reason: "excluded"
        }
      };
    }
    return {
      matched: { idx: idx, record: row },
      detail: {
        requestedName: forcedReq.name,
        matchedName: row.name || "",
        slot: idx,
        source: forcedReq.source,
        forced: true
      }
    };
  }

  // AI CHANGED: Phase C4 slice 8+12+15 — pick opener with optional horizonSim (paper damage window); else first feasible heuristic order.
  function plannerPickSkillOpeningPick(userOpts) {
    plannerApplyClassProfile();
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
    pr.lastRuntimeAggressionThreshold = null;
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

    const forcedReq = plannerBuildForcedOpenerRequest(opts);
    if (forcedReq) {
      const forcedPick = plannerPickForcedOpenerCandidate(slots, exclude, forcedReq, mpCur, reserve);
      if (forcedPick && forcedPick.matched) {
        pr.lastOpeningPickReason = "forced_for_test";
        pr.lastOpeningPickDetail = forcedPick.detail;
        return { slot: forcedPick.matched.idx, record: forcedPick.matched.record };
      }
      if (forcedPick && forcedPick.detail) {
        pr.lastOpeningPickDetail = {
          forcedOpenerSkipped: forcedPick.detail,
          breakdown: breakdown,
          mpCur: mpCur,
          skillMpReserve: reserve
        };
      }
    }

    const useHorizon = Config.planner.useOpenerHorizonSim !== false;
    const horizonMs = Number.isFinite(Config.planner.openerHorizonSimMs) ? Config.planner.openerHorizonSimMs : 5000;
    const minFracRaw = Config.planner.openerHorizonMinImprovementFraction;
    const minFracBase = Number.isFinite(minFracRaw) && minFracRaw >= 0 ? minFracRaw : 0.02;
    const enemyAdaptive = plannerComputeEnemyAdaptiveMinFrac(minFracBase, key || null);
    const enemyAdaptiveMinFrac = enemyAdaptive && Number.isFinite(enemyAdaptive.minFrac) ? enemyAdaptive.minFrac : minFracBase;
    const runtimeAggression = plannerComputeRuntimeAggressiveMinFrac(enemyAdaptiveMinFrac);
    const minFrac = runtimeAggression && Number.isFinite(runtimeAggression.minFrac) ? runtimeAggression.minFrac : enemyAdaptiveMinFrac;
    const minFracSource =
      runtimeAggression && runtimeAggression.applied
        ? (
            enemyAdaptive && enemyAdaptive.applied
              ? "enemy_adaptive_then_runtime_headroom"
              : "runtime_headroom_credit"
          )
        : "enemy_adaptive_or_global";
    pr.lastEnemyAdaptiveThreshold = enemyAdaptive;
    pr.lastRuntimeAggressionThreshold = runtimeAggression;
    const paper = estimatePaperBasicAttackDps();
    const expectedBasicHit = plannerExpectedBasicHitFromPaper(paper);
    const horizonMobFactor = plannerMobCalibrationFactorForKey(key);
    if (useHorizon && horizonMs > 0 && paper && Number.isFinite(paper.dps) && paper.dps > 0) {
      const horizonCtx = plannerResolveEffectiveOpenerHorizon(horizonMs / 1000, key, paper, st);
      const horizonSec = horizonCtx.effectiveHorizonSec > 0 ? horizonCtx.effectiveHorizonSec : (horizonMs / 1000);
      const baselineTotal = plannerOpenerHorizonBasicOnly(horizonSec, key, {
        paper: paper,
        mobFactor: horizonMobFactor
      });
      let bestIdx = null;
      let bestDmg = baselineTotal;
      let bestPassingIdx = null;
      let bestPassingDmg = baselineTotal;
      let bestPassingMin = null;
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
          const candMin = plannerResolveCandidateMinImprovementFraction(cand.record, minFrac, { defaultSource: minFracSource });
          const policyOverride =
            candMin && candMin.source && candMin.source !== "enemy_adaptive_or_global"
              ? candMin
              : null;
          scoredConc.push({
            idx: cand.idx,
            score: rr.heuristicScore,
            rank: rr,
            policyOverride: policyOverride
          });
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
            if (bestConcScore - row.score <= conceptionGateDelta || row.policyOverride) {
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
              policyIncluded: scoredConc
                .filter(function (r) { return !!r.policyOverride; })
                .map(function (r) {
                  return {
                    slot: r.idx,
                    score: +r.score.toFixed(3),
                    thresholdPct: +(r.policyOverride.minFrac * 100).toFixed(2),
                    thresholdSource: r.policyOverride.source
                  };
                }),
              ranked: scoredConc.map(function (r) {
                return {
                  slot: r.idx,
                  score: +r.score.toFixed(3),
                  policyOverrideSource: r.policyOverride ? r.policyOverride.source : null
                };
              })
            };
          }
        }
      }
      for (let c = 0; c < horizonCandidates.length; c += 1) {
        const cand = horizonCandidates[c];
        const d = plannerOpenerHorizonSkillPlusBasics(cand.record, horizonSec, key, {
          liveState: st,
          paper: paper,
          mobFactor: horizonMobFactor,
          expectedBasicHit: expectedBasicHit,
          mpAvailable: mpCur
        });
        const candMin = plannerResolveCandidateMinImprovementFraction(cand.record, minFrac, { defaultSource: minFracSource });
        const candThreshold = baselineTotal * (1 + candMin.minFrac);
        const cooldownForecast = plannerComputeCooldownForecastPenalty(cand.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const passesThreshold = d > candThreshold;
        scored.push({
          slot: cand.idx,
          name: cand.record.name || "",
          damage: +d.toFixed(2),
          threshold: +candThreshold.toFixed(2),
          thresholdPct: +(candMin.minFrac * 100).toFixed(2),
          thresholdSource: candMin.source,
          cooldownSec: cooldownForecast.cooldownSec,
          cooldownExcessSec: cooldownForecast.excessSec,
          cooldownOpportunityPenalty: cooldownForecast.penalty,
          passesThreshold: passesThreshold
        });
        if (passesThreshold && d > bestPassingDmg) {
          bestPassingDmg = d;
          bestPassingIdx = cand.idx;
          bestPassingMin = candMin;
        }
        if (d > bestDmg) {
          bestDmg = d;
          bestIdx = cand.idx;
        }
      }
      const bestPair = bestIdx !== null
        ? candidates.find(function (cand) { return cand && cand.idx === bestIdx; }) || null
        : null;
      const bestMin = plannerResolveCandidateMinImprovementFraction(bestPair ? bestPair.record : null, minFrac, { defaultSource: minFracSource });
      const bestPassingPair = bestPassingIdx !== null
        ? candidates.find(function (cand) { return cand && cand.idx === bestPassingIdx; }) || null
        : null;
      pr.lastOpenerHorizonSim = {
        horizonMs: horizonCtx.effectiveHorizonMs,
        requestedHorizonMs: horizonCtx.requestedHorizonMs,
        baselineDamage: +baselineTotal.toFixed(2),
        mobFactorApplied: +horizonMobFactor.toFixed(4),
        bestDamage: +bestDmg.toFixed(2),
        bestSlot: bestIdx,
        bestThresholdPct: +(bestMin.minFrac * 100).toFixed(2),
        bestThresholdSource: bestMin.source,
        bestPassingDamage: bestPassingIdx !== null ? +bestPassingDmg.toFixed(2) : null,
        bestPassingSlot: bestPassingIdx,
        bestPassingThresholdPct: bestPassingMin ? +(bestPassingMin.minFrac * 100).toFixed(2) : null,
        bestPassingThresholdSource: bestPassingMin ? bestPassingMin.source : null,
        decisionMode: bestPassingIdx !== null ? "candidate_passed_own_threshold" : "basic_fallback_no_candidate_passed",
        ttkContext: horizonCtx,
        runtimeAggression: runtimeAggression,
        scored: scored,
        rankMode: rank.rankMode || null,
        conceptionGate: conceptionGate
      };
      if (Config.planner.openerHorizonLog) {
        Logger.log("PLANNER", "openerHorizonSim", pr.lastOpenerHorizonSim);
      }
      if (bestPassingIdx !== null && bestPassingPair) {
        pr.lastOpeningPickReason = "picked";
        const bestVsBaselinePct =
          baselineTotal > 0 ? +(((bestPassingDmg / baselineTotal) - 1) * 100).toFixed(2) : null;
        const thresholdPct = +(bestPassingMin.minFrac * 100).toFixed(2);
        const pickedCooldownForecast = plannerComputeCooldownForecastPenalty(bestPassingPair.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const pickedChargePlan = plannerBuildChargeReleasePlan(bestPassingPair.record, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: st,
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
          expectedBasicHit: expectedBasicHit,
          mobFactor: horizonMobFactor,
          mpAvailable: mpCur
        });
        pr.lastOpeningPickDetail = {
          slot: bestPassingPair.idx,
          name: bestPassingPair.record.name || "",
          chargeReleasePlan: pickedChargePlan,
          horizonSim: pr.lastOpenerHorizonSim,
          bestSkillVsBaselinePct: bestVsBaselinePct,
          thresholdPct: thresholdPct,
          thresholdSource: bestPassingMin.source,
          minImprovementFraction: bestPassingMin.minFrac,
          runtimeAggression: runtimeAggression,
          cooldownForecast: pickedCooldownForecast,
          filteredOut: {
            cooldown: breakdown.cooldown,
            mpGate: breakdown.mp,
            noDirectDamage: breakdown.noDirectDamage,
            excluded: breakdown.exclude
          }
        };
        return { slot: bestPassingPair.idx, record: bestPassingPair.record };
      }
      const threshold = baselineTotal * (1 + bestMin.minFrac);
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
        const bestVsBaselinePct =
          baselineTotal > 0 ? +(((bestDmg / baselineTotal) - 1) * 100).toFixed(2) : null;
        const thresholdPct = +(bestMin.minFrac * 100).toFixed(2);
        const pickedCooldownForecast = plannerComputeCooldownForecastPenalty(pickedPair.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const pickedChargePlan = plannerBuildChargeReleasePlan(pickedPair.record, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: st,
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
          expectedBasicHit: expectedBasicHit,
          mobFactor: horizonMobFactor,
          mpAvailable: mpCur
        });
        pr.lastOpeningPickDetail = {
          slot: pickedPair.idx,
          name: pickedPair.record.name || "",
          chargeReleasePlan: pickedChargePlan,
          horizonSim: pr.lastOpenerHorizonSim,
          bestSkillVsBaselinePct: bestVsBaselinePct,
          thresholdPct: thresholdPct,
          thresholdSource: bestMin.source,
          minImprovementFraction: bestMin.minFrac,
          runtimeAggression: runtimeAggression,
          cooldownForecast: pickedCooldownForecast,
          filteredOut: {
            cooldown: breakdown.cooldown,
            mpGate: breakdown.mp,
            noDirectDamage: breakdown.noDirectDamage,
            excluded: breakdown.exclude
          }
        };
        return { slot: pickedPair.idx, record: pickedPair.record };
      }
      pr.lastOpeningPickReason = "horizon_prefers_basic";
      const bestRow = scored.find(function (r) { return r && r.slot === bestIdx; }) || null;
      const bestCand = bestPair;
      const bestChargePlan = bestCand
        ? plannerBuildChargeReleasePlan(bestCand.record, {
            horizonSec: horizonSec,
            enemyKey: key,
            liveState: st,
            paper: paper,
            basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
            expectedBasicHit: expectedBasicHit,
            mobFactor: horizonMobFactor,
            mpAvailable: mpCur
          })
        : null;
      const bestCooldownForecast = plannerComputeCooldownForecastPenalty(bestCand ? bestCand.record : null, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
      const bestVsBaselinePct =
        baselineTotal > 0 ? +(((bestDmg / baselineTotal) - 1) * 100).toFixed(2) : null;
      const thresholdPct = +(bestMin.minFrac * 100).toFixed(2);
      pr.lastOpeningPickDetail = {
        bestCandidate: bestRow
          ? {
              slot: bestRow.slot,
              name: bestRow.name,
              damage: bestRow.damage,
              chargeReleasePlan: bestChargePlan,
              cooldownForecast: bestCooldownForecast
            }
          : null,
        bestSkillVsBaselinePct: bestVsBaselinePct,
        horizonSim: pr.lastOpenerHorizonSim,
        threshold: +threshold.toFixed(2),
        thresholdPct: thresholdPct,
        thresholdSource: bestMin.source,
        minImprovementFraction: bestMin.minFrac,
        runtimeAggression: runtimeAggression,
        filteredOut: {
          cooldown: breakdown.cooldown,
          mpGate: breakdown.mp,
          noDirectDamage: breakdown.noDirectDamage,
          excluded: breakdown.exclude
        }
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
