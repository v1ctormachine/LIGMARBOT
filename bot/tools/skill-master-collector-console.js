// =============================================================================
// PASTE INTO: DevTools → Console. Pick execution context = same frame as game
// (or rely on auto iframe detection below). NOT Tampermonkey.
// =============================================================================

(function () {
  var NAMES = ["assassin", "archer", "mage", "guardian", "warrior", "priest"];
  var MS = { s: 500, L: 2000, pop: 2000, gap: 350, pick: 4500 };
  var DOC = document;

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function walkDocs(rootDoc, depth, acc) {
    if (!rootDoc || depth > 10 || acc.indexOf(rootDoc) >= 0) {
      return;
    }
    acc.push(rootDoc);
    var frames = rootDoc.querySelectorAll("iframe");
    var i;
    var ch;
    for (i = 0; i < frames.length; i++) {
      try {
        ch = frames[i].contentDocument;
        if (ch) {
          walkDocs(ch, depth + 1, acc);
        }
      } catch (e) {}
    }
  }

  function allSameOriginDocs() {
    var acc = [];
    walkDocs(document, 0, acc);
    return acc;
  }

  function lmcResolveDoc() {
    var docs = allSameOriginDocs();
    var i;
    for (i = 0; i < docs.length; i++) {
      if (docs[i].querySelector(".skills-tree")) {
        DOC = docs[i];
        return DOC;
      }
    }
    DOC = document;
    return DOC;
  }

  function qs(s, r) {
    return (r || DOC).querySelector(s);
  }
  function qsa(s, r) {
    return [].slice.call((r || DOC).querySelectorAll(s));
  }

  function winFor(el) {
    return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
  }
  function cStyle(el) {
    return winFor(el).getComputedStyle(el);
  }

  function ligmar() {
    var w = DOC.defaultView || window;
    if (typeof w.ligmarBot !== "undefined") {
      return w.ligmarBot;
    }
    if (typeof window.ligmarBot !== "undefined") {
      return window.ligmarBot;
    }
    return null;
  }

  // AI CHANGED: app-modal + .dialog-action app-action-info; header "Skill" optional (i18n).
  function findVisibleSkillPopup(S) {
    var i;
    var modals = qsa("app-modal");
    var modal;
    var mst;
    var hdr;
    var hdrOk;
    var info;
    var nameEl;
    var infos;
    var pst;
    var scoped;
    var list;
    var el;
    var st;
    var nameText;

    for (i = 0; i < modals.length; i++) {
      modal = modals[i];
      if (!modal || !modal.isConnected) {
        continue;
      }
      mst = cStyle(modal);
      if (mst.display === "none" || mst.visibility === "hidden" || parseFloat(mst.opacity) < 0.01) {
        continue;
      }
      info = modal.querySelector(".dialog-action app-action-info") || modal.querySelector(S.skillPopup);
      if (!info) {
        continue;
      }
      hdr = modal.querySelector(".modal-header-content");
      hdrOk = hdr && /\bskill\b/i.test((hdr.textContent || "").replace(/\s+/g, " ").trim());
      nameEl = info.querySelector(".action-name");
      nameText = nameEl ? (nameEl.textContent || "").trim() : "";
      if (hdrOk || nameText.length > 0 || info.querySelector(".header-description, .action-info-params")) {
        return info;
      }
    }

    infos = qsa(".dialog-action " + S.skillPopup);
    for (i = 0; i < infos.length; i++) {
      info = infos[i];
      if (!info || !info.isConnected) {
        continue;
      }
      pst = cStyle(info);
      if (pst.display === "none" || pst.visibility === "hidden") {
        continue;
      }
      modal = info.closest ? info.closest("app-modal") : null;
      if (modal) {
        mst = cStyle(modal);
        if (mst.display === "none") {
          continue;
        }
      }
      nameEl = info.querySelector(".action-name");
      if (nameEl && (nameEl.textContent || "").trim().length > 0) {
        return info;
      }
    }

    scoped = qsa(".cdk-overlay-container " + S.skillPopup);
    list = scoped.length > 0 ? scoped : qsa(S.skillPopup);
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.isConnected) {
        continue;
      }
      st = cStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) < 0.01) {
        continue;
      }
      nameEl = el.querySelector(".action-name");
      nameText = nameEl ? (nameEl.textContent || "").trim() : "";
      if (nameText.length > 0) {
        return el;
      }
    }
    return null;
  }

  function click(el) {
    if (!el) {
      return;
    }
    var win = winFor(el);
    try {
      el.click();
    } catch (e) {
      el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
    }
  }

  // AI CHANGED: apptap / Angular often expects pointer + mouse sequence, not only .click().
  function tapUi(el) {
    if (!el) {
      return;
    }
    var win = winFor(el);
    var r = el.getBoundingClientRect();
    var x = r.left + Math.min(r.width / 2, 40);
    var y = r.top + Math.min(r.height / 2, 40);
    var base = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0, buttons: 1 };
    try {
      el.dispatchEvent(
        new win.PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          view: win,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (e1) {}
    el.dispatchEvent(new win.MouseEvent("mousedown", base));
    try {
      el.dispatchEvent(
        new win.PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          view: win,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (e2) {}
    el.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0, buttons: 0 }));
    el.dispatchEvent(new win.MouseEvent("click", base));
    try {
      el.click();
    } catch (e3) {}
  }

  function sel() {
    var b = ligmar();
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
    var a = qs(S.skillPopupAdditionalDescription, root) || qs(".header-additional-description", root);
    var t1 = m ? (m.textContent || "").replace(/\s+/g, " ").trim() : "";
    var t2 = a ? (a.textContent || "").replace(/\s+/g, " ").trim() : "";
    return t2 ? (t1 + " " + t2).trim() : t1;
  }
  function tags(root, S) {
    var out = [];
    var nodes = root.querySelectorAll(S.skillPopupTag);
    if (nodes.length === 0) {
      nodes = root.querySelectorAll(".action-tags app-tag, app-tag");
    }
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
    if (items.length === 0) {
      items = root.querySelectorAll("app-param-item-new");
    }
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
    var b = ligmar();
    if (b && typeof b.parseSkillEffects === "function") {
      try {
        return b.parseSkillEffects(txt || "");
      } catch (e) {}
    }
    return [];
  }
  function record(popup, cl, idx, S, heroClass) {
    var nn = qs(S.skillPopupName, popup) || qs(".action-name", popup);
    var raw = nn ? (nn.textContent || "").trim() : "";
    var nm = raw;
    var lv = null;
    var mx = null;
    var m = raw.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
    var desc = mergeDesc(popup, S);
    var addN = qs(S.skillPopupAdditionalDescription, popup) || qs(".header-additional-description", popup);
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
      usedBotParser: !!(ligmar() && ligmar().parseSkillEffects)
    };
  }
  async function waitPop(S, tmax) {
    var t0 = Date.now();
    var p;
    while (Date.now() - t0 < tmax) {
      p = findVisibleSkillPopup(S);
      if (p) {
        return p;
      }
      await sleep(80);
    }
    return null;
  }
  async function closePop(S) {
    var info = findVisibleSkillPopup(S);
    var modal = info && info.closest ? info.closest("app-modal") : null;
    var btn = modal ? modal.querySelector(".modal-header-close") : null;
    click(btn || qs(S.skillPopupClose) || qs(".modal-header-close"));
    var t0 = Date.now();
    while (Date.now() - t0 < 2500 && findVisibleSkillPopup(S)) {
      await sleep(60);
    }
    await sleep(MS.gap);
  }
  async function openCharSkills() {
    var i;
    var tab;
    var tc;
    var lab;
    tapUi(footer("character", "Character"));
    await sleep(MS.s);
    for (i = 0; i < qsa("app-tab").length; i++) {
      tab = qsa("app-tab")[i];
      tc = tab.querySelector(".tab-content");
      lab = tc ? (tc.textContent || "").trim() : "";
      if (/^skills$/i.test(lab)) {
        tapUi(tab);
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
      tapUi(b);
      await sleep(280);
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
    if (findVisibleSkillPopup(sel())) {
      await closePop(sel());
    }
    tapUi(footer("town", "Town"));
    await sleep(MS.L);
    for (i = 0; i < qsa("app-button").length; i++) {
      el = qsa("app-button")[i];
      if ((el.textContent || "").indexOf("Buildings") !== -1) {
        tapUi(el);
        break;
      }
    }
    await sleep(MS.L);
    for (i = 0; i < qsa("app-location-item").length; i++) {
      el = qsa("app-location-item")[i];
      n = el.querySelector(".location-name");
      if (n && /hall of heroes/i.test(n.textContent || "")) {
        tapUi(el);
        break;
      }
    }
    await sleep(MS.L);
    el = qsa("app-tabs app-tab.tab-as-icon")[tabIndex];
    if (el) {
      tapUi(el);
      await sleep(MS.s);
    }
    tapUi(qs("app-button.gear-button-select"));
    await sleep(MS.pick);
  }

  window.lmcSetDoc = function (customDoc) {
    if (customDoc && customDoc.querySelector) {
      DOC = customDoc;
    }
    return DOC;
  };

  window.lmcProbe = function () {
    var docs = allSameOriginDocs();
    return docs.map(function (d, i) {
      return {
        index: i,
        href: d.location ? d.location.href : "",
        hasSkillsTree: !!d.querySelector(".skills-tree"),
        appModals: d.querySelectorAll("app-modal").length,
        isActiveDoc: d === DOC
      };
    });
  };

  window.lmcOne = async function (classKey) {
    lmcResolveDoc();
    var key = classKey || "unknown";
    if (!qs(".skills-tree") && !(await openCharSkills())) {
      console.warn("[lmc] No .skills-tree in resolved doc. Run lmcProbe() or lmcSetDoc(iframe.contentDocument).");
      return { ok: false, err: "open_skills_failed", probe: window.lmcProbe() };
    }
    var skills = await walkTree(key);
    var payload = { v: 1, classKey: key, at: new Date().toISOString(), skills: skills, doc: DOC.location ? DOC.location.href : "" };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  };

  window.lmcAll = async function (startIndex) {
    lmcResolveDoc();
    var s = typeof startIndex === "number" ? startIndex : 0;
    var step;
    var tabIdx;
    var cname;
    var all = { v: 1, at: new Date().toISOString(), start: s, classes: [], doc: DOC.location ? DOC.location.href : "" };
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

  lmcResolveDoc();
  console.log(
    "[lmc] ready. doc=" +
      (DOC.location ? DOC.location.href : "?") +
      "\n  lmcProbe() — which iframe has .skills-tree\n" +
      '  await lmcOne("assassin")\n' +
      "  await lmcAll(0)"
  );
})();
