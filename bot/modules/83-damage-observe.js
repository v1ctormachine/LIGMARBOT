  // AI CHANGED: Phase C2 -- damage observer: target HP deltas (primary) + newly appeared short numeric
  // leaf text under app-game (secondary, for floating combat numbers). Console-first; tolerates missed
  // frames via poll cadence + suspicious-jump filtering.

  function dmgIsNodeUnderExcludedSubtree(node, selectors) {
    if (!node || typeof node.closest !== "function") {
      return false;
    }
    for (let i = 0; i < selectors.length; i += 1) {
      try {
        if (node.closest(selectors[i])) {
          return true;
        }
      } catch (err) {
        // AI CHANGED: Bad selector in config — skip instead of throwing during observe.
      }
    }
    return false;
  }

  // AI CHANGED: Leaf text matches configured miss substrings (lowercase ASCII / Unicode).
  function dmgLeafTextMatchesMissSubstrings(text, substrings) {
    if (typeof text !== "string" || !substrings || !Array.isArray(substrings)) {
      return false;
    }
    const norm = text.replace(/\u00a0/g, " ").trim().toLowerCase();
    if (!norm) {
      return false;
    }
    for (let i = 0; i < substrings.length; i += 1) {
      const s = substrings[i];
      if (typeof s !== "string" || !s.trim()) {
        continue;
      }
      if (norm.indexOf(s.trim().toLowerCase()) !== -1) {
        return true;
      }
    }
    return false;
  }

  // AI CHANGED: Classify canvas-drawn combat labels — prefer miss_text when both miss and dodge lists match the same string.
  function dmgClassifyCanvasCombatTextKind(text, missSubs, dodgeSubs) {
    if (typeof text !== "string") {
      return null;
    }
    const raw = text.replace(/\u00a0/g, " ").trim();
    if (!raw) {
      return null;
    }
    if (dmgLeafTextMatchesMissSubstrings(raw, missSubs)) {
      return "miss_text";
    }
    if (dodgeSubs && dodgeSubs.length > 0 && dmgLeafTextMatchesMissSubstrings(raw, dodgeSubs)) {
      return "dodge_text";
    }
    return null;
  }

  // AI CHANGED: Canvas hook state — observeCombatDamage attaches { events, active }; dedupe map is bounded by pruning.
  var dmgCanvasTextCapture = null;
  var dmgCanvasTextDedupeAt = {};

  function dmgCanvasPruneDedupeMap(nowMs, dedupeMs, store) {
    const keys = Object.keys(store);
    if (keys.length < 56) {
      return;
    }
    const cutoff = nowMs - dedupeMs * 6;
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      const t = store[k];
      if (typeof t === "number" && t < cutoff) {
        delete store[k];
      }
    }
  }

  function dmgCanvasShouldIgnoreCanvas(canvas, cfg) {
    if (!canvas || typeof canvas.closest !== "function") {
      return true;
    }
    const rootSel =
      cfg && typeof cfg.scanRootSelector === "string" && cfg.scanRootSelector.trim()
        ? cfg.scanRootSelector.trim()
        : "app-game";
    if (!canvas.closest(rootSel)) {
      return true;
    }
    const ex =
      cfg && Array.isArray(cfg.canvas2dExcludeCanvasClosestSelectors)
        ? cfg.canvas2dExcludeCanvasClosestSelectors
        : [];
    for (let i = 0; i < ex.length; i += 1) {
      const sel = ex[i];
      if (typeof sel !== "string" || !sel.trim()) {
        continue;
      }
      try {
        if (canvas.closest(sel.trim())) {
          return true;
        }
      } catch (err) {
        // AI CHANGED: Bad exclude selector — skip entry.
      }
    }
    return false;
  }

  function dmgCanvasPlausibleViewport(canvas, requireVp) {
    if (!requireVp) {
      return true;
    }
    try {
      const r = canvas.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) {
        return false;
      }
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
        return false;
      }
    } catch (err) {
      return true;
    }
    return true;
  }

  function dmgHandleCanvasDrawText(ctx, methodName, text) {
    const cap = dmgCanvasTextCapture;
    if (!cap || !cap.active || !cap.events) {
      return;
    }
    const cfg = Config.damageObserver;
    if (!cfg || cfg.hookCanvas2dCombatText === false) {
      return;
    }
    const canvas = ctx && ctx.canvas ? ctx.canvas : null;
    if (dmgCanvasShouldIgnoreCanvas(canvas, cfg)) {
      return;
    }
    const requireVp = cfg.canvasCombatTextRequireInViewport !== false;
    if (!dmgCanvasPlausibleViewport(canvas, requireVp)) {
      return;
    }
    if (typeof text !== "string") {
      return;
    }
    const raw = text.replace(/\u00a0/g, " ").trim();
    const maxLen =
      Number.isFinite(cfg.canvasCombatTextMaxDrawLength) && cfg.canvasCombatTextMaxDrawLength > 0
        ? Math.round(cfg.canvasCombatTextMaxDrawLength)
        : 48;
    if (raw.length < 2 || raw.length > maxLen) {
      return;
    }
    const missSubs =
      cfg && Array.isArray(cfg.missTextSubstrings) && cfg.missTextSubstrings.length > 0
        ? cfg.missTextSubstrings
        : ["miss"];
    const dodgeSubs =
      cfg && Array.isArray(cfg.dodgeTextSubstrings) && cfg.dodgeTextSubstrings.length > 0
        ? cfg.dodgeTextSubstrings
        : [];
    const kind = dmgClassifyCanvasCombatTextKind(raw, missSubs, dodgeSubs);
    if (!kind) {
      return;
    }
    const dedupeMs =
      Number.isFinite(cfg.canvasCombatTextDedupeMs) && cfg.canvasCombatTextDedupeMs > 0
        ? cfg.canvasCombatTextDedupeMs
        : 420;
    const now = Date.now();
    const norm = raw.toLowerCase();
    const dedupeKey = kind + "|" + norm;
    const prev = dmgCanvasTextDedupeAt[dedupeKey];
    if (typeof prev === "number" && now - prev < dedupeMs) {
      return;
    }
    dmgCanvasTextDedupeAt[dedupeKey] = now;
    dmgCanvasPruneDedupeMap(now, dedupeMs, dmgCanvasTextDedupeAt);
    cap.events.push({
      ts: now,
      kind: kind,
      text: raw,
      source: "canvas2d",
      method: typeof methodName === "string" ? methodName : "draw"
    });
    Logger.log("DMG", "canvas combat text", { kind: kind, text: raw, method: methodName });
  }

  // AI CHANGED: One-time prototype hook — observes attach via dmgCanvasTextCapture while includeMissTexts runs.
  function ensureCanvas2dCombatTextHook() {
    if (Runtime.damage.canvas2dCombatTextHookInstalled) {
      return;
    }
    const proto = typeof CanvasRenderingContext2D !== "undefined" ? CanvasRenderingContext2D.prototype : null;
    if (!proto || typeof proto.fillText !== "function") {
      return;
    }
    const origFill = proto.fillText;
    const origStroke = typeof proto.strokeText === "function" ? proto.strokeText : null;
    proto.fillText = function dmgFillTextWrap(text, x, y, maxWidth) {
      try {
        dmgHandleCanvasDrawText(this, "fillText", text);
      } catch (err) {
        // AI CHANGED: Never break game paint — swallow hook errors.
      }
      return origFill.apply(this, arguments);
    };
    if (origStroke) {
      proto.strokeText = function dmgStrokeTextWrap(text, x, y, maxWidth) {
        try {
          dmgHandleCanvasDrawText(this, "strokeText", text);
        } catch (err) {
          // AI CHANGED: Never break game paint — swallow hook errors.
        }
        return origStroke.apply(this, arguments);
      };
    }
    Runtime.damage.canvas2dCombatTextHookInstalled = true;
  }

  function dmgParseShortNumericText(text) {
    if (typeof text !== "string") {
      return null;
    }
    const t = text.replace(/\u00a0/g, " ").trim();
    const m = t.match(/^[+-]?[\d,]+$/);
    if (!m) {
      return null;
    }
    const n = Number.parseInt(t.replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function scanFloatingDamageNodes() {
    const cfg = Config.damageObserver;
    const root = document.querySelector(cfg.scanRootSelector) || document.body;
    const exclude = cfg.excludeClosestSelectors;
    const hits = [];
    const maxNodes = 900;
    const nodes = root.querySelectorAll("span, div, p, b, strong, i, em, label");
    let scanned = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      if (hits.length >= 140) {
        break;
      }
      const node = nodes[i];
      if (!node || node.children.length > 0) {
        continue;
      }
      scanned += 1;
      if (scanned > maxNodes) {
        break;
      }
      if (dmgIsNodeUnderExcludedSubtree(node, exclude)) {
        continue;
      }
      const raw = (node.textContent || "").trim();
      if (raw.length < 1 || raw.length > 16) {
        continue;
      }
      const value = dmgParseShortNumericText(raw);
      if (value === null || value === 0) {
        continue;
      }
      if (value > 9999999) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        continue;
      }
      const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${raw}`;
      hits.push({
        key: key,
        text: raw,
        value: value,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        cssPath: getCssPath(node)
      });
    }
    return hits;
  }

  // AI CHANGED: Scan same overlay band as floating damage for short leaf labels like "Miss" / locale variants.
  function scanFloatingMissNodes() {
    const cfg = Config.damageObserver;
    const root = document.querySelector(cfg.scanRootSelector) || document.body;
    const exclude = cfg.excludeClosestSelectors;
    const subs =
      cfg && Array.isArray(cfg.missTextSubstrings) && cfg.missTextSubstrings.length > 0
        ? cfg.missTextSubstrings
        : ["miss"];
    const maxLeaf =
      Number.isFinite(cfg && cfg.missScanMaxLeafLength) && cfg.missScanMaxLeafLength > 0
        ? Math.round(cfg.missScanMaxLeafLength)
        : 28;
    const hits = [];
    const maxNodes = 900;
    const nodes = root.querySelectorAll("span, div, p, b, strong, i, em, label");
    let scanned = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      if (hits.length >= 80) {
        break;
      }
      const node = nodes[i];
      if (!node || node.children.length > 0) {
        continue;
      }
      scanned += 1;
      if (scanned > maxNodes) {
        break;
      }
      if (dmgIsNodeUnderExcludedSubtree(node, exclude)) {
        continue;
      }
      const raw = (node.textContent || "").trim();
      if (raw.length < 2 || raw.length > maxLeaf) {
        continue;
      }
      if (dmgParseShortNumericText(raw) !== null) {
        continue;
      }
      if (!dmgLeafTextMatchesMissSubstrings(raw, subs)) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        continue;
      }
      const key = `m:${Math.round(rect.left)}:${Math.round(rect.top)}:${raw}`;
      hits.push({
        key: key,
        text: raw,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        cssPath: getCssPath(node)
      });
    }
    return hits;
  }

  function dmgSummarizeSession(samples, events) {
    let hpDropSum = 0;
    let hpDropCount = 0;
    let hpRiseCount = 0;
    let floatCount = 0;
    let missCount = 0;
    let dodgeCount = 0;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.kind === "hp_drop") {
        hpDropSum += e.damage;
        hpDropCount += 1;
      } else if (e.kind === "hp_rise") {
        hpRiseCount += 1;
      } else if (e.kind === "float_text") {
        floatCount += 1;
      } else if (e.kind === "miss_text") {
        missCount += 1;
      } else if (e.kind === "dodge_text") {
        dodgeCount += 1;
      }
    }
    const validTargetSamples = samples.filter((s) => s.targetValid).length;
    return {
      hpDropEventCount: hpDropCount,
      hpDropTotal: hpDropSum,
      avgHpDrop: hpDropCount > 0 ? hpDropSum / hpDropCount : null,
      hpRiseEventCount: hpRiseCount,
      floatTextEventCount: floatCount,
      missTextEventCount: missCount,
      dodgeTextEventCount: dodgeCount,
      sampleCount: samples.length,
      eventCount: events.length,
      validTargetSamples: validTargetSamples
    };
  }

  function saveDamageSessionSummary(session) {
    const cfg = Config.damageObserver;
    try {
      const payload = {
        version: 4,
        savedAt: Date.now(),
        summary: session.summary,
        storedEventCount: session.events ? session.events.length : 0,
        durationMs: session.durationMs,
        optionsUsed: session.optionsUsed,
        attribution: session.attribution || null,
        enemyDbMerge:
          session.enemyDbMerge && typeof session.enemyDbMerge === "object"
            ? {
                ok: session.enemyDbMerge.ok,
                key: session.enemyDbMerge.key || null,
                error: session.enemyDbMerge.error || null
              }
            : null
      };
      window.localStorage.setItem(cfg.storageKey, JSON.stringify(payload));
    } catch (err) {
      Logger.warn("DMG", "Failed to persist damage session summary", err);
    }
  }

  function loadDamageObserveSummaryFromStorage() {
    const cfg = Config.damageObserver;
    try {
      const raw = window.localStorage.getItem(cfg.storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clearDamageObserveStorage() {
    try {
      window.localStorage.removeItem(Config.damageObserver.storageKey);
    } catch (err) {
      // AI CHANGED: Non-fatal clear failure.
    }
  }

  function snapFloatingDamageOnce() {
    const floats = scanFloatingDamageNodes();
    Logger.log("DMG", "snapFloatingDamageOnce", { count: floats.length, floats: floats });
    return floats;
  }

  // AI CHANGED: Console/debug — list visible floating miss labels matching Config.damageObserver.missTextSubstrings.
  function snapFloatingMissOnce() {
    const misses = scanFloatingMissNodes();
    Logger.log("DMG", "snapFloatingMissOnce", {
      count: misses.length,
      misses: misses,
      patterns: Config.damageObserver && Config.damageObserver.missTextSubstrings
        ? Config.damageObserver.missTextSubstrings
        : null
    });
    return misses;
  }

  function getDamageObserveMeta() {
    return {
      lastError: Runtime.damage.lastError,
      observedAt: Runtime.damage.observedAt,
      hasSession: !!Runtime.damage.lastSession,
      cachedSummary: loadDamageObserveSummaryFromStorage(),
      canvas2dCombatTextHookInstalled: !!Runtime.damage.canvas2dCombatTextHookInstalled
    };
  }

  async function observeCombatDamage(userOptions) {
    const cfg = Config.damageObserver;
    const opts = userOptions && typeof userOptions === "object" ? userOptions : {};
    const totalMs = Number.isFinite(opts.totalMs) ? opts.totalMs : cfg.defaultTotalMs;
    const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : cfg.defaultPollMs;
    const includeFloatingTexts = opts.includeFloatingTexts !== false;
    const cfgMissDefault =
      Config.damageObserver && Config.damageObserver.includeMissTextsDefault !== false;
    const includeMissTexts =
      opts.includeMissTexts !== undefined
        ? opts.includeMissTexts !== false
        : cfgMissDefault !== false;
    const saveSummary = opts.saveSummary !== false;
    const mergeToEnemyDb = opts.mergeToEnemyDb === true;
    const mergeOpts =
      opts.mergeOpts && typeof opts.mergeOpts === "object"
        ? opts.mergeOpts
        : opts.merge && typeof opts.merge === "object"
          ? opts.merge
          : {};

    Runtime.damage.lastError = null;
    setBotStatus("scanning", "damage observe");

    const started = Date.now();
    const samples = [];
    const events = [];
    let suspiciousJumps = 0;
    let prevTarget = null;
    let prevFloatKeySet = null;
    let prevMissKeySet = null;

    const maxSamples = Math.min(
      Number.isFinite(opts.maxSamples) ? opts.maxSamples : cfg.maxSamplesCap,
      cfg.maxSamplesCap
    );
    const jumpRatio = Number.isFinite(opts.suspiciousHpJumpRatio) ? opts.suspiciousHpJumpRatio : cfg.suspiciousHpJumpRatio;

    let sessionAttribution = null;
    let dmgObserveCanvasCap = null;
    try {
      // AI CHANGED: Phase C4 slice 2 — freeze target identity at observe start for merge into enemy DB.
      const startSnap = readTargetProfileSnapshot();
      if (startSnap && startSnap.ok && startSnap.targetHp && startSnap.targetHp.valid) {
        sessionAttribution = {
          key: makeEnemyDbKey(startSnap.name, startSnap.level, startSnap.targetHp.max),
          name: startSnap.name,
          level: startSnap.level,
          maxHp: startSnap.targetHp.max
        };
      }

      // AI CHANGED: Canvas fillText/strokeText hook — captures Miss/Dodge particles drawn on 2D contexts under app-game.
      if (includeMissTexts && cfg.hookCanvas2dCombatText !== false) {
        ensureCanvas2dCombatTextHook();
        dmgObserveCanvasCap = { events: events, active: true };
        dmgCanvasTextCapture = dmgObserveCanvasCap;
      }

      // AI CHANGED: Poll until duration or sample cap; HP deltas need consecutive valid target HP reads.
      while (Date.now() - started < totalMs && samples.length < maxSamples) {
        const state = readBasicState();
        const th = state.combat.targetHp;
        const now = Date.now();
        const floats = includeFloatingTexts ? scanFloatingDamageNodes() : [];
        const misses = includeMissTexts ? scanFloatingMissNodes() : [];

        const sample = {
          t: now,
          enemyCount: state.combat.enemyCount,
          targetValid: !!(th && th.valid),
          targetCur: th && th.valid ? th.cur : null,
          targetMax: th && th.valid ? th.max : null,
          floatScanCount: floats.length,
          missScanCount: misses.length
        };
        samples.push(sample);

        // AI CHANGED: Late attribution — observe may start before target panel is ready (e.g. right after TEST soak stop); merge needs a key when hp_drop events exist.
        if (!sessionAttribution && th && th.valid) {
          try {
            const snap = readTargetProfileSnapshot();
            if (snap && snap.ok && snap.targetHp && snap.targetHp.valid) {
              sessionAttribution = {
                key: makeEnemyDbKey(snap.name, snap.level, snap.targetHp.max),
                name: snap.name,
                level: snap.level,
                maxHp: snap.targetHp.max
              };
            }
          } catch (attErr) {
            Logger.warn("DMG", "attribution snapshot during observe failed", attErr);
          }
        }

        if (th && th.valid && prevTarget && prevTarget.valid) {
          const maxRef = Math.max(prevTarget.max, th.max, 1);
          // AI CHANGED: Coerce cur so string "0" / odd DOM types still match lethal and delta math.
          const curN = Number(th.cur);
          const prevN = Number(prevTarget.cur);
          const delta =
            Number.isFinite(curN) && Number.isFinite(prevN) ? curN - prevN : NaN;
          const absDelta = Math.abs(delta);

          if (th.max !== prevTarget.max) {
            suspiciousJumps += 1;
            Logger.log("DMG", "target max changed — skip delta", { prevMax: prevTarget.max, nextMax: th.max });
          } else if (Number.isFinite(prevN) && prevN > 0 && Number.isFinite(curN) && curN <= 0) {
            // AI CHANGED: Kill (cur hits 0 with same max) looks like a huge |ΔHP| vs jumpRatio — must count as damage.
            const damage = Math.round(prevN);
            events.push({
              ts: now,
              kind: "hp_drop",
              damage: damage,
              targetCurAfter: curN,
              targetMax: th.max,
              enemyCount: state.combat.enemyCount,
              lethal: true
            });
            Logger.log("DMG", "hp delta (lethal)", { damage: damage, cur: curN, max: th.max });
          } else if (!Number.isFinite(delta)) {
            suspiciousJumps += 1;
            Logger.log("DMG", "non-finite HP delta — skip", { prevCur: prevN, nextCur: curN });
          } else if (absDelta > maxRef * jumpRatio) {
            suspiciousJumps += 1;
            Logger.log("DMG", "suspicious HP jump — skip delta", {
              prevCur: prevN,
              nextCur: curN,
              maxRef: maxRef
            });
          } else if (delta < 0) {
            const damage = -delta;
            events.push({
              ts: now,
              kind: "hp_drop",
              damage: damage,
              targetCurAfter: curN,
              targetMax: th.max,
              enemyCount: state.combat.enemyCount
            });
            Logger.log("DMG", "hp delta", { damage: damage, cur: curN, max: th.max });
          } else if (delta > 0) {
            events.push({
              ts: now,
              kind: "hp_rise",
              amount: delta,
              targetCurAfter: curN,
              targetMax: th.max
            });
            Logger.log("DMG", "target HP rose", { amount: delta, cur: curN, max: th.max });
          }
        }

        if (includeFloatingTexts) {
          const keySet = new Set();
          for (let fi = 0; fi < floats.length; fi += 1) {
            keySet.add(floats[fi].key);
          }
          if (prevFloatKeySet === null) {
            // AI CHANGED: Warmup tick — populate baseline so static HUD numbers don't flood events.
            prevFloatKeySet = keySet;
          } else {
            for (let fj = 0; fj < floats.length; fj += 1) {
              const f = floats[fj];
              if (prevFloatKeySet.has(f.key)) {
                continue;
              }
              events.push({
                ts: now,
                kind: "float_text",
                value: f.value,
                text: f.text,
                x: f.x,
                y: f.y,
                cssPath: f.cssPath
              });
              Logger.log("DMG", "float text (new)", { value: f.value, text: f.text, x: f.x, y: f.y });
            }
            prevFloatKeySet = keySet;
          }
        }

        if (includeMissTexts) {
          const mset = new Set();
          for (let mi = 0; mi < misses.length; mi += 1) {
            mset.add(misses[mi].key);
          }
          if (prevMissKeySet === null) {
            prevMissKeySet = mset;
          } else {
            for (let mj = 0; mj < misses.length; mj += 1) {
              const mm = misses[mj];
              if (prevMissKeySet.has(mm.key)) {
                continue;
              }
              events.push({
                ts: now,
                kind: "miss_text",
                text: mm.text,
                x: mm.x,
                y: mm.y,
                cssPath: mm.cssPath
              });
              Logger.log("DMG", "miss text (new)", { text: mm.text, x: mm.x, y: mm.y });
            }
            prevMissKeySet = mset;
          }
        }

        prevTarget = th && th.valid ? { cur: th.cur, max: th.max, valid: true } : { valid: false };

        await sleep(pollMs);
      }

      const durationMs = Date.now() - started;
      const summary = dmgSummarizeSession(samples, events);

      const session = {
        ok: true,
        startedAt: started,
        durationMs: durationMs,
        totalMs: totalMs,
        pollMs: pollMs,
        samples: samples,
        events: events,
        summary: summary,
        suspiciousJumps: suspiciousJumps,
        optionsUsed: {
          includeFloatingTexts: includeFloatingTexts,
          includeMissTexts: includeMissTexts,
          hookCanvas2dCombatText: includeMissTexts && cfg.hookCanvas2dCombatText !== false,
          saveSummary: saveSummary,
          mergeToEnemyDb: mergeToEnemyDb
        },
        attribution: sessionAttribution,
        enemyDbMerge: null
      };

      Runtime.damage.lastSession = session;
      Runtime.damage.observedAt = Date.now();

      if (
        mergeToEnemyDb &&
        (summary.hpDropEventCount > 0 || summary.missTextEventCount > 0)
      ) {
        const mergedRow = mergeLastDamageObserveIntoEnemyDb(mergeOpts);
        session.enemyDbMerge = mergedRow
          ? { ok: true, key: mergedRow.key, row: mergedRow }
          : { ok: false, error: Runtime.enemy.lastError || "merge_failed" };
        Logger.log("DMG", "enemy DB merge after observe", session.enemyDbMerge);
      } else if (mergeToEnemyDb) {
        session.enemyDbMerge = {
          ok: false,
          error: "skipped_no_hp_drops_or_miss_text",
          hint: "mergeToEnemyDb requested but session had no hp_drop or miss_text events"
        };
      }

      if (saveSummary) {
        saveDamageSessionSummary(session);
      }

      if (sessionAttribution && sessionAttribution.key) {
        Runtime.enemy.lastFoughtKey = sessionAttribution.key;
      }

      Logger.log("DMG", "observe done", summary);
      setBotStatus("idle", "damage observe OK");

      return session;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      Runtime.damage.lastError = msg;
      const failSession = {
        ok: false,
        error: msg,
        startedAt: started,
        samples: samples,
        events: events,
        durationMs: Date.now() - started,
        attribution: sessionAttribution
      };
      Runtime.damage.lastSession = failSession;
      Logger.error("DMG", "observeCombatDamage failed", err);
      setBotStatus("idle", "damage observe failed");
      return failSession;
    } finally {
      if (dmgObserveCanvasCap) {
        dmgObserveCanvasCap.active = false;
      }
      if (dmgCanvasTextCapture === dmgObserveCanvasCap) {
        dmgCanvasTextCapture = null;
      }
    }
  }
