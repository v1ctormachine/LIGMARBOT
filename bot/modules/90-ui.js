  // AI CHANGED: SVG_NS used by the 2-ring overlay renderer (avoids createElementNS string typos).
  const SVG_NS = "http://www.w3.org/2000/svg";

  // AI CHANGED: Tear down any existing 2-ring debug overlay (DOM + auto-clear timer).
  function clearSecondRingOverlay() {
    if (Runtime.ui.secondRingOverlayTimer) {
      clearTimeout(Runtime.ui.secondRingOverlayTimer);
      Runtime.ui.secondRingOverlayTimer = null;
    }
    if (Runtime.ui.secondRingOverlay) {
      try {
        Runtime.ui.secondRingOverlay.remove();
      } catch (err) {
        // ignore — element may already be detached
      }
      Runtime.ui.secondRingOverlay = null;
    }
  }

  // AI CHANGED: Render the 12-sample 2-ring scan as an SVG overlay so user can SEE where we sample,
  // which positions hit/missed, and where the best-hit arrow points. pointer-events: none so it never
  // blocks the game canvas from receiving clicks. Auto-clears after Config.debug.secondRingOverlayTtlMs.
  function renderSecondRingOverlay(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.samples) || !snapshot.canvasRect) {
      return;
    }
    clearSecondRingOverlay();

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "ligmar-bot-ring2-overlay");
    svg.style.position = "fixed";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.width = "100vw";
    svg.style.height = "100vh";
    svg.style.zIndex = "999998"; // just under the control panel (999999) so panel buttons stay clickable
    svg.style.pointerEvents = "none";

    const rect = snapshot.canvasRect;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Center marker — small crosshair so user can verify our origin matches their character's tile.
    const cross1 = document.createElementNS(SVG_NS, "line");
    cross1.setAttribute("x1", centerX - 8);
    cross1.setAttribute("y1", centerY);
    cross1.setAttribute("x2", centerX + 8);
    cross1.setAttribute("y2", centerY);
    cross1.setAttribute("stroke", "#dce3ff");
    cross1.setAttribute("stroke-width", "1.5");
    cross1.setAttribute("opacity", "0.8");
    svg.appendChild(cross1);
    const cross2 = document.createElementNS(SVG_NS, "line");
    cross2.setAttribute("x1", centerX);
    cross2.setAttribute("y1", centerY - 8);
    cross2.setAttribute("x2", centerX);
    cross2.setAttribute("y2", centerY + 8);
    cross2.setAttribute("stroke", "#dce3ff");
    cross2.setAttribute("stroke-width", "1.5");
    cross2.setAttribute("opacity", "0.8");
    svg.appendChild(cross2);

    // AI CHANGED: Per-sample shape + label. When the scan used a hex mask we draw a hex polygon (the
    // actual sampled area); otherwise we keep the legacy rectangle. The hex matches the in-game tile
    // shape so the user can see exactly what we measured.
    for (let i = 0; i < snapshot.samples.length; i += 1) {
      const s = snapshot.samples[i];
      const isBest = !!(snapshot.best && snapshot.best.key === s.key);
      const fill = s.hit ? "rgba(75, 217, 122, 0.28)" : "rgba(0,0,0,0)";
      const stroke = s.hit ? "#4bd97a" : (s.ratio > 0 ? "#d9a14b" : "#d96f4b");
      const strokeWidth = isBest ? 2.4 : 1.2;

      // AI CHANGED: Center of the patch in viewport coords -- shared by both shape and label placement.
      const patchCenterX = s.viewportX + s.patchW / 2;
      const patchCenterY = s.viewportY + s.patchH / 2;

      let shapeNode;
      if (s.maskShape === "hex" && Number.isFinite(s.hexRadius) && s.hexRadius > 0) {
        // Pointy-top hex polygon: 6 vertices around the patch center.
        const r = s.hexRadius;
        const hx = r * (Math.sqrt(3) / 2); // half-width at flat sides
        const points = [
          [patchCenterX, patchCenterY - r],
          [patchCenterX + hx, patchCenterY - r / 2],
          [patchCenterX + hx, patchCenterY + r / 2],
          [patchCenterX, patchCenterY + r],
          [patchCenterX - hx, patchCenterY + r / 2],
          [patchCenterX - hx, patchCenterY - r / 2]
        ];
        shapeNode = document.createElementNS(SVG_NS, "polygon");
        shapeNode.setAttribute("points", points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "));
      } else {
        shapeNode = document.createElementNS(SVG_NS, "rect");
        shapeNode.setAttribute("x", s.viewportX);
        shapeNode.setAttribute("y", s.viewportY);
        shapeNode.setAttribute("width", s.patchW);
        shapeNode.setAttribute("height", s.patchH);
      }
      shapeNode.setAttribute("fill", fill);
      shapeNode.setAttribute("stroke", stroke);
      shapeNode.setAttribute("stroke-width", strokeWidth);
      svg.appendChild(shapeNode);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", patchCenterX);
      // AI CHANGED: For hex shapes the top is taller than the bounding box top, so anchor the label
      // above the hex's top vertex (patchCenterY - hexRadius - 3). Square fallback keeps original offset.
      const labelY = (s.maskShape === "hex" && Number.isFinite(s.hexRadius))
        ? patchCenterY - s.hexRadius - 3
        : s.viewportY - 3;
      label.setAttribute("y", labelY);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-family", "Consolas, Menlo, monospace");
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", stroke);
      label.setAttribute("stroke", "rgba(0,0,0,0.65)");
      label.setAttribute("stroke-width", "0.6");
      label.setAttribute("paint-order", "stroke");
      const ratioPct = (s.ratio * 100).toFixed(1) + "%";
      label.textContent = `${s.key} ${ratioPct}`;
      svg.appendChild(label);
    }

    // Direction arrow from center to the best-hit patch (if any).
    if (snapshot.best) {
      const b = snapshot.best;
      const targetX = b.viewportX + b.patchW / 2;
      const targetY = b.viewportY + b.patchH / 2;
      const arrow = document.createElementNS(SVG_NS, "line");
      arrow.setAttribute("x1", centerX);
      arrow.setAttribute("y1", centerY);
      arrow.setAttribute("x2", targetX);
      arrow.setAttribute("y2", targetY);
      arrow.setAttribute("stroke", "#4bd97a");
      arrow.setAttribute("stroke-width", "2");
      arrow.setAttribute("opacity", "0.85");
      svg.appendChild(arrow);

      const arrowHead = document.createElementNS(SVG_NS, "circle");
      arrowHead.setAttribute("cx", targetX);
      arrowHead.setAttribute("cy", targetY);
      arrowHead.setAttribute("r", "4");
      arrowHead.setAttribute("fill", "#4bd97a");
      svg.appendChild(arrowHead);
    }

    // Top-left mini summary (so it's clear which scan this is and when).
    const summary = document.createElementNS(SVG_NS, "text");
    summary.setAttribute("x", rect.left + 6);
    summary.setAttribute("y", rect.top + 14);
    summary.setAttribute("font-family", "Consolas, Menlo, monospace");
    summary.setAttribute("font-size", "11");
    summary.setAttribute("fill", "#dce3ff");
    summary.setAttribute("stroke", "rgba(0,0,0,0.7)");
    summary.setAttribute("stroke-width", "0.7");
    summary.setAttribute("paint-order", "stroke");
    const hitCount = Array.isArray(snapshot.hits) ? snapshot.hits.length : 0;
    summary.textContent = `[ring2:${snapshot.label || "?"}] hits=${hitCount}` +
      (snapshot.best ? ` best=${snapshot.best.key} (${(snapshot.best.ratio * 100).toFixed(1)}%) -> ${snapshot.best.dirs.join("/")}` : "");
    svg.appendChild(summary);

    document.body.appendChild(svg);
    Runtime.ui.secondRingOverlay = svg;

    const ttl = Config.debug && Config.debug.secondRingOverlayTtlMs ? Config.debug.secondRingOverlayTtlMs : 0;
    if (ttl > 0) {
      Runtime.ui.secondRingOverlayTimer = setTimeout(clearSecondRingOverlay, ttl);
    }
  }

  // AI CHANGED: Map a status phase tag to a color category for the GUI badge / phase line.
  function phaseColor(phase) {
    switch (phase) {
      case "starting":
      case "looting":
        return "#4bd97a"; // green
      case "waiting":
      case "preparing":
        return "#d9a14b"; // amber
      case "zooming":
      case "scanning":
      case "finding":
      case "moving":
      case "verifying":
        return "#4ba8d9"; // blue
      case "attacking":
        return "#d96f4b"; // orange-red
      case "halted":
        return "#d94b4b"; // red
      case "idle":
      case "stopped":
      default:
        return "#9098a8"; // muted grey
    }
  }

  // AI CHANGED: Format ms-since-event as "Xs", "Xm Ys", or "Xh Ym" — used for "(N ago)" label on phase line.
  function formatAgo(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "—";
    }
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) {
      return `${totalSec}s`;
    }
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) {
      return `${min}m ${sec}s`;
    }
    const hr = Math.floor(min / 60);
    const restMin = min % 60;
    return `${hr}h ${restMin}m`;
  }

  // AI CHANGED: Format auto-farm ON duration for GUI footer (live while running).
  function formatOnDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "0s";
    }
    const totalSec = Math.floor(ms / 1000);
    const sec = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const min = totalMin % 60;
    const hr = Math.floor(totalMin / 60);
    if (hr > 0) {
      return `${hr}h ${min}m ${sec}s`;
    }
    if (min > 0) {
      return `${min}m ${sec}s`;
    }
    return `${sec}s`;
  }

  // AI CHANGED: Boot-only + console — apply saved planner flags; returns a result object (slice 36).
  function plannerPrefsSnapshot() {
    return {
      recordEnemyDbBeforeAttack: !!Config.planner.recordEnemyDbBeforeAttack,
      logPlannerAfterSecureTile: !!Config.planner.logPlannerAfterSecureTile,
      useRankedAttackSkillsInCombat: !!Config.planner.useRankedAttackSkillsInCombat,
      useRankedSkillOnlyFirstBurstAfterFind: !!Config.planner.useRankedSkillOnlyFirstBurstAfterFind
    };
  }

  function loadPlannerUiPrefs() {
    try {
      const raw = window.localStorage.getItem("ligmarbot.plannerUi.v1");
      if (!raw) {
        return { ok: true, fromStorage: false, planner: plannerPrefsSnapshot() };
      }
      const p = JSON.parse(raw);
      if (typeof p.recordEnemyDbBeforeAttack === "boolean") {
        Config.planner.recordEnemyDbBeforeAttack = p.recordEnemyDbBeforeAttack;
      }
      if (typeof p.logPlannerAfterSecureTile === "boolean") {
        Config.planner.logPlannerAfterSecureTile = p.logPlannerAfterSecureTile;
      }
      if (typeof p.useRankedAttackSkillsInCombat === "boolean") {
        Config.planner.useRankedAttackSkillsInCombat = p.useRankedAttackSkillsInCombat;
      }
      if (typeof p.useRankedSkillOnlyFirstBurstAfterFind === "boolean") {
        Config.planner.useRankedSkillOnlyFirstBurstAfterFind = p.useRankedSkillOnlyFirstBurstAfterFind;
      }
      return { ok: true, fromStorage: true, planner: plannerPrefsSnapshot() };
    } catch (err) {
      return {
        ok: false,
        fromStorage: false,
        error: String(err && err.message ? err.message : err),
        planner: plannerPrefsSnapshot()
      };
    }
  }

  // AI CHANGED: grouped slice 34 — persist planner flags after console edits (ligmarBot.savePlannerUiPrefs).
  function savePlannerUiPrefs() {
    const payload = plannerPrefsSnapshot();
    try {
      window.localStorage.setItem("ligmarbot.plannerUi.v1", JSON.stringify(payload));
      return { ok: true, storageKey: "ligmarbot.plannerUi.v1", planner: payload };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err), planner: payload };
    }
  }

  // AI CHANGED: slice 26 — persist ranked opener timing (slice 25) from panel; returns result object (slice 36).
  function combatPrefsSnapshot() {
    return {
      rankedOpenerChargeGraceMs: Number(Config.combat.rankedOpenerChargeGraceMs) || 0,
      rankedOpenerEarlyCancelIfHintAfterMs: Number(Config.combat.rankedOpenerEarlyCancelIfHintAfterMs) || 0,
      chargeSkillReleaseFraction: Number(Config.combat.chargeSkillReleaseFraction) || 1
    };
  }

  function loadCombatUiPrefs() {
    try {
      const raw = window.localStorage.getItem("ligmarbot.combatUi.v1");
      if (!raw) {
        return { ok: true, fromStorage: false, combat: combatPrefsSnapshot() };
      }
      const p = JSON.parse(raw);
      if (Number.isFinite(p.rankedOpenerChargeGraceMs) && p.rankedOpenerChargeGraceMs >= 0) {
        Config.combat.rankedOpenerChargeGraceMs = p.rankedOpenerChargeGraceMs;
      }
      if (Number.isFinite(p.rankedOpenerEarlyCancelIfHintAfterMs) && p.rankedOpenerEarlyCancelIfHintAfterMs >= 0) {
        Config.combat.rankedOpenerEarlyCancelIfHintAfterMs = p.rankedOpenerEarlyCancelIfHintAfterMs;
      }
      if (Number.isFinite(p.chargeSkillReleaseFraction) && p.chargeSkillReleaseFraction > 0 && p.chargeSkillReleaseFraction <= 1) {
        Config.combat.chargeSkillReleaseFraction = p.chargeSkillReleaseFraction;
      }
      return { ok: true, fromStorage: true, combat: combatPrefsSnapshot() };
    } catch (err) {
      return {
        ok: false,
        fromStorage: false,
        error: String(err && err.message ? err.message : err),
        combat: combatPrefsSnapshot()
      };
    }
  }

  function saveCombatUiPrefs() {
    const payload = combatPrefsSnapshot();
    try {
      window.localStorage.setItem("ligmarbot.combatUi.v1", JSON.stringify(payload));
      return { ok: true, storageKey: "ligmarbot.combatUi.v1", combat: payload };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err), combat: payload };
    }
  }

  // AI CHANGED: slice 36 — one console call to persist planner + opener ms; refresh panel fields.
  function saveAllUiPrefs() {
    const planner = savePlannerUiPrefs();
    const combat = saveCombatUiPrefs();
    return { ok: !!(planner.ok && combat.ok), planner: planner, combat: combat };
  }

  function loadAllUiPrefs() {
    const planner = loadPlannerUiPrefs();
    const combat = loadCombatUiPrefs();
    updateControlPanelStatus();
    return { ok: !!(planner.ok && combat.ok), planner: planner, combat: combat };
  }

  function clampEarlyCancelToFirstWaitMs(earlyMs) {
    const firstRaw = Config.combat.rankedOpenerFirstProgressTimeoutMs;
    const first =
      Number.isFinite(firstRaw) && firstRaw > 0 ? firstRaw : Config.combat.attackProgressTimeoutMs || 4200;
    let e = Number.isFinite(earlyMs) && earlyMs >= 0 ? earlyMs : 0;
    if (e > 0 && e >= first) {
      e = Math.max(0, first - 1);
    }
    return e;
  }

  function applyCombatTuneInputsAndSave(graceInput, earlyInput) {
    const g = Number.parseInt(String(graceInput.value), 10);
    Config.combat.rankedOpenerChargeGraceMs = Number.isFinite(g) && g >= 0 ? g : 0;
    const eRaw = Number.parseInt(String(earlyInput.value), 10);
    const e = clampEarlyCancelToFirstWaitMs(Number.isFinite(eRaw) && eRaw >= 0 ? eRaw : 0);
    if (String(earlyInput.value) !== String(e)) {
      earlyInput.value = String(e);
    }
    Config.combat.rankedOpenerEarlyCancelIfHintAfterMs = e;
    saveCombatUiPrefs();
    Logger.log("UI", "combat opener ms", {
      rankedOpenerChargeGraceMs: Config.combat.rankedOpenerChargeGraceMs,
      rankedOpenerEarlyCancelIfHintAfterMs: Config.combat.rankedOpenerEarlyCancelIfHintAfterMs
    });
  }

  // AI CHANGED: Keep exactly one live GUI refresh ticker; recover if callback throws.
  function ensureControlPanelRefreshTicker() {
    if (Runtime.ui.statusRefreshTimer) {
      clearInterval(Runtime.ui.statusRefreshTimer);
      Runtime.ui.statusRefreshTimer = null;
    }
    Runtime.ui.statusRefreshTimer = setInterval(function () {
      try {
        updateControlPanelStatus();
      } catch (err) {
        Logger.warn("UI", "updateControlPanelStatus tick failed", err);
      }
    }, 500);
  }

  // AI CHANGED: Live GUI refresher — phase block, button enabled-state, and compact stats line.
  function updateControlPanelStatus() {
    if (!Runtime.ui.statusNode) {
      return;
    }

    // AI CHANGED: slice 26 — sync opener ms fields when Config changes elsewhere (not while typing).
    if (Runtime.ui.combatGraceInput && document.activeElement !== Runtime.ui.combatGraceInput) {
      const gv = Config.combat.rankedOpenerChargeGraceMs;
      const gs = String(Number.isFinite(gv) && gv >= 0 ? gv : 0);
      if (Runtime.ui.combatGraceInput.value !== gs) {
        Runtime.ui.combatGraceInput.value = gs;
      }
    }
    if (Runtime.ui.combatEarlyCancelInput && document.activeElement !== Runtime.ui.combatEarlyCancelInput) {
      const ev = clampEarlyCancelToFirstWaitMs(Config.combat.rankedOpenerEarlyCancelIfHintAfterMs);
      const es = String(ev);
      if (Runtime.ui.combatEarlyCancelInput.value !== es) {
        Runtime.ui.combatEarlyCancelInput.value = es;
      }
    }

    // Update Start/Stop button enabled-state so the GUI shows which action is currently meaningful.
    const running = !!Runtime.autoFarm.running;
    const stopRequested = !!Runtime.autoFarm.stopRequested;
    if (Runtime.ui.startButton) {
      Runtime.ui.startButton.disabled = running;
      Runtime.ui.startButton.style.opacity = running ? "0.45" : "1";
      Runtime.ui.startButton.style.cursor = running ? "not-allowed" : "pointer";
    }
    if (Runtime.ui.stopButton) {
      const canStop = running && !stopRequested;
      Runtime.ui.stopButton.disabled = !canStop;
      Runtime.ui.stopButton.style.opacity = canStop ? "1" : "0.45";
      Runtime.ui.stopButton.style.cursor = canStop ? "pointer" : "not-allowed";
    }

    // Update phase block (large activity indicator).
    const phase = Runtime.status && Runtime.status.phase ? Runtime.status.phase : "idle";
    const detail = Runtime.status && Runtime.status.detail ? Runtime.status.detail : "";
    const since = Runtime.status && Runtime.status.since ? Runtime.status.since : Date.now();
    const ago = formatAgo(Date.now() - since);
    const color = phaseColor(phase);
    if (Runtime.ui.phaseNode) {
      Runtime.ui.phaseNode.textContent = phase.toUpperCase();
      Runtime.ui.phaseNode.style.color = color;
    }
    if (Runtime.ui.phaseDetailNode) {
      Runtime.ui.phaseDetailNode.textContent = detail || "—";
    }
    if (Runtime.ui.phaseSinceNode) {
      Runtime.ui.phaseSinceNode.textContent = `${ago} ago`;
    }

    // Compact stats footer — HP/MP/Ping/Enemies/Coords/Cycles.
    const state = readBasicState();
    const auto = getAutoFarmStatus();
    const hpPct = state.player.hp && state.player.hp.valid ? Math.round(state.player.hp.pct * 100) : null;
    const mpPct = state.player.mp && state.player.mp.valid ? Math.round(state.player.mp.pct * 100) : null;
    const enemyText = typeof state.combat.enemyCount === "number" ? state.combat.enemyCount : "?";
    const coordsText = Runtime.exploration.lastKnownCoords
      ? `[${Runtime.exploration.lastKnownCoords.x};${Runtime.exploration.lastKnownCoords.y}]`
      : "unknown";
    const onMs = auto.running && Number.isFinite(auto.startedAt) ? (Date.now() - auto.startedAt) : 0;
    const onText = formatOnDuration(onMs);
    const healthSummary = typeof evaluateAutoFarmHealth === "function"
      ? evaluateAutoFarmHealth(state, {
          readonly: true,
          running: !!auto.running
        })
      : null;
    const sessionText = state.session.dead
      ? "dead"
      : state.session.poorConnection
        ? "poor-connection"
        : state.session.coreUi && state.session.coreUi.missing
          ? "ui-missing"
          : "ok";
    const healthState = healthSummary && healthSummary.severity ? healthSummary.severity : "unknown";
    const recoverySoft = auto.recovery && Number.isFinite(auto.recovery.softAttempts) ? auto.recovery.softAttempts : 0;
    const recoveryRefresh = auto.recovery && Number.isFinite(auto.recovery.refreshAttempts) ? auto.recovery.refreshAttempts : 0;
    const lastVerifiedAt =
      auto.health && Number.isFinite(auto.health.lastActionVerifiedAt)
        ? auto.health.lastActionVerifiedAt
        : auto.health && Number.isFinite(auto.health.lastProgressAt)
          ? auto.health.lastProgressAt
          : null;
    const lines = [
      `HP ${hpPct !== null ? hpPct + "%" : "?"} · MP ${mpPct !== null ? mpPct + "%" : "?"} · Ping ${state.network.pingMs !== null ? state.network.pingMs + "ms" : "?"}`,
      `Enemies: ${enemyText} · Coords: ${coordsText}`,
      `Session: ${sessionText} · Health: ${healthState}${healthSummary && healthSummary.primaryReason ? " (" + healthSummary.primaryReason + ")" : ""}`,
      `Recovery: soft ${recoverySoft} · refresh ${recoveryRefresh} · Last action: ${lastVerifiedAt ? formatAgo(Date.now() - lastVerifiedAt) + " ago" : "—"}`,
      `Cycles: ${auto.cyclesCompleted} · Failures: ${auto.consecutiveFailures} · ON: ${onText}`
    ];
    Runtime.ui.statusNode.textContent = lines.join("\n");
  }

  // AI CHANGED: Single copy-paste line for patch verification (console + panel); one entry per addCheck step.
  function buildTestBundleHumanReport(checks, versionSemver) {
    const labelById = {
      version: "Version",
      probe_selectors: "Selector probe",
      skill_scan: "Skill data",
      skill_master_db: "Skill master DB",
      hero_stats: "Hero stats",
      planner_opener_horizon_preview: "HorizonSim",
      planner_conception_path: "Conception path",
      planner_ranked_runtime: "Ranked runtime",
      planner_opener_context_scoring: "Opener context scoring",
      planner_ranked_reason_quality: "Ranked reason quality",
      planner_ranked_tuning_hint: "Ranked tuning hint",
      planner_ranked_preflight: "Ranked preflight",
      planner_ranked_soak: "Ranked soak",
      test_profile: "Test profile",
      planner_class_profile: "Class profile",
      planner_enemy_adaptation: "Enemy adaptation",
      planner_rotation_policy: "Rotation policy",
      planner_multimob_channel: "Multi-mob channel rank",
      planner_natural_sniper_shot: "Natural Sniper Shot",
      planner_execute_policy: "Execute policy",
      planner_forced_opener: "Forced opener",
      planner_golden_comparator: "Golden comparator",
      planner_charge_release_policy: "Charge release policy",
      planner_dynamic_charge_scoring: "Dynamic charge scoring",
      combat_attackers_retarget_ui: "Attackers retarget UI",
      combat_post_retarget_guard: "Post-retarget no-charge guard",
      combat_queue_policy: "Combat queue",
      session_risk_detection: "Session risk",
      recovery_policy: "Recovery policy",
      auto_resume_after_refresh: "Auto-resume refresh",
      watchdog_surface: "Watchdog surface",
      chat_spammer_auto: "Chat spammer auto",
      combat_sustain_policy: "Combat sustain",
      auto_farm_resume_policy: "Farm resume policy",
      auto_farm_reliability: "Combat reliability",
      auto_farm_session_summary: "Auto-farm session",
      planner_ranked_openers: "Ranked opener",
      calibration_observe: "Calibration"
    };
    const segs = [];
    segs.push("bot v" + String(versionSemver || "?"));
    for (let i = 0; i < checks.length; i += 1) {
      const ch = checks[i];
      const human = labelById[ch.id] || ch.id;
      let status;
      if (ch.detail && ch.detail.skipped) {
        status = "skipped";
      } else if (ch.ok) {
        status = "successful";
      } else {
        status = "failed";
      }
      segs.push(human + " — " + status);
    }
    const criticalBad = checks.some(function (c) { return c.critical && !c.ok; });
    const anyBad = checks.some(function (c) { return !c.ok; });
    let overall;
    if (criticalBad) {
      overall = "OVERALL: FAIL (critical)";
    } else if (anyBad) {
      overall = "OVERALL: PASS with warnings";
    } else {
      overall = "OVERALL: PASS";
    }
    const fullText = "Test result: " + segs.join("; ") + "; " + overall + ".";
    return { fullText: fullText, overall: overall };
  }

  // AI CHANGED: Precise TEST debug payload for DevTools — compact but complete, stable across patches.
  function buildTestDebugReport(checks) {
    const report = {};
    for (let i = 0; i < checks.length; i += 1) {
      const c = checks[i];
      report[c.id] = {
        ok: !!c.ok,
        critical: !!c.critical,
        skipped: !!(c.detail && c.detail.skipped),
        note: c.note || null,
        detail: c.detail !== undefined ? c.detail : null
      };
    }
    return report;
  }

  // AI CHANGED: Compact always-on comparator payload for TEST — one object summarizes the opener decision context without cross-reading multiple diagnostics.
  function buildPlannerGoldenComparator(diag, horizonPreview, naturalSniperProbe, forcedOpenerReadiness, forcedOpenerRuntime) {
    const lastHorizon = diag && diag.lastOpenerHorizonSim ? diag.lastOpenerHorizonSim : null;
    const lastDetail = diag && diag.lastDetail ? diag.lastDetail : null;
    const enemyAdaptive = diag && diag.enemyAdaptive ? diag.enemyAdaptive : null;
    const runtimeAggression = diag && diag.runtimeAggression ? diag.runtimeAggression : null;
    const tuningHint = diag && diag.tuningHint ? diag.tuningHint : null;
    const openerRuntime = diag && diag.openerRuntime ? diag.openerRuntime : null;
    const runtimeEvents = openerRuntime && openerRuntime.events ? openerRuntime.events : null;
    const candidates = horizonPreview && Array.isArray(horizonPreview.candidates) ? horizonPreview.candidates.slice() : [];
    candidates.sort(function (a, b) {
      const aPass = a && a.passesThreshold ? 1 : 0;
      const bPass = b && b.passesThreshold ? 1 : 0;
      if (bPass !== aPass) {
        return bPass - aPass;
      }
      const aDmg = a && Number.isFinite(a.horizonDamage) ? a.horizonDamage : -Infinity;
      const bDmg = b && Number.isFinite(b.horizonDamage) ? b.horizonDamage : -Infinity;
      return bDmg - aDmg;
    });
    const topCandidates = candidates.slice(0, 3).map(function (row) {
      return {
        slot: row && Number.isFinite(row.slot) ? row.slot : null,
        name: row && row.name ? row.name : "",
        horizonDamage: row && Number.isFinite(row.horizonDamage) ? row.horizonDamage : null,
        vsBaseline: row && row.vsBaseline ? row.vsBaseline : null,
        passesThreshold: !!(row && row.passesThreshold),
        thresholdPct: row && Number.isFinite(row.thresholdPct) ? row.thresholdPct : null,
        thresholdSource: row && row.thresholdSource ? row.thresholdSource : null,
        contextAdjustment: row && Number.isFinite(row.contextAdjustment) ? row.contextAdjustment : 0,
        contextParts: row && Array.isArray(row.contextParts) ? row.contextParts : [],
        contextPressure: row && row.contextPressure ? row.contextPressure : null,
        cooldownSec: row && Number.isFinite(row.cooldownSec) ? row.cooldownSec : null,
        cooldownExcessSec: row && Number.isFinite(row.cooldownExcessSec) ? row.cooldownExcessSec : null,
        cooldownOpportunityPenalty: row && Number.isFinite(row.cooldownOpportunityPenalty) ? row.cooldownOpportunityPenalty : null,
        chargeReleaseFraction: row && Number.isFinite(row.chargeReleaseFraction) ? row.chargeReleaseFraction : null,
        chargeReleaseSelectionMode: row && row.chargeReleaseSelectionMode ? row.chargeReleaseSelectionMode : null,
        chargeReleaseCandidateCount: row && Number.isFinite(row.chargeReleaseCandidateCount) ? row.chargeReleaseCandidateCount : 0,
        execute: row && row.execute ? row.execute : null
      };
    });
    return {
      ok: !!(diag && horizonPreview && horizonPreview.ok),
      enemyKey: horizonPreview && horizonPreview.enemyKey ? horizonPreview.enemyKey : null,
      decision: {
        lastReason: diag && diag.lastReason ? diag.lastReason : null,
        lastAt: diag && diag.lastAt ? diag.lastAt : null,
        pickedSlot: lastDetail && Number.isFinite(lastDetail.slot) ? lastDetail.slot : null,
        pickedName: lastDetail && lastDetail.name ? lastDetail.name : null,
        bestSkillVsBaselinePct: lastDetail && Number.isFinite(lastDetail.bestSkillVsBaselinePct) ? lastDetail.bestSkillVsBaselinePct : null,
        thresholdPct: lastDetail && Number.isFinite(lastDetail.thresholdPct) ? lastDetail.thresholdPct : null,
        thresholdSource: lastDetail && lastDetail.thresholdSource ? lastDetail.thresholdSource : null,
        minImprovementFraction: lastDetail && Number.isFinite(lastDetail.minImprovementFraction) ? lastDetail.minImprovementFraction : null,
        contextAdjustment: lastDetail && lastDetail.contextAdjustment ? lastDetail.contextAdjustment : null,
        executePolicy: lastDetail && lastDetail.executePolicy ? lastDetail.executePolicy : null,
        runtimeAggressionReason: lastDetail && lastDetail.runtimeAggression && lastDetail.runtimeAggression.reason
          ? lastDetail.runtimeAggression.reason
          : null,
        cooldownForecast: lastDetail && lastDetail.cooldownForecast ? lastDetail.cooldownForecast : null,
        bestCandidate: lastDetail && lastDetail.bestCandidate ? lastDetail.bestCandidate : null,
        filteredOut: lastDetail && lastDetail.filteredOut ? lastDetail.filteredOut : null,
        decisionMode: lastHorizon && lastHorizon.decisionMode ? lastHorizon.decisionMode : null
      },
      horizon: {
        requestedHorizonMs: horizonPreview && Number.isFinite(horizonPreview.requestedHorizonMs) ? horizonPreview.requestedHorizonMs : null,
        effectiveHorizonMs: horizonPreview && Number.isFinite(horizonPreview.horizonMs) ? horizonPreview.horizonMs : null,
        baselineDamage: horizonPreview && Number.isFinite(horizonPreview.baselineDamage) ? horizonPreview.baselineDamage : null,
        mobFactorApplied: horizonPreview && Number.isFinite(horizonPreview.mobFactorApplied) ? horizonPreview.mobFactorApplied : null,
        ttkApplied: !!(horizonPreview && horizonPreview.ttkContext && horizonPreview.ttkContext.applied),
        ttkTargetMs: horizonPreview && horizonPreview.ttkContext && Number.isFinite(horizonPreview.ttkContext.targetTtkMs)
          ? horizonPreview.ttkContext.targetTtkMs
          : null,
        candidateCount: candidates.length,
        topCandidates: topCandidates
      },
      thresholds: {
        globalThresholdPct: Number.isFinite(Config.planner.openerHorizonMinImprovementFraction)
          ? +(Config.planner.openerHorizonMinImprovementFraction * 100).toFixed(2)
          : 2,
        enemyAdaptiveThresholdPct: enemyAdaptive && Number.isFinite(enemyAdaptive.minFrac) ? +(enemyAdaptive.minFrac * 100).toFixed(2) : null,
        enemyAdaptiveReason: enemyAdaptive && enemyAdaptive.reason ? enemyAdaptive.reason : null,
        enemyAdaptiveApplied: !!(enemyAdaptive && enemyAdaptive.applied),
        ratioObservedVsCurrentPaper: enemyAdaptive && Number.isFinite(enemyAdaptive.ratioObservedVsCurrentPaper)
          ? enemyAdaptive.ratioObservedVsCurrentPaper
          : null,
        runtimeAggressionThresholdPct: runtimeAggression && Number.isFinite(runtimeAggression.minFrac)
          ? +(runtimeAggression.minFrac * 100).toFixed(2)
          : null,
        runtimeAggressionReason: runtimeAggression && runtimeAggression.reason ? runtimeAggression.reason : null,
        runtimeAggressionApplied: !!(runtimeAggression && runtimeAggression.applied)
      },
      runtime: {
        rankedPick: runtimeEvents && Number.isFinite(runtimeEvents.ranked_pick) ? runtimeEvents.ranked_pick : 0,
        rankedAltPick: runtimeEvents && Number.isFinite(runtimeEvents.ranked_alt_pick) ? runtimeEvents.ranked_alt_pick : 0,
        rankedPickNone: runtimeEvents && Number.isFinite(runtimeEvents.ranked_pick_none) ? runtimeEvents.ranked_pick_none : 0,
        rankedClickFailed: runtimeEvents && Number.isFinite(runtimeEvents.ranked_click_failed) ? runtimeEvents.ranked_click_failed : 0,
        rankedProgress: runtimeEvents && Number.isFinite(runtimeEvents.ranked_progress) ? runtimeEvents.ranked_progress : 0,
        rankedNoProgress: runtimeEvents && Number.isFinite(runtimeEvents.ranked_no_progress) ? runtimeEvents.ranked_no_progress : 0,
        basicFallbackAfterRanked: runtimeEvents && Number.isFinite(runtimeEvents.basic_fallback_after_ranked) ? runtimeEvents.basic_fallback_after_ranked : 0
      },
      naturalSniper: naturalSniperProbe || { error: "no_natural_sniper_probe" },
      forcedSniper: {
        readiness: forcedOpenerReadiness || null,
        runtime: forcedOpenerRuntime || null
      },
      tuningHint: tuningHint || null,
      policy: {
        conceptionEnabled: !!Config.planner.skillRankUseConception,
        queueEnabled: Config.planner.openerFollowUpSkillQueueEnabled !== false,
        queueDepth: Number.isFinite(Config.planner.openerFollowUpSkillDepth) ? Config.planner.openerFollowUpSkillDepth : 0,
        cooldownForecastEnabled: Config.planner.openerCooldownForecastEnabled !== false,
        cooldownForecastGraceSec: Number.isFinite(Config.planner.openerCooldownForecastGraceSec) ? Config.planner.openerCooldownForecastGraceSec : null,
        cooldownForecastCoeff: Number.isFinite(Config.planner.openerCooldownExcessPenaltyInBasicDps) ? Config.planner.openerCooldownExcessPenaltyInBasicDps : null,
        targetTtkAwareHorizon: Config.planner.openerTargetTtkAwareHorizonEnabled !== false,
        targetHpAwareScoring: Config.planner.openerTargetHpAwareScoring !== false,
        runtimeAggressionEnabled: Config.planner.openerRuntimeAggressionEnabled !== false,
        openerContextAwareScoring: Config.planner.openerContextAwareScoringEnabled !== false,
        executeModeEnabled: Config.planner.openerExecuteModeEnabled !== false,
        executeLowTargetBasicHitWindow: Number.isFinite(Config.planner.openerExecuteLowTargetBasicHitWindow) ? Config.planner.openerExecuteLowTargetBasicHitWindow : null,
        denseChargeSearchStepFraction: Number.isFinite(Config.combat.chargeSkillDynamicSearchStepFraction) ? Config.combat.chargeSkillDynamicSearchStepFraction : null,
        combatPotionsEnabled: Config.combat.useCombatPotions !== false
      }
    };
  }

  // AI CHANGED: One-click TEST — auto skill scan when needed, hero stats read, planner dry-run + diagnostics, probes, optional cancel smoke, quickCalibrationSession; console [TEST] SUMMARY + panel line; restarts auto-farm if it was ON (opts.resumeAutoFarm: false to leave stopped).
  async function runUiTestBundle(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const requestedProfile = typeof opts.testProfile === "string" ? opts.testProfile.trim().toLowerCase() : "quick";
    const isReleaseProfile = requestedProfile === "release" || requestedProfile === "long";
    const runCalibration = isReleaseProfile ? true : opts.runQuickCalibration !== false;
    // AI CHANGED: Legacy option kept for API compatibility; TEST no longer runs charge-cancel smoke by default.
    const fireChargeCancelIfHint = opts.fireChargeCancelIfHint === true;
    // AI CHANGED: Soak workflow hardening — release profile defaults to resume auto-farm after TEST when it was ON pre-run.
    const resumeAfter = typeof opts.resumeAutoFarm === "boolean"
      ? opts.resumeAutoFarm
      : isReleaseProfile;
    const forceSkillScan = opts.forceSkillScan === true;
    const runSkillScanIfNeeded = opts.runSkillScanIfNeeded !== false;
    const runHeroStatsInTest = opts.runHeroStatsInTest !== false;
    const strictCalibration = isReleaseProfile ? true : opts.strictCalibration === true;
    // AI CHANGED: Enforce ranked-combat validation by default; set strictRankedChecks:false only for ad-hoc smoke.
    const strictRankedChecks = isReleaseProfile ? true : opts.strictRankedChecks !== false;
    // AI CHANGED: TEST one-click policy — run short ranked soak automatically unless explicitly disabled.
    const autoRankedSoak = isReleaseProfile ? true : opts.autoRankedSoak !== false;
    const rankedSoakMinMs = Number.isFinite(opts.rankedSoakMinMs)
      ? opts.rankedSoakMinMs
      : (isReleaseProfile ? 180000 : 12000);
    const rankedSoakMaxMs = Number.isFinite(opts.rankedSoakMaxMs)
      ? opts.rankedSoakMaxMs
      : (isReleaseProfile ? 360000 : 45000);
    // AI CHANGED: Planner-tuning reliability — require a minimum runtime event budget so tuning hints are less often skipped.
    const rankedSoakMinEvents = Number.isFinite(opts.rankedSoakMinEvents)
      ? opts.rankedSoakMinEvents
      : (isReleaseProfile ? 16 : 6);
    const forcedRankedSkillName = opts.forceRankedSkillName === false
      ? ""
      : (typeof opts.forceRankedSkillName === "string" && opts.forceRankedSkillName.trim()
        ? opts.forceRankedSkillName.trim()
        : "Sniper Shot");
    const forceChargeReleaseFraction = Number.isFinite(opts.forceChargeReleaseFraction)
      ? opts.forceChargeReleaseFraction
      : null;
    let hadFarmOn = false;
    let bundleResult = null;
    const checks = [];
    // AI CHANGED: Defined for the whole bundle so later logging never references an out-of-scope var.
    let chargeCancelTest = null;
    let plannerBackup = null;
    let forcedOpenerReadiness = null;
    let forcedOpenerRuntime = null;
    let naturalSniperProbe = null;

    function addCheck(id, ok, detail, critical, note) {
      const c = { id: id, ok: !!ok, critical: critical === true };
      if (detail !== undefined) {
        c.detail = detail;
      }
      if (note) {
        c.note = note;
      }
      checks.push(c);
      return c;
    }

    function resolveForcedSkillSlotFromRuntime(skillName) {
      if (!skillName || !Array.isArray(Runtime.skills.slots)) {
        return null;
      }
      const wanted = typeof normalizeSkillName === "function"
        ? normalizeSkillName(skillName).toLowerCase()
        : String(skillName).trim().toLowerCase();
      for (let i = 0; i < Runtime.skills.slots.length; i += 1) {
        const row = Runtime.skills.slots[i];
        if (!row || row.kind !== "skill") {
          continue;
        }
        const got = typeof normalizeSkillName === "function"
          ? normalizeSkillName(row.name || "").toLowerCase()
          : String(row.name || "").trim().toLowerCase();
        if (got === wanted) {
          return {
            slot: typeof row.slot === "number" ? row.slot : i,
            name: row.name || "",
            record: row
          };
        }
      }
      return null;
    }

    // AI CHANGED: Reuse the planner's fresh-target threshold so TEST judges Sniper Shot only on the same kind of opener opportunity we actually score.
    function resolveTestFreshTargetHpPctMin() {
      return Number.isFinite(Config.planner && Config.planner.openerContextFreshTargetHpPctMin)
        ? Math.max(0.5, Math.min(1, Config.planner.openerContextFreshTargetHpPctMin))
        : 0.85;
    }

    // AI CHANGED: Natural Sniper Shot TEST needs live target hp pct to distinguish a fresh opener from a late-fight follow-up decision.
    function readLiveTargetHpPctForTest(liveState) {
      const hp =
        liveState &&
        liveState.combat &&
        liveState.combat.targetHp &&
        liveState.combat.targetHp.valid &&
        Number.isFinite(liveState.combat.targetHp.cur) &&
        Number.isFinite(liveState.combat.targetHp.max) &&
        liveState.combat.targetHp.max > 0
          ? liveState.combat.targetHp
          : null;
      return hp ? (hp.cur / hp.max) : null;
    }

    // AI CHANGED: Judge post-force Natural Sniper Shot only on calm single-target fresh-opener windows, not any later ranked pick.
    function evaluateFreshNaturalOpenerOpportunity(detail, liveState) {
      const targetHpPct = readLiveTargetHpPctForTest(liveState);
      const enemyCount =
        liveState &&
        liveState.combat &&
        typeof liveState.combat.enemyCount === "number"
          ? liveState.combat.enemyCount
          : null;
      const calmPressureMax = Number.isFinite(Config.planner && Config.planner.openerContextCalmPressureMax)
        ? Math.max(0, Config.planner.openerContextCalmPressureMax)
        : 0.2;
      const pressure =
        detail &&
        detail.contextAdjustment &&
        detail.contextAdjustment.pressure
          ? detail.contextAdjustment.pressure
          : null;
      if (!detail || !detail.horizonSim || typeof detail.slot !== "number") {
        return {
          ok: false,
          reason: "no_live_pick_detail",
          targetHpPct: Number.isFinite(targetHpPct) ? +targetHpPct.toFixed(4) : null,
          enemyCount: enemyCount
        };
      }
      if (!(enemyCount <= 1)) {
        return {
          ok: false,
          reason: "not_single_target",
          targetHpPct: Number.isFinite(targetHpPct) ? +targetHpPct.toFixed(4) : null,
          enemyCount: enemyCount
        };
      }
      if (!Number.isFinite(targetHpPct)) {
        return {
          ok: false,
          reason: "target_hp_unread",
          targetHpPct: null,
          enemyCount: enemyCount
        };
      }
      const freshTargetHpPctMin = resolveTestFreshTargetHpPctMin();
      if (targetHpPct < freshTargetHpPctMin) {
        return {
          ok: false,
          reason: "target_not_fresh_enough",
          targetHpPct: +targetHpPct.toFixed(4),
          targetHpPctMin: +freshTargetHpPctMin.toFixed(4),
          enemyCount: enemyCount
        };
      }
      if (pressure && Number.isFinite(pressure.totalPressure) && calmPressureMax > 0 && pressure.totalPressure > calmPressureMax) {
        return {
          ok: false,
          reason: "pressure_above_calm_window",
          targetHpPct: +targetHpPct.toFixed(4),
          targetHpPctMin: +freshTargetHpPctMin.toFixed(4),
          enemyCount: enemyCount,
          pressure: pressure.totalPressure
        };
      }
      return {
        ok: true,
        reason: null,
        targetHpPct: +targetHpPct.toFixed(4),
        targetHpPctMin: +freshTargetHpPctMin.toFixed(4),
        enemyCount: enemyCount,
        pressure: pressure && Number.isFinite(pressure.totalPressure) ? pressure.totalPressure : 0
      };
    }

    const af0 = getAutoFarmStatus();
    if (af0 && af0.running) {
      hadFarmOn = true;
      Logger.log("TEST", "auto-farm was ON — stopping for TEST; will restart loop after bundle if resumeAutoFarm stays true", af0);
      stopAutoFarmLoop();
      const maxWaitMs = 120000;
      const t0 = Date.now();
      // AI CHANGED: sleep must use bypassStop — plain sleep() returns immediately while stopRequested, causing a CPU spin freeze.
      while (Runtime.autoFarm.running && Date.now() - t0 < maxWaitMs) {
        await sleep(80, { bypassStop: true });
      }
      if (Runtime.autoFarm.running) {
        Logger.warn("TEST", "auto-farm still running after wait — continuing TEST anyway", getAutoFarmStatus());
      } else {
        Logger.log("TEST", "auto-farm idle — continuing");
      }
    }

    // AI CHANGED: if farm is not running, clear leaked stopRequested so TEST hero stats / verifies run full timeouts (same fix as loop exit in 85-combat.js).
    if (!Runtime.autoFarm.running) {
      Runtime.autoFarm.stopRequested = false;
    }
    plannerBackup = {
      useRankedAttackSkillsInCombat: !!Config.planner.useRankedAttackSkillsInCombat,
      skillMpReserve: Config.planner.skillMpReserve,
      forcedOpenerSkillName: Runtime.planner.forcedOpenerSkillName,
      forcedOpenerReason: Runtime.planner.forcedOpenerReason,
      chargeSkillDynamicReleaseEnabled: Config.combat.chargeSkillDynamicReleaseEnabled !== false,
      chargeSkillReleaseFraction: Config.combat.chargeSkillReleaseFraction,
      rankedOpenerEarlyCancelIfHintAfterMs: Config.combat.rankedOpenerEarlyCancelIfHintAfterMs
    };
    // AI CHANGED: TEST must self-enable ranked checks path; user should only press TEST.
    Config.planner.useRankedAttackSkillsInCombat = true;
    Config.planner.skillMpReserve = 0;
    Runtime.planner.forcedOpenerSkillName = forcedRankedSkillName || null;
    Runtime.planner.forcedOpenerReason = forcedRankedSkillName ? "runUiTestBundle" : null;
    if (forcedRankedSkillName && forceChargeReleaseFraction !== null) {
      Config.combat.chargeSkillDynamicReleaseEnabled = false;
      Config.combat.rankedOpenerEarlyCancelIfHintAfterMs = 0;
      Config.combat.chargeSkillReleaseFraction = forceChargeReleaseFraction;
    }

    try {
      Logger.log("TEST", `bundle start v${BotVersion.version}`, {
        runQuickCalibration: runCalibration,
        fireChargeCancelIfHint: fireChargeCancelIfHint,
        forceSkillScan: forceSkillScan,
        runHeroStatsInTest: runHeroStatsInTest,
        strictCalibration: strictCalibration,
        forceRankedSkillName: forcedRankedSkillName || null,
        forceChargeReleaseFraction: forceChargeReleaseFraction
      });

      addCheck(
        "version",
        !!(BotVersion && BotVersion.version),
        { version: BotVersion.version, description: BotVersion.description, builtAt: BotVersion.builtAt },
        true
      );
      addCheck(
        "test_profile",
        true,
        {
          profile: isReleaseProfile ? "release" : "quick",
          strictRankedChecks: strictRankedChecks,
          strictCalibration: strictCalibration,
          resumeAutoFarmAfterTest: resumeAfter,
          rankedSoakMinMs: rankedSoakMinMs,
          rankedSoakMaxMs: rankedSoakMaxMs,
          rankedSoakMinEvents: rankedSoakMinEvents,
          forceRankedSkillName: forcedRankedSkillName || null,
          forceChargeReleaseFraction: forceChargeReleaseFraction
        },
        false
      );

      try {
        probeSelectors();
        addCheck("probe_selectors", true, null, false);
      } catch (err) {
        Logger.warn("TEST", "probeSelectors threw", err);
        addCheck("probe_selectors", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        const attackersButton = document.querySelector(Config.selectors.attackersButton);
        addCheck("combat_attackers_retarget_ui", !!(attackersButton && isElementVisible(attackersButton)), {
          enabled: !(Config.combat && Config.combat.useAttackersPanelRetargetAfterKill === false),
          // AI CHANGED: Attackers-popup retarget path now reuses the first HP>0 confirmation and sends cancel immediately from that confirmed state.
          postRetargetCancelBeforeAttacks: true,
          postRetargetCancelConfirmMode: "reuse_first_hp_confirm",
          attackersButtonFound: !!attackersButton,
          attackersButtonVisible: !!(attackersButton && isElementVisible(attackersButton)),
          popupListSelector: Config.selectors.attackersPopupList,
          popupCardSelector: Config.selectors.attackersPopupCard
        }, false);
      } catch (err) {
        addCheck("combat_attackers_retarget_ui", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const lastPickDetail =
          Runtime &&
          Runtime.planner &&
          Runtime.planner.lastOpeningPickDetail &&
          typeof Runtime.planner.lastOpeningPickDetail === "object"
            ? Runtime.planner.lastOpeningPickDetail
            : null;
        addCheck("combat_post_retarget_guard", Config.combat.disallowChargeSkillFirstBurstAfterRetarget !== false, {
          enabled: Config.combat.disallowChargeSkillFirstBurstAfterRetarget !== false,
          policy: "until_first_verified_progress",
          observedOnLastPick: !!(lastPickDetail && lastPickDetail.postRetargetNoChargeGuard),
          lastPickReason: Runtime && Runtime.planner ? Runtime.planner.lastOpeningPickReason || null : null,
          filteredChargeCount:
            lastPickDetail &&
            lastPickDetail.filteredOut &&
            Number.isFinite(lastPickDetail.filteredOut.chargeGuard)
              ? lastPickDetail.filteredOut.chargeGuard
              : 0
        }, false);
      } catch (err) {
        addCheck("combat_post_retarget_guard", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const queueRt =
          Runtime &&
          Runtime.autoFarm &&
          Runtime.autoFarm.combatQueue &&
          typeof Runtime.autoFarm.combatQueue === "object"
            ? Runtime.autoFarm.combatQueue
            : null;
        const queueEvents =
          Runtime &&
          Runtime.planner &&
          Runtime.planner.openerRuntime &&
          Runtime.planner.openerRuntime.events &&
          typeof Runtime.planner.openerRuntime.events === "object"
            ? Runtime.planner.openerRuntime.events
            : null;
        addCheck("combat_queue_policy", Config.combat.combatQueueEnabled !== false, {
          enabled: Config.combat.combatQueueEnabled !== false,
          // AI CHANGED: Queue v2 trigger — advance the chain when the previous queued action name is visible in the cast/progress bar.
          trigger: "progress_bar_name_match",
          visibleCastBarTexts: typeof readVisibleCombatCastBarTexts === "function" ? readVisibleCombatCastBarTexts() : [],
          postProgressSettleMs: Number.isFinite(Config.combat.combatQueuePostProgressSettleMs) ? Config.combat.combatQueuePostProgressSettleMs : null,
          queuedActionArmed: queueEvents && Number.isFinite(queueEvents.queued_action_armed) ? queueEvents.queued_action_armed : 0,
          queuedActionFired: queueEvents && Number.isFinite(queueEvents.queued_action_fired) ? queueEvents.queued_action_fired : 0,
          runtimeQueue: queueRt ? Object.assign({}, queueRt) : null
        }, false);
      } catch (err) {
        addCheck("combat_queue_policy", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const nowMs = Date.now();
        const healthyFixture = evaluateAutoFarmHealth({
          session: {
            inGame: true,
            dead: false,
            poorConnection: false,
            coreUi: { visible: true, missing: false }
          },
          network: { pingMs: 80 },
          combat: { enemyCount: 0, targetHp: { valid: false } }
        }, {
          readonly: true,
          running: true,
          nowMs: nowMs,
          healthRuntime: {
            lastHealthyAt: nowMs - 1000,
            lastProgressAt: nowMs - 1000,
            lastActionVerifiedAt: nowMs - 1000,
            lastStateReadAt: nowMs - 1000,
            poorConnectionSince: null,
            deadSince: null,
            missingCoreUiSince: null,
            highPingSince: null,
            staleSince: null,
            suspectedOverload: false,
            lastRiskReason: null,
            lastSummary: null
          },
          recoveryRuntime: {
            softAttempts: 0,
            refreshAttempts: 0
          }
        });
        const criticalFixture = evaluateAutoFarmHealth({
          session: {
            inGame: true,
            dead: false,
            poorConnection: true,
            coreUi: { visible: false, missing: true }
          },
          network: { pingMs: 900 },
          combat: { enemyCount: 0, targetHp: { valid: false } }
        }, {
          readonly: true,
          running: true,
          nowMs: nowMs,
          healthRuntime: {
            lastHealthyAt: nowMs - 60000,
            lastProgressAt: nowMs - 60000,
            lastActionVerifiedAt: nowMs - 60000,
            lastStateReadAt: nowMs - 1000,
            poorConnectionSince: nowMs - (Config.recovery.poorConnectionGraceMs + 1000),
            deadSince: null,
            missingCoreUiSince: nowMs - (Config.recovery.missingCoreUiGraceMs + 1000),
            highPingSince: nowMs - (Config.recovery.highPingGraceMs + 1000),
            staleSince: nowMs - (Config.recovery.staleActionGraceMs + 1000),
            suspectedOverload: true,
            lastRiskReason: "poor_connection",
            lastSummary: null
          },
          recoveryRuntime: {
            softAttempts: Config.recovery.softRecoveryMaxAttemptsBeforeRefresh,
            refreshAttempts: 0
          }
        });
        addCheck("session_risk_detection", !!(
          healthyFixture &&
          healthyFixture.severity === "healthy" &&
          criticalFixture &&
          criticalFixture.severity === "critical"
        ), {
          healthyFixture: healthyFixture,
          criticalFixture: criticalFixture
        }, false);
      } catch (err) {
        addCheck("session_risk_detection", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const nowMs = Date.now();
        const refreshFixture = evaluateAutoFarmHealth({
          session: {
            inGame: true,
            dead: false,
            poorConnection: true,
            coreUi: { visible: false, missing: true }
          },
          network: { pingMs: 700 },
          combat: { enemyCount: 0, targetHp: { valid: false } }
        }, {
          readonly: true,
          running: true,
          nowMs: nowMs,
          healthRuntime: {
            lastHealthyAt: nowMs - 90000,
            lastProgressAt: nowMs - 90000,
            lastActionVerifiedAt: nowMs - 90000,
            lastStateReadAt: nowMs - 1000,
            poorConnectionSince: nowMs - (Config.recovery.poorConnectionGraceMs + 2000),
            deadSince: null,
            missingCoreUiSince: nowMs - (Config.recovery.missingCoreUiGraceMs + 2000),
            highPingSince: nowMs - (Config.recovery.highPingGraceMs + 2000),
            staleSince: nowMs - (Config.recovery.staleActionGraceMs + 2000),
            suspectedOverload: true,
            lastRiskReason: "stale_session_overload",
            lastSummary: null
          },
          recoveryRuntime: {
            softAttempts: Config.recovery.softRecoveryMaxAttemptsBeforeRefresh,
            refreshAttempts: 0
          }
        });
        addCheck("recovery_policy", !!(
          refreshFixture &&
          refreshFixture.recommendedAction === "refresh"
        ), {
          fixture: refreshFixture,
          softRecoveryMaxAttemptsBeforeRefresh: Config.recovery.softRecoveryMaxAttemptsBeforeRefresh,
          maxAutoRefreshAttemptsPerSession: Config.recovery.maxAutoRefreshAttemptsPerSession
        }, false);
      } catch (err) {
        addCheck("recovery_policy", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const existingToken = typeof readPersistedAutoRecoveryResume === "function" ? readPersistedAutoRecoveryResume() : null;
        const testToken = {
          version: BotVersion.version,
          createdAt: new Date().toISOString(),
          reason: "test_probe",
          resumeAutoFarm: true,
          refreshAttempts: 1
        };
        let roundTripOk = false;
        if (typeof writePersistedAutoRecoveryResume === "function" && typeof clearPersistedAutoRecoveryResume === "function" && typeof readPersistedAutoRecoveryResume === "function") {
          writePersistedAutoRecoveryResume(testToken);
          const readBack = readPersistedAutoRecoveryResume();
          roundTripOk = !!(readBack && readBack.reason === "test_probe" && readBack.resumeAutoFarm === true);
          clearPersistedAutoRecoveryResume();
          if (existingToken) {
            writePersistedAutoRecoveryResume(existingToken);
          }
        }
        addCheck("auto_resume_after_refresh", !!(
          Config.recovery &&
          Config.recovery.autoResumeAfterRefresh !== false &&
          roundTripOk
        ), {
          enabled: !!(Config.recovery && Config.recovery.autoResumeAfterRefresh !== false),
          storageKey: Config.recovery && Config.recovery.resumeStorageKey ? Config.recovery.resumeStorageKey : null,
          roundTripOk: roundTripOk
        }, false);
      } catch (err) {
        addCheck("auto_resume_after_refresh", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const autoStatus = getAutoFarmStatus();
        addCheck("watchdog_surface", !!(
          autoStatus &&
          autoStatus.health &&
          autoStatus.recovery &&
          typeof evaluateAutoFarmHealth === "function"
        ), {
          health: autoStatus ? autoStatus.health || null : null,
          recovery: autoStatus ? autoStatus.recovery || null : null,
          summary: typeof evaluateAutoFarmHealth === "function"
            ? evaluateAutoFarmHealth(readBasicState(), { readonly: true, running: !!(autoStatus && autoStatus.running) })
            : null
        }, false);
      } catch (err) {
        addCheck("watchdog_surface", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      try {
        const chatMessages =
          typeof getAllChatSpammerMessagesFlat === "function"
            ? getAllChatSpammerMessagesFlat()
            : Config.chat && Array.isArray(Config.chat.messages)
              ? Config.chat.messages.filter(Boolean)
              : [];
        const probeMessage =
          Config.chat &&
          Config.chat.messagesByTimeOfDay &&
          Array.isArray(Config.chat.messagesByTimeOfDay.morning) &&
          typeof Config.chat.messagesByTimeOfDay.morning[0] === "string"
            ? Config.chat.messagesByTimeOfDay.morning[0]
            : chatMessages.length > 0
              ? chatMessages[0]
              : "";
        const maxMessageLength = chatMessages.reduce(function (maxLen, row) {
          return Math.max(maxLen, typeof row === "string" ? row.length : 0);
        }, 0);
        const allMessagesUnder100Chars =
          chatMessages.length > 0 &&
          chatMessages.every(function (row) {
            return typeof row === "string" && row.length > 0 && row.length < 100;
          });
        const smoke =
          probeMessage && typeof probeLocalChatPromocodeUi === "function"
            ? await probeLocalChatPromocodeUi(probeMessage)
            : { ok: false, reason: probeMessage ? "probe_helper_missing" : "no_messages" };
        // AI CHANGED: Enforce <100 char bank + time-of-day banks; UI probe unchanged.
        addCheck(
          "chat_spammer_auto",
          !!(
            Config.chat &&
            Config.chat.autoLocalPromocodeSpammerEnabled !== false &&
            smoke &&
            smoke.ok &&
            allMessagesUnder100Chars
          ),
          {
            enabled: !!(Config.chat && Config.chat.autoLocalPromocodeSpammerEnabled !== false),
            mode: "auto_on_cycle_boundary_time_of_day_banks",
            intervalMinMs: Number.isFinite(Config.chat && Config.chat.messageIntervalMinMs) ? Config.chat.messageIntervalMinMs : null,
            intervalMaxMs: Number.isFinite(Config.chat && Config.chat.messageIntervalMaxMs) ? Config.chat.messageIntervalMaxMs : null,
            messageCount: chatMessages.length,
            maxMessageLength: maxMessageLength,
            allMessagesUnder100Chars: allMessagesUnder100Chars,
            timeSlotSample:
              typeof getTimeOfDayChatSlot === "function" ? getTimeOfDayChatSlot({ nowMs: Date.now() }) : null,
            probe: smoke,
            runtime: Runtime && Runtime.autoFarm ? Runtime.autoFarm.chatSpammer || null : null
          },
          false
        );
      } catch (err) {
        addCheck("chat_spammer_auto", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        Logger.log("TEST", "readBasicState", readBasicState());
      } catch (err) {
        Logger.warn("TEST", "readBasicState threw", err);
      }

      try {
        Logger.log("TEST", "getAutoFarmStatus", getAutoFarmStatus());
      } catch (err) {
        Logger.warn("TEST", "getAutoFarmStatus threw", err);
      }

      const slotsBefore = Runtime.skills.slots;
      const slotCountBefore = Array.isArray(slotsBefore) ? slotsBefore.length : 0;
      const hasNonEmptyBefore =
        Array.isArray(slotsBefore) && slotsBefore.some(function (s) { return s && s.kind !== "empty"; });
      const needsScan = forceSkillScan || isReleaseProfile || slotCountBefore === 0 || !hasNonEmptyBefore;
      const rankedOn0 = !!Config.planner.useRankedAttackSkillsInCombat;
      let scanRan = false;
      let scanSlots = null;
      if (runSkillScanIfNeeded && needsScan) {
        Logger.log("TEST", "auto scanSkills (empty cache, no non-empty slots, or forceSkillScan)");
        scanRan = true;
        try {
          scanSlots = await scanSkills();
        } catch (err) {
          Logger.warn("TEST", "scanSkills threw", err);
          scanSlots = null;
        }
        const scanOk = scanSlots !== null && Array.isArray(scanSlots) && scanSlots.length > 0;
        addCheck("skill_scan", scanOk, { ran: true, slots: scanSlots ? scanSlots.length : 0 }, rankedOn0);
      } else {
        const cacheOk = slotCountBefore > 0 && hasNonEmptyBefore;
        addCheck(
          "skill_scan",
          cacheOk || !rankedOn0,
          { ran: false, skipped: true, slotCount: slotCountBefore, hasNonEmpty: hasNonEmptyBefore },
          rankedOn0 && !cacheOk
        );
      }

      if (runHeroStatsInTest) {
        try {
          const h = await readHeroCombatStats();
          addCheck("hero_stats", !!(h && h.ok), h || null, false);
        } catch (err) {
          Logger.warn("TEST", "readHeroCombatStats threw", err);
          addCheck("hero_stats", false, { error: String(err && err.message ? err.message : err) }, false);
        }
      } else {
        addCheck("hero_stats", true, { skipped: true }, false);
      }

      // AI CHANGED: One-click ranked soak — generate real opener runtime telemetry before ranked diagnostics.
      if (autoRankedSoak) {
        let soakError = null;
        let soakTimedOut = false;
        let soakStarted = false;
        let soakStopped = false;
        let soakStopIssued = false;
        let soakPicks = 0;
        let soakProgress = 0;
        let soakTotalEvents = 0;
        let soakEvents = null;
        let soakAttemptCount = 1;
        let soakRetryUsed = false;
        let soakRetryReason = "";
        let soakRetryExtensionMs = 0;
        const forcedResolved = forcedRankedSkillName ? resolveForcedSkillSlotFromRuntime(forcedRankedSkillName) : null;
        const forcedReadyWaitMs = Number.isFinite(opts.forcedOpenerReadyWaitMs) ? opts.forcedOpenerReadyWaitMs : 12000;
        let forcedSeenDuringSoak = false;
        let forcedSeenAt = null;
        let forcedSeenCount = 0;
        const naturalSniperResolved = resolveForcedSkillSlotFromRuntime("Sniper Shot");
        const naturalSniperReadyWaitMs = Number.isFinite(opts.naturalSniperReadyWaitMs) ? opts.naturalSniperReadyWaitMs : 12000; // AI CHANGED: Wait long enough for post-force cooldown recovery before judging natural pick.
        const naturalSniperProbeWaitMs = Number.isFinite(opts.naturalSniperProbeWaitMs) ? opts.naturalSniperProbeWaitMs : 12000; // AI CHANGED: Give the post-force window enough time to reach at least one real opener decision in live auto-farm.
        const soakStartAt = Date.now();
        let soakDeadlineMs = rankedSoakMaxMs;
        if (typeof resetPlannerRuntimeTelemetry === "function") {
          try {
            resetPlannerRuntimeTelemetry();
          } catch (err) {
            Logger.warn("TEST", "resetPlannerRuntimeTelemetry threw", err);
          }
        }
        try {
          if (forcedRankedSkillName) {
            if (!forcedResolved) {
              forcedOpenerReadiness = {
                requestedName: forcedRankedSkillName,
                ready: false,
                reason: "not_found_on_bar"
              };
            } else {
              const readyStart = Date.now();
              let ready = false;
              let lastReason = null;
              let lastDetail = null;
              while (Date.now() - readyStart < forcedReadyWaitMs) {
                const probe = plannerPickSkillOpeningPick({ forceSkillName: forcedRankedSkillName });
                lastReason = Runtime.planner.lastOpeningPickReason || null;
                lastDetail = Runtime.planner.lastOpeningPickDetail || null;
                const probeSlot = probe && typeof probe.slot === "number" ? probe.slot : null;
                if (probe && probeSlot === forcedResolved.slot && lastReason === "forced_for_test") {
                  ready = true;
                  break;
                }
                await sleep(250, { bypassStop: true });
              }
              forcedOpenerReadiness = {
                requestedName: forcedRankedSkillName,
                slot: forcedResolved.slot,
                matchedName: forcedResolved.name,
                waitedMs: Date.now() - readyStart,
                chargeReleaseFractionOverride: forceChargeReleaseFraction,
                ready: ready,
                lastReason: lastReason,
                lastDetail: lastDetail,
                reason: ready ? null : "not_ready_before_soak"
              };
            }
            Logger.log("TEST", "forced opener readiness", forcedOpenerReadiness);
          }
          if (!Runtime.autoFarm.running) {
            // AI CHANGED: Do not await loop promise here — it resolves only after stop; TEST would hang.
            startAutoFarmLoop();
            soakStarted = true;
          } else {
            soakStarted = true;
          }
          while (Date.now() - soakStartAt < soakDeadlineMs) {
            await sleep(250, { bypassStop: true });
            const rt = typeof getPlannerRuntimeTelemetry === "function"
              ? getPlannerRuntimeTelemetry()
              : (Runtime.planner && Runtime.planner.openerRuntime ? Runtime.planner.openerRuntime : null);
            const ev = rt && rt.events ? rt.events : null;
            const picks = ev && Number.isFinite(ev.ranked_pick) ? ev.ranked_pick : 0;
            const progress = ev && Number.isFinite(ev.ranked_progress) ? ev.ranked_progress : 0;
            const totalEvents = ev
              ? Object.keys(ev).reduce(function (acc, k) {
                const n = ev[k];
                return acc + (Number.isFinite(n) ? n : 0);
              }, 0)
              : 0;
            soakPicks = picks;
            soakProgress = progress;
            soakTotalEvents = totalEvents;
            soakEvents = ev || null;
            if (!forcedSeenDuringSoak && forcedResolved && rt && Array.isArray(rt.recent)) {
              const forcedRows = rt.recent.filter(function (row) {
                return row && row.event === "ranked_pick" && row.detail && row.detail.slot === forcedResolved.slot;
              });
              if (forcedRows.length > 0) {
                forcedSeenDuringSoak = true;
                forcedSeenCount = forcedRows.length;
                forcedSeenAt = forcedRows[0].at || null;
              }
            }
            if (Date.now() - soakStartAt >= rankedSoakMinMs && totalEvents >= rankedSoakMinEvents) {
              break;
            }
            // AI CHANGED: TEST soak reliability — extend once when the initial window produced no ranked activity at all.
            if (!soakRetryUsed && Date.now() - soakStartAt >= rankedSoakMaxMs && soakTotalEvents <= 0) {
              const extraMs = Number.isFinite(opts.rankedSoakRetryExtraMs) ? opts.rankedSoakRetryExtraMs : 20000;
              soakRetryUsed = true;
              soakAttemptCount = 2;
              soakRetryExtensionMs = extraMs;
              soakRetryReason = "no_ranked_activity_initial_window";
              soakDeadlineMs = rankedSoakMaxMs + extraMs;
              Logger.log("TEST", "ranked soak retry window enabled", {
                reason: soakRetryReason,
                extraMs: extraMs,
                newDeadlineMs: soakDeadlineMs
              });
            }
            // AI CHANGED: TEST soak reliability — if ranked events are flowing but the quota is not met yet, allow one extra window instead of failing the suite on a near-miss.
            if (!soakRetryUsed && Date.now() - soakStartAt >= rankedSoakMaxMs && soakTotalEvents > 0 && soakTotalEvents < rankedSoakMinEvents) {
              const extraMs = Number.isFinite(opts.rankedSoakPartialRetryExtraMs) ? opts.rankedSoakPartialRetryExtraMs : 20000;
              soakRetryUsed = true;
              soakAttemptCount = 2;
              soakRetryExtensionMs = extraMs;
              soakRetryReason = "partial_ranked_activity_before_timeout";
              soakDeadlineMs = rankedSoakMaxMs + extraMs;
              Logger.log("TEST", "ranked soak retry window enabled", {
                reason: soakRetryReason,
                extraMs: extraMs,
                currentTotalEvents: soakTotalEvents,
                targetMinEvents: rankedSoakMinEvents,
                newDeadlineMs: soakDeadlineMs
              });
            }
          }
          if (Date.now() - soakStartAt >= soakDeadlineMs && soakTotalEvents < rankedSoakMinEvents) {
            soakTimedOut = true;
          }
          Runtime.planner.forcedOpenerSkillName = null;
          Runtime.planner.forcedOpenerReason = null;
          if (!naturalSniperResolved) {
            naturalSniperProbe = { skipped: true, reason: "sniper_shot_not_on_bar" };
          } else {
            let naturalReady = true;
            let naturalReadyWaitedMs = 0;
            let naturalReadyLastReason = null;
            let naturalReadyLastDetail = null;
            const forcedMatchesNatural =
              forcedRankedSkillName &&
              typeof normalizeSkillName === "function" &&
              normalizeSkillName(forcedRankedSkillName).toLowerCase() === normalizeSkillName(naturalSniperResolved.name || "Sniper Shot").toLowerCase();
            if (forcedMatchesNatural) {
              const naturalReadyStart = Date.now();
              naturalReady = false;
              while (Runtime.autoFarm.running && Date.now() - naturalReadyStart < naturalSniperReadyWaitMs) {
                const readyProbe = plannerPickSkillOpeningPick({ forceSkillName: naturalSniperResolved.name || "Sniper Shot" });
                naturalReadyLastReason = Runtime.planner.lastOpeningPickReason || null;
                naturalReadyLastDetail = Runtime.planner.lastOpeningPickDetail || null;
                const readySlot = readyProbe && typeof readyProbe.slot === "number" ? readyProbe.slot : null;
                if (readyProbe && readySlot === naturalSniperResolved.slot && naturalReadyLastReason === "forced_for_test") {
                  naturalReady = true;
                  break;
                }
                await sleep(250, { bypassStop: true });
              }
              naturalReadyWaitedMs = Date.now() - naturalReadyStart;
            }
            const naturalProbeStart = Date.now();
            let naturalPicked = false;
            let naturalPickedAt = null;
            let naturalLastReason = null;
            let naturalLastDetail = null;
            let naturalPickCountSeen = 0;
            let naturalDecisionCountSeen = 0;
            let naturalDecisionEvents = [];
            let naturalFreshDecisionCountSeen = 0;
            let naturalFreshDecisionEvents = [];
            let naturalLastOpportunityReason = null;
            let naturalLastOpportunityOk = false;
            let naturalLastLiveTargetHpPct = null;
            let naturalLastLiveEnemyCount = null;
            let naturalLastHandledDecisionAt = null;
            if (naturalReady) {
              while (Runtime.autoFarm.running && Date.now() - naturalProbeStart < naturalSniperProbeWaitMs) {
                await sleep(250, { bypassStop: true });
                naturalLastReason = Runtime.planner.lastOpeningPickReason || null;
                naturalLastDetail = Runtime.planner.lastOpeningPickDetail || null;
                const liveNow = readBasicState();
                naturalLastLiveTargetHpPct = readLiveTargetHpPctForTest(liveNow);
                naturalLastLiveEnemyCount =
                  liveNow &&
                  liveNow.combat &&
                  typeof liveNow.combat.enemyCount === "number"
                    ? liveNow.combat.enemyCount
                    : null;
                const rt = typeof getPlannerRuntimeTelemetry === "function"
                  ? getPlannerRuntimeTelemetry()
                  : (Runtime.planner && Runtime.planner.openerRuntime ? Runtime.planner.openerRuntime : null);
                const naturalRows =
                  rt && Array.isArray(rt.recent)
                    ? rt.recent.filter(function (row) {
                        return row &&
                          row.at >= naturalProbeStart &&
                          row.event === "ranked_pick" &&
                          row.detail &&
                          row.detail.slot === naturalSniperResolved.slot;
                      })
                    : [];
                const decisionRows =
                  rt && Array.isArray(rt.recent)
                    ? rt.recent.filter(function (row) {
                        return row &&
                          row.at >= naturalProbeStart &&
                          (
                            row.event === "ranked_pick" ||
                            row.event === "ranked_alt_pick" ||
                            row.event === "ranked_pick_none" ||
                            row.event === "ranked_click_failed" ||
                            row.event === "basic_fallback_after_ranked"
                          );
                      })
                    : [];
                naturalDecisionCountSeen = decisionRows.length;
                naturalDecisionEvents = decisionRows.map(function (row) { return row.event; }).slice(-8);
                if (naturalRows.length > 0) {
                  naturalPickCountSeen = naturalRows.length;
                }
                if (decisionRows.length > 0) {
                  const latestDecision = decisionRows[decisionRows.length - 1];
                  if (latestDecision && latestDecision.at !== naturalLastHandledDecisionAt) {
                    naturalLastHandledDecisionAt = latestDecision.at || naturalLastHandledDecisionAt;
                    const opportunity = evaluateFreshNaturalOpenerOpportunity(naturalLastDetail, liveNow);
                    naturalLastOpportunityReason = opportunity.reason;
                    naturalLastOpportunityOk = !!opportunity.ok;
                    if (opportunity.ok) {
                      naturalFreshDecisionCountSeen += 1;
                      naturalFreshDecisionEvents = naturalFreshDecisionEvents.concat([latestDecision.event]).slice(-8);
                      if (latestDecision.event === "ranked_pick" && latestDecision.detail && latestDecision.detail.slot === naturalSniperResolved.slot) {
                        naturalPicked = true;
                        naturalPickedAt = latestDecision.at || null;
                      }
                      break; // AI CHANGED: Judge Natural Sniper Shot only from a fresh single-target opener opportunity, not any later in-fight ranked pick.
                    }
                  }
                }
              }
            }
            naturalSniperProbe = {
              slot: naturalSniperResolved.slot,
              name: naturalSniperResolved.name,
              mode: "live_post_force_window",
              observedWhileAutoFarmRunning: true,
              waitedMs: naturalReady ? (Date.now() - naturalProbeStart) : 0,
              readinessWaitedMs: naturalReadyWaitedMs,
              readyAfterForcedSoak: naturalReady,
              readinessLastReason: naturalReadyLastReason,
              readinessLastDetail: naturalReadyLastDetail,
              pickedNaturally: naturalPicked,
              pickedAt: naturalPickedAt,
              pickCountSeen: naturalPickCountSeen,
              decisionCountSeen: naturalDecisionCountSeen,
              decisionEventsSeen: naturalDecisionEvents,
              freshDecisionCountSeen: naturalFreshDecisionCountSeen,
              freshDecisionEventsSeen: naturalFreshDecisionEvents,
              lastOpportunityReason: naturalLastOpportunityReason,
              lastOpportunityQualified: naturalLastOpportunityOk,
              lastLiveTargetHpPct: Number.isFinite(naturalLastLiveTargetHpPct) ? +naturalLastLiveTargetHpPct.toFixed(4) : null,
              lastLiveEnemyCount: naturalLastLiveEnemyCount,
              freshTargetHpPctMin: +resolveTestFreshTargetHpPctMin().toFixed(4),
              skipped: !naturalPicked && naturalFreshDecisionCountSeen <= 0,
              lastReason: naturalLastReason,
              lastDetail: naturalLastDetail,
              reason: naturalReady
                ? (naturalPicked
                  ? null
                  : (naturalFreshDecisionCountSeen > 0 ? "not_picked_after_fresh_live_decision" : "no_fresh_post_force_opener_decision_observed"))
                : "not_ready_after_forced_soak"
            };
            Logger.log("TEST", "natural sniper probe", naturalSniperProbe);
          }
        } catch (err) {
          soakError = String(err && err.message ? err.message : err);
          Logger.warn("TEST", "auto ranked soak failed", err);
        } finally {
          if (Runtime.autoFarm.running) {
            // AI CHANGED: Graceful TEST stop — wait for a safe boundary (combat cleared) before issuing stop request.
            const safeStopWaitMs = Number.isFinite(opts.rankedSoakSafeStopWaitMs) ? opts.rankedSoakSafeStopWaitMs : 12000;
            const safeStopStart = Date.now();
            while (Runtime.autoFarm.running && Date.now() - safeStopStart < safeStopWaitMs) {
              const stNow = readBasicState();
              const enemiesNow = stNow && stNow.combat ? stNow.combat.enemyCount : null;
              if (typeof enemiesNow === "number" && enemiesNow <= 0) {
                break;
              }
              await sleep(200, { bypassStop: true });
            }
            soakStopIssued = true;
            stopAutoFarmLoop();
            const waitStopStart = Date.now();
            while (Runtime.autoFarm.running && Date.now() - waitStopStart < 60000) {
              await sleep(120, { bypassStop: true });
            }
          }
          soakStopped = !Runtime.autoFarm.running;
        }
        const soakStopAccepted = soakStopped || (soakStopIssued && Runtime.autoFarm.stopRequested);
        const soakActivityOk = soakTotalEvents >= rankedSoakMinEvents;
        forcedOpenerRuntime = forcedRankedSkillName
          ? {
              requestedName: forcedRankedSkillName,
              chargeReleaseFractionOverride: forceChargeReleaseFraction,
              resolvedSlot: forcedResolved ? forcedResolved.slot : null,
              resolvedName: forcedResolved ? forcedResolved.name : null,
              usedDuringSoak: forcedSeenDuringSoak,
              firstUsedAt: forcedSeenAt,
              pickCountSeen: forcedSeenCount
            }
          : null;
        let soakReason = "";
        if (soakTimedOut) {
          soakReason = soakTotalEvents > 0 ? "insufficient_ranked_events_before_timeout" : "no_ranked_activity_before_timeout";
        } else if (!soakActivityOk) {
          soakReason = "no_ranked_activity";
        } else if (soakError) {
          soakReason = "soak_error";
        } else if (!soakStopAccepted) {
          soakReason = "stop_not_accepted";
        }
        addCheck(
          "planner_ranked_soak",
          soakActivityOk && !soakError && !soakTimedOut,
          {
            started: soakStarted,
            stopped: soakStopped,
            stopIssued: soakStopIssued,
            stopAccepted: soakStopAccepted,
            durationMs: Date.now() - soakStartAt,
            rankedPicks: soakPicks,
            rankedProgressEvents: soakProgress,
            totalRankedEvents: soakTotalEvents,
            targetMinEvents: rankedSoakMinEvents,
            minEventsReached: soakTotalEvents >= rankedSoakMinEvents,
            attemptCount: soakAttemptCount,
            retryUsed: soakRetryUsed,
            retryReason: soakRetryReason || null,
            retryExtensionMs: soakRetryExtensionMs,
            timedOut: soakTimedOut,
            reason: soakReason || null,
            forcedOpenerReadiness: forcedOpenerReadiness,
            forcedOpenerRuntime: forcedOpenerRuntime,
            events: soakEvents,
            error: soakError
          },
          strictRankedChecks
        );
      } else {
        addCheck("planner_ranked_soak", true, { skipped: true, reason: "auto_ranked_soak_off" }, false);
        if (!naturalSniperProbe) {
          naturalSniperProbe = { skipped: true, reason: "auto_ranked_soak_off" }; // AI CHANGED: Keep Natural Sniper Shot check self-explanatory when soak is disabled.
        }
      }
      Runtime.planner.forcedOpenerSkillName = null;
      Runtime.planner.forcedOpenerReason = null;

      try {
        Logger.log("TEST", "summarizePlannerInputs", summarizePlannerInputs());
      } catch (err) {
        Logger.warn("TEST", "summarizePlannerInputs threw", err);
      }

      try {
        Logger.log("TEST", "rankAttackSkillsByHeuristic", rankAttackSkillsByHeuristic({}));
      } catch (err) {
        Logger.warn("TEST", "rankAttackSkillsByHeuristic threw", err);
      }

      try {
        plannerPickSkillOpeningPick({});
      } catch (err) {
        Logger.warn("TEST", "plannerPickSkillOpeningPick threw", err);
      }
      let diag = null;
      try {
        diag = getPlannerOpeningPickDiagnostics();
        Logger.log("TEST", "plannerOpeningPickDiagnostics", diag);
      } catch (err) {
        Logger.warn("TEST", "getPlannerOpeningPickDiagnostics threw", err);
      }
      const classProfile = diag && diag.classProfile ? diag.classProfile : null;
      addCheck(
        "planner_class_profile",
        !!(classProfile && classProfile.ok && classProfile.profileKey),
        classProfile || { error: "no_class_profile" },
        false
      );
      const enemyAdaptive = diag && diag.enemyAdaptive ? diag.enemyAdaptive : null;
      addCheck(
        "planner_enemy_adaptation",
        !!(enemyAdaptive && Number.isFinite(enemyAdaptive.minFrac)),
        enemyAdaptive || { error: "no_enemy_adaptation" },
        false
      );
      addCheck(
        "planner_rotation_policy",
        !!(diag && Number.isFinite(diag.rankedBurstsPerFindEffective) && diag.rankedBurstsPerFindEffective >= 1),
        diag ? { rankedBurstsPerFindEffective: diag.rankedBurstsPerFindEffective } : { error: "no_diag" },
        false
      );
      // AI CHANGED: Combat teaching — diagnostics for multi-mob channel deprioritization in heuristic rank.
      const mmRank = diag && diag.multiMobChannelRank ? diag.multiMobChannelRank : null;
      addCheck(
        "planner_multimob_channel",
        !!(mmRank && typeof mmRank.enemyCount === "number"),
        mmRank || { error: "no_multimob_rank" },
        false
      );
      addCheck(
        "planner_natural_sniper_shot",
        !!(
          naturalSniperProbe &&
          (naturalSniperProbe.skipped || naturalSniperProbe.pickedNaturally)
        ),
        naturalSniperProbe
          ? Object.assign({}, naturalSniperProbe, {
              lastOpenerHorizonSim: diag ? diag.lastOpenerHorizonSim : null
            })
          : { error: "no_natural_sniper_probe" },
        false
      );
      addCheck(
        "planner_forced_opener",
        !forcedRankedSkillName || !!(
          forcedOpenerReadiness &&
          forcedOpenerReadiness.ready &&
          forcedOpenerRuntime &&
          forcedOpenerRuntime.usedDuringSoak
        ),
        forcedRankedSkillName
          ? {
              requestedName: forcedRankedSkillName,
              readiness: forcedOpenerReadiness,
              runtime: forcedOpenerRuntime
            }
          : { skipped: true, reason: "force_ranked_skill_off" },
        false
      );
      try {
        const skillRows = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
        const chargeSample = skillRows.find(function (slotRec) {
          return slotRec && slotRec.kind === "skill" && typeof plannerBuildChargeReleasePlan === "function" && !!plannerBuildChargeReleasePlan(slotRec);
        }) || null;
        if (!chargeSample) {
          addCheck("planner_charge_release_policy", true, { skipped: true, reason: "no_charge_skill_on_bar" }, false);
          addCheck("planner_dynamic_charge_scoring", true, { skipped: true, reason: "no_charge_skill_on_bar" }, false);
        } else {
          const chargePlan = plannerBuildChargeReleasePlan(chargeSample);
          const chargePlanOk = !!(
            chargePlan &&
            Number.isFinite(chargePlan.channelMaxMs) &&
            Number.isFinite(chargePlan.releaseMs) &&
            chargePlan.releaseMs > 0 &&
            chargePlan.releaseMs <= chargePlan.channelMaxMs &&
            Number.isFinite(chargePlan.releaseFraction) &&
            chargePlan.releaseFraction > 0 &&
            chargePlan.releaseFraction <= 1 &&
            Array.isArray(chargePlan.candidates) &&
            chargePlan.candidates.length >= 1
          );
          addCheck("planner_charge_release_policy", chargePlanOk, {
            slot: chargeSample.slot,
            name: chargeSample.name || "",
            dynamicEnabled: Config.combat.chargeSkillDynamicReleaseEnabled !== false,
            forcedFraction: forceChargeReleaseFraction,
            plan: chargePlan
          }, false);
          const dynamicChargeOk =
            Config.combat.chargeSkillDynamicReleaseEnabled === false
              ? true
              : !!(
                  chargePlan &&
                  (
                    chargePlan.selectionMode === "dynamic_horizon_best_total" ||
                    chargePlan.selectionMode === "dynamic_execute_earliest_lethal"
                  ) &&
                  chargePlan.scoringContext &&
                  Array.isArray(chargePlan.candidates) &&
                  chargePlan.candidates.length >= 20 &&
                  chargePlan.candidates.some(function (row) {
                    return row && Number.isFinite(row.holdRiskPenalty) && typeof row.followUpActionMode === "string" && row.execute && typeof row.execute.enabled === "boolean";
                  })
                );
          addCheck("planner_dynamic_charge_scoring", dynamicChargeOk, {
            slot: chargeSample.slot,
            name: chargeSample.name || "",
            dynamicEnabled: Config.combat.chargeSkillDynamicReleaseEnabled !== false,
            forcedFraction: forceChargeReleaseFraction,
            plan: chargePlan
          }, false);
        }
      } catch (err) {
        addCheck("planner_charge_release_policy", false, { error: String(err && err.message ? err.message : err) }, false);
        addCheck("planner_dynamic_charge_scoring", false, { error: String(err && err.message ? err.message : err) }, false);
      }
      const rankedOn = !!Config.planner.useRankedAttackSkillsInCombat;
      addCheck(
        "planner_ranked_preflight",
        rankedOn || !strictRankedChecks,
        rankedOn
          ? { rankedCombatEnabled: true, strictRankedChecks: strictRankedChecks }
          : (strictRankedChecks
            ? { rankedCombatEnabled: false, strictRankedChecks: true, error: "ranked_combat_off" }
            : { skipped: true, reason: "ranked_combat_off", strictRankedChecks: false }),
        strictRankedChecks
      );
      // AI CHANGED: Planner v2 check — mark skipped when ranked opener is disabled (path not exercised).
      if (!rankedOn) {
        addCheck(
          "planner_conception_path",
          !strictRankedChecks,
          strictRankedChecks
            ? {
              error: "ranked_combat_off",
              strictRankedChecks: true,
              skillRankUseConception: !!Config.planner.skillRankUseConception
            }
            : {
              skipped: true,
              reason: "ranked_combat_off",
              skillRankUseConception: !!Config.planner.skillRankUseConception
            },
          strictRankedChecks
        );
      } else {
        const conceptionOn = !!(Config.planner.skillRankUseConception === true);
        const horizonRankMode =
          diag &&
          diag.lastOpenerHorizonSim &&
          diag.lastOpenerHorizonSim.rankMode
            ? diag.lastOpenerHorizonSim.rankMode
            : null;
        const conceptionModeObserved = horizonRankMode === "conception";
        addCheck("planner_conception_path", conceptionOn && conceptionModeObserved, {
          skillRankUseConception: conceptionOn,
          lastReason: diag && diag.lastReason ? diag.lastReason : null,
          horizonRankMode: horizonRankMode,
          conceptionGate:
            diag &&
            diag.lastOpenerHorizonSim &&
            diag.lastOpenerHorizonSim.conceptionGate
              ? diag.lastOpenerHorizonSim.conceptionGate
              : null
        }, false);
      }
      // AI CHANGED: Ranked-opener soak telemetry check — skipped unless ranked is ON and runtime events exist.
      if (!rankedOn) {
        addCheck(
          "planner_ranked_runtime",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else {
        const rt =
          diag &&
          diag.openerRuntime &&
          typeof diag.openerRuntime === "object"
            ? diag.openerRuntime
            : null;
        const ev = rt && rt.events && typeof rt.events === "object" ? rt.events : null;
        const totalEvents =
          ev
            ? Object.keys(ev).reduce(function (acc, k) {
              const n = ev[k];
              return acc + (Number.isFinite(n) ? n : 0);
            }, 0)
            : 0;
        if (totalEvents <= 0) {
          addCheck("planner_ranked_runtime", true, {
            skipped: true,
            reason: "no_ranked_runtime_events_yet",
            hint: "Run ON in combat for ~1-2 minutes, then TEST again."
          }, false);
        } else {
          addCheck("planner_ranked_runtime", true, {
            totalEvents: totalEvents,
            events: ev,
            lastEvent: rt ? rt.lastEvent : null,
            lastAt: rt ? rt.lastAt : null
          }, false);
        }
      }
      // AI CHANGED: ranked builds — TEST exercises openerHorizonSim preview (ship rule: new testable behavior via TEST).
      let horizonPreview = null;
      if (rankedOn) {
        try {
          horizonPreview = previewOpenerHorizonSim({});
          Logger.log("TEST", "previewOpenerHorizonSim", horizonPreview);
        } catch (err) {
          Logger.warn("TEST", "previewOpenerHorizonSim threw", err);
        }
        addCheck(
          "planner_opener_horizon_preview",
          !!(horizonPreview && horizonPreview.ok),
          horizonPreview,
          false
        );
      } else {
        addCheck(
          "planner_opener_horizon_preview",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      }
      if (!rankedOn) {
        addCheck(
          "planner_opener_context_scoring",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else {
        const previewRows = horizonPreview && Array.isArray(horizonPreview.candidates) ? horizonPreview.candidates : [];
        const previewHasContext = previewRows.length > 0 && previewRows.every(function (row) {
          return row && Number.isFinite(row.contextAdjustment) && Array.isArray(row.contextParts);
        });
        const detailCtx = diag && diag.lastDetail && diag.lastDetail.contextAdjustment ? diag.lastDetail.contextAdjustment : null;
        const forcedOnlyDetail = !!(diag && diag.lastReason === "forced_for_test" && !detailCtx);
        const detailHasContext = !!(
          detailCtx &&
          Number.isFinite(detailCtx.total) &&
          Array.isArray(detailCtx.parts)
        );
        addCheck("planner_opener_context_scoring", previewHasContext && (detailHasContext || forcedOnlyDetail), {
          previewCandidateCount: previewRows.length,
          previewHasContext: previewHasContext,
          detailHasContext: detailHasContext,
          forcedOnlyDetail: forcedOnlyDetail,
          lastReason: diag && diag.lastReason ? diag.lastReason : null,
          detailContextAdjustment: detailCtx,
          previewSample: previewRows.slice(0, 3).map(function (row) {
            return {
              slot: row && Number.isFinite(row.slot) ? row.slot : null,
              name: row && row.name ? row.name : "",
              contextAdjustment: row && Number.isFinite(row.contextAdjustment) ? row.contextAdjustment : null,
              contextParts: row && Array.isArray(row.contextParts) ? row.contextParts : [],
              contextPressure: row && row.contextPressure ? row.contextPressure : null,
              execute: row && row.execute ? row.execute : null
            };
          })
        }, false);
      }
      if (!rankedOn) {
        addCheck(
          "planner_execute_policy",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else {
        const previewRows = horizonPreview && Array.isArray(horizonPreview.candidates) ? horizonPreview.candidates : [];
        const previewHasExecute = previewRows.length > 0 && previewRows.every(function (row) {
          return row && row.execute && typeof row.execute.enabled === "boolean";
        });
        const detailExecute = diag && diag.lastDetail ? diag.lastDetail.executePolicy || null : null;
        if (!previewHasExecute) {
          addCheck("planner_execute_policy", false, {
            error: "missing_execute_payload",
            previewCandidateCount: previewRows.length
          }, false);
        } else if (detailExecute && detailExecute.eligibleWindow) {
          addCheck("planner_execute_policy", true, {
            previewHasExecute: true,
            detailExecute: detailExecute,
            lastReason: diag && diag.lastReason ? diag.lastReason : null
          }, false);
        } else {
          addCheck("planner_execute_policy", true, {
            skipped: true,
            reason: "no_live_execute_window",
            previewHasExecute: true,
            detailExecute: detailExecute,
            previewSample: previewRows.slice(0, 3).map(function (row) {
              return {
                slot: row && Number.isFinite(row.slot) ? row.slot : null,
                name: row && row.name ? row.name : "",
                execute: row && row.execute ? row.execute : null,
                chargeReleaseFraction: row && Number.isFinite(row.chargeReleaseFraction) ? row.chargeReleaseFraction : null
              };
            })
          }, false);
        }
      }
      const goldenComparator =
        rankedOn
          ? buildPlannerGoldenComparator(diag, horizonPreview, naturalSniperProbe, forcedOpenerReadiness, forcedOpenerRuntime)
          : { skipped: true, reason: "ranked_combat_off" }; // AI CHANGED: Golden comparator rides the ranked opener path, so skip cleanly when ranked combat is off.
      Logger.log("TEST", "plannerGoldenComparator", goldenComparator);
      addCheck(
        "planner_golden_comparator",
        rankedOn ? !!(goldenComparator && goldenComparator.ok) : !strictRankedChecks,
        goldenComparator,
        false
      );
      let openerOk = !rankedOn;
      if (rankedOn) {
        openerOk =
          !!diag &&
          diag.lastReason !== "empty_cache" &&
          diag.lastReason !== "no_attack_skills_for_ranker";
      }
      addCheck("planner_ranked_openers", openerOk, diag, rankedOn);
      // AI CHANGED: Decision-quality check — when horizon prefers basic, detail must explain by pct + threshold and filtered-out counts.
      if (!rankedOn) {
        addCheck(
          "planner_ranked_reason_quality",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else {
        const lastReason = diag && diag.lastReason ? diag.lastReason : null;
        const d = diag && diag.lastDetail ? diag.lastDetail : null;
        let qualityOk = true;
        let qualityDetail = { lastReason: lastReason };
        if (lastReason === "horizon_prefers_basic") {
          const hasPct = d && Number.isFinite(d.bestSkillVsBaselinePct);
          const hasThresholdPct = d && Number.isFinite(d.thresholdPct);
          const hasFiltered =
            d &&
            d.filteredOut &&
            Number.isFinite(d.filteredOut.cooldown) &&
            Number.isFinite(d.filteredOut.mpGate);
          qualityOk = !!(hasPct && hasThresholdPct && hasFiltered);
          qualityDetail = {
            lastReason: lastReason,
            bestSkillVsBaselinePct: d ? d.bestSkillVsBaselinePct : null,
            thresholdPct: d ? d.thresholdPct : null,
            filteredOut: d ? d.filteredOut : null
          };
        } else if (lastReason === "picked") {
          qualityOk = !!(d && Number.isFinite(d.slot));
          qualityDetail = {
            lastReason: lastReason,
            slot: d ? d.slot : null,
            name: d ? d.name : null,
            bestSkillVsBaselinePct: d ? d.bestSkillVsBaselinePct : null,
            thresholdPct: d ? d.thresholdPct : null
          };
        } else if (
          lastReason === "all_candidates_filtered" ||
          lastReason === "empty_cache" ||
          lastReason === "no_attack_skills_for_ranker"
        ) {
          qualityOk = false;
          qualityDetail = {
            lastReason: lastReason,
            note: "ranked opener not usable in current runtime state"
          };
        } else {
          qualityDetail = {
            lastReason: lastReason,
            note: "no strict schema required for this reason"
          };
        }
        addCheck("planner_ranked_reason_quality", qualityOk, qualityDetail, false);
      }
      // AI CHANGED: Tuning-hint check — soft diagnostics only; skipped when ranked is off or not enough runtime telemetry.
      if (!rankedOn) {
        addCheck(
          "planner_ranked_tuning_hint",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else {
        const hint = diag && diag.tuningHint ? diag.tuningHint : null;
        const hintSkipped = !!(hint && hint.skipped);
        const hintOk = !!(hint && hint.ok);
        const hintHasRuntimeAggressionSnapshot = !!(
          hint &&
          typeof hint.runtimeAggressionApplied === "boolean" &&
          typeof hint.runtimeAggressionReason === "string"
        );
        addCheck(
          "planner_ranked_tuning_hint",
          hintSkipped || (hintOk && hintHasRuntimeAggressionSnapshot),
          hint || { skipped: true, reason: "no_hint" },
          false
        );
      }

      if (fireChargeCancelIfHint) {
        // AI CHANGED: On-demand only (debugging a charge-cancel patch): run the old smoke probe/click when explicitly requested.
        try {
          const hintVis = isChargingSkillCancelHintVisible();
          if (hintVis) {
            const clickedOk = clickChargingSkillCancelUi();
            Logger.log("TEST", "charge-cancel click (on-demand)", { ok: clickedOk });
            chargeCancelTest = { attempted: true, ok: clickedOk };
          } else {
            Logger.log("TEST", "charge-cancel on-demand skipped (hint not visible)");
            chargeCancelTest = { attempted: false, ok: null, reason: "no_hint" };
          }
          addCheck("charge_cancel_smoke", true, chargeCancelTest, false);
        } catch (err) {
          Logger.warn("TEST", "charge-cancel on-demand threw", err);
          addCheck("charge_cancel_smoke", false, { error: String(err && err.message ? err.message : err) }, false);
        }
      }

      const skillsMeta = {
        slotCount: Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots.length : 0,
        scannedAt: Runtime.skills ? Runtime.skills.scannedAt : null,
        lastError: Runtime.skills ? Runtime.skills.lastError : null,
        scanRan: scanRan
      };
      Logger.log("TEST", "skills meta", skillsMeta);
      const afStatus = getAutoFarmStatus();
      const afSession = afStatus && afStatus.lastSessionSummary ? afStatus.lastSessionSummary : null;
      const reliability = afStatus && afStatus.reliability ? afStatus.reliability : null;
      const sustain = Runtime.autoFarm && Runtime.autoFarm.combatSustain ? Runtime.autoFarm.combatSustain : null;
      const skillRows = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
      const hpPotionRow = skillRows.find(function (row) { return row && row.kind === "potion" && row.resource === "hp"; }) || null;
      const mpPotionRow = skillRows.find(function (row) { return row && row.kind === "potion" && row.resource === "mp"; }) || null;
      // AI CHANGED: Sustain TEST detail now surfaces parsed potion strength/duration plus runtime sustain state, so potion policy can be debugged from one TEST run.
      const hpPotionEffect = hpPotionRow && Array.isArray(hpPotionRow.effects)
        ? (
            hpPotionRow.effects.find(function (effect) {
              return effect && effect.type === "heal" && effect.resource === "hp";
            }) || null
          )
        : null;
      const mpPotionEffect = mpPotionRow && Array.isArray(mpPotionRow.effects)
        ? (
            mpPotionRow.effects.find(function (effect) {
              return effect && effect.type === "heal" && effect.resource === "mp";
            }) || null
          )
        : null;
      if (!hpPotionRow && !mpPotionRow) {
        addCheck("combat_sustain_policy", false, {
          error: "no_combat_potions_on_bar",
          combatPotionsEnabled: Config.combat.useCombatPotions !== false
        }, false);
      } else {
        addCheck("combat_sustain_policy", true, {
          combatPotionsEnabled: Config.combat.useCombatPotions !== false,
          combatPotionCooldownMs: Number.isFinite(Config.combat.combatPotionCooldownMs) ? Config.combat.combatPotionCooldownMs : null,
          combatPotionSharedCooldown: Config.combat.combatPotionSharedCooldown !== false,
          outOfCombatHealBeforeExplore: Config.combat.outOfCombatHealBeforeExplore !== false,
          outOfCombatHealWaitHpPct: Number.isFinite(Config.combat.outOfCombatHealWaitHpPct) ? Config.combat.outOfCombatHealWaitHpPct : null,
          outOfCombatHealPollMs: Number.isFinite(Config.combat.outOfCombatHealPollMs) ? Config.combat.outOfCombatHealPollMs : null,
          postRetargetNoChargeGuard: Config.combat.disallowChargeSkillFirstBurstAfterRetarget !== false,
          combatQueueEnabled: Config.combat.combatQueueEnabled !== false,
          combatQueuePostProgressSettleMs: Number.isFinite(Config.combat.combatQueuePostProgressSettleMs) ? Config.combat.combatQueuePostProgressSettleMs : null,
          hpPotionUseBelowPct: Number.isFinite(Config.combat.hpPotionUseBelowPct) ? Config.combat.hpPotionUseBelowPct : null,
          hpPotionEmergencyBelowPct: Number.isFinite(Config.combat.hpPotionEmergencyBelowPct) ? Config.combat.hpPotionEmergencyBelowPct : null,
          hpPotionSafeMissingHealFraction: Number.isFinite(Config.combat.hpPotionSafeMissingHealFraction) ? Config.combat.hpPotionSafeMissingHealFraction : null,
          hpPotionCombatMissingHealFraction: Number.isFinite(Config.combat.hpPotionCombatMissingHealFraction) ? Config.combat.hpPotionCombatMissingHealFraction : null,
          hpPotionForecastWindowSec: Number.isFinite(Config.combat.hpPotionForecastWindowSec) ? Config.combat.hpPotionForecastWindowSec : null,
          mpPotionUseBelowPct: Number.isFinite(Config.combat.mpPotionUseBelowPct) ? Config.combat.mpPotionUseBelowPct : null,
          hpPotionSlot: hpPotionRow ? {
            slot: hpPotionRow.slot,
            counter: hpPotionRow.counter ? hpPotionRow.counter.value : null,
            totalValue: hpPotionEffect && Number.isFinite(hpPotionEffect.value) ? hpPotionEffect.value : null,
            durationSec: hpPotionEffect && Number.isFinite(hpPotionEffect.durationSec) ? hpPotionEffect.durationSec : null
          } : null,
          mpPotionSlot: mpPotionRow ? {
            slot: mpPotionRow.slot,
            counter: mpPotionRow.counter ? mpPotionRow.counter.value : null,
            totalValue: mpPotionEffect && Number.isFinite(mpPotionEffect.value) ? mpPotionEffect.value : null,
            durationSec: mpPotionEffect && Number.isFinite(mpPotionEffect.durationSec) ? mpPotionEffect.durationSec : null
          } : null,
          runtime: sustain || null
        }, false);
      }
      addCheck(
        "auto_farm_reliability",
        !!(
          reliability &&
          Number.isFinite(reliability.noProgressStreak) &&
          Number.isFinite(reliability.totalNoProgressFailures)
        ),
        reliability || { skipped: true, reason: "no_reliability_data" },
        false
      );
      if (!afSession) {
        addCheck("auto_farm_session_summary", true, { skipped: true, reason: "no_completed_session_yet" }, false);
      } else {
        addCheck("auto_farm_session_summary", true, afSession, false);
      }

      // AI CHANGED: Master skill DB smoke — auto-detect class from profile icon via applySkillMasterToSlots();
      // fail the check when there are scanned skills but zero master matches.
      try {
        if (typeof getSkillMasterEntry === "function" && typeof applySkillMasterToSlots === "function") {
          const classHint =
            diag &&
            diag.classProfile &&
            diag.classProfile.classKey
              ? String(diag.classProfile.classKey).trim()
              : "";
          if (classHint) {
            Config.skills.masterClassKey = classHint;
          }
          const applied = classHint ? applySkillMasterToSlots(classHint) : applySkillMasterToSlots();
          const appliedClassKey = applied && applied.classKey ? applied.classKey : null;
          let sample = null;
          if (appliedClassKey) {
            const firstSkill = Runtime.skills && Array.isArray(Runtime.skills.slots)
              ? Runtime.skills.slots.find((s) => s && s.kind === "skill" && s.name)
              : null;
            if (firstSkill) {
              sample = getSkillMasterEntry(appliedClassKey, firstSkill.name || "");
            }
          }
          const hasSkills = !!(applied && Number.isFinite(applied.totalSkills) && applied.totalSkills > 0);
          const hasMatch = !!(applied && Number.isFinite(applied.matched) && applied.matched > 0);
          const ok = !!(applied && applied.ok && (!hasSkills || hasMatch));
          addCheck("skill_master_db", ok, {
            classKey: appliedClassKey,
            applied: applied,
            sample: sample ? sample.name : null,
            unmatchedNames: applied && Array.isArray(applied.unmatchedNames) ? applied.unmatchedNames : [],
            unmatchedCount: applied && Number.isFinite(applied.unmatchedCount) ? applied.unmatchedCount : 0
          }, false);
        } else {
          addCheck("skill_master_db", true, { skipped: true, reason: "no_master_module" }, false);
        }
      } catch (err) {
        addCheck("skill_master_db", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      let calibration = null;
      let calibrationError = null;
      if (!runCalibration) {
        Logger.log("TEST", "done (calibration skipped via opts)", {
          chargeCancelTest: chargeCancelTest,
          fireChargeCancelIfHint: fireChargeCancelIfHint
        });
        addCheck("calibration_observe", true, { skipped: true }, false);
      } else {
        try {
          let calibrationRetried = false;
          let calibrationRetryPasses = 0;
          let calibrationRetryError = null;
          calibration = await quickCalibrationSession(
            isReleaseProfile
              ? { observe: { totalMs: 15000 } }
              : {}
          );
          // AI CHANGED: Release strict calibration — tier-1 retry: find + one basic, then longer observe.
          if (
            isReleaseProfile &&
            strictCalibration &&
            calibration &&
            calibration.enemyDbMerge &&
            calibration.enemyDbMerge.error === "skipped_no_hp_drops"
          ) {
            calibrationRetried = true;
            calibrationRetryPasses = 1;
            try {
              await clickFindEnemyVerified();
              await sleep(450, { bypassStop: true });
              clickBasicAttack();
              await sleep(1400, { bypassStop: true });
              calibration = await quickCalibrationSession({ observe: { totalMs: 18000 } });
            } catch (retryErr) {
              calibrationRetryError = String(retryErr && retryErr.message ? retryErr.message : retryErr);
              Logger.warn("TEST", "release calibration retry failed", retryErr);
            }
          }
          // AI CHANGED: Tier-2 retry — still no hp drops after soak/off-combat gap: stronger combat seed + longest observe.
          if (
            isReleaseProfile &&
            strictCalibration &&
            calibration &&
            calibration.enemyDbMerge &&
            calibration.enemyDbMerge.error === "skipped_no_hp_drops"
          ) {
            calibrationRetryPasses = 2;
            try {
              await clickFindEnemyVerified();
              await sleep(600, { bypassStop: true });
              for (let bi = 0; bi < 3; bi += 1) {
                clickBasicAttack();
                await sleep(520, { bypassStop: true });
              }
              await sleep(900, { bypassStop: true });
              calibration = await quickCalibrationSession({ observe: { totalMs: 28000 } });
            } catch (retry2Err) {
              calibrationRetryError = String(retry2Err && retry2Err.message ? retry2Err.message : retry2Err);
              Logger.warn("TEST", "release calibration retry-2 failed", retry2Err);
            }
          }
          Logger.log("TEST", "quickCalibrationSession", calibration);
          const mergeErr =
            calibration && calibration.enemyDbMerge && calibration.enemyDbMerge.error
              ? String(calibration.enemyDbMerge.error)
              : "";
          const hasKey = !!(calibration && calibration.lastFoughtKey);
          const mergeOk = !!(calibration && calibration.enemyDbMerge && calibration.enemyDbMerge.ok);
          if (!hasKey || !mergeOk) {
            // AI CHANGED: If TEST is pressed out of combat / no target, observe can be OK but attribution key is missing.
            // Treat as skipped unless strictCalibration is requested.
            const detail = {
              skipped: !strictCalibration,
              reason: !hasKey
                ? "no_enemy_key"
                : mergeErr || "merge_failed",
              lastFoughtKey: calibration ? calibration.lastFoughtKey : null,
              enemyDbMerge: calibration ? calibration.enemyDbMerge : null,
              retried: calibrationRetried,
              retryPasses: calibrationRetryPasses,
              retryError: calibrationRetryError
            };
            addCheck("calibration_observe", !strictCalibration, detail, strictCalibration);
          } else {
            addCheck("calibration_observe", true, Object.assign({}, calibration || {}, {
              retried: calibrationRetried,
              retryPasses: calibrationRetryPasses,
              retryError: calibrationRetryError
            }), strictCalibration);
          }
        } catch (err) {
          calibrationError = String(err && err.message ? err.message : err);
          Logger.warn("TEST", "quickCalibrationSession failed", err);
          addCheck("calibration_observe", false, { error: calibrationError }, strictCalibration);
        }
        Logger.log("TEST", "bundle done");
      }

      // AI CHANGED: Long-soak mid-session visibility — explicit check for auto-farm resume policy and current status.
      addCheck(
        "auto_farm_resume_policy",
        !hadFarmOn || resumeAfter,
        {
          hadFarmOnBeforeTest: hadFarmOn,
          resumeRequested: resumeAfter,
          runningNow: !!Runtime.autoFarm.running,
          note: hadFarmOn
            ? (resumeAfter ? "farm_will_resume_after_bundle" : "farm_left_off_by_policy")
            : "farm_was_off_before_test"
        },
        false
      );

      const criticalFail = checks.some(function (c) { return c.critical && !c.ok; });
      const softFail = checks.some(function (c) { return !c.critical && !c.ok; });
      const humanReport = buildTestBundleHumanReport(checks, BotVersion.version);
      // AI CHANGED: Highlight the exact line the user should copy-paste back (visual emphasis in console).
      try {
        /* eslint-disable no-console */
        if (typeof console.log === "function") {
          console.log(
            "%c" + humanReport.fullText,
            "background:#1f2a44;color:#e6f0ff;font-weight:700;padding:3px 6px;border-radius:4px;border:1px solid rgba(125,255,179,0.35)"
          );
        }
        /* eslint-enable no-console */
      } catch (e) {
        // ignore — cosmetic only
      }
      Logger.log("TEST", humanReport.fullText);
      Logger.log("TEST", "SUMMARY", {
        ok: !criticalFail,
        criticalFail: criticalFail,
        softFail: softFail,
        checks: checks,
        testReportLine: humanReport.fullText
      });
      // AI CHANGED: Always emit per-check detail map for deterministic debugging (no hidden state).
      Logger.log("TEST", "DETAILS", buildTestDebugReport(checks));
      /* eslint-disable no-console */
      if (typeof console.table === "function") {
        console.table(
          checks.map(function (c) {
            return {
              id: c.id,
              ok: c.ok,
              critical: c.critical,
              skipped: !!(c.detail && c.detail.skipped),
              reason: c.detail && (c.detail.reason || c.detail.error) ? (c.detail.reason || c.detail.error) : "",
              note: c.note || ""
            };
          })
        );
      }
      /* eslint-enable no-console */

      bundleResult = {
        ok: !criticalFail,
        criticalOk: !criticalFail,
        softFail: softFail,
        checks: checks,
        testReportLine: humanReport.fullText,
        testReportOverall: humanReport.overall,
        runQuickCalibration: runCalibration,
        calibration: calibration,
        calibrationError: calibrationError,
        skillsMeta: skillsMeta,
        chargeCancelTest: chargeCancelTest
      };
    } finally {
      if (plannerBackup) {
        Config.planner.useRankedAttackSkillsInCombat = !!plannerBackup.useRankedAttackSkillsInCombat;
        Config.planner.skillMpReserve = plannerBackup.skillMpReserve;
        Runtime.planner.forcedOpenerSkillName = plannerBackup.forcedOpenerSkillName || null;
        Runtime.planner.forcedOpenerReason = plannerBackup.forcedOpenerReason || null;
        Config.combat.chargeSkillDynamicReleaseEnabled = plannerBackup.chargeSkillDynamicReleaseEnabled !== false;
        Config.combat.chargeSkillReleaseFraction = plannerBackup.chargeSkillReleaseFraction;
        Config.combat.rankedOpenerEarlyCancelIfHintAfterMs = plannerBackup.rankedOpenerEarlyCancelIfHintAfterMs;
      }
      if (resumeAfter && hadFarmOn && !Runtime.autoFarm.running) {
        Logger.log("TEST", "restarting auto-farm after TEST");
        startAutoFarmLoop();
      } else if (hadFarmOn && !resumeAfter) {
        Logger.log("TEST", "auto-farm left OFF after TEST (resumeAutoFarm=false)");
      }
    }

    return bundleResult;
  }

  // AI CHANGED: Streamlined control panel — version header, ON/OFF only, large phase indicator, compact stats footer.
  // All previously-clickable debug buttons (Run 1 Cycle, Map prep, Scan Ring, Toggle Logs, Refresh) are still
  // available via window.ligmarBot.* in the devtools console.
  function createControlPanel() {
    if (Runtime.ui.panel) {
      return Runtime.ui.panel;
    }

    loadPlannerUiPrefs();

    const panel = document.createElement("div");
    panel.id = "ligmar-bot-panel";
    panel.style.position = "fixed";
    panel.style.top = "12px";
    panel.style.right = "12px";
    panel.style.width = "280px";
    panel.style.background = "rgba(14, 18, 30, 0.92)";
    panel.style.border = "1px solid rgba(115, 138, 255, 0.5)";
    panel.style.borderRadius = "10px";
    panel.style.padding = "12px";
    panel.style.zIndex = "999999";
    panel.style.fontFamily = "Consolas, Menlo, monospace";
    panel.style.fontSize = "12px";
    panel.style.color = "#dce3ff";
    panel.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
    panel.style.userSelect = "none";

    // ---- Header: version + change description ---------------------------
    const titleWrap = document.createElement("div");
    titleWrap.style.marginBottom = "10px";
    titleWrap.style.paddingBottom = "8px";
    titleWrap.style.borderBottom = "1px solid rgba(115, 138, 255, 0.25)";

    const title = document.createElement("div");
    title.textContent = `Ligmar Bot v${BotVersion.version}`;
    title.style.fontWeight = "700";
    title.style.fontSize = "13px";
    title.style.letterSpacing = "0.3px";
    titleWrap.appendChild(title);

    if (BotVersion.description) {
      const subtitle = document.createElement("div");
      subtitle.textContent = `“${BotVersion.description}”`;
      subtitle.style.fontSize = "10.5px";
      subtitle.style.opacity = "0.65";
      subtitle.style.fontStyle = "italic";
      subtitle.style.marginTop = "2px";
      subtitle.style.wordBreak = "break-word";
      titleWrap.appendChild(subtitle);
    }
    panel.appendChild(titleWrap);

    // ---- Buttons: ON / OFF ----------------------------------------------
    const buttonsWrap = document.createElement("div");
    buttonsWrap.style.display = "flex";
    buttonsWrap.style.gap = "8px";
    buttonsWrap.style.marginBottom = "10px";

    function makeButton(label, baseColor, hoverColor, onClick) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.flex = "1";
      button.style.padding = "8px 10px";
      button.style.borderRadius = "6px";
      button.style.border = `1px solid ${baseColor}`;
      button.style.background = baseColor;
      button.style.color = "#0e121e";
      button.style.fontWeight = "700";
      button.style.fontSize = "12px";
      button.style.cursor = "pointer";
      button.style.transition = "background 120ms ease, opacity 120ms ease";
      button.addEventListener("mouseenter", () => {
        if (!button.disabled) {
          button.style.background = hoverColor;
        }
      });
      button.addEventListener("mouseleave", () => {
        button.style.background = baseColor;
      });
      button.addEventListener("click", onClick);
      return button;
    }

    const startButton = makeButton("ON", "#4bd97a", "#5fe48a", () => {
      if (startButton.disabled) {
        return;
      }
      startAutoFarmLoop();
      setTimeout(updateControlPanelStatus, 50);
    });
    const stopButton = makeButton("OFF", "#d96f4b", "#e58463", () => {
      if (stopButton.disabled) {
        return;
      }
      stopAutoFarmLoop();
      setTimeout(updateControlPanelStatus, 50);
    });
    buttonsWrap.appendChild(startButton);
    buttonsWrap.appendChild(stopButton);
    panel.appendChild(buttonsWrap);

    // AI CHANGED: TEST (version) — one-click full bundle (stops auto-farm if needed; probes; cancel smoke if hint; quick calibration).
    const testButton = makeButton(`TEST (${BotVersion.version})`, "#737fff", "#8f94ff", () => {
      if (testButton.disabled) {
        return;
      }
      testButton.disabled = true;
      testButton.style.opacity = "0.45";
      testButton.style.cursor = "wait";
      Promise.resolve(runUiTestBundle())
        .then(function (res) {
          Logger.log("TEST", "finished", res);
          // AI CHANGED: panel mirrors copy-paste `Test result:` line from console (per-step + OVERALL).
          if (testResultLine) {
            testResultLine.textContent =
              (res && res.testReportLine) ? res.testReportLine : (res && res.ok ? "Test result: OK (no report line)" : "Test result: failed");
            testResultLine.style.color = res && res.ok ? "#7dffb3" : "#ff6b6b";
            testResultLine.style.fontSize = "9px";
          }
        })
        .catch(function (err) {
          const errLine = "Test result: bundle error — " + String(err && err.message ? err.message : err);
          Logger.log("TEST", errLine);
          Logger.warn("TEST", "bundle rejected", err);
          if (testResultLine) {
            testResultLine.textContent = errLine;
            testResultLine.style.color = "#ff6b6b";
            testResultLine.style.fontSize = "9px";
          }
        })
        .finally(function () {
          testButton.disabled = false;
          testButton.style.opacity = "1";
          testButton.style.cursor = "pointer";
          updateControlPanelStatus();
        });
    });
    testButton.style.flex = "none";
    testButton.style.width = "100%";
    testButton.style.marginBottom = "4px";
    panel.appendChild(testButton);

    // AI CHANGED: Release-profile TEST — long soak + strict calibration without console (`testProfile: "release"`).
    const testReleaseButton = makeButton(`TEST release (${BotVersion.version})`, "#5a6bbf", "#6f7ad4", () => {
      if (testReleaseButton.disabled) {
        return;
      }
      testReleaseButton.disabled = true;
      testReleaseButton.style.opacity = "0.45";
      testReleaseButton.style.cursor = "wait";
      Promise.resolve(runUiTestBundle({ testProfile: "release" }))
        .then(function (res) {
          Logger.log("TEST", "finished (release profile)", res);
          if (testResultLine) {
            testResultLine.textContent =
              (res && res.testReportLine) ? res.testReportLine : (res && res.ok ? "Test result: OK (no report line)" : "Test result: failed");
            testResultLine.style.color = res && res.ok ? "#7dffb3" : "#ff6b6b";
            testResultLine.style.fontSize = "9px";
          }
        })
        .catch(function (err) {
          const errLine = "Test result: bundle error — " + String(err && err.message ? err.message : err);
          Logger.log("TEST", errLine);
          Logger.warn("TEST", "bundle rejected (release profile)", err);
          if (testResultLine) {
            testResultLine.textContent = errLine;
            testResultLine.style.color = "#ff6b6b";
            testResultLine.style.fontSize = "9px";
          }
        })
        .finally(function () {
          testReleaseButton.disabled = false;
          testReleaseButton.style.opacity = "1";
          testReleaseButton.style.cursor = "pointer";
          updateControlPanelStatus();
        });
    });
    testReleaseButton.style.flex = "none";
    testReleaseButton.style.width = "100%";
    testReleaseButton.style.marginBottom = "4px";
    testReleaseButton.style.fontSize = "11px";
    panel.appendChild(testReleaseButton);

    // AI CHANGED: last TEST pass/fail line — filled when runUiTestBundle resolves (no manual console steps).
    const testResultLine = document.createElement("div");
    testResultLine.textContent = "Test result: — (see console [TEST] after run)";
    testResultLine.style.fontSize = "10px";
    testResultLine.style.lineHeight = "1.35";
    testResultLine.style.marginBottom = "8px";
    testResultLine.style.opacity = "0.85";
    testResultLine.style.wordBreak = "break-word";
    panel.appendChild(testResultLine);

    // ---- Phase block (the "what is the bot doing right now" area) ------
    const phaseWrap = document.createElement("div");
    phaseWrap.style.padding = "10px";
    phaseWrap.style.background = "rgba(0,0,0,0.28)";
    phaseWrap.style.borderRadius = "6px";
    phaseWrap.style.marginBottom = "8px";

    const phaseRow = document.createElement("div");
    phaseRow.style.display = "flex";
    phaseRow.style.alignItems = "baseline";
    phaseRow.style.justifyContent = "space-between";
    phaseRow.style.gap = "8px";

    const phaseNode = document.createElement("div");
    phaseNode.textContent = "IDLE";
    phaseNode.style.fontWeight = "700";
    phaseNode.style.fontSize = "14px";
    phaseNode.style.letterSpacing = "0.6px";
    phaseNode.style.color = phaseColor("idle");
    phaseRow.appendChild(phaseNode);

    const phaseSinceNode = document.createElement("div");
    phaseSinceNode.textContent = "0s ago";
    phaseSinceNode.style.fontSize = "10.5px";
    phaseSinceNode.style.opacity = "0.6";
    phaseRow.appendChild(phaseSinceNode);

    phaseWrap.appendChild(phaseRow);

    const phaseDetailNode = document.createElement("div");
    phaseDetailNode.textContent = "—";
    phaseDetailNode.style.fontSize = "11px";
    phaseDetailNode.style.opacity = "0.85";
    phaseDetailNode.style.marginTop = "4px";
    phaseDetailNode.style.wordBreak = "break-word";
    phaseWrap.appendChild(phaseDetailNode);

    panel.appendChild(phaseWrap);

    // ---- Compact stats footer -------------------------------------------
    const status = document.createElement("pre");
    status.style.margin = "0";
    status.style.padding = "8px 10px";
    status.style.background = "rgba(0,0,0,0.18)";
    status.style.borderRadius = "6px";
    status.style.whiteSpace = "pre-wrap";
    status.style.wordBreak = "break-word";
    status.style.fontSize = "11px";
    status.style.lineHeight = "1.5";
    status.textContent = "Initializing…";
    panel.appendChild(status);

    document.body.appendChild(panel);

    Runtime.ui.panel = panel;
    Runtime.ui.statusNode = status;
    Runtime.ui.startButton = startButton;
    Runtime.ui.stopButton = stopButton;
    Runtime.ui.phaseNode = phaseNode;
    Runtime.ui.phaseDetailNode = phaseDetailNode;
    Runtime.ui.phaseSinceNode = phaseSinceNode;
    Runtime.ui.testButton = testButton;
    Runtime.ui.testResultLine = testResultLine;
    Runtime.ui.combatGraceInput = null;
    Runtime.ui.combatEarlyCancelInput = null;

    updateControlPanelStatus();
    // AI CHANGED: Faster refresh (500ms) so ON timer + HP/MP/Ping/phase stay live during auto-farm.
    ensureControlPanelRefreshTicker();
    return panel;
  }
