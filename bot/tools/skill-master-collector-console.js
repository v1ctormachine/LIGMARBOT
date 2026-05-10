/**
 * Ligmar.io — Skill master DB collector (paste into DevTools console on /game/).
 *
 * Prerequisites:
 *   - Be on the game page. Prefer having the Tampermonkey bot loaded so
 *     `ligmarBot.parseSkillEffects` / `ligmarBot.Config.selectors` match the live parser.
 *   - Before a full 6-class run: open the FIRST hero's Character sheet → Skills tab
 *     (skill tree visible). Set startClassIndex to match that hero (0=assassin … 5=priest).
 *
 * Usage:
 *   await LigmarSkillMasterCollector.collectCurrentClass({ classKey: "assassin" })
 *   await LigmarSkillMasterCollector.runFullRoster({ startClassIndex: 0 })
 *
 * Output: object with schemaVersion + classes[].skills[]; also logs JSON and optional download.
 */
(function () {
  "use strict";

  var DEFAULT_CLASS_KEYS = ["assassin", "archer", "mage", "guardian", "warrior", "priest"];

  var CFG = {
    settleMs: 600,
    longSettleMs: 2200,
    popupWaitMs: 3500,
    betweenSkillsMs: 400,
    afterSelectMs: 4500,
    debug: true
  };

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function log() {
    if (CFG.debug) {
      console.log.apply(console, ["[SkillMasterCollector]"].concat([].slice.call(arguments)));
    }
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return [].slice.call((root || document).querySelectorAll(sel));
  }

  function clickEl(el, label) {
    if (!el) {
      log("click miss:", label);
      return false;
    }
    try {
      el.click();
    } catch (e) {
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    }
    return true;
  }

  function selectors() {
    if (typeof window.ligmarBot !== "undefined" && ligmarBot.Config && ligmarBot.Config.selectors) {
      return ligmarBot.Config.selectors;
    }
    return {
      skillPopup: "app-action-info",
      skillPopupClose: "app-icon.modal-header-close",
      skillPopupName: "app-action-info .action-name",
      skillPopupTag: "app-action-info app-tag",
      skillPopupDescription: "app-action-info .header-description",
      skillPopupAdditionalDescription: "app-action-info .header-additional-description",
      skillPopupParam: "app-action-info app-param-item-new",
      skillPopupParamLeft: ".param-item-left",
      skillPopupParamRight: ".param-item-right",
      skillPopupParamValue: ".param-value-current",
      skillPopupParamUnits: ".param-units"
    };
  }

  function findFooterButton(iconClassSubstring, textContains) {
    var buttons = qsa(".footer-button");
    var i;
    var b;
    var t;
    for (i = 0; i < buttons.length; i += 1) {
      b = buttons[i];
      if (iconClassSubstring && b.querySelector("[class*='" + iconClassSubstring + "']")) {
        return b;
      }
      t = ((b.textContent || "") + "").trim().toLowerCase();
      if (textContains && t.indexOf(textContains.toLowerCase()) !== -1) {
        return b;
      }
    }
    return null;
  }

  function getDescriptionMerged(popupRoot, sel) {
    var mainNode = qs(sel.skillPopupDescription, popupRoot) || qs(".header-description", popupRoot);
    var mainText = mainNode ? (mainNode.textContent || "").replace(/\s+/g, " ").trim() : "";
    var addText = "";
    var addNode = qs(sel.skillPopupAdditionalDescription, popupRoot);
    if (addNode) {
      addText = (addNode.textContent || "").replace(/\s+/g, " ").trim();
    }
    if (addText) {
      return (mainText + " " + addText).trim();
    }
    return mainText;
  }

  function getSkillTags(popupRoot, sel) {
    var tagNodes = popupRoot.querySelectorAll(sel.skillPopupTag);
    var tags = [];
    var i;
    var t;
    for (i = 0; i < tagNodes.length; i += 1) {
      t = (tagNodes[i].textContent || "").trim().toLowerCase();
      if (t) {
        tags.push(t);
      }
    }
    return tags;
  }

  function getSkillParams(popupRoot, sel) {
    var items = popupRoot.querySelectorAll(sel.skillPopupParam);
    var out = {};
    var i;
    var item;
    var leftNode;
    var rightNode;
    var key;
    var valueNode;
    var unitsNode;
    var valueText;
    var numeric;
    for (i = 0; i < items.length; i += 1) {
      item = items[i];
      leftNode = item.querySelector(sel.skillPopupParamLeft);
      rightNode = item.querySelector(sel.skillPopupParamRight);
      if (!leftNode || !rightNode) {
        continue;
      }
      key = (leftNode.textContent || "").trim().toLowerCase().replace(/\s+/g, "_");
      valueNode = rightNode.querySelector(sel.skillPopupParamValue);
      unitsNode = rightNode.querySelector(sel.skillPopupParamUnits);
      if (valueNode) {
        valueText = (valueNode.textContent || "").trim();
      } else {
        valueText = (rightNode.textContent || "").trim();
      }
      numeric = Number.parseFloat(valueText.replace(/,/g, ""));
      out[key] = {
        raw: valueText,
        value: Number.isFinite(numeric) ? numeric : null,
        units: unitsNode ? (unitsNode.textContent || "").trim() : null
      };
    }
    return out;
  }

  function normalizeCastTimeSec(params) {
    var at = params.activation_time;
    var raw;
    if (!at) {
      return null;
    }
    raw = (at.raw || "").trim();
    if (/^instantly$/i.test(raw)) {
      return 0;
    }
    if (at.value !== null && Number.isFinite(at.value)) {
      return at.value;
    }
    return null;
  }

  function classifyTreeButton(btn) {
    var cls = ((btn.className || "") + "").toLowerCase();
    var img = btn.querySelector(".action-image");
    var styleAttr = img ? img.getAttribute("style") || "" : "";
    var iconMatch = styleAttr.match(/url\("?([^")]+)"?\)/i);
    var iconUrl = iconMatch ? iconMatch[1] : "";
    var flavorMatch = cls.match(/type-skill-(\w+)/);
    return {
      kind: "skill",
      flavor: flavorMatch ? flavorMatch[1] : "unknown",
      iconUrl: iconUrl,
      disabled: cls.indexOf("action-disabled") !== -1
    };
  }

  function iconHashFromUrl(iconUrl) {
    if (!iconUrl) {
      return null;
    }
    var m = iconUrl.match(/\/([0-9a-f]{16,})\.webp/i);
    if (m) {
      return m[1];
    }
    var parts = iconUrl.split("/");
    var last = parts[parts.length - 1] || "";
    return last.replace(/\.\w+$/, "") || null;
  }

  function parseEffectsFromDescription(description) {
    if (
      typeof window.ligmarBot !== "undefined" &&
      typeof ligmarBot.parseSkillEffects === "function"
    ) {
      try {
        return ligmarBot.parseSkillEffects(description || "");
      } catch (e) {
        log("parseSkillEffects threw", e);
      }
    }
    return [];
  }

  function buildRecordFromPopup(popupRoot, classification, treeIndex, sel) {
    var nameNode = qs(sel.skillPopupName, popupRoot);
    var rawName = nameNode ? (nameNode.textContent || "").trim() : "";
    var name = rawName;
    var level = null;
    var maxLevel = null;
    var levelMatch = rawName.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
    var description = getDescriptionMerged(popupRoot, sel);
    var addDescNode = qs(sel.skillPopupAdditionalDescription, popupRoot);
    var descriptionAdditional = addDescNode
      ? (addDescNode.textContent || "").replace(/\s+/g, " ").trim()
      : null;
    if (levelMatch) {
      name = levelMatch[1].trim();
      level = parseInt(levelMatch[2], 10);
      maxLevel = parseInt(levelMatch[3], 10);
    }
    var tags = getSkillTags(popupRoot, sel);
    var paramsRaw = getSkillParams(popupRoot, sel);
    var effects = parseEffectsFromDescription(description);
    return {
      treeIndex: treeIndex,
      kind: classification.kind,
      flavor: classification.flavor,
      iconUrl: classification.iconUrl,
      iconHash: iconHashFromUrl(classification.iconUrl),
      treeDisabled: classification.disabled,
      name: name,
      level: level,
      maxLevel: maxLevel,
      tags: tags,
      targetsSelf: tags.indexOf("self") !== -1,
      targetsEnemy: tags.indexOf("target") !== -1,
      isAttack: tags.indexOf("attack") !== -1,
      isSupport: tags.indexOf("support") !== -1,
      description: description,
      descriptionAdditional: descriptionAdditional
        ? (descriptionAdditional + "").replace(/\s+/g, " ").trim()
        : null,
      paramsRaw: paramsRaw,
      castTimeSec: normalizeCastTimeSec(paramsRaw),
      cooldownSec:
        paramsRaw.cooldown && paramsRaw.cooldown.value !== null
          ? paramsRaw.cooldown.value
          : null,
      manaCost:
        paramsRaw.mana_cost && paramsRaw.mana_cost.value !== null
          ? paramsRaw.mana_cost.value
          : null,
      effects: effects,
      parseUsedBot: !!(typeof ligmarBot !== "undefined" && ligmarBot.parseSkillEffects)
    };
  }

  async function waitForPopup(sel, timeoutMs) {
    var t0 = Date.now();
    var popup;
    while (Date.now() - t0 < timeoutMs) {
      popup = qs(sel.skillPopup);
      if (popup && popup.offsetParent !== null) {
        return popup;
      }
      await sleep(90);
    }
    return null;
  }

  async function closeSkillPopup(sel) {
    var closeButton = qs(sel.skillPopupClose) || qs(".modal-header-close");
    clickEl(closeButton, "close popup");
    var t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      if (!qs(sel.skillPopup)) {
        break;
      }
      await sleep(80);
    }
    await sleep(CFG.betweenSkillsMs);
  }

  async function closeAnyOpenSkillPopup(sel) {
    if (qs(sel.skillPopup)) {
      await closeSkillPopup(sel);
    }
  }

  async function openCharacterSkills() {
    var tabs;
    var i;
    var tab;
    var tc;
    var label;
    clickEl(findFooterButton("character", "Character"), "Character footer");
    await sleep(CFG.settleMs);
    tabs = qsa("app-tab");
    for (i = 0; i < tabs.length; i += 1) {
      tab = tabs[i];
      tc = tab.querySelector(".tab-content");
      label = tc ? (tc.textContent || "").trim() : "";
      if (/^skills$/i.test(label)) {
        clickEl(tab, "Skills tab");
        await sleep(CFG.settleMs);
        return true;
      }
    }
    log("Skills tab not found");
    return false;
  }

  function getSkillTreeButtons() {
    var tree = qs(".skills-tree");
    if (!tree) {
      return [];
    }
    return qsa("app-action-button.skill-item", tree);
  }

  async function collectSkillTree(classKey) {
    var sel = selectors();
    var buttons = getSkillTreeButtons();
    var records = [];
    var i;
    var btn;
    var classification;
    var popup;
    var rec;
    log("skills in tree:", buttons.length, "class:", classKey);
    for (i = 0; i < buttons.length; i += 1) {
      btn = buttons[i];
      classification = classifyTreeButton(btn);
      clickEl(btn, "skill tree " + i);
      await sleep(250);
      popup = await waitForPopup(sel, CFG.popupWaitMs);
      if (!popup) {
        records.push({
          treeIndex: i,
          classKey: classKey,
          ok: false,
          error: "popup_timeout",
          classification: classification
        });
        continue;
      }
      try {
        rec = buildRecordFromPopup(popup, classification, i, sel);
        rec.classKey = classKey;
        rec.ok = true;
        records.push(rec);
      } catch (err) {
        records.push({
          treeIndex: i,
          classKey: classKey,
          ok: false,
          error: String(err && err.message ? err.message : err)
        });
      }
      await closeSkillPopup(sel);
    }
    return records;
  }

  async function navigateHallSelectClass(tabIndex) {
    var buildingBtns;
    var i;
    var b;
    var items;
    var it;
    var n;
    var classTabs;
    var selectBtn;
    await closeAnyOpenSkillPopup(selectors());
    clickEl(findFooterButton("town", "Town"), "Town");
    await sleep(CFG.longSettleMs);
    buildingBtns = qsa("app-button");
    for (i = 0; i < buildingBtns.length; i += 1) {
      b = buildingBtns[i];
      if (((b.textContent || "") + "").indexOf("Buildings") !== -1) {
        clickEl(b, "Buildings");
        break;
      }
    }
    await sleep(CFG.longSettleMs);
    items = qsa("app-location-item");
    for (i = 0; i < items.length; i += 1) {
      it = items[i];
      n = it.querySelector(".location-name");
      if (n && /hall of heroes/i.test((n.textContent || "") + "")) {
        clickEl(it, "Hall of Heroes");
        break;
      }
    }
    await sleep(CFG.longSettleMs);
    classTabs = qsa("app-tabs app-tab.tab-as-icon");
    if (classTabs[tabIndex]) {
      clickEl(classTabs[tabIndex], "class tab " + tabIndex);
      await sleep(CFG.settleMs);
    } else {
      log("class tab missing index", tabIndex, "count", classTabs.length);
    }
    selectBtn = qs("app-button.gear-button-select");
    clickEl(selectBtn, "Select");
    await sleep(CFG.afterSelectMs);
  }

  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "ligmar-skills-master.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.LigmarSkillMasterCollector = {
    cfg: CFG,

    setCfg: function (partial) {
      var k;
      for (k in partial) {
        if (Object.prototype.hasOwnProperty.call(partial, k)) {
          CFG[k] = partial[k];
        }
      }
    },

    collectCurrentClass: async function (opts) {
      opts = opts || {};
      var classKey = opts.classKey || "unknown";
      var sel = selectors();
      if (!qs(".skills-tree")) {
        log("No .skills-tree — open Character → Skills first, or call openCharacterSkills()");
        var opened = await openCharacterSkills();
        if (!opened) {
          return { classKey: classKey, ok: false, error: "skills_tree_not_visible" };
        }
      }
      var skills = await collectSkillTree(classKey);
      var payload = {
        schemaVersion: 1,
        classKey: classKey,
        collectedAt: new Date().toISOString(),
        gamePath: location.pathname,
        skills: skills
      };
      log("done", classKey, "records", skills.length);
      console.log(JSON.stringify(payload, null, 2));
      return payload;
    },

    runFullRoster: async function (opts) {
      opts = opts || {};
      var classKeys = opts.classKeys || DEFAULT_CLASS_KEYS;
      var startClassIndex =
        typeof opts.startClassIndex === "number" ? opts.startClassIndex : 0;
      var download = opts.download !== false;
      var i;
      var step;
      var classKey;
      var tabIdx;
      var skillsPayload;
      var out = {
        schemaVersion: 1,
        collectedAt: new Date().toISOString(),
        gamePath: location.pathname,
        startClassIndex: startClassIndex,
        classOrder: classKeys,
        classes: []
      };
      for (step = 0; step < classKeys.length; step += 1) {
        tabIdx = (startClassIndex + step) % classKeys.length;
        classKey = classKeys[tabIdx];
        if (step > 0) {
          await navigateHallSelectClass(tabIdx);
        }
        if (!(await openCharacterSkills())) {
          out.classes.push({ classKey: classKey, ok: false, error: "open_character_skills_failed" });
          continue;
        }
        skillsPayload = await collectSkillTree(classKey);
        out.classes.push({
          classKey: classKey,
          ok: true,
          collectedAt: new Date().toISOString(),
          skills: skillsPayload
        });
        log("finished class", classKey);
      }
      console.log(JSON.stringify(out, null, 2));
      if (download) {
        downloadJson(out, opts.filename || "ligmar-skills-master.json");
      }
      return out;
    },

    downloadJson: downloadJson,
    openCharacterSkills: openCharacterSkills,
    navigateHallSelectClass: navigateHallSelectClass
  };

  console.log(
    "%c[SkillMasterCollector] Ready. Examples:\n" +
      "  await LigmarSkillMasterCollector.collectCurrentClass({ classKey: \"assassin\" })\n" +
      "  await LigmarSkillMasterCollector.runFullRoster({ startClassIndex: 0 })",
    "color:#7dffb3"
  );
})();
