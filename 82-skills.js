  // --- Layer 2 Module: 60-actions.js (Core Game Actions) ---
  // Rebuilt from scratch based on user approved specifications.
  // Manages raw element clicks, attackers panel triggers, and slot cooldown checking.

  // 1. clickActionBarSlot
  // Clicks the action-bar slot button at index (0-17)
  function clickActionBarSlot(index) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      Logger.warn("ACTION", "clickActionBarSlot: Action bar not found in DOM");
      return false;
    }

    const slotSel = Config.selectors.actionBarSlot || "app-action-button, app-skill-button";
    const buttons = bar.querySelectorAll(slotSel);
    const btn = buttons[index];

    if (!btn) {
      Logger.debug("ACTION", `clickActionBarSlot: Button at index ${index} missing`);
      return false;
    }

    return clickElementSafe(btn, `action-bar-slot-${index}`);
  }

  // 2. isActionBarSlotShowingCooldown
  // Evaluates if a slot at index is currently showing a cooldown spinner, countdown, or disabled state
  function isActionBarSlotShowingCooldown(index) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      return false;
    }

    const slotSel = Config.selectors.actionBarSlot || "app-action-button, app-skill-button";
    const buttons = bar.querySelectorAll(slotSel);
    const el = buttons[index];

    if (!el) {
      return false;
    }

    // Check raw attributes
    if (el.hasAttribute("disabled")) {
      return true;
    }
    const aria = (el.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") {
      return true;
    }

    // Check class names
    const elTag = (el.tagName || el.localName || "").toLowerCase();
    const clsFull = (el.className || "").toString().toLowerCase();
    const isSkillSlot = elTag === "app-skill-button" || clsFull.includes("type-skill");

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

    // If it's a skill slot, check opacity or pointer-events
    if (isSkillSlot) {
      try {
        const st = window.getComputedStyle(el);
        if (st.pointerEvents === "none") {
          return true;
        }
        const op = parseFloat(st.opacity);
        if (Number.isFinite(op) && op < 0.35) {
          return true;
        }
      } catch (err) {}
    }

    // Check nested overlays
    const nested = el.querySelector(
      ".cooldown-progress, .skill-cooldown, [class*='cooldown'], [class*='cd-'], .action-blocked"
    );
    if (nested && isElementVisible(nested)) {
      const nc = (nested.className || "").toString().toLowerCase();
      if (nc.indexOf("cooldown") >= 0 || nc.indexOf("cd") >= 0 || nc.indexOf("blocked") >= 0) {
        return true;
      }
    }

    // Check text timers (e.g. "1.2s" or "2:35")
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

  function getActionBarSlotCooldownSpanText(index) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      return "";
    }

    const slotSel = Config.selectors.actionBarSlot || "app-action-button, app-skill-button";
    const buttons = bar.querySelectorAll(slotSel);
    const el = buttons[index];
    if (!el || !isElementVisible(el)) {
      return "";
    }

    // Strict post-cast cooldown signal from the game.
    // Example: <span class="skill-cooldown">2</span>
    // Do NOT inspect counters, the full slot text, disabled state, opacity, or generic [class*=cooldown].
    const cooldownNode = el.querySelector("span.skill-cooldown");
    if (!cooldownNode || !isElementVisible(cooldownNode)) {
      return "";
    }

    const raw = (cooldownNode.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 10) {
      return "";
    }
    if (/^\d{1,3}(?:\.\d)?s?$/i.test(raw) || /^\d{1,2}:\d{2}$/.test(raw)) {
      return raw;
    }
    return "";
  }

  function isActionBarSlotShowingCooldownDigits(index) {
    return !!getActionBarSlotCooldownSpanText(index);
  }

  // 3. clickBasicAttack
  // Dispatches a click to the primary physical attack icon
  function clickBasicAttack() {
    const btn = document.querySelector(Config.selectors.basicAttackButton);
    if (clickElementSafe(btn, "basic attack button")) {
      return true;
    }

    // Fallback search
    const candidates = Array.from(document.querySelectorAll("button, app-button-icon, div, span"));
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      const text = (node.textContent || "").trim().toLowerCase();
      if (text === "attack" || text.includes("basic attack")) {
        if (clickElementSafe(node, "basic-attack-fallback")) {
          return true;
        }
      }
    }

    Logger.warn("ACTION", "clickBasicAttack skipped: no known basic attack control found");
    return false;
  }

  // 4. Attackers Popup Actions
  function clickAttackersButton() {
    const btn = document.querySelector(Config.selectors.attackersButton);
    return clickElementSafe(btn, "attackers popup button");
  }

  function getVisibleAttackersPopupCards() {
    const list = document.querySelector(Config.selectors.attackersPopupList);
    if (!list || !isElementVisible(list)) {
      return [];
    }
    return Array.from(list.querySelectorAll(Config.selectors.attackersPopupCard));
  }

  function clickAttackersPopupCard(cardElement, label) {
    return clickElementSafe(cardElement, label || "attacker-popup-card");
  }
