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
  async function waitForTargetAcquired() {
    return waitForCondition("target acquired", () => {
      const now = readBasicState();
      return now.combat.targetHp && now.combat.targetHp.valid;
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
