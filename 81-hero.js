  // --- Layer 2 Module: 40-state.js (Sensing & DOM Scrapers) ---
  // Rebuilt from scratch based on user approved specifications.
  // Serves as the raw parsing layer (the "eyes") of the bot, extracting game status in real-time.

  // 1. readCurrentCoordsFromPopup
  // Extracts current coordinates from the active popup (supporting commas and semicolons)
  function readCurrentCoordsFromPopup() {
    const coordsNode = document.querySelector(Config.selectors.hexTitleCoords);
    if (!coordsNode) {
      return null;
    }
    return typeof parseCoordsText === "function" ? parseCoordsText(coordsNode.textContent || "") : null;
  }

  // 2. readTilePopupDetails
  // Parses details of the active clicked tile popup (loot, enemies, allies, and "You are here" state)
  function readTilePopupDetails() {
    const coords = readCurrentCoordsFromPopup();
    if (!coords) {
      return null;
    }

    const nameNode = document.querySelector(Config.selectors.hexTitleName);
    const alliesNode = document.querySelector(Config.selectors.alliesCounter);
    const enemiesNode = document.querySelector(Config.selectors.enemiesCounter);
    const hereNode = document.querySelector(Config.selectors.hexCurrentText);

    // Capture visual event icons (loot chests, champions, etc.)
    const eventIcons = Array.from(document.querySelectorAll(Config.selectors.hexEventIcons)).map((icon) => {
      const classPart = (icon.className || "").toString();
      const srcPart = icon.getAttribute ? icon.getAttribute("src") || "" : "";
      return `${classPart} ${srcPart}`.trim();
    });

    const allies = alliesNode ? Number.parseInt((alliesNode.textContent || "").trim(), 10) : 0;
    const enemies = enemiesNode ? Number.parseInt((enemiesNode.textContent || "").trim(), 10) : 0;

    const hereText = hereNode ? (hereNode.textContent || "").toLowerCase() : "";
    const isCurrent = hereText.includes("here") || hereText.includes("current") || 
                      hereText.includes("текущ") || hereText.includes("текущая");

    return {
      coords: coords,
      tileName: nameNode ? (nameNode.textContent || "").trim() : "",
      isCurrentTile: !!(hereNode && isCurrent),
      allies: Number.isFinite(allies) ? allies : 0,
      enemies: Number.isFinite(enemies) ? enemies : 0,
      lootIcons: eventIcons
    };
  }

  // 3. readEnemyCount
  // Extracts the number of enemies remaining in the current pull
  function readEnemyCount() {
    const node = document.querySelector(Config.selectors.enemyCounter);
    if (!node) {
      return 0;
    }
    const val = typeof parseFirstInt === "function" ? parseFirstInt(node.textContent || "") : 0;
    return Number.isFinite(val) && val >= 0 ? val : 0;
  }

  // 4. readBasicState
  // Scrapes player HP/MP, active target HP, and critical system overlays
  function readBasicState() {
    const hpNode = document.querySelector(Config.selectors.hpText);
    const mpNode = document.querySelector(Config.selectors.mpText);
    const targetHpNode = document.querySelector(Config.selectors.targetHpText);
    const deathScreenNode = document.querySelector(Config.selectors.deathScreen);
    const poorConnectionNode = document.querySelector(Config.selectors.poorConnection);

    const hpText = hpNode ? hpNode.textContent || "" : "";
    const mpText = mpNode ? mpNode.textContent || "" : "";

    const hp = typeof parseFractionText === "function" ? parseFractionText(hpText) : { valid: false };
    const mp = typeof parseFractionText === "function" ? parseFractionText(mpText) : { valid: false };
    const targetHp = targetHpNode && typeof parseFractionText === "function" ? parseFractionText(targetHpNode.textContent || "") : { valid: false };

    // Get current coordinates (fallback to map baseline coordinates if no popup is open)
    let currentCoords = readCurrentCoordsFromPopup();
    if (!currentCoords && Runtime && Runtime.exploration) {
      currentCoords = Runtime.exploration.lastKnownCoords;
    }

    return {
      player: {
        hp: hp,
        mp: mp,
        coords: currentCoords
      },
      combat: {
        enemyCount: readEnemyCount(),
        targetHp: targetHp
      },
      session: {
        dead: !!(deathScreenNode && isElementVisible(deathScreenNode)),
        poorConnection: !!(poorConnectionNode && isElementVisible(poorConnectionNode)),
        isHealthy: !deathScreenNode && !poorConnectionNode
      }
    };
  }
