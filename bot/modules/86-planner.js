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

      // AI CHANGED: §6 buff calibration export — last merge signature + capped per-signature buckets.
      const buffBuckets = cal.buffSigBuckets && typeof cal.buffSigBuckets === "object" ? cal.buffSigBuckets : null;
      const buffBucketList = [];
      if (buffBuckets) {
        const bkeys = Object.keys(buffBuckets);
        for (let bi = 0; bi < bkeys.length; bi += 1) {
          const bb = buffBuckets[bkeys[bi]];
          buffBucketList.push({
            signature: bb && bb.signature != null ? String(bb.signature) : bkeys[bi],
            sessionsMerged: bb ? bb.sessionsMerged : null,
            hpDropSamples: bb ? bb.hpDropSamples : null,
            hpDropMean: bb ? bb.hpDropMean : null
          });
        }
        buffBucketList.sort(function (a, b) {
          return (b.hpDropSamples || 0) - (a.hpDropSamples || 0);
        });
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
        statusLabelsLast: row.statusLabelsLast || [],
        statusLabelsSignatureLastMerge:
          row.observeCalLast && row.observeCalLast.statusLabelsSignature != null
            ? row.observeCalLast.statusLabelsSignature
            : null,
        statusLabelsMergeSourceLast:
          row.observeCalLast && row.observeCalLast.statusLabelsMergeSource
            ? row.observeCalLast.statusLabelsMergeSource
            : null,
        buffSigBucketCount: buffBucketList.length,
        buffSigBucketsTop: buffBucketList.slice(0, 6)
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
        "ratio > 1 often means skills/crits/debuffs mixed in; basic-only fights give cleaner factors. ratioVsCurrentPaper uses live hero stats. buffSigBucketsTop groups hp_drop stats by merged statusLabelsSignature (capped) for buffed vs clean comparisons."
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
  // AI CHANGED: Planner rewrite v1.2 — split into pure compute (read-only) + mutating apply.
  //   Logic (bullet-list):
  //     • `plannerComputeClassProfile()` returns what WOULD be applied (classKey, profileKey, planned set) WITHOUT mutating `Config.planner` or `Runtime.planner.activeClassProfile`.
  //     • `plannerApplyClassProfile()` calls compute then mutates `Config.planner` for the values that pass min-gate; updates `Runtime.planner.activeClassProfile`.
  //     • Diagnostic / read-only callers (`getPlannerOpeningPickDiagnostics`) use compute; only the actual pick path (`plannerPickSkillOpeningPick`) calls apply.
  //   Why: previously diagnostics called Apply, mutating live Config every time you inspected planner state from the console. Now read-only paths are truly read-only.
  function plannerComputeClassProfile() {
    const map = Config.planner && Config.planner.classProfiles ? Config.planner.classProfiles : null;
    if (!map || typeof map !== "object") {
      return { ok: false, reason: "no_profiles", planned: {} };
    }
    const classKey = plannerDetectProfileClassKey() || "default";
    const profile = map[classKey] || map.default || null;
    if (!profile || typeof profile !== "object") {
      return { ok: false, reason: "profile_missing", classKey: classKey, planned: {} };
    }
    const planned = {};
    function gatherNum(key, min) {
      const v = profile[key];
      if (Number.isFinite(v) && (min === undefined || v >= min)) {
        planned[key] = v;
      }
    }
    gatherNum("skillMpReserve", 0);
    gatherNum("openerHorizonMinImprovementFraction", 0);
    gatherNum("openerExtraRankedSkills", 0);
    gatherNum("conceptionOpenerGateDelta", 0);
    gatherNum("conceptionMultiMobEnemyCountThreshold", 0);
    gatherNum("conceptionChannelMultiMobPenalty", 0);
    return {
      ok: true,
      classKey: classKey,
      profileKey: map[classKey] ? classKey : "default",
      planned: planned
    };
  }

  function plannerApplyClassProfile() {
    const computed = plannerComputeClassProfile();
    if (!computed.ok) {
      Runtime.planner.activeClassProfile = null;
      return { ok: false, reason: computed.reason, classKey: computed.classKey || null };
    }
    const applied = {};
    const planned = computed.planned;
    const keys = Object.keys(planned);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      Config.planner[k] = planned[k];
      applied[k] = planned[k];
    }
    const out = {
      ok: true,
      classKey: computed.classKey,
      profileKey: computed.profileKey,
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
    const denseStep =
      Config.combat && Number.isFinite(Config.combat.chargeSkillDynamicSearchStepFraction)
        ? Config.combat.chargeSkillDynamicSearchStepFraction
        : 0;
    if (denseStep > 0 && denseStep < 1) {
      for (let frac = denseStep; frac < 1; frac += denseStep) {
        addFraction(frac, "chargeSkillDynamicSearchStepFraction");
      }
      addFraction(1, "chargeSkillDynamicSearchStepFraction.full");
    }
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

  function plannerReadLiveTargetHpSnapshot(liveState) {
    const targetHp =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid
        ? liveState.combat.targetHp
        : null;
    const cur = targetHp && Number.isFinite(targetHp.cur) && targetHp.cur > 0 ? targetHp.cur : null;
    const max = targetHp && Number.isFinite(targetHp.max) && targetHp.max > 0 ? targetHp.max : null;
    const pct = Number.isFinite(cur) && Number.isFinite(max) && max > 0 ? cur / max : null;
    return {
      cur: Number.isFinite(cur) ? +cur.toFixed(2) : null,
      max: Number.isFinite(max) ? +max.toFixed(2) : null,
      pct: Number.isFinite(pct) ? +pct.toFixed(4) : null
    };
  }

  function plannerComputeExecuteCandidate(skillShape, actionSec, expectedBasicHit, liveState) {
    const out = {
      enabled: Config.planner && Config.planner.openerExecuteModeEnabled !== false,
      actionSec: Number.isFinite(actionSec) ? +actionSec.toFixed(3) : 0,
      targetHpCur: null,
      targetHpMax: null,
      targetHpPct: null,
      lowTargetHpCap: null,
      immediateDamage: skillShape && Number.isFinite(skillShape.immediateDamage) ? +skillShape.immediateDamage.toFixed(2) : 0,
      eligibleWindow: false,
      lethal: false,
      killMargin: null,
      reason: "disabled"
    };
    if (!out.enabled) {
      return out;
    }
    const targetHp = plannerReadLiveTargetHpSnapshot(liveState);
    out.targetHpCur = targetHp.cur;
    out.targetHpMax = targetHp.max;
    out.targetHpPct = targetHp.pct;
    if (!Number.isFinite(targetHp.cur) || !(targetHp.cur > 0)) {
      out.reason = "no_live_target_hp";
      return out;
    }
    const executeWindowBasicHits =
      Config.planner && Number.isFinite(Config.planner.openerExecuteLowTargetBasicHitWindow)
        ? Math.max(0.5, Config.planner.openerExecuteLowTargetBasicHitWindow)
        : 1.5;
    const lowTargetHpCap =
      Number.isFinite(expectedBasicHit) && expectedBasicHit > 0
        ? expectedBasicHit * executeWindowBasicHits
        : null;
    out.lowTargetHpCap = Number.isFinite(lowTargetHpCap) ? +lowTargetHpCap.toFixed(2) : null;
    if (!Number.isFinite(lowTargetHpCap) || !(lowTargetHpCap > 0)) {
      out.reason = "no_basic_hit_estimate";
      return out;
    }
    out.eligibleWindow = targetHp.cur <= lowTargetHpCap;
    if (!out.eligibleWindow) {
      out.reason = "target_not_in_execute_window";
      return out;
    }
    if (!(out.immediateDamage > 0)) {
      out.reason = "no_immediate_damage";
      return out;
    }
    out.lethal = out.immediateDamage >= targetHp.cur;
    out.killMargin = out.lethal ? +(out.immediateDamage - targetHp.cur).toFixed(2) : null;
    out.reason = out.lethal ? "earliest_lethal_action" : "execute_window_not_lethal";
    return out;
  }

  function plannerChooseExecuteCandidate(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }
    let best = null;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const execute = row && row.execute ? row.execute : null;
      if (!execute || !execute.enabled || !execute.eligibleWindow || !execute.lethal) {
        continue;
      }
      if (!best) {
        best = row;
        continue;
      }
      const bestActionSec = best.execute && Number.isFinite(best.execute.actionSec) ? best.execute.actionSec : Number.POSITIVE_INFINITY;
      const rowActionSec = Number.isFinite(execute.actionSec) ? execute.actionSec : Number.POSITIVE_INFINITY;
      if (rowActionSec !== bestActionSec) {
        if (rowActionSec < bestActionSec) {
          best = row;
        }
        continue;
      }
      const bestMargin = best.execute && Number.isFinite(best.execute.killMargin) ? best.execute.killMargin : -Infinity;
      const rowMargin = Number.isFinite(execute.killMargin) ? execute.killMargin : -Infinity;
      if (rowMargin !== bestMargin) {
        if (rowMargin > bestMargin) {
          best = row;
        }
        continue;
      }
      const bestDamage = Number.isFinite(best.horizonDamage) ? best.horizonDamage : -Infinity;
      const rowDamage = Number.isFinite(row.horizonDamage) ? row.horizonDamage : -Infinity;
      if (rowDamage > bestDamage) {
        best = row;
      }
    }
    return best;
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

  // AI CHANGED: Horizon unified terms — live target HP for opener/charge scoring (one resolver).
  function plannerHorizonResolveLiveTargetHpCur(liveState) {
    const th =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.cur) &&
      liveState.combat.targetHp.cur > 0
        ? liveState.combat.targetHp.cur
        : null;
    return Number.isFinite(th) ? th : null;
  }

  // AI CHANGED: Horizon unified terms — cap paper/release damage to current target HP when enabled (generic vs charge config flags).
  function plannerHorizonCapSkillDamageToTargetHp(damageRaw, liveState, policy) {
    const raw = Number.isFinite(damageRaw) ? damageRaw : 0;
    const capHp = plannerHorizonResolveLiveTargetHpCur(liveState);
    let capEnabled = true;
    if (policy === "charge_release") {
      capEnabled = Config.planner && Config.planner.chargeSkillTargetOverkillCapEnabled !== false;
    } else {
      capEnabled = Config.planner && Config.planner.openerTargetHpAwareScoring !== false;
    }
    if (!capEnabled || capHp == null) {
      return {
        capped: raw,
        raw: raw,
        applied: false,
        wastedOverkill: 0,
        capHp: capHp,
        policy: policy || "generic_opener"
      };
    }
    const capped = Math.min(raw, capHp);
    return {
      capped: capped,
      raw: raw,
      applied: raw - capped > 1e-9,
      wastedOverkill: Math.max(0, raw - capped),
      capHp: capHp,
      policy: policy || "generic_opener"
    };
  }

  function plannerScoreChargeReleaseCandidate(effect, chargePlan, horizonSec, mobFactor, expectedBasicHit, basicDps, liveState, scoreOpts) {
    const opts = scoreOpts && typeof scoreOpts === "object" ? scoreOpts : {};
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    const basePart = expectedBasicHit * mf;
    const releaseDamageRaw =
      horizonSec >= chargePlan.releaseSec
        ? basePart * chargePlan.expectedBasePlusGearMultiplier
        : 0;
    const targetHpCur = plannerHorizonResolveLiveTargetHpCur(liveState);
    const overkillWrap = plannerHorizonCapSkillDamageToTargetHp(releaseDamageRaw, liveState, "charge_release");
    const releaseDamage = overkillWrap.capped;
    const wastedOverkillDamage = overkillWrap.wastedOverkill;
    const followUpBasicDamage = Math.max(0, horizonSec - chargePlan.releaseSec) * basicDps;
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
    const skillShape = {
      totalDamage: +releaseDamageRaw.toFixed(2),
      immediateDamage: +releaseDamageRaw.toFixed(2),
      dotDamage: 0
    };
    const contextAdjustment = plannerComputeOpenerContextAdjustment(
      opts.slot || null,
      chargePlan.releaseSec,
      skillShape,
      basicDps,
      expectedBasicHit,
      liveState,
      opts.enemyKey && String(opts.enemyKey).trim() ? { enemyKey: String(opts.enemyKey).trim() } : null
    );
    const execute = plannerComputeExecuteCandidate(skillShape, chargePlan.releaseSec, expectedBasicHit, liveState);
    const totalDamage = releaseDamage + followUpAction.value - cooldownForecast.penalty + contextAdjustment.total;
    const hrDiag =
      contextAdjustment && contextAdjustment.channelHoldRisk
        ? contextAdjustment.channelHoldRisk
        : plannerComputeHorizonChannelHoldRisk(chargePlan.releaseSec, basicDps, liveState, {
            pressure: plannerComputeOpenerDangerPressure(
              liveState,
              opts.enemyKey && String(opts.enemyKey).trim() ? { enemyKey: String(opts.enemyKey).trim() } : null
            ),
            enemyKey: opts.enemyKey && String(opts.enemyKey).trim() ? String(opts.enemyKey).trim() : null
          });
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
      holdRiskPenalty: hrDiag.penalty,
      multiMobHoldPenalty: hrDiag.multiMobHoldPenalty,
      lowHpHoldPenalty: hrDiag.lowHpHoldPenalty,
      incomingHoldPenalty: Number.isFinite(hrDiag.incomingHoldPenalty) ? hrDiag.incomingHoldPenalty : 0,
      enemyCountLive: hrDiag.enemyCountLive,
      playerHpPct: hrDiag.playerHpPct,
      targetHpCur: Number.isFinite(targetHpCur) ? +targetHpCur.toFixed(2) : null,
      skillShape: skillShape,
      contextAdjustment: contextAdjustment,
      execute: execute,
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
    const overrideReleaseMsRaw = Config.combat.chargeSkillReleaseOverrideMs;
    const hasOverrideReleaseMs = Number.isFinite(overrideReleaseMsRaw) && overrideReleaseMsRaw > 0;
    if (hasOverrideReleaseMs) {
      const manualPlan = plannerBuildChargeReleasePlanFromMs(
        effect,
        maxMs,
        minHoldMs,
        overrideReleaseMsRaw,
        "chargeSkillReleaseOverrideMs"
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
        const executeBest = plannerChooseExecuteCandidate(scoredCandidates);
        const orderedByTotal = scoredCandidates.slice().sort(function (a, b) {
          if (b.horizonDamage !== a.horizonDamage) {
            return b.horizonDamage - a.horizonDamage;
          }
          return a.releaseMs - b.releaseMs;
        });
        const best = Object.assign({}, executeBest || orderedByTotal[0]);
        best.selectionMode = executeBest ? "dynamic_execute_earliest_lethal" : "dynamic_horizon_best_total";
        best.executeModeApplied = !!executeBest;
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
              : null,
          targetHpMax:
            liveState && liveState.combat && liveState.combat.targetHp && liveState.combat.targetHp.valid && Number.isFinite(liveState.combat.targetHp.max)
              ? +liveState.combat.targetHp.max.toFixed(2)
              : null,
          targetHpPct:
            liveState && liveState.combat && liveState.combat.targetHp && liveState.combat.targetHp.valid && Number.isFinite(liveState.combat.targetHp.cur) && Number.isFinite(liveState.combat.targetHp.max) && liveState.combat.targetHp.max > 0
              ? +(liveState.combat.targetHp.cur / liveState.combat.targetHp.max).toFixed(4)
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

  // AI CHANGED: openerHorizonSim paper — full mobFactor on basic-anchored effects (basic_proc, channel_gear); instant/dot use damageType-aware blend weights (physical vs magic/unknown).
  function plannerHorizonPaperEffectiveMobFactor(mobFactor, anchoring, damageType) {
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    if (anchoring === "basic") {
      return mf;
    }
    const dt = typeof damageType === "string" ? damageType.toLowerCase() : "";
    const isPhysical = dt === "physical";
    let w;
    if (isPhysical) {
      const wCfg = Config.planner && Config.planner.horizonPaperMobBlendPhysicalWeight;
      w = Number.isFinite(wCfg) ? Math.max(0, Math.min(1, wCfg)) : 1;
    } else {
      const wMag = Config.planner && Config.planner.horizonPaperMobBlendMagicWeight;
      if (Number.isFinite(wMag)) {
        w = Math.max(0, Math.min(1, wMag));
      } else {
        const wLegacy = Config.planner && Config.planner.horizonPaperMobBlendNonBasicWeight;
        w = Number.isFinite(wLegacy) ? Math.max(0, Math.min(1, wLegacy)) : 0.6;
      }
    }
    if (w >= 1 - 1e-9) {
      return mf;
    }
    return 1 + (mf - 1) * w;
  }

  // AI CHANGED: openerHorizonSim — split skill paper damage into immediate vs delayed parts; basic_proc + channel use full mobFactor; instant/dot use typed blend via damageType when present.
  function plannerSummarizeSkillPaperDamageShape(slot, horizonSec, mobFactor, expectedBasicHit, prebuiltChargePlan) {
    if (!slot || !Array.isArray(slot.effects) || !(horizonSec > 0)) {
      return {
        totalDamage: 0,
        immediateDamage: 0,
        dotDamage: 0
      };
    }
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    let totalDamage = 0;
    let immediateDamage = 0;
    let dotDamage = 0;
    for (let i = 0; i < slot.effects.length; i += 1) {
      const e = slot.effects[i];
      if (!e || !e.type) {
        continue;
      }
      if (e.type === "dot" && Number.isFinite(e.perSec)) {
        const dur = Number.isFinite(e.durationSec) ? e.durationSec : horizonSec;
        const mfDot = plannerHorizonPaperEffectiveMobFactor(mf, "non_basic", e.damageType);
        const add = e.perSec * Math.min(horizonSec, dur) * mfDot;
        totalDamage += add;
        dotDamage += add;
      } else if (e.type === "instant" && Number.isFinite(e.value)) {
        const mfInst = plannerHorizonPaperEffectiveMobFactor(mf, "non_basic", e.damageType);
        const add = e.value * mfInst;
        totalDamage += add;
        immediateDamage += add;
      } else if (e.type === "basic_proc" && expectedBasicHit !== null && Number.isFinite(expectedBasicHit)) {
        const add = expectedBasicHit * mf;
        totalDamage += add;
        immediateDamage += add;
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
          const add = basePart * mult;
          totalDamage += add;
          immediateDamage += add;
        }
      }
    }
    return {
      totalDamage: totalDamage,
      immediateDamage: immediateDamage,
      dotDamage: dotDamage
    };
  }

  // AI CHANGED: openerHorizonSim — rough skill damage over window from parsed effects (HP units, same scale as paper).
  function plannerSkillPaperDamageInHorizon(slot, horizonSec, mobFactor, expectedBasicHit, prebuiltChargePlan) {
    return plannerSummarizeSkillPaperDamageShape(slot, horizonSec, mobFactor, expectedBasicHit, prebuiltChargePlan).totalDamage;
  }

  // AI CHANGED: Enemy DB calibration → opener pressure — hard when ratio < paper (with spread confidence); optional ease when ratio > paper within a capped band; charge holds use hard only.
  function plannerComputeCalibrationPressureAddon(enemyKey) {
    const out = {
      hardAddon: 0,
      easeAddon: 0,
      addon: 0,
      ratio: null,
      hpDropSamples: null,
      skippedReason: null,
      spreadRel: null,
      confidenceMul: 1
    };
    if (Config.planner && Config.planner.openerContextCalibrationPressureEnabled === false) {
      out.skippedReason = "disabled";
      return out;
    }
    if (!enemyKey || typeof enemyKey !== "string" || !enemyKey.trim()) {
      out.skippedReason = "no_enemy_key";
      return out;
    }
    const row = getEnemyCalibrationRow(enemyKey.trim());
    if (!row || !Number.isFinite(row.ratioObservedVsCurrentPaper) || row.ratioObservedVsCurrentPaper <= 0) {
      out.skippedReason = "no_ratio";
      return out;
    }
    out.ratio = row.ratioObservedVsCurrentPaper;
    const n = row.hpDropSamples;
    out.hpDropSamples = n;
    const minN =
      Config.planner && Number.isFinite(Config.planner.openerContextCalibrationPressureMinHpDropSamples)
        ? Math.max(1, Math.floor(Config.planner.openerContextCalibrationPressureMinHpDropSamples))
        : 5;
    if (!Number.isFinite(n) || n < minN) {
      out.skippedReason = "low_samples";
      return out;
    }
    const mean = row.observedMeanHpDrop;
    let spreadRel = null;
    let confMul = 1;
    if (Number.isFinite(mean) && mean > 0 && Number.isFinite(row.observedMin) && Number.isFinite(row.observedMax)) {
      spreadRel = (row.observedMax - row.observedMin) / mean;
      out.spreadRel = +spreadRel.toFixed(4);
      const spreadLo =
        Config.planner && Number.isFinite(Config.planner.openerContextCalibrationSpreadLo)
          ? Math.max(0, Config.planner.openerContextCalibrationSpreadLo)
          : 0.18;
      const spreadHi =
        Config.planner && Number.isFinite(Config.planner.openerContextCalibrationSpreadHi)
          ? Math.max(spreadLo + 0.01, Config.planner.openerContextCalibrationSpreadHi)
          : 0.72;
      const pen =
        Config.planner && Number.isFinite(Config.planner.openerContextCalibrationSpreadConfidencePenalty)
          ? Math.max(0, Config.planner.openerContextCalibrationSpreadConfidencePenalty)
          : 0.85;
      if (spreadRel > spreadHi) {
        out.skippedReason = "spread_too_wide";
        return out;
      }
      confMul = Math.max(0.2, 1 - Math.max(0, spreadRel - spreadLo) * pen);
      out.confidenceMul = +confMul.toFixed(4);
    } else {
      out.confidenceMul = 1;
    }
    const ratio = row.ratioObservedVsCurrentPaper;
    const scale =
      Config.planner && Number.isFinite(Config.planner.openerContextCalibrationPressureScale)
        ? Math.max(0, Config.planner.openerContextCalibrationPressureScale)
        : 0.35;
    const cap =
      Config.planner && Number.isFinite(Config.planner.openerContextCalibrationPressureCap)
        ? Math.max(0, Config.planner.openerContextCalibrationPressureCap)
        : 0.45;
    if (ratio < 0.995) {
      const deficit = 1 - ratio;
      out.hardAddon = +Math.min(cap, deficit * scale * confMul).toFixed(4);
    }
    if (
      Config.planner &&
      Config.planner.openerContextCalibrationEaseEnabled !== false &&
      ratio > 1.005
    ) {
      const maxR =
        Config.planner && Number.isFinite(Config.planner.openerContextCalibrationEaseMaxRatio)
          ? Math.max(1.01, Config.planner.openerContextCalibrationEaseMaxRatio)
          : 1.32;
      if (ratio <= maxR) {
        const easeScale =
          Config.planner && Number.isFinite(Config.planner.openerContextCalibrationEaseScale)
            ? Math.max(0, Config.planner.openerContextCalibrationEaseScale)
            : 0.22;
        const easeCap =
          Config.planner && Number.isFinite(Config.planner.openerContextCalibrationEaseCap)
            ? Math.max(0, Config.planner.openerContextCalibrationEaseCap)
            : 0.2;
        const surplus = ratio - 1;
        out.easeAddon = +Math.min(easeCap, surplus * easeScale * confMul).toFixed(4);
      }
    }
    out.addon = +(out.hardAddon - out.easeAddon).toFixed(4);
    return out;
  }

  // AI CHANGED: Live-fight danger model for generic opener scoring — optional `dangerOpts.enemyKey` folds DB calibration (spread confidence, hard/ease ratio nudges) into `totalPressure`.
  function plannerComputeOpenerDangerPressure(liveState, dangerOpts) {
    const dOpt = dangerOpts && typeof dangerOpts === "object" ? dangerOpts : null;
    const enemyKeyForCal =
      dOpt && typeof dOpt.enemyKey === "string" && dOpt.enemyKey.trim() ? dOpt.enemyKey.trim() : null;
    const enemyCountLive =
      liveState && liveState.combat && typeof liveState.combat.enemyCount === "number"
        ? Math.max(0, liveState.combat.enemyCount)
        : 0;
    const extraEnemies = Math.max(0, enemyCountLive - 1);
    const playerHpPct =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.pct)
        ? liveState.player.hp.pct
        : null;
    const lowHpThresholdPct = Number.isFinite(Config.planner.openerContextLowHpThresholdPct)
      ? Math.max(0.05, Math.min(1, Config.planner.openerContextLowHpThresholdPct))
      : 0.65;
    const lowHpPressureWeight = Number.isFinite(Config.planner.openerContextLowHpPressureWeight)
      ? Math.max(0, Config.planner.openerContextLowHpPressureWeight)
      : 1.25;
    const lowHpPressure =
      Number.isFinite(playerHpPct) && playerHpPct < lowHpThresholdPct
        ? ((lowHpThresholdPct - playerHpPct) / lowHpThresholdPct) * lowHpPressureWeight
        : 0;
    let incomingHpLossPerSec = 0;
    let incomingPressure = 0;
    if (Config.planner && Config.planner.openerContextIncomingHpLossEnabled !== false && enemyCountLive >= 1) {
      const sustain =
        Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain && typeof Runtime.autoFarm.combatSustain === "object"
          ? Runtime.autoFarm.combatSustain
          : null;
      if (sustain && Number.isFinite(sustain.recentHpLossPerSec) && sustain.recentHpLossPerSec > 0) {
        incomingHpLossPerSec = +sustain.recentHpLossPerSec.toFixed(3);
        const maxHp =
          liveState &&
          liveState.player &&
          liveState.player.hp &&
          liveState.player.hp.valid &&
          Number.isFinite(liveState.player.hp.max) &&
          liveState.player.hp.max > 0
            ? liveState.player.hp.max
            : null;
        const scaleRaw = Config.planner.openerContextIncomingHpLossScale;
        const scale = Number.isFinite(scaleRaw) && scaleRaw >= 0 ? scaleRaw : 8;
        const capRaw = Config.planner.openerContextIncomingHpLossPressureCap;
        const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : 2.5;
        if (Number.isFinite(maxHp) && maxHp > 0) {
          incomingPressure = Math.min(cap, (incomingHpLossPerSec / maxHp) * scale);
        }
      }
    }
    const calWrap = plannerComputeCalibrationPressureAddon(enemyKeyForCal);
    const calibrationPressureHard = calWrap && Number.isFinite(calWrap.hardAddon) ? calWrap.hardAddon : 0;
    const calibrationPressureEase = calWrap && Number.isFinite(calWrap.easeAddon) ? calWrap.easeAddon : 0;
    const calibrationPressure =
      calWrap && Number.isFinite(calWrap.addon) ? calWrap.addon : calibrationPressureHard - calibrationPressureEase;
    const totalPressureRaw = extraEnemies + lowHpPressure + incomingPressure + calibrationPressure;
    const totalPressure = +Math.max(0, totalPressureRaw).toFixed(4);
    // AI CHANGED: Pull-size labels for diagnostics / exports (solo = one live enemy bar, duo = two, pack = three+).
    const pullTier =
      enemyCountLive <= 0 ? "none" : enemyCountLive === 1 ? "solo" : enemyCountLive === 2 ? "duo" : "pack";
    return {
      enemyCountLive: enemyCountLive,
      extraEnemies: extraEnemies,
      pullEnemyCount: enemyCountLive,
      pullTier: pullTier,
      playerHpPct: playerHpPct,
      lowHpThresholdPct: lowHpThresholdPct,
      lowHpPressure: +lowHpPressure.toFixed(4),
      incomingHpLossPerSec: incomingHpLossPerSec,
      incomingPressure: +incomingPressure.toFixed(4),
      calibrationPressureHard: +calibrationPressureHard.toFixed(4),
      calibrationPressureEase: +calibrationPressureEase.toFixed(4),
      calibrationPressure: +calibrationPressure.toFixed(4),
      calibrationRatio: calWrap && calWrap.ratio !== null && Number.isFinite(calWrap.ratio) ? +calWrap.ratio.toFixed(4) : null,
      calibrationHpDropSamples: calWrap && calWrap.hpDropSamples !== null ? calWrap.hpDropSamples : null,
      calibrationSpreadRel: calWrap && calWrap.spreadRel !== null && Number.isFinite(calWrap.spreadRel) ? calWrap.spreadRel : null,
      calibrationConfidenceMul:
        calWrap && Number.isFinite(calWrap.confidenceMul) ? +calWrap.confidenceMul.toFixed(4) : null,
      calibrationPressureSkipped: calWrap && calWrap.skippedReason ? calWrap.skippedReason : null,
      totalPressure: totalPressure
    };
  }

  // AI CHANGED: Horizon single authority — channel-hold risk (multi-mob + low player HP + optional incoming sustain pressure) lives here only; charge candidate scoring and opener context share the same numbers/parts.
  function plannerComputeHorizonChannelHoldRisk(castBlockedSec, basicDps, liveState, userOpts) {
    const out = {
      penalty: 0,
      multiMobHoldPenalty: 0,
      lowHpHoldPenalty: 0,
      incomingHoldPenalty: 0,
      enemyCountLive: 0,
      playerHpPct: null,
      parts: []
    };
    if (!(castBlockedSec > 0) || !(basicDps > 0)) {
      return out;
    }
    const enemyCountLive =
      liveState &&
      liveState.combat &&
      typeof liveState.combat.enemyCount === "number"
        ? liveState.combat.enemyCount
        : 0;
    out.enemyCountLive = enemyCountLive;
    const extraEnemies = enemyCountLive > 1 ? enemyCountLive - 1 : 0;
    const extraEnemyPenaltyCoeff =
      Config.planner && Number.isFinite(Config.planner.chargeSkillHoldExtraEnemyPenaltyInBasicDps)
        ? Math.max(0, Config.planner.chargeSkillHoldExtraEnemyPenaltyInBasicDps)
        : 0.08;
    const multiMobHoldPenalty = castBlockedSec * basicDps * extraEnemyPenaltyCoeff * extraEnemies;
    out.multiMobHoldPenalty = +multiMobHoldPenalty.toFixed(2);
    const playerHpPct =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.pct)
        ? liveState.player.hp.pct
        : null;
    out.playerHpPct = Number.isFinite(playerHpPct) ? +playerHpPct.toFixed(4) : null;
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
    const lowHpHoldPenalty = castBlockedSec * basicDps * lowHpPenaltyCoeff * lowHpRatio;
    out.lowHpHoldPenalty = +lowHpHoldPenalty.toFixed(2);
    let incomingHoldPenalty = 0;
    const precalcPressure = userOpts && userOpts.pressure && typeof userOpts.pressure === "object" ? userOpts.pressure : null;
    if (
      enemyCountLive >= 1 &&
      Config.planner &&
      Config.planner.chargeSkillHoldIncomingPressureEnabled !== false
    ) {
      const incCoeff =
        Config.planner && Number.isFinite(Config.planner.chargeSkillHoldIncomingPressurePenaltyInBasicDps)
          ? Math.max(0, Config.planner.chargeSkillHoldIncomingPressurePenaltyInBasicDps)
          : 0.07;
      if (incCoeff > 0) {
        const dpDangerOpt =
          userOpts && typeof userOpts === "object" && typeof userOpts.enemyKey === "string" && userOpts.enemyKey.trim()
            ? { enemyKey: userOpts.enemyKey.trim() }
            : null;
        const dp = precalcPressure || plannerComputeOpenerDangerPressure(liveState, dpDangerOpt);
        const incP = dp && Number.isFinite(dp.incomingPressure) ? Math.max(0, dp.incomingPressure) : 0;
        const calHard =
          dp && Number.isFinite(dp.calibrationPressureHard)
            ? Math.max(0, dp.calibrationPressureHard)
            : dp && Number.isFinite(dp.calibrationPressure)
              ? Math.max(0, dp.calibrationPressure)
              : 0;
        const incomingLike = incP + calHard;
        if (incomingLike > 0) {
          incomingHoldPenalty = castBlockedSec * basicDps * incomingLike * incCoeff;
          out.incomingHoldPenalty = +incomingHoldPenalty.toFixed(2);
        }
      }
    }
    const holdRiskPenalty = multiMobHoldPenalty + lowHpHoldPenalty + incomingHoldPenalty;
    out.penalty = +holdRiskPenalty.toFixed(2);
    if (multiMobHoldPenalty > 0) {
      out.parts.push({
        type: "hold_multimob_penalty",
        add: -+multiMobHoldPenalty.toFixed(2),
        extraEnemies: extraEnemies,
        castBlockedSec: +castBlockedSec.toFixed(3)
      });
    }
    if (lowHpHoldPenalty > 0) {
      out.parts.push({
        type: "hold_low_hp_penalty",
        add: -+lowHpHoldPenalty.toFixed(2),
        lowHpRatio: +lowHpRatio.toFixed(4),
        castBlockedSec: +castBlockedSec.toFixed(3)
      });
    }
    if (incomingHoldPenalty > 0) {
      out.parts.push({
        type: "hold_incoming_pressure_penalty",
        add: -+incomingHoldPenalty.toFixed(2),
        castBlockedSec: +castBlockedSec.toFixed(3)
      });
    }
    if (userOpts && userOpts.note) {
      out.note = userOpts.note;
    }
    return out;
  }

  // AI CHANGED: Enemy-state-aware opener score nudges openers based on live danger, calm safe-setup windows, finisher urgency, and multi-target opportunity.
  function plannerComputeOpenerContextAdjustment(slot, castBlockedSec, skillShape, basicDps, expectedBasicHit, liveState, contextOpts) {
    const ctxOpts = contextOpts && typeof contextOpts === "object" ? contextOpts : {};
    const enemyKeyForCtx =
      typeof ctxOpts.enemyKey === "string" && ctxOpts.enemyKey.trim() ? ctxOpts.enemyKey.trim() : null;
    const dangerOpt = enemyKeyForCtx ? { enemyKey: enemyKeyForCtx } : null;
    const out = {
      total: 0,
      pressure: plannerComputeOpenerDangerPressure(liveState, dangerOpt),
      liveTargetHp: null,
      liveTargetHpPct: null,
      basicTtkSec: null,
      immediateDamage: skillShape && Number.isFinite(skillShape.immediateDamage) ? +skillShape.immediateDamage.toFixed(2) : 0,
      dotDamage: skillShape && Number.isFinite(skillShape.dotDamage) ? +skillShape.dotDamage.toFixed(2) : 0,
      parts: []
    };
    if (Config.planner.openerContextAwareScoringEnabled === false || !(basicDps > 0)) {
      if (
        Config.planner.openerContextAwareScoringEnabled === false &&
        basicDps > 0 &&
        slot &&
        typeof plannerGetChargeSkillEffect === "function" &&
        plannerGetChargeSkillEffect(slot) &&
        castBlockedSec > 0
      ) {
        const stPressure = plannerComputeOpenerDangerPressure(liveState, dangerOpt);
        const hr = plannerComputeHorizonChannelHoldRisk(castBlockedSec, basicDps, liveState, {
          pressure: stPressure,
          enemyKey: enemyKeyForCtx || null
        });
        out.total -= hr.penalty;
        out.channelHoldRisk = hr;
        for (let hi = 0; hi < hr.parts.length; hi += 1) {
          out.parts.push(hr.parts[hi]);
        }
        out.total = +out.total.toFixed(2);
      }
      return out;
    }
    const conception = plannerResolveSlotConception(slot);
    const pressure = out.pressure;
    const targetHpCur =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.cur) &&
      liveState.combat.targetHp.cur > 0
        ? liveState.combat.targetHp.cur
        : null;
    const targetHpMax =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.max) &&
      liveState.combat.targetHp.max > 0
        ? liveState.combat.targetHp.max
        : null;
    const targetHpPct =
      Number.isFinite(targetHpCur) && Number.isFinite(targetHpMax) && targetHpMax > 0
        ? targetHpCur / targetHpMax
        : null;
    out.liveTargetHp = Number.isFinite(targetHpCur) ? +targetHpCur.toFixed(2) : null;
    out.liveTargetHpPct = Number.isFinite(targetHpPct) ? +targetHpPct.toFixed(4) : null;
    const basicTtkSec = Number.isFinite(targetHpCur) ? targetHpCur / basicDps : null;
    out.basicTtkSec = Number.isFinite(basicTtkSec) ? +basicTtkSec.toFixed(3) : null;
    const castPressureCoeff = Number.isFinite(Config.planner.openerContextCastPressurePenaltyInBasicDps)
      ? Math.max(0, Config.planner.openerContextCastPressurePenaltyInBasicDps)
      : 0.12;
    const isChargeChannelSkill =
      !!(slot && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(slot));
    if (!isChargeChannelSkill && pressure.totalPressure > 0 && castBlockedSec > 0.35 && castPressureCoeff > 0) {
      const penalty = castBlockedSec * basicDps * pressure.totalPressure * castPressureCoeff;
      if (penalty > 0) {
        out.total -= penalty;
        out.parts.push({
          type: "pressure_cast_penalty",
          add: -+penalty.toFixed(2),
          pressure: pressure.totalPressure,
          castBlockedSec: +castBlockedSec.toFixed(3)
        });
      }
    }
    const controlCoeff = Number.isFinite(Config.planner.openerContextControlPressureBonusInBasicDps)
      ? Math.max(0, Config.planner.openerContextControlPressureBonusInBasicDps)
      : 0.18;
    const controlFlags = conception && conception.flags ? conception.flags : null;
    if (pressure.totalPressure > 0 && controlCoeff > 0 && controlFlags && (controlFlags.stun || controlFlags.slow)) {
      const controlWeight = controlFlags.stun ? 1 : 0.55;
      const bonus = basicDps * pressure.totalPressure * controlCoeff * controlWeight;
      if (bonus > 0) {
        out.total += bonus;
        out.parts.push({
          type: controlFlags.stun ? "pressure_control_bonus_stun" : "pressure_control_bonus_slow",
          add: +bonus.toFixed(2),
          pressure: pressure.totalPressure
        });
      }
    }
    const multiTargetCoeff = Number.isFinite(Config.planner.openerContextMultiTargetEnemyBonusInBasicDps)
      ? Math.max(0, Config.planner.openerContextMultiTargetEnemyBonusInBasicDps)
      : 0.1;
    const tags = Array.isArray(slot && slot.tags) ? slot.tags.map((t) => String(t).toLowerCase()) : [];
    const multiTargetSkill = tags.indexOf("close") >= 0 || tags.indexOf("party") >= 0;
    if (pressure.extraEnemies > 0 && multiTargetSkill && multiTargetCoeff > 0) {
      const bonus = pressure.extraEnemies * basicDps * multiTargetCoeff;
      if (bonus > 0) {
        out.total += bonus;
        out.parts.push({
          type: "multitarget_enemy_bonus",
          add: +bonus.toFixed(2),
          extraEnemies: pressure.extraEnemies
        });
      }
    }
    const immediateDamage = skillShape && Number.isFinite(skillShape.immediateDamage) ? skillShape.immediateDamage : 0;
    const dotDamage = skillShape && Number.isFinite(skillShape.dotDamage) ? skillShape.dotDamage : 0;
    const totalSkillDamage = Math.max(0, immediateDamage + dotDamage);
    const frontloadShare = totalSkillDamage > 0 ? immediateDamage / totalSkillDamage : 0;
    const dotShare = totalSkillDamage > 0 ? dotDamage / totalSkillDamage : 0;
    const calmPressureMax = Number.isFinite(Config.planner.openerContextCalmPressureMax)
      ? Math.max(0, Config.planner.openerContextCalmPressureMax)
      : 0.2;
    const calmTargetBasicHitWindow = Number.isFinite(Config.planner.openerContextCalmTargetBasicHitWindow)
      ? Math.max(1, Config.planner.openerContextCalmTargetBasicHitWindow)
      : 2.5;
    const calmBurstImmediateRatio = Number.isFinite(Config.planner.openerContextCalmBurstImmediateBasicHitRatio)
      ? Math.max(1, Config.planner.openerContextCalmBurstImmediateBasicHitRatio)
      : 2.2;
    const calmBurstCoeff = Number.isFinite(Config.planner.openerContextCalmBurstBonusInBasicDps)
      ? Math.max(0, Config.planner.openerContextCalmBurstBonusInBasicDps)
      : 0.16;
    const calmTargetHpMin = Number.isFinite(expectedBasicHit) && expectedBasicHit > 0
      ? expectedBasicHit * calmTargetBasicHitWindow
      : null;
    const calmImmediateMin = Number.isFinite(expectedBasicHit) && expectedBasicHit > 0
      ? expectedBasicHit * calmBurstImmediateRatio
      : null;
    const chargeLike = !!plannerGetChargeSkillEffect(slot) || !!(controlFlags && controlFlags.channel);
    if (
      pressure.extraEnemies === 0 &&
      calmBurstCoeff > 0 &&
      Number.isFinite(targetHpCur) &&
      Number.isFinite(calmTargetHpMin) &&
      targetHpCur >= calmTargetHpMin &&
      Number.isFinite(calmImmediateMin) &&
      immediateDamage >= calmImmediateMin &&
      (calmPressureMax <= 0 || pressure.totalPressure <= calmPressureMax)
    ) {
      const immediateToBasicHits = expectedBasicHit > 0 ? immediateDamage / expectedBasicHit : 0;
      const targetToBasicHits = expectedBasicHit > 0 ? targetHpCur / expectedBasicHit : 0;
      const calmFactor = calmPressureMax > 0 ? Math.max(0, 1 - (pressure.totalPressure / calmPressureMax)) : 1;
      const burstWeight = Math.min(1.75, Math.max(0, immediateToBasicHits - calmBurstImmediateRatio));
      const setupWeight = Math.min(1.25, Math.max(chargeLike ? 0.9 : 0.55, castBlockedSec > 0 ? 0.55 + (castBlockedSec / 2) : 0.55));
      const targetRunwayWeight = Math.min(1.15, Math.max(1, targetToBasicHits / calmTargetBasicHitWindow));
      const bonus = basicDps * calmBurstCoeff * calmFactor * burstWeight * setupWeight * targetRunwayWeight;
      if (bonus > 0) {
        out.total += bonus;
        out.parts.push({
          type: "calm_single_target_burst_bonus",
          add: +bonus.toFixed(2),
          pressure: pressure.totalPressure,
          immediateToBasicHits: +immediateToBasicHits.toFixed(3),
          targetToBasicHits: +targetToBasicHits.toFixed(3),
          setupWeight: +setupWeight.toFixed(3),
          chargeLike: chargeLike
        });
      }
    }
    // AI CHANGED: Fresh healthy targets should reward alpha/front-load more than generic 5s value and slightly discount delayed DoT payoff.
    const freshTargetHpPctMin = Number.isFinite(Config.planner.openerContextFreshTargetHpPctMin)
      ? Math.max(0.5, Math.min(1, Config.planner.openerContextFreshTargetHpPctMin))
      : 0.85;
    const freshTargetAlphaCoeff = Number.isFinite(Config.planner.openerContextFreshTargetAlphaBonusInBasicDps)
      ? Math.max(0, Config.planner.openerContextFreshTargetAlphaBonusInBasicDps)
      : 0.22;
    const freshTargetDotPenaltyCoeff = Number.isFinite(Config.planner.openerContextFreshTargetDotPenaltyInBasicDps)
      ? Math.max(0, Config.planner.openerContextFreshTargetDotPenaltyInBasicDps)
      : 0.18;
    const freshTargetWindow =
      pressure.extraEnemies === 0 &&
      Number.isFinite(targetHpPct) &&
      targetHpPct >= freshTargetHpPctMin &&
      (calmPressureMax <= 0 || pressure.totalPressure <= calmPressureMax);
    if (freshTargetWindow) {
      const freshness = Math.min(
        1,
        Math.max(0.35, (targetHpPct - freshTargetHpPctMin) / Math.max(0.05, 1 - freshTargetHpPctMin))
      );
      const immediateToBasicHits = expectedBasicHit > 0 ? immediateDamage / expectedBasicHit : 0;
      const alphaWeight = Math.min(1.25, Math.max(0, immediateToBasicHits - 1.1));
      const setupWeight = chargeLike ? 1.1 : Math.min(1, Math.max(0.65, 0.65 + (castBlockedSec * 0.35)));
      if (freshTargetAlphaCoeff > 0 && alphaWeight > 0) {
        const bonus = basicDps * freshTargetAlphaCoeff * freshness * alphaWeight * setupWeight * Math.max(0.65, frontloadShare);
        if (bonus > 0) {
          out.total += bonus;
          out.parts.push({
            type: "fresh_target_alpha_bonus",
            add: +bonus.toFixed(2),
            targetHpPct: +targetHpPct.toFixed(4),
            immediateToBasicHits: +immediateToBasicHits.toFixed(3),
            frontloadShare: +frontloadShare.toFixed(3),
            chargeLike: chargeLike
          });
        }
      }
      if (freshTargetDotPenaltyCoeff > 0 && dotDamage > 0) {
        const delayedWeight = Math.min(1, Math.max(0, (dotShare - 0.2) + Math.max(0, 0.7 - frontloadShare)));
        if (delayedWeight > 0) {
          const penalty = basicDps * freshTargetDotPenaltyCoeff * freshness * delayedWeight;
          if (penalty > 0) {
            out.total -= penalty;
            out.parts.push({
              type: "fresh_target_dot_penalty",
              add: -+penalty.toFixed(2),
              targetHpPct: +targetHpPct.toFixed(4),
              dotShare: +dotShare.toFixed(3),
              frontloadShare: +frontloadShare.toFixed(3)
            });
          }
        }
      }
    }
    const lowTargetBasicHitWindow = Number.isFinite(Config.planner.openerContextLowTargetBasicHitWindow)
      ? Math.max(0.5, Config.planner.openerContextLowTargetBasicHitWindow)
      : 1.5;
    const finisherCoeff = Number.isFinite(Config.planner.openerContextFinisherBonusInBasicDps)
      ? Math.max(0, Config.planner.openerContextFinisherBonusInBasicDps)
      : 0.22;
    const dotPenaltyCoeff = Number.isFinite(Config.planner.openerContextDotFinisherPenaltyInBasicDps)
      ? Math.max(0, Config.planner.openerContextDotFinisherPenaltyInBasicDps)
      : 0.12;
    const lowTargetHpCap = Number.isFinite(expectedBasicHit) && expectedBasicHit > 0
      ? expectedBasicHit * lowTargetBasicHitWindow
      : null;
    if (Number.isFinite(targetHpCur) && Number.isFinite(lowTargetHpCap) && lowTargetHpCap > 0 && targetHpCur <= lowTargetHpCap) {
      const urgency = Math.max(0, 1 - (targetHpCur / lowTargetHpCap));
      if (immediateDamage >= targetHpCur && finisherCoeff > 0 && Number.isFinite(basicTtkSec)) {
        const savedSec = Math.max(0, basicTtkSec - Math.max(0, castBlockedSec));
        const bonus = savedSec * basicDps * finisherCoeff;
        if (bonus > 0) {
          out.total += bonus;
          out.parts.push({
            type: "direct_finisher_bonus",
            add: +bonus.toFixed(2),
            savedSec: +savedSec.toFixed(3)
          });
        }
      } else if (immediateDamage > 0 && finisherCoeff > 0) {
        const bonus = basicDps * finisherCoeff * urgency;
        if (bonus > 0) {
          out.total += bonus;
          out.parts.push({
            type: "low_target_frontload_bonus",
            add: +bonus.toFixed(2),
            urgency: +urgency.toFixed(3)
          });
        }
      }
      if (dotDamage > immediateDamage && dotPenaltyCoeff > 0) {
        const penalty = basicDps * dotPenaltyCoeff * Math.max(0.2, urgency);
        if (penalty > 0) {
          out.total -= penalty;
          out.parts.push({
            type: "low_target_dot_penalty",
            add: -+penalty.toFixed(2),
            urgency: +urgency.toFixed(3)
          });
        }
      }
    }
    if (isChargeChannelSkill && castBlockedSec > 0) {
      // AI CHANGED: Reuse opener danger pressure object so hold-risk does not call `plannerComputeOpenerDangerPressure` twice per candidate.
      const hr = plannerComputeHorizonChannelHoldRisk(castBlockedSec, basicDps, liveState, {
        pressure: pressure,
        enemyKey: enemyKeyForCtx || null
      });
      out.channelHoldRisk = hr;
      if (hr.penalty > 0) {
        out.total -= hr.penalty;
        for (let hi = 0; hi < hr.parts.length; hi += 1) {
          out.parts.push(hr.parts[hi]);
        }
      }
    }
    out.total = +out.total.toFixed(2);
    return out;
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
      if (opts.withBreakdown) {
        return {
          totalDamage: +chargePlan.horizonDamage.toFixed(2),
          skillPaper: Number.isFinite(chargePlan.releaseDamage) ? +chargePlan.releaseDamage.toFixed(2) : 0,
          skillPaperRaw: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
          skillShape: chargePlan.skillShape
            ? {
                totalDamage: Number.isFinite(chargePlan.skillShape.totalDamage) ? +chargePlan.skillShape.totalDamage.toFixed(2) : 0,
                immediateDamage: Number.isFinite(chargePlan.skillShape.immediateDamage) ? +chargePlan.skillShape.immediateDamage.toFixed(2) : 0,
                dotDamage: Number.isFinite(chargePlan.skillShape.dotDamage) ? +chargePlan.skillShape.dotDamage.toFixed(2) : 0
              }
            : {
                totalDamage: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
                immediateDamage: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
                dotDamage: 0
              },
          castBlockedSec: Number.isFinite(chargePlan.blockedSec) ? +chargePlan.blockedSec.toFixed(3) : +(Math.min(horizonSec, chargePlan.releaseSec || 0)).toFixed(3),
          followUp: {
            value: Number.isFinite(chargePlan.followUpActionValue) ? +chargePlan.followUpActionValue.toFixed(2) : 0,
            mode: chargePlan.followUpActionMode || "basic_only",
            slot: Number.isFinite(chargePlan.followUpActionSlot) ? chargePlan.followUpActionSlot : null
          },
          cooldownForecast: {
            cooldownSec: Number.isFinite(chargePlan.cooldownSec) ? chargePlan.cooldownSec : null,
            excessSec: Number.isFinite(chargePlan.cooldownExcessSec) ? chargePlan.cooldownExcessSec : null,
            penalty: Number.isFinite(chargePlan.cooldownOpportunityPenalty) ? chargePlan.cooldownOpportunityPenalty : 0,
            applied: Number.isFinite(chargePlan.cooldownOpportunityPenalty) ? chargePlan.cooldownOpportunityPenalty > 0 : false
          },
          contextAdjustment: chargePlan.contextAdjustment || {
            total: 0,
            pressure: plannerComputeOpenerDangerPressure(
              opts.liveState || null,
              opts.enemyKey && String(opts.enemyKey).trim() ? { enemyKey: String(opts.enemyKey).trim() } : null
            ),
            liveTargetHp: null,
            basicTtkSec: null,
            immediateDamage: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
            dotDamage: 0,
            parts: []
          },
          execute: chargePlan.execute || plannerComputeExecuteCandidate(
            {
              totalDamage: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
              immediateDamage: Number.isFinite(chargePlan.releaseDamageRaw) ? +chargePlan.releaseDamageRaw.toFixed(2) : 0,
              dotDamage: 0
            },
            Number.isFinite(chargePlan.releaseSec) ? chargePlan.releaseSec : 0,
            expectedBasicHit,
            opts.liveState || null
          ),
          chargePlan: chargePlan
        };
      }
      return chargePlan.horizonDamage;
    }
    const castBlocked =
      chargePlan && Number.isFinite(chargePlan.releaseSec) && chargePlan.releaseSec > 0
        ? Math.min(horizonSec, chargePlan.releaseSec)
        : (Number.isFinite(slot.castTimeSec) && slot.castTimeSec > 0 ? Math.min(horizonSec, slot.castTimeSec) : 0);
    const skillShape = plannerSummarizeSkillPaperDamageShape(slot, horizonSec, mobFactor, expectedBasicHit, chargePlan);
    const skillPaperRaw = skillShape.totalDamage;
    const liveTargetHp = plannerHorizonResolveLiveTargetHpCur(opts.liveState || null);
    const overkillWrap = plannerHorizonCapSkillDamageToTargetHp(skillPaperRaw, opts.liveState || null, "generic_opener");
    const skillPaper = overkillWrap.capped;
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
    const contextAdjustment = plannerComputeOpenerContextAdjustment(
      slot,
      castBlocked,
      skillShape,
      basicDps,
      expectedBasicHit,
      opts.liveState || null,
      enemyKey && String(enemyKey).trim() ? { enemyKey: String(enemyKey).trim() } : null
    );
    const execute = plannerComputeExecuteCandidate(skillShape, castBlocked, expectedBasicHit, opts.liveState || null);
    const totalDamage = skillPaper + followUp.value - cooldownForecast.penalty + contextAdjustment.total;
    if (opts.withBreakdown) {
      return {
        totalDamage: +totalDamage.toFixed(2),
        skillPaper: +skillPaper.toFixed(2),
        skillPaperRaw: +skillPaperRaw.toFixed(2),
        skillShape: {
          totalDamage: +skillShape.totalDamage.toFixed(2),
          immediateDamage: +skillShape.immediateDamage.toFixed(2),
          dotDamage: +skillShape.dotDamage.toFixed(2)
        },
        castBlockedSec: +castBlocked.toFixed(3),
        followUp: followUp,
        cooldownForecast: cooldownForecast,
        contextAdjustment: contextAdjustment,
        execute: execute,
        chargePlan: chargePlan
      };
    }
    return totalDamage;
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
        const score = plannerOpenerHorizonSkillPlusBasics(s, horizonSec, key, {
          liveState: liveState,
          withBreakdown: true,
          mpAvailable:
            liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid && Number.isFinite(liveState.player.mp.cur)
              ? liveState.player.mp.cur
              : null
        });
        const d = score && Number.isFinite(score.totalDamage) ? score.totalDamage : 0;
        const candMin = plannerResolveCandidateMinImprovementFraction(s, previewMinFrac, { defaultSource: previewMinFracSource });
        const candThreshold = baseline * (1 + candMin.minFrac);
        const cooldownForecast = plannerComputeCooldownForecastPenalty(s, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, previewMobFactor));
        const chargePlan = score && score.chargePlan ? score.chargePlan : plannerBuildChargeReleasePlan(s, {
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
          contextAdjustment: score && score.contextAdjustment ? score.contextAdjustment.total : 0,
          contextParts: score && score.contextAdjustment ? score.contextAdjustment.parts : [],
          contextPressure: score && score.contextAdjustment ? score.contextAdjustment.pressure : null,
          execute: score && score.execute ? score.execute : null,
          immediateSkillDamage: score && score.skillShape ? score.skillShape.immediateDamage : null,
          dotSkillDamage: score && score.skillShape ? score.skillShape.dotDamage : null,
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
  // AI CHANGED: Planner rewrite v1.2 — diagnostics no longer mutates Config via class-profile apply; uses pure compute instead so console inspection
  // never side-effects live planner config. The actual mutation still happens in `plannerPickSkillOpeningPick` where it belongs.
  function getPlannerOpeningPickDiagnostics() {
    const classProfile = plannerComputeClassProfile();
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
      basic_fallback_after_ranked: 0,
      queued_action_armed: 0,
      queued_action_fired: 0
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

  function plannerPickForcedOpenerCandidate(slots, exclude, forcedReq, mpCur, reserve, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
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
    if (opts.disallowChargeSkills && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(row)) {
      return {
        matched: null,
        detail: {
          requestedName: forcedReq.name,
          matchedName: row.name || "",
          slot: idx,
          source: forcedReq.source,
          forced: true,
          presentOnBar: true,
          reason: "charge_skill_disallowed"
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

  // AI CHANGED: Same lookahead depth as opener follow-up scoring — runtime queue still sends one bar click per step; depth only changes which skill wins “next queue”.
  function plannerResolveCombatQueueScoreDepth(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (Number.isFinite(opts.queueScoreDepth) && opts.queueScoreDepth >= 0) {
      return Math.floor(opts.queueScoreDepth);
    }
    if (Config.planner && Config.planner.openerFollowUpSkillQueueEnabled === false) {
      return 0;
    }
    const d = Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
      ? Math.floor(Config.planner.openerFollowUpSkillDepth)
      : 1;
    return Math.max(0, d);
  }

  // AI CHANGED: Runtime queue v1 — resolve the next buffered non-charge/basic combat action from the planner's follow-up scoring.
  function plannerBuildCombatQueueAction(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (Config.combat && Config.combat.combatQueueEnabled === false) {
      return null;
    }
    const disallowChargeSkills = opts.disallowChargeSkills !== false;
    const liveState = opts.liveState || readBasicState();
    const followUpHint = opts.followUpHint && typeof opts.followUpHint === "object" ? opts.followUpHint : null;
    let candidateMode = null;
    let candidateSlot = null;
    let candidateSource = null;
    if (followUpHint) {
      if (followUpHint.mode === "follow_up_skill" && Number.isFinite(followUpHint.slot)) {
        candidateMode = "follow_up_skill";
        candidateSlot = followUpHint.slot;
        candidateSource = "follow_up_hint";
      } else if (followUpHint.mode === "basic_only") {
        candidateMode = "basic_only";
        candidateSource = "follow_up_hint";
      }
    }
    if (!candidateMode) {
      const key = Runtime.enemy.lastFoughtKey || null;
      const paper = estimatePaperBasicAttackDps();
      const horizonMs = Number.isFinite(Config.planner && Config.planner.openerHorizonSimMs) ? Config.planner.openerHorizonSimMs : 5000;
      const horizonCtx = plannerResolveEffectiveOpenerHorizon(Math.max(0.001, horizonMs / 1000), key, paper, liveState);
      const horizonSec = horizonCtx && horizonCtx.effectiveHorizonSec > 0 ? horizonCtx.effectiveHorizonSec : Math.max(0.001, horizonMs / 1000);
      const followUp = plannerBestFollowUpActionValue(
        horizonSec,
        key,
        {
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : 0,
          expectedBasicHit: plannerExpectedBasicHitFromPaper(paper),
          mobFactor: plannerMobCalibrationFactorForKey(key)
        },
        {
          depth: plannerResolveCombatQueueScoreDepth(opts),
          excludeSlot: Number.isFinite(opts.afterSlot) ? opts.afterSlot : null,
          mpAvailable: Number.isFinite(opts.mpAvailable)
            ? opts.mpAvailable
            : (
                liveState &&
                liveState.player &&
                liveState.player.mp &&
                liveState.player.mp.valid &&
                Number.isFinite(liveState.player.mp.cur)
                  ? liveState.player.mp.cur
                  : null
              )
        }
      );
      if (followUp && followUp.mode === "follow_up_skill" && Number.isFinite(followUp.slot)) {
        candidateMode = "follow_up_skill";
        candidateSlot = followUp.slot;
        candidateSource = "planner_best_follow_up";
      } else {
        candidateMode = "basic_only";
        candidateSource = "planner_best_follow_up";
      }
    }
    if (candidateMode === "follow_up_skill" && Number.isFinite(candidateSlot)) {
      const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
      const row = slots[candidateSlot] || null;
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy || !plannerSkillHasDirectDamageForOpener(row)) {
        return {
          mode: "basic",
          slot: null,
          name: "Basic Attack",
          source: candidateSource ? candidateSource + "_fallback_basic" : "fallback_basic"
        };
      }
      if (Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
        if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(candidateSlot)) {
          return {
            mode: "basic",
            slot: null,
            name: "Basic Attack",
            source: candidateSource ? candidateSource + "_cooldown_basic" : "cooldown_basic"
          };
        }
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      if (manaCost > 0 && Number.isFinite(opts.mpAvailable) && opts.mpAvailable < manaCost) {
        return {
          mode: "basic",
          slot: null,
          name: "Basic Attack",
          source: candidateSource ? candidateSource + "_mp_basic" : "mp_basic"
        };
      }
      if (disallowChargeSkills && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(row)) {
        return {
          mode: "basic",
          slot: null,
          name: "Basic Attack",
          source: candidateSource ? candidateSource + "_charge_downgrade_basic" : "charge_downgrade_basic",
          downgradedFromSlot: candidateSlot
        };
      }
      return {
        mode: "skill",
        slot: candidateSlot,
        name: row.name || "",
        source: candidateSource || "planner_best_follow_up"
      };
    }
    return {
      mode: "basic",
      slot: null,
      name: "Basic Attack",
      source: candidateSource || "planner_basic_follow_up"
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AI CHANGED: Planner rewrite v1 (Part 1) — short-sequence combat planner foundation.
  //   - Builds a structured combat state model (player / target / fight / timing).
  //   - Normalizes attack skills with planner-side semantics (charge, debuff windows, AoE, tempo, control).
  //   - Runs a bounded beam search comparing 2–5-action sequences (not opener-only) over up to ~maxHorizonSec seconds.
  //   - Scores primarily by minimum expected time-to-kill (TTK); tie-breaks by lower HP loss / mana waste / better tempo.
  //   - Compatibility adapter returns { slot, record, chargeReleasePlan, queuedAction } so the existing executor stays stable for Part 1.
  // The legacy openerHorizonSim path remains as a fallback when the new planner cannot decide (no paper DPS, no candidates, etc.).
  // ───────────────────────────────────────────────────────────────────────────

  // AI CHANGED: Helper used to match planner semantic enrichment by normalized skill name (Sniper Shot / sniper_shot / sniper-shot all ⇒ "snipershot").
  function plannerSeqNormalizeSkillKey(name) {
    if (!name) {
      return "";
    }
    if (typeof normalizeSkillName === "function") {
      return normalizeSkillName(name).toLowerCase();
    }
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  // AI CHANGED: Best-effort cooldown readiness signal for planner state. Uses live action-bar DOM hint when available; falls back to "ready"
  // when scan cache says the slot is a skill (we never observed any "starting cooldown" for it). Planner search additionally simulates the skill's
  // own cooldown when reasoning about whether the same skill can fire twice in the short window.
  function plannerSeqSkillIsReadyNow(slotIdx, row) {
    if (!row || row.kind !== "skill") {
      return false;
    }
    if (Config.planner && Config.planner.skipOpenerWhenActionBarShowsCooldown !== false) {
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(slotIdx)) {
        return false;
      }
    }
    return true;
  }

  // AI CHANGED: Resolve archer-name-keyed semantic enrichment. Generic (class-agnostic) helper — encoding the skill's OWN effect semantics,
  // not combo recipes. Keys are normalized in `plannerSeqNormalizeSkillKey`.
  function plannerSeqResolveSemanticEnrichment(name) {
    const root = Config.planner && Config.planner.sequencePlanner ? Config.planner.sequencePlanner.archerSemantics : null;
    if (!root || typeof root !== "object") {
      return null;
    }
    const key = plannerSeqNormalizeSkillKey(name);
    if (!key) {
      return null;
    }
    if (key === "snipershot" && root.sniperShot) {
      return Object.assign({ __semKey: "snipershot" }, root.sniperShot);
    }
    if (key === "piercingstrike" && root.piercingStrike) {
      return Object.assign({ __semKey: "piercingstrike" }, root.piercingStrike);
    }
    if (key === "iceshard" && root.iceShard) {
      return Object.assign({ __semKey: "iceshard" }, root.iceShard);
    }
    if (key === "distractingshot" && root.distractingShot) {
      return Object.assign({ __semKey: "distractingshot" }, root.distractingShot);
    }
    if (key === "fanvolley" && root.fanVolley) {
      return Object.assign({ __semKey: "fanvolley" }, root.fanVolley);
    }
    if (key === "windydome" && root.windyDome) {
      return Object.assign({ __semKey: "windydome" }, root.windyDome);
    }
    return null;
  }

  // AI CHANGED: Build the planner-facing normalized representation of a single skill slot. Pulls together raw scan + master conception + parsed
  // effects + planner-side semantic enrichment so the simulator has one coherent view of what the skill DOES.
  // AI CHANGED: Planner rewrite v1.2 — typed damage normalization + Sniper Shot charge guarantee.
  //   Logic (bullet-list):
  //     • Per-effect typed mob-factor: `plannerHorizonPaperEffectiveMobFactor(mf, anchoring, damageType)` reproduces legacy horizon paper logic
  //       (full mf for basic-anchored basic_proc/channel_gear; blended `1 + (mf-1)*w` for instant/dot using physical vs magic weights).
  //     • `immediateDamageByType` and `dotPerSecByType` split damage so the simulator can boost ONLY the magic portion under magic-resist-shred
  //       instead of multiplying the entire damage tank.
  //     • Sniper Shot charge guarantee: if the normalized skill name resolves to `snipershot` and the parsed effects didn't expose `channel_gear`
  //       (parser miss / locale variant), force `isCharge = true` with a fallback `chargeMaxSec` (4s) and `chargeGearPct` (200) so the planner
  //       always generates full + partial release candidates. This is NOT combo hardcoding — it is guaranteeing the skill's OWN intrinsic charge
  //       semantics when the live parse cannot.
  function plannerSeqNormalizeOneSkill(row, paperBasic, mobFactor, expectedBasicHit) {
    if (!row || row.kind !== "skill") {
      return null;
    }
    const conception = (typeof plannerResolveSlotConception === "function" ? plannerResolveSlotConception(row) : (row.conception || null)) || null;
    const effects = Array.isArray(row.effects) ? row.effects : [];
    const mf = Number.isFinite(mobFactor) && mobFactor > 0 ? mobFactor : 1;
    const immediateDamageByType = { physical: 0, magic: 0, unknown: 0 };
    const dotPerSecByType = { physical: 0, magic: 0, unknown: 0 };
    let dotTotal = 0;
    let dotDurationSec = 0;
    let dominantDamageType = "unknown";
    let isAoe = false;
    let isControl = false;
    let controlDurationSec = 0;
    let isCharge = false;
    let chargeMaxSec = 0;
    let chargeGearPct = 0;
    function bucketKey(dt) {
      const d = typeof dt === "string" ? dt.toLowerCase() : "";
      if (d === "physical") return "physical";
      if (d === "magic") return "magic";
      return "unknown";
    }
    function typedMf(anchoring, dt) {
      if (typeof plannerHorizonPaperEffectiveMobFactor === "function") {
        return plannerHorizonPaperEffectiveMobFactor(mf, anchoring, dt);
      }
      return mf;
    }
    for (let i = 0; i < effects.length; i += 1) {
      const e = effects[i];
      if (!e || !e.type) {
        continue;
      }
      if (e.type === "instant" && Number.isFinite(e.value)) {
        const k = bucketKey(e.damageType);
        immediateDamageByType[k] += e.value * typedMf("non_basic", e.damageType);
        if (e.damageType) {
          dominantDamageType = e.damageType;
        }
      } else if (e.type === "dot" && Number.isFinite(e.total) && Number.isFinite(e.durationSec) && e.durationSec > 0) {
        dotTotal += e.total;
        dotDurationSec = Math.max(dotDurationSec, e.durationSec);
        const k = bucketKey(e.damageType);
        dotPerSecByType[k] += (e.total / e.durationSec) * typedMf("non_basic", e.damageType);
        if (e.damageType) {
          dominantDamageType = e.damageType;
        }
      } else if (e.type === "basic_proc") {
        if (Number.isFinite(expectedBasicHit) && expectedBasicHit > 0) {
          // basic_proc is basic-anchored — full mob factor regardless of typing (parser typically marks physical for archers).
          immediateDamageByType[bucketKey(e.damageType || "physical")] += expectedBasicHit * typedMf("basic", e.damageType || "physical");
        }
        if (e.damageType) {
          dominantDamageType = e.damageType;
        }
      } else if (e.type === "channel_gear") {
        isCharge = true;
        chargeMaxSec = Number.isFinite(e.channelMaxSec) ? e.channelMaxSec : chargeMaxSec;
        chargeGearPct = Number.isFinite(e.gearDamagePercent) ? e.gearDamagePercent : chargeGearPct;
        if (Number.isFinite(expectedBasicHit) && expectedBasicHit > 0) {
          // The base hit of a charge is basic-anchored.
          immediateDamageByType[bucketKey(e.damageType || "physical")] += expectedBasicHit * typedMf("basic", e.damageType || "physical");
        }
        if (e.damageType) {
          dominantDamageType = e.damageType;
        }
      } else if (e.type === "slow") {
        isControl = true;
        controlDurationSec = Math.max(controlDurationSec, Number.isFinite(e.durationSec) ? e.durationSec : 0);
      } else if (e.type === "stun") {
        isControl = true;
        controlDurationSec = Math.max(controlDurationSec, Number.isFinite(e.durationSec) ? e.durationSec : 0);
      }
    }
    if (conception && conception.flags) {
      if (conception.flags.slow || conception.flags.stun) {
        isControl = true;
      }
      if (conception.flags.channel) {
        isCharge = true;
      }
    }
    const sem = plannerSeqResolveSemanticEnrichment(row.name || "");
    if (sem) {
      if (sem.role === "aoe") {
        isAoe = true;
      }
    }
    // AI CHANGED: Planner rewrite v1.2 — Sniper Shot charge guarantee. If the parser missed `channel_gear` (locale variant, name format,
    // or scan-snapshot timing), force charge-capable normalization using the semantic enrichment config so the planner always sees full +
    // partial release candidates. We only do this for skills whose normalized identity is explicitly known charge skills.
    const normalizedKey = plannerSeqNormalizeSkillKey(row.name || "");
    if (normalizedKey === "snipershot") {
      isCharge = true;
      if (!(chargeMaxSec > 0)) {
        chargeMaxSec = 4;
      }
      if (!(chargeGearPct > 0)) {
        // Fallback gear multiplier — Sniper Shot scales with gear; without parse data we assume +200% at full release.
        chargeGearPct = 200;
      }
      // Ensure a sane minimum immediate-damage payload exists when the parser produced none (so partial vs full release scoring still compares).
      const totalImmediate = immediateDamageByType.physical + immediateDamageByType.magic + immediateDamageByType.unknown;
      if (totalImmediate <= 0 && Number.isFinite(expectedBasicHit) && expectedBasicHit > 0) {
        immediateDamageByType.physical += expectedBasicHit * typedMf("basic", "physical");
      }
    }
    const immediateDamage = +(immediateDamageByType.physical + immediateDamageByType.magic + immediateDamageByType.unknown).toFixed(2);
    const dotPerSec = +(dotPerSecByType.physical + dotPerSecByType.magic + dotPerSecByType.unknown).toFixed(3);
    return {
      slot: typeof row.slot === "number" ? row.slot : null,
      name: row.name || "",
      normalizedKey: normalizedKey,
      kind: row.kind,
      manaCost: Number.isFinite(row.manaCost) ? row.manaCost : 0,
      castTimeSec: Number.isFinite(row.castTimeSec) ? row.castTimeSec : 0,
      cooldownSec: Number.isFinite(row.cooldownSec) ? row.cooldownSec : 0,
      // damage shape (typed mob-factor already applied per effect):
      immediateDamage: immediateDamage,
      // AI CHANGED: Planner rewrite v1.2 — typed split so simulator can target only the magic portion for shred boost.
      immediateDamageByType: {
        physical: +immediateDamageByType.physical.toFixed(2),
        magic: +immediateDamageByType.magic.toFixed(2),
        unknown: +immediateDamageByType.unknown.toFixed(2)
      },
      dotTotal: +(dotTotal * mf).toFixed(2),
      dotDurationSec: +dotDurationSec.toFixed(2),
      dotPerSec: dotPerSec,
      dotPerSecByType: {
        physical: +dotPerSecByType.physical.toFixed(3),
        magic: +dotPerSecByType.magic.toFixed(3),
        unknown: +dotPerSecByType.unknown.toFixed(3)
      },
      damageType: dominantDamageType,
      // delivery / tactics:
      isAttack: !!(row.isAttack && row.targetsEnemy),
      isCharge: isCharge,
      chargeMaxSec: +chargeMaxSec.toFixed(2),
      chargeGearPct: chargeGearPct,
      isAoe: isAoe,
      isControl: isControl,
      controlDurationSec: +controlDurationSec.toFixed(2),
      // conception roles (level-invariant master/inferred):
      tacticalRoles: conception && Array.isArray(conception.tacticalRoles) ? conception.tacticalRoles.slice(0) : [],
      // semantic enrichment by skill OWN identity (NOT combo):
      semantic: sem,
      // sanity:
      hasDirectDamage: typeof plannerSkillHasDirectDamageForOpener === "function"
        ? plannerSkillHasDirectDamageForOpener(row)
        : (immediateDamage > 0 || dotTotal > 0)
    };
  }

  // AI CHANGED: Build normalized representations for all attack skills on the bar. Reused by combat-state model + sequence search.
  function plannerSeqBuildNormalizedSkills(opts) {
    const slots = (Runtime.skills && Array.isArray(Runtime.skills.slots)) ? Runtime.skills.slots : [];
    const paper = (opts && opts.paper) ? opts.paper : estimatePaperBasicAttackDps();
    const expectedBasicHit = Number.isFinite(opts && opts.expectedBasicHit)
      ? opts.expectedBasicHit
      : plannerExpectedBasicHitFromPaper(paper);
    const enemyKey = (opts && opts.enemyKey) || (Runtime.enemy && Runtime.enemy.lastFoughtKey) || null;
    const mobFactor = Number.isFinite(opts && opts.mobFactor)
      ? opts.mobFactor
      : plannerMobCalibrationFactorForKey(enemyKey);
    const out = [];
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill") {
        continue;
      }
      if (!row.isAttack || !row.targetsEnemy) {
        continue;
      }
      const norm = plannerSeqNormalizeOneSkill(row, paper, mobFactor, expectedBasicHit);
      if (norm) {
        out.push(norm);
      }
    }
    return out;
  }

  // AI CHANGED: Build the planner combat-state model. Used by sequence search + diagnostics. Best-effort: missing fields are nulled, not faked.
  function plannerSeqBuildCombatState(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const liveState = options.liveState || readBasicState();
    const paper = options.paper || estimatePaperBasicAttackDps();
    const expectedBasicHit = Number.isFinite(options.expectedBasicHit)
      ? options.expectedBasicHit
      : plannerExpectedBasicHitFromPaper(paper);
    const enemyKey = options.enemyKey || (Runtime.enemy && Runtime.enemy.lastFoughtKey) || null;
    const mobFactor = Number.isFinite(options.mobFactor)
      ? options.mobFactor
      : plannerMobCalibrationFactorForKey(enemyKey);
    const basicDps = paper && Number.isFinite(paper.dps) ? paper.dps : null;
    const adjustedBasicDps = Number.isFinite(basicDps) ? plannerAdjustedBasicDps(basicDps, mobFactor) : null;
    const swingIntervalMsFallback = Number.isFinite(Config.planner && Config.planner.sequencePlanner && Config.planner.sequencePlanner.basicSwingIntervalMsFallback)
      ? Config.planner.sequencePlanner.basicSwingIntervalMsFallback
      : 1000;
    let swingIntervalSec = 1;
    const aps = Runtime.hero && Runtime.hero.combatStats && Number.isFinite(Runtime.hero.combatStats.attackSpeed)
      ? Runtime.hero.combatStats.attackSpeed
      : null;
    if (Number.isFinite(aps) && aps > 0) {
      swingIntervalSec = +(1 / aps).toFixed(4);
    } else {
      swingIntervalSec = +(swingIntervalMsFallback / 1000).toFixed(4);
    }
    const playerHp = liveState && liveState.player && liveState.player.hp ? liveState.player.hp : { valid: false };
    const playerMp = liveState && liveState.player && liveState.player.mp ? liveState.player.mp : { valid: false };
    const combat = liveState && liveState.combat ? liveState.combat : {};
    const targetHp = combat && combat.targetHp ? combat.targetHp : { valid: false };
    const visibleEffects = typeof readTargetVisibleEffects === "function" ? readTargetVisibleEffects() : [];
    const attackersInfo = typeof readActiveAttackerCount === "function" ? readActiveAttackerCount() : null;
    const activeAttackerCount = attackersInfo && Number.isFinite(attackersInfo.count) ? attackersInfo.count : null;
    const enemyCount = combat && Number.isFinite(combat.enemyCount) ? combat.enemyCount : null;
    // recentHpLossPerSec from sustain telemetry — already incoming HP rate.
    const sustain = Runtime.autoFarm && Runtime.autoFarm.combatSustain ? Runtime.autoFarm.combatSustain : null;
    const incomingHpLossPerSec = sustain && Number.isFinite(sustain.recentHpLossPerSec) && sustain.recentHpLossPerSec > 0
      ? sustain.recentHpLossPerSec
      : 0;
    // Pressure estimate — additive bundle in the spirit of openerContext but living inside the combat state model.
    const effActiveAttackers = Number.isFinite(activeAttackerCount) ? activeAttackerCount : (Number.isFinite(enemyCount) ? enemyCount : 0);
    const playerHpPct = playerHp.valid && Number.isFinite(playerHp.pct) ? playerHp.pct : null;
    let pressure = Math.max(0, effActiveAttackers - 1);
    if (Number.isFinite(playerHpPct) && playerHpPct < 0.65) {
      pressure += (0.65 - playerHpPct) * 2;
    }
    if (incomingHpLossPerSec > 0 && playerHp.valid && Number.isFinite(playerHp.max) && playerHp.max > 0) {
      pressure += Math.min(2.5, (incomingHpLossPerSec / playerHp.max) * 8);
    }
    pressure = +pressure.toFixed(3);
    // Translate visible effects → semantic flags
    const targetFlags = {
      hasMagicResistShred: false,
      hasSlow: false,
      hasDistract: false,
      magicResistShredRemainingSec: 0,
      slowRemainingSec: 0,
      distractRemainingSec: 0
    };
    for (let i = 0; i < visibleEffects.length; i += 1) {
      const e = visibleEffects[i];
      if (!e) {
        continue;
      }
      const id = (e.id || "").toLowerCase();
      const rem = Number.isFinite(e.remainingSec) ? e.remainingSec : 0;
      // ID matching is best-effort; we only flag when ID hints at a known semantic.
      if (id.indexOf("pierc") >= 0 || id.indexOf("magicresist") >= 0 || id.indexOf("shred") >= 0) {
        targetFlags.hasMagicResistShred = true;
        targetFlags.magicResistShredRemainingSec = Math.max(targetFlags.magicResistShredRemainingSec, rem);
      }
      if (id.indexOf("iceshard") >= 0 || id.indexOf("slow") >= 0 || id.indexOf("ice") >= 0) {
        targetFlags.hasSlow = true;
        targetFlags.slowRemainingSec = Math.max(targetFlags.slowRemainingSec, rem);
      }
      if (id.indexOf("distract") >= 0) {
        targetFlags.hasDistract = true;
        targetFlags.distractRemainingSec = Math.max(targetFlags.distractRemainingSec, rem);
      }
    }
    // self buffs (longSelfTracked) for awareness — read-only snapshot.
    const longSelf = Runtime.autoFarm && Runtime.autoFarm.supportBuffLine && Runtime.autoFarm.supportBuffLine.longSelfTracked
      ? Runtime.autoFarm.supportBuffLine.longSelfTracked
      : {};
    const longSelfList = [];
    const longSelfKeys = Object.keys(longSelf);
    for (let k = 0; k < longSelfKeys.length; k += 1) {
      const v = longSelf[longSelfKeys[k]];
      if (v && typeof v === "object") {
        longSelfList.push({
          key: longSelfKeys[k],
          assumedExpiresAt: v.assumedExpiresAt || null,
          remainingSec: v.assumedExpiresAt && Number.isFinite(v.assumedExpiresAt)
            ? Math.max(0, +((v.assumedExpiresAt - Date.now()) / 1000).toFixed(2))
            : null
        });
      }
    }
    // basicAttackUnderway is best-effort: if there are active attackers AND find-enemy just retargeted, the game often auto-starts a basic.
    const queue = Runtime.autoFarm && Runtime.autoFarm.combatQueue ? Runtime.autoFarm.combatQueue : null;
    const basicAttackLikelyUnderway = !!(queue && queue.postRetargetGuarded === true) || (effActiveAttackers >= 1 && enemyCount && enemyCount >= 1);
    const maxHorizonSec = Number.isFinite(Config.planner && Config.planner.sequencePlanner && Config.planner.sequencePlanner.maxHorizonSec)
      ? Config.planner.sequencePlanner.maxHorizonSec
      : 6;
    const maxActions = Number.isFinite(Config.planner && Config.planner.sequencePlanner && Config.planner.sequencePlanner.maxActions)
      ? Config.planner.sequencePlanner.maxActions
      : 5;
    const combatMode = Runtime.autoFarm && Runtime.autoFarm.combatMode ? Runtime.autoFarm.combatMode : "fast";
    return {
      builtAt: Date.now(),
      mode: combatMode,
      player: {
        hpCur: playerHp.valid ? playerHp.cur : null,
        hpMax: playerHp.valid ? playerHp.max : null,
        hpPct: playerHpPct,
        mpCur: playerMp.valid ? playerMp.cur : null,
        mpMax: playerMp.valid ? playerMp.max : null,
        mpPct: playerMp.valid && Number.isFinite(playerMp.pct) ? playerMp.pct : null,
        basicSwingIntervalSec: swingIntervalSec,
        expectedBasicHit: Number.isFinite(expectedBasicHit) ? +expectedBasicHit.toFixed(2) : null,
        basicDpsAdjusted: Number.isFinite(adjustedBasicDps) ? +adjustedBasicDps.toFixed(2) : null,
        basicAttackLikelyUnderway: basicAttackLikelyUnderway,
        longSelfBuffs: longSelfList
      },
      target: {
        hpCur: targetHp.valid && Number.isFinite(targetHp.cur) ? targetHp.cur : null,
        hpMax: targetHp.valid && Number.isFinite(targetHp.max) ? targetHp.max : null,
        hpPct: targetHp.valid && Number.isFinite(targetHp.pct) ? targetHp.pct : null,
        visibleEffects: visibleEffects,
        flags: targetFlags,
        fingerprintKey: enemyKey
      },
      fight: {
        enemiesPresent: Number.isFinite(enemyCount) ? enemyCount : null,
        activeAttackerCount: Number.isFinite(activeAttackerCount) ? activeAttackerCount : null,
        activeAttackerSource: attackersInfo ? attackersInfo.source : null,
        pressure: pressure,
        incomingHpLossPerSec: +incomingHpLossPerSec.toFixed(3),
        combatMode: combatMode
      },
      timing: {
        nowMs: Date.now(),
        maxHorizonSec: maxHorizonSec,
        maxActions: maxActions
      },
      paperBasicDps: Number.isFinite(basicDps) ? +basicDps.toFixed(2) : null,
      mobFactor: Number.isFinite(mobFactor) ? +mobFactor.toFixed(4) : 1
    };
  }

  // AI CHANGED: Snapshot for diagnostics (does NOT advance simulator); used by `getPlannerCombatState`.
  function getPlannerCombatState(opts) {
    return plannerSeqBuildCombatState(opts || null);
  }

  // AI CHANGED: Snapshot for diagnostics; used by `getPlannerNormalizedSkills`.
  function getPlannerNormalizedSkills(opts) {
    return plannerSeqBuildNormalizedSkills(opts || null);
  }

  // AI CHANGED: Build candidate actions from current sim state. For each skill ready + mana-affordable, generate at least one action.
  // Charge skills additionally generate a partial-release variant so the planner can compare full vs partial release directly.
  // AI CHANGED: Planner rewrite v1.1 — `opts.excludeSlots` (Set of slot indexes) is honored INSIDE candidate generation at all depths so
  // excluded slots never appear in any sequence position (matches legacy openerHorizonSim hard-exclude semantics).
  function plannerSeqBuildCandidateActions(simState, normalizedSkills, opts) {
    const out = [];
    out.push({
      kind: "basic",
      name: "Basic Attack",
      slot: null
    });
    const allowCharge = !(opts && opts.disallowChargeSkills === true);
    // AI CHANGED: Planner rewrite v1.1 — accept Set or Array via excludeSlots so callers can pass either shape; depth-0 + deeper depths filter equally.
    let excludeSlots = null;
    if (opts && opts.excludeSlots instanceof Set) {
      excludeSlots = opts.excludeSlots;
    } else if (opts && Array.isArray(opts.excludeSlots) && opts.excludeSlots.length > 0) {
      excludeSlots = new Set();
      for (let ex = 0; ex < opts.excludeSlots.length; ex += 1) {
        const v = opts.excludeSlots[ex];
        if (typeof v === "number" && v >= 0) {
          excludeSlots.add(v);
        }
      }
      if (excludeSlots.size === 0) {
        excludeSlots = null;
      }
    }
    // AI CHANGED: Planner rewrite v1.1 — fix latent bug: simState is FLAT (`playerMpCur`); previous code read `simState.player.mpCur` which threw
    // a TypeError silently swallowed by the outer try/catch in plannerPickSkillOpeningPick, causing the new sequence planner to never actually run
    // in production. Read the flat field instead. Falls back to `simState.player?.mpCur` only when a caller hand-builds a nested-shape state.
    const mpCur = Number.isFinite(simState.playerMpCur)
      ? simState.playerMpCur
      : (simState.player && Number.isFinite(simState.player.mpCur) ? simState.player.mpCur : null);
    for (let i = 0; i < normalizedSkills.length; i += 1) {
      const s = normalizedSkills[i];
      if (!s || !s.isAttack || !s.hasDirectDamage) {
        continue;
      }
      // AI CHANGED: Planner rewrite v1.1 — slot excluded for this burst (e.g. recent click failure / target-swap retry); skip entirely.
      if (excludeSlots && typeof s.slot === "number" && excludeSlots.has(s.slot)) {
        continue;
      }
      // Cooldown gate from sim cooldowns (set after each cast simulation).
      const cdReady = simState.skillCooldownReadyAtSec[s.slot] == null
        ? true
        : (simState.elapsedSec >= simState.skillCooldownReadyAtSec[s.slot]);
      if (!cdReady) {
        continue;
      }
      // Initial live-DOM cooldown hint (only honored at depth 0 where state.elapsedSec == 0).
      if (simState.elapsedSec === 0 && !plannerSeqSkillIsReadyNow(s.slot, Runtime.skills.slots[s.slot])) {
        continue;
      }
      // Mana gate.
      if (s.manaCost > 0) {
        if (!Number.isFinite(mpCur) || mpCur < s.manaCost) {
          continue;
        }
      }
      if (s.isCharge && !allowCharge) {
        continue;
      }
      if (s.isCharge && s.chargeMaxSec > 0) {
        // Full charge variant + partial-release variant.
        out.push({
          kind: "skill_charge",
          chargeMode: "full",
          chargeReleaseFraction: 1,
          name: s.name,
          slot: s.slot,
          skill: s
        });
        const partialFrac = Number.isFinite(Config.planner && Config.planner.sequencePlanner && Config.planner.sequencePlanner.chargePartialReleaseFraction)
          ? Math.max(0.1, Math.min(0.95, Config.planner.sequencePlanner.chargePartialReleaseFraction))
          : 0.55;
        out.push({
          kind: "skill_charge",
          chargeMode: "partial",
          chargeReleaseFraction: partialFrac,
          name: s.name,
          slot: s.slot,
          skill: s
        });
      } else {
        out.push({
          kind: "skill",
          name: s.name,
          slot: s.slot,
          skill: s
        });
      }
    }
    return out;
  }

  // AI CHANGED: Simulate one action against simState; returns a fresh simState (immutable shape). All timing/HP/damage math lives here so
  // the search code can stay declarative.
  // AI CHANGED: Planner rewrite v1.2 — basic-attack timing model is now CONSERVATIVE and schedule-based, not "free basics during cast":
  //   • `nextBasicReadyAtSec` is a scheduled-arrival timestamp for the next auto-basic.
  //   • `basicAttackLikelyUnderway` (carried from combat state) materially affects the model: when true at depth 0, the game's auto-basic is
  //     mid-flight and lands at the start of the first action. When false (cold start), no auto-basic is credited until the planner explicitly
  //     issues a `basic` action.
  //   • During a `skill` or `skill_charge` action's cast/channel window, auto-basics are SUPPRESSED in-game; the simulator credits no basics
  //     during cast and reschedules `nextBasicReadyAtSec = end_of_action + swingInterval` (so a basic that "would have" landed during cast is
  //     consumed by the cast, matching observed behavior). This is the conservative model the user explicitly requested.
  //   • Carry-over: when `simState.basicAttackLikelyUnderway === true` AND the action is a skill/charge AND `nextBasicReadyAtSec` has already
  //     elapsed (or is exactly at start), credit ONE auto-basic at the START of the action. This is the only "free" basic the simulator credits.
  //   • A `basic` action remains an explicit one-swing action; it consumes `swingInterval`, deals `expectedBasicHit * mobFactor`, and the next
  //     auto-basic is scheduled `swingInterval` after it.
  // AI CHANGED: Planner rewrite v1.2 — typed shred handling is now SURGICAL:
  //   • Skills carry `immediateDamageByType` (and `dotPerSecByType`) from normalization so the simulator can boost ONLY the magic portion of
  //     a skill's damage when magic-resist-shred is active. Previously the boost multiplied the WHOLE damage even when only part of it was
  //     magic-typed, which over-credited multi-type skills and made shred follow-up feel handwavy.
  function plannerSeqSimulateAction(simState, action) {
    const next = {
      elapsedSec: simState.elapsedSec,
      playerHpCur: simState.playerHpCur,
      playerHpMax: simState.playerHpMax,
      playerMpCur: simState.playerMpCur,
      playerMpMax: simState.playerMpMax,
      targetHpCur: simState.targetHpCur,
      targetHpMax: simState.targetHpMax,
      enemyCount: simState.enemyCount,
      activeAttackers: simState.activeAttackers,
      pressure: simState.pressure,
      incomingHpLossPerSec: simState.incomingHpLossPerSec,
      basicSwingIntervalSec: simState.basicSwingIntervalSec,
      expectedBasicHit: simState.expectedBasicHit,
      basicAttackLikelyUnderway: simState.basicAttackLikelyUnderway,
      skillCooldownReadyAtSec: Object.assign({}, simState.skillCooldownReadyAtSec),
      targetFlags: {
        hasMagicResistShred: simState.targetFlags.hasMagicResistShred,
        hasSlow: simState.targetFlags.hasSlow,
        hasDistract: simState.targetFlags.hasDistract,
        magicResistShredRemainingSec: simState.targetFlags.magicResistShredRemainingSec,
        slowRemainingSec: simState.targetFlags.slowRemainingSec,
        distractRemainingSec: simState.targetFlags.distractRemainingSec
      },
      lastActionTimeSec: simState.lastActionTimeSec,
      mpWasted: simState.mpWasted,
      hpLost: simState.hpLost,
      mobFactor: simState.mobFactor,
      // AI CHANGED: Planner rewrite v1.2 — schedule-based basic-swing model. Carries scheduled arrival time of the next auto-basic plus telemetry totals.
      nextBasicReadyAtSec: Number.isFinite(simState.nextBasicReadyAtSec)
        ? simState.nextBasicReadyAtSec
        : (Number.isFinite(simState.basicSwingIntervalSec) && simState.basicSwingIntervalSec > 0 ? simState.basicSwingIntervalSec : 1),
      extraBasicSwingsTotal: Number.isFinite(simState.extraBasicSwingsTotal) ? simState.extraBasicSwingsTotal : 0,
      extraBasicDamageTotal: Number.isFinite(simState.extraBasicDamageTotal) ? simState.extraBasicDamageTotal : 0
    };
    const swingInterval = next.basicSwingIntervalSec > 0 ? next.basicSwingIntervalSec : 1;
    let actionTimeSec = 0;
    let damageDealt = 0;
    let action2 = Object.assign({}, action);
    // AI CHANGED: Planner rewrite v1.2 — carry-over auto-basic credit (the ONE case where the simulator credits an "interleaved" basic): when the
    // hero entered the sim with `basicAttackLikelyUnderway === true` AND the planner's first action is a skill/charge, credit one auto-basic at
    // the start of that action. After this single credit the underway flag is cleared so the rest of the sequence is fully under the planner's control.
    let extraBasicSwings = 0;
    let extraBasicDamage = 0;
    const interleaveEnabled = !(
      Config.planner &&
      Config.planner.sequencePlanner &&
      Config.planner.sequencePlanner.simBasicSwingsBetweenActions === false
    );
    if (
      interleaveEnabled &&
      simState.basicAttackLikelyUnderway === true &&
      (action.kind === "skill" || action.kind === "skill_charge") &&
      Number.isFinite(next.expectedBasicHit) &&
      next.expectedBasicHit > 0 &&
      // The carry-over basic only counts when it would have landed at-or-before the action's start (which is `simState.elapsedSec`).
      next.nextBasicReadyAtSec <= simState.elapsedSec + 1e-9
    ) {
      const hit = next.expectedBasicHit * (Number.isFinite(next.mobFactor) ? next.mobFactor : 1);
      damageDealt += hit;
      extraBasicSwings += 1;
      extraBasicDamage += hit;
    }
    if (action.kind === "basic") {
      actionTimeSec = swingInterval;
      if (Number.isFinite(next.expectedBasicHit)) {
        damageDealt += next.expectedBasicHit * (Number.isFinite(next.mobFactor) ? next.mobFactor : 1);
      }
    } else if (action.kind === "skill" && action.skill) {
      const s = action.skill;
      actionTimeSec = Math.max(0.1, s.castTimeSec || 0);
      damageDealt += s.immediateDamage;
      // DoT — count only the portion that lands inside the remaining sim horizon.
      if (s.dotPerSec > 0 && s.dotDurationSec > 0) {
        const remHorizon = (Config.planner.sequencePlanner.maxHorizonSec || 6) - (next.elapsedSec + actionTimeSec);
        const dotWindow = Math.max(0, Math.min(s.dotDurationSec, remHorizon));
        damageDealt += s.dotPerSec * dotWindow;
      }
      // AI CHANGED: Planner rewrite v1.2 — typed shred boost. Apply ONLY to the magic-typed portion of this skill's damage instead of
      // multiplying the whole damageDealt. `immediateDamageByType.magic` is populated at normalization time when an effect's `damageType === "magic"`.
      if (next.targetFlags.hasMagicResistShred) {
        const boost = Number.isFinite(Config.planner.sequencePlanner.archerSemantics && Config.planner.sequencePlanner.archerSemantics.piercingStrike && Config.planner.sequencePlanner.archerSemantics.piercingStrike.followUpMagicDamageBoost)
          ? Config.planner.sequencePlanner.archerSemantics.piercingStrike.followUpMagicDamageBoost
          : 0.2;
        const byType = s.immediateDamageByType || null;
        const magicImmediate = byType && Number.isFinite(byType.magic) ? byType.magic : 0;
        if (magicImmediate > 0) {
          damageDealt += magicImmediate * boost;
        } else if (!byType && s.damageType === "magic" && Number.isFinite(s.immediateDamage) && s.immediateDamage > 0) {
          // Back-compat path for hand-built skills in tests/synthetic state without `immediateDamageByType`.
          damageDealt += s.immediateDamage * boost;
        }
        // DoT magic portion within the lingering shred window.
        const dotByType = s.dotPerSecByType || null;
        const magicDotPerSec = dotByType && Number.isFinite(dotByType.magic) ? dotByType.magic : 0;
        if (magicDotPerSec > 0 && s.dotDurationSec > 0) {
          const remHorizon2 = (Config.planner.sequencePlanner.maxHorizonSec || 6) - (next.elapsedSec + actionTimeSec);
          const dotWindow2 = Math.max(0, Math.min(s.dotDurationSec, remHorizon2));
          // Shred boost only counts for the part of the DoT inside the shred remaining window — clamp by `magicResistShredRemainingSec`.
          const shredOverlapSec = Math.max(0, Math.min(dotWindow2, next.targetFlags.magicResistShredRemainingSec));
          if (shredOverlapSec > 0) {
            damageDealt += magicDotPerSec * shredOverlapSec * boost;
          }
        }
      }
      // AoE: planner's target is a single fingerprint, but AoE still kills faster against multi-mob; we add a fraction of "extra hit damage" against extras.
      if (s.isAoe && Number.isFinite(next.enemyCount) && next.enemyCount > 1) {
        // We do not reduce our own target's HP for extras; the AoE benefit is encoded later in survival pressure relief.
      }
      // Mana spend.
      if (s.manaCost > 0) {
        if (Number.isFinite(next.playerMpCur)) {
          next.playerMpCur = Math.max(0, next.playerMpCur - s.manaCost);
        }
      }
      // Self cooldown.
      if (s.cooldownSec > 0 && Number.isFinite(s.slot)) {
        next.skillCooldownReadyAtSec[s.slot] = next.elapsedSec + actionTimeSec + s.cooldownSec;
      }
      // Semantic side-effects (debuffs/tempo).
      const sem = s.semantic;
      if (sem) {
        if (sem.__semKey === "piercingstrike") {
          next.targetFlags.hasMagicResistShred = true;
          next.targetFlags.magicResistShredRemainingSec = Math.max(
            next.targetFlags.magicResistShredRemainingSec,
            Number.isFinite(sem.debuffDurationSec) ? sem.debuffDurationSec : 15
          );
        } else if (sem.__semKey === "iceshard") {
          next.targetFlags.hasSlow = true;
          next.targetFlags.slowRemainingSec = Math.max(
            next.targetFlags.slowRemainingSec,
            Number.isFinite(sem.slowDurationSec) ? sem.slowDurationSec : 5
          );
        } else if (sem.__semKey === "distractingshot") {
          next.targetFlags.hasDistract = true;
          next.targetFlags.distractRemainingSec = Math.max(
            next.targetFlags.distractRemainingSec,
            Number.isFinite(sem.distractDurationSec) ? sem.distractDurationSec : 6
          );
        }
      }
    } else if (action.kind === "skill_charge" && action.skill) {
      const s = action.skill;
      const releaseFraction = Math.max(0.1, Math.min(1, Number.isFinite(action.chargeReleaseFraction) ? action.chargeReleaseFraction : 1));
      const chargeSec = Math.max(0.1, (s.chargeMaxSec || 1) * releaseFraction);
      actionTimeSec = chargeSec;
      // base + gear contribution scaled by release fraction.
      const baseHit = s.immediateDamage || 0;
      const gearMultiplier = 1 + ((s.chargeGearPct || 0) / 100) * releaseFraction;
      damageDealt += baseHit * gearMultiplier;
      if (s.dotPerSec > 0 && s.dotDurationSec > 0) {
        const remHorizon = (Config.planner.sequencePlanner.maxHorizonSec || 6) - (next.elapsedSec + actionTimeSec);
        const dotWindow = Math.max(0, Math.min(s.dotDurationSec, remHorizon));
        damageDealt += s.dotPerSec * dotWindow;
      }
      if (s.manaCost > 0 && Number.isFinite(next.playerMpCur)) {
        next.playerMpCur = Math.max(0, next.playerMpCur - s.manaCost);
      }
      if (s.cooldownSec > 0 && Number.isFinite(s.slot)) {
        next.skillCooldownReadyAtSec[s.slot] = next.elapsedSec + actionTimeSec + s.cooldownSec;
      }
      action2.simChargeSec = +chargeSec.toFixed(3);
    }
    next.extraBasicSwingsTotal += extraBasicSwings;
    next.extraBasicDamageTotal += extraBasicDamage;
    action2.extraBasicSwings = extraBasicSwings;
    action2.extraBasicDamage = +extraBasicDamage.toFixed(2);
    // Apply damage to target.
    if (Number.isFinite(next.targetHpCur)) {
      next.targetHpCur = Math.max(0, next.targetHpCur - damageDealt);
    }
    // Player HP loss model. Distract removes one active attacker for the distract window. Slow reduces incoming damage.
    const incoming = next.incomingHpLossPerSec;
    let effectiveIncoming = incoming;
    if (next.targetFlags.hasSlow) {
      const slowReduction = Config.planner.sequencePlanner.archerSemantics.iceShard && Number.isFinite(Config.planner.sequencePlanner.archerSemantics.iceShard.incomingDamageReductionFraction)
        ? Config.planner.sequencePlanner.archerSemantics.iceShard.incomingDamageReductionFraction
        : 0.3;
      effectiveIncoming = effectiveIncoming * (1 - slowReduction);
    }
    let effectiveActiveAttackers = next.activeAttackers;
    if (next.targetFlags.hasDistract && effectiveActiveAttackers > 0) {
      const relief = Config.planner.sequencePlanner.archerSemantics.distractingShot && Number.isFinite(Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount)
        ? Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount
        : 1;
      effectiveActiveAttackers = Math.max(0, effectiveActiveAttackers - relief);
      // Scale incoming by the ratio of remaining attackers.
      if (next.activeAttackers > 0) {
        effectiveIncoming = effectiveIncoming * (effectiveActiveAttackers / next.activeAttackers);
      }
    }
    if (Number.isFinite(next.playerHpCur) && effectiveIncoming > 0) {
      const lost = effectiveIncoming * actionTimeSec;
      next.playerHpCur = Math.max(0, next.playerHpCur - lost);
      next.hpLost += lost;
    }
    // Decay debuff durations.
    next.targetFlags.magicResistShredRemainingSec = Math.max(0, next.targetFlags.magicResistShredRemainingSec - actionTimeSec);
    if (next.targetFlags.magicResistShredRemainingSec <= 0) {
      next.targetFlags.hasMagicResistShred = false;
    }
    next.targetFlags.slowRemainingSec = Math.max(0, next.targetFlags.slowRemainingSec - actionTimeSec);
    if (next.targetFlags.slowRemainingSec <= 0) {
      next.targetFlags.hasSlow = false;
    }
    next.targetFlags.distractRemainingSec = Math.max(0, next.targetFlags.distractRemainingSec - actionTimeSec);
    if (next.targetFlags.distractRemainingSec <= 0) {
      next.targetFlags.hasDistract = false;
    }
    next.elapsedSec += actionTimeSec;
    next.lastActionTimeSec = actionTimeSec;
    // AI CHANGED: Planner rewrite v1.2 — schedule the next auto-basic after this action resolves.
    //   • basic action: next swing one cycle after the swing landed.
    //   • skill / skill_charge: the cast/channel preempts AA in-game; next auto-basic is one cycle after the cast ends.
    next.nextBasicReadyAtSec = next.elapsedSec + swingInterval;
    // Taking any explicit action consumes the "basic-likely-underway" hint exactly once (either credited as carry-over above or burned by the cast).
    next.basicAttackLikelyUnderway = false;
    // Track tempo / mana waste tiebreaks.
    if (action.kind !== "basic" && action.skill && action.skill.manaCost > 0) {
      if (Number.isFinite(next.targetHpCur) && next.targetHpCur <= 0) {
        // overkill mana waste — anything spent past kill counts as waste.
        next.mpWasted += 0;
      }
    }
    return { next: next, action: action2, damageDealt: damageDealt, actionTimeSec: actionTimeSec };
  }

  // AI CHANGED: Beam search over short action sequences. Returns top sequences sorted best-first.
  function plannerSeqSearchSequences(combatState, normalizedSkills, opts) {
    const sp = Config.planner && Config.planner.sequencePlanner ? Config.planner.sequencePlanner : {};
    const beamWidth = Number.isFinite(sp.beamWidth) ? sp.beamWidth : 12;
    const maxActions = Number.isFinite(sp.maxActions) ? sp.maxActions : 5;
    const maxHorizonSec = Number.isFinite(sp.maxHorizonSec) ? sp.maxHorizonSec : 6;
    const disallowCharge = opts && opts.disallowChargeSkills === true;
    const initialSimState = {
      elapsedSec: 0,
      playerHpCur: combatState.player.hpCur,
      playerHpMax: combatState.player.hpMax,
      playerMpCur: combatState.player.mpCur,
      playerMpMax: combatState.player.mpMax,
      targetHpCur: combatState.target.hpCur,
      targetHpMax: combatState.target.hpMax,
      enemyCount: combatState.fight.enemiesPresent,
      activeAttackers: Number.isFinite(combatState.fight.activeAttackerCount) ? combatState.fight.activeAttackerCount : (Number.isFinite(combatState.fight.enemiesPresent) ? combatState.fight.enemiesPresent : 0),
      pressure: combatState.fight.pressure,
      incomingHpLossPerSec: combatState.fight.incomingHpLossPerSec,
      basicSwingIntervalSec: combatState.player.basicSwingIntervalSec,
      expectedBasicHit: combatState.player.expectedBasicHit,
      basicAttackLikelyUnderway: combatState.player.basicAttackLikelyUnderway,
      skillCooldownReadyAtSec: {},
      targetFlags: Object.assign({}, combatState.target.flags),
      lastActionTimeSec: 0,
      mpWasted: 0,
      hpLost: 0,
      mobFactor: combatState.mobFactor,
      // AI CHANGED: Planner rewrite v1.2 — schedule-based basic-swing accounting.
      //   • When `basicAttackLikelyUnderway` is true the in-flight game auto-basic is essentially "now" (next swing at 0s); the simulator
      //     uses this to credit ONE carry-over basic if the planner's first action is a skill/charge (see plannerSeqSimulateAction).
      //   • Otherwise (cold start), the next auto-basic would be one full swing-interval away — but it never lands unless the planner
      //     explicitly issues a `basic` action. This matches the user-requested conservative model.
      nextBasicReadyAtSec: combatState.player && combatState.player.basicAttackLikelyUnderway === true
        ? 0
        : (Number.isFinite(combatState.player && combatState.player.basicSwingIntervalSec) && combatState.player.basicSwingIntervalSec > 0
            ? combatState.player.basicSwingIntervalSec
            : 1),
      extraBasicSwingsTotal: 0,
      extraBasicDamageTotal: 0
    };
    let beam = [{
      sim: initialSimState,
      actions: [],
      cumulativeDamage: 0,
      killedAtSec: null
    }];
    const completed = [];
    for (let depth = 0; depth < maxActions; depth += 1) {
      const expanded = [];
      for (let b = 0; b < beam.length; b += 1) {
        const node = beam[b];
        if (node.killedAtSec !== null) {
          completed.push(node);
          continue;
        }
        if (node.sim.elapsedSec >= maxHorizonSec) {
          completed.push(node);
          continue;
        }
        // AI CHANGED: Planner rewrite v1.1 — forward `excludeSlots` (set/array) into candidate generation so excluded slots never appear at any depth.
        const candidates = plannerSeqBuildCandidateActions(node.sim, normalizedSkills, {
          disallowChargeSkills: disallowCharge,
          excludeSlots: opts && opts.excludeSlots ? opts.excludeSlots : null
        });
        for (let c = 0; c < candidates.length; c += 1) {
          const cand = candidates[c];
          // AI CHANGED: Planner rewrite v1.2 — capture a PRE-action snapshot from node.sim so semantic tie-breaks can read the simulated moment
          // when this action would fire (target HP %, effective attackers, pressure, etc.) instead of always reading the initial combat state.
          const preTargetHpPct = Number.isFinite(node.sim.targetHpCur) && Number.isFinite(node.sim.targetHpMax) && node.sim.targetHpMax > 0
            ? +(node.sim.targetHpCur / node.sim.targetHpMax).toFixed(4)
            : null;
          const prePlayerHpPct = Number.isFinite(node.sim.playerHpCur) && Number.isFinite(node.sim.playerHpMax) && node.sim.playerHpMax > 0
            ? +(node.sim.playerHpCur / node.sim.playerHpMax).toFixed(4)
            : null;
          const preDistractReliefCount = Config.planner.sequencePlanner.archerSemantics && Config.planner.sequencePlanner.archerSemantics.distractingShot && Number.isFinite(Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount)
            ? Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount
            : 1;
          const preEffectiveActiveAttackers = Number.isFinite(node.sim.activeAttackers)
            ? Math.max(0, node.sim.activeAttackers - (node.sim.targetFlags && node.sim.targetFlags.hasDistract ? preDistractReliefCount : 0))
            : null;
          const preSnapshot = {
            elapsedSec: +node.sim.elapsedSec.toFixed(3),
            targetHpPct: preTargetHpPct,
            playerHpPct: prePlayerHpPct,
            pressure: Number.isFinite(node.sim.pressure) ? +node.sim.pressure.toFixed(3) : null,
            activeAttackers: Number.isFinite(node.sim.activeAttackers) ? node.sim.activeAttackers : null,
            effectiveActiveAttackers: preEffectiveActiveAttackers,
            enemyCount: Number.isFinite(node.sim.enemyCount) ? node.sim.enemyCount : null,
            hasMagicResistShred: !!(node.sim.targetFlags && node.sim.targetFlags.hasMagicResistShred),
            hasSlow: !!(node.sim.targetFlags && node.sim.targetFlags.hasSlow),
            hasDistract: !!(node.sim.targetFlags && node.sim.targetFlags.hasDistract),
            basicAttackLikelyUnderway: node.sim.basicAttackLikelyUnderway === true
          };
          const stepped = plannerSeqSimulateAction(node.sim, cand);
          const nextNode = {
            sim: stepped.next,
            actions: node.actions.concat([{
              kind: cand.kind,
              name: cand.name,
              slot: cand.slot,
              skill: cand.skill ? { slot: cand.skill.slot, name: cand.skill.name, normalizedKey: cand.skill.normalizedKey, damageType: cand.skill.damageType } : null,
              chargeMode: cand.chargeMode || null,
              chargeReleaseFraction: Number.isFinite(cand.chargeReleaseFraction) ? cand.chargeReleaseFraction : null,
              actionTimeSec: +stepped.actionTimeSec.toFixed(3),
              damageDealt: +stepped.damageDealt.toFixed(2),
              // AI CHANGED: Planner rewrite v1.2 — carry-over basic telemetry per step (1 only when basicAttackLikelyUnderway credited it at depth 0).
              extraBasicSwings: Number.isFinite(stepped.action.extraBasicSwings) ? stepped.action.extraBasicSwings : 0,
              extraBasicDamage: Number.isFinite(stepped.action.extraBasicDamage) ? stepped.action.extraBasicDamage : 0,
              // AI CHANGED: Planner rewrite v1.2 — pre-action simulated snapshot so scoring uses the current sequence moment, not just initial combat state.
              pre: preSnapshot
            }]),
            cumulativeDamage: node.cumulativeDamage + stepped.damageDealt,
            killedAtSec: null
          };
          if (sp.pruneIfTargetDead !== false && Number.isFinite(nextNode.sim.targetHpCur) && nextNode.sim.targetHpCur <= 0 && node.killedAtSec === null) {
            nextNode.killedAtSec = +nextNode.sim.elapsedSec.toFixed(3);
            completed.push(nextNode);
            continue;
          }
          expanded.push(nextNode);
        }
      }
      // Score + prune to beamWidth.
      const scored = expanded.map(function (n) {
        return Object.assign({}, n, { _provisionalScore: plannerSeqScoreNode(n, combatState) });
      });
      scored.sort(function (a, b) {
        return a._provisionalScore - b._provisionalScore;
      });
      beam = scored.slice(0, beamWidth);
      if (beam.length === 0) {
        break;
      }
    }
    for (let b = 0; b < beam.length; b += 1) {
      completed.push(beam[b]);
    }
    const finalScored = completed.map(function (n) {
      return Object.assign({}, n, { _finalScore: plannerSeqScoreNode(n, combatState) });
    });
    finalScored.sort(function (a, b) {
      return a._finalScore - b._finalScore;
    });
    return finalScored;
  }

  // AI CHANGED: Score a sequence node. Primary objective: minimize expected time-to-kill. Secondary tiebreaks: lower HP loss, lower MP waste,
  // better tempo. Returns a single number — LOWER is BETTER.
  function plannerSeqScoreNode(node, combatState) {
    const sp = Config.planner && Config.planner.sequencePlanner ? Config.planner.sequencePlanner : {};
    const sim = node.sim;
    const targetHpMax = sim.targetHpMax || combatState.target.hpMax || 1;
    let ttkSec;
    if (node.killedAtSec !== null && Number.isFinite(node.killedAtSec)) {
      ttkSec = node.killedAtSec;
    } else {
      // Project remaining HP / basic DPS for tail.
      const baseDps = combatState.player.basicDpsAdjusted;
      const remHp = Number.isFinite(sim.targetHpCur) ? sim.targetHpCur : targetHpMax;
      if (Number.isFinite(baseDps) && baseDps > 0) {
        ttkSec = sim.elapsedSec + (remHp / baseDps);
      } else {
        ttkSec = sim.elapsedSec + 12; // unknown DPS — large but bounded penalty.
      }
    }
    // Survival floor breach penalty.
    let survivalPenaltySec = 0;
    if (Number.isFinite(sim.playerHpCur) && Number.isFinite(sim.playerHpMax) && sim.playerHpMax > 0) {
      const ratio = sim.playerHpCur / sim.playerHpMax;
      const floor = Number.isFinite(sp.survivalMinHpRatio) ? sp.survivalMinHpRatio : 0.18;
      if (ratio < floor) {
        const breach = (floor - ratio) / Math.max(0.01, floor);
        const penaltyBase = Number.isFinite(sp.survivalBreachPenaltySec) ? sp.survivalBreachPenaltySec : 8;
        survivalPenaltySec = penaltyBase * (1 + breach);
      }
      if (sim.playerHpCur <= 0) {
        survivalPenaltySec += 25;
      }
    }
    // HP-loss tiebreak — scaled by hpMax so it stays comparable across hero levels.
    const hpLossRatio = Number.isFinite(sim.playerHpMax) && sim.playerHpMax > 0 ? (sim.hpLost / sim.playerHpMax) : 0;
    const tieHpLossSec = (Number.isFinite(sp.tieBreakHpLossPerHpMaxSec) ? sp.tieBreakHpLossPerHpMaxSec : 1.5) * Math.max(0, hpLossRatio);
    // MP waste tiebreak — discourage spending lots of MP when overkill is already obvious.
    const mpSpent = Math.max(0, (combatState.player.mpCur || 0) - (Number.isFinite(sim.playerMpCur) ? sim.playerMpCur : 0));
    let mpWaste = 0;
    if (node.killedAtSec !== null) {
      const overkill = Math.max(0, (node.cumulativeDamage - targetHpMax) / Math.max(1, targetHpMax));
      mpWaste = mpSpent * overkill;
    }
    const tieMpWasteSec = (Number.isFinite(sp.tieBreakMpWasteCoefSec) ? sp.tieBreakMpWasteCoefSec : 0.0008) * mpWaste;
    // Tempo tiebreak — prefer shorter actual elapsed time when TTK is similar.
    const tieTempoSec = (Number.isFinite(sp.tieBreakTempoCoefSec) ? sp.tieBreakTempoCoefSec : 0.05) * sim.elapsedSec;
    // Skill-own semantic nudges. (NOT combos — just intrinsic skill traits.)
    // AI CHANGED: Planner rewrite v1.2 — semantic tie-breaks now consult per-action `pre` simulated state (target HP %, effective attackers,
    // pressure, enemy count) so e.g. Sniper Shot rewards a finisher window EARNED earlier in the sequence, and Distracting Shot value reflects
    // the simulated attacker pressure at the moment of cast. When `pre` is missing (legacy callers / hand-built nodes), we fall back to the
    // initial combatState values so behavior is back-compat.
    let semanticAdjSec = 0;
    function preOrInitialNum(pre, preKey, initial, fallback) {
      if (pre && Number.isFinite(pre[preKey])) {
        return pre[preKey];
      }
      if (Number.isFinite(initial)) {
        return initial;
      }
      return fallback;
    }
    for (let i = 0; i < node.actions.length; i += 1) {
      const a = node.actions[i];
      if (!a || !a.skill || !a.skill.normalizedKey) {
        continue;
      }
      const sem = plannerSeqResolveSemanticEnrichment(a.skill.name || "");
      if (!sem) {
        continue;
      }
      const pre = a.pre || null;
      if (sem.__semKey === "snipershot") {
        // Penalize full-charge under pressure — use simulated pressure at moment-of-cast (pre-snapshot) when available, else initial.
        const isFullCharge = a.chargeMode === "full" || (a.chargeReleaseFraction != null && a.chargeReleaseFraction >= 0.95);
        const effPressure = preOrInitialNum(pre, "pressure", combatState.fight.pressure, 0);
        if (isFullCharge && effPressure >= 1) {
          semanticAdjSec += Number.isFinite(sem.chargeFullPressurePenaltySec) ? sem.chargeFullPressurePenaltySec : 1.6;
        }
        // Reward as finisher when target HP is low AT THE TIME this action fires — this is the most simulation-sensitive case (the planner
        // can EARN a finisher window over the previous actions in the sequence and the bonus then unlocks the Sniper Shot).
        const effTargetHpPct = pre && Number.isFinite(pre.targetHpPct)
          ? pre.targetHpPct
          : (Number.isFinite(combatState.target.hpPct) ? combatState.target.hpPct : null);
        if (Number.isFinite(effTargetHpPct) && effTargetHpPct <= (Number.isFinite(sem.finisherTargetHpPctMax) ? sem.finisherTargetHpPctMax : 0.45)) {
          semanticAdjSec -= Number.isFinite(sem.finisherBonusSec) ? sem.finisherBonusSec : 0.8;
        }
      } else if (sem.__semKey === "distractingshot") {
        // Use simulated effective attacker count + pressure at the moment of cast.
        const effAttackers = pre && Number.isFinite(pre.effectiveActiveAttackers)
          ? pre.effectiveActiveAttackers
          : (Number.isFinite(combatState.fight.activeAttackerCount) ? combatState.fight.activeAttackerCount : 0);
        const effPressure = preOrInitialNum(pre, "pressure", combatState.fight.pressure, 0);
        // Bad calm opener (low pressure, fresh target, single attacker). Use elapsedSec === 0 instead of index so a Distracting Shot inserted
        // later in the sequence is judged on the simulated moment, not its array index.
        const isOpenerMoment = pre ? pre.elapsedSec === 0 : (i === 0);
        if (isOpenerMoment && effPressure < 0.5 && effAttackers <= 1) {
          semanticAdjSec += Number.isFinite(sem.calmOpenerPenaltySec) ? sem.calmOpenerPenaltySec : 1.4;
        }
        // Good under active-attacker pressure (>=2). Use simulated values so distract repeats / mid-sequence casts can still be valued.
        if (effAttackers >= 2 || effPressure >= 1.2) {
          semanticAdjSec -= Number.isFinite(sem.pressureReliefBonusSec) ? sem.pressureReliefBonusSec : 1.2;
        }
      } else if (sem.__semKey === "fanvolley") {
        // Penalize when only one enemy / one attacker (true AoE wasted) AND mana heavy — use simulated enemy/attacker counts from pre state.
        const effEnemyCount = pre && Number.isFinite(pre.enemyCount)
          ? pre.enemyCount
          : (Number.isFinite(combatState.fight.enemiesPresent) ? combatState.fight.enemiesPresent : 0);
        const effActiveAttackers = pre && Number.isFinite(pre.effectiveActiveAttackers)
          ? pre.effectiveActiveAttackers
          : (Number.isFinite(combatState.fight.activeAttackerCount) ? combatState.fight.activeAttackerCount : 0);
        if (effEnemyCount <= 1) {
          semanticAdjSec += Number.isFinite(sem.singleTargetMisusePenaltySec) ? sem.singleTargetMisusePenaltySec : 1.8;
        }
        if (effActiveAttackers <= 1 && effEnemyCount <= 2) {
          semanticAdjSec += Number.isFinite(sem.mpHeavyPenaltySec) ? sem.mpHeavyPenaltySec : 0.4;
        }
      }
    }
    return +(ttkSec + survivalPenaltySec + tieHpLossSec + tieMpWasteSec + tieTempoSec + semanticAdjSec).toFixed(4);
  }

  // AI CHANGED: Compose results — short summary, action list, kill prediction, survival summary.
  function plannerSeqDescribeNode(node, combatState) {
    return {
      actions: node.actions,
      cumulativeDamage: +node.cumulativeDamage.toFixed(2),
      predictedKillAtSec: node.killedAtSec,
      finalTargetHp: Number.isFinite(node.sim.targetHpCur) ? +node.sim.targetHpCur.toFixed(2) : null,
      finalPlayerHp: Number.isFinite(node.sim.playerHpCur) ? +node.sim.playerHpCur.toFixed(2) : null,
      finalPlayerMp: Number.isFinite(node.sim.playerMpCur) ? +node.sim.playerMpCur.toFixed(2) : null,
      finalElapsedSec: +node.sim.elapsedSec.toFixed(3),
      simHpLost: +node.sim.hpLost.toFixed(2),
      score: node._finalScore != null ? node._finalScore : node._provisionalScore,
      survivalSummary: {
        playerHpPctEnd: Number.isFinite(node.sim.playerHpCur) && Number.isFinite(node.sim.playerHpMax) && node.sim.playerHpMax > 0
          ? +(node.sim.playerHpCur / node.sim.playerHpMax).toFixed(4)
          : null,
        pressureStart: combatState.fight.pressure
      }
    };
  }

  // AI CHANGED: Diagnostics-only — preview top candidate sequences. Read-only; safe to call from console at any time.
  function previewPlannerSequences(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const combatState = plannerSeqBuildCombatState(opts);
    const normalizedSkills = plannerSeqBuildNormalizedSkills(opts);
    if (normalizedSkills.length === 0) {
      return {
        ok: false,
        reason: "no_normalized_skills",
        combatState: combatState
      };
    }
    const seqs = plannerSeqSearchSequences(combatState, normalizedSkills, {
      disallowChargeSkills: opts.disallowChargeSkills === true
    });
    const top = seqs.slice(0, 6).map(function (n) {
      return plannerSeqDescribeNode(n, combatState);
    });
    return {
      ok: true,
      combatState: combatState,
      normalizedSkills: normalizedSkills,
      topSequences: top,
      bestSequence: top[0] || null
    };
  }

  // AI CHANGED: Sequence-planner ENTRY POINT. Returns adapter-shape pick (or null when planner cannot decide / no skills).
  // Also stores last decision in Runtime.planner.lastSequencePlan for diagnostics.
  // AI CHANGED: Planner rewrite v1.1 — `opts.excludeSlots` (Set or Array of slot indexes) is now honored INSIDE sequence search; excluded slots
  // never appear as the first action OR any later action, matching legacy openerHorizonSim hard-exclude semantics so alternate-opener retries can
  // safely ask the new planner for a next-best allowed sequence instead of silently falling back to the legacy planner.
  function plannerSelectSequencePick(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const sp = Config.planner && Config.planner.sequencePlanner ? Config.planner.sequencePlanner : {};
    if (Config.planner.useSequencePlannerFoundation === false) {
      return null;
    }
    if (sp.enabled === false) {
      return null;
    }
    // AI CHANGED: Planner rewrite v1.1 — normalize excludeSlots once into a Set, then pass to depth-0 feasibility check and the full beam search.
    let excludeSlots = null;
    if (opts.excludeSlots instanceof Set) {
      excludeSlots = opts.excludeSlots;
    } else if (Array.isArray(opts.excludeSlots) && opts.excludeSlots.length > 0) {
      excludeSlots = new Set();
      for (let ex = 0; ex < opts.excludeSlots.length; ex += 1) {
        const v = opts.excludeSlots[ex];
        if (typeof v === "number" && v >= 0) {
          excludeSlots.add(v);
        }
      }
      if (excludeSlots.size === 0) {
        excludeSlots = null;
      }
    }
    const combatState = plannerSeqBuildCombatState(opts);
    if (!combatState || combatState.fight.combatMode === "easy") {
      // In Easy mode, the sequence planner is intentionally bypassed — combat path uses basic only via existing gates.
      return null;
    }
    const normalizedSkills = plannerSeqBuildNormalizedSkills(opts);
    if (!Array.isArray(normalizedSkills) || normalizedSkills.length === 0) {
      return null;
    }
    // Mana / cooldown gate: at least one feasible candidate must exist at depth 0.
    // AI CHANGED: Planner rewrite v1.1 — pass excludeSlots here so the depth-0 feasibility check matches what the beam search will actually expand.
    const initialSim = {
      elapsedSec: 0,
      playerMpCur: combatState.player.mpCur,
      skillCooldownReadyAtSec: {}
    };
    const initialActions = plannerSeqBuildCandidateActions(initialSim, normalizedSkills, {
      disallowChargeSkills: opts.disallowChargeSkills === true,
      excludeSlots: excludeSlots
    });
    const hasFeasibleSkill = initialActions.some(function (a) { return a.kind === "skill" || a.kind === "skill_charge"; });
    if (!hasFeasibleSkill) {
      // No skill actually fires now — let caller fall back to basic.
      Runtime.planner.lastSequencePlan = {
        ok: false,
        reason: "no_feasible_skill_at_depth0",
        combatState: combatState,
        candidates: initialActions,
        excludeSlotsApplied: excludeSlots ? Array.from(excludeSlots) : null
      };
      return null;
    }
    const seqs = plannerSeqSearchSequences(combatState, normalizedSkills, {
      disallowChargeSkills: opts.disallowChargeSkills === true,
      excludeSlots: excludeSlots
    });
    if (!seqs || seqs.length === 0) {
      Runtime.planner.lastSequencePlan = {
        ok: false,
        reason: "no_sequences_returned",
        combatState: combatState,
        excludeSlotsApplied: excludeSlots ? Array.from(excludeSlots) : null
      };
      return null;
    }
    const best = seqs[0];
    const firstAction = best.actions[0];
    const secondAction = best.actions.length > 1 ? best.actions[1] : null;
    const diagnosticTop = seqs.slice(0, 5).map(function (n) {
      return plannerSeqDescribeNode(n, combatState);
    });
    Runtime.planner.lastSequencePlan = {
      ok: true,
      builtAt: Date.now(),
      combatState: combatState,
      normalizedSkillCount: normalizedSkills.length,
      bestSequence: plannerSeqDescribeNode(best, combatState),
      topSequences: diagnosticTop,
      firstAction: firstAction || null,
      secondActionHint: secondAction || null,
      excludeSlotsApplied: excludeSlots ? Array.from(excludeSlots) : null
    };
    if (Config.planner.sequencePlanner && Config.planner.sequencePlanner.debugLog === true) {
      Logger.log("PLANNER", "sequencePlanner pick", Runtime.planner.lastSequencePlan);
    }
    return {
      combatState: combatState,
      best: best,
      firstAction: firstAction,
      secondAction: secondAction,
      normalizedSkills: normalizedSkills,
      excludeSlotsApplied: excludeSlots ? Array.from(excludeSlots) : null
    };
  }

  // AI CHANGED: Compatibility adapter — translate a sequence-planner pick into the legacy { slot, record, chargeReleasePlan, queuedAction } shape
  // the current combat executor consumes. Returns null when first action is basic (caller falls through to basic-only path).
  function plannerAdaptSequencePickToOpenerShape(seqPick) {
    if (!seqPick || !seqPick.firstAction) {
      return null;
    }
    const first = seqPick.firstAction;
    if (first.kind === "basic") {
      return { adapted: null, reason: "first_action_basic" };
    }
    if (!first.skill || typeof first.skill.slot !== "number") {
      return null;
    }
    const slots = (Runtime.skills && Array.isArray(Runtime.skills.slots)) ? Runtime.skills.slots : [];
    const record = slots[first.skill.slot] || null;
    if (!record || record.kind !== "skill") {
      return null;
    }
    // Charge release plan — derive from existing helper, optionally overriding releaseMs for partial-release.
    let chargeReleasePlan = null;
    if (first.kind === "skill_charge" && typeof plannerBuildChargeReleasePlan === "function") {
      // Use existing helper for shape, then override release fraction when partial.
      const liveState = readBasicState();
      const builtPlan = plannerBuildChargeReleasePlan(record, {
        horizonSec: Number.isFinite(seqPick.combatState && seqPick.combatState.timing && seqPick.combatState.timing.maxHorizonSec)
          ? seqPick.combatState.timing.maxHorizonSec
          : null,
        enemyKey: seqPick.combatState && seqPick.combatState.target ? seqPick.combatState.target.fingerprintKey : null,
        liveState: liveState,
        mpAvailable: seqPick.combatState && seqPick.combatState.player ? seqPick.combatState.player.mpCur : null
      });
      if (builtPlan && first.chargeMode === "partial" && Number.isFinite(first.chargeReleaseFraction) && Number.isFinite(builtPlan.channelMaxMs)) {
        const overrideMs = Math.max(1, Math.round(builtPlan.channelMaxMs * first.chargeReleaseFraction));
        const minHoldRaw = Config.combat && Number.isFinite(Config.combat.chargeSkillReleaseMinHoldMs)
          ? Config.combat.chargeSkillReleaseMinHoldMs
          : 0;
        const minHoldMs = Math.max(0, Math.min(Math.round(minHoldRaw), builtPlan.channelMaxMs));
        const finalReleaseMs = Math.max(minHoldMs, Math.min(builtPlan.channelMaxMs, overrideMs));
        builtPlan.releaseMs = finalReleaseMs;
        builtPlan.releaseSec = +(finalReleaseMs / 1000).toFixed(3);
        builtPlan.releaseFraction = +(finalReleaseMs / builtPlan.channelMaxMs).toFixed(4);
        builtPlan.releaseSource = "sequencePlanner_partial_release";
        builtPlan.strategy = finalReleaseMs >= builtPlan.channelMaxMs ? "full_charge" : "cancel_release";
        builtPlan.selectionMode = "sequence_planner_override";
      }
      chargeReleasePlan = builtPlan || null;
    } else if (typeof plannerBuildChargeReleasePlan === "function") {
      chargeReleasePlan = plannerBuildChargeReleasePlan(record, {
        enemyKey: seqPick.combatState && seqPick.combatState.target ? seqPick.combatState.target.fingerprintKey : null,
        liveState: readBasicState(),
        mpAvailable: seqPick.combatState && seqPick.combatState.player ? seqPick.combatState.player.mpCur : null
      });
    }
    // Queued follow-up action — use second-action hint if it is a skill/charge; otherwise let plannerBuildCombatQueueAction decide.
    let queuedAction = null;
    const second = seqPick.secondAction;
    if (second && (second.kind === "skill" || second.kind === "skill_charge") && second.skill && typeof second.skill.slot === "number") {
      const followUpHint = {
        mode: "follow_up_skill",
        slot: second.skill.slot,
        value: null
      };
      queuedAction = typeof plannerBuildCombatQueueAction === "function"
        ? plannerBuildCombatQueueAction({
            afterSlot: first.skill.slot,
            liveState: readBasicState(),
            followUpHint: followUpHint,
            mpAvailable: seqPick.combatState && seqPick.combatState.player && Number.isFinite(seqPick.combatState.player.mpCur)
              ? Math.max(0, seqPick.combatState.player.mpCur - (Number.isFinite(record.manaCost) ? record.manaCost : 0))
              : null,
            disallowChargeSkills: true
          })
        : null;
    } else {
      queuedAction = typeof plannerBuildCombatQueueAction === "function"
        ? plannerBuildCombatQueueAction({
            afterSlot: first.skill.slot,
            liveState: readBasicState(),
            mpAvailable: seqPick.combatState && seqPick.combatState.player && Number.isFinite(seqPick.combatState.player.mpCur)
              ? Math.max(0, seqPick.combatState.player.mpCur - (Number.isFinite(record.manaCost) ? record.manaCost : 0))
              : null,
            disallowChargeSkills: true
          })
        : null;
    }
    return {
      adapted: {
        slot: first.skill.slot,
        record: record,
        chargeReleasePlan: chargeReleasePlan,
        queuedAction: queuedAction
      },
      reason: "ok"
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // End planner rewrite v1 foundation.
  // ───────────────────────────────────────────────────────────────────────────

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
    // AI CHANGED: refresh sustain-derived incoming-damage rate before opener scoring reads `combatSustain.recentHpLossPerSec`.
    if (typeof updateCombatSustainObservations === "function") {
      updateCombatSustainObservations(st);
    }
    const mpCur = st.player.mp && st.player.mp.valid ? st.player.mp.cur : null;
    const disallowChargeSkills =
      opts.disallowChargeSkills === true &&
      !(opts.forceSkillName && typeof opts.forceSkillName === "string" && opts.forceSkillName.trim());
    const breakdown = {
      mp: 0,
      cooldown: 0,
      exclude: 0,
      chargeGuard: 0,
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
      if (disallowChargeSkills && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(s)) {
        breakdown.chargeGuard += 1;
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
    if (disallowChargeSkills && breakdown.chargeGuard > 0) {
      Logger.log("PLANNER", "Post-retarget no-charge guard filtered charge opener candidates", {
        filteredChargeSkills: breakdown.chargeGuard,
        excludedSlots: exclude.size
      });
    }

    if (candidates.length === 0) {
      pr.lastOpeningPickReason = "all_candidates_filtered";
      pr.lastOpeningPickDetail = {
        breakdown: breakdown,
        mpCur: mpCur,
        skillMpReserve: reserve,
        excludedCount: exclude.size,
        postRetargetNoChargeGuard: disallowChargeSkills
      };
      plannerMaybeLogOpeningPickFailure("all_candidates_filtered", pr.lastOpeningPickDetail);
      return null;
    }

    // AI CHANGED: Planner rewrite v1 — sequence-planner foundation runs FIRST and is the new core decision engine.
    //   - When it returns a usable adapter shape, we use it as the canonical pick.
    //   - When it cannot decide (Easy mode, no feasible skill, no normalized skills, no paper DPS), we fall back to legacy openerHorizonSim.
    //   - Forced-opener test path is still honored AFTER the sequence-planner adapter (when applicable) for runUiTestBundle's forced tests.
    const forcedReq = plannerBuildForcedOpenerRequest(opts);
    if (
      !forcedReq &&
      Config.planner.useSequencePlannerFoundation !== false &&
      Config.planner.sequencePlanner &&
      Config.planner.sequencePlanner.enabled !== false
    ) {
      try {
        // AI CHANGED: Planner rewrite v1.1 — forward the same `exclude` Set used by the legacy filter so the new sequence planner
        // can avoid excluded slots INSIDE search instead of only catching them after adaptation, preserving alternate-opener retry behavior.
        const seqPick = plannerSelectSequencePick({
          disallowChargeSkills: disallowChargeSkills,
          excludeSlots: exclude,
          liveState: st
        });
        if (seqPick) {
          const adapterOut = plannerAdaptSequencePickToOpenerShape(seqPick);
          if (adapterOut) {
            if (adapterOut.adapted) {
              const pickedSlot = adapterOut.adapted.slot;
              const pickedRecord = adapterOut.adapted.record;
              if (typeof pickedSlot === "number" && pickedRecord && pickedRecord.kind === "skill" && !exclude.has(pickedSlot)) {
                pr.lastOpeningPickReason = "picked";
                pr.lastOpeningPickDetail = {
                  source: "sequence_planner_v1",
                  slot: pickedSlot,
                  name: pickedRecord.name || "",
                  chargeReleasePlan: adapterOut.adapted.chargeReleasePlan || null,
                  queuedAction: adapterOut.adapted.queuedAction || null,
                  bestSequence: Runtime.planner.lastSequencePlan && Runtime.planner.lastSequencePlan.bestSequence
                    ? Runtime.planner.lastSequencePlan.bestSequence
                    : null,
                  topSequences: Runtime.planner.lastSequencePlan && Runtime.planner.lastSequencePlan.topSequences
                    ? Runtime.planner.lastSequencePlan.topSequences
                    : null,
                  filteredOut: {
                    cooldown: breakdown.cooldown,
                    mpGate: breakdown.mp,
                    noDirectDamage: breakdown.noDirectDamage,
                    excluded: breakdown.exclude,
                    chargeGuard: breakdown.chargeGuard
                  },
                  postRetargetNoChargeGuard: disallowChargeSkills,
                  // AI CHANGED: Planner rewrite v1.1 — surface excluded slots that the sequence planner honored, so retry-loop callers can verify.
                  excludeSlotsApplied: exclude && exclude.size ? Array.from(exclude) : null
                };
                return {
                  slot: pickedSlot,
                  record: pickedRecord,
                  chargeReleasePlan: adapterOut.adapted.chargeReleasePlan || null,
                  queuedAction: adapterOut.adapted.queuedAction || null
                };
              }
            } else if (adapterOut.reason === "first_action_basic") {
              // Sequence planner explicitly recommends starting with a basic — let the basic-fallback path take over.
              pr.lastOpeningPickReason = "sequence_planner_prefers_basic";
              pr.lastOpeningPickDetail = {
                source: "sequence_planner_v1",
                bestSequence: Runtime.planner.lastSequencePlan && Runtime.planner.lastSequencePlan.bestSequence
                  ? Runtime.planner.lastSequencePlan.bestSequence
                  : null,
                topSequences: Runtime.planner.lastSequencePlan && Runtime.planner.lastSequencePlan.topSequences
                  ? Runtime.planner.lastSequencePlan.topSequences
                  : null,
                filteredOut: {
                  cooldown: breakdown.cooldown,
                  mpGate: breakdown.mp,
                  noDirectDamage: breakdown.noDirectDamage,
                  excluded: breakdown.exclude,
                  chargeGuard: breakdown.chargeGuard
                },
                postRetargetNoChargeGuard: disallowChargeSkills
              };
              return null;
            }
          }
        }
      } catch (seqErr) {
        Logger.warn("PLANNER", "sequence planner threw — falling back to legacy openerHorizonSim", {
          error: String(seqErr && seqErr.message ? seqErr.message : seqErr)
        });
      }
    }

    if (forcedReq) {
      const forcedPick = plannerPickForcedOpenerCandidate(slots, exclude, forcedReq, mpCur, reserve, {
        disallowChargeSkills: disallowChargeSkills
      });
      if (forcedPick && forcedPick.matched) {
        const forcedPaper = estimatePaperBasicAttackDps();
        const forcedMobFactor = plannerMobCalibrationFactorForKey(key);
        const forcedExpectedBasicHit = plannerExpectedBasicHitFromPaper(forcedPaper);
        const forcedChargePlan = plannerBuildChargeReleasePlan(forcedPick.matched.record, {
          horizonSec: Number.isFinite(Config.planner && Config.planner.openerHorizonSimMs) ? (Config.planner.openerHorizonSimMs / 1000) : 5,
          enemyKey: key,
          liveState: st,
          paper: forcedPaper,
          basicDps: forcedPaper && Number.isFinite(forcedPaper.dps) ? forcedPaper.dps : null,
          expectedBasicHit: forcedExpectedBasicHit,
          mobFactor: forcedMobFactor,
          mpAvailable: mpCur
        });
        const forcedQueuedAction = plannerBuildCombatQueueAction({
          afterSlot: forcedPick.matched.idx,
          liveState: st,
          followUpHint: forcedChargePlan && Number.isFinite(forcedChargePlan.followUpActionValue)
            ? {
                value: forcedChargePlan.followUpActionValue,
                mode: forcedChargePlan.followUpActionMode || "basic_only",
                slot: Number.isFinite(forcedChargePlan.followUpActionSlot) ? forcedChargePlan.followUpActionSlot : null
              }
            : null,
          mpAvailable: Number.isFinite(mpCur)
            ? Math.max(0, mpCur - (Number.isFinite(forcedPick.matched.record.manaCost) ? forcedPick.matched.record.manaCost : 0))
            : null,
          disallowChargeSkills: true
        });
        pr.lastOpeningPickReason = "forced_for_test";
        pr.lastOpeningPickDetail = Object.assign({}, forcedPick.detail, {
          chargeReleasePlan: forcedChargePlan,
          queuedAction: forcedQueuedAction,
          postRetargetNoChargeGuard: disallowChargeSkills
        });
        return {
          slot: forcedPick.matched.idx,
          record: forcedPick.matched.record,
          chargeReleasePlan: forcedChargePlan,
          queuedAction: forcedQueuedAction
        };
      }
      if (forcedPick && forcedPick.detail) {
        pr.lastOpeningPickDetail = {
          forcedOpenerSkipped: forcedPick.detail,
          breakdown: breakdown,
          mpCur: mpCur,
        skillMpReserve: reserve,
        postRetargetNoChargeGuard: disallowChargeSkills
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
        const score = plannerOpenerHorizonSkillPlusBasics(cand.record, horizonSec, key, {
          liveState: st,
          paper: paper,
          mobFactor: horizonMobFactor,
          expectedBasicHit: expectedBasicHit,
          withBreakdown: true,
          mpAvailable: mpCur
        });
        const d = score && Number.isFinite(score.totalDamage) ? score.totalDamage : 0;
        const candMin = plannerResolveCandidateMinImprovementFraction(cand.record, minFrac, { defaultSource: minFracSource });
        const candThreshold = baselineTotal * (1 + candMin.minFrac);
        const cooldownForecast =
          score && score.cooldownForecast && typeof score.cooldownForecast === "object"
            ? score.cooldownForecast
            : plannerComputeCooldownForecastPenalty(
                cand.record,
                horizonSec,
                plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor)
              );
        const passesThreshold = d > candThreshold;
        scored.push({
          slot: cand.idx,
          name: cand.record.name || "",
          damage: +d.toFixed(2),
          threshold: +candThreshold.toFixed(2),
          thresholdPct: +(candMin.minFrac * 100).toFixed(2),
          thresholdSource: candMin.source,
          contextAdjustment: score && score.contextAdjustment ? score.contextAdjustment.total : 0,
          contextParts: score && score.contextAdjustment ? score.contextAdjustment.parts : [],
          contextPressure: score && score.contextAdjustment ? score.contextAdjustment.pressure : null,
          execute: score && score.execute ? score.execute : null,
          followUp: score && score.followUp ? score.followUp : { value: 0, mode: "basic_only", slot: null },
          immediateSkillDamage: score && score.skillShape ? score.skillShape.immediateDamage : null,
          dotSkillDamage: score && score.skillShape ? score.skillShape.dotDamage : null,
          cooldownSec: cooldownForecast.cooldownSec,
          cooldownExcessSec: cooldownForecast.excessSec,
          cooldownOpportunityPenalty: cooldownForecast.penalty,
          chargeReleasePlan: score && score.chargePlan ? score.chargePlan : null,
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
      const executeChoice = plannerChooseExecuteCandidate(scored);
      const executePair = executeChoice && typeof executeChoice.slot === "number"
        ? (candidates.find(function (cand) { return cand && cand.idx === executeChoice.slot; }) || null)
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
        decisionMode: executeChoice
          ? "explicit_execute_earliest_lethal"
          : (bestPassingIdx !== null ? "candidate_passed_own_threshold" : "basic_fallback_no_candidate_passed"),
        ttkContext: horizonCtx,
        runtimeAggression: runtimeAggression,
        executeChoice: executeChoice
          ? {
              slot: executeChoice.slot,
              name: executeChoice.name,
              actionSec: executeChoice.execute && Number.isFinite(executeChoice.execute.actionSec) ? executeChoice.execute.actionSec : null,
              killMargin: executeChoice.execute && Number.isFinite(executeChoice.execute.killMargin) ? executeChoice.execute.killMargin : null,
              targetHpCur: executeChoice.execute && Number.isFinite(executeChoice.execute.targetHpCur) ? executeChoice.execute.targetHpCur : null,
              targetHpPct: executeChoice.execute && Number.isFinite(executeChoice.execute.targetHpPct) ? executeChoice.execute.targetHpPct : null,
              lowTargetHpCap: executeChoice.execute && Number.isFinite(executeChoice.execute.lowTargetHpCap) ? executeChoice.execute.lowTargetHpCap : null
            }
          : null,
        scored: scored,
        rankMode: rank.rankMode || null,
        conceptionGate: conceptionGate
      };
      pr.lastOpenerHorizonSim.postRetargetNoChargeGuard = disallowChargeSkills;
      if (Config.planner.openerHorizonLog) {
        Logger.log("PLANNER", "openerHorizonSim", pr.lastOpenerHorizonSim);
      }
      if (executeChoice && executePair) {
        pr.lastOpeningPickReason = "picked";
        const executeChargePlan = executeChoice.chargeReleasePlan || plannerBuildChargeReleasePlan(executePair.record, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: st,
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
          expectedBasicHit: expectedBasicHit,
          mobFactor: horizonMobFactor,
          mpAvailable: mpCur
        });
        const executeCooldownForecast = plannerComputeCooldownForecastPenalty(executePair.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const executeQueuedAction = plannerBuildCombatQueueAction({
          afterSlot: executePair.idx,
          liveState: st,
          followUpHint: executeChoice.followUp || null,
          mpAvailable: Number.isFinite(mpCur)
            ? Math.max(0, mpCur - (Number.isFinite(executePair.record.manaCost) ? executePair.record.manaCost : 0))
            : null,
          disallowChargeSkills: true
        });
        pr.lastOpeningPickDetail = {
          slot: executePair.idx,
          name: executePair.record.name || "",
          chargeReleasePlan: executeChargePlan,
          horizonSim: pr.lastOpenerHorizonSim,
          bestSkillVsBaselinePct: baselineTotal > 0 ? +(((executeChoice.damage / baselineTotal) - 1) * 100).toFixed(2) : null,
          thresholdPct: executeChoice.thresholdPct,
          thresholdSource: executeChoice.thresholdSource,
          minImprovementFraction: executeChoice.thresholdPct != null ? +(executeChoice.thresholdPct / 100).toFixed(4) : null,
          contextAdjustment: {
            total: executeChoice.contextAdjustment,
            parts: executeChoice.contextParts,
            pressure: executeChoice.contextPressure,
            immediateSkillDamage: executeChoice.immediateSkillDamage,
            dotSkillDamage: executeChoice.dotSkillDamage
          },
          executePolicy: executeChoice.execute,
          runtimeAggression: runtimeAggression,
          cooldownForecast: executeCooldownForecast,
          queuedAction: executeQueuedAction,
          postRetargetNoChargeGuard: disallowChargeSkills,
          filteredOut: {
            cooldown: breakdown.cooldown,
            mpGate: breakdown.mp,
            noDirectDamage: breakdown.noDirectDamage,
            excluded: breakdown.exclude,
            chargeGuard: breakdown.chargeGuard
          }
        };
        return {
          slot: executePair.idx,
          record: executePair.record,
          chargeReleasePlan: executeChargePlan,
          queuedAction: executeQueuedAction
        };
      }
      if (bestPassingIdx !== null && bestPassingPair) {
        pr.lastOpeningPickReason = "picked";
        const bestVsBaselinePct =
          baselineTotal > 0 ? +(((bestPassingDmg / baselineTotal) - 1) * 100).toFixed(2) : null;
        const thresholdPct = +(bestPassingMin.minFrac * 100).toFixed(2);
        const pickedRow = scored.find(function (r) { return r && r.slot === bestPassingPair.idx; }) || null;
        const pickedCooldownForecast = plannerComputeCooldownForecastPenalty(bestPassingPair.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const pickedChargePlan = pickedRow && pickedRow.chargeReleasePlan ? pickedRow.chargeReleasePlan : plannerBuildChargeReleasePlan(bestPassingPair.record, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: st,
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
          expectedBasicHit: expectedBasicHit,
          mobFactor: horizonMobFactor,
          mpAvailable: mpCur
        });
        const pickedQueuedAction = plannerBuildCombatQueueAction({
          afterSlot: bestPassingPair.idx,
          liveState: st,
          followUpHint: pickedRow ? pickedRow.followUp : null,
          mpAvailable: Number.isFinite(mpCur)
            ? Math.max(0, mpCur - (Number.isFinite(bestPassingPair.record.manaCost) ? bestPassingPair.record.manaCost : 0))
            : null,
          disallowChargeSkills: true
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
          contextAdjustment: pickedRow
            ? {
                total: pickedRow.contextAdjustment,
                parts: pickedRow.contextParts,
                pressure: pickedRow.contextPressure,
                immediateSkillDamage: pickedRow.immediateSkillDamage,
                dotSkillDamage: pickedRow.dotSkillDamage
              }
            : null,
          executePolicy: pickedRow ? pickedRow.execute : null,
          runtimeAggression: runtimeAggression,
          cooldownForecast: pickedCooldownForecast,
          queuedAction: pickedQueuedAction,
          postRetargetNoChargeGuard: disallowChargeSkills,
          filteredOut: {
            cooldown: breakdown.cooldown,
            mpGate: breakdown.mp,
            noDirectDamage: breakdown.noDirectDamage,
            excluded: breakdown.exclude,
            chargeGuard: breakdown.chargeGuard
          }
        };
        return {
          slot: bestPassingPair.idx,
          record: bestPassingPair.record,
          chargeReleasePlan: pickedChargePlan,
          queuedAction: pickedQueuedAction
        };
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
        const pickedRow = scored.find(function (r) { return r && r.slot === pickedPair.idx; }) || null;
        const pickedCooldownForecast = plannerComputeCooldownForecastPenalty(pickedPair.record, horizonSec, plannerAdjustedBasicDps(paper && Number.isFinite(paper.dps) ? paper.dps : 0, horizonMobFactor));
        const pickedChargePlan = pickedRow && pickedRow.chargeReleasePlan ? pickedRow.chargeReleasePlan : plannerBuildChargeReleasePlan(pickedPair.record, {
          horizonSec: horizonSec,
          enemyKey: key,
          liveState: st,
          paper: paper,
          basicDps: paper && Number.isFinite(paper.dps) ? paper.dps : null,
          expectedBasicHit: expectedBasicHit,
          mobFactor: horizonMobFactor,
          mpAvailable: mpCur
        });
        const pickedQueuedAction = plannerBuildCombatQueueAction({
          afterSlot: pickedPair.idx,
          liveState: st,
          followUpHint: pickedRow ? pickedRow.followUp : null,
          mpAvailable: Number.isFinite(mpCur)
            ? Math.max(0, mpCur - (Number.isFinite(pickedPair.record.manaCost) ? pickedPair.record.manaCost : 0))
            : null,
          disallowChargeSkills: true
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
          contextAdjustment: pickedRow
            ? {
                total: pickedRow.contextAdjustment,
                parts: pickedRow.contextParts,
                pressure: pickedRow.contextPressure,
                immediateSkillDamage: pickedRow.immediateSkillDamage,
                dotSkillDamage: pickedRow.dotSkillDamage
              }
            : null,
          executePolicy: pickedRow ? pickedRow.execute : null,
          runtimeAggression: runtimeAggression,
          cooldownForecast: pickedCooldownForecast,
          queuedAction: pickedQueuedAction,
          postRetargetNoChargeGuard: disallowChargeSkills,
          filteredOut: {
            cooldown: breakdown.cooldown,
            mpGate: breakdown.mp,
            noDirectDamage: breakdown.noDirectDamage,
            excluded: breakdown.exclude,
            chargeGuard: breakdown.chargeGuard
          }
        };
        return {
          slot: pickedPair.idx,
          record: pickedPair.record,
          chargeReleasePlan: pickedChargePlan,
          queuedAction: pickedQueuedAction
        };
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
              contextAdjustment: {
                total: bestRow.contextAdjustment,
                parts: bestRow.contextParts,
                pressure: bestRow.contextPressure,
                immediateSkillDamage: bestRow.immediateSkillDamage,
                dotSkillDamage: bestRow.dotSkillDamage
              },
              executePolicy: bestRow.execute,
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
        postRetargetNoChargeGuard: disallowChargeSkills,
        contextAdjustment: bestRow
          ? {
              total: bestRow.contextAdjustment,
              parts: bestRow.contextParts,
              pressure: bestRow.contextPressure,
              immediateSkillDamage: bestRow.immediateSkillDamage,
              dotSkillDamage: bestRow.dotSkillDamage
            }
          : null,
        executePolicy: bestRow ? bestRow.execute : null,
        runtimeAggression: runtimeAggression,
        filteredOut: {
          cooldown: breakdown.cooldown,
          mpGate: breakdown.mp,
          noDirectDamage: breakdown.noDirectDamage,
          excluded: breakdown.exclude,
          chargeGuard: breakdown.chargeGuard
        }
      };
      return null;
    }

    const first = candidates[0];
    const firstChargePlan = plannerBuildChargeReleasePlan(first.record, {
      enemyKey: key,
      liveState: st,
      mpAvailable: mpCur
    });
    pr.lastOpeningPickReason = "picked";
    pr.lastOpeningPickDetail = {
      slot: first.idx,
      name: first.record.name || "",
      chargeReleasePlan: firstChargePlan,
      queuedAction: plannerBuildCombatQueueAction({
        afterSlot: first.idx,
        liveState: st,
        mpAvailable: Number.isFinite(mpCur)
          ? Math.max(0, mpCur - (Number.isFinite(first.record.manaCost) ? first.record.manaCost : 0))
          : null,
        disallowChargeSkills: true
      }),
      heuristicFallback: true,
      note: useHorizon ? "horizonSim skipped (no paper DPS)" : "useOpenerHorizonSim off",
      postRetargetNoChargeGuard: disallowChargeSkills
    };
    return {
      slot: first.idx,
      record: first.record,
      chargeReleasePlan: firstChargePlan,
      queuedAction: pr.lastOpeningPickDetail.queuedAction || null
    };
  }

  // AI CHANGED: Phase C4 slice 8 — pick action-bar index for opening attack, or null to use basic-only path.
  function plannerPickSkillSlotToCast() {
    const p = plannerPickSkillOpeningPick(null);
    return p ? p.slot : null;
  }

  // AI CHANGED: Combat episode v1 — stable fingerprint for the current pull/target (enemy DB key when known, else enemyCount + target max HP).
  function plannerResolveCombatEpisodeTargetKey(st) {
    const live = st && typeof st === "object" ? st : readBasicState();
    const enemyKey =
      Runtime && Runtime.enemy && Runtime.enemy.lastFoughtKey != null && String(Runtime.enemy.lastFoughtKey).length > 0
        ? String(Runtime.enemy.lastFoughtKey)
        : "";
    const combat = live && live.combat ? live.combat : null;
    const ec = combat && Number.isFinite(combat.enemyCount) ? Math.round(combat.enemyCount) : null;
    const th = combat && combat.targetHp && combat.targetHp.valid ? combat.targetHp : null;
    const maxHp = th && Number.isFinite(th.max) ? th.max : null;
    if (enemyKey) {
      return "k:" + enemyKey + "|ec:" + (ec != null ? ec : "u") + "|max:" + (maxHp != null ? maxHp : "u");
    }
    return "ec:" + (ec != null ? ec : "u") + "|max:" + (maxHp != null ? maxHp : "u");
  }

  // AI CHANGED: Combat episode v1 — serialize opener + optional queued follow-up into ordered steps (telemetry + future executor); does not call `plannerPickSkillOpeningPick` (caller passes the pick already used for the burst).
  function plannerBuildCombatEpisodePlan(st, openingPick, burstOpts) {
    const fp = plannerResolveCombatEpisodeTargetKey(st);
    const steps = [];
    const rankedSlot =
      openingPick && typeof openingPick.slot === "number" && Number.isFinite(openingPick.slot) ? openingPick.slot : null;
    const rec = openingPick && openingPick.record && typeof openingPick.record === "object" ? openingPick.record : null;
    if (rankedSlot != null && rec) {
      const strat =
        openingPick.chargeReleasePlan && openingPick.chargeReleasePlan.strategy
          ? String(openingPick.chargeReleasePlan.strategy)
          : null;
      steps.push({
        kind: "opener_skill",
        slot: rankedSlot,
        name: rec.name || "",
        chargeStrategy: strat
      });
    } else {
      steps.push({ kind: "opener_basic" });
    }
    const q =
      openingPick && openingPick.queuedAction && openingPick.queuedAction.mode ? openingPick.queuedAction : null;
    if (q) {
      steps.push({
        kind: "queued_followup",
        mode: q.mode,
        slot: q.mode === "skill" && Number.isFinite(q.slot) ? q.slot : null,
        name: q.name || ""
      });
    }
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    const burst = burstOpts && typeof burstOpts === "object" ? burstOpts : null;
    return {
      version: 1,
      targetFingerprint: fp,
      builtAt: Date.now(),
      burstOptsSummary: burst
        ? {
            useRankedSkillOpener: burst.useRankedSkillOpener !== false,
            firstBurstAfterRetarget: !!burst.firstBurstAfterRetarget,
            disallowChargeSkills: !!burst.disallowChargeSkills
          }
        : null,
      openerPickSlot: rankedSlot,
      openerPickReason: pr && pr.lastOpeningPickReason ? pr.lastOpeningPickReason : null,
      horizonSummary:
        pr && pr.lastOpenerHorizonSim && typeof pr.lastOpenerHorizonSim === "object"
          ? {
              horizonMs:
                pr.lastOpenerHorizonSim.horizonMs != null && Number.isFinite(pr.lastOpenerHorizonSim.horizonMs)
                  ? pr.lastOpenerHorizonSim.horizonMs
                  : null,
              bestSlot:
                pr.lastOpenerHorizonSim.bestSlot != null && Number.isFinite(pr.lastOpenerHorizonSim.bestSlot)
                  ? pr.lastOpenerHorizonSim.bestSlot
                  : null,
              decisionMode: pr.lastOpenerHorizonSim.decisionMode || null
            }
          : null,
      steps: steps,
      stepsTotal: steps.length
    };
  }

  function getLastFoughtEnemyKey() {
    return Runtime.enemy.lastFoughtKey || null;
  }
