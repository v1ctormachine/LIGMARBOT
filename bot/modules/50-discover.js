  // AI CHANGED: Added selector probe utility for milestone 0.2 diagnostics.
  function probeSelectors() {
    const rows = Object.keys(Config.selectors).map((key) => {
      const selector = Config.selectors[key];
      // AI CHANGED: Guard against empty/invalid selectors so probe never crashes startup.
      if (typeof selector !== "string" || selector.trim() === "") {
        return {
          key: key,
          selector: selector,
          found: false,
          skipped: true,
          reason: "empty_selector"
        };
      }
      let element = null;
      try {
        element = document.querySelector(selector);
      } catch (error) {
        return {
          key: key,
          selector: selector,
          found: false,
          skipped: true,
          reason: "invalid_selector",
          error: error && error.message ? error.message : String(error)
        };
      }
      return {
        key: key,
        selector: selector,
        found: !!element,
        skipped: false
      };
    });
    console.table(rows);
    Logger.log("PROBE", "Selector probe complete", rows);
    return rows;
  }

  // AI CHANGED: Added automatic discovery for HP/MP style x/y text nodes.
  function discoverFractionNodes() {
    const nodes = Array.from(document.querySelectorAll("*"));
    const candidates = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.children.length > 0) {
        continue;
      }
      const text = (node.textContent || "").trim();
      // AI CHANGED: Detect fraction nodes via parseFractionText so comma-formatted HP is included.
      const parsed = parseFractionText(text);
      if (!parsed.valid) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      candidates.push({
        text: text,
        cssPath: getCssPath(node),
        className: node.className || "",
        id: node.id || "",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.x),
        y: Math.round(rect.y)
      });
    }
    console.table(candidates);
    Logger.log("DISCOVER", "Fraction node discovery complete", candidates);
    return candidates;
  }

  // AI CHANGED: Added automatic discovery for action buttons by visible text.
  function discoverButtons() {
    const nodes = Array.from(document.querySelectorAll("button, [role='button'], div, span, a"));
    const candidates = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const text = (node.textContent || "").trim();
      if (!text) {
        continue;
      }
      const lower = text.toLowerCase();
      const isInteresting =
        lower.includes("loot") ||
        lower.includes("find enemy") ||
        lower.includes("enemy") ||
        lower.includes("center") ||
        lower.includes("run");
      if (!isInteresting) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      candidates.push({
        text: text,
        tag: node.tagName.toLowerCase(),
        cssPath: getCssPath(node),
        className: node.className || "",
        id: node.id || "",
        disabled: !!node.disabled,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
    console.table(candidates);
    Logger.log("DISCOVER", "Button discovery complete", candidates);
    return candidates;
  }
