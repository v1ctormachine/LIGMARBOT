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

  // AI CHANGED: Queue v2 trigger — read all visible non-fraction canvas-condition-bar labels so queueing can react to the real cast name ("Sniper Shot", "Attack", etc.).
  function readVisibleCombatCastBarTexts() {
    const nodes = Array.from(document.querySelectorAll(Config.selectors.movingBarValue));
    const out = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length; i += 1) {
      const span = nodes[i];
      if (!span || !span.isConnected) {
        continue;
      }
      const host = span.closest("app-canvas-condition-bar") || span;
      if (!isElementVisible(host)) {
        continue;
      }
      const text = (span.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) {
        continue;
      }
      if (parseFractionText(text).valid) {
        continue;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(text);
    }
    const battleText = readBattleStatusBarText();
    if (battleText && !parseFractionText(battleText).valid) {
      const battleKey = battleText.toLowerCase();
      if (!seen.has(battleKey)) {
        out.unshift(battleText);
      }
    }
    return out;
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

  // AI CHANGED: slice 24b — find visible “Press to cancel” (or configured substrings) on charge UI.
  function findChargingSkillCancelHintElement() {
    const subs = Config.combat.chargingCancelHintSubstrings;
    if (!Array.isArray(subs) || subs.length === 0) {
      return null;
    }
    const rootSel =
      typeof Config.combat.chargingCancelHintScanRoot === "string" && Config.combat.chargingCancelHintScanRoot.trim()
        ? Config.combat.chargingCancelHintScanRoot.trim()
        : "app-game";
    const root = document.querySelector(rootSel);
    if (!root) {
      return null;
    }
    const nodes = root.querySelectorAll("span.status-description, .status-description");
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!el || !isElementVisible(el)) {
        continue;
      }
      const t = (el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
      for (let j = 0; j < subs.length; j += 1) {
        const sub = String(subs[j] || "").toLowerCase();
        if (sub && t.indexOf(sub) !== -1) {
          return el;
        }
      }
    }
    return null;
  }

  function isChargingSkillCancelHintVisible() {
    return !!findChargingSkillCancelHintElement();
  }

  // AI CHANGED: slice 24b — element to click for charge cancel (explicit selectors first, else ancestor button / role=button, else hint node).
  // AI CHANGED: Midpoint in the gap between map-open button and map canvas (viewport coords) — game treats as empty UI; cancels charge.
  function getChargeCancelMapGapClientPoint() {
    const btnSel =
      typeof Config.selectors.mapToggleButton === "string" && Config.selectors.mapToggleButton.trim()
        ? Config.selectors.mapToggleButton.trim()
        : "app-button-icon.button-map";
    const cvSel =
      typeof Config.selectors.mapCanvas === "string" && Config.selectors.mapCanvas.trim()
        ? Config.selectors.mapCanvas.trim()
        : "app-game canvas";
    const btn = document.querySelector(btnSel);
    const canvas = document.querySelector(cvSel);
    if (!btn || !canvas || !isElementVisible(btn) || !isElementVisible(canvas)) {
      return null;
    }
    const a = btn.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    let x;
    let y;
    if (a.right <= b.left) {
      x = (a.right + b.left) / 2;
      const yTop = Math.max(a.top, b.top);
      const yBot = Math.min(a.bottom, b.bottom);
      y = yBot > yTop ? (yTop + yBot) / 2 : (a.top + a.bottom + b.top + b.bottom) / 4;
    } else if (b.right <= a.left) {
      x = (b.right + a.left) / 2;
      const yTop = Math.max(a.top, b.top);
      const yBot = Math.min(a.bottom, b.bottom);
      y = yBot > yTop ? (yTop + yBot) / 2 : (a.top + a.bottom + b.top + b.bottom) / 4;
    } else if (a.bottom <= b.top) {
      y = (a.bottom + b.top) / 2;
      const xLeft = Math.max(a.left, b.left);
      const xRight = Math.min(a.right, b.right);
      x = xRight > xLeft ? (xLeft + xRight) / 2 : (a.left + a.right + b.left + b.right) / 4;
    } else if (b.bottom <= a.top) {
      y = (b.bottom + a.top) / 2;
      const xLeft = Math.max(a.left, b.left);
      const xRight = Math.min(a.right, b.right);
      x = xRight > xLeft ? (xLeft + xRight) / 2 : (a.left + a.right + b.left + b.right) / 4;
    } else {
      x = (a.right + b.left) / 2;
      y = (a.top + a.bottom + b.top + b.bottom) / 4;
    }
    const margin = 2;
    const clampedX = Math.min(Math.max(x, margin), window.innerWidth - margin);
    const clampedY = Math.min(Math.max(y, margin), window.innerHeight - margin);
    return { clientX: clampedX, clientY: clampedY };
  }

  function clickChargeCancelViaMapToggleCanvasGap() {
    const pt = getChargeCancelMapGapClientPoint();
    if (!pt) {
      Logger.warn("COMBAT", "charge cancel map-gap: map button or canvas missing / not visible");
      return false;
    }
    return dispatchClickAt(pt.clientX, pt.clientY, "charge-cancel-map-gap");
  }

  function getChargingSkillCancelClickTarget() {
    const hint = findChargingSkillCancelHintElement();
    if (!hint) {
      return null;
    }
    const explicit = Config.combat.chargingCancelClickSelectors;
    if (Array.isArray(explicit) && explicit.length > 0) {
      for (let e = 0; e < explicit.length; e += 1) {
        const sel = String(explicit[e] || "").trim();
        if (!sel) {
          continue;
        }
        const el = document.querySelector(sel);
        if (el && isElementVisible(el)) {
          return el;
        }
      }
    }
    const maxUp = Number.isFinite(Config.combat.chargingCancelParentWalkMax)
      ? Config.combat.chargingCancelParentWalkMax
      : 14;
    let node = hint;
    for (let u = 0; u < maxUp && node; u += 1) {
      const tag = (node.tagName || "").toLowerCase();
      const role = (node.getAttribute && node.getAttribute("role")) || "";
      if (tag === "button" || role.toLowerCase() === "button") {
        return node;
      }
      if (tag === "a") {
        const href = node.getAttribute ? node.getAttribute("href") : null;
        if (href && href !== "#") {
          return node;
        }
      }
      node = node.parentElement;
    }
    return hint;
  }

  // AI CHANGED: slice 24b — cancel charge: prefer map-toggle/canvas gap click; else DOM cancel control (not bar slot).
  function clickChargingSkillCancelUi() {
    if (Config.combat.chargingCancelPreferMapGapClick !== false) {
      if (clickChargeCancelViaMapToggleCanvasGap()) {
        return true;
      }
      Logger.log("COMBAT", "charge cancel: map-gap click failed; trying DOM cancel target");
    }
    const target = getChargingSkillCancelClickTarget();
    if (!target) {
      Logger.warn("COMBAT", "charge cancel: no DOM click target (hint missing or selectors unmatched)");
      return false;
    }
    return clickElementSafe(target, "charge-cancel-ui");
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

  // AI CHANGED: Added basic state read loop for immediate visibility into runtime reads.
  function readBasicState() {
    const hpNode = document.querySelector(Config.selectors.hpText);
    const mpNode = document.querySelector(Config.selectors.mpText);
    const pingNode = document.querySelector(Config.selectors.pingText);
    // AI CHANGED: Read enemy HP directly from red condition bar when available.
    const targetHpNode = document.querySelector(Config.selectors.targetHpText);
    const deathScreenNode = document.querySelector(Config.selectors.deathScreen);
    const poorConnectionNode = document.querySelector(Config.selectors.poorConnection);
    const gameRootNode = document.querySelector(Config.selectors.gameRoot);
    const actionBarNode = document.querySelector(Config.selectors.actionBar);
    const mapToggleNode = document.querySelector(Config.selectors.mapToggleButton);
    const mapCanvasNode = document.querySelector(Config.selectors.mapCanvas);
    const findEnemyNode = document.querySelector(Config.selectors.findEnemyButton);

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

    const gameRootVisible = !!(gameRootNode && isElementVisible(gameRootNode));
    const actionBarVisible = !!(actionBarNode && isElementVisible(actionBarNode));
    const mapToggleVisible = !!(mapToggleNode && isElementVisible(mapToggleNode));
    const mapCanvasVisible = !!(mapCanvasNode && isElementVisible(mapCanvasNode));
    const findEnemyVisible = !!(findEnemyNode && isElementVisible(findEnemyNode));
    const coreUiVisible = !!(gameRootVisible && (actionBarVisible || mapToggleVisible || mapCanvasVisible || findEnemyVisible));
    const coreUiMissing = !coreUiVisible;

    return {
      time: Date.now(),
      session: {
        inGame: isGamePage(),
        dead: !!deathScreenNode,
        poorConnection: !!poorConnectionNode,
        coreUi: {
          gameRootVisible: gameRootVisible,
          actionBarVisible: actionBarVisible,
          mapToggleVisible: mapToggleVisible,
          mapCanvasVisible: mapCanvasVisible,
          findEnemyVisible: findEnemyVisible,
          visible: coreUiVisible,
          missing: coreUiMissing
        }
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
        inferredTargetHpNode: inferred.targetHp ? { text: inferred.targetHp.text, x: inferred.targetHp.x, y: inferred.targetHp.y } : null,
        coreUiVisible: coreUiVisible
      }
    };
  }
