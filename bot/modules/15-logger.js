  // AI CHANGED: Added consistent module-based logging with timestamps for debugging.
  // AI CHANGED: In-memory ring buffer so soak/issue reports can copy last N lines without DevTools (panel STOP+COPY LOGS).
  const LOGGER_RECENT_MAX = 200;
  const LOGGER_PAYLOAD_MAX_CHARS = 1800;

  const _recentLogLines = [];

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
    log(module, message, payload) {
      const ts = new Date().toISOString();
      pushRecentLogLine("log", module, message, payload);
      if (typeof payload === "undefined") {
        console.log(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.log(`[${ts}] [${module}] ${message}`, payload);
    },
    warn(module, message, payload) {
      const ts = new Date().toISOString();
      pushRecentLogLine("warn", module, message, payload);
      if (typeof payload === "undefined") {
        console.warn(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.warn(`[${ts}] [${module}] ${message}`, payload);
    },
    error(module, message, payload) {
      const ts = new Date().toISOString();
      pushRecentLogLine("error", module, message, payload);
      if (typeof payload === "undefined") {
        console.error(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.error(`[${ts}] [${module}] ${message}`, payload);
    }
  };
