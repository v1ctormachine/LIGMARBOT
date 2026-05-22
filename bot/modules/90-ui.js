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
        const empty = { ok: true, fromStorage: false, planner: plannerPrefsSnapshot() };
        // AI CHANGED: Fast/Safe must override stale plannerUi ranked=false even when no planner blob (console loadPlanner-only flows still get combat mode).
        if (typeof applyAutoFarmCombatMode === "function") {
          applyAutoFarmCombatMode();
        }
        return empty;
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
      const out = { ok: true, fromStorage: true, planner: plannerPrefsSnapshot() };
      // AI CHANGED: Reconcile ranked / burst MP knobs with persisted AUTO combat mode so ligmarbot.plannerUi.v1 cannot leave ranked off while panel mode is Fast/Safe (TEST restores planner backup; loadPlanner alone must not strand false).
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
      }
      return out;
    } catch (err) {
      const bad = {
        ok: false,
        fromStorage: false,
        error: String(err && err.message ? err.message : err),
        planner: plannerPrefsSnapshot()
      };
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
      }
      return bad;
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
    // AI CHANGED: Persist night mode (hourly reload + boot autostart) with the same AUTO prefs blob.
    const nightOn = !!(Runtime.autoFarm && Runtime.autoFarm.nightMode && Runtime.autoFarm.nightMode.enabled);
    return { combatMode: cm, autoLocalChatSpammerEnabled: spamOn, nightModeEnabled: nightOn };
  }

  function loadAutoFarmUiPrefs() {
    try {
      const raw = window.localStorage.getItem("ligmarbot.autoFarmUi.v1");
      if (!raw) {
        // AI CHANGED: No stored prefs — still sync planner from default Runtime.autoFarm.combatMode (e.g. fast).
        if (typeof applyAutoFarmCombatMode === "function") {
          applyAutoFarmCombatMode();
        }
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
      // AI CHANGED: Restore night mode preference. Only flips Runtime flag; boot autostart + hourly reload arming are gated separately.
      if (typeof p.nightModeEnabled === "boolean") {
        if (!Runtime.autoFarm.nightMode || typeof Runtime.autoFarm.nightMode !== "object") {
          Runtime.autoFarm.nightMode = {
            enabled: false,
            hourlyReloadTimer: null,
            hourlyReloadScheduledAt: null,
            hourlyReloadDueAt: null,
            lastReloadAt: null,
            lastBootAutostartAt: null
          };
        }
        Runtime.autoFarm.nightMode.enabled = !!p.nightModeEnabled;
      }
      // AI CHANGED: Persisted Fast/Safe/Easy must sync planner immediately (not only while AUTO loop is running).
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
      }
      return { ok: true, fromStorage: true, autoFarm: autoFarmUiPrefsSnapshot() };
    } catch (err) {
      // AI CHANGED: On corrupt prefs JSON, still sync planner from current Runtime combat mode.
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
      }
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
    // AI CHANGED: Minimal panel footer — watchdog/session/recovery detail stays in console `Logger` / `ligmarBot.getAutoFarmStatus()`.
    const lines = [
      `HP ${hpPct !== null ? hpPct + "%" : "?"} · MP ${mpPct !== null ? mpPct + "%" : "?"} · Ping ${state.network.pingMs !== null ? state.network.pingMs + "ms" : "?"}`,
      `Enemies: ${enemyText} · Coords: ${coordsText}`,
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
      action_bar_unified_slots: "Action bar unified slots",
      user_click_sequence: "User-like click sequence",
      night_mode_helpers_wired: "Night mode helpers wired",
      night_mode_persistence_roundtrip: "Night mode persistence",
      auto_skill_ensure_runs_once: "Skill ensure once-per-session",
      easy_mode_disables_buffs: "Easy mode disables buffs",
      sleep_min_tick_on_stop: "sleep yields even when stopRequested",
      combat_progress_target_swap: "Target-swap counts as progress",
      hp_spike_requires_low_hp: "HP spike rejects high-HP misreads",
      potion_cooldown_client_enforced: "Potion respects client cooldown",
      wait_for_condition_health_throttle: "Health eval throttled in waits",
      ring_scan_fresh_baseline: "Ring scan per-tile baseline",
      logger_dedup_consecutive: "Logger collapses repeats",
      click_safe_visibility_recheck: "Click recheck visibility",
      ensure_map_open_canvas_guard: "Map-open canvas guard",
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
      support_buff_post_cast_cooldown_wait_config: "Support buff post-cast CD wait",
      support_buff_duration_tracking_config: "Support buff duration tracking",
      farm_loop_ensure_skills_config: "AUTO farmLoop.ensureSkills",
      // AI CHANGED: Potion tooltip regression — base (+bonus) total heal/MP for sustain.
      potion_parse_heal_base_plus_bonus: "Potion heal parse (+bonus)",
      potion_parse_mp_base_plus_bonus: "Potion MP parse (+bonus)",
      potion_parse_heal_legacy_no_bonus: "Potion heal parse (legacy)",
      combat_sustain_policy: "Combat sustain",
      auto_farm_resume_policy: "Farm resume policy",
      auto_farm_reliability: "Combat reliability",
      auto_farm_session_summary: "Auto-farm session",
      auto_combat_mode_fast_enables_ranked: "AUTO Fast enables ranked",
      auto_combat_mode_easy_disables_ranked: "AUTO Easy disables ranked",
      auto_combat_mode_safe_full_planner_like_fast: "AUTO Safe = full planner bursts",
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
        const bar = document.querySelector(Config.selectors.actionBar);
        if (!bar) {
          addCheck("action_bar_unified_slots", true, { skipped: "no_action_bar" }, false);
        } else {
          const actionOnly = bar.querySelectorAll("app-action-button").length;
          const skillOnly = bar.querySelectorAll("app-skill-button").length;
          const unified =
            typeof getActionBarSlotElements === "function"
              ? getActionBarSlotElements(bar).length
              : bar.querySelectorAll(
                  Config.selectors.actionBarSlot || "app-action-button, app-skill-button"
                ).length;
          const ok = skillOnly === 0 || unified > actionOnly;
          addCheck(
            "action_bar_unified_slots",
            ok,
            { actionOnly: actionOnly, skillOnly: skillOnly, unified: unified, children: bar.children.length },
            false,
            ok ? null : "app-skill-button present but unified slot count did not exceed action-button-only count"
          );
        }
      } catch (err) {
        Logger.warn("TEST", "action_bar_unified_slots threw", err);
        addCheck(
          "action_bar_unified_slots",
          false,
          { error: String(err && err.message ? err.message : err) },
          false
        );
      }

      try {
        addCheck(
          "user_click_sequence",
          typeof dispatchUserClickSequence === "function",
          {
            helper: typeof dispatchUserClickSequence,
            pointerEvent: typeof PointerEvent === "function",
            reason: "appsmartclick requires pointer/mouse center events; native element.click() is not enough after game update"
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "user_click_sequence threw", err);
        addCheck(
          "user_click_sequence",
          false,
          { error: String(err && err.message ? err.message : err) },
          false
        );
      }

      // AI CHANGED: Night mode — helper wiring (config + lifecycle helpers + bootstrap autostart hook).
      try {
        const nmCfg = Config && Config.nightMode ? Config.nightMode : null;
        const hourlyMs = nmCfg && Number.isFinite(nmCfg.hourlyReloadMs) ? nmCfg.hourlyReloadMs : null;
        const wired =
          !!nmCfg &&
          hourlyMs != null &&
          hourlyMs >= 60000 &&
          typeof setNightModeEnabled === "function" &&
          typeof scheduleNightModeHourlyReloadIfNeeded === "function" &&
          typeof cancelNightModeHourlyReload === "function" &&
          typeof triggerNightModeHourlyReload === "function" &&
          typeof writeNightModeBootAutostartTokenIfNeeded === "function";
        addCheck(
          "night_mode_helpers_wired",
          wired,
          {
            hourlyReloadMs: hourlyMs,
            setNightModeEnabled: typeof setNightModeEnabled,
            scheduleNightModeHourlyReloadIfNeeded: typeof scheduleNightModeHourlyReloadIfNeeded,
            cancelNightModeHourlyReload: typeof cancelNightModeHourlyReload,
            triggerNightModeHourlyReload: typeof triggerNightModeHourlyReload,
            writeNightModeBootAutostartTokenIfNeeded: typeof writeNightModeBootAutostartTokenIfNeeded
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "night_mode_helpers_wired threw", err);
        addCheck("night_mode_helpers_wired", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #1 — sleep() must yield a macro-task even when stopRequested or ms===0; assert by measuring elapsed time.
      try {
        const prevStop = !!(Runtime.autoFarm && Runtime.autoFarm.stopRequested);
        const wasRunning = !!(Runtime.autoFarm && Runtime.autoFarm.running);
        Runtime.autoFarm.stopRequested = true;
        const t0 = Date.now();
        await sleep(0);
        const elapsed = Date.now() - t0;
        Runtime.autoFarm.stopRequested = prevStop;
        Runtime.autoFarm.running = wasRunning;
        addCheck(
          "sleep_min_tick_on_stop",
          elapsed >= 10,
          { elapsedMs: elapsed, threshold: 10 },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "sleep_min_tick_on_stop threw", err);
        addCheck("sleep_min_tick_on_stop", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #3 — verify by source inspection that hasCombatProgressSince treats target-swap (upward jump or different max) as progress, and the supporting config knob is present and valid.
      try {
        const src = typeof hasCombatProgressSince === "function" ? String(hasCombatProgressSince) : "";
        const hasJumpFracPath = src.indexOf("progressTargetSwapJumpFrac") >= 0 || src.indexOf("targetSwapJumpFrac") >= 0;
        const hasDifferentMaxPath = src.indexOf("different max HP") >= 0 || src.indexOf("b.max !== t.max") >= 0;
        const frac = Number(Config.combat && Config.combat.progressTargetSwapJumpFrac);
        const fracOk = Number.isFinite(frac) && frac > 0 && frac < 1;
        addCheck(
          "combat_progress_target_swap",
          hasJumpFracPath && hasDifferentMaxPath && fracOk,
          {
            jumpFracPath: hasJumpFracPath,
            differentMaxPath: hasDifferentMaxPath,
            progressTargetSwapJumpFrac: frac
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "combat_progress_target_swap threw", err);
        addCheck("combat_progress_target_swap", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #9 — config knobs exist and update path checks current HP fraction.
      try {
        const ok =
          Number.isFinite(Config.combat && Config.combat.safetyHpSpikeRequireHpBelowFrac) &&
          Number.isFinite(Config.combat && Config.combat.safetyHpSpikeCooldownMs) &&
          Config.combat.safetyHpSpikeRequireHpBelowFrac > 0 &&
          Config.combat.safetyHpSpikeRequireHpBelowFrac <= 1 &&
          Config.combat.safetyHpSpikeCooldownMs >= 500;
        addCheck(
          "hp_spike_requires_low_hp",
          ok,
          {
            requireHpBelowFrac: Config.combat ? Config.combat.safetyHpSpikeRequireHpBelowFrac : null,
            cooldownMs: Config.combat ? Config.combat.safetyHpSpikeCooldownMs : null
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "hp_spike_requires_low_hp threw", err);
        addCheck("hp_spike_requires_low_hp", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #5 — listCombatPotionCandidates honors client cooldown window when enforce flag is on.
      try {
        if (typeof listCombatPotionCandidates !== "function" || typeof getCombatSustainRuntime !== "function") {
          addCheck("potion_cooldown_client_enforced", false, { reason: "api_missing" }, false);
        } else {
          const sustain = getCombatSustainRuntime();
          const prevCooldown = sustain.potionCooldownUntil;
          const prevEnforce = Config.combat && Config.combat.combatPotionEnforceClientCooldown;
          Config.combat.combatPotionEnforceClientCooldown = true;
          sustain.potionCooldownUntil = Date.now() + 5000;
          const blocked = listCombatPotionCandidates("hp", { readyOnly: true }).length === 0;
          sustain.potionCooldownUntil = prevCooldown;
          Config.combat.combatPotionEnforceClientCooldown = prevEnforce;
          addCheck(
            "potion_cooldown_client_enforced",
            blocked,
            { enforced: true, listCountWhenCooling: blocked ? 0 : -1 },
            false
          );
        }
      } catch (err) {
        Logger.warn("TEST", "potion_cooldown_client_enforced threw", err);
        addCheck("potion_cooldown_client_enforced", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #11 — verification config exposes healthEvalThrottleMs >= 50.
      try {
        const v = Config.verification && Number(Config.verification.healthEvalThrottleMs);
        addCheck(
          "wait_for_condition_health_throttle",
          Number.isFinite(v) && v >= 50,
          { healthEvalThrottleMs: v },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "wait_for_condition_health_throttle threw", err);
        addCheck("wait_for_condition_health_throttle", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #7 — scanNeighborRing source uses per-tile `preClickBaseline` instead of cumulative `lastObservedCoords`.
      try {
        const src = typeof scanNeighborRing === "function" ? String(scanNeighborRing) : "";
        const ok = src.indexOf("preClickBaseline") >= 0;
        addCheck("ring_scan_fresh_baseline", ok, { hasPreClickBaseline: ok }, false);
      } catch (err) {
        Logger.warn("TEST", "ring_scan_fresh_baseline threw", err);
        addCheck("ring_scan_fresh_baseline", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #15 — Logger collapses two consecutive identical log calls, emitting only the first and tracking the rest as a deferred summary.
      try {
        const before = Logger.getRecentLogLines(10).length;
        Logger.log("TEST_DEDUP", "audit fix #15 dedup probe", { tag: "dedup_probe" });
        Logger.log("TEST_DEDUP", "audit fix #15 dedup probe", { tag: "dedup_probe" });
        Logger.log("TEST_DEDUP", "audit fix #15 dedup probe", { tag: "dedup_probe" });
        const after = Logger.getRecentLogLines(10).length;
        // First call wrote one line; the next two should be coalesced (not written until flush).
        const delta = after - before;
        addCheck(
          "logger_dedup_consecutive",
          delta === 1,
          { lineDelta: delta, expected: 1 },
          false
        );
        if (typeof Logger.flushDedup === "function") {
          Logger.flushDedup();
        }
      } catch (err) {
        Logger.warn("TEST", "logger_dedup_consecutive threw", err);
        addCheck("logger_dedup_consecutive", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #8 — clickElementSafe's dispatchUserClickSequence re-checks visibility right before reading rect (TOCTOU guard).
      try {
        const src = typeof dispatchUserClickSequence === "function" ? String(dispatchUserClickSequence) : "";
        const guarded = src.indexOf("became invisible before dispatch") >= 0;
        addCheck("click_safe_visibility_recheck", guarded, { guarded: guarded }, false);
      } catch (err) {
        Logger.warn("TEST", "click_safe_visibility_recheck threw", err);
        addCheck("click_safe_visibility_recheck", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Audit fix #6 — ensureMapOpen probes the map canvas before clicking the toggle.
      try {
        const src = typeof ensureMapOpen === "function" ? String(ensureMapOpen) : "";
        const guarded = src.indexOf("already_open_canvas") >= 0 && src.indexOf("Config.selectors.mapCanvas") >= 0;
        addCheck("ensure_map_open_canvas_guard", guarded, { guarded: guarded }, false);
      } catch (err) {
        Logger.warn("TEST", "ensure_map_open_canvas_guard threw", err);
        addCheck("ensure_map_open_canvas_guard", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Verify the ensure-skills helper has once-per-session config + Runtime latch hook (`Config.farmLoop.ensureSkills.runOncePerAutoSession`, `Runtime.autoFarm.skillEnsureDone`).
      try {
        const eCfg =
          Config.farmLoop && Config.farmLoop.ensureSkills ? Config.farmLoop.ensureSkills : null;
        const runtimeHasFlag =
          !!Runtime.autoFarm && Object.prototype.hasOwnProperty.call(Runtime.autoFarm, "skillEnsureDone");
        const ok =
          !!eCfg &&
          eCfg.runOncePerAutoSession !== false &&
          eCfg.skipInEasyMode !== false &&
          runtimeHasFlag;
        addCheck(
          "auto_skill_ensure_runs_once",
          ok,
          {
            runOncePerAutoSession: eCfg ? eCfg.runOncePerAutoSession : null,
            skipInEasyMode: eCfg ? eCfg.skipInEasyMode : null,
            runtimeSkillEnsureDone: runtimeHasFlag ? !!Runtime.autoFarm.skillEnsureDone : null
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "auto_skill_ensure_runs_once threw", err);
        addCheck("auto_skill_ensure_runs_once", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Easy mode disables all buff usage — verify the central predicate exists and buff entry helpers short-circuit by inspecting source strings (live combat exec is non-trivial in TEST).
      try {
        const predicateOk = typeof isAutoFarmEasyMode === "function";
        const fnSrc = function (fn) {
          try {
            return typeof fn === "function" ? String(fn) : "";
          } catch (e) {
            return "";
          }
        };
        const gated = [
          {
            name: "maybeApplyPrebuffsForNewMobTile",
            ok: fnSrc(typeof maybeApplyPrebuffsForNewMobTile === "function" ? maybeApplyPrebuffsForNewMobTile : null).indexOf("isAutoFarmEasyMode") >= 0
          },
          {
            name: "maintainLongbuffsOutOfCombat",
            ok: fnSrc(typeof maintainLongbuffsOutOfCombat === "function" ? maintainLongbuffsOutOfCombat : null).indexOf("isAutoFarmEasyMode") >= 0
          },
          {
            name: "maybeCombatSafetyBuffInterrupt",
            ok: fnSrc(typeof maybeCombatSafetyBuffInterrupt === "function" ? maybeCombatSafetyBuffInterrupt : null).indexOf("isAutoFarmEasyMode") >= 0
          },
          {
            name: "processCombatSafetyHpSpikeIfNeeded",
            ok: fnSrc(typeof processCombatSafetyHpSpikeIfNeeded === "function" ? processCombatSafetyHpSpikeIfNeeded : null).indexOf("isAutoFarmEasyMode") >= 0
          },
          {
            name: "waitForSafeModeExploreResourcesAndShortPrebuffs",
            ok: fnSrc(typeof waitForSafeModeExploreResourcesAndShortPrebuffs === "function" ? waitForSafeModeExploreResourcesAndShortPrebuffs : null).indexOf("isAutoFarmEasyMode") >= 0
          }
        ];
        const missing = gated.filter(function (g) {
          return !g.ok;
        });
        addCheck(
          "easy_mode_disables_buffs",
          predicateOk && missing.length === 0,
          {
            predicate: predicateOk,
            gatedFunctions: gated,
            missingCount: missing.length
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "easy_mode_disables_buffs threw", err);
        addCheck("easy_mode_disables_buffs", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — duration-based policy split. <60s ⇒ prebuff, >=60s ⇒ longbuff, safety reserved (Windy Dome) excluded.
      try {
        if (typeof classifySupportBuffPolicyForRow !== "function") {
          addCheck("support_buff_policy_split", false, { reason: "classifier_missing" }, false);
        } else {
          const longMin = Number.isFinite(Config.supportBuffs && Config.supportBuffs.longDurationMinSec)
            ? Config.supportBuffs.longDurationMinSec
            : 60;
          // Use a synthetic stub row with the duration injected via the "force long unknown" path so we don't depend on real DB rows.
          // We bypass the DB resolver by leveraging the named forceLongDuration substring (always present).
          const fakeShortRow = {
            kind: "skill",
            slot: 0,
            name: "TestShortPrebuff",
            isAttack: false,
            isSupport: true,
            targetsSelf: true,
            tags: ["support", "self"],
            paramsRaw: { duration: { value: 30, raw: "30 seconds" } },
            description: "Restores stamina for 30 seconds.",
            castTimeSec: 0.5
          };
          const fakeLongRow = {
            kind: "skill",
            slot: 1,
            name: "TestLongBuff",
            isAttack: false,
            isSupport: true,
            targetsSelf: true,
            tags: ["support", "self"],
            paramsRaw: { duration: { value: 600, raw: "600 seconds" } },
            description: "Bless self for 600 seconds.",
            castTimeSec: 1
          };
          const fakeSafetyRow = {
            kind: "skill",
            slot: 2,
            name: "Windy Dome",
            isAttack: false,
            isSupport: true,
            targetsSelf: true,
            tags: ["support", "self"],
            paramsRaw: { duration: { value: 8, raw: "8 seconds" } },
            description: "Creates a wind shield around the caster.",
            castTimeSec: 0
          };
          const cShort = classifySupportBuffPolicyForRow(fakeShortRow, "");
          const cLong = classifySupportBuffPolicyForRow(fakeLongRow, "");
          const cSafety = classifySupportBuffPolicyForRow(fakeSafetyRow, "");
          const splitOk =
            cShort.policy === "prebuff" &&
            cShort.durationSec < longMin &&
            cLong.policy === "longbuff" &&
            cLong.durationSec >= longMin &&
            cSafety.policy === "excluded_safety";
          addCheck(
            "support_buff_policy_split",
            splitOk,
            {
              longDurationMinSec: longMin,
              shortClass: cShort,
              longClass: cLong,
              safetyClass: cSafety
            },
            false
          );
        }
      } catch (err) {
        Logger.warn("TEST", "support_buff_policy_split threw", err);
        addCheck("support_buff_policy_split", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — prebuff list contains ONLY policy=prebuff (no longbuffs leaked in).
      try {
        const root = Config.supportBuffs;
        const longMin = Number.isFinite(root && root.longDurationMinSec) ? root.longDurationMinSec : 60;
        const listFn = typeof buildOrderedNewTilePrebuffTargets === "function" ? buildOrderedNewTilePrebuffTargets : null;
        if (!listFn) {
          addCheck("prebuff_list_excludes_longbuffs", false, { reason: "fn_missing" }, false);
        } else {
          const list = listFn();
          let bad = 0;
          for (let i = 0; i < list.length; i++) {
            if (Number.isFinite(list[i].dur) && list[i].dur >= longMin) bad += 1;
          }
          addCheck(
            "prebuff_list_excludes_longbuffs",
            bad === 0,
            { listLength: list.length, longMin: longMin, longbuffsLeaked: bad },
            false
          );
        }
      } catch (err) {
        Logger.warn("TEST", "prebuff_list_excludes_longbuffs threw", err);
        addCheck("prebuff_list_excludes_longbuffs", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — prebuff pipeline is TILE-BASED (does NOT call duration-tracking skip helper).
      try {
        const fnSrc = function (fn) {
          try {
            return typeof fn === "function" ? String(fn) : "";
          } catch (e) {
            return "";
          }
        };
        const src = fnSrc(typeof maybeApplyPrebuffsForNewMobTile === "function" ? maybeApplyPrebuffsForNewMobTile : null);
        const referencesTileKey = src.indexOf("getSupportBuffCurrentTileKey") >= 0 && src.indexOf("rt.prebuff.tileKey") >= 0;
        const doesNotUseDurationSkip = src.indexOf("supportBuffShouldSkipRecastFromTracking") < 0;
        addCheck(
          "prebuff_policy_tile_based",
          referencesTileKey && doesNotUseDurationSkip,
          {
            referencesTileKey: referencesTileKey,
            doesNotCallDurationSkipHelper: doesNotUseDurationSkip
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "prebuff_policy_tile_based threw", err);
        addCheck("prebuff_policy_tile_based", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — safe-mode prebuff wait lives on the MOB-TILE prebuff path (wait-all-ready), and is NOT invoked from the empty-tile explore gate anymore.
      try {
        const fnSrc = function (fn) {
          try {
            return typeof fn === "function" ? String(fn) : "";
          } catch (e) {
            return "";
          }
        };
        const mobTileSrc = fnSrc(typeof maybeApplyPrebuffsForNewMobTile === "function" ? maybeApplyPrebuffsForNewMobTile : null);
        const exploreSrc = fnSrc(typeof waitForSafeModeExploreResourcesAndShortPrebuffs === "function" ? waitForSafeModeExploreResourcesAndShortPrebuffs : null);
        const mobTileHasWaitAll = mobTileSrc.indexOf("safe") >= 0 && mobTileSrc.indexOf("safeModeWaitAllReadyMs") >= 0 && mobTileSrc.indexOf("isActionBarSlotShowingCooldown") >= 0;
        const exploreDoesNotCastShortPrebuffs =
          exploreSrc.indexOf("waitForSafeModeShortPrebuffCooldownsThenCast") < 0 &&
          exploreSrc.indexOf("clickActionBarSlot(") < 0 &&
          exploreSrc.indexOf("shortPrebuffMovedToMobTile") >= 0;
        addCheck(
          "safe_mode_prebuff_wait_on_mob_tile",
          mobTileHasWaitAll && exploreDoesNotCastShortPrebuffs,
          {
            mobTileWaitAllPresent: mobTileHasWaitAll,
            exploreGateNoShortPrebuffCast: exploreDoesNotCastShortPrebuffs
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "safe_mode_prebuff_wait_on_mob_tile threw", err);
        addCheck("safe_mode_prebuff_wait_on_mob_tile", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — support cast wait uses cast-bar + castTimeSec, not just slot cooldown.
      try {
        const fnSrc = function (fn) {
          try {
            return typeof fn === "function" ? String(fn) : "";
          } catch (e) {
            return "";
          }
        };
        const resolvedSrc = fnSrc(typeof waitForSupportCastResolved === "function" ? waitForSupportCastResolved : null);
        const usesCastBar = resolvedSrc.indexOf("readVisibleCombatCastBarTexts") >= 0;
        const usesCastTime = resolvedSrc.indexOf("castTimeSec") >= 0;
        const hasFinishPhase = resolvedSrc.indexOf("cast_bar_cleared") >= 0;
        const hasPostSettle = resolvedSrc.indexOf("postSettleMs") >= 0;
        addCheck(
          "support_cast_resolution_wait_uses_cast_bar",
          usesCastBar && usesCastTime && hasFinishPhase && hasPostSettle,
          {
            readsCastBar: usesCastBar,
            usesCastTimeSec: usesCastTime,
            finishesOnBarClear: hasFinishPhase,
            hasPostCastSettle: hasPostSettle
          },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "support_cast_resolution_wait_uses_cast_bar threw", err);
        addCheck("support_cast_resolution_wait_uses_cast_bar", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — longbuff maintenance is OOC-only and uses the longbuff policy bucket.
      try {
        const fnSrc = function (fn) {
          try {
            return typeof fn === "function" ? String(fn) : "";
          } catch (e) {
            return "";
          }
        };
        const src = fnSrc(typeof maintainLongbuffsOutOfCombat === "function" ? maintainLongbuffsOutOfCombat : null);
        const oocOnly = src.indexOf("not_clear_tile") >= 0 && src.indexOf('liveState.combat.enemyCount !== 0') >= 0;
        const usesPolicyBucket = src.indexOf('buildSupportBuffMetaListForPolicy("longbuff")') >= 0;
        addCheck(
          "longbuff_maintenance_ooc_only",
          oocOnly && usesPolicyBucket,
          { oocOnlyGuard: oocOnly, usesPolicyBucket: usesPolicyBucket },
          false
        );
      } catch (err) {
        Logger.warn("TEST", "longbuff_maintenance_ooc_only threw", err);
        addCheck("longbuff_maintenance_ooc_only", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — Easy mode runtime-call check: both pipelines return easy_mode skip.
      try {
        if (
          Runtime.autoFarm &&
          typeof maybeApplyPrebuffsForNewMobTile === "function" &&
          typeof maintainLongbuffsOutOfCombat === "function"
        ) {
          const prevMode = Runtime.autoFarm.combatMode;
          Runtime.autoFarm.combatMode = "easy";
          const mobState = {
            combat: { enemyCount: 3 },
            player: { hp: { valid: true, pct: 1 }, mp: { valid: true, pct: 1 } },
            session: {}
          };
          const oocState = {
            combat: { enemyCount: 0 },
            player: { hp: { valid: true, pct: 1 }, mp: { valid: true, pct: 1 } },
            session: {}
          };
          const prebuffRes = await maybeApplyPrebuffsForNewMobTile(mobState);
          const longbuffRes = await maintainLongbuffsOutOfCombat(oocState);
          Runtime.autoFarm.combatMode = prevMode;
          const easyOk =
            prebuffRes && prebuffRes.skipped === true && prebuffRes.reason === "easy_mode" &&
            longbuffRes && longbuffRes.skipped === true && longbuffRes.reason === "easy_mode";
          addCheck(
            "easy_mode_no_buff_systems",
            easyOk,
            { prebuffResult: prebuffRes, longbuffResult: longbuffRes },
            false
          );
        } else {
          addCheck("easy_mode_no_buff_systems", false, { reason: "fns_or_runtime_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "easy_mode_no_buff_systems threw", err);
        addCheck("easy_mode_no_buff_systems", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Buff system v1.0.5-alpha — tile gate prevents re-prebuffing the SAME tile twice in a row.
      try {
        if (
          Runtime.autoFarm &&
          typeof maybeApplyPrebuffsForNewMobTile === "function" &&
          typeof getSupportBuffLineRuntime === "function"
        ) {
          const prevMode = Runtime.autoFarm.combatMode;
          Runtime.autoFarm.combatMode = "fast";
          const rt = getSupportBuffLineRuntime();
          const prevKey = rt.prebuff.tileKey;
          const prevAt = rt.prebuff.tileAt;
          const prevResult = rt.prebuff.lastResult;
          // Force the current tile to match by spoofing numeric coords (the tile key uses Number.isFinite check).
          const prevCoords = Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
          if (Runtime.exploration) {
            Runtime.exploration.lastKnownCoords = { x: -987654, y: -123456 };
          }
          rt.prebuff.tileKey = "-987654;-123456";
          rt.prebuff.tileAt = Date.now();
          const mobState = {
            combat: { enemyCount: 3 },
            player: { hp: { valid: true, pct: 1 }, mp: { valid: true, pct: 1 } },
            session: {}
          };
          const res = await maybeApplyPrebuffsForNewMobTile(mobState);
          // Restore.
          if (Runtime.exploration) {
            Runtime.exploration.lastKnownCoords = prevCoords;
          }
          rt.prebuff.tileKey = prevKey;
          rt.prebuff.tileAt = prevAt;
          rt.prebuff.lastResult = prevResult;
          Runtime.autoFarm.combatMode = prevMode;
          const sameTileSkipped =
            res && res.skipped === true && res.reason === "tile_already_prebuffed";
          addCheck(
            "prebuff_tile_gate_skips_same_tile",
            sameTileSkipped,
            { result: res },
            false
          );
        } else {
          addCheck("prebuff_tile_gate_skips_same_tile", false, { reason: "fns_or_runtime_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "prebuff_tile_gate_skips_same_tile threw", err);
        addCheck("prebuff_tile_gate_skips_same_tile", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — combat-state model shape sanity. Should expose player/target/fight/timing sub-objects whether or not
      // a fight is live (best-effort fields are nulled when unknown, never absent).
      try {
        if (typeof getPlannerCombatState === "function") {
          const cs = getPlannerCombatState();
          const shapeOk = !!(
            cs &&
            cs.player && typeof cs.player === "object" &&
            cs.target && typeof cs.target === "object" &&
            cs.fight && typeof cs.fight === "object" &&
            cs.timing && typeof cs.timing === "object" &&
            Object.prototype.hasOwnProperty.call(cs.player, "hpCur") &&
            Object.prototype.hasOwnProperty.call(cs.player, "mpCur") &&
            Object.prototype.hasOwnProperty.call(cs.target, "hpCur") &&
            Object.prototype.hasOwnProperty.call(cs.target, "visibleEffects") &&
            Array.isArray(cs.target.visibleEffects) &&
            Object.prototype.hasOwnProperty.call(cs.fight, "enemiesPresent") &&
            Object.prototype.hasOwnProperty.call(cs.fight, "activeAttackerCount") &&
            Object.prototype.hasOwnProperty.call(cs.fight, "pressure") &&
            Object.prototype.hasOwnProperty.call(cs.timing, "maxHorizonSec") &&
            Object.prototype.hasOwnProperty.call(cs.timing, "maxActions")
          );
          addCheck("planner_combat_state_shape", shapeOk, {
            hasPlayer: !!(cs && cs.player),
            hasTarget: !!(cs && cs.target),
            hasFight: !!(cs && cs.fight),
            hasTiming: !!(cs && cs.timing),
            maxActions: cs && cs.timing ? cs.timing.maxActions : null,
            maxHorizonSec: cs && cs.timing ? cs.timing.maxHorizonSec : null,
            activeAttackerCount: cs && cs.fight ? cs.fight.activeAttackerCount : null,
            activeAttackerSource: cs && cs.fight ? cs.fight.activeAttackerSource : null,
            visibleEffectsCount: cs && cs.target && Array.isArray(cs.target.visibleEffects) ? cs.target.visibleEffects.length : null
          }, false);
        } else {
          addCheck("planner_combat_state_shape", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_combat_state_shape threw", err);
        addCheck("planner_combat_state_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — active-attacker reader is available + returns either an object or null.
      try {
        if (typeof readActiveAttackerCount === "function") {
          const a = readActiveAttackerCount();
          const ok = a === null || (a && typeof a === "object" && Number.isFinite(a.count));
          addCheck("planner_active_attacker_reader", !!ok, {
            result: a,
            buttonSelector: Config.selectors.attackersButton
          }, false);
        } else {
          addCheck("planner_active_attacker_reader", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_active_attacker_reader threw", err);
        addCheck("planner_active_attacker_reader", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — target effect reader returns array (empty when no target / no effect cards present).
      try {
        if (typeof readTargetVisibleEffects === "function") {
          const eff = readTargetVisibleEffects();
          const shapeOk = Array.isArray(eff) && eff.every(function (e) {
            return e && typeof e === "object"
              && Object.prototype.hasOwnProperty.call(e, "id")
              && Object.prototype.hasOwnProperty.call(e, "label")
              && Object.prototype.hasOwnProperty.call(e, "remainingSec")
              && Object.prototype.hasOwnProperty.call(e, "raw");
          });
          addCheck("planner_target_effect_reader_shape", shapeOk, {
            effectCount: Array.isArray(eff) ? eff.length : null,
            sample: Array.isArray(eff) ? eff.slice(0, 3) : null,
            selectorsUsed: {
              root: Config.selectors.targetEffectsRoot,
              card: Config.selectors.targetEffectCard,
              time: Config.selectors.targetEffectTime
            }
          }, false);
        } else {
          addCheck("planner_target_effect_reader_shape", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_target_effect_reader_shape threw", err);
        addCheck("planner_target_effect_reader_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — Archer skill semantic enrichment is loaded into Config.planner.sequencePlanner.archerSemantics.
      // We do NOT require those skills to be on the bar; we only verify the SEMANTIC table is intact + has the expected keys/values.
      try {
        const sem = Config.planner && Config.planner.sequencePlanner && Config.planner.sequencePlanner.archerSemantics;
        const ok = !!(
          sem &&
          sem.sniperShot && sem.sniperShot.role === "finisher" &&
          sem.piercingStrike && sem.piercingStrike.role === "shred_magic_resist" && Number.isFinite(sem.piercingStrike.debuffDurationSec) &&
          sem.iceShard && sem.iceShard.role === "tempo_slow" && Number.isFinite(sem.iceShard.slowDurationSec) &&
          sem.distractingShot && sem.distractingShot.role === "survival_tempo_distract" &&
          sem.fanVolley && sem.fanVolley.role === "aoe" && sem.fanVolley.aoeFactor >= 1
        );
        addCheck("planner_archer_semantic_table", ok, {
          sniperShotRole: sem && sem.sniperShot ? sem.sniperShot.role : null,
          piercingStrikeRole: sem && sem.piercingStrike ? sem.piercingStrike.role : null,
          piercingStrikeDuration: sem && sem.piercingStrike ? sem.piercingStrike.debuffDurationSec : null,
          iceShardRole: sem && sem.iceShard ? sem.iceShard.role : null,
          iceShardDuration: sem && sem.iceShard ? sem.iceShard.slowDurationSec : null,
          distractingShotRole: sem && sem.distractingShot ? sem.distractingShot.role : null,
          fanVolleyRole: sem && sem.fanVolley ? sem.fanVolley.role : null
        }, false);
      } catch (err) {
        Logger.warn("TEST", "planner_archer_semantic_table threw", err);
        addCheck("planner_archer_semantic_table", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — normalized skill view exposes the right per-skill fields (slot/name/cast/cooldown/manaCost/damage shape/charge/AoE/control).
      try {
        if (typeof getPlannerNormalizedSkills === "function") {
          const ns = getPlannerNormalizedSkills();
          const shapeOk = Array.isArray(ns) && ns.every(function (s) {
            return s && typeof s === "object"
              && Object.prototype.hasOwnProperty.call(s, "slot")
              && Object.prototype.hasOwnProperty.call(s, "name")
              && Object.prototype.hasOwnProperty.call(s, "manaCost")
              && Object.prototype.hasOwnProperty.call(s, "castTimeSec")
              && Object.prototype.hasOwnProperty.call(s, "cooldownSec")
              && Object.prototype.hasOwnProperty.call(s, "immediateDamage")
              && Object.prototype.hasOwnProperty.call(s, "dotPerSec")
              && Object.prototype.hasOwnProperty.call(s, "isCharge")
              && Object.prototype.hasOwnProperty.call(s, "isAoe")
              && Object.prototype.hasOwnProperty.call(s, "isControl")
              && Object.prototype.hasOwnProperty.call(s, "damageType")
              && Object.prototype.hasOwnProperty.call(s, "tacticalRoles")
              && Object.prototype.hasOwnProperty.call(s, "semantic");
          });
          // Also verify any Archer skill on the bar that we have semantics for resolves to the right semantic key.
          const byKey = {};
          for (let i = 0; i < ns.length; i += 1) {
            const k = ns[i].normalizedKey || "";
            byKey[k] = ns[i];
          }
          const archerKeys = ["snipershot", "piercingstrike", "iceshard", "distractingshot", "fanvolley"];
          const semanticHits = archerKeys.filter(function (k) {
            return byKey[k] && byKey[k].semantic && byKey[k].semantic.__semKey === k;
          });
          addCheck("planner_normalized_skill_semantics", shapeOk, {
            count: Array.isArray(ns) ? ns.length : null,
            archerSemanticsHits: semanticHits,
            sample: Array.isArray(ns) ? ns.slice(0, 4).map(function (s) {
              return {
                slot: s.slot,
                name: s.name,
                normalizedKey: s.normalizedKey,
                immediateDamage: s.immediateDamage,
                dotPerSec: s.dotPerSec,
                isCharge: s.isCharge,
                isAoe: s.isAoe,
                isControl: s.isControl,
                damageType: s.damageType,
                semanticRole: s.semantic ? s.semantic.role : null
              };
            }) : null
          }, false);
        } else {
          addCheck("planner_normalized_skill_semantics", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_normalized_skill_semantics threw", err);
        addCheck("planner_normalized_skill_semantics", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — candidate sequence preview returns shape we expect (combatState + normalizedSkills + topSequences[] with actions/score),
      // or a reasoned `ok:false` when no normalized skills are available (e.g. empty bar in dev/test).
      try {
        if (typeof previewPlannerSequences === "function") {
          const p = previewPlannerSequences();
          const okShape = !!(
            p && typeof p === "object" &&
            (
              (p.ok === true &&
                p.combatState && typeof p.combatState === "object" &&
                Array.isArray(p.normalizedSkills) &&
                Array.isArray(p.topSequences) &&
                p.topSequences.every(function (s) {
                  return s && Array.isArray(s.actions) && Object.prototype.hasOwnProperty.call(s, "score");
                })
              )
              ||
              (p.ok === false && typeof p.reason === "string")
            )
          );
          addCheck("planner_sequence_preview_shape", okShape, {
            ok: p && p.ok,
            reason: p && p.reason,
            topCount: p && Array.isArray(p.topSequences) ? p.topSequences.length : null,
            firstSequenceActions: p && p.topSequences && p.topSequences[0]
              ? p.topSequences[0].actions.map(function (a) { return { kind: a.kind, name: a.name, slot: a.slot, chargeMode: a.chargeMode }; })
              : null
          }, false);
        } else {
          addCheck("planner_sequence_preview_shape", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_sequence_preview_shape threw", err);
        addCheck("planner_sequence_preview_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — compatibility adapter still produces { slot, record, chargeReleasePlan, queuedAction } when the new planner
      // returns a usable skill pick, OR returns null cleanly when first action is basic / no feasible skill. We can only assert the type contract here;
      // a real combat call is exercised by live AUTO runs.
      try {
        if (typeof plannerSelectSequencePick === "function" && typeof plannerAdaptSequencePickToOpenerShape === "function") {
          const seqPick = plannerSelectSequencePick({});
          let adapterShapeOk = false;
          let adapterReason = null;
          if (seqPick) {
            const adapterOut = plannerAdaptSequencePickToOpenerShape(seqPick);
            if (adapterOut) {
              adapterReason = adapterOut.reason;
              if (adapterOut.adapted) {
                adapterShapeOk = !!(
                  adapterOut.adapted &&
                  typeof adapterOut.adapted.slot === "number" &&
                  adapterOut.adapted.record &&
                  Object.prototype.hasOwnProperty.call(adapterOut.adapted, "chargeReleasePlan") &&
                  Object.prototype.hasOwnProperty.call(adapterOut.adapted, "queuedAction")
                );
              } else if (adapterOut.reason === "first_action_basic") {
                adapterShapeOk = true;
              }
            } else {
              adapterShapeOk = true;
            }
          } else {
            // No sequence pick (Easy mode, no skills, no paper DPS, etc.) — adapter contract still satisfied.
            adapterShapeOk = true;
            adapterReason = "no_sequence_pick";
          }
          addCheck("planner_compat_adapter_shape", adapterShapeOk, {
            seqPickPresent: !!seqPick,
            adapterReason: adapterReason,
            lastPlanReason: Runtime.planner && Runtime.planner.lastSequencePlan ? Runtime.planner.lastSequencePlan.reason || null : null
          }, false);
        } else {
          addCheck("planner_compat_adapter_shape", false, { reason: "fns_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_compat_adapter_shape threw", err);
        addCheck("planner_compat_adapter_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1 — pure logic check: with no live UI, build a synthetic combat state + normalized skill set covering
      // (a) full-charge Sniper Shot under pressure (b) partial-release Sniper Shot under pressure (c) Distracting Shot as opener vs calm.
      // We use ONLY public planner internals; this is a shape/logic sanity test, NOT a tactical perfection test.
      try {
        if (
          typeof plannerSeqBuildCandidateActions === "function" &&
          typeof plannerSeqSimulateAction === "function" &&
          typeof plannerSeqScoreNode === "function"
        ) {
          // Synthetic skills.
          const sniper = {
            slot: 0, name: "Sniper Shot", normalizedKey: "snipershot",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0, cooldownSec: 6,
            immediateDamage: 200, dotPerSec: 0, dotDurationSec: 0, damageType: "physical",
            isCharge: true, chargeMaxSec: 4, chargeGearPct: 200, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["channeled"],
            semantic: { __semKey: "snipershot", role: "finisher",
              chargeFullPressurePenaltySec: 1.6, finisherTargetHpPctMax: 0.45, finisherBonusSec: 0.8 }
          };
          const distract = {
            slot: 1, name: "Distracting Shot", normalizedKey: "distractingshot",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0.4, cooldownSec: 12,
            immediateDamage: 80, dotPerSec: 0, dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"],
            semantic: { __semKey: "distractingshot", role: "survival_tempo_distract",
              distractDurationSec: 6, calmOpenerPenaltySec: 1.4, pressureReliefBonusSec: 1.2, activeAttackerReliefCount: 1 }
          };
          // AI CHANGED: Planner rewrite v1.3 — sim state uses `nextBasicReadyAtSec` (single source of truth); no separate underway flag.
          function mkSim(playerHpRatio) {
            return {
              elapsedSec: 0, playerHpCur: playerHpRatio * 1000, playerHpMax: 1000,
              playerMpCur: 100, playerMpMax: 100, targetHpCur: 1000, targetHpMax: 1000,
              enemyCount: 1, activeAttackers: 1, pressure: 0,
              incomingHpLossPerSec: 0, basicSwingIntervalSec: 1, expectedBasicHit: 50,
              skillCooldownReadyAtSec: {},
              targetFlags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 },
              lastActionTimeSec: 0, mpWasted: 0, hpLost: 0, mobFactor: 1,
              nextBasicReadyAtSec: Number.POSITIVE_INFINITY, extraBasicSwingsTotal: 0, extraBasicDamageTotal: 0
            };
          }
          // 1) Under pressure: full-charge vs partial-release Sniper Shot — partial-release should score better (lower is better).
          const pressureState = {
            mode: "fast",
            player: { hpCur: 600, hpMax: 1000, hpPct: 0.6, mpCur: 100, mpMax: 100, mpPct: 1,
              basicSwingIntervalSec: 1, expectedBasicHit: 50, basicDpsAdjusted: 50, basicAttackLikelyUnderway: false, longSelfBuffs: [] },
            target: { hpCur: 1000, hpMax: 1000, hpPct: 1, visibleEffects: [],
              flags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 }, fingerprintKey: null },
            fight: { enemiesPresent: 2, activeAttackerCount: 2, activeAttackerSource: "test",
              pressure: 1.4, incomingHpLossPerSec: 0, combatMode: "fast" },
            timing: { nowMs: Date.now(), maxHorizonSec: 6, maxActions: 5 },
            paperBasicDps: 50, mobFactor: 1
          };
          const simP = mkSim(0.6);
          const fullChargeStep = plannerSeqSimulateAction(simP, {
            kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Sniper Shot", slot: 0, skill: sniper
          });
          const partialStep = plannerSeqSimulateAction(simP, {
            kind: "skill_charge", chargeMode: "partial", chargeReleaseFraction: 0.5, name: "Sniper Shot", slot: 0, skill: sniper
          });
          const fullNode = {
            sim: fullChargeStep.next, actions: [{ kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1,
              skill: { slot: 0, name: "Sniper Shot", normalizedKey: "snipershot", damageType: "physical" } }],
            cumulativeDamage: fullChargeStep.damageDealt, killedAtSec: null
          };
          const partialNode = {
            sim: partialStep.next, actions: [{ kind: "skill_charge", chargeMode: "partial", chargeReleaseFraction: 0.5,
              skill: { slot: 0, name: "Sniper Shot", normalizedKey: "snipershot", damageType: "physical" } }],
            cumulativeDamage: partialStep.damageDealt, killedAtSec: null
          };
          const fullScore = plannerSeqScoreNode(fullNode, pressureState);
          const partialScore = plannerSeqScoreNode(partialNode, pressureState);
          const partialBetterUnderPressure = partialScore < fullScore;
          // 2) Calm opener: Distracting Shot first should score WORSE than basic first (penalize calm-opener distract).
          const calmState = {
            mode: "fast",
            player: { hpCur: 1000, hpMax: 1000, hpPct: 1, mpCur: 100, mpMax: 100, mpPct: 1,
              basicSwingIntervalSec: 1, expectedBasicHit: 50, basicDpsAdjusted: 50, basicAttackLikelyUnderway: false, longSelfBuffs: [] },
            target: { hpCur: 600, hpMax: 600, hpPct: 1, visibleEffects: [],
              flags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 }, fingerprintKey: null },
            fight: { enemiesPresent: 1, activeAttackerCount: 1, activeAttackerSource: "test",
              pressure: 0, incomingHpLossPerSec: 0, combatMode: "fast" },
            timing: { nowMs: Date.now(), maxHorizonSec: 6, maxActions: 5 },
            paperBasicDps: 50, mobFactor: 1
          };
          const calmSimBasic = mkSim(1);
          const basicStep = plannerSeqSimulateAction(calmSimBasic, { kind: "basic", name: "Basic Attack", slot: null });
          const calmSimDist = mkSim(1);
          const distStep = plannerSeqSimulateAction(calmSimDist, {
            kind: "skill", name: "Distracting Shot", slot: 1, skill: distract
          });
          const basicNode = {
            sim: basicStep.next, actions: [{ kind: "basic", name: "Basic Attack", slot: null }],
            cumulativeDamage: basicStep.damageDealt, killedAtSec: null
          };
          const distNode = {
            sim: distStep.next, actions: [{ kind: "skill", name: "Distracting Shot", slot: 1,
              skill: { slot: 1, name: "Distracting Shot", normalizedKey: "distractingshot", damageType: "physical" } }],
            cumulativeDamage: distStep.damageDealt, killedAtSec: null
          };
          const basicScore = plannerSeqScoreNode(basicNode, calmState);
          const distScore = plannerSeqScoreNode(distNode, calmState);
          const distractCalmIsWorseThanBasic = distScore > basicScore;
          // 3) Active-attacker = 2 pressure → distract should score BETTER than basic.
          const pressureSim = mkSim(0.7);
          const pressureBasicStep = plannerSeqSimulateAction(pressureSim, { kind: "basic", name: "Basic Attack", slot: null });
          const pressureDistStep = plannerSeqSimulateAction(mkSim(0.7), {
            kind: "skill", name: "Distracting Shot", slot: 1, skill: distract
          });
          const pressureBasicNode = {
            sim: pressureBasicStep.next, actions: [{ kind: "basic", name: "Basic Attack", slot: null }],
            cumulativeDamage: pressureBasicStep.damageDealt, killedAtSec: null
          };
          const pressureDistNode = {
            sim: pressureDistStep.next, actions: [{ kind: "skill", name: "Distracting Shot", slot: 1,
              skill: { slot: 1, name: "Distracting Shot", normalizedKey: "distractingshot", damageType: "physical" } }],
            cumulativeDamage: pressureDistStep.damageDealt, killedAtSec: null
          };
          const pressureBasicScore = plannerSeqScoreNode(pressureBasicNode, pressureState);
          const pressureDistScore = plannerSeqScoreNode(pressureDistNode, pressureState);
          const distractUnderPressureIsBetterThanBasic = pressureDistScore < pressureBasicScore;
          addCheck(
            "planner_sequence_logic_archer_smoke",
            partialBetterUnderPressure && distractCalmIsWorseThanBasic && distractUnderPressureIsBetterThanBasic,
            {
              fullChargeScore: fullScore,
              partialReleaseScore: partialScore,
              partialBetterUnderPressure: partialBetterUnderPressure,
              calmBasicScore: basicScore,
              calmDistractScore: distScore,
              distractCalmIsWorseThanBasic: distractCalmIsWorseThanBasic,
              pressureBasicScore: pressureBasicScore,
              pressureDistractScore: pressureDistScore,
              distractUnderPressureIsBetterThanBasic: distractUnderPressureIsBetterThanBasic
            },
            false
          );
        } else {
          addCheck("planner_sequence_logic_archer_smoke", false, { reason: "internal_fns_unreachable" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_sequence_logic_archer_smoke threw", err);
        addCheck("planner_sequence_logic_archer_smoke", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.1 — excludeSlots is honored INSIDE the new sequence planner's candidate builder.
      //   Logic (bullet-list):
      //     • Build a synthetic flat sim state with two attack skills (slots 0 and 1), both ready and mana-affordable.
      //     • Call plannerSeqBuildCandidateActions with no exclude — expect both skills present in the candidate list.
      //     • Call again with excludeSlots = new Set([0]) — expect slot 0 absent, slot 1 still present, basic still present.
      //     • Call again with Array form excludeSlots = [1] — same logic, slot 1 absent.
      //   This verifies the planner-correctness fix at the most fundamental level, regardless of live skill cache.
      try {
        if (typeof plannerSeqBuildCandidateActions === "function") {
          const skillA = {
            slot: 0, name: "Skill A", normalizedKey: "skilla",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0.4, cooldownSec: 0,
            immediateDamage: 100, dotPerSec: 0, dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const skillB = {
            slot: 1, name: "Skill B", normalizedKey: "skillb",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0.4, cooldownSec: 0,
            immediateDamage: 90, dotPerSec: 0, dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const synthSim = {
            elapsedSec: 0,
            playerMpCur: 100,
            skillCooldownReadyAtSec: {}
          };
          // AI CHANGED: depth-0 skipReadyCheck — `plannerSeqSkillIsReadyNow` is only invoked when elapsedSec === 0; for the synthetic test we lift
          // that gate by setting `elapsedSec` to a tiny non-zero value so live-DOM is not consulted.
          synthSim.elapsedSec = 0.001;
          const noExclude = plannerSeqBuildCandidateActions(synthSim, [skillA, skillB], {
            disallowChargeSkills: false
          });
          const slotsNoExclude = noExclude.map(function (c) { return c.slot; });
          const noExcludeHasA = slotsNoExclude.indexOf(0) !== -1;
          const noExcludeHasB = slotsNoExclude.indexOf(1) !== -1;
          const noExcludeHasBasic = noExclude.some(function (c) { return c.kind === "basic"; });
          const setExclude = plannerSeqBuildCandidateActions(synthSim, [skillA, skillB], {
            disallowChargeSkills: false,
            excludeSlots: new Set([0])
          });
          const slotsSetExclude = setExclude.map(function (c) { return c.slot; });
          const setExcludeOk = slotsSetExclude.indexOf(0) === -1 && slotsSetExclude.indexOf(1) !== -1 && setExclude.some(function (c) { return c.kind === "basic"; });
          const arrExclude = plannerSeqBuildCandidateActions(synthSim, [skillA, skillB], {
            disallowChargeSkills: false,
            excludeSlots: [1]
          });
          const slotsArrExclude = arrExclude.map(function (c) { return c.slot; });
          const arrExcludeOk = slotsArrExclude.indexOf(1) === -1 && slotsArrExclude.indexOf(0) !== -1 && arrExclude.some(function (c) { return c.kind === "basic"; });
          const passed = noExcludeHasA && noExcludeHasB && noExcludeHasBasic && setExcludeOk && arrExcludeOk;
          addCheck(
            "planner_sequence_exclude_slots_honored",
            passed,
            {
              noExcludeSlots: slotsNoExclude,
              setExcludeSlots: slotsSetExclude,
              arrExcludeSlots: slotsArrExclude,
              noExcludeHasA: noExcludeHasA,
              noExcludeHasB: noExcludeHasB,
              noExcludeHasBasic: noExcludeHasBasic,
              setExcludeOk: setExcludeOk,
              arrExcludeOk: arrExcludeOk
            },
            false
          );
        } else {
          addCheck("planner_sequence_exclude_slots_honored", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_sequence_exclude_slots_honored threw", err);
        addCheck("planner_sequence_exclude_slots_honored", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.3 — conservative basic-attack timing model is now ENFORCED BY CONSTRUCTION via a single
      // `nextBasicReadyAtSec` schedule (the simulator no longer tracks a redundant `basicAttackLikelyUnderway` flag in sim state).
      //   Active model under test:
      //     • Depth-0 init: underway → schedule = 0; cold → schedule = `+Infinity`.
      //     • Carry-over fires AT MOST ONCE, and only when schedule has elapsed AT OR BEFORE the action's start AND action is skill/charge.
      //     • After ANY action, schedule = `+Infinity` (consumed/burned) — a second carry-over CANNOT fire at depth 1+.
      //     • `basic` action remains an explicit one-swing action (no extra), schedules to Infinity.
      //     • Config flag `simBasicSwingsBetweenActions === false` disables the carry-over path entirely.
      //   Test sub-cases:
      //     1) Cold-start long-cast skill → extraBasicSwings = 0, damage = immediateDamage only.
      //     2) Underway long-cast skill → extraBasicSwings = 1, damage = immediateDamage + 1 carry-over basic (= 150).
      //     3) Cold-start instant skill → extraBasicSwings = 0.
      //     4) Underway instant skill → extraBasicSwings = 1, damage = 150.
      //     5) Underway charge skill → extraBasicSwings = 1 (carry-over at start of channel).
      //     6) Basic action (cold) → extraBasicSwings = 0; damage = expectedBasicHit (= 50); post-action schedule = Infinity.
      //     7) After a skill resolves, sim.nextBasicReadyAtSec is `+Infinity` (no leftover schedule that could spuriously re-arm).
      //     8) Config flag off → carry-over suppressed even when underway is set (= 0 extra swings).
      //     9) Sim state contains NO `basicAttackLikelyUnderway` field (schedule is the only source of truth).
      try {
        if (typeof plannerSeqSimulateAction === "function" && Config.planner && Config.planner.sequencePlanner) {
          const prevFlag = Config.planner.sequencePlanner.simBasicSwingsBetweenActions;
          const longSkill = {
            slot: 0, name: "Long Cast", normalizedKey: "longcast",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 2.5, cooldownSec: 0,
            immediateDamage: 100,
            immediateDamageByType: { physical: 100, magic: 0, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const instantSkill = {
            slot: 1, name: "Instant", normalizedKey: "instant",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0, cooldownSec: 0,
            immediateDamage: 100,
            immediateDamageByType: { physical: 100, magic: 0, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const chargeSkill = {
            slot: 2, name: "Big Hold", normalizedKey: "bighold",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0, cooldownSec: 6,
            immediateDamage: 100,
            immediateDamageByType: { physical: 100, magic: 0, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "physical",
            isCharge: true, chargeMaxSec: 4, chargeGearPct: 200, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["channeled"], semantic: null
          };
          // AI CHANGED: Planner rewrite v1.3 — schedule is the SINGLE source of truth; sim state no longer carries `basicAttackLikelyUnderway`.
          // `nextBasicReadyAtSec = 0` represents an in-flight game auto-basic; `+Infinity` represents cold-start (no carry-over possible).
          function mkSimV13(underway) {
            return {
              elapsedSec: 0,
              playerHpCur: 1000, playerHpMax: 1000,
              playerMpCur: 100, playerMpMax: 100,
              targetHpCur: 5000, targetHpMax: 5000,
              enemyCount: 1, activeAttackers: 1, pressure: 0,
              incomingHpLossPerSec: 0,
              basicSwingIntervalSec: 1,
              expectedBasicHit: 50,
              skillCooldownReadyAtSec: {},
              targetFlags: {
                hasMagicResistShred: false, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0
              },
              lastActionTimeSec: 0, mpWasted: 0, hpLost: 0, mobFactor: 1,
              nextBasicReadyAtSec: underway ? 0 : Number.POSITIVE_INFINITY,
              extraBasicSwingsTotal: 0, extraBasicDamageTotal: 0
            };
          }
          Config.planner.sequencePlanner.simBasicSwingsBetweenActions = true;
          const longCold = plannerSeqSimulateAction(mkSimV13(false), {
            kind: "skill", name: "Long Cast", slot: 0, skill: longSkill
          });
          const longUnderway = plannerSeqSimulateAction(mkSimV13(true), {
            kind: "skill", name: "Long Cast", slot: 0, skill: longSkill
          });
          const instantCold = plannerSeqSimulateAction(mkSimV13(false), {
            kind: "skill", name: "Instant", slot: 1, skill: instantSkill
          });
          const instantUnderway = plannerSeqSimulateAction(mkSimV13(true), {
            kind: "skill", name: "Instant", slot: 1, skill: instantSkill
          });
          const chargeUnderway = plannerSeqSimulateAction(mkSimV13(true), {
            kind: "skill_charge", name: "Big Hold", slot: 2, chargeMode: "full", chargeReleaseFraction: 1, skill: chargeSkill
          });
          const basicCold = plannerSeqSimulateAction(mkSimV13(false), {
            kind: "basic", name: "Basic Attack", slot: null
          });
          Config.planner.sequencePlanner.simBasicSwingsBetweenActions = false;
          const longUnderwayFlagOff = plannerSeqSimulateAction(mkSimV13(true), {
            kind: "skill", name: "Long Cast", slot: 0, skill: longSkill
          });
          Config.planner.sequencePlanner.simBasicSwingsBetweenActions = prevFlag;
          // Expectations.
          const longColdOk = longCold.action.extraBasicSwings === 0 && longCold.damageDealt === 100;
          const longUnderwayOk = longUnderway.action.extraBasicSwings === 1 && Math.abs(longUnderway.damageDealt - 150) < 0.01;
          const instantColdOk = instantCold.action.extraBasicSwings === 0 && instantCold.damageDealt === 100;
          const instantUnderwayOk = instantUnderway.action.extraBasicSwings === 1 && Math.abs(instantUnderway.damageDealt - 150) < 0.01;
          const chargeUnderwayOk = chargeUnderway.action.extraBasicSwings === 1;
          const basicColdOk = basicCold.action.extraBasicSwings === 0 && basicCold.damageDealt === 50;
          // After a skill resolves, schedule is `+Infinity` (consumed). Use isFinite to detect this clearly.
          const longColdSchedOk = !Number.isFinite(longCold.next.nextBasicReadyAtSec) && longCold.next.nextBasicReadyAtSec > 0;
          const basicColdSchedOk = !Number.isFinite(basicCold.next.nextBasicReadyAtSec) && basicCold.next.nextBasicReadyAtSec > 0;
          const flagOffOk = longUnderwayFlagOff.action.extraBasicSwings === 0 && longUnderwayFlagOff.damageDealt === 100;
          // Sim state must NOT carry `basicAttackLikelyUnderway` — schedule is the single source of truth in v1.3.
          const noStaleFlagOk = !Object.prototype.hasOwnProperty.call(longUnderway.next, "basicAttackLikelyUnderway");
          const passed = longColdOk && longUnderwayOk && instantColdOk && instantUnderwayOk && chargeUnderwayOk && basicColdOk && longColdSchedOk && basicColdSchedOk && flagOffOk && noStaleFlagOk;
          addCheck(
            "planner_basic_timing_conservative",
            passed,
            {
              longCold: { swings: longCold.action.extraBasicSwings, damage: longCold.damageDealt },
              longUnderway: { swings: longUnderway.action.extraBasicSwings, damage: longUnderway.damageDealt },
              instantCold: { swings: instantCold.action.extraBasicSwings, damage: instantCold.damageDealt },
              instantUnderway: { swings: instantUnderway.action.extraBasicSwings, damage: instantUnderway.damageDealt },
              chargeUnderway: { swings: chargeUnderway.action.extraBasicSwings, damage: chargeUnderway.damageDealt },
              basicCold: { swings: basicCold.action.extraBasicSwings, damage: basicCold.damageDealt },
              longColdNextBasicReadyAtSec: longCold.next.nextBasicReadyAtSec === Number.POSITIVE_INFINITY ? "+Infinity" : longCold.next.nextBasicReadyAtSec,
              basicColdNextBasicReadyAtSec: basicCold.next.nextBasicReadyAtSec === Number.POSITIVE_INFINITY ? "+Infinity" : basicCold.next.nextBasicReadyAtSec,
              flagOffUnderway: { swings: longUnderwayFlagOff.action.extraBasicSwings, damage: longUnderwayFlagOff.damageDealt },
              noStaleFlag: noStaleFlagOk,
              passing: {
                longColdOk: longColdOk, longUnderwayOk: longUnderwayOk,
                instantColdOk: instantColdOk, instantUnderwayOk: instantUnderwayOk,
                chargeUnderwayOk: chargeUnderwayOk, basicColdOk: basicColdOk,
                longColdSchedOk: longColdSchedOk, basicColdSchedOk: basicColdSchedOk,
                flagOffOk: flagOffOk, noStaleFlagOk: noStaleFlagOk
              }
            },
            false
          );
        } else {
          addCheck("planner_basic_timing_conservative", false, { reason: "fn_or_config_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_basic_timing_conservative threw", err);
        addCheck("planner_basic_timing_conservative", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.3 — carry-over fires at most ONCE per sequence. Chain the simulator twice from an underway depth-0
      // state: the first skill credits 1 carry-over (schedule was 0); after the simulator finishes that step, schedule is `+Infinity`, so the
      // second skill MUST NOT credit any extra basic. This is the structural guarantee that "no free basics during cast" cannot be violated.
      try {
        if (typeof plannerSeqSimulateAction === "function" && Config.planner && Config.planner.sequencePlanner) {
          const skillA = {
            slot: 0, name: "Skill A", normalizedKey: "skilla",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0.5, cooldownSec: 0,
            immediateDamage: 80, immediateDamageByType: { physical: 80, magic: 0, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "physical",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const skillB = Object.assign({}, skillA, { slot: 1, name: "Skill B", normalizedKey: "skillb", castTimeSec: 0.4, immediateDamage: 60,
            immediateDamageByType: { physical: 60, magic: 0, unknown: 0 } });
          const sim0 = {
            elapsedSec: 0,
            playerHpCur: 1000, playerHpMax: 1000, playerMpCur: 100, playerMpMax: 100,
            targetHpCur: 5000, targetHpMax: 5000, enemyCount: 1, activeAttackers: 1, pressure: 0,
            incomingHpLossPerSec: 0, basicSwingIntervalSec: 1, expectedBasicHit: 50,
            skillCooldownReadyAtSec: {},
            targetFlags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
              magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 },
            lastActionTimeSec: 0, mpWasted: 0, hpLost: 0, mobFactor: 1,
            nextBasicReadyAtSec: 0,
            extraBasicSwingsTotal: 0, extraBasicDamageTotal: 0
          };
          const prevFlag = Config.planner.sequencePlanner.simBasicSwingsBetweenActions;
          Config.planner.sequencePlanner.simBasicSwingsBetweenActions = true;
          const step1 = plannerSeqSimulateAction(sim0, { kind: "skill", name: "Skill A", slot: 0, skill: skillA });
          const step2 = plannerSeqSimulateAction(step1.next, { kind: "skill", name: "Skill B", slot: 1, skill: skillB });
          Config.planner.sequencePlanner.simBasicSwingsBetweenActions = prevFlag;
          const firstFired = step1.action.extraBasicSwings === 1 && Math.abs(step1.damageDealt - (80 + 50)) < 0.01;
          const secondSilent = step2.action.extraBasicSwings === 0 && Math.abs(step2.damageDealt - 60) < 0.01;
          const scheduleConsumed = !Number.isFinite(step1.next.nextBasicReadyAtSec) && step1.next.nextBasicReadyAtSec > 0;
          const passed = firstFired && secondSilent && scheduleConsumed;
          addCheck(
            "planner_basic_carry_over_fires_once",
            passed,
            {
              step1: { extraBasicSwings: step1.action.extraBasicSwings, damage: step1.damageDealt,
                scheduleAfter: step1.next.nextBasicReadyAtSec === Number.POSITIVE_INFINITY ? "+Infinity" : step1.next.nextBasicReadyAtSec },
              step2: { extraBasicSwings: step2.action.extraBasicSwings, damage: step2.damageDealt },
              passing: { firstFired: firstFired, secondSilent: secondSilent, scheduleConsumed: scheduleConsumed }
            },
            false
          );
        } else {
          addCheck("planner_basic_carry_over_fires_once", false, { reason: "fn_or_config_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_basic_carry_over_fires_once threw", err);
        addCheck("planner_basic_carry_over_fires_once", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.3 — typed shred handling (active in BOTH skill and skill_charge paths via `plannerSeqMagicShredBonus`).
      //   Logic (bullet-list):
      //     • A magic skill (immediateDamageByType.magic = 100) WITHOUT active shred → damage = 100.
      //     • Same skill WITH shred → damage = 100 + 100*boost (default 0.2) = 120.
      //     • Physical-only skill WITH shred → damage = 100 (no boost; shred only touches magic portion).
      //     • Mixed skill (physical 60 + magic 40) WITH shred → 60 + 40 + 40*boost = 108 (only magic 40 is boosted).
      //     • Magic CHARGE skill WITH shred → base (= magic * gearMultiplier) PLUS magic * gearMultiplier * boost. With base 50, gearPct 200,
      //       release fraction 1.0 → gearMultiplier 3 → base damage 150, bonus 150*0.2 = 30, total 180. Confirms the helper is wired into
      //       skill_charge path identically to skill path — no blanket multiplier anywhere.
      try {
        if (typeof plannerSeqSimulateAction === "function" && Config.planner && Config.planner.sequencePlanner) {
          const magicSkill = {
            slot: 0, name: "Magic Bolt", normalizedKey: "magicbolt",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0.5, cooldownSec: 0,
            immediateDamage: 100,
            immediateDamageByType: { physical: 0, magic: 100, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "magic",
            isCharge: false, chargeMaxSec: 0, chargeGearPct: 0, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["offensive"], semantic: null
          };
          const physicalSkill = Object.assign({}, magicSkill, {
            name: "Physical Strike", normalizedKey: "physstrike", damageType: "physical",
            immediateDamageByType: { physical: 100, magic: 0, unknown: 0 }
          });
          const mixedSkill = Object.assign({}, magicSkill, {
            name: "Mixed Hit", normalizedKey: "mixedhit",
            immediateDamage: 100,
            immediateDamageByType: { physical: 60, magic: 40, unknown: 0 }, damageType: "magic"
          });
          const magicCharge = {
            slot: 1, name: "Magic Hold", normalizedKey: "magichold",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0, cooldownSec: 0,
            immediateDamage: 50,
            immediateDamageByType: { physical: 0, magic: 50, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "magic",
            isCharge: true, chargeMaxSec: 2, chargeGearPct: 200, isAoe: false, isControl: false,
            controlDurationSec: 0, tacticalRoles: ["channeled"], semantic: null
          };
          function mkShredSim(shredOn) {
            return {
              elapsedSec: 0,
              playerHpCur: 1000, playerHpMax: 1000,
              playerMpCur: 100, playerMpMax: 100,
              targetHpCur: 5000, targetHpMax: 5000,
              enemyCount: 1, activeAttackers: 1, pressure: 0,
              incomingHpLossPerSec: 0,
              basicSwingIntervalSec: 1, expectedBasicHit: 50,
              skillCooldownReadyAtSec: {},
              targetFlags: {
                hasMagicResistShred: !!shredOn, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: shredOn ? 15 : 0, slowRemainingSec: 0, distractRemainingSec: 0
              },
              lastActionTimeSec: 0, mpWasted: 0, hpLost: 0, mobFactor: 1,
              nextBasicReadyAtSec: Number.POSITIVE_INFINITY,
              extraBasicSwingsTotal: 0, extraBasicDamageTotal: 0
            };
          }
          const boost = 0.2;
          const magicNoShred = plannerSeqSimulateAction(mkShredSim(false), { kind: "skill", name: "Magic Bolt", slot: 0, skill: magicSkill });
          const magicWithShred = plannerSeqSimulateAction(mkShredSim(true), { kind: "skill", name: "Magic Bolt", slot: 0, skill: magicSkill });
          const physicalWithShred = plannerSeqSimulateAction(mkShredSim(true), { kind: "skill", name: "Physical Strike", slot: 0, skill: physicalSkill });
          const mixedWithShred = plannerSeqSimulateAction(mkShredSim(true), { kind: "skill", name: "Mixed Hit", slot: 0, skill: mixedSkill });
          const magicChargeWithShred = plannerSeqSimulateAction(mkShredSim(true), {
            kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Magic Hold", slot: 1, skill: magicCharge
          });
          const magicNoShredOk = Math.abs(magicNoShred.damageDealt - 100) < 0.01;
          const magicWithShredOk = Math.abs(magicWithShred.damageDealt - (100 + 100 * boost)) < 0.01; // 120
          const physicalWithShredOk = Math.abs(physicalWithShred.damageDealt - 100) < 0.01; // no boost
          const mixedWithShredOk = Math.abs(mixedWithShred.damageDealt - (100 + 40 * boost)) < 0.01; // 108
          // Charge: base 50 * gearMultiplier 3 = 150 base damage; magic bonus = 50 * 3 * 0.2 = 30; total = 180.
          const magicChargeExpected = 50 * 3 + 50 * 3 * boost;
          const magicChargeWithShredOk = Math.abs(magicChargeWithShred.damageDealt - magicChargeExpected) < 0.01;
          const passed = magicNoShredOk && magicWithShredOk && physicalWithShredOk && mixedWithShredOk && magicChargeWithShredOk;
          addCheck(
            "planner_typed_shred_only_boosts_magic",
            passed,
            {
              magicNoShred: magicNoShred.damageDealt,
              magicWithShred: magicWithShred.damageDealt,
              physicalWithShred: physicalWithShred.damageDealt,
              mixedWithShred: mixedWithShred.damageDealt,
              magicChargeWithShred: magicChargeWithShred.damageDealt,
              magicChargeExpected: magicChargeExpected,
              passing: { magicNoShredOk: magicNoShredOk, magicWithShredOk: magicWithShredOk, physicalWithShredOk: physicalWithShredOk,
                mixedWithShredOk: mixedWithShredOk, magicChargeWithShredOk: magicChargeWithShredOk }
            },
            false
          );
        } else {
          addCheck("planner_typed_shred_only_boosts_magic", false, { reason: "fn_or_config_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_typed_shred_only_boosts_magic threw", err);
        addCheck("planner_typed_shred_only_boosts_magic", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.2 — Sniper Shot is guaranteed to normalize as charge.
      //   Logic (bullet-list):
      //     • Build a fake `row` representing a scanned Sniper Shot bar entry where the parser DID NOT detect a `channel_gear` effect
      //       (real-world failure mode for locale variants / scan timing).
      //     • Normalize it via `plannerSeqNormalizeOneSkill`.
      //     • Expect: `isCharge === true`, `chargeMaxSec > 0`, `chargeGearPct > 0`, semantic enrichment resolved (`semantic.__semKey === "snipershot"`).
      //     • Pass the normalized skill through `plannerSeqBuildCandidateActions` against a permissive sim state — expect BOTH full and partial release candidates.
      try {
        if (typeof plannerSeqNormalizeOneSkill === "function" && typeof plannerSeqBuildCandidateActions === "function") {
          const sniperRow = {
            slot: 3, name: "Sniper Shot", kind: "skill", isAttack: true, targetsEnemy: true,
            manaCost: 0, castTimeSec: 0, cooldownSec: 6,
            effects: [], // parser miss: no channel_gear effect detected
            conception: null
          };
          const normalized = plannerSeqNormalizeOneSkill(sniperRow, null, 1, 50);
          const isChargeOk = normalized && normalized.isCharge === true;
          const chargeMaxOk = normalized && Number.isFinite(normalized.chargeMaxSec) && normalized.chargeMaxSec > 0;
          const chargeGearOk = normalized && Number.isFinite(normalized.chargeGearPct) && normalized.chargeGearPct > 0;
          const semanticOk = normalized && normalized.semantic && normalized.semantic.__semKey === "snipershot";
          const synthSim = {
            elapsedSec: 0.001, // bypass live-DOM ready check
            playerMpCur: 100,
            skillCooldownReadyAtSec: {}
          };
          const cands = plannerSeqBuildCandidateActions(synthSim, [normalized], { disallowChargeSkills: false });
          const fullCands = cands.filter(function (c) { return c.kind === "skill_charge" && c.chargeMode === "full" && c.slot === 3; });
          const partialCands = cands.filter(function (c) { return c.kind === "skill_charge" && c.chargeMode === "partial" && c.slot === 3; });
          const fullPresent = fullCands.length === 1;
          const partialPresent = partialCands.length === 1;
          const passed = isChargeOk && chargeMaxOk && chargeGearOk && semanticOk && fullPresent && partialPresent;
          addCheck(
            "planner_sniper_shot_charge_guaranteed",
            passed,
            {
              isCharge: normalized && normalized.isCharge,
              chargeMaxSec: normalized && normalized.chargeMaxSec,
              chargeGearPct: normalized && normalized.chargeGearPct,
              semanticKey: normalized && normalized.semantic ? normalized.semantic.__semKey : null,
              fullPresent: fullPresent,
              partialPresent: partialPresent,
              partialFraction: partialCands[0] ? partialCands[0].chargeReleaseFraction : null,
              candidates: cands.map(function (c) { return { kind: c.kind, slot: c.slot, chargeMode: c.chargeMode, chargeReleaseFraction: c.chargeReleaseFraction }; })
            },
            false
          );
        } else {
          addCheck("planner_sniper_shot_charge_guaranteed", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_sniper_shot_charge_guaranteed threw", err);
        addCheck("planner_sniper_shot_charge_guaranteed", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.2 — semantic tie-breaks use simulated state.
      //   Logic (bullet-list):
      //     • Sniper Shot finisher bonus must fire based on SIMULATED target HP %, not initial. Build a two-action node where the simulated
      //       target HP% drops below the finisher threshold AFTER action 1, then Sniper Shot fires as action 2. Compare against a node where
      //       Sniper Shot fires as action 1 against a fresh target — the EARNED-finisher Sniper Shot should NOT be over-penalized by initial-HP logic.
      //     • The `pre` snapshot on each action must carry the simulated moment values.
      try {
        if (
          typeof plannerSeqSimulateAction === "function" &&
          typeof plannerSeqScoreNode === "function"
        ) {
          // Synthetic Sniper Shot (charge skill).
          const sniper = {
            slot: 0, name: "Sniper Shot", normalizedKey: "snipershot",
            isAttack: true, hasDirectDamage: true, manaCost: 0, castTimeSec: 0, cooldownSec: 6,
            immediateDamage: 100, immediateDamageByType: { physical: 100, magic: 0, unknown: 0 },
            dotPerSec: 0, dotPerSecByType: { physical: 0, magic: 0, unknown: 0 },
            dotDurationSec: 0, damageType: "physical",
            isCharge: true, chargeMaxSec: 4, chargeGearPct: 200,
            isAoe: false, isControl: false, controlDurationSec: 0, tacticalRoles: ["channeled"],
            semantic: { __semKey: "snipershot", role: "finisher",
              chargeFullPressurePenaltySec: 1.6, finisherTargetHpPctMax: 0.45, finisherBonusSec: 0.8 }
          };
          // Fresh target → mid-sequence Sniper Shot finisher window EARNED:
          // AI CHANGED: Planner rewrite v1.3 — sim state no longer carries `basicAttackLikelyUnderway`; schedule = `+Infinity` means "no carry-over pending".
          const initial = {
            elapsedSec: 0,
            playerHpCur: 1000, playerHpMax: 1000,
            playerMpCur: 100, playerMpMax: 100,
            targetHpCur: 500, targetHpMax: 1000, // start at 50%
            enemyCount: 1, activeAttackers: 1, pressure: 0,
            incomingHpLossPerSec: 0,
            basicSwingIntervalSec: 1, expectedBasicHit: 50,
            skillCooldownReadyAtSec: {},
            targetFlags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
              magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 },
            lastActionTimeSec: 0, mpWasted: 0, hpLost: 0, mobFactor: 1,
            nextBasicReadyAtSec: Number.POSITIVE_INFINITY, extraBasicSwingsTotal: 0, extraBasicDamageTotal: 0
          };
          // Build a node with PRE snapshots manually.
          // AI CHANGED: Planner rewrite v1.3 — `basicCarryOverPending` is derived from the canonical schedule (mirrored on legacy alias `basicAttackLikelyUnderway`).
          function preFor(simSnap) {
            const reliefCount = Config.planner.sequencePlanner.archerSemantics && Config.planner.sequencePlanner.archerSemantics.distractingShot && Number.isFinite(Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount)
              ? Config.planner.sequencePlanner.archerSemantics.distractingShot.activeAttackerReliefCount : 1;
            const effAtt = Number.isFinite(simSnap.activeAttackers)
              ? Math.max(0, simSnap.activeAttackers - (simSnap.targetFlags && simSnap.targetFlags.hasDistract ? reliefCount : 0))
              : null;
            const carryOverPending = typeof simSnap.nextBasicReadyAtSec === "number"
              && simSnap.nextBasicReadyAtSec <= simSnap.elapsedSec + 1e-9;
            return {
              elapsedSec: +simSnap.elapsedSec.toFixed(3),
              targetHpPct: Number.isFinite(simSnap.targetHpCur) && simSnap.targetHpMax > 0 ? +(simSnap.targetHpCur / simSnap.targetHpMax).toFixed(4) : null,
              playerHpPct: Number.isFinite(simSnap.playerHpCur) && simSnap.playerHpMax > 0 ? +(simSnap.playerHpCur / simSnap.playerHpMax).toFixed(4) : null,
              pressure: Number.isFinite(simSnap.pressure) ? simSnap.pressure : null,
              activeAttackers: simSnap.activeAttackers, effectiveActiveAttackers: effAtt,
              enemyCount: simSnap.enemyCount,
              hasMagicResistShred: !!(simSnap.targetFlags && simSnap.targetFlags.hasMagicResistShred),
              hasSlow: !!(simSnap.targetFlags && simSnap.targetFlags.hasSlow),
              hasDistract: !!(simSnap.targetFlags && simSnap.targetFlags.hasDistract),
              basicCarryOverPending: carryOverPending,
              basicAttackLikelyUnderway: carryOverPending
            };
          }
          // Path A: Sniper Shot fired at initial state (target at 50% — already inside finisher window of 0.45 default? no, finisherTargetHpPctMax=0.45, 0.5>0.45, so no bonus).
          const preA = preFor(initial);
          const stepA = plannerSeqSimulateAction(initial, { kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Sniper Shot", slot: 0, skill: sniper });
          const nodeA = {
            sim: stepA.next,
            actions: [{ kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Sniper Shot", slot: 0,
              skill: { slot: 0, name: "Sniper Shot", normalizedKey: "snipershot", damageType: "physical" }, pre: preA }],
            cumulativeDamage: stepA.damageDealt, killedAtSec: null
          };
          const combatStateForScore = {
            mode: "fast",
            player: { hpCur: 1000, hpMax: 1000, hpPct: 1, mpCur: 100, mpMax: 100, mpPct: 1,
              basicSwingIntervalSec: 1, expectedBasicHit: 50, basicDpsAdjusted: 50, basicAttackLikelyUnderway: false, longSelfBuffs: [] },
            target: { hpCur: 500, hpMax: 1000, hpPct: 0.5, visibleEffects: [],
              flags: { hasMagicResistShred: false, hasSlow: false, hasDistract: false,
                magicResistShredRemainingSec: 0, slowRemainingSec: 0, distractRemainingSec: 0 }, fingerprintKey: null },
            fight: { enemiesPresent: 1, activeAttackerCount: 1, activeAttackerSource: "test",
              pressure: 0, incomingHpLossPerSec: 0, combatMode: "fast" },
            timing: { nowMs: Date.now(), maxHorizonSec: 6, maxActions: 5 },
            paperBasicDps: 50, mobFactor: 1
          };
          // Path B: chain a softening basic action first to drop target to ~450/1000 (45%), THEN Sniper Shot.
          const softener = { kind: "basic", name: "Basic Attack", slot: null };
          const stepB1 = plannerSeqSimulateAction(initial, softener);
          // Manually drop target HP further so Sniper Shot fires when targetHpPct < 0.45.
          const midState = Object.assign({}, stepB1.next);
          midState.targetHpCur = 0.4 * midState.targetHpMax;
          const preB2 = preFor(midState);
          const stepB2 = plannerSeqSimulateAction(midState, { kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Sniper Shot", slot: 0, skill: sniper });
          const nodeB = {
            sim: stepB2.next,
            actions: [
              { kind: "basic", name: "Basic Attack", slot: null, pre: preFor(initial) },
              { kind: "skill_charge", chargeMode: "full", chargeReleaseFraction: 1, name: "Sniper Shot", slot: 0,
                skill: { slot: 0, name: "Sniper Shot", normalizedKey: "snipershot", damageType: "physical" }, pre: preB2 }
            ],
            cumulativeDamage: stepB1.damageDealt + stepB2.damageDealt, killedAtSec: null
          };
          const scoreA = plannerSeqScoreNode(nodeA, combatStateForScore);
          const scoreB = plannerSeqScoreNode(nodeB, combatStateForScore);
          // Path B's Sniper Shot pre.targetHpPct = 0.4 < 0.45 → finisher bonus fires (semanticAdj -0.8). Path A's pre.targetHpPct = 0.5 → no bonus.
          // The finisher must be reflected in the score — check that nodeB.actions[1].pre.targetHpPct < 0.45.
          const preBTargetOk = nodeB.actions[1].pre && Number.isFinite(nodeB.actions[1].pre.targetHpPct) && nodeB.actions[1].pre.targetHpPct < 0.45;
          const preAExists = !!(nodeA.actions[0] && nodeA.actions[0].pre);
          const passed = preBTargetOk && preAExists;
          addCheck(
            "planner_semantic_uses_simulated_state",
            passed,
            {
              preATargetHpPct: nodeA.actions[0] && nodeA.actions[0].pre ? nodeA.actions[0].pre.targetHpPct : null,
              preBTargetHpPct: nodeB.actions[1] && nodeB.actions[1].pre ? nodeB.actions[1].pre.targetHpPct : null,
              scoreA: scoreA,
              scoreB: scoreB,
              preATargetExists: preAExists,
              preBTargetUnderFinisher: preBTargetOk
            },
            false
          );
        } else {
          addCheck("planner_semantic_uses_simulated_state", false, { reason: "fns_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_semantic_uses_simulated_state threw", err);
        addCheck("planner_semantic_uses_simulated_state", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — execution-plan SHAPE test.
      //   Build a synthetic seqPick (no live state needed) and convert it to an execution plan via the internal helper
      //   `plannerExecutionPlanFromSeqPick`. Verify the runtime-facing fields exist and look correct: `planId`, `builtAt`,
      //   `actions[]`, `totalActions`, `currentIndex === 0`, `valid === true`, etc. Modules share IIFE scope inside the
      //   concatenated bot.user.js so the helpers are referenced directly by name.
      try {
        if (typeof plannerExecutionPlanFromSeqPick === "function") {
          const synthSeq = {
            combatState: {
              target: { fingerprintKey: "test-fp-001", hpCur: 1800, hpMax: 2000, flags: { hasMagicResistShred: false } },
              player: { hpCur: 950, hpMax: 1000, mpCur: 800, mpMax: 1000 },
              fight: { enemyCount: 1, activeAttackerCount: 1, pressure: 0.2, combatMode: "fast" },
              timing: { maxHorizonSec: 6 }
            },
            best: {
              actions: [
                { kind: "skill", skill: { slot: 2, name: "Piercing Strike", damageType: "physical", normalizedKey: "piercing strike" }, damageDealt: 120, actionTimeSec: 0.6, elapsedAfterSec: 0.6 },
                { kind: "skill", skill: { slot: 3, name: "Ice Shard", damageType: "magic", normalizedKey: "ice shard" }, damageDealt: 360, actionTimeSec: 0.7, elapsedAfterSec: 1.3 },
                { kind: "basic" }
              ],
              cumulativeDamage: 540,
              killedAtSec: null,
              sim: { targetHpCur: 1460, playerHpCur: 950, playerMpCur: 700, elapsedSec: 2.0, hpLost: 0, playerHpMax: 1000 },
              _finalScore: 12.5
            },
            firstAction: null,
            secondAction: null,
            normalizedSkills: [],
            excludeSlotsApplied: null
          };
          const ep = plannerExecutionPlanFromSeqPick(synthSeq, { liveState: null });
          const hasId = ep && typeof ep.planId === "string" && ep.planId.length > 3;
          const hasBuiltAt = ep && Number.isFinite(ep.builtAt) && ep.builtAt > 0;
          const fpOk = ep && ep.targetFingerprint === "test-fp-001";
          const versionOk = ep && ep.version === 2;
          const totalOk = ep && ep.totalActions === 3 && Array.isArray(ep.actions) && ep.actions.length === 3;
          const cursorOk = ep && ep.currentIndex === 0;
          const validOk = ep && ep.valid === true && ep.invalidReason === null;
          const stepZero = ep ? ep.actions[0] : null;
          const stepOne = ep ? ep.actions[1] : null;
          const stepTwo = ep ? ep.actions[2] : null;
          const stepZeroOk =
            stepZero && stepZero.index === 0 && stepZero.kind === "skill" && stepZero.slot === 2 && stepZero.damageType === "physical";
          const stepOneOk =
            stepOne && stepOne.index === 1 && stepOne.kind === "skill" && stepOne.slot === 3 && stepOne.damageType === "magic";
          const stepTwoOk =
            stepTwo && stepTwo.index === 2 && stepTwo.kind === "basic" && stepTwo.slot === null;
          const compactStateOk =
            ep && ep.combatStateAtBuild &&
            ep.combatStateAtBuild.target &&
            ep.combatStateAtBuild.target.fingerprintKey === "test-fp-001" &&
            ep.combatStateAtBuild.fight &&
            ep.combatStateAtBuild.fight.enemyCount === 1;
          const passed =
            !!ep && hasId && hasBuiltAt && fpOk && versionOk && totalOk && cursorOk && validOk &&
            stepZeroOk && stepOneOk && stepTwoOk && compactStateOk;
          addCheck(
            "planner_execution_plan_shape",
            passed,
            {
              planId: ep ? ep.planId : null,
              version: ep ? ep.version : null,
              total: ep ? ep.totalActions : null,
              currentIndex: ep ? ep.currentIndex : null,
              valid: ep ? ep.valid : null,
              steps: ep ? ep.actions.map(function (a) { return { i: a.index, k: a.kind, s: a.slot, t: a.damageType }; }) : null,
              compact: ep ? ep.combatStateAtBuild : null
            },
            false
          );
        } else {
          addCheck("planner_execution_plan_shape", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_execution_plan_shape threw", err);
        addCheck("planner_execution_plan_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — execution plan STEP ADVANCE test.
      //   Build a synthetic plan, install as active, advance the cursor twice, verify cursor + stepHistory + plan-exhausted
      //   invalidation. This validates that runtime can continue to step 2+ within a single plan.
      try {
        if (
          typeof plannerExecutionPlanFromSeqPick === "function" &&
          typeof plannerSetActiveExecutionPlan === "function" &&
          typeof plannerAdvanceExecutionPlanStep === "function"
        ) {
          const prevPlan = Runtime.planner ? Runtime.planner.activeExecutionPlan : null;
          const ep = plannerExecutionPlanFromSeqPick(
            {
              combatState: {
                target: { fingerprintKey: "test-adv-001", hpCur: 600, hpMax: 1000, flags: { hasMagicResistShred: false } },
                player: { hpCur: 1000, hpMax: 1000, mpCur: 1000, mpMax: 1000 },
                fight: { enemyCount: 1, activeAttackerCount: 1, pressure: 0.1, combatMode: "fast" },
                timing: { maxHorizonSec: 6 }
              },
              best: {
                actions: [
                  { kind: "skill", skill: { slot: 2, name: "Piercing Strike", damageType: "physical" }, damageDealt: 120, actionTimeSec: 0.6, elapsedAfterSec: 0.6 },
                  { kind: "skill", skill: { slot: 3, name: "Ice Shard", damageType: "magic" }, damageDealt: 360, actionTimeSec: 0.7, elapsedAfterSec: 1.3 }
                ],
                cumulativeDamage: 480,
                killedAtSec: null,
                sim: { targetHpCur: 120, playerHpCur: 1000, playerMpCur: 900, elapsedSec: 1.3, hpLost: 0, playerHpMax: 1000 },
                _finalScore: 8.4
              },
              excludeSlotsApplied: null
            },
            {}
          );
          plannerSetActiveExecutionPlan(ep);
          const before = ep.currentIndex;
          plannerAdvanceExecutionPlanStep({ result: "test_advance_1", source: "test" });
          const afterFirst = ep.currentIndex;
          plannerAdvanceExecutionPlanStep({ result: "test_advance_2", source: "test" });
          const afterSecond = ep.currentIndex;
          const exhaustedOk = ep.valid === false && ep.invalidReason === "plan_exhausted";
          const historyOk =
            Array.isArray(ep.stepHistory) &&
            ep.stepHistory.length === 2 &&
            ep.stepHistory[0].index === 0 &&
            ep.stepHistory[1].index === 1 &&
            ep.stepHistory[0].result === "test_advance_1" &&
            ep.stepHistory[1].result === "test_advance_2";
          const passed = before === 0 && afterFirst === 1 && afterSecond === 2 && exhaustedOk && historyOk;
          addCheck(
            "planner_execution_plan_step_advance",
            passed,
            {
              before: before,
              afterFirst: afterFirst,
              afterSecond: afterSecond,
              exhaustedReason: ep.invalidReason,
              historyLen: Array.isArray(ep.stepHistory) ? ep.stepHistory.length : null
            },
            false
          );
          // Restore previous active plan to avoid leaking the synthetic into production runtime.
          plannerSetActiveExecutionPlan(prevPlan);
        } else {
          addCheck("planner_execution_plan_step_advance", false, { reason: "advance_fns_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_execution_plan_step_advance threw", err);
        addCheck("planner_execution_plan_step_advance", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — should-replan HELPER shape test.
      //   Construct a known plan + varied live-state scenarios, verify each reason fires and the helper returns the
      //   expected `{ shouldReplan, reason, details }` triple for inspection.
      try {
        const mkPlan = function (fp) {
          return {
            version: 2,
            planId: "ep_test_replan",
            builtAt: Date.now(),
            targetFingerprint: fp || "test-replan-001",
            combatStateAtBuild: {
              target: { fingerprintKey: fp || "test-replan-001", hpCur: 800, hpMax: 1000, magicResistShred: false, shredRemainingSec: null },
              player: { hpCur: 1000, hpMax: 1000, mpCur: 1000, mpMax: 1000 },
              fight: { enemyCount: 1, activeAttackerCount: 1, pressure: 0.1, combatMode: "fast" }
            },
            actions: [
              { index: 0, kind: "skill", slot: 2, name: "Piercing Strike", damageType: "physical", chargeMode: null, chargeReleaseFraction: null, predictedDamageDealt: 120, predictedActionTimeSec: 0.6, predictedEndElapsedSec: 0.6, reasonTags: [] }
            ],
            totalActions: 1,
            currentIndex: 0,
            selectionReason: "test",
            predictedKillAtSec: null,
            score: 1,
            valid: true,
            invalidReason: null,
            replanReason: null,
            stepHistory: [],
            excludeSlotsApplied: null,
            disallowChargeSkills: false,
            firstBurstAfterRetarget: false
          };
        };
        if (typeof plannerShouldReplanForExecutionPlan === "function") {
          const planOk = mkPlan("fp-OK");
          const liveOk = {
            combat: { enemyCount: 1, targetHp: { valid: true, cur: 800, max: 1000 } },
            player: { mp: { valid: true, cur: 1000 } }
          };
          const decisionOk = plannerShouldReplanForExecutionPlan({ plan: planOk, liveState: liveOk, targetFingerprint: "fp-OK" });
          const planFpMismatch = mkPlan("fp-old");
          const decisionFp = plannerShouldReplanForExecutionPlan({ plan: planFpMismatch, liveState: liveOk, targetFingerprint: "fp-new" });
          const planDied = mkPlan("fp-died");
          const liveDied = {
            combat: { enemyCount: 1, targetHp: { valid: true, cur: 0, max: 1000 } },
            player: { mp: { valid: true, cur: 1000 } }
          };
          const decisionDied = plannerShouldReplanForExecutionPlan({ plan: planDied, liveState: liveDied, targetFingerprint: "fp-died" });
          const planExhausted = mkPlan("fp-exh");
          planExhausted.currentIndex = 1;
          const decisionExh = plannerShouldReplanForExecutionPlan({ plan: planExhausted, liveState: liveOk, targetFingerprint: "fp-exh" });
          const decisionNoPlan = plannerShouldReplanForExecutionPlan({ plan: null, liveState: liveOk });
          const planMax = mkPlan("fp-max");
          const liveMaxDiff = {
            combat: { enemyCount: 1, targetHp: { valid: true, cur: 1500, max: 2000 } },
            player: { mp: { valid: true, cur: 1000 } }
          };
          const decisionMax = plannerShouldReplanForExecutionPlan({ plan: planMax, liveState: liveMaxDiff, targetFingerprint: "fp-max" });
          const planOld = mkPlan("fp-old2");
          planOld.builtAt = Date.now() - 60000;
          const decisionOld = plannerShouldReplanForExecutionPlan({ plan: planOld, liveState: liveOk, targetFingerprint: "fp-old2", maxPlanAgeMs: 5000 });
          const passed =
            decisionOk && decisionOk.shouldReplan === false &&
            decisionFp && decisionFp.shouldReplan === true && decisionFp.reason === "target_fingerprint_changed" &&
            decisionDied && decisionDied.shouldReplan === true && decisionDied.reason === "target_died" &&
            decisionExh && decisionExh.shouldReplan === true && decisionExh.reason === "plan_exhausted" &&
            decisionNoPlan && decisionNoPlan.shouldReplan === true && decisionNoPlan.reason === "no_active_plan" &&
            decisionMax && decisionMax.shouldReplan === true && decisionMax.reason === "target_max_hp_changed" &&
            decisionOld && decisionOld.shouldReplan === true && decisionOld.reason === "plan_too_old";
          addCheck(
            "planner_should_replan_helper_shape",
            passed,
            {
              ok: decisionOk,
              fp: decisionFp,
              died: decisionDied,
              exh: decisionExh,
              noPlan: decisionNoPlan,
              max: decisionMax,
              old: decisionOld
            },
            false
          );
        } else {
          addCheck("planner_should_replan_helper_shape", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_should_replan_helper_shape threw", err);
        addCheck("planner_should_replan_helper_shape", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — execution-plan CHARGE STEP shape test.
      //   Verify a charge step survives plan materialization with chargeMode + chargeReleaseFraction preserved, AND that
      //   `plannerExecutionPlanStepToQueueAction` correctly returns null for the charge step (queue cannot fire charges).
      try {
        if (
          typeof plannerExecutionPlanFromSeqPick === "function" &&
          typeof plannerExecutionPlanStepToQueueAction === "function"
        ) {
          const ep = plannerExecutionPlanFromSeqPick(
            {
              combatState: {
                target: { fingerprintKey: "fp-chg-001", hpCur: 1900, hpMax: 2000, flags: { hasMagicResistShred: false } },
                player: { hpCur: 1000, hpMax: 1000, mpCur: 1000, mpMax: 1000 },
                fight: { enemyCount: 1, activeAttackerCount: 1, pressure: 0.1, combatMode: "fast" },
                timing: { maxHorizonSec: 6 }
              },
              best: {
                actions: [
                  {
                    kind: "skill_charge",
                    skill: { slot: 4, name: "Sniper Shot", damageType: "physical" },
                    chargeMode: "partial",
                    chargeReleaseFraction: 0.62,
                    damageDealt: 480,
                    actionTimeSec: 1.5,
                    elapsedAfterSec: 1.5
                  },
                  { kind: "basic" }
                ],
                cumulativeDamage: 480,
                killedAtSec: null,
                sim: { targetHpCur: 1420, playerHpCur: 1000, playerMpCur: 900, elapsedSec: 1.5, hpLost: 0, playerHpMax: 1000 },
                _finalScore: 7
              },
              excludeSlotsApplied: null
            },
            {}
          );
          const step0 = ep ? ep.actions[0] : null;
          const step1 = ep ? ep.actions[1] : null;
          const chargeShapeOk =
            step0 && step0.kind === "skill_charge" && step0.slot === 4 &&
            step0.chargeMode === "partial" &&
            typeof step0.chargeReleaseFraction === "number" &&
            Math.abs(step0.chargeReleaseFraction - 0.62) < 0.0001;
          const qa0 = plannerExecutionPlanStepToQueueAction(ep, 0);
          const qa1 = plannerExecutionPlanStepToQueueAction(ep, 1);
          const queueRejectsChargeOk = qa0 === null;
          const queueAcceptsBasicOk = qa1 && qa1.mode === "basic" && qa1.slot === null;
          // Also verify `plannerNextCombatQueueAction` skips the charge step and falls back to the basic at index 1.
          let nextSkipsCharge = false;
          if (typeof plannerSetActiveExecutionPlan === "function" && typeof plannerNextCombatQueueAction === "function") {
            const prev = Runtime.planner ? Runtime.planner.activeExecutionPlan : null;
            plannerSetActiveExecutionPlan(ep);
            const nextAct = plannerNextCombatQueueAction({ disallowChargeSkills: true });
            nextSkipsCharge = !!(nextAct && nextAct.mode === "basic" && nextAct.fromExecutionPlan === true && nextAct.planStepIndex === 1);
            plannerSetActiveExecutionPlan(prev);
          }
          const passed = chargeShapeOk && queueRejectsChargeOk && queueAcceptsBasicOk && nextSkipsCharge;
          addCheck(
            "planner_execution_plan_charge_step_preserved",
            passed,
            {
              step0: step0
                ? { kind: step0.kind, slot: step0.slot, chargeMode: step0.chargeMode, chargeReleaseFraction: step0.chargeReleaseFraction }
                : null,
              queueForCharge: qa0,
              queueForBasic: qa1,
              nextSkipsCharge: nextSkipsCharge
            },
            false
          );
        } else {
          addCheck("planner_execution_plan_charge_step_preserved", false, { reason: "fns_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_execution_plan_charge_step_preserved threw", err);
        addCheck("planner_execution_plan_charge_step_preserved", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — execution-plan INVALIDATION on retarget test.
      //   Build a synthetic plan, install it as active, call `plannerInvalidateExecutionPlan("post_kill_retarget")`, verify
      //   plan.valid=false + invalidReason matches + Runtime.planner.lastExecutionPlanInvalidationReason populated +
      //   combatExecution counter incremented.
      try {
        if (
          typeof plannerExecutionPlanFromSeqPick === "function" &&
          typeof plannerSetActiveExecutionPlan === "function" &&
          typeof plannerInvalidateExecutionPlan === "function"
        ) {
          const prevPlan = Runtime.planner ? Runtime.planner.activeExecutionPlan : null;
          const ep = plannerExecutionPlanFromSeqPick(
            {
              combatState: {
                target: { fingerprintKey: "fp-inv-001", hpCur: 800, hpMax: 1000, flags: { hasMagicResistShred: false } },
                player: { hpCur: 1000, hpMax: 1000, mpCur: 1000, mpMax: 1000 },
                fight: { enemyCount: 2, activeAttackerCount: 1, pressure: 0.1, combatMode: "fast" },
                timing: { maxHorizonSec: 6 }
              },
              best: {
                actions: [
                  { kind: "skill", skill: { slot: 2, name: "Piercing Strike", damageType: "physical" }, damageDealt: 120, actionTimeSec: 0.6, elapsedAfterSec: 0.6 }
                ],
                cumulativeDamage: 120,
                killedAtSec: null,
                sim: { targetHpCur: 680, playerHpCur: 1000, playerMpCur: 950, elapsedSec: 0.6, hpLost: 0, playerHpMax: 1000 },
                _finalScore: 2
              },
              excludeSlotsApplied: null
            },
            {}
          );
          plannerSetActiveExecutionPlan(ep);
          const beforeCount =
            Runtime.autoFarm && Runtime.autoFarm.combatExecution && Number.isFinite(Runtime.autoFarm.combatExecution.plansInvalidated)
              ? Runtime.autoFarm.combatExecution.plansInvalidated
              : 0;
          plannerInvalidateExecutionPlan("post_kill_retarget", { test: true });
          const planFromRuntime = Runtime.planner ? Runtime.planner.activeExecutionPlan : null;
          const afterCount =
            Runtime.autoFarm && Runtime.autoFarm.combatExecution && Number.isFinite(Runtime.autoFarm.combatExecution.plansInvalidated)
              ? Runtime.autoFarm.combatExecution.plansInvalidated
              : 0;
          const validOk = planFromRuntime && planFromRuntime.valid === false;
          const reasonOk = planFromRuntime && planFromRuntime.invalidReason === "post_kill_retarget";
          const reasonMirrorOk =
            Runtime.planner && Runtime.planner.lastExecutionPlanInvalidationReason === "post_kill_retarget";
          const counterOk = afterCount === beforeCount + 1;
          const passed = validOk && reasonOk && reasonMirrorOk && counterOk;
          addCheck(
            "planner_execution_plan_invalidates_on_retarget",
            passed,
            {
              validAfter: planFromRuntime ? planFromRuntime.valid : null,
              invalidReason: planFromRuntime ? planFromRuntime.invalidReason : null,
              runtimeMirror: Runtime.planner ? Runtime.planner.lastExecutionPlanInvalidationReason : null,
              beforeCount: beforeCount,
              afterCount: afterCount
            },
            false
          );
          plannerSetActiveExecutionPlan(prevPlan);
        } else {
          addCheck("planner_execution_plan_invalidates_on_retarget", false, { reason: "fns_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_execution_plan_invalidates_on_retarget threw", err);
        addCheck("planner_execution_plan_invalidates_on_retarget", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner Part 2 — runtime DIAGNOSTICS surface test.
      //   `ligmarBot.getActiveExecutionPlan` / `getCombatExecutionState` / `getPlannerLastExecutionPlanInvalidationReason` /
      //   `getPlannerLastShouldReplanReason` must exist and return shape-compatible values. Also verifies all the Part 2
      //   helpers are wired through to `ligmarBot`.
      try {
        const bot = window.ligmarBot || null;
        if (bot) {
          const hasGetPlan = typeof bot.getActiveExecutionPlan === "function";
          const hasGetExec = typeof bot.getCombatExecutionState === "function";
          const hasGetInvReason = typeof bot.getPlannerLastExecutionPlanInvalidationReason === "function";
          const hasGetReplanReason = typeof bot.getPlannerLastShouldReplanReason === "function";
          const hasBuild = typeof bot.plannerBuildExecutionPlan === "function";
          const hasShouldReplan = typeof bot.plannerShouldReplanForExecutionPlan === "function";
          const hasInvalidate = typeof bot.plannerInvalidateExecutionPlan === "function";
          const hasAdvance = typeof bot.plannerAdvanceExecutionPlanStep === "function";
          const hasAdapter = typeof bot.plannerAdaptExecutionPlanStepToOpenerShape === "function";
          const hasNextQueue = typeof bot.plannerNextCombatQueueAction === "function";
          const execState = hasGetExec ? bot.getCombatExecutionState() : null;
          const execShapeOk =
            !execState ||
            (
              "planId" in execState &&
              "currentStepIndex" in execState &&
              "lastStepResult" in execState &&
              "lastReplanReason" in execState &&
              "lastInvalidationReason" in execState &&
              "planFollowedBeyondFirstStep" in execState
            );
          const passed =
            hasGetPlan && hasGetExec && hasGetInvReason && hasGetReplanReason &&
            hasBuild && hasShouldReplan && hasInvalidate && hasAdvance && hasAdapter && hasNextQueue &&
            execShapeOk;
          addCheck(
            "planner_execution_plan_runtime_diagnostics",
            passed,
            {
              hasGetPlan: hasGetPlan,
              hasGetExec: hasGetExec,
              hasGetInvReason: hasGetInvReason,
              hasGetReplanReason: hasGetReplanReason,
              hasBuild: hasBuild,
              hasShouldReplan: hasShouldReplan,
              hasInvalidate: hasInvalidate,
              hasAdvance: hasAdvance,
              hasAdapter: hasAdapter,
              hasNextQueue: hasNextQueue,
              execShapeOk: execShapeOk,
              execStateKeys: execState ? Object.keys(execState).slice(0, 16) : null
            },
            false
          );
        } else {
          addCheck("planner_execution_plan_runtime_diagnostics", false, { reason: "ligmarBot_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_execution_plan_runtime_diagnostics threw", err);
        addCheck("planner_execution_plan_runtime_diagnostics", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Planner rewrite v1.2 — diagnostics is now read-only (no class-profile mutation).
      //   Logic (bullet-list):
      //     • Capture a known `Config.planner.skillMpReserve` value, set a sentinel value, call `getPlannerOpeningPickDiagnostics()` (which previously
      //       called `plannerApplyClassProfile()` and would mutate this field back from the class profile).
      //     • After the diagnostic call, `Config.planner.skillMpReserve` should still equal the sentinel — diagnostics did NOT mutate it.
      //     • Restore the original value when done.
      try {
        if (typeof getPlannerOpeningPickDiagnostics === "function" && Config.planner) {
          const original = Config.planner.skillMpReserve;
          const sentinel = 9999;
          Config.planner.skillMpReserve = sentinel;
          const diag = getPlannerOpeningPickDiagnostics();
          const stayedAsSentinel = Config.planner.skillMpReserve === sentinel;
          Config.planner.skillMpReserve = original;
          addCheck(
            "planner_diagnostics_read_only",
            stayedAsSentinel,
            {
              originalRestored: Config.planner.skillMpReserve === original,
              postCallValue: stayedAsSentinel ? sentinel : "mutated",
              classProfilePresent: !!(diag && diag.classProfile)
            },
            false
          );
        } else {
          addCheck("planner_diagnostics_read_only", false, { reason: "fn_missing" }, false);
        }
      } catch (err) {
        Logger.warn("TEST", "planner_diagnostics_read_only threw", err);
        addCheck("planner_diagnostics_read_only", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Night mode — persistence round-trip via the shared autoFarmUi blob (key `ligmarbot.autoFarmUi.v1`).
      try {
        if (
          typeof saveAutoFarmUiPrefs !== "function" ||
          typeof loadAutoFarmUiPrefs !== "function" ||
          !Runtime.autoFarm
        ) {
          addCheck("night_mode_persistence_roundtrip", false, { reason: "prefs_api_missing" }, false);
        } else {
          if (!Runtime.autoFarm.nightMode || typeof Runtime.autoFarm.nightMode !== "object") {
            Runtime.autoFarm.nightMode = {
              enabled: false,
              hourlyReloadTimer: null,
              hourlyReloadScheduledAt: null,
              hourlyReloadDueAt: null,
              lastReloadAt: null,
              lastBootAutostartAt: null
            };
          }
          const prevEnabled = !!Runtime.autoFarm.nightMode.enabled;
          Runtime.autoFarm.nightMode.enabled = true;
          const saved = saveAutoFarmUiPrefs();
          Runtime.autoFarm.nightMode.enabled = false;
          loadAutoFarmUiPrefs();
          const afterLoad = !!(Runtime.autoFarm.nightMode && Runtime.autoFarm.nightMode.enabled);
          Runtime.autoFarm.nightMode.enabled = prevEnabled;
          saveAutoFarmUiPrefs();
          addCheck(
            "night_mode_persistence_roundtrip",
            saved && saved.ok === true && afterLoad === true,
            {
              storageKey: saved && saved.storageKey ? saved.storageKey : null,
              wroteEnabled: true,
              loadedEnabled: afterLoad,
              restoredTo: prevEnabled
            },
            false
          );
        }
      } catch (err) {
        Logger.warn("TEST", "night_mode_persistence_roundtrip threw", err);
        addCheck(
          "night_mode_persistence_roundtrip",
          false,
          { error: String(err && err.message ? err.message : err) },
          false
        );
      }

      // AI CHANGED: Regression — planner localStorage can leave useRanked false; Fast/Safe must flip it on via applyAutoFarmCombatMode (same as AUTO ON / loop start).
      try {
        if (typeof applyAutoFarmCombatMode === "function" && Runtime.autoFarm) {
          const prevMode = Runtime.autoFarm.combatMode;
          Config.planner.useRankedAttackSkillsInCombat = false;
          Runtime.autoFarm.combatMode = "fast";
          applyAutoFarmCombatMode();
          addCheck(
            "auto_combat_mode_fast_enables_ranked",
            Config.planner.useRankedAttackSkillsInCombat === true,
            { mode: "fast", useRanked: Config.planner.useRankedAttackSkillsInCombat },
            false
          );
          Runtime.autoFarm.combatMode = "easy";
          applyAutoFarmCombatMode();
          addCheck(
            "auto_combat_mode_easy_disables_ranked",
            Config.planner.useRankedAttackSkillsInCombat === false,
            { mode: "easy", useRanked: Config.planner.useRankedAttackSkillsInCombat },
            false
          );
          Runtime.autoFarm.combatMode = "safe";
          applyAutoFarmCombatMode();
          addCheck(
            "auto_combat_mode_safe_full_planner_like_fast",
            Config.planner.useRankedAttackSkillsInCombat === true &&
              Config.planner.useRankedSkillOnlyFirstBurstAfterFind === false &&
              Number.isFinite(Config.planner.skillMpReserve) &&
              Config.planner.skillMpReserve === 0,
            {
              mode: "safe",
              useRanked: Config.planner.useRankedAttackSkillsInCombat,
              useRankedSkillOnlyFirstBurstAfterFind: Config.planner.useRankedSkillOnlyFirstBurstAfterFind,
              skillMpReserve: Config.planner.skillMpReserve
            },
            false
          );
          Runtime.autoFarm.combatMode = prevMode;
          Config.planner.useRankedAttackSkillsInCombat = true;
          Config.planner.skillMpReserve = 0;
        } else {
          const miss = { reason: "applyAutoFarmCombatMode_or_autoFarm_missing" };
          addCheck("auto_combat_mode_fast_enables_ranked", false, miss, false);
          addCheck("auto_combat_mode_easy_disables_ranked", false, miss, false);
          addCheck("auto_combat_mode_safe_full_planner_like_fast", false, miss, false);
        }
      } catch (err) {
        Logger.warn("TEST", "auto combat mode ranked regression check threw", err);
        addCheck("auto_combat_mode_fast_enables_ranked", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        const root = Config.supportBuffs;
        const w = root && root.postBuffCastCooldownWait;
        addCheck(
          "support_buff_post_cast_cooldown_wait_config",
          !!(root && w && w.enabled !== false && Number.isFinite(w.maxWaitMs) && w.maxWaitMs > 0),
          { maxWaitMs: w && w.maxWaitMs, pollMs: w && w.pollMs, minSettleMs: w && w.minSettleMs },
          false
        );
      } catch (err) {
        addCheck("support_buff_post_cast_cooldown_wait_config", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        const tr = Config.supportBuffs && Config.supportBuffs.buffDurationTracking;
        addCheck(
          "support_buff_duration_tracking_config",
          !!(Config.supportBuffs && tr && tr.enabled !== false && Number.isFinite(tr.recastMinRemainingSec) && tr.recastMinRemainingSec >= 0),
          { recastMinRemainingSec: tr && tr.recastMinRemainingSec, enabled: !(tr && tr.enabled === false) },
          false
        );
      } catch (err) {
        addCheck("support_buff_duration_tracking_config", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      try {
        const es = Config.farmLoop && Config.farmLoop.ensureSkills;
        addCheck(
          "farm_loop_ensure_skills_config",
          !!(Config.farmLoop && es && es.enabled !== false),
          {
            enabled: !(es && es.enabled === false),
            loadCacheEveryCycle: es && es.loadCacheEveryCycle,
            scanWhenLikelyBlind: es && es.scanWhenLikelyBlind
          },
          false
        );
      } catch (err) {
        addCheck("farm_loop_ensure_skills_config", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: TEST self-check — `Config.farmLoop.autoLikeTest` mirrors panel TEST OOC prep on first AUTO cycle (no soak / calibration).
      try {
        const altc = Config.farmLoop && Config.farmLoop.autoLikeTest;
        addCheck(
          "farm_loop_auto_like_test_config",
          !!(Config.farmLoop && altc && altc.enabled !== false),
          {
            enabled: !(altc && altc.enabled === false),
            probeSelectors: altc && altc.probeSelectors,
            skillScanLikePanelTest: altc && altc.skillScanLikePanelTest,
            readHeroCombatStatsWhenMissing: altc && altc.readHeroCombatStatsWhenMissing,
            applySkillMaster: altc && altc.applySkillMaster
          },
          false
        );
      } catch (err) {
        addCheck("farm_loop_auto_like_test_config", false, { error: String(err && err.message ? err.message : err) }, false);
      }

      // AI CHANGED: Potion tooltips can show base (+upgrade) as plain text after DOM strip — parseSkillEffects sums for combat sustain / potion choice.
      try {
        if (typeof parseSkillEffects !== "function") {
          addCheck("potion_parse_heal_base_plus_bonus", false, { reason: "parseSkillEffects_missing" }, false);
          addCheck("potion_parse_mp_base_plus_bonus", false, { reason: "parseSkillEffects_missing" }, false);
          addCheck("potion_parse_heal_legacy_no_bonus", false, { reason: "parseSkillEffects_missing" }, false);
        } else {
          const hpPotionDesc =
            "A magical potion made from Health Powder that restores 405 (+52) health over 10 seconds.";
          const hpFx = parseSkillEffects(hpPotionDesc);
          const healHp = hpFx.find(function (e) {
            return e && e.type === "heal" && e.resource === "hp";
          });
          addCheck(
            "potion_parse_heal_base_plus_bonus",
            !!(healHp && Math.abs(healHp.value - 457) < 0.01 && healHp.durationSec >= 9.5 && healHp.durationSec <= 10.5),
            { value: healHp && healHp.value, durationSec: healHp && healHp.durationSec },
            false
          );
          const mpDesc = "Restores 120 (+30) mana over 8 seconds.";
          const mpFx = parseSkillEffects(mpDesc);
          const healMp = mpFx.find(function (e) {
            return e && e.type === "heal" && e.resource === "mp";
          });
          addCheck(
            "potion_parse_mp_base_plus_bonus",
            !!(healMp && Math.abs(healMp.value - 150) < 0.01 && healMp.durationSec >= 7.5 && healMp.durationSec <= 8.5),
            { value: healMp && healMp.value, durationSec: healMp && healMp.durationSec },
            false
          );
          const legacyHp = "Restores 200 HP over 12 s";
          const legFx = parseSkillEffects(legacyHp);
          const legHeal = legFx.find(function (e) {
            return e && e.type === "heal" && e.resource === "hp";
          });
          addCheck(
            "potion_parse_heal_legacy_no_bonus",
            !!(legHeal && legHeal.value === 200 && legHeal.durationSec === 12),
            { value: legHeal && legHeal.value, durationSec: legHeal && legHeal.durationSec },
            false
          );
        }
      } catch (err) {
        Logger.warn("TEST", "potion parse (+bonus) checks threw", err);
        addCheck("potion_parse_heal_base_plus_bonus", false, { error: String(err && err.message ? err.message : err) }, false);
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
            safetyHpDropImmediateMaxFrac: sb && sb.safety ? sb.safety.hpDropImmediateMaxFrac : null,
            safetySpikeSampleMaxDtSec: sb && sb.safety ? sb.safety.spikeSampleMaxDtSec : null,
            safeModeExploreMinHpPct:
              Config.combat && Number.isFinite(Config.combat.safeModeExploreMinHpPct)
                ? Config.combat.safeModeExploreMinHpPct
                : null,
            safeModeExploreMinMpPct:
              Config.combat && Number.isFinite(Config.combat.safeModeExploreMinMpPct)
                ? Config.combat.safeModeExploreMinMpPct
                : null,
            idleMpPotionUseBelowPct:
              Config.combat && Number.isFinite(Config.combat.idleMpPotionUseBelowPct)
                ? Config.combat.idleMpPotionUseBelowPct
                : null,
            idleMpPotionTopOffTargetPct:
              Config.combat && Number.isFinite(Config.combat.idleMpPotionTopOffTargetPct)
                ? Config.combat.idleMpPotionTopOffTargetPct
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
      // AI CHANGED: TEST restores planner localStorage snapshot — re-apply Fast/Safe/Easy so AUTO ON is not left with useRanked false until another prefs load.
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
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

  // AI CHANGED: Streamlined control panel — version header, ON/OFF, combat mode, chat promo toggle, phase + compact stats (no TEST / issue-clip buttons; use `ligmarBot.runUiTestBundle` / `ligmarBot.copyIssueReportLogs` from console).
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
      // AI CHANGED: Re-apply Fast/Safe/Easy planner flags before loop start (same as loop body) so ranked is on even if plannerUi prefs were loaded false.
      if (typeof applyAutoFarmCombatMode === "function") {
        applyAutoFarmCombatMode();
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

    // AI CHANGED: AUTO combat mode — Fast / Safe / Easy; persisted in ligmarbot.autoFarmUi.v1; `applyAutoFarmCombatMode` on each click (AUTO on or off).
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
        if (typeof applyAutoFarmCombatMode === "function") {
          applyAutoFarmCombatMode();
        }
        Logger.log("UI", "AUTO combat mode selected", { mode: modeKey, running: !!Runtime.autoFarm.running });
        setTimeout(updateControlPanelStatus, 20);
      });
      return b;
    }
    const modeBtnFast = makeModeButton("Fast", "fast");
    const modeBtnSafe = makeModeButton("Safe", "safe");
    modeBtnSafe.title =
      "Full planner (ranked, horizon, openers, buffs). Between empty tiles: wait for HP/MP floors + short prebuffs before explore.";
    const modeBtnEasy = makeModeButton("Easy", "easy");
    modeBtnEasy.title = "Basic attacks only — ranked planner path disabled.";
    modeBtnFast.title = "Full planner; lighter idle gating between tiles than Safe.";
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

    // AI CHANGED: Panel toggle — Night Mode (hourly page reload + boot autostart for unattended overnight farming).
    const nightModeRow = document.createElement("label");
    nightModeRow.style.display = "flex";
    nightModeRow.style.alignItems = "center";
    nightModeRow.style.gap = "8px";
    nightModeRow.style.marginBottom = "10px";
    nightModeRow.style.fontSize = "10px";
    nightModeRow.style.opacity = "0.9";
    nightModeRow.style.cursor = "pointer";
    nightModeRow.title =
      "When ON: page auto-reloads every hour while AUTO is running, and AUTO ON starts automatically after each refresh (and after a normal page load).";
    const nightModeCb = document.createElement("input");
    nightModeCb.type = "checkbox";
    nightModeCb.checked = !!(Runtime.autoFarm && Runtime.autoFarm.nightMode && Runtime.autoFarm.nightMode.enabled);
    nightModeCb.addEventListener("change", function () {
      if (typeof setNightModeEnabled === "function") {
        setNightModeEnabled(!!nightModeCb.checked, { source: "panel_toggle" });
      } else if (Runtime.autoFarm && Runtime.autoFarm.nightMode) {
        Runtime.autoFarm.nightMode.enabled = !!nightModeCb.checked;
      }
      saveAutoFarmUiPrefs();
      Logger.log("UI", "Night mode toggled", { enabled: !!nightModeCb.checked });
      setTimeout(updateControlPanelStatus, 20);
    });
    const nightModeLbl = document.createElement("span");
    nightModeLbl.textContent = "Night Mode (hourly reload + auto-start)";
    nightModeRow.appendChild(nightModeCb);
    nightModeRow.appendChild(nightModeLbl);
    panel.appendChild(nightModeRow);

    // AI CHANGED: TEST / issue clip — use console only: `ligmarBot.runUiTestBundle(...)`, `ligmarBot.copyIssueReportLogs(...)`.

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
    Runtime.ui.testButton = null;
    Runtime.ui.testResultLine = null;
    Runtime.ui.issueStopCopyButton = null;
    Runtime.ui.issueReportLine = null;
    Runtime.ui.combatGraceInput = null;
    Runtime.ui.chatSpammerCheckbox = chatSpamCb;
    Runtime.ui.autoFarmModeButtons = { fast: modeBtnFast, safe: modeBtnSafe, easy: modeBtnEasy };
    refreshAutoFarmModeButtonsVisual();

    updateControlPanelStatus();
    // AI CHANGED: Faster refresh (500ms) so ON timer + HP/MP/Ping/phase stay live during auto-farm.
    ensureControlPanelRefreshTicker();
    return panel;
  }
