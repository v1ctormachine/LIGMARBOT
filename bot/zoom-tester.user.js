// ==UserScript==
// @name         Ligmar Zoom Tester
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Standalone probe: try multiple programmatic zoom approaches on the ligmar.io map and report what works.
// @author       Victor
// @match        https://ligmar.io/game/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// AI CHANGED: New standalone test harness — runs alongside the main bot without touching it.

(function () {
  "use strict";

  const PREFIX = "[ZOOM]";
  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);

  // ---------- DOM / canvas helpers ----------
  function getGameCanvas() {
    return (
      document.querySelector("app-game canvas") ||
      document.querySelector("canvas")
    );
  }

  function elementCenter(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return (
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      s.opacity !== "0"
    );
  }

  function classListString(el) {
    if (!el) return "";
    if (typeof el.className === "string") return el.className;
    if (el.className && typeof el.className.baseVal === "string") return el.className.baseVal;
    return "";
  }

  function simpleSelector(el) {
    if (!el) return "";
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const cls = classListString(el).trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return cls ? `${tag}.${cls}` : tag;
  }

  // ---------- snapshot helpers (so we can detect "did anything change?") ----------
  function snapshotCanvasTransform() {
    const c = getGameCanvas();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const s = getComputedStyle(c);
    const ancestors = [];
    let cur = c.parentElement;
    while (cur && cur !== document.body) {
      const t = getComputedStyle(cur).transform;
      if (t && t !== "none") ancestors.push({ sel: simpleSelector(cur), transform: t });
      cur = cur.parentElement;
    }
    return {
      attrW: c.width,
      attrH: c.height,
      cssW: Math.round(r.width),
      cssH: Math.round(r.height),
      transform: s.transform,
      ancestors: ancestors
    };
  }

  function diffSnapshots(before, after) {
    if (!before || !after) return { changed: false, reason: "missing snapshot" };
    const fields = ["attrW", "attrH", "cssW", "cssH", "transform"];
    const changes = [];
    for (const f of fields) {
      if (before[f] !== after[f]) changes.push({ field: f, before: before[f], after: after[f] });
    }
    const beforeAnc = JSON.stringify(before.ancestors);
    const afterAnc = JSON.stringify(after.ancestors);
    if (beforeAnc !== afterAnc) changes.push({ field: "ancestors", before: before.ancestors, after: after.ancestors });
    return { changed: changes.length > 0, changes };
  }

  // ---------- wheel approaches ----------
  function dispatchWheel(target, opts) {
    const ev = new WheelEvent("wheel", Object.assign({
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: 0,
      deltaZ: 0,
      deltaMode: 0
    }, opts));
    return target.dispatchEvent(ev);
  }

  function tryWheel(direction, count, ctrl) {
    const dir = direction === "out" ? "out" : "in";
    const n = typeof count === "number" && count > 0 ? count : 3;
    const useCtrl = !!ctrl;
    const canvas = getGameCanvas();
    if (!canvas) {
      warn("wheel: no canvas found");
      return { ok: false, reason: "no_canvas" };
    }
    const center = elementCenter(canvas);
    const deltaY = dir === "in" ? -120 : 120;
    const before = snapshotCanvasTransform();
    log(`wheel${useCtrl ? "+ctrl" : ""}: ${dir} x${n} at`, center);
    for (let i = 0; i < n; i++) {
      dispatchWheel(canvas, {
        deltaY: deltaY,
        clientX: center.x,
        clientY: center.y,
        ctrlKey: useCtrl
      });
    }
    return waitAndDiff("wheel", before);
  }

  // ---------- keyboard approach ----------
  function keyToCode(k) {
    const map = {
      "+": "Equal",
      "=": "Equal",
      "-": "Minus",
      _: "Minus"
    };
    return map[k] || (k.length === 1 ? `Key${k.toUpperCase()}` : k);
  }

  function tryKey(key, count) {
    const n = typeof count === "number" && count > 0 ? count : 3;
    const before = snapshotCanvasTransform();
    log(`key: "${key}" x${n}`);
    for (let i = 0; i < n; i++) {
      const init = {
        bubbles: true,
        cancelable: true,
        key: key,
        code: keyToCode(key)
      };
      const down = new KeyboardEvent("keydown", init);
      const up = new KeyboardEvent("keyup", init);
      document.dispatchEvent(down);
      window.dispatchEvent(down);
      const canvas = getGameCanvas();
      if (canvas) canvas.dispatchEvent(down);
      document.dispatchEvent(up);
      window.dispatchEvent(up);
      if (canvas) canvas.dispatchEvent(up);
    }
    return waitAndDiff("key", before);
  }

  // ---------- in-game zoom button discovery ----------
  function findZoomButtons() {
    const candidates = [];
    const all = Array.from(document.querySelectorAll(
      "app-icon, app-button-icon, button, [role='button'], div, span"
    ));
    for (const el of all) {
      if (!el || !el.tagName) continue;
      const cls = classListString(el);
      const text = (el.textContent || "").trim();
      const titleAttr = el.getAttribute && el.getAttribute("title");
      const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
      let iconStyle = "";
      try {
        const tuiIcon = el.querySelector ? el.querySelector("tui-icon[data-icon]") : null;
        if (tuiIcon) iconStyle = tuiIcon.style.cssText || "";
      } catch (_) {}
      const hay = `${cls} ${text} ${titleAttr || ""} ${ariaLabel || ""} ${iconStyle}`.toLowerCase();

      const looksZoom = (
        hay.includes("zoom") ||
        hay.includes("magnify") ||
        hay.includes("scale-up") ||
        hay.includes("scale-down") ||
        hay.includes("plus") ||
        hay.includes("minus") ||
        hay.includes("camera-up") ||
        hay.includes("camera-down")
      );
      if (!looksZoom) continue;

      const r = el.getBoundingClientRect();
      candidates.push({
        tag: el.tagName.toLowerCase(),
        cls: cls,
        text: text.slice(0, 60),
        title: titleAttr || "",
        aria: ariaLabel || "",
        icon: iconStyle.slice(0, 80),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: isVisible(el),
        el: el
      });
    }
    log(`zoom-button candidates: ${candidates.length}`);
    if (candidates.length) {
      console.table(candidates.map((c) => ({
        tag: c.tag,
        cls: c.cls,
        text: c.text,
        title: c.title,
        aria: c.aria,
        icon: c.icon,
        x: c.x, y: c.y, w: c.w, h: c.h,
        visible: c.visible
      })));
    }
    return candidates;
  }

  function clickFirstMatching(predicate, label) {
    const list = findZoomButtons().filter((c) => c.visible).filter(predicate);
    if (!list.length) {
      warn(`${label}: no visible button matched`);
      return { ok: false, reason: "no_match" };
    }
    const before = snapshotCanvasTransform();
    log(`${label}: clicking`, {
      tag: list[0].tag, cls: list[0].cls, text: list[0].text, x: list[0].x, y: list[0].y
    });
    list[0].el.click();
    return waitAndDiff(label, before);
  }

  function clickInGameZoomIn() {
    return clickFirstMatching(
      (c) => /(zoom.*in|plus|scale-up|magnify\+|camera-up)/i.test(`${c.cls} ${c.text} ${c.title} ${c.aria} ${c.icon}`),
      "ui-zoom-in"
    );
  }
  function clickInGameZoomOut() {
    return clickFirstMatching(
      (c) => /(zoom.*out|minus|scale-down|magnify-|camera-down)/i.test(`${c.cls} ${c.text} ${c.title} ${c.aria} ${c.icon}`),
      "ui-zoom-out"
    );
  }

  // ---------- canvas / transform inspection ----------
  function inspectCanvas() {
    const c = getGameCanvas();
    if (!c) {
      warn("no canvas");
      return null;
    }
    const snap = snapshotCanvasTransform();
    const r = c.getBoundingClientRect();
    const info = {
      element: c,
      attrSize: { w: c.width, h: c.height },
      cssSize: { w: Math.round(r.width), h: Math.round(r.height) },
      pxRatio: window.devicePixelRatio,
      transform: snap.transform,
      ancestorTransforms: snap.ancestors
    };
    log("canvas inspect:", info);
    console.table(info.ancestorTransforms);
    return info;
  }

  // ---------- async diff helper ----------
  function waitAndDiff(label, beforeSnap, waitMs) {
    const ms = typeof waitMs === "number" ? waitMs : 250;
    return new Promise((resolve) => {
      setTimeout(() => {
        const after = snapshotCanvasTransform();
        const diff = diffSnapshots(beforeSnap, after);
        if (diff.changed) {
          log(`${label}: CHANGE detected`, diff.changes);
        } else {
          warn(`${label}: no visible change after ${ms}ms`);
        }
        resolve({ ok: true, label: label, changed: diff.changed, changes: diff.changes, after: after });
      }, ms);
    });
  }

  // ---------- floating panel ----------
  function makePanel() {
    if (document.getElementById("zoomTestPanel")) return;

    const p = document.createElement("div");
    p.id = "zoomTestPanel";
    Object.assign(p.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: "999999",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      padding: "10px",
      font: "12px monospace",
      borderRadius: "6px",
      border: "1px solid #555",
      maxWidth: "260px",
      pointerEvents: "auto"
    });

    p.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;color:#9cf">Zoom Tester</div>
      <div>
        <button data-act="wheel-in">Wheel In</button>
        <button data-act="wheel-out">Wheel Out</button>
      </div>
      <div>
        <button data-act="wheel-ctrl-in">Ctrl+Wheel In</button>
        <button data-act="wheel-ctrl-out">Ctrl+Wheel Out</button>
      </div>
      <div>
        <button data-act="key-plus">Key +</button>
        <button data-act="key-minus">Key -</button>
        <button data-act="key-equal">Key =</button>
      </div>
      <div>
        <button data-act="ui-plus">UI +</button>
        <button data-act="ui-minus">UI -</button>
      </div>
      <div>
        <button data-act="find">Find buttons</button>
        <button data-act="canvas">Canvas info</button>
      </div>
      <div id="zoomTestStatus" style="margin-top:6px;font-size:11px;color:#9cf;min-height:14px"></div>
    `;

    Array.from(p.querySelectorAll("button")).forEach((b) => {
      Object.assign(b.style, {
        margin: "2px 2px",
        padding: "3px 6px",
        background: "#222",
        color: "#fff",
        border: "1px solid #555",
        borderRadius: "3px",
        cursor: "pointer",
        font: "11px monospace"
      });
    });

    function setStatus(txt) {
      const s = document.getElementById("zoomTestStatus");
      if (s) s.textContent = txt;
    }

    p.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      const act = t.dataset.act;
      let res = null;
      try {
        switch (act) {
          case "wheel-in":        res = await tryWheel("in", 3, false); break;
          case "wheel-out":       res = await tryWheel("out", 3, false); break;
          case "wheel-ctrl-in":   res = await tryWheel("in", 3, true); break;
          case "wheel-ctrl-out":  res = await tryWheel("out", 3, true); break;
          case "key-plus":        res = await tryKey("+", 3); break;
          case "key-minus":       res = await tryKey("-", 3); break;
          case "key-equal":       res = await tryKey("=", 3); break;
          case "ui-plus":         res = await clickInGameZoomIn(); break;
          case "ui-minus":        res = await clickInGameZoomOut(); break;
          case "find":            findZoomButtons(); res = { changed: false, label: "find" }; break;
          case "canvas":          inspectCanvas(); res = { changed: false, label: "canvas" }; break;
        }
        if (res && typeof res.changed === "boolean") {
          setStatus(`${act}: ${res.changed ? "CHANGED" : "no change"}`);
        } else {
          setStatus(`${act}: see console`);
        }
      } catch (err) {
        warn("button error", err);
        setStatus(`${act}: error (see console)`);
      }
    });

    document.body.appendChild(p);
    log("panel attached at top-right");
  }

  // ---------- public API ----------
  window.zoomTest = {
    wheel: (dir, count) => tryWheel(dir, count, false),
    wheelCtrl: (dir, count) => tryWheel(dir, count, true),
    key: tryKey,
    findZoomButtons: findZoomButtons,
    clickInGameZoomIn: clickInGameZoomIn,
    clickInGameZoomOut: clickInGameZoomOut,
    inspectCanvas: inspectCanvas,
    snapshot: snapshotCanvasTransform
  };

  function start() {
    log("zoom tester loaded. Use the panel (top-right) or window.zoomTest.* in console.");
    setTimeout(makePanel, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
