  // AI CHANGED: Phase C0 -- skill scanner. Discovers every action-bar slot, opens its description
  // popup via long-press (mousedown -> wait -> close button), parses the modal contents into a
  // structured record, and returns the array. Output is recon-only -- nothing in combat consumes
  // Runtime.skills.slots yet. The point is to verify our parsing assumptions match the live DOM
  // before later phases build the planner on top of this data.

  // Regex patterns for description-text effect parsing. Each pattern returns 0+ effect objects.
  // Patterns are ordered most-specific first so e.g. DoT ("X damage over Y s") matches before
  // the generic "additional X damage" pattern.
  // eslint-disable-next-line no-unused-vars  // exposed via window.ligmarBot for debugging.
  const SkillEffectPatterns = [
    // Pattern channel_gear: Sniper Shot style -- channel up to T sec + base hit + up to N% gear damage.
    // AI CHANGED: Must run before generic basic_proc so we capture gear% and channel window together.
    {
      key: "channel_gear",
      regex: /\bfor\s+up\s+to\s+(\d+(?:\.\d+)?)\s*seconds?\s+and\s+.*?deals\s+base\s+(physical|magic|magical)\s+damage\s+to\s+the\s+target\s+and\s+up\s+to\s+(\d+(?:\.\d+)?)%\s+(physical|magic|magical)\s+damage\s+from\s+gear/i,
      build: (m) => ({
        type: "channel_gear",
        channelMaxSec: parseFloat(m[1]),
        gearDamagePercent: parseFloat(m[3]),
        damageType: m[2].toLowerCase().replace("magical", "magic"),
        gearDamageType: m[4].toLowerCase().replace("magical", "magic"),
        target: "enemy",
        interruptible: true
      })
    },
    // Pattern A: DoT -- "<NUMBER> (physical|magic|magical) damage over <NUMBER> s"
    {
      key: "dot",
      regex: /(\d+(?:\.\d+)?)\s+(physical|magic|magical)\s+damage\s+over\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => {
        const total = parseFloat(m[1]);
        const durationSec = parseFloat(m[3]);
        return {
          type: "dot",
          total: total,
          perSec: durationSec > 0 ? +(total / durationSec).toFixed(3) : 0,
          durationSec: durationSec,
          damageType: m[2].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        };
      }
    },
    // Pattern B: Slow -- "Slows the target by <N>% for <T> s"
    {
      key: "slow",
      regex: /slows?\s+(?:the\s+)?target\s+by\s+(\d+(?:\.\d+)?)%\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "slow",
        magnitude: parseFloat(m[1]),
        durationSec: parseFloat(m[2]),
        target: "enemy"
      })
    },
    // Pattern C: Stun -- "Stuns? the target for <T> s" (no live example yet -- pattern guessed
    // from genre conventions; will be refined when we encounter a stun skill in recon).
    {
      key: "stun",
      regex: /stuns?\s+(?:the\s+)?target\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "stun",
        durationSec: parseFloat(m[1]),
        target: "enemy"
      })
    },
    // Pattern D: Damage buff -- "<N>% additional <KIND> damage with each attack for <T> s"
    {
      key: "damage_buff",
      regex: /(\d+(?:\.\d+)?)%\s+additional\s+([\w\s]+?)\s+damage\s+with\s+each\s+attack\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "damage_buff",
        magnitude: parseFloat(m[1]),
        boostType: m[2].trim().toLowerCase().replace(/\s+/g, "_"),
        durationSec: parseFloat(m[3]),
        target: "self"
      })
    },
    // Pattern E: Heal HP -- "Restores <N> HP" (instant) or "Restores <N> HP over <T> s" (HoT).
    {
      key: "heal_hp",
      regex: /restores?\s+(\d+(?:\.\d+)?)\s+(?:HP|health)(?:\s+over\s+(\d+(?:\.\d+)?)\s*s)?/i,
      build: (m) => ({
        type: "heal",
        resource: "hp",
        value: parseFloat(m[1]),
        durationSec: m[2] ? parseFloat(m[2]) : 0,
        target: "self"
      })
    },
    // Pattern F: Restore MP -- same shape as heal HP.
    {
      key: "restore_mp",
      regex: /restores?\s+(\d+(?:\.\d+)?)\s+(?:MP|mana)(?:\s+over\s+(\d+(?:\.\d+)?)\s*s)?/i,
      build: (m) => ({
        type: "heal",
        resource: "mp",
        value: parseFloat(m[1]),
        durationSec: m[2] ? parseFloat(m[2]) : 0,
        target: "self"
      })
    },
    // AI CHANGED: Step into Darkness -- ongoing MP drain while effect is active (not upfront mana cost).
    {
      key: "mana_drain_per_sec",
      regex: /consumes\s+(\d+(?:\.\d+)?)\s+mana\s+every\s+second/i,
      build: (m) => ({
        type: "mana_drain_per_sec",
        mpPerSec: parseFloat(m[1]),
        target: "self"
      })
    },
    // AI CHANGED: Predator Dexterity -- dodge chance buff.
    {
      key: "dodge_buff",
      regex: /(\d+(?:\.\d+)?)%\s+chance\s+to\s+dodge\s+enemy\s+skills?\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "dodge_buff",
        dodgePercent: parseFloat(m[1]),
        durationSec: parseFloat(m[2]),
        target: "self"
      })
    },
    // AI CHANGED: Taste of Death -- critical damage multiplier buff.
    {
      key: "crit_damage_buff",
      regex: /critical\s+hit\s+damage\s+by\s+(\d+(?:\.\d+)?)%\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "crit_damage_buff",
        critDamagePercent: parseFloat(m[1]),
        durationSec: parseFloat(m[2]),
        target: "self"
      })
    },
    // AI CHANGED: Full stealth / invis (visibility to 0).
    {
      key: "stealth_full",
      regex: /visibility\s+of\s+.*?\s+is\s+decreased\s+to\s+0/i,
      build: () => ({
        type: "stealth",
        visibility: 0,
        target: "self"
      })
    }
  ];

  // AI CHANGED: Main description + optional .header-additional-description (e.g. interrupt hint).
  // Regex patterns see the merged string so nothing important is dropped.
  function getDescriptionText(popupRoot) {
    const mainNode = popupRoot.querySelector(Config.selectors.skillPopupDescription);
    const mainText = mainNode ? (mainNode.textContent || "").replace(/\s+/g, " ").trim() : "";
    let addText = "";
    if (Config.selectors.skillPopupAdditionalDescription) {
      const addNode = popupRoot.querySelector(Config.selectors.skillPopupAdditionalDescription);
      if (addNode) {
        addText = (addNode.textContent || "").replace(/\s+/g, " ").trim();
      }
    }
    if (addText) {
      return (mainText + " " + addText).trim();
    }
    return mainText;
  }

  // AI CHANGED: Secondary line alone (for display / "interruptible" hints without re-parsing).
  function getAdditionalDescriptionText(popupRoot) {
    if (!Config.selectors.skillPopupAdditionalDescription) {
      return "";
    }
    const addNode = popupRoot.querySelector(Config.selectors.skillPopupAdditionalDescription);
    if (!addNode) {
      return "";
    }
    return (addNode.textContent || "").replace(/\s+/g, " ").trim();
  }

  // AI CHANGED: "Instantly" activation is not numeric in param-value-current -- treat as 0 s cast.
  function normalizeCastTimeSec(params) {
    const at = params.activation_time;
    if (!at) {
      return null;
    }
    const raw = (at.raw || "").trim();
    if (/^instantly$/i.test(raw)) {
      return 0;
    }
    if (at.value !== null && Number.isFinite(at.value)) {
      return at.value;
    }
    return null;
  }

  // AI CHANGED: Collect all <app-tag> labels (case-insensitive, lowercased). e.g. ["attack","target"].
  function getSkillTags(popupRoot) {
    const tagNodes = popupRoot.querySelectorAll(Config.selectors.skillPopupTag);
    const tags = [];
    for (let i = 0; i < tagNodes.length; i += 1) {
      const t = (tagNodes[i].textContent || "").trim().toLowerCase();
      if (t) {
        tags.push(t);
      }
    }
    return tags;
  }

  // AI CHANGED: Extract { paramName -> { value, units } } from the .action-info-params block.
  // Numeric value is read from .param-value-current; if not present, falls back to text content.
  function getSkillParams(popupRoot) {
    const items = popupRoot.querySelectorAll(Config.selectors.skillPopupParam);
    const out = {};
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const leftNode = item.querySelector(Config.selectors.skillPopupParamLeft);
      const rightNode = item.querySelector(Config.selectors.skillPopupParamRight);
      if (!leftNode || !rightNode) {
        continue;
      }
      const key = (leftNode.textContent || "").trim().toLowerCase().replace(/\s+/g, "_");
      const valueNode = rightNode.querySelector(Config.selectors.skillPopupParamValue);
      const unitsNode = rightNode.querySelector(Config.selectors.skillPopupParamUnits);
      let valueText;
      if (valueNode) {
        valueText = (valueNode.textContent || "").trim();
      } else {
        valueText = (rightNode.textContent || "").trim();
      }
      const numeric = Number.parseFloat(valueText);
      out[key] = {
        raw: valueText,
        value: Number.isFinite(numeric) ? numeric : null,
        units: unitsNode ? (unitsNode.textContent || "").trim() : null
      };
    }
    return out;
  }

  // AI CHANGED: Apply every effect pattern to the description text. Order: run SkillEffectPatterns
  // first (channel_gear, DoT, etc.), then basic_proc unless channel_gear already encodes the hit.
  function parseSkillEffects(description) {
    const effects = [];
    if (!description) {
      return effects;
    }
    // Run each effect pattern first (array is ordered most-specific first).
    for (let i = 0; i < SkillEffectPatterns.length; i += 1) {
      const pattern = SkillEffectPatterns[i];
      const m = description.match(pattern.regex);
      if (m) {
        try {
          effects.push(pattern.build(m));
        } catch (err) {
          Logger.warn("SKILLS", `Pattern '${pattern.key}' threw on match`, err);
        }
      }
    }
    // AI CHANGED: basic_proc -- skip if channel_gear already describes the same base+gear bundle (Sniper Shot).
    const hasChannelGear = effects.some((e) => e.type === "channel_gear");
    if (!hasChannelGear) {
      if (/deals\s+basic\s+(physical|magic|magical)\s+damage/i.test(description)) {
        const m = description.match(/deals\s+basic\s+(physical|magic|magical)\s+damage/i);
        effects.push({
          type: "basic_proc",
          damageType: m[1].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        });
      } else if (/deals\s+base\s+(physical|magic|magical)\s+damage\s+to\s+the\s+target/i.test(description)) {
        const m = description.match(/deals\s+base\s+(physical|magic|magical)\s+damage\s+to\s+the\s+target/i);
        effects.push({
          type: "basic_proc",
          damageType: m[1].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        });
      }
    }
    // Generic "additional N damage" -- only emitted if no DoT already captured (DoT regex is more
    // specific and would have consumed the same number).
    if (!effects.some((e) => e.type === "dot")) {
      const m = description.match(/(?:additional|additionally)\s+(\d+(?:\.\d+)?)\s+(physical|magic|magical)\s+damage(?!\s+over)/i);
      if (m) {
        effects.push({
          type: "instant",
          value: parseFloat(m[1]),
          damageType: m[2].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        });
      }
    }
    return effects;
  }

  // AI CHANGED: Classify a button purely from its class string + image URL, BEFORE we open its
  // popup. Lets us decide whether to scan it at all and what record shape to emit.
  function classifyActionButton(button) {
    const cls = (button.className || "").toString().toLowerCase();
    const imgNode = button.querySelector(".action-image");
    const styleAttr = imgNode ? (imgNode.getAttribute("style") || "") : "";
    const iconMatch = styleAttr.match(/url\("?([^")]+)"?\)/i);
    const iconUrl = iconMatch ? iconMatch[1] : "";
    if (cls.includes("type-empty")) {
      return { kind: "empty", iconUrl: iconUrl };
    }
    if (cls.includes("type-default")) {
      return { kind: "basic", iconUrl: iconUrl };
    }
    if (cls.includes("type-item")) {
      // Pull tier from class (rare/common/etc) and resource from the icon filename.
      const tierMatch = cls.match(/type-item-(common|uncommon|rare|epic|legendary|mythic)/);
      let resource = "unknown";
      if (/potion-health/i.test(iconUrl)) {
        resource = "hp";
      } else if (/potion-mana/i.test(iconUrl)) {
        resource = "mp";
      }
      return {
        kind: "potion",
        resource: resource,
        tier: tierMatch ? tierMatch[1] : "unknown",
        iconUrl: iconUrl
      };
    }
    if (cls.includes("type-skill")) {
      // Skill flavor (attack vs support) from the type-skill-X class.
      const flavorMatch = cls.match(/type-skill-(\w+)/);
      return {
        kind: "skill",
        flavor: flavorMatch ? flavorMatch[1] : "unknown",
        iconUrl: iconUrl
      };
    }
    return { kind: "unknown", iconUrl: iconUrl };
  }

  // AI CHANGED: Pull the unique skill icon hash out of the asset URL so we can detect when a
  // user remaps a slot to a different skill. e.g. "1591a679...c3c06.webp" -> "1591a679...c3c06".
  function getIconHash(iconUrl) {
    if (!iconUrl) {
      return null;
    }
    const m = iconUrl.match(/\/([0-9a-f]{16,})\.webp/i);
    if (m) {
      return m[1];
    }
    // Fall back to last filename component without extension.
    const parts = iconUrl.split("/");
    const last = parts[parts.length - 1] || "";
    return last.replace(/\.\w+$/, "") || null;
  }

  // AI CHANGED: Open one action-bar slot's description popup. Returns the popup root element
  // when it's visible, or null on timeout. NEVER dispatches mouseup on the button itself --
  // that could fire `click` and accidentally cast/use the slot. We dispatch mouseup on
  // document.body later, after the popup is closed via its X button.
  async function openActionPopup(button) {
    const cfg = Config.skills;
    const downEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1
    });
    button.dispatchEvent(downEvent);
    // Hold long enough that the game registers a long-press, not a click.
    await sleep(cfg.holdToOpenMs);
    // Now poll for the popup to mount.
    const appeared = await waitForCondition(
      "skill popup appear",
      () => !!document.querySelector(Config.selectors.skillPopup),
      { timeoutMs: cfg.popupAppearTimeoutMs, pollMs: cfg.popupPollMs }
    );
    if (!appeared) {
      Logger.warn("SKILLS", "Popup never appeared after long-press");
      return null;
    }
    return document.querySelector(Config.selectors.skillPopup);
  }

  // AI CHANGED: Close the description popup via its X button and wait for unmount. After unmount
  // we fire one mouseup on document.body so any mousedown state we left behind is cleared
  // somewhere harmless (away from any action button).
  async function closeActionPopup() {
    const cfg = Config.skills;
    const closeButton = document.querySelector(Config.selectors.skillPopupClose);
    if (!closeButton) {
      Logger.warn("SKILLS", "Close button not found; popup may already be closed");
    } else {
      clickElementSafe(closeButton);
    }
    const closed = await waitForCondition(
      "skill popup close",
      () => !document.querySelector(Config.selectors.skillPopup),
      { timeoutMs: cfg.popupCloseTimeoutMs, pollMs: cfg.popupPollMs }
    );
    // Release the dangling mousedown somewhere safe regardless of close success.
    try {
      document.body.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 0
      }));
    } catch (err) {
      // ignore -- not critical
    }
    return closed;
  }

  // AI CHANGED: Parse a single popup-mounted action into a structured record. Caller provides
  // the classification (so we can short-circuit empty slots) plus the slot index for traceability.
  function parseActionPopup(popupRoot, classification, slotIndex) {
    const nameNode = popupRoot.querySelector(Config.selectors.skillPopupName);
    const rawName = nameNode ? (nameNode.textContent || "").trim() : "";
    // "Rapid Fire (4/10)" -> name="Rapid Fire", level=4, maxLevel=10
    let name = rawName;
    let level = null;
    let maxLevel = null;
    const levelMatch = rawName.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
    if (levelMatch) {
      name = levelMatch[1].trim();
      level = parseInt(levelMatch[2], 10);
      maxLevel = parseInt(levelMatch[3], 10);
    }
    const tags = getSkillTags(popupRoot);
    const description = getDescriptionText(popupRoot);
    const descriptionAdditional = getAdditionalDescriptionText(popupRoot);
    const params = getSkillParams(popupRoot);
    const effects = parseSkillEffects(description);
    return {
      slot: slotIndex,
      kind: classification.kind,
      flavor: classification.flavor || null,
      resource: classification.resource || null,
      tier: classification.tier || null,
      iconUrl: classification.iconUrl || null,
      iconHash: getIconHash(classification.iconUrl),
      name: name,
      level: level,
      maxLevel: maxLevel,
      tags: tags,
      // AI CHANGED: Convenience targeting flags derived from tags (canonicalized for the planner).
      targetsSelf: tags.indexOf("self") >= 0,
      targetsEnemy: tags.indexOf("target") >= 0,
      isAttack: tags.indexOf("attack") >= 0,
      isSupport: tags.indexOf("support") >= 0,
      // AI CHANGED: Common params surfaced as top-level for the planner; full params kept under
      // `paramsRaw` for later patterns we haven't generalised yet.
      castTimeSec: normalizeCastTimeSec(params),
      cooldownSec: params.cooldown && params.cooldown.value !== null
        ? params.cooldown.value : null,
      manaCost: params.mana_cost && params.mana_cost.value !== null
        ? params.mana_cost.value : null,
      range: params.range ? params.range.raw : null,
      weapon: params.weapon ? params.weapon.raw : null,
      paramsRaw: params,
      description: description,
      // AI CHANGED: Extra modal line when present (interrupt hints, etc.).
      descriptionAdditional: descriptionAdditional || null,
      effects: effects
    };
  }

  // AI CHANGED: Read action-bar count badge for potions (the .action-counter on the button itself).
  // Skills don't have this; potions show charges (e.g. "246"). We sample BEFORE opening the popup
  // because opening it doesn't modify the badge.
  function readActionCounter(button) {
    const counter = button.querySelector(".action-counter-top, .action-counter-bottom");
    if (!counter) {
      return null;
    }
    const text = (counter.textContent || "").trim();
    const numeric = Number.parseInt(text, 10);
    return {
      raw: text,
      value: Number.isFinite(numeric) ? numeric : null
    };
  }

  // AI CHANGED: Persist the parsed slot array to localStorage so subsequent page reloads can skip
  // the rescan. Versioned key (Config.skills.storageKey) so a parser-schema change forces fresh scan.
  function saveSkillsToCache(slots) {
    try {
      const payload = {
        version: 2,
        savedAt: Date.now(),
        slots: slots
      };
      localStorage.setItem(Config.skills.storageKey, JSON.stringify(payload));
      Logger.log("SKILLS", `Saved ${slots.length} slots to localStorage`, { key: Config.skills.storageKey });
      return true;
    } catch (err) {
      Logger.warn("SKILLS", "Failed to save skills to localStorage", err);
      return false;
    }
  }

  // AI CHANGED: Try to populate Runtime.skills.slots from localStorage on boot. Returns true on
  // successful load, false otherwise. Boot logs which path we took so the user can verify.
  function loadSkillsFromCache() {
    try {
      const raw = localStorage.getItem(Config.skills.storageKey);
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.slots)) {
        return false;
      }
      Runtime.skills.slots = payload.slots;
      Runtime.skills.cacheLoadedAt = Date.now();
      Runtime.skills.scannedAt = payload.savedAt || null;
      return true;
    } catch (err) {
      Logger.warn("SKILLS", "Failed to load skills cache", err);
      return false;
    }
  }

  // AI CHANGED: Wipe the cache (Runtime + localStorage). Exposed via window.ligmarBot for quick
  // recovery if the cache ever ends up corrupted.
  function clearSkillsCache() {
    try {
      localStorage.removeItem(Config.skills.storageKey);
    } catch (err) {
      Logger.warn("SKILLS", "Failed to remove cache key", err);
    }
    Runtime.skills.slots = [];
    Runtime.skills.scannedAt = null;
    Runtime.skills.cacheLoadedAt = null;
    Runtime.skills.lastError = null;
    Logger.log("SKILLS", "Skill cache cleared");
  }

  // AI CHANGED: Console summary column -- potions both use effect.type "heal"; append resource so the
  // table is not ambiguous (heal_hp vs heal_mp). Runtime still stores full objects for the planner.
  function formatEffectForTable(effect) {
    if (!effect || typeof effect.type !== "string") {
      return "";
    }
    if (effect.type === "heal" && effect.resource) {
      return "heal_" + effect.resource;
    }
    return effect.type;
  }

  // AI CHANGED: Top-level scan. Iterates every slot in the action bar, classifies, opens popup
  // (skipping empty slots), parses, closes popup, accumulates records. Returns the array of
  // parsed slots. Refuses to run while auto-farm is active so we never accidentally cast a skill
  // mid-fight by simulating clicks. Caller can wait for the returned promise; the bot status
  // bar surfaces progress via setBotStatus.
  async function scanSkills() {
    if (Runtime.autoFarm.running) {
      Logger.warn("SKILLS", "Cannot scan: auto-farm is running. Press OFF first, then retry.");
      Runtime.skills.lastError = "auto_farm_running";
      return null;
    }
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      Logger.warn("SKILLS", "Action bar not found in DOM. Are you in-game?");
      Runtime.skills.lastError = "no_action_bar";
      return null;
    }
    const buttons = bar.querySelectorAll("app-action-button");
    if (!buttons || buttons.length === 0) {
      Logger.warn("SKILLS", "Action bar has no buttons; selector may be stale");
      Runtime.skills.lastError = "no_buttons";
      return null;
    }
    setBotStatus("scanning", `skills (0/${buttons.length})`);
    Logger.log("SKILLS", `Scanning ${buttons.length} action-bar slots`);

    const slots = [];
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i];
      const classification = classifyActionButton(button);
      // Read the counter (potion charges, etc.) BEFORE opening the popup -- the popup may move
      // focus and detach the badge node briefly.
      const counter = readActionCounter(button);

      if (classification.kind === "empty") {
        slots.push({
          slot: i,
          kind: "empty",
          iconUrl: classification.iconUrl
        });
        setBotStatus("scanning", `skills (${i + 1}/${buttons.length}) -- empty`);
        continue;
      }

      setBotStatus("scanning", `skills (${i + 1}/${buttons.length}) -- ${classification.kind}`);
      let popupRoot = null;
      try {
        popupRoot = await openActionPopup(button);
      } catch (err) {
        Logger.warn("SKILLS", `openActionPopup threw on slot ${i}`, err);
      }
      if (!popupRoot) {
        slots.push({
          slot: i,
          kind: classification.kind,
          iconUrl: classification.iconUrl,
          iconHash: getIconHash(classification.iconUrl),
          counter: counter,
          parseFailed: true,
          parseError: "popup_did_not_appear"
        });
        // Try to clean up state anyway.
        await closeActionPopup();
        await sleep(Config.skills.betweenSlotsMs);
        continue;
      }
      let record;
      try {
        record = parseActionPopup(popupRoot, classification, i);
        record.counter = counter;
      } catch (err) {
        Logger.warn("SKILLS", `parseActionPopup threw on slot ${i}`, err);
        record = {
          slot: i,
          kind: classification.kind,
          iconUrl: classification.iconUrl,
          iconHash: getIconHash(classification.iconUrl),
          counter: counter,
          parseFailed: true,
          parseError: (err && err.message) ? err.message : String(err)
        };
      }
      slots.push(record);

      const closed = await closeActionPopup();
      if (!closed) {
        Logger.warn("SKILLS", `Popup may still be open after slot ${i}; continuing anyway`);
      }
      await sleep(Config.skills.betweenSlotsMs);
    }

    Runtime.skills.slots = slots;
    Runtime.skills.scannedAt = Date.now();
    Runtime.skills.lastError = null;
    saveSkillsToCache(slots);

    // Pretty-print a table for quick eyeballing. Console-only -- no GUI clutter.
    const tableData = slots.map((s) => ({
      slot: s.slot,
      kind: s.kind,
      flavor: s.flavor || "",
      name: s.name || (s.kind === "empty" ? "(empty)" : ""),
      level: s.level || "",
      cast: s.castTimeSec ?? "",
      cd: s.cooldownSec ?? "",
      mp: s.manaCost ?? "",
      counter: s.counter ? s.counter.value : "",
      effects: Array.isArray(s.effects) ? s.effects.map(formatEffectForTable).join("+") : ""
    }));
    /* eslint-disable no-console */
    if (typeof console.table === "function") {
      console.table(tableData);
    }
    /* eslint-enable no-console */
    Logger.log("SKILLS", `Scan done: ${slots.length} slots parsed`, {
      nonEmpty: slots.filter((s) => s.kind !== "empty").length,
      withEffects: slots.filter((s) => Array.isArray(s.effects) && s.effects.length > 0).length,
      failed: slots.filter((s) => s.parseFailed).length
    });
    setBotStatus("idle", `skills scanned: ${slots.length}`);
    return slots;
  }
