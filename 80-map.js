  // --- Layer 1 Module: 30-utils.js (Cooperative Utilities & Guarded Clicker) ---
  // Implements core pointer actuation, fractional text parsing, and stop-cooperative sleepers.
  // Clicker is protected against TOCTOU (Time-of-Check to Time-of-Use) vanishing element races.

  // 1. Cooperative Sleep Primitive
  function sleep(ms, options) {
    const opts = options || {};
    const bypassStop = opts.bypassStop === true;
    const duration = typeof ms === "number" && ms >= 0 ? ms : 0;

    // Minimum yield constraint (prevents CPU lockups even when ms is 0)
    const MIN_YIELD_MS = 30;
    const finalMs = Math.max(duration, MIN_YIELD_MS);

    if (bypassStop) {
      return new Promise((resolve) => setTimeout(resolve, finalMs));
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const endTime = startTime + finalMs;

      function poll() {
        if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) {
          resolve();
          return;
        }

        const now = Date.now();
        if (now >= endTime) {
          resolve();
          return;
        }

        // Poll in tight 30ms steps for rapid responsiveness to stop requests
        const remaining = endTime - now;
        const nextStep = Math.min(30, remaining);
        setTimeout(poll, nextStep);
      }

      poll();
    });
  }

  // 2. DOM Helper: Check if element is mounted and visible
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) {
      return false;
    }
    // Check offset dimensions
    if (el.offsetWidth === 0 && el.offsetHeight === 0) {
      return false;
    }
    // Check computed style
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
        return false;
      }
    } catch (err) {
      // Ignore styles check failures
    }
    // Check bounding rect
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    return true;
  }

  // 3. TOCTOU-Guarded Pointer Click Simulator
  // Dispatches a complete pointer and mouse event cascade over the center-point of the element.
  // Re-evaluates element mounting and visibility before *every individual step* to prevent
  // miss-clicking on background layers if the target element vanishes mid-frame.
  function dispatchUserClickSequence(el, label) {
    const name = label || "unspecified-element";
    
    // Step 1: Pre-flight check
    if (!isElementVisible(el)) {
      Logger.debug("ACTION", `Click sequence skipped: element not visible or unmounted`, { element: name });
      return false;
    }

    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;

      // Event types to dispatch in sequence
      const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

      for (let i = 0; i < eventTypes.length; i++) {
        // TOCTOU check immediately before dispatching each event in the cascade
        if (!isElementVisible(el)) {
          Logger.warn("ACTION", `Click sequence aborted mid-run: element vanished during sequence`, { 
            element: name, 
            abortedAt: eventTypes[i] 
          });
          return false;
        }

        const rect = el.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const eventType = eventTypes[i];
        let event;

        if (eventType.startsWith("pointer")) {
          event = new win.PointerEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: win,
            clientX: clientX,
            clientY: clientY,
            isPrimary: true
          });
        } else {
          event = new win.MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: win,
            clientX: clientX,
            clientY: clientY
          });
        }

        el.dispatchEvent(event);
      }

      Logger.debug("ACTION", `Click sequence dispatched successfully`, { element: name });
      return true;
    } catch (err) {
      Logger.error("ACTION", `Click sequence threw on dispatch`, { element: name, error: String(err) });
      return false;
    }
  }

  // Wrapper for safe interaction click with logger feedback
  function clickElementSafe(el, label) {
    if (!el) {
      Logger.debug("ACTION", `Click skipped: element reference is null`, { element: label || "unknown" });
      return false;
    }
    return dispatchUserClickSequence(el, label);
  }

  // 4. Safe Click-At-Coordinates helper (used for map canvas and coordinate clicks)
  function dispatchClickAt(targetNode, clientX, clientY, label) {
    if (!targetNode || !isElementVisible(targetNode)) {
      Logger.warn("ACTION", `Coordinates click skipped: target node not visible`, { element: label || "coordinate" });
      return false;
    }

    try {
      const doc = targetNode.ownerDocument || document;
      const win = doc.defaultView || window;
      const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

      for (let i = 0; i < eventTypes.length; i++) {
        // Double check target node state
        if (!isElementVisible(targetNode)) {
          return false;
        }

        const eventType = eventTypes[i];
        let event;

        if (eventType.startsWith("pointer")) {
          event = new win.PointerEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: win,
            clientX: clientX,
            clientY: clientY,
            isPrimary: true
          });
        } else {
          event = new win.MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: win,
            clientX: clientX,
            clientY: clientY
          });
        }

        targetNode.dispatchEvent(event);
      }
      return true;
    } catch (err) {
      Logger.error("ACTION", `Coordinates click threw on dispatch`, { error: String(err) });
      return false;
    }
  }

  // 4b. Canvas-Safe Click helper (Single click MouseEvent only to prevent WebGL setPointerCapture crashes)
  function dispatchCanvasClickAt(canvasNode, clientX, clientY, label) {
    if (!canvasNode || !isElementVisible(canvasNode)) {
      return false;
    }
    try {
      const doc = canvasNode.ownerDocument || document;
      const win = doc.defaultView || window;
      const event = new win.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: clientX,
        clientY: clientY,
        button: 0
      });
      canvasNode.dispatchEvent(event);
      return true;
    } catch (err) {
      Logger.error("ACTION", `Canvas click threw on dispatch`, { error: String(err) });
      return false;
    }
  }

  // 4c. Canvas-Safe Double-Click helper (Click & DblClick MouseEvents with 50ms delay to prevent WebGL crashes)
  async function dispatchCanvasDblClickAt(canvasNode, clientX, clientY, label) {
    if (!canvasNode || !isElementVisible(canvasNode)) {
      return false;
    }
    try {
      const doc = canvasNode.ownerDocument || document;
      const win = doc.defaultView || window;

      // Click 1
      const click1 = new win.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: clientX,
        clientY: clientY,
        button: 0
      });
      canvasNode.dispatchEvent(click1);

      // Sleep 50ms (User-calibrated delay to let WebGL register the clicks as double-click)
      await sleep(50, { bypassStop: true });

      if (!isElementVisible(canvasNode)) {
        return false;
      }

      // Click 2
      const click2 = new win.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: clientX,
        clientY: clientY,
        button: 0
      });
      canvasNode.dispatchEvent(click2);

      // Double Click event
      const dblClick = new win.MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: clientX,
        clientY: clientY,
        button: 0
      });
      canvasNode.dispatchEvent(dblClick);

      return true;
    } catch (err) {
      Logger.error("ACTION", `Canvas dblclick threw on dispatch`, { error: String(err) });
      return false;
    }
  }

  // 5. Raw Coordinate Parsers & Regex Extractors
  function parseStatNumber(raw) {
    if (raw === undefined || raw === null) {
      return null;
    }
    const s = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
    // Support range inputs (e.g. "17-30") by splitting and taking the first (minimal) part
    const firstPart = s.split("-")[0].trim();
    const n = Number.parseFloat(firstPart);
    return Number.isFinite(n) ? n : null;
  }

  // Parses fractional labels (e.g., "1,399 / 1,399" or "40 / 40") into clean values
  function parseFractionText(str) {
    const out = { cur: null, max: null, pct: null, valid: false };
    if (!str) {
      return out;
    }
    const cleanStr = String(str).replace(/,/g, "");
    const m = cleanStr.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    if (m) {
      const cur = Number.parseFloat(m[1]);
      const max = Number.parseFloat(m[2]);
      if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) {
        out.cur = cur;
        out.max = max;
        out.pct = +(cur / max).toFixed(4);
        out.valid = true;
      }
    }
    return out;
  }

  function parseFirstInt(str) {
    if (!str) return null;
    const m = String(str).match(/-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  // Parses coordinate popup text (e.g., "3, -4" or "[3;-4]" supporting commas and semicolons)
  function parseCoordsText(str) {
    if (!str) return null;
    let clean = String(str).replace(/[\[\]]/g, ""); // Strip brackets
    let m = clean.match(/(-?\d+)\s*,\s*(-?\d+)/);    // Try comma
    if (!m) {
      m = clean.match(/(-?\d+)\s*;\s*(-?\d+)/);    // Try semicolon
    }
    if (m) {
      return {
        x: parseInt(m[1], 10),
        y: parseInt(m[2], 10)
      };
    }
    return null;
  }
