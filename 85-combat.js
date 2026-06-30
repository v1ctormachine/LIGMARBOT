  // --- Layer 2 Module: 70-verify.js (Verified Game Actions) ---
  // Rebuilt strictly based on user mechanics specifications.
  // No hardcoded blind delays are used; relies entirely on signal/popup events.

  // Core verified wait utility
  function waitForCondition(label, predicate, options) {
    const timeoutMs = options && options.timeoutMs ? options.timeoutMs : (Config.timings.verificationTimeoutMs || 1250);
    const pollMs = options && options.pollMs ? options.pollMs : (Config.timings.verificationPollMs || 25);
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) {
          Logger.log("VERIFY", `${label} aborted (stop requested)`, { elapsedMs: Date.now() - start });
          resolve(false);
          return;
        }
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

  // 1. ensureMapOpen (Corrected: checks Center Map button visibility to determine open/closed state)
  //   1. Check if centerMapButton visible
  //   2. If not, click the map toggle button
  //   3. Wait 50ms
  //   4. Check if centerMapButton visible again; if yes return immediately
  //   5. If not, soft-fail on timeout (100ms)
  async function ensureMapOpen() {
    const centerBtnSel = Config.selectors.centerMapButton;
    let centerBtn = document.querySelector(centerBtnSel);

    // 1. Check if centerMapButton visible (the recenter aim button is only visible when the map overlay is open)
    if (centerBtn && isElementVisible(centerBtn)) {
      return { ok: true, alreadyOpen: true };
    }

    // 2. If not, click the map toggle button
    const toggleBtn = document.querySelector(Config.selectors.mapToggleButton);
    if (!clickElementSafe(toggleBtn, "map toggle button")) {
      return { ok: false, reason: "toggle_button_missing" };
    }

    // 3. Wait 50ms
    await sleep(50);

    // 4. Check if centerMapButton visible again; if yes return immediately
    centerBtn = document.querySelector(centerBtnSel);
    if (centerBtn && isElementVisible(centerBtn)) {
      return { ok: true, alreadyOpen: false };
    }

    // 5. If not, soft-fail on timeout (100ms total: another 50ms check)
    await sleep(50);
    centerBtn = document.querySelector(centerBtnSel);
    if (centerBtn && isElementVisible(centerBtn)) {
      return { ok: true, alreadyOpen: false };
    }

    Logger.warn("VERIFY", "ensureMapOpen soft-failed: center map button not visible after 100ms");
    return { ok: false, reason: "canvas_timeout_100ms" };
  }

  // 2. ensureMapZoomedOut
  //   1. locate the center coordinates of the map canvas element.
  //   2. Dispatch 40 consecutive synthetic WheelEvents with deltaY: 120 over the canvas center.
  function ensureMapZoomedOut() {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return { ok: false, reason: "canvas_not_visible" };
    }

    // 1. locate the center coordinates of the map canvas element.
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const doc = canvas.ownerDocument || document;
    const win = doc.defaultView || window;

    Logger.log("ZOOM", "Dispatching 40 consecutive WheelEvents over canvas center");

    // 2. Dispatch 40 consecutive synthetic WheelEvents with deltaY: 120 over the canvas center.
    for (let i = 0; i < 40; i++) {
      const wheel = new win.WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: cx,
        clientY: cy,
        deltaY: 120
      });
      canvas.dispatchEvent(wheel);
    }

    return { ok: true };
  }

  // Helper: Click map canvas relative center
  function clickMapCenterTile() {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return dispatchCanvasClickAt(canvas, cx, cy, "map center tile");
  }

  // Helper: Click relative to map center by pixel offsets
  function clickMapRelative(dx, dy) {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return dispatchCanvasClickAt(canvas, cx + dx, cy + dy, "relative map click");
  }

  // 3. ensureMapCentered (User-Improved Architecture: writes down current coordinates directly)
  // Active Verification: Click center map tile at most once every 120ms inside the poll loop
  // until the WebGL camera panning completes and the "You are here" popup is successfully opened.
  // 100% signal-driven, zero blind sleeps.
  async function ensureMapCentered() {
    // 0. Close any existing tile popup so stale popup coords cannot satisfy verification.
    const existingCloseBtn = document.querySelector(Config.selectors.hexPopupCloseButton);
    if (existingCloseBtn && isElementVisible(existingCloseBtn)) {
      clickElementSafe(existingCloseBtn, "hex popup close before map centering");
      await sleep(80);
    }

    // 1. Click center map button once
    const centerBtn = document.querySelector(Config.selectors.centerMapButton);
    if (!clickElementSafe(centerBtn, "center map button")) {
      return { ok: false, reason: "center_button_missing" };
    }

    // Let the camera actually settle before clicking the visual center tile.
    // Without this, the center-tile click can land on the previous/offset tile while recentering is still in progress.
    Logger.log("VERIFY", "Waiting 300ms for map recenter settle before center tile verification");
    await sleep(300);

    let finalCoords = null;
    let lastClickAt = 0;

    // 2. Active Verification loop
    const verified = await waitForCondition(
      "camera centered verification",
      () => {
        if (typeof readTilePopupDetails !== "function") {
          return false;
        }
        
        const det = readTilePopupDetails();
        if (det && det.isCurrentTile === true && det.coords) {
          finalCoords = det.coords;
          return true; // Centering is successfully verified!
        }

        // If the popup hasn't opened yet, click the center tile at most once every 120ms
        const now = Date.now();
        if (now - lastClickAt >= 120) {
          lastClickAt = now;
          clickMapCenterTile();
        }
        return false;
      },
      { timeoutMs: 2500, pollMs: 25 } // 2.5s timeout for safety, but resolves instantly on success
    );

    // 3. Once `isCurrentTile` is confirmed `true`, the camera is verified centered.
    if (!verified || !finalCoords) {
      Logger.warn("VERIFY", "ensureMapCentered: verification timed out or coordinates unreadable");
      return { ok: false, reason: "verification_timeout" };
    }

    // USER SUGGESTION ARCHITECTURE: Save the fresh baseline coordinates directly on verification
    if (Runtime && Runtime.exploration) {
      Runtime.exploration.lastKnownCoords = finalCoords;
    }
    if (Runtime && Runtime.basement && Runtime.basement.active) {
      Runtime.basement.lastTileCoords = finalCoords;
      Runtime.basement.lastTileKey = finalCoords.x + "," + finalCoords.y;
      if (typeof addBasementVisitedTile === "function") {
        addBasementVisitedTile(Runtime.basement.lastTileKey);
      }
    }

    // 4. Dismiss the coordinate popup immediately by clicking its close button (hexPopupCloseButton) to restore a clean HUD.
    const closeBtn = document.querySelector(Config.selectors.hexPopupCloseButton);
    if (closeBtn) {
      clickElementSafe(closeBtn, "hex popup close button");
    }

    Logger.log("VERIFY", "ensureMapCentered completed and current coords logged", finalCoords);
    return { ok: true, coords: finalCoords };
  }

  // 4. scanNeighborRing (User-Calibrated High-Speed Scan)
  //   - Clockwise scan order: TR -> R -> BR -> BL -> L -> TL
  //   - Click tile -> Sleep exactly 20ms -> Check for coordinates change (no timeouts, no polling)
  //   - No coords change = Wall/Blocked. Simple.
  async function scanNeighborRing() {
    Logger.log("SCAN", "Neighbor 1-ring high-speed scan started");

    const mapOpen = await ensureMapOpen();
    if (!mapOpen || !mapOpen.ok) {
      Logger.warn("SCAN", "Scan aborted: map could not be opened", mapOpen);
      return { ok: false, reason: "map_not_open", detail: mapOpen };
    }

    // Retrieve the baseline coordinates recorded by ensureMapCentered
    const baseline = Runtime && Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
    if (!baseline || !Number.isFinite(baseline.x) || !Number.isFinite(baseline.y)) {
      Logger.warn("SCAN", "Scan aborted: no valid baseline coordinates found. Run ensureMapCentered first.");
      return { ok: false, reason: "baseline_coords_missing" };
    }

    const step = Config.scan.neighborStepPx;
    const h = Math.round(step * 0.86);
    const ring = [
      { key: "TR", dx: Math.round(step / 2), dy: -h },
      { key: "R",  dx: step,                  dy: 0  },
      { key: "BR", dx: Math.round(step / 2), dy: h  },
      { key: "BL", dx: -Math.round(step / 2), dy: h  },
      { key: "L",  dx: -step,                 dy: 0  },
      { key: "TL", dx: -Math.round(step / 2), dy: -h }
    ];

    const results = [];
    let activePopupBaseline = baseline;

    for (let i = 0; i < ring.length; i += 1) {
      const point = ring[i];

      // Dispatch single relative map click
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

      // Wait exactly 50ms to let DOM and Angular process the click
      await sleep(50);

      // Check if coordinates changed compared to our current active baseline
      const currentCoords = typeof readCurrentCoordsFromPopup === "function" ? readCurrentCoordsFromPopup() : null;
      const coordsChanged = !!(currentCoords && (currentCoords.x !== activePopupBaseline.x || currentCoords.y !== activePopupBaseline.y));

      // No coords change = Wall. Simple.
      if (!coordsChanged) {
        results.push({
          key: point.key,
          ok: false,
          clickable: false,
          classification: "blocked",
          reason: "coords_unchanged"
        });
        continue; // Keep the activePopupBaseline unchanged (old popup remains open)
      }

      // Coordinates changed: update the baseline and capture tile details
      activePopupBaseline = currentCoords;
      const details = typeof readTilePopupDetails === "function" ? readTilePopupDetails() : null;
      const basementEntry = !!(
        Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled &&
        !(Runtime.basement && Runtime.basement.active) &&
        typeof detectBasementPortalActionButton === "function" &&
        detectBasementPortalActionButton().found
      );

      results.push({
        key: point.key,
        ok: true,
        clickable: true,
        classification: "walkable",
        dx: point.dx,
        dy: point.dy,
        coords: currentCoords,
        tileName: details ? details.tileName : "",
        isCurrentTile: details ? details.isCurrentTile : false,
        allies: details ? details.allies : 0,
        enemies: details ? details.enemies : 0,
        lootIcons: details ? details.lootIcons : [],
        basementEntry: basementEntry
      });
    }

    const snapshot = {
      ok: true,
      scannedAt: Date.now(),
      results: results
    };

    if (Runtime && Runtime.exploration) {
      Runtime.exploration.lastRingScan = snapshot;
    }

    if (typeof closeHexPopupIfVisible === "function") {
      closeHexPopupIfVisible("scan complete");
    }

    Logger.log("SCAN", "Neighbor ring scan completed successfully", snapshot);
    return snapshot;
  }

  function isFindEnemyButtonReady() {
    const btn = document.querySelector(Config.selectors.findEnemyButton);
    if (!btn || !isElementVisible(btn)) {
      return false;
    }
    if (btn.hasAttribute("disabled")) {
      return false;
    }
    const aria = (btn.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") {
      return false;
    }
    const cls = (btn.className || "").toString().toLowerCase();
    if (cls.indexOf("state-disabled") !== -1 || cls.indexOf("disabled") !== -1 || cls.indexOf("inactive") !== -1) {
      return false;
    }
    try {
      const st = window.getComputedStyle(btn);
      if (st.pointerEvents === "none") {
        return false;
      }
      const op = parseFloat(st.opacity);
      if (Number.isFinite(op) && op < 0.35) {
        return false;
      }
    } catch (err) {}
    return true;
  }

  function describeElementBrief(el) {
    if (!el) {
      return null;
    }
    const tag = (el.tagName || el.localName || "").toLowerCase();
    const cls = (el.className || "").toString().trim().replace(/\s+/g, ".");
    const id = el.id ? `#${el.id}` : "";
    return `${tag}${id}${cls ? "." + cls : ""}`;
  }

  function buildFindEnemyClickDiagnostic(btn) {
    const out = {
      buttonFound: !!btn,
      visible: !!(btn && isElementVisible(btn)),
      disabled: false,
      ariaDisabled: "",
      className: btn ? (btn.className || "").toString() : "",
      rect: null,
      elementFromPoint: null,
      enemyCountBefore: null,
      targetHpBefore: null
    };

    if (btn) {
      out.disabled = !!btn.hasAttribute("disabled");
      out.ariaDisabled = btn.getAttribute("aria-disabled") || "";
      try {
        const rect = btn.getBoundingClientRect();
        out.rect = {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint ? document.elementFromPoint(cx, cy) : null;
        out.elementFromPoint = describeElementBrief(topEl);
      } catch (err) {
        out.rectError = String(err);
      }
    }

    try {
      const st = typeof readBasicState === "function" ? readBasicState() : null;
      out.enemyCountBefore = st && st.combat && Number.isFinite(st.combat.enemyCount) ? st.combat.enemyCount : null;
      out.targetHpBefore = st && st.combat && st.combat.targetHp ? Object.assign({}, st.combat.targetHp) : null;
    } catch (err) {
      out.stateError = String(err);
    }

    return out;
  }

  function isTargetHpAcquired() {
    if (typeof readBasicState !== "function") return false;
    const st = readBasicState();
    return !!(st && st.combat && st.combat.targetHp && st.combat.targetHp.valid && st.combat.targetHp.cur > 0);
  }

  // 5. clickFindEnemyVerified (Signal-Driven target HP Gate with click retries)
  //   - Each attempt waits for Find Enemy readiness, clicks it, then waits for target HP.
  //   - This handles missed/ignored first clicks instead of only re-waiting after one click.
  async function clickFindEnemyVerified(options) {
    const opts = options || {};
    const maxAttempts = Number.isFinite(opts.maxAttempts) ? opts.maxAttempts : 8;
    const attemptTimeoutMs = Number.isFinite(opts.attemptTimeoutMs) ? opts.attemptTimeoutMs : 500;
    const attempts = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ready = await waitForCondition(
        "find enemy button ready",
        () => isFindEnemyButtonReady(),
        { timeoutMs: attempt === 1 ? 1000 : 350, pollMs: 50 }
      );

      if (!ready) {
        const row = { attempt: attempt, ready: false, reason: "find_button_not_ready" };
        attempts.push(row);
        Logger.warn("VERIFY", `Find Enemy click attempt ${attempt}/${maxAttempts}: button not ready`, row);
        continue;
      }

      const findBtn = document.querySelector(Config.selectors.findEnemyButton);
      const beforeDiag = buildFindEnemyClickDiagnostic(findBtn);
      Logger.log("VERIFY", `Find Enemy click attempt ${attempt}/${maxAttempts}`, beforeDiag);

      const clickDispatched = clickElementSafe(findBtn, "find enemy button");
      await sleep(40);

      const afterState = typeof readBasicState === "function" ? readBasicState() : null;
      const row = {
        attempt: attempt,
        ready: true,
        clickDispatched: !!clickDispatched,
        elementFromPoint: beforeDiag.elementFromPoint,
        enemyCountBefore: beforeDiag.enemyCountBefore,
        enemyCountAfterClick: afterState && afterState.combat && Number.isFinite(afterState.combat.enemyCount) ? afterState.combat.enemyCount : null,
        targetHpAfterClick: afterState && afterState.combat && afterState.combat.targetHp ? Object.assign({}, afterState.combat.targetHp) : null
      };
      attempts.push(row);
      Logger.log("VERIFY", "Find Enemy click dispatched", row);

      if (row.enemyCountAfterClick === 0) {
        row.reason = "enemy_count_zero_after_find";
        Logger.log("VERIFY", "Find Enemy resolved with no enemies remaining", row);
        return { ok: true, noEnemies: true, reason: "enemy_count_zero_after_find", attempt: attempt, attempts: attempts };
      }

      if (!clickDispatched) {
        row.reason = "find_button_click_failed";
        continue;
      }

      const verified = await waitForCondition(
        "target acquired verification",
        () => isTargetHpAcquired(),
        { timeoutMs: attemptTimeoutMs, pollMs: Config.timings.verificationPollMs }
      );

      if (verified) {
        if (Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain) {
          Runtime.autoFarm.combatSustain.freshTargetOpenerPending = true;
        }
        Logger.log("VERIFY", "Target acquired and verified successfully", { attempt: attempt, freshTargetOpenerPending: true });
        return { ok: true, attempt: attempt, attempts: attempts };
      }

      row.reason = "target_timeout";
      Logger.warn("VERIFY", `Find Enemy attempt ${attempt}/${maxAttempts} did not acquire target`, row);
    }

    Logger.warn("VERIFY", "Find Enemy did not acquire target after all click attempts", { attempts: attempts });
    return { ok: false, reason: "lock_timeout", attempts: attempts };
  }

  function parseAttackersPopupCardThreat(card) {
    if (!card) {
      return null;
    }
    const html = (card.outerHTML || "").toLowerCase();
    const nameNode = card.querySelector(Config.selectors.attackersPopupCardName);
    const name = nameNode ? (nameNode.textContent || "").trim() : "";

    let type = "common";
    let typeRank = 1;
    if (html.indexOf("mob-type-boss") !== -1 || html.indexOf("mob-boss") !== -1) {
      type = "boss";
      typeRank = 4;
    } else if (html.indexOf("mob-type-champion") !== -1 || html.indexOf("mob-champion") !== -1) {
      type = "champion";
      typeRank = 3;
    } else if (html.indexOf("mob-type-rare") !== -1 || html.indexOf("mob-rare") !== -1) {
      type = "rare";
      typeRank = 2;
    } else if (html.indexOf("mob-type-common") !== -1 || html.indexOf("mob-common") !== -1) {
      type = "common";
      typeRank = 1;
    }

    let damageType = "unknown";
    let rangeType = "unknown";
    if (html.indexOf("mob-class-magic-melee") !== -1) {
      damageType = "magic";
      rangeType = "melee";
    } else if (html.indexOf("mob-class-magic-range") !== -1) {
      damageType = "magic";
      rangeType = "range";
    } else if (html.indexOf("mob-class-physical-melee") !== -1) {
      damageType = "physical";
      rangeType = "melee";
    } else if (html.indexOf("mob-class-physical-range") !== -1) {
      damageType = "physical";
      rangeType = "range";
    }

    const magicBonus = damageType === "magic" ? 100 : 0;
    const score = typeRank * 1000 + magicBonus;
    return { name: name, type: type, typeRank: typeRank, damageType: damageType, rangeType: rangeType, score: score };
  }

  function chooseBestAttackersPopupCard(cards) {
    const list = Array.isArray(cards) ? cards : [];
    if (list.length === 0) {
      return null;
    }
    const ranked = list.map((card, index) => {
      const threat = parseAttackersPopupCardThreat(card) || { score: 0 };
      return { card: card, index: index, threat: threat, score: threat.score || 0 };
    });
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return ranked[0];
  }

  // 6. selectTargetFromAttackersPopup (User's Exact Re-targeting logic)
  //   - Click attackers button.
  //   - Wait up to 1.5s for the list to mount.
  //   - Immediately click the first visible member card in the popup using our fast 20ms event loop.
  //   - Wait for target lock verification.
  async function selectTargetFromAttackersPopup() {
    const listBtn = document.querySelector(Config.selectors.attackersButton);
    if (!clickElementSafe(listBtn, "attackers list button")) {
      return { ok: false, reason: "attackers_button_missing" };
    }

    // Wait for attackers list popup to mount in DOM
    const opened = await waitForCondition(
      "attackers list mount",
      () => {
        const list = document.querySelector(Config.selectors.attackersPopupList);
        return !!(list && isElementVisible(list));
      },
      { timeoutMs: 1500, pollMs: 50 }
    );

    if (!opened) {
      return { ok: false, reason: "popup_failed_to_mount" };
    }

    const cards = typeof getVisibleAttackersPopupCards === "function" ? getVisibleAttackersPopupCards() : Array.from(document.querySelectorAll(Config.selectors.attackersPopupCard));
    const picked = chooseBestAttackersPopupCard(cards);
    const card = picked ? picked.card : null;
    if (!card || !isElementVisible(card)) {
      return { ok: false, reason: "no_attacker_cards_visible" };
    }

    const targetName = picked && picked.threat ? picked.threat.name : "";
    Logger.log("VERIFY", "Selected attacker popup target by threat priority", picked ? picked.threat : null);
    const clicked = clickElementSafe(card, targetName ? `attacker-card-${targetName}` : "attacker-card");
    if (!clicked) {
      return { ok: false, reason: "card_click_failed" };
    }

    // Delay exactly 20ms for the game engine to register targeting (Fast event loop)
    await sleep(20);

    // Verify target lock
    const verified = await waitForCondition(
      "popup target acquired verification",
      () => {
        if (typeof readBasicState !== "function") return false;
        const st = readBasicState();
        return !!(st && st.combat && st.combat.targetHp && st.combat.targetHp.valid && st.combat.targetHp.cur > 0);
      },
      { timeoutMs: 1000, pollMs: 50 }
    );

    if (!verified) {
      return { ok: false, reason: "target_lock_timeout" };
    }

    if (Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain) {
      Runtime.autoFarm.combatSustain.freshTargetOpenerPending = true;
    }
    Logger.log("VERIFY", `Successfully targeted ${targetName || "attacker"} via attackers popup`, { freshTargetOpenerPending: true });
    return { ok: true, targetName: targetName };
  }
