  // AI CHANGED: Phase C3 -- enemy target profile reader + lightweight DB. Reads name / level /
  // condition-bar labels from the live target panel (scoped from the red HP bar when possible).
  // Mob damage-type icon dropped: observed hp_drop from C2 already reflects real mitigation; typing
  // from icon is a weak prior without known formulas. Buff magnitudes not parsed — diff rows later.

  function findTargetProfileScope() {
    const cfg = Config.enemyProfile;
    const hpEl = document.querySelector(Config.selectors.targetHpText);
    if (!hpEl) {
      return null;
    }
    let el = hpEl;
    for (let d = 0; d < cfg.parentWalkMax && el; d += 1, el = el.parentElement) {
      const name = el.querySelector ? el.querySelector(cfg.nameText) : null;
      if (name && isElementVisible(name) && (name.textContent || "").trim()) {
        return el;
      }
    }
    return null;
  }

  function pickFallbackEnemyNameElement() {
    const cfg = Config.enemyProfile;
    const minX = window.innerWidth * cfg.fallbackMinXFraction;
    const nodes = Array.from(document.querySelectorAll(cfg.nameText));
    const vis = nodes.filter((n) => {
      if (!isElementVisible(n)) {
        return false;
      }
      const t = (n.textContent || "").trim();
      if (!t) {
        return false;
      }
      return n.getBoundingClientRect().left >= minX;
    });
    if (vis.length === 0) {
      return null;
    }
    vis.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    return vis[0];
  }

  function widenProfileScopeFromName(nameEl) {
    const cfg = Config.enemyProfile;
    let el = nameEl;
    for (let d = 0; d < 8 && el; d += 1, el = el.parentElement) {
      const lev = el.querySelector ? el.querySelector(cfg.level) : null;
      if (lev && isElementVisible(lev) && (lev.textContent || "").trim()) {
        return el;
      }
    }
    return nameEl.parentElement;
  }

  function readEnemyTargetStatusBars(scopeRoot) {
    const cfg = Config.enemyProfile;
    const out = [];
    if (!scopeRoot) {
      return out;
    }
    const bars = scopeRoot.querySelectorAll(cfg.statusBarRoot);
    for (let i = 0; i < bars.length; i += 1) {
      const barRoot = bars[i];
      const conds = barRoot.querySelectorAll(cfg.conditionBar);
      for (let j = 0; j < conds.length; j += 1) {
        const c = conds[j];
        const valNode = c.querySelector(cfg.conditionValue) || c.querySelector("span.value");
        const label = valNode ? (valNode.textContent || "").replace(/\s+/g, " ").trim() : "";
        const color = c.getAttribute("data-color") || "";
        const size = c.getAttribute("data-size") || "";
        const disabled = (c.className || "").indexOf("disabled") !== -1;
        if (!label && !color) {
          continue;
        }
        out.push({
          color: color,
          size: size,
          label: label,
          disabled: disabled
        });
      }
    }
    return out;
  }

  function makeEnemyDbKey(name, levelNum, maxHp) {
    const n = (name || "").trim().toLowerCase().replace(/\s+/g, " ");
    const lv = Number.isFinite(levelNum) ? String(levelNum) : "";
    const mx = Number.isFinite(maxHp) ? String(maxHp) : "";
    return `${n}|${lv}|${mx}`;
  }

  function trimEnemyDb() {
    const max = Config.enemyProfile.maxDbEntries;
    if (Runtime.enemy.db.length <= max) {
      return;
    }
    Runtime.enemy.db.sort((a, b) => (a.lastSeenAt || 0) - (b.lastSeenAt || 0));
    while (Runtime.enemy.db.length > max) {
      Runtime.enemy.db.shift();
    }
  }

  function readTargetProfileSnapshot() {
    const cfg = Config.enemyProfile;
    const state = readBasicState();
    const th = state.combat.targetHp;

    let scope = findTargetProfileScope();
    if (!scope) {
      const nameEl = pickFallbackEnemyNameElement();
      if (nameEl) {
        scope = widenProfileScopeFromName(nameEl);
      }
    }

    const nameEl = scope ? scope.querySelector(cfg.nameText) : null;
    const name = nameEl ? (nameEl.textContent || "").replace(/\s+/g, " ").trim() : "";

    const levEl = scope ? scope.querySelector(cfg.level) : document.querySelector(cfg.level);
    const levelRaw = levEl ? (levEl.textContent || "").trim() : "";
    const levelNum = Number.parseInt(levelRaw, 10);

    const statusEffects = scope ? readEnemyTargetStatusBars(scope) : [];

    const snapshot = {
      ok: !!(name && name.length > 0),
      time: Date.now(),
      name: name,
      levelRaw: levelRaw,
      level: Number.isFinite(levelNum) ? levelNum : null,
      targetHp: th && th.valid ? { cur: th.cur, max: th.max, pct: th.pct, valid: true } : { valid: false },
      statusEffects: statusEffects,
      enemyCount: state.combat.enemyCount,
      scopeFound: !!scope
    };
    if (!snapshot.ok) {
      snapshot.reason = "missing_name";
    }

    Runtime.enemy.lastSnapshot = snapshot;
    Runtime.enemy.capturedAt = Date.now();
    Runtime.enemy.lastError = null;
    if (snapshot.ok && snapshot.targetHp && snapshot.targetHp.valid) {
      Runtime.enemy.lastFoughtKey = makeEnemyDbKey(snapshot.name, snapshot.level, snapshot.targetHp.max);
    }
    return snapshot;
  }

  function saveEnemyDbToCache() {
    try {
      const payload = {
        version: 2,
        savedAt: Date.now(),
        entries: Runtime.enemy.db
      };
      window.localStorage.setItem(Config.enemyProfile.storageKey, JSON.stringify(payload));
      Logger.log("ENEMY", `Saved ${Runtime.enemy.db.length} entries`, { key: Config.enemyProfile.storageKey });
      return true;
    } catch (err) {
      Logger.warn("ENEMY", "Failed to save enemy DB", err);
      return false;
    }
  }

  function loadEnemyDbFromCache() {
    try {
      const raw = window.localStorage.getItem(Config.enemyProfile.storageKey);
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.entries)) {
        return false;
      }
      // AI CHANGED: Strip legacy damageClass (v1); empirical C2 observer supersedes icon typing.
      for (let i = 0; i < payload.entries.length; i += 1) {
        const row = payload.entries[i];
        if (row && typeof row === "object" && "damageClass" in row) {
          delete row.damageClass;
        }
      }
      Runtime.enemy.db = payload.entries;
      Runtime.enemy.dbLoadedAt = Date.now();
      return true;
    } catch (err) {
      Logger.warn("ENEMY", "Failed to load enemy DB cache", err);
      return false;
    }
  }

  function clearEnemyDbCache() {
    Runtime.enemy.db = [];
    Runtime.enemy.lastSnapshot = null;
    Runtime.enemy.capturedAt = null;
    Runtime.enemy.lastError = null;
    Runtime.enemy.lastFoughtKey = null;
    try {
      window.localStorage.removeItem(Config.enemyProfile.storageKey);
    } catch (err) {
      // AI CHANGED: Non-fatal.
    }
    Logger.log("ENEMY", "Enemy DB cleared");
  }

  function getEnemyDbMeta() {
    return {
      count: Runtime.enemy.db.length,
      dbLoadedAt: Runtime.enemy.dbLoadedAt,
      lastSnapshotAt: Runtime.enemy.capturedAt,
      lastFoughtKey: Runtime.enemy.lastFoughtKey,
      lastError: Runtime.enemy.lastError
    };
  }

  function recordTargetToEnemyDb(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const snap = readTargetProfileSnapshot();
    if (!snap.ok) {
      Runtime.enemy.lastError = snap.reason || "bad_snapshot";
      Logger.warn("ENEMY", "recordTargetToEnemyDb: need visible target name", snap);
      return null;
    }
    if (!snap.targetHp || !snap.targetHp.valid) {
      Runtime.enemy.lastError = "no_target_hp";
      Logger.warn("ENEMY", "recordTargetToEnemyDb: target HP invalid — select a target with red bar");
      return null;
    }

    const key = makeEnemyDbKey(snap.name, snap.level, snap.targetHp.max);
    const labels = snap.statusEffects.map((s) => s.label).filter(Boolean);
    const now = Date.now();

    const existingIdx = Runtime.enemy.db.findIndex((e) => e.key === key);
    const note = typeof opts.note === "string" ? opts.note : null;

    if (existingIdx >= 0) {
      const existing = Runtime.enemy.db[existingIdx];
      existing.lastSeenAt = now;
      existing.seenCount = (existing.seenCount || 1) + 1;
      existing.statusLabelsLast = labels;
      // AI CHANGED: Drop legacy field if present from older sessions.
      if ("damageClass" in existing) {
        delete existing.damageClass;
      }
      existing.level = snap.level != null ? snap.level : existing.level;
      existing.maxHp = snap.targetHp.max;
      if (note) {
        existing.note = note;
      }
      trimEnemyDb();
      saveEnemyDbToCache();
      Runtime.enemy.lastFoughtKey = key;
      Logger.log("ENEMY", "DB merge", { key: key, seenCount: existing.seenCount });
      return existing;
    }

    const row = {
      key: key,
      name: snap.name,
      level: snap.level,
      maxHp: snap.targetHp.max,
      statusLabelsLast: labels,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 1,
      note: note
    };
    Runtime.enemy.db.push(row);
    trimEnemyDb();
    saveEnemyDbToCache();
    Runtime.enemy.lastFoughtKey = key;
    Logger.log("ENEMY", "DB insert", { key: key, name: snap.name });
    return row;
  }

  // AI CHANGED: Phase C4 slice 2 — merge hp_drop stats from Runtime.damage.lastSession into enemy DB row.
  // AI CHANGED: v0.3.174 — miss_text merge removed; at least one hp_drop (after lethal filter) required.
  function mergeLastDamageObserveIntoEnemyDb(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const excludeLethal = opts.excludeLethal !== false;

    const session = Runtime.damage.lastSession;
    if (!session || !session.ok) {
      Runtime.enemy.lastError = "no_damage_session";
      Logger.warn("ENEMY", "mergeLastDamageObserveIntoEnemyDb: need a successful observeCombatDamage() first");
      return null;
    }

    let key = typeof opts.key === "string" && opts.key.trim() ? opts.key.trim() : null;
    let name;
    let level;
    let maxHp;

    if (!key && session.attribution && session.attribution.key) {
      key = session.attribution.key;
      name = session.attribution.name;
      level = session.attribution.level;
      maxHp = session.attribution.maxHp;
    }
    if (!key) {
      const snap = Runtime.enemy.lastSnapshot;
      if (snap && snap.ok && snap.targetHp && snap.targetHp.valid) {
        key = makeEnemyDbKey(snap.name, snap.level, snap.targetHp.max);
        name = snap.name;
        level = snap.level;
        maxHp = snap.targetHp.max;
      }
    }
    if (!key) {
      Runtime.enemy.lastError = "no_enemy_key";
      Logger.warn(
        "ENEMY",
        "mergeLastDamageObserveIntoEnemyDb: no key — start observe with target + profile visible, pass opts.key, or set lastSnapshot"
      );
      return null;
    }

    const hpDropsAll = session.events.filter((e) => e.kind === "hp_drop");
    const hpDrops = hpDropsAll.filter((e) => !excludeLethal || !e.lethal);

    if (hpDrops.length === 0) {
      Runtime.enemy.lastError = "no_hp_drops";
      Logger.warn(
        "ENEMY",
        "mergeLastDamageObserveIntoEnemyDb: no hp_drop events in session"
      );
      return null;
    }

    let row = Runtime.enemy.db.find((e) => e.key === key);
    if (!row) {
      const now = Date.now();
      row = {
        key: key,
        name: name || "",
        level: level != null ? level : null,
        maxHp: maxHp != null ? maxHp : null,
        statusLabelsLast: [],
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 0,
        note: null
      };
      Runtime.enemy.db.push(row);
    }

    if (hpDrops.length > 0) {
      const damages = hpDrops.map((e) => e.damage);
      const n = damages.length;
      const sum = damages.reduce((a, b) => a + b, 0);
      const mn = Math.min.apply(null, damages);
      const mx = Math.max.apply(null, damages);
      const mean = sum / n;

      if (!row.observeCalAgg) {
        row.observeCalAgg = {
          hpDropSamples: 0,
          hpDropSum: 0,
          hpDropMin: null,
          hpDropMax: null,
          sessionsMerged: 0,
          lastUpdatedAt: null
        };
      }
      const cal = row.observeCalAgg;
      cal.hpDropSamples += n;
      cal.hpDropSum += sum;
      cal.hpDropMin = cal.hpDropMin === null ? mn : Math.min(cal.hpDropMin, mn);
      cal.hpDropMax = cal.hpDropMax === null ? mx : Math.max(cal.hpDropMax, mx);
      cal.sessionsMerged += 1;
      cal.lastUpdatedAt = Date.now();
      cal.hpDropMean = cal.hpDropSum / cal.hpDropSamples;

      let paperHit = null;
      if (typeof estimatePaperBasicAttackDps === "function") {
        const est = estimatePaperBasicAttackDps();
        if (est && est.breakdown && Number.isFinite(est.breakdown.physicalAttack) && Number.isFinite(est.expectedHitMult)) {
          paperHit = est.breakdown.physicalAttack * est.expectedHitMult;
        }
      }

      row.observeCalLast = {
        mergedAt: Date.now(),
        sessionStartedAt: session.startedAt,
        hpDropCount: n,
        hpDropExcludedLethal: excludeLethal,
        hpDropMin: mn,
        hpDropMax: mx,
        hpDropMean: mean,
        lethalEventsInSession: hpDropsAll.filter((e) => e.lethal).length,
        totalHpDropEventsInSession: hpDropsAll.length,
        paperExpectedHitApprox: paperHit
      };
    }

    trimEnemyDb();
    saveEnemyDbToCache();
    Runtime.enemy.lastFoughtKey = key;
    Logger.log("ENEMY", "merged observe session into DB", {
      key: key,
      lastSessionMean: row.observeCalLast ? row.observeCalLast.hpDropMean : null,
      aggMean: row.observeCalAgg.hpDropMean,
      aggSamples: row.observeCalAgg.hpDropSamples
    });
    return row;
  }
