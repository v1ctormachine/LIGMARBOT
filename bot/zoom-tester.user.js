// ==UserScript==
// @name         Ligmar Zoom Tester
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  Standalone probe: try multiple programmatic zoom approaches on the ligmar.io map and calibrate per-step intensity.
// @author       Victor
// @match        https://ligmar.io/game/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// AI CHANGED: v0.2.0 — calibration inputs (delta, count), preset bursts, canvas pixel-hash detector, self-detection fix.

(function () {
  "use strict";

  const PANEL_ID = "zoomTestPanel";
  const PREFIX = "[ZOOM]";
  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);

  // ---------- DOM / canvas helpers ----------
  function getGameCanvas() {
    // AI CHANGED: Prefer the explicit map canvas observed in production DOM (canvas.map).
    return (
      document.querySelector("app-game canvas.map") ||
      document.querySelector("app-game canvas") ||
      document.querySelector("canvas.map") ||
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

  // AI CHANGED: Skip anything that lives inside the zoom-tester panel itself to avoid false self-matches.
  function isInsideTesterPanel(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(`#${PANEL_ID}`);
  }

  // ---------- canvas pixel-hash detector (the real signal) ----------
  // AI CHANGED: Sample a sparse pixel grid from the canvas and produce a short string hash;
  // if it changes after we dispatch input, the game actually re-rendered (likely due to zoom).
  function canvasPixelHash() {
    const c = getGameCanvas();
    if (!c) return null;
    try {
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const w = c.width;
      const h = c.height;
      if (!w || !h) return null;
      const stepX = Math.max(1, Math.floor(w / 8));
      const stepY = Math.max(1, Math.floor(h / 8));
      let hash = 0;
      for (let y = stepY; y < h; y += stepY) {
        for (let x = stepX; x < w; x += stepX) {
          let d;
          try {
            d = ctx.getImageData(x, y, 1, 1).data;
          } catch (_) {
            return "tainted"; // cross-origin canvas
          }
          // simple rolling hash over RGB
          hash = ((hash << 5) - hash + d[0]) | 0;
          hash = ((hash << 5) - hash + d[1]) | 0;
          hash = ((hash << 5) - hash + d[2]) | 0;
        }
      }
      return String(hash);
    } catch (e) {
      return null;
    }
  }

  function snapshotCanvasMeta() {
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
      ancestors: ancestors,
      pixelHash: canvasPixelHash()
    };
  }

  function diffSnapshots(before, after) {
    if (!before || !after) return { changed: false, reason: "missing snapshot" };
    const fields = ["attrW", "attrH", "cssW", "cssH", "transform", "pixelHash"];
    const changes = [];
    for (const f of fields) {
      if (before[f] !== after[f]) changes.push({ field: f, before: before[f], after: after[f] });
    }
    const beforeAnc = JSON.stringify(before.ancestors);
    const afterAnc = JSON.stringify(after.ancestors);
    if (beforeAnc !== afterAnc) changes.push({ field: "ancestors", before: before.ancestors, after: after.ancestors });
    return { changed: changes.length > 0, changes };
  }

  // ---------- calibration state from panel inputs ----------
  function getCalibration() {
    const deltaInput = document.getElementById("zoomTestDelta");
    const countInput = document.getElementById("zoomTestCount");
    const delta = deltaInput && Number(deltaInput.value) ? Number(deltaInput.value) : 120;
    const count = countInput && Number(countInput.value) ? Number(countInput.value) : 1;
    return {
      // AI CHANGED: Clamp to safe ranges so user typos don't fire 100k events.
      deltaY: Math.max(1, Math.min(2000, Math.abs(delta))),
      count: Math.max(1, Math.min(200, Math.floor(count)))
    };
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

  async function tryWheel(direction, count, ctrl, deltaMagnitude) {
    const dir = direction === "out" ? "out" : "in";
    const cal = getCalibration();
    const n = typeof count === "number" && count > 0 ? count : cal.count;
    const dY = (typeof deltaMagnitude === "number" && deltaMagnitude > 0 ? deltaMagnitude : cal.deltaY) * (dir === "in" ? -1 : 1);
    const useCtrl = !!ctrl;
    const canvas = getGameCanvas();
    if (!canvas) {
      warn("wheel: no canvas found");
      return { ok: false, reason: "no_canvas" };
    }
    const center = elementCenter(canvas);
    const before = snapshotCanvasMeta();
    log(`wheel${useCtrl ? "+ctrl" : ""}: ${dir} count=${n} deltaY=${dY} at (${Math.round(center.x)}, ${Math.round(center.y)})`);
    for (let i = 0; i < n; i++) {
      dispatchWheel(canvas, {
        deltaY: dY,
        clientX: center.x,
        clientY: center.y,
        ctrlKey: useCtrl
      });
    }
    return await waitAndDiff("wheel", before);
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

  async function tryKey(key, count) {
    const cal = getCalibration();
    const n = typeof count === "number" && count > 0 ? count : cal.count;
    const before = snapshotCanvasMeta();
    log(`key: "${key}" count=${n}`);
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
    return await waitAndDiff("key", before);
  }

  // ---------- in-game zoom button discovery ----------
  function findZoomButtons() {
    const candidates = [];
    const all = Array.from(document.querySelectorAll(
      "app-icon, app-button-icon, button, [role='button'], div, span"
    ));
    for (const el of all) {
      if (!el || !el.tagName) continue;
      // AI CHANGED: Hard skip any element belonging to our own tester panel.
      if (isInsideTesterPanel(el)) continue;

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

  async function clickFirstMatching(predicate, label) {
    const list = findZoomButtons().filter((c) => c.visible).filter(predicate);
    if (!list.length) {
      warn(`${label}: no visible button matched`);
      return { ok: false, reason: "no_match" };
    }
    const before = snapshotCanvasMeta();
    log(`${label}: clicking`, {
      tag: list[0].tag, cls: list[0].cls, text: list[0].text, x: list[0].x, y: list[0].y
    });
    list[0].el.click();
    return await waitAndDiff(label, before);
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
    const snap = snapshotCanvasMeta();
    const r = c.getBoundingClientRect();
    const info = {
      element: c,
      attrSize: { w: c.width, h: c.height },
      cssSize: { w: Math.round(r.width), h: Math.round(r.height) },
      pxRatio: window.devicePixelRatio,
      transform: snap.transform,
      ancestorTransforms: snap.ancestors,
      pixelHash: snap.pixelHash
    };
    log("canvas inspect:", info);
    if (info.ancestorTransforms.length) console.table(info.ancestorTransforms);
    return info;
  }

  // ---------- async diff helper ----------
  function waitAndDiff(label, beforeSnap, waitMs) {
    const ms = typeof waitMs === "number" ? waitMs : 250;
    return new Promise((resolve) => {
      setTimeout(() => {
        const after = snapshotCanvasMeta();
        const diff = diffSnapshots(beforeSnap, after);
        // AI CHANGED: Pixel-hash change is the real signal; DOM-only diff doesn't apply to canvas-rendered zoom.
        const pixelChanged = pixelHashChanged(beforeSnap, after);
        if (diff.changed) {
          log(`${label}: change detected`, diff.changes.map((c) => c.field));
        } else if (pixelChanged) {
          log(`${label}: canvas pixels changed (likely zoom/redraw)`);
        } else {
          log(`${label}: dispatched, no detectable diff (visual confirmation needed)`);
        }
        resolve({ ok: true, label: label, changed: diff.changed || pixelChanged, changes: diff.changes, after: after });
      }, ms);
    });
  }
  // AI CHANGED: Pixel-hash compare helper kept separate so waitAndDiff stays readable.
  function pixelHashChanged(b, a) {
    return !!(b && a && b.pixelHash !== a.pixelHash && b.pixelHash !== "tainted" && a.pixelHash !== "tainted");
  }

  // ---------- preset bursts ----------
  async function zoomOutMax(steps) {
    const n = typeof steps === "number" && steps > 0 ? steps : 40;
    log(`preset: zoomOutMax x${n}`);
    return await tryWheel("out", n, false, 120);
  }
  async function zoomInMax(steps) {
    const n = typeof steps === "number" && steps > 0 ? steps : 40;
    log(`preset: zoomInMax x${n}`);
    return await tryWheel("in", n, false, 120);
  }
  async function singleStep(direction) {
    const dir = direction === "out" ? "out" : "in";
    log(`preset: singleStep ${dir} (using current calibration)`);
    return await tryWheel(dir, 1, false);
  }

  // ---------- floating panel ----------
  function makePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const p = document.createElement("div");
    p.id = PANEL_ID;
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
      maxWidth: "280px",
      pointerEvents: "auto"
    });

    p.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;color:#9cf">Zoom Tester v0.2</div>
      <div style="margin-bottom:4px">
        <label>Δ deltaY <input id="zoomTestDelta" type="number" value="120" min="1" max="2000" style="width:60px"></label>
        <label>count <input id="zoomTestCount" type="number" value="1" min="1" max="200" style="width:50px"></label>
      </div>
      <div>
        <button data-act="single-in">Single In</button>
        <button data-act="single-out">Single Out</button>
      </div>
      <div>
        <button data-act="wheel-in">Wheel In (×count)</button>
        <button data-act="wheel-out">Wheel Out (×count)</button>
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
      <div style="margin-top:4px;border-top:1px solid #444;padding-top:4px">
        <button data-act="preset-out">Zoom Out 40×</button>
        <button data-act="preset-in">Zoom In 40×</button>
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
          case "single-in":      res = await singleStep("in"); break;
          case "single-out":     res = await singleStep("out"); break;
          case "wheel-in":       res = await tryWheel("in", undefined, false); break;
          case "wheel-out":      res = await tryWheel("out", undefined, false); break;
          case "wheel-ctrl-in":  res = await tryWheel("in", undefined, true); break;
          case "wheel-ctrl-out": res = await tryWheel("out", undefined, true); break;
          case "key-plus":       res = await tryKey("+"); break;
          case "key-minus":      res = await tryKey("-"); break;
          case "key-equal":      res = await tryKey("="); break;
          case "ui-plus":        res = await clickInGameZoomIn(); break;
          case "ui-minus":       res = await clickInGameZoomOut(); break;
          case "preset-out":     res = await zoomOutMax(); break;
          case "preset-in":      res = await zoomInMax(); break;
          case "find":           findZoomButtons(); res = { changed: false, label: "find" }; break;
          case "canvas":         inspectCanvas(); res = { changed: false, label: "canvas" }; break;
        }
        if (res && typeof res.changed === "boolean") {
          setStatus(`${act}: ${res.changed ? "CHANGED" : "dispatched"}`);
        } else {
          setStatus(`${act}: see console`);
        }
      } catch (err) {
        warn("button error", err);
        setStatus(`${act}: error (see console)`);
      }
    });

    document.body.appendChild(p);
    log("panel attached at top-right (v0.2)");
  }

  // ---------- public API ----------
  window.zoomTest = {
    wheel: (dir, count, deltaMagnitude) => tryWheel(dir, count, false, deltaMagnitude),
    wheelCtrl: (dir, count, deltaMagnitude) => tryWheel(dir, count, true, deltaMagnitude),
    key: tryKey,
    singleStep: singleStep,
    zoomOutMax: zoomOutMax,
    zoomInMax: zoomInMax,
    findZoomButtons: findZoomButtons,
    clickInGameZoomIn: clickInGameZoomIn,
    clickInGameZoomOut: clickInGameZoomOut,
    inspectCanvas: inspectCanvas,
    snapshot: snapshotCanvasMeta,
    pixelHash: canvasPixelHash
  };

  function start() {
    log("zoom tester v0.2 loaded. Use the panel (top-right) or window.zoomTest.* in console.");
    setTimeout(makePanel, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
