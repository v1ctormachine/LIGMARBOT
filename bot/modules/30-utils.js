  // AI CHANGED: Added strict game-page guard to ensure script runs only in /game/.
  function isGamePage() {
    return window.location.pathname.startsWith("/game/");
  }

  // AI CHANGED: Added CSS path generator to capture stable selectors from live elements.
  function getCssPath(element) {
    if (!element || element.nodeType !== 1) {
      return "";
    }
    const segments = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += `#${current.id}`;
        segments.unshift(segment);
        break;
      }
      const classList = Array.from(current.classList || []).filter(Boolean);
      if (classList.length > 0) {
        segment += `.${classList.slice(0, 3).join(".")}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      segments.unshift(segment);
      current = current.parentElement;
    }
    return segments.join(" > ");
  }

  // AI CHANGED: Added reusable parser for x/y style counters like HP and MP.
  function parseFractionText(text) {
    if (typeof text !== "string") {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    // AI CHANGED: Strip thousands separators (e.g. "1,399 / 1,399") so target HP reads match live UI.
    const normalized = text.trim().replace(/\s+/g, " ").replace(/,/g, "");
    const match = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    const cur = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) {
      return { cur: 0, max: 0, pct: 0, valid: false };
    }
    return { cur: cur, max: max, pct: cur / max, valid: true };
  }

  // AI CHANGED: Added fallback parser for integer values from mixed text nodes.
  function parseFirstInt(text) {
    if (typeof text !== "string") {
      return null;
    }
    const match = text.match(/\d+/);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[0], 10);
    return Number.isFinite(value) ? value : null;
  }

  // AI CHANGED: Added shared async sleep helper for paced loop execution.
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // AI CHANGED: Added helper for consistent compact JSON text in GUI status.
  function toShortJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  // AI CHANGED: Added shared visibility guard so action clicks only fire on visible controls.
  function isElementVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  // AI CHANGED: Added safe click wrapper with logging and visibility checks.
  function clickElementSafe(element, label) {
    if (!element) {
      Logger.warn("ACTION", `${label} click skipped: element not found`);
      return false;
    }
    if (!isElementVisible(element)) {
      Logger.warn("ACTION", `${label} click skipped: element not visible`);
      return false;
    }
    element.click();
    Logger.log("ACTION", `${label} clicked`);
    return true;
  }

  // AI CHANGED: Added low-level mouse event dispatcher for canvas click simulation.
  function dispatchMouseAt(canvas, type, clientX, clientY) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      button: 0
    });
    canvas.dispatchEvent(event);
  }

  // AI CHANGED: Added parser for coordinate popup text like "[2;2]".
  function parseCoordsText(text) {
    if (typeof text !== "string") {
      return null;
    }
    const match = text.trim().match(/^\[\s*(-?\d+)\s*;\s*(-?\d+)\s*\]$/);
    if (!match) {
      return null;
    }
    return { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10), raw: text.trim() };
  }
