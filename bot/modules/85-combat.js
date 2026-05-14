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
    // AI CHANGED: Duplicate-avoid index is only meaningful within the same time-of-day slot.
    if (!Object.prototype.hasOwnProperty.call(rt, "lastChatSlot")) {
      rt.lastChatSlot = null;
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
    rt.lastChatSlot = null;
    rt.sends = 0;
    rt.failures = 0;
    rt.lastResult = null;
    return rt;
  }

  function pickAutoChatSpammerDelayMs() {
    const minRaw = Number.isFinite(Config.chat && Config.chat.messageIntervalMinMs)
      ? Math.max(0, Math.round(Config.chat.messageIntervalMinMs))
      : 5 * 60 * 1000;
    const maxRaw = Number.isFinite(Config.chat && Config.chat.messageIntervalMaxMs)
      ? Math.max(minRaw, Math.round(Config.chat.messageIntervalMaxMs))
      : 15 * 60 * 1000;
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

  // AI CHANGED: Messages for one slot; optional legacy flat `Config.chat.messages` only if banks missing.
  function getChatSpammerMessagesForSlot(slot) {
    const m = Config.chat && Config.chat.messagesByTimeOfDay ? Config.chat.messagesByTimeOfDay : null;
    if (!m || typeof m !== "object") {
      return Array.isArray(Config.chat && Config.chat.messages) ? Config.chat.messages.filter(Boolean) : [];
    }
    const key = typeof slot === "string" && slot ? slot : getTimeOfDayChatSlot();
    const arr = m[key];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  }

  // AI CHANGED: Dispatch uses exactly five bank slots vs one universal smart path — pad short banks by cycling trimmed lines.
  function normalizeChatBankToFive(messages) {
    const filtered = [];
    if (Array.isArray(messages)) {
      for (let i = 0; i < messages.length; i += 1) {
        const s = messages[i];
        if (typeof s === "string" && s.trim()) {
          filtered.push(s.trim());
        }
      }
    }
    if (filtered.length === 0) {
      return [];
    }
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      out.push(filtered[i % filtered.length]);
    }
    return out;
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
    // AI CHANGED: Include smart-line strings in flatten for TEST max-length coverage.
    const cfg = Config.chat;
    if (cfg && cfg.smartLineEnabled !== false) {
      if (typeof cfg.smartLineOpener === "string" && cfg.smartLineOpener.trim()) {
        out.push(cfg.smartLineOpener.trim());
      }
      if (typeof cfg.smartLineFollowup === "string" && cfg.smartLineFollowup.trim()) {
        out.push(cfg.smartLineFollowup.trim());
      }
    }
    return out;
  }

  // AI CHANGED: True when smart two-step promo is configured (opener + follow-up non-empty).
  function isChatSmartLineConfigured() {
    const cfg = Config.chat;
    return !!(
      cfg &&
      cfg.smartLineEnabled !== false &&
      typeof cfg.smartLineOpener === "string" &&
      cfg.smartLineOpener.trim() &&
      typeof cfg.smartLineFollowup === "string" &&
      cfg.smartLineFollowup.trim()
    );
  }

  function pickAutoChatSpammerMessage() {
    const slot = getTimeOfDayChatSlot();
    const messages = getChatSpammerMessagesForSlot(slot);
    if (messages.length <= 0) {
      return null;
    }
    const rt = getAutoChatSpammerRuntime();
    let idx = Math.floor(Math.random() * messages.length);
    if (
      messages.length > 1 &&
      rt.lastChatSlot === slot &&
      Number.isFinite(rt.lastMessageIndex) &&
      idx === rt.lastMessageIndex
    ) {
      idx = (idx + 1 + Math.floor(Math.random() * (messages.length - 1))) % messages.length;
    }
    return {
      index: idx,
      message: messages[idx],
      slot: slot
    };
  }

  // AI CHANGED: Each due window rolls uniform 1/6 — smart pair (universal) vs five time-slot bank lines (same odds each).
  function pickAutoChatSpammerDispatch() {
    const slot = getTimeOfDayChatSlot();
    const rawMessages = getChatSpammerMessagesForSlot(slot);
    const bankFive = normalizeChatBankToFive(rawMessages);
    const smartOk = isChatSmartLineConfigured();
    const delayMsRaw =
      Config.chat && Number.isFinite(Config.chat.smartLineFollowupDelayMs)
        ? Config.chat.smartLineFollowupDelayMs
        : 40000;
    const followDelayMs = Math.max(0, Math.round(delayMsRaw));

    if (!smartOk && bankFive.length === 0) {
      return null;
    }
    if (smartOk && bankFive.length === 0) {
      return {
        kind: "smart",
        slot: slot,
        opener: Config.chat.smartLineOpener.trim(),
        followup: Config.chat.smartLineFollowup.trim(),
        followDelayMs: followDelayMs,
        pickRoll: 0,
        pickOutcomes: 1
      };
    }
    if (!smartOk) {
      const bank = pickAutoChatSpammerMessage();
      if (!bank || !bank.message) {
        return null;
      }
      return Object.assign({ kind: "bank" }, bank);
    }

    const roll = Math.floor(Math.random() * 6);
    if (roll === 0) {
      return {
        kind: "smart",
        slot: slot,
        opener: Config.chat.smartLineOpener.trim(),
        followup: Config.chat.smartLineFollowup.trim(),
        followDelayMs: followDelayMs,
        pickRoll: roll,
        pickOutcomes: 6
      };
    }
    const bankIndex = roll - 1;
    return {
      kind: "bank",
      slot: slot,
      index: bankIndex,
      message: bankFive[bankIndex],
      bankSize: 5,
      pickRoll: roll,
      pickOutcomes: 6
    };
  }

  async function maybeRunAutoChatSpammer(liveState, userOpts) {
    const opts = userOpts && typeof userOpts === "object" ? userOpts : {};
    if (!Config.chat || Config.chat.autoLocalPromocodeSpammerEnabled === false) {
      return { ok: true, skipped: true, reason: "disabled" };
    }
    const now = Date.now();
    const slotNow = getTimeOfDayChatSlot({ nowMs: now });
    const messages = getChatSpammerMessagesForSlot(slotNow);
    const smartConfigured = isChatSmartLineConfigured();
    if (messages.length <= 0 && !smartConfigured) {
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
    const dispatch = pickAutoChatSpammerDispatch();
    if (!dispatch) {
      return { ok: false, skipped: true, reason: "message_pick_failed" };
    }

    rt.lastAttemptAt = now;

    if (dispatch.kind === "smart") {
      setBotStatus("waiting", "auto local chat smart opener");
      Logger.log("CHAT", "Auto local chat smart opener due", {
        timeSlot: dispatch.slot || null,
        openerLength: dispatch.opener.length,
        followDelayMs: dispatch.followDelayMs,
        pickRoll: Number.isFinite(dispatch.pickRoll) ? dispatch.pickRoll : null,
        pickOutcomes: Number.isFinite(dispatch.pickOutcomes) ? dispatch.pickOutcomes : null,
        reason: opts.reason || null
      });
      const openResult = await sendLocalChatPromocodeMessage(dispatch.opener);
      rt.lastResult = openResult;
      if (!openResult || !openResult.ok) {
        rt.failures += 1;
        Logger.warn("CHAT", "Auto local chat smart opener failed", { failures: rt.failures, result: openResult });
        scheduleNextAutoChatSpammer("send_failed", { nowMs: Date.now() });
        return {
          ok: false,
          sent: false,
          kind: "smart",
          stage: "opener",
          failures: rt.failures,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs,
          result: openResult
        };
      }
      rt.sends += 1;
      rt.lastSendAt = Date.now();
      rt.lastMessage = dispatch.opener;
      rt.lastMessageIndex = -1;
      rt.lastChatSlot = dispatch.slot || null;
      Logger.log("CHAT", "Auto local chat smart opener sent; waiting before follow-up", {
        followDelayMs: dispatch.followDelayMs,
        timeSlot: dispatch.slot || null
      });

      await sleep(dispatch.followDelayMs);

      if (Runtime.autoFarm.stopRequested) {
        Logger.log("CHAT", "Auto local chat smart follow-up skipped (stop requested)", {});
        scheduleNextAutoChatSpammer("smart_followup_aborted_stop", { nowMs: Date.now() });
        return {
          ok: true,
          sent: true,
          kind: "smart",
          partial: true,
          stage: "followup_skipped_stop",
          openerOk: true,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs
        };
      }

      const stateFollow = readBasicState();
      if (
        stateFollow &&
        stateFollow.session &&
        (stateFollow.session.dead === true || stateFollow.session.poorConnection === true)
      ) {
        Logger.warn("CHAT", "Auto local chat smart follow-up skipped (session risk)", {});
        scheduleNextAutoChatSpammer("smart_followup_aborted_session", { nowMs: Date.now() });
        return {
          ok: true,
          sent: true,
          kind: "smart",
          partial: true,
          stage: "followup_skipped_session",
          openerOk: true,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs
        };
      }
      if (
        stateFollow &&
        stateFollow.combat &&
        typeof stateFollow.combat.enemyCount === "number" &&
        stateFollow.combat.enemyCount > 0
      ) {
        Logger.warn("CHAT", "Auto local chat smart follow-up skipped (enemy present)", {
          enemyCount: stateFollow.combat.enemyCount
        });
        scheduleNextAutoChatSpammer("smart_followup_aborted_combat", { nowMs: Date.now() });
        return {
          ok: true,
          sent: true,
          kind: "smart",
          partial: true,
          stage: "followup_skipped_combat",
          openerOk: true,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs
        };
      }

      setBotStatus("waiting", "auto local chat smart follow-up");
      Logger.log("CHAT", "Auto local chat smart follow-up due", {
        messageLength: dispatch.followup.length,
        timeSlot: dispatch.slot || null
      });
      const followResult = await sendLocalChatPromocodeMessage(dispatch.followup);
      rt.lastResult = followResult;
      if (!followResult || !followResult.ok) {
        rt.failures += 1;
        Logger.warn("CHAT", "Auto local chat smart follow-up failed", { failures: rt.failures, result: followResult });
        scheduleNextAutoChatSpammer("send_failed", { nowMs: Date.now() });
        return {
          ok: false,
          sent: true,
          kind: "smart",
          partial: true,
          stage: "followup",
          openerOk: true,
          failures: rt.failures,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs,
          result: followResult
        };
      }
      rt.sends += 1;
      rt.lastSendAt = Date.now();
      rt.lastMessage = dispatch.followup;
      rt.lastMessageIndex = -1;
      rt.lastChatSlot = dispatch.slot || null;
      Logger.log("CHAT", "Auto local chat smart pair complete", {
        sends: rt.sends,
        timeSlot: dispatch.slot || null
      });
      scheduleNextAutoChatSpammer("sent", { nowMs: rt.lastSendAt });
      return Object.assign(
        {
          ok: true,
          sent: true,
          kind: "smart",
          pairComplete: true,
          nextSendAt: rt.nextSendAt,
          lastDelayMs: rt.lastDelayMs
        },
        followResult
      );
    }

    const picked = dispatch;
    if (!picked.message) {
      return { ok: false, skipped: true, reason: "message_pick_failed" };
    }
    const bankDenom = picked.bankSize || messages.length;
    setBotStatus("waiting", `auto local chat send (msg ${picked.index + 1}/${bankDenom})`);
    Logger.log("CHAT", "Auto local chat send due", {
      kind: "bank",
      messageIndex: picked.index,
      messageLength: picked.message.length,
      timeSlot: picked.slot || null,
      pickRoll: Number.isFinite(picked.pickRoll) ? picked.pickRoll : null,
      pickOutcomes: Number.isFinite(picked.pickOutcomes) ? picked.pickOutcomes : null,
      reason: opts.reason || null
    });
    const sendResult = await sendLocalChatPromocodeMessage(picked.message);
    rt.lastResult = sendResult;
    if (sendResult && sendResult.ok) {
      rt.sends += 1;
      rt.lastSendAt = Date.now();
      rt.lastMessage = picked.message;
      rt.lastMessageIndex = picked.index;
      // AI CHANGED: Tie duplicate-avoid state to the slot used for this send.
      rt.lastChatSlot = picked.slot || null;
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
        kind: "bank",
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
      kind: "bank",
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
    const hpMax =
      liveState &&
      liveState.player &&
      liveState.player.hp &&
      liveState.player.hp.valid &&
      Number.isFinite(liveState.player.hp.max)
        ? liveState.player.hp.max
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
        // AI CHANGED: Large instant HP loss → flag safety skill (≥ hpDropImmediateMaxFrac of max HP between close samples).
        const sb = Config.supportBuffs;
        const sCfg = sb && sb.safety;
        if (
          sb &&
          sb.enabled !== false &&
          sCfg &&
          sCfg.enabled !== false &&
          Number.isFinite(sustain.lastHpSampleCur) &&
          Number.isFinite(hpMax) &&
          hpMax > 0
        ) {
          const spikeDtMax = Number.isFinite(sCfg.spikeSampleMaxDtSec) ? sCfg.spikeSampleMaxDtSec : 1.5;
          const dtSpike = Math.max(0, (now - sustain.lastHpSampleAt) / 1000);
          if (dtSpike >= 0.05 && dtSpike <= spikeDtMax) {
            const lost = sustain.lastHpSampleCur - hpCur;
            const needFrac = Number.isFinite(sCfg.hpDropImmediateMaxFrac) ? sCfg.hpDropImmediateMaxFrac : 0.25;
            if (lost > 0 && lost / hpMax >= needFrac) {
              const rt = getSupportBuffLineRuntime();
              rt.safetyHpSpikePending = true;
              rt.safetyHpSpikeLost = +lost.toFixed(2);
              rt.safetyHpSpikeAt = now;
              Logger.log("COMBAT", "HP spike flagged for safety buff", {
                lost: +lost.toFixed(2),
                hpMax: hpMax,
                frac: +(lost / hpMax).toFixed(4),
                dtSec: +dtSpike.toFixed(3)
              });
            }
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
    // AI CHANGED: Hard floor — at/below this MP pct always request a potion (overrides can_cast_any and other skips).
    const forcePctRaw = Config.combat && Config.combat.mpPotionForceUseBelowPct;
    if (Number.isFinite(forcePctRaw) && forcePctRaw > 0 && forcePctRaw <= 1 && mpPct <= forcePctRaw) {
      const mpMaxF =
        liveState &&
        liveState.player &&
        liveState.player.mp &&
        liveState.player.mp.valid &&
        Number.isFinite(liveState.player.mp.max)
          ? liveState.player.mp.max
          : null;
      const effectiveMpF = mpCur + activeRemaining;
      const shortageF =
        Number.isFinite(mpMaxF) && mpMaxF > 0 ? Math.max(0, mpMaxF - effectiveMpF) : Math.max(1, bestKnown.spec.totalValue);
      return {
        needed: true,
        reason: "force_below_mp_pct",
        mpCur: +mpCur.toFixed(2),
        mpPct: +mpPct.toFixed(4),
        activeRemaining: +activeRemaining.toFixed(2),
        shortage: +shortageF.toFixed(2),
        forceBelowPct: +forcePctRaw,
        potionTotalValue: bestKnown.spec.totalValue,
        potionDurationSec: bestKnown.spec.durationSec,
        potionPerSec: bestKnown.spec.perSec
      };
    }
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
      if (shortage > 0) {
        return {
          needed: true,
          reason: "preferred_skill_shortage",
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
      // AI CHANGED: Preferred skill has enough MP — still allow max-minus-heal top-off below (do not return early).
    }
    const mpMax =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.max)
        ? liveState.player.mp.max
        : null;
    const healAmt =
      bestKnown.spec && Number.isFinite(bestKnown.spec.totalValue) && bestKnown.spec.totalValue > 0
        ? bestKnown.spec.totalValue
        : null;
    // AI CHANGED: Drink when missing MP ≥ one bar MP potion heal (equivalent to cur+remainder ≤ maxMP − heal) to limit overheal waste; uses largest parsed MP pot on bar as heal reference.
    if (
      Config.combat.mpPotionUseWhenBelowMaxMinusHeal !== false &&
      Number.isFinite(mpMax) &&
      mpMax > 0 &&
      healAmt !== null
    ) {
      const effectiveMp = mpCur + activeRemaining;
      const missing = mpMax - effectiveMp;
      if (missing >= healAmt) {
        return {
          needed: true,
          reason: "mp_missing_at_least_one_potion_heal",
          mpCur: +mpCur.toFixed(2),
          mpPct: +mpPct.toFixed(4),
          activeRemaining: +activeRemaining.toFixed(2),
          shortage: +missing.toFixed(2),
          mpMax: +mpMax.toFixed(2),
          manaPotionHeal: +healAmt.toFixed(2),
          potionTotalValue: bestKnown.spec.totalValue,
          potionDurationSec: bestKnown.spec.durationSec,
          potionPerSec: bestKnown.spec.perSec
        };
      }
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

  // AI CHANGED: Runtime slice for support-buff renew / safety / prebuff counters (see `Config.supportBuffs`).
  function getSupportBuffLineRuntime() {
    if (!Runtime.autoFarm.supportBuffLine || typeof Runtime.autoFarm.supportBuffLine !== "object") {
      Runtime.autoFarm.supportBuffLine = {
        longSelfTracked: Object.create(null),
        lastSafetyBuffCastAt: 0,
        prebuffCastCount: 0
      };
    }
    const rt = Runtime.autoFarm.supportBuffLine;
    if (!rt.longSelfTracked || typeof rt.longSelfTracked !== "object") {
      rt.longSelfTracked = Object.create(null);
    }
    if (!Number.isFinite(rt.lastSafetyBuffCastAt)) {
      rt.lastSafetyBuffCastAt = 0;
    }
    if (!Number.isFinite(rt.prebuffCastCount)) {
      rt.prebuffCastCount = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "safetyHpSpikePending")) {
      rt.safetyHpSpikePending = false;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "safetyHpSpikeLost")) {
      rt.safetyHpSpikeLost = null;
    }
    if (!Object.prototype.hasOwnProperty.call(rt, "safetyHpSpikeAt")) {
      rt.safetyHpSpikeAt = null;
    }
    return rt;
  }

  function getSupportBuffDescriptionForRow(row, classKey) {
    let desc = row && typeof row.description === "string" ? row.description : "";
    if (!desc && classKey && typeof getSkillMasterEntry === "function" && row && row.name) {
      try {
        const ent = getSkillMasterEntry(classKey, row.name);
        if (ent && typeof ent.description === "string") {
          desc = ent.description;
        }
      } catch (_e) {
        desc = desc || "";
      }
    }
    return desc;
  }

  function parseEffectsMaxDurationSec(row) {
    if (!row || !Array.isArray(row.effects)) {
      return null;
    }
    let best = null;
    for (let i = 0; i < row.effects.length; i++) {
      const ef = row.effects[i];
      if (ef && Number.isFinite(ef.durationSec) && ef.durationSec > 0) {
        if (best === null || ef.durationSec > best) {
          best = ef.durationSec;
        }
      }
    }
    return best;
  }

  function parseLikelyBuffDurationSecFromDescription(desc) {
    const d = String(desc || "");
    const re = /(\d[\d.,]{0,8})\s*s(?:econds?)?\b/gi;
    let best = null;
    let x;
    while ((x = re.exec(d)) !== null) {
      const v = parseFloat(String(x[1]).replace(/,/g, "."));
      if (Number.isFinite(v) && v > 0 && v < 200000 && (best === null || v > best)) {
        best = v;
      }
    }
    // AI CHANGED: Match "900 seconds" style wording from skill DB export (mage barriers, etc.).
    const reWord = /(\d[\d.,]{0,8})\s+seconds?\b/gi;
    while ((x = reWord.exec(d)) !== null) {
      const v2 = parseFloat(String(x[1]).replace(/,/g, "."));
      if (Number.isFinite(v2) && v2 > 0 && v2 < 200000 && (best === null || v2 > best)) {
        best = v2;
      }
    }
    return best;
  }

  function guessBuffDurationSecForSupportRow(row, classKey) {
    const desc = getSupportBuffDescriptionForRow(row, classKey);
    let dur = parseLikelyBuffDurationSecFromDescription(desc);
    const fromFx = parseEffectsMaxDurationSec(row);
    if (Number.isFinite(fromFx)) {
      if (!Number.isFinite(dur) || fromFx > dur) {
        dur = fromFx;
      }
    }
    return Number.isFinite(dur) ? dur : null;
  }

  function skillNameMatchesAnySubstring(name, subs) {
    const raw = String(name || "").trim();
    const n =
      typeof normalizeSkillName === "function"
        ? String(normalizeSkillName(raw)).toLowerCase()
        : raw.toLowerCase();
    const list = Array.isArray(subs) ? subs : [];
    for (let i = 0; i < list.length; i++) {
      const s = String(list[i] || "").toLowerCase().trim();
      if (s && n.indexOf(s) !== -1) {
        return true;
      }
    }
    return false;
  }

  // AI CHANGED: Shared absorb/incoming barrier heuristic (safety prebuff exclusion + TEST list).
  function supportBuffDescriptionMatchesSafetyIncomingAbsorbHeuristic(desc) {
    const d = String(desc || "").toLowerCase();
    return (
      (d.indexOf("absorb") !== -1 && d.indexOf("incoming") !== -1) ||
      (d.indexOf("absorbs") !== -1 && d.indexOf("incoming") !== -1) ||
      (d.indexOf("incoming damage") !== -1 && (d.indexOf("barrier") !== -1 || d.indexOf("shield") !== -1))
    );
  }

  // AI CHANGED: Skill DB — Support+Party without Attack (e.g. Hunter's Tread, Battle Song) = party prebuff.
  function skillMasterEntryIsPartySupportNonAttackFromDb(entry) {
    if (!entry || !Array.isArray(entry.tags)) {
      return false;
    }
    const t = entry.tags;
    const has = function (x) {
      return t.indexOf(x) !== -1;
    };
    return has("support") && has("party") && !has("attack");
  }

  // AI CHANGED: Live scan tags — same party-support rule when DB row missing or class mismatch.
  function skillRowScanTagsPartySupportNonAttack(row) {
    if (!row || !Array.isArray(row.tags) || row.isAttack) {
      return false;
    }
    const t = row.tags.map(function (x) {
      return String(x || "").toLowerCase().trim();
    });
    return t.indexOf("support") !== -1 && t.indexOf("party") !== -1 && t.indexOf("attack") === -1;
  }

  // AI CHANGED: Never prebuff safety barriers — reserve list, safety.skillNames, scan/DB absorb+incoming on self-only support.
  function isSupportSkillExcludedFromPrebuffSafetyPolicy(row, classKey) {
    const root = Config.supportBuffs;
    const pb = root && root.prebuff;
    const reserveSubs = Array.isArray(pb && pb.reserveSafetyNameSubstrings) ? pb.reserveSafetyNameSubstrings : ["windy dome"];
    if (skillNameMatchesAnySubstring(row.name, reserveSubs)) {
      return true;
    }
    const cfgSafe = root && root.safety;
    const explicit = Array.isArray(cfgSafe && cfgSafe.skillNames) ? cfgSafe.skillNames : [];
    const rawName = typeof row.name === "string" ? row.name : "";
    const nk =
      typeof normalizeSkillName === "function"
        ? String(normalizeSkillName(rawName)).toLowerCase()
        : rawName.toLowerCase();
    for (let e = 0; e < explicit.length; e++) {
      const want = String(explicit[e] || "").trim();
      if (!want) {
        continue;
      }
      const wk =
        typeof normalizeSkillName === "function"
          ? String(normalizeSkillName(want)).toLowerCase()
          : want.toLowerCase();
      if (wk && (nk.indexOf(wk) !== -1 || wk.indexOf(nk) !== -1)) {
        return true;
      }
    }
    const scanDesc = getSupportBuffDescriptionForRow(row, classKey);
    if (supportBuffDescriptionMatchesSafetyIncomingAbsorbHeuristic(scanDesc)) {
      return true;
    }
    if (typeof getSkillMasterEntry === "function" && classKey) {
      const ent = getSkillMasterEntry(classKey, row.name);
      if (ent && typeof ent.description === "string" && supportBuffDescriptionMatchesSafetyIncomingAbsorbHeuristic(ent.description)) {
        const tg = Array.isArray(ent.tags) ? ent.tags : [];
        const sup = tg.indexOf("support") !== -1;
        const atk = tg.indexOf("attack") !== -1;
        const party = tg.indexOf("party") !== -1;
        if (sup && !atk && !party) {
          return true;
        }
      }
    }
    return false;
  }

  // AI CHANGED: Tooltip/FX duration first; then embedded DB classification (88-support-classification.generated.js).
  function resolveSupportBuffDurationSecPreferDb(row, classKey) {
    let dur = guessBuffDurationSecForSupportRow(row, classKey);
    if (Number.isFinite(dur)) {
      return dur;
    }
    if (typeof lookupSupportSkillClassificationFromGeneratedDb === "function" && classKey) {
      const lu = lookupSupportSkillClassificationFromGeneratedDb(classKey, row && row.name);
      if (lu && Number.isFinite(lu.durationSecGuess)) {
        return lu.durationSecGuess;
      }
    }
    return null;
  }

  // AI CHANGED: Long self support (≥ longDurationMinSec, default 60s) — OOC renew + pre-combat refresh; never new-tile prebuff.
  function skillRowIsPermanentOocSelfLongBuff(row, classKey) {
    if (!row || row.kind !== "skill" || row.isAttack) {
      return false;
    }
    if (!row.isSupport || !row.targetsSelf) {
      return false;
    }
    if (isSupportSkillExcludedFromPrebuffSafetyPolicy(row, classKey)) {
      return false;
    }
    if (skillRowScanTagsPartySupportNonAttack(row)) {
      return false;
    }
    const masterEnt =
      typeof getSkillMasterEntry === "function" && classKey ? getSkillMasterEntry(classKey, row.name) : null;
    if (skillMasterEntryIsPartySupportNonAttackFromDb(masterEnt)) {
      return false;
    }
    const root = Config.supportBuffs;
    const longMin = Number.isFinite(root && root.longDurationMinSec) ? root.longDurationMinSec : 60;
    const dur = resolveSupportBuffDurationSecPreferDb(row, classKey);
    if (!Number.isFinite(dur) || dur < longMin) {
      return false;
    }
    const lu =
      typeof lookupSupportSkillClassificationFromGeneratedDb === "function" && classKey
        ? lookupSupportSkillClassificationFromGeneratedDb(classKey, row.name)
        : null;
    if (lu) {
      return lu.permanentSelfOoc === true;
    }
    return true;
  }

  // AI CHANGED: Idle empty tile — drink MP pots when mana below idleMpPotionUseBelowPct (toward idleMpPotionTopOffTargetPct).
  async function tryUseOutOfCombatIdleLowManaPotion(liveState) {
    if (!(Config.combat && Config.combat.useCombatPotions !== false)) {
      return { used: false, reason: "combat_potions_off" };
    }
    const rawFloor = Config.combat && Config.combat.idleMpPotionUseBelowPct;
    if (!Number.isFinite(rawFloor) || rawFloor <= 0 || rawFloor > 0.95) {
      return { used: false, reason: "idle_mp_floor_off" };
    }
    const floorPct = Math.max(0.02, Math.min(0.45, rawFloor));
    const rawTarget = Config.combat && Config.combat.idleMpPotionTopOffTargetPct;
    const targetPct = Number.isFinite(rawTarget)
      ? Math.max(floorPct + 0.01, Math.min(1, rawTarget))
      : Math.max(floorPct + 0.01, 0.5);
    const enemyCount =
      liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount)
        ? liveState.combat.enemyCount
        : null;
    if (enemyCount !== 0) {
      return { used: false, reason: "not_clear_tile" };
    }
    const mpPct =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.pct)
        ? liveState.player.mp.pct
        : null;
    if (!Number.isFinite(mpPct) || mpPct >= floorPct) {
      return { used: false, reason: "mp_not_below_idle_floor", floorPct: floorPct, mpPct: mpPct };
    }
    const res = await tryUseOutOfCombatMpTopoff(liveState, targetPct);
    if (res && res.used) {
      Logger.log("COMBAT", "Idle MP potion (below floor)", {
        floorPct: floorPct,
        targetPct: targetPct,
        mpPct: mpPct,
        detail: res.detail || null
      });
    }
    return res || { used: false, reason: "no_result" };
  }

  function findActionBarSlotForSupportSkillNameCandidates(names) {
    const wantList = Array.isArray(names) ? names : [];
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    for (let n = 0; n < wantList.length; n++) {
      const wantRaw = String(wantList[n] || "").trim();
      if (!wantRaw) {
        continue;
      }
      const key =
        typeof normalizeSkillName === "function"
          ? String(normalizeSkillName(wantRaw)).toLowerCase()
          : wantRaw.toLowerCase();
      for (let i = 0; i < slots.length; i++) {
        const row = slots[i];
        if (!row || row.kind !== "skill") {
          continue;
        }
        const rawName = typeof row.name === "string" ? row.name : "";
        const nk =
          typeof normalizeSkillName === "function"
            ? String(normalizeSkillName(rawName)).toLowerCase()
            : rawName.toLowerCase();
        if (nk.indexOf(key) !== -1 || key.indexOf(nk) !== -1) {
          const slotIdx = typeof row.slot === "number" ? row.slot : i;
          return { slot: slotIdx, name: rawName, row: row };
        }
      }
    }
    return null;
  }

  // AI CHANGED: Sync safety fire — HP spike flag from sustain observations; cancel+Windy Dome when available.
  function processCombatSafetyHpSpikeIfNeeded(liveState) {
    const root = Config.supportBuffs;
    const cfg = root && root.safety;
    const rt = getSupportBuffLineRuntime();
    if (!root || root.enabled === false || !cfg || cfg.enabled === false) {
      return false;
    }
    if (!rt.safetyHpSpikePending) {
      return false;
    }
    const now = Date.now();
    const pick = findActionBarSlotForSupportSkillNameCandidates(cfg.skillNames || ["Windy Dome"]);
    if (!pick) {
      rt.safetyHpSpikePending = false;
      Logger.warn("COMBAT", "Safety spike cleared: no bar slot for safety skill", { wanted: cfg.skillNames || null });
      return false;
    }
    if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(pick.slot)) {
      return false;
    }
    // AI CHANGED: HP-spike path — attempt cancel first (map-gap / DOM; bypass strict name gate), then safety skill.
    if (cfg.cancelCurrentSkillFirst !== false && typeof clickChargingSkillCancelUi === "function") {
      clickChargingSkillCancelUi({ dangerBypassNameMatch: true });
    }
    const clicked = clickActionBarSlot(pick.slot);
    if (clicked) {
      rt.safetyHpSpikePending = false;
      rt.lastSafetyBuffCastAt = now;
      Logger.log("COMBAT", "Safety buff fired (HP spike)", {
        name: pick.name,
        slot: pick.slot,
        spikeLost: rt.safetyHpSpikeLost,
        spikeAt: rt.safetyHpSpikeAt
      });
      rt.safetyHpSpikeLost = null;
      rt.safetyHpSpikeAt = null;
      return true;
    }
    Logger.warn("COMBAT", "Safety spike: safety skill click failed", { name: pick.name, slot: pick.slot });
    return false;
  }

  async function maybeCombatSafetyBuffInterrupt(liveState) {
    const root = Config.supportBuffs;
    const cfg = root && root.safety;
    if (!root || root.enabled === false || !cfg || cfg.enabled === false) {
      return { fired: false, skipped: true, reason: "disabled" };
    }
    updateCombatSustainObservations(liveState);
    const fired = processCombatSafetyHpSpikeIfNeeded(liveState);
    if (fired) {
      const settle = Number.isFinite(Config.combat && Config.combat.postRankedSkillClickSettleMs)
        ? Math.max(25, Config.combat.postRankedSkillClickSettleMs)
        : 40;
      await sleep(settle);
      return { fired: true, reason: "hp_spike" };
    }
    return { fired: false, skipped: true, reason: "no_spike_or_on_cd" };
  }

  function buildPrebuffRowMetaListForPolicy(which) {
    const root = Config.supportBuffs;
    const pb = root && root.prebuff;
    const out = [];
    if (!root || root.enabled === false || !pb || pb.enabled === false) {
      return out;
    }
      const treatAttackSubs = Array.isArray(pb.treatAsBuffDespiteAttackNameSubstrings)
        ? pb.treatAsBuffDespiteAttackNameSubstrings
        : ["enchanted arrow", "hunters tread", "hunter's tread"];
      const forceLongSubs = Array.isArray(pb.forceLongDurationIfUnknownNameSubstrings)
        ? pb.forceLongDurationIfUnknownNameSubstrings
        : treatAttackSubs;
      const longMin = Number.isFinite(pb.prebuffLongDurationMinSec)
        ? pb.prebuffLongDurationMinSec
        : Number.isFinite(root.longDurationMinSec)
          ? root.longDurationMinSec
          : 120;
      const shortMax = Number.isFinite(pb.shortDurationMaxSec)
        ? pb.shortDurationMaxSec
        : Number.isFinite(root.shortPrebuffMaxSec)
          ? root.shortPrebuffMaxSec
          : 120;
      const unknownLongSec = Number.isFinite(pb.unknownLongDefaultDurationSec) ? pb.unknownLongDefaultDurationSec : 900;
      const classKey = typeof Config.skills.masterClassKey === "string" ? Config.skills.masterClassKey.trim() : "";
      const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
      for (let i = 0; i < slots.length; i++) {
        const row = slots[i];
        if (!row || row.kind !== "skill") {
          continue;
        }
        if (isSupportSkillExcludedFromPrebuffSafetyPolicy(row, classKey)) {
          continue;
        }
        const masterEnt = typeof getSkillMasterEntry === "function" && classKey ? getSkillMasterEntry(classKey, row.name) : null;
        const fromDbParty = skillMasterEntryIsPartySupportNonAttackFromDb(masterEnt);
        const fromScanParty = skillRowScanTagsPartySupportNonAttack(row);
        const eligibleBuff =
          row.isSupport || skillNameMatchesAnySubstring(row.name, treatAttackSubs) || fromDbParty || fromScanParty;
        if (!eligibleBuff) {
          continue;
        }
        if (row.isAttack && !skillNameMatchesAnySubstring(row.name, treatAttackSubs)) {
          continue;
        }
        // AI CHANGED: Permanent long self-buffs use OOC / pre-combat refresh only — not new-tile prebuff.
        if (skillRowIsPermanentOocSelfLongBuff(row, classKey)) {
          continue;
        }
      let dur = resolveSupportBuffDurationSecPreferDb(row, classKey);
      if (!Number.isFinite(dur) && skillNameMatchesAnySubstring(row.name, forceLongSubs)) {
        dur = unknownLongSec;
      }
      if (!Number.isFinite(dur) || dur <= 0) {
        continue;
      }
      const isLong = dur >= longMin;
      const isShort = dur < longMin;
      if (which === "long" && !isLong) {
        continue;
      }
      if (which === "short" && !isShort) {
        continue;
      }
      if (which === "short" && dur > shortMax) {
        continue;
      }
      const slotIdx = typeof row.slot === "number" ? row.slot : i;
      out.push({ slot: slotIdx, name: row.name, dur: dur, row: row });
    }
    out.sort(function (a, b) {
      return b.dur - a.dur;
    });
    return out;
  }

  function buildOrderedNewTilePrebuffTargets() {
    const root = Config.supportBuffs;
    const pb = root && root.prebuff;
    const longs = buildPrebuffRowMetaListForPolicy("long");
    const shorts = buildPrebuffRowMetaListForPolicy("short");
    const maxTotal = Number.isFinite(pb && pb.maxSkillsTotal) ? Math.max(0, Math.floor(pb.maxSkillsTotal)) : 10;
    const merged = longs.concat(shorts);
    if (merged.length <= maxTotal) {
      return merged;
    }
    return merged.slice(0, maxTotal);
  }

  async function maybeApplySupportPrebuffsOnNewTile(liveState) {
    const root = Config.supportBuffs;
    const pb = root && root.prebuff;
    if (!root || root.enabled === false || !pb || pb.enabled === false) {
      return { used: 0 };
    }
    if (!liveState || typeof liveState.combat.enemyCount !== "number" || liveState.combat.enemyCount <= 0) {
      return { used: 0, skipped: true, reason: "no_enemies" };
    }
    const rt = getSupportBuffLineRuntime();
    rt.prebuffCastCount = 0;
    const targets = buildOrderedNewTilePrebuffTargets();
    let used = 0;
    const settleMs = Number.isFinite(Config.combat && Config.combat.postRankedSkillClickSettleMs)
      ? Math.max(80, Config.combat.postRankedSkillClickSettleMs * 3)
      : 120;
    for (let t = 0; t < targets.length; t++) {
      const one = targets[t];
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(one.slot)) {
        continue;
      }
      if (!clickActionBarSlot(one.slot)) {
        continue;
      }
      used += 1;
      rt.prebuffCastCount += 1;
      Logger.log("COMBAT", "New-tile prebuff cast", { name: one.name, assumedDurationSec: one.dur, slot: one.slot });
      await sleep(settleMs);
    }
    return { used: used, planned: targets.length };
  }

  async function waitForSafeModeShortPrebuffCooldownsThenCast() {
    const root = Config.supportBuffs;
    const pb = root && root.prebuff;
    if (!root || root.enabled === false || !pb || pb.enabled === false) {
      return { skipped: true };
    }
    const pollMs = Number.isFinite(Config.combat && Config.combat.safeModeExplorePollMs)
      ? Math.max(200, Config.combat.safeModeExplorePollMs)
      : 500;
    const shorts = buildPrebuffRowMetaListForPolicy("short");
    if (shorts.length === 0) {
      return { skipped: true, reason: "no_short_prebuffs" };
    }
    let guard = 0;
    while (!Runtime.autoFarm.stopRequested && guard < 600) {
      guard += 1;
      let waiting = 0;
      for (let s = 0; s < shorts.length; s++) {
        if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(shorts[s].slot)) {
          waiting += 1;
        }
      }
      if (waiting === 0) {
        break;
      }
      setBotStatus("waiting", `safe mode: short prebuffs on CD (${waiting}/${shorts.length})`);
      await sleep(pollMs, { bypassStop: true });
    }
    const rt = getSupportBuffLineRuntime();
    const settleMs = Number.isFinite(Config.combat && Config.combat.postRankedSkillClickSettleMs)
      ? Math.max(80, Config.combat.postRankedSkillClickSettleMs * 3)
      : 120;
    let cast = 0;
    for (let s = 0; s < shorts.length; s++) {
      const one = shorts[s];
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(one.slot)) {
        continue;
      }
      if (!clickActionBarSlot(one.slot)) {
        continue;
      }
      cast += 1;
      rt.prebuffCastCount += 1;
      Logger.log("COMBAT", "Safe mode short prebuff before explore", { name: one.name, dur: one.dur, slot: one.slot });
      await sleep(settleMs);
    }
    return { cast: cast };
  }

  async function waitForSafeModeExploreResourcesAndShortPrebuffs() {
    const mode = Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode).toLowerCase() : "fast";
    if (mode !== "safe") {
      return { skipped: true, reason: "not_safe_mode" };
    }
    const hpTh = Number.isFinite(Config.combat && Config.combat.safeModeExploreMinHpPct)
      ? Math.max(0.5, Math.min(1, Config.combat.safeModeExploreMinHpPct))
      : 0.95;
    const mpTh = Number.isFinite(Config.combat && Config.combat.safeModeExploreMinMpPct)
      ? Math.max(0.1, Math.min(1, Config.combat.safeModeExploreMinMpPct))
      : 0.5;
    const pollMs = Number.isFinite(Config.combat && Config.combat.safeModeExplorePollMs)
      ? Math.max(200, Config.combat.safeModeExplorePollMs)
      : 500;
    const maxWait = Number.isFinite(Config.combat && Config.combat.safeModeExploreMaxWaitMs)
      ? Math.max(5000, Config.combat.safeModeExploreMaxWaitMs)
      : 180000;
    const started = Date.now();
    while (!Runtime.autoFarm.stopRequested) {
      if (Date.now() - started > maxWait) {
        Logger.warn("COMBAT", "Safe-mode explore gate timed out", { hpTh: hpTh, mpTh: mpTh, waitedMs: Date.now() - started });
        return { ok: false, reason: "safe_mode_gate_timeout" };
      }
      const state = readBasicState();
      if (!(typeof state.combat.enemyCount === "number" && state.combat.enemyCount === 0)) {
        return { ok: true, skipped: true, reason: "enemies_present" };
      }
      const hpPct =
        state && state.player && state.player.hp && state.player.hp.valid && Number.isFinite(state.player.hp.pct)
          ? state.player.hp.pct
          : null;
      const mpPct =
        state && state.player && state.player.mp && state.player.mp.valid && Number.isFinite(state.player.mp.pct)
          ? state.player.mp.pct
          : null;
      if (!Number.isFinite(hpPct) || !Number.isFinite(mpPct)) {
        await sleep(pollMs, { bypassStop: true });
        continue;
      }
      if (hpPct >= hpTh && mpPct >= mpTh) {
        break;
      }
      setBotStatus(
        "waiting",
        `safe mode before next tile (HP≥${Math.round(hpTh * 100)}% MP≥${Math.round(mpTh * 100)}%)`
      );
      if (hpPct < hpTh) {
        await tryUseOutOfCombatHpTopoff(state, hpTh);
      }
      if (mpPct < mpTh) {
        await tryUseOutOfCombatMpTopoff(state, mpTh);
      }
      await sleep(pollMs, { bypassStop: true });
    }
    const pbCast = await waitForSafeModeShortPrebuffCooldownsThenCast();
    return { ok: true, hpTh: hpTh, mpTh: mpTh, shortPrebuff: pbCast };
  }

  // AI CHANGED: Shared pass for permanent (≥longDurationMinSec) self support buffs — idle OOC or occupied tile before find-enemy.
  async function runPermanentSelfLongBuffRefreshPass(liveState, opts) {
    const o = opts || {};
    const allowEnemiesOnTile = !!o.allowEnemiesOnTile;
    const root = Config.supportBuffs;
    const perm = root && root.permanentSelf;
    if (!root || root.enabled === false || !perm || perm.enabled === false) {
      return { cast: 0, skipped: true, reason: "disabled" };
    }
    if (!liveState || typeof liveState.combat.enemyCount !== "number") {
      return { cast: 0, skipped: true, reason: "no_enemy_count" };
    }
    const ec = liveState.combat.enemyCount;
    if (allowEnemiesOnTile) {
      if (!(ec > 0)) {
        return { cast: 0, skipped: true, reason: "need_enemies_on_tile" };
      }
    } else if (ec !== 0) {
      return { cast: 0, skipped: true, reason: "not_clear_tile" };
    }
    const longMin = Number.isFinite(root.longDurationMinSec) ? root.longDurationMinSec : 60;
    const renewRem = Number.isFinite(perm.renewWhenRemainingSec) ? perm.renewWhenRemainingSec : 20;
    const classKey = typeof Config.skills.masterClassKey === "string" ? Config.skills.masterClassKey.trim() : "";
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const rt = getSupportBuffLineRuntime();
    const now = Date.now();
    const metaList = [];
    for (let i = 0; i < slots.length; i++) {
      const row = slots[i];
      if (!skillRowIsPermanentOocSelfLongBuff(row, classKey)) {
        continue;
      }
      const dur = resolveSupportBuffDurationSecPreferDb(row, classKey);
      if (!Number.isFinite(dur) || dur < longMin) {
        continue;
      }
      const nameKey =
        typeof normalizeSkillName === "function" ? normalizeSkillName(String(row.name || "")) : String(row.name || "");
      const tracked = rt.longSelfTracked[nameKey];
      const need =
        !tracked ||
        !Number.isFinite(tracked.expectedEndAt) ||
        now >= tracked.expectedEndAt - renewRem * 1000;
      if (!need) {
        continue;
      }
      const slotIdx = typeof row.slot === "number" ? row.slot : i;
      const urgency = tracked && Number.isFinite(tracked.expectedEndAt) ? tracked.expectedEndAt : now + 1e12;
      metaList.push({ slot: slotIdx, row: row, dur: dur, nameKey: nameKey, urgency: urgency });
    }
    metaList.sort(function (a, b) {
      return a.urgency - b.urgency;
    });
    const maxCast = Number.isFinite(perm.maxCastPerPass) ? Math.max(1, Math.floor(perm.maxCastPerPass)) : 6;
    let cast = 0;
    const settleMs = Number.isFinite(Config.combat && Config.combat.postRankedSkillClickSettleMs)
      ? Math.max(120, Config.combat.postRankedSkillClickSettleMs * 4)
      : 180;
    for (let m = 0; m < metaList.length && cast < maxCast; m++) {
      const one = metaList[m];
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(one.slot)) {
        continue;
      }
      if (!clickActionBarSlot(one.slot)) {
        continue;
      }
      rt.longSelfTracked[one.nameKey] = { expectedEndAt: now + Math.round(one.dur * 1000), assumedDurationSec: one.dur };
      cast += 1;
      Logger.log("COMBAT", allowEnemiesOnTile ? "Permanent self-buff before combat" : "Long self-buff renew (OOC)", {
        name: one.row.name,
        durSec: one.dur,
        slot: one.slot
      });
      await sleep(settleMs);
    }
    return { cast: cast, planned: metaList.length };
  }

  async function maybeMaintainLongSelfSupportBuffsOutOfCombat(liveState) {
    const res = await runPermanentSelfLongBuffRefreshPass(liveState, { allowEnemiesOnTile: false });
    return { renewed: res.cast || 0, skipped: res.skipped, reason: res.reason };
  }

  async function maybeApplyPermanentSelfLongBuffsBeforeFindEnemy(liveState) {
    return runPermanentSelfLongBuffRefreshPass(liveState, { allowEnemiesOnTile: true });
  }

  function listScannedSupportBuffClassifications() {
    const out = [];
    const classKey = typeof Config.skills.masterClassKey === "string" ? Config.skills.masterClassKey.trim() : "";
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const longMin = Number.isFinite(Config.supportBuffs && Config.supportBuffs.longDurationMinSec)
      ? Config.supportBuffs.longDurationMinSec
      : 60;
    const shortMax = Number.isFinite(Config.supportBuffs && Config.supportBuffs.shortPrebuffMaxSec)
      ? Config.supportBuffs.shortPrebuffMaxSec
      : 120;
    for (let i = 0; i < slots.length; i++) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !row.isSupport) {
        continue;
      }
      const desc = getSupportBuffDescriptionForRow(row, classKey);
      const d = desc.toLowerCase();
      const dur = resolveSupportBuffDurationSecPreferDb(row, classKey);
      let durationKind = "unknown";
      if (Number.isFinite(dur)) {
        if (dur >= longMin) {
          durationKind = "long";
        } else if (dur <= shortMax) {
          durationKind = "short";
        } else {
          durationKind = "medium";
        }
      }
      let scope = "unknown";
      if (row.targetsSelf && !row.targetsEnemy) {
        scope = "self";
      } else if (!row.targetsSelf) {
        if (d.indexOf("allies") !== -1 || d.indexOf("ally") !== -1 || d.indexOf("party") !== -1 || d.indexOf("friendly") !== -1) {
          scope = "mass";
        } else if (
          Array.isArray(row.tags) &&
          row.tags.some(function (t) {
            return /area|allies|party|nearby|around/i.test(String(t));
          })
        ) {
          scope = "mass";
        }
      }
      const protNeedles = [
        "shield",
        "armor",
        "armour",
        "defense",
        "defence",
        "dodge",
        "barrier",
        "absorb",
        "resist",
        "mitigat",
        "protection",
        "invulnerable",
        "aegis",
        "block",
        "immune"
      ];
      const attNeedles = [
        "damage",
        "attack power",
        "attack rating",
        "critical",
        "haste",
        "speed",
        "power",
        "strength",
        "agility",
        "fury",
        "rage"
      ];
      let hitsProt = false;
      let hitsAtt = false;
      for (let p = 0; p < protNeedles.length; p++) {
        if (d.indexOf(protNeedles[p]) !== -1) {
          hitsProt = true;
          break;
        }
      }
      for (let a = 0; a < attNeedles.length; a++) {
        if (d.indexOf(attNeedles[a]) !== -1) {
          hitsAtt = true;
          break;
        }
      }
      let role = "unknown";
      if (hitsProt && hitsAtt) {
        role = "mixed";
      } else if (hitsProt) {
        role = "protective";
      } else if (hitsAtt) {
        role = "attacking";
      }
      const supportDb =
        typeof lookupSupportSkillClassificationFromGeneratedDb === "function" && classKey
          ? lookupSupportSkillClassificationFromGeneratedDb(classKey, row.name)
          : null;
      out.push({
        slot: typeof row.slot === "number" ? row.slot : i,
        name: row.name,
        durationKind: durationKind,
        durationSecGuess: dur,
        scope: scope,
        role: role,
        isAttack: !!row.isAttack,
        description: desc,
        supportDb: supportDb || null
      });
    }
    return out;
  }

  function listScannedSkillsMatchingSafetyBuffHeuristic() {
    const out = [];
    const classKey = typeof Config.skills.masterClassKey === "string" ? Config.skills.masterClassKey.trim() : "";
    const slots = Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    for (let i = 0; i < slots.length; i++) {
      const row = slots[i];
      if (!row || row.kind !== "skill") {
        continue;
      }
      const desc = getSupportBuffDescriptionForRow(row, classKey);
      const isSafetyLike = supportBuffDescriptionMatchesSafetyIncomingAbsorbHeuristic(desc);
      if (isSafetyLike) {
        out.push({
          slot: typeof row.slot === "number" ? row.slot : i,
          name: row.name,
          description: desc
        });
      }
    }
    return out;
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

  // AI CHANGED: Safe-mode explore gate — drink MP potions toward threshold when enemyCount===0.
  async function tryUseOutOfCombatMpTopoff(liveState, thresholdPct) {
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
    const mpCur =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.cur)
        ? liveState.player.mp.cur
        : null;
    const mpMax =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.max)
        ? liveState.player.mp.max
        : null;
    const mpPct =
      liveState &&
      liveState.player &&
      liveState.player.mp &&
      liveState.player.mp.valid &&
      Number.isFinite(liveState.player.mp.pct)
        ? liveState.player.mp.pct
        : null;
    if (!Number.isFinite(mpCur) || !Number.isFinite(mpMax) || !(mpMax > 0) || !Number.isFinite(mpPct)) {
      return { used: false, reason: "mp_unread" };
    }
    const safeThreshold =
      Number.isFinite(thresholdPct) ? Math.max(0.05, Math.min(1, thresholdPct)) : 0.5;
    if (mpPct >= safeThreshold) {
      return { used: false, reason: "already_above_threshold" };
    }
    const targetCur = mpMax * safeThreshold;
    const missingToThreshold = Math.max(0, targetCur - mpCur);
    if (!(missingToThreshold > 0.5)) {
      return { used: false, reason: "missing_mp_trivial" };
    }
    const potion = chooseCombatPotionCandidate("mp", missingToThreshold, { preferLargest: true });
    if (!potion) {
      return { used: false, reason: "no_ready_mp_potion" };
    }
    const useResult = await tryUseCombatPotion("mp", potion, "out_of_combat_safe_mode_mp_topoff", { ignoreThrottle: true });
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
      await tryUseOutOfCombatIdleLowManaPotion(state);
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

  // AI CHANGED: Combat episode v1 — drop structured burst plan when target/context resets (logged once when something was stored).
  function clearCombatEpisode(reason) {
    if (!Runtime || !Runtime.autoFarm) {
      return;
    }
    if (Runtime.autoFarm.combatEpisode != null) {
      Logger.log("COMBAT", "combatEpisode cleared", { reason: reason || "unspecified" });
    }
    Runtime.autoFarm.combatEpisode = null;
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

  // AI CHANGED: After mid-pull retarget the game winds a default basic — do not click opener or cancel; arm queue on Attack cast (see applyPostRetargetQueueOpenerPick).

  // AI CHANGED: Post-retarget burst — skip opener bar click; queue planner non-charge opener skill while game basic casts; charge opener falls back to normal tap path.
  async function applyPostRetargetQueueOpenerPick(pickWrap, opts, excludeSlots) {
    const wrap = pickWrap && typeof pickWrap === "object" ? pickWrap : { useRankedPath: false, opening: null };
    if (wrap.useRankedPath && wrap.opening && wrap.opening.slot != null && wrap.opening.record) {
      const sr = wrap.opening.record;
      const isCharge =
        sr && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(sr);
      if (isCharge) {
        Logger.log("LOOP", "Post-retarget: charge opener from planner — using standard opener click path", {
          slot: wrap.opening.slot
        });
        return applyPlannerOpeningPick(wrap, opts, excludeSlots);
      }
      const qa = {
        mode: "skill",
        slot: wrap.opening.slot,
        name: sr.name || "",
        source: "post_retarget_queue_after_game_basic"
      };
      Logger.log("COMBAT", "Post-retarget: no cancel, no opener click; queue skill on game basic cast bar", {
        queuedSlot: qa.slot,
        queuedName: qa.name
      });
      return {
        ok: true,
        skillSlot: null,
        skillRecord: null,
        chargeReleasePlan: null,
        queuedAction: qa
      };
    }
    if (wrap.useRankedPath && !wrap.opening) {
      const bq =
        !(opts && opts.allowCombatQueue === false) &&
        Config.combat &&
        Config.combat.combatQueueEnabled !== false &&
        typeof plannerBuildCombatQueueAction === "function"
          ? plannerBuildCombatQueueAction({
              afterSlot: null,
              liveState: readBasicState(),
              disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
            })
          : null;
      if (bq && bq.mode) {
        Logger.log("COMBAT", "Post-retarget: no ranked opener — arm queue follow-up only (game basic first)", {
          mode: bq.mode,
          slot: bq.slot
        });
        return {
          ok: true,
          skillSlot: null,
          skillRecord: null,
          chargeReleasePlan: null,
          queuedAction: bq
        };
      }
      Logger.log("COMBAT", "Post-retarget: no opener and no queue action — wait for game basic progress only", {});
      return { ok: true, skillSlot: null, skillRecord: null, chargeReleasePlan: null, queuedAction: null };
    }
    return applyPlannerOpeningPick(wrap, opts, excludeSlots);
  }

  // AI CHANGED: Combat episode v1 — split ranked pick vs click so `attackUntilProgress` can snapshot the plan without double-calling the planner.
  function resolvePlannerOpeningPick(opts, excludeSlots) {
    const useRankedPath =
      Config.planner.useRankedAttackSkillsInCombat &&
      (!opts || opts.useRankedSkillOpener !== false);
    if (!useRankedPath) {
      return { useRankedPath: false, opening: null };
    }
    const opening = plannerPickSkillOpeningPick({
      excludeSlots: excludeSlots || [],
      disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
    });
    return { useRankedPath: true, opening: opening };
  }

  // AI CHANGED: Phase C4 slice 8 — first swing: ranked attack skill (if enabled + pick), else basic attack.
  // AI CHANGED: slice 9 — optional opts.useRankedSkillOpener === false forces basic-only (follow-up bursts).
  // AI CHANGED: slice 22 — combat opener is tap-only (clickActionBarSlot); no synthetic bar hold — game uses tap for skills including charge start.
  // AI CHANGED: slice 15 — excludeSlots skips bar indices already used this burst (alternate ranked openers).
  async function applyPlannerOpeningPick(pickWrap, opts, excludeSlots) {
    const wrap = pickWrap && typeof pickWrap === "object" ? pickWrap : { useRankedPath: false, opening: null };
    const useRankedPath = !!wrap.useRankedPath;
    const opening = wrap.opening;
    if (useRankedPath && opening != null) {
      const ok = clickActionBarSlot(opening.slot); // AI CHANGED: slice 22 — always normal bar click
      if (ok) {
        plannerRecordOpenerRuntimeEvent("ranked_pick", {
          slot: opening.slot,
          excluded: (excludeSlots || []).slice(0, 8)
        });
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
    } else if (useRankedPath && opening == null) {
      plannerRecordOpenerRuntimeEvent("ranked_pick_none", {
        reason: Runtime.planner && Runtime.planner.lastOpeningPickReason ? Runtime.planner.lastOpeningPickReason : null
      });
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

  async function clickPlannerOpeningAttack(opts, excludeSlots) {
    return applyPlannerOpeningPick(resolvePlannerOpeningPick(opts, excludeSlots), opts, excludeSlots);
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

  function getAttackProgressSafetyOnEachPoll() {
    if (!Config.supportBuffs || Config.supportBuffs.enabled === false) {
      return undefined;
    }
    const sb = Config.supportBuffs.safety;
    if (!sb || sb.enabled === false) {
      return undefined;
    }
    return function attackProgressSafetyOnEachPoll() {
      const live = readBasicState();
      updateCombatSustainObservations(live);
      processCombatSafetyHpSpikeIfNeeded(live);
    };
  }

  function attackProgressWaitOptions(timeoutMs, pollMs) {
    const o = { timeoutMs: timeoutMs, pollMs: pollMs };
    const hook = getAttackProgressSafetyOnEachPoll();
    if (hook) {
      o.onEachPoll = hook;
    }
    return o;
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
      // AI CHANGED: Log after successful cancel click; distinguish hint-missing vs cast-bar gate / map-gap failure.
      const expectedN = open.skillRecord && open.skillRecord.name ? String(open.skillRecord.name) : "";
      const released = clickChargingSkillCancelUi({ expectedSkillName: expectedN });
      if (released) {
        Logger.log("LOOP", "Charge skill release via cancel UI", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction
        });
        if (settleRanked > 0) {
          await sleep(settleRanked);
        }
        if (Runtime.autoFarm.stopRequested) {
          return { handled: true, progressed: false };
        }
      } else if (isChargingSkillCancelHintVisible()) {
        Logger.warn("LOOP", "Charge release: cancel UI not fired (cast bar name gate, empty expected name, or click failed)", {
          slot: open.skillSlot,
          releaseMs: chargePlan.releaseMs,
          releaseFraction: chargePlan.releaseFraction,
          expectedSkillName: expectedN,
          castBarLabels: typeof readVisibleCombatCastBarTexts === "function" ? readVisibleCombatCastBarTexts() : []
        });
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
    let cancelVerifyMs = cancelReleaseTimeout;
    if (chargePlan.strategy === "cancel_release") {
      const thRaw = Config.combat.chargeSkillReleaseLateTinyFractionThreshold;
      const fracTh = Number.isFinite(thRaw) && thRaw > 0 && thRaw < 1 ? thRaw : 0.12;
      const rf = Number.isFinite(chargePlan.releaseFraction) ? chargePlan.releaseFraction : 1;
      if (rf < fracTh) {
        const tinyFirstRaw = Config.combat.chargeSkillReleaseTinyFractionProgressTimeoutMs;
        if (Number.isFinite(tinyFirstRaw) && tinyFirstRaw > 0) {
          cancelVerifyMs = Math.min(Math.max(cancelReleaseTimeout, tinyFirstRaw), fullTimeoutMs);
        }
        if (cancelVerifyMs > cancelReleaseTimeout) {
          Logger.log("LOOP", "Charge cancel_release: widened first progress timeout for tiny releaseFraction", {
            slot: open.skillSlot,
            releaseFraction: rf,
            timeoutMs: cancelVerifyMs
          });
        }
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
      attackProgressWaitOptions(chargePlan.strategy === "full_charge" ? fullChargeTimeout : cancelVerifyMs, pollMs)
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

    const fpNow =
      typeof plannerResolveCombatEpisodeTargetKey === "function"
        ? plannerResolveCombatEpisodeTargetKey(beforeState)
        : null;
    if (
      fpNow &&
      Runtime.autoFarm.combatEpisode &&
      Runtime.autoFarm.combatEpisode.targetFingerprint &&
      Runtime.autoFarm.combatEpisode.targetFingerprint !== fpNow
    ) {
      clearCombatEpisode("target_fingerprint_changed");
    }

    const pickWrap = resolvePlannerOpeningPick(opts, []);

    let planPickForEpisode = null;
    // AI CHANGED: Episode telemetry — post-retarget queue-only path shows game basic then first queued skill, not a phantom opener_skill click.
    if (opts && opts.firstBurstAfterRetarget) {
      if (pickWrap.useRankedPath && pickWrap.opening && pickWrap.opening.slot != null && pickWrap.opening.record) {
        const srEp = pickWrap.opening.record;
        const isChargeEp =
          srEp && typeof plannerGetChargeSkillEffect === "function" && plannerGetChargeSkillEffect(srEp);
        if (!isChargeEp) {
          planPickForEpisode = {
            slot: null,
            record: null,
            chargeReleasePlan: null,
            queuedAction: {
              mode: "skill",
              slot: pickWrap.opening.slot,
              name: srEp.name || "",
              source: "post_retarget_after_implicit_basic"
            }
          };
        }
      }
    }
    if (!planPickForEpisode) {
      if (pickWrap.useRankedPath && pickWrap.opening) {
        planPickForEpisode = pickWrap.opening;
      } else {
        const bq =
          !(opts && opts.allowCombatQueue === false) &&
          Config.combat &&
          Config.combat.combatQueueEnabled !== false &&
          typeof plannerBuildCombatQueueAction === "function"
            ? plannerBuildCombatQueueAction({
                afterSlot: null,
                liveState: beforeState,
                disallowChargeSkills: !!(opts && opts.disallowChargeSkills)
              })
            : null;
        planPickForEpisode = {
          slot: null,
          record: null,
          chargeReleasePlan: null,
          queuedAction: bq
        };
      }
    }

    if (typeof plannerBuildCombatEpisodePlan === "function") {
      Runtime.autoFarm.combatEpisode = plannerBuildCombatEpisodePlan(beforeState, planPickForEpisode, opts);
      Logger.log("COMBAT", "combatEpisode built", {
        fingerprint: fpNow,
        steps: Runtime.autoFarm.combatEpisode ? Runtime.autoFarm.combatEpisode.stepsTotal : 0,
        firstKind:
          Runtime.autoFarm.combatEpisode &&
          Runtime.autoFarm.combatEpisode.steps &&
          Runtime.autoFarm.combatEpisode.steps[0]
            ? Runtime.autoFarm.combatEpisode.steps[0].kind
            : null
      });
    } else {
      clearCombatEpisode("planner_build_missing");
    }

    const open =
      opts && opts.firstBurstAfterRetarget
        ? await applyPostRetargetQueueOpenerPick(pickWrap, opts, [])
        : await applyPlannerOpeningPick(pickWrap, opts, []);
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
    // AI CHANGED: Queue only for non-charge openers; alternate openers need their own gate (first pick can be charge while follow-up is not).
    function combatQueueAllowedForOpenerPick(openerPick) {
      if (!openerPick) {
        return false;
      }
      if (opts && opts.allowCombatQueue === false) {
        return false;
      }
      if (!Config.combat || Config.combat.combatQueueEnabled === false) {
        return false;
      }
      if (openerPick.skillSlot == null) {
        return true;
      }
      const sr = openerPick.skillRecord;
      const isChargePick = !!(
        sr &&
        typeof plannerGetChargeSkillEffect === "function" &&
        plannerGetChargeSkillEffect(sr)
      );
      return !isChargePick;
    }
    const queueAllowedOpen = combatQueueAllowedForOpenerPick(open);
    let queuedActionFired = false;
    const queueAdvanceTick = function () {
      // AI CHANGED: If queue was armed on an alternate non-charge opener, ticks must still run — do not gate on first opener's charge-only queueAllowed.
      if (!getCombatQueueRuntime().active) {
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
    if (queueAllowedOpen && open && open.queuedAction) {
      const queuedState = armCombatActionQueue(open.queuedAction, {
        anchorMode: open.skillSlot != null ? "skill" : "basic",
        anchorSlot: open.skillSlot,
        anchorName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : "Basic Attack",
        anchorSource: open.skillSlot != null ? "opening_attack" : "opening_basic",
        openerSlot: open.skillSlot,
        openerName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : (open.skillSlot == null ? "Basic Attack" : null),
        liveState: readBasicState(),
        postRetargetGuarded: false
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
      // AI CHANGED: cancel_release often lands damage just after the aggressive 250ms window; without this we skipped straight to alternate openers (chaotic clicks). Optional second wait before ranked_alt_pick.
      const chargePlanForLate = open && open.chargeReleasePlan ? open.chargeReleasePlan : null;
      const lateStrat = chargePlanForLate && chargePlanForLate.strategy ? chargePlanForLate.strategy : "";
      if (lateStrat === "cancel_release" || lateStrat === "full_charge") {
        const lateRaw = Config.combat.chargeSkillReleaseLateProgressTimeoutMs;
        let lateMs =
          Number.isFinite(lateRaw) && lateRaw > 0 ? Math.min(lateRaw, fullTimeoutMs) : Math.min(2000, fullTimeoutMs);
        // AI CHANGED: Micro cancel_release (planner tiny fraction + min hold) rarely needs multi-second silence; user clip showed ~3.6s idle before alternates.
        let lateTinyNote = null;
        if (lateStrat === "cancel_release" && chargePlanForLate) {
          const thRaw = Config.combat.chargeSkillReleaseLateTinyFractionThreshold;
          const fracTh =
            Number.isFinite(thRaw) && thRaw > 0 && thRaw < 1 ? thRaw : 0.12;
          const rf = Number.isFinite(chargePlanForLate.releaseFraction) ? chargePlanForLate.releaseFraction : 1;
          if (rf < fracTh) {
            const capRaw = Config.combat.chargeSkillReleaseLateTinyCancelCapMs;
            const capMs =
              Number.isFinite(capRaw) && capRaw >= 400 ? Math.min(capRaw, lateMs) : Math.min(1150, lateMs);
            lateMs = Math.max(450, Math.min(lateMs, capMs));
            lateTinyNote = { releaseFraction: rf, capMs: capMs };
          }
        }
        Logger.log("LOOP", "Charge opener: no progress in fast verify window; extended wait before alternates", {
          slot: open.skillSlot,
          strategy: lateStrat,
          extendedTimeoutMs: lateMs,
          lateTinyCap: lateTinyNote
        });
        const progressedLate = await waitForCondition(
          "attack progress after charge release (extended)",
          buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
          attackProgressWaitOptions(lateMs, pollMs)
        );
        if (progressedLate) {
          plannerRecordOpenerRuntimeEvent("ranked_progress", {
            slot: open.skillSlot,
            stage: lateStrat === "full_charge" ? "after_full_charge_extended" : "after_charge_release_extended"
          });
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
      // AI CHANGED: removed rankedOpenerEarlyCancelIfHintAfterMs partial-wait + early cancel UI — single first wait only; stuck path below still clears hint when full wait fails.
      progressed = await waitForCondition(
        "attack progress",
        buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
        attackProgressWaitOptions(firstWaitTimeoutMs, pollMs)
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

    // AI CHANGED: slice 21b — stop-aborted wait must not fall through to more clicks (alternate opener / basic).
    if (Runtime.autoFarm.stopRequested) {
      Logger.log("LOOP", "attackUntilProgress: stop requested after opener wait; skipping follow-up attacks");
      return false;
    }

    // AI CHANGED: slice 24b — charge skill stuck: first wait saw no HP/count (CD not running until cancel or full shot). Tap cancel UI only when needed, not a second bar click.
    if (
      !chargeSkillHandled &&
      open.skillSlot != null &&
      Config.combat.rankedOpenerClickCancelUiIfChargeStuck !== false &&
      isChargingSkillCancelHintVisible()
    ) {
      Logger.log("LOOP", "Charge cancel hint visible after opener wait; map-gap / cancel UI (not bar slot)", {
        slot: open.skillSlot
      });
      // AI CHANGED: Cast-bar name gate when enabled — only cancel if bar shows this charge skill (reduces false stuck cancels).
      clickChargingSkillCancelUi({
        expectedSkillName: open.skillRecord && open.skillRecord.name ? String(open.skillRecord.name) : ""
      });
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
        attackProgressWaitOptions(postCancelTimeout, pollMs)
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
      const queueAllowedAlt = combatQueueAllowedForOpenerPick(open2);
      if (queueAllowedAlt && open2 && open2.queuedAction) {
        armCombatActionQueue(open2.queuedAction, {
          anchorMode: "skill",
          anchorSlot: open2.skillSlot,
          anchorName: open2.skillRecord && open2.skillRecord.name ? open2.skillRecord.name : "",
          anchorSource: "alternate_ranked_opening",
          openerSlot: open.skillSlot,
          openerName: open.skillRecord && open.skillRecord.name ? open.skillRecord.name : (open.skillSlot == null ? "Basic Attack" : null),
          liveState: readBasicState(),
          postRetargetGuarded: false
        });
      }
      if (settleRanked > 0) {
        await sleep(settleRanked);
      }
      progressed = await waitForCondition(
        "attack progress",
        buildAttackProgressOrQueueAdvancePredicate(beforeState, { onQueueAdvance: queueAdvanceTick }),
        attackProgressWaitOptions(fullTimeoutMs, pollMs)
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
      const queueAllowedBasic =
        !(opts && opts.allowCombatQueue === false) &&
        Config.combat &&
        Config.combat.combatQueueEnabled !== false;
      if (queueAllowedBasic && typeof plannerBuildCombatQueueAction === "function") {
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
            postRetargetGuarded: false
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
        attackProgressWaitOptions(fullTimeoutMs, pollMs)
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
    clearCombatEpisode("secure_cycle_start");
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
    if (typeof startState.combat.enemyCount === "number" && startState.combat.enemyCount > 0) {
      setBotStatus("preparing", "permanent self-buffs (before prebuff / find-enemy)");
      await maybeApplyPermanentSelfLongBuffsBeforeFindEnemy(startState);
      current = readBasicState();
      setBotStatus("preparing", "new-tile prebuffs (before find-enemy)");
      await maybeApplySupportPrebuffsOnNewTile(current);
      current = readBasicState();
    }
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

      // AI CHANGED: Map was opened for prep/explore — close overlay after successful find-enemy for battle view.
      await closeMapIfOpenAfterFindEnemy();

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

        current = readBasicState();
        await maybeCombatSafetyBuffInterrupt(current);
        current = readBasicState();

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
          allowCombatQueue: true
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
          // AI CHANGED: Re-find via find-enemy only — attackers-popup path does not open map for find.
          if (refindOk.via !== "attackers_popup") {
            await closeMapIfOpenAfterFindEnemy();
          }
          if (!refindOk || refindOk.via !== "attackers_popup") {
            const reAcquired = await waitForTargetAcquired();
            if (!reAcquired) {
              Logger.warn("LOOP", "Target HP not detected after re-find; continuing by enemy-count logic");
            }
          }
          // AI CHANGED: No post-retarget cancel — game winds default basic; first burst arms queue on Attack cast (applyPostRetargetQueueOpenerPick).
          current = readBasicState();
          if (typeof current.combat.enemyCount === "number" && current.combat.enemyCount <= 0) {
            Logger.log("LOOP", "Enemies cleared during re-find after kill");
            break;
          }
          clearCombatEpisode("post_kill_retarget");
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
      combatMode: status.combatMode || "fast",
      reliability: status.reliability || null,
      chatSpammer: status.chatSpammer || null,
      health: status.health || null,
      recovery: status.recovery || null,
      lastSessionSummary: status.lastSessionSummary || null
    };
  }

  // AI CHANGED: AUTO panel combat mode — Fast (ranked every burst, min MP reserve), Safe (tile-to-tile resource gate + short prebuffs), Easy (basics only).
  function applyAutoFarmCombatMode() {
    const raw =
      Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode).toLowerCase() : "fast";
    const mode = raw === "easy" || raw === "safe" || raw === "fast" ? raw : "fast";
    Runtime.autoFarm.combatMode = mode;
    if (mode === "easy") {
      Config.planner.useRankedAttackSkillsInCombat = false;
      Logger.log("AUTO", "combat mode easy: ranked skills off (basic attacks only)");
      return;
    }
    Config.planner.useRankedAttackSkillsInCombat = true;
    if (mode === "fast") {
      Config.planner.useRankedSkillOnlyFirstBurstAfterFind = false;
      Config.planner.skillMpReserve = 0;
      Logger.log("AUTO", "combat mode fast: ranked every burst, skillMpReserve 0 (max DPS)");
    } else {
      Config.planner.useRankedSkillOnlyFirstBurstAfterFind = true;
      Config.planner.skillMpReserve = 5;
      Logger.log(
        "AUTO",
        "combat mode safe: ranked first burst only, skillMpReserve 5; idle explore waits HP/MP floors (see combat.safeModeExplore*) then short prebuff CDs"
      );
    }
  }

  function setAutoFarmCombatMode(mode) {
    const raw = String(mode || "fast").toLowerCase();
    const norm = raw === "easy" || raw === "safe" || raw === "fast" ? raw : "fast";
    Runtime.autoFarm.combatMode = norm;
    applyAutoFarmCombatMode();
    return { ok: true, combatMode: norm };
  }

  function restorePlannerAfterAutoFarmLoop() {
    const snap = Runtime.autoFarm.plannerSnapshotBeforeAuto;
    if (snap && typeof snap === "object") {
      if (typeof snap.useRankedAttackSkillsInCombat === "boolean") {
        Config.planner.useRankedAttackSkillsInCombat = snap.useRankedAttackSkillsInCombat;
      }
      if (typeof snap.useRankedSkillOnlyFirstBurstAfterFind === "boolean") {
        Config.planner.useRankedSkillOnlyFirstBurstAfterFind = snap.useRankedSkillOnlyFirstBurstAfterFind;
      }
      if (typeof snap.skillMpReserve === "number" && Number.isFinite(snap.skillMpReserve)) {
        Config.planner.skillMpReserve = snap.skillMpReserve;
      }
      Runtime.autoFarm.plannerSnapshotBeforeAuto = null;
      Logger.log("AUTO", "restored planner flags after AUTO session", snap);
    }
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
    Runtime.autoFarm.plannerSnapshotBeforeAuto = {
      useRankedAttackSkillsInCombat: !!Config.planner.useRankedAttackSkillsInCombat,
      useRankedSkillOnlyFirstBurstAfterFind: !!Config.planner.useRankedSkillOnlyFirstBurstAfterFind,
      skillMpReserve: Number.isFinite(Config.planner.skillMpReserve) ? Config.planner.skillMpReserve : 5
    };
    // AI CHANGED: Apply Fast/Safe/Easy combat pipeline for this AUTO session (restored when loop exits).
    applyAutoFarmCombatMode();
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
      // AI CHANGED: Re-apply combat mode each cycle so mid-session panel changes take effect without restart.
      applyAutoFarmCombatMode();
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
          // AI CHANGED: Renew long self-support buffs on empty tiles before heal gate / explore (OOC only).
          await maybeMaintainLongSelfSupportBuffsOutOfCombat(readBasicState());
          await tryUseOutOfCombatIdleLowManaPotion(readBasicState());
          const modeIdle =
            Runtime.autoFarm && Runtime.autoFarm.combatMode ? String(Runtime.autoFarm.combatMode).toLowerCase() : "fast";
          if (modeIdle === "safe") {
            const safeGate = await waitForSafeModeExploreResourcesAndShortPrebuffs();
            if (safeGate && safeGate.ok === false && safeGate.reason === "safe_mode_gate_timeout") {
              Logger.warn("AUTO", "Safe mode tile gate timed out — continuing toward explore", safeGate);
            }
          }
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
      lastStage: Runtime.autoFarm.lastResult ? Runtime.autoFarm.lastResult.stage || null : null,
      combatMode: Runtime.autoFarm.combatMode || "fast"
    };
    // AI CHANGED: consume stop flag when loop ends — if it stays true, waitForCondition (hero stats, verifies) aborts on first tick and leaves profile on wrong tab after TEST.
    Runtime.autoFarm.stopRequested = false;
    restorePlannerAfterAutoFarmLoop();
    // AI CHANGED: Only set "stopped" if we weren't already halted by failures.
    if (Runtime.status.phase !== "halted") {
      setBotStatus("stopped", `${Runtime.autoFarm.cyclesCompleted} cycles completed`);
    }
    const finalStatus = getAutoFarmStatus();
    Logger.log("AUTO", "Auto-farm loop exited", finalStatus);
    return { ok: true, status: finalStatus };
  }
