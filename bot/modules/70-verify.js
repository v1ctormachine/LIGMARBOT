  // AI CHANGED: Added generic async waiter so actions can be verified against state changes.
  function waitForCondition(label, predicate, options) {
    const timeoutMs = options && options.timeoutMs ? options.timeoutMs : Config.verification.timeoutMs;
    const pollMs = options && options.pollMs ? options.pollMs : Config.verification.pollMs;
    const start = Date.now();
    // AI CHANGED: Audit fix #11 — throttle the per-poll health evaluation (`evaluateAutoFarmHealth(readBasicState())` reads ~15 DOM selectors). Predicate still runs every `pollMs`; health eval runs at most every `healthEvalThrottleMs` (default 250 ms — much slower than typical 25–90 ms polls).
    const healthEvalThrottleMs = Number.isFinite(Config.verification && Config.verification.healthEvalThrottleMs)
      ? Math.max(50, Config.verification.healthEvalThrottleMs)
      : 250;
    let lastHealthEvalAt = 0;
    return new Promise((resolve) => {
      const tick = () => {
        // AI CHANGED: slice 21 — cooperative stop so verify waits don’t block Stop.
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("VERIFY", `${label} aborted (stop requested)`, { elapsedMs: Date.now() - start });
          resolve(false);
          return;
        }
        const nowEvalCheck = Date.now();
        if (
          Runtime.autoFarm.running &&
          typeof evaluateAutoFarmHealth === "function" &&
          typeof shouldAbortWaitForSessionRisk === "function" &&
          nowEvalCheck - lastHealthEvalAt >= healthEvalThrottleMs
        ) {
          lastHealthEvalAt = nowEvalCheck;
          const healthSummary = evaluateAutoFarmHealth(readBasicState(), {
            reason: label
          });
          if (shouldAbortWaitForSessionRisk(healthSummary)) {
            Logger.warn("VERIFY", `${label} aborted (session risk)`, {
              elapsedMs: Date.now() - start,
              severity: healthSummary.severity,
              reason: healthSummary.primaryReason,
              recommendedAction: healthSummary.recommendedAction
            });
            resolve(false);
            return;
          }
        }
        if (options && typeof options.onEachPoll === "function") {
          try {
            options.onEachPoll();
          } catch (error) {
            Logger.warn("VERIFY", `${label} onEachPoll threw`, error);
          }
        }
        let passed = false;
        try {
          passed = !!predicate();
        } catch (error) {
          Logger.warn("VERIFY", `${label} predicate threw`, error);
          passed = false;
        }
        if (passed) {
          if (typeof noteAutoFarmActionVerified === "function") {
            noteAutoFarmActionVerified(label, null, { whenMs: Date.now() });
          }
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

  // AI CHANGED: Wait until highlight loot button is gone AND status bar is not busy, continuously for lootSettleStableMs.
  function waitForLootInteractionSettled() {
    const stableMs = Config.verification.lootSettleStableMs;
    const timeoutMs = Config.verification.lootSettleTimeoutMs;
    const pollMs = Config.verification.lootSettlePollMs;
    const start = Date.now();
    let stableStart = null;
    return new Promise((resolve) => {
      const tick = () => {
        // AI CHANGED: slice 21 — long loot-settle waits respect Stop.
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("VERIFY", "loot interaction settle aborted (stop requested)", {
            elapsedMs: Date.now() - start
          });
          resolve(false);
          return;
        }
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

  // AI CHANGED: slice 21 — heuristic “bag full” from visible overlay / game root text (see Config.verification).
  function detectInventoryFullFromUi() {
    const subs = Config.verification.inventoryFullSubstrings;
    if (!Array.isArray(subs) || subs.length === 0) {
      return false;
    }
    const sels = Config.verification.inventoryFullScanSelectors;
    const roots = Array.isArray(sels) && sels.length > 0 ? sels : ["app-game"];
    for (let r = 0; r < roots.length; r += 1) {
      const root = document.querySelector(roots[r]);
      if (!root) {
        continue;
      }
      const text = (root.textContent || "").toLowerCase();
      for (let i = 0; i < subs.length; i += 1) {
        const sub = String(subs[i] || "").toLowerCase();
        if (sub && text.indexOf(sub) !== -1) {
          return true;
        }
      }
    }
    return false;
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

  // AI CHANGED: Kept helper for optional diagnostics; core loop no longer hard-blocks on this.
  // AI CHANGED: Retarget fix — do not continue combat until target HP is real (> 0), not just a placeholder/appearing bar.
  async function waitForTargetAcquired() {
    return waitForCondition("target acquired", () => {
      const now = readBasicState();
      return !!(
        now.combat.targetHp &&
        now.combat.targetHp.valid &&
        Number.isFinite(now.combat.targetHp.cur) &&
        now.combat.targetHp.cur > 0
      );
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
      // AI CHANGED: Retarget fix — enemy-count may not change before first attack, so verify by a real target HP value (> 0), not just a valid shell bar.
      return !!(
        now.combat.targetHp &&
        now.combat.targetHp.valid &&
        Number.isFinite(now.combat.targetHp.cur) &&
        now.combat.targetHp.cur > 0
      );
    });
    return { ok: verified, clicked: true, verified: verified };
  }

  // AI CHANGED: v1.2.0-alpha — When champion/goblin avoidance is OFF and the current tile shows a champion or goblin
  //   event icon, the bot must ACTIVELY target it.
  //   v1.2.1-alpha — REWRITTEN to follow the exact required flow (the previous version relied on `clickCenterMap()` alone,
  //   which only re-centers the camera and does NOT open the per-tile event popup, so the hex-events DOM was usually empty).
  //   Correct flow:
  //     1. `ensureMapOpen()` — make sure the map is visible.
  //     2. `clickCenterMapVerified()` — re-center so the camera origin matches our current tile.
  //     3. `clickMapCenterTile()` — single-click the canvas center to OPEN the hex tile popup (the same primitive
  //        `scanNeighborRing` uses to scan the local tile).
  //     4. Wait for the popup to actually appear via `readTilePopupDetails()` returning a result whose `isCurrentTile`
  //        flag is true (we want OUR tile's event icons, not a neighbor's).
  //     5. Query `Config.selectors.hexEventIcons` (same selector the scan path uses) and filter to champion / goblin.
  //        Champion has priority over goblin when both are present and both are not avoided. The basement-end override
  //        permits champion engagement even when global champion avoidance is ON, but only when `Runtime.basement.atEndTile`.
  //     6. Dispatch a click on the matching icon. Game selects that mob as the active target.
  //   Soft-fail: if any step fails (popup never opens, no matching icon, etc.) the helper returns `ok:false` with a clear
  //   `reason`. Callers (specifically `secureTileAndLootOnce`) ignore the failure and continue with `clickFindEnemyVerified()`
  //   so combat is never stalled by a special-target miss.
  async function selectSpecialTileTargetIfDesired() {
    const avoidChampions = typeof getAvoidChampions === "function" ? getAvoidChampions() : true;
    const avoidGoblins = typeof getAvoidGoblins === "function" ? getAvoidGoblins() : false;
    // Basement-end override permits champion engagement even when avoidChampions is true.
    //   v1.2.2-alpha / v1.2.4-alpha — accept either the live `atEndTile` UI flag OR the sticky "atEnd" / "complete" /
    //   "returning" phase so the override stays valid throughout the end-tile fight and through the return phase
    //   (e.g. if a champion roams onto a tile during return).
    const basementEndOverride = !!(
      typeof isInBasement === "function" && isInBasement() &&
      Runtime && Runtime.basement &&
      (Runtime.basement.atEndTile === true || Runtime.basement.phase === "atEnd" || Runtime.basement.phase === "complete" || Runtime.basement.phase === "returning") &&
      Config && Config.basement && Config.basement.endChampionOverride !== false
    );
    const wantChampion = !avoidChampions || basementEndOverride;
    const wantGoblin = !avoidGoblins;
    if (!wantChampion && !wantGoblin) {
      return { ok: false, skipped: true, reason: "both_avoided", wantChampion: wantChampion, wantGoblin: wantGoblin };
    }
    try {
      // Step 1: map open.
      if (typeof ensureMapOpen === "function") {
        const mapResult = await ensureMapOpen();
        if (!mapResult || mapResult.ok === false) {
          return { ok: false, reason: "map_not_open", map: mapResult };
        }
      }
      // Step 2: recenter so canvas center == our tile.
      if (typeof clickCenterMapVerified === "function") {
        try {
          const centerResult = await clickCenterMapVerified();
          if (!centerResult || centerResult.ok === false) {
            return { ok: false, reason: "center_failed", center: centerResult };
          }
        } catch (err) {
          return { ok: false, reason: "center_threw", error: String(err && err.message ? err.message : err) };
        }
      }
      // Step 3: open the current tile's popup by clicking the canvas center (this is the SAME primitive
      //   scanNeighborRing uses to scan the local tile).
      let popupClicked = false;
      if (typeof clickMapCenterTile === "function") {
        try {
          popupClicked = !!clickMapCenterTile();
        } catch (err) {
          return { ok: false, reason: "center_tile_click_threw", error: String(err && err.message ? err.message : err) };
        }
      }
      if (!popupClicked) {
        return { ok: false, reason: "center_tile_click_failed" };
      }
      // Step 4: wait for the popup to show OUR tile's details.
      const popupVisible = await waitForCondition(
        "select-special tile popup",
        () => {
          if (typeof readTilePopupDetails !== "function") return !!(typeof readCurrentCoordsFromPopup === "function" ? readCurrentCoordsFromPopup() : null);
          const det = readTilePopupDetails();
          // Prefer isCurrentTile=true; if the "You are here" string is missing/localized, fall back to coords-only.
          return !!(det && det.coords);
        },
        { timeoutMs: 1500, pollMs: 100 }
      );
      if (!popupVisible) {
        return { ok: false, reason: "popup_timeout" };
      }
      let det = typeof readTilePopupDetails === "function" ? readTilePopupDetails() : null;
      if (det && det.isCurrentTile === false) {
        // Wrong tile in popup — try ONE more re-click.
        if (typeof clickMapCenterTile === "function") {
          try { clickMapCenterTile(); } catch (err) {}
        }
        await sleep(180);
        det = typeof readTilePopupDetails === "function" ? readTilePopupDetails() : null;
        if (det && det.isCurrentTile === false) {
          return { ok: false, reason: "popup_not_current_tile", details: { isCurrentTile: det.isCurrentTile } };
        }
      }
      // Step 5: pick matching icon from THIS popup (it is the active visible popup; querySelectorAll returns
      //   only the open popup's icons because closed popups remove their hex-events containers).
      const sel = Config && Config.selectors && Config.selectors.hexEventIcons
        ? Config.selectors.hexEventIcons
        : "div.hex-events app-icon, div.hex-events img";
      const icons = Array.from(document.querySelectorAll(sel));
      if (icons.length === 0) {
        return { ok: false, reason: "no_event_icons" };
      }
      const champIcon = icons.find((el) => {
        const blob = ((el.getAttribute("class") || "") + " " + (el.getAttribute("src") || "") + " " + (el.outerHTML || "")).toLowerCase();
        return blob.indexOf("mob-type-champion") !== -1 || blob.indexOf("event-champion") !== -1;
      });
      const gobIcon = icons.find((el) => {
        const blob = ((el.getAttribute("class") || "") + " " + (el.getAttribute("src") || "") + " " + (el.outerHTML || "")).toLowerCase();
        return blob.indexOf("event-goblin") !== -1 || blob.indexOf("goblin") !== -1;
      });
      let pick = null;
      let kind = null;
      if (wantChampion && champIcon) { pick = champIcon; kind = "champion"; }
      else if (wantGoblin && gobIcon) { pick = gobIcon; kind = "goblin"; }
      if (!pick) {
        return {
          ok: false,
          reason: "no_matching_icon",
          wantChampion: wantChampion,
          wantGoblin: wantGoblin,
          championPresent: !!champIcon,
          goblinPresent: !!gobIcon,
          iconCount: icons.length
        };
      }
      // Step 6: click the matching icon.
      try {
        pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        pick.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        pick.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (err) {
        return { ok: false, reason: "icon_click_threw", error: String(err && err.message ? err.message : err) };
      }
      Logger.log("TARGET", "selectSpecialTileTargetIfDesired clicked icon", { kind: kind, basementEndOverride: basementEndOverride });
      // Brief settle so the game can register the target.
      await sleep(160);
      return { ok: true, clicked: true, kind: kind, basementEndOverride: basementEndOverride };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  // AI CHANGED: Fast retarget via attackers popup after one kill in a multi-mob pull; falls back elsewhere if popup path is unavailable.
  async function clickAttackersRetargetVerified() {
    if (Config.combat && Config.combat.useAttackersPanelRetargetAfterKill === false) {
      return { ok: false, clicked: false, verified: false, reason: "feature_off" };
    }
    let cards = typeof getVisibleAttackersPopupCards === "function" ? getVisibleAttackersPopupCards() : [];
    let openedPopup = cards.length > 0;
    let clickedButton = false;
    if (cards.length <= 0) {
      clickedButton = clickAttackersButton();
      if (!clickedButton) {
        return { ok: false, clicked: false, verified: false, reason: "button_click_failed" };
      }
      openedPopup = await waitForCondition("attackers popup open", () => {
        const rows = typeof getVisibleAttackersPopupCards === "function" ? getVisibleAttackersPopupCards() : [];
        return rows.length > 0;
      }, { timeoutMs: 1200, pollMs: 80 });
      if (!openedPopup) {
        return { ok: false, clicked: true, verified: false, reason: "popup_not_open" };
      }
      const settleMs = Number.isFinite(Config.combat && Config.combat.attackersRetargetSettleMs)
        ? Math.max(0, Config.combat.attackersRetargetSettleMs)
        : 0;
      if (settleMs > 0) {
        await sleep(settleMs, { bypassStop: true });
      }
      cards = typeof getVisibleAttackersPopupCards === "function" ? getVisibleAttackersPopupCards() : [];
    }
    if (cards.length <= 0) {
      return { ok: false, clicked: clickedButton, verified: false, reason: "no_visible_cards" };
    }
    const firstCard = cards[0];
    const nameNode = firstCard.querySelector(Config.selectors.attackersPopupCardName);
    const targetName = nameNode ? (nameNode.textContent || "").trim() : "";
    const clickedCard = clickAttackersPopupCard(firstCard, targetName ? `attackers-card-${targetName}` : "attackers-card");
    if (!clickedCard) {
      return {
        ok: false,
        clicked: true,
        verified: false,
        reason: "card_click_failed",
        targetName: targetName || null,
        candidateCount: cards.length
      };
    }
    const settleAfterClickMs = Number.isFinite(Config.combat && Config.combat.attackersRetargetSettleMs)
      ? Math.max(0, Config.combat.attackersRetargetSettleMs)
      : 0;
    if (settleAfterClickMs > 0) {
      await sleep(settleAfterClickMs, { bypassStop: true });
    }
    const verified = await waitForTargetAcquired();
    return {
      ok: verified,
      clicked: true,
      verified: verified,
      via: "attackers_popup",
      targetName: targetName || null,
      candidateCount: cards.length
    };
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
    // AI CHANGED: slice 21 — brief pause after recenter before loot-settle (reduces highlight flicker race).
    const settleMs = Number.isFinite(Config.verification.lootPostCenterTileSettleMs)
      ? Config.verification.lootPostCenterTileSettleMs
      : 0;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    // AI CHANGED: Hybrid settle — battle status (Opening/Activating) + stable absence of highlight loot button.
    const verified = await waitForLootInteractionSettled();
    if (!verified && detectInventoryFullFromUi()) {
      Logger.warn("LOOT", "Loot settle failed; inventory-full hint detected in UI text");
      return {
        ok: false,
        clicked: true,
        verified: false,
        waitedForLootGone: true,
        reason: "inventory_full"
      };
    }
    return {
      ok: verified,
      clicked: true,
      verified: verified,
      waitedForLootGone: true,
      reason: verified ? undefined : "loot_settle_timeout"
    };
  }

  // AI CHANGED: Added center-map verification wrapper for reliable map recentering.
  async function clickCenterMapVerified() {
    const attempts = Number.isFinite(Config.recovery && Config.recovery.centerMapRetryCount)
      ? Math.max(1, Config.recovery.centerMapRetryCount)
      : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const clicked = clickCenterMap();
      if (!clicked) {
        if (attempt >= attempts - 1) {
          return { ok: false, clicked: false, verified: false, reason: "click_failed", attempts: attempt + 1 };
        }
        await sleep(180, { bypassStop: true });
        continue;
      }
      const verified = await waitForCondition("center-map effect", () => {
        const button = document.querySelector(Config.selectors.centerMapButton);
        // Center action has no obvious state field, so confirmation is "control remains available and visible after click".
        return !!button && isElementVisible(button);
      }, { timeoutMs: 1200, pollMs: 120 });
      if (verified) {
        return { ok: true, clicked: true, verified: true, attempts: attempt + 1 };
      }
      if (attempt < attempts - 1 && typeof closeTransientUiForRecovery === "function") {
        await closeTransientUiForRecovery();
      }
      await sleep(180, { bypassStop: true });
    }
    return { ok: false, clicked: true, verified: false, reason: "verify_failed", attempts: attempts };
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
    // AI CHANGED: Audit fix #6 — center button may be momentarily hidden (animation, popup) while the map canvas is still mounted. Clicking the toggle in that state would close the map. If the canvas is already in the DOM, treat as already-open and wait briefly for the center button to reappear instead of toggling.
    const mapCanvasSelector =
      Config.selectors && typeof Config.selectors.mapCanvas === "string" ? Config.selectors.mapCanvas : null;
    if (mapCanvasSelector) {
      const canvas = document.querySelector(mapCanvasSelector);
      if (canvas && isElementVisible(canvas)) {
        const reappear = await waitForCondition(
          "map center button reappear",
          function () {
            const cb = document.querySelector(Config.selectors.centerMapButton);
            return !!cb && isElementVisible(cb);
          },
          { timeoutMs: 600, pollMs: 80 }
        );
        if (reappear) {
          Logger.log("MAP", "Map already open (center button was transiently hidden)");
          return { ok: true, action: "already_open_canvas" };
        }
        Logger.warn("MAP", "Map canvas visible but center button missing — toggling anyway");
      }
    }
    const attempts = Number.isFinite(Config.recovery && Config.recovery.mapOpenRetryCount)
      ? Math.max(1, Config.recovery.mapOpenRetryCount)
      : 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const toggled = clickMapToggle();
      if (!toggled) {
        if (attempt >= attempts - 1) {
          return { ok: false, action: "toggle_failed", attempts: attempt + 1 };
        }
        if (typeof closeTransientUiForRecovery === "function") {
          await closeTransientUiForRecovery();
        }
        await sleep(220, { bypassStop: true });
        continue;
      }
      const opened = await waitForCondition("map open", () => {
        const centerButton = document.querySelector(Config.selectors.centerMapButton);
        return !!centerButton && isElementVisible(centerButton);
      }, { timeoutMs: 1800, pollMs: 120 });
      if (opened) {
        Logger.log("MAP", "Map opened");
        return { ok: true, action: "opened", attempts: attempt + 1 };
      }
      Logger.warn("MAP", "Map open verification failed", {
        attempt: attempt + 1,
        maxAttempts: attempts
      });
      if (typeof closeTransientUiForRecovery === "function") {
        await closeTransientUiForRecovery();
      }
      await sleep(220, { bypassStop: true });
    }
    return { ok: false, action: "open_verify_failed", attempts: attempts };
  }

  // AI CHANGED: Post find-enemy — dismiss map overlay for battle view; skip when map UI not open or feature off.
  async function closeMapIfOpenAfterFindEnemy() {
    if (Config.combat && Config.combat.closeMapAfterFindEnemy === false) {
      return { ok: true, skipped: true, reason: "feature_off" };
    }
    const centerButton = document.querySelector(Config.selectors.centerMapButton);
    if (!centerButton || !isElementVisible(centerButton)) {
      Logger.log("MAP", "closeMapIfOpenAfterFindEnemy: map not open (center control hidden)");
      return { ok: true, action: "already_closed" };
    }
    if (!clickMapToggle()) {
      Logger.warn("MAP", "closeMapIfOpenAfterFindEnemy: map toggle click failed");
      return { ok: false, action: "toggle_failed" };
    }
    const closed = await waitForCondition("map closed after find-enemy", () => {
      const btn = document.querySelector(Config.selectors.centerMapButton);
      return !btn || !isElementVisible(btn);
    }, { timeoutMs: 1800, pollMs: 120 });
    const settleMs = Number.isFinite(Config.combat && Config.combat.closeMapAfterFindEnemySettleMs)
      ? Math.max(0, Math.round(Config.combat.closeMapAfterFindEnemySettleMs))
      : 0;
    if (closed && settleMs > 0) {
      await sleep(settleMs, { bypassStop: true });
    }
    if (!closed) {
      Logger.warn("MAP", "closeMapIfOpenAfterFindEnemy: center control still visible after toggle");
    } else {
      Logger.log("MAP", "Map closed after find-enemy");
    }
    return { ok: closed, action: closed ? "closed" : "close_verify_failed" };
  }
