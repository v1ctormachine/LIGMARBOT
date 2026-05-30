  // AI CHANGED: Phase C1 -- hero combat stats reader and passive regen sampler. Opens the profile
  // overlay (avatar click), switches to the Stats tab, regex-parses Physical attack / Attack speed /
  // Crit chance / Crit damage from visible text, then returns via the Battle footer button.
  // Designed for console use first; combat planner will consume Runtime.hero later.

  // AI CHANGED: Strip thousands separators, percent signs, and parse a float; returns null if not finite.
  // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — when the value is a numeric range like "17-30" or "150-200"
  // (game sometimes shows physical/magic attack as a min-max bracket on Mage / Priest builds), take the FIRST
  // (minimal) part so damage estimates stay conservative. Negative single numbers ("-5") still parse via
  // parseFloat without being mistaken for a range (we only treat the value as a range when a digit precedes "-").
  function parseStatNumber(raw) {
    if (raw === undefined || raw === null) {
      return null;
    }
    let s = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
    if (s.length > 0 && /^\d/.test(s) && s.indexOf("-") > 0) {
      const parts = s.split("-");
      if (parts.length >= 2 && parts[0].length > 0) {
        s = parts[0];
      }
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // AI CHANGED: Collect visible text from the overlay layer so stats regex do not match unrelated HUD.
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

  // AI CHANGED: Extract labeled stat rows from flattened overlay text (English UI).
  function parseHeroCombatStatsFromText(blob) {
    const out = {
      physicalAttack: null,
      // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — magic attack added as a first-class stat so non-Archer
      // classes (Mage / Priest / hybrid Warrior magic skills) can rely on the planner damage model.
      magicAttack: null,
      attackSpeed: null,
      critChance: null,
      critDamage: null,
      // Raw substrings for debugging when regex misses (e.g. localization).
      rawSnippets: {}
    };
    if (!blob) {
      return out;
    }

    // Physical attack — "Physical attack  1234" or "Physical attack: 1234"
    // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — accept hyphen in the captured numeric so range values
    // like "17-30" reach `parseStatNumber`, which now picks the minimum.
    let m = blob.match(/physical\s+attack\s*[:\s]+([\d.,-]+)/i);
    if (m) {
      out.physicalAttack = parseStatNumber(m[1]);
      out.rawSnippets.physicalAttack = m[0];
    }

    // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — magic attack regex (mirrors physical attack shape).
    m = blob.match(/magic\s+attack\s*[:\s]+([\d.,-]+)/i);
    if (m) {
      out.magicAttack = parseStatNumber(m[1]);
      out.rawSnippets.magicAttack = m[0];
    }

    // Attack speed — may be "1.4 / s" or percent in some builds
    m = blob.match(/attack\s+speed\s*[:\s]+([\d.,]+(?:\s*\/\s*s)?)/i);
    if (m) {
      const numPart = m[1].split("/")[0];
      out.attackSpeed = parseStatNumber(numPart);
      out.rawSnippets.attackSpeed = m[0];
    }

    // Crit chance — short label OR full "Critical hit chance" (game template)
    m = blob.match(/critical\s+hit\s+chance\s*[:\s]+([\d.,]+)\s*%?/i);
    if (m) {
      out.critChance = parseStatNumber(m[1]);
      out.rawSnippets.critChance = m[0];
    }
    if (out.critChance === null) {
      m = blob.match(/crit(?:\.|al)?\s*chance\s*[:\s]+([\d.,]+)\s*%?/i);
      if (m) {
        out.critChance = parseStatNumber(m[1]);
        out.rawSnippets.critChance = m[0];
      }
    }

    // Crit damage — "Critical hit damage" OR "critical damage"
    m = blob.match(/critical\s+hit\s+damage\s*[:\s]+([\d.,]+)\s*%?/i);
    if (m) {
      out.critDamage = parseStatNumber(m[1]);
      out.rawSnippets.critDamage = m[0];
    }
    if (out.critDamage === null) {
      m = blob.match(/crit(?:ical)?\s+damage\s*[:\s]+([\d.,]+)\s*%?/i);
      if (m) {
        out.critDamage = parseStatNumber(m[1]);
        out.rawSnippets.critDamage = m[0];
      }
    }

    return out;
  }

  // AI CHANGED: Primary parse path — each row is `app-param-item` with `.stat-item-name` / `.stat-item-value`
  // (Ligmar uses "Critical hit chance" / "Critical hit damage", which blob-regex alone often misses).
  function parseHeroCombatStatsFromParamItems(scopeRoot) {
    const out = {
      physicalAttack: null,
      // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — magic attack added as a first-class stat (see text-blob parser).
      magicAttack: null,
      attackSpeed: null,
      critChance: null,
      critDamage: null,
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
        // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — magic attack row (Mage / Priest / hybrid).
        out.magicAttack = parseStatNumber(rawVal);
        out.rawSnippets.magicAttack = rawVal;
      } else if (name === "attack speed") {
        const firstNum = rawVal.match(/[\d.,]+/);
        out.attackSpeed = firstNum ? parseStatNumber(firstNum[0]) : parseStatNumber(rawVal);
        out.rawSnippets.attackSpeed = rawVal;
      } else if (name === "critical hit chance") {
        out.critChance = parseStatNumber(rawVal);
        out.rawSnippets.critChance = rawVal;
      } else if (name === "critical hit damage") {
        out.critDamage = parseStatNumber(rawVal);
        out.rawSnippets.critDamage = rawVal;
      }
    }
    return out;
  }

  // AI CHANGED: Merge param-row parse (preferred) with regex-on-blob fallback for any null field.
  // AI CHANGED: Universal v1.2.9-alpha (Phase U1) — magicAttack joins physicalAttack in the merged shape.
  function mergeHeroCombatStats(fromParams, fromRegex) {
    const keys = ["physicalAttack", "magicAttack", "attackSpeed", "critChance", "critDamage"];
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

  // AI CHANGED: Find the Stats tab (tab-content text equals "Stats").
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

  // AI CHANGED: Activate the Stats tab inside the profile sheet.
  function clickHeroStatsTab() {
    const tab = findHeroStatsTab();
    if (!tab) {
      return false;
    }
    return clickElementSafe(tab, "hero Stats tab");
  }

  // AI CHANGED: Footer control that returns to battle view (closes profile / stats).
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

  // AI CHANGED: Persist last good combat stats read (survives refresh same as skills DB).
  function saveHeroStatsCache(stats) {
    try {
      const payload = {
        version: 2,
        savedAt: Date.now(),
        combat: stats
      };
      localStorage.setItem(Config.hero.statsStorageKey, JSON.stringify(payload));
      return true;
    } catch (err) {
      Logger.warn("HERO", "saveHeroStatsCache failed", err);
      return false;
    }
  }

  // AI CHANGED: Load cached hero stats on boot into Runtime.hero (optional convenience).
  function loadHeroStatsFromCache() {
    try {
      const raw = localStorage.getItem(Config.hero.statsStorageKey);
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      if (!payload || !payload.combat) {
        return false;
      }
      Runtime.hero.combatStats = payload.combat;
      Runtime.hero.statsReadAt = payload.savedAt || null;
      Runtime.hero.statsCacheLoadedAt = Date.now();
      return true;
    } catch (err) {
      Logger.warn("HERO", "loadHeroStatsFromCache failed", err);
      return false;
    }
  }

  // AI CHANGED: Clear cached hero stats (localStorage + Runtime fields).
  function clearHeroStatsCache() {
    try {
      localStorage.removeItem(Config.hero.statsStorageKey);
    } catch (err) {
      Logger.warn("HERO", "clearHeroStatsCache localStorage", err);
    }
    Runtime.hero.combatStats = null;
    Runtime.hero.statsReadAt = null;
    Runtime.hero.statsCacheLoadedAt = null;
    Runtime.hero.passiveRegen = null;
    Runtime.hero.regenMeasuredAt = null;
    Runtime.hero.lastError = null;
    Logger.log("HERO", "Hero stats cache cleared");
  }

  // AI CHANGED: Full UI flow: avatar -> Stats tab -> parse -> Battle. Manual / console-first.
  async function readHeroCombatStats() {
    const cfg = Config.hero;
    Runtime.hero.lastError = null;
    setBotStatus("scanning", "hero Stats tab");

    if (!clickHeroProfileAvatar()) {
      Runtime.hero.lastError = "profile_avatar_not_found";
      Logger.warn("HERO", "Could not find app-profile-avatar to open hero sheet");
      setBotStatus("idle", "hero stats: avatar missing");
      return { ok: false, reason: "profile_avatar_not_found" };
    }

    const opened = await waitForCondition(
      "hero profile sheet",
      () => !!findHeroStatsTab(),
      { timeoutMs: cfg.profileOpenTimeoutMs, pollMs: cfg.pollMs }
    );
    if (!opened) {
      Runtime.hero.lastError = "profile_sheet_timeout";
      Logger.warn("HERO", "Stats tab never appeared after avatar click");
      setBotStatus("idle", "hero stats: timeout");
      clickHeroBattleFooter();
      return { ok: false, reason: "profile_sheet_timeout" };
    }

    if (!clickHeroStatsTab()) {
      Runtime.hero.lastError = "stats_tab_not_found";
      Logger.warn("HERO", "Stats tab click failed");
      setBotStatus("idle", "hero stats: tab missing");
      clickHeroBattleFooter();
      return { ok: false, reason: "stats_tab_not_found" };
    }

    await sleep(cfg.statsPanelSettleMs);
    const overlayShell = document.querySelector(".cdk-overlay-container");
    const paramStats = parseHeroCombatStatsFromParamItems(overlayShell);
    const blob = collectHeroStatsTextBlob();
    const regexStats = parseHeroCombatStatsFromText(blob);
    const stats = mergeHeroCombatStats(paramStats, regexStats);

    Runtime.hero.combatStats = stats;
    Runtime.hero.statsReadAt = Date.now();
    saveHeroStatsCache(stats);

    clickHeroBattleFooter();
    await sleep(220);

    Logger.log("HERO", "Combat stats read", {
      stats: stats,
      fromParamRows: Object.keys(paramStats.byName || {}).length,
      textSample: blob.length > 220 ? blob.slice(0, 220) + "…" : blob
    });
    setBotStatus("idle", "hero stats OK");
    return { ok: true, stats: stats, rawTextSample: blob.slice(0, 600) };
  }

  // AI CHANGED: Sample HP/MP via readBasicState over a window; derive first/last slope as HP/s and MP/s.
  // Many games only apply HP regen while below max HP — if delta is 0, caller may need chip damage first.
  async function measurePassiveRegen(options) {
    const cfg = Config.hero;
    const opts = options || {};
    const totalMs = typeof opts.totalMs === "number" ? opts.totalMs : cfg.regenDefaultTotalMs;
    const intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : cfg.regenDefaultIntervalMs;

    Runtime.hero.lastError = null;
    setBotStatus("scanning", `regen ${Math.round(totalMs / 1000)}s`);

    const samples = [];
    const tEnd = Date.now() + totalMs;
    while (Date.now() < tEnd) {
      const st = readBasicState();
      const hp = st.player.hp;
      const mp = st.player.mp;
      samples.push({
        t: Date.now(),
        hpCur: hp.valid ? hp.cur : null,
        hpMax: hp.valid ? hp.max : null,
        mpCur: mp.valid ? mp.cur : null,
        mpMax: mp.valid ? mp.max : null
      });
      await sleep(intervalMs);
    }

    if (samples.length < 2) {
      Runtime.hero.passiveRegen = null;
      Runtime.hero.regenMeasuredAt = Date.now();
      setBotStatus("idle", "regen: too few samples");
      return { ok: false, reason: "too_few_samples", samples: samples };
    }

    const a = samples[0];
    const b = samples[samples.length - 1];
    const dtSec = (b.t - a.t) / 1000;
    const hpPerSec = dtSec > 0 && a.hpCur !== null && b.hpCur !== null ? (b.hpCur - a.hpCur) / dtSec : null;
    const mpPerSec = dtSec > 0 && a.mpCur !== null && b.mpCur !== null ? (b.mpCur - a.mpCur) / dtSec : null;

    const noteParts = [];
    if (hpPerSec === 0 || hpPerSec === -0) {
      noteParts.push("HP delta 0 — often at full HP or out-of-combat regen gated; try missing some HP first.");
    }
    if (mpPerSec === 0 || mpPerSec === -0) {
      noteParts.push("MP delta 0 — at max MP or no passive MP regen in this state.");
    }

    const result = {
      ok: true,
      durationSec: dtSec,
      hpPerSec: hpPerSec,
      mpPerSec: mpPerSec,
      sampleCount: samples.length,
      note: noteParts.join(" ")
    };
    Runtime.hero.passiveRegen = result;
    Runtime.hero.regenMeasuredAt = Date.now();
    Logger.log("HERO", "Passive regen measured", result);
    setBotStatus("idle", "regen sampled");
    return result;
  }
