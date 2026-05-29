  // AI CHANGED: Added consistent module-based logging with timestamps for debugging.
  // AI CHANGED: In-memory ring buffer so soak/issue reports can copy last N lines without DevTools (panel STOP+COPY LOGS).
  const LOGGER_RECENT_MAX = 200;
  const LOGGER_PAYLOAD_MAX_CHARS = 1800;
  // AI CHANGED: Audit fix #15 — consecutive identical log/warn/error lines (same level/module/message/payload signature) are collapsed; emit a single `(repeated N times)` summary when a different line arrives or `LOGGER_DEDUP_FLUSH_MS` elapses.
  const LOGGER_DEDUP_FLUSH_MS = 4000;

  const _recentLogLines = [];
  const _dedupState = {
    sig: null,
    level: null,
    module: null,
    message: null,
    payload: undefined,
    count: 0,
    firstAt: 0,
    lastAt: 0,
    flushTimer: null
  };

  function buildDedupSignature(level, module, message, payload) {
    let payloadKey;
    if (payload === undefined) {
      payloadKey = "_u";
    } else if (typeof payload === "string") {
      payloadKey = payload.length > 240 ? payload.slice(0, 240) : payload;
    } else {
      try {
        const s = JSON.stringify(payload);
        payloadKey = s.length > 240 ? s.slice(0, 240) : s;
      } catch (e) {
        payloadKey = "_p_err";
      }
    }
    return level + "|" + module + "|" + message + "|" + payloadKey;
  }

  function stringifyLoggerPayload(payload) {
    if (payload === undefined) {
      return "";
    }
    if (typeof payload === "string") {
      return payload.length > LOGGER_PAYLOAD_MAX_CHARS
        ? payload.slice(0, LOGGER_PAYLOAD_MAX_CHARS) + "…"
        : payload;
    }
    try {
      const s = JSON.stringify(payload);
      return s.length > LOGGER_PAYLOAD_MAX_CHARS ? s.slice(0, LOGGER_PAYLOAD_MAX_CHARS) + "…" : s;
    } catch (e) {
      return "[payload_json_error]";
    }
  }

  function pushRecentLogLine(level, module, message, payload) {
    const ts = new Date().toISOString();
    const payloadStr = stringifyLoggerPayload(payload);
    const line =
      payloadStr === ""
        ? `[${ts}] [${module}] [${level}] ${message}`
        : `[${ts}] [${module}] [${level}] ${message} ${payloadStr}`;
    _recentLogLines.push(line);
    if (_recentLogLines.length > LOGGER_RECENT_MAX) {
      _recentLogLines.splice(0, _recentLogLines.length - LOGGER_RECENT_MAX);
    }
  }

  // AI CHANGED: Audit fix #15 — flushed when a different signature arrives or the timer fires; emits a single summary line so the ring buffer keeps useful diagnostics.
  function flushDedupSummary(nowMs) {
    if (_dedupState.flushTimer != null) {
      try {
        clearTimeout(_dedupState.flushTimer);
      } catch (e) {
        // ignore
      }
      _dedupState.flushTimer = null;
    }
    if (!_dedupState.sig || _dedupState.count <= 1) {
      _dedupState.sig = null;
      _dedupState.count = 0;
      return;
    }
    const extra = _dedupState.count - 1;
    const spanMs = Math.max(0, (Number.isFinite(nowMs) ? nowMs : Date.now()) - _dedupState.firstAt);
    const summary = {
      repeated: extra,
      spanMs: spanMs,
      lastAt: _dedupState.lastAt,
      module: _dedupState.module,
      message: _dedupState.message
    };
    const ts = new Date().toISOString();
    pushRecentLogLine("log", "LOG", `(repeated ${extra} times) ${_dedupState.module}: ${_dedupState.message}`, summary);
    try {
      console.log(`[${ts}] [LOG] (repeated ${extra} times) ${_dedupState.module}: ${_dedupState.message}`, summary);
    } catch (e) {
      // ignore console failures
    }
    _dedupState.sig = null;
    _dedupState.count = 0;
  }

  function loggerCoreEmit(level, module, message, payload) {
    const ts = new Date().toISOString();
    const sig = buildDedupSignature(level, module, message, payload);
    const now = Date.now();
    if (sig === _dedupState.sig) {
      _dedupState.count += 1;
      _dedupState.lastAt = now;
      if (_dedupState.flushTimer == null) {
        _dedupState.flushTimer = setTimeout(function () {
          _dedupState.flushTimer = null;
          flushDedupSummary(Date.now());
        }, LOGGER_DEDUP_FLUSH_MS);
      }
      return;
    }
    if (_dedupState.sig) {
      flushDedupSummary(now);
    }
    _dedupState.sig = sig;
    _dedupState.level = level;
    _dedupState.module = module;
    _dedupState.message = message;
    _dedupState.payload = payload;
    _dedupState.count = 1;
    _dedupState.firstAt = now;
    _dedupState.lastAt = now;
    pushRecentLogLine(level, module, message, payload);
    const out = typeof payload === "undefined" ? null : payload;
    const consoleMethod = level === "warn" ? console.warn : level === "error" ? console.error : console.log;
    if (out === null) {
      consoleMethod(`[${ts}] [${module}] ${message}`);
    } else {
      consoleMethod(`[${ts}] [${module}] ${message}`, out);
    }
  }

  const Logger = {
    getRecentLogLines(count) {
      const n = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), LOGGER_RECENT_MAX) : 30;
      if (!_recentLogLines.length) {
        return [];
      }
      const start = Math.max(0, _recentLogLines.length - n);
      return _recentLogLines.slice(start);
    },
    getRecentLogLinesText(count) {
      return this.getRecentLogLines(count).join("\n");
    },
    // AI CHANGED: Audit fix #15 — expose forced flush for TEST + edge-case callers that want a clean snapshot.
    flushDedup() {
      flushDedupSummary(Date.now());
    },
    log(module, message, payload) {
      loggerCoreEmit("log", module, message, payload);
    },
    warn(module, message, payload) {
      loggerCoreEmit("warn", module, message, payload);
    },
    error(module, message, payload) {
      loggerCoreEmit("error", module, message, payload);
    }
  };
