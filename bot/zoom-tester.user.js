// ==UserScript==
// @name         Ligmar Zoom Tester
// @namespace    http://tampermonkey.net/
// @version      0.3.0
// @description  Minimal calibration tool: max-zoom-out button + scan-distance slider with hex-ring overlay.
// @author       Victor
// @match        https://ligmar.io/game/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// AI CHANGED: v0.3.0 — stripped to MAX ZOOM OUT + step slider + hex-ring SVG overlay (everything else removed).

(function () {
  "use strict";

  const PANEL_ID = "zoomTestPanel";
  const OVERLAY_ID = "zoomTestOverlay";
  const SLIDER_ID = "zoomTestStepSlider";
  const NUMBER_ID = "zoomTestStepNumber";
  const PREFIX = "[ZOOM]";

  // AI CHANGED: Mirror the bot's scan defaults so the slider starts where Config.movement.neighborStepPx is today.
  const DEFAULT_STEP = 45;
  const STEP_MIN = 10;
  const STEP_MAX = 200;
  // AI CHANGED: Vertical hex factor matches scanNeighborRing()'s h = round(step * 0.86).
  const HEX_V = 0.86;
  // AI CHANGED: 6 hex directions in the same order as scanNeighborRing() in bot.user.js.
  const HEX_DIRS = [
    { key: "TR", sx: +0.5, sy: -HEX_V },
    { key: "R",  sx: +1.0, sy:  0     },
    { key: "BR", sx: +0.5, sy: +HEX_V },
    { key: "BL", sx: -0.5, sy: +HEX_V },
    { key: "L",  sx: -1.0, sy:  0     },
    { key: "TL", sx: -0.5, sy: -HEX_V }
  ];

  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);

  // ---------- canvas ----------
  function getGameCanvas() {
    return (
      document.querySelector("app-game canvas.map") ||
      document.querySelector("app-game canvas") ||
      document.querySelector("canvas.map") ||
      document.querySelector("canvas")
    );
  }

  function canvasCenterViewport() {
    const c = getGameCanvas();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      w: r.width,
      h: r.height
    };
  }

  // ---------- max zoom out ----------
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

  function zoomOutMax(steps) {
    const n = typeof steps === "number" && steps > 0 ? steps : 40;
    const canvas = getGameCanvas();
    if (!canvas) {
      warn("zoomOutMax: no canvas");
      return false;
    }
    const center = canvasCenterViewport();
    log(`zoomOutMax: dispatching wheel out x${n} at`, center);
    for (let i = 0; i < n; i++) {
      dispatchWheel(canvas, {
        deltaY: 120,
        clientX: center.x,
        clientY: center.y,
        ctrlKey: false
      });
    }
    return true;
  }

  // ---------- step state ----------
  let currentStep = DEFAULT_STEP;
  function clampStep(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return currentStep;
    return Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(n)));
  }
  function setStep(v) {
    currentStep = clampStep(v);
    const slider = document.getElementById(SLIDER_ID);
    const number = document.getElementById(NUMBER_ID);
    if (slider) slider.value = String(currentStep);
    if (number) number.value = String(currentStep);
    updateOverlay();
    return currentStep;
  }

  // ---------- SVG overlay ----------
  function ensureOverlay() {
    let svg = document.getElementById(OVERLAY_ID);
    if (svg) return svg;

    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = OVERLAY_ID;
    Object.assign(svg.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "999998",
      pointerEvents: "none"
    });
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);

    // Crosshair group + ring group are filled in by updateOverlay()
    const center = document.createElementNS("http://www.w3.org/2000/svg", "g");
    center.id = "zoomTestCenter";
    svg.appendChild(center);

    const ring = document.createElementNS("http://www.w3.org/2000/svg", "g");
    ring.id = "zoomTestRing";
    svg.appendChild(ring);

    document.body.appendChild(svg);
    return svg;
  }

  function clearGroup(g) {
    while (g.firstChild) g.removeChild(g.firstChild);
  }

  function lineEl(x1, y1, x2, y2, color) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", color);
    l.setAttribute("stroke-width", "2");
    l.setAttribute("stroke-linecap", "round");
    return l;
  }

  function circleEl(cx, cy, r, fill) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", fill);
    c.setAttribute("stroke", "#000");
    c.setAttribute("stroke-width", "1");
    return c;
  }

  function textEl(x, y, str, color) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", color);
    t.setAttribute("font-family", "monospace");
    t.setAttribute("font-size", "12");
    t.setAttribute("font-weight", "bold");
    t.setAttribute("paint-order", "stroke");
    t.setAttribute("stroke", "#000");
    t.setAttribute("stroke-width", "3");
    t.textContent = str;
    return t;
  }

  function updateOverlay() {
    const svg = ensureOverlay();
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);

    const centerG = svg.querySelector("#zoomTestCenter");
    const ringG = svg.querySelector("#zoomTestRing");
    if (!centerG || !ringG) return;
    clearGroup(centerG);
    clearGroup(ringG);

    const center = canvasCenterViewport();
    if (!center) return;

    // Crosshair at canvas center.
    centerG.appendChild(lineEl(center.x - 8, center.y, center.x + 8, center.y, "#ffea00"));
    centerG.appendChild(lineEl(center.x, center.y - 8, center.x, center.y + 8, "#ffea00"));
    centerG.appendChild(circleEl(center.x, center.y, 3, "#ffea00"));

    // Hex ring.
    const step = currentStep;
    const h = Math.round(step * HEX_V);
    for (let i = 0; i < HEX_DIRS.length; i++) {
      const d = HEX_DIRS[i];
      const dx = Math.round(d.sx * step);
      // AI CHANGED: Use the same vertical magnitude as the bot (round(step * 0.86)) so the visual matches click targets.
      const dy = d.sy === 0 ? 0 : (d.sy > 0 ? +h : -h);
      const x = center.x + dx;
      const y = center.y + dy;

      ringG.appendChild(lineEl(center.x, center.y, x, y, "#00e0ff"));
      ringG.appendChild(circleEl(x, y, 6, "#00e0ff"));
      // Label slightly outward from the dot.
      const lx = x + (d.sx >= 0 ? 8 : -8);
      const ly = y + (d.sy >= 0 ? 14 : -8);
      const anchor = d.sx >= 0 ? "start" : "end";
      const label = textEl(lx, ly, d.key, "#ffffff");
      label.setAttribute("text-anchor", anchor);
      ringG.appendChild(label);
    }

    // Step readout near the crosshair.
    const readout = textEl(center.x + 12, center.y - 12, `step=${step}px h=${h}px`, "#ffea00");
    readout.setAttribute("text-anchor", "start");
    centerG.appendChild(readout);
  }

  // ---------- panel ----------
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
      maxWidth: "260px"
    });

    p.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;color:#9cf">Scan Calibrator v0.3</div>
      <button id="zoomTestMaxOut" style="
        margin:2px 0;
        padding:6px 10px;
        background:#222;
        color:#fff;
        border:1px solid #555;
        border-radius:3px;
        cursor:pointer;
        font:11px monospace;
        width:100%;
      ">MAX ZOOM OUT</button>
      <div style="margin-top:8px">
        <div style="margin-bottom:2px">scan step (px)</div>
        <input id="${SLIDER_ID}" type="range" min="${STEP_MIN}" max="${STEP_MAX}" value="${DEFAULT_STEP}" style="width:170px;vertical-align:middle">
        <input id="${NUMBER_ID}" type="number" min="${STEP_MIN}" max="${STEP_MAX}" value="${DEFAULT_STEP}" style="width:55px;margin-left:4px">
      </div>
      <div style="margin-top:6px;font-size:11px;color:#9cf" id="zoomTestStatus">step=${DEFAULT_STEP}, h=${Math.round(DEFAULT_STEP * HEX_V)}</div>
    `;

    document.body.appendChild(p);

    document.getElementById("zoomTestMaxOut").addEventListener("click", () => {
      zoomOutMax();
      // AI CHANGED: Refresh overlay shortly after; the canvas rect can shift if the engine rescales the visible viewport.
      setTimeout(updateOverlay, 300);
    });

    const slider = document.getElementById(SLIDER_ID);
    const number = document.getElementById(NUMBER_ID);
    const status = document.getElementById("zoomTestStatus");

    function reflect() {
      const h = Math.round(currentStep * HEX_V);
      if (status) status.textContent = `step=${currentStep}, h=${h}`;
    }

    slider.addEventListener("input", () => {
      setStep(slider.value);
      reflect();
    });
    number.addEventListener("input", () => {
      setStep(number.value);
      reflect();
    });

    log("panel attached");
  }

  // ---------- continuous overlay refresh ----------
  function startOverlayLoop() {
    function tick() {
      updateOverlay();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    window.addEventListener("resize", updateOverlay);
    window.addEventListener("scroll", updateOverlay, true);
  }

  // ---------- public API ----------
  window.zoomTest = {
    zoomOutMax: zoomOutMax,
    setStep: setStep,
    getStep: () => currentStep,
    refreshOverlay: updateOverlay
  };

  function start() {
    log("scan calibrator v0.3 loaded. Use the panel (top-right). API: window.zoomTest.{zoomOutMax,setStep,getStep,refreshOverlay}.");
    setTimeout(() => {
      makePanel();
      ensureOverlay();
      updateOverlay();
      startOverlayLoop();
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
