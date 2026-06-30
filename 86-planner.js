  // --- Layer 4 Module: 80-map.js (Navigation & Tile Scoring Engine) ---
  // Rebuilt with highly optimized, clean, and modular scoring functions.
  // Implements the universal (0,0) block, exact loot priorities, player avoidance, and slight backtracking.

  function reverseDirection(dir) {
    const map = {
      "TR": "BL",
      "R":  "L",
      "BR": "TL",
      "BL": "TR",
      "L":  "R",
      "TL": "BR"
    };
    return dir && map[dir] ? map[dir] : null;
  }

  // 1. parseLootKindsFromMarkers
  // Parses visual SVG attributes/classes on the tile popup into recognized loot tags
  function parseLootKindsFromMarkers(markers) {
    const kinds = [];
    if (!Array.isArray(markers)) {
      return kinds;
    }
    for (let i = 0; i < markers.length; i += 1) {
      const marker = String(markers[i] || "");
      const markerLower = marker.toLowerCase();
      if (
        markerLower.indexOf("icon-src-event-goblin") !== -1 ||
        markerLower.indexOf("event-goblin") !== -1 ||
        markerLower.indexOf("assets/icons/event-goblin.svg") !== -1
      ) {
        kinds.push("goblin");
        continue;
      }
      if (
        markerLower.indexOf("icon-src-mob-type-boss") !== -1 ||
        markerLower.indexOf("mob-type-boss") !== -1 ||
        markerLower.indexOf("assets/icons/mob-type-boss.svg") !== -1
      ) {
        kinds.push("world_boss");
        continue;
      }
      if (
        markerLower.indexOf("icon-src-mob-type-champion") !== -1 ||
        markerLower.indexOf("mob-type-champion") !== -1 ||
        markerLower.indexOf("assets/icons/mob-type-champion.svg") !== -1
      ) {
        kinds.push("boss");
        continue;
      }
      if (marker.indexOf("%237b2dda") !== -1 || marker.indexOf("#7b2dda") !== -1) {
        kinds.push("purple_chest");
        continue;
      }
      if (marker.indexOf("%232d53da") !== -1 || marker.indexOf("#2d53da") !== -1) {
        kinds.push("blue_chest");
        continue;
      }
      if (
        (marker.indexOf("broken") !== -1 && marker.indexOf("cargo") !== -1) ||
        marker.indexOf("%23c96e2b") !== -1 ||
        marker.indexOf("#c96e2b") !== -1 ||
        marker.indexOf("viewbox%3d%220%200%2011.1179%2011.1184%22") !== -1
      ) {
        kinds.push("broken_cargo");
        continue;
      }
      if (marker.indexOf("icon-src-shrine") !== -1 || marker.indexOf("sanctuary") !== -1 || marker.indexOf("altar") !== -1) {
        kinds.push("altar");
        continue;
      }
      if (marker.indexOf("%23a5abb5") !== -1 || marker.indexOf("#a5abb5") !== -1) {
        kinds.push("grey_chest");
        continue;
      }
      if (
        marker.indexOf("grey-chest") !== -1 ||
        marker.indexOf("greychest") !== -1 ||
        marker.indexOf("gray-chest") !== -1 ||
        marker.indexOf("silver-chest") !== -1 ||
        marker.indexOf("icon-src-chest") !== -1 ||
        (marker.indexOf("chest") !== -1 &&
          marker.indexOf("purple") === -1 &&
          marker.indexOf("7b2dda") === -1 &&
          marker.indexOf("2d53da") === -1)
      ) {
        kinds.push("grey_chest");
        continue;
      }
      kinds.push("other_loot");
    }
    return kinds;
  }

  function isBasementPortalTile(tile) {
    if (!tile) {
      return false;
    }
    if (tile.basementEntry === true) {
      return true;
    }
    const markerText = Array.isArray(tile.lootIcons) ? tile.lootIcons.join(" ").toLowerCase() : "";
    return markerText.indexOf("m2.83594%2011.60154") !== -1 || markerText.indexOf("m2.83594 11.60154") !== -1;
  }

  function isBasementEndCandidateTile(tile) {
    if (!tile) {
      return false;
    }
    const inBasement = !!(Runtime && Runtime.basement && Runtime.basement.active && Runtime.preferences && Runtime.preferences.basementFarmingEnabled);
    if (!inBasement) {
      return false;
    }
    const kinds = parseLootKindsFromMarkers(tile.lootIcons);
    return kinds.indexOf("boss") !== -1;
  }

  function getBasementTileCoordKey(coords) {
    if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)) {
      return null;
    }
    return `${coords.x},${coords.y}`;
  }

  function addBasementVisitedTile(keyOrCoords) {
    if (!Runtime || !Runtime.basement) {
      return false;
    }
    const key = typeof keyOrCoords === "string" ? keyOrCoords : getBasementTileCoordKey(keyOrCoords);
    if (!key) {
      return false;
    }
    if (!Array.isArray(Runtime.basement.visitedTiles)) {
      Runtime.basement.visitedTiles = [];
    }
    if (Runtime.basement.visitedTiles.indexOf(key) === -1) {
      Runtime.basement.visitedTiles.push(key);
    }
    return true;
  }

  function isBasementTileVisited(keyOrCoords) {
    const key = typeof keyOrCoords === "string" ? keyOrCoords : getBasementTileCoordKey(keyOrCoords);
    return !!(key && Runtime && Runtime.basement && Array.isArray(Runtime.basement.visitedTiles) && Runtime.basement.visitedTiles.indexOf(key) !== -1);
  }

  function getBasementVisitedTiles() {
    return Runtime && Runtime.basement && Array.isArray(Runtime.basement.visitedTiles) ? Runtime.basement.visitedTiles.slice() : [];
  }

  function predictBasementTileCoord(tile) {
    if (!tile) {
      return null;
    }
    if (tile.coords && Number.isFinite(tile.coords.x) && Number.isFinite(tile.coords.y)) {
      return { x: tile.coords.x, y: tile.coords.y };
    }
    const last = Runtime && Runtime.basement ? Runtime.basement.lastTileCoords : null;
    const offsets = Runtime && Runtime.basement ? Runtime.basement.directionOffsets : null;
    if (!last || !offsets || !tile.key || !offsets[tile.key]) {
      return null;
    }
    return { x: last.x + offsets[tile.key].dx, y: last.y + offsets[tile.key].dy };
  }

  function isBasementChampionOverrideActive() {
    return !!(Runtime && Runtime.basement && Runtime.basement.active &&
      Runtime.preferences && Runtime.preferences.basementFarmingEnabled &&
      Config.basement && Config.basement.basementWideChampionOverride !== false);
  }

  // 2. scoreScannedTile
  // Evaluates and scores a single walkable tile using user's priority and strict player avoidance.
  function scoreScannedTile(tile) {
    // Basic verification: reject invalid/non-walkable tiles immediately
    if (!tile || !tile.ok || tile.classification !== "walkable") {
      return -9999;
    }

    // 1. UNIVERSAL (0,0) BLOCK RULE: never step on a tile with 0,0 coords. no matter where.
    if (tile.coords && tile.coords.x === 0 && tile.coords.y === 0) {
      return -9999;
    }

    const nameLower = String(tile.tileName || "").toLowerCase();
    const lootKinds = parseLootKindsFromMarkers(tile.lootIcons);
    const enemies = Number.isFinite(tile.enemies) ? tile.enemies : 0;
    const allies = Number.isFinite(tile.allies) ? tile.allies : 0;

    // Checks for avoidance settings
    const avoidChampions = Runtime && Runtime.preferences ? Runtime.preferences.avoidChampions : true;
    const avoidBosses = Runtime && Runtime.preferences ? Runtime.preferences.avoidBosses !== false : true;
    const avoidGoblins = Runtime && Runtime.preferences ? Runtime.preferences.avoidGoblins : false;
    const basementChampionOverride = isBasementChampionOverrideActive();
    const inBasementExploring = !!(Runtime && Runtime.basement && Runtime.basement.active && Runtime.basement.phase === "exploring");

    if (inBasementExploring) {
      const coord = predictBasementTileCoord(tile);
      const key = getBasementTileCoordKey(coord);
      const entranceKey = Runtime.basement.entranceTileKey || null;
      if (key && (key === entranceKey || isBasementTileVisited(key))) {
        Logger.debug("BASEMENT", "Basement visited/entrance tile suppressed while exploring", { tileKey: tile.key, coordKey: key, entranceKey: entranceKey });
        return -9999;
      }
    }

    // Gating for bosses, champions and goblins avoidance
    if (lootKinds.includes("world_boss") && avoidBosses) {
      return -500000;
    }
    if (lootKinds.includes("boss") && avoidChampions && !basementChampionOverride) {
      return -500000;
    }
    if (lootKinds.includes("goblin") && avoidGoblins) {
      return -400000;
    }

    // 2. LOOT/EVENT PRIORITY: Basement > Cargo > Champion > Purple chest > Altar > blue chest > Grey chest > Goblins > Contract > Mobs only > Empty space
    let base = 100000; // Empty space baseline (100k)

    const isBasementPortal = isBasementPortalTile(tile);

    if (isBasementPortal) {
      const basementEnabled = !!(Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled);
      if (!basementEnabled) {
        Logger.debug("BASEMENT", "Basement portal ignored because Basement Farming is OFF", { key: tile.key, coords: tile.coords, tileName: tile.tileName });
        return -9999;
      }
      base = 1100000; // Basement (1.1M)
    } else if (lootKinds.includes("broken_cargo")) {
      base = 1000000; // Cargo (1.0M)
    } else if (lootKinds.includes("world_boss") && !avoidBosses) {
      base = 980000;  // World boss if allowed
    } else if (lootKinds.includes("boss") && (!avoidChampions || basementChampionOverride)) {
      base = basementChampionOverride ? 950000 : 900000;  // Champion / Boss
    } else if (lootKinds.includes("purple_chest")) {
      base = 800000;  // Purple Chest (800k)
    } else if (lootKinds.includes("altar")) {
      base = 700000;  // Altar (700k)
    } else if (lootKinds.includes("blue_chest")) {
      base = 600000;  // Blue Chest (600k)
    } else if (lootKinds.includes("grey_chest")) {
      base = 500000;  // Grey Chest (500k)
    } else if (lootKinds.includes("goblin") && !avoidGoblins) {
      base = 400000;  // Goblins (400k)
    } else if (lootKinds.includes("contract") || lootKinds.includes("other_loot")) {
      base = 300000;  // Contract / Unclassified (300k)
    } else if (enemies > 0) {
      base = 200000;  // Mobs only (200k)
    }

    // 3. MULTIPLIERS & AVOID OTHER PLAYERS RULE: Just avoid other players, no exceptions.
    // Apply static ally penalty (-2000 per player) and enemy bonus (+200 per mob)
    const alliesPenalty = allies * 2000; // Strictly applied, no exceptions.
    const enemiesBonus = enemies * 200;

    let score = base + enemiesBonus - alliesPenalty;

    // 4. Penalize immediate reverse direction. Inside basements, use the basement moveStack
    // only, so the first basement step is not penalized by stale outside-map movement state.
    const inBasementForBacktrack = !!(Runtime && Runtime.basement && Runtime.basement.active && Runtime.preferences && Runtime.preferences.basementFarmingEnabled);
    let lastMoveDir = null;
    if (inBasementForBacktrack) {
      const stack = Runtime.basement && Array.isArray(Runtime.basement.moveStack) ? Runtime.basement.moveStack : [];
      lastMoveDir = stack.length > 0 ? stack[stack.length - 1] : null;
    } else {
      lastMoveDir = Runtime && Runtime.exploration ? Runtime.exploration.lastMoveDir : null;
    }
    if (lastMoveDir && tile.key === reverseDirection(lastMoveDir)) {
      score -= inBasementForBacktrack ? (Config.basement.backtrackPenalty || 800000) : 150000;
    }

    return score;
  }

  // 3. chooseBestScannedNeighbor
  // Selects the highest scoring walkable neighbor from the last ring scan
  function chooseBestScannedNeighbor(scan) {
    if (!scan || !Array.isArray(scan.results)) {
      return null;
    }

    const walkable = scan.results.filter((r) => r && r.ok && r.classification === "walkable");
    if (walkable.length === 0) {
      return null;
    }

    // Sort descending by score
    walkable.sort((a, b) => scoreScannedTile(b) - scoreScannedTile(a));

    const best = walkable[0];
    const bestScore = scoreScannedTile(best);

    // If the highest score is extremely negative (e.g. everything is blocked or highly avoided), return null
    if (bestScore <= -300000) {
      Logger.warn("MOVE", "All neighbors are blocked, hazardous, or avoided", { bestKey: best.key, bestScore: bestScore });
      return null;
    }

    return best;
  }

  function tileHasUsefulLoot(tile) {
    if (!tile || !tile.ok || tile.classification !== "walkable") {
      return false;
    }
    const score = scoreScannedTile(tile);
    if (score <= -300000) {
      return false;
    }
    if (tile.basementEntry === true) {
      return true;
    }
    const kinds = parseLootKindsFromMarkers(tile.lootIcons);
    const usefulKinds = ["world_boss", "boss", "broken_cargo", "purple_chest", "blue_chest", "grey_chest", "altar", "goblin", "other_loot", "contract"];
    return kinds.some((k) => usefulKinds.indexOf(k) !== -1);
  }

  function ringHasUsefulLoot(scan) {
    return !!(scan && Array.isArray(scan.results) && scan.results.some((t) => tileHasUsefulLoot(t)));
  }

  function chooseStepTowardRingTarget(firstRingScan, ringTarget) {
    if (!firstRingScan || !Array.isArray(firstRingScan.results) || !ringTarget || !Array.isArray(ringTarget.dirs)) {
      return null;
    }
    const candidates = [];
    for (let i = 0; i < ringTarget.dirs.length; i++) {
      const dir = ringTarget.dirs[i];
      const tile = firstRingScan.results.find((r) => r && r.key === dir && r.ok && r.classification === "walkable");
      if (!tile) {
        continue;
      }
      const score = scoreScannedTile(tile);
      if (score > -9999) {
        candidates.push({ tile: tile, score: score });
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0].tile;
    Logger.log("SCAN", "Resolved first-ring step toward ring target", {
      targetKey: ringTarget.key,
      dirs: ringTarget.dirs,
      chosen: chosen.key,
      chosenScore: candidates[0].score
    });
    return chosen;
  }

  function chooseBestUsefulRingTarget(ringScan) {
    if (!ringScan || !Array.isArray(ringScan.results)) {
      return null;
    }
    const useful = ringScan.results
      .filter((r) => r && r.ok && r.classification === "walkable" && tileHasUsefulLoot(r))
      .map((r) => Object.assign({ score: scoreScannedTile(r) }, r));
    if (useful.length === 0) {
      return null;
    }
    useful.sort((a, b) => b.score - a.score);
    return useful[0];
  }

  // 4. Movement Status & Event Readers
  function isMovementInProgress() {
    const movingNode = document.querySelector(Config.selectors.movingBarValue);
    if (!movingNode) {
      return false;
    }
    const text = (movingNode.textContent || "").trim().toLowerCase();
    return text.indexOf("moving") !== -1;
  }

  // Wait for movement progress bar to disappear (no-op if no bar is present/appeared)
  async function waitUntilNotMoving(label) {
    const l = label || "navigation";
    Logger.debug("MOVE", `Checking movement progress bar clear (${l})`);

    const completed = await waitForCondition(
      "movement bar clear",
      () => !isMovementInProgress(),
      { timeoutMs: 6500, pollMs: 100 } // Safe upper limit for long dungeon transitions
    );
    return !!completed;
  }

  // Wait for the "Move" button to become active (lose state-disabled, gain state-default)
  // USER CORRECTION: check every 50ms. If not visible, skip cooldown guard entirely and proceed.
  async function waitForMoveButtonEnabled() {
    const selector = Config.selectors.buttonMove;
    const btn = document.querySelector(selector);
    
    // If the button is not visible or missing, skip cooldown guard and proceed
    if (!btn || !isElementVisible(btn)) {
      Logger.debug("MOVE", "Move button is not visible or missing. Skipping cooldown guard.");
      return true;
    }

    // Button is visible, check every 50ms (up to 1.5s) for it to become enabled (not state-disabled, is state-default)
    const isEnabled = await waitForCondition(
      "move button active state",
      () => {
        const b = document.querySelector(selector);
        if (!b || !isElementVisible(b)) {
          return true; // If it vanished mid-poll, proceed
        }
        const cls = b.className || "";
        return cls.indexOf("state-disabled") === -1 && cls.indexOf("state-default") !== -1;
      },
      { timeoutMs: 1500, pollMs: 50 }
    );
    return !!isEnabled;
  }

  // Simulates a precise, canvas-safe user double-click (no PointerEvents to prevent WebGL crashes)
  async function doubleClickMapPoint(clientX, clientY) {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return false;
    }
    return await dispatchCanvasDblClickAt(canvas, clientX, clientY, "relative dblclick");
  }

  // 5. moveToScannedNeighbor (User-Improved Architecture: no redundant center click!)
  //   - Wait for "Move" button to be active/enabled (if visible).
  //   - Double-click target relative center.
  //   - Wait for progress bar to disable/disappear.
  //   - Mathematically project new coordinates (zero clicks, zero HUD popup flicker).
  async function moveToScannedNeighbor(target) {
    if (!target || !target.key || !Number.isFinite(target.dx) || !Number.isFinite(target.dy)) {
      return { ok: false, reason: "invalid_target" };
    }

    // 1. Check for the Move button to be active before double-clicking (skip if not visible)
    const moveBtnReady = await waitForMoveButtonEnabled();
    if (!moveBtnReady) {
      Logger.warn("MOVE", "Move button remained disabled after 1.5s; attempting click anyway");
    }

    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return { ok: false, reason: "canvas_not_visible" };
    }

    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const targetX = cx + target.dx;
    const targetY = cy + target.dy;

    // 2. Double-click the target tile
    const clicked = await doubleClickMapPoint(targetX, targetY);
    if (!clicked) {
      return { ok: false, reason: "double_click_failed" };
    }

    Logger.log("MOVE", `Tile ${target.key} double-clicked. Walking to coordinates...`, target.coords);

    // Give DOM 220ms to mount the progress bar if the movement is successfully registered
    await sleep(220);

    // 3. Wait for the movement progress bar to disable/disappear (no-op if already standing there)
    await waitUntilNotMoving("post-move-verification");

    // 4. Verify actual current-tile popup coords. Prefer the scanned target coords as
    // the expected destination; mathematical projection is only a fallback when scan coords are missing.
    const baseline = Runtime && Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
    const offsets = Runtime && Runtime.basement && Runtime.basement.directionOffsets ? Runtime.basement.directionOffsets : null;
    let expectedCoords = null;
    let expectedSource = "none";
    if (target.coords && Number.isFinite(target.coords.x) && Number.isFinite(target.coords.y)) {
      expectedCoords = { x: target.coords.x, y: target.coords.y };
      expectedSource = "scan_target_coords";
    } else if (baseline && offsets && offsets[target.key]) {
      expectedCoords = { x: baseline.x + offsets[target.key].dx, y: baseline.y + offsets[target.key].dy };
      expectedSource = "projection";
    }

    let actualCoords = null;
    await sleep(250);

    // After movement, do not click the visual map center directly: the camera may still be
    // centered on the previous tile. Re-run the full center-map verification, which recenters
    // first, waits for recenter settle, then opens the current-tile popup and returns coords.
    if (typeof ensureMapCentered === "function") {
      const centered = await ensureMapCentered();
      if (centered && centered.ok && centered.coords && Number.isFinite(centered.coords.x) && Number.isFinite(centered.coords.y)) {
        actualCoords = { x: centered.coords.x, y: centered.coords.y };
      } else {
        Logger.warn("MOVE", "Post-move map recenter verification failed; falling back to projected coords", centered);
      }
    }

    const finalCoords = actualCoords || expectedCoords;
    if (finalCoords) {
      const mismatch = !!(actualCoords && expectedCoords && (actualCoords.x !== expectedCoords.x || actualCoords.y !== expectedCoords.y));

      if (mismatch) {
        // The click did not move us to the intended tile. Update the known current position for safety,
        // but do not push moveStack / mark the intended direction as successful.
        if (Runtime && Runtime.exploration) {
          Runtime.exploration.lastKnownCoords = actualCoords;
        }
        if (Runtime && Runtime.basement && Runtime.basement.active) {
          Runtime.basement.lastTileCoords = actualCoords;
          Runtime.basement.lastTileKey = getBasementTileCoordKey(actualCoords);
        }
        Logger.warn("MOVE", "Post-move popup coords differed from projection; treating movement as failed", {
          expectedCoords: expectedCoords,
          actualCoords: actualCoords,
          direction: target.key,
          expectedSource: expectedSource
        });
        return {
          ok: false,
          reason: "move_coord_mismatch",
          holdPosition: true,
          coords: actualCoords,
          expectedCoords: expectedCoords,
          verifiedByPopup: true,
          mismatch: true,
          direction: target.key,
          expectedSource: expectedSource
        };
      }

      if (Runtime && Runtime.exploration) {
        Runtime.exploration.lastKnownCoords = finalCoords;
        Runtime.exploration.lastMoveDir = target.key;
      }
      if (Runtime && Runtime.basement && Runtime.basement.active) {
        Runtime.basement.lastTileCoords = finalCoords;
        Runtime.basement.lastTileKey = getBasementTileCoordKey(finalCoords);
        if (Array.isArray(Runtime.basement.moveStack)) {
          Runtime.basement.moveStack.push(target.key);
        }
        addBasementVisitedTile(Runtime.basement.lastTileKey);
      }
      Logger.log("MOVE", `Arrived. Coordinates updated to: [${finalCoords.x}, ${finalCoords.y}]`, { coords: finalCoords, expectedCoords: expectedCoords, expectedSource: expectedSource, verifiedByPopup: !!actualCoords, mismatch: false });
      return { ok: true, coords: finalCoords, expectedCoords: expectedCoords, expectedSource: expectedSource, verifiedByPopup: !!actualCoords, mismatch: false };
    }

    Logger.warn("MOVE", "Arrived, but coordinate projection and popup verification both failed.");
    return { ok: true, projected: false, verifiedByPopup: false };
  }

  // 6. 2-Ring & 3-Ring Coordinate Offset Mappers (verified axial pointy-topped)
  function getSecondRingOffsets() {
    const step = Config.scan.neighborStepPx;
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

  function getThirdRingOffsets() {
    const step = Config.scan.neighborStepPx;
    const h = Math.round(step * 0.86);
    const halfStep = Math.round(step / 2);
    const oneAndHalf = step + halfStep;
    const twoAndHalf = step * 2 + halfStep;
    return [
      { key: "TL3",   dx: -oneAndHalf,  dy: -3 * h, dirs: ["TL"]       },
      { key: "T3a",   dx: -halfStep,    dy: -3 * h, dirs: ["TL", "TR"] },
      { key: "T3b",   dx:  halfStep,    dy: -3 * h, dirs: ["TL", "TR"] },
      { key: "TR3",   dx:  oneAndHalf,  dy: -3 * h, dirs: ["TR"]       },
      { key: "TR-R3", dx:  twoAndHalf,  dy: -2 * h, dirs: ["TR", "R"]  },
      { key: "TL-L3", dx: -twoAndHalf,  dy: -2 * h, dirs: ["TL", "L"]  },
      { key: "R3a",   dx:  3 * step,    dy: -h,     dirs: ["R"]        },
      { key: "L3a",   dx: -3 * step,    dy: -h,     dirs: ["L"]        },
      { key: "R3",    dx:  3 * step,    dy:  0,     dirs: ["R"]        },
      { key: "L3",    dx: -3 * step,    dy:  0,     dirs: ["L"]        },
      { key: "R3b",   dx:  3 * step,    dy:  h,     dirs: ["R"]        },
      { key: "L3b",   dx: -3 * step,    dy:  h,     dirs: ["L"]        },
      { key: "BR-R3", dx:  twoAndHalf,  dy:  2 * h, dirs: ["BR", "R"]  },
      { key: "BL-L3", dx: -twoAndHalf,  dy:  2 * h, dirs: ["BL", "L"]  },
      { key: "BL3",   dx: -oneAndHalf,  dy:  3 * h, dirs: ["BL"]       },
      { key: "B3a",   dx: -halfStep,    dy:  3 * h, dirs: ["BL", "BR"] },
      { key: "B3b",   dx:  halfStep,    dy:  3 * h, dirs: ["BL", "BR"] },
      { key: "BR3",   dx:  oneAndHalf,  dy:  3 * h, dirs: ["BR"]       }
    ];
  }

  // 7. Ultra-High Performance One-Capture Canvas Pixel Scanner
  async function scanRingForColorInSingleCapture(ringOffsets, targetColor, tolerance, minMatchRatio, useHexMask) {
    const canvas = document.querySelector(Config.selectors.mapCanvas);
    if (!canvas || !isElementVisible(canvas)) {
      return { ok: false, reason: "canvas_not_visible" };
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, reason: "zero_canvas_size" };
    }

    // Account for device pixel ratio
    const scaleX = (canvas.width || rect.width) / rect.width;
    const scaleY = (canvas.height || rect.height) / rect.height;

    const cssCenterX = rect.width / 2;
    const cssCenterY = rect.height / 2;

    // Create a single temporary canvas of the same size to draw the map in exactly 1 call!
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) {
      return { ok: false, reason: "temp_context_unavailable" };
    }

    try {
      tempCtx.drawImage(canvas, 0, 0);
    } catch (err) {
      return { ok: false, reason: "draw_image_failed", error: String(err) };
    }

    // Extract raw pixels exactly once in-memory!
    const fullImgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const pixels = fullImgData.data;
    const fullWidth = tempCanvas.width;
    const fullHeight = tempCanvas.height;

    const targetR = targetColor.r;
    const targetG = targetColor.g;
    const targetB = targetColor.b;
    const tolSq = tolerance * tolerance;

    const hexRadius = Config.scan.neighborStepPx / Math.sqrt(3);
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const INV_SQRT3 = 1 / Math.sqrt(3);

    const halfSize = Math.round(Config.scan.secondRing.sampleHalfSizePx || 18);
    const samples = [];

    for (let i = 0; i < ringOffsets.length; i += 1) {
      const tile = ringOffsets[i];
      // Target center on the full canvas coordinate space
      const tileCenterX = Math.round((cssCenterX + tile.dx) * scaleX);
      const tileCenterY = Math.round((cssCenterY + tile.dy) * scaleY);

      let matchCount = 0;
      let totalPixels = 0;

      // Sample a bounding box around the tile center
      const startX = tileCenterX - Math.round(halfSize * scaleX);
      const endX = tileCenterX + Math.round(halfSize * scaleX);
      const startY = tileCenterY - Math.round(halfSize * scaleY);
      const endY = tileCenterY + Math.round(halfSize * scaleY);

      for (let y = startY; y <= endY; y++) {
        if (y < 0 || y >= fullHeight) continue;
        for (let x = startX; x <= endX; x++) {
          if (x < 0 || x >= fullWidth) continue;

          // Apply Hex Mask in source-pixel coordinates to eliminate neighbor leakage
          if (useHexMask) {
            const dyPixels = (y - tileCenterY) / scaleY;
            const dxPixels = (x - tileCenterX) / scaleX;
            const absDx = Math.abs(dxPixels);
            const absDy = Math.abs(dyPixels);

            const outsideY = absDy > hexRadius;
            const outsideX = absDx > hexRadius * SQRT3_HALF;
            const outsideSlanted = (absDx * INV_SQRT3) + absDy > hexRadius;

            if (outsideY || outsideX || outsideSlanted) {
              continue; // Exclude pixel from calculations
            }
          }

          const idx = (y * fullWidth + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];

          // Compute Euclidean distance square
          const distSq = (r - targetR) * (r - targetR) + 
                         (g - targetG) * (g - targetG) + 
                         (b - targetB) * (b - targetB);

          if (distSq <= tolSq) {
            matchCount += 1;
          }
          totalPixels += 1;
        }
      }

      const ratio = totalPixels > 0 ? (matchCount / totalPixels) : 0;
      const hit = ratio >= minMatchRatio;

      samples.push({
        key: tile.key,
        dirs: tile.dirs ? tile.dirs.slice() : [],
        ok: true,
        ratio: ratio,
        hit: hit
      });
    }

    // Find the best matching candidate tile
    const sorted = samples.filter((s) => s.hit).sort((a, b) => b.ratio - a.ratio);
    const best = sorted.length > 0 ? sorted[0] : null;

    return {
      ok: true,
      samples: samples,
      best: best
    };
  }

  async function scanSecondRingClickable() {
    Logger.log("SCAN", "Second-ring click scan started (lens mode)");
    const opened = await ensureMapOpen();
    if (!opened || !opened.ok) {
      return { ok: false, reason: "map_not_open", detail: opened };
    }
    const baseline = Runtime && Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
    if (!baseline || !Number.isFinite(baseline.x) || !Number.isFinite(baseline.y)) {
      return { ok: false, reason: "baseline_coords_missing" };
    }
    const offsets = getSecondRingOffsets();
    const results = [];
    let activePopupBaseline = baseline;
    for (let i = 0; i < offsets.length; i++) {
      const point = offsets[i];
      const clicked = clickMapRelative(point.dx, point.dy);
      if (!clicked) {
        results.push({ key: point.key, dirs: point.dirs || [], ok: false, clickable: false, classification: "blocked", reason: "click_failed" });
        continue;
      }
      await sleep(50);
      const currentCoords = typeof readCurrentCoordsFromPopup === "function" ? readCurrentCoordsFromPopup() : null;
      const coordsChanged = !!(currentCoords && (currentCoords.x !== activePopupBaseline.x || currentCoords.y !== activePopupBaseline.y));
      if (!coordsChanged) {
        results.push({ key: point.key, dirs: point.dirs || [], ok: false, clickable: false, classification: "blocked", reason: "coords_unchanged" });
        continue;
      }
      activePopupBaseline = currentCoords;
      const details = typeof readTilePopupDetails === "function" ? readTilePopupDetails() : null;
      const basementEntry = !!(
        Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled &&
        !(Runtime.basement && Runtime.basement.active) &&
        typeof detectBasementPortalActionButton === "function" &&
        detectBasementPortalActionButton().found
      );
      results.push({
        key: point.key,
        dirs: point.dirs || [],
        ok: true,
        clickable: true,
        classification: "walkable",
        dx: point.dx,
        dy: point.dy,
        coords: currentCoords,
        tileName: details ? details.tileName : "",
        isCurrentTile: details ? details.isCurrentTile : false,
        allies: details ? details.allies : 0,
        enemies: details ? details.enemies : 0,
        lootIcons: details ? details.lootIcons : [],
        basementEntry: basementEntry
      });
    }
    const snapshot = { ok: true, scannedAt: Date.now(), results: results };
    if (Runtime && Runtime.exploration) {
      Runtime.exploration.lastSecondRingClickScan = snapshot;
    }
    Logger.log("SCAN", "Second-ring click scan completed", snapshot);
    return snapshot;
  }

  // 8. Visual Scanner Wrappers
  async function scanSecondRingForDie() {
    const cfg = Config.scan.secondRing;
    const yellow = cfg.yellowDieColor || { r: 240, g: 184, b: 12 };
    return scanRingForColorInSingleCapture(getSecondRingOffsets(), yellow, cfg.yellowDieTolerance || 75, cfg.minMatchRatio || 0.005, cfg.useHexMask !== false);
  }

  async function scanSecondRingForChampion() {
    const cfg = Config.scan.secondRing;
    const red = cfg.championRedColor || { r: 0xaa, g: 0x40, b: 0x40 };
    return scanRingForColorInSingleCapture(getSecondRingOffsets(), red, cfg.championRedTolerance || 75, cfg.championRedMinMatchRatio || 0.005, cfg.useHexMask !== false);
  }

  async function scanThirdRingForColor(targetColor, options) {
    const opts = options || {};
    const cfg = Config.scan.thirdRing || {};
    const useHex = cfg.useHexMask !== false;
    return scanRingForColorInSingleCapture(getThirdRingOffsets(), targetColor, opts.tolerance || 75, opts.minMatchRatio || cfg.minMatchRatio || 0.004, useHex);
  }

  // 9. Automated, Non-Destructive Lens Detection
  //   - Click-scan EVERY tile on the second ring to guarantee range checking (even if some are blocked/walls).
  //   - Wait exactly 20ms between clicks (user-calibrated pollms = 20ms).
  //   - If any coordinate change is detected -> Lens = True!
  //   - Restores map focus and closes popup to remain 100% silent and clean.
  function getLensState() {
    const v = Runtime && Runtime.vision ? Runtime.vision : null;
    return v ? Object.assign({}, v) : { hasLens: null, override: null, detectedAt: null, lastDetection: null };
  }

  function setLensStateOverride(value) {
    if (!Runtime.vision) {
      Runtime.vision = { hasLens: null, override: null, detectedAt: null, lastDetection: null };
    }
    if (value === true || value === false) {
      Runtime.vision.override = value;
      Runtime.vision.hasLens = value;
      Runtime.vision.detectedAt = Date.now();
    } else {
      Runtime.vision.override = null;
      Runtime.vision.hasLens = null;
      Runtime.vision.detectedAt = null;
    }
    Logger.log("LENS", "Lens override updated", getLensState());
    return getLensState();
  }

  async function detectLensState() {
    if (Runtime && Runtime.vision && (Runtime.vision.override === true || Runtime.vision.override === false)) {
      Logger.log("LENS", "Lens detection skipped due to manual override", getLensState());
      return { ok: true, hasLens: Runtime.vision.override, override: true };
    }
    Logger.log("LENS", "Automated, non-destructive Lens Detection started");

    const opened = await ensureMapOpen();
    if (!opened || !opened.ok) {
      return { ok: false, hasLens: null, reason: "map_not_open" };
    }

    const centered = await ensureMapCentered();
    if (!centered || !centered.ok) {
      return { ok: false, hasLens: null, reason: "centering_failed" };
    }

    const beforeCoords = Runtime && Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
    if (!beforeCoords) {
      return { ok: false, hasLens: null, reason: "coords_unread" };
    }

    const offsets = getSecondRingOffsets();
    if (offsets.length === 0) {
      return { ok: false, hasLens: null, reason: "offsets_missing" };
    }

    let hasLens = false;

    // Scan EVERY tile of the second ring
    for (let i = 0; i < offsets.length; i++) {
      const probe = offsets[i];
      const clicked = clickMapRelative(probe.dx, probe.dy);
      if (!clicked) {
        continue;
      }

      // Delay between clicks is exactly 20ms (User-calibrated pollms = 20ms)
      await sleep(20);

      // Check if coordinates changed on this click
      const afterCoords = typeof readCurrentCoordsFromPopup === "function" ? readCurrentCoordsFromPopup() : null;
      if (afterCoords && (afterCoords.x !== beforeCoords.x || afterCoords.y !== beforeCoords.y)) {
        hasLens = true;
        Logger.log("LENS", `Coordinate change detected on 2-ring tile ${probe.key}. Lens is EQUIPPED!`);
        break; // Break instantly on first successful range confirmation
      }
    }

    const result = { ok: true, hasLens: hasLens, detectedAt: Date.now() };
    Logger.log("LENS", `Detection complete. Lens Equipped: ${hasLens}`, result);

    // Clean up: Recenter the camera to restore our starting coordinates and dismiss the popup
    await ensureMapCentered();

    if (Runtime && Runtime.vision) {
      Runtime.vision.hasLens = hasLens;
      Runtime.vision.detectedAt = result.detectedAt;
      Runtime.vision.lastDetection = result;
    }

    return result;
  }
