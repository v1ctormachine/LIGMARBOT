  // AI CHANGED: Added GUI status renderer so user can monitor bot without console commands.
  function updateControlPanelStatus() {
    if (!Runtime.ui.statusNode) {
      return;
    }
    const state = readBasicState();
    const auto = getAutoFarmStatus();
    const hpPct = state.player.hp && state.player.hp.valid ? Math.round(state.player.hp.pct * 100) : null;
    const mpPct = state.player.mp && state.player.mp.valid ? Math.round(state.player.mp.pct * 100) : null;
    const lines = [
      `Auto: ${auto.running ? "RUNNING" : "STOPPED"}${auto.stopRequested ? " (stopping)" : ""}`,
      `Cycles: ${auto.cyclesCompleted} | Failures: ${auto.consecutiveFailures}`,
      `EnemyCount: ${state.combat.enemyCount}`,
      `HP: ${hpPct !== null ? `${hpPct}%` : "?"} | MP: ${mpPct !== null ? `${mpPct}%` : "?"} | Ping: ${state.network.pingMs}`,
      `Last: ${auto.lastResult ? toShortJson({ ok: auto.lastResult.ok, stage: auto.lastResult.stage }) : "none"}`,
      `Coords: ${
        Runtime.exploration.lastKnownCoords
          ? `[${Runtime.exploration.lastKnownCoords.x};${Runtime.exploration.lastKnownCoords.y}]`
          : "unknown"
      }`,
      `Scan: ${
        Runtime.exploration.lastRingScan
          ? `${Runtime.exploration.lastRingScan.results.filter((r) => r.ok).length}/6 tiles`
          : "none"
      }`
    ];
    Runtime.ui.statusNode.textContent = lines.join("\n");
  }

  // AI CHANGED: Added in-game control panel for start/stop and single-step actions.
  function createControlPanel() {
    if (Runtime.ui.panel) {
      return Runtime.ui.panel;
    }

    const panel = document.createElement("div");
    panel.id = "ligmar-bot-panel";
    panel.style.position = "fixed";
    panel.style.top = "12px";
    panel.style.right = "12px";
    panel.style.width = "320px";
    panel.style.background = "rgba(14, 18, 30, 0.92)";
    panel.style.border = "1px solid rgba(115, 138, 255, 0.5)";
    panel.style.borderRadius = "8px";
    panel.style.padding = "10px";
    panel.style.zIndex = "999999";
    panel.style.fontFamily = "Consolas, Menlo, monospace";
    panel.style.fontSize = "12px";
    panel.style.color = "#dce3ff";
    panel.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";

    // AI CHANGED: Header now renders BotVersion (auto-injected by build.ps1) so the running bundle is visible at a glance.
    const titleWrap = document.createElement("div");
    titleWrap.style.marginBottom = "8px";

    const title = document.createElement("div");
    title.textContent = `Ligmar Bot v${BotVersion.version}`;
    title.style.fontWeight = "700";
    title.style.fontSize = "13px";
    titleWrap.appendChild(title);

    const subtitle = document.createElement("div");
    subtitle.textContent = BotVersion.description ? `“${BotVersion.description}”` : "";
    subtitle.style.fontSize = "11px";
    subtitle.style.opacity = "0.75";
    subtitle.style.fontStyle = "italic";
    subtitle.style.marginTop = "2px";
    subtitle.style.wordBreak = "break-word";
    titleWrap.appendChild(subtitle);

    panel.appendChild(titleWrap);

    const buttonsWrap = document.createElement("div");
    buttonsWrap.style.display = "grid";
    buttonsWrap.style.gridTemplateColumns = "1fr 1fr";
    buttonsWrap.style.gap = "6px";
    buttonsWrap.style.marginBottom = "8px";

    function makeButton(label, onClick) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.padding = "6px 8px";
      button.style.borderRadius = "6px";
      button.style.border = "1px solid rgba(160,170,210,0.4)";
      button.style.background = "rgba(54, 67, 124, 0.55)";
      button.style.color = "#eef2ff";
      button.style.cursor = "pointer";
      button.addEventListener("click", onClick);
      return button;
    }

    // AI CHANGED: Added GUI start button to launch autonomous loop without console.
    buttonsWrap.appendChild(
      makeButton("Start Auto", () => {
        startAutoFarmLoop();
        setTimeout(updateControlPanelStatus, 50);
      })
    );
    // AI CHANGED: Added GUI stop button for graceful loop shutdown.
    buttonsWrap.appendChild(
      makeButton("Stop Auto", () => {
        stopAutoFarmLoop();
        setTimeout(updateControlPanelStatus, 50);
      })
    );
    // AI CHANGED: Added GUI single-cycle run button for controlled manual testing.
    buttonsWrap.appendChild(
      makeButton("Run 1 Cycle", async () => {
        await runPreparedSecureCycle();
        updateControlPanelStatus();
      })
    );
    // AI CHANGED: Map prep only (opens map if needed); ring scan is separate "Scan Ring" button.
    buttonsWrap.appendChild(
      makeButton("Map prep", async () => {
        await prepMapForCombatCycle();
        updateControlPanelStatus();
      })
    );
    // AI CHANGED: Added GUI ring-scan button to inspect TR->TL clockwise tile data.
    buttonsWrap.appendChild(
      makeButton("Scan Ring", async () => {
        await scanNeighborRing();
        updateControlPanelStatus();
      })
    );
    // AI CHANGED: Added GUI enemy count/state snapshot button for quick diagnostics.
    buttonsWrap.appendChild(
      makeButton("Refresh Status", () => {
        updateControlPanelStatus();
      })
    );
    // AI CHANGED: Added GUI toggle for verbose state snapshot logging.
    buttonsWrap.appendChild(
      makeButton("Toggle Logs", () => {
        Config.logging.stateSnapshots = !Config.logging.stateSnapshots;
        Logger.log("GUI", "State snapshot logs toggled", { enabled: Config.logging.stateSnapshots });
        updateControlPanelStatus();
      })
    );

    panel.appendChild(buttonsWrap);

    const status = document.createElement("pre");
    status.style.margin = "0";
    status.style.padding = "8px";
    status.style.background = "rgba(0,0,0,0.25)";
    status.style.borderRadius = "6px";
    status.style.whiteSpace = "pre-wrap";
    status.style.wordBreak = "break-word";
    status.style.minHeight = "92px";
    status.textContent = "Initializing...";
    panel.appendChild(status);

    document.body.appendChild(panel);
    Runtime.ui.panel = panel;
    Runtime.ui.statusNode = status;
    updateControlPanelStatus();

    // AI CHANGED: Added periodic GUI refresh for live monitoring.
    setInterval(updateControlPanelStatus, 1000);
    return panel;
  }
