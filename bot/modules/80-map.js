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

  // AI CHANGED: slice 21 — game may reset camera zoom on death / poor connection; clear maxedOut so ensureMapZoomedOut runs again.
  function resetZoomAssumptionIfSessionRisk(session) {
    if (!session) {
      return false;
    }
    const risky = !!(session.dead || session.poorConnection);
    if (!risky) {
      return false;
    }
    if (Runtime.zoom.maxedOut) {
      Logger.log("ZOOM", "Cleared maxedOut (death or poor connection) — next scan will re-apply wheel zoom-out");
    }
    Runtime.zoom.maxedOut = false;
    return true;
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
      // AI CHANGED: Audit fix #7 — refresh per-tile baseline from the live popup just before the click instead of trusting the cumulative `lastObservedCoords`. A stale popup from a prior tile could otherwise cause us to compare against the wrong reference and misclassify the tile.
      const preClickFresh = readCurrentCoordsFromPopup();
      const preClickBaseline =
        preClickFresh && Number.isFinite(preClickFresh.x) && Number.isFinite(preClickFresh.y)
          ? preClickFresh
          : lastObservedCoords;
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
      // AI CHANGED: Wait for coordinate change from the just-read per-tile baseline (audit fix #7), not from `lastObservedCoords` which may have drifted.
      let coordsChangedInTime = await waitForCondition(
        `scan ${point.key} coords change`,
        () => {
          const c = readCurrentCoordsFromPopup();
          return !!(c && (c.x !== preClickBaseline.x || c.y !== preClickBaseline.y));
        },
        // AI CHANGED: Use faster polling/timeout for quicker ring scan.
        { timeoutMs: Config.scan.tileTimeoutMs, pollMs: Config.scan.pollMs }
      );
      // AI CHANGED: slice 14 — occasional slow popup misses 220ms window; one re-click + re-wait before marking blocked.
      const coordRetries = Number.isFinite(Config.scan.tileCoordVerifyRetries)
        ? Config.scan.tileCoordVerifyRetries
        : 0;
      if (!coordsChangedInTime && coordRetries > 0) {
        const settle = Number.isFinite(Config.scan.tileRetrySettleMs) ? Config.scan.tileRetrySettleMs : 90;
        for (let r = 0; r < coordRetries; r += 1) {
          await sleep(settle);
          Logger.log("SCAN", `scan ${point.key} coords change retry`, { attempt: r + 1, max: coordRetries });
          clickMapRelative(point.dx, point.dy);
          coordsChangedInTime = await waitForCondition(
            `scan ${point.key} coords change`,
            () => {
              const c = readCurrentCoordsFromPopup();
              return !!(c && (c.x !== preClickBaseline.x || c.y !== preClickBaseline.y));
            },
            { timeoutMs: Config.scan.tileTimeoutMs, pollMs: Config.scan.pollMs }
          );
          if (coordsChangedInTime) {
            break;
          }
        }
      }
      // AI CHANGED: Classify tiles by coordinate change only, independent of popup detail parsing.
      const currentCoords = readCurrentCoordsFromPopup() || preClickBaseline;
      const details = readTilePopupDetails();
      const coordsChanged =
        currentCoords.x !== preClickBaseline.x || currentCoords.y !== preClickBaseline.y;
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

  // AI CHANGED: v1.2.0-alpha — exposed avoidance / basement preference accessors so scoring + scan paths share one truth.
  function getAvoidChampions() {
    if (Runtime && Runtime.preferences && typeof Runtime.preferences.avoidChampions === "boolean") {
      return Runtime.preferences.avoidChampions;
    }
    return Config && Config.exploration && Config.exploration.avoidChampions === false ? false : true;
  }

  function getAvoidGoblins() {
    if (Runtime && Runtime.preferences && typeof Runtime.preferences.avoidGoblins === "boolean") {
      return Runtime.preferences.avoidGoblins;
    }
    return !!(Config && Config.exploration && Config.exploration.avoidGoblins === true);
  }

  function getBasementFarmingEnabled() {
    if (Runtime && Runtime.preferences && typeof Runtime.preferences.basementFarmingEnabled === "boolean") {
      return Runtime.preferences.basementFarmingEnabled;
    }
    return !!(Config && Config.basement && Config.basement.enabled === true);
  }

  function isInBasement() {
    return !!(Runtime && Runtime.basement && Runtime.basement.active === true);
  }

  // AI CHANGED: v1.2.0-alpha — direction reverse mapping for forward-objective scoring inside basements.
  function reverseDirection(dir) {
    const map = { TL: "BR", TR: "BL", L: "R", R: "L", BL: "TR", BR: "TL" };
    return dir && map[dir] ? map[dir] : null;
  }

  // AI CHANGED: Added deterministic priority score matching user-defined rank order with avoid rules.
  //   v1.2.0-alpha — boss/goblin avoidance is now driven by Runtime.preferences. When `avoidChampions === false` the
  //   champion-only tile becomes a top-priority TARGET (above all loot tiers). When `avoidGoblins === true` goblin tiles
  //   are hard-avoided. Basement forward-objective: while `Runtime.basement.active === true` the tile direction matching
  //   the REVERSE of `Runtime.exploration.lastMoveDir` receives a heavy backtrack penalty.
  function scoreScannedTile(tile) {
    if (!tile || !tile.ok || tile.classification !== "walkable") {
      return -9999;
    }
    const lootKinds = parseLootKindsFromMarkers(tile.lootIcons);
    const enemies = Number.isFinite(tile.enemies) ? tile.enemies : 0;
    const allies = Number.isFinite(tile.allies) ? tile.allies : 0;
    const avoidChampions = getAvoidChampions();
    const avoidGoblins = getAvoidGoblins();
    const inBasement = isInBasement();
    // Basement-end override: if we're at the basement end tile, allow champion engagement even when global avoidance is ON.
    //   v1.2.2-alpha — accept either the live atEndTile UI flag OR the sticky "atEnd" phase, so the override remains
    //   stable across the kill (champion icon disappears post-mortem but phase stays "atEnd" / "complete").
    const basementEndChampOverride =
      inBasement &&
      Runtime.basement &&
      (Runtime.basement.atEndTile === true || Runtime.basement.phase === "atEnd" || Runtime.basement.phase === "complete") &&
      Config &&
      Config.basement &&
      Config.basement.endChampionOverride !== false;

    // AI CHANGED: Champion / goblin avoidance.
    if (lootKinds.includes("boss") && avoidChampions && !basementEndChampOverride) {
      return -500000;
    }
    if (lootKinds.includes("goblin") && avoidGoblins) {
      return -400000;
    }

    // AI CHANGED: When champions/goblins are NOT avoided, treat their tiles as top-priority TARGETS
    //   (above any loot tier). Basement-end override also routes here so the end champion is engaged.
    if (lootKinds.includes("boss") && (!avoidChampions || basementEndChampOverride)) {
      const championBase = Config && Config.exploration && Number.isFinite(Config.exploration.championTargetScoreBase)
        ? Config.exploration.championTargetScoreBase
        : 950000;
      // Mob multiplier and ally penalty still apply.
      const champAllies = lootKinds.includes("purple_chest") ? 0 : allies * 2000;
      let champScore = championBase + enemies * 250 - champAllies;
      if (inBasement) {
        const reverse = reverseDirection(Runtime.exploration ? Runtime.exploration.lastMoveDir : null);
        const penalty = Config && Config.basement && Number.isFinite(Config.basement.backtrackPenalty)
          ? Config.basement.backtrackPenalty
          : 800000;
        if (reverse && tile.key === reverse) champScore -= penalty;
      }
      return champScore;
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
    } else if (lootKinds.includes("goblin") && !avoidGoblins) {
      // AI CHANGED: When goblins are NOT avoided, rank as a TARGET tier above loot fallback (configurable).
      base = Config && Config.exploration && Number.isFinite(Config.exploration.goblinTargetScoreBase)
        ? Config.exploration.goblinTargetScoreBase
        : 850000;
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
    let score = base + enemies * 200 - alliesPenalty;

    // AI CHANGED: v1.2.0-alpha — Basement forward objective. While inside a basement, penalize the tile that lies in the
    //   REVERSE direction of the last verified move. This stops the bot from oscillating back toward the entry/ladder.
    if (inBasement) {
      const reverse = reverseDirection(Runtime.exploration ? Runtime.exploration.lastMoveDir : null);
      const penalty = Config && Config.basement && Number.isFinite(Config.basement.backtrackPenalty)
        ? Config.basement.backtrackPenalty
        : 800000;
      if (reverse && tile.key === reverse) {
        score -= penalty;
      }
    }
    return score;
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

  // AI CHANGED: v1.2.0-alpha — Scans the 2-ring for the champion red marker (#aa4040). ONLY safe to call when
  //   `Runtime.preferences.avoidChampions === false`. Caller MUST gate on that — this helper does NOT enforce the gate
  //   itself so tests can exercise it directly. Returns the same shape as `scanSecondRingForColor`.
  async function scanSecondRingForChampion() {
    const cfg = Config.scan.secondRing;
    const color = (cfg && cfg.championRedColor) || { r: 0xaa, g: 0x40, b: 0x40 };
    const tol = Number.isFinite(cfg && cfg.championRedTolerance) ? cfg.championRedTolerance : 75;
    const ratio = Number.isFinite(cfg && cfg.championRedMinMatchRatio) ? cfg.championRedMinMatchRatio : (cfg && cfg.minMatchRatio) || 0.005;
    const result = await scanSecondRingForColor(color, {
      tolerance: tol,
      minMatchRatio: ratio,
      halfSize: cfg && cfg.sampleHalfSizePx ? cfg.sampleHalfSizePx : 18,
      label: "champion_red"
    });
    Runtime.exploration.lastSecondRingChampionScan = result;
    return result;
  }

  // AI CHANGED: v1.2.0-alpha — Build the 18 third-ring tile offsets (6 corners + 12 edges) plus the 1-ring directions
  //   that step toward each. Mirror of `getSecondRingOffsets()`; consumed only when lens equipped.
  function getThirdRingOffsets() {
    const step = Config.movement.neighborStepPx;
    const h = Math.round(step * 0.86);
    const halfStep = Math.round(step / 2);
    const oneAndHalf = step + halfStep;
    const twoAndHalf = step * 2 + halfStep;
    return [
      // Top row (y = -3h)
      { key: "TL3",   dx: -oneAndHalf,  dy: -3 * h, dirs: ["TL"]       },
      { key: "T3a",   dx: -halfStep,    dy: -3 * h, dirs: ["TL", "TR"] },
      { key: "T3b",   dx:  halfStep,    dy: -3 * h, dirs: ["TL", "TR"] },
      { key: "TR3",   dx:  oneAndHalf,  dy: -3 * h, dirs: ["TR"]       },
      // Upper-edge (y = -2h)
      { key: "TR-R3", dx:  twoAndHalf,  dy: -2 * h, dirs: ["TR", "R"]  },
      { key: "TL-L3", dx: -twoAndHalf,  dy: -2 * h, dirs: ["TL", "L"]  },
      // Side row (y = -h)
      { key: "R3a",   dx:  3 * step,    dy: -h,     dirs: ["R"]        },
      { key: "L3a",   dx: -3 * step,    dy: -h,     dirs: ["L"]        },
      // Side row (y = 0)
      { key: "R3",    dx:  3 * step,    dy:  0,     dirs: ["R"]        },
      { key: "L3",    dx: -3 * step,    dy:  0,     dirs: ["L"]        },
      // Lower-side (y = +h)
      { key: "R3b",   dx:  3 * step,    dy:  h,     dirs: ["R"]        },
      { key: "L3b",   dx: -3 * step,    dy:  h,     dirs: ["L"]        },
      // Lower-edge (y = +2h)
      { key: "BR-R3", dx:  twoAndHalf,  dy:  2 * h, dirs: ["BR", "R"]  },
      { key: "BL-L3", dx: -twoAndHalf,  dy:  2 * h, dirs: ["BL", "L"]  },
      // Bottom row (y = +3h)
      { key: "BL3",   dx: -oneAndHalf,  dy:  3 * h, dirs: ["BL"]       },
      { key: "B3a",   dx: -halfStep,    dy:  3 * h, dirs: ["BL", "BR"] },
      { key: "B3b",   dx:  halfStep,    dy:  3 * h, dirs: ["BL", "BR"] },
      { key: "BR3",   dx:  oneAndHalf,  dy:  3 * h, dirs: ["BR"]       }
    ];
  }

  // AI CHANGED: v1.2.0-alpha — Pixel-scan the third ring for arbitrary color. Implementation mirrors
  //   `scanSecondRingForColor()` but consults `Config.scan.thirdRing` defaults and reads its own offsets.
  async function scanThirdRingForColor(targetColor, options) {
    const opts = options || {};
    const cfg = Config.scan.thirdRing || {};
    const cfg2 = Config.scan.secondRing || {};
    const tolerance = typeof opts.tolerance === "number" ? opts.tolerance : (cfg2.yellowDieTolerance || 75);
    const minMatchRatio = typeof opts.minMatchRatio === "number"
      ? opts.minMatchRatio
      : (Number.isFinite(cfg.minMatchRatio) ? cfg.minMatchRatio : 0.004);
    const halfSize = typeof opts.halfSize === "number"
      ? opts.halfSize
      : (Number.isFinite(cfg.sampleHalfSizePx) ? cfg.sampleHalfSizePx : 16);
    const label = typeof opts.label === "string" ? opts.label : "color3";
    const logTag = "SCAN3";

    const canvas = getMapCanvas();
    if (!canvas) {
      Logger.warn(logTag, "scanThirdRingForColor: map canvas not visible");
      return { ok: false, reason: "no_canvas" };
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, reason: "zero_canvas_size" };
    }

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
      return { ok: false, reason: "no_temp_ctx" };
    }

    const offsets = getThirdRingOffsets();
    const targetR = targetColor.r;
    const targetG = targetColor.g;
    const targetB = targetColor.b;
    const tolSq = tolerance * tolerance;

    const useHexMask = cfg.useHexMask !== false;
    const hexRadius = Config.movement.neighborStepPx / Math.sqrt(3);
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const INV_SQRT3 = 1 / Math.sqrt(3);

    const samples = [];
    let drawFailures = 0;
    for (let i = 0; i < offsets.length; i += 1) {
      const tile = offsets[i];
      const cssX = cssCenterX + tile.dx - halfSize;
      const cssY = cssCenterY + tile.dy - halfSize;
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
        samples.push({ key: tile.key, dirs: tile.dirs.slice(), ok: false, ratio: 0, hit: false });
        continue;
      }

      let matchCount = 0;
      let totalPixels = 0;
      const tempW = tempCanvas.width;
      const tempH = tempCanvas.height;
      for (let ty = 0; ty < tempH; ty += 1) {
        const cssDy = ((ty + 0.5) / scaleY) - halfSize;
        const ay = Math.abs(cssDy);
        if (useHexMask && ay > hexRadius) continue;
        for (let tx = 0; tx < tempW; tx += 1) {
          const cssDx = ((tx + 0.5) / scaleX) - halfSize;
          if (useHexMask) {
            const ax = Math.abs(cssDx);
            if (ax > hexRadius * SQRT3_HALF) continue;
            if (ax * INV_SQRT3 + ay > hexRadius) continue;
          }
          const p = (ty * tempW + tx) * 4;
          const dr = pixels[p] - targetR;
          const dg = pixels[p + 1] - targetG;
          const db = pixels[p + 2] - targetB;
          const distSq = dr * dr + dg * dg + db * db;
          if (distSq <= tolSq) matchCount += 1;
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
      canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      samples: samples,
      hits: hits,
      best: best,
      drawFailures: drawFailures
    };
    Logger.log(logTag, `3-ring scan for ${label} done`, {
      hits: hits.length,
      bestKey: best ? best.key : null,
      bestRatio: best ? Number(best.ratio.toFixed(4)) : null
    });
    Runtime.exploration.lastThirdRingScan = snapshot;
    return snapshot;
  }

  // AI CHANGED: v1.2.0-alpha — best-effort lens detection. Click-dispatches one second-ring tile center via the same
  //   movement primitive used by `exploreByScan`. If the game accepts the move (lastKnownCoords change indicates the bot
  //   moved 2 hops), lens is equipped. The probe is destructive (it actually moves the bot) so callers must invoke this
  //   only on a safe boundary (e.g. start of session, before AUTO begins). Manual override via `setLensStateOverride()`
  //   bypasses the destructive probe entirely.
  async function detectLensState(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!Runtime.vision || typeof Runtime.vision !== "object") {
      Runtime.vision = { hasLens: null, lastDetectAt: null, lastDetectResult: null, detectAttempts: 0, manualOverride: null };
    }
    Runtime.vision.detectAttempts = (Runtime.vision.detectAttempts || 0) + 1;
    Runtime.vision.lastDetectAt = Date.now();

    if (Runtime.vision.manualOverride === true || Runtime.vision.manualOverride === false) {
      const result = { ok: true, hasLens: Runtime.vision.manualOverride, source: "manual_override" };
      Runtime.vision.hasLens = Runtime.vision.manualOverride;
      Runtime.vision.lastDetectResult = result;
      Logger.log("LENS", "detectLensState short-circuited via manual override", result);
      return result;
    }
    if (Config && Config.vision && Config.vision.lensProbeEnabled === false && opts.force !== true) {
      const result = { ok: true, hasLens: false, source: "probe_disabled", reason: "lens_probe_disabled" };
      Runtime.vision.lastDetectResult = result;
      return result;
    }

    const beforeMap = await ensureMapOpen();
    if (!beforeMap || beforeMap.ok === false) {
      const result = { ok: false, hasLens: null, reason: "map_not_open" };
      Runtime.vision.lastDetectResult = result;
      return result;
    }
    const before = readBasicState();
    const beforeCoords = before && before.coords ? String(before.coords) : null;

    // Pick first second-ring offset.
    const offsets = getSecondRingOffsets();
    const center = getMapCenterClientPoint();
    if (!center || offsets.length === 0) {
      const result = { ok: false, hasLens: null, reason: "no_center_or_offsets" };
      Runtime.vision.lastDetectResult = result;
      return result;
    }
    const probeTile = offsets[0];
    Logger.log("LENS", "detectLensState probing second-ring center", { tile: probeTile.key, beforeCoords: beforeCoords });
    const moved = moveToMapPoint(center.x + probeTile.dx, center.y + probeTile.dy);
    if (!moved) {
      const result = { ok: false, hasLens: null, reason: "dispatch_failed" };
      Runtime.vision.lastDetectResult = result;
      return result;
    }
    const settleMs = Config && Config.vision && Number.isFinite(Config.vision.lensProbeCoordsCheckSettleMs)
      ? Config.vision.lensProbeCoordsCheckSettleMs
      : 600;
    await sleep(settleMs);
    const after = readBasicState();
    const afterCoords = after && after.coords ? String(after.coords) : null;
    const moveAccepted = !!(beforeCoords && afterCoords && beforeCoords !== afterCoords);
    const hasLens = moveAccepted;
    Runtime.vision.hasLens = hasLens;
    const result = {
      ok: true,
      hasLens: hasLens,
      source: "probe",
      beforeCoords: beforeCoords,
      afterCoords: afterCoords,
      probeKey: probeTile.key
    };
    Runtime.vision.lastDetectResult = result;
    Logger.log("LENS", "detectLensState result", result);
    return result;
  }

  function setLensStateOverride(value) {
    if (!Runtime.vision || typeof Runtime.vision !== "object") {
      Runtime.vision = { hasLens: null, lastDetectAt: null, lastDetectResult: null, detectAttempts: 0, manualOverride: null };
    }
    if (value === true || value === false) {
      Runtime.vision.manualOverride = value;
      Runtime.vision.hasLens = value;
      return { ok: true, manualOverride: value, hasLens: value };
    }
    if (value === null || value === undefined) {
      Runtime.vision.manualOverride = null;
      return { ok: true, manualOverride: null, hasLens: Runtime.vision.hasLens };
    }
    return { ok: false, reason: "invalid_value" };
  }

  function getLensState() {
    const v = Runtime.vision || {};
    return {
      hasLens: typeof v.hasLens === "boolean" ? v.hasLens : null,
      manualOverride: typeof v.manualOverride === "boolean" ? v.manualOverride : null,
      lastDetectAt: v.lastDetectAt || null,
      detectAttempts: Number.isFinite(v.detectAttempts) ? v.detectAttempts : 0
    };
  }

  // AI CHANGED: v1.2.1-alpha — Automatic lens auto-detection latch. Called once per AUTO session from `startAutoFarmLoop`
  //   on the first SAFE OOC cycle. The probe is destructive (it actually moves the bot one tile) so we gate it tightly:
  //     - Must be running in AUTO and not stop-requested.
  //     - Latch `Runtime.autoFarm.lensAutoDetectDone` must be false (set true on completion or skip-by-state).
  //     - Manual override (`setLensStateOverride`) wins — if non-null, latch is set true and the probe never runs.
  //     - Probe must be enabled in `Config.vision.lensProbeEnabled`.
  //     - Live state must be OOC (enemyCount === 0), session healthy (no death/poor connection), no movement in progress.
  //     - Map must be openable.
  //   On any unsafe condition, the helper returns without flipping the latch so a later OOC cycle can retry.
  async function maybeAutoDetectLensIfNeeded(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!Runtime.autoFarm || Runtime.autoFarm.running !== true) {
      return { ok: false, skipped: true, reason: "not_in_auto" };
    }
    if (Runtime.autoFarm.stopRequested === true) {
      return { ok: false, skipped: true, reason: "stop_requested" };
    }
    if (Runtime.autoFarm.lensAutoDetectDone === true) {
      return { ok: true, skipped: true, reason: "already_done" };
    }
    if (!Runtime.vision || typeof Runtime.vision !== "object") {
      Runtime.vision = { hasLens: null, lastDetectAt: null, lastDetectResult: null, detectAttempts: 0, manualOverride: null };
    }
    // Manual override wins — latch and stop probing.
    if (Runtime.vision.manualOverride === true || Runtime.vision.manualOverride === false) {
      Runtime.vision.hasLens = Runtime.vision.manualOverride;
      Runtime.autoFarm.lensAutoDetectDone = true;
      Logger.log("LENS", "auto-detect skipped — manual override active", { override: Runtime.vision.manualOverride });
      return { ok: true, skipped: true, reason: "manual_override", hasLens: Runtime.vision.hasLens };
    }
    // Already known.
    if (Runtime.vision.hasLens === true || Runtime.vision.hasLens === false) {
      Runtime.autoFarm.lensAutoDetectDone = true;
      return { ok: true, skipped: true, reason: "already_known", hasLens: Runtime.vision.hasLens };
    }
    if (Config && Config.vision && Config.vision.lensProbeEnabled === false && opts.force !== true) {
      Runtime.autoFarm.lensAutoDetectDone = true;
      return { ok: true, skipped: true, reason: "probe_disabled" };
    }
    // Safety gates — DO NOT flip the latch on these so later cycles can retry.
    let state = null;
    try {
      state = typeof readBasicState === "function" ? readBasicState() : null;
    } catch (err) {
      return { ok: false, skipped: true, reason: "state_read_threw" };
    }
    if (!state || !state.combat || typeof state.combat.enemyCount !== "number") {
      return { ok: false, skipped: true, reason: "state_unavailable" };
    }
    if (state.combat.enemyCount > 0) {
      return { ok: false, skipped: true, reason: "in_combat" };
    }
    if (state.session && (state.session.dead === true || state.session.poorConnection === true)) {
      return { ok: false, skipped: true, reason: "session_risk" };
    }
    try {
      if (typeof isMovementInProgress === "function" && isMovementInProgress()) {
        return { ok: false, skipped: true, reason: "moving" };
      }
    } catch (err) {}
    setBotStatus("scanning", "lens auto-detect probe");
    Logger.log("LENS", "auto-detect probe starting", { reason: opts.reason || null });
    const result = await detectLensState({});
    Runtime.autoFarm.lensAutoDetectDone = true;
    Logger.log("LENS", "auto-detect probe complete", result);
    return Object.assign({ ok: true, autoLatched: true }, result || {});
  }

  // AI CHANGED: Helper — does a 1-ring scan have any USEFUL loot? Useful = at least one walkable tile
  // with non-empty loot icons that isn't boss-only (boss tiles stay hard-avoided in scoring).
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
      if (kinds.includes("boss")) {
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
  //   2. If 1-ring has any useful (non-boss) loot -> pick it via existing scoring.
  //   3. Else -> run 2-ring visual scan for yellow-die markers (loot 2 tiles away).
  //      If a die is found, override target to the 1-ring tile in that direction
  //      (only if that 1-ring tile is walkable and not boss).
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
    let championRingGuided = false;
    let lensThirdRingGuided = false;
    let secondRing = null;
    let secondRingChampion = null;
    let thirdRing = null;
    const avoidChampions = getAvoidChampions();
    const lensEquipped = !!(Runtime.vision && Runtime.vision.hasLens === true);

    // AI CHANGED: When the 1-ring already shows useful loot, use it directly — no point doing the 2-ring scan.
    if (ringHasUsefulLoot(scan)) {
      target = chooseBestScannedNeighbor(scan);
    } else {
      // AI CHANGED: 1-ring is empty (or only boss). Visually probe the 2-ring for a yellow die hint.
      setBotStatus("scanning", "2-ring visual scan for yellow die");
      secondRing = await scanSecondRingForDie();
      // AI CHANGED: v1.2.0-alpha — When champions NOT avoided, also pixel-scan 2-ring for champion red marker (#aa4040).
      if (!avoidChampions) {
        setBotStatus("scanning", "2-ring visual scan for champion red");
        secondRingChampion = await scanSecondRingForChampion();
      }
      // Pick the higher-priority 2-ring hint: champion red dominates yellow die (active target > loot hint).
      const bestSample = (() => {
        if (secondRingChampion && secondRingChampion.ok && secondRingChampion.best) {
          championRingGuided = true;
          return secondRingChampion.best;
        }
        return secondRing && secondRing.ok ? secondRing.best : null;
      })();
      if (bestSample) {
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
          // Champion-guided path may step through a boss-marked tile only when champion avoidance is OFF.
          if (kinds.includes("boss") && avoidChampions) {
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
          dieGuided = !championRingGuided;
          Logger.log("MOVE", `2-ring ${championRingGuided ? "champion red" : "yellow die"} guides toward ${target.key}`, {
            ring2Key: bestSample.key,
            ring2Ratio: Number(bestSample.ratio.toFixed(4)),
            considered: candidateDirs,
            picked: target.key,
            pickedEnemies: target.enemies,
            pickedAllies: target.allies,
            championGuided: championRingGuided,
            // AI CHANGED: Surface the score so we can see in logs why a candidate beat its peers.
            pickedScore: scoreScannedTile(target)
          });
        } else {
          Logger.warn("MOVE", `Hint seen toward dirs ${candidateDirs.join("/")} but no walkable safe candidate; ignoring hint`);
        }
      }
      // AI CHANGED: v1.2.0-alpha — Lens-equipped third-ring fallback. When neither 1-ring nor 2-ring yielded a target,
      //   scan the 3-ring for yellow + (champion red if not avoided) and step toward the resolved 1-ring direction.
      if (!target && lensEquipped) {
        setBotStatus("scanning", "3-ring visual scan (lens equipped)");
        const yellowCfg = Config.scan.secondRing || {};
        const yellowColor = yellowCfg.yellowDieColor || { r: 240, g: 184, b: 12 };
        thirdRing = await scanThirdRingForColor(yellowColor, {
          tolerance: yellowCfg.yellowDieTolerance,
          minMatchRatio: (Config.scan.thirdRing && Config.scan.thirdRing.minMatchRatio) || yellowCfg.minMatchRatio,
          label: "yellow_die_3ring"
        });
        let thirdBest = thirdRing && thirdRing.ok ? thirdRing.best : null;
        if (!thirdBest && !avoidChampions) {
          const champColor = yellowCfg.championRedColor || { r: 0xaa, g: 0x40, b: 0x40 };
          const champ3 = await scanThirdRingForColor(champColor, {
            tolerance: yellowCfg.championRedTolerance || 75,
            minMatchRatio: yellowCfg.championRedMinMatchRatio || 0.005,
            label: "champion_red_3ring"
          });
          if (champ3 && champ3.ok && champ3.best) {
            thirdRing = champ3;
            thirdBest = champ3.best;
            championRingGuided = true;
          }
        }
        if (thirdBest) {
          const candidateDirs = Array.isArray(thirdBest.dirs) ? thirdBest.dirs : [];
          const ringCandidates3 = [];
          for (let i = 0; i < candidateDirs.length; i += 1) {
            const dir = candidateDirs[i];
            const tile = scan.results.find((r) => r && r.ok && r.classification === "walkable" && r.key === dir);
            if (!tile) continue;
            const kinds = parseLootKindsFromMarkers(tile.lootIcons || []);
            if (kinds.includes("boss") && avoidChampions) continue;
            ringCandidates3.push(tile);
          }
          if (ringCandidates3.length > 0) {
            ringCandidates3.sort((a, b) => scoreScannedTile(b) - scoreScannedTile(a));
            target = ringCandidates3[0];
            lensThirdRingGuided = true;
            Logger.log("MOVE", `3-ring scan guides toward ${target.key}`, {
              ring3Key: thirdBest.key,
              ring3Ratio: Number(thirdBest.ratio.toFixed(4)),
              picked: target.key,
              championGuided: championRingGuided
            });
          }
        }
      }
      // If neither 2-ring nor 3-ring yielded a usable target, fall back to standard scoring.
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
      dieGuided: dieGuided,
      championRingGuided: championRingGuided,
      lensThirdRingGuided: lensThirdRingGuided
    });
    // AI CHANGED: v1.2.0-alpha — record last move direction for basement forward-objective scoring.
    if (Runtime.exploration && target && target.key) {
      Runtime.exploration.lastMoveDir = target.key;
    }
    if (isInBasement() && Runtime.basement) {
      Runtime.basement.lastDirection = target.key;
      Runtime.basement.tilesAdvanced = (Runtime.basement.tilesAdvanced || 0) + 1;
    }
    return {
      ok: true, moved: true, target: target, verify: verify, scan: scan,
      secondRing: secondRing, secondRingChampion: secondRingChampion, thirdRing: thirdRing,
      dieGuided: dieGuided, championRingGuided: championRingGuided, lensThirdRingGuided: lensThirdRingGuided
    };
  }

  // AI CHANGED: v1.2.0-alpha — App-facing setters/getters for avoidance + basement preferences. Persisted to localStorage.
  function ensurePreferencesObject() {
    if (!Runtime.preferences || typeof Runtime.preferences !== "object") {
      Runtime.preferences = { avoidChampions: true, avoidGoblins: false, basementFarmingEnabled: false };
    }
    return Runtime.preferences;
  }

  function setAvoidChampions(value) {
    const prefs = ensurePreferencesObject();
    prefs.avoidChampions = !!value;
    saveBotPreferencesToStorage({ reason: "set_avoid_champions" });
    Logger.log("PREFS", "avoidChampions=" + prefs.avoidChampions);
    return { ok: true, avoidChampions: prefs.avoidChampions };
  }

  function setAvoidGoblins(value) {
    const prefs = ensurePreferencesObject();
    prefs.avoidGoblins = !!value;
    saveBotPreferencesToStorage({ reason: "set_avoid_goblins" });
    Logger.log("PREFS", "avoidGoblins=" + prefs.avoidGoblins);
    return { ok: true, avoidGoblins: prefs.avoidGoblins };
  }

  function setBasementFarmingEnabled(value) {
    const prefs = ensurePreferencesObject();
    prefs.basementFarmingEnabled = !!value;
    saveBotPreferencesToStorage({ reason: "set_basement_farming" });
    Logger.log("PREFS", "basementFarmingEnabled=" + prefs.basementFarmingEnabled);
    return { ok: true, basementFarmingEnabled: prefs.basementFarmingEnabled };
  }

  function getBotPreferencesSnapshot() {
    const prefs = ensurePreferencesObject();
    return {
      avoidChampions: !!prefs.avoidChampions,
      avoidGoblins: !!prefs.avoidGoblins,
      basementFarmingEnabled: !!prefs.basementFarmingEnabled
    };
  }

  function saveBotPreferencesToStorage(meta) {
    try {
      const payload = getBotPreferencesSnapshot();
      window.localStorage.setItem("ligmarbot.botPreferences.v1", JSON.stringify(payload));
      return { ok: true, payload: payload, reason: meta && meta.reason ? meta.reason : null };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  function loadBotPreferencesFromStorage() {
    try {
      const raw = window.localStorage.getItem("ligmarbot.botPreferences.v1");
      if (!raw) return { ok: true, fromStorage: false };
      const p = JSON.parse(raw);
      const prefs = ensurePreferencesObject();
      if (typeof p.avoidChampions === "boolean") prefs.avoidChampions = p.avoidChampions;
      if (typeof p.avoidGoblins === "boolean") prefs.avoidGoblins = p.avoidGoblins;
      if (typeof p.basementFarmingEnabled === "boolean") prefs.basementFarmingEnabled = p.basementFarmingEnabled;
      return { ok: true, fromStorage: true, prefs: getBotPreferencesSnapshot() };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  // AI CHANGED: v1.2.0-alpha — Basement state helpers. Detection looks at the highlighted collect button's accessible
  //   text content for one of `Config.basement.entryDetectSubstrings`. Entry/exit lifecycle is operator-callable so the
  //   desktop app can drive it explicitly; AUTO loop callers can also invoke `markBasementEntered()` after a verified
  //   collect-click into a basement, and `markBasementExited()` after the corresponding exit collect-click.
  function detectBasementEntryFromUi() {
    if (!Config || !Config.basement) return { ok: false, reason: "no_config" };
    try {
      const sel = Config.basement.collectButtonSelector || "div.battle-event-button.highlight";
      const btns = Array.from(document.querySelectorAll(sel));
      const subs = Array.isArray(Config.basement.entryDetectSubstrings) ? Config.basement.entryDetectSubstrings : [];
      for (let i = 0; i < btns.length; i += 1) {
        const btn = btns[i];
        const txt = (btn.textContent || "").toLowerCase().trim();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase().trim();
        const blob = txt + " " + aria;
        for (let j = 0; j < subs.length; j += 1) {
          const sub = String(subs[j] || "").toLowerCase();
          if (sub && blob.indexOf(sub) !== -1) {
            return { ok: true, isBasement: true, substring: sub, button: btn };
          }
        }
      }
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
    return { ok: true, isBasement: false };
  }

  // AI CHANGED: v1.2.2-alpha — Phase state machine. ALL phase mutations route through this helper so we keep a single
  //   place for invariants: `active` boolean stays in sync, `objectiveComplete` flag stays in sync, transitions are
  //   logged with reasons, and we record `lastPhaseTransitionAt` / `lastPhaseTransitionReason` for diagnostics.
  function basementSetPhase(nextPhase, reason) {
    if (!Runtime.basement || typeof Runtime.basement !== "object") {
      Runtime.basement = {
        active: false, phase: "idle", objectiveComplete: false,
        enteredAt: null, exitedAt: null, lastEntrySource: null, lastDirection: null,
        atEndTile: false, mobsKilledHere: 0, tilesAdvanced: 0,
        exitSuppressedCount: 0, exitSuppressedAtEndCount: 0, knowledgeLootedCount: 0,
        lastPhaseTransitionAt: null, lastPhaseTransitionReason: null
      };
    }
    const allowed = ["idle", "active", "atEnd", "complete"];
    const target = allowed.indexOf(nextPhase) !== -1 ? nextPhase : null;
    if (!target) return { ok: false, reason: "invalid_phase", attempted: nextPhase };
    const prev = Runtime.basement.phase || "idle";
    if (prev === target) return { ok: true, skipped: true, phase: prev };
    Runtime.basement.phase = target;
    Runtime.basement.objectiveComplete = (target === "complete");
    Runtime.basement.active = (target !== "idle");
    Runtime.basement.lastPhaseTransitionAt = Date.now();
    Runtime.basement.lastPhaseTransitionReason = reason || null;
    Logger.log("BASEMENT", "phase transition", { from: prev, to: target, reason: reason || null });
    return { ok: true, from: prev, to: target };
  }

  function markBasementEntered(meta) {
    if (!Runtime.basement || typeof Runtime.basement !== "object") {
      Runtime.basement = {};
    }
    Runtime.basement.enteredAt = Date.now();
    Runtime.basement.exitedAt = null;
    Runtime.basement.lastEntrySource = meta && meta.source ? String(meta.source) : "unknown";
    Runtime.basement.lastDirection = null;
    Runtime.basement.atEndTile = false;
    Runtime.basement.mobsKilledHere = 0;
    Runtime.basement.tilesAdvanced = 0;
    Runtime.basement.exitSuppressedCount = 0;
    Runtime.basement.exitSuppressedAtEndCount = 0;
    Runtime.basement.knowledgeLootedCount = 0;
    basementSetPhase("active", "mark_basement_entered");
    Logger.log("BASEMENT", "entered", { source: Runtime.basement.lastEntrySource, substring: meta && meta.substring ? meta.substring : null });
    return { ok: true, state: Object.assign({}, Runtime.basement) };
  }

  function markBasementExited(meta) {
    if (!Runtime.basement) return { ok: false, reason: "no_state" };
    Runtime.basement.exitedAt = Date.now();
    Runtime.basement.atEndTile = false;
    Runtime.basement.lastDirection = null;
    basementSetPhase("idle", (meta && meta.reason) || "mark_basement_exited");
    Logger.log("BASEMENT", "exited", { reason: meta && meta.reason ? meta.reason : null, substring: meta && meta.substring ? meta.substring : null });
    return { ok: true };
  }

  function setBasementAtEndTile(value) {
    if (!Runtime.basement || typeof Runtime.basement !== "object") return { ok: false, reason: "no_state" };
    const v = !!value;
    Runtime.basement.atEndTile = v;
    // Rising edge into atEnd phase only happens from "active". From "atEnd"/"complete" we stay sticky.
    if (v && Runtime.basement.phase === "active") {
      basementSetPhase("atEnd", "set_basement_at_end_tile");
    }
    return { ok: true, atEndTile: v, phase: Runtime.basement.phase };
  }

  // AI CHANGED: v1.2.2-alpha — Convenience boolean: are we allowed to take the basement exit ladder right now?
  //   True only when phase === "complete". Used by the loot wrapper and (optionally) by external desktop-app callers.
  function getBasementCanExit() {
    return !!(Runtime && Runtime.basement && Runtime.basement.phase === "complete");
  }

  function getBasementState() {
    const b = Runtime.basement || {};
    return {
      active: !!b.active,
      phase: b.phase || "idle",
      objectiveComplete: !!b.objectiveComplete,
      canExit: b.phase === "complete",
      enteredAt: b.enteredAt || null,
      exitedAt: b.exitedAt || null,
      atEndTile: !!b.atEndTile,
      mobsKilledHere: Number.isFinite(b.mobsKilledHere) ? b.mobsKilledHere : 0,
      tilesAdvanced: Number.isFinite(b.tilesAdvanced) ? b.tilesAdvanced : 0,
      lastDirection: b.lastDirection || null,
      lastEntrySource: b.lastEntrySource || null,
      exitSuppressedCount: Number.isFinite(b.exitSuppressedCount) ? b.exitSuppressedCount : 0,
      exitSuppressedAtEndCount: Number.isFinite(b.exitSuppressedAtEndCount) ? b.exitSuppressedAtEndCount : 0,
      knowledgeLootedCount: Number.isFinite(b.knowledgeLootedCount) ? b.knowledgeLootedCount : 0,
      lastPhaseTransitionAt: b.lastPhaseTransitionAt || null,
      lastPhaseTransitionReason: b.lastPhaseTransitionReason || null
    };
  }

  // AI CHANGED: v1.2.1-alpha / v1.2.2-alpha — Basement objective wrapper. Wraps an async loot/activate function with a
  //   phase-aware decision tree so the bot does NOT immediately exit the basement on the cycle right after entry.
  //
  //   Decision tree (checks `detectBasementEntryFromUi()` BEFORE clicking — the highlighted button vanishes after a
  //   successful click, so we MUST snapshot first):
  //
  //     phase=="idle":
  //       - isLadder + click ok        → markBasementEntered  (phase → active)
  //       - !isLadder + click ok       → normal loot, no state change
  //
  //     phase=="active":  (we just entered, exploring forward)
  //       - isLadder                   → SUPPRESS click. Return ok/skipped/reason="basement_exit_suppressed".
  //                                       Increment exitSuppressedCount. Critical: this is the fix for the
  //                                       immediate-exit bug — the entrance-tile ladder is the same button as the
  //                                       exit ladder, so detect-substring matches it; without this gate the wrapper
  //                                       would flip phase back to idle on cycle 2.
  //       - !isLadder + click ok       → normal loot (chest/altar/contract on the way), no phase change.
  //
  //     phase=="atEnd":   (champion icon was seen on this tile this run; sticky)
  //       - isLadder                   → SUPPRESS first N cycles (Config.basement.exitSuppressedAtEndPromoteThreshold).
  //                                       Increment exitSuppressedAtEndCount. After threshold reached, promote phase
  //                                       → "complete" and FALL THROUGH to actually click the ladder (this is the
  //                                       fallback for basements that have no separate knowledge button).
  //       - !isLadder + click ok       → KNOWLEDGE LOOTED. Promote phase → "complete". The next cycle's ladder click
  //                                       will be allowed and will exit the basement.
  //
  //     phase=="complete":
  //       - isLadder + click ok        → markBasementExited (phase → idle). This is the allowed exit click.
  //       - !isLadder + click ok       → normal loot, no phase change (rare; secondary loot at end tile).
  //
  //   When basement farming is disabled, the wrapper is a transparent pass-through. When the loot fn fails, no phase
  //   transition is applied (the bot will retry on a later cycle).
  async function maybeApplyBasementTransitionAroundLoot(lootFn) {
    const farmingOn = typeof getBasementFarmingEnabled === "function" ? getBasementFarmingEnabled() : false;
    if (!farmingOn) {
      return await lootFn();
    }
    let beforeDetect = null;
    try {
      beforeDetect = typeof detectBasementEntryFromUi === "function" ? detectBasementEntryFromUi() : null;
    } catch (err) {
      beforeDetect = null;
    }
    const isLadder = !!(beforeDetect && beforeDetect.ok === true && beforeDetect.isBasement === true);
    if (!Runtime.basement || typeof Runtime.basement !== "object") {
      basementSetPhase("idle", "wrapper_init_default");
    }
    let phase = Runtime.basement.phase || "idle";
    const promoteThreshold =
      Config && Config.basement && Number.isFinite(Config.basement.exitSuppressedAtEndPromoteThreshold)
        ? Config.basement.exitSuppressedAtEndPromoteThreshold
        : 2;

    // PHASE-AWARE PRE-CLICK GATE.
    if (isLadder) {
      if (phase === "active") {
        Runtime.basement.exitSuppressedCount = (Runtime.basement.exitSuppressedCount || 0) + 1;
        Logger.log("BASEMENT", "ladder click suppressed (active phase)", {
          phase: phase,
          exitSuppressedCount: Runtime.basement.exitSuppressedCount,
          substring: beforeDetect ? beforeDetect.substring : null
        });
        return {
          ok: true, clicked: false, verified: true, skipped: true,
          reason: "basement_exit_suppressed",
          phase: phase,
          exitSuppressedCount: Runtime.basement.exitSuppressedCount
        };
      }
      if (phase === "atEnd") {
        Runtime.basement.exitSuppressedCount = (Runtime.basement.exitSuppressedCount || 0) + 1;
        Runtime.basement.exitSuppressedAtEndCount = (Runtime.basement.exitSuppressedAtEndCount || 0) + 1;
        if (Runtime.basement.exitSuppressedAtEndCount >= promoteThreshold) {
          // Promote to complete and fall through to actually click the ladder = exit.
          Logger.log("BASEMENT", "promoting to complete via suppressed-at-end threshold", {
            exitSuppressedAtEndCount: Runtime.basement.exitSuppressedAtEndCount,
            threshold: promoteThreshold
          });
          basementSetPhase("complete", "atEnd_suppressed_threshold_reached");
          phase = "complete";
        } else {
          Logger.log("BASEMENT", "ladder click suppressed (atEnd phase)", {
            phase: phase,
            exitSuppressedAtEndCount: Runtime.basement.exitSuppressedAtEndCount,
            threshold: promoteThreshold,
            substring: beforeDetect ? beforeDetect.substring : null
          });
          return {
            ok: true, clicked: false, verified: true, skipped: true,
            reason: "basement_exit_suppressed",
            phase: phase,
            exitSuppressedAtEndCount: Runtime.basement.exitSuppressedAtEndCount,
            promoteThreshold: promoteThreshold
          };
        }
      }
    }

    // CLICK (suppression has already short-circuited above for protected phases).
    const lootResult = await lootFn();

    // POST-CLICK PHASE TRANSITIONS.
    if (lootResult && lootResult.ok === true) {
      if (isLadder) {
        if (phase === "idle") {
          try { markBasementEntered({ source: "loot_collect_click", substring: beforeDetect.substring }); } catch (err) {}
        } else if (phase === "complete") {
          try { markBasementExited({ reason: "loot_collect_click_exit", substring: beforeDetect.substring }); } catch (err) {}
        }
      } else {
        // Non-ladder loot succeeded.
        if (phase === "atEnd" && lootResult.clicked === true && !lootResult.skipped) {
          Runtime.basement.knowledgeLootedCount = (Runtime.basement.knowledgeLootedCount || 0) + 1;
          basementSetPhase("complete", "knowledge_looted_at_end_tile");
        }
      }
    }
    return lootResult;
  }

  // AI CHANGED: v1.2.1-alpha / v1.2.2-alpha / v1.2.3-alpha — Refresh `Runtime.basement.atEndTile` by EXPLICITLY opening
  //   the current tile popup and reading its event icons. Live game behavior is that the champion / end icon is only
  //   reliably available inside the per-tile popup — assuming a popup is already open is fragile (it depends on a
  //   recent ring scan or a manual click), so v1.2.3 makes this an active probe.
  //
  //   Flow (uses the same primitives as `selectSpecialTileTargetIfDesired` and `scanNeighborRing`):
  //     1. `ensureMapOpen()` — guarantee the map view is live.
  //     2. `clickCenterMapVerified()` — recenter so the canvas center matches our current tile.
  //     3. `clickMapCenterTile()` — single-click the center to OPEN the per-tile popup.
  //     4. `waitForCondition` on `readTilePopupDetails()` returning a popup with coords (bounded ~1.5s, `pollMs=100`).
  //     5. Read `det.lootIcons` (popup-derived) and look for a champion-class icon.
  //
  //   Safety / non-destabilization rules:
  //     - Short-circuits when phase is already "atEnd" or "complete" (sticky — no need to re-probe).
  //     - Short-circuits when not in a basement.
  //     - If `opts.skipPopup === true`, falls back to the legacy passive `querySelectorAll` read (used by tests AND
  //       by callers that already have a popup open; e.g. wrappers that snapshot the DOM mid-flow).
  //     - If `opts.requireOoc === true` and the bot is in combat, returns `{ ok: false, skipped: true, reason: "in_combat" }`
  //       without touching the popup. Combat callers pass this so the destructive probe never runs while fighting.
  //     - Every step soft-fails to a structured `{ ok: false, skipped: true, reason: ... }` so a transient probe
  //       failure NEVER mutates `atEndTile` in either direction. The phase machine's sticky-once-set invariant means
  //       a failed probe cannot regress phase; combined with the no-mutation-on-fail rule, transient probe issues
  //       are fully contained.
  //
  //   Phase transition: rising edge (active → atEnd) ONLY when the probe succeeds and finds a champion icon.
  //   Returns `{ ok, atEndTile, phase, iconsScanned, viaPopup }` on success.
  async function updateBasementEndTileFlagFromVisibleIcons(opts) {
    if (!isInBasement()) return { ok: false, skipped: true, reason: "not_in_basement" };
    if (!Runtime.basement) return { ok: false, skipped: true, reason: "no_state" };
    const cfg = (opts && typeof opts === "object") ? opts : {};
    // Sticky: once at "atEnd" / "complete", further probes are unnecessary and could introduce side effects.
    if (Runtime.basement.phase === "atEnd" || Runtime.basement.phase === "complete") {
      return { ok: true, skipped: true, reason: "phase_sticky", phase: Runtime.basement.phase, atEndTile: !!Runtime.basement.atEndTile };
    }
    // Optional OOC gate — combat callers pass requireOoc:true so the popup probe never runs mid-fight.
    if (cfg.requireOoc === true) {
      let oocState = null;
      try { oocState = typeof readBasicState === "function" ? readBasicState() : null; } catch (err) { oocState = null; }
      if (!oocState || !oocState.combat || typeof oocState.combat.enemyCount !== "number") {
        return { ok: false, skipped: true, reason: "state_unavailable" };
      }
      if (oocState.combat.enemyCount > 0) {
        return { ok: false, skipped: true, reason: "in_combat" };
      }
    }

    const skipPopup = cfg.skipPopup === true;

    // STEP 1-4: open + recenter + click center tile + wait for popup. Each step soft-fails.
    if (!skipPopup) {
      if (typeof ensureMapOpen === "function") {
        try {
          const m = await ensureMapOpen();
          if (!m || m.ok === false) return { ok: false, skipped: true, reason: "map_not_open" };
        } catch (err) {
          return { ok: false, skipped: true, reason: "map_open_threw", error: String(err && err.message ? err.message : err) };
        }
      }
      if (typeof clickCenterMapVerified === "function") {
        try {
          const c = await clickCenterMapVerified();
          if (!c || c.ok === false) return { ok: false, skipped: true, reason: "center_failed" };
        } catch (err) {
          return { ok: false, skipped: true, reason: "center_threw", error: String(err && err.message ? err.message : err) };
        }
      }
      if (typeof clickMapCenterTile === "function") {
        try {
          const ok = clickMapCenterTile();
          if (!ok) return { ok: false, skipped: true, reason: "center_tile_click_failed" };
        } catch (err) {
          return { ok: false, skipped: true, reason: "center_tile_click_threw", error: String(err && err.message ? err.message : err) };
        }
      }
      const popupVisible = await waitForCondition(
        "basement end-tile popup",
        () => {
          if (typeof readTilePopupDetails === "function") {
            const d = readTilePopupDetails();
            return !!(d && d.coords);
          }
          return !!(typeof readCurrentCoordsFromPopup === "function" ? readCurrentCoordsFromPopup() : null);
        },
        { timeoutMs: 1500, pollMs: 100 }
      );
      if (!popupVisible) return { ok: false, skipped: true, reason: "popup_timeout" };
    }

    // STEP 5: read icons. Prefer the popup-derived `det.lootIcons` when available (canonical source); fall back
    // to a passive `querySelectorAll` for the `skipPopup` path.
    let hasChampion = false;
    let iconsScanned = 0;
    let viaPopup = false;

    if (typeof readTilePopupDetails === "function") {
      const det = readTilePopupDetails();
      if (det && Array.isArray(det.lootIcons) && det.lootIcons.length > 0) {
        viaPopup = true;
        iconsScanned = det.lootIcons.length;
        for (let i = 0; i < det.lootIcons.length; i += 1) {
          const blob = String(det.lootIcons[i] || "").toLowerCase();
          if (blob.indexOf("mob-type-champion") !== -1 || blob.indexOf("event-champion") !== -1) {
            hasChampion = true;
            break;
          }
        }
      }
    }
    if (!viaPopup) {
      const sel = Config && Config.selectors && Config.selectors.hexEventIcons
        ? Config.selectors.hexEventIcons
        : "div.hex-events app-icon, div.hex-events img";
      let icons = [];
      try {
        icons = Array.from(document.querySelectorAll(sel));
      } catch (err) {
        return { ok: false, skipped: true, reason: "selector_threw", error: String(err && err.message ? err.message : err) };
      }
      iconsScanned = icons.length;
      for (let i = 0; i < icons.length; i += 1) {
        const el = icons[i];
        const blob = ((el.getAttribute("class") || "") + " " + (el.getAttribute("src") || "") + " " + (el.outerHTML || "")).toLowerCase();
        if (blob.indexOf("mob-type-champion") !== -1 || blob.indexOf("event-champion") !== -1) {
          hasChampion = true;
          break;
        }
      }
    }

    const previous = !!Runtime.basement.atEndTile;
    Runtime.basement.atEndTile = hasChampion;
    if (hasChampion !== previous) {
      Logger.log("BASEMENT", "atEndTile flag updated", { previous: previous, current: hasChampion, iconsScanned: iconsScanned, viaPopup: viaPopup });
    }
    // Rising edge (active → atEnd) — sticky thereafter.
    if (Runtime.basement.phase === "active" && previous === false && hasChampion === true) {
      basementSetPhase("atEnd", "champion_icon_visible_in_basement");
    }
    return { ok: true, atEndTile: hasChampion, phase: Runtime.basement.phase, iconsScanned: iconsScanned, viaPopup: viaPopup };
  }
