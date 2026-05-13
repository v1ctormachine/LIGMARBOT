  // AI CHANGED: Added live action helper for find enemy button.
  function clickFindEnemy() {
    const button = document.querySelector(Config.selectors.findEnemyButton);
    return clickElementSafe(button, "find-enemy");
  }

  // AI CHANGED: Fast multi-mob retarget — open attackers popup to click the next enemy directly instead of waiting on find-enemy.
  function clickAttackersButton() {
    const button = document.querySelector(Config.selectors.attackersButton);
    return clickElementSafe(button, "attackers");
  }

  function getVisibleAttackersPopupCards() {
    const list = document.querySelector(Config.selectors.attackersPopupList);
    if (!list || !isElementVisible(list)) {
      return [];
    }
    const cards = Array.from(list.querySelectorAll(Config.selectors.attackersPopupCard));
    return cards.filter(function (card) {
      return !!card && isElementVisible(card);
    });
  }

  function clickAttackersPopupCard(card, label) {
    if (!card || !isElementVisible(card)) {
      Logger.warn("ACTION", `${label || "attackers-card"} click skipped: element not visible`);
      return false;
    }
    const rect = card.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    if (dispatchClickAt(clientX, clientY, label || "attackers-card")) {
      return true;
    }
    return clickElementSafe(card, label || "attackers-card");
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

  // AI CHANGED: AUTO chat spammer — visible chat input is the main signal that the chat dialog is open and ready.
  function getVisibleChatInput() {
    const input = document.querySelector(Config.selectors.chatInput);
    return input && isElementVisible(input) ? input : null;
  }

  function getVisibleLocalChatSidebarButton() {
    const buttons = Array.from(document.querySelectorAll(Config.selectors.chatSidebarButton));
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i];
      if (!button || !isElementVisible(button)) {
        continue;
      }
      const textNode = button.querySelector(Config.selectors.chatSidebarButtonText);
      const text = (textNode ? textNode.textContent : button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text === "local" || text.indexOf("local") >= 0) {
        return button;
      }
    }
    return null;
  }

  function getVisibleChatSendButton() {
    const buttons = Array.from(document.querySelectorAll(Config.selectors.chatSendButton));
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i];
      if (button && isElementVisible(button)) {
        return button;
      }
    }
    return null;
  }

  function getVisibleChatCloseButton() {
    const buttons = Array.from(document.querySelectorAll(Config.selectors.chatDialogCloseButton));
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i];
      if (!button || !isElementVisible(button)) {
        continue;
      }
      const text = (button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text || text === "close" || text.indexOf("close") >= 0) {
        return button;
      }
    }
    return null;
  }

  function isChatSendButtonDisabled(button) {
    if (!button) {
      return true;
    }
    if (button.classList && button.classList.contains("disabled")) {
      return true;
    }
    if (button.hasAttribute("disabled")) {
      return true;
    }
    const aria = (button.getAttribute("aria-disabled") || "").toLowerCase();
    return aria === "true";
  }

  function setTextInputValue(input, value, label) {
    if (!input || !isElementVisible(input)) {
      Logger.warn("ACTION", `${label} input set skipped: element not visible`);
      return false;
    }
    const nextValue = typeof value === "string" ? value : "";
    input.focus();
    const desc =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (desc && typeof desc.set === "function") {
      desc.set.call(input, nextValue);
    } else {
      input.value = nextValue;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    Logger.log("ACTION", `${label} input set`, { length: nextValue.length });
    return true;
  }

  async function ensureChatDialogOpen() {
    const alreadyOpenInput = getVisibleChatInput();
    if (alreadyOpenInput) {
      return { ok: true, opened: false, inputReady: true };
    }
    const clicked = clickElementSafe(document.querySelector(Config.selectors.chatOpenButton), "chat-open");
    if (!clicked) {
      return { ok: false, opened: false, inputReady: false, reason: "chat_open_click_failed" };
    }
    const timeoutMs =
      Number.isFinite(Config.chat && Config.chat.openTimeoutMs) && Config.chat.openTimeoutMs > 0
        ? Config.chat.openTimeoutMs
        : 1200;
    const opened = await waitForCondition("chat input open", function () {
      return !!getVisibleChatInput();
    }, { timeoutMs: timeoutMs, pollMs: 80 });
    return {
      ok: opened,
      opened: true,
      inputReady: opened,
      reason: opened ? null : "chat_input_not_open"
    };
  }

  async function closeChatDialog() {
    const closeButton = getVisibleChatCloseButton();
    if (!closeButton) {
      return getVisibleChatInput()
        ? { ok: false, closed: false, reason: "chat_close_button_missing" }
        : { ok: true, closed: false, reason: "already_closed" };
    }
    const clicked = clickElementSafe(closeButton, "chat-close");
    if (!clicked) {
      return { ok: false, closed: false, reason: "chat_close_click_failed" };
    }
    const timeoutMs =
      Number.isFinite(Config.chat && Config.chat.closeTimeoutMs) && Config.chat.closeTimeoutMs > 0
        ? Config.chat.closeTimeoutMs
        : 1200;
    const closed = await waitForCondition("chat close", function () {
      return !getVisibleChatInput();
    }, { timeoutMs: timeoutMs, pollMs: 80 });
    return {
      ok: closed,
      closed: closed,
      reason: closed ? null : "chat_close_not_confirmed"
    };
  }

  async function prepareLocalChatPromocodeMessage(message) {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) {
      return { ok: false, reason: "empty_message" };
    }
    const openResult = await ensureChatDialogOpen();
    if (!openResult.ok) {
      return Object.assign({ ok: false }, openResult);
    }
    const input = getVisibleChatInput();
    if (!input) {
      return { ok: false, reason: "chat_input_missing_after_open" };
    }
    const filled = setTextInputValue(input, text, "chat-message");
    if (!filled) {
      return { ok: false, reason: "chat_message_fill_failed" };
    }
    const localButton = getVisibleLocalChatSidebarButton();
    if (!localButton) {
      return { ok: false, reason: "local_chat_button_missing" };
    }
    const localClicked = clickElementSafe(localButton, "chat-local");
    if (!localClicked) {
      return { ok: false, reason: "local_chat_click_failed" };
    }
    const settleMs =
      Number.isFinite(Config.chat && Config.chat.uiSettleMs) && Config.chat.uiSettleMs > 0
        ? Config.chat.uiSettleMs
        : 0;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    const sendReady = await waitForCondition("chat send ready", function () {
      const sendButton = getVisibleChatSendButton();
      const liveInput = getVisibleChatInput();
      return !!sendButton && !isChatSendButtonDisabled(sendButton) && !!liveInput && (liveInput.value || "").trim().length > 0;
    }, { timeoutMs: 1200, pollMs: 80 });
    const liveInput = getVisibleChatInput();
    const appliedText = liveInput && typeof liveInput.value === "string" ? liveInput.value : "";
    return {
      ok: sendReady,
      openedDialog: openResult.opened,
      sendReady: sendReady,
      messageLength: text.length,
      appliedMessageLength: appliedText.length,
      reason: sendReady ? null : "chat_send_not_ready"
    };
  }

  async function probeLocalChatPromocodeUi(message) {
    const prep = await prepareLocalChatPromocodeMessage(message);
    let cleared = false;
    let closeResult = { ok: true, closed: false, reason: "not_attempted" };
    const input = getVisibleChatInput();
    if (input) {
      cleared = setTextInputValue(input, "", "chat-message-clear");
    }
    const settleMs =
      Number.isFinite(Config.chat && Config.chat.uiSettleMs) && Config.chat.uiSettleMs > 0
        ? Config.chat.uiSettleMs
        : 0;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    closeResult = await closeChatDialog();
    return {
      ok: !!(prep.ok && cleared && closeResult.ok && prep.appliedMessageLength === prep.messageLength),
      prepared: prep,
      cleared: cleared,
      close: closeResult
    };
  }

  async function sendLocalChatPromocodeMessage(message) {
    const prep = await prepareLocalChatPromocodeMessage(message);
    if (!prep.ok) {
      await closeChatDialog();
      return {
        ok: false,
        stage: "prepare",
        prepare: prep
      };
    }
    const sendButton = getVisibleChatSendButton();
    const sentClick = clickElementSafe(sendButton, "chat-send");
    if (!sentClick) {
      await closeChatDialog();
      return {
        ok: false,
        stage: "send_click",
        prepare: prep
      };
    }
    const sent = await waitForCondition("chat send effect", function () {
      const input = getVisibleChatInput();
      if (!input) {
        return true;
      }
      const text = typeof input.value === "string" ? input.value.trim() : "";
      const sendLive = getVisibleChatSendButton();
      return text.length === 0 || !!sendLive && isChatSendButtonDisabled(sendLive);
    }, { timeoutMs: 1400, pollMs: 80 });
    const settleMs =
      Number.isFinite(Config.chat && Config.chat.uiSettleMs) && Config.chat.uiSettleMs > 0
        ? Config.chat.uiSettleMs
        : 0;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    const closeResult = await closeChatDialog();
    return {
      ok: !!(sentClick && sent && closeResult.ok),
      stage: "done",
      prepare: prep,
      sent: sent,
      close: closeResult
    };
  }

  // AI CHANGED: Night resilience — close transient overlays/popups before retrying map/combat recovery.
  async function closeTransientUiForRecovery() {
    const out = {
      chat: null,
      hex: null,
      skillInfoClosed: false
    };
    if (getVisibleChatInput()) {
      out.chat = await closeChatDialog();
    }
    out.hex = closeHexPopupIfOpen();
    out.skillInfoClosed = closeSkillInfoPopupQuick();
    const chatOk = !out.chat || out.chat.ok;
    const hexOk = !out.hex || out.hex.ok;
    return {
      ok: !!(chatOk && hexOk),
      detail: out
    };
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
