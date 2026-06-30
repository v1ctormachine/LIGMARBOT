  // --- Layer 3 Module: 82-skills.js (Action Bar Scanner & Parser) ---
  // Rebuilt strictly based on user specifications:
  //   - Exact long-press sequence: mousedown -> hold 450ms -> wait for tooltip -> mouseup -> read details -> close.
  //   - No persistent local storage caching (rescans every time the bot is activated).
  //   - Scans all 18 action-bar slots found in the DOM (no hardcoded limits!).
  //   - Simple base effect parsing (advanced Mage/Priest custom patterns removed for now).

  const SkillEffectPatterns = [
    // Pattern channel_gear: Sniper Shot style -- channel up to T sec + base hit + up to N% gear damage.
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
    // Pattern DoT -- "<NUMBER> (physical|magic|magical) damage over <NUMBER> s"
    {
      key: "dot",
      regex: /([\d,]+(?:\.\d+)?)\s+(physical|magic|magical)\s+damage\s+over\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => {
        const total = parseFloat(String(m[1]).replace(/,/g, ""));
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
    // Pattern Slow -- "Slows the target by <N>% for <T> s"
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
    // Pattern Stun -- "Stuns? the target for <T> s"
    {
      key: "stun",
      regex: /stuns?\s+(?:the\s+)?target\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "stun",
        durationSec: parseFloat(m[1]),
        target: "enemy"
      })
    },
    // Pattern Damage buff -- "<N>% additional <KIND> damage with each attack for <T> s"
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
    // Pattern Heal HP (Standard)
    {
      key: "heal_hp",
      regex: /restores?\s+([\d,]+(?:\.\d+)?)\s*(?:\(\s*\+?\s*([\d,]+(?:\.\d+)?)\s*\))?\s+(?:HP|health)(?:\s+over\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:ond)?s?)?)?)?/i,
      build: (m) => {
        const base = parseFloat(String(m[1]).replace(/,/g, ""));
        const bonus = m[2] ? parseFloat(String(m[2]).replace(/,/g, "")) : 0;
        const val = base + bonus;
        const durationSec = m[3] ? parseFloat(m[3]) : 0;
        return {
          type: "heal",
          resource: "hp",
          value: val,
          durationSec: durationSec,
          target: "self"
        };
      }
    },
    // Pattern Restore MP (Standard)
    {
      key: "restore_mp",
      regex: /restores?\s+([\d,]+(?:\.\d+)?)\s*(?:\(\s*\+?\s*([\d,]+(?:\.\d+)?)\s*\))?\s+(?:MP|mana)(?:\s+over\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:ond)?s?)?)?)?/i,
      build: (m) => {
        const base = parseFloat(String(m[1]).replace(/,/g, ""));
        const bonus = m[2] ? parseFloat(String(m[2]).replace(/,/g, "")) : 0;
        const val = base + bonus;
        const durationSec = m[3] ? parseFloat(m[3]) : 0;
        return {
          type: "heal",
          resource: "mp",
          value: val,
          durationSec: durationSec,
          target: "self"
        };
      }
    },
    // Pattern Step into Darkness mana drain
    {
      key: "mana_drain_per_sec",
      regex: /consumes\s+(\d+(?:\.\d+)?)\s+mana\s+every\s+second/i,
      build: (m) => ({
        type: "mana_drain_per_sec",
        mpPerSec: parseFloat(m[1]),
        target: "self"
      })
    },
    // Pattern Predator Dexterity dodge
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
    // Pattern Taste of Death critical damage
    {
      key: "crit_damage_buff",
      regex: /critical\s+hit\s+damage\s+by\s+(\d+(?:\.\d+)?)%\s+for\s+(\d+(?:\.\d+)?)\s*s/i,
      build: (m) => ({
        type: "crit_damage_buff",
        critDamagePercent: parseFloat(m[1]),
        durationSec: parseFloat(m[2]),
        target: "self"
      })
    }
  ];

  function normalizeSkillName(rawName) {
    if (!rawName) return "";
    return String(rawName).split("(")[0].replace(/[’']/g, "'").trim();
  }

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
    return (mainText + " " + addText).trim();
  }

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

  function normalizeCastTimeSec(params) {
    const at = params.activation_time;
    if (!at) return null;
    const raw = (at.raw || "").trim();
    if (/^instantly$/i.test(raw)) return 0;
    return at.value !== null && Number.isFinite(at.value) ? at.value : null;
  }

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
      let valueText = valueNode ? (valueNode.textContent || "").trim() : (rightNode.textContent || "").trim();
      const numeric = Number.parseFloat(valueText);
      out[key] = {
        raw: valueText,
        value: Number.isFinite(numeric) ? numeric : null,
        units: unitsNode ? (unitsNode.textContent || "").trim() : null
      };
    }
    return out;
  }

  function parseSkillEffects(description) {
    const effects = [];
    if (!description) return effects;

    // Evaluate in order of SkillEffectPatterns
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

    const hasChannelGear = effects.some((e) => e.type === "channel_gear");
    if (!hasChannelGear) {
      const basicMatch = description.match(/deals\s+basic\s+(physical|magic|magical)\s+damage/i);
      if (basicMatch) {
        effects.push({
          type: "basic_proc",
          damageType: basicMatch[1].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        });
      } else {
        const baseMatch = description.match(/deals\s+base\s+(physical|magic|magical)\s+damage\s+to\s+the\s+target/i);
        if (baseMatch) {
          effects.push({
            type: "basic_proc",
            damageType: baseMatch[1].toLowerCase().replace("magical", "magic"),
            target: "enemy"
          });
        }
      }
    }

    // Generic "additional N damage" -- only emitted if no DoT already captured
    if (!effects.some((e) => e.type === "dot")) {
      let m = description.match(/(?:additional|additionally)\s+([\d,]+(?:\.\d+)?)\s+(physical|magic|magical)\s+damage(?!\s+over)/i);
      if (!m) {
        m = description.match(
          /(?:additional|additionally)\s+([\d,]+(?:\.\d+)?)(?:\s*(?:\u2192|->|>)\s*[\d,]+(?:\.\d+)?)?\s+of\s+(physical|magic|magical)\s+damage(?!\s+over)/i
        );
      }
      if (m) {
        effects.push({
          type: "instant",
          value: parseFloat(m[1].replace(/,/g, "")),
          damageType: m[2].toLowerCase().replace("magical", "magic"),
          target: "enemy"
        });
      }
    }

    return effects;
  }

  function inferSkillConception(slotLike) {
    const tags = Array.isArray(slotLike.tags) ? slotLike.tags : [];
    const desc = slotLike.description || "";
    const effects = Array.isArray(slotLike.effects) ? slotLike.effects : [];
    
    const conception = {
      isAttack: tags.includes("attack"),
      isSupport: tags.includes("support"),
      targetsSelf: tags.includes("self"),
      targetsEnemy: tags.includes("target"),
      flags: {
        dot: effects.some((e) => e.type === "dot"),
        slow: effects.some((e) => e.type === "slow"),
        stun: effects.some((e) => e.type === "stun"),
        channel: effects.some((e) => e.type === "channel_gear")
      }
    };
    return conception;
  }

  function getActionSlotVisualSource(el) {
    if (!el) {
      return "";
    }
    const img = el.querySelector("img");
    if (img) {
      const src = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (src) {
        return String(src);
      }
    }
    const imageNode = el.querySelector(".action-image, .skill-button-image, [style*='background-image']");
    if (imageNode) {
      const inlineBg = imageNode.style && imageNode.style.backgroundImage ? imageNode.style.backgroundImage : "";
      const attrStyle = imageNode.getAttribute("style") || "";
      const bg = inlineBg || attrStyle;
      if (bg) {
        return String(bg);
      }
    }
    const attrStyle = el.getAttribute("style") || "";
    if (attrStyle.indexOf("background-image") !== -1) {
      return attrStyle;
    }
    return "";
  }

  function inferPotionResourceFromSlotElement(el, visualSource) {
    const raw = [
      visualSource || "",
      el ? (el.className || "").toString() : "",
      el ? (el.getAttribute("aria-label") || "") : "",
      el ? (el.getAttribute("title") || "") : "",
      el ? (el.textContent || "") : ""
    ].join(" ").toLowerCase();

    if (raw.indexOf("potion-health") !== -1 || raw.indexOf("health-potion") !== -1 || raw.indexOf("potion_hp") !== -1) {
      return "hp";
    }
    if (raw.indexOf("potion-mana") !== -1 || raw.indexOf("mana-potion") !== -1 || raw.indexOf("potion-mp") !== -1 || raw.indexOf("mp-potion") !== -1) {
      return "mp";
    }
    return null;
  }

  function buildInferredPotionSlotRecord(slotIndex, el, resource, visualSource) {
    const counterNode = el ? el.querySelector(".action-counter, .skill-counter, [class*='counter']") : null;
    const count = counterNode ? parseFirstInt(counterNode.textContent || "") : null;
    return {
      slot: slotIndex,
      kind: "potion",
      potionResource: resource,
      name: resource === "hp" ? "HP Potion" : "MP Potion",
      nameRaw: resource === "hp" ? "HP Potion" : "MP Potion",
      visualSource: visualSource || "",
      count: Number.isFinite(count) ? count : null,
      tags: ["item", "potion", resource],
      effects: [{
        type: "heal",
        resource: resource,
        value: 1,
        durationSec: 0,
        target: "self",
        inferredFromIcon: true
      }],
      parseFailed: false,
      inferredFromIcon: true
    };
  }


  // Real-Time Skill Scanner (No localStorage caching!)
  // Exact user-defined sequence: mousedown -> hold 450ms -> wait for tooltip -> mouseup -> read details -> click close
  async function scanSkills() {
    Logger.log("SKILLS", "Starting real-time action bar skill scan");
    
    if (Runtime && Runtime.skills) {
      Runtime.skills.lastError = null;
    }

    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      if (Runtime && Runtime.skills) Runtime.skills.lastError = "bar_missing";
      Logger.warn("SKILLS", "Action bar element not found in DOM");
      return false;
    }

    const slots = Array.from(bar.querySelectorAll(Config.selectors.actionBarSlot));
    const scannedSlots = [];

    Logger.log("SKILLS", `Scanning all ${slots.length} action-bar slots found in DOM`);

    for (let i = 0; i < slots.length; i++) {
      const el = slots[i];
      if (!el) {
        scannedSlots.push({ slot: i, kind: "empty" });
        continue;
      }

      const visualSource = getActionSlotVisualSource(el);
      const potionResource = inferPotionResourceFromSlotElement(el, visualSource);

      if (potionResource) {
        scannedSlots.push(buildInferredPotionSlotRecord(i, el, potionResource, visualSource));
        continue;
      }

      if (!visualSource) {
        scannedSlots.push({ slot: i, kind: "empty" });
        continue;
      }

      const kind = "skill";

      // EXACT USER-DEFINED SEQUENCE:
      // 1. mousedown
      const mdEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      el.dispatchEvent(mdEvent);

      // 2. hold 450ms
      await sleep(Config.skills.holdToOpenMs || 450);

      // 3. wait for tooltip popup
      const popupSel = Config.selectors.skillPopup;
      const opened = await waitForCondition(
        "skill description tooltip appear",
        () => {
          const popup = document.body.querySelector(popupSel);
          return !!(popup && isElementVisible(popup));
        },
        { timeoutMs: Config.skills.popupAppearTimeoutMs || 1500, pollMs: Config.skills.popupPollMs || 60 }
      );

      // 4. mouseup (release hold immediately)
      const muEvent = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
      el.dispatchEvent(muEvent);
      document.body.dispatchEvent(muEvent); // safety release

      if (!opened) {
        Logger.warn("SKILLS", `Tooltip failed to appear for slot ${i}. Mapping as fallback.`);
        scannedSlots.push({ slot: i, kind: kind, name: `Slot ${i} Skill`, parseFailed: true });
        continue;
      }

      const popup = document.body.querySelector(popupSel);

      // 5. read details
      const rawName = (popup.querySelector(Config.selectors.skillPopupName)?.textContent || "").trim();
      const baseName = normalizeSkillName(rawName);
      const tags = getSkillTags(popup);
      const descText = getDescriptionText(popup);
      const params = getSkillParams(popup);
      
      const effects = parseSkillEffects(descText);
      const castTimeSec = normalizeCastTimeSec(params);
      const cooldownSec = params.cooldown && params.cooldown.value !== null ? params.cooldown.value : 0;
      const manaCost = params.mana_cost && params.mana_cost.value !== null ? params.mana_cost.value : 0;

      const record = {
        slot: i,
        kind: kind,
        nameRaw: rawName,
        name: baseName,
        tags: tags,
        description: descText,
        effects: effects,
        castTimeSec: castTimeSec,
        cooldownSec: cooldownSec,
        manaCost: manaCost,
        isAttack: tags.includes("attack") && tags.includes("target"),
        targetsEnemy: tags.includes("target"),
        conception: null
      };

      record.conception = inferSkillConception(record);

      // 6. click close
      const closeBtn = document.querySelector(Config.selectors.skillPopupClose);
      if (closeBtn) {
        clickElementSafe(closeBtn, "skill popup close button");
      }

      // Wait for tooltip to fully unmount
      await waitForCondition(
        "skill description tooltip clear",
        () => {
          const pop = document.body.querySelector(popupSel);
          return !pop || !isElementVisible(pop);
        },
        { timeoutMs: Config.skills.popupCloseTimeoutMs || 1000, pollMs: Config.skills.popupPollMs || 60 }
      );

      scannedSlots.push(record);

      // Yield the execution thread briefly between slots so the UI unmounts cleanly
      await sleep(Config.skills.betweenSlotsMs || 150);
    }

    if (Runtime && Runtime.skills) {
      Runtime.skills.slots = scannedSlots;
      Runtime.skills.scannedAt = Date.now();
    }
    
    Logger.log("SKILLS", `Action bar real-time scan complete: ${scannedSlots.length} slots found`, scannedSlots);
    return true;
  }
