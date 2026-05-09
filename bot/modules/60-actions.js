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
