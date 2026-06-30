  // --- Layer 3 Module: 81-hero.js (Hero Stats Reader) ---
  // Rebuilt strictly based on user specifications:
  //   - Only parses Physical Attack and Magic Attack (crit, critdamage, attackspeed are completely omitted).
  //   - Automatically takes the minimum of range values (e.g., "17-30" -> 17) for conservative damage estimation.
  //   - Passive regeneration sampling and wait loops are completely removed.
  //   - No persistent local storage caching (rescans every time the bot is activated).

  // 1. parseHeroCombatStatsFromParamItems (Preferred Layer)
  // Queries all app-param-item rows inside the profile Stats tab overlay
  function parseHeroCombatStatsFromParamItems(scopeRoot) {
    const out = {
      physicalAttack: null,
      magicAttack: null,
      rawSnippets: {},
      byName: {}
    };

    const scope = scopeRoot || document.querySelector(".cdk-overlay-container") || document.body;
    const rows = scope.querySelectorAll("app-param-item");

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const nameEl = row.querySelector(".stat-item-name");
      const valEl = row.querySelector(".stat-item-value");
      if (!nameEl || !valEl) {
        continue;
      }

      const name = (nameEl.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const rawVal = (valEl.textContent || "").trim();
      out.byName[name] = rawVal;

      if (name === "physical attack") {
        out.physicalAttack = parseStatNumber(rawVal);
        out.rawSnippets.physicalAttack = rawVal;
      } else if (name === "magic attack") {
        out.magicAttack = parseStatNumber(rawVal);
        out.rawSnippets.magicAttack = rawVal;
      }
    }
    return out;
  }

  // 2. parseHeroCombatStatsFromText (Fallback Layer)
  // Gathers the raw inner text and searches using range-safe, hyphen-supporting regexes
  function parseHeroCombatStatsFromText(blob) {
    const out = {
      physicalAttack: null,
      magicAttack: null,
      rawSnippets: {}
    };
    if (!blob) {
      return out;
    }

    // Match physical attack (including hyphens for ranges: "120-150")
    let m = blob.match(/physical\s+attack\s*[:\s]+([\d.,-]+)/i);
    if (m) {
      out.physicalAttack = parseStatNumber(m[1]);
      out.rawSnippets.physicalAttack = m[0];
    }

    // Match magic attack (including hyphens for ranges: "17-30")
    m = blob.match(/magic\s+attack\s*[:\s]+([\d.,-]+)/i);
    if (m) {
      out.magicAttack = parseStatNumber(m[1]);
      out.rawSnippets.magicAttack = m[0];
    }

    return out;
  }

  // 3. mergeHeroCombatStats
  // Merges the row parser with the flat text parser fallback
  function mergeHeroCombatStats(fromParams, fromRegex) {
    const keys = ["physicalAttack", "magicAttack"];
    const merged = {
      rawSnippets: {},
      byName: fromParams && fromParams.byName ? fromParams.byName : {}
    };

    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      const pv = fromParams ? fromParams[k] : null;
      const rv = fromRegex ? fromRegex[k] : null;
      merged[k] = pv !== null && pv !== undefined && Number.isFinite(pv) ? pv : rv;
      merged.rawSnippets[k] = (fromParams && fromParams.rawSnippets && fromParams.rawSnippets[k])
        ? fromParams.rawSnippets[k]
        : (fromRegex && fromRegex.rawSnippets && fromRegex.rawSnippets[k])
          ? fromRegex.rawSnippets[k]
          : undefined;
    }
    return merged;
  }

  // 4. collectHeroStatsTextBlob (Isolates the dialog overlay content)
  function collectHeroStatsTextBlob() {
    const trySel = [
      ".cdk-overlay-container",
      ".tui-dialog",
      "app-dialog",
      "[class*='profile']",
      "body"
    ];
    for (let i = 0; i < trySel.length; i += 1) {
      const root = document.querySelector(trySel[i]);
      if (root) {
        const t = (root.innerText || "").replace(/\s+/g, " ").trim();
        if (t.length > 80) {
          return t;
        }
      }
    }
    return (document.body.innerText || "").replace(/\s+/g, " ").trim();
  }

  function clickHeroProfileAvatar() {
    let el = document.querySelector(Config.selectors.heroProfileAvatar);
    if (!el) {
      el = document.querySelector(Config.selectors.heroProfileAvatarFallback);
    }
    if (!el) {
      return false;
    }
    return clickElementSafe(el, "hero profile avatar");
  }

  function findHeroStatsTab() {
    const tabs = document.querySelectorAll("app-tab");
    for (let i = 0; i < tabs.length; i += 1) {
      const tc = tabs[i].querySelector(".tab-content");
      const label = tc ? (tc.textContent || "").trim() : "";
      if (/^stats$/i.test(label)) {
        return tabs[i];
      }
    }
    return null;
  }

  function clickHeroStatsTab() {
    const tab = findHeroStatsTab();
    if (!tab) {
      return false;
    }
    return clickElementSafe(tab, "hero Stats tab");
  }

  function clickHeroBattleFooter() {
    const byIcon = document.querySelector(Config.selectors.heroBattleFooterIcon);
    if (byIcon) {
      const row = byIcon.closest(".footer-button");
      if (row) {
        return clickElementSafe(row, "Battle footer");
      }
    }
    const texts = document.querySelectorAll(".footer-button");
    for (let i = 0; i < texts.length; i += 1) {
      const b = texts[i];
      const t = ((b.textContent || "") + "").toLowerCase();
      if (t.indexOf("battle") !== -1) {
        return clickElementSafe(b, "Battle footer");
      }
    }
    return false;
  }

  // 5. readHeroCombatStats (Streamlined Stats Sheet Scanner)
  // Exact Sequence: Open Profile -> Wait for Stats tab -> Click tab -> Settle 320ms -> Extract Stats -> Close Profile
  async function readHeroCombatStats() {
    Logger.log("HERO", "Starting real-time hero Stats sheet scan");
    
    if (Runtime && Runtime.hero) {
      Runtime.hero.lastError = null;
    }
    setBotStatus("scanning", "hero Stats tab");

    // 1. Open Profile Sheet
    if (!clickHeroProfileAvatar()) {
      if (Runtime && Runtime.hero) Runtime.hero.lastError = "profile_avatar_not_found";
      Logger.warn("HERO", "Could not find app-profile-avatar to open hero sheet");
      setBotStatus("idle", "hero stats: avatar missing");
      return { ok: false, reason: "profile_avatar_not_found" };
    }

    // 2. Wait for Stats tab to mount in DOM
    const opened = await waitForCondition(
      "hero profile sheet",
      () => !!findHeroStatsTab(),
      { timeoutMs: Config.hero.profileOpenTimeoutMs || 2800, pollMs: Config.hero.pollMs || 60 }
    );
    if (!opened) {
      if (Runtime && Runtime.hero) Runtime.hero.lastError = "profile_sheet_timeout";
      Logger.warn("HERO", "Stats tab never appeared after avatar click");
      setBotStatus("idle", "hero stats: timeout");
      clickHeroBattleFooter();
      return { ok: false, reason: "profile_sheet_timeout" };
    }

    // 3. Click Stats Tab
    if (!clickHeroStatsTab()) {
      if (Runtime && Runtime.hero) Runtime.hero.lastError = "stats_tab_not_found";
      Logger.warn("HERO", "Stats tab click failed");
      setBotStatus("idle", "hero stats: tab missing");
      clickHeroBattleFooter();
      return { ok: false, reason: "stats_tab_not_found" };
    }

    // 4. Settle exactly 320ms to allow Angular list renderer to complete
    await sleep(Config.hero.statsPanelSettleMs || 320);

    // 5. Read and parse combat stats
    const overlayShell = document.querySelector(".cdk-overlay-container");
    const paramStats = parseHeroCombatStatsFromParamItems(overlayShell);
    const blob = collectHeroStatsTextBlob();
    const regexStats = parseHeroCombatStatsFromText(blob);
    const stats = mergeHeroCombatStats(paramStats, regexStats);

    if (Runtime && Runtime.hero) {
      Runtime.hero.combatStats = stats;
      Runtime.hero.statsReadAt = Date.now();
    }

    // 6. Click Battle footer button to return to battle HUD (closes character sheet)
    clickHeroBattleFooter();
    
    // Settle 220ms for HUD rendering
    await sleep(220);

    Logger.log("HERO", "Hero Stats scan completed successfully", stats);
    setBotStatus("idle", "hero stats OK");
    return { ok: true, stats: stats };
  }
