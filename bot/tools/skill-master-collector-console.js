// =============================================================================
// PASTE THIS FILE INTO: Chrome/Edge DevTools → Console tab, on ligmar.io/game/
// Do NOT install in Tampermonkey — use the normal game tab console only.
// Bot should be loaded so window.ligmarBot.parseSkillEffects exists (optional).
// =============================================================================

(function () {
  var NAMES = ["assassin", "archer", "mage", "guardian", "warrior", "priest"];
  var MS = { s: 500, L: 2000, pop: 3000, gap: 350, pick: 4500 };

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function qs(s, r) {
    return (r || document).querySelector(s);
  }
  function qsa(s, r) {
    return [].slice.call((r || document).querySelectorAll(s));
  }
  function click(el) {
    if (!el) {
      return;
    }
    try {
      el.click();
    } catch (e) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
  }
  function sel() {
    var b = window.ligmarBot;
    if (b && b.Config && b.Config.selectors) {
      return b.Config.selectors;
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
  function footer(iconBit, textBit) {
    var i;
    var el;
    var t;
    var list = qsa(".footer-button");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (iconBit && el.querySelector("[class*='" + iconBit + "']")) {
        return el;
      }
      t = (el.textContent || "").trim().toLowerCase();
      if (textBit && t.indexOf(textBit.toLowerCase()) !== -1) {
        return el;
      }
    }
    return null;
  }
  function mergeDesc(root, S) {
    var m = qs(S.skillPopupDescription, root) || qs(".header-description", root);
    var a = qs(S.skillPopupAdditionalDescription, root);
    var t1 = m ? (m.textContent || "").replace(/\s+/g, " ").trim() : "";
    var t2 = a ? (a.textContent || "").replace(/\s+/g, " ").trim() : "";
    return t2 ? (t1 + " " + t2).trim() : t1;
  }
  function tags(root, S) {
    var out = [];
    var nodes = root.querySelectorAll(S.skillPopupTag);
    var i;
    var x;
    for (i = 0; i < nodes.length; i++) {
      x = (nodes[i].textContent || "").trim().toLowerCase();
      if (x) {
        out.push(x);
      }
    }
    return out;
  }
  function params(root, S) {
    var out = {};
    var items = root.querySelectorAll(S.skillPopupParam);
    var i;
    var it;
    var L;
    var R;
    var k;
    var vn;
    var un;
    var vt;
    var num;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      L = it.querySelector(S.skillPopupParamLeft);
      R = it.querySelector(S.skillPopupParamRight);
      if (!L || !R) {
        continue;
      }
      k = (L.textContent || "").trim().toLowerCase().replace(/\s+/g, "_");
      vn = R.querySelector(S.skillPopupParamValue);
      un = R.querySelector(S.skillPopupParamUnits);
      vt = vn ? (vn.textContent || "").trim() : (R.textContent || "").trim();
      num = parseFloat(vt.replace(/,/g, ""));
      out[k] = { raw: vt, value: isFinite(num) ? num : null, units: un ? (un.textContent || "").trim() : null };
    }
    return out;
  }
  function castSec(p) {
    var a = p.activation_time;
    var r;
    if (!a) {
      return null;
    }
    r = (a.raw || "").trim();
    if (/^instantly$/i.test(r)) {
      return 0;
    }
    return a.value != null && isFinite(a.value) ? a.value : null;
  }
  function classifyBtn(btn) {
    var cls = (btn.className || "").toLowerCase();
    var img = btn.querySelector(".action-image");
    var st = img ? img.getAttribute("style") || "" : "";
    var u = (st.match(/url\("?([^")]+)"?\)/i) || [])[1] || "";
    var f = (cls.match(/type-skill-(\w+)/) || [])[1] || "unknown";
    return { flavor: f, iconUrl: u, disabled: cls.indexOf("action-disabled") !== -1 };
  }
  function iconHash(u) {
    var m;
    if (!u) {
      return null;
    }
    m = u.match(/\/([0-9a-f]{16,})\.webp/i);
    if (m) {
      return m[1];
    }
    return (u.split("/").pop() || "").replace(/\.\w+$/, "") || null;
  }
  function effects(txt) {
    var b = window.ligmarBot;
    if (b && typeof b.parseSkillEffects === "function") {
      try {
        return b.parseSkillEffects(txt || "");
      } catch (e) {}
    }
    return [];
  }
  function record(popup, cl, idx, S, heroClass) {
    var nn = qs(S.skillPopupName, popup);
    var raw = nn ? (nn.textContent || "").trim() : "";
    var nm = raw;
    var lv = null;
    var mx = null;
    var m = raw.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
    var desc = mergeDesc(popup, S);
    var addN = qs(S.skillPopupAdditionalDescription, popup);
    var addT = addN ? (addN.textContent || "").replace(/\s+/g, " ").trim() : null;
    var tg = tags(popup, S);
    var pr = params(popup, S);
    if (m) {
      nm = m[1].trim();
      lv = parseInt(m[2], 10);
      mx = parseInt(m[3], 10);
    }
    return {
      treeIndex: idx,
      classKey: heroClass,
      flavor: cl.flavor,
      iconUrl: cl.iconUrl,
      iconHash: iconHash(cl.iconUrl),
      treeDisabled: cl.disabled,
      name: nm,
      level: lv,
      maxLevel: mx,
      tags: tg,
      description: desc,
      descriptionAdditional: addT,
      paramsRaw: pr,
      castTimeSec: castSec(pr),
      cooldownSec: pr.cooldown && pr.cooldown.value != null ? pr.cooldown.value : null,
      manaCost: pr.mana_cost && pr.mana_cost.value != null ? pr.mana_cost.value : null,
      effects: effects(desc),
      usedBotParser: !!(window.ligmarBot && window.ligmarBot.parseSkillEffects)
    };
  }
  async function waitPop(S, tmax) {
    var t0 = Date.now();
    var p;
    while (Date.now() - t0 < tmax) {
      p = qs(S.skillPopup);
      if (p && p.offsetParent !== null) {
        return p;
      }
      await sleep(80);
    }
    return null;
  }
  async function closePop(S) {
    click(qs(S.skillPopupClose) || qs(".modal-header-close"));
    var t0 = Date.now();
    while (Date.now() - t0 < 2500 && qs(S.skillPopup)) {
      await sleep(60);
    }
    await sleep(MS.gap);
  }
  async function openCharSkills() {
    var i;
    var tab;
    var tc;
    var lab;
    click(footer("character", "Character"));
    await sleep(MS.s);
    for (i = 0; i < qsa("app-tab").length; i++) {
      tab = qsa("app-tab")[i];
      tc = tab.querySelector(".tab-content");
      lab = tc ? (tc.textContent || "").trim() : "";
      if (/^skills$/i.test(lab)) {
        click(tab);
        await sleep(MS.s);
        return true;
      }
    }
    return false;
  }
  function treeBtns() {
    var tr = qs(".skills-tree");
    return tr ? qsa("app-action-button.skill-item", tr) : [];
  }
  async function walkTree(classKey) {
    var S = sel();
    var btns = treeBtns();
    var out = [];
    var i;
    var b;
    var cl;
    var pop;
    var rec;
    for (i = 0; i < btns.length; i++) {
      b = btns[i];
      cl = classifyBtn(b);
      click(b);
      await sleep(200);
      pop = await waitPop(S, MS.pop);
      if (!pop) {
        out.push({ treeIndex: i, classKey: classKey, ok: false, err: "no_popup" });
      } else {
        try {
          rec = record(pop, cl, i, S, classKey);
          rec.ok = true;
          out.push(rec);
        } catch (e) {
          out.push({ treeIndex: i, classKey: classKey, ok: false, err: String(e && e.message ? e.message : e) });
        }
        await closePop(S);
      }
    }
    return out;
  }
  async function hallPick(tabIndex) {
    var i;
    var el;
    var n;
    if (qs(sel().skillPopup)) {
      await closePop(sel());
    }
    click(footer("town", "Town"));
    await sleep(MS.L);
    for (i = 0; i < qsa("app-button").length; i++) {
      el = qsa("app-button")[i];
      if ((el.textContent || "").indexOf("Buildings") !== -1) {
        click(el);
        break;
      }
    }
    await sleep(MS.L);
    for (i = 0; i < qsa("app-location-item").length; i++) {
      el = qsa("app-location-item")[i];
      n = el.querySelector(".location-name");
      if (n && /hall of heroes/i.test(n.textContent || "")) {
        click(el);
        break;
      }
    }
    await sleep(MS.L);
    el = qsa("app-tabs app-tab.tab-as-icon")[tabIndex];
    if (el) {
      click(el);
      await sleep(MS.s);
    }
    click(qs("app-button.gear-button-select"));
    await sleep(MS.pick);
  }

  window.lmcOne = async function (classKey) {
    var key = classKey || "unknown";
    if (!qs(".skills-tree") && !(await openCharSkills())) {
      return { ok: false, err: "open_skills_failed" };
    }
    var skills = await walkTree(key);
    var payload = { v: 1, classKey: key, at: new Date().toISOString(), skills: skills };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  };

  window.lmcAll = async function (startIndex) {
    var s = typeof startIndex === "number" ? startIndex : 0;
    var step;
    var tabIdx;
    var cname;
    var all = { v: 1, at: new Date().toISOString(), start: s, classes: [] };
    for (step = 0; step < NAMES.length; step++) {
      tabIdx = (s + step) % NAMES.length;
      cname = NAMES[tabIdx];
      if (step > 0) {
        await hallPick(tabIdx);
      }
      if (!(await openCharSkills())) {
        all.classes.push({ classKey: cname, ok: false, err: "open_skills" });
        continue;
      }
      all.classes.push({ classKey: cname, ok: true, skills: await walkTree(cname) });
    }
    console.log(JSON.stringify(all, null, 2));
    return all;
  };

  window.lmcDownload = function (obj, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = name || "ligmar-skills.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  console.log(
    "lmc ready. DevTools console only — not Tampermonkey.\n" +
      '  await lmcOne("assassin")\n' +
      "  await lmcAll(0)\n" +
      "  lmcDownload(await lmcAll(0))"
  );
})();
