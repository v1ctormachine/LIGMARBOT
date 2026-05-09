// ==UserScript==
// @name         Ligmar Bot
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Ligmar.io farming bot foundation
// @author       Victor
// @match        https://ligmar.io/game/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // AI CHANGED: Added centralized config for bootstrap, selectors, and timing.
  const Config = {
    tickMs: 500,
    // AI CHANGED: Added action verification timing config for click+confirm flows.
    verification: {
      pollMs: 120,
      timeoutMs: 2500,
      // AI CHANGED: Loot/shrine completion — require this long with no highlight loot button and no busy battle-status text.
      lootSettleStableMs: 400,
      // AI CHANGED: Longer cap than generic verify; altar/shrine animations can run several seconds.
      lootSettleTimeoutMs: 12000,
      // AI CHANGED: Tighter poll during loot settle to catch short DOM flickers without adding much CPU.
      lootSettlePollMs: 80,
      // AI CHANGED: Substrings (lowercase match) on visible app-battle-status-bar label while interaction runs.
      lootInteractionBusySubstrings: ["opening", "activating"]
    },
    // AI CHANGED: Added bounded combat-loop config for secure-tile automation.
    combat: {
      maxFindEnemyAttempts: 8,
      maxAttackAttempts: 12,
      attackTickMs: 350
    },
    // AI CHANGED: Added runtime logging flags so noisy snapshot logs can be disabled quickly.
    logging: {
      stateSnapshots: false
    },
    // AI CHANGED: Added configurable auto-farm loop controls.
    farmLoop: {
      cycleDelayMs: 900,
      maxConsecutiveFailures: 3,
      // AI CHANGED: Added longer idle delay to reduce repetitive no-enemy/no-loot cycling.
      idleNoEnemyDelayMs: 4000,
      // AI CHANGED: Recenter map less frequently when already open.
      recenterEveryNCycles: 4
    },
    // AI CHANGED: Added movement tuning for map exploration when idling on empty tiles.
    movement: {
      settleAfterMoveMs: 900,
      // AI CHANGED: Calibrated for max-zoom-out via zoom-tester v0.3 (step=30, h=26).
      neighborStepPx: 30,
      // AI CHANGED: Try all 6 hex directions before declaring blocked.
      maxExploreAttemptsPerIdle: 6,
      // AI CHANGED: Number of synthetic wheel-out events to lock the map at minimum zoom before scanning.
      maxZoomOutBursts: 40
    },
    // AI CHANGED: Added scan timing config for faster tile probing.
    scan: {
      // AI CHANGED: Slightly relaxed scan timing to reduce false blocked reads.
      tileTimeoutMs: 760,
      // AI CHANGED: Slower polling cadence for more stable UI state transitions.
      pollMs: 95
    },
    selectors: {
      // AI CHANGED: Relaxed HP selector to avoid brittle container path mismatches.
      hpText: 'app-condition-bar[data-color="green"] span.value',
      // AI CHANGED: Relaxed MP selector to avoid brittle container path mismatches.
      mpText: 'app-condition-bar[data-color="blue"] span.value',
      // AI CHANGED: Wired real enemy counter selector provided from live DOM.
      enemyCounter: "div.battle-bar-enemies-value",
      // AI CHANGED: Wired real find-enemy button selector provided from live DOM.
      findEnemyButton: "app-button-icon.button-find-target",
      // AI CHANGED: Wired real loot/activate selector provided from live DOM.
      lootButton: "div.battle-event-button.highlight",
      // AI CHANGED: Wired basic-attack selector from fresh provided DOM element.
      basicAttackButton: "app-action-button.type-default",
      // AI CHANGED: Wired real center-map button selector from provided DOM.
      centerMapButton: "div.action-bottom-panel app-icon.to-center",
      // AI CHANGED: Wired real map-toggle button selector from provided DOM.
      mapToggleButton: "app-button-icon.button-map",
      // AI CHANGED: Added map canvas selector used for movement clicks.
      mapCanvas: "app-game canvas",
      // AI CHANGED: Added coordinate popup selectors for movement verification.
      hexTitleCoords: "div.hex-title span.hex-title-coords",
      // AI CHANGED: Added tile title selector to capture tile name during scan.
      hexTitleName: "div.hex-title span.hex-title-name",
      hexCurrentText: "div.hex-footer div.hex-current-text",
      // AI CHANGED: Added ally/enemy counters and event icon selectors for ring scan.
      alliesCounter: "div.member-item.allies div.member-counter",
      enemiesCounter: "div.member-item.enemies div.member-counter",
      // AI CHANGED: Include both app-icon and nested img so encoded loot SVG markers are always captured.
      hexEventIcons: "div.hex-events app-icon, div.hex-events img",
      // AI CHANGED: Added direct enemy HP selector to avoid fragile positional inference.
      targetHpText: 'app-condition-bar[data-color="red"] span.value',
      // AI CHANGED: Added moving-state selector so bot can avoid scanning while character is moving.
      movingBarValue: "app-canvas-condition-bar span.value",
      // AI CHANGED: Added close button selector for coordinate popup dismissal after movement verification.
      hexPopupCloseButton: "app-button-icon.close-button",
      // AI CHANGED: Battle status bar (Opening/Activating) — primary busy signal for loot/shrine completion.
      battleStatusBarValue: "app-battle-status-bar span.value",
      pingText: '[data-test="ping-value"]',
      deathScreen: '[data-test="death-screen"]',
      poorConnection: '[data-test="poor-connection"]'
    }
  };

  // AI CHANGED: Added consistent module-based logging with timestamps for debugging.
  const Logger = {
    log(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.log(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.log(`[${ts}] [${module}] ${message}`, payload);
    },
    warn(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.warn(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.warn(`[${ts}] [${module}] ${message}`, payload);
    },
    error(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.error(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.error(`[${ts}] [${module}] ${message}`, payload);
    }
  };

  // AI CHANGED: Added runtime state container for start/stop auto-farm control.
  const Runtime = {
    autoFarm: {
      running: false,
      stopRequested: false,
      cyclesCompleted: 0,
      consecutiveFailures: 0,
      lastResult: null,
      startedAt: null
    },
    // AI CHANGED: Added exploration state so idle movement rotates through nearby directions.
    exploration: {
      directionIndex: 0,
      // AI CHANGED: Stores last known tile coordinates for movement verification.
      lastKnownCoords: null,
      // AI CHANGED: Stores latest ring scan snapshot for GUI/debug use.
      lastRingScan: null
    },
    // AI CHANGED: Track whether we've already zoomed the map to minimum so scans use calibrated step distances.
    zoom: {
      maxedOut: false
    },
    // AI CHANGED: Added GUI runtime references for in-page control panel/status updates.
    ui: {
      panel: null,
      statusNode: null
    }
  };

  // AI CHANGED: Added strict game-page guard to ensure script runs only in /game/.
  function isGamePage() {
    return window.location.pathname.startsWith("/game/");
  }

  // AI CHANGED: Added selector probe utility for milestone 0.2 diagnostics.
  function probeSelectors() {
    const rows = Object.keys(Config.selectors).map((key) => {
      const selector = Config.selectors[key];
      // AI CHANGED: Guard against empty/invalid selectors so probe never crashes startup.
      if (typeof selector !== "string" || selector.trim() === "") {
        return {
          key: key,
          selector: selector,
          found: false,
          skipped: true,
          reason: "empty_selector"
        };
      }
      let element = null;
      try {
        element = document.querySelector(selector);
      } catch (error) {
        return {
          key: key,
          selector: selector,
          found: false,
          skipped: true,
          reason: "invalid_selector",
          error: error && error.message ? error.message : String(error)
        };
      }
      return {
        key: key,
        selector: selector,
        found: !!element,
        skipped: false
      };
    });
    console.table(rows);
    Logger.log("PROBE", "Selector probe complete", rows);
    return rows;
  }

  // AI CHANGED: Added CSS path generator to capture stable selectors from live elements.
  function getCssPath(element) {
    if (!element || element.nodeType !== 1) {
      return "";
    }
    const segments = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += `#${current.id}`;
        segments.unshift(segment);
        break;
      }
      const classList = Array.from(current.classList || []).filter(Boolean);
      if (classList.length > 0) {
        segment += `.${classList.slice(0, 3).join(".")}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      segments.unshift(segment);
      current = current.parentElement;
    }
    return segments.join(" > ");
  }

  // AI CHANGED: Added automatic discovery for HP/MP style x/y text nodes.
  function discoverFractionNodes() {
    const nodes = Array.from(document.querySelectorAll("*"));
    const candidates = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.children.length > 0) {
        continue;
      }
      const text = (node.textContent || "").trim();
      // AI CHANGED: Detect fraction nodes via parseFractionText so comma-formatted HP is included.
      const parsed = parseFractionText(text);
      if (!parsed.valid) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      candidates.push({
        text: text,
        cssPath: getCssPath(node),
        className: node.className || "",
        id: node.id || "",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.x),
        y: Math.round(rect.y)
      });
    }
    console.table(candidates);
    Logger.log("DISCOVER", "Fraction node discovery complete", candidates);
    return candidates;
  }

  // AI CHANGED: Added automatic discovery for action buttons by visible text.
  function discoverButtons() {
    const nodes = Array.from(document.querySelectorAll("button, [role='button'], div, span, a"));
    const candidates = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const text = (node.textContent || "").trim();
      if (!text) {
        continue;
      }
      const lower = text.toLowerCase();
      const isInteresting =
        lower.includes("loot") ||
        lower.includes("find enemy") ||
        lower.includes("enemy") ||
        lower.includes("center") ||
        lower.includes("run");
      if (!isInteresting) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      candidates.push({
        text: text,
        tag: node.tagName.toLowerCase(),
        cssPath: getCssPath(node),
        className: node.className || "",
        id: node.id || "",
        disabled: !!node.disabled,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
    console.table(candidates);
    Logger.log("DISCOVER", "Button discovery complete", candidates);
    return candidates;
  }

  // AI CHANGED: Added reusable parser for x/y style counters like HP and MP.
  function parseFractionText(text) {
    if (typeof text !== "string") {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    // AI CHANGED: Strip thousands separators (e.g. "1,399 / 1,399") so target HP reads match live UI.
    const normalized = text.trim().replace(/\s+/g, " ").replace(/,/g, "");
    const match = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    const cur = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    return { cur: cur, max: max, pct: cur / max, valid: true };
  }

  // AI CHANGED: Added lightweight fraction-node scan so HP/MP can be read without brittle selectors.
  function getFractionCandidates() {
    const nodes = Array.from(document.querySelectorAll("span.value, span, div"));
    const candidates = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.children.length > 0) {
        continue;
      }
      const text = (node.textContent || "").trim();
      // AI CHANGED: Same as discoverFractionNodes — allow comma thousands in inferred HUD reads.
      const parsed = parseFractionText(text);
      if (!parsed.valid) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      candidates.push({
        node: node,
        text: text,
        parsed: parsed,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        className: node.className || "",
        cssPath: getCssPath(node)
      });
    }
    return candidates;
  }

  // AI CHANGED: Added role inference for HP/MP/target HP using screen-position heuristics.
  function inferFractionRoles(candidates) {
    const result = {
      hp: null,
      mp: null,
      targetHp: null
    };
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return result;
    }

    const sortedByYThenX = candidates.slice().sort((a, b) => {
      if (a.y === b.y) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    // AI CHANGED: Infer player HP/MP from a vertical pair in the left/mid panel, not just "first two by Y".
    let bestPlayerPair = null;
    for (let i = 0; i < sortedByYThenX.length; i += 1) {
      for (let j = i + 1; j < sortedByYThenX.length; j += 1) {
        const a = sortedByYThenX[i];
        const b = sortedByYThenX[j];
        const sameColumn = Math.abs(a.x - b.x) <= 18;
        const verticalGap = Math.abs(a.y - b.y);
        const reasonableGap = verticalGap >= 12 && verticalGap <= 42;
        const inPlayableHud = a.y >= 35 && b.y <= 150;
        const notTopBar = a.y > 20 && b.y > 20;
        const leftHud = a.x < window.innerWidth * 0.55 && b.x < window.innerWidth * 0.55;
        if (!sameColumn || !reasonableGap || !inPlayableHud || !notTopBar || !leftHud) {
          continue;
        }
        const top = a.y <= b.y ? a : b;
        const bottom = a.y <= b.y ? b : a;
        const score = top.x * 3 + top.y;
        if (!bestPlayerPair || score < bestPlayerPair.score) {
          bestPlayerPair = { hp: top, mp: bottom, score: score };
        }
      }
    }
    if (bestPlayerPair) {
      result.hp = bestPlayerPair.hp;
      result.mp = bestPlayerPair.mp;
    }

    // AI CHANGED: Infer target HP from candidate near player HP row but to the right, excluding top-bar values.
    if (result.hp) {
      const targetCandidates = sortedByYThenX.filter((c) => {
        const rightOfPlayer = c.x >= result.hp.x + 120;
        const roughlySameRow = Math.abs(c.y - result.hp.y) <= 16;
        const avoidTopBar = c.y >= 35;
        return rightOfPlayer && roughlySameRow && avoidTopBar;
      });
      if (targetCandidates.length > 0) {
        targetCandidates.sort((a, b) => a.x - b.x);
        result.targetHp = targetCandidates[0];
      }
    }

    return result;
  }

  // AI CHANGED: Added fallback parser for integer values from mixed text nodes.
  function parseFirstInt(text) {
    if (typeof text !== "string") {
      return null;
    }
    const match = text.match(/\d+/);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[0], 10);
    return Number.isFinite(value) ? value : null;
  }

  // AI CHANGED: Added shared async sleep helper for paced loop execution.
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // AI CHANGED: Added helper for consistent compact JSON text in GUI status.
  function toShortJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  // AI CHANGED: Added shared visibility guard so action clicks only fire on visible controls.
  function isElementVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  // AI CHANGED: Read visible battle status label; treat missing/hidden bar as idle (avoids stale hidden text).
  function readBattleStatusBarText() {
    const span = document.querySelector(Config.selectors.battleStatusBarValue);
    if (!span || !span.isConnected) {
      return "";
    }
    const host = span.closest("app-canvas-condition-bar") || span;
    if (!isElementVisible(host)) {
      return "";
    }
    return (span.textContent || "").replace(/\s+/g, " ").trim();
  }

  // AI CHANGED: True when battle status shows known in-progress loot/altar strings (visible bar only).
  function isLootInteractionStatusBusy() {
    const t = readBattleStatusBarText().toLowerCase();
    if (!t) {
      return false;
    }
    const subs = Config.verification.lootInteractionBusySubstrings;
    for (let i = 0; i < subs.length; i++) {
      if (t.indexOf(subs[i].toLowerCase()) !== -1) {
        return true;
      }
    }
    return false;
  }

  // AI CHANGED: Wait until highlight loot button is gone AND status bar is not busy, continuously for lootSettleStableMs.
  function waitForLootInteractionSettled() {
    const stableMs = Config.verification.lootSettleStableMs;
    const timeoutMs = Config.verification.lootSettleTimeoutMs;
    const pollMs = Config.verification.lootSettlePollMs;
    const start = Date.now();
    let stableStart = null;
    return new Promise((resolve) => {
      const tick = () => {
        const lootElt = document.querySelector(Config.selectors.lootButton);
        const lootGone = !lootElt;
        let statusBusy = false;
        try {
          statusBusy = isLootInteractionStatusBusy();
        } catch (error) {
          Logger.warn("VERIFY", "loot settle status check threw", error);
          statusBusy = false;
        }
        const ok = lootGone && !statusBusy;
        if (ok) {
          if (stableStart === null) {
            stableStart = Date.now();
          } else if (Date.now() - stableStart >= stableMs) {
            Logger.log("VERIFY", "loot interaction settled (button gone + idle status)", {
              elapsedMs: Date.now() - start,
              stableMs: stableMs
            });
            resolve(true);
            return;
          }
        } else {
          stableStart = null;
        }
        if (Date.now() - start >= timeoutMs) {
          Logger.warn("VERIFY", "loot interaction settle timed out", {
            timeoutMs: timeoutMs,
            lootGone: lootGone,
            statusBusy: statusBusy
          });
          resolve(false);
          return;
        }
        setTimeout(tick, pollMs);
      };
      tick();
    });
  }

  // AI CHANGED: Added direct enemy counter reader using the real game selector.
  function readEnemyCount() {
    const enemyCounterNode = document.querySelector(Config.selectors.enemyCounter);
    if (!enemyCounterNode) {
      return null;
    }
    const raw = (enemyCounterNode.textContent || "").trim();
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  }

  // AI CHANGED: Added safe click wrapper with logging and visibility checks.
  function clickElementSafe(element, label) {
    if (!element) {
      Logger.warn("ACTION", `${label} click skipped: element not found`);
      return false;
    }
    if (!isElementVisible(element)) {
      Logger.warn("ACTION", `${label} click skipped: element not visible`);
      return false;
    }
    element.click();
    Logger.log("ACTION", `${label} clicked`);
    return true;
  }

  // AI CHANGED: Added live action helper for find enemy button.
  function clickFindEnemy() {
    const button = document.querySelector(Config.selectors.findEnemyButton);
    return clickElementSafe(button, "find-enemy");
  }

  // AI CHANGED: Added live action helper for loot/activate button.
  function clickLootOrActivate() {
    const button = document.querySelector(Config.selectors.lootButton);
    return clickElementSafe(button, "loot-or-activate");
  }

  // AI CHANGED: Added direct center-map action helper.
  function clickCenterMap() {
    const button = document.querySelector(Config.selectors.centerMapButton);
    return clickElementSafe(button, "center-map");
  }

  // AI CHANGED: Added direct map-toggle action helper.
  function clickMapToggle() {
    const button = document.querySelector(Config.selectors.mapToggleButton);
    return clickElementSafe(button, "map-toggle");
  }

  // AI CHANGED: Added helper to close the hex coordinate popup so action buttons are not blocked.
  function closeHexPopupIfOpen() {
    const closeButton = document.querySelector(Config.selectors.hexPopupCloseButton);
    if (!closeButton) {
      return { ok: true, closed: false, reason: "not_open" };
    }
    const closed = clickElementSafe(closeButton, "hex-popup-close");
    return { ok: closed, closed: closed, reason: closed ? "closed" : "close_click_failed" };
  }

  // AI CHANGED: Added map-canvas lookup with basic visibility guard for movement actions.
  function getMapCanvas() {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return null;
    }
    return canvas;
  }

  // AI CHANGED: One-shot max zoom-out so scanNeighborRing's neighborStepPx (30) matches actual on-screen tile spacing.
  function ensureMapZoomedOut() {
    if (Runtime.zoom.maxedOut) {
      return { ok: true, skipped: true, reason: "already_maxed" };
    }
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("ZOOM", "ensureMapZoomedOut: map canvas not visible; skipping");
      return { ok: false, reason: "no_canvas" };
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const bursts = Config.movement.maxZoomOutBursts;
    for (let i = 0; i < bursts; i += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 0,
        deltaY: 120,
        deltaZ: 0,
        deltaMode: 0,
        clientX: cx,
        clientY: cy,
        ctrlKey: false
      }));
    }
    Runtime.zoom.maxedOut = true;
    Logger.log("ZOOM", `max zoom-out applied (${bursts} wheel events)`);
    return { ok: true, bursts: bursts };
  }

  // AI CHANGED: Manual reset (e.g. after death or page reload) so the next scan re-applies max zoom-out.
  function forceZoomOut() {
    Runtime.zoom.maxedOut = false;
    return ensureMapZoomedOut();
  }

  // AI CHANGED: Added movement-state detector via yellow canvas condition bar "Moving".
  function isMovementInProgress() {
    const movingNode = document.querySelector(Config.selectors.movingBarValue);
    if (!movingNode) {
      return false;
    }
    const text = ((movingNode.textContent || "").trim()).toLowerCase();
    return text.includes("moving");
  }

  // AI CHANGED: Added guard to avoid scan/verify while movement animation is still active.
  async function waitUntilNotMoving(label) {
    const timeoutMs = label === "post-move" ? 5200 : 2800;
    const clear = await waitForCondition(
      `${label} movement settled`,
      () => !isMovementInProgress(),
      { timeoutMs: timeoutMs, pollMs: 90 }
    );
    if (!clear) {
      Logger.warn("MOVE", `${label}: movement did not settle before timeout`);
    }
    return clear;
  }

  // AI CHANGED: Added low-level mouse event dispatcher for canvas click simulation.
  function dispatchMouseAt(canvas, type, clientX, clientY) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      button: 0
    });
    canvas.dispatchEvent(event);
  }

  // AI CHANGED: Added map movement primitive that double-clicks a point on the canvas.
  function moveToMapPoint(clientX, clientY) {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("MOVE", "Move skipped: map canvas not found/visible");
      return false;
    }
    // AI CHANGED: Reduced synthetic events to lower passive-listener warnings while preserving double-click behavior.
    dispatchMouseAt(canvas, "click", clientX, clientY);
    dispatchMouseAt(canvas, "click", clientX, clientY);
    dispatchMouseAt(canvas, "dblclick", clientX, clientY);
    Logger.log("MOVE", "Map point double-clicked", { x: Math.round(clientX), y: Math.round(clientY) });
    return true;
  }

  // AI CHANGED: Added center-tile click used to open coordinate popup.
  function clickMapCenterTile() {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("MOVE", "Center tile click skipped: map canvas not found/visible");
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dispatchMouseAt(canvas, "click", cx, cy);
    Logger.log("MOVE", "Center tile clicked for coordinate read", {
      x: Math.round(cx),
      y: Math.round(cy)
    });
    return true;
  }

  // AI CHANGED: Added relative tile click helper for ring scan points.
  function clickMapRelative(dx, dy) {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("SCAN", "Relative tile click skipped: map canvas not found/visible");
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + dx;
    const y = rect.top + rect.height / 2 + dy;
    dispatchMouseAt(canvas, "click", x, y);
    Logger.log("SCAN", "Relative tile clicked", { x: Math.round(x), y: Math.round(y), dx: dx, dy: dy });
    return true;
  }

  // AI CHANGED: Added helper to compute map center in client coordinates.
  function getMapCenterClientPoint() {
    const canvas = getMapCanvas();
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      rect: rect
    };
  }

  // AI CHANGED: Added parser for coordinate popup text like "[2;2]".
  function parseCoordsText(text) {
    if (typeof text !== "string") {
      return null;
    }
    const match = text.trim().match(/^\[\s*(-?\d+)\s*;\s*(-?\d+)\s*\]$/);
    if (!match) {
      return null;
    }
    return { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), raw: text.trim() };
  }

  // AI CHANGED: Added coordinate reader independent of "You are here" so neighbor tile scans can parse coords.
  function readCurrentCoordsFromPopup() {
    const coordsNode = document.querySelector(Config.selectors.hexTitleCoords);
    if (!coordsNode) {
      return null;
    }
    return parseCoordsText(coordsNode.textContent || "");
  }

  // AI CHANGED: Added popup extractor for allies/enemies/loot marker classes during tile scan.
  function readTilePopupDetails() {
    const coords = readCurrentCoordsFromPopup();
    if (!coords) {
      return null;
    }
    const nameNode = document.querySelector(Config.selectors.hexTitleName);
    const alliesNode = document.querySelector(Config.selectors.alliesCounter);
    const enemiesNode = document.querySelector(Config.selectors.enemiesCounter);
    const hereNode = document.querySelector(Config.selectors.hexCurrentText);
    // AI CHANGED: Capture both class and src markers for robust loot-type recognition.
    const eventIcons = Array.from(document.querySelectorAll(Config.selectors.hexEventIcons)).map((icon) => {
      const classPart = (icon.className || "").toString();
      const srcPart = icon.getAttribute ? icon.getAttribute("src") || "" : "";
      return `${classPart} ${srcPart}`.trim();
    });
    const allies = alliesNode ? Number.parseInt((alliesNode.textContent || "").trim(), 10) : 0;
    const enemies = enemiesNode ? Number.parseInt((enemiesNode.textContent || "").trim(), 10) : 0;
    return {
      coords: coords,
      tileName: nameNode ? (nameNode.textContent || "").trim() : "",
      isCurrentTile: !!(hereNode && (hereNode.textContent || "").toLowerCase().includes("you are here")),
      allies: Number.isFinite(allies) ? allies : 0,
      enemies: Number.isFinite(enemies) ? enemies : 0,
      lootIcons: eventIcons
    };
  }

  // AI CHANGED: Added clockwise 1-ring scan (TR -> TL) using popup counters/icons instead of visual guessing.
  async function scanNeighborRing() {
    // AI CHANGED: Prevent scan start while avatar is still moving.
    await waitUntilNotMoving("scan-start");
    const opened = await ensureMapOpen();
    if (!opened.ok) {
      return { ok: false, reason: "map_not_open" };
    }
    // AI CHANGED: Lock map at min zoom so neighborStepPx=30 maps to real tile centers (calibrated via zoom-tester v0.3).
    ensureMapZoomedOut();
    const centered = await clickCenterMapVerified();
    if (!centered.ok) {
      return { ok: false, reason: "center_failed" };
    }

    const centerClicked = clickMapCenterTile();
    if (!centerClicked) {
      return { ok: false, reason: "center_tile_click_failed" };
    }
    const centerVisible = await waitForCondition(
      "scan center popup",
      () => !!readCurrentCoordsFromPopup(),
      { timeoutMs: 1200, pollMs: 120 }
    );
    if (!centerVisible) {
      return { ok: false, reason: "center_coords_timeout" };
    }
    const baseline = readCurrentCoordsFromPopup();
    if (!baseline) {
      return { ok: false, reason: "center_coords_missing" };
    }

    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const ring = [
      { key: "TR", dx: Math.round(step / 2), dy: -h },
      { key: "R", dx: step, dy: 0 },
      { key: "BR", dx: Math.round(step / 2), dy: h },
      { key: "BL", dx: -Math.round(step / 2), dy: h },
      { key: "L", dx: -step, dy: 0 },
      { key: "TL", dx: -Math.round(step / 2), dy: -h }
    ];

    const results = [];
    let lastObservedCoords = baseline;
    for (let i = 0; i < ring.length; i += 1) {
      const point = ring[i];
      const clicked = clickMapRelative(point.dx, point.dy);
      if (!clicked) {
        results.push({
          key: point.key,
          ok: false,
          clickable: false,
          classification: "blocked",
          reason: "click_failed"
        });
        continue;
      }
      // AI CHANGED: Wait for coordinate change from previously selected tile, not just popup visibility.
      const coordsChangedInTime = await waitForCondition(
        `scan ${point.key} coords change`,
        () => {
          const c = readCurrentCoordsFromPopup();
          return !!(c && (c.x !== lastObservedCoords.x || c.y !== lastObservedCoords.y));
        },
        // AI CHANGED: Use faster polling/timeout for quicker ring scan.
        { timeoutMs: Config.scan.tileTimeoutMs, pollMs: Config.scan.pollMs }
      );
      // AI CHANGED: Classify tiles by coordinate change only, independent of popup detail parsing.
      const currentCoords = readCurrentCoordsFromPopup() || lastObservedCoords;
      const details = readTilePopupDetails();
      const coordsChanged =
        currentCoords.x !== lastObservedCoords.x || currentCoords.y !== lastObservedCoords.y;
      if (!coordsChanged) {
        results.push({
          key: point.key,
          ok: false,
          clickable: false,
          classification: "blocked",
          reason: coordsChangedInTime ? "coords_unchanged" : "coords_unchanged",
          coords: currentCoords
        });
        continue;
      }
      lastObservedCoords = currentCoords;
      results.push({
        key: point.key,
        ok: true,
        clickable: true,
        classification: "walkable",
        // AI CHANGED: Preserve click vector for scan-driven movement decision.
        dx: point.dx,
        dy: point.dy,
        coords: currentCoords,
        tileName: details ? details.tileName : "",
        isCurrentTile: details ? details.isCurrentTile : false,
        allies: details ? details.allies : 0,
        enemies: details ? details.enemies : 0,
        lootIcons: details ? details.lootIcons : []
      });
    }

    const snapshot = {
      ok: true,
      scannedAt: Date.now(),
      results: results
    };
    Runtime.exploration.lastRingScan = snapshot;
    Logger.log("SCAN", "Neighbor ring scan completed", snapshot);
    return snapshot;
  }

  // AI CHANGED: Added coordinate-based movement verification, replacing visual-delta checks.
  async function verifyMoveByCoordinates() {
    const centered = await clickCenterMapVerified();
    if (!centered.ok) {
      return { ok: false, reason: "center_failed" };
    }
    const centerTileClicked = clickMapCenterTile();
    if (!centerTileClicked) {
      return { ok: false, reason: "center_tile_click_failed" };
    }
    const hasCoords = await waitForCondition(
      "coords popup visible",
      () => !!readCurrentCoordsFromPopup(),
      { timeoutMs: 1200, pollMs: 120 }
    );
    if (!hasCoords) {
      return { ok: false, reason: "coords_not_visible" };
    }
    const currentCoords = readCurrentCoordsFromPopup();
    if (!currentCoords) {
      return { ok: false, reason: "coords_parse_failed" };
    }
    if (!Runtime.exploration.lastKnownCoords) {
      Runtime.exploration.lastKnownCoords = currentCoords;
      Logger.log("MOVE", "Initialized last known coordinates", currentCoords);
      // AI CHANGED: Close coords popup after initialization to reveal bottom action controls.
      closeHexPopupIfOpen();
      // AI CHANGED: Initialization is not proof of movement; caller should run one follow-up verify.
      return { ok: false, moved: false, initialized: true, reason: "verify_initialized", coords: currentCoords };
    }
    const prev = Runtime.exploration.lastKnownCoords;
    const moved = currentCoords.x !== prev.x || currentCoords.y !== prev.y;
    if (moved) {
      Runtime.exploration.lastKnownCoords = currentCoords;
      Logger.log("MOVE", "Movement verified by coordinates", { from: prev, to: currentCoords });
      // AI CHANGED: Close coords popup after successful verify to avoid covering combat controls.
      closeHexPopupIfOpen();
      return { ok: true, moved: true, coords: currentCoords, prev: prev };
    }
    Logger.warn("MOVE", "Movement failed by coordinates (unchanged)", { coords: currentCoords });
    // AI CHANGED: Close coords popup even on failed verify so combat UI remains accessible.
    closeHexPopupIfOpen();
    return { ok: false, moved: false, reason: "coords_unchanged", coords: currentCoords, prev: prev };
  }

  // AI CHANGED: Added rotating neighbor target selection around player-centered map.
  function getNextExplorationPoint() {
    const canvas = getMapCanvas();
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const directions = [
      { dx: step, dy: 0 },
      { dx: Math.round(step / 2), dy: h },
      { dx: -Math.round(step / 2), dy: h },
      { dx: -step, dy: 0 },
      { dx: -Math.round(step / 2), dy: -h },
      { dx: Math.round(step / 2), dy: -h }
    ];
    const index = Runtime.exploration.directionIndex % directions.length;
    Runtime.exploration.directionIndex += 1;
    const dir = directions[index];
    return {
      x: cx + dir.dx,
      y: cy + dir.dy,
      directionIndex: index
    };
  }

  // AI CHANGED: Added idle exploration step used when no enemies and no loot are present.
  async function exploreIfIdle() {
    const now = readBasicState();
    if (typeof now.combat.enemyCount !== "number" || now.combat.enemyCount !== 0) {
      return { ok: false, skipped: true, reason: "not_idle" };
    }
    for (let attempt = 1; attempt <= Config.movement.maxExploreAttemptsPerIdle; attempt += 1) {
      const point = getNextExplorationPoint();
      if (!point) {
        return { ok: false, skipped: true, reason: "no_map_canvas" };
      }
      const moved = moveToMapPoint(point.x, point.y);
      if (!moved) {
        return { ok: false, skipped: true, reason: "move_dispatch_failed" };
      }
      await sleep(Config.movement.settleAfterMoveMs);
      const verify = await verifyMoveByCoordinates();
      if (verify.ok) {
        Logger.log("MOVE", "Idle exploration step verified", {
          directionIndex: point.directionIndex,
          attempt: attempt,
          settleMs: Config.movement.settleAfterMoveMs,
          coords: verify.coords
        });
        return { ok: true, moved: true, directionIndex: point.directionIndex, attempt: attempt, verify: verify };
      }
      Logger.warn("MOVE", "Exploration step blocked; trying next direction", {
        directionIndex: point.directionIndex,
        attempt: attempt,
        reason: verify.reason
      });
    }
    return { ok: false, skipped: true, reason: "all_directions_blocked" };
  }

  // AI CHANGED: Added loot/event marker parser (encoded SVG/color/class based) for deterministic priority rules.
  function parseLootKindsFromMarkers(markers) {
    if (!Array.isArray(markers) || markers.length === 0) {
      return [];
    }
    const kinds = [];
    for (let i = 0; i < markers.length; i += 1) {
      const marker = (markers[i] || "").toString().toLowerCase();
      if (!marker) {
        continue;
      }
      // AI CHANGED: Detect contract first (it can share grey color with chest family).
      if (
        marker.includes("viewbox%3d%220%200%2012%2012%22") ||
        marker.includes("stroke-width%3d%221%22") ||
        marker.includes("contract")
      ) {
        kinds.push("contract");
        continue;
      }
      if (
        marker.includes("icon-src-event-goblin") ||
        marker.includes("event-goblin") ||
        marker.includes("assets/icons/event-goblin.svg")
      ) {
        kinds.push("goblin");
        continue;
      }
      if (
        marker.includes("icon-src-mob-type-champion") ||
        marker.includes("mob-type-champion") ||
        marker.includes("assets/icons/mob-type-champion.svg")
      ) {
        kinds.push("boss");
        continue;
      }
      if (marker.includes("%237b2dda") || marker.includes("#7b2dda")) {
        kinds.push("purple_chest");
        continue;
      }
      if (marker.includes("%232d53da") || marker.includes("#2d53da")) {
        kinds.push("blue_chest");
        continue;
      }
      if (
        (marker.includes("broken") && marker.includes("cargo")) ||
        marker.includes("%23c96e2b") ||
        marker.includes("#c96e2b") ||
        marker.includes("viewbox%3d%220%200%2011.1179%2011.1184%22")
      ) {
        kinds.push("broken_cargo");
        continue;
      }
      if (marker.includes("icon-src-shrine") || marker.includes("sanctuary") || marker.includes("altar")) {
        kinds.push("altar");
        continue;
      }
      if (marker.includes("%23a5abb5") || marker.includes("#a5abb5")) {
        kinds.push("grey_chest");
        continue;
      }
      kinds.push("other_loot");
    }
    return kinds;
  }

  // AI CHANGED: Added deterministic priority score matching user-defined rank order with avoid rules.
  function scoreScannedTile(tile) {
    if (!tile || !tile.ok || tile.classification !== "walkable") {
      return -9999;
    }
    const lootKinds = parseLootKindsFromMarkers(tile.lootIcons);
    const enemies = Number.isFinite(tile.enemies) ? tile.enemies : 0;
    const allies = Number.isFinite(tile.allies) ? tile.allies : 0;

    // AI CHANGED: Hard-avoid goblin/boss tiles.
    if (lootKinds.includes("goblin") || lootKinds.includes("boss")) {
      return -500000;
    }

    // AI CHANGED: Apply exact loot ranking:
    // purple chest > blue chest > broken cargo > altar > grey chest > contract > only mobs > empty/allies.
    let base = 0;
    if (lootKinds.includes("purple_chest")) {
      base = 900000;
    } else if (lootKinds.includes("blue_chest")) {
      base = 800000;
    } else if (lootKinds.includes("broken_cargo")) {
      base = 700000;
    } else if (lootKinds.includes("altar")) {
      base = 600000;
    } else if (lootKinds.includes("grey_chest")) {
      base = 500000;
    } else if (lootKinds.includes("contract")) {
      base = 400000;
    } else if (enemies > 0) {
      base = 300000;
    } else {
      base = 100000;
    }

    // AI CHANGED: Contract can stack with any other loot/event type.
    if (lootKinds.includes("contract")) {
      base += 120000;
    }

    // AI CHANGED: If purple chest exists, do not penalize allies (steal attempt policy).
    const alliesPenalty = lootKinds.includes("purple_chest") ? 0 : allies * 400;

    // AI CHANGED: Keep same priority tier, but prefer more mobs and fewer allies unless purple is present.
    return base + enemies * 50 - alliesPenalty;
  }

  // AI CHANGED: Pick best walkable tile from ring scan.
  function chooseBestScannedNeighbor(scanSnapshot) {
    if (!scanSnapshot || !scanSnapshot.ok || !Array.isArray(scanSnapshot.results)) {
      return null;
    }
    const walkable = scanSnapshot.results.filter((tile) => tile.ok && tile.classification === "walkable");
    if (walkable.length === 0) {
      return null;
    }
    walkable.sort((a, b) => scoreScannedTile(b) - scoreScannedTile(a));
    return walkable[0];
  }

  // AI CHANGED: Move by scan result first, fallback to old exploration if needed.
  async function exploreByScan() {
    const now = readBasicState();
    if (typeof now.combat.enemyCount !== "number" || now.combat.enemyCount !== 0) {
      return { ok: false, skipped: true, reason: "not_idle" };
    }
    const scan = await scanNeighborRing();
    if (!scan.ok) {
      return { ok: false, skipped: true, reason: scan.reason || "scan_failed", scan: scan };
    }
    const target = chooseBestScannedNeighbor(scan);
    if (!target) {
      return { ok: false, skipped: true, reason: "no_walkable_neighbor", scan: scan };
    }
    const center = getMapCenterClientPoint();
    // AI CHANGED: Move to selected scan target using double-click movement, not single scan click.
    const moved = center ? moveToMapPoint(center.x + target.dx, center.y + target.dy) : false;
    if (!moved) {
      return { ok: false, skipped: true, reason: "move_dispatch_failed", target: target };
    }
    Logger.log("MOVE", "Scan-selected tile double-clicked", { target: target.key, dx: target.dx, dy: target.dy });
    await sleep(Config.movement.settleAfterMoveMs);
    // AI CHANGED: Keep a single post-move gate before verification; loop entry has its own movement guard.
    await waitUntilNotMoving("post-move");
    let verify = await verifyMoveByCoordinates();
    // AI CHANGED: If verify just initialized baseline, run one immediate follow-up verify before deciding.
    if (verify.initialized) {
      await sleep(260);
      verify = await verifyMoveByCoordinates();
    }
    if (!verify.ok) {
      return { ok: false, skipped: true, reason: verify.reason || "move_verify_failed", target: target, verify: verify };
    }
    Logger.log("MOVE", "Scan-driven movement verified", {
      target: target.key,
      // AI CHANGED: Surface parsed loot kinds in movement logs for live validation of ranking behavior.
      lootKinds: parseLootKindsFromMarkers(target.lootIcons),
      enemies: target.enemies,
      allies: target.allies,
      lootIcons: target.lootIcons,
      coords: verify.coords
    });
    return { ok: true, moved: true, target: target, verify: verify, scan: scan };
  }

  // AI CHANGED: Added adaptive basic-attack clicker using optional selector and fallback text search.
  function clickBasicAttack() {
    if (Config.selectors.basicAttackButton) {
      const strictButton = document.querySelector(Config.selectors.basicAttackButton);
      if (clickElementSafe(strictButton, "basic-attack")) {
        return true;
      }
    }

    const candidates = Array.from(document.querySelectorAll("button, app-button-icon, div, span"));
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      const text = (node.textContent || "").trim().toLowerCase();
      if (!text) {
        continue;
      }
      const looksLikeAttack = text === "attack" || text.includes("basic attack");
      if (!looksLikeAttack) {
        continue;
      }
      if (clickElementSafe(node, "basic-attack")) {
        return true;
      }
    }

    Logger.warn("ACTION", "basic-attack click skipped: no known attack control found");
    return false;
  }

  // AI CHANGED: Added explicit readiness check so combat loop can fail fast if attack selector is missing.
  function isBasicAttackConfigured() {
    if (typeof Config.selectors.basicAttackButton !== "string" || Config.selectors.basicAttackButton.trim() === "") {
      return false;
    }
    try {
      const button = document.querySelector(Config.selectors.basicAttackButton);
      return !!button && isElementVisible(button);
    } catch (error) {
      return false;
    }
  }

  // AI CHANGED: Added helper to save exact attack selector from a manually chosen DOM element.
  function setBasicAttackSelector(selector) {
    if (typeof selector !== "string" || selector.trim() === "") {
      Logger.warn("CONFIG", "basic attack selector not set: empty selector");
      return false;
    }
    try {
      const node = document.querySelector(selector);
      if (!node) {
        Logger.warn("CONFIG", "basic attack selector not set: selector matched nothing", { selector: selector });
        return false;
      }
      Config.selectors.basicAttackButton = selector;
      Logger.log("CONFIG", "basic attack selector set", { selector: selector });
      return true;
    } catch (error) {
      Logger.warn("CONFIG", "basic attack selector not set: invalid selector", {
        selector: selector,
        error: error && error.message ? error.message : String(error)
      });
      return false;
    }
  }

  // AI CHANGED: Added generic async waiter so actions can be verified against state changes.
  function waitForCondition(label, predicate, options) {
    const timeoutMs = options && options.timeoutMs ? options.timeoutMs : Config.verification.timeoutMs;
    const pollMs = options && options.pollMs ? options.pollMs : Config.verification.pollMs;
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        let passed = false;
        try {
          passed = !!predicate();
        } catch (error) {
          Logger.warn("VERIFY", `${label} predicate threw`, error);
          passed = false;
        }
        if (passed) {
          Logger.log("VERIFY", `${label} confirmed`, { elapsedMs: Date.now() - start });
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          Logger.warn("VERIFY", `${label} timed out`, { timeoutMs: timeoutMs });
          resolve(false);
          return;
        }
        setTimeout(tick, pollMs);
      };
      tick();
    });
  }

  // AI CHANGED: Added click+verify helper for find enemy flow.
  async function clickFindEnemyVerified() {
    const clicked = clickFindEnemy();
    if (!clicked) {
      return { ok: false, clicked: false, verified: false, reason: "click_failed" };
    }
    const verified = await waitForCondition("find-enemy effect", () => {
      const now = readBasicState();
      // AI CHANGED: Verify only by target HP; enemy count may not change before first attack.
      return !!(now.combat.targetHp && now.combat.targetHp.valid);
    });
    return { ok: verified, clicked: true, verified: verified };
  }

  // AI CHANGED: Added click+verify helper for loot/activate flow.
  async function clickLootOrActivateVerified() {
    const lootElementBeforeClick = document.querySelector(Config.selectors.lootButton);
    // AI CHANGED: Treat "no loot button present" as a valid no-op because many tiles have no loot.
    if (!lootElementBeforeClick) {
      Logger.log("LOOT", "No loot/activate button on current tile; skipping loot step");
      return { ok: true, clicked: false, verified: true, skipped: true, reason: "no_loot_available" };
    }
    const clicked = clickLootOrActivate();
    if (!clicked) {
      return { ok: false, clicked: false, verified: false, reason: "click_failed" };
    }
    // AI CHANGED: After loot click — ensure map open, recenter, select current tile, then wait until loot UI is gone.
    const mapOpened = await ensureMapOpen();
    if (!mapOpened.ok) {
      Logger.warn("LOOT", "Loot follow-up: map open failed", mapOpened);
      return { ok: false, clicked: true, verified: false, reason: "map_open_failed_after_loot", map: mapOpened };
    }
    const centered = await clickCenterMapVerified();
    if (!centered.ok) {
      Logger.warn("LOOT", "Loot follow-up: center map failed", centered);
      return { ok: false, clicked: true, verified: false, reason: "center_failed_after_loot", center: centered };
    }
    clickMapCenterTile();
    // AI CHANGED: Hybrid settle — battle status (Opening/Activating) + stable absence of highlight loot button.
    const verified = await waitForLootInteractionSettled();
    return { ok: verified, clicked: true, verified: verified, waitedForLootGone: true };
  }

  // AI CHANGED: Added center-map verification wrapper for reliable map recentering.
  async function clickCenterMapVerified() {
    const clicked = clickCenterMap();
    if (!clicked) {
      return { ok: false, clicked: false, verified: false, reason: "click_failed" };
    }
    const verified = await waitForCondition("center-map effect", () => {
      const button = document.querySelector(Config.selectors.centerMapButton);
      // Center action has no obvious state field, so confirmation is "control remains available and visible after click".
      return !!button && isElementVisible(button);
    }, { timeoutMs: 1200, pollMs: 120 });
    return { ok: verified, clicked: true, verified: verified };
  }

  // AI CHANGED: Added map-open helper that retries toggle and confirms center control is available.
  async function ensureMapOpen() {
    const centerAlreadyVisible = (() => {
      const centerButton = document.querySelector(Config.selectors.centerMapButton);
      return !!centerButton && isElementVisible(centerButton);
    })();
    if (centerAlreadyVisible) {
      Logger.log("MAP", "Map already open");
      return { ok: true, action: "already_open" };
    }

    const toggled = clickMapToggle();
    if (!toggled) {
      return { ok: false, action: "toggle_failed" };
    }

    const opened = await waitForCondition("map open", () => {
      const centerButton = document.querySelector(Config.selectors.centerMapButton);
      return !!centerButton && isElementVisible(centerButton);
    }, { timeoutMs: 1800, pollMs: 120 });

    if (!opened) {
      Logger.warn("MAP", "Map open verification failed");
      return { ok: false, action: "open_verify_failed" };
    }
    Logger.log("MAP", "Map opened");
    return { ok: true, action: "opened" };
  }

  // AI CHANGED: Kept helper for optional diagnostics; core loop no longer hard-blocks on this.
  async function waitForTargetAcquired() {
    return waitForCondition("target acquired", () => {
      const now = readBasicState();
      return now.combat.targetHp && now.combat.targetHp.valid;
    });
  }

  // AI CHANGED: Added helper to verify attack effect by enemy count drop or target HP change.
  async function attackUntilProgress(beforeState) {
    let previous = beforeState;
    let missingAttackControl = false;
    for (let i = 0; i < Config.combat.maxAttackAttempts; i += 1) {
      // AI CHANGED: Click attack once per found enemy, then wait only for enemyCount drop.
      if (i === 0) {
        const attackClicked = clickBasicAttack();
        if (!attackClicked) {
          missingAttackControl = true;
          break;
        }
      }
      const enemyDropped = await waitForCondition(
        "attack progress",
        () => {
          const now = readBasicState();
          const dropped =
            typeof previous.combat.enemyCount === "number" &&
            typeof now.combat.enemyCount === "number" &&
            now.combat.enemyCount < previous.combat.enemyCount;
          if (dropped) {
            previous = now;
            return true;
          }
          return false;
        },
        { timeoutMs: 4500, pollMs: 140 }
      );
      if (enemyDropped) {
        return true;
      }
      if (i === 0) {
        Logger.warn("LOOP", "Enemy count did not drop after single attack click");
        return false;
      }
    }
    if (missingAttackControl) {
      Logger.warn("LOOP", "Attack loop aborted: missing attack control selector");
    }
    return false;
  }

  // AI CHANGED: Added first autonomous secure-current-tile-and-loot cycle with bounded retries.
  async function secureTileAndLootOnce() {
    const startState = readBasicState();
    if (typeof startState.combat.enemyCount !== "number") {
      Logger.warn("LOOP", "Cannot start secure loop: enemyCount unavailable");
      return { ok: false, stage: "precheck", reason: "enemy_count_unavailable" };
    }

    Logger.log("LOOP", "Secure-tile cycle started", { enemyCount: startState.combat.enemyCount });
    // AI CHANGED: Ensure popup is closed before combat/find actions so attack control is not obscured.
    closeHexPopupIfOpen();

    // AI CHANGED: Removed strict visibility precheck; attack control can appear only after target selection.

    let current = startState;
    let findAttempts = 0;
    while (current.combat.enemyCount > 0 && findAttempts < Config.combat.maxFindEnemyAttempts) {
      findAttempts += 1;
      Logger.log("LOOP", "Find-enemy attempt", { attempt: findAttempts, enemyCount: current.combat.enemyCount });

      const findResult = await clickFindEnemyVerified();
      if (!findResult.ok) {
        Logger.warn("LOOP", "Find-enemy verification failed", findResult);
        current = readBasicState();
        continue;
      }

      // AI CHANGED: Do not hard-require target HP acquisition; enemyCount-based combat is more reliable.
      const acquired = await waitForTargetAcquired();
      if (!acquired) {
        Logger.warn("LOOP", "Target HP not detected after find-enemy; proceeding by enemy-count logic");
      }

      // AI CHANGED: Skip attack step when enemy count already reached zero after find flow.
      current = readBasicState();
      if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
        Logger.log("LOOP", "Enemies already cleared after find-enemy, skipping attack step");
        break;
      }

      const beforeAttack = readBasicState();
      const attackProgressed = await attackUntilProgress(beforeAttack);
      if (!attackProgressed) {
        Logger.warn("LOOP", "No attack progress detected in current cycle");
      }

      current = readBasicState();
      Logger.log("LOOP", "Combat state after cycle", {
        enemyCount: current.combat.enemyCount,
        targetHp: current.combat.targetHp
      });
    }

    if (current.combat.enemyCount > 0) {
      Logger.warn("LOOP", "Secure loop stopped with enemies still alive", {
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      });
      return { ok: false, stage: "combat", enemyCount: current.combat.enemyCount, attempts: findAttempts };
    }

    const lootResult = await clickLootOrActivateVerified();
    if (!lootResult.ok) {
      Logger.warn("LOOP", "Loot verification failed", lootResult);
      return { ok: false, stage: "loot", result: lootResult };
    }
    if (lootResult.skipped) {
      Logger.log("LOOP", "Secure-tile cycle completed (no loot on tile)");
      return { ok: true, stage: "done_no_loot", loot: lootResult };
    }

    Logger.log("LOOP", "Secure-tile cycle completed");
    return { ok: true, stage: "done" };
  }

  // AI CHANGED: Map prep only before each combat cycle; ring scan lives in exploreByScan/scanNeighborRing, not here.
  async function prepMapForCombatCycle() {
    const mapResult = await ensureMapOpen();
    if (!mapResult.ok) {
      Logger.warn("MAP", "Prep for combat cycle failed: map not available", mapResult);
      return { ok: false, stage: "map_open", map: mapResult };
    }
    Logger.log("MAP", "Map ready for combat cycle", mapResult);
    return { ok: true, stage: "map_ready", map: mapResult };
  }

  // AI CHANGED: Kept name for Tampermonkey/GUI compatibility; forwards to prepMapForCombatCycle (no scan placeholder).
  async function prepareAndScanOnce() {
    return prepMapForCombatCycle();
  }

  // AI CHANGED: Updated cycle runner to map-prep then secure+loot (tactical scan only in exploreByScan).
  async function runPreparedSecureCycle() {
    const prepMap = await prepMapForCombatCycle();
    if (!prepMap.ok) {
      return { ok: false, stage: prepMap.stage, prep: prepMap };
    }

    const secureResult = await secureTileAndLootOnce();
    return {
      ok: !!secureResult.ok,
      stage: secureResult.stage,
      prep: prepMap,
      secure: secureResult
    };
  }

  // AI CHANGED: Added status API for external visibility into auto-farm loop health.
  function getAutoFarmStatus() {
    const status = Runtime.autoFarm;
    return {
      running: status.running,
      stopRequested: status.stopRequested,
      cyclesCompleted: status.cyclesCompleted,
      consecutiveFailures: status.consecutiveFailures,
      lastResult: status.lastResult,
      startedAt: status.startedAt
    };
  }

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

    const title = document.createElement("div");
    title.textContent = "Ligmar Bot Control";
    title.style.fontWeight = "700";
    title.style.marginBottom = "8px";
    panel.appendChild(title);

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

  // AI CHANGED: Added stop API to gracefully halt loop after current cycle.
  function stopAutoFarmLoop() {
    if (!Runtime.autoFarm.running) {
      Logger.log("AUTO", "Auto-farm loop already stopped");
      return { ok: true, running: false, message: "already_stopped" };
    }
    Runtime.autoFarm.stopRequested = true;
    Logger.log("AUTO", "Stop requested for auto-farm loop");
    return { ok: true, running: true, message: "stop_requested" };
  }

  // AI CHANGED: Added controlled repeat runner with auto-stop on repeated failures.
  async function startAutoFarmLoop() {
    if (Runtime.autoFarm.running) {
      Logger.warn("AUTO", "Auto-farm loop already running");
      return { ok: false, reason: "already_running", status: getAutoFarmStatus() };
    }

    Runtime.autoFarm.running = true;
    Runtime.autoFarm.stopRequested = false;
    Runtime.autoFarm.cyclesCompleted = 0;
    Runtime.autoFarm.consecutiveFailures = 0;
    Runtime.autoFarm.lastResult = null;
    Runtime.autoFarm.startedAt = Date.now();

    Logger.log("AUTO", "Auto-farm loop started", {
      cycleDelayMs: Config.farmLoop.cycleDelayMs,
      maxConsecutiveFailures: Config.farmLoop.maxConsecutiveFailures
    });

    while (Runtime.autoFarm.running && !Runtime.autoFarm.stopRequested) {
      // AI CHANGED: Block new cycle start until movement bar clears to avoid scan-vs-move overlap.
      await waitUntilNotMoving("auto-loop");
      const cycleResult = await runPreparedSecureCycle();
      Runtime.autoFarm.lastResult = cycleResult;
      Runtime.autoFarm.cyclesCompleted += 1;

      if (cycleResult && cycleResult.ok) {
        Runtime.autoFarm.consecutiveFailures = 0;
        Logger.log("AUTO", "Cycle completed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else {
        Runtime.autoFarm.consecutiveFailures += 1;
        Logger.warn("AUTO", "Cycle failed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
          stage: cycleResult ? cycleResult.stage : "unknown"
        });
      }

      if (Runtime.autoFarm.consecutiveFailures >= Config.farmLoop.maxConsecutiveFailures) {
        Logger.warn("AUTO", "Auto-farm loop stopped after repeated failures", {
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures
        });
        Runtime.autoFarm.stopRequested = true;
        break;
      }

      if (!Runtime.autoFarm.stopRequested) {
        // AI CHANGED: Back off when we're idling on empty tiles to avoid spammy repeated actions.
        const nowState = readBasicState();
        const shouldIdleBackoff =
          cycleResult &&
          cycleResult.ok &&
          cycleResult.stage === "done_no_loot" &&
          typeof nowState.combat.enemyCount === "number" &&
          nowState.combat.enemyCount === 0;
        if (shouldIdleBackoff) {
          // AI CHANGED: Prefer scan-driven movement while idling on empty tile.
          let moveResult = await exploreByScan();
          if (!moveResult.ok) {
            // AI CHANGED: Keep legacy fallback so loop remains resilient if scan path fails.
            moveResult = await exploreIfIdle();
          }
          if (moveResult.ok) {
            Logger.log("AUTO", "Idle exploration movement completed", moveResult);
            await sleep(Config.farmLoop.cycleDelayMs);
            continue;
          }
          Logger.log("AUTO", "Idle backoff delay applied", {
            delayMs: Config.farmLoop.idleNoEnemyDelayMs,
            reason: moveResult.reason
          });
          await sleep(Config.farmLoop.idleNoEnemyDelayMs);
          continue;
        }
        await sleep(Config.farmLoop.cycleDelayMs);
      }
    }

    Runtime.autoFarm.running = false;
    const finalStatus = getAutoFarmStatus();
    Logger.log("AUTO", "Auto-farm loop exited", finalStatus);
    return { ok: true, status: finalStatus };
  }

  // AI CHANGED: Added basic state read loop for immediate visibility into runtime reads.
  function readBasicState() {
    const hpNode = document.querySelector(Config.selectors.hpText);
    const mpNode = document.querySelector(Config.selectors.mpText);
    const pingNode = document.querySelector(Config.selectors.pingText);
    // AI CHANGED: Read enemy HP directly from red condition bar when available.
    const targetHpNode = document.querySelector(Config.selectors.targetHpText);
    const deathScreenNode = document.querySelector(Config.selectors.deathScreen);
    const poorConnectionNode = document.querySelector(Config.selectors.poorConnection);

    const hpText = hpNode ? hpNode.textContent || "" : "";
    const mpText = mpNode ? mpNode.textContent || "" : "";
    let hp = parseFractionText(hpText);
    let mp = parseFractionText(mpText);

    // AI CHANGED: Fallback to inferred fraction nodes when configured selectors are unknown.
    const fractionCandidates = getFractionCandidates();
    const inferred = inferFractionRoles(fractionCandidates);
    if (!hp.valid && inferred.hp) {
      hp = inferred.hp.parsed;
    }
    if (!mp.valid && inferred.mp) {
      mp = inferred.mp.parsed;
    }

    // AI CHANGED: Switched to dedicated enemy counter parser using real selector.
    const enemyCount = readEnemyCount();
    // AI CHANGED: Prefer direct enemy HP selector, fallback to inferred target HP.
    const directTargetHpText = targetHpNode ? targetHpNode.textContent || "" : "";
    const directTargetHp = parseFractionText(directTargetHpText);
    const resolvedTargetHp = directTargetHp.valid
      ? directTargetHp
      : inferred.targetHp
        ? inferred.targetHp.parsed
        : { cur: 0, max: 0, pct: 0, valid: false };

    const pingRaw = pingNode ? (pingNode.textContent || "").replace(/[^\d]/g, "") : "";
    const pingFromSelector = Number.parseInt(pingRaw, 10);
    let pingMs = Number.isFinite(pingFromSelector) ? pingFromSelector : null;
    if (!Number.isFinite(pingMs)) {
      const bodyText = document.body ? document.body.textContent || "" : "";
      const pingMatch = bodyText.match(/(\d+)\s*ms/i);
      pingMs = pingMatch ? parseFirstInt(pingMatch[1]) : null;
    }

    return {
      time: Date.now(),
      session: {
        inGame: isGamePage(),
        dead: !!deathScreenNode,
        poorConnection: !!poorConnectionNode
      },
      player: {
        hp: hp,
        mp: mp
      },
      combat: {
        enemyCount: enemyCount,
        targetHp: resolvedTargetHp
      },
      network: {
        pingMs: Number.isFinite(pingMs) ? pingMs : null
      },
      debug: {
        fractionCandidateCount: fractionCandidates.length,
        inferredHpNode: inferred.hp ? { text: inferred.hp.text, x: inferred.hp.x, y: inferred.hp.y } : null,
        inferredMpNode: inferred.mp ? { text: inferred.mp.text, x: inferred.mp.x, y: inferred.mp.y } : null,
        inferredTargetHpNode: inferred.targetHp ? { text: inferred.targetHp.text, x: inferred.targetHp.x, y: inferred.targetHp.y } : null
      }
    };
  }

  // AI CHANGED: Added startup routine and optional debug helpers for manual testing.
  function start() {
    if (!isGamePage()) {
      Logger.warn("BOOT", "Not on /game/ page. Script idle.");
      return;
    }

    Logger.log("BOOT", "bot loaded");
    probeSelectors();

    window.ligmarBot = {
      config: Config,
      logger: Logger,
      probeSelectors: probeSelectors,
      readBasicState: readBasicState,
      discoverFractionNodes: discoverFractionNodes,
      discoverButtons: discoverButtons,
      readEnemyCount: readEnemyCount,
      clickFindEnemy: clickFindEnemy,
      clickLootOrActivate: clickLootOrActivate,
      waitForCondition: waitForCondition,
      clickFindEnemyVerified: clickFindEnemyVerified,
      clickLootOrActivateVerified: clickLootOrActivateVerified,
      clickCenterMap: clickCenterMap,
      clickCenterMapVerified: clickCenterMapVerified,
      clickMapToggle: clickMapToggle,
      ensureMapOpen: ensureMapOpen,
      // AI CHANGED: Expose zoom helpers so user can re-trigger max zoom-out after reload/death without restarting bot.
      ensureMapZoomedOut: ensureMapZoomedOut,
      forceZoomOut: forceZoomOut,
      getMapCanvas: getMapCanvas,
      moveToMapPoint: moveToMapPoint,
      exploreIfIdle: exploreIfIdle,
      scanNeighborRing: scanNeighborRing,
      clickBasicAttack: clickBasicAttack,
      isBasicAttackConfigured: isBasicAttackConfigured,
      setBasicAttackSelector: setBasicAttackSelector,
      secureTileAndLootOnce: secureTileAndLootOnce,
      prepMapForCombatCycle: prepMapForCombatCycle,
      prepareAndScanOnce: prepareAndScanOnce,
      runPreparedSecureCycle: runPreparedSecureCycle,
      startAutoFarmLoop: startAutoFarmLoop,
      stopAutoFarmLoop: stopAutoFarmLoop,
      getAutoFarmStatus: getAutoFarmStatus,
      createControlPanel: createControlPanel,
      updateControlPanelStatus: updateControlPanelStatus
    };

    Logger.log("BOOT", "Debug API exposed as window.ligmarBot");
    // AI CHANGED: Auto-create GUI control panel at startup.
    createControlPanel();

    setInterval(() => {
      const state = readBasicState();
      if (Config.logging.stateSnapshots) {
        Logger.log("STATE", "Basic snapshot", state);
      }
    }, Config.tickMs);
  }

  start();
})();