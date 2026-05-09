  // AI CHANGED: Added map-canvas lookup with basic visibility guard for movement actions.
  function getMapCanvas() {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return null;
    }
    return canvas;
  }

  // AI CHANGED: One-shot max zoom-out so scanNeighborRing's neighborStepPx (30) matches actual on-screen tile spacing.
  function ensureMapZoomedOut() {
    if (Runtime.zoom.maxedOut) {
      return { ok: true, skipped: true, reason: "already_maxed" };
    }
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("ZOOM", "ensureMapZoomedOut: map canvas not visible; skipping");
      return { ok: false, reason: "no_canvas" };
    }
    // AI CHANGED: Surface zoom-out as live status so the GUI shows what the bot is doing.
    setBotStatus("zooming", `max zoom-out (${Config.movement.maxZoomOutBursts} bursts)`);
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const bursts = Config.movement.maxZoomOutBursts;
    for (let i = 0; i < bursts; i += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 0,
        deltaY: 120,
        deltaZ: 0,
        deltaMode: 0,
        clientX: cx,
        clientY: cy,
        ctrlKey: false
      }));
    }
    Runtime.zoom.maxedOut = true;
    Logger.log("ZOOM", `max zoom-out applied (${bursts} wheel events)`);
    return { ok: true, bursts: bursts };
  }

  // AI CHANGED: Manual reset (e.g. after death or page reload) so the next scan re-applies max zoom-out.
  function forceZoomOut() {
    Runtime.zoom.maxedOut = false;
    return ensureMapZoomedOut();
  }

  // AI CHANGED: Added movement-state detector via yellow canvas condition bar "Moving".
  function isMovementInProgress() {
    const movingNode = document.querySelector(Config.selectors.movingBarValue);
    if (!movingNode) {
      return false;
    }
    const text = ((movingNode.textContent || "").trim()).toLowerCase();
    return text.includes("moving");
  }

  // AI CHANGED: Added map movement primitive that double-clicks a point on the canvas.
  function moveToMapPoint(clientX, clientY) {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("MOVE", "Move skipped: map canvas not found/visible");
      return false;
    }
    // AI CHANGED: Reduced synthetic events to lower passive-listener warnings while preserving double-click behavior.
    dispatchMouseAt(canvas, "click", clientX, clientY);
    dispatchMouseAt(canvas, "click", clientX, clientY);
    dispatchMouseAt(canvas, "dblclick", clientX, clientY);
    Logger.log("MOVE", "Map point double-clicked", { x: Math.round(clientX), y: Math.round(clientY) });
    return true;
  }

  // AI CHANGED: Added center-tile click used to open coordinate popup.
  function clickMapCenterTile() {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("MOVE", "Center tile click skipped: map canvas not found/visible");
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dispatchMouseAt(canvas, "click", cx, cy);
    Logger.log("MOVE", "Center tile clicked for coordinate read", {
      x: Math.round(cx),
      y: Math.round(cy)
    });
    return true;
  }

  // AI CHANGED: Added relative tile click helper for ring scan points.
  function clickMapRelative(dx, dy) {
    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn("SCAN", "Relative tile click skipped: map canvas not found/visible");
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + dx;
    const y = rect.top + rect.height / 2 + dy;
    dispatchMouseAt(canvas, "click", x, y);
    Logger.log("SCAN", "Relative tile clicked", { x: Math.round(x), y: Math.round(y), dx: dx, dy: dy });
    return true;
  }

  // AI CHANGED: Added helper to compute map center in client coordinates.
  function getMapCenterClientPoint() {
    const canvas = getMapCanvas();
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      rect: rect
    };
  }

  // AI CHANGED: Added clockwise 1-ring scan (TR -> TL) using popup counters/icons instead of visual guessing.
  async function scanNeighborRing() {
    // AI CHANGED: Surface scan as live status for the GUI.
    setBotStatus("scanning", "ring scan: 6 neighbor tiles");
    // AI CHANGED: Prevent scan start while avatar is still moving.
    await waitUntilNotMoving("scan-start");
    const opened = await ensureMapOpen();
    if (!opened.ok) {
      return { ok: false, reason: "map_not_open" };
    }
    // AI CHANGED: Lock map at min zoom so neighborStepPx=30 maps to real tile centers (calibrated via zoom-tester v0.3).
    ensureMapZoomedOut();
    const centered = await clickCenterMapVerified();
    if (!centered.ok) {
      return { ok: false, reason: "center_failed" };
    }

    const centerClicked = clickMapCenterTile();
    if (!centerClicked) {
      return { ok: false, reason: "center_tile_click_failed" };
    }
    const centerVisible = await waitForCondition(
      "scan center popup",
      () => !!readCurrentCoordsFromPopup(),
      { timeoutMs: 1200, pollMs: 120 }
    );
    if (!centerVisible) {
      return { ok: false, reason: "center_coords_timeout" };
    }
    const baseline = readCurrentCoordsFromPopup();
    if (!baseline) {
      return { ok: false, reason: "center_coords_missing" };
    }

    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const ring = [
      { key: "TR", dx: Math.round(step / 2), dy: -h },
      { key: "R", dx: step, dy: 0 },
      { key: "BR", dx: Math.round(step / 2), dy: h },
      { key: "BL", dx: -Math.round(step / 2), dy: h },
      { key: "L", dx: -step, dy: 0 },
      { key: "TL", dx: -Math.round(step / 2), dy: -h }
    ];

    const results = [];
    let lastObservedCoords = baseline;
    for (let i = 0; i < ring.length; i += 1) {
      const point = ring[i];
      const clicked = clickMapRelative(point.dx, point.dy);
      if (!clicked) {
        results.push({
          key: point.key,
          ok: false,
          clickable: false,
          classification: "blocked",
          reason: "click_failed"
        });
        continue;
      }
      // AI CHANGED: Wait for coordinate change from previously selected tile, not just popup visibility.
      const coordsChangedInTime = await waitForCondition(
        `scan ${point.key} coords change`,
        () => {
          const c = readCurrentCoordsFromPopup();
          return !!(c && (c.x !== lastObservedCoords.x || c.y !== lastObservedCoords.y));
        },
        // AI CHANGED: Use faster polling/timeout for quicker ring scan.
        { timeoutMs: Config.scan.tileTimeoutMs, pollMs: Config.scan.pollMs }
      );
      // AI CHANGED: Classify tiles by coordinate change only, independent of popup detail parsing.
      const currentCoords = readCurrentCoordsFromPopup() || lastObservedCoords;
      const details = readTilePopupDetails();
      const coordsChanged =
        currentCoords.x !== lastObservedCoords.x || currentCoords.y !== lastObservedCoords.y;
      if (!coordsChanged) {
        results.push({
          key: point.key,
          ok: false,
          clickable: false,
          classification: "blocked",
          reason: coordsChangedInTime ? "coords_unchanged" : "coords_unchanged",
          coords: currentCoords
        });
        continue;
      }
      lastObservedCoords = currentCoords;
      results.push({
        key: point.key,
        ok: true,
        clickable: true,
        classification: "walkable",
        // AI CHANGED: Preserve click vector for scan-driven movement decision.
        dx: point.dx,
        dy: point.dy,
        coords: currentCoords,
        tileName: details ? details.tileName : "",
        isCurrentTile: details ? details.isCurrentTile : false,
        allies: details ? details.allies : 0,
        enemies: details ? details.enemies : 0,
        lootIcons: details ? details.lootIcons : []
      });
    }

    const snapshot = {
      ok: true,
      scannedAt: Date.now(),
      results: results
    };
    Runtime.exploration.lastRingScan = snapshot;
    Logger.log("SCAN", "Neighbor ring scan completed", snapshot);
    return snapshot;
  }

  // AI CHANGED: Added coordinate-based movement verification, replacing visual-delta checks.
  async function verifyMoveByCoordinates() {
    const centered = await clickCenterMapVerified();
    if (!centered.ok) {
      return { ok: false, reason: "center_failed" };
    }
    const centerTileClicked = clickMapCenterTile();
    if (!centerTileClicked) {
      return { ok: false, reason: "center_tile_click_failed" };
    }
    const hasCoords = await waitForCondition(
      "coords popup visible",
      () => !!readCurrentCoordsFromPopup(),
      { timeoutMs: 1200, pollMs: 120 }
    );
    if (!hasCoords) {
      return { ok: false, reason: "coords_not_visible" };
    }
    const currentCoords = readCurrentCoordsFromPopup();
    if (!currentCoords) {
      return { ok: false, reason: "coords_parse_failed" };
    }
    if (!Runtime.exploration.lastKnownCoords) {
      Runtime.exploration.lastKnownCoords = currentCoords;
      Logger.log("MOVE", "Initialized last known coordinates", currentCoords);
      // AI CHANGED: Close coords popup after initialization to reveal bottom action controls.
      closeHexPopupIfOpen();
      // AI CHANGED: Initialization is not proof of movement; caller should run one follow-up verify.
      return { ok: false, moved: false, initialized: true, reason: "verify_initialized", coords: currentCoords };
    }
    const prev = Runtime.exploration.lastKnownCoords;
    const moved = currentCoords.x !== prev.x || currentCoords.y !== prev.y;
    if (moved) {
      Runtime.exploration.lastKnownCoords = currentCoords;
      Logger.log("MOVE", "Movement verified by coordinates", { from: prev, to: currentCoords });
      // AI CHANGED: Close coords popup after successful verify to avoid covering combat controls.
      closeHexPopupIfOpen();
      return { ok: true, moved: true, coords: currentCoords, prev: prev };
    }
    Logger.warn("MOVE", "Movement failed by coordinates (unchanged)", { coords: currentCoords });
    // AI CHANGED: Close coords popup even on failed verify so combat UI remains accessible.
    closeHexPopupIfOpen();
    return { ok: false, moved: false, reason: "coords_unchanged", coords: currentCoords, prev: prev };
  }

  // AI CHANGED: Added rotating neighbor target selection around player-centered map.
  function getNextExplorationPoint() {
    const canvas = getMapCanvas();
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const directions = [
      { dx: step, dy: 0 },
      { dx: Math.round(step / 2), dy: h },
      { dx: -Math.round(step / 2), dy: h },
      { dx: -step, dy: 0 },
      { dx: -Math.round(step / 2), dy: -h },
      { dx: Math.round(step / 2), dy: -h }
    ];
    const index = Runtime.exploration.directionIndex % directions.length;
    Runtime.exploration.directionIndex += 1;
    const dir = directions[index];
    return {
      x: cx + dir.dx,
      y: cy + dir.dy,
      directionIndex: index
    };
  }

  // AI CHANGED: Added idle exploration step used when no enemies and no loot are present.
  async function exploreIfIdle() {
    const now = readBasicState();
    if (typeof now.combat.enemyCount !== "number" || now.combat.enemyCount !== 0) {
      return { ok: false, skipped: true, reason: "not_idle" };
    }
    for (let attempt = 1; attempt <= Config.movement.maxExploreAttemptsPerIdle; attempt += 1) {
      const point = getNextExplorationPoint();
      if (!point) {
        return { ok: false, skipped: true, reason: "no_map_canvas" };
      }
      const moved = moveToMapPoint(point.x, point.y);
      if (!moved) {
        return { ok: false, skipped: true, reason: "move_dispatch_failed" };
      }
      await sleep(Config.movement.settleAfterMoveMs);
      const verify = await verifyMoveByCoordinates();
      if (verify.ok) {
        Logger.log("MOVE", "Idle exploration step verified", {
          directionIndex: point.directionIndex,
          attempt: attempt,
          settleMs: Config.movement.settleAfterMoveMs,
          coords: verify.coords
        });
        return { ok: true, moved: true, directionIndex: point.directionIndex, attempt: attempt, verify: verify };
      }
      Logger.warn("MOVE", "Exploration step blocked; trying next direction", {
        directionIndex: point.directionIndex,
        attempt: attempt,
        reason: verify.reason
      });
    }
    return { ok: false, skipped: true, reason: "all_directions_blocked" };
  }

  // AI CHANGED: Added loot/event marker parser (encoded SVG/color/class based) for deterministic priority rules.
  function parseLootKindsFromMarkers(markers) {
    if (!Array.isArray(markers) || markers.length === 0) {
      return [];
    }
    const kinds = [];
    for (let i = 0; i < markers.length; i += 1) {
      const marker = (markers[i] || "").toString().toLowerCase();
      if (!marker) {
        continue;
      }
      // AI CHANGED: Detect contract first (it can share grey color with chest family).
      if (
        marker.includes("viewbox%3d%220%200%2012%2012%22") ||
        marker.includes("stroke-width%3d%221%22") ||
        marker.includes("contract")
      ) {
        kinds.push("contract");
        continue;
      }
      if (
        marker.includes("icon-src-event-goblin") ||
        marker.includes("event-goblin") ||
        marker.includes("assets/icons/event-goblin.svg")
      ) {
        kinds.push("goblin");
        continue;
      }
      if (
        marker.includes("icon-src-mob-type-champion") ||
        marker.includes("mob-type-champion") ||
        marker.includes("assets/icons/mob-type-champion.svg")
      ) {
        kinds.push("boss");
        continue;
      }
      if (marker.includes("%237b2dda") || marker.includes("#7b2dda")) {
        kinds.push("purple_chest");
        continue;
      }
      if (marker.includes("%232d53da") || marker.includes("#2d53da")) {
        kinds.push("blue_chest");
        continue;
      }
      if (
        (marker.includes("broken") && marker.includes("cargo")) ||
        marker.includes("%23c96e2b") ||
        marker.includes("#c96e2b") ||
        marker.includes("viewbox%3d%220%200%2011.1179%2011.1184%22")
      ) {
        kinds.push("broken_cargo");
        continue;
      }
      if (marker.includes("icon-src-shrine") || marker.includes("sanctuary") || marker.includes("altar")) {
        kinds.push("altar");
        continue;
      }
      if (marker.includes("%23a5abb5") || marker.includes("#a5abb5")) {
        kinds.push("grey_chest");
        continue;
      }
      kinds.push("other_loot");
    }
    return kinds;
  }

  // AI CHANGED: Added deterministic priority score matching user-defined rank order with avoid rules.
  function scoreScannedTile(tile) {
    if (!tile || !tile.ok || tile.classification !== "walkable") {
      return -9999;
    }
    const lootKinds = parseLootKindsFromMarkers(tile.lootIcons);
    const enemies = Number.isFinite(tile.enemies) ? tile.enemies : 0;
    const allies = Number.isFinite(tile.allies) ? tile.allies : 0;

    // AI CHANGED: Hard-avoid goblin/boss tiles.
    if (lootKinds.includes("goblin") || lootKinds.includes("boss")) {
      return -500000;
    }

    // AI CHANGED: Apply exact loot ranking:
    // purple chest > blue chest > broken cargo > altar > grey chest > contract > only mobs > empty/allies.
    let base = 0;
    if (lootKinds.includes("purple_chest")) {
      base = 900000;
    } else if (lootKinds.includes("blue_chest")) {
      base = 800000;
    } else if (lootKinds.includes("broken_cargo")) {
      base = 700000;
    } else if (lootKinds.includes("altar")) {
      base = 600000;
    } else if (lootKinds.includes("grey_chest")) {
      base = 500000;
    } else if (lootKinds.includes("contract")) {
      base = 400000;
    } else if (enemies > 0) {
      base = 300000;
    } else {
      base = 100000;
    }

    // AI CHANGED: Contract can stack with any other loot/event type.
    if (lootKinds.includes("contract")) {
      base += 120000;
    }

    // AI CHANGED: If purple chest exists, do not penalize allies (steal attempt policy).
    const alliesPenalty = lootKinds.includes("purple_chest") ? 0 : allies * 400;

    // AI CHANGED: Keep same priority tier, but prefer more mobs and fewer allies unless purple is present.
    return base + enemies * 50 - alliesPenalty;
  }

  // AI CHANGED: Build the 12 second-ring tile offsets (6 corners + 6 edges) plus their nearest 1-ring direction.
  // Edge tiles map clockwise (e.g. T2 between TL and TR -> TR). The mapping is what we use to translate a
  // detected 2-ring marker into an actual 1-ring move target.
  function getSecondRingOffsets() {
    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const halfStep = Math.round(step / 2);
    const oneAndHalf = step + halfStep;
    return [
      { key: "TL2",  dx: -step,        dy: -2 * h, dir: "TL" },
      { key: "T2",   dx: 0,            dy: -2 * h, dir: "TR" },
      { key: "TR2",  dx: step,         dy: -2 * h, dir: "TR" },
      { key: "TR-R", dx: oneAndHalf,   dy: -h,     dir: "R"  },
      { key: "R2",   dx: 2 * step,     dy: 0,      dir: "R"  },
      { key: "R-BR", dx: oneAndHalf,   dy: h,      dir: "BR" },
      { key: "BR2",  dx: step,         dy: 2 * h,  dir: "BR" },
      { key: "B2",   dx: 0,            dy: 2 * h,  dir: "BL" },
      { key: "BL2",  dx: -step,        dy: 2 * h,  dir: "BL" },
      { key: "BL-L", dx: -oneAndHalf,  dy: h,      dir: "L"  },
      { key: "L2",   dx: -2 * step,    dy: 0,      dir: "L"  },
      { key: "L-TL", dx: -oneAndHalf,  dy: -h,     dir: "TL" }
    ];
  }

  // AI CHANGED: Generic 2-ring visual scanner — samples a small patch at each 2-ring tile center and counts
  // pixels matching `targetColor` within Euclidean RGB distance `options.tolerance`. Returns per-tile match
  // ratios plus the highest-ratio "hit". Used by scanSecondRingForDie; built generic so we can reuse it
  // later for purple chest / goblin / etc. The map must already be open and zoomed out (caller's job).
  async function scanSecondRingForColor(targetColor, options) {
    const opts = options || {};
    const cfg = Config.scan.secondRing;
    const tolerance = typeof opts.tolerance === "number" ? opts.tolerance : cfg.yellowDieTolerance;
    const minMatchRatio = typeof opts.minMatchRatio === "number" ? opts.minMatchRatio : cfg.minMatchRatio;
    const halfSize = typeof opts.halfSize === "number" ? opts.halfSize : cfg.sampleHalfSizePx;
    const label = typeof opts.label === "string" ? opts.label : "color";
    const logTag = "SCAN2";

    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn(logTag, "scanSecondRingForColor: map canvas not visible");
      return { ok: false, reason: "no_canvas" };
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      Logger.warn(logTag, "scanSecondRingForColor: canvas has zero CSS size");
      return { ok: false, reason: "zero_canvas_size" };
    }

    // Account for device pixel ratio — drawImage's source coords are in source-pixel space, not CSS space.
    const scaleX = (canvas.width || rect.width) / rect.width;
    const scaleY = (canvas.height || rect.height) / rect.height;

    const cssCenterX = rect.width / 2;
    const cssCenterY = rect.height / 2;

    const patchW = halfSize * 2;
    const patchH = halfSize * 2;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = Math.max(1, Math.round(patchW * scaleX));
    tempCanvas.height = Math.max(1, Math.round(patchH * scaleY));
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) {
      Logger.warn(logTag, "scanSecondRingForColor: temp canvas 2d context not available");
      return { ok: false, reason: "no_temp_ctx" };
    }

    const offsets = getSecondRingOffsets();
    const targetR = targetColor.r;
    const targetG = targetColor.g;
    const targetB = targetColor.b;
    const tolSq = tolerance * tolerance;

    const samples = [];
    let drawFailures = 0;
    for (let i = 0; i < offsets.length; i += 1) {
      const tile = offsets[i];
      const cssX = cssCenterX + tile.dx - halfSize;
      const cssY = cssCenterY + tile.dy - halfSize;
      const srcX = Math.round(cssX * scaleX);
      const srcY = Math.round(cssY * scaleY);
      const srcW = Math.round(patchW * scaleX);
      const srcH = Math.round(patchH * scaleY);

      let pixels = null;
      try {
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, tempCanvas.width, tempCanvas.height);
        pixels = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
      } catch (err) {
        drawFailures += 1;
        samples.push({
          key: tile.key,
          dir: tile.dir,
          dx: tile.dx,
          dy: tile.dy,
          ok: false,
          ratio: 0,
          hit: false,
          error: err && err.message ? err.message : String(err)
        });
        continue;
      }

      let matchCount = 0;
      const totalPixels = pixels.length / 4;
      for (let p = 0; p < pixels.length; p += 4) {
        const dr = pixels[p] - targetR;
        const dg = pixels[p + 1] - targetG;
        const db = pixels[p + 2] - targetB;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq <= tolSq) {
          matchCount += 1;
        }
      }
      const ratio = totalPixels > 0 ? matchCount / totalPixels : 0;
      samples.push({
        key: tile.key,
        dir: tile.dir,
        dx: tile.dx,
        dy: tile.dy,
        ok: true,
        ratio: ratio,
        matchCount: matchCount,
        totalPixels: totalPixels,
        hit: ratio >= minMatchRatio
      });
    }

    const hits = samples.filter((s) => s.hit);
    hits.sort((a, b) => b.ratio - a.ratio);
    const best = hits.length > 0 ? hits[0] : null;

    const snapshot = {
      ok: true,
      scannedAt: Date.now(),
      label: label,
      target: targetColor,
      tolerance: tolerance,
      minMatchRatio: minMatchRatio,
      halfSize: halfSize,
      samples: samples,
      hits: hits,
      best: best,
      drawFailures: drawFailures
    };

    Logger.log(logTag, `2-ring scan for ${label} done`, {
      hits: hits.length,
      bestKey: best ? best.key : null,
      bestDir: best ? best.dir : null,
      bestRatio: best ? Number(best.ratio.toFixed(4)) : null,
      drawFailures: drawFailures
    });

    return snapshot;
  }

  // AI CHANGED: Specific wrapper — scans the 2-ring for the yellow die marker (#f0b80c).
  // Returns the same shape as scanSecondRingForColor; caller looks at `best.dir` for the move target.
  async function scanSecondRingForDie() {
    const cfg = Config.scan.secondRing;
    const result = await scanSecondRingForColor(cfg.yellowDieColor, {
      tolerance: cfg.yellowDieTolerance,
      minMatchRatio: cfg.minMatchRatio,
      halfSize: cfg.sampleHalfSizePx,
      label: "yellow_die"
    });
    Runtime.exploration.lastSecondRingScan = result;
    return result;
  }

  // AI CHANGED: Helper — does a 1-ring scan have any USEFUL loot? Useful = at least one walkable tile
  // with non-empty loot icons that aren't goblin/boss (those are hard-avoided).
  function ringHasUsefulLoot(scanSnapshot) {
    if (!scanSnapshot || !scanSnapshot.ok || !Array.isArray(scanSnapshot.results)) {
      return false;
    }
    for (let i = 0; i < scanSnapshot.results.length; i += 1) {
      const r = scanSnapshot.results[i];
      if (!r || !r.ok || r.classification !== "walkable") {
        continue;
      }
      const kinds = parseLootKindsFromMarkers(r.lootIcons || []);
      if (kinds.length === 0) {
        continue;
      }
      if (kinds.includes("goblin") || kinds.includes("boss")) {
        continue;
      }
      return true;
    }
    return false;
  }

  // AI CHANGED: Pick best walkable tile from ring scan.
  function chooseBestScannedNeighbor(scanSnapshot) {
    if (!scanSnapshot || !scanSnapshot.ok || !Array.isArray(scanSnapshot.results)) {
      return null;
    }
    const walkable = scanSnapshot.results.filter((tile) => tile.ok && tile.classification === "walkable");
    if (walkable.length === 0) {
      return null;
    }
    walkable.sort((a, b) => scoreScannedTile(b) - scoreScannedTile(a));
    return walkable[0];
  }

  // AI CHANGED: Move by scan result first, fallback to old exploration if needed.
  // Order:
  //   1. Run 1-ring scan (popup-based, gives explicit loot icons + ally/enemy counts).
  //   2. If 1-ring has any useful (non-goblin/boss) loot -> pick it via existing scoring.
  //   3. Else -> run 2-ring visual scan for yellow-die markers (loot 2 tiles away).
  //      If a die is found, override target to the 1-ring tile in that direction
  //      (only if that 1-ring tile is walkable and not goblin/boss).
  //   4. Else -> fall back to existing scoring (covers empty-but-walkable tiles, allies-stacking, etc.).
  async function exploreByScan() {
    const now = readBasicState();
    if (typeof now.combat.enemyCount !== "number" || now.combat.enemyCount !== 0) {
      return { ok: false, skipped: true, reason: "not_idle" };
    }
    const scan = await scanNeighborRing();
    if (!scan.ok) {
      return { ok: false, skipped: true, reason: scan.reason || "scan_failed", scan: scan };
    }

    let target = null;
    let dieGuided = false;
    let secondRing = null;

    // AI CHANGED: When the 1-ring already shows useful loot, use it directly — no point doing the 2-ring scan.
    if (ringHasUsefulLoot(scan)) {
      target = chooseBestScannedNeighbor(scan);
    } else {
      // AI CHANGED: 1-ring is empty (or only goblin/boss). Visually probe the 2-ring for a yellow die hint.
      setBotStatus("scanning", "2-ring visual scan for yellow die");
      secondRing = await scanSecondRingForDie();
      if (secondRing && secondRing.ok && secondRing.best) {
        const dieDir = secondRing.best.dir;
        const candidate = scan.results.find((r) => r && r.ok && r.classification === "walkable" && r.key === dieDir);
        if (candidate) {
          const candidateKinds = parseLootKindsFromMarkers(candidate.lootIcons || []);
          const hostileTile = candidateKinds.includes("goblin") || candidateKinds.includes("boss");
          if (!hostileTile) {
            target = candidate;
            dieGuided = true;
            Logger.log("MOVE", `2-ring yellow die guides toward ${dieDir}`, {
              ring2Key: secondRing.best.key,
              ring2Ratio: Number(secondRing.best.ratio.toFixed(4)),
              ring1Tile: candidate.key
            });
          } else {
            Logger.warn("MOVE", `Die seen toward ${dieDir} but 1-ring tile is hostile (${candidateKinds.join(",")}); ignoring hint`);
          }
        } else {
          Logger.warn("MOVE", `Die seen toward ${dieDir} but corresponding 1-ring tile is blocked or missing; ignoring hint`);
        }
      }
      // If die didn't yield a usable target, fall back to standard scoring (e.g. step into empty tile).
      if (!target) {
        target = chooseBestScannedNeighbor(scan);
      }
    }

    if (!target) {
      return { ok: false, skipped: true, reason: "no_walkable_neighbor", scan: scan, secondRing: secondRing };
    }
    const center = getMapCenterClientPoint();
    // AI CHANGED: Surface move as live status for the GUI.
    setBotStatus("moving", `to ${target.key} (enemies=${target.enemies}, allies=${target.allies})`);
    // AI CHANGED: Move to selected scan target using double-click movement, not single scan click.
    const moved = center ? moveToMapPoint(center.x + target.dx, center.y + target.dy) : false;
    if (!moved) {
      return { ok: false, skipped: true, reason: "move_dispatch_failed", target: target };
    }
    Logger.log("MOVE", "Scan-selected tile double-clicked", { target: target.key, dx: target.dx, dy: target.dy });
    await sleep(Config.movement.settleAfterMoveMs);
    // AI CHANGED: Keep a single post-move gate before verification; loop entry has its own movement guard.
    await waitUntilNotMoving("post-move");
    // AI CHANGED: Surface verify as live status.
    setBotStatus("verifying", `coords change after move to ${target.key}`);
    let verify = await verifyMoveByCoordinates();
    // AI CHANGED: If verify just initialized baseline, run one immediate follow-up verify before deciding.
    if (verify.initialized) {
      await sleep(260);
      verify = await verifyMoveByCoordinates();
    }
    if (!verify.ok) {
      return { ok: false, skipped: true, reason: verify.reason || "move_verify_failed", target: target, verify: verify };
    }
    Logger.log("MOVE", "Scan-driven movement verified", {
      target: target.key,
      // AI CHANGED: Surface parsed loot kinds in movement logs for live validation of ranking behavior.
      lootKinds: parseLootKindsFromMarkers(target.lootIcons),
      enemies: target.enemies,
      allies: target.allies,
      lootIcons: target.lootIcons,
      coords: verify.coords,
      // AI CHANGED: Mark whether this move was driven by a 2-ring yellow-die hint (vs. normal scoring).
      dieGuided: dieGuided
    });
    return { ok: true, moved: true, target: target, verify: verify, scan: scan, secondRing: secondRing, dieGuided: dieGuided };
  }
