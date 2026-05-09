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

  // AI CHANGED: slice 18 — best-effort close app-action-info after a long bar-hold opener (same root as scanSkills popup).
  function closeSkillInfoPopupQuick() {
    const popup = document.querySelector(Config.selectors.skillPopup);
    if (!popup) {
      return false;
    }
    const closeButton = document.querySelector(Config.selectors.skillPopupClose);
    if (closeButton) {
      clickElementSafe(closeButton, "skill-popup-close-quick");
      return true;
    }
    return false;
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

  // AI CHANGED: Phase C4 slice 8 — click one battle-bar slot by index (same ordering as scanSkills / app-action-button list).
  function clickActionBarSlot(slotIndex) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      Logger.warn("ACTION", "action-bar slot click skipped: no action bar");
      return false;
    }
    const buttons = bar.querySelectorAll("app-action-button");
    const n = buttons ? buttons.length : 0;
    if (!buttons || typeof slotIndex !== "number" || slotIndex < 0 || slotIndex >= n) {
      Logger.warn("ACTION", "action-bar slot click skipped: bad index", { slotIndex: slotIndex, count: n });
      return false;
    }
    return clickElementSafe(buttons[slotIndex], "action-slot-" + slotIndex);
  }

  // AI CHANGED: Phase C4 slice 12 — hold-to-cast / channel opener: mousedown, hold, mouseup on same slot (no click()).
  async function clickActionBarSlotHoldCast(slotIndex, holdMs) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      Logger.warn("ACTION", "action-bar hold-cast skipped: no action bar");
      return false;
    }
    const buttons = bar.querySelectorAll("app-action-button");
    const n = buttons ? buttons.length : 0;
    if (!buttons || typeof slotIndex !== "number" || slotIndex < 0 || slotIndex >= n) {
      Logger.warn("ACTION", "action-bar hold-cast skipped: bad index", { slotIndex: slotIndex, count: n });
      return false;
    }
    const el = buttons[slotIndex];
    if (!isElementVisible(el)) {
      Logger.warn("ACTION", "action-bar hold-cast skipped: not visible", { slotIndex: slotIndex });
      return false;
    }
    const raw = Number(holdMs);
    const ms = Math.min(8000, Math.max(80, Number.isFinite(raw) ? raw : 200));
    el.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1
    }));
    await sleep(ms);
    el.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 0
    }));
    Logger.log("ACTION", "action-slot-" + slotIndex + " hold-cast", { holdMs: ms });
    return true;
  }

  // AI CHANGED: Phase C4 slice 11 — best-effort live cooldown read for planner (tooltip CD alone is not enough).
  function isActionBarSlotShowingCooldown(slotIndex) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      return false;
    }
    const buttons = bar.querySelectorAll("app-action-button");
    const n = buttons ? buttons.length : 0;
    if (typeof slotIndex !== "number" || slotIndex < 0 || slotIndex >= n) {
      return false;
    }
    const el = buttons[slotIndex];
    if (!el) {
      return false;
    }
    if (el.hasAttribute("disabled")) {
      return true;
    }
    const aria = (el.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") {
      return true;
    }
    const clsFull = (el.className || "").toString().toLowerCase();
    for (let i = 0; i < el.classList.length; i += 1) {
      const token = el.classList[i].toLowerCase();
      if (
        token === "disabled" ||
        token.indexOf("cooldown") >= 0 ||
        token.indexOf("inactive") >= 0 ||
        token.indexOf("not-ready") >= 0 ||
        token.indexOf("notready") >= 0 ||
        token.indexOf("locked") >= 0 ||
        token.indexOf("unavailable") >= 0
      ) {
        return true;
      }
    }
    if (clsFull.includes("type-skill")) {
      try {
        const st = window.getComputedStyle(el);
        if (st.pointerEvents === "none") {
          return true;
        }
      } catch (err) {
        // ignore
      }
    }
    const nested = el.querySelector(
      ".cooldown-progress, .skill-cooldown, [class*='cooldown'], [class*='cd-'], .action-blocked"
    );
    if (nested && isElementVisible(nested)) {
      const nc = (nested.className || "").toString().toLowerCase();
      if (nc.indexOf("cooldown") >= 0 || nc.indexOf("cd") >= 0 || nc.indexOf("blocked") >= 0) {
        return true;
      }
    }
    const rawText = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (rawText.length >= 1 && rawText.length <= 8) {
      if (/^\d{1,3}(\.\d)?s$/i.test(rawText)) {
        return true;
      }
      if (/^\d{1,2}:\d{2}$/.test(rawText)) {
        return true;
      }
    }
    return false;
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
