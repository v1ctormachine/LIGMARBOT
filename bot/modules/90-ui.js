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
      useRankedSkillOnlyFirstBurstAfterFind: !!Config.planner.useRankedSkillOnlyFirstBurstAfterFind,
      // AI CHANGED: Queue+horizon lookahead depth (0–4); survives refresh via ligmarbot.plannerUi.v1.
      openerFollowUpSkillDepth:
        Number.isFinite(Config.planner.openerFollowUpSkillDepth) && Config.planner.openerFollowUpSkillDepth >= 0
          ? Math.max(0, Math.min(4, Math.floor(Config.planner.openerFollowUpSkillDepth)))
          : 2
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
      if (Number.isFinite(p.openerFollowUpSkillDepth) && p.openerFollowUpSkillDepth >= 0 && p.openerFollowUpSkillDepth <= 4) {
        Config.planner.openerFollowUpSkillDepth = Math.max(0, Math.min(4, Math.floor(p.openerFollowUpSkillDepth)));
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

  // AI CHANGED: AUTO panel — persist combat mode (Fast/Safe/Easy) in ligmarbot.autoFarmUi.v1; applied when AUTO loop runs.
  function autoFarmUiPrefsSnapshot() {
    const raw =
      Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode).toLowerCase() : "fast";
    const cm = raw === "easy" || raw === "safe" || raw === "fast" ? raw : "fast";
    // AI CHANGED: Persist AUTO local chat spammer toggle with combat mode (`ligmarbot.autoFarmUi.v1`).
    const spamOn = !!(Config.chat && Config.chat.autoLocalPromocodeSpammerEnabled !== false);
    return { combatMode: cm, autoLocalChatSpammerEnabled: spamOn };
  }

  function loadAutoFarmUiPrefs() {
    try {
      const raw = window.localStorage.getItem("ligmarbot.autoFarmUi.v1");
      if (!raw) {
        return { ok: true, fromStorage: false, autoFarm: autoFarmUiPrefsSnapshot() };
      }
      const p = JSON.parse(raw);
      if (typeof p.combatMode === "string") {
        const m = p.combatMode.toLowerCase();
        if (m === "fast" || m === "safe" || m === "easy") {
          Runtime.autoFarm.combatMode = m;
        }
      }
      // AI CHANGED: Restore chat spammer preference from the same AUTO prefs blob.
      if (typeof p.autoLocalChatSpammerEnabled === "boolean" && Config.chat) {
        Config.chat.autoLocalPromocodeSpammerEnabled = p.autoLocalChatSpammerEnabled;
      }
      return { ok: true, fromStorage: true, autoFarm: autoFarmUiPrefsSnapshot() };
    } catch (err) {
      return {
        ok: false,
        fromStorage: false,
        error: String(err && err.message ? err.message : err),
        autoFarm: autoFarmUiPrefsSnapshot()
      };
    }
  }

  function saveAutoFarmUiPrefs() {
    const payload = autoFarmUiPrefsSnapshot();
    try {
      window.localStorage.setItem("ligmarbot.autoFarmUi.v1", JSON.stringify(payload));
      return { ok: true, storageKey: "ligmarbot.autoFarmUi.v1", autoFarm: payload };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err), autoFarm: payload };
    }
  }

  // AI CHANGED: Highlight selected AUTO combat mode buttons on panel.
  function refreshAutoFarmModeButtonsVisual() {
    const map = Runtime.ui && Runtime.ui.autoFarmModeButtons ? Runtime.ui.autoFarmModeButtons : null;
    if (!map) {
      return;
    }
    const raw =
      Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode).toLowerCase() : "fast";
    const norm = raw === "easy" || raw === "safe" || raw === "fast" ? raw : "fast";
    ["fast", "safe", "easy"].forEach(function (key) {
      const btn = map[key];
      if (!btn) {
        return;
      }
      const on = key === norm;
      btn.style.background = on ? "#7a8cff" : "#2a3351";
      btn.style.borderColor = on ? "#aab6ff" : "#4a5672";
      btn.style.color = on ? "#0e121e" : "#dce3ff";
    });
  }

  // AI CHANGED: slice 26 — persist ranked opener timing (slice 25) from panel; returns result object (slice 36).
  function combatPrefsSnapshot() {
    return {
      rankedOpenerChargeGraceMs: Number(Config.combat.rankedOpenerChargeGraceMs) || 0,
      chargeSkillReleaseOverrideMs: Number(Config.combat.chargeSkillReleaseOverrideMs) || 0,
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
      if (Number.isFinite(p.chargeSkillReleaseOverrideMs) && p.chargeSkillReleaseOverrideMs >= 0) {
        Config.combat.chargeSkillReleaseOverrideMs = p.chargeSkillReleaseOverrideMs;
      } else if (Number.isFinite(p.rankedOpenerEarlyCancelIfHintAfterMs) && p.rankedOpenerEarlyCancelIfHintAfterMs >= 0) {
        // AI CHANGED: migrate ligmarbot.combatUi.v1 — old key was planner ms override + removed early-cancel wait; map to chargeSkillReleaseOverrideMs only.
        Config.combat.chargeSkillReleaseOverrideMs = p.rankedOpenerEarlyCancelIfHintAfterMs;
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
    const autoFarm = saveAutoFarmUiPrefs();
    return {
      ok: !!(planner.ok && combat.ok && autoFarm.ok),
      planner: planner,
      combat: combat,
      autoFarm: autoFarm
    };
  }

  function loadAllUiPrefs() {
    const planner = loadPlannerUiPrefs();
    const combat = loadCombatUiPrefs();
    const autoFarm = loadAutoFarmUiPrefs();
    refreshAutoFarmModeButtonsVisual();
    updateControlPanelStatus();
    return {
      ok: !!(planner.ok && combat.ok && autoFarm.ok),
      planner: planner,
      combat: combat,
      autoFarm: autoFarm
    };
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

    // AI CHANGED: Keep chat spammer checkbox aligned with Config when not being edited.
    if (Runtime.ui.chatSpammerCheckbox && document.activeElement !== Runtime.ui.chatSpammerCheckbox) {
      const spamOn = !!(Config.chat && Config.chat.autoLocalPromocodeSpammerEnabled !== false);
      if (Runtime.ui.chatSpammerCheckbox.checked !== spamOn) {
        Runtime.ui.chatSpammerCheckbox.checked = spamOn;
      }
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
      `AUTO: ${auto.combatMode || "fast"} · Cycles: ${auto.cyclesCompleted} · Failures: ${auto.consecutiveFailures} · ON: ${onText}`
    ];
    Runtime.ui.statusNode.textContent = lines.join("\n");
    refreshAutoFarmModeButtonsVisual();
  }

  // AI CHANGED: Human labels for TEST reports, failures list, and self-test JSON export.
  function getTestBundleHumanLabels() {
    return {
      version: "Version",
      probe_selectors: "Selector probe",
      skill_scan: "Skill data",
      skill_master_db: "Skill master DB",
      hero_stats: "Hero stats",
      planner_opener_horizon_preview: "HorizonSim",
      // AI CHANGED: DoT branch in horizon paper scales with mobFactor (calibration EV).
      // AI CHANGED: Label reflects DoT + instant paper mob blend check (basic_proc/channel still full mobFactor).
      planner_horizon_dot_mob_calibration: "Horizon typed paper mob calibration",
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
      planner_combat_episode_plan: "Combat episode plan",
      // AI CHANGED: TEST human label for opener danger pressure shape check.
      planner_opener_danger_pressure_shape: "Opener danger pressure",
      // AI CHANGED: TEST label for channel hold risk shape (incoming sustain on charge holds).
      planner_horizon_channel_hold_risk_shape: "Channel hold risk",
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
      support_buffs_surface: "Support buffs surface",
      combat_sustain_policy: "Combat sustain",
      auto_farm_resume_policy: "Farm resume policy",
      auto_farm_reliability: "Combat reliability",
      auto_farm_session_summary: "Auto-farm session",
      field_validation_snapshot: "Field validation",
      // AI CHANGED: §6 — enemy DB merge exposes buff label signature for TEST export.
      enemy_buff_calibration_probe: "Enemy buff calibration",
      enemy_buff_sig_buckets_api: "Enemy buff bucket API",
      logger_recent_ring: "Logger ring",
      planner_ranked_openers: "Ranked opener",
      calibration_observe: "Calibration"
    };
  }

  // AI CHANGED: Single copy-paste line for patch verification (console + panel); one entry per addCheck step.
  function buildTestBundleHumanReport(checks, versionSemver) {
    const labelById = getTestBundleHumanLabels();
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
  function buildTestDebugReport(checks, opts) {
    const pruneDetails = !!(opts && opts.pruneDetails);
    const report = {};
    for (let i = 0; i < checks.length; i += 1) {
      const c = checks[i];
      report[c.id] = {
        ok: !!c.ok,
        critical: !!c.critical,
        skipped: !!(c.detail && c.detail.skipped),
        note: c.note || null,
        detail:
          c.detail !== undefined
            ? pruneDetails
              ? pruneValueForTestExport(cloneJsonSafeForTestExport(c.detail), 0)
              : c.detail
            : null
      };
    }
    return report;
  }

  // AI CHANGED: Serializable opts for self-test export (no functions / circular refs).
  function pickSerializableTestOpts(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const keys = [
      "testProfile",
      "runQuickCalibration",
      "resumeAutoFarm",
      "forceSkillScan",
      "runSkillScanIfNeeded",
      "runHeroStatsInTest",
      "strictCalibration",
      "strictRankedChecks",
      "autoRankedSoak",
      "rankedSoakMinMs",
      "rankedSoakMaxMs",
      "rankedSoakMinEvents",
      "forceRankedSkillName",
      "forceChargeReleaseFraction",
      "fireChargeCancelIfHint",
      "forcedOpenerReadyWaitMs",
      "naturalSniperReadyWaitMs",
      "naturalSniperProbeWaitMs"
    ];
    const out = {};
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (Object.prototype.hasOwnProperty.call(opts, k)) {
        const v = opts[k];
        const t = typeof v;
        if (v === null || t === "string" || t === "number" || t === "boolean") {
          out[k] = v;
        }
      }
    }
    return out;
  }

  // AI CHANGED: Planner diagnostics reuse one object for multiple keys — JSON clone breaks shared refs so prune does not emit false "[circular]".
  function cloneJsonSafeForTestExport(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  // AI CHANGED: Shrink TEST JSON exports — dense charge-search arrays (10k+ objects) are paste-hostile; keep counts + head/tail samples.
  function pruneValueForTestExport(value, depth, seen) {
    const MAX_DEPTH = 22;
    const MAX_INLINE_ARRAY = 12;
    const HEAD = 5;
    const TAIL = 2;
    const MAX_STRING = 2400;
    const d = typeof depth === "number" ? depth : 0;
    if (d > MAX_DEPTH) {
      return "[max depth]";
    }
    if (value === null || value === undefined) {
      return value;
    }
    const t = typeof value;
    if (t === "string") {
      if (value.length <= MAX_STRING) {
        return value;
      }
      return {
        __truncatedString: true,
        length: value.length,
        head: value.slice(0, 600),
        tail: value.length > 800 ? value.slice(-400) : ""
      };
    }
    if (t === "number" || t === "boolean") {
      return value;
    }
    if (t === "function") {
      return "[function]";
    }
    if (typeof value === "object") {
      const ws = seen || new WeakSet();
      if (ws.has(value)) {
        return "[circular]";
      }
      if (Array.isArray(value)) {
        ws.add(value);
        if (value.length <= MAX_INLINE_ARRAY) {
          const arr = [];
          for (let i = 0; i < value.length; i += 1) {
            arr.push(pruneValueForTestExport(value[i], d + 1, ws));
          }
          return arr;
        }
        const headItems = [];
        const nHead = Math.min(HEAD, value.length);
        for (let i = 0; i < nHead; i += 1) {
          headItems.push(pruneValueForTestExport(value[i], d + 1, ws));
        }
        let tailItems = [];
        if (value.length > nHead + TAIL) {
          for (let j = value.length - TAIL; j < value.length; j += 1) {
            tailItems.push(pruneValueForTestExport(value[j], d + 1, ws));
          }
        } else if (value.length > nHead) {
          for (let k = nHead; k < value.length; k += 1) {
            tailItems.push(pruneValueForTestExport(value[k], d + 1, ws));
          }
        }
        return {
          __truncatedArray: true,
          length: value.length,
          head: headItems,
          tail: tailItems.length ? tailItems : undefined
        };
      }
      ws.add(value);
      const out = {};
      let keys;
      try {
        keys = Object.keys(value);
      } catch (eK) {
        return "[object keys error]";
      }
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        try {
          out[k] = pruneValueForTestExport(value[k], d + 1, ws);
        } catch (e2) {
          out[k] = "[error]";
        }
      }
      return out;
    }
    try {
      return String(value);
    } catch (e3) {
      return "[unserializable]";
    }
  }

  // AI CHANGED: ROADMAP #2 — compact runtime slice for soak triage (TEST export `gameSnapshotEnd.fieldValidation`, console `ligmarBot.getFieldValidationSnapshot()`).
  function buildFieldValidationSnapshotForTestExport() {
    const af = Runtime && Runtime.autoFarm ? Runtime.autoFarm : null;
    const out = {
      farmRunning: !!(af && af.running),
      cycleDelayMs:
        Config && Config.farmLoop && Number.isFinite(Config.farmLoop.cycleDelayMs)
          ? Config.farmLoop.cycleDelayMs
          : null,
      maxConsecutiveFailures:
        Config && Config.farmLoop && Number.isFinite(Config.farmLoop.maxConsecutiveFailures)
          ? Config.farmLoop.maxConsecutiveFailures
          : null
    };
    if (af) {
      out.reliability = af.reliability || null;
      out.health = af.health || null;
      out.recovery = af.recovery || null;
      out.combatSustain = af.combatSustain || null;
      if (af.combatQueue) {
        out.combatQueue = {
          active: af.combatQueue.active,
          mode: af.combatQueue.mode,
          slot: af.combatQueue.slot,
          name: af.combatQueue.name,
          postRetargetGuarded: af.combatQueue.postRetargetGuarded,
          advanceCount: af.combatQueue.advanceCount,
          clearReason: af.combatQueue.clearReason,
          lastMatchedCastText: af.combatQueue.lastMatchedCastText
        };
      }
      if (af.chatSpammer) {
        out.chatSpammer = {
          sends: af.chatSpammer.sends,
          failures: af.chatSpammer.failures,
          lastResult: af.chatSpammer.lastResult,
          nextSendAt: af.chatSpammer.nextSendAt,
          lastSendAt: af.chatSpammer.lastSendAt
        };
      }
      out.lastSessionSummary = af.lastSessionSummary || null;
    }
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    if (pr && pr.openerRuntime && pr.openerRuntime.events) {
      out.plannerOpenerEventTotals = Object.assign({}, pr.openerRuntime.events);
    }
    out.lastFoughtEnemyKey = Runtime && Runtime.enemy ? Runtime.enemy.lastFoughtKey || null : null;
    // AI CHANGED: compact opener danger pressure sample for soak triage (same helper as ranked context scoring).
    try {
      if (typeof plannerComputeOpenerDangerPressure === "function" && typeof readBasicState === "function") {
        const liveStFv = readBasicState();
        if (typeof updateCombatSustainObservations === "function") {
          updateCombatSustainObservations(liveStFv);
        }
        const fvKey =
          Runtime && Runtime.enemy && typeof Runtime.enemy.lastFoughtKey === "string" && Runtime.enemy.lastFoughtKey.trim()
            ? Runtime.enemy.lastFoughtKey.trim()
            : null;
        out.openerDangerPressureSample = plannerComputeOpenerDangerPressure(liveStFv, fvKey ? { enemyKey: fvKey } : null);
      }
    } catch (eDpFv) {
      out.openerDangerPressureSampleError = String(eDpFv && eDpFv.message ? eDpFv.message : eDpFv);
    }
    // AI CHANGED: §6 — last-fought row buff signature + bucket counts for soak export / getFieldValidationSnapshot().
    try {
      const fkBuff =
        Runtime && Runtime.enemy && typeof Runtime.enemy.lastFoughtKey === "string" && Runtime.enemy.lastFoughtKey.trim()
          ? Runtime.enemy.lastFoughtKey.trim()
          : null;
      if (fkBuff && Runtime.enemy.db && Array.isArray(Runtime.enemy.db)) {
        const er = Runtime.enemy.db.find(function (e) {
          return e && e.key === fkBuff;
        });
        if (er) {
          const lastB = er.observeCalLast;
          const calB = er.observeCalAgg;
          const bucketsB = calB && calB.buffSigBuckets ? calB.buffSigBuckets : null;
          let topB = [];
          if (bucketsB && typeof bucketsB === "object") {
            const ksB = Object.keys(bucketsB);
            for (let ib = 0; ib < ksB.length; ib += 1) {
              const bEnt = bucketsB[ksB[ib]];
              const sigFull = bEnt && bEnt.signature != null ? String(bEnt.signature) : "";
              // AI CHANGED: §6 soak triage — short text so TestSummary.json distinguishes buckets (not only signatureLen).
              const signaturePreview =
                sigFull.length > 0 ? (sigFull.length > 96 ? sigFull.slice(0, 96) + "..." : sigFull) : "(clean)";
              topB.push({
                signatureLen: sigFull.length,
                signaturePreview: signaturePreview,
                samples: bEnt ? bEnt.hpDropSamples : null,
                mean: bEnt ? bEnt.hpDropMean : null,
                sessions: bEnt ? bEnt.sessionsMerged : null
              });
            }
            topB.sort(function (a, b) {
              return (b.samples || 0) - (a.samples || 0);
            });
            topB = topB.slice(0, 3);
          }
          out.enemyBuffCalibration = {
            lastFoughtKey: fkBuff,
            statusLabelsMergeSource: lastB ? lastB.statusLabelsMergeSource : null,
            statusLabelsSignature: lastB ? lastB.statusLabelsSignature : null,
            statusLabelCount: lastB && Number.isFinite(lastB.statusLabelCount) ? lastB.statusLabelCount : null,
            buffSigBucketCount: bucketsB ? Object.keys(bucketsB).length : 0,
            buffSigTop: topB
          };
        }
      }
    } catch (eBf) {
      out.enemyBuffCalibrationError = String(eBf && eBf.message ? eBf.message : eBf);
    }
    // AI CHANGED: Planner prefs slice for soak exports (includes openerFollowUpSkillDepth from ligmarbot.plannerUi.v1 after boot load).
    try {
      if (typeof plannerPrefsSnapshot === "function") {
        out.plannerUiPrefs = plannerPrefsSnapshot();
      }
    } catch (ePlFv) {
      out.plannerUiPrefsError = String(ePlFv && ePlFv.message ? ePlFv.message : ePlFv);
    }
    return out;
  }

  // AI CHANGED: End-of-bundle game/planner snapshot for offline analysis (best-effort).
  function buildGameSnapshotForTestExport() {
    const snap = {};
    try {
      if (typeof readBasicState === "function") {
        snap.basicState = readBasicState();
      }
    } catch (e) {
      snap.basicStateError = String(e && e.message ? e.message : e);
    }
    try {
      if (typeof getAutoFarmStatus === "function") {
        snap.autoFarm = getAutoFarmStatus();
      }
    } catch (e2) {
      snap.autoFarmError = String(e2 && e2.message ? e2.message : e2);
    }
    try {
      if (typeof getPlannerOpeningPickDiagnostics === "function") {
        snap.plannerDiagnostics = getPlannerOpeningPickDiagnostics();
      }
    } catch (e3) {
      snap.plannerDiagnosticsError = String(e3 && e3.message ? e3.message : e3);
    }
    try {
      snap.fieldValidation = buildFieldValidationSnapshotForTestExport();
    } catch (e4) {
      snap.fieldValidationError = String(e4 && e4.message ? e4.message : e4);
    }
    return snap;
  }

  // AI CHANGED: Single JSON document for support — full steps, failures, environment, timing.
  function buildTestSelfTestExportPayload(params) {
    const checks = params.checks;
    const labelById = getTestBundleHumanLabels();
    const finishedAt = Date.now();
    const startedAt = params.startedAt;
    const failures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < checks.length; i += 1) {
      const c = checks[i];
      if (c.detail && c.detail.skipped) {
        skipped += 1;
      } else if (c.ok) {
        passed += 1;
      } else {
        failed += 1;
        const reason =
          c.detail && (c.detail.reason || c.detail.error)
            ? String(c.detail.reason || c.detail.error)
            : "";
        failures.push({
          id: c.id,
          label: labelById[c.id] || c.id,
          critical: !!c.critical,
          reason: reason,
          detail:
            c.detail !== undefined
              ? pruneValueForTestExport(cloneJsonSafeForTestExport(c.detail), 0)
              : null // AI CHANGED: compact paste-friendly failure detail (clone breaks shared planner refs)
        });
      }
    }
    return {
      ligmarbotSelfTest: 1,
      exportCompact: {
        schema: 1,
        maxInlineArray: 12,
        truncatedArrayHead: 5,
        truncatedArrayTail: 2,
        maxStringChars: 2400
      },
      version: params.botVersion,
      timing: {
        startedAt: startedAt,
        finishedAt: finishedAt,
        durationMs: finishedAt - startedAt,
        startedIso: new Date(startedAt).toISOString(),
        finishedIso: new Date(finishedAt).toISOString()
      },
      environment: {
        pageUrl: typeof location !== "undefined" && location.href ? String(location.href) : "",
        userAgent: typeof navigator !== "undefined" && navigator.userAgent ? String(navigator.userAgent) : ""
      },
      testProfile: params.testProfile,
      optionsResolved: params.optsResolved,
      result: {
        ok: params.criticalFail === false,
        criticalFail: params.criticalFail,
        softFail: params.softFail,
        overall: params.humanReport.overall,
        oneLine: params.humanReport.fullText
      },
      counts: {
        steps: checks.length,
        passed: passed,
        failed: failed,
        skipped: skipped,
        failuresListed: failures.length
      },
      failures: failures,
      steps: buildTestDebugReport(checks, { pruneDetails: true }),
      gameSnapshotEnd: pruneValueForTestExport(
        cloneJsonSafeForTestExport(params.gameSnapshot || buildGameSnapshotForTestExport()),
        0
      ),
      extras:
        params.extras !== undefined && params.extras !== null
          ? pruneValueForTestExport(cloneJsonSafeForTestExport(params.extras), 0)
          : null
    };
  }

  // AI CHANGED: Escape JSON for embedding in HTML export tab.
  function escapeHtmlForTestExport(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // AI CHANGED: Full export in a new tab — Ctrl+A / optional Copy button (no tiny console selection).
  function openTestSelfExportInNewTab(jsonStr, summaryOneLine) {
    const sum = summaryOneLine ? escapeHtmlForTestExport(summaryOneLine) : "";
    const bodyJson = escapeHtmlForTestExport(jsonStr);
    const html =
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Ligmar Bot TEST export</title>" +
      "<style>body{font-family:system-ui,-apple-system,sans-serif;margin:16px;max-width:1200px;background:#0d1117;color:#e6edf3}" +
      ".sum{background:#21262d;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:14px;line-height:1.45;border:1px solid #30363d}" +
      "pre{white-space:pre-wrap;word-break:break-word;background:#161b22;padding:14px;border-radius:8px;border:1px solid #30363d;font:12px/1.45 Consolas,Menlo,monospace;max-height:70vh;overflow:auto}" +
      "button{padding:10px 18px;font-size:14px;margin:0 8px 12px 0;cursor:pointer;border-radius:6px;background:#238636;color:#fff;border:none;font-weight:600}" +
      "button:hover{background:#2ea043} .hint{color:#8b949e;font-size:13px;margin-bottom:10px}</style></head><body>" +
      "<h1 style=\"font-size:18px;margin:0 0 12px\">Ligmar Bot — TEST export</h1>" +
      "<div class=\"sum\"><strong>One-line result:</strong> " + sum + "</div>" +
      "<p class=\"hint\">Paste this tab into chat/AI. Use <strong>Copy JSON</strong> or Ctrl+A in the box below.</p>" +
      "<button type=\"button\" id=\"ligmar-test-copy-btn\">Copy JSON to clipboard</button>" +
      "<pre id=\"ligmar-test-raw\">" + bodyJson + "</pre>" +
      "<script>" +
      "(function(){var p=document.getElementById(\"ligmar-test-raw\");var b=document.getElementById(\"ligmar-test-copy-btn\");" +
      "function go(t){if(navigator.clipboard&&navigator.clipboard.writeText){return navigator.clipboard.writeText(t).then(function(){flash(\"Copied \"+t.length+\" characters\");});}" +
      "return Promise.resolve(fallback(t));}" +
      "function fallback(t){var x=document.createElement(\"textarea\");x.value=t;x.style.position=\"fixed\";x.style.left=\"-9999px\";document.body.appendChild(x);x.select();" +
      "try{document.execCommand(\"copy\");flash(\"Copied \"+t.length+\" characters\");return true;}catch(e){flash(\"Select the box and press Ctrl+C\");return false;}finally{document.body.removeChild(x);}}" +
      "function flash(m){b.textContent=m;setTimeout(function(){b.textContent=\"Copy JSON to clipboard\";},2500);}" +
      "b.onclick=function(){go(p.textContent);};})();" +
      "</script></body></html>";
    try {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) {
        setTimeout(function () {
          try {
            URL.revokeObjectURL(url);
          } catch (e2) {
            // ignore
          }
        }, 120000);
        Logger.log("TEST", "SELF_TEST_TAB", "opened export in new tab — copy from there or use Copy JSON button");
      } else {
        Logger.warn("TEST", "SELF_TEST_TAB", "popup blocked — allow popups for this site, or use console block / ligmarBot.getLastTestExport()");
      }
    } catch (e) {
      Logger.warn("TEST", "SELF_TEST_TAB", "could not open tab", e);
    }
  }

  // AI CHANGED: Auto-copy after TEST (may fail without user gesture — new tab is the reliable path).
  function tryCopyTestExportToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return fallbackCopyTestExportToClipboard(text);
      });
    }
    return Promise.resolve(fallbackCopyTestExportToClipboard(text));
  }

  function fallbackCopyTestExportToClipboard(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // AI CHANGED: Soak triage — graceful auto-farm stop + copy last N Logger ring lines (panel STOP+COPY LOGS, no manual console steps).
  function copyIssueReportLogsForSupport(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const lineCount = Number.isFinite(opts.lines) && opts.lines > 0 ? Math.min(200, Math.floor(opts.lines)) : 30;
    const stopFarm = opts.stopFarm !== false;
    let stopRes = { ok: true, message: "skip_stop" };
    if (stopFarm && typeof stopAutoFarmLoop === "function") {
      stopRes = stopAutoFarmLoop();
    }
    Logger.log("UI", "ISSUE_REPORT_CLIP", {
      version: BotVersion.version,
      linesRequested: lineCount,
      farmStop: stopRes,
      via: opts.via || "api"
    });
    const inner =
      typeof Logger.getRecentLogLinesText === "function" ? Logger.getRecentLogLinesText(lineCount) : "";
    const clip =
      "---LIGMARBOT_ISSUE_LOG_CLIP_START---\n" +
      "version: " + String(BotVersion.version) + "\n" +
      "description: " + String(BotVersion.description || "") + "\n" +
      "farmStop: " + JSON.stringify(stopRes) + "\n" +
      "logLines: " + String(lineCount) + " (newest at bottom)\n" +
      "---\n" +
      inner +
      "\n---LIGMARBOT_ISSUE_LOG_CLIP_END---";
    return Promise.resolve(tryCopyTestExportToClipboard(clip)).then(function (copiedOk) {
      Logger.log("UI", "ISSUE_REPORT_CLIPBOARD", { ok: !!copiedOk, chars: clip.length, lines: lineCount });
      return { ok: true, copied: !!copiedOk, chars: clip.length, lines: lineCount, farmStop: stopRes };
    });
  }

  // AI CHANGED: Highlight DevTools copy region + Logger lines filterable by [TEST].
  function emitTestSelfTestPackage(payload, checksLength) {
    let json = "";
    try {
      json = JSON.stringify(payload, null, 2);
    } catch (err) {
      json = JSON.stringify({
        ligmarbotSelfTest: 1,
        error: "JSON.stringify failed",
        message: String(err && err.message ? err.message : err)
      });
    }
    const styleBanner = "background:#1a2332;color:#58a6ff;font-weight:bold;font-size:13px;padding:8px 10px;border-radius:6px;margin:4px 0";
    const styleCopy = "background:#0d1117;color:#7ee787;font-family:Consolas,Menlo,monospace;font-size:11px;padding:10px;border:2px solid #238636;border-radius:6px;white-space:pre-wrap";
    const styleHint = "color:#8b949e;font-size:11px;padding:4px 0";
    const styleOk = "background:#14532d;color:#bbf7d0;padding:6px 10px;border-radius:6px;font-size:12px";
    try {
      /* eslint-disable no-console */
      console.log("%c[TEST] ►►► COPY FOR SUPPORT / AI — SELECT TEXT BETWEEN BEGIN AND END BELOW ◄◄◄", styleBanner);
      console.log("%c---LIGMAR_TEST_EXPORT_BEGIN---\n" + json + "\n---LIGMAR_TEST_EXPORT_END---", styleCopy);
      console.log("%c[TEST] Tip: New tab should open with full JSON — paste from there. DevTools filter [TEST] | ligmarBot.getLastTestExport()", styleHint);
      /* eslint-enable no-console */
    } catch (e) {
      // ignore — cosmetic only
    }
    Logger.log("TEST", "SELF_TEST_COPY_BLOCK", "Copy JSON between ---LIGMAR_TEST_EXPORT_BEGIN--- and ---LIGMAR_TEST_EXPORT_END--- (console, green block)");
    Logger.log("TEST", "SELF_TEST_JSON", json);
    Logger.log("TEST", "SELF_TEST_SUMMARY", {
      version: payload.version && payload.version.version,
      ok: payload.result && payload.result.ok,
      overall: payload.result && payload.result.overall,
      durationMs: payload.timing && payload.timing.durationMs,
      failureCount: payload.failures && payload.failures.length,
      stepCount: checksLength
    });
    if (Runtime && Runtime.ui) {
      Runtime.ui.lastTestExportJson = json;
      Runtime.ui.lastTestExportAt = Date.now();
      Runtime.ui.lastTestExportOk = !!(payload.result && payload.result.ok);
    }
    const oneLine = payload.result && payload.result.oneLine ? payload.result.oneLine : "";
    openTestSelfExportInNewTab(json, oneLine);
    void tryCopyTestExportToClipboard(json).then(function (copied) {
      if (copied) {
        Logger.log("TEST", "SELF_TEST_CLIPBOARD", "full JSON copied to clipboard automatically");
        try {
          /* eslint-disable no-console */
          console.log("%c[TEST] Full export copied to clipboard (" + json.length + " chars)", styleOk);
          /* eslint-enable no-console */
        } catch (e2) {
          // ignore
        }
      } else {
        Logger.log("TEST", "SELF_TEST_CLIPBOARD", "auto-copy unavailable — use the new tab, Copy JSON button, or Ctrl+A in the tab");
      }
    });
    return json;
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

  // AI CHANGED: One-click TEST — default **`panel`** profile runs the full automated suite (ranked soak, strict calibration, watchdog/chat probes, skill scan when needed, resume farm). Use **`testProfile: "quick"`** for a fast dev pass; **`release`** for longest soak windows (console).
  async function runUiTestBundle(userOpts) {
    const testBundleStartedAt = Date.now();
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const requestedProfileRaw =
      typeof opts.testProfile === "string" && opts.testProfile.trim() ? opts.testProfile.trim().toLowerCase() : "";
    const requestedProfile = requestedProfileRaw || "panel";
    const isReleaseProfile = requestedProfile === "release" || requestedProfile === "long";
    const isQuickProfile = requestedProfile === "quick";
    const isPanelProfile = requestedProfile === "panel";
    const runCalibration = isQuickProfile ? opts.runQuickCalibration !== false : true;
    // AI CHANGED: Legacy option kept for API compatibility; TEST no longer runs charge-cancel smoke by default. Quick profile never runs cancel smoke even if opts ask for it.
    const fireChargeCancelIfHint = !isQuickProfile && opts.fireChargeCancelIfHint === true;
    // AI CHANGED: Soak workflow hardening — release profile defaults to resume auto-farm after TEST when it was ON pre-run.
    const resumeAfter =
      typeof opts.resumeAutoFarm === "boolean" ? opts.resumeAutoFarm : !isQuickProfile;
    const forceSkillScan = opts.forceSkillScan === true;
    const runSkillScanIfNeeded = opts.runSkillScanIfNeeded !== false;
    const runHeroStatsInTest = opts.runHeroStatsInTest !== false;
    const strictCalibration = isQuickProfile ? opts.strictCalibration === true : true;
    const strictRankedChecks = isQuickProfile ? opts.strictRankedChecks !== false : true;
    const autoRankedSoak = opts.autoRankedSoak !== false;
    const rankedSoakMinMs = Number.isFinite(opts.rankedSoakMinMs)
      ? opts.rankedSoakMinMs
      : isReleaseProfile
        ? 180000
        : isQuickProfile
          ? 12000
          : 45000;
    const rankedSoakMaxMs = Number.isFinite(opts.rankedSoakMaxMs)
      ? opts.rankedSoakMaxMs
      : isReleaseProfile
        ? 360000
        : isQuickProfile
          ? 45000
          : 180000;
    const rankedSoakMinEvents = Number.isFinite(opts.rankedSoakMinEvents)
      ? opts.rankedSoakMinEvents
      : isReleaseProfile
        ? 16
        : isQuickProfile
          ? 6
          : 10;
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
    let testBundleQuickCancelBackup = null;

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
      chargeSkillReleaseOverrideMs: Config.combat.chargeSkillReleaseOverrideMs
    };
    // AI CHANGED: TEST must self-enable ranked checks path; user should only press TEST.
    Config.planner.useRankedAttackSkillsInCombat = true;
    Config.planner.skillMpReserve = 0;
    Runtime.planner.forcedOpenerSkillName = forcedRankedSkillName || null;
    Runtime.planner.forcedOpenerReason = forcedRankedSkillName ? "runUiTestBundle" : null;
    if (forcedRankedSkillName && forceChargeReleaseFraction !== null) {
      Config.combat.chargeSkillDynamicReleaseEnabled = false;
      Config.combat.chargeSkillReleaseOverrideMs = 0;
      Config.combat.chargeSkillReleaseFraction = forceChargeReleaseFraction;
    }
    // AI CHANGED: quick TEST — disable all charge-cancel UI taps during bundle + stuck-cancel config for soak combat inside TEST.
    if (isQuickProfile) {
      testBundleQuickCancelBackup = {
        disableChargeCancelUi: Runtime.testBundle.disableChargeCancelUi === true,
        rankedOpenerClickCancelUiIfChargeStuck: Config.combat.rankedOpenerClickCancelUiIfChargeStuck,
        chargingCancelPreferMapGapClick: Config.combat.chargingCancelPreferMapGapClick
      };
      Runtime.testBundle.disableChargeCancelUi = true;
      Config.combat.rankedOpenerClickCancelUiIfChargeStuck = false;
      Config.combat.chargingCancelPreferMapGapClick = false;
      Logger.log("TEST", "quick profile: charge cancel UI + stuck-cancel prefs disabled for bundle scope");
    }

    try {
      Logger.log("TEST", "BUNDLE_START", {
        at: testBundleStartedAt,
        iso: new Date(testBundleStartedAt).toISOString(),
        testProfile: requestedProfile
      });
      Logger.log("TEST", `bundle start v${BotVersion.version}`, {
        testProfile: requestedProfile,
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
          profile: isReleaseProfile ? "release" : isQuickProfile ? "quick" : "panel",
          strictRankedChecks: strictRankedChecks,
          strictCalibration: strictCalibration,
          resumeAutoFarmAfterTest: resumeAfter,
          rankedSoakMinMs: rankedSoakMinMs,
          rankedSoakMaxMs: rankedSoakMaxMs,
          rankedSoakMinEvents: rankedSoakMinEvents,
          autoRankedSoak: autoRankedSoak,
          forceRankedSkillName: forcedRankedSkillName || null,
          forceChargeReleaseFraction: forceChargeReleaseFraction,
          quickDisableChargeCancelUi: isQuickProfile === true
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
          // AI CHANGED: No post-retarget cancel — game winds default basic; bot arms cast-bar queue on Attack.
          postRetargetCancelBeforeAttacks: false,
          postRetargetQueueAfterGameBasic: true,
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
          // AI CHANGED: Queue v2 — cast-bar name match; first post-retarget burst may arm queue on game basic without opener click.
          trigger: "progress_bar_name_match",
          visibleCastBarTexts: typeof readVisibleCombatCastBarTexts === "function" ? readVisibleCombatCastBarTexts() : [],
          postProgressSettleMs: Number.isFinite(Config.combat.combatQueuePostProgressSettleMs) ? Config.combat.combatQueuePostProgressSettleMs : null,
          // AI CHANGED: Queue v3 — planner lookahead depth for `plannerBuildCombatQueueAction` (same knob as opener follow-up horizon).
          configOpenerFollowUpSkillDepth:
            Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
              ? Math.max(0, Math.min(4, Math.floor(Config.planner.openerFollowUpSkillDepth)))
              : null,
          queueScoreDepth:
            Config.planner && Config.planner.openerFollowUpSkillQueueEnabled === false
              ? 0
              : (
                  Number.isFinite(Config.planner && Config.planner.openerFollowUpSkillDepth)
                    ? Math.max(0, Math.floor(Config.planner.openerFollowUpSkillDepth))
                    : 2
                ),
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
            smartLineConfigured:
              typeof isChatSmartLineConfigured === "function" ? isChatSmartLineConfigured() : null,
            smartLineDispatch: "uniform_1_of_6_smart_plus_5_bank_lines",
            smartLineFollowupDelayMs:
              Config.chat && Number.isFinite(Config.chat.smartLineFollowupDelayMs)
                ? Config.chat.smartLineFollowupDelayMs
                : null,
            probe: smoke,
            runtime: Runtime && Runtime.autoFarm ? Runtime.autoFarm.chatSpammer || null : null
          },
          false
        );
      } catch (err) {
        addCheck("chat_spammer_auto", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        const sb = Config.supportBuffs;
        const clsOk = typeof listScannedSupportBuffClassifications === "function";
        const safeOk = typeof listScannedSkillsMatchingSafetyBuffHeuristic === "function";
        const cls = clsOk ? listScannedSupportBuffClassifications() : null;
        const safe = safeOk ? listScannedSkillsMatchingSafetyBuffHeuristic() : null;
        addCheck(
          "support_buffs_surface",
          !!(sb && sb.enabled !== false && clsOk && safeOk && Array.isArray(cls) && Array.isArray(safe)),
          {
            enabled: !!(sb && sb.enabled !== false),
            mpPotionForceUseBelowPct:
              Config.combat && Number.isFinite(Config.combat.mpPotionForceUseBelowPct)
                ? Config.combat.mpPotionForceUseBelowPct
                : null,
            safetySkillNames: sb && sb.safety ? sb.safety.skillNames : null,
            classifyCount: Array.isArray(cls) ? cls.length : null,
            safetyHeuristicCount: Array.isArray(safe) ? safe.length : null
          },
          false
        );
      } catch (err) {
        addCheck("support_buffs_surface", false, { error: String(err && err.message ? err.message : err) }, false);
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
      // AI CHANGED: Panel uses "scan when needed" like quick (empty bar only); release still forces a fresh scan for longest validation runs.
      const needsScan =
        forceSkillScan || isReleaseProfile || slotCountBefore === 0 || !hasNonEmptyBefore;
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
              // AI CHANGED: freshDecisionCountSeen increments only when evaluateFreshNaturalOpenerOpportunity was ok — another skill winning that window is valid.
              acceptableFreshAlternative:
                naturalReady && !naturalPicked && naturalFreshDecisionCountSeen > 0,
              skipped: !naturalPicked && naturalFreshDecisionCountSeen <= 0,
              lastReason: naturalLastReason,
              lastDetail: naturalLastDetail,
              reason: naturalReady
                ? (naturalPicked
                  ? null
                  : (naturalFreshDecisionCountSeen <= 0
                    ? "no_fresh_post_force_opener_decision_observed"
                    : "fresh_opener_other_skill_observed"))
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
          (naturalSniperProbe.skipped ||
            naturalSniperProbe.pickedNaturally ||
            naturalSniperProbe.acceptableFreshAlternative)
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
      // AI CHANGED: openerHorizonSim paper mob — unknown damageType uses magic blend; explicit physical uses physical weight; TEST covers both.
      if (!rankedOn) {
        addCheck(
          "planner_horizon_dot_mob_calibration",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else if (typeof plannerSummarizeSkillPaperDamageShape !== "function") {
        addCheck("planner_horizon_dot_mob_calibration", false, { error: "missing_plannerSummarizeSkillPaperDamageShape" }, false);
      } else {
        const dotSlot = { effects: [{ type: "dot", perSec: 20, durationSec: 4 }] };
        const instSlot = { effects: [{ type: "instant", value: 100 }] };
        const dotPhysSlot = { effects: [{ type: "dot", perSec: 20, durationSec: 4, damageType: "physical" }] };
        const instPhysSlot = { effects: [{ type: "instant", value: 100, damageType: "physical" }] };
        let sFull = null;
        let sHalf = null;
        let iFull = null;
        let iHalf = null;
        let dpFull = null;
        let dpHalf = null;
        let ipFull = null;
        let ipHalf = null;
        let dotErr = null;
        const wMagCfg = Config.planner && Config.planner.horizonPaperMobBlendMagicWeight;
        const wMagic = Number.isFinite(wMagCfg)
          ? Math.max(0, Math.min(1, wMagCfg))
          : (function () {
              const leg = Config.planner && Config.planner.horizonPaperMobBlendNonBasicWeight;
              return Number.isFinite(leg) ? Math.max(0, Math.min(1, leg)) : 0.6;
            })();
        const wPhysCfg = Config.planner && Config.planner.horizonPaperMobBlendPhysicalWeight;
        const wPhys = Number.isFinite(wPhysCfg) ? Math.max(0, Math.min(1, wPhysCfg)) : 1;
        const effHalfMagic = 1 + (0.5 - 1) * wMagic;
        const effHalfPhys = 1 + (0.5 - 1) * wPhys;
        try {
          sFull = plannerSummarizeSkillPaperDamageShape(dotSlot, 4, 1, null, null);
          sHalf = plannerSummarizeSkillPaperDamageShape(dotSlot, 4, 0.5, null, null);
          iFull = plannerSummarizeSkillPaperDamageShape(instSlot, 4, 1, null, null);
          iHalf = plannerSummarizeSkillPaperDamageShape(instSlot, 4, 0.5, null, null);
          dpFull = plannerSummarizeSkillPaperDamageShape(dotPhysSlot, 4, 1, null, null);
          dpHalf = plannerSummarizeSkillPaperDamageShape(dotPhysSlot, 4, 0.5, null, null);
          ipFull = plannerSummarizeSkillPaperDamageShape(instPhysSlot, 4, 1, null, null);
          ipHalf = plannerSummarizeSkillPaperDamageShape(instPhysSlot, 4, 0.5, null, null);
        } catch (eDot) {
          dotErr = String(eDot && eDot.message ? eDot.message : eDot);
        }
        const dotOk =
          !dotErr &&
          sFull &&
          sHalf &&
          Number.isFinite(sFull.dotDamage) &&
          sFull.dotDamage > 0 &&
          Number.isFinite(sHalf.dotDamage) &&
          Math.abs(sHalf.dotDamage - sFull.dotDamage * effHalfMagic) < 1e-4;
        const instOk =
          !dotErr &&
          iFull &&
          iHalf &&
          Number.isFinite(iFull.immediateDamage) &&
          iFull.immediateDamage > 0 &&
          Number.isFinite(iHalf.immediateDamage) &&
          Math.abs(iHalf.immediateDamage - iFull.immediateDamage * effHalfMagic) < 1e-4;
        const dotPhysOk =
          !dotErr &&
          dpFull &&
          dpHalf &&
          Number.isFinite(dpFull.dotDamage) &&
          dpFull.dotDamage > 0 &&
          Number.isFinite(dpHalf.dotDamage) &&
          Math.abs(dpHalf.dotDamage - dpFull.dotDamage * effHalfPhys) < 1e-4;
        const instPhysOk =
          !dotErr &&
          ipFull &&
          ipHalf &&
          Number.isFinite(ipFull.immediateDamage) &&
          ipFull.immediateDamage > 0 &&
          Number.isFinite(ipHalf.immediateDamage) &&
          Math.abs(ipHalf.immediateDamage - ipFull.immediateDamage * effHalfPhys) < 1e-4;
        const basicSlot = { effects: [{ type: "basic_proc" }] };
        let bFull = null;
        let bHalf = null;
        try {
          bFull = plannerSummarizeSkillPaperDamageShape(basicSlot, 4, 1, 200, null);
          bHalf = plannerSummarizeSkillPaperDamageShape(basicSlot, 4, 0.5, 200, null);
        } catch (eB) {
          dotErr = dotErr || String(eB && eB.message ? eB.message : eB);
        }
        const basicOk =
          !dotErr &&
          bFull &&
          bHalf &&
          Number.isFinite(bFull.immediateDamage) &&
          bFull.immediateDamage > 0 &&
          Math.abs(bHalf.immediateDamage - bFull.immediateDamage * 0.5) < 1e-4;
        const paperMobOk = dotOk && instOk && basicOk && dotPhysOk && instPhysOk;
        addCheck(
          "planner_horizon_dot_mob_calibration",
          paperMobOk,
          paperMobOk
            ? {
                blendMagicWeight: wMagic,
                blendPhysicalWeight: wPhys,
                effHalfMagic: effHalfMagic,
                effHalfPhys: effHalfPhys,
                dotFull: sFull.dotDamage,
                dotHalf: sHalf.dotDamage,
                instantFull: iFull.immediateDamage,
                instantHalf: iHalf.immediateDamage,
                dotPhysFull: dpFull.dotDamage,
                dotPhysHalf: dpHalf.dotDamage,
                instantPhysFull: ipFull.immediateDamage,
                instantPhysHalf: ipHalf.immediateDamage,
                basicProcFull: bFull.immediateDamage,
                basicProcHalf: bHalf.immediateDamage
              }
            : {
                error: "paper_mob_factor_mismatch",
                dotError: dotErr,
                blendMagicWeight: wMagic,
                blendPhysicalWeight: wPhys,
                effHalfMagic: effHalfMagic,
                effHalfPhys: effHalfPhys,
                dot: { full: sFull, half: sHalf },
                instant: { full: iFull, half: iHalf },
                dotPhys: { full: dpFull, half: dpHalf },
                instantPhys: { full: ipFull, half: ipHalf },
                basicProc: { full: bFull, half: bHalf },
                dotOk: dotOk,
                instOk: instOk,
                dotPhysOk: dotPhysOk,
                instPhysOk: instPhysOk,
                basicOk: basicOk
              },
          false
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
        // AI CHANGED: horizon basic win omits skill-shaped lastDetail.contextAdjustment; preview still exercises context scoring.
        const lastReasonCtx = diag && diag.lastReason ? diag.lastReason : null;
        const detailContextWaivedForBasicHorizon = lastReasonCtx === "horizon_prefers_basic";
        addCheck(
          "planner_opener_context_scoring",
          previewHasContext && (detailHasContext || forcedOnlyDetail || detailContextWaivedForBasicHorizon),
          {
          previewCandidateCount: previewRows.length,
          previewHasContext: previewHasContext,
          detailHasContext: detailHasContext,
          forcedOnlyDetail: forcedOnlyDetail,
          detailContextWaivedForBasicHorizon: detailContextWaivedForBasicHorizon,
          lastReason: lastReasonCtx,
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
      // AI CHANGED: Combat episode v1 — `plannerBuildCombatEpisodePlan` must emit versioned steps whenever ranked helpers exist.
      if (!rankedOn) {
        addCheck(
          "planner_combat_episode_plan",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else if (
        typeof plannerBuildCombatEpisodePlan !== "function" ||
        typeof plannerResolveCombatEpisodeTargetKey !== "function" ||
        typeof plannerPickSkillOpeningPick !== "function"
      ) {
        addCheck("planner_combat_episode_plan", false, { error: "missing_planner_episode_helpers" }, false);
      } else {
        let episodePick = null;
        let episodePickErr = null;
        try {
          episodePick = plannerPickSkillOpeningPick({ excludeSlots: [], disallowChargeSkills: false });
        } catch (epErr) {
          episodePickErr = String(epErr && epErr.message ? epErr.message : epErr);
        }
        const liveSt = typeof readBasicState === "function" ? readBasicState() : null;
        let planPick = episodePick;
        if (!episodePickErr && !planPick) {
          const bq =
            Config.combat &&
            Config.combat.combatQueueEnabled !== false &&
            typeof plannerBuildCombatQueueAction === "function"
              ? plannerBuildCombatQueueAction({
                  afterSlot: null,
                  liveState: liveSt,
                  disallowChargeSkills: true
                })
              : null;
          planPick = { slot: null, record: null, chargeReleasePlan: null, queuedAction: bq };
        }
        const episode =
          !episodePickErr && planPick
            ? plannerBuildCombatEpisodePlan(liveSt, planPick, {
                useRankedSkillOpener: true,
                firstBurstAfterRetarget: false,
                disallowChargeSkills: false
              })
            : null;
        const epOk =
          !!episode &&
          episode.version === 1 &&
          typeof episode.targetFingerprint === "string" &&
          episode.targetFingerprint.length > 0 &&
          Array.isArray(episode.steps) &&
          episode.steps.length >= 1;
        addCheck(
          "planner_combat_episode_plan",
          epOk,
          epOk
            ? {
                fingerprintLen: episode.targetFingerprint.length,
                steps: episode.steps.length,
                firstKind: episode.steps[0] ? episode.steps[0].kind : null
              }
            : {
                error: "episode_shape_invalid",
                pickError: episodePickErr,
                episode: episode
              },
          false
        );
      }
      // AI CHANGED: Opener danger pressure — validate `plannerComputeOpenerDangerPressure` return shape + bounded incoming term (soft).
      if (!rankedOn) {
        addCheck(
          "planner_opener_danger_pressure_shape",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else if (typeof plannerComputeOpenerDangerPressure !== "function") {
        addCheck("planner_opener_danger_pressure_shape", false, { error: "missing_plannerComputeOpenerDangerPressure" }, false);
      } else {
        const liveStDp = typeof readBasicState === "function" ? readBasicState() : {};
        try {
          if (typeof updateCombatSustainObservations === "function") {
            updateCombatSustainObservations(liveStDp);
          }
        } catch (susErr) {
          /* best-effort */
        }
        const dpKey =
          Runtime && Runtime.enemy && typeof Runtime.enemy.lastFoughtKey === "string" && Runtime.enemy.lastFoughtKey.trim()
            ? Runtime.enemy.lastFoughtKey.trim()
            : null;
        let dp = null;
        let dpErr = null;
        try {
          dp = plannerComputeOpenerDangerPressure(liveStDp, dpKey ? { enemyKey: dpKey } : null);
        } catch (eDp) {
          dpErr = String(eDp && eDp.message ? eDp.message : eDp);
        }
        const cap =
          Config &&
          Config.planner &&
          Number.isFinite(Config.planner.openerContextIncomingHpLossPressureCap)
            ? Math.max(0, Config.planner.openerContextIncomingHpLossPressureCap)
            : 2.5;
        const calCap =
          Config &&
          Config.planner &&
          Number.isFinite(Config.planner.openerContextCalibrationPressureCap)
            ? Math.max(0, Config.planner.openerContextCalibrationPressureCap)
            : 0.45;
        const easeCapBound =
          Config &&
          Config.planner &&
          Number.isFinite(Config.planner.openerContextCalibrationEaseCap)
            ? Math.max(0, Config.planner.openerContextCalibrationEaseCap)
            : 0.2;
        const dpOk =
          !dpErr &&
          dp &&
          typeof dp === "object" &&
          typeof dp.totalPressure === "number" &&
          Number.isFinite(dp.totalPressure) &&
          dp.totalPressure >= 0 &&
          typeof dp.incomingHpLossPerSec === "number" &&
          Number.isFinite(dp.incomingHpLossPerSec) &&
          dp.incomingHpLossPerSec >= 0 &&
          typeof dp.incomingPressure === "number" &&
          Number.isFinite(dp.incomingPressure) &&
          dp.incomingPressure >= 0 &&
          dp.incomingPressure <= cap + 1e-3 &&
          typeof dp.calibrationPressure === "number" &&
          Number.isFinite(dp.calibrationPressure) &&
          dp.calibrationPressure >= -easeCapBound - 1e-3 &&
          dp.calibrationPressure <= calCap + 1e-3 &&
          typeof dp.calibrationPressureHard === "number" &&
          Number.isFinite(dp.calibrationPressureHard) &&
          dp.calibrationPressureHard >= 0 &&
          dp.calibrationPressureHard <= calCap + 1e-3 &&
          typeof dp.calibrationPressureEase === "number" &&
          Number.isFinite(dp.calibrationPressureEase) &&
          dp.calibrationPressureEase >= 0 &&
          dp.calibrationPressureEase <= easeCapBound + 1e-3 &&
          typeof dp.lowHpPressure === "number" &&
          Number.isFinite(dp.lowHpPressure) &&
          dp.lowHpPressure >= 0 &&
          typeof dp.enemyCountLive === "number" &&
          Number.isFinite(dp.enemyCountLive) &&
          dp.enemyCountLive >= 0 &&
          typeof dp.pullTier === "string" &&
          ["none", "solo", "duo", "pack"].indexOf(dp.pullTier) >= 0 &&
          typeof dp.pullEnemyCount === "number" &&
          Number.isFinite(dp.pullEnemyCount) &&
          dp.pullEnemyCount >= 0 &&
          (dp.calibrationRatio === null || (typeof dp.calibrationRatio === "number" && Number.isFinite(dp.calibrationRatio))) &&
          (dp.calibrationHpDropSamples === null ||
            (typeof dp.calibrationHpDropSamples === "number" && Number.isFinite(dp.calibrationHpDropSamples) && dp.calibrationHpDropSamples >= 0)) &&
          (dp.calibrationSpreadRel === null ||
            (typeof dp.calibrationSpreadRel === "number" && Number.isFinite(dp.calibrationSpreadRel) && dp.calibrationSpreadRel >= 0)) &&
          (dp.calibrationConfidenceMul === null ||
            (typeof dp.calibrationConfidenceMul === "number" &&
              Number.isFinite(dp.calibrationConfidenceMul) &&
              dp.calibrationConfidenceMul > 0 &&
              dp.calibrationConfidenceMul <= 1.001));
        addCheck(
          "planner_opener_danger_pressure_shape",
          dpOk,
          dpOk
            ? {
                totalPressure: dp.totalPressure,
                incomingPressure: dp.incomingPressure,
                incomingHpLossPerSec: dp.incomingHpLossPerSec,
                calibrationPressure: dp.calibrationPressure,
                calibrationPressureHard: dp.calibrationPressureHard,
                calibrationPressureEase: dp.calibrationPressureEase,
                enemyCountLive: dp.enemyCountLive,
                pullTier: dp.pullTier
              }
            : { error: "danger_pressure_shape_invalid", dpError: dpErr, sample: dp },
          false
        );
      }
      // AI CHANGED: Horizon channel hold risk — validate `incomingHoldPenalty` + total penalty contract (soft).
      if (!rankedOn) {
        addCheck(
          "planner_horizon_channel_hold_risk_shape",
          !strictRankedChecks,
          strictRankedChecks
            ? { error: "ranked_combat_off", strictRankedChecks: true }
            : { skipped: true, reason: "ranked_combat_off" },
          strictRankedChecks
        );
      } else if (typeof plannerComputeHorizonChannelHoldRisk !== "function") {
        addCheck("planner_horizon_channel_hold_risk_shape", false, { error: "missing_plannerComputeHorizonChannelHoldRisk" }, false);
      } else {
        const liveStHr = typeof readBasicState === "function" ? readBasicState() : {};
        const dpHrKey =
          Runtime && Runtime.enemy && typeof Runtime.enemy.lastFoughtKey === "string" && Runtime.enemy.lastFoughtKey.trim()
            ? Runtime.enemy.lastFoughtKey.trim()
            : null;
        let dpHr = null;
        try {
          dpHr = plannerComputeOpenerDangerPressure(liveStHr, dpHrKey ? { enemyKey: dpHrKey } : null);
        } catch (eDpHr) {
          dpHr = null;
        }
        let hr0 = null;
        let hrErr = null;
        try {
          hr0 = plannerComputeHorizonChannelHoldRisk(0.4, 25, liveStHr, {
            pressure: dpHr && typeof dpHr === "object" ? dpHr : null,
            enemyKey: dpHrKey || null
          });
        } catch (eHr0) {
          hrErr = String(eHr0 && eHr0.message ? eHr0.message : eHr0);
        }
        const hrOk =
          !hrErr &&
          hr0 &&
          typeof hr0 === "object" &&
          typeof hr0.penalty === "number" &&
          Number.isFinite(hr0.penalty) &&
          hr0.penalty >= 0 &&
          typeof hr0.incomingHoldPenalty === "number" &&
          Number.isFinite(hr0.incomingHoldPenalty) &&
          hr0.incomingHoldPenalty >= 0;
        addCheck(
          "planner_horizon_channel_hold_risk_shape",
          hrOk,
          hrOk
            ? { penalty: hr0.penalty, incomingHoldPenalty: hr0.incomingHoldPenalty, enemyCountLive: hr0.enemyCountLive }
            : { error: "horizon_hold_risk_shape_invalid", hrError: hrErr, sample: hr0 },
          false
        );
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
          const expectedName =
            typeof forcedRankedSkillName === "string" && forcedRankedSkillName.trim()
              ? forcedRankedSkillName.trim()
              : "";
          const barLabels = typeof readVisibleCombatCastBarTexts === "function" ? readVisibleCombatCastBarTexts() : [];
          if (hintVis) {
            // AI CHANGED: Pass forced opener name so chargeCancelRequireCastBarNameMatch gate applies in TEST like in combat.
            const clickedOk = clickChargingSkillCancelUi(
              expectedName ? { expectedSkillName: expectedName } : {}
            );
            Logger.log("TEST", "charge-cancel click (on-demand)", {
              ok: clickedOk,
              expectedSkillName: expectedName || null,
              castBarLabels: barLabels
            });
            chargeCancelTest = {
              attempted: true,
              ok: clickedOk,
              expectedSkillName: expectedName || null,
              castBarLabels: barLabels
            };
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
          chargeCancelRequireCastBarNameMatch: Config.combat.chargeCancelRequireCastBarNameMatch !== false,
          combatQueueEnabled: Config.combat.combatQueueEnabled !== false,
          combatQueuePostProgressSettleMs: Number.isFinite(Config.combat.combatQueuePostProgressSettleMs) ? Config.combat.combatQueuePostProgressSettleMs : null,
          hpPotionUseBelowPct: Number.isFinite(Config.combat.hpPotionUseBelowPct) ? Config.combat.hpPotionUseBelowPct : null,
          hpPotionEmergencyBelowPct: Number.isFinite(Config.combat.hpPotionEmergencyBelowPct) ? Config.combat.hpPotionEmergencyBelowPct : null,
          hpPotionSafeMissingHealFraction: Number.isFinite(Config.combat.hpPotionSafeMissingHealFraction) ? Config.combat.hpPotionSafeMissingHealFraction : null,
          hpPotionCombatMissingHealFraction: Number.isFinite(Config.combat.hpPotionCombatMissingHealFraction) ? Config.combat.hpPotionCombatMissingHealFraction : null,
          hpPotionForecastWindowSec: Number.isFinite(Config.combat.hpPotionForecastWindowSec) ? Config.combat.hpPotionForecastWindowSec : null,
          mpPotionUseBelowPct: Number.isFinite(Config.combat.mpPotionUseBelowPct) ? Config.combat.mpPotionUseBelowPct : null,
          mpPotionUseWhenBelowMaxMinusHeal: Config.combat.mpPotionUseWhenBelowMaxMinusHeal !== false,
          autoCombatMode: Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode) : "fast",
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

      // AI CHANGED: ROADMAP #2 — ensure field-validation slice builds (mirrors `gameSnapshotEnd.fieldValidation` in export).
      try {
        const fv = buildFieldValidationSnapshotForTestExport();
        const keys = fv && typeof fv === "object" ? Object.keys(fv) : [];
        addCheck("field_validation_snapshot", keys.length > 0, { keys: keys, farmRunning: !!(fv && fv.farmRunning) }, false);
      } catch (fvErr) {
        addCheck(
          "field_validation_snapshot",
          false,
          { error: String(fvErr && fvErr.message ? fvErr.message : fvErr) },
          false
        );
      }

      // AI CHANGED: Logger ring buffer exists and captured this TEST run (supports STOP+COPY LOGS soak workflow).
      try {
        const tail = typeof Logger.getRecentLogLines === "function" ? Logger.getRecentLogLines(5) : [];
        addCheck("logger_recent_ring", tail.length > 0, { bufferedTailSample: tail.length, ringCap: 200 }, false);
      } catch (ringErr) {
        addCheck(
          "logger_recent_ring",
          false,
          { error: String(ringErr && ringErr.message ? ringErr.message : ringErr) },
          false
        );
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
            isReleaseProfile || isPanelProfile
              ? { observe: { totalMs: 15000 } }
              : {}
          );
          const mergeSkippedNoHpDrops =
            calibration &&
            calibration.enemyDbMerge &&
            calibration.enemyDbMerge.error === "skipped_no_hp_drops";
          // AI CHANGED: Panel/release strict calibration — tier-1 retry: find + one basic, then longer observe.
          if (
            (isReleaseProfile || isPanelProfile) &&
            strictCalibration &&
            mergeSkippedNoHpDrops
          ) {
            calibrationRetried = true;
            calibrationRetryPasses = 1;
            try {
              await clickFindEnemyVerified();
              await sleep(450, { bypassStop: true });
              clickBasicAttack();
              await sleep(1400, { bypassStop: true });
              calibration = await quickCalibrationSession({
                observe: { totalMs: 18000 }
              });
            } catch (retryErr) {
              calibrationRetryError = String(retryErr && retryErr.message ? retryErr.message : retryErr);
              Logger.warn("TEST", "release calibration retry failed", retryErr);
            }
          }
          const stillSkippedMerge =
            calibration &&
            calibration.enemyDbMerge &&
            calibration.enemyDbMerge.error === "skipped_no_hp_drops";
          // AI CHANGED: Tier-2 retry — still no hp drops after soak/off-combat gap: stronger combat seed + longest observe.
          if ((isReleaseProfile || isPanelProfile) && strictCalibration && stillSkippedMerge) {
            calibrationRetryPasses = 2;
            try {
              await clickFindEnemyVerified();
              await sleep(600, { bypassStop: true });
              for (let bi = 0; bi < 3; bi += 1) {
                clickBasicAttack();
                await sleep(520, { bypassStop: true });
              }
              await sleep(900, { bypassStop: true });
              calibration = await quickCalibrationSession({
                observe: { totalMs: 28000 }
              });
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

      // AI CHANGED: §6 — after calibration merge, surface buff signature + bucket count (soft; skips when no merge).
      try {
        let buffDetail = { skipped: true, reason: "no_merge_payload" };
        let buffOk = true;
        if (!runCalibration) {
          buffDetail = { skipped: true, reason: "calibration_off" };
        } else if (calibration && calibration.enemyDbMerge && calibration.enemyDbMerge.ok && calibration.enemyDbMerge.row) {
          const rB = calibration.enemyDbMerge.row;
          const lastB = rB.observeCalLast;
          const hasSource = !!(lastB && typeof lastB.statusLabelsMergeSource === "string");
          buffOk = hasSource;
          const calRow = rB.observeCalAgg;
          buffDetail = {
            skipped: false,
            key: rB.key,
            statusLabelsMergeSource: lastB ? lastB.statusLabelsMergeSource : null,
            statusLabelsSignature: lastB ? lastB.statusLabelsSignature : null,
            statusLabelCount: lastB && Number.isFinite(lastB.statusLabelCount) ? lastB.statusLabelCount : null,
            buffSigBucketKeys:
              calRow && calRow.buffSigBuckets && typeof calRow.buffSigBuckets === "object"
                ? Object.keys(calRow.buffSigBuckets).length
                : 0
          };
        } else if (calibration && calibration.enemyDbMerge && calibration.enemyDbMerge.error) {
          buffDetail = {
            skipped: true,
            reason: "merge_not_ok",
            error: String(calibration.enemyDbMerge.error)
          };
        }
        addCheck("enemy_buff_calibration_probe", buffOk || buffDetail.skipped, buffDetail, false);
      } catch (buffErr) {
        addCheck(
          "enemy_buff_calibration_probe",
          false,
          { error: String(buffErr && buffErr.message ? buffErr.message : buffErr) },
          false
        );
      }

      // AI CHANGED: §6 — smoke that summarizeEnemyBuffSigBuckets returns a stable shape (console research API).
      try {
        let apiDetail = { skipped: true, reason: "no_summarizeEnemyBuffSigBuckets" };
        let apiOk = false;
        if (typeof summarizeEnemyBuffSigBuckets === "function") {
          const sB = summarizeEnemyBuffSigBuckets({});
          apiOk = !!(sB && typeof sB === "object" && Array.isArray(sB.buckets));
          apiDetail = {
            skipped: false,
            returnOk: !!(sB && sB.ok),
            reason: sB && sB.reason ? String(sB.reason) : null,
            key: sB && sB.key ? sB.key : null,
            bucketCount: sB && Number.isFinite(sB.bucketCount) ? sB.bucketCount : sB && sB.buckets ? sB.buckets.length : 0
          };
        }
        addCheck("enemy_buff_sig_buckets_api", apiOk || apiDetail.skipped, apiDetail, false);
      } catch (eApi) {
        addCheck(
          "enemy_buff_sig_buckets_api",
          false,
          { error: String(eApi && eApi.message ? eApi.message : eApi) },
          false
        );
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

      const gameSnapEnd = buildGameSnapshotForTestExport();
      const selfTestPayload = buildTestSelfTestExportPayload({
        checks: checks,
        startedAt: testBundleStartedAt,
        botVersion: {
          version: BotVersion.version,
          description: BotVersion.description,
          builtAt: BotVersion.builtAt
        },
        testProfile: requestedProfile,
        optsResolved: pickSerializableTestOpts(opts),
        criticalFail: criticalFail,
        softFail: softFail,
        humanReport: humanReport,
        gameSnapshot: gameSnapEnd,
        extras: {
          skillsSlotCount: Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots.length : null,
          chargeCancelTest: chargeCancelTest,
          calibrationError: calibrationError || null,
          skillsMeta: skillsMeta || null
        }
      });
      const testExportJson = emitTestSelfTestPackage(selfTestPayload, checks.length);

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
        chargeCancelTest: chargeCancelTest,
        testExportJson: testExportJson
      };
    } finally {
      if (testBundleQuickCancelBackup) {
        if (!Runtime.testBundle) {
          Runtime.testBundle = { disableChargeCancelUi: false };
        }
        Runtime.testBundle.disableChargeCancelUi = testBundleQuickCancelBackup.disableChargeCancelUi === true;
        Config.combat.rankedOpenerClickCancelUiIfChargeStuck = testBundleQuickCancelBackup.rankedOpenerClickCancelUiIfChargeStuck;
        Config.combat.chargingCancelPreferMapGapClick = testBundleQuickCancelBackup.chargingCancelPreferMapGapClick;
        testBundleQuickCancelBackup = null;
      }
      if (plannerBackup) {
        Config.planner.useRankedAttackSkillsInCombat = !!plannerBackup.useRankedAttackSkillsInCombat;
        Config.planner.skillMpReserve = plannerBackup.skillMpReserve;
        Runtime.planner.forcedOpenerSkillName = plannerBackup.forcedOpenerSkillName || null;
        Runtime.planner.forcedOpenerReason = plannerBackup.forcedOpenerReason || null;
        Config.combat.chargeSkillDynamicReleaseEnabled = plannerBackup.chargeSkillDynamicReleaseEnabled !== false;
        Config.combat.chargeSkillReleaseFraction = plannerBackup.chargeSkillReleaseFraction;
        Config.combat.chargeSkillReleaseOverrideMs = plannerBackup.chargeSkillReleaseOverrideMs;
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
    loadAutoFarmUiPrefs();

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

    // AI CHANGED: AUTO combat mode — Fast / Safe / Easy; persisted in ligmarbot.autoFarmUi.v1; planner applied when AUTO runs.
    const autoModeLabel = document.createElement("div");
    autoModeLabel.textContent = "AUTO combat mode";
    autoModeLabel.style.fontSize = "10px";
    autoModeLabel.style.opacity = "0.75";
    autoModeLabel.style.marginBottom = "4px";
    panel.appendChild(autoModeLabel);
    const autoModeRow = document.createElement("div");
    autoModeRow.style.display = "flex";
    autoModeRow.style.gap = "4px";
    autoModeRow.style.marginBottom = "10px";
    function makeModeButton(label, modeKey) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.flex = "1";
      b.style.padding = "6px 4px";
      b.style.borderRadius = "5px";
      b.style.border = "1px solid #4a5672";
      b.style.background = "#2a3351";
      b.style.color = "#dce3ff";
      b.style.fontSize = "10px";
      b.style.fontWeight = "700";
      b.style.cursor = "pointer";
      b.addEventListener("click", function () {
        Runtime.autoFarm.combatMode = modeKey;
        saveAutoFarmUiPrefs();
        refreshAutoFarmModeButtonsVisual();
        if (Runtime.autoFarm.running && typeof applyAutoFarmCombatMode === "function") {
          applyAutoFarmCombatMode();
        }
        Logger.log("UI", "AUTO combat mode selected", { mode: modeKey, running: !!Runtime.autoFarm.running });
        setTimeout(updateControlPanelStatus, 20);
      });
      return b;
    }
    const modeBtnFast = makeModeButton("Fast", "fast");
    const modeBtnSafe = makeModeButton("Safe", "safe");
    const modeBtnEasy = makeModeButton("Easy", "easy");
    autoModeRow.appendChild(modeBtnFast);
    autoModeRow.appendChild(modeBtnSafe);
    autoModeRow.appendChild(modeBtnEasy);
    panel.appendChild(autoModeRow);

    // AI CHANGED: Panel toggle — AUTO local chat promo spammer (persists in `ligmarbot.autoFarmUi.v1`).
    const chatSpamRow = document.createElement("label");
    chatSpamRow.style.display = "flex";
    chatSpamRow.style.alignItems = "center";
    chatSpamRow.style.gap = "8px";
    chatSpamRow.style.marginBottom = "10px";
    chatSpamRow.style.fontSize = "10px";
    chatSpamRow.style.opacity = "0.9";
    chatSpamRow.style.cursor = "pointer";
    const chatSpamCb = document.createElement("input");
    chatSpamCb.type = "checkbox";
    chatSpamCb.checked = !!(Config.chat && Config.chat.autoLocalPromocodeSpammerEnabled !== false);
    chatSpamCb.addEventListener("change", function () {
      if (Config.chat) {
        Config.chat.autoLocalPromocodeSpammerEnabled = !!chatSpamCb.checked;
      }
      saveAutoFarmUiPrefs();
      Logger.log("UI", "Auto local chat spammer toggled", { enabled: !!chatSpamCb.checked });
      setTimeout(updateControlPanelStatus, 20);
    });
    const chatSpamLbl = document.createElement("span");
    chatSpamLbl.textContent = "Auto local chat promo spammer";
    chatSpamRow.appendChild(chatSpamCb);
    chatSpamRow.appendChild(chatSpamLbl);
    panel.appendChild(chatSpamRow);

    // AI CHANGED: TEST — one-click **`panel`** profile (full automated suite: soak, strict calibration, probes, resume farm). Console: `ligmarBot.runUiTestBundle({ testProfile: "quick" })` or `"release"`.
    const testButton = makeButton(`TEST (${BotVersion.version})`, "#737fff", "#8f94ff", () => {
      if (testButton.disabled) {
        return;
      }
      testButton.disabled = true;
      testButton.style.opacity = "0.45";
      testButton.style.cursor = "wait";
      Promise.resolve(runUiTestBundle({ testProfile: "panel" }))
        .then(function (res) {
          Logger.log("TEST", "finished", res);
          // AI CHANGED: panel mirrors copy-paste `Test result:` line from console (per-step + OVERALL).
          if (testResultLine) {
            const line =
              (res && res.testReportLine) ? res.testReportLine : (res && res.ok ? "Test result: OK (no report line)" : "Test result: failed");
            testResultLine.textContent =
              line + " — Export tab + JSON clipboard tried.";
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

    // AI CHANGED: last TEST pass/fail line — filled when runUiTestBundle resolves (no manual console steps).
    const testResultLine = document.createElement("div");
    testResultLine.textContent = "Test result: — (full suite via TEST)";
    testResultLine.style.fontSize = "10px";
    testResultLine.style.lineHeight = "1.35";
    testResultLine.style.marginBottom = "8px";
    testResultLine.style.opacity = "0.85";
    testResultLine.style.wordBreak = "break-word";
    panel.appendChild(testResultLine);

    // AI CHANGED: Soak — one click stops auto-farm and copies last 30 Logger lines (paste to AI); no manual DevTools selection.
    const issueStopCopyButton = makeButton("STOP + COPY LOGS", "#c94b7d", "#e06699", function () {
      Promise.resolve(copyIssueReportLogsForSupport({ lines: 30, via: "panel" }))
        .then(function (res) {
          if (Runtime.ui.issueReportLine) {
            const copied = res && res.copied;
            Runtime.ui.issueReportLine.textContent = copied
              ? "Issue clip: copied last 30 bot log lines (farm stop requested if it was ON)."
              : "Issue clip: clipboard failed — click again or use ligmarBot.copyIssueReportLogs() after a user gesture.";
            Runtime.ui.issueReportLine.style.color = copied ? "#9ecbff" : "#ff6b6b";
            Runtime.ui.issueReportLine.style.fontSize = "9px";
          }
        })
        .catch(function (err) {
          Logger.warn("UI", "ISSUE_REPORT_CLIP rejected", err);
          if (Runtime.ui.issueReportLine) {
            Runtime.ui.issueReportLine.textContent =
              "Issue clip: error — " + String(err && err.message ? err.message : err);
            Runtime.ui.issueReportLine.style.color = "#ff6b6b";
          }
        })
        .finally(function () {
          setTimeout(updateControlPanelStatus, 50);
        });
    });
    issueStopCopyButton.style.flex = "none";
    issueStopCopyButton.style.width = "100%";
    issueStopCopyButton.style.marginBottom = "4px";
    panel.appendChild(issueStopCopyButton);

    const issueReportLine = document.createElement("div");
    issueReportLine.textContent = "Issue clip: — (use during soak if something looks wrong)";
    issueReportLine.style.fontSize = "9px";
    issueReportLine.style.lineHeight = "1.35";
    issueReportLine.style.marginBottom = "8px";
    issueReportLine.style.opacity = "0.8";
    issueReportLine.style.wordBreak = "break-word";
    panel.appendChild(issueReportLine);

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
    Runtime.ui.issueStopCopyButton = issueStopCopyButton;
    Runtime.ui.issueReportLine = issueReportLine;
    Runtime.ui.combatGraceInput = null;
    Runtime.ui.chatSpammerCheckbox = chatSpamCb;
    Runtime.ui.autoFarmModeButtons = { fast: modeBtnFast, safe: modeBtnSafe, easy: modeBtnEasy };
    refreshAutoFarmModeButtonsVisual();

    updateControlPanelStatus();
    // AI CHANGED: Faster refresh (500ms) so ON timer + HP/MP/Ping/phase stay live during auto-farm.
    ensureControlPanelRefreshTicker();
    return panel;
  }
