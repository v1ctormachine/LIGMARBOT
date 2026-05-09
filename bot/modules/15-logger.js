  // AI CHANGED: Added consistent module-based logging with timestamps for debugging.
  const Logger = {
    log(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.log(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.log(`[${ts}] [${module}] ${message}`, payload);
    },
    warn(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.warn(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.warn(`[${ts}] [${module}] ${message}`, payload);
    },
    error(module, message, payload) {
      const ts = new Date().toISOString();
      if (typeof payload === "undefined") {
        console.error(`[${ts}] [${module}] ${message}`);
        return;
      }
      console.error(`[${ts}] [${module}] ${message}`, payload);
    }
  };
