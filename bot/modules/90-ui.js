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

  // AI CHANGED: Live GUI refresher — phase block, button enabled-state, and compact stats line.
  function updateControlPanelStatus() {
    if (!Runtime.ui.statusNode) {
      return;
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
    const lines = [
      `HP ${hpPct !== null ? hpPct + "%" : "?"} · MP ${mpPct !== null ? mpPct + "%" : "?"} · Ping ${state.network.pingMs !== null ? state.network.pingMs + "ms" : "?"}`,
      `Enemies: ${enemyText} · Coords: ${coordsText}`,
      `Cycles: ${auto.cyclesCompleted} · Failures: ${auto.consecutiveFailures}`
    ];
    Runtime.ui.statusNode.textContent = lines.join("\n");
  }

  // AI CHANGED: Streamlined control panel — version header, ON/OFF only, large phase indicator, compact stats footer.
  // All previously-clickable debug buttons (Run 1 Cycle, Map prep, Scan Ring, Toggle Logs, Refresh) are still
  // available via window.ligmarBot.* in the devtools console.
  function createControlPanel() {
    if (Runtime.ui.panel) {
      return Runtime.ui.panel;
    }

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

    updateControlPanelStatus();

    // AI CHANGED: Faster refresh (500ms) so the "X s ago" counter and phase changes feel live.
    setInterval(updateControlPanelStatus, 500);
    return panel;
  }
