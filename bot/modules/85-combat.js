  // AI CHANGED: Ranked opener runtime telemetry — keep lightweight counters + recent ring buffer for soak diagnostics.
  function plannerRecordOpenerRuntimeEvent(kind, detail) {
    const pr = Runtime && Runtime.planner ? Runtime.planner : null;
    if (!pr || !pr.openerRuntime) {
      return;
    }
    const rt = pr.openerRuntime;
    if (!rt.events || typeof rt.events !== "object") {
      rt.events = {};
    }
    rt.events[kind] = (rt.events[kind] || 0) + 1;
    rt.lastEvent = kind;
    rt.lastAt = Date.now();
    if (!Array.isArray(rt.recent)) {
      rt.recent = [];
    }
    rt.recent.push({
      at: rt.lastAt,
      event: kind,
      detail: detail || null
    });
    const keep = 30;
    if (rt.recent.length > keep) {
      rt.recent.splice(0, rt.recent.length - keep);
    }
  }

  // AI CHANGED: AUTO ON chat spammer — keep randomized due time and last-send telemetry in runtime state.
  function getAutoChatSpammerRuntime() {
    if (!Runtime.autoFarm.chatSpammer || typeof Runtime.autoFarm.chatSpammer !== "object") {
      Runtime.autoFarm.chatSpammer = {};
    }
    const rt = Runtime.autoFarm.chatSpammer;
    if (!Object.prototype.hasOwnProperty.call(rt, "nextSendAt")) {
      rt.nextSendAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastDelayMs")) {
      rt.lastDelayMs = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastAttemptAt")) {
      rt.lastAttemptAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastSendAt")) {
      rt.lastSendAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastMessage")) {
      rt.lastMessage = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastMessageIndex")) {
      rt.lastMessageIndex = null;
    }
    if (!Number.isFinite(rt.sends)) {
      rt.sends = 0;
    }
    if (!Number.isFinite(rt.failures)) {
      rt.failures = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "lastResult")) {
      rt.lastResult = null;
    }
    return rt;
  }

  function resetAutoChatSpammerRuntime() {
    const rt = getAutoChatSpammerRuntime();
    rt.nextSendAt = null;
    rt.lastDelayMs = null;
    rt.lastAttemptAt = null;
    rt.lastSendAt = null;
    rt.lastMessage = null;
    rt.lastMessageIndex = null;
    rt.sends = 0;
    rt.failures = 0;
    rt.lastResult = null;
    return rt;
  }

  function pickAutoChatSpammerDelayMs() {
    const minRaw = Number.isFinite(Config.chat && Config.chat.messageIntervalMinMs)
      ? Math.max(0, Math.round(Config.chat.messageIntervalMinMs))
      : 8 * 60 * 1000;
    const maxRaw = Number.isFinite(Config.chat && Config.chat.messageIntervalMaxMs)
      ? Math.max(minRaw, Math.round(Config.chat.messageIntervalMaxMs))
      : 20 * 60 * 1000;
    if (maxRaw <= minRaw) {
      return minRaw;
    }
    return minRaw + Math.floor(Math.random() * (maxRaw - minRaw + 1));
  }

  function scheduleNextAutoChatSpammer(reason, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const rt = getAutoChatSpammerRuntime();
    const now = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    const delayMs = Number.isFinite(opts.delayMs) ? Math.max(0, Math.round(opts.delayMs)) : pickAutoChatSpammerDelayMs();
    rt.nextSendAt = now + delayMs;
    rt.lastDelayMs = delayMs;
    if (reason) {
      rt.lastResult = Object.assign({}, rt.lastResult || {}, {
        nextScheduleReason: reason,
        nextSendAt: rt.nextSendAt
      });
    }
    return rt.nextSendAt;
  }

  // AI CHANGED: Local-clock slot for AUTO chat lines (07–12 morning, 12–18 daytime, 18–23 evening, else night).
  function getTimeOfDayChatSlot(userOpts) {
    const nowMs = userOpts && Number.isFinite(userOpts.nowMs) ? userOpts.nowMs : Date.now();
    const h = new Date(nowMs).getHours();
    if (h >= 7 && h < 12) {
      return "morning";
    }
    if (h >= 12 && h < 18) {
      return "daytime";
    }
    if (h >= 18 && h < 23) {
      return "evening";
    }
    return "night";
  }

  // AI CHANGED: Messages for one slot; fallback to legacy flat `Config.chat.messages` if present.
  function getChatSpammerMessagesForSlot(slot) {
    const m = Config.chat && Config.chat.messagesByTimeOfDay ? Config.chat.messagesByTimeOfDay : null;
    if (!m || typeof m !== "object") {
      return Array.isArray(Config.chat && Config.chat.messages) ? Config.chat.messages.filter(Boolean) : [];
    }
    const key = typeof slot === "string" && slot ? slot : getTimeOfDayChatSlot();
    const arr = m[key];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  }

  // AI CHANGED: Flatten all banks for diagnostics / TEST max-length scan.
  function getAllChatSpammerMessagesFlat() {
    const m = Config.chat && Config.chat.messagesByTimeOfDay ? Config.chat.messagesByTimeOfDay : null;
    if (!m || typeof m !== "object") {
      return Array.isArray(Config.chat && Config.chat.messages) ? Config.chat.messages.filter(Boolean) : [];
    }
    const keys = ["morning", "daytime", "evening", "night"];
    const out = [];
    for (let i = 0; i < keys.length; i += 1) {
      const arr = m[keys[i]];
      if (Array.isArray(arr)) {
        for (let j = 0; j < arr.length; j += 1) {
          if (arr[j]) {
            out.push(arr[j]);
          }
        }
      }
    }
    return out;
  }

  function pickAutoChatSpammerMessage() {
    const slot = getTimeOfDayChatSlot();
    const messages = getChatSpammerMessagesForSlot(slot);
    if (messages.length <= 0) {
      return null;
    }
    const rt = getAutoChatSpammerRuntime();
    let idx = Math.floor(Math.random() * messages.length);
    if (messages.length > 1 && Number.isFinite(rt.lastMessageIndex) && idx === rt.lastMessageIndex) {
      idx = (idx + 1 + Math.floor(Math.random() * (messages.length - 1))) % messages.length;
    }
    return {
      index: idx,
      message: messages[idx],
      slot: slot
    };
  }

  async function maybeRunAutoChatSpammer(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!Config.chat || Config.chat.autoLocalPromocodeSpammerEnabled === false) {
      return { ok: true, skipped: true, reason: "disabled" };
    }
    const now = Date.now();
    const messages = getChatSpammerMessagesForSlot(getTimeOfDayChatSlot({ nowMs: now }));
    if (messages.length <= 0) {
      return { ok: false, skipped: true, reason: "no_messages" };
    }
    const rt = getAutoChatSpammerRuntime();
    if (!Number.isFinite(rt.nextSendAt)) {
      scheduleNextAutoChatSpammer("auto_loop_start", { nowMs: now });
      return {
        ok: true,
        skipped: true,
        reason: "scheduled_first_send",
        nextSendAt: rt.nextSendAt,
        lastDelayMs: rt.lastDelayMs
      };
    }
    if (now < rt.nextSendAt) {
      return {
        ok: true,
        skipped: true,
        reason: "not_due",
        nextSendAt: rt.nextSendAt,
        msUntilNext: rt.nextSendAt - now
      };
    }
    const state = liveState && typeof liveState === "object" ? liveState : readBasicState();
    if (
      state &&
      state.session &&
      (
        state.session.dead === true ||
        state.session.poorConnection === true
      )
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "session_risk",
        nextSendAt: rt.nextSendAt
      };
    }
    if (state && state.combat && typeof state.combat.enemyCount === "number" && state.combat.enemyCount > 0) {
      return {
        ok: true,
        skipped: true,
        reason: "enemy_present",
        enemyCount: state.combat.enemyCount,
        nextSendAt: rt.nextSendAt
      };
    }
    const picked = pickAutoChatSpammerMessage();
    if (!picked || !picked.message) {
      return { ok: false, skipped: true, reason: "message_pick_failed" };
    }
    rt.lastAttemptAt = now;
    setBotStatus("waiting", `auto local chat send (msg ${picked.index + 1}/${messages.length})`);
    Logger.log("CHAT", "Auto local chat send due", {
      messageIndex: picked.index,
      messageLength: picked.message.length,
      timeSlot: picked.slot || null,
      reason: opts.reason || null
    });
    const sendResult = await sendLocalChatPromocodeMessage(picked.message);
    rt.lastResult = sendResult;
    if (sendResult && sendResult.ok) {
      rt.sends += 1;
      rt.lastSendAt = Date.now();
      rt.lastMessage = picked.message;
      rt.lastMessageIndex = picked.index;
      Logger.log("CHAT", "Auto local chat send complete", {
        sends: rt.sends,
        messageIndex: picked.index,
        messageLength: picked.message.length,
        timeSlot: picked.slot || null
      });
      scheduleNextAutoChatSpammer("sent", { nowMs: rt.lastSendAt });
      return Object.assign({
        ok: true,
        sent: true,
        messageIndex: picked.index,
        nextSendAt: rt.nextSendAt,
        lastDelayMs: rt.lastDelayMs
      }, sendResult);
    }
    rt.failures += 1;
    Logger.warn("CHAT", "Auto local chat send failed", {
      failures: rt.failures,
      messageIndex: picked.index,
      result: sendResult
    });
    scheduleNextAutoChatSpammer("send_failed", { nowMs: Date.now() });
    return {
      ok: false,
      sent: false,
      messageIndex: picked.index,
      failures: rt.failures,
      nextSendAt: rt.nextSendAt,
      lastDelayMs: rt.lastDelayMs,
      result: sendResult
    };
  }

  // AI CHANGED: Night resilience — health runtime tracks degraded-session timers and last healthy/progress points.
  function getAutoFarmHealthRuntime() {
    if (!Runtime.autoFarm.health || typeof Runtime.autoFarm.health !== "object") {
      Runtime.autoFarm.health = {};
    }
    const health = Runtime.autoFarm.health;
    if (!Object.prototype.hasOwnProperty.call(health, "lastHealthyAt")) {
      health.lastHealthyAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "lastProgressAt")) {
      health.lastProgressAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "lastActionVerifiedAt")) {
      health.lastActionVerifiedAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "lastStateReadAt")) {
      health.lastStateReadAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "poorConnectionSince")) {
      health.poorConnectionSince = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "deadSince")) {
      health.deadSince = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "missingCoreUiSince")) {
      health.missingCoreUiSince = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "highPingSince")) {
      health.highPingSince = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "staleSince")) {
      health.staleSince = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "suspectedOverload")) {
      health.suspectedOverload = false;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "lastRiskReason")) {
      health.lastRiskReason = null;
    }
    if (!Object.prototype.hasOwnProperty.call(health, "lastSummary")) {
      health.lastSummary = null;
    }
    return health;
  }

  // AI CHANGED: Night resilience — recovery runtime tracks soft recoveries, refreshes, and last refresh reason.
  function getAutoFarmRecoveryRuntime() {
    if (!Runtime.autoFarm.recovery || typeof Runtime.autoFarm.recovery !== "object") {
      Runtime.autoFarm.recovery = {};
    }
    const recovery = Runtime.autoFarm.recovery;
    if (!Number.isFinite(recovery.softAttempts)) {
      recovery.softAttempts = 0;
    }
    if (!Number.isFinite(recovery.refreshAttempts)) {
      recovery.refreshAttempts = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(recovery, "lastSoftRecoveryAt")) {
      recovery.lastSoftRecoveryAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(recovery, "lastRefreshAt")) {
      recovery.lastRefreshAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(recovery, "lastRefreshReason")) {
      recovery.lastRefreshReason = null;
    }
    if (!Object.prototype.hasOwnProperty.call(recovery, "lastRefreshToken")) {
      recovery.lastRefreshToken = null;
    }
    return recovery;
  }

  function resetAutoFarmHealthRuntime(startedAt) {
    const health = getAutoFarmHealthRuntime();
    const when = Number.isFinite(startedAt) ? startedAt : Date.now();
    health.lastHealthyAt = when;
    health.lastProgressAt = when;
    health.lastActionVerifiedAt = when;
    health.lastStateReadAt = when;
    health.poorConnectionSince = null;
    health.deadSince = null;
    health.missingCoreUiSince = null;
    health.highPingSince = null;
    health.staleSince = null;
    health.suspectedOverload = false;
    health.lastRiskReason = null;
    health.lastSummary = null;
    return health;
  }

  function resetAutoFarmRecoveryRuntime() {
    const recovery = getAutoFarmRecoveryRuntime();
    recovery.softAttempts = 0;
    recovery.lastSoftRecoveryAt = null;
    recovery.lastRefreshAt = null;
    recovery.lastRefreshReason = null;
    recovery.lastRefreshToken = null;
    return recovery;
  }

  function markAutoFarmProgress(kind, detail, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const when = Number.isFinite(opts.whenMs) ? opts.whenMs : Date.now();
    const health = getAutoFarmHealthRuntime();
    health.lastProgressAt = when;
    health.lastActionVerifiedAt = when;
    if (!health.lastRiskReason) {
      health.lastHealthyAt = when;
    }
    if (kind) {
      health.lastSummary = Object.assign({}, health.lastSummary || {}, {
        lastProgressKind: kind,
        lastProgressDetail: detail || null,
        lastProgressAt: when
      });
    }
    return when;
  }

  // AI CHANGED: Wait verifications now feed the watchdog so stale sessions use "last verified action" instead of only cycle-level success.
  function noteAutoFarmActionVerified(kind, detail, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const when = Number.isFinite(opts.whenMs) ? opts.whenMs : Date.now();
    const health = getAutoFarmHealthRuntime();
    health.lastActionVerifiedAt = when;
    if (kind && /progress|opened|settled|acquired|effect/i.test(kind)) {
      health.lastProgressAt = when;
    }
    health.lastSummary = Object.assign({}, health.lastSummary || {}, {
      lastVerifiedKind: kind || null,
      lastVerifiedDetail: detail || null,
      lastVerifiedAt: when
    });
    return when;
  }

  function getAutoRecoveryResumeStorageKey() {
    return Config.recovery && typeof Config.recovery.resumeStorageKey === "string" && Config.recovery.resumeStorageKey.trim()
      ? Config.recovery.resumeStorageKey
      : "ligmarbot.autoRecoveryResume.v1";
  }

  function readPersistedAutoRecoveryResume() {
    try {
      const raw = window.localStorage.getItem(getAutoRecoveryResumeStorageKey());
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      Logger.warn("RECOVERY", "Failed to read persisted auto-recovery resume token", err);
      return null;
    }
  }

  function writePersistedAutoRecoveryResume(token) {
    try {
      window.localStorage.setItem(getAutoRecoveryResumeStorageKey(), JSON.stringify(token));
      return true;
    } catch (err) {
      Logger.warn("RECOVERY", "Failed to persist auto-recovery resume token", err);
      return false;
    }
  }

  function clearPersistedAutoRecoveryResume() {
    try {
      window.localStorage.removeItem(getAutoRecoveryResumeStorageKey());
      return true;
    } catch (err) {
      Logger.warn("RECOVERY", "Failed to clear auto-recovery resume token", err);
      return false;
    }
  }

  function updateRecoverySince(flag, currentValue, nowMs) {
    if (!flag) {
      return { since: null, durationMs: 0 };
    }
    const since = Number.isFinite(currentValue) ? currentValue : nowMs;
    return { since: since, durationMs: Math.max(0, nowMs - since) };
  }

  // AI CHANGED: Night resilience — summarize current session health into one recovery decision object.
  function evaluateAutoFarmHealth(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const now = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    const state = liveState && typeof liveState === "object" ? liveState : readBasicState();
    const health = opts.healthRuntime && typeof opts.healthRuntime === "object"
      ? opts.healthRuntime
      : getAutoFarmHealthRuntime();
    const recovery = opts.recoveryRuntime && typeof opts.recoveryRuntime === "object"
      ? opts.recoveryRuntime
      : getAutoFarmRecoveryRuntime();
    const running = typeof opts.running === "boolean" ? opts.running : !!Runtime.autoFarm.running;
    const readonly = opts.readonly === true;
    const session = state && state.session ? state.session : {};
    const coreUi = session && session.coreUi ? session.coreUi : {};
    const pingMs = state && state.network && Number.isFinite(state.network.pingMs) ? state.network.pingMs : null;
    const dead = !!session.dead;
    const poorConnection = !!session.poorConnection;
    const inGame = session.inGame !== false;
    const missingCoreUi = !!coreUi.missing;
    const highPing = Number.isFinite(pingMs) && pingMs >= (Number.isFinite(Config.recovery && Config.recovery.highPingThresholdMs) ? Config.recovery.highPingThresholdMs : 450);
    const lastObservedActionAt =
      Number.isFinite(health.lastActionVerifiedAt)
        ? health.lastActionVerifiedAt
        : Number.isFinite(health.lastProgressAt)
          ? health.lastProgressAt
          : Number.isFinite(Runtime.autoFarm.startedAt)
            ? Runtime.autoFarm.startedAt
            : now;
    const staleActionMs = running ? Math.max(0, now - lastObservedActionAt) : 0;

    if (!readonly) {
      health.lastStateReadAt = now;
    }

    const deadMeta = updateRecoverySince(dead, health.deadSince, now);
    const poorMeta = updateRecoverySince(poorConnection, health.poorConnectionSince, now);
    const missingCoreUiMeta = updateRecoverySince(missingCoreUi, health.missingCoreUiSince, now);
    const highPingMeta = updateRecoverySince(highPing, health.highPingSince, now);
    const staleMeta = updateRecoverySince(staleActionMs >= (Number.isFinite(Config.recovery && Config.recovery.staleActionGraceMs) ? Config.recovery.staleActionGraceMs : 30000), health.staleSince || lastObservedActionAt, now);

    if (!readonly) {
      health.deadSince = deadMeta.since;
      health.poorConnectionSince = poorMeta.since;
      health.missingCoreUiSince = missingCoreUiMeta.since;
      health.highPingSince = highPingMeta.since;
      health.staleSince = staleMeta.since;
    }

    const reasons = [];
    let severity = "healthy";
    let recommendedAction = "continue";
    const deadCritical = deadMeta.durationMs >= (Number.isFinite(Config.recovery && Config.recovery.deadGraceMs) ? Config.recovery.deadGraceMs : 7000);
    const poorCritical = poorMeta.durationMs >= (Number.isFinite(Config.recovery && Config.recovery.poorConnectionGraceMs) ? Config.recovery.poorConnectionGraceMs : 9000);
    const coreUiCritical = missingCoreUiMeta.durationMs >= (Number.isFinite(Config.recovery && Config.recovery.missingCoreUiGraceMs) ? Config.recovery.missingCoreUiGraceMs : 12000);
    const highPingCritical = highPingMeta.durationMs >= (Number.isFinite(Config.recovery && Config.recovery.highPingGraceMs) ? Config.recovery.highPingGraceMs : 25000);
    const staleCritical = staleActionMs >= (Number.isFinite(Config.recovery && Config.recovery.staleActionGraceMs) ? Config.recovery.staleActionGraceMs : 30000);
    const suspectedOverload = !!(staleCritical && (highPing || poorConnection || missingCoreUi));

    if (!inGame) {
      severity = "critical";
      recommendedAction = "refresh";
      reasons.push("not_in_game");
    }
    if (dead) {
      reasons.push(deadCritical ? "dead_screen" : "dead_screen_pending");
      severity = deadCritical ? "critical" : severity === "healthy" ? "degraded" : severity;
      if (deadCritical) {
        recommendedAction = "soft_recover";
      }
    }
    if (poorConnection) {
      reasons.push(poorCritical ? "poor_connection" : "poor_connection_pending");
      severity = poorCritical ? "critical" : severity === "healthy" ? "degraded" : severity;
      if (poorCritical) {
        recommendedAction = "soft_recover";
      }
    }
    if (missingCoreUi) {
      reasons.push(coreUiCritical ? "missing_core_ui" : "missing_core_ui_pending");
      severity = coreUiCritical ? "critical" : severity === "healthy" ? "degraded" : severity;
      if (coreUiCritical) {
        recommendedAction = "soft_recover";
      }
    }
    if (highPing) {
      reasons.push(highPingCritical ? "high_ping" : "high_ping_pending");
      if (severity === "healthy") {
        severity = "degraded";
      }
      if (recommendedAction === "continue" && highPingCritical) {
        recommendedAction = "monitor";
      }
    }
    if (staleCritical) {
      reasons.push(suspectedOverload ? "stale_session_overload" : "stale_session");
      if (severity === "healthy") {
        severity = "degraded";
      }
      if (suspectedOverload) {
        severity = "critical";
      }
      if (recommendedAction === "continue" || recommendedAction === "monitor") {
        recommendedAction = "soft_recover";
      }
    }

    const hardRefreshGraceMs = Number.isFinite(Config.recovery && Config.recovery.hardRefreshGraceMs)
      ? Config.recovery.hardRefreshGraceMs
      : 45000;
    const longestRiskMs = Math.max(deadMeta.durationMs, poorMeta.durationMs, missingCoreUiMeta.durationMs, staleActionMs, highPingMeta.durationMs);
    const refreshCap = Number.isFinite(Config.recovery && Config.recovery.maxAutoRefreshAttemptsPerSession)
      ? Math.max(0, Config.recovery.maxAutoRefreshAttemptsPerSession)
      : 3;

    if (severity === "critical" && recommendedAction === "soft_recover") {
      if (recovery.softAttempts >= (Number.isFinite(Config.recovery && Config.recovery.softRecoveryMaxAttemptsBeforeRefresh)
        ? Config.recovery.softRecoveryMaxAttemptsBeforeRefresh
        : 2) || longestRiskMs >= hardRefreshGraceMs) {
        recommendedAction = recovery.refreshAttempts >= refreshCap ? "halt" : "refresh";
      }
    }

    if (severity === "healthy" || reasons.length === 0) {
      recommendedAction = "continue";
      if (!readonly) {
        health.lastHealthyAt = now;
        health.lastRiskReason = null;
      }
    } else if (!readonly) {
      health.lastRiskReason = reasons[0] || null;
    }

    if (!readonly) {
      health.suspectedOverload = suspectedOverload;
    }

    const summary = {
      severity: severity,
      recommendedAction: recommendedAction,
      reasons: reasons,
      primaryReason: reasons[0] || null,
      dead: dead,
      poorConnection: poorConnection,
      missingCoreUi: missingCoreUi,
      highPing: highPing,
      suspectedOverload: suspectedOverload,
      pingMs: pingMs,
      staleActionMs: staleActionMs,
      lastActionVerifiedAt: lastObservedActionAt,
      durationsMs: {
        dead: deadMeta.durationMs,
        poorConnection: poorMeta.durationMs,
        missingCoreUi: missingCoreUiMeta.durationMs,
        highPing: highPingMeta.durationMs,
        stale: staleActionMs
      },
      coreUi: coreUi,
      lastHealthyAt: health.lastHealthyAt,
      softAttempts: recovery.softAttempts,
      refreshAttempts: recovery.refreshAttempts
    };
    if (!readonly) {
      health.lastSummary = summary;
    }
    return summary;
  }

  // AI CHANGED: Verify waits abort early only on true critical session risk, not on mild ping spikes or short overlays.
  function shouldAbortWaitForSessionRisk(summary) {
    return !!(
      Runtime.autoFarm.running &&
      summary &&
      summary.severity === "critical" &&
      (summary.recommendedAction === "soft_recover" || summary.recommendedAction === "refresh" || summary.recommendedAction === "halt")
    );
  }

  function isStateHealthyForAutoResume(state, summary) {
    const session = state && state.session ? state.session : {};
    const coreUi = session && session.coreUi ? session.coreUi : {};
    return !!(
      session.inGame !== false &&
      !session.dead &&
      !session.poorConnection &&
      coreUi.visible !== false &&
      (!summary || summary.severity !== "critical")
    );
  }

  async function performSoftSessionRecovery(liveState, summary, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const recovery = getAutoFarmRecoveryRuntime();
    recovery.softAttempts += 1;
    recovery.lastSoftRecoveryAt = Date.now();
    setBotStatus("waiting", `soft recovery (${summary && summary.primaryReason ? summary.primaryReason : "session risk"})`);
    Logger.warn("RECOVERY", "Soft recovery started", {
      attempt: recovery.softAttempts,
      reason: summary && summary.primaryReason ? summary.primaryReason : null,
      summary: summary || null
    });
    const cleanup = typeof closeTransientUiForRecovery === "function"
      ? await closeTransientUiForRecovery()
      : { ok: true, detail: null };
    const currentState = liveState && typeof liveState === "object" ? liveState : readBasicState();
    resetZoomAssumptionIfSessionRisk(currentState.session);
    const delayMs = Number.isFinite(Config.recovery && Config.recovery.softRecoveryDelayMs)
      ? Math.max(0, Config.recovery.softRecoveryDelayMs)
      : 1400;
    if (delayMs > 0) {
      await sleep(delayMs, { bypassStop: true });
    }
    if (Runtime.autoFarm.stopRequested) {
      return { ok: false, recovered: false, reason: "stop_requested", cleanup: cleanup };
    }
    const mapOpen = await ensureMapOpen();
    let center = { ok: false, skipped: true, reason: "map_not_open" };
    if (mapOpen.ok) {
      const centerRetries = Number.isFinite(Config.recovery && Config.recovery.centerMapRetryCount)
        ? Math.max(1, Config.recovery.centerMapRetryCount)
        : 2;
      for (let attempt = 0; attempt < centerRetries; attempt += 1) {
        center = await clickCenterMapVerified();
        if (center.ok) {
          break;
        }
        await sleep(180, { bypassStop: true });
      }
    }
    const afterState = readBasicState();
    const afterSummary = evaluateAutoFarmHealth(afterState, { reason: opts.reason || "after_soft_recovery" });
    if (afterSummary.severity === "healthy" || afterSummary.recommendedAction === "continue" || afterSummary.recommendedAction === "monitor") {
      recovery.softAttempts = 0;
      markAutoFarmProgress("soft_recovery", {
        primaryReason: summary && summary.primaryReason ? summary.primaryReason : null
      });
      Logger.log("RECOVERY", "Soft recovery cleared session risk", {
        cleanup: cleanup,
        mapOpen: mapOpen,
        center: center,
        summary: afterSummary
      });
      return {
        ok: true,
        recovered: true,
        cleanup: cleanup,
        mapOpen: mapOpen,
        center: center,
        summary: afterSummary
      };
    }
    Logger.warn("RECOVERY", "Soft recovery did not clear session risk", {
      cleanup: cleanup,
      mapOpen: mapOpen,
      center: center,
      summary: afterSummary
    });
    return {
      ok: false,
      recovered: false,
      cleanup: cleanup,
      mapOpen: mapOpen,
      center: center,
      summary: afterSummary
    };
  }

  function buildAutoRecoveryResumeToken(reason, summary, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const recovery = getAutoFarmRecoveryRuntime();
    return {
      version: BotVersion.version,
      createdAt: new Date().toISOString(),
      reason: reason || (summary && summary.primaryReason) || "session_risk",
      resumeAutoFarm: !(Config.recovery && Config.recovery.autoResumeAfterRefresh === false),
      refreshAttempts: Number.isFinite(opts.refreshAttempts) ? opts.refreshAttempts : recovery.refreshAttempts,
      summary: summary || null
    };
  }

  function requestHardSessionRefresh(reason, summary, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const recovery = getAutoFarmRecoveryRuntime();
    const refreshCap = Number.isFinite(Config.recovery && Config.recovery.maxAutoRefreshAttemptsPerSession)
      ? Math.max(0, Config.recovery.maxAutoRefreshAttemptsPerSession)
      : 3;
    if (recovery.refreshAttempts >= refreshCap) {
      setBotStatus("halted", `recovery refresh cap reached (${reason || "session risk"})`);
      Logger.warn("RECOVERY", "Hard refresh skipped: refresh cap reached", {
        reason: reason || null,
        summary: summary || null,
        refreshAttempts: recovery.refreshAttempts,
        refreshCap: refreshCap
      });
      return { ok: false, halted: true, reason: "refresh_cap_reached", summary: summary || null };
    }
    recovery.refreshAttempts += 1;
    recovery.lastRefreshAt = Date.now();
    recovery.lastRefreshReason = reason || (summary && summary.primaryReason) || "session_risk";
    const token = buildAutoRecoveryResumeToken(recovery.lastRefreshReason, summary, {
      refreshAttempts: recovery.refreshAttempts
    });
    recovery.lastRefreshToken = token;
    writePersistedAutoRecoveryResume(token);
    setBotStatus("waiting", `refreshing after ${recovery.lastRefreshReason}`);
    Logger.warn("RECOVERY", "Hard recovery refresh requested", token);
    window.setTimeout(function () {
      window.location.reload();
    }, Number.isFinite(opts.delayMs) ? Math.max(0, opts.delayMs) : 60);
    return { ok: true, refreshing: true, token: token, summary: summary || null };
  }

  async function maybeRecoverUnhealthySession(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!Runtime.autoFarm.running) {
      return { ok: true, skipped: true, reason: "not_running" };
    }
    const summary = evaluateAutoFarmHealth(liveState, { reason: opts.reason || "cycle_boundary" });
    if (summary.severity === "healthy" || summary.recommendedAction === "continue" || summary.recommendedAction === "monitor") {
      return { ok: true, skipped: true, summary: summary };
    }
    if (summary.recommendedAction === "halt") {
      setBotStatus("halted", `session risk: ${summary.primaryReason || "unknown"}`);
      Runtime.autoFarm.stopRequested = true;
      return { ok: false, halted: true, summary: summary };
    }
    const soft = await performSoftSessionRecovery(liveState, summary, opts);
    if (soft.ok) {
      return { ok: true, recovered: true, summary: soft.summary, soft: soft };
    }
    const postSummary = soft.summary || summary;
    if (postSummary.recommendedAction === "refresh" || postSummary.recommendedAction === "halt") {
      return requestHardSessionRefresh(postSummary.primaryReason || summary.primaryReason, postSummary, opts);
    }
    return { ok: false, recovered: false, summary: postSummary, soft: soft };
  }

  // AI CHANGED: After an auto-refresh recovery, wait for a healthy game surface and restart AUTO ON automatically.
  function resumeAutoFarmAfterRecoveryBootIfNeeded() {
    const token = readPersistedAutoRecoveryResume();
    if (!token || token.resumeAutoFarm !== true) {
      return false;
    }
    if (Runtime.autoFarm.running) {
      clearPersistedAutoRecoveryResume();
      return true;
    }
    const pollMs = Number.isFinite(Config.recovery && Config.recovery.bootResumePollMs)
      ? Math.max(100, Config.recovery.bootResumePollMs)
      : 800;
    const maxWaitMs = Number.isFinite(Config.recovery && Config.recovery.bootResumeMaxWaitMs)
      ? Math.max(pollMs, Config.recovery.bootResumeMaxWaitMs)
      : 45000;
    const refreshCap = Number.isFinite(Config.recovery && Config.recovery.maxAutoRefreshAttemptsPerSession)
      ? Math.max(0, Config.recovery.maxAutoRefreshAttemptsPerSession)
      : 3;
    const started = Date.now();
    Logger.warn("RECOVERY", "Pending AUTO resume after refresh", token);
    setBotStatus("waiting", "recovery boot health check");
    const tick = function () {
      const state = readBasicState();
      const summary = evaluateAutoFarmHealth(state, {
        readonly: true,
        running: false,
        nowMs: Date.now()
      });
      if (isStateHealthyForAutoResume(state, summary)) {
        clearPersistedAutoRecoveryResume();
        Logger.log("RECOVERY", "Boot recovery healthy — restarting AUTO", {
          summary: summary,
          token: token
        });
        startAutoFarmLoop();
        return;
      }
      if (Date.now() - started >= maxWaitMs) {
        const usedRefreshes = Number.isFinite(token.refreshAttempts) ? token.refreshAttempts : 0;
        if (usedRefreshes < refreshCap) {
          const retryToken = Object.assign({}, token, {
            refreshAttempts: usedRefreshes + 1,
            updatedAt: new Date().toISOString(),
            reason: summary.primaryReason || token.reason || "boot_not_healthy"
          });
          writePersistedAutoRecoveryResume(retryToken);
          Logger.warn("RECOVERY", "Boot recovery still unhealthy — refreshing again", {
            summary: summary,
            token: retryToken
          });
          window.location.reload();
          return;
        }
        clearPersistedAutoRecoveryResume();
        setBotStatus("halted", `recovery exhausted (${summary.primaryReason || "boot_not_healthy"})`);
        Logger.warn("RECOVERY", "Boot recovery exhausted — AUTO will stay idle", {
          summary: summary,
          token: token
        });
        return;
      }
      window.setTimeout(tick, pollMs);
    };
    window.setTimeout(tick, pollMs);
    return true;
  }

  // AI CHANGED: Potion sustain now keeps state for active HoTs, shared cooldown, recent HP-loss trend, and the last protected mana requirement.
  function getCombatSustainRuntime() {
    if (!Runtime.autoFarm.combatSustain || typeof Runtime.autoFarm.combatSustain !== "object") {
      Runtime.autoFarm.combatSustain = {};
    }
    const sustain = Runtime.autoFarm.combatSustain;
    if (!Number.isFinite(sustain.hpPotionUses)) {
      sustain.hpPotionUses = 0;
    }
    if (!Number.isFinite(sustain.mpPotionUses)) {
      sustain.mpPotionUses = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionAt")) {
      sustain.lastPotionAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionResource")) {
      sustain.lastPotionResource = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPotionReason")) {
      sustain.lastPotionReason = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "potionCooldownUntil")) {
      sustain.potionCooldownUntil = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "activeHpPotion")) {
      sustain.activeHpPotion = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "activeMpPotion")) {
      sustain.activeMpPotion = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastHpSampleAt")) {
      sustain.lastHpSampleAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastHpSampleCur")) {
      sustain.lastHpSampleCur = null;
    }
    if (!Number.isFinite(sustain.recentHpLossPerSec)) {
      sustain.recentHpLossPerSec = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(sustain, "lastPreferredManaNeed")) {
      sustain.lastPreferredManaNeed = null;
    }
    return sustain;
  }

  function getCombatPotionEffectSpec(record, resource) {
    if (!record || !Array.isArray(record.effects)) {
      return null;
    }
    let best = null;
    for (let i = 0; i < record.effects.length; i += 1) {
      const effect = record.effects[i];
      if (!effect || effect.type !== "heal" || effect.resource !== resource || !Number.isFinite(effect.value) || effect.value <= 0) {
        continue;
      }
      const fallbackDuration =
        resource === "hp" && Number.isFinite(Config.combat && Config.combat.combatPotionHotDefaultDurationSec)
          ? Math.max(0, Config.combat.combatPotionHotDefaultDurationSec)
          : 0;
      const durationSec =
        Number.isFinite(effect.durationSec) && effect.durationSec > 0
          ? effect.durationSec
          : fallbackDuration;
      const totalValue = effect.value;
      const spec = {
        resource: resource,
        totalValue: +totalValue.toFixed(2),
        durationSec: Number.isFinite(durationSec) ? +durationSec.toFixed(3) : 0,
        perSec: durationSec > 0 ? +(totalValue / durationSec).toFixed(3) : +totalValue.toFixed(3),
        hot: durationSec > 0
      };
      if (!best || spec.totalValue > best.totalValue) {
        best = spec;
      }
    }
    return best;
  }

  function listCombatPotionCandidates(resource, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const readyOnly = opts.readyOnly !== false;
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const rows = [];
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "potion" || row.resource !== resource) {
        continue;
      }
      const slotIdx = typeof row.slot === "number" ? row.slot : i;
      const spec = getCombatPotionEffectSpec(row, resource);
      if (!spec) {
        continue;
      }
      if (row.counter && Number.isFinite(row.counter.value) && row.counter.value <= 0) {
        continue;
      }
      if (readyOnly && typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(slotIdx)) {
        continue;
      }
      rows.push({
        slot: slotIdx,
        record: row,
        spec: spec
      });
    }
    rows.sort(function (a, b) {
      if (a.spec.totalValue !== b.spec.totalValue) {
        return a.spec.totalValue - b.spec.totalValue;
      }
      return a.slot - b.slot;
    });
    return rows;
  }

  function chooseCombatPotionCandidate(resource, needAmount, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const rows = listCombatPotionCandidates(resource, { readyOnly: true });
    if (rows.length === 0) {
      return null;
    }
    if (opts.preferLargest) {
      return rows[rows.length - 1];
    }
    const need = Number.isFinite(needAmount) ? Math.max(0, needAmount) : 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].spec.totalValue >= need) {
        return rows[i];
      }
    }
    return rows[rows.length - 1];
  }

  function getCombatActivePotionRemaining(activePotion, nowMs) {
    if (
      !activePotion ||
      !Number.isFinite(activePotion.endsAt) ||
      !Number.isFinite(activePotion.durationSec) ||
      !Number.isFinite(activePotion.totalValue)
    ) {
      return 0;
    }
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (now >= activePotion.endsAt || activePotion.durationSec <= 0 || activePotion.totalValue <= 0) {
      return 0;
    }
    const totalMs = activePotion.durationSec * 1000;
    if (!(totalMs > 0)) {
      return 0;
    }
    const remainFrac = Math.max(0, Math.min(1, (activePotion.endsAt - now) / totalMs));
    return +(activePotion.totalValue * remainFrac).toFixed(2);
  }

  function updateCombatSustainObservations(liveState) {
    const sustain = getCombatSustainRuntime();
    const now = liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now();
    if (sustain.activeHpPotion && Number.isFinite(sustain.activeHpPotion.endsAt) && now >= sustain.activeHpPotion.endsAt) {
      sustain.activeHpPotion = null;
    }
    if (sustain.activeMpPotion && Number.isFinite(sustain.activeMpPotion.endsAt) && now >= sustain.activeMpPotion.endsAt) {
      sustain.activeMpPotion = null;
    }
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    if (Number.isFinite(hpCur)) {
      if (Number.isFinite(sustain.lastHpSampleCur) && Number.isFinite(sustain.lastHpSampleAt)) {
        const dtSec = Math.max(0, (now - sustain.lastHpSampleAt) / 1000);
        if (dtSec >= 0.1) {
          const delta = hpCur - sustain.lastHpSampleCur;
          const instantLossPerSec = delta < 0 ? (-delta / dtSec) : 0;
          if (instantLossPerSec > 0) {
            sustain.recentHpLossPerSec = +(
              (sustain.recentHpLossPerSec * 0.65) +
              (instantLossPerSec * 0.35)
            ).toFixed(3);
          } else {
            sustain.recentHpLossPerSec = +(sustain.recentHpLossPerSec * 0.82).toFixed(3);
          }
        }
      }
      sustain.lastHpSampleCur = hpCur;
      sustain.lastHpSampleAt = now;
    }
    return sustain;
  }

  function buildCombatActivePotionState(resource, potion, usedAt) {
    if (!potion || !potion.spec || !Number.isFinite(usedAt)) {
      return null;
    }
    if (!(Number.isFinite(potion.spec.durationSec) && potion.spec.durationSec > 0)) {
      return null;
    }
    return {
      resource: resource,
      slot: potion.slot,
      name: potion.record && potion.record.name ? potion.record.name : "",
      totalValue: potion.spec.totalValue,
      durationSec: potion.spec.durationSec,
      perSec: potion.spec.perSec,
      startedAt: usedAt,
      endsAt: usedAt + Math.round(potion.spec.durationSec * 1000)
    };
  }

  function rememberCombatPotionUse(resource, potion, reason, usedAt) {
    const sustain = getCombatSustainRuntime();
    const when = Number.isFinite(usedAt) ? usedAt : Date.now();
    sustain.lastPotionAt = when;
    sustain.lastPotionResource = resource;
    sustain.lastPotionReason = reason || null;
    if (resource === "hp") {
      sustain.hpPotionUses += 1;
      sustain.activeHpPotion = buildCombatActivePotionState("hp", potion, when);
    } else if (resource === "mp") {
      sustain.mpPotionUses += 1;
      sustain.activeMpPotion = buildCombatActivePotionState("mp", potion, when);
    }
    if (Config.combat && Config.combat.combatPotionSharedCooldown !== false) {
      const cooldownMs =
        Number.isFinite(Config.combat.combatPotionCooldownMs) && Config.combat.combatPotionCooldownMs > 0
          ? Math.round(Config.combat.combatPotionCooldownMs)
          : 15000;
      sustain.potionCooldownUntil = when + cooldownMs;
    }
  }

  function getCombatMinimumAttackManaNeed() {
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let best = null;
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy) {
        continue;
      }
      if (typeof plannerSkillHasDirectDamageForOpener === "function" && !plannerSkillHasDirectDamageForOpener(row)) {
        continue;
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      if (!(manaCost > 0)) {
        continue;
      }
      if (best === null || manaCost < best) {
        best = manaCost;
      }
    }
    return best;
  }

  function getCombatMaximumAttackManaNeed() {
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let best = null;
    for (let i = 0; i < slots.length; i += 1) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy) {
        continue;
      }
      if (typeof plannerSkillHasDirectDamageForOpener === "function" && !plannerSkillHasDirectDamageForOpener(row)) {
        continue;
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      if (!(manaCost > 0)) {
        continue;
      }
      if (best === null || manaCost > best) {
        best = manaCost;
      }
    }
    return best;
  }

  function computeCombatPreferredManaNeed(liveState) {
    if (!(Config.planner && Config.planner.useRankedAttackSkillsInCombat)) {
      return null;
    }
    if (typeof previewOpenerHorizonSim !== "function") {
      return null;
    }
    const preview = previewOpenerHorizonSim({});
    const rows = preview && Array.isArray(preview.candidates) ? preview.candidates.slice() : [];
    if (rows.length === 0) {
      return null;
    }
    rows.sort(function (a, b) {
      const aPass = a && a.passesThreshold ? 1 : 0;
      const bPass = b && b.passesThreshold ? 1 : 0;
      if (bPass !== aPass) {
        return bPass - aPass;
      }
      const aDmg = a && Number.isFinite(a.horizonDamage) ? a.horizonDamage : -Infinity;
      const bDmg = b && Number.isFinite(b.horizonDamage) ? b.horizonDamage : -Infinity;
      return bDmg - aDmg;
    });
    const picked = rows[0];
    if (!picked || !Number.isFinite(picked.slot)) {
      return null;
    }
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const row = slots.find(function (slotRec) {
      return slotRec && typeof slotRec.slot === "number" && slotRec.slot === picked.slot;
    }) || null;
    if (!row) {
      return null;
    }
    const reserve = Number.isFinite(Config.planner && Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
    return {
      slot: picked.slot,
      name: row.name || picked.name || "",
      manaCost: manaCost,
      manaNeed: manaCost + reserve,
      horizonDamage: Number.isFinite(picked.horizonDamage) ? picked.horizonDamage : null,
      passesThreshold: !!picked.passesThreshold
    };
  }

  // AI CHANGED: HP potion policy uses parsed total heal + HoT duration + recent incoming damage so the bot keeps HP high without blind percentage-only spam.
  function evaluateCombatHpPotionNeed(liveState) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { needed: false, emergency: false, hpPct: null, reason: "combat_potions_off" };
    }
    const sustain = getCombatSustainRuntime();
    const knownPotions = listCombatPotionCandidates("hp", { readyOnly: false });
    const bestKnown = knownPotions.length > 0 ? knownPotions[knownPotions.length - 1] : null;
    if (!bestKnown) {
      return { needed: false, emergency: false, hpPct: null, reason: "no_hp_potion_on_bar" };
    }
    const now = liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now();
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    const hpMax =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.max)
        ? liveState.player.hp.max
        : null;
    const hpPct =
      Number.isFinite(hpCur) && Number.isFinite(hpMax) && hpMax > 0
        ? hpCur / hpMax
        : null;
    if (!Number.isFinite(hpPct) || !Number.isFinite(hpCur) || !Number.isFinite(hpMax)) {
      return { needed: false, emergency: false, hpPct: null, reason: "hp_unread" };
    }
    const missingHp = Math.max(0, hpMax - hpCur);
    const emergencyPct = Number.isFinite(Config.combat.hpPotionEmergencyBelowPct)
      ? Math.max(0.05, Math.min(1, Config.combat.hpPotionEmergencyBelowPct))
      : 0.35;
    const normalPct = Number.isFinite(Config.combat.hpPotionUseBelowPct)
      ? Math.max(emergencyPct, Math.min(1, Config.combat.hpPotionUseBelowPct))
      : 0.55;
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : 0;
    const forecastWindowSec =
      enemyCount > 0 && Number.isFinite(Config.combat.hpPotionForecastWindowSec)
        ? Math.max(0, Math.min(bestKnown.spec.durationSec, Config.combat.hpPotionForecastWindowSec))
        : 0;
    const projectedIncoming = Math.max(0, sustain.recentHpLossPerSec || 0) * forecastWindowSec;
    const activeRemaining = getCombatActivePotionRemaining(sustain.activeHpPotion, now);
    const efficiencyFrac =
      enemyCount > 0 && Number.isFinite(Config.combat.hpPotionCombatMissingHealFraction)
        ? Math.max(0.1, Math.min(1, Config.combat.hpPotionCombatMissingHealFraction))
        : (
            Number.isFinite(Config.combat.hpPotionSafeMissingHealFraction)
              ? Math.max(0.1, Math.min(1, Config.combat.hpPotionSafeMissingHealFraction))
              : 0.85
          );
    const effectiveMissing = Math.max(0, missingHp + projectedIncoming - activeRemaining);
    const thresholdValue = bestKnown.spec.totalValue * efficiencyFrac;
    const emergency = hpPct <= emergencyPct;
    const needed =
      emergency ||
      (
        activeRemaining <= bestKnown.spec.perSec &&
        (
          effectiveMissing >= thresholdValue ||
          (enemyCount > 0 && hpPct <= normalPct && effectiveMissing >= bestKnown.spec.perSec * 2)
        )
      );
    return {
      needed: needed,
      emergency: emergency,
      hpPct: +hpPct.toFixed(4),
      hpCur: +hpCur.toFixed(2),
      hpMax: +hpMax.toFixed(2),
      missingHp: +missingHp.toFixed(2),
      activeRemaining: +activeRemaining.toFixed(2),
      projectedIncoming: +projectedIncoming.toFixed(2),
      effectiveMissing: +effectiveMissing.toFixed(2),
      thresholdValue: +thresholdValue.toFixed(2),
      potionTotalValue: bestKnown.spec.totalValue,
      potionDurationSec: bestKnown.spec.durationSec,
      potionPerSec: bestKnown.spec.perSec,
      reason: needed ? (emergency ? "emergency_hp_pct" : "parsed_hot_value_window") : "hp_not_missing_enough_yet"
    };
  }

  // AI CHANGED: MP potion policy protects the mana needed for the current best ranked skill instead of a fixed low-mana percentage alone.
  function evaluateCombatMpPotionNeed(liveState) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { needed: false, reason: "combat_potions_off" };
    }
    const sustain = getCombatSustainRuntime();
    const knownPotions = listCombatPotionCandidates("mp", { readyOnly: false });
    const bestKnown = knownPotions.length > 0 ? knownPotions[knownPotions.length - 1] : null;
    if (!bestKnown) {
      sustain.lastPreferredManaNeed = null;
      return { needed: false, reason: "no_mp_potion_on_bar" };
    }
    const mpCur =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.cur)
        ? liveState.player.mp.cur
        : null;
    const mpPct =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.pct)
        ? liveState.player.mp.pct
        : null;
    if (!Number.isFinite(mpCur) || !Number.isFinite(mpPct)) {
      sustain.lastPreferredManaNeed = null;
      return { needed: false, reason: "mp_unread" };
    }
    const reserve = Number.isFinite(Config.planner && Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 0;
    const maxAttackManaNeed = getCombatMaximumAttackManaNeed();
    const activeRemaining = getCombatActivePotionRemaining(sustain.activeMpPotion, liveState && Number.isFinite(liveState.time) ? liveState.time : Date.now());
    const lowMpPct = Number.isFinite(Config.combat.mpPotionUseBelowPct)
      ? Math.max(0.05, Math.min(1, Config.combat.mpPotionUseBelowPct))
      : 0.22;
    if (Number.isFinite(maxAttackManaNeed) && mpCur >= maxAttackManaNeed + reserve) {
      sustain.lastPreferredManaNeed = {
        reason: "can_cast_any_attack_skill",
        manaNeed: maxAttackManaNeed + reserve
      };
      return {
        needed: false,
        reason: "can_cast_any_attack_skill",
        mpCur: +mpCur.toFixed(2),
        mpPct: +mpPct.toFixed(4),
        activeRemaining: +activeRemaining.toFixed(2)
      };
    }
    const preferred = computeCombatPreferredManaNeed(liveState);
    sustain.lastPreferredManaNeed = preferred;
    if (preferred && Number.isFinite(preferred.manaNeed) && preferred.manaNeed > 0) {
      const shortage = preferred.manaNeed - (mpCur + activeRemaining);
      return {
        needed: shortage > 0,
        reason: shortage > 0 ? "preferred_skill_shortage" : "preferred_skill_mana_available",
        mpCur: +mpCur.toFixed(2),
        mpPct: +mpPct.toFixed(4),
        activeRemaining: +activeRemaining.toFixed(2),
        shortage: +Math.max(0, shortage).toFixed(2),
        preferredSkill: preferred,
        potionTotalValue: bestKnown.spec.totalValue,
        potionDurationSec: bestKnown.spec.durationSec,
        potionPerSec: bestKnown.spec.perSec
      };
    }
    const minAttackManaNeed = getCombatMinimumAttackManaNeed();
    const fallbackNeeded =
      mpPct <= lowMpPct &&
      Number.isFinite(minAttackManaNeed) &&
      mpCur + activeRemaining < minAttackManaNeed + reserve;
    return {
      needed: fallbackNeeded,
      reason: fallbackNeeded ? "fallback_low_mp_pct" : "no_ranked_mana_pressure",
      mpCur: +mpCur.toFixed(2),
      mpPct: +mpPct.toFixed(4),
      activeRemaining: +activeRemaining.toFixed(2),
      minAttackManaNeed: minAttackManaNeed,
      potionTotalValue: bestKnown.spec.totalValue,
      potionDurationSec: bestKnown.spec.durationSec,
      potionPerSec: bestKnown.spec.perSec
    };
  }

  async function tryUseCombatPotion(resource, potion, reason, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const sustain = getCombatSustainRuntime();
    const now = Date.now();
    if (
      Config.combat &&
      Config.combat.combatPotionSharedCooldown !== false &&
      Number.isFinite(sustain.potionCooldownUntil) &&
      now < sustain.potionCooldownUntil
    ) {
      return { ok: false, skipped: true, reason: "shared_potion_cooldown_active", cooldownRemainingMs: sustain.potionCooldownUntil - now };
    }
    const throttleMs = Number.isFinite(Config.combat && Config.combat.combatPotionThrottleMs)
      ? Math.max(0, Config.combat.combatPotionThrottleMs)
      : 1200;
    if (!opts.ignoreThrottle && Number.isFinite(sustain.lastPotionAt) && now - sustain.lastPotionAt < throttleMs) {
      return { ok: false, skipped: true, reason: "throttled_recent_potion_use" };
    }
    if (!potion) {
      return { ok: false, skipped: true, reason: "no_ready_" + resource + "_potion" };
    }
    const clicked = clickActionBarSlot(potion.slot);
    if (!clicked) {
      return { ok: false, skipped: false, reason: "click_failed", slot: potion.slot };
    }
    rememberCombatPotionUse(resource, potion, reason, now);
    Logger.log("COMBAT", "Combat potion used", {
      resource: resource,
      slot: potion.slot,
      reason: reason || null,
      counter: potion.record && potion.record.counter ? potion.record.counter.value : null,
      totalValue: potion.spec ? potion.spec.totalValue : null,
      durationSec: potion.spec ? potion.spec.durationSec : null,
      perSec: potion.spec ? potion.spec.perSec : null
    });
    const settleMs = Number.isFinite(Config.combat && Config.combat.combatPotionSettleMs)
      ? Math.max(0, Config.combat.combatPotionSettleMs)
      : 120;
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    return { ok: true, skipped: false, slot: potion.slot, reason: reason || null };
  }

  async function maybeUseCombatSustain(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { used: false, reason: "combat_potions_off" };
    }
    updateCombatSustainObservations(liveState);
    const hpNeed = evaluateCombatHpPotionNeed(liveState);
    if (hpNeed.needed) {
      const hpPotion = chooseCombatPotionCandidate("hp", hpNeed.effectiveMissing, {
        preferLargest: hpNeed.emergency
      });
      const hpUse = await tryUseCombatPotion("hp", hpPotion, opts.reason || hpNeed.reason, {});
      if (hpUse.ok) {
        return { used: true, resource: "hp", detail: hpUse, policy: hpNeed };
      }
    }
    const mpNeed = evaluateCombatMpPotionNeed(liveState);
    if (mpNeed.needed) {
      const mpPotion = chooseCombatPotionCandidate("mp", mpNeed.shortage, { preferLargest: false });
      const mpUse = await tryUseCombatPotion("mp", mpPotion, opts.reason || mpNeed.reason);
      if (mpUse.ok) {
        return { used: true, resource: "mp", detail: mpUse, policy: mpNeed };
      }
    }
    return {
      used: false,
      reason: "no_potion_needed_or_ready",
      hpPolicy: hpNeed,
      mpPolicy: mpNeed
    };
  }

  // AI CHANGED: Out-of-combat explore prep — drink HP potions toward threshold when enemyCount===0 (does not spend MP potions).
  async function tryUseOutOfCombatHpTopoff(liveState, thresholdPct) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { used: false, reason: "combat_potions_off" };
    }
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : 0;
    if (enemyCount !== 0) {
      return { used: false, reason: "not_clear_tile" };
    }
    updateCombatSustainObservations(liveState);
    const hpCur =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.cur)
        ? liveState.player.hp.cur
        : null;
    const hpMax =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.max)
        ? liveState.player.hp.max
        : null;
    const hpPct =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.pct)
        ? liveState.player.hp.pct
        : null;
    if (!Number.isFinite(hpCur) || !Number.isFinite(hpMax) || !(hpMax > 0) || !Number.isFinite(hpPct)) {
      return { used: false, reason: "hp_unread" };
    }
    const safeThreshold =
      Number.isFinite(thresholdPct) ? Math.max(0.05, Math.min(1, thresholdPct)) : 0.75;
    if (hpPct >= safeThreshold) {
      return { used: false, reason: "already_above_threshold" };
    }
    const targetCur = hpMax * safeThreshold;
    const missingToThreshold = Math.max(0, targetCur - hpCur);
    if (!(missingToThreshold > 0.5)) {
      return { used: false, reason: "missing_hp_trivial" };
    }
    const potion = chooseCombatPotionCandidate("hp", missingToThreshold, { preferLargest: true });
    if (!potion) {
      return { used: false, reason: "no_ready_hp_potion" };
    }
    const useResult = await tryUseCombatPotion("hp", potion, "out_of_combat_explore_topoff", { ignoreThrottle: true });
    if (useResult && useResult.ok) {
      return { used: true, detail: useResult };
    }
    return {
      used: false,
      reason: useResult && useResult.reason ? useResult.reason : "use_failed",
      detail: useResult || null
    };
  }

  // AI CHANGED: Idle regen gate — when enemyCount===0 before exploreByScan, stay idle until HP≥threshold (HP potions + passive ticks).
  async function waitForOutOfCombatHealBeforeExplore(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (Config.combat && Config.combat.outOfCombatHealBeforeExplore === false) {
      return { ok: true, skipped: true, reason: "feature_off" };
    }
    const thresholdPct =
      Number.isFinite(Config.combat && Config.combat.outOfCombatHealWaitHpPct)
        ? Math.max(0.05, Math.min(1, Config.combat.outOfCombatHealWaitHpPct))
        : 0.75;
    const pollMs =
      Number.isFinite(Config.combat && Config.combat.outOfCombatHealPollMs)
        ? Math.max(120, Config.combat.outOfCombatHealPollMs)
        : 600;
    let state = readBasicState();
    if (!(typeof state.combat.enemyCount === "number" && state.combat.enemyCount === 0)) {
      return { ok: true, skipped: true, reason: "enemies_present", thresholdPct: thresholdPct };
    }
    const hp =
      state && state.player && state.player.hp && state.player.hp.valid ? state.player.hp : null;
    const targetActive =
      state &&
      state.combat &&
      state.combat.targetHp &&
      state.combat.targetHp.valid &&
      Number.isFinite(state.combat.targetHp.cur) &&
      state.combat.targetHp.cur > 0;
    if (!hp || !Number.isFinite(hp.pct)) {
      return { ok: true, skipped: true, reason: "hp_unread", thresholdPct: thresholdPct };
    }
    if (targetActive) {
      return {
        ok: true,
        skipped: true,
        reason: "target_bar_active",
        thresholdPct: thresholdPct,
        hpPct: +hp.pct.toFixed(4)
      };
    }
    if (hp.pct >= thresholdPct) {
      return { ok: true, waited: false, thresholdPct: thresholdPct, hpPct: +hp.pct.toFixed(4) };
    }
    const startedAt = Date.now();
    let sustainUses = 0;
    while (!Runtime.autoFarm.stopRequested) {
      state = readBasicState();
      if (!(typeof state.combat.enemyCount === "number" && state.combat.enemyCount === 0)) {
        return {
          ok: true,
          skipped: true,
          reason: "combat_became_active_enemy_count",
          thresholdPct: thresholdPct,
          sustainUses: sustainUses
        };
      }
      const hpNow = state.player && state.player.hp && state.player.hp.valid ? state.player.hp : null;
      if (!hpNow || !Number.isFinite(hpNow.pct)) {
        return {
          ok: true,
          skipped: true,
          reason: "hp_became_unread",
          thresholdPct: thresholdPct,
          sustainUses: sustainUses
        };
      }
      const targetNow =
        state &&
        state.combat &&
        state.combat.targetHp &&
        state.combat.targetHp.valid &&
        Number.isFinite(state.combat.targetHp.cur) &&
        state.combat.targetHp.cur > 0;
      if (targetNow) {
        return {
          ok: true,
          skipped: true,
          reason: "combat_became_active_target",
          thresholdPct: thresholdPct,
          hpPct: +hpNow.pct.toFixed(4),
          sustainUses: sustainUses
        };
      }
      if (hpNow.pct >= thresholdPct) {
        return {
          ok: true,
          waited: true,
          thresholdPct: thresholdPct,
          hpPct: +hpNow.pct.toFixed(4),
          waitedMs: Math.max(0, Date.now() - startedAt),
          sustainUses: sustainUses
        };
      }
      const hpCurText = Number.isFinite(hpNow.cur) && Number.isFinite(hpNow.max)
        ? `${Math.round(hpNow.cur)}/${Math.round(hpNow.max)}`
        : `${Math.round(hpNow.pct * 100)}%`;
      setBotStatus(
        "waiting",
        `healing before next tile (${hpCurText} → ${Math.round(thresholdPct * 100)}%)`
      );
      const topoff = await tryUseOutOfCombatHpTopoff(state, thresholdPct);
      if (topoff && topoff.used) {
        sustainUses += 1;
        Logger.log("COMBAT", "Out-of-combat explore HP topoff", {
          reason: opts.reason || "before_explore_move",
          sustainUses: sustainUses,
          detail: topoff.detail || null
        });
      }
      await sleep(pollMs, { bypassStop: true });
    }
    return { ok: false, reason: "stop_requested", thresholdPct: thresholdPct };
  }

  function getCombatQueueRuntime() {
    if (!Runtime.autoFarm.combatQueue || typeof Runtime.autoFarm.combatQueue !== "object") {
      Runtime.autoFarm.combatQueue = {};
    }
    const queue = Runtime.autoFarm.combatQueue;
    if (!Object.prototype.hasOwnProperty.call(queue, "active")) {
      queue.active = false;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "mode")) {
      queue.mode = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "slot")) {
      queue.slot = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "name")) {
      queue.name = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "source")) {
      queue.source = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "anchorMode")) {
      queue.anchorMode = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "anchorSlot")) {
      queue.anchorSlot = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "anchorName")) {
      queue.anchorName = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "anchorSource")) {
      queue.anchorSource = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "openerSlot")) {
      queue.openerSlot = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "openerName")) {
      queue.openerName = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "armedAt")) {
      queue.armedAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "firedAt")) {
      queue.firedAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "clearedAt")) {
      queue.clearedAt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "clearReason")) {
      queue.clearReason = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "targetHpMaxAtArm")) {
      queue.targetHpMaxAtArm = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "enemyCountAtArm")) {
      queue.enemyCountAtArm = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "postRetargetGuarded")) {
      queue.postRetargetGuarded = false;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "lastMatchedCastText")) {
      queue.lastMatchedCastText = null;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "advanceCount")) {
      queue.advanceCount = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(queue, "anchorNeedsReset")) {
      queue.anchorNeedsReset = false;
    }
    return queue;
  }

  function clearCombatActionQueue(reason, detail) {
    const queue = getCombatQueueRuntime();
    queue.active = false;
    queue.clearedAt = Date.now();
    queue.clearReason = reason || null;
    if (detail && typeof detail === "object") {
      if (Object.prototype.hasOwnProperty.call(detail, "mode")) {
        queue.mode = detail.mode;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "slot")) {
        queue.slot = detail.slot;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "name")) {
        queue.name = detail.name;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "source")) {
        queue.source = detail.source;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "anchorMode")) {
        queue.anchorMode = detail.anchorMode;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "anchorSlot")) {
        queue.anchorSlot = detail.anchorSlot;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "anchorName")) {
        queue.anchorName = detail.anchorName;
      }
      if (Object.prototype.hasOwnProperty.call(detail, "anchorSource")) {
        queue.anchorSource = detail.anchorSource;
      }
    }
    return queue;
  }

  function normalizeCombatQueueActionName(rawName) {
    if (typeof plannerNormalizeSkillNameForMatch === "function") {
      return plannerNormalizeSkillNameForMatch(rawName || "");
    }
    if (typeof normalizeSkillName === "function") {
      return normalizeSkillName(rawName || "").toLowerCase();
    }
    return String(rawName || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function resolveCombatQueueActionName(mode, name) {
    if (mode === "basic") {
      return "Basic Attack";
    }
    return name || "";
  }

  function buildCombatQueueActionAliases(mode, name) {
    const base = resolveCombatQueueActionName(mode, name);
    const aliases = [];
    const pushAlias = function (raw) {
      const normalized = normalizeCombatQueueActionName(raw);
      if (!normalized) {
        return;
      }
      if (aliases.indexOf(normalized) === -1) {
        aliases.push(normalized);
      }
    };
    pushAlias(base);
    if (mode === "basic") {
      pushAlias("Attack");
      pushAlias("Basic Attack");
    }
    return aliases;
  }

  function findCombatQueueAnchorCastMatch(queue) {
    const texts = typeof readVisibleCombatCastBarTexts === "function" ? readVisibleCombatCastBarTexts() : [];
    if (!queue || !queue.anchorMode || !queue.anchorName) {
      return null;
    }
    const aliases = buildCombatQueueActionAliases(queue.anchorMode, queue.anchorName);
    if (aliases.length <= 0 || texts.length <= 0) {
      return null;
    }
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const normalized = normalizeCombatQueueActionName(text);
      if (!normalized) {
        continue;
      }
      if (aliases.indexOf(normalized) !== -1) {
        return text;
      }
    }
    return null;
  }

  function buildCombatQueueAnchorAction(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    return {
      mode: opts.mode === "skill" && Number.isFinite(opts.slot) ? "skill" : "basic",
      slot: opts.mode === "skill" && Number.isFinite(opts.slot) ? opts.slot : null,
      name: resolveCombatQueueActionName(opts.mode === "skill" ? "skill" : "basic", opts.name || ""),
      source: opts.source || null
    };
  }

  function armCombatActionQueue(action, meta) {
    if (!action || !action.mode) {
      return null;
    }
    const liveState = meta && meta.liveState ? meta.liveState : readBasicState();
    const queue = getCombatQueueRuntime();
    queue.active = true;
    queue.mode = action.mode;
    queue.slot = Number.isFinite(action.slot) ? action.slot : null;
    queue.name = resolveCombatQueueActionName(action.mode, action.name || "");
    queue.source = action.source || null;
    queue.anchorMode = meta && meta.anchorMode ? meta.anchorMode : null;
    queue.anchorSlot = meta && Number.isFinite(meta.anchorSlot) ? meta.anchorSlot : null;
    queue.anchorName = meta && meta.anchorName ? resolveCombatQueueActionName(meta.anchorMode, meta.anchorName) : null;
    queue.anchorSource = meta && meta.anchorSource ? meta.anchorSource : null;
    queue.openerSlot = meta && Number.isFinite(meta.openerSlot) ? meta.openerSlot : null;
    queue.openerName = meta && meta.openerName ? meta.openerName : null;
    queue.armedAt = Date.now();
    queue.firedAt = null;
    queue.clearedAt = null;
    queue.clearReason = null;
    queue.lastMatchedCastText = null;
    queue.advanceCount = 0;
    queue.anchorNeedsReset = false;
    queue.targetHpMaxAtArm =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.max)
        ? liveState.combat.targetHp.max
        : null;
    queue.enemyCountAtArm =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : null;
    queue.postRetargetGuarded = !!(meta && meta.postRetargetGuarded);
    return queue;
  }

  function fireCombatActionQueue(userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const queue = getCombatQueueRuntime();
    if (!queue.active) {
      return { fired: false, reason: "no_active_queue" };
    }
    if (Runtime.autoFarm.stopRequested) {
      clearCombatActionQueue("stop_requested_before_queue_fire");
      return { fired: false, reason: "stop_requested" };
    }
    const liveState = opts.liveState || readBasicState();
    const targetNow =
      liveState &&
      liveState.combat &&
      liveState.combat.targetHp &&
      liveState.combat.targetHp.valid &&
      Number.isFinite(liveState.combat.targetHp.cur) &&
      liveState.combat.targetHp.cur > 0
        ? liveState.combat.targetHp
        : null;
    if (!targetNow) {
      clearCombatActionQueue("no_live_target_before_queue_fire");
      return { fired: false, reason: "no_live_target" };
    }
    if (Number.isFinite(queue.targetHpMaxAtArm) && Number.isFinite(targetNow.max) && queue.targetHpMaxAtArm !== targetNow.max) {
      clearCombatActionQueue("target_changed_before_queue_fire");
      return { fired: false, reason: "target_changed" };
    }
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : null;
    if (Number.isFinite(enemyCount) && enemyCount <= 0) {
      clearCombatActionQueue("no_enemies_before_queue_fire");
      return { fired: false, reason: "no_enemies" };
    }
    const matchedCastText = findCombatQueueAnchorCastMatch(queue);
    if (queue.anchorNeedsReset) {
      if (matchedCastText) {
        return { fired: false, reason: "anchor_cast_not_reset_yet" };
      }
      queue.anchorNeedsReset = false;
      return { fired: false, reason: "anchor_cast_reset_wait" };
    }
    if (!matchedCastText) {
      return { fired: false, reason: "anchor_not_casting_yet" };
    }
    if (!queue.mode) {
      clearCombatActionQueue("no_pending_queue_action", {
        anchorMode: queue.anchorMode,
        anchorSlot: queue.anchorSlot,
        anchorName: queue.anchorName,
        anchorSource: queue.anchorSource
      });
      return { fired: false, reason: "no_pending_queue_action" };
    }
    const queuedAction = {
      mode: queue.mode,
      slot: Number.isFinite(queue.slot) ? queue.slot : null,
      name: resolveCombatQueueActionName(queue.mode, queue.name || ""),
      source: queue.source || null
    };
    let clicked = false;
    if (queuedAction.mode === "skill" && Number.isFinite(queuedAction.slot)) {
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(queuedAction.slot)) {
        clearCombatActionQueue("queued_skill_cooldown_hint", {
          mode: queuedAction.mode,
          slot: queuedAction.slot,
          name: queuedAction.name,
          source: queuedAction.source,
          anchorMode: queue.anchorMode,
          anchorSlot: queue.anchorSlot,
          anchorName: queue.anchorName,
          anchorSource: queue.anchorSource
        });
        return { fired: false, reason: "cooldown_or_blocked_hint" };
      }
      const row = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots[queuedAction.slot] : null;
      if (!row || row.kind !== "skill" || !row.isAttack || !row.targetsEnemy || !plannerSkillHasDirectDamageForOpener(row)) {
        clearCombatActionQueue("queued_skill_invalid", {
          mode: queuedAction.mode,
          slot: queuedAction.slot,
          name: queuedAction.name,
          source: queuedAction.source,
          anchorMode: queue.anchorMode,
          anchorSlot: queue.anchorSlot,
          anchorName: queue.anchorName,
          anchorSource: queue.anchorSource
        });
        return { fired: false, reason: "skill_invalid" };
      }
      if (typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(row)) {
        clearCombatActionQueue("queued_skill_charge_disallowed", {
          mode: queuedAction.mode,
          slot: queuedAction.slot,
          name: row.name || queuedAction.name || null,
          source: queuedAction.source,
          anchorMode: queue.anchorMode,
          anchorSlot: queue.anchorSlot,
          anchorName: queue.anchorName,
          anchorSource: queue.anchorSource
        });
        return { fired: false, reason: "charge_disallowed" };
      }
      const manaCost = Number.isFinite(row.manaCost) ? row.manaCost : 0;
      const mpCur =
        liveState &&
        liveState.player &&
        liveState.player.mp &&
        liveState.player.mp.valid &&
        Number.isFinite(liveState.player.mp.cur)
          ? liveState.player.mp.cur
          : null;
      if (manaCost > 0 && Number.isFinite(mpCur) && mpCur < manaCost) {
        clearCombatActionQueue("queued_skill_mp_gate", {
          mode: queuedAction.mode,
          slot: queuedAction.slot,
          name: row.name || queuedAction.name || null,
          source: queuedAction.source,
          anchorMode: queue.anchorMode,
          anchorSlot: queue.anchorSlot,
          anchorName: queue.anchorName,
          anchorSource: queue.anchorSource
        });
        return { fired: false, reason: "mp_gate" };
      }
      clicked = clickActionBarSlot(queuedAction.slot);
    } else if (queuedAction.mode === "basic") {
      clicked = clickBasicAttack();
    } else {
      clearCombatActionQueue("bad_queue_mode", {
        mode: queuedAction.mode,
        slot: queuedAction.slot,
        name: queuedAction.name,
        source: queuedAction.source,
        anchorMode: queue.anchorMode,
        anchorSlot: queue.anchorSlot,
        anchorName: queue.anchorName,
        anchorSource: queue.anchorSource
      });
      return { fired: false, reason: "bad_queue_mode" };
    }
    if (!clicked) {
      clearCombatActionQueue("queue_click_failed", {
        mode: queuedAction.mode,
        slot: queuedAction.slot,
        name: queuedAction.name,
        source: queuedAction.source,
        anchorMode: queue.anchorMode,
        anchorSlot: queue.anchorSlot,
        anchorName: queue.anchorName,
        anchorSource: queue.anchorSource
      });
      return { fired: false, reason: "click_failed" };
    }
    queue.firedAt = Date.now();
    queue.lastMatchedCastText = matchedCastText;
    queue.advanceCount = Number.isFinite(queue.advanceCount) ? (queue.advanceCount + 1) : 1;
    Logger.log("COMBAT", "Queued combat action fired", {
      mode: queuedAction.mode,
      slot: queuedAction.slot,
      name: queuedAction.name,
      source: queuedAction.source,
      matchedCastText: matchedCastText,
      anchorMode: queue.anchorMode,
      anchorSlot: queue.anchorSlot,
      anchorName: queue.anchorName,
      anchorSource: queue.anchorSource,
      openerSlot: queue.openerSlot,
      openerName: queue.openerName
    });
    plannerRecordOpenerRuntimeEvent("queued_action_fired", {
      mode: queuedAction.mode,
      slot: queuedAction.slot,
      openerSlot: queue.openerSlot
    });
    queue.anchorMode = queuedAction.mode;
    queue.anchorSlot = queuedAction.slot;
    queue.anchorName = queuedAction.name;
    queue.anchorSource = queuedAction.source;
    queue.anchorNeedsReset = true;
    const postQueueState = readBasicState();
    const nextQueuedAction =
      typeof plannerBuildCombatQueueAction === "function"
        ? plannerBuildCombatQueueAction({
            afterSlot: queuedAction.mode === "skill" ? queuedAction.slot : null,
            liveState: postQueueState,
            disallowChargeSkills: opts.disallowChargeSkills !== false
          })
        : null;
    if (!nextQueuedAction || !nextQueuedAction.mode) {
      clearCombatActionQueue("no_followup_after_queue_fire", {
        anchorMode: queue.anchorMode,
        anchorSlot: queue.anchorSlot,
        anchorName: queue.anchorName,
        anchorSource: queue.anchorSource
      });
      return {
        fired: true,
        mode: queuedAction.mode,
        slot: queuedAction.slot,
        name: queuedAction.name,
        source: queuedAction.source,
        chainContinues: false
      };
    }
    queue.mode = nextQueuedAction.mode;
    queue.slot = Number.isFinite(nextQueuedAction.slot) ? nextQueuedAction.slot : null;
    queue.name = resolveCombatQueueActionName(nextQueuedAction.mode, nextQueuedAction.name || "");
    queue.source = nextQueuedAction.source || null;
    queue.armedAt = Date.now();
    queue.targetHpMaxAtArm =
      postQueueState &&
      postQueueState.combat &&
      postQueueState.combat.targetHp &&
      postQueueState.combat.targetHp.valid &&
      Number.isFinite(postQueueState.combat.targetHp.max)
        ? postQueueState.combat.targetHp.max
        : null;
    queue.enemyCountAtArm =
      postQueueState && postQueueState.combat && Number.isFinite(postQueueState.combat.enemyCount)
        ? postQueueState.combat.enemyCount
        : null;
    return {
      fired: true,
      mode: queuedAction.mode,
      slot: queuedAction.slot,
      name: queuedAction.name,
      source: queuedAction.source,
      chainContinues: true,
      nextMode: queue.mode,
      nextSlot: queue.slot,
      nextName: queue.name,
      nextSource: queue.source
    };
  }

  // AI CHANGED: After attackers-popup re-target, the first HP>0 verify already happened inside clickAttackersRetargetVerified(); cancel immediately from that confirmed state.
  async function performPostAttackersRetargetCancel() {
    const now = readBasicState();
    const targetReady = !!(
      now &&
      now.combat &&
      now.combat.targetHp &&
      now.combat.targetHp.valid &&
      Number.isFinite(now.combat.targetHp.cur) &&
      now.combat.targetHp.cur > 0
    );
    if (!targetReady) {
      return { ok: false, reason: "target_lost_before_post_attackers_cancel" };
    }
    const clickedCancel = clickChargingSkillCancelUi();
    const settleMs = Number.isFinite(Config.combat && Config.combat.postRankedSkillClickSettleMs)
      ? Math.max(0, Config.combat.postRankedSkillClickSettleMs)
      : 0;
    if (clickedCancel && settleMs > 0) {
      await sleep(settleMs);
    }
    return {
      ok: true,
      clickedCancel: clickedCancel,
      targetHpCur:
        now &&
        now.combat &&
        now.combat.targetHp &&
        now.combat.targetHp.valid &&
        Number.isFinite(now.combat.targetHp.cur)
          ? now.combat.targetHp.cur
          : null
    };
  }

  // AI CHANGED: Phase C4 slice 8 — first swing: ranked attack skill (if enabled + pick), else basic attack.
  // AI CHANGED: slice 9 — optional opts.useRankedSkillOpener === false forces basic-only (follow-up bursts).
  // AI CHANGED: slice 22 — combat opener is tap-only (clickActionBarSlot); no synthetic bar hold — game uses tap for skills including charge start.
  // AI CHANGED: slice 15 — excludeSlots skips bar indices already used this burst (alternate ranked openers).
  async function clickPlannerOpeningAttack(opts, excludeSlots) {
    const useSkill =
      Config.planner.useRankedAttackSkillsInCombat &&
      (!opts || opts.useRankedSkillOpener !== false);
    if (useSkill) {
      const opening = plannerPickSkillOpeningPick({
        excludeSlots: excludeSlots || [],
        disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
      });
      if (opening != null) {
        const ok = clickActionBarSlot(opening.slot); // AI CHANGED: slice 22 — always normal bar click
        if (ok) {
          plannerRecordOpenerRuntimeEvent("ranked_pick", { slot: opening.slot, excluded: (excludeSlots || []).slice(0, 8) });
          Logger.log("PLANNER", "Opening attack used ranked skill slot", { slot: opening.slot });
          return {
            ok: true,
            skillSlot: opening.slot,
            skillRecord: opening.record || null,
            chargeReleasePlan: opening.chargeReleasePlan || null,
            queuedAction: opening.queuedAction || null
          };
        }
        plannerRecordOpenerRuntimeEvent("ranked_click_failed", { slot: opening.slot });
        Logger.warn("PLANNER", "Ranked skill slot click failed; falling back to basic attack", { slot: opening.slot });
      } else {
        plannerRecordOpenerRuntimeEvent("ranked_pick_none", {
          reason: Runtime.planner && Runtime.planner.lastOpeningPickReason ? Runtime.planner.lastOpeningPickReason : null
        });
      }
    }
    const basicOk = clickBasicAttack();
    const basicQueuedAction =
      basicOk &&
      !(opts && opts.allowCombatQueue === false) &&
      Config.combat &&
      Config.combat.combatQueueEnabled !== false &&
      typeof plannerBuildCombatQueueAction === "function"
        ? plannerBuildCombatQueueAction({
            afterSlot: null,
            liveState: readBasicState(),
            disallowChargeSkills: true
          })
        : null;
    return { ok: basicOk, skillSlot: null, skillRecord: null, chargeReleasePlan: null, queuedAction: basicQueuedAction };
  }

  // AI CHANGED: slice 8b — true if enemy died (count) or target red bar dropped (same max HP baseline).
  function hasCombatProgressSince(baselineState) {
    return function () {
      const now = readBasicState();
      if (
        typeof baselineState.combat.enemyCount === "number" &&
        typeof now.combat.enemyCount === "number" &&
        now.combat.enemyCount < baselineState.combat.enemyCount
      ) {
        return true;
      }
      const b = baselineState.combat.targetHp;
      const t = now.combat.targetHp;
      if (b && b.valid && t && t.valid && b.max === t.max && t.cur < b.cur) {
        return true;
      }
      return false;
    };
  }

  function buildAttackProgressOrQueueAdvancePredicate(baselineState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    const progressCheck = hasCombatProgressSince(baselineState);
    return function () {
      if (progressCheck()) {
        return true;
      }
      if (typeof opts.onQueueAdvance === "function") {
        try {
          opts.onQueueAdvance();
        } catch (error) {
          Logger.warn("COMBAT", "Queue advance tick failed", error);
        }
      }
      return false;
    };
  }

  // AI CHANGED: Charge skills land damage on release (cancel/full charge), not during the hold itself. Run a dedicated release plan before generic "no progress" fallback logic.
  async function handleChargeSkillOpener(beforeState, open, settleRanked, pollMs, fullTimeoutMs) {
    const chargePlan =
      open && open.chargeReleasePlan
        ? open.chargeReleasePlan
        : (
            open && open.skillRecord && typeof plannerBuildChargeReleasePlan === "function"
              ? plannerBuildChargeReleasePlan(open.skillRecord)
              : null
          );
    if (!chargePlan) {
      return { handled: false, progressed: false };
    }
    Logger.log("LOOP", "Charge skill opener plan", {
      slot: open.skillSlot,
      releaseMs: chargePlan.releaseMs,
      releaseFraction: chargePlan.releaseFraction,
      strategy: chargePlan.strategy,
      source: chargePlan.releaseSource,
      selectionMode: chargePlan.selectionMode || null,
      candidateCount: Array.isArray(chargePlan.candidates) ? chargePlan.candidates.length : 0
    });
    if (chargePlan.releaseMs > 0) {
      await sleep(chargePlan.releaseMs);
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested during charge hold");
      return { handled: true, progressed: false };
    }
    const cancelReleaseTimeoutRaw = Config.combat.chargeSkillReleaseProgressTimeoutMs;
    const cancelReleaseTimeout =
      Number.isFinite(cancelReleaseTimeoutRaw) && cancelReleaseTimeoutRaw > 0
        ? Math.min(cancelReleaseTimeoutRaw, fullTimeoutMs)
        : Math.min(2200, fullTimeoutMs);
    if (chargePlan.strategy === "cancel_release") {
      if (isChargingSkillCancelHintVisible()) {
        Logger.log("LOOP", "Charge skill release via cancel UI", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction
        });
        clickChargingSkillCancelUi();
        if (settleRanked > 0) {
          await sleep(settleRanked);
        }
        if (Runtime.autoFarm.stopRequested) {
          return { handled: true, progressed: false };
        }
      } else {
        Logger.warn("LOOP", "Charge release hint missing at planned release time", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction
        });
      }
    } else {
      const fullPadRaw = Config.combat.chargeSkillFullReleasePaddingMs;
      const fullPadMs = Number.isFinite(fullPadRaw) && fullPadRaw >= 0 ? fullPadRaw : 180;
      if (fullPadMs > 0) {
        await sleep(fullPadMs);
      }
      if (Runtime.autoFarm.stopRequested) {
        return { handled: true, progressed: false };
      }
    }
    const fullChargeTimeoutRaw = Config.combat.chargeSkillFullChargeProgressTimeoutMs;
    const fullChargeTimeout =
      Number.isFinite(fullChargeTimeoutRaw) && fullChargeTimeoutRaw > 0
        ? Math.min(fullChargeTimeoutRaw, fullTimeoutMs)
        : Math.min(650, fullTimeoutMs);
    const progressed = await waitForCondition(
      chargePlan.strategy === "full_charge" ? "attack progress after full charge" : "attack progress after charge release",
      hasCombatProgressSince(beforeState),
      { timeoutMs: chargePlan.strategy === "full_charge" ? fullChargeTimeout : cancelReleaseTimeout, pollMs: pollMs }
    );
    if (progressed) {
      plannerRecordOpenerRuntimeEvent("ranked_progress", {
        slot: open.skillSlot,
        stage: chargePlan.strategy === "full_charge" ? "after_full_charge" : "after_charge_release"
      });
    }
    return { handled: true, progressed: progressed };
  }

  // AI CHANGED: Added helper to verify attack effect by enemy count drop or target HP change.
  // AI CHANGED: slice 9 — opts.useRankedSkillOpener (default true) gates ranked opener vs basic-only burst.
  async function attackUntilProgress(beforeState, opts) {
    if (getCombatQueueRuntime().active) {
      clearCombatActionQueue("new_attack_cycle");
    }
    const fullTimeoutMs = Number.isFinite(Config.combat.attackProgressTimeoutMs)
      ? Config.combat.attackProgressTimeoutMs
      : 4500;
    const firstRankedTimeoutRaw = Config.combat.rankedOpenerFirstProgressTimeoutMs;
    const firstRankedTimeoutMs =
      Number.isFinite(firstRankedTimeoutRaw) && firstRankedTimeoutRaw > 0
        ? firstRankedTimeoutRaw
        : fullTimeoutMs;
    const pollMs = Number.isFinite(Config.combat.attackProgressPollMs)
      ? Config.combat.attackProgressPollMs
      : 140;

    const open = await clickPlannerOpeningAttack(opts, []);
    if (!open.ok) {
      Logger.warn("LOOP", "Attack loop aborted: no attack click succeeded");
      return false;
    }

    // AI CHANGED: slice 23 — let the client apply tap-cast before we poll target HP / enemy count.
    const settleRanked = Number.isFinite(Config.combat.postRankedSkillClickSettleMs)
      ? Config.combat.postRankedSkillClickSettleMs
      : 0;
    if (open.skillSlot != null && settleRanked > 0) {
      await sleep(settleRanked);
    }
    const isChargeOpening =
      !!(
        open &&
        open.skillRecord &&
        typeof plannerGetChargeSkillEffect === "function" &&
        plannerGetChargeSkillEffect(open.skillRecord)
      );
    const queueAllowed =
      !(opts && opts.allowCombatQueue === false) &&
      Config.combat &&
      Config.combat.combatQueueEnabled !== false &&
      !isChargeOpening;
    let queuedActionFired = false;
    const queueAdvanceTick = function () {
      if (!queueAllowed || !getCombatQueueRuntime().active) {
        return;
      }
      const queueFire = fireCombatActionQueue({
        liveState: readBasicState(),
        disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
      });
      if (queueFire && queueFire.fired) {
        queuedActionFired = true;
      }
    };
    if (queueAllowed && open && open.queuedAction) {
      const queuedState = armCombatActionQueue(open.queuedAction, {
        anchorMode: open.skillSlot != null ? "skill" : "basic",
        anchorSlot: open.skillSlot,
        anchorName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : "Basic Attack",
        anchorSource: open.skillSlot != null ? "opening_attack" : "opening_basic",
        openerSlot: open.skillSlot,
        openerName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : (open.skillSlot == null ? "Basic Attack" : null),
        liveState: readBasicState(),
        postRetargetGuarded: !!(opts && opts.firstBurstAfterRetarget)
      });
      if (queuedState) {
        Logger.log("COMBAT", "Queued combat action armed", {
          mode: queuedState.mode,
          slot: queuedState.slot,
          name: queuedState.name,
          source: queuedState.source,
          anchorMode: queuedState.anchorMode,
          anchorSlot: queuedState.anchorSlot,
          anchorName: queuedState.anchorName,
          openerSlot: queuedState.openerSlot,
          postRetargetGuarded: queuedState.postRetargetGuarded
        });
        plannerRecordOpenerRuntimeEvent("queued_action_armed", {
          mode: queuedState.mode,
          slot: queuedState.slot,
          openerSlot: queuedState.openerSlot
        });
      }
    }

    const chargeOutcome = await handleChargeSkillOpener(beforeState, open, settleRanked, pollMs, fullTimeoutMs);
    const chargeSkillHandled = !!(chargeOutcome && chargeOutcome.handled);
    if (chargeSkillHandled) {
      if (chargeOutcome.progressed) {
        if (queuedActionFired) {
          const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
            ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
            : 0;
          if (queueSettleMs > 0) {
            await sleep(queueSettleMs);
          }
        }
        return true;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after charge-skill handling");
        return false;
      }
    }

    // AI CHANGED: slice 25 — optional grace so slow-starting charge skills register before HP polling.
    const chargeGraceRaw = Config.combat.rankedOpenerChargeGraceMs;
    const chargeGraceMs =
      !chargeSkillHandled && open.skillSlot != null && Number.isFinite(chargeGraceRaw) && chargeGraceRaw > 0 ? chargeGraceRaw : 0;
    if (chargeGraceMs > 0) {
      await sleep(chargeGraceMs);
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after charge grace; skipping follow-up");
      return false;
    }

    let chargeCancelAttempted = false;
    let progressed = false;
    if (!chargeSkillHandled) {
      const firstWaitTimeoutMs =
        open.skillSlot != null ? firstRankedTimeoutMs : fullTimeoutMs; // AI CHANGED: slice 23 — fast fallback when first ranked pick does nothing observable
      if (open.skillSlot != null && firstWaitTimeoutMs < fullTimeoutMs) {
        Logger.log("LOOP", "attack progress wait (first ranked opener)", {
          timeoutMs: firstWaitTimeoutMs,
          fullTimeoutMs: fullTimeoutMs,
          slot: open.skillSlot
        });
      }

      const earlyCancelRaw = Config.combat.rankedOpenerEarlyCancelIfHintAfterMs;
      const earlyCancelMs =
        open.skillSlot != null &&
        Number.isFinite(earlyCancelRaw) &&
        earlyCancelRaw > 0 &&
        earlyCancelRaw < firstWaitTimeoutMs
          ? earlyCancelRaw
          : 0;

      if (earlyCancelMs > 0) {
        progressed = await waitForCondition(
          "attack progress (early window)",
          buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
          { timeoutMs: earlyCancelMs, pollMs: pollMs }
        );
        if (progressed) {
          if (open.skillSlot != null) {
            plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "early_or_late_wait" });
          }
          if (queuedActionFired) {
            const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
              ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
              : 0;
            if (queueSettleMs > 0) {
              await sleep(queueSettleMs);
            }
          }
          return true;
        }
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("LOOP", "attackUntilProgress: stop requested after early opener wait");
          return false;
        }
        if (
          Config.combat.rankedOpenerClickCancelUiIfChargeStuck !== false &&
          isChargingSkillCancelHintVisible()
        ) {
          Logger.log("LOOP", "ranked opener early charge cancel (hint after partial wait)", {
            earlyCancelMs: earlyCancelMs,
            slot: open.skillSlot
          });
          clickChargingSkillCancelUi();
          chargeCancelAttempted = true;
          if (settleRanked > 0) {
            await sleep(settleRanked);
          }
          if (Runtime.autoFarm.stopRequested) {
            return false;
          }
          progressed = await waitForCondition(
            "attack progress after early charge cancel",
            buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
            { timeoutMs: fullTimeoutMs, pollMs: pollMs }
          );
          if (progressed) {
            plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "after_early_cancel" });
            if (queuedActionFired) {
              const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
                ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
                : 0;
              if (queueSettleMs > 0) {
                await sleep(queueSettleMs);
              }
            }
            return true;
          }
        } else {
          progressed = await waitForCondition(
            "attack progress (late window)",
            buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
            { timeoutMs: firstWaitTimeoutMs - earlyCancelMs, pollMs: pollMs }
          );
          if (progressed) {
            if (open.skillSlot != null) {
              plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "late_window" });
            }
            if (queuedActionFired) {
              const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
                ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
                : 0;
              if (queueSettleMs > 0) {
                await sleep(queueSettleMs);
              }
            }
            return true;
          }
        }
      } else {
        progressed = await waitForCondition(
          "attack progress",
          buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
          { timeoutMs: firstWaitTimeoutMs, pollMs: pollMs }
        );
        if (progressed) {
          if (open.skillSlot != null) {
            plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "first_wait" });
          }
          if (queuedActionFired) {
            const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
              ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
              : 0;
            if (queueSettleMs > 0) {
              await sleep(queueSettleMs);
            }
          }
          return true;
        }
      }
    }

    // AI CHANGED: slice 21b — stop-aborted wait must not fall through to more clicks (alternate opener / basic).
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after opener wait; skipping follow-up attacks");
      return false;
    }

    // AI CHANGED: slice 24b — charge skill stuck: first wait saw no HP/count (CD not running until cancel or full shot). Tap cancel UI only when needed, not a second bar click.
    if (
      !chargeSkillHandled &&
      !chargeCancelAttempted &&
      open.skillSlot != null &&
      Config.combat.rankedOpenerClickCancelUiIfChargeStuck !== false &&
      isChargingSkillCancelHintVisible()
    ) {
      Logger.log("LOOP", "Charge cancel hint visible after opener wait; map-gap / cancel UI (not bar slot)", {
        slot: open.skillSlot
      });
      clickChargingSkillCancelUi();
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      if (Runtime.autoFarm.stopRequested) {
        return false;
      }
      // AI CHANGED: Resume damage immediately after cancel — don't stand idle for full attackProgressTimeoutMs (hero takes free hits).
      clickBasicAttack();
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      if (Runtime.autoFarm.stopRequested) {
        return false;
      }
      const postCancelTimeoutRaw = Config.combat.attackProgressAfterChargeCancelTimeoutMs;
      const postCancelTimeout =
        Number.isFinite(postCancelTimeoutRaw) && postCancelTimeoutRaw > 0
          ? Math.min(postCancelTimeoutRaw, fullTimeoutMs)
          : Math.min(3200, fullTimeoutMs);
      progressed = await waitForCondition(
        "attack progress after charge cancel ui",
        buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
        { timeoutMs: postCancelTimeout, pollMs: pollMs }
      );
      if (progressed) {
        plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open.skillSlot, stage: "after_charge_cancel" });
        if (queuedActionFired) {
          const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
            ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
            : 0;
          if (queueSettleMs > 0) {
            await sleep(queueSettleMs);
          }
        }
        return true;
      }
    }
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after charge-cancel wait");
      return false;
    }

    // AI CHANGED: slice 15 — try next ranked opener(s) before basic if first skill had no verified effect.
    const extra = Number.isFinite(Config.planner.openerExtraRankedSkills)
      ? Config.planner.openerExtraRankedSkills
      : 0;
    const triedSlots =
      open.skillSlot != null && typeof open.skillSlot === "number" ? [open.skillSlot] : [];
    for (let alt = 0; alt < extra; alt += 1) {
      if (triedSlots.length === 0) {
        break;
      }
      const open2 = await clickPlannerOpeningAttack(opts, triedSlots.slice());
      if (!open2.ok || open2.skillSlot == null) {
        break;
      }
      Logger.log("PLANNER", "Alternate ranked opener after no progress", {
        slot: open2.skillSlot,
        attempt: alt + 1
      });
      plannerRecordOpenerRuntimeEvent("ranked_alt_pick", { slot: open2.skillSlot, attempt: alt + 1 });
      if (queueAllowed && open2 && open2.queuedAction) {
        armCombatActionQueue(open2.queuedAction, {
          anchorMode: "skill",
          anchorSlot: open2.skillSlot,
          anchorName: open2.skillRecord && open2.skillRecord.name ? open2.skillRecord.name : "",
          anchorSource: "alternate_ranked_opening",
          openerSlot: open.skillSlot,
          openerName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : (open.skillSlot == null ? "Basic Attack" : null),
          liveState: readBasicState(),
          postRetargetGuarded: !!(opts && opts.firstBurstAfterRetarget)
        });
      }
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      progressed = await waitForCondition(
        "attack progress",
        buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
        { timeoutMs: fullTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        plannerRecordOpenerRuntimeEvent("ranked_progress", { slot: open2.skillSlot, stage: "alternate_wait" });
        if (queuedActionFired) {
          const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
            ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
            : 0;
          if (queueSettleMs > 0) {
            await sleep(queueSettleMs);
          }
        }
        return true;
      }
      // AI CHANGED: slice 21b — same as primary opener: do not chain more attacks after Stop.
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after alternate opener wait");
        return false;
      }
      triedSlots.push(open2.skillSlot);
    }

    if (triedSlots.length > 0) {
      plannerRecordOpenerRuntimeEvent("basic_fallback_after_ranked", { triedSlots: triedSlots.slice(0, 8) });
      Logger.warn("PLANNER", "Ranked opener(s) had no verified progress; trying basic attack", {
        triedSlots: triedSlots
      });
      const baselineAfterSkill = readBasicState();
      if (!clickBasicAttack()) {
        Logger.warn("LOOP", "Basic attack click failed after skill opener");
        return false;
      }
      if (queueAllowed && typeof plannerBuildCombatQueueAction === "function") {
        const basicFallbackQueuedAction = plannerBuildCombatQueueAction({
          afterSlot: null,
          liveState: readBasicState(),
          disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
        });
        if (basicFallbackQueuedAction && basicFallbackQueuedAction.mode) {
          armCombatActionQueue(basicFallbackQueuedAction, {
            anchorMode: "basic",
            anchorSlot: null,
            anchorName: "Basic Attack",
            anchorSource: "basic_fallback_after_ranked",
            openerSlot: open.skillSlot,
            openerName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : (open.skillSlot == null ? "Basic Attack" : null),
            liveState: readBasicState(),
            postRetargetGuarded: !!(opts && opts.firstBurstAfterRetarget)
          });
        }
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested before basic-attack wait");
        return false;
      }
      progressed = await waitForCondition(
        "attack progress",
        buildAttackProgressOrQueueAdvancePredicate(baselineAfterSkill, { onQueueAdvance: queueAdvanceTick }),
        { timeoutMs: fullTimeoutMs, pollMs: pollMs }
      );
      if (progressed) {
        if (queuedActionFired) {
          const queueSettleMs = Number.isFinite(Config.combat && Config.combat.combatQueuePostProgressSettleMs)
            ? Math.max(0, Config.combat.combatQueuePostProgressSettleMs)
            : 0;
          if (queueSettleMs > 0) {
            await sleep(queueSettleMs);
          }
        }
        return true;
      }
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "attackUntilProgress: stop requested after basic-attack wait");
        return false;
      }
    }

    Logger.warn("LOOP", "No attack progress detected (enemy count + target HP unchanged for baseline)");
    clearCombatActionQueue("no_progress_detected");
    if (triedSlots.length > 0 || open.skillSlot != null) {
      plannerRecordOpenerRuntimeEvent("ranked_no_progress", {
        initialSlot: open.skillSlot,
        triedSlots: triedSlots.slice(0, 8)
      });
    }
    return false;
  }

  // AI CHANGED: Phase C4 -- optional enemy DB refresh during auto-farm (Config.planner.recordEnemyDbBeforeAttack).
  function plannerMaybeRecordEnemyBeforeAttack() {
    if (!Config.planner.recordEnemyDbBeforeAttack) {
      return null;
    }
    try {
      const rec = recordTargetToEnemyDb();
      if (rec) {
        Logger.log("PLANNER", "Enemy DB row refreshed before attack", { key: rec.key });
      }
      return rec;
    } catch (err) {
      Logger.warn("PLANNER", "recordTargetToEnemyDb failed", err);
      return null;
    }
  }

  // AI CHANGED: Step 4 — effective ranked bursts per find cycle with legacy fallback.
  function getRankedBurstsPerFindEffective() {
    if (!Config.planner.useRankedAttackSkillsInCombat) {
      return 0;
    }
    if (Number.isFinite(Config.planner.rankedBurstsPerFind) && Config.planner.rankedBurstsPerFind >= 0) {
      return Math.floor(Config.planner.rankedBurstsPerFind);
    }
    return Config.planner.useRankedSkillOnlyFirstBurstAfterFind ? 1 : Number.MAX_SAFE_INTEGER;
  }

  // AI CHANGED: Phase C4 -- one-line hint after combat clears (Config.planner.logPlannerAfterSecureTile).
  function plannerMaybeLogAfterSecureCombat() {
    if (!Config.planner.logPlannerAfterSecureTile) {
      return;
    }
    const key = Runtime.enemy.lastFoughtKey;
    let calibrated = false;
    if (key && Runtime.enemy.db && Runtime.enemy.db.length) {
      const row = Runtime.enemy.db.find((r) => r.key === key);
      calibrated = !!(row && row.observeCalAgg && row.observeCalAgg.hpDropSamples > 0);
    }
    Logger.log("PLANNER", "Combat cleared — planner snapshot", {
      lastFoughtKey: key,
      hasHpDropCalibration: calibrated,
      hint: calibrated
        ? null
        : "For hp_drop merge: await ligmarBot.quickCalibrationSession() while attacking a target."
    });
  }

  // AI CHANGED: Added first autonomous secure-current-tile-and-loot cycle with bounded retries.
  async function secureTileAndLootOnce() {
    const startState = readBasicState();
    // AI CHANGED: slice 21 — death / disconnect often reset in-game zoom without reloading the page.
    resetZoomAssumptionIfSessionRisk(startState.session);
    if (typeof startState.combat.enemyCount !== "number") {
      Logger.warn("LOOP", "Cannot start secure loop: enemyCount unavailable");
      return { ok: false, stage: "precheck", reason: "enemy_count_unavailable" };
    }

    // AI CHANGED: Surface secure-tile preparation as live status.
    setBotStatus("preparing", `secure-tile cycle (enemies=${startState.combat.enemyCount})`);
    Logger.log("LOOP", "Secure-tile cycle started", { enemyCount: startState.combat.enemyCount });
    // AI CHANGED: Ensure popup is closed before combat/find actions so attack control is not obscured.
    closeHexPopupIfOpen();

    // AI CHANGED: Removed strict visibility precheck; attack control can appear only after target selection.

    let current = startState;
    let findAttempts = 0;
    while (current.combat.enemyCount > 0 && findAttempts < Config.combat.maxFindEnemyAttempts) {
      // AI CHANGED: slice 21b — do not burn find-enemy attempts or send clicks after user Stop.
      if (Runtime.autoFarm.stopRequested) {
        Logger.log("LOOP", "Secure-tile cycle aborted before find-enemy (stop requested)", {
          attemptsSoFar: findAttempts,
          enemyCount: current.combat.enemyCount
        });
        return {
          ok: false,
          stage: "combat",
          reason: "stop_requested",
          enemyCount: current.combat.enemyCount,
          attempts: findAttempts
        };
      }
      findAttempts += 1;
      // AI CHANGED: Surface find-enemy as live status.
      setBotStatus("finding", `attempt ${findAttempts}/${Config.combat.maxFindEnemyAttempts} (enemies=${current.combat.enemyCount})`);
      Logger.log("LOOP", "Find-enemy attempt", { attempt: findAttempts, enemyCount: current.combat.enemyCount });

      const findResult = await clickFindEnemyVerified();
      if (!findResult.ok) {
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("LOOP", "Secure-tile cycle aborted after find-enemy wait (stop requested)", {
            attempt: findAttempts,
            enemyCount: current.combat.enemyCount
          });
          return {
            ok: false,
            stage: "combat",
            reason: "stop_requested",
            enemyCount: current.combat.enemyCount,
            attempts: findAttempts
          };
        }
        Logger.warn("LOOP", "Find-enemy verification failed", findResult);
        current = readBasicState();
        continue;
      }

      // AI CHANGED: Do not hard-require target HP acquisition; enemyCount-based combat is more reliable.
      const acquired = await waitForTargetAcquired();
      if (!acquired) {
        Logger.warn("LOOP", "Target HP not detected after find-enemy; proceeding by enemy-count logic");
      }

      // AI CHANGED: Skip attack step when enemy count already reached zero after find flow.
      current = readBasicState();
      if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
        Logger.log("LOOP", "Enemies already cleared after find-enemy, skipping attack step");
        break;
      }

      const maxBursts = Number.isFinite(Config.combat.maxCombatAttackBurstsPerFind)
        ? Config.combat.maxCombatAttackBurstsPerFind
        : 24;
      let attackBursts = 0;
      let firstBurstAfterRetarget = false;
      let chargeGuardUntilRetargetProgress = false;
      // AI CHANGED: Step 4 — allow configurable number of ranked bursts per find cycle.
      let rankedBurstsLeft = getRankedBurstsPerFindEffective();
      while (
        typeof current.combat.enemyCount === "number" &&
        current.combat.enemyCount > 0 &&
        attackBursts < maxBursts
      ) {
        if (Runtime.autoFarm.stopRequested) {
          Logger.log("LOOP", "Secure-tile combat bursts aborted (stop requested)", {
            attackBursts: attackBursts,
            findAttempts: findAttempts
          });
          return {
            ok: false,
            stage: "combat",
            reason: "stop_requested",
            enemyCount: current.combat.enemyCount,
            attempts: findAttempts
          };
        }
        attackBursts += 1;
        plannerMaybeRecordEnemyBeforeAttack();

        const useRankedBurst = rankedBurstsLeft > 0;
        await maybeUseCombatSustain(current, {
          reason: useRankedBurst ? "before_ranked_burst" : "before_basic_burst",
          useRankedBurst: useRankedBurst
        });
        current = readBasicState();
        const disallowChargeSkills =
          !!(
            chargeGuardUntilRetargetProgress &&
            Config.combat &&
            Config.combat.disallowChargeSkillFirstBurstAfterRetarget !== false
          );
        if (disallowChargeSkills) {
          Logger.log("LOOP", "Post-retarget charge guard active (until first verified progress)", {
            enemyCount: current.combat.enemyCount,
            attackBursts: attackBursts,
            findAttempts: findAttempts,
            firstBurstAfterRetarget: firstBurstAfterRetarget
          });
        }

        // AI CHANGED: Surface attack as live status (slice 9 — burst index for multi-mob pulls).
        setBotStatus(
          "attacking",
          `engaging target (remaining=${current.combat.enemyCount}, burst=${attackBursts}/${maxBursts}, find=${findAttempts})`
        );
        const beforeAttack = readBasicState();
        const attackProgressed = await attackUntilProgress(beforeAttack, {
          useRankedSkillOpener: useRankedBurst,
          firstBurstAfterRetarget: firstBurstAfterRetarget,
          disallowChargeSkills: disallowChargeSkills,
          allowCombatQueue: !firstBurstAfterRetarget
        });
        firstBurstAfterRetarget = false;
        if (attackProgressed && chargeGuardUntilRetargetProgress) {
          chargeGuardUntilRetargetProgress = false;
          Logger.log("LOOP", "Post-retarget charge guard cleared after first verified progress", {
            enemyCount: current.combat.enemyCount,
            attackBursts: attackBursts,
            findAttempts: findAttempts
          });
        }
        if (!attackProgressed) {
          if (Runtime.autoFarm.stopRequested) {
            Logger.log("LOOP", "Secure-tile cycle aborted after attack burst (stop requested)", {
              attackBursts: attackBursts,
              findAttempts: findAttempts
            });
            return {
              ok: false,
              stage: "combat",
              reason: "stop_requested",
              enemyCount: current.combat.enemyCount,
              attempts: findAttempts
            };
          }
          Logger.warn("LOOP", "No attack progress detected in burst", { attackBursts, findAttempts });
          break;
        }

        if (useRankedBurst && rankedBurstsLeft > 0) {
          rankedBurstsLeft -= 1;
        }

        current = readBasicState();
        const countBeforeBurst =
          typeof beforeAttack.combat.enemyCount === "number" ? beforeAttack.combat.enemyCount : null;
        const countAfterBurst =
          typeof current.combat.enemyCount === "number" ? current.combat.enemyCount : null;
        const killedOnThisBurst =
          countBeforeBurst != null &&
          countAfterBurst != null &&
          countAfterBurst < countBeforeBurst;

        Logger.log("LOOP", "Combat state after burst", {
          enemyCount: current.combat.enemyCount,
          targetHp: current.combat.targetHp,
          attackBursts,
          findAttempts,
          killedOnThisBurst
        });

        // AI CHANGED: slice 9 fix — inner bursts skipped find-enemy between kills; next target/red bar often only updates after find, so attackUntilProgress timed out (~attackProgressTimeoutMs) then outer loop spammed find. Re-acquire only when count dropped but pull not clear.
        if (
          killedOnThisBurst &&
          countAfterBurst != null &&
          countAfterBurst > 0 &&
          attackBursts < maxBursts
        ) {
          if (Runtime.autoFarm.stopRequested) {
            Logger.log("LOOP", "Secure-tile cycle aborted before re-find (stop requested)", {
              attackBursts: attackBursts,
              findAttempts: findAttempts
            });
            return {
              ok: false,
              stage: "combat",
              reason: "stop_requested",
              enemyCount: current.combat.enemyCount,
              attempts: findAttempts
            };
          }
          setBotStatus(
            "finding",
            `re-target after kill (enemies=${countAfterBurst}, burst=${attackBursts}/${maxBursts}, findPass=${findAttempts})`
          );
          Logger.log("LOOP", "Re-find-enemy after kill in multi-mob pull", {
            countBeforeBurst,
            countAfterBurst,
            attackBursts
          });
          let refindOk = null;
          if (
            Config.combat &&
            Config.combat.useAttackersPanelRetargetAfterKill !== false &&
            typeof clickAttackersRetargetVerified === "function"
          ) {
            refindOk = await clickAttackersRetargetVerified();
            if (refindOk && refindOk.ok) {
              Logger.log("LOOP", "Retargeted next enemy via attackers popup", refindOk);
            } else {
              Logger.warn("LOOP", "Attackers popup retarget failed; falling back to find-enemy", refindOk);
            }
          }
          if (!refindOk || !refindOk.ok) {
            refindOk = await clickFindEnemyVerified();
          }
          if (!refindOk.ok) {
            if (Runtime.autoFarm.stopRequested) {
              Logger.log("LOOP", "Secure-tile cycle aborted after re-find wait (stop requested)", {
                attackBursts: attackBursts,
                findAttempts: findAttempts
              });
              return {
                ok: false,
                stage: "combat",
                reason: "stop_requested",
                enemyCount: current.combat.enemyCount,
                attempts: findAttempts
              };
            }
            Logger.warn("LOOP", "Re-find-enemy after burst failed", refindOk);
            break;
          }
          if (!refindOk || refindOk.via !== "attackers_popup") {
            const reAcquired = await waitForTargetAcquired();
            if (!reAcquired) {
              Logger.warn("LOOP", "Target HP not detected after re-find; continuing by enemy-count logic");
            }
          }
          if (refindOk && refindOk.via === "attackers_popup") {
            const postRetargetCancel = await performPostAttackersRetargetCancel();
            if (!postRetargetCancel.ok) {
              Logger.warn("LOOP", "Post-attackers-retarget cancel pre-step failed", postRetargetCancel);
              break;
            }
            Logger.log("LOOP", "Post-attackers-retarget cancel pre-step complete", postRetargetCancel);
          }
          current = readBasicState();
          if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
            Logger.log("LOOP", "Enemies cleared during re-find after kill");
            break;
          }
          firstBurstAfterRetarget = true;
          chargeGuardUntilRetargetProgress = true;
          rankedBurstsLeft = getRankedBurstsPerFindEffective();
        }
      }
    }

    if (Runtime.autoFarm.stopRequested && typeof current.combat.enemyCount === "number" && current.combat.enemyCount > 0) {
      Logger.log("LOOP", "Secure-tile cycle ended with enemies present (stop requested)", {
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      });
      return {
        ok: false,
        stage: "combat",
        reason: "stop_requested",
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      };
    }

    if (current.combat.enemyCount > 0) {
      Logger.warn("LOOP", "Secure loop stopped with enemies still alive", {
        enemyCount: current.combat.enemyCount,
        attempts: findAttempts
      });
      return { ok: false, stage: "combat", enemyCount: current.combat.enemyCount, attempts: findAttempts };
    }

    plannerMaybeLogAfterSecureCombat();

    // AI CHANGED: Surface loot as live status (clickLootOrActivateVerified internally handles "no loot" no-op).
    setBotStatus("looting", "collecting loot / activating event");
    const lootResult = await clickLootOrActivateVerified();
    if (!lootResult.ok) {
      Logger.warn("LOOP", "Loot verification failed", lootResult);
      return { ok: false, stage: "loot", result: lootResult };
    }
    if (lootResult.skipped) {
      Logger.log("LOOP", "Secure-tile cycle completed (no loot on tile)");
      return { ok: true, stage: "done_no_loot", loot: lootResult };
    }

    Logger.log("LOOP", "Secure-tile cycle completed");
    return { ok: true, stage: "done" };
  }

  // AI CHANGED: Map prep only before each combat cycle; ring scan lives in exploreByScan/scanNeighborRing, not here.
  async function prepMapForCombatCycle() {
    const mapResult = await ensureMapOpen();
    if (!mapResult.ok) {
      Logger.warn("MAP", "Prep for combat cycle failed: map not available", mapResult);
      return { ok: false, stage: "map_open", map: mapResult };
    }
    Logger.log("MAP", "Map ready for combat cycle", mapResult);
    return { ok: true, stage: "map_ready", map: mapResult };
  }

  // AI CHANGED: Kept name for Tampermonkey/GUI compatibility; forwards to prepMapForCombatCycle (no scan placeholder).
  async function prepareAndScanOnce() {
    return prepMapForCombatCycle();
  }

  // AI CHANGED: Updated cycle runner to map-prep then secure+loot (tactical scan only in exploreByScan).
  async function runPreparedSecureCycle() {
    const prepMap = await prepMapForCombatCycle();
    if (!prepMap.ok) {
      return { ok: false, stage: prepMap.stage, prep: prepMap };
    }

    const secureResult = await secureTileAndLootOnce();
    return {
      ok: !!secureResult.ok,
      stage: secureResult.stage,
      reason: secureResult.reason,
      prep: prepMap,
      secure: secureResult
    };
  }

  // AI CHANGED: Added status API for external visibility into auto-farm loop health.
  function getAutoFarmStatus() {
    const status = Runtime.autoFarm;
    return {
      running: status.running,
      stopRequested: status.stopRequested,
      cyclesCompleted: status.cyclesCompleted,
      consecutiveFailures: status.consecutiveFailures,
      lastResult: status.lastResult,
      startedAt: status.startedAt,
      reliability: status.reliability || null,
      chatSpammer: status.chatSpammer || null,
      health: status.health || null,
      recovery: status.recovery || null,
      lastSessionSummary: status.lastSessionSummary || null
    };
  }

  // AI CHANGED: Added stop API to gracefully halt loop after current cycle.
  function stopAutoFarmLoop() {
    if (!Runtime.autoFarm.running) {
      Logger.log("AUTO", "Auto-farm loop already stopped");
      return { ok: true, running: false, message: "already_stopped" };
    }
    Runtime.autoFarm.stopRequested = true;
    Logger.log("AUTO", "Stop requested for auto-farm loop");
    return { ok: true, running: true, message: "stop_requested" };
  }

  // AI CHANGED: Added controlled repeat runner with auto-stop on repeated failures.
  async function startAutoFarmLoop() {
    if (Runtime.autoFarm.running) {
      Logger.warn("AUTO", "Auto-farm loop already running");
      return { ok: false, reason: "already_running", status: getAutoFarmStatus() };
    }

    Runtime.autoFarm.running = true;
    Runtime.autoFarm.stopRequested = false;
    Runtime.autoFarm.cyclesCompleted = 0;
    Runtime.autoFarm.consecutiveFailures = 0;
    Runtime.autoFarm.lastResult = null;
    Runtime.autoFarm.startedAt = Date.now();
    Runtime.autoFarm.reliability.noProgressStreak = 0;
    resetAutoChatSpammerRuntime();
    resetAutoFarmHealthRuntime(Runtime.autoFarm.startedAt);
    resetAutoFarmRecoveryRuntime();
    clearPersistedAutoRecoveryResume();
    scheduleNextAutoChatSpammer("auto_loop_start", { nowMs: Runtime.autoFarm.startedAt });
    let exitReason = "unknown";

    // AI CHANGED: Surface loop start as live status.
    setBotStatus("starting", `auto-farm loop (delay=${Config.farmLoop.cycleDelayMs}ms)`);
    Logger.log("AUTO", "Auto-farm loop started", {
      cycleDelayMs: Config.farmLoop.cycleDelayMs,
      maxConsecutiveFailures: Config.farmLoop.maxConsecutiveFailures
    });

    while (Runtime.autoFarm.running && !Runtime.autoFarm.stopRequested) {
      // AI CHANGED: Surface waiting-for-settle as live status.
      setBotStatus("waiting", "movement settle gate");
      // AI CHANGED: Block new cycle start until movement bar clears to avoid scan-vs-move overlap.
      await waitUntilNotMoving("auto-loop");
      const preCycleState = readBasicState();
      // AI CHANGED: slice 21 — fresh session flags each cycle so zoom flag tracks UI, not stale assumptions.
      resetZoomAssumptionIfSessionRisk(preCycleState.session);
      const preCycleRecovery = await maybeRecoverUnhealthySession(preCycleState, {
        reason: "cycle_start"
      });
      if (preCycleRecovery && preCycleRecovery.refreshing) {
        exitReason = "session_refresh";
        break;
      }
      if (preCycleRecovery && preCycleRecovery.halted) {
        exitReason = "session_risk";
        break;
      }
      if (preCycleRecovery && preCycleRecovery.recovered) {
        await sleep(Config.farmLoop.cycleDelayMs, { bypassStop: true });
      }
      if (Runtime.autoFarm.stopRequested) {
        exitReason = "user_stop";
        break;
      }
      const cycleResult = await runPreparedSecureCycle();
      Runtime.autoFarm.lastResult = cycleResult;
      Runtime.autoFarm.cyclesCompleted += 1;

      const recoveryAfterCycle = !cycleResult || !cycleResult.ok
        ? await maybeRecoverUnhealthySession(readBasicState(), {
            reason: cycleResult && cycleResult.stage ? cycleResult.stage : "cycle_failure"
          })
        : { ok: true, skipped: true };
      if (recoveryAfterCycle && recoveryAfterCycle.refreshing) {
        exitReason = "session_refresh";
        break;
      }
      if (recoveryAfterCycle && recoveryAfterCycle.halted) {
        exitReason = "session_risk";
        break;
      }
      if (recoveryAfterCycle && recoveryAfterCycle.recovered) {
        Runtime.autoFarm.consecutiveFailures = 0;
        Runtime.autoFarm.reliability.noProgressStreak = 0;
        markAutoFarmProgress("recovered_cycle_boundary", {
          stage: cycleResult ? cycleResult.stage || null : null
        });
        Logger.log("AUTO", "Cycle boundary recovered by session watchdog", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult ? cycleResult.stage : null
        });
        await sleep(Config.farmLoop.cycleDelayMs, { bypassStop: true });
        continue;
      }

      if (cycleResult && cycleResult.ok) {
        Runtime.autoFarm.consecutiveFailures = 0;
        Runtime.autoFarm.reliability.noProgressStreak = 0;
        getAutoFarmRecoveryRuntime().softAttempts = 0;
        markAutoFarmProgress("cycle_completed", {
          stage: cycleResult.stage || null
        });
        Logger.log("AUTO", "Cycle completed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else if (cycleResult && cycleResult.reason === "stop_requested") {
        Logger.log("AUTO", "Cycle aborted by user stop (not counted as failure)", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          stage: cycleResult.stage
        });
      } else {
        Runtime.autoFarm.consecutiveFailures += 1;
        const isNoProgressCombat =
          cycleResult &&
          cycleResult.stage === "combat" &&
          !cycleResult.reason &&
          typeof cycleResult.secure === "object" &&
          cycleResult.secure &&
          cycleResult.secure.ok === false;
        if (isNoProgressCombat) {
          Runtime.autoFarm.reliability.noProgressStreak += 1;
          Runtime.autoFarm.reliability.totalNoProgressFailures += 1;
          Runtime.autoFarm.reliability.lastNoProgressAt = Date.now();
        } else {
          Runtime.autoFarm.reliability.noProgressStreak = 0;
        }
        Logger.warn("AUTO", "Cycle failed", {
          cycle: Runtime.autoFarm.cyclesCompleted,
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
          stage: cycleResult ? cycleResult.stage : "unknown"
        });
        const cooldownThreshold = Number.isFinite(Config.farmLoop.noProgressCooldownThreshold)
          ? Config.farmLoop.noProgressCooldownThreshold
          : 2;
        const cooldownMs = Number.isFinite(Config.farmLoop.noProgressCooldownMs)
          ? Config.farmLoop.noProgressCooldownMs
          : 5000;
        if (
          Runtime.autoFarm.reliability.noProgressStreak >= cooldownThreshold &&
          cooldownMs > 0 &&
          !Runtime.autoFarm.stopRequested
        ) {
          Runtime.autoFarm.reliability.lastCooldownAt = Date.now();
          setBotStatus("waiting", `reliability cooldown ${cooldownMs}ms (no-progress streak=${Runtime.autoFarm.reliability.noProgressStreak})`);
          Logger.warn("AUTO", "Applying reliability cooldown after repeated no-progress failures", {
            noProgressStreak: Runtime.autoFarm.reliability.noProgressStreak,
            cooldownMs: cooldownMs
          });
          await sleep(cooldownMs, { bypassStop: true });
          Runtime.autoFarm.reliability.noProgressStreak = 0;
        }
      }

      if (Runtime.autoFarm.consecutiveFailures >= Config.farmLoop.maxConsecutiveFailures) {
        Logger.warn("AUTO", "Auto-farm loop stopped after repeated failures", {
          consecutiveFailures: Runtime.autoFarm.consecutiveFailures
        });
        // AI CHANGED: Surface halt-on-failures as live status.
        setBotStatus("halted", `${Runtime.autoFarm.consecutiveFailures} consecutive failures`);
        Runtime.autoFarm.stopRequested = true;
        exitReason = "failure_cap";
        break;
      }

      if (!Runtime.autoFarm.stopRequested) {
        const chatAttempt = await maybeRunAutoChatSpammer(readBasicState(), {
          reason: cycleResult && cycleResult.stage ? cycleResult.stage : "cycle_boundary"
        });
        if (!chatAttempt.ok && !chatAttempt.skipped) {
          Logger.warn("CHAT", "Auto local chat attempt did not complete cleanly", chatAttempt);
        }
        // AI CHANGED: Back off when we're idling on empty tiles to avoid spammy repeated actions.
        const nowState = readBasicState();
        const shouldIdleBackoff =
          cycleResult &&
          cycleResult.ok &&
          cycleResult.stage === "done_no_loot" &&
          typeof nowState.combat.enemyCount === "number" &&
          nowState.combat.enemyCount === 0;
        if (shouldIdleBackoff) {
          // AI CHANGED: enemyCount===0 — top off to outOfCombatHealWaitHpPct with HP potions + passive regen before exploreByScan.
          const healReady = await waitForOutOfCombatHealBeforeExplore({
            reason: "before_explore_move"
          });
          if (!healReady.ok && healReady.reason === "stop_requested") {
            exitReason = "user_stop";
            break;
          } else if (healReady.waited) {
            Logger.log("COMBAT", "Out-of-combat heal gate satisfied before explore move", healReady);
          }
          // AI CHANGED: Prefer scan-driven movement while idling on empty tile.
          let moveResult = await exploreByScan();
          if (!moveResult.ok) {
            // AI CHANGED: Keep legacy fallback so loop remains resilient if scan path fails.
            moveResult = await exploreIfIdle();
          }
          if (moveResult.ok) {
            Logger.log("AUTO", "Idle exploration movement completed", moveResult);
            await sleep(Config.farmLoop.cycleDelayMs);
            continue;
          }
          // AI CHANGED: Surface idle-backoff as live status.
          setBotStatus("idle", `no walkable neighbor (${moveResult.reason}); backing off`);
          Logger.log("AUTO", "Idle backoff delay applied", {
            delayMs: Config.farmLoop.idleNoEnemyDelayMs,
            reason: moveResult.reason
          });
          await sleep(Config.farmLoop.idleNoEnemyDelayMs);
          continue;
        }
        await sleep(Config.farmLoop.cycleDelayMs);
      }
    }

    Runtime.autoFarm.running = false;
    if (exitReason === "unknown") {
      if (Runtime.autoFarm.lastResult && Runtime.autoFarm.lastResult.reason === "stop_requested") {
        exitReason = "user_stop";
      } else if (Runtime.autoFarm.stopRequested) {
        exitReason = "stop_requested";
      } else {
        exitReason = "loop_completed";
      }
    }
    const endedAt = Date.now();
    const startedAt = Number.isFinite(Runtime.autoFarm.startedAt) ? Runtime.autoFarm.startedAt : endedAt;
    Runtime.autoFarm.lastSessionSummary = {
      startedAt: startedAt,
      endedAt: endedAt,
      onDurationMs: Math.max(0, endedAt - startedAt),
      cyclesCompleted: Runtime.autoFarm.cyclesCompleted,
      consecutiveFailures: Runtime.autoFarm.consecutiveFailures,
      reliability: Object.assign({}, Runtime.autoFarm.reliability || {}),
      chatSpammer: Object.assign({}, getAutoChatSpammerRuntime()),
      health: Object.assign({}, getAutoFarmHealthRuntime()),
      recovery: Object.assign({}, getAutoFarmRecoveryRuntime()),
      exitReason: exitReason,
      lastStage: Runtime.autoFarm.lastResult ? Runtime.autoFarm.lastResult.stage || null : null
    };
    // AI CHANGED: consume stop flag when loop ends — if it stays true, waitForCondition (hero stats, verifies) aborts on first tick and leaves profile on wrong tab after TEST.
    Runtime.autoFarm.stopRequested = false;
    // AI CHANGED: Only set "stopped" if we weren't already halted by failures.
    if (Runtime.status.phase !== "halted") {
      setBotStatus("stopped", `${Runtime.autoFarm.cyclesCompleted} cycles completed`);
    }
    const finalStatus = getAutoFarmStatus();
    Logger.log("AUTO", "Auto-farm loop exited", finalStatus);
    return { ok: true, status: finalStatus };
  }
