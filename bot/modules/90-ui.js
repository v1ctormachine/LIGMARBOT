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
