  // --- Layer 1 Module: 15-logger.js (High-Performance Level-Aware Logger) ---
  // Implements logging levels (DEBUG, INFO, WARN, ERROR), collapsing duplicate lines,
  // and a rolling in-memory ring buffer of the last 200 entries for diagnostic exports.

  const Logger = (function () {
    const SEVERITIES = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };

    // Rolling Ring Buffer (keeps exactly the last 200 formatted lines)
    const RING_BUFFER_MAX_SIZE = 200;
    const ringBuffer = [];

    // Deduplication State
    let lastLogLine = "";
    let duplicateCount = 0;
    let duplicateTimer = null;
    let firstSeenAt = 0;
    let lastTag = "";
    let lastLevel = "INFO";

    function pushToRingBuffer(formattedLine) {
      ringBuffer.push(formattedLine);
      if (ringBuffer.length > RING_BUFFER_MAX_SIZE) {
        ringBuffer.shift();
      }
    }

    function getLogLevelValue(levelStr) {
      const u = String(levelStr || "").toUpperCase();
      return Number.isFinite(SEVERITIES[u]) ? SEVERITIES[u] : 1; // Default to INFO (1)
    }

    function formatTimestamp(dateObj) {
      return dateObj.toISOString();
    }

    // Flush any pending collapsed duplicates
    function flushDedup() {
      if (duplicateCount > 0) {
        const repeatMsg = `[${lastTag}] ${lastLogLine} (repeated ${duplicateCount + 1} times)`;
        const timeStr = formatTimestamp(new Date());
        const consoleLine = `[${timeStr}] ${repeatMsg}`;
        
        // Print to actual console matching original level severity
        const activeFilterVal = getLogLevelValue(Config && Config.logging && Config.logging.level ? Config.logging.level : "INFO");
        const msgLevelVal = getLogLevelValue(lastLevel);

        if (msgLevelVal >= activeFilterVal) {
          if (lastLevel === "ERROR") {
            console.error(consoleLine);
          } else if (lastLevel === "WARN") {
            console.warn(consoleLine);
          } else {
            console.log(consoleLine);
          }
        }
        
        pushToRingBuffer(consoleLine);
        duplicateCount = 0;
      }
      if (duplicateTimer) {
        clearTimeout(duplicateTimer);
        duplicateTimer = null;
      }
      lastLogLine = "";
    }

    function writeLog(level, tag, message, details) {
      const filterLevelStr = Config && Config.logging && Config.logging.level ? Config.logging.level : "INFO";
      const filterVal = getLogLevelValue(filterLevelStr);
      const msgVal = getLogLevelValue(level);

      const msgText = typeof message === "object" ? JSON.stringify(message) : String(message);
      const fullLine = details !== undefined ? `${msgText} ${JSON.stringify(details)}` : msgText;

      // Deduplication check
      if (fullLine === lastLogLine && tag === lastTag && level === lastLevel) {
        duplicateCount += 1;
        if (!duplicateTimer) {
          firstSeenAt = Date.now();
          // Flush automatically after 4 seconds of continuous repeats
          duplicateTimer = setTimeout(flushDedup, 4000);
        }
        return;
      }

      // If a different line arrives, flush the old duplicate first
      if (duplicateCount > 0) {
        flushDedup();
      }

      lastLogLine = fullLine;
      lastTag = tag;
      lastLevel = level;
      firstSeenAt = Date.now();

      const timeStr = formatTimestamp(new Date());
      const prefix = `[${timeStr}] [${tag}]`;
      const consoleMsg = `${prefix} ${fullLine}`;

      // Write to console if matches level filter
      if (msgVal >= filterVal) {
        if (level === "ERROR") {
          console.error(consoleMsg);
        } else if (level === "WARN") {
          console.warn(consoleMsg);
        } else {
          console.log(consoleMsg);
        }
      }

      pushToRingBuffer(consoleMsg);
    }

    return {
      debug: function (tag, message, details) {
        writeLog("DEBUG", tag, message, details);
      },
      log: function (tag, message, details) {
        writeLog("INFO", tag, message, details);
      },
      warn: function (tag, message, details) {
        writeLog("WARN", tag, message, details);
      },
      error: function (tag, message, details) {
        writeLog("ERROR", tag, message, details);
      },
      flushDedup: flushDedup,
      
      // Public Diagnostic Exports
      getRingBuffer: function () {
        return ringBuffer.slice();
      },
      copyIssueReportLogs: function (linesToReturn) {
        flushDedup();
        const cnt = typeof linesToReturn === "number" ? linesToReturn : 30;
        const slice = ringBuffer.slice(-cnt);
        const header = `--- LIGMARBOT_ISSUE_LOG_CLIP_START (v${BotVersion && BotVersion.version ? BotVersion.version : "unknown"}) ---`;
        const footer = "--- LIGMARBOT_ISSUE_LOG_CLIP_END ---";
        const text = [header, ...slice, footer].join("\n");
        
        try {
          navigator.clipboard.writeText(text);
          console.log("[LOGGER] Logs copied to clipboard successfully.");
        } catch (err) {
          console.warn("[LOGGER] Failed to copy logs automatically:", err);
        }
        return text;
      }
    };
  })();
