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
      // AI CHANGED: Live recon — some grey/silver chest builds use a different fill or filename than #a5abb5.
      if (
        marker.includes("grey-chest") ||
        marker.includes("greychest") ||
        marker.includes("gray-chest") ||
        marker.includes("silver-chest") ||
        marker.includes("icon-src-chest") ||
        (marker.includes("chest") &&
          !marker.includes("purple") &&
          !marker.includes("7b2dda") &&
          !marker.includes("2d53da"))
      ) {
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
    // purple chest > blue chest > broken cargo > altar > grey chest > unknown icon > contract > only mobs > empty/allies.
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
    } else if (lootKinds.includes("other_loot")) {
      // AI CHANGED: Icons we do not classify used to fall through to "mobs or empty" base — chest-only tiles
      // often became 100000 while a 2-mob neighbor scored 300400, so the bot skipped real loot visually
      // marked on the map. Tier sits below grey_chest (known hex) but above contract.
      base = 450000;
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
    // AI CHANGED: Ally penalty bumped 400 -> 2000 so 1 ally is "worth ~10 enemies" worth of avoidance.
    // This stops the bot from preferring an ally-only tile over a mob-only tile when both are
    // empty-tier walkables, and it dominates within the same loot tier (mob+ally < mob-only).
    const alliesPenalty = lootKinds.includes("purple_chest") ? 0 : allies * 2000;

    // AI CHANGED: Per-enemy bonus bumped 50 -> 200 so mob count is a meaningful tiebreak between
    // walkable tiles in the same loot tier (e.g. 2 mobs > 1 mob > 0 mobs).
    return base + enemies * 200 - alliesPenalty;
  }

  // AI CHANGED: Build the 12 second-ring tile offsets (6 corners + 6 edges) plus the 1-ring directions
  // that bring us closer to that tile. Corner-2 tiles have one closest 1-ring direction; edge-2 tiles
  // have TWO equally-close directions (e.g. T2 between TL and TR -> ["TL","TR"]). The caller picks
  // among multiple candidates by min-enemies.
  function getSecondRingOffsets() {
    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const halfStep = Math.round(step / 2);
    const oneAndHalf = step + halfStep;
    return [
      { key: "TL2",  dx: -step,        dy: -2 * h, dirs: ["TL"]       },
      { key: "T2",   dx: 0,            dy: -2 * h, dirs: ["TL", "TR"] },
      { key: "TR2",  dx: step,         dy: -2 * h, dirs: ["TR"]       },
      { key: "TR-R", dx: oneAndHalf,   dy: -h,     dirs: ["TR", "R"]  },
      { key: "R2",   dx: 2 * step,     dy: 0,      dirs: ["R"]        },
      { key: "R-BR", dx: oneAndHalf,   dy: h,      dirs: ["R", "BR"]  },
      { key: "BR2",  dx: step,         dy: 2 * h,  dirs: ["BR"]       },
      { key: "B2",   dx: 0,            dy: 2 * h,  dirs: ["BR", "BL"] },
      { key: "BL2",  dx: -step,        dy: 2 * h,  dirs: ["BL"]       },
      { key: "BL-L", dx: -oneAndHalf,  dy: h,      dirs: ["BL", "L"]  },
      { key: "L2",   dx: -2 * step,    dy: 0,      dirs: ["L"]        },
      { key: "L-TL", dx: -oneAndHalf,  dy: -h,     dirs: ["L", "TL"]  }
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

    // AI CHANGED: Hex-mask precomputation. The actual game tile is a pointy-top hex with circumradius
    // r = step / sqrt(3) (~17.32 px at step=30). When useHexMask is on we test each pixel against the
    // hex inequality and only count pixels inside the tile's hex footprint -- this stops corner pixels
    // from leaking into neighbor tiles and gives a cleaner ratio. INV_SQRT3 and SQRT3_HALF are
    // precomputed to avoid trig per pixel; the inequality system is:
    //   |dy| <= r              (top/bottom point cap)
    //   |dx| <= r * sqrt(3)/2  (left/right flat-side cap)
    //   |dx|/sqrt(3) + |dy| <= r (slanted edges)
    const useHexMask = cfg && cfg.useHexMask !== false;
    const hexRadius = Config.movement.neighborStepPx / Math.sqrt(3);
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const INV_SQRT3 = 1 / Math.sqrt(3);

    const samples = [];
    let drawFailures = 0;
    for (let i = 0; i < offsets.length; i += 1) {
      const tile = offsets[i];
      const cssX = cssCenterX + tile.dx - halfSize;
      const cssY = cssCenterY + tile.dy - halfSize;
      // AI CHANGED: Capture the patch's viewport-space rect so the overlay can draw it without recomputing.
      const viewportX = rect.left + cssX;
      const viewportY = rect.top + cssY;
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
          dirs: tile.dirs.slice(),
          dx: tile.dx,
          dy: tile.dy,
          viewportX: viewportX,
          viewportY: viewportY,
          patchW: patchW,
          patchH: patchH,
          ok: false,
          ratio: 0,
          hit: false,
          maskShape: useHexMask ? "hex" : "square",
          error: err && err.message ? err.message : String(err)
        });
        continue;
      }

      // AI CHANGED: Walk the temp canvas pixel-by-pixel so we can skip pixels outside the hex when
      // useHexMask is on. The temp canvas dimensions are (patchW * scaleX) x (patchH * scaleY); we
      // convert each pixel back to CSS-space offset from the patch center and apply the hex test.
      let matchCount = 0;
      let totalPixels = 0;
      const tempW = tempCanvas.width;
      const tempH = tempCanvas.height;
      for (let ty = 0; ty < tempH; ty += 1) {
        // CSS-space dy (offset from tile center, in CSS px).
        const cssDy = ((ty + 0.5) / scaleY) - halfSize;
        const ay = Math.abs(cssDy);
        if (useHexMask && ay > hexRadius) {
          // Whole row is outside the hex -- skip without touching pixel data.
          continue;
        }
        for (let tx = 0; tx < tempW; tx += 1) {
          const cssDx = ((tx + 0.5) / scaleX) - halfSize;
          if (useHexMask) {
            const ax = Math.abs(cssDx);
            if (ax > hexRadius * SQRT3_HALF) {
              continue;
            }
            if (ax * INV_SQRT3 + ay > hexRadius) {
              continue;
            }
          }
          const p = (ty * tempW + tx) * 4;
          const dr = pixels[p] - targetR;
          const dg = pixels[p + 1] - targetG;
          const db = pixels[p + 2] - targetB;
          const distSq = dr * dr + dg * dg + db * db;
          if (distSq <= tolSq) {
            matchCount += 1;
          }
          totalPixels += 1;
        }
      }
      const ratio = totalPixels > 0 ? matchCount / totalPixels : 0;
      samples.push({
        key: tile.key,
        dirs: tile.dirs.slice(),
        dx: tile.dx,
        dy: tile.dy,
        viewportX: viewportX,
        viewportY: viewportY,
        patchW: patchW,
        patchH: patchH,
        ok: true,
        ratio: ratio,
        matchCount: matchCount,
        totalPixels: totalPixels,
        // AI CHANGED: Carry the mask shape so the overlay can draw a hex outline instead of a square.
        maskShape: useHexMask ? "hex" : "square",
        hexRadius: useHexMask ? hexRadius : null,
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
      // AI CHANGED: Carry the canvas viewport rect so the overlay can draw the center marker / direction arrow.
      canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      samples: samples,
      hits: hits,
      best: best,
      drawFailures: drawFailures
    };

    Logger.log(logTag, `2-ring scan for ${label} done`, {
      hits: hits.length,
      bestKey: best ? best.key : null,
      bestDirs: best ? best.dirs : null,
      bestRatio: best ? Number(best.ratio.toFixed(4)) : null,
      drawFailures: drawFailures
    });

    // AI CHANGED: Hook the visual overlay so every 2-ring scan (auto or manual) is visible on the page.
    if (Config.debug && Config.debug.showSecondRingOverlay && typeof renderSecondRingOverlay === "function") {
      try {
        renderSecondRingOverlay(snapshot);
      } catch (err) {
        Logger.warn(logTag, "renderSecondRingOverlay threw", err);
      }
    }

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
        const bestSample = secondRing.best;
        const candidateDirs = Array.isArray(bestSample.dirs) ? bestSample.dirs : [];
        // AI CHANGED: Resolve every candidate dir to its 1-ring scan result, drop blocked / hostile tiles.
        const ringCandidates = [];
        for (let i = 0; i < candidateDirs.length; i += 1) {
          const dir = candidateDirs[i];
          const tile = scan.results.find((r) => r && r.ok && r.classification === "walkable" && r.key === dir);
          if (!tile) {
            continue;
          }
          const kinds = parseLootKindsFromMarkers(tile.lootIcons || []);
          if (kinds.includes("goblin") || kinds.includes("boss")) {
            continue;
          }
          ringCandidates.push(tile);
        }
        if (ringCandidates.length > 0) {
          // AI CHANGED: Use the same scoreScannedTile() ranking that the non-die path uses so allies
          // are heavily penalized and enemies are mildly preferred. The previous "min enemies first"
          // tiebreak treated mobs as obstacles, causing the bot to walk through a player-only tile
          // toward a die instead of through a mob tile that led to the same die. Now both branches
          // use the same farming-aware policy.
          ringCandidates.sort((a, b) => scoreScannedTile(b) - scoreScannedTile(a));
          target = ringCandidates[0];
          dieGuided = true;
          Logger.log("MOVE", `2-ring yellow die guides toward ${target.key}`, {
            ring2Key: bestSample.key,
            ring2Ratio: Number(bestSample.ratio.toFixed(4)),
            considered: candidateDirs,
            picked: target.key,
            pickedEnemies: target.enemies,
            pickedAllies: target.allies,
            // AI CHANGED: Surface the score so we can see in logs why a candidate beat its peers.
            pickedScore: scoreScannedTile(target)
          });
        } else {
          Logger.warn("MOVE", `Die seen toward dirs ${candidateDirs.join("/")} but no walkable safe candidate; ignoring hint`);
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
