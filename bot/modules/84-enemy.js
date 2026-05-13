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

  // AI CHANGED: §6 buff modeling — stable fingerprint from condition-bar label strings (no numeric buff parse).
  function buildEnemyStatusLabelsSignatureFromLabels(labels) {
    const arr = Array.isArray(labels) ? labels : [];
    const bag = {};
    const uniq = [];
    for (let i = 0; i < arr.length; i += 1) {
      const t = String(arr[i] || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!t) {
        continue;
      }
      if (!bag[t]) {
        bag[t] = true;
        uniq.push(t);
      }
    }
    uniq.sort();
    let sig = uniq.join("|");
    const maxLen = 480;
    if (sig.length > maxLen) {
      sig = sig.slice(0, maxLen);
    }
    return sig;
  }

  function enemyBuffSigBucketKey(signature) {
    const s = typeof signature === "string" ? signature : "";
    return s.length ? s : "__clean__";
  }

  function pruneEnemyBuffSigBuckets(buckets, maxKeys) {
    if (!buckets || typeof buckets !== "object") {
      return;
    }
    const keys = Object.keys(buckets);
    if (keys.length <= maxKeys) {
      return;
    }
    keys.sort(function (a, b) {
      const ta = buckets[a] && buckets[a].lastMergedAt ? buckets[a].lastMergedAt : 0;
      const tb = buckets[b] && buckets[b].lastMergedAt ? buckets[b].lastMergedAt : 0;
      return ta - tb;
    });
    while (keys.length > maxKeys) {
      const drop = keys.shift();
      if (drop) {
        delete buckets[drop];
      }
    }
  }

  // AI CHANGED: Prefer live snapshot (same key) over stale row labels for merge-time buff pairing.
  function collectStatusLabelsForEnemyDbMerge(row, key) {
    let labels = [];
    let source = "none";

    const snap = Runtime.enemy.lastSnapshot;
    if (snap && snap.ok && snap.targetHp && snap.targetHp.valid) {
      const sk = makeEnemyDbKey(snap.name, snap.level, snap.targetHp.max);
      if (sk === key && Array.isArray(snap.statusEffects)) {
        const fromSnap = [];
        for (let i = 0; i < snap.statusEffects.length; i += 1) {
          const se = snap.statusEffects[i];
          const lb = se && se.label ? String(se.label) : "";
          const t = lb.replace(/\s+/g, " ").trim();
          if (t) {
            fromSnap.push(t);
          }
        }
        if (fromSnap.length > 0) {
          labels = fromSnap;
          source = "snapshot_matched";
        } else {
          source = "snapshot_matched_empty";
        }
      }
    }

    if (labels.length === 0) {
      const fresh = readTargetProfileSnapshot();
      if (fresh && fresh.ok && fresh.targetHp && fresh.targetHp.valid) {
        const fk = makeEnemyDbKey(fresh.name, fresh.level, fresh.targetHp.max);
        if (fk === key && Array.isArray(fresh.statusEffects)) {
          const fromFresh = [];
          for (let j = 0; j < fresh.statusEffects.length; j += 1) {
            const se2 = fresh.statusEffects[j];
            const lb2 = se2 && se2.label ? String(se2.label) : "";
            const t2 = lb2.replace(/\s+/g, " ").trim();
            if (t2) {
              fromFresh.push(t2);
            }
          }
          if (fromFresh.length > 0) {
            labels = fromFresh;
            source = "fresh_read_matched";
          }
        }
      }
    }

    if (labels.length === 0 && Array.isArray(row.statusLabelsLast) && row.statusLabelsLast.length > 0) {
      const fromRow = [];
      for (let k = 0; k < row.statusLabelsLast.length; k += 1) {
        const t3 = String(row.statusLabelsLast[k] || "")
          .replace(/\s+/g, " ")
          .trim();
        if (t3) {
          fromRow.push(t3);
        }
      }
      if (fromRow.length > 0) {
        labels = fromRow;
        source = "row_last";
      }
    }

    if (labels.length === 0) {
      source = "none";
    }
    return { labels: labels, source: source };
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

      // AI CHANGED: §6 — label snapshot + per-signature hp_drop buckets for buffed vs clean pairing.
      const collected = collectStatusLabelsForEnemyDbMerge(row, key);
      const statusLabelsSignature = buildEnemyStatusLabelsSignatureFromLabels(collected.labels);
      if (collected.labels.length > 0) {
        row.statusLabelsLast = collected.labels;
      }

      if (!cal.buffSigBuckets) {
        cal.buffSigBuckets = {};
      }
      const bucketKey = enemyBuffSigBucketKey(statusLabelsSignature);
      const buckets = cal.buffSigBuckets;
      if (!buckets[bucketKey]) {
        buckets[bucketKey] = {
          signature: statusLabelsSignature,
          hpDropSamples: 0,
          hpDropSum: 0,
          hpDropMin: null,
          hpDropMax: null,
          sessionsMerged: 0,
          lastMergedAt: null,
          lastSessionMean: null,
          hpDropMean: null
        };
      }
      const bk = buckets[bucketKey];
      bk.hpDropSamples += n;
      bk.hpDropSum += sum;
      bk.hpDropMin = bk.hpDropMin === null ? mn : Math.min(bk.hpDropMin, mn);
      bk.hpDropMax = bk.hpDropMax === null ? mx : Math.max(bk.hpDropMax, mx);
      bk.sessionsMerged += 1;
      bk.lastMergedAt = Date.now();
      bk.lastSessionMean = mean;
      bk.hpDropMean = bk.hpDropSum / bk.hpDropSamples;
      bk.signature = statusLabelsSignature;
      pruneEnemyBuffSigBuckets(buckets, 20);

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
        paperExpectedHitApprox: paperHit,
        statusLabelsSignature: statusLabelsSignature,
        statusLabelsMergeSource: collected.source,
        statusLabelCount: collected.labels.length,
        statusLabelsSample: collected.labels.slice(0, 8).map(function (lb) {
          const t = String(lb || "").replace(/\s+/g, " ").trim();
          return t.length > 48 ? t.slice(0, 48) + "..." : t;
        })
      };
    }

    trimEnemyDb();
    saveEnemyDbToCache();
    Runtime.enemy.lastFoughtKey = key;
    Logger.log("ENEMY", "merged observe session into DB", {
      key: key,
      lastSessionMean: row.observeCalLast ? row.observeCalLast.hpDropMean : null,
      aggMean: row.observeCalAgg.hpDropMean,
      aggSamples: row.observeCalAgg.hpDropSamples,
      buffSig: row.observeCalLast ? row.observeCalLast.statusLabelsSignature : null,
      buffSource: row.observeCalLast ? row.observeCalLast.statusLabelsMergeSource : null,
      buffBuckets:
        row.observeCalAgg && row.observeCalAgg.buffSigBuckets
          ? Object.keys(row.observeCalAgg.buffSigBuckets).length
          : 0
    });
    return row;
  }

  // AI CHANGED: §6 buff research — console helper to compare per-signature hp_drop buckets for one mob key (pair fights).
  function formatEnemyBuffSignaturePreviewForResearch(sig) {
    const s = sig == null ? "" : String(sig);
    if (!s.length) {
      return "(clean)";
    }
    return s.length > 120 ? s.slice(0, 120) + "..." : s;
  }

  function summarizeEnemyBuffSigBuckets(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    let key = typeof opts.key === "string" && opts.key.trim() ? opts.key.trim() : null;
    if (!key && Runtime.enemy && typeof Runtime.enemy.lastFoughtKey === "string" && Runtime.enemy.lastFoughtKey.trim()) {
      key = Runtime.enemy.lastFoughtKey.trim();
    }
    if (!key) {
      return {
        ok: false,
        reason: "no_key",
        hint: "Pass { key: ligmarBot.makeEnemyDbKey(name, level, maxHp) } or fight a mob so Runtime.enemy.lastFoughtKey is set.",
        buckets: []
      };
    }
    const row =
      Runtime.enemy.db && Array.isArray(Runtime.enemy.db)
        ? Runtime.enemy.db.find(function (r) {
            return r && r.key === key;
          })
        : null;
    if (!row) {
      return {
        ok: false,
        key: key,
        reason: "no_row",
        hint: "No enemy DB row for this key — recordTargetToEnemyDb / merge after observe.",
        buckets: []
      };
    }
    const cal = row.observeCalAgg;
    const bucketsRaw = cal && cal.buffSigBuckets && typeof cal.buffSigBuckets === "object" ? cal.buffSigBuckets : null;
    const list = [];
    if (bucketsRaw) {
      const bk = Object.keys(bucketsRaw);
      for (let i = 0; i < bk.length; i += 1) {
        const k = bk[i];
        const b = bucketsRaw[k];
        const sigFull = b && b.signature != null ? String(b.signature) : "";
        list.push({
          bucketKey: k,
          signaturePreview: formatEnemyBuffSignaturePreviewForResearch(sigFull),
          signatureLen: sigFull.length,
          hpDropMean: b && Number.isFinite(b.hpDropMean) ? b.hpDropMean : null,
          hpDropSamples: b && Number.isFinite(b.hpDropSamples) ? b.hpDropSamples : null,
          sessionsMerged: b && Number.isFinite(b.sessionsMerged) ? b.sessionsMerged : null,
          hpDropMin: b && Number.isFinite(b.hpDropMin) ? b.hpDropMin : null,
          hpDropMax: b && Number.isFinite(b.hpDropMax) ? b.hpDropMax : null,
          lastMergedAt: b && b.lastMergedAt ? b.lastMergedAt : null
        });
      }
      list.sort(function (a, b) {
        const sa = a.hpDropSamples || 0;
        const sb = b.hpDropSamples || 0;
        if (sb !== sa) {
          return sb - sa;
        }
        return (b.lastMergedAt || 0) - (a.lastMergedAt || 0);
      });
    }
    const last = row.observeCalLast || null;
    return {
      ok: true,
      key: key,
      name: row.name,
      level: row.level,
      maxHp: row.maxHp,
      aggHpDropMean: cal && Number.isFinite(cal.hpDropMean) ? cal.hpDropMean : null,
      aggHpDropSamples: cal && Number.isFinite(cal.hpDropSamples) ? cal.hpDropSamples : null,
      observeCalLast: last
        ? {
            mergedAt: last.mergedAt,
            statusLabelsSignature: last.statusLabelsSignature,
            statusLabelsMergeSource: last.statusLabelsMergeSource,
            statusLabelCount: last.statusLabelCount,
            hpDropMean: last.hpDropMean
          }
        : null,
      statusLabelsLast: row.statusLabelsLast || [],
      buckets: list,
      bucketCount: list.length,
      note:
        "Compare hpDropMean across signaturePreview rows for the same key (unbuffed vs buffed fights). Planner does not consume this automatically yet."
    };
  }
