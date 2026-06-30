  // --- Layer 5 Module: 86-planner.js (Simplified, Multi-Class Utility Combat Planner & Queue Controller) ---
  // Rebuilt from scratch based on user approved specifications.
  // Combines 3 advanced mathematical variations (DPS, HP Heal-Deficit, and CC Pressure)
  // into a single, unified, stateless utility equation that runs on every frame.
  // Houses our state-aware Queue Builder that maintains a perfect 2-skill queue using active icon counts.

  // 1. plannerSeqNormalizeOneSkill
  // Normalizes an action bar skill row into a structured planner representation
  function plannerSeqNormalizeOneSkill(row, stats) {
    if (!row || row.kind !== "skill") {
      return null;
    }

    const effects = Array.isArray(row.effects) ? row.effects : [];
    let immediateDamage = 0;
    let dotTotal = 0;
    let healValue = 0;
    let isControl = false;
    let ccBaseValue = 0;
    let dominantDamageType = "physical";

    // Retrieve stats
    const physAttack = stats && Number.isFinite(stats.physicalAttack) ? stats.physicalAttack : 0;
    const magicAttack = stats && Number.isFinite(stats.magicAttack) ? stats.magicAttack : 0;

    for (let i = 0; i < effects.length; i += 1) {
      const e = effects[i];
      if (!e || !e.type) continue;

      if (e.type === "instant" && Number.isFinite(e.value)) {
        immediateDamage += e.value;
        if (e.damageType) dominantDamageType = e.damageType;
      } else if (e.type === "dot" && Number.isFinite(e.total)) {
        dotTotal += e.total;
        if (e.damageType) dominantDamageType = e.damageType;
      } else if (e.type === "basic_proc") {
        // basic_proc scales with player's base attack
        const base = e.damageType === "magic" ? magicAttack : physAttack;
        immediateDamage += base;
        if (e.damageType) dominantDamageType = e.damageType;
      } else if (e.type === "channel_gear") {
        const base = e.damageType === "magic" ? magicAttack : physAttack;
        immediateDamage += base;
        if (e.damageType) dominantDamageType = e.damageType;
      } else if (e.type === "heal" && Number.isFinite(e.value)) {
        if (e.resource === "hp") {
          let hVal = e.value;
          // Account for magic-scaling heals (e.g. 8% of base magic damage)
          if (Number.isFinite(e.percentOfMagicAttack) && e.percentOfMagicAttack > 0) {
            hVal += magicAttack * (e.percentOfMagicAttack / 100);
          }
          healValue += hVal;
        }
      } else if (e.type === "slow") {
        isControl = true;
        ccBaseValue = Math.max(ccBaseValue, 80); // Base slow value
      } else if (e.type === "stun") {
        isControl = true;
        ccBaseValue = Math.max(ccBaseValue, 180); // Base stun value
      }
    }

    // Flag the built-in basic Attack (castTimeSec=0, manaCost=0, cooldownSec=0)
    const isBasicAttack = (row.name === "Attack" || row.name === "Атака") && row.cooldownSec === 0 && row.manaCost === 0;

    const descLower = String(row.description || "").toLowerCase();
    const rowTags = Array.isArray(row.tags) ? row.tags.map((t) => String(t || "").trim().toLowerCase()) : [];
    const rowIsAttack = rowTags.indexOf("attack") !== -1 || !!(row.isAttack && row.targetsEnemy);
    // Game convention: AoE attack skills carry the "Close" target tag. Do not infer AoE from prose.
    const isAoe = rowTags.indexOf("close") !== -1;
    // Target-reset skills are attack skills whose description mentions both target and reset.
    const isTargetReset = rowTags.indexOf("attack") !== -1 && descLower.indexOf("target") !== -1 && descLower.indexOf("reset") !== -1;
    const hasDot = dotTotal > 0;

    // AoE "base physical damage to nearby targets" does not use the normal "to the target" parser.
    // Add hero base physical attack for Close-tag attack skills with base physical wording.
    if (isAoe && rowIsAttack && descLower.indexOf("base physical damage") !== -1 && physAttack > 0) {
      immediateDamage += physAttack;
    }

    // Phase U3: Sane fallback damage model for unparsed attack skills.
    if (rowIsAttack && immediateDamage === 0 && dotTotal === 0 && !isBasicAttack) {
      const fallbackMult = Config && Config.planner && Number.isFinite(Config.planner.fallbackDamageMultiplier)
        ? Config.planner.fallbackDamageMultiplier
        : 1.5;
      const classKey = typeof detectProfileClassKey === "function" ? detectProfileClassKey() : (Config.skills.masterClassKey || "assassin");
      const isMagicClass = classKey === "mage" || classKey === "priest";
      dominantDamageType = isMagicClass ? "magic" : "physical";
      const baseAttack = isMagicClass ? magicAttack : physAttack;
      immediateDamage = baseAttack * fallbackMult;
    }

    return {
      slot: typeof row.slot === "number" ? row.slot : null,
      name: row.name || "",
      kind: row.kind,
      manaCost: Number.isFinite(row.manaCost) ? row.manaCost : 0,
      castTimeSec: Number.isFinite(row.castTimeSec) ? row.castTimeSec : 0,
      cooldownSec: Number.isFinite(row.cooldownSec) ? row.cooldownSec : 0,
      immediateDamage: immediateDamage,
      dotTotal: dotTotal,
      healValue: healValue,
      isAttack: rowIsAttack,
      isControl: isControl,
      ccBaseValue: ccBaseValue,
      damageType: dominantDamageType,
      isBasicAttack: isBasicAttack,
      isAoe: isAoe,
      isTargetReset: isTargetReset,
      hasDot: hasDot
    };
  }

  // 2. plannerCalculateSkillUtility
  // The Unified Core Scoring Equation: combines DPS, HP Heal-Deficit, and CC Pressure
  function plannerCalculateSkillUtility(skill, liveState, stats) {
    // Hard Gates: If not affordable or ready, return -Infinity
    if (!skill || skill.slot === null) {
      return -Infinity;
    }

    // Cooldown check
    if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(skill.slot)) {
      return -Infinity;
    }

    const mpCur = liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid ? liveState.player.mp.cur : 0;
    const hpPct = liveState && liveState.player && liveState.player.hp && liveState.player.hp.valid ? liveState.player.hp.pct : 1.0;
    const targetHp = liveState && liveState.combat && liveState.combat.targetHp && liveState.combat.targetHp.valid ? liveState.combat.targetHp : null;
    const enemyCount = liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount) ? liveState.combat.enemyCount : 0;
    const activeAttackers = typeof readAttackersCount === "function" ? readAttackersCount() : 0;

    // Mana Gate
    if (mpCur < skill.manaCost) {
      return -Infinity;
    }

    // --- TERM 1: DPS-Equivalent Damage Utility (V1) ---
    const totalDamage = skill.immediateDamage + skill.dotTotal;
    const damageUtility = totalDamage / (skill.castTimeSec + 0.1);

    // --- TERM 2: Self-Preservation Heal Utility (V3 - specifically for HEALING SPELLS) ---
    // Zero at 100% HP, scales quadratically as HP drops. Multiplied by configurable healUrgencyWeight.
    let healUtility = 0;
    if (skill.healValue > 0 && hpPct < 1.0) {
      const hpDeficit = 1.0 - hpPct;
      const weight = Config && Config.planner && Number.isFinite(Config.planner.healUrgencyWeight)
        ? Config.planner.healUrgencyWeight
        : 3.0;
      healUtility = skill.healValue * (hpDeficit * hpDeficit) * weight;
    }

    // --- TERM 3: Crowd Control (CC) Scaling under Pressure (V4) ---
    let ccUtility = 0;
    if (skill.isControl && skill.ccBaseValue > 0) {
      ccUtility = skill.ccBaseValue * activeAttackers;
    }

    // --- TERM 4: Tactical priority policy ---
    let tacticalUtility = 0;
    const underPressure = hpPct < 0.66;
    const freshTargetOpener = !!(Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain && Runtime.autoFarm.combatSustain.freshTargetOpenerPending);

    // AoE should be preferred when 2+ enemies are actively attacking, but not as a safe fresh-target opener.
    if (activeAttackers > 1 && skill.isAoe && !(freshTargetOpener && !underPressure)) {
      const aoeTargets = Math.max(2, Math.min(3, activeAttackers));
      tacticalUtility += skill.immediateDamage * 0.75 * (aoeTargets - 1);
      tacticalUtility += 300 * (aoeTargets - 1);
    }

    // Survival pressure: prefer target reset and disables/stuns when HP is low.
    if (underPressure && skill.isTargetReset) {
      tacticalUtility += 900;
    }
    if (underPressure && skill.isControl) {
      tacticalUtility += 700;
    }

    // DoTs are strongly opener-favored when a new target was just selected, unless survival pressure overrides.
    if (skill.dotTotal > 0 && freshTargetOpener && !underPressure) {
      tacticalUtility += 5000;
    }

    // --- THE FINISHER URGENCY RULE ---
    // If the skill's immediate damage can kill the target, add a massive priority score
    let finisherUrgency = 0;
    if (skill.isAttack && targetHp && Number.isFinite(targetHp.cur) && targetHp.cur > 0) {
      if (targetHp.cur <= skill.immediateDamage) {
        finisherUrgency = 500000; // Absolute priority
      }
    }

    // Unified utility sum
    const totalScore = damageUtility + healUtility + ccUtility + tacticalUtility + finisherUrgency;
    return totalScore;
  }

  // 3. plannerPickSkillOpeningPick
  // Evaluates all slots on the action bar and returns the skill record with the highest utility
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

    const slots = Runtime.skills.slots;
    if (!Array.isArray(slots) || slots.length === 0) {
      pr.lastOpeningPickReason = "empty_cache";
      return null;
    }

    const stats = Runtime.hero.combatStats;
    const liveState = readBasicState();

    let bestSkill = null;
    let bestScore = -Infinity;
    const scoredCandidates = [];

    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || exclude.has(i) || (typeof isSkillForbiddenForAutomation === "function" && isSkillForbiddenForAutomation(row))) {
        continue;
      }

      // Normalize slot details dynamically
      const normalized = plannerSeqNormalizeOneSkill(row, stats);
      if (!normalized) {
        continue;
      }

      // Skip basic Attack from planner selection — it serves only as fallback
      if (normalized.isBasicAttack) {
        continue;
      }

      const score = plannerCalculateSkillUtility(normalized, liveState, stats);
      if (score > -Infinity) {
        scoredCandidates.push({ slot: i, name: normalized.name, score: score, record: normalized });
      }

      if (score > bestScore) {
        bestScore = score;
        bestSkill = { slot: i, record: row };
      }
    }

    // If no skill is affordable or off cooldown, return null (lets basic attack fallback)
    if (bestScore === -Infinity || !bestSkill) {
      pr.lastOpeningPickReason = "no_skills_available_or_affordable";
      return null;
    }

    pr.lastOpeningPickReason = "picked";
    pr.lastOpeningPickDetail = {
      slot: bestSkill.slot,
      name: bestSkill.record.name,
      score: bestScore,
      candidates: scoredCandidates.sort((a, b) => b.score - a.score)
    };

    return bestSkill;
  }

  function isBasicAttackCastText(text) {
    const raw = String(text || "").trim().toLowerCase();
    return raw === "attack" || raw.indexOf("basic attack") !== -1 || raw === "атака";
  }

  function armPostRetargetQueuePolicy(reason) {
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    if (!sustain) {
      return { ok: false, reason: "sustain_missing" };
    }
    sustain.postRetargetQueueActive = true;
    sustain.postRetargetQueued = false;
    sustain.postRetargetWaitingAttackChange = false;
    sustain.postRetargetArmedAt = Date.now();
    sustain.postRetargetQueuedSlot = null;
    sustain.postRetargetQueuedName = "";
    Logger.log("QUEUE", "Post-retarget queue policy armed", { reason: reason || "retarget", at: sustain.postRetargetArmedAt });
    return { ok: true };
  }

  function clearPostRetargetQueuePolicy(reason) {
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    if (!sustain) {
      return { ok: false, reason: "sustain_missing" };
    }
    const prev = {
      active: !!sustain.postRetargetQueueActive,
      queued: !!sustain.postRetargetQueued,
      waitingAttack: !!sustain.postRetargetWaitingAttackChange,
      slot: sustain.postRetargetQueuedSlot,
      name: sustain.postRetargetQueuedName
    };
    sustain.postRetargetQueueActive = false;
    sustain.postRetargetQueued = false;
    sustain.postRetargetWaitingAttackChange = false;
    sustain.postRetargetArmedAt = 0;
    sustain.postRetargetQueuedSlot = null;
    sustain.postRetargetQueuedName = "";
    Logger.log("QUEUE", "Post-retarget queue policy cleared", { reason: reason || "clear", prev: prev });
    return { ok: true };
  }

  function handlePostRetargetQueuePolicy(activeCastName, len) {
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    if (!sustain || !sustain.postRetargetQueueActive) {
      return null;
    }

    const isAttack = isBasicAttackCastText(activeCastName);

    if (sustain.postRetargetWaitingAttackChange) {
      if (isAttack) {
        Logger.debug("QUEUE", "Post-retarget queued skill locked; waiting for Attack cast to change", {
          queuedSlot: sustain.postRetargetQueuedSlot,
          queuedName: sustain.postRetargetQueuedName,
          activeCastName: activeCastName
        });
        return { ok: true, handled: true, reason: "waiting_attack_to_change" };
      }
      clearPostRetargetQueuePolicy("attack_changed");
      return null;
    }

    if (!sustain.postRetargetQueued) {
      const skill = plannerPickSkillOpeningPick();
      if (!skill) {
        clearPostRetargetQueuePolicy("no_skill_to_queue");
        return null;
      }
      if (typeof clickActionBarSlot === "function" && clickActionBarSlot(skill.slot)) {
        sustain.postRetargetQueued = true;
        sustain.postRetargetQueuedSlot = skill.slot;
        sustain.postRetargetQueuedName = skill.record && skill.record.name ? skill.record.name : `slot ${skill.slot}`;
        Runtime.autoFarm.combatQueue = { slot: skill.slot, name: sustain.postRetargetQueuedName, kind: "post_retarget_queued" };
        Logger.log("QUEUE", `Post-retarget queued one skill: ${sustain.postRetargetQueuedName} (Slot ${skill.slot})`, { activeCastName: activeCastName, len: len });
        if (isAttack) {
          sustain.postRetargetWaitingAttackChange = true;
          Logger.log("QUEUE", "Attack progressbar detected after retarget; locking queued skill until Attack changes", { queuedName: sustain.postRetargetQueuedName });
        } else {
          clearPostRetargetQueuePolicy("no_attack_anchor_after_queue");
        }
        return { ok: true, handled: true, reason: "post_retarget_queued_one", slot: skill.slot };
      }
      clearPostRetargetQueuePolicy("queue_click_failed");
      return null;
    }

    return { ok: true, handled: true, reason: "post_retarget_already_queued" };
  }

  // 4. plannerManageQueueTick (User's Approved Visual-Icon Queue Builder)
  //   - Relies purely on counting .skill-icon.active nodes on .status-bar-wrapper.
  //   - Enforces a strictly single queue click per active cast cycle (via queuedThisCycle).
  //   - Reads active cast text (span.value) to adapt dynamically if Basic Attack auto-started.
  //   - Clears the queue cleanly on target death: Runtime.autoFarm.combatQueue = null.
  async function plannerManageQueueTick() {
    if (!Runtime || !Runtime.autoFarm || !Runtime.skills || !Array.isArray(Runtime.skills.slots)) {
      return { ok: false, reason: "runtime_or_skills_missing" };
    }

    // Check if target has died (Cleanse queue state - no extra clicks)
    const liveState = typeof readBasicState === "function" ? readBasicState() : null;
    const targetHp = liveState && liveState.combat && liveState.combat.targetHp && liveState.combat.targetHp.valid ? liveState.combat.targetHp : null;
    const enemyCount = liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount) ? liveState.combat.enemyCount : 0;

    if (enemyCount === 0 || (targetHp && targetHp.cur <= 0)) {
      Runtime.autoFarm.combatQueue = null; // Cleared on target death. No more steps.
      return { ok: true, reason: "target_died_cleansed" };
    }

    const wrapper = document.querySelector(Config.selectors.statusBarWrapper);
    const activeIcons = wrapper ? Array.from(wrapper.querySelectorAll(Config.selectors.activeIcons)) : [];
    const activeCastName = wrapper ? (wrapper.querySelector(Config.selectors.activeCastName)?.textContent || "").trim() : "";

    const len = activeIcons.length;
    const sustain = Runtime.autoFarm.combatSustain || {};

    if (typeof isAutoFarmEasyMode === "function" && isAutoFarmEasyMode() && typeof hasBasicAttackOnBar === "function" && hasBasicAttackOnBar()) {
      if (len === 0) {
        clickBasicAttack();
        sustain.lastActiveCastName = "Attack";
        sustain.queuedThisCycle = false;
        sustain.freshTargetOpenerPending = false;
        return { ok: true, reason: "easy_mode_basic_only" };
      }
      return { ok: true, reason: "easy_mode_waiting_for_basic" };
    }

    if (typeof tryUseImmediateCombatBuffIfReady === "function") {
      await tryUseImmediateCombatBuffIfReady("planner_tick");
    }

    // COOLDOWN RESET TRIGGER: If we are idle, or if the active casting skill name changed, reset our queue flag!
    if (len === 0 || activeCastName !== sustain.lastActiveCastName) {
      if (sustain.queuedThisCycle) {
        Logger.debug("QUEUE", `New cast cycle started. Cleared queue flag (Old cast: [${sustain.lastActiveCastName}] -> New cast: [${activeCastName || "idle"}])`);
      }
      sustain.queuedThisCycle = false;
      sustain.lastActiveCastName = activeCastName;
    }

    const postRetargetHandled = handlePostRetargetQueuePolicy(activeCastName, len);
    if (postRetargetHandled && postRetargetHandled.handled) {
      return postRetargetHandled;
    }

    // --- CASE 0: IDLE (No skills casting or queued) -> Click our optimal opener (Skill A) ---
    if (len === 0) {
      const skillA = plannerPickSkillOpeningPick();
      if (skillA) {
        if (typeof clickActionBarSlot === "function" && clickActionBarSlot(skillA.slot)) {
          Logger.log("QUEUE", `Casting opener: ${skillA.record.name} (Slot ${skillA.slot})`);
          Runtime.autoFarm.combatQueue = { slot: skillA.slot, name: skillA.record.name, kind: "opener" };
          sustain.lastActiveCastName = skillA.record.name; // Instantly predict active cast name
          sustain.queuedThisCycle = false;
          sustain.freshTargetOpenerPending = false;
          return { ok: true, action: "opener_fired", slot: skillA.slot };
        }
      } else {
        // Fallback to basic attack if no skills available/affordable
        if (typeof clickBasicAttack === "function") {
          clickBasicAttack();
          sustain.lastActiveCastName = "Attack";
          sustain.queuedThisCycle = false;
          sustain.freshTargetOpenerPending = false;
        }
      }
      return { ok: true, reason: "idle_processed" };
    }

    // --- CASE 1: CASTING (1 active icon) -> Pre-press our follow-up (Skill B) ---
    if (len === 1) {
      // Only queue exactly ONCE per cast cycle to prevent rapid-fire skill overwrites
      if (!sustain.queuedThisCycle) {
        // Find the next best skill, excluding the current casting slot
        const excludeSlots = [];
        if (Runtime.autoFarm.combatQueue && typeof Runtime.autoFarm.combatQueue.slot === "number") {
          excludeSlots.push(Runtime.autoFarm.combatQueue.slot);
        }

        const skillB = plannerPickSkillOpeningPick({ excludeSlots: excludeSlots });
        if (skillB) {
          if (typeof clickActionBarSlot === "function" && clickActionBarSlot(skillB.slot)) {
            Logger.log("QUEUE", `Pre-pressing queued follow-up: ${skillB.record.name} (Slot ${skillB.slot}) - Active Cast: [${activeCastName}]`);
            Runtime.autoFarm.combatQueue = { slot: skillB.slot, name: skillB.record.name, kind: "queued" };
            sustain.queuedThisCycle = true; // Lock the queue immediately!
            return { ok: true, action: "queue_fired", slot: skillB.slot };
          }
        }
      }
      return { ok: true, reason: "casting_processed" };
    }

    // --- CASE 2: CASTING & QUEUED (2 active icons) -> Queue is already verified full. Stand completely still. ---
    if (len === 2) {
      return { ok: true, reason: "queue_full_standing_still" };
    }

    return { ok: true };
  }
