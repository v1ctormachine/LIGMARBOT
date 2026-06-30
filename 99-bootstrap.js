  // --- Layer 6 Module: 85-combat.js (Automation Loops, Potions & Buff Pipelines) ---
  // Rebuilt from scratch based on user approved specifications.
  // Manages our 3 customizable combat modes (Easy, Normal, Hard) and separate 15s cooldown potion pipelines.
  // Houses our OOC Long-Buff pipeline and our tactical, pre-move Short-Buff pipeline with 4-phase Cast Settle.
  // Implements the main Sense -> Decide -> Act -> Verify FSM and the custom Basement Targeting and Exiting flows.

  let botStatus = { stage: "idle", reason: "" };
  let gameInputBlockerEl = null;
  let gameInputKeyboardBlockerInstalled = false;

  function setBotStatus(stage, reason) {
    botStatus.stage = stage || "idle";
    botStatus.reason = reason || "";
    Logger.debug("STATUS", `Bot status changed to: [${botStatus.stage}] - ${botStatus.reason}`);
    try {
      recordDiagnosticEvent("stages", "stage", Object.assign({ stage: botStatus.stage, reason: botStatus.reason }, buildDiagnosticSnapshot()));
    } catch (err) {}
  }

  function getBotStatus() {
    return Object.assign({}, botStatus);
  }

  function diagNow() { return Date.now(); }

  function cloneDiagnosticValue(value, depth) {
    const d = Number.isFinite(depth) ? depth : 0;
    if (value === null || value === undefined) return value;
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
    if (d > 5) return "[max-depth]";
    if (Array.isArray(value)) return value.slice(0, 40).map((v) => cloneDiagnosticValue(v, d + 1));
    if (typeof value === "object") {
      if (value instanceof Element) return describeElementBrief(value);
      const out = {};
      Object.keys(value).slice(0, 80).forEach((k) => {
        if (k === "button" || k === "element" || k === "card") {
          out[k] = describeElementBrief(value[k]);
        } else {
          try { out[k] = cloneDiagnosticValue(value[k], d + 1); } catch (err) { out[k] = `[clone-error:${String(err)}]`; }
        }
      });
      return out;
    }
    return String(value);
  }

  function buildDiagnosticSnapshot() {
    return {
      at: diagNow(),
      botStatus: getBotStatus(),
      basicState: typeof readBasicState === "function" ? cloneDiagnosticValue(readBasicState()) : null,
      attackersCount: typeof readAttackersCount === "function" ? readAttackersCount() : null,
      attackersDetail: typeof readAttackersCounterDetail === "function" ? cloneDiagnosticValue(readAttackersCounterDetail()) : null,
      basementState: typeof getBasementState === "function" ? cloneDiagnosticValue(getBasementState()) : null,
      preferences: Runtime && Runtime.preferences ? cloneDiagnosticValue(Runtime.preferences) : null,
      lensState: typeof getLensState === "function" ? cloneDiagnosticValue(getLensState()) : null,
      combatSustain: Runtime && Runtime.autoFarm ? cloneDiagnosticValue(Runtime.autoFarm.combatSustain) : null,
      combatQueue: Runtime && Runtime.autoFarm ? cloneDiagnosticValue(Runtime.autoFarm.combatQueue) : null,
      plannerLast: Runtime && Runtime.planner ? cloneDiagnosticValue({
        lastOpeningPickReason: Runtime.planner.lastOpeningPickReason,
        lastOpeningPickDetail: Runtime.planner.lastOpeningPickDetail,
        lastOpeningPickAt: Runtime.planner.lastOpeningPickAt
      }) : null
    };
  }

  function getDiagnosticsRuntime() {
    if (!Runtime.diagnostics) {
      Runtime.diagnostics = { recentCycles: [], currentCycle: null, reports: [], lastReport: null, nextCycleId: 1 };
    }
    return Runtime.diagnostics;
  }

  function beginDiagnosticCycle(label) {
    const d = getDiagnosticsRuntime();
    if (d.currentCycle) {
      endDiagnosticCycle("implicit_new_cycle");
    }
    const id = d.nextCycleId || 1;
    d.nextCycleId = id + 1;
    d.currentCycle = {
      cycleId: id,
      label: label || "auto_cycle",
      startedAt: diagNow(),
      endedAt: null,
      durationMs: null,
      exitReason: null,
      stages: [],
      decisions: [],
      snapshots: [],
      errors: []
    };
    recordDiagnosticSnapshot("cycle_start");
    return d.currentCycle;
  }

  function endDiagnosticCycle(reason, extra) {
    const d = getDiagnosticsRuntime();
    const c = d.currentCycle;
    if (!c) return null;
    c.endedAt = diagNow();
    c.durationMs = c.endedAt - c.startedAt;
    c.exitReason = reason || "ended";
    if (extra !== undefined) c.extra = cloneDiagnosticValue(extra);
    recordDiagnosticSnapshot("cycle_end");
    d.recentCycles.push(c);
    if (d.recentCycles.length > 10) d.recentCycles.shift();
    d.currentCycle = null;
    return c;
  }

  function recordDiagnosticEvent(bucket, type, data) {
    const d = getDiagnosticsRuntime();
    const c = d.currentCycle;
    if (!c) return null;
    const ev = { at: diagNow(), type: type, data: cloneDiagnosticValue(data) };
    if (!Array.isArray(c[bucket])) c[bucket] = [];
    c[bucket].push(ev);
    if (c[bucket].length > 80) c[bucket].shift();
    return ev;
  }

  function recordDiagnosticDecision(type, data) { return recordDiagnosticEvent("decisions", type, data); }
  function recordDiagnosticError(type, data) { return recordDiagnosticEvent("errors", type, data); }

  function recordDiagnosticSnapshot(type) {
    const snap = buildDiagnosticSnapshot();
    return recordDiagnosticEvent("snapshots", type || "snapshot", snap);
  }

  function getRecentCycleDiagnostics() { return cloneDiagnosticValue(getDiagnosticsRuntime().recentCycles); }
  function getCurrentCycleDiagnostics() { return cloneDiagnosticValue(getDiagnosticsRuntime().currentCycle); }

  function createDiagnosticReport(reason, extra, options) {
    const opts = options || {};
    const d = getDiagnosticsRuntime();
    const report = {
      version: BotVersion ? cloneDiagnosticValue(BotVersion) : null,
      createdAt: new Date().toISOString(),
      reason: reason || "diagnostic_report",
      url: location && location.href ? location.href : "",
      userAgent: navigator && navigator.userAgent ? navigator.userAgent : "",
      currentState: buildDiagnosticSnapshot(),
      currentCycle: cloneDiagnosticValue(d.currentCycle),
      recentCycles: cloneDiagnosticValue(d.recentCycles),
      loggerLinesLast100: Logger && Logger.getRingBuffer ? Logger.getRingBuffer().slice(-100) : null,
      extra: cloneDiagnosticValue(extra)
    };
    d.lastReport = report;
    d.reports.push(report);
    if (d.reports.length > 5) d.reports.shift();
    const json = JSON.stringify(report, null, 2);
    Logger.warn("DIAG", `Diagnostic report created: ${report.reason}`, { reason: report.reason });
    const shouldAutoCopy = opts.autoCopy !== false && report.reason !== "unhandled_rejection";
    if (shouldAutoCopy) {
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          Promise.resolve(navigator.clipboard.writeText(json)).catch((err) => {
            Logger.debug("DIAG", "Diagnostic report clipboard auto-copy skipped/failed", { error: String(err) });
          });
        }
      } catch (err) {
        Logger.debug("DIAG", "Diagnostic report clipboard auto-copy threw", { error: String(err) });
      }
    }
    console.warn("---LIGMARBOT_REPORT_BEGIN---\n" + json + "\n---LIGMARBOT_REPORT_END---");
    return report;
  }

  function getLastCrashReport() { return cloneDiagnosticValue(getDiagnosticsRuntime().lastReport); }

  function copyLastCrashReport() {
    const report = getDiagnosticsRuntime().lastReport;
    if (!report) return { ok: false, reason: "no_report" };
    const json = JSON.stringify(report, null, 2);
    try {
      if (!navigator || !navigator.clipboard || !navigator.clipboard.writeText) {
        return { ok: false, reason: "clipboard_unavailable", json: json };
      }
      Promise.resolve(navigator.clipboard.writeText(json)).catch((err) => {
        Logger.warn("DIAG", "Manual crash report clipboard copy failed", { error: String(err) });
      });
      return { ok: true, copied: "requested", json: json };
    } catch (err) {
      return { ok: false, reason: "clipboard_failed", error: String(err), json: json };
    }
  }

  function gameInputKeyboardBlocker(ev) {
    const panel = document.querySelector("#rebuilt-ligmar-panel");
    if (panel && ev && ev.target && panel.contains(ev.target)) {
      return;
    }
    if (Runtime && Runtime.autoFarm && Runtime.autoFarm.running) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  function enableGameInputBlocker() {
    if (gameInputBlockerEl && gameInputBlockerEl.parentNode) {
      return { ok: true, alreadyEnabled: true };
    }
    const blocker = document.createElement("div");
    blocker.id = "ligmarbot-game-input-blocker";
    blocker.style.position = "fixed";
    blocker.style.left = "0";
    blocker.style.top = "0";
    blocker.style.width = "100vw";
    blocker.style.height = "100vh";
    blocker.style.zIndex = "999990";
    blocker.style.background = "transparent";
    blocker.style.pointerEvents = "auto";
    blocker.style.cursor = "not-allowed";
    ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel", "touchstart", "touchmove", "touchend"].forEach((type) => {
      blocker.addEventListener(type, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      }, { capture: true, passive: false });
    });
    document.body.appendChild(blocker);
    gameInputBlockerEl = blocker;
    if (!gameInputKeyboardBlockerInstalled) {
      ["keydown", "keyup", "keypress"].forEach((type) => document.addEventListener(type, gameInputKeyboardBlocker, true));
      gameInputKeyboardBlockerInstalled = true;
    }
    Logger.log("UI", "Game input blocker enabled while AUTO is running");
    return { ok: true, enabled: true };
  }

  function disableGameInputBlocker() {
    if (gameInputBlockerEl && gameInputBlockerEl.parentNode) {
      try { gameInputBlockerEl.remove(); } catch (err) {}
    }
    gameInputBlockerEl = null;
    Logger.log("UI", "Game input blocker disabled");
    return { ok: true, enabled: false };
  }

  function isGameInputBlocked() {
    return !!(gameInputBlockerEl && gameInputBlockerEl.parentNode);
  }

  function normalizeAutomationSkillName(name) {
    const base = typeof normalizeSkillName === "function" ? normalizeSkillName(name || "") : String(name || "");
    return base.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  }

  function isSkillForbiddenForAutomation(skill) {
    const key = normalizeAutomationSkillName(skill && (skill.name || skill.nameRaw));
    return key === "step into darkness";
  }

  function hasBasicAttackOnBar() {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) return false;
    const btn = bar.querySelector("app-action-button.type-default");
    if (!btn || !isElementVisible(btn)) return false;
    const visual = typeof getActionSlotVisualSource === "function" ? getActionSlotVisualSource(btn).toLowerCase() : "";
    return visual.indexOf("attack.webp") !== -1 || (btn.className || "").toString().indexOf("type-default") !== -1;
  }

  function isAutoFarmEasyMode() {
    return !!(Runtime && Runtime.preferences && Runtime.preferences.combatMode === "easy");
  }

  function isImmediateCombatBuff(skill) {
    if (!skill || skill.kind !== "skill" || isSkillForbiddenForAutomation(skill)) return false;
    const tags = Array.isArray(skill.tags) ? skill.tags.map((t) => String(t || "").toLowerCase()) : [];
    const isSupport = tags.indexOf("support") !== -1 || (skill.conception && skill.conception.isSupport);
    if (!isSupport) return false;
    return Number(skill.castTimeSec) === 0;
  }

  async function tryUseImmediateCombatBuffIfReady(context) {
    if (Runtime && Runtime.preferences && Runtime.preferences.useCombatBuffs === false) {
      return { ok: true, skipped: true, reason: "combat_buffs_disabled" };
    }
    const state = typeof readBasicState === "function" ? readBasicState() : null;
    const enemyCount = state && state.combat && Number.isFinite(state.combat.enemyCount) ? state.combat.enemyCount : 0;
    if (enemyCount <= 0 || (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested)) {
      return { ok: true, skipped: true, reason: "not_in_combat" };
    }
    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!isImmediateCombatBuff(s)) continue;
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(i)) continue;
      Logger.log("BUFF", `Casting immediate combat buff: ${s.name} (Slot ${i})`, { context: context || "combat" });
      if (clickActionBarSlot(i)) {
        const settle = await waitForSupportCastResolved(i, s);
        if (settle && settle.ok) {
          return { ok: true, used: true, slot: i, name: s.name, settle: settle };
        }
        return { ok: false, reason: "instant_buff_not_confirmed", slot: i, name: s.name, settle: settle };
      }
    }
    return { ok: true, skipped: true, reason: "no_ready_immediate_combat_buff" };
  }

  // Helper to determine if player is inside a basement.
  // Relies solely on the Runtime.basement.active flag, which is set to true
  // when a basement portal tile is entered and false after exiting.
  // NOTE: (0,0) is a valid coordinate on the normal map (map center),
  // so it cannot be used as a basement detection signal.
  function isInBasement() {
    return !!(Runtime && Runtime.basement && Runtime.basement.active);
  }

  function getBasementState() {
    const b = Runtime && Runtime.basement ? Runtime.basement : {};
    return {
      active: !!b.active,
      phase: b.phase || "idle",
      enteredAt: b.enteredAt || null,
      exitedAt: b.exitedAt || null,
      entranceCoords: b.entranceCoords || null,
      entranceTileKey: b.entranceTileKey || null,
      lastTileCoords: b.lastTileCoords || null,
      lastTileKey: b.lastTileKey || null,
      visitedTiles: Array.isArray(b.visitedTiles) ? b.visitedTiles.slice() : [],
      moveStack: Array.isArray(b.moveStack) ? b.moveStack.slice() : [],
      objectiveCompleteAt: b.objectiveCompleteAt || null,
      exitClickedAt: b.exitClickedAt || null,
      exitSettledAt: b.exitSettledAt || null,
      basementFarmingEnabled: !!(Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled)
    };
  }

  function basementSetPhase(phase, reason) {
    if (!Runtime || !Runtime.basement) {
      return null;
    }
    const prev = Runtime.basement.phase || "idle";
    Runtime.basement.phase = phase || "idle";
    Runtime.basement.active = Runtime.basement.phase !== "idle";
    Runtime.basement.lastTransitionReason = reason || "unspecified";
    const state = getBasementState();
    Logger.log("BASEMENT", `Basement phase ${prev} -> ${Runtime.basement.phase}`, { reason: Runtime.basement.lastTransitionReason });
    recordDiagnosticDecision("basement_phase", { previous: prev, next: Runtime.basement.phase, reason: Runtime.basement.lastTransitionReason, state: state });
    return state;
  }

  function markBasementEntered(meta) {
    if (!Runtime || !Runtime.basement) {
      return null;
    }
    const now = Date.now();
    Runtime.basement.enteredAt = now;
    Runtime.basement.exitedAt = null;
    Runtime.basement.objectiveCompleteAt = null;
    Runtime.basement.exitClickedAt = null;
    Runtime.basement.exitSettledAt = null;
    Runtime.basement.moveStack = [];
    Runtime.basement.visitedTiles = [];
    const coords = Runtime && Runtime.exploration ? Runtime.exploration.lastKnownCoords : null;
    if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
      Runtime.basement.entranceCoords = { x: coords.x, y: coords.y };
      Runtime.basement.entranceTileKey = `${coords.x},${coords.y}`;
      Runtime.basement.lastTileCoords = { x: coords.x, y: coords.y };
      Runtime.basement.lastTileKey = Runtime.basement.entranceTileKey;
      Runtime.basement.visitedTiles.push(Runtime.basement.entranceTileKey);
    }
    Runtime.basement.lastEntrySource = meta && meta.source ? meta.source : "unknown";
    if (Runtime.exploration) {
      Runtime.exploration.lastMoveDir = null;
    }
    return basementSetPhase("exploring", Runtime.basement.lastEntrySource);
  }

  function markBasementExited(reason) {
    if (!Runtime || !Runtime.basement) {
      return null;
    }
    Runtime.basement.exitedAt = Date.now();
    Runtime.basement.exitSettledAt = Runtime.basement.exitedAt;
    Runtime.basement.active = false;
    Runtime.basement.phase = "idle";
    Runtime.basement.lastTransitionReason = reason || "exited";
    Logger.log("BASEMENT", "Basement exited", getBasementState());
    return getBasementState();
  }

  function detectBasementExitButton() {
    const textSel = Config && Config.basement && Config.basement.exitButtonTextSelector
      ? Config.basement.exitButtonTextSelector
      : ".button-icon-text";
    const tags = Config && Config.basement && Array.isArray(Config.basement.exitButtonClickableTags)
      ? Config.basement.exitButtonClickableTags
      : ["app-button-icon", "button"];
    const candidates = Array.from(document.querySelectorAll(tags.join(",")));
    const substrings = Config && Config.basement && Array.isArray(Config.basement.exitDetectSubstrings)
      ? Config.basement.exitDetectSubstrings.map((x) => String(x || "").toLowerCase())
      : ["exiting", "exit", "выход"];

    for (let i = 0; i < candidates.length; i++) {
      const txtNode = candidates[i].querySelector(textSel);
      const txt = txtNode ? (txtNode.textContent || "").trim().toLowerCase() : "";
      if (!txt) {
        continue;
      }
      for (let j = 0; j < substrings.length; j++) {
        if (txt.indexOf(substrings[j]) !== -1) {
          return { ok: true, found: true, button: candidates[i], text: txt, index: i };
        }
      }
    }
    return { ok: true, found: false, button: null, text: "" };
  }

  function isBasementPortalActionButtonElement(btn) {
    if (!btn) {
      return false;
    }
    const raw = [
      btn.textContent || "",
      btn.getAttribute("aria-label") || "",
      btn.getAttribute("title") || "",
      btn.className || "",
      btn.innerHTML || "",
      btn.outerHTML || ""
    ].join(" ").toLowerCase();
    return raw.indexOf("m2.83594%2011.60154") !== -1 || raw.indexOf("m2.83594 11.60154") !== -1;
  }

  function detectBasementPortalActionButton() {
    const btn = document.querySelector(Config.selectors.lootButton);
    if (!btn || !isElementVisible(btn)) {
      return { ok: true, found: false, button: null, reason: "portal_action_button_not_visible" };
    }
    const matched = isBasementPortalActionButtonElement(btn);
    return {
      ok: true,
      found: matched,
      button: matched ? btn : null,
      reason: matched ? "icon_signature" : "signature_missing",
      htmlSample: (btn.outerHTML || "").slice(0, 240)
    };
  }

  function detectBasementEntryButton() {
    return detectBasementPortalActionButton();
  }

  async function openCurrentTilePopupForBasementAction() {
    if (typeof ensureMapOpen === "function") {
      const opened = await ensureMapOpen();
      if (!opened || !opened.ok) {
        return { ok: false, reason: "map_not_open", detail: opened };
      }
    }
    if (typeof clickMapCenterTile === "function") {
      clickMapCenterTile();
    }
    const found = await waitForCondition(
      "basement portal action button visible",
      () => detectBasementPortalActionButton().found,
      { timeoutMs: 1200, pollMs: 60 }
    );
    const det = detectBasementPortalActionButton();
    return Object.assign({ ok: !!found }, det);
  }

  async function maybeEnterBasementAfterMove(target) {
    if (isInBasement()) {
      return { ok: true, skipped: true, reason: "already_in_basement" };
    }
    if (!target || typeof isBasementPortalTile !== "function" || !isBasementPortalTile(target)) {
      return { ok: true, skipped: true, reason: "not_basement_portal" };
    }
    if (!(Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled)) {
      return { ok: true, skipped: true, reason: "basement_farming_disabled" };
    }

    const det = await openCurrentTilePopupForBasementAction();
    if (!det || !det.found || !det.button) {
      Logger.warn("BASEMENT", "Basement portal reached but entry icon button is missing; stopping safely", det);
      return { ok: false, reason: "basement_entry_button_missing", holdPosition: true, detail: det };
    }

    Logger.log("BASEMENT", "Clicking basement entry icon button", { targetKey: target.key, targetName: target.tileName, detail: det });
    const clickInfo = clickLootButtonWithDiagnostics(det.button, "basement entry button");
    if (!clickInfo || !clickInfo.clickDispatched) {
      return { ok: false, reason: "basement_entry_click_failed", holdPosition: true, clickInfo: clickInfo };
    }

    const settle = await waitForLootSettled("basement_entry");
    if (!settle || !settle.ok) {
      return { ok: false, reason: "basement_entry_settle_timeout", holdPosition: true, settle: settle };
    }

    markBasementEntered({ source: "portal_entry_icon" });
    return { ok: true, entered: true, settle: settle, state: getBasementState() };
  }

  // 1. getActiveModeSettings
  // Dynamically resolves the active threshold settings based on selected preferences mode
  function getActiveModeSettings() {
    const mode = Runtime && Runtime.preferences && Runtime.preferences.combatMode 
                 ? String(Runtime.preferences.combatMode).toLowerCase() 
                 : "normal";
    
    if (Config && Config.combatModes && Config.combatModes[mode]) {
      return Config.combatModes[mode];
    }
    return Config && Config.combatModes ? Config.combatModes.normal : { hpPotionBelowPct: 0.80, mpPotionBelowPct: 0.35 };
  }

  function getCurrentModeResourceThresholds() {
    const settings = getActiveModeSettings();
    return {
      mode: Runtime && Runtime.preferences ? Runtime.preferences.combatMode || "normal" : "normal",
      hp: Number.isFinite(settings.hpPotionBelowPct) ? settings.hpPotionBelowPct : 0.8,
      mp: Number.isFinite(settings.mpPotionBelowPct) ? settings.mpPotionBelowPct : 0.8
    };
  }

  function getPlayerHpMpPct() {
    const liveState = typeof readBasicState === "function" ? readBasicState() : null;
    const hp = liveState && liveState.player && liveState.player.hp && liveState.player.hp.valid ? liveState.player.hp.pct : 1;
    const mp = liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid ? liveState.player.mp.pct : 1;
    return { hpPct: hp, mpPct: mp, state: liveState };
  }

  function isHealthAmuletInCooldown() {
    const el = document.querySelector(".amulet.amulet-health");
    if (!el || !isElementVisible(el)) {
      return false;
    }
    const cls = (el.className || "").toString().toLowerCase();
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return cls.indexOf("cooldown") !== -1 || /\d+\s*s/.test(txt) || /^\d+\s*s$/.test(txt);
  }

  function detectRunButton() {
    const candidates = Array.from(document.querySelectorAll("app-button-icon, button"));
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const textNode = el.querySelector ? el.querySelector(".button-icon-text") : null;
      const text = textNode ? (textNode.textContent || "").trim().toLowerCase() : (el.textContent || "").trim().toLowerCase();
      const icon = el.querySelector ? el.querySelector(".icon-src-move, [class*='icon-src-move'], tui-icon[style*='move.svg']") : null;
      if (text !== "run" && !icon) {
        continue;
      }
      if (!isElementVisible(el)) {
        continue;
      }
      const cls = (el.className || "").toString().toLowerCase();
      const state = (el.getAttribute("data-state") || "").toLowerCase();
      const cdNode = el.querySelector ? el.querySelector(".button-icon-cooldown") : null;
      const cdText = cdNode ? (cdNode.textContent || "").trim() : "";
      const cooldown = cls.indexOf("has-cooldown") !== -1 || !!(cdNode && isElementVisible(cdNode));
      const disabled = state === "disabled" || el.hasAttribute("disabled") || (el.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      return { ok: true, found: true, button: el, disabled: disabled, cooldown: cooldown, cooldownText: cdText, state: state, className: cls };
    }
    return { ok: true, found: false, button: null, disabled: false, cooldown: false, reason: "run_button_missing" };
  }

  function isRunningStateActive() {
    const det = detectRunButton();
    return !!(det && det.found && det.disabled && !det.cooldown);
  }

  function isRunButtonInCooldown() {
    const det = detectRunButton();
    return !!(det && det.found && det.cooldown);
  }

  function clickRunButton() {
    const det = detectRunButton();
    if (!det.found || !det.button) {
      return { ok: false, reason: "run_button_missing", detail: det };
    }
    if (det.cooldown || det.disabled) {
      return { ok: false, reason: "run_button_not_ready", detail: det };
    }
    const clicked = clickElementSafe(det.button, "run button");
    if (clicked && Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain) {
      Runtime.autoFarm.combatSustain.lastRunAt = Date.now();
      Runtime.autoFarm.combatSustain.runCooldownUntil = Date.now() + 4000;
    }
    Logger.log("RUN", "Run button click dispatched", { clicked: clicked, detail: det });
    return { ok: !!clicked, clicked: !!clicked, detail: det };
  }

  async function tryUseRecoverySkill(resource) {
    const wanted = resource === "mp" ? "mp" : "hp";
    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.kind !== "skill" || isSkillForbiddenForAutomation(s) || !Array.isArray(s.effects)) continue;
      const heal = s.effects.find((e) => e && e.type === "heal" && e.resource === wanted);
      if (!heal) continue;
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(i)) continue;
      const st = getPlayerHpMpPct().state;
      const mpCur = st && st.player && st.player.mp && st.player.mp.valid ? st.player.mp.cur : null;
      if (wanted === "hp" && Number.isFinite(s.manaCost) && Number.isFinite(mpCur) && mpCur < s.manaCost) continue;
      Logger.log("SUSTAIN", `Using ${wanted.toUpperCase()} recovery skill ${s.name} (Slot ${i})`);
      if (clickActionBarSlot(i)) {
        await sleep(250);
        return { ok: true, resource: wanted, slot: i, name: s.name };
      }
    }
    return { ok: false, reason: "no_recovery_skill", resource: wanted };
  }

  async function waitForRunningRecovery() {
    const started = Date.now();
    const recoverPct = 0.80;
    if (Runtime && Runtime.autoFarm && Runtime.autoFarm.combatSustain) {
      Runtime.autoFarm.combatSustain.runningSince = started;
    }
    Logger.log("RUN", "Waiting while running until HP recovers or run is interrupted", { recoverPct: recoverPct });
    while (Runtime && Runtime.autoFarm && !Runtime.autoFarm.stopRequested) {
      const p = getPlayerHpMpPct();
      // During running, use potions only. Skill usage resumes after running ends/recovery completes.
      await evaluateAndUsePotions();
      if (p.hpPct >= recoverPct) {
        Logger.log("RUN", "Running recovery target reached", { hpPct: p.hpPct, elapsedMs: Date.now() - started });
        return { ok: true, reason: "hp_recovered", hpPct: p.hpPct };
      }
      const det = detectRunButton();
      if (det && det.cooldown) {
        Logger.log("RUN", "Run state ended/interrupted; button is in cooldown", det);
        return { ok: true, reason: "run_interrupted_or_finished", detail: det };
      }
      if (det && det.found && !det.disabled && Date.now() - started > 700) {
        Logger.log("RUN", "Run state no longer active; resuming normal actions", det);
        return { ok: true, reason: "run_not_active", detail: det };
      }
      if (Date.now() - started > 20000) {
        Logger.warn("RUN", "Run recovery wait timed out; resuming normal actions", { hpPct: p.hpPct });
        return { ok: false, reason: "timeout", hpPct: p.hpPct };
      }
      await sleep(300);
    }
    return { ok: false, reason: "stop_requested" };
  }

  async function maybeTriggerEmergencyRun(context) {
    const p = getPlayerHpMpPct();
    const hpPct = p.hpPct;
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    const now = Date.now();
    if (hpPct > 0.33) return { ok: true, skipped: true, reason: "hp_above_run_threshold", hpPct: hpPct };
    if (!isHealthAmuletInCooldown()) return { ok: true, skipped: true, reason: "health_amulet_not_in_cooldown", hpPct: hpPct };
    if (sustain && now < (sustain.runCooldownUntil || 0)) return { ok: true, skipped: true, reason: "run_recently_used", hpPct: hpPct };
    const det = detectRunButton();
    if (!det.found || det.disabled || det.cooldown) {
      Logger.warn("RUN", "Emergency run needed but Run button is not ready", { hpPct: hpPct, detail: det, context: context });
      return { ok: false, reason: "run_not_ready", hpPct: hpPct, detail: det };
    }
    Logger.warn("RUN", "Emergency run triggered", { hpPct: hpPct, context: context });
    recordDiagnosticDecision("emergency_run", { hpPct: hpPct, context: context });
    const clicked = clickRunButton();
    if (!clicked.ok) return clicked;
    const active = await waitForCondition("run button disabled/running state", () => isRunningStateActive() || isRunButtonInCooldown(), { timeoutMs: 1200, pollMs: 50 });
    Logger.log("RUN", "Run state verification completed", { activeOrCooldown: active, detail: detectRunButton() });
    const recovery = await waitForRunningRecovery();
    return { ok: true, triggered: true, hpPct: hpPct, recovery: recovery };
  }

  function shouldCloseCoordPopupBeforeSustain(context) {
    const raw = String(context || "").toLowerCase();
    return raw.indexOf("combat") === -1;
  }

  async function closeCoordPopupBeforeSustainIfNeeded(context) {
    if (shouldCloseCoordPopupBeforeSustain(context) && typeof closeHexPopupIfVisible === "function") {
      if (closeHexPopupIfVisible(`global sustain: ${context || "unknown"}`)) {
        await sleep(80);
        return true;
      }
    }
    return false;
  }

  async function runGlobalSustainCheck(context) {
    await closeCoordPopupBeforeSustainIfNeeded(context);
    const thresholds = getCurrentModeResourceThresholds();
    const before = getPlayerHpMpPct();
    const run = await maybeTriggerEmergencyRun(context || "global");
    const pot1 = await evaluateAndUsePotions();
    const pot2 = await evaluateAndUsePotions();
    const afterPot = getPlayerHpMpPct();
    let skillHp = null;
    let skillMp = null;
    if (afterPot.hpPct < thresholds.hp) skillHp = await tryUseRecoverySkill("hp");
    if (afterPot.mpPct < thresholds.mp) skillMp = await tryUseRecoverySkill("mp");
    const after = getPlayerHpMpPct();
    return { ok: true, context: context || "global", mode: thresholds.mode, hpThreshold: thresholds.hp, mpThreshold: thresholds.mp, beforeHpPct: before.hpPct, beforeMpPct: before.mpPct, afterHpPct: after.hpPct, afterMpPct: after.mpPct, run: run, potions: [pot1, pot2], recoverySkills: { hp: skillHp, mp: skillMp } };
  }

  function getReadableHpSample() {
    const st = typeof readBasicState === "function" ? readBasicState() : null;
    const hp = st && st.player && st.player.hp && st.player.hp.valid ? st.player.hp : null;
    return {
      ok: !!hp,
      cur: hp && Number.isFinite(hp.cur) ? hp.cur : null,
      max: hp && Number.isFinite(hp.max) ? hp.max : null,
      pct: hp && Number.isFinite(hp.pct) ? hp.pct : null,
      state: st
    };
  }

  function detectSustainHpDrop(prev, current) {
    if (!prev || !current || !prev.ok || !current.ok) return null;
    const prevCur = Number.isFinite(prev.cur) ? prev.cur : null;
    const cur = Number.isFinite(current.cur) ? current.cur : null;
    const prevPct = Number.isFinite(prev.pct) ? prev.pct : null;
    const pct = Number.isFinite(current.pct) ? current.pct : null;
    const max = Number.isFinite(current.max) ? current.max : (Number.isFinite(prev.max) ? prev.max : null);
    const rawDrop = Number.isFinite(prevCur) && Number.isFinite(cur) ? prevCur - cur : 0;
    const pctDrop = Number.isFinite(prevPct) && Number.isFinite(pct) ? prevPct - pct : 0;
    const rawThreshold = Number.isFinite(max) ? Math.max(1, Math.ceil(max * 0.01)) : 1;
    if (rawDrop >= rawThreshold || pctDrop >= 0.01) {
      return {
        hpDropped: true,
        prevCur: prevCur,
        cur: cur,
        rawDrop: rawDrop,
        rawThreshold: rawThreshold,
        prevPct: prevPct,
        pct: pct,
        pctDrop: pctDrop
      };
    }
    return null;
  }

  function getSustainCombatEvidence() {
    const st = typeof readBasicState === "function" ? readBasicState() : null;
    const enemyCount = st && st.combat && Number.isFinite(st.combat.enemyCount) ? st.combat.enemyCount : 0;
    const targetHp = st && st.combat ? st.combat.targetHp : null;
    const attackers = typeof readAttackersCount === "function" ? readAttackersCount() : 0;
    return {
      hasEvidence: attackers > 0 || enemyCount > 0 || !!(targetHp && targetHp.valid && targetHp.cur > 0),
      enemyCount: enemyCount,
      attackers: attackers,
      targetHp: targetHp || null
    };
  }

  async function engageCurrentThreatsFromSustain(reason, dropInfo) {
    Logger.warn("SUSTAIN", "HP dropped during sustain; assuming under attack and switching to combat", { reason: reason || "travel_gate", drop: dropInfo });
    recordDiagnosticDecision("sustain_hp_drop_under_attack", { reason: reason || "travel_gate", drop: dropInfo });
    if (closeHexPopupIfVisible("sustain hp-drop combat interrupt")) {
      await sleep(80);
    }

    let current = typeof readBasicState === "function" ? readBasicState() : null;
    let enemyCount = current && current.combat && Number.isFinite(current.combat.enemyCount) ? current.combat.enemyCount : 0;
    let targetHp = current && current.combat ? current.combat.targetHp : null;
    const attackers = typeof readAttackersCount === "function" ? readAttackersCount() : 0;

    if (!(targetHp && targetHp.valid && targetHp.cur > 0)) {
      let lock = null;
      if (attackers > 0 && typeof selectTargetFromAttackersPopup === "function") {
        lock = await selectTargetFromAttackersPopup();
        if (lock && lock.ok && typeof armPostRetargetQueuePolicy === "function") {
          armPostRetargetQueuePolicy("sustain_hp_drop_attackers_popup");
        }
      }
      if ((!lock || !lock.ok) && enemyCount > 0 && typeof clickFindEnemyVerified === "function") {
        lock = await clickFindEnemyVerified();
      }
      current = typeof readBasicState === "function" ? readBasicState() : current;
      enemyCount = current && current.combat && Number.isFinite(current.combat.enemyCount) ? current.combat.enemyCount : enemyCount;
      targetHp = current && current.combat ? current.combat.targetHp : targetHp;
      if (!(targetHp && targetHp.valid && targetHp.cur > 0)) {
        Logger.warn("SUSTAIN", "HP-drop combat interrupt could not acquire a target", { lock: lock, enemyCount: enemyCount, attackers: attackers });
        return { ok: false, reason: "target_lock_failed", lock: lock, enemyCount: enemyCount, attackers: attackers };
      }
    }

    setBotStatus("combat", "sustain interrupted by attack");
    const started = Date.now();
    while (current && current.combat && current.combat.enemyCount > 0 && Date.now() - started < 120000) {
      if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) {
        return { ok: false, reason: "stop_requested" };
      }
      const thp = current.combat.targetHp;
      if (!(thp && thp.valid && thp.cur > 0)) {
        await cancelActiveAoeCastIfNeeded("sustain_interrupt_target_dead");
        const survivors = current.combat.enemyCount;
        if (survivors <= 0) break;
        let relock = null;
        const ac = typeof readAttackersCount === "function" ? readAttackersCount() : 0;
        if (ac > 0 && typeof selectTargetFromAttackersPopup === "function") {
          relock = await selectTargetFromAttackersPopup();
          if (relock && relock.ok && typeof armPostRetargetQueuePolicy === "function") {
            armPostRetargetQueuePolicy("sustain_hp_drop_survivor_popup");
          }
        }
        if ((!relock || !relock.ok) && typeof clickFindEnemyVerified === "function") {
          relock = await clickFindEnemyVerified();
        }
        if (!relock || !relock.ok) {
          Logger.warn("SUSTAIN", "HP-drop combat interrupt could not relock survivor", { relock: relock, survivors: survivors });
          break;
        }
      }
      await runGlobalSustainCheck("combat_sustain_interrupt_tick");
      if (typeof maybeUseArcherSniperShotFinisher === "function") {
        const sniperFinisher = await maybeUseArcherSniperShotFinisher("combat_sustain_interrupt_tick");
        if (sniperFinisher && sniperFinisher.used) {
          await sleep(100);
          current = typeof readBasicState === "function" ? readBasicState() : current;
          continue;
        }
      }
      if (typeof plannerManageQueueTick === "function") {
        await plannerManageQueueTick();
      }
      await sleep(100);
      current = typeof readBasicState === "function" ? readBasicState() : current;
    }
    await cancelActiveAoeCastIfNeeded("sustain_interrupt_complete");
    current = typeof readBasicState === "function" ? readBasicState() : current;
    const remaining = current && current.combat && Number.isFinite(current.combat.enemyCount) ? current.combat.enemyCount : 0;
    Logger.log("SUSTAIN", "HP-drop combat interrupt completed", { remainingEnemies: remaining });
    return { ok: remaining <= 0, reason: remaining <= 0 ? "threats_cleared" : "combat_incomplete", remainingEnemies: remaining };
  }

  async function waitForTravelResourcesForCurrentMode(reason) {
    await closeCoordPopupBeforeSustainIfNeeded(reason || "travel_gate");
    const thresholds = getCurrentModeResourceThresholds();
    Logger.log("SUSTAIN", "Travel resource gate check started", { reason: reason || "travel", thresholds: thresholds });
    let lastHpSample = getReadableHpSample();
    while (Runtime && Runtime.autoFarm && !Runtime.autoFarm.stopRequested) {
      const p = getPlayerHpMpPct();
      if (p.hpPct >= thresholds.hp && p.mpPct >= thresholds.mp) {
        Logger.log("SUSTAIN", "Travel resources ready", { hpPct: p.hpPct, mpPct: p.mpPct, thresholds: thresholds });
        return { ok: true, hpPct: p.hpPct, mpPct: p.mpPct };
      }
      Logger.log("SUSTAIN", "Travel gate waiting for HP/MP", { hpPct: p.hpPct, mpPct: p.mpPct, hpTarget: thresholds.hp, mpTarget: thresholds.mp, reason: reason || "travel" });
      recordDiagnosticDecision("travel_gate_wait", { hpPct: p.hpPct, mpPct: p.mpPct, hpTarget: thresholds.hp, mpTarget: thresholds.mp, reason: reason || "travel" });
      await runGlobalSustainCheck(reason || "travel_gate");
      await sleep(500);
      const afterHpSample = getReadableHpSample();
      const drop = detectSustainHpDrop(lastHpSample, afterHpSample);
      if (drop) {
        const evidence = getSustainCombatEvidence();
        if (!evidence.hasEvidence) {
          Logger.warn("SUSTAIN", "HP dropped during sustain but no combat indicators were visible; continuing sustain", { reason: reason || "travel_gate", drop: drop, evidence: evidence });
          recordDiagnosticDecision("sustain_hp_drop_no_combat_evidence", { reason: reason || "travel_gate", drop: drop, evidence: evidence });
          lastHpSample = afterHpSample;
          continue;
        }
        const combat = await engageCurrentThreatsFromSustain(reason || "travel_gate", drop);
        lastHpSample = getReadableHpSample();
        if (combat && combat.ok) {
          continue;
        }
        return { ok: false, reason: "hp_drop_under_attack", holdPosition: true, combat: combat, drop: drop, evidence: evidence };
      }
      lastHpSample = afterHpSample;
    }
    return { ok: false, reason: "stop_requested" };
  }

  function normalizeCombatModeName(mode) {
    const raw = String(mode || "").toLowerCase();
    if (raw === "easy") return "easy";
    if (raw === "hard" || raw === "safe") return "hard";
    if (raw === "normal" || raw === "fast") return "normal";
    return "normal";
  }

  function setCombatMode(mode) {
    const normalized = normalizeCombatModeName(mode);
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.combatMode = normalized;
    }
    Logger.log("PREF", `Combat mode set to ${normalized}`);
    return getBotPreferences();
  }

  function setAvoidChampions(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.avoidChampions = !!enabled;
    }
    Logger.log("PREF", `Avoid Champions set to ${!!enabled}`);
    return getBotPreferences();
  }

  function setAvoidBosses(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.avoidBosses = !!enabled;
    }
    Logger.log("PREF", `Avoid Bosses set to ${!!enabled}`);
    return getBotPreferences();
  }

  function setBasementFarmingEnabled(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.basementFarmingEnabled = !!enabled;
    }
    Logger.log("PREF", `Basement Farming set to ${!!enabled}`);
    return getBotPreferences();
  }

  function setUseShortBuffs(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.useShortBuffs = !!enabled;
    }
    Logger.log("PREF", `Use Shortbuffs set to ${!!enabled}`);
    return getBotPreferences();
  }

  function setUseLongBuffs(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.useLongBuffs = !!enabled;
    }
    Logger.log("PREF", `Use Longbuffs set to ${!!enabled}`);
    return getBotPreferences();
  }

  function setUseCombatBuffs(enabled) {
    if (Runtime && Runtime.preferences) {
      Runtime.preferences.useCombatBuffs = !!enabled;
    }
    Logger.log("PREF", `Use CombatBuffs set to ${!!enabled}`);
    return getBotPreferences();
  }

  function getBotPreferences() {
    return Object.assign({}, Runtime && Runtime.preferences ? Runtime.preferences : {});
  }

  function readAttackersCount() {
    const root = document.querySelector(Config.selectors.attackersButton);
    const node = root ? root.querySelector(".button-icon-counter") : document.querySelector(Config.selectors.attackersBadgeValue);
    if (!node || !isElementVisible(node)) {
      return 0;
    }
    const parsed = parseFirstInt(node.textContent || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readAttackersCounterDetail() {
    const root = document.querySelector(Config.selectors.attackersButton);
    const node = root ? root.querySelector(".button-icon-counter") : null;
    const className = node ? (node.className || "").toString() : "";
    return {
      found: !!node,
      visible: !!(node && isElementVisible(node)),
      count: readAttackersCount(),
      className: className,
      color: className.indexOf("red") !== -1 ? "red" : (className.indexOf("green") !== -1 ? "green" : "unknown")
    };
  }

  // 2. findBestPotionSlot
  // Automatically scans scanned slots to locate the strongest HP/MP potion slot on your active bar.
  // Falls back to live DOM icon detection so icon-only app-action-button item slots still work
  // when a tooltip scan did not map them.
  function findBestPotionSlot(resource) {
    const wanted = resource === "mp" ? "mp" : "hp";
    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let bestSlot = null;
    let highestValue = -1;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.kind !== "potion") {
        continue;
      }
      let value = -1;
      if (s.potionResource === wanted) {
        value = 1;
      }
      if (Array.isArray(s.effects)) {
        const healEffect = s.effects.find((e) => e && e.type === "heal" && e.resource === wanted);
        if (healEffect) {
          value = Number.isFinite(healEffect.value) ? healEffect.value : 1;
        }
      }
      if (value > highestValue) {
        highestValue = value;
        bestSlot = i;
      }
    }

    if (bestSlot !== null) {
      return bestSlot;
    }

    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      return null;
    }
    const buttons = Array.from(bar.querySelectorAll(Config.selectors.actionBarSlot || "app-action-button, app-skill-button"));
    for (let i = 0; i < buttons.length; i++) {
      const el = buttons[i];
      const visual = typeof getActionSlotVisualSource === "function" ? getActionSlotVisualSource(el) : "";
      const res = typeof inferPotionResourceFromSlotElement === "function" ? inferPotionResourceFromSlotElement(el, visual) : null;
      if (res === wanted) {
        Logger.log("SUSTAIN", `Detected ${wanted.toUpperCase()} potion directly from action-bar icon at slot ${i}`);
        return i;
      }
    }

    return null;
  }

  function getActionBarSlotElement(index) {
    const bar = document.querySelector(Config.selectors.actionBar);
    if (!bar) {
      return null;
    }
    const buttons = bar.querySelectorAll(Config.selectors.actionBarSlot || "app-action-button, app-skill-button");
    return buttons[index] || null;
  }

  function getPotionSlotState(slotIndex) {
    const el = getActionBarSlotElement(slotIndex);
    const out = {
      slot: slotIndex,
      found: !!el,
      visible: !!(el && isElementVisible(el)),
      unavailable: false,
      reason: "ready",
      className: el ? (el.className || "").toString() : "",
      dataState: el ? (el.getAttribute("data-state") || "") : "",
      ariaDisabled: el ? (el.getAttribute("aria-disabled") || "") : "",
      text: el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "",
      pointerEvents: "",
      opacity: null,
      cooldownText: ""
    };
    if (!el) {
      out.unavailable = true;
      out.reason = "slot_missing";
      return out;
    }
    const cls = out.className.toLowerCase();
    const state = out.dataState.toLowerCase();
    const aria = out.ariaDisabled.toLowerCase();
    const cooldownNode = el.querySelector(".button-icon-cooldown, .skill-cooldown, .cooldown-progress, [class*='cooldown']");
    if (cooldownNode && isElementVisible(cooldownNode)) {
      out.cooldownText = (cooldownNode.textContent || "").replace(/\s+/g, " ").trim();
      out.unavailable = true;
      out.reason = "cooldown_node_visible";
      return out;
    }
    if (el.hasAttribute("disabled") || state === "disabled" || aria === "true") {
      out.unavailable = true;
      out.reason = "disabled_state";
      return out;
    }
    if (cls.indexOf("has-cooldown") !== -1 || cls.indexOf("action-disabled") !== -1 || cls.indexOf("cooldown") !== -1 || cls.indexOf("disabled") !== -1 || cls.indexOf("inactive") !== -1 || cls.indexOf("not-ready") !== -1 || cls.indexOf("notready") !== -1) {
      out.unavailable = true;
      out.reason = "cooldown_or_disabled_class";
      return out;
    }
    if (!out.visible) {
      out.unavailable = true;
      out.reason = "slot_not_visible";
      return out;
    }
    try {
      const st = window.getComputedStyle(el);
      out.pointerEvents = st.pointerEvents;
      out.opacity = parseFloat(st.opacity);
      if (st.pointerEvents === "none") {
        out.unavailable = true;
        out.reason = "pointer_events_none";
        return out;
      }
      if (Number.isFinite(out.opacity) && out.opacity < 0.35) {
        out.unavailable = true;
        out.reason = "low_opacity";
        return out;
      }
    } catch (err) {}
    return out;
  }

  function isPotionSlotUnavailable(slotIndex) {
    return !!getPotionSlotState(slotIndex).unavailable;
  }

  function isPotionSlotReady(slotIndex) {
    const st = getPotionSlotState(slotIndex);
    return !!(st.found && st.visible && !st.unavailable);
  }

  async function waitForPotionSlotUnavailable(slotIndex, resource) {
    const started = Date.now();
    let lastState = getPotionSlotState(slotIndex);
    const ok = await waitForCondition(
      `${String(resource || "potion").toUpperCase()} potion slot unavailable`,
      () => {
        lastState = getPotionSlotState(slotIndex);
        return !!lastState.unavailable;
      },
      { timeoutMs: 1000, pollMs: 50 }
    );
    const result = { ok: !!ok, slot: slotIndex, resource: resource || "potion", elapsedMs: Date.now() - started, state: lastState };
    if (ok) {
      Logger.log("SUSTAIN", `${String(resource || "Potion").toUpperCase()} potion cooldown/disabled state confirmed`, result);
    } else {
      Logger.warn("SUSTAIN", `${String(resource || "Potion").toUpperCase()} potion click was not confirmed by button disabled/cooldown state`, result);
    }
    return result;
  }

  async function tryUsePotionResource(resource, pct, threshold) {
    const wanted = resource === "mp" ? "mp" : "hp";
    const slot = findBestPotionSlot(wanted);
    if (slot === null) {
      Logger.warn("SUSTAIN", `${wanted.toUpperCase()} is low (${Math.round(pct * 100)}%), but no ${wanted.toUpperCase()} potion is currently mapped on your bar!`);
      return { ok: false, reason: "potion_slot_missing", resource: wanted };
    }
    const beforeState = getPotionSlotState(slot);
    if (!isPotionSlotReady(slot)) {
      Logger.log("SUSTAIN", `${wanted.toUpperCase()} potion skipped: slot is not ready`, beforeState);
      return { ok: false, skipped: true, reason: "potion_slot_not_ready", resource: wanted, slot: slot, state: beforeState };
    }
    Logger.log("SUSTAIN", `${wanted.toUpperCase()} below threshold (${Math.round(pct * 100)}% < ${Math.round(threshold * 100)}%). Dispatching potion click on Slot ${slot}.`, beforeState);
    const clicked = typeof clickActionBarSlot === "function" && clickActionBarSlot(slot);
    if (!clicked) {
      return { ok: false, reason: "potion_click_failed", resource: wanted, slot: slot, state: beforeState };
    }
    const confirmed = await waitForPotionSlotUnavailable(slot, wanted);
    if (confirmed && confirmed.ok) {
      Logger.log("SUSTAIN", `${wanted.toUpperCase()} potion use confirmed by action-bar state`, { slot: slot, confirmed: confirmed });
      recordDiagnosticDecision("potion_used", { resource: wanted, slot: slot, confirmed: confirmed });
      return { ok: true, resource: wanted, slot: slot, confirmed: confirmed };
    }
    return { ok: false, reason: "potion_click_not_confirmed", resource: wanted, slot: slot, confirmed: confirmed };
  }

  // 3. evaluateAndUsePotions (DOM-verified HP/MP potion pipeline)
  async function evaluateAndUsePotions() {
    if (!Runtime || !Runtime.autoFarm || !Runtime.autoFarm.combatSustain) {
      return { ok: false, reason: "sustain_runtime_missing" };
    }

    const liveState = typeof readBasicState === "function" ? readBasicState() : null;
    if (!liveState || !liveState.player) {
      return { ok: false, reason: "live_state_unread" };
    }

    const hpPct = liveState.player.hp && liveState.player.hp.valid ? liveState.player.hp.pct : 1.0;
    const mpPct = liveState.player.mp && liveState.player.mp.valid ? liveState.player.mp.pct : 1.0;
    const settings = getActiveModeSettings();

    if (hpPct < settings.hpPotionBelowPct) {
      const hp = await tryUsePotionResource("hp", hpPct, settings.hpPotionBelowPct);
      if (hp && hp.ok) {
        return hp;
      }
    }

    if (mpPct < settings.mpPotionBelowPct) {
      const mp = await tryUsePotionResource("mp", mpPct, settings.mpPotionBelowPct);
      if (mp && mp.ok) {
        return mp;
      }
    }

    return { ok: true, reason: "sustain_evaluated_no_potion_triggered", hpPct: hpPct, mpPct: mpPct };
  }

  function normalizeBuffTrackingKey(skill) {
    const raw = skill && skill.name ? skill.name : "";
    const base = typeof normalizeSkillName === "function" ? normalizeSkillName(raw) : String(raw || "");
    return base.trim().toLowerCase().replace(/[’']/g, "'");
  }

  function parseSupportBuffDurationFromText(text) {
    const raw = String(text || "").replace(/,/g, " ");
    if (!raw.trim()) {
      return null;
    }

    const patterns = [
      /\bfor\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/i,
      /\bfor\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/i,
      /\bduration\s*:?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/i,
      /\bduration\s*:?\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const m = raw.match(patterns[i]);
      if (m) {
        const value = parseFloat(m[1]);
        if (!Number.isFinite(value) || value <= 0) {
          continue;
        }
        const unit = String(m[2] || "s").toLowerCase();
        return unit.charAt(0) === "m" ? value * 60 : value;
      }
    }
    return null;
  }

  function resolveSupportBuffDurationSec(skill) {
    if (!skill || typeof skill !== "object") {
      return null;
    }

    const effects = Array.isArray(skill.effects) ? skill.effects : [];
    let best = null;
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (e && Number.isFinite(e.durationSec) && e.durationSec > 0) {
        best = best === null ? e.durationSec : Math.max(best, e.durationSec);
      }
    }
    if (Number.isFinite(best) && best > 0) {
      return best;
    }

    const parsed = parseSupportBuffDurationFromText(skill.description || skill.descriptionText || "");
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return null;
  }

  function getSupportBuffTrackingDurationSec(skill) {
    const resolved = resolveSupportBuffDurationSec(skill);
    if (Number.isFinite(resolved) && resolved > 0) {
      return resolved;
    }
    const fallback = Config && Config.supportBuffs && Number.isFinite(Config.supportBuffs.longDurationFallbackSec)
      ? Config.supportBuffs.longDurationFallbackSec
      : 900;
    return fallback;
  }

  // 4. classifySupportBuff
  // Classifies whether a skill slot is a long-duration buff or pre-move short buff.
  // Longbuff classification is based on real effect duration when available. Cooldown >= 60s
  // is only a fallback signal that the support skill is a long-maintenance buff; cooldown is
  // never used as the tracked buff duration.
  function classifySupportBuff(skill) {
    if (!skill || skill.kind !== "skill") {
      return "not_buff";
    }

    const tags = Array.isArray(skill.tags) ? skill.tags : [];
    const conception = skill.conception || {};
    const isSupport = tags.includes("support") || conception.isSupport;
    // Treat "self" and "party" as affecting the caster
    const affectsCaster = tags.includes("self") || tags.includes("party") || 
                          conception.targetsSelf || conception.affectsCaster;

    if (!isSupport || !affectsCaster) {
      return "not_buff";
    }

    // Exclude forbidden skills and safety barriers (such as Windy Dome) from automated pipelines
    if (isSkillForbiddenForAutomation(skill)) {
      return "excluded_forbidden";
    }
    if (isImmediateCombatBuff(skill)) {
      return "combat_instant_buff";
    }

    const threshold = Config.supportBuffs.longDurationMinSec || 60;
    const duration = resolveSupportBuffDurationSec(skill);
    if (Number.isFinite(duration) && duration > 0) {
      return duration >= threshold ? "longbuff" : "prebuff";
    }

    // Conservative fallback: a support skill with a long cooldown is likely a long-maintenance buff.
    // Track it with fallback duration to prevent recasting on every tile.
    if (Number.isFinite(skill.cooldownSec) && skill.cooldownSec >= threshold) {
      return "longbuff";
    }

    return "prebuff";
  }

  function computeSupportBuffCooldownWaitTimeoutMs(skillRecord) {
    const castMs = skillRecord && Number.isFinite(skillRecord.castTimeSec) && skillRecord.castTimeSec > 0
      ? skillRecord.castTimeSec * 1000
      : 0;
    // Wait for actual post-cast cooldown digits, not the temporary cast-time disabled state.
    return Math.max(5000, castMs + 3000);
  }

  function readSupportBuffCastDiagnosticSignals() {
    const wrapperSel = Config.selectors.statusBarWrapper;
    const wrap = document.querySelector(wrapperSel);
    const out = { castBarVisible: false, activeIconCount: 0, activeCastText: "" };
    if (!wrap || !isElementVisible(wrap)) {
      return out;
    }
    const activeIcons = wrap.querySelectorAll(Config.selectors.activeIcons || ".skill-icon.active");
    out.activeIconCount = activeIcons ? activeIcons.length : 0;
    const castTextNode = wrap.querySelector(Config.selectors.activeCastName);
    out.activeCastText = castTextNode ? (castTextNode.textContent || "").trim() : "";
    out.castBarVisible = !!out.activeCastText || out.activeIconCount > 0;
    return out;
  }

  async function waitForSupportBuffSlotCooldownStarted(slotIndex, skillRecord) {
    const skillName = skillRecord && skillRecord.name ? skillRecord.name : `slot ${slotIndex}`;
    const timeoutMs = computeSupportBuffCooldownWaitTimeoutMs(skillRecord);
    const startedAt = Date.now();
    Logger.log("BUFF", `Waiting for real buff cooldown span.skill-cooldown: ${skillName} (Slot ${slotIndex})`, { timeoutMs: timeoutMs });

    let cooldownSpanText = "";
    const confirmed = await waitForCondition(
      `support buff real cooldown span: ${skillName}`,
      () => {
        cooldownSpanText = typeof getActionBarSlotCooldownSpanText === "function"
          ? getActionBarSlotCooldownSpanText(slotIndex)
          : "";
        return !!cooldownSpanText;
      },
      { timeoutMs: timeoutMs, pollMs: 50 }
    );

    const diagnostics = readSupportBuffCastDiagnosticSignals();
    const result = {
      ok: !!confirmed,
      reason: confirmed ? "cooldown_digits_confirmed" : "cooldown_digits_timeout",
      slot: slotIndex,
      name: skillName,
      elapsedMs: Date.now() - startedAt,
      cooldownDigitsAppeared: !!confirmed,
      cooldownSpanText: cooldownSpanText || "",
      castBarVisible: diagnostics.castBarVisible,
      activeIconCount: diagnostics.activeIconCount,
      activeCastText: diagnostics.activeCastText
    };

    if (confirmed) {
      Logger.log("BUFF", `Buff cooldown span.skill-cooldown confirmed: ${skillName} (Slot ${slotIndex})`, result);
    } else {
      Logger.warn("BUFF", `Real span.skill-cooldown did not appear after buff click: ${skillName} (Slot ${slotIndex})`, result);
    }

    return result;
  }

  // 5. waitForSupportCastResolved
  // For support-buff sequencing, the authoritative acceptance signal is the clicked button entering cooldown.
  // Other cast-bar/icon signals are included only as diagnostics and do not allow the next buff to start early.
  async function waitForSupportCastResolved(slotIndex, skillRecord) {
    const cfg = Config.supportBuffs.postBuffCastCooldownWait;
    await sleep(cfg.minSettleMs || 100);
    const cooldownResult = await waitForSupportBuffSlotCooldownStarted(slotIndex, skillRecord);
    await sleep(cfg.postSettleMs || 140);
    return Object.assign({}, cooldownResult, {
      ok: cooldownResult.ok,
      reason: cooldownResult.ok ? "cast_confirmed_by_cooldown_digits" : cooldownResult.reason
    });
  }

  // 6. maintainLongbuffsOutOfCombat (OOC Long-Buff Pipeline)
  //   - Runs strictly out of combat (when enemyCount === 0).
  //   - Refreshes long buffs only when their remembered duration is near expiry.
  async function maintainLongbuffsOutOfCombat() {
    if (Runtime && Runtime.preferences && Runtime.preferences.useLongBuffs === false) {
      return { ok: true, skipped: true, reason: "longbuffs_disabled" };
    }
    const liveState = typeof readBasicState === "function" ? readBasicState() : null;
    const enemyCount = liveState && liveState.combat && Number.isFinite(liveState.combat.enemyCount) ? liveState.combat.enemyCount : 0;

    if (enemyCount > 0) {
      return { ok: false, reason: "in_combat" };
    }

    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    if (!sustain) return { ok: false, reason: "sustain_missing" };

    if (!sustain.longSelfTracked || typeof sustain.longSelfTracked !== "object") {
      sustain.longSelfTracked = {};
    }

    const now = Date.now();
    const renewThreshold = Config.supportBuffs.permanentSelf.renewWhenRemainingSec || 20;
    const results = [];

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.kind !== "skill") {
        continue;
      }

      const policy = classifySupportBuff(s);
      if (policy !== "longbuff") {
        continue;
      }

      const key = normalizeBuffTrackingKey(s);
      if (!key) {
        continue;
      }

      const expectedEnd = sustain.longSelfTracked[key] || 0;
      const remainingSec = (expectedEnd - now) / 1000;

      if (expectedEnd && remainingSec > renewThreshold) {
        Logger.debug("BUFF", `Longbuff active, skipping ${s.name}: remaining ${Math.round(remainingSec)}s`);
        results.push({ slot: i, name: s.name, skipped: true, reason: "still_active", remainingSec: Math.round(remainingSec) });
        continue;
      }

      // Check if slot is off cooldown / available before trying to refresh.
      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(i)) {
        Logger.debug("BUFF", `Longbuff refresh skipped: ${s.name} is not available yet`);
        results.push({ slot: i, name: s.name, skipped: true, reason: "slot_not_available" });
        continue;
      }

      const durationSec = getSupportBuffTrackingDurationSec(s);
      if (!Number.isFinite(resolveSupportBuffDurationSec(s))) {
        Logger.debug("BUFF", `Longbuff duration unknown for ${s.name}; using fallback ${durationSec}s`);
      }

      Logger.log("BUFF", `Refreshing OOC Long-Buff: ${s.name} (Slot ${i}) - Remaining: ${Math.round(remainingSec)}s`);
      if (typeof clickActionBarSlot === "function" && clickActionBarSlot(i)) {
        const settle = await waitForSupportCastResolved(i, s);
        if (settle && settle.ok) {
          const expectedEndAt = Date.now() + (durationSec * 1000);
          sustain.longSelfTracked[key] = expectedEndAt;
          Logger.log("BUFF", `Longbuff expiry tracked: ${s.name} for ${Math.round(durationSec)}s`, {
            key: key,
            expectedEndAt: expectedEndAt
          });
          results.push({ slot: i, name: s.name, ok: true, durationSec: durationSec, expectedEndAt: expectedEndAt });
        } else {
          Logger.warn("BUFF", `Longbuff refresh was not confirmed, not updating expiry: ${s.name}`, settle);
          results.push({ slot: i, name: s.name, ok: false, reason: "cast_not_confirmed", settle: settle });
        }
      } else {
        Logger.warn("BUFF", `Longbuff click failed: ${s.name} (Slot ${i})`);
        results.push({ slot: i, name: s.name, ok: false, reason: "click_failed" });
      }
    }

    return { ok: true, results: results };
  }

  function getSupportBuffAssumedDurationTrackingSnapshot() {
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    const tracked = sustain && sustain.longSelfTracked && typeof sustain.longSelfTracked === "object" ? sustain.longSelfTracked : {};
    const now = Date.now();
    const out = {};
    Object.keys(tracked).forEach((key) => {
      const expectedEndAt = tracked[key];
      out[key] = {
        expectedEndAt: expectedEndAt,
        remainingSec: Number.isFinite(expectedEndAt) ? Math.round((expectedEndAt - now) / 1000) : null
      };
    });
    return out;
  }

  function clearSupportBuffAssumedDurationTracking() {
    const sustain = Runtime && Runtime.autoFarm ? Runtime.autoFarm.combatSustain : null;
    if (sustain) {
      sustain.longSelfTracked = {};
    }
    return { ok: true };
  }

  function closeHexPopupIfVisible(reason) {
    const label = reason || "cleanup";
    const closeBtn = document.querySelector(Config.selectors.hexPopupCloseButton);
    if (closeBtn && isElementVisible(closeBtn)) {
      const closed = clickElementSafe(closeBtn, `hex popup close: ${label}`);
      Logger.debug("UI", `Closed hex popup for ${label}`, { closed: closed });
      return closed;
    }
    return false;
  }

  function closeHexPopupBeforePrebuffIfNeeded() {
    return closeHexPopupIfVisible("prebuff");
  }

  // 7. applyPreMoveSupportBuffsIfNeeded (The Approved Pre-Move Safe-Prep Rule)
  //   - Checks target tile BEFORE stepping onto it.
  //   - If target has enemies, stay on safe tile, cast ready short buffs, and settle.
  async function applyPreMoveSupportBuffsIfNeeded(target) {
    if (Runtime && Runtime.preferences && Runtime.preferences.useShortBuffs === false) {
      return { ok: true, skipped: true, reason: "shortbuffs_disabled" };
    }
    if (!target || !target.key || !(target.enemies > 0)) {
      return { ok: true, reason: "no_enemies_or_invalid_target" };
    }

    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    let castCount = 0;
    const attempts = [];

    Logger.log("BUFF", `Pre-Move Buffs triggered. Preparing safe casts for target tile ${target.key}...`);

    // Ring scan may leave a hex popup open. Close it before action-bar support clicks so the game accepts them.
    closeHexPopupBeforePrebuffIfNeeded();
    await sleep(120);

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && s.kind === "skill") {
        const policy = classifySupportBuff(s);
        if (policy === "prebuff") {
          if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(i)) {
            attempts.push({ slot: i, name: s.name, ok: false, skipped: true, reason: "cooldown" });
            continue;
          }

          const liveState = typeof readBasicState === "function" ? readBasicState() : null;
          const mpCur = liveState && liveState.player && liveState.player.mp && liveState.player.mp.valid ? liveState.player.mp.cur : null;
          const manaCost = Number.isFinite(s.manaCost) ? s.manaCost : 0;
          if (Number.isFinite(mpCur) && mpCur < manaCost) {
            Logger.log("BUFF", `Skipping prebuff ${s.name}: not enough MP (${mpCur} < ${manaCost})`);
            attempts.push({ slot: i, name: s.name, ok: false, skipped: true, reason: "not_enough_mp", mpCur: mpCur, manaCost: manaCost });
            continue;
          }

          Logger.log("BUFF", `Dispatching Short Combat Prebuff: ${s.name} (Slot ${i}) before stepping into combat`);
          if (typeof clickActionBarSlot === "function" && clickActionBarSlot(i)) {
            const settle = await waitForSupportCastResolved(i, s);
            attempts.push(Object.assign({ slot: i, name: s.name }, settle));
            if (settle && settle.ok) {
              castCount += 1;
            } else {
              Logger.warn("BUFF", `Prebuff click dispatched but cast was not confirmed: ${s.name}`, settle);
            }
          } else {
            attempts.push({ slot: i, name: s.name, ok: false, reason: "click_failed" });
            Logger.warn("BUFF", `Prebuff click failed before dispatch: ${s.name} (Slot ${i})`);
          }
        }
      }
    }

    if (castCount > 0) {
      Logger.log("BUFF", `Pre-Move Buff pipeline complete. Confirmed ${castCount} short buff cast(s).`, { attempts: attempts });
    } else {
      Logger.debug("BUFF", "Pre-Move Buff pipeline complete. No short buffs were confirmed.", { attempts: attempts });
    }

    return { ok: true, count: castCount, attempts: attempts };
  }

  function isLootBusyStatusText(text) {
    const raw = String(text || "").trim().toLowerCase();
    if (!raw) {
      return false;
    }
    return (
      raw.indexOf("opening") !== -1 ||
      raw.indexOf("activating") !== -1 ||
      raw.indexOf("collecting") !== -1 ||
      raw.indexOf("looting") !== -1 ||
      raw.indexOf("harvesting") !== -1 ||
      raw.indexOf("откры") !== -1 ||
      raw.indexOf("актив") !== -1 ||
      raw.indexOf("сбор") !== -1
    );
  }

  function readBattleProgressState() {
    const statusBar = document.querySelector(Config.selectors.enemyBattleStatusBar || "app-battle-status-bar");
    const conditionBar = document.querySelector("app-battle-status-bar app-canvas-condition-bar");
    const value = document.querySelector(Config.selectors.battleStatusBarValue || "app-battle-status-bar span.value");
    const canvas = document.querySelector("app-battle-status-bar canvas.canvas-bar");

    const statusBarVisible = !!(statusBar && isElementVisible(statusBar));
    const conditionBarVisible = !!(conditionBar && isElementVisible(conditionBar));
    const valueVisible = !!(value && isElementVisible(value));
    const canvasVisible = !!(canvas && isElementVisible(canvas));
    const valueText = value ? (value.textContent || "").replace(/\s+/g, " ").trim() : "";
    const statusText = statusBar ? (statusBar.textContent || "").replace(/\s+/g, " ").trim() : "";

    return {
      statusBarExists: !!statusBar,
      statusBarVisible: statusBarVisible,
      conditionBarExists: !!conditionBar,
      conditionBarVisible: conditionBarVisible,
      valueExists: !!value,
      valueVisible: valueVisible,
      valueText: valueText,
      statusText: statusText,
      canvasExists: !!canvas,
      canvasVisible: canvasVisible,
      active: statusBarVisible || conditionBarVisible || valueVisible || canvasVisible,
      dataColor: conditionBar ? conditionBar.getAttribute("data-color") : null,
      dataSize: conditionBar ? conditionBar.getAttribute("data-size") : null
    };
  }

  function buildLootDiagnostic(label) {
    const lootBtn = document.querySelector(Config.selectors.lootButton);
    const lootVisible = !!(lootBtn && isElementVisible(lootBtn));
    const progress = readBattleProgressState();
    // Busy text is diagnostic only unless the progress bar is actually visible.
    const busy = !!(progress.active && isLootBusyStatusText(progress.valueText || progress.statusText));
    const out = {
      label: label || "loot",
      lootVisible: lootVisible,
      lootText: lootBtn ? (lootBtn.textContent || "").replace(/\s+/g, " ").trim() : "",
      statusText: progress.valueText || progress.statusText || "",
      busy: busy,
      progress: progress,
      portalActionVisible: !!(lootBtn && isBasementPortalActionButtonElement(lootBtn)),
      rect: null,
      elementFromPoint: null
    };
    if (lootBtn) {
      try {
        const rect = lootBtn.getBoundingClientRect();
        out.rect = {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        out.elementFromPoint = typeof describeElementBrief === "function" && document.elementFromPoint
          ? describeElementBrief(document.elementFromPoint(cx, cy))
          : null;
      } catch (err) {
        out.rectError = String(err);
      }
    }
    return out;
  }

  function clickLootButtonWithDiagnostics(lootBtn, label) {
    const before = buildLootDiagnostic(label);
    const clickDispatched = clickElementSafe(lootBtn, label || "loot button");
    const result = Object.assign({}, before, { clickDispatched: !!clickDispatched });
    Logger.log("LOOT", "Loot click dispatched", result);
    return result;
  }

  async function retryLootClickOnceIfStillIdle(label) {
    await sleep(500);
    const diag = buildLootDiagnostic(label);
    if (diag.lootVisible && !(diag.progress && diag.progress.active)) {
      const btn = document.querySelector(Config.selectors.lootButton);
      if (btn && isElementVisible(btn)) {
        Logger.warn("LOOT", "Loot button still visible and not busy after first click; retrying once", diag);
        return clickLootButtonWithDiagnostics(btn, `${label || "loot"}_retry`);
      }
    }
    return null;
  }

  async function waitForLootSettled(label, options) {
    const opts = options || {};
    const l = label || "loot";
    const timeoutMs = 18000;
    const stableMs = 1800;
    const pollMs = 50;
    const startedAt = Date.now();
    let stableSince = null;
    let lastDiagnostic = null;

    Logger.log("LOOT", `Loot interaction wait started: ${l}`, { timeoutMs: timeoutMs, stableMs: stableMs });

    const ok = await waitForCondition(
      `loot interaction settled: ${l}`,
      () => {
        const diag = buildLootDiagnostic(l);
        lastDiagnostic = diag;
        const lootDone = !diag.lootVisible || (opts.allowPortalActionVisible === true && diag.portalActionVisible === true);
        const settledNow = lootDone && !(diag.progress && diag.progress.active);

        if (settledNow) {
          if (stableSince === null) {
            stableSince = Date.now();
          }
          return Date.now() - stableSince >= stableMs;
        }

        stableSince = null;
        return false;
      },
      { timeoutMs: timeoutMs, pollMs: pollMs }
    );

    const result = {
      ok: !!ok,
      reason: ok ? "settled" : "timeout",
      elapsedMs: Date.now() - startedAt,
      label: l,
      stableSinceAgeMs: stableSince ? Date.now() - stableSince : null,
      diagnostic: lastDiagnostic || buildLootDiagnostic(l)
    };
    if (ok) {
      Logger.log("LOOT", `Loot interaction settled: ${l}`, result);
    } else {
      Logger.warn("LOOT", `Loot settle timed out: ${l}`, result);
    }
    return result;
  }

  function normalizeCombatSkillNameForMatch(name) {
    const base = typeof normalizeSkillName === "function" ? normalizeSkillName(name || "") : String(name || "");
    return base.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  }

  function isSkillRecordAoe(row) {
    const tags = row && Array.isArray(row.tags) ? row.tags.map((t) => String(t || "").trim().toLowerCase()) : [];
    return tags.indexOf("close") !== -1;
  }

  function detectActiveAoeCast() {
    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    const wrapper = document.querySelector(Config.selectors.statusBarWrapper);
    const activeIcons = wrapper ? Array.from(wrapper.querySelectorAll(Config.selectors.activeIcons || ".skill-icon.active")) : [];
    const castTextNode = wrapper ? wrapper.querySelector(Config.selectors.activeCastName) : null;
    const activeCastText = castTextNode ? (castTextNode.textContent || "").trim() : "";
    const activeKey = normalizeCombatSkillNameForMatch(activeCastText);

    if (activeKey) {
      for (let i = 0; i < slots.length; i++) {
        const row = slots[i];
        if (!row || row.kind !== "skill" || !isSkillRecordAoe(row)) {
          continue;
        }
        const key = normalizeCombatSkillNameForMatch(row.name || row.nameRaw || "");
        if (key && (activeKey === key || activeKey.indexOf(key) !== -1 || key.indexOf(activeKey) !== -1)) {
          return { active: true, method: "cast_bar", slot: i, name: row.name || row.nameRaw || activeCastText, activeCastText: activeCastText, activeIconCount: activeIcons.length };
        }
      }
    }

    for (let i = 0; i < slots.length; i++) {
      const row = slots[i];
      if (!row || row.kind !== "skill" || !isSkillRecordAoe(row)) {
        continue;
      }
      const disabledOrUnavailable = typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(i);
      const realCooldownDigits = typeof isActionBarSlotShowingCooldownDigits === "function" && isActionBarSlotShowingCooldownDigits(i);
      if (disabledOrUnavailable && !realCooldownDigits) {
        return { active: true, method: "slot_disabled_no_cooldown", slot: i, name: row.name || row.nameRaw || `slot ${i}`, activeCastText: activeCastText, activeIconCount: activeIcons.length };
      }
    }

    return { active: false, method: "none", activeCastText: activeCastText, activeIconCount: activeIcons.length };
  }

  function detectPressToCancelElement() {
    const nodes = Array.from(document.querySelectorAll("app-status-bar .status-description, .status-description"));
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text.indexOf("press to cancel") !== -1 && isElementVisible(node)) {
        return { found: true, element: node, text: text };
      }
    }
    return { found: false, element: null, text: "" };
  }

  function clearCombatQueueAfterAoeCancel() {
    if (Runtime && Runtime.autoFarm) {
      Runtime.autoFarm.combatQueue = null;
      if (Runtime.autoFarm.combatSustain) {
        Runtime.autoFarm.combatSustain.queuedThisCycle = false;
        Runtime.autoFarm.combatSustain.lastActiveCastName = "";
        Runtime.autoFarm.combatSustain.freshTargetOpenerPending = false;
      }
    }
    Logger.log("COMBAT", "Cleared combat queue after AoE cancel");
    return { ok: true };
  }

  async function cancelActiveAoeCastIfNeeded(reason) {
    const cast = detectActiveAoeCast();
    if (!cast || !cast.active) {
      return { ok: true, skipped: true, reason: "no_active_aoe_cast", detail: cast };
    }

    const cancel = detectPressToCancelElement();
    if (!cancel.found || !cancel.element) {
      Logger.warn("COMBAT", "AoE cast active but Press to cancel element missing", { reason: reason || "unspecified", cast: cast, cancel: cancel });
      return { ok: false, reason: "cancel_element_missing", cast: cast, cancel: cancel };
    }

    Logger.warn("COMBAT", "Target died while AoE cast active; clicking Press to cancel", { reason: reason || "unspecified", cast: cast, cancelText: cancel.text });
    const clicked = clickElementSafe(cancel.element, "press to cancel active aoe cast");
    if (!clicked) {
      return { ok: false, reason: "cancel_click_failed", cast: cast };
    }

    const stopped = await waitForCondition(
      "active AoE cast canceled",
      () => {
        const next = detectActiveAoeCast();
        return !next || !next.active;
      },
      { timeoutMs: 1500, pollMs: 50 }
    );

    if (stopped) {
      clearCombatQueueAfterAoeCancel();
      Logger.log("COMBAT", "AoE cast cancel confirmed", { original: cast });
      return { ok: true, canceled: true, cast: cast };
    }

    Logger.warn("COMBAT", "AoE cast cancel click did not clear active cast before timeout", { original: cast, current: detectActiveAoeCast() });
    return { ok: false, reason: "cancel_verify_timeout", cast: cast, current: detectActiveAoeCast() };
  }

  function clearCombatQueueAfterManualCancel(reason) {
    if (Runtime && Runtime.autoFarm) {
      Runtime.autoFarm.combatQueue = null;
      if (Runtime.autoFarm.combatSustain) {
        Runtime.autoFarm.combatSustain.queuedThisCycle = false;
        Runtime.autoFarm.combatSustain.lastActiveCastName = "";
        Runtime.autoFarm.combatSustain.freshTargetOpenerPending = false;
      }
    }
    Logger.log("COMBAT", "Cleared combat queue after manual cancel", { reason: reason || "manual_cancel" });
    return { ok: true };
  }

  function findSniperShotSlot() {
    const slots = Runtime && Runtime.skills && Array.isArray(Runtime.skills.slots) ? Runtime.skills.slots : [];
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      if (!s || s.kind !== "skill") continue;
      const name = normalizeAutomationSkillName(s.name || s.nameRaw || "");
      if (name === "sniper shot") {
        return { slot: i, skill: s };
      }
    }
    return null;
  }

  function parseAverageStatNumberFromRaw(raw) {
    const text = String(raw || "").replace(/,/g, "");
    const range = text.match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (range) {
      const a = Number.parseFloat(range[1]);
      const b = Number.parseFloat(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return (a + b) / 2;
      }
    }
    const first = text.match(/([\d.]+)/);
    if (first) {
      const n = Number.parseFloat(first[1]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function getHeroAveragePhysicalDamageForSniper() {
    const stats = Runtime && Runtime.hero ? Runtime.hero.combatStats : null;
    if (!stats) return null;
    const raw = stats.rawSnippets && stats.rawSnippets.physicalAttack ? stats.rawSnippets.physicalAttack : "";
    const avg = parseAverageStatNumberFromRaw(raw);
    if (Number.isFinite(avg) && avg > 0) return avg;
    return Number.isFinite(stats.physicalAttack) && stats.physicalAttack > 0 ? stats.physicalAttack : null;
  }

  async function clickPressToCancelAndWaitHidden(reason, options) {
    const opts = options || {};
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 1500;
    const progressBefore = typeof readBattleProgressState === "function" ? readBattleProgressState() : null;
    const cancel = detectPressToCancelElement();

    if (cancel && cancel.found && cancel.element) {
      Logger.log("COMBAT", "Clicking Press to cancel", { reason: reason || "manual", progressBefore: progressBefore, cancelText: cancel.text });
      const clicked = clickElementSafe(cancel.element, `press to cancel: ${reason || "manual"}`);
      if (!clicked) {
        return { ok: false, reason: "cancel_click_failed", progressBefore: progressBefore, cancel: cancel };
      }
      const hidden = await waitForCondition(
        `progressbar hidden after cancel: ${reason || "manual"}`,
        () => {
          const p = typeof readBattleProgressState === "function" ? readBattleProgressState() : null;
          return !p || !p.active;
        },
        { timeoutMs: timeoutMs, pollMs: 50 }
      );
      if (hidden) {
        clearCombatQueueAfterManualCancel(reason || "manual_cancel");
        return { ok: true, canceled: true, progressBefore: progressBefore };
      }
      return { ok: false, reason: "progressbar_still_visible", progressBefore: progressBefore, progressAfter: readBattleProgressState() };
    }

    if (!progressBefore || !progressBefore.active) {
      return { ok: true, skipped: true, reason: "no_active_progressbar" };
    }

    const hidden = await waitForCondition(
      `progressbar naturally hidden: ${reason || "manual"}`,
      () => {
        const p = typeof readBattleProgressState === "function" ? readBattleProgressState() : null;
        return !p || !p.active;
      },
      { timeoutMs: Math.min(timeoutMs, 500), pollMs: 50 }
    );
    return hidden
      ? { ok: true, skipped: true, reason: "progressbar_hidden_without_cancel", progressBefore: progressBefore }
      : { ok: false, reason: "cancel_missing_progressbar_active", progressBefore: progressBefore, cancel: cancel };
  }

  async function maybeUseArcherSniperShotFinisher(context) {
    if (!Runtime || !Runtime.autoFarm || !Runtime.autoFarm.combatSustain) {
      return { ok: false, skipped: true, reason: "runtime_missing" };
    }
    const sustain = Runtime.autoFarm.combatSustain;
    if (sustain.sniperFinisherInProgress) {
      return { ok: true, skipped: true, reason: "finisher_in_progress" };
    }
    const now = Date.now();
    if (now - (sustain.lastSniperFinisherAt || 0) < 1500) {
      return { ok: true, skipped: true, reason: "finisher_recently_attempted" };
    }

    const sniper = findSniperShotSlot();
    if (!sniper) {
      return { ok: true, skipped: true, reason: "sniper_shot_not_on_bar" };
    }
    // Before canceling the current cast, only trust real cooldown digits.
    // Broad disabled-state checks can be caused by the active cast itself.
    if (typeof isActionBarSlotShowingCooldownDigits === "function" && isActionBarSlotShowingCooldownDigits(sniper.slot)) {
      return { ok: true, skipped: true, reason: "sniper_shot_cooldown_digits", slot: sniper.slot };
    }

    const state = typeof readBasicState === "function" ? readBasicState() : null;
    const targetHp = state && state.combat && state.combat.targetHp && state.combat.targetHp.valid ? state.combat.targetHp : null;
    const enemyCount = state && state.combat && Number.isFinite(state.combat.enemyCount) ? state.combat.enemyCount : 0;
    if (!targetHp || !(targetHp.cur > 0) || enemyCount <= 0) {
      return { ok: true, skipped: true, reason: "no_live_target" };
    }

    const sniperDamage = getHeroAveragePhysicalDamageForSniper();
    if (!Number.isFinite(sniperDamage) || sniperDamage <= 0) {
      return { ok: true, skipped: true, reason: "physical_damage_unavailable" };
    }
    const threshold = 0.8 * sniperDamage;
    if (!(targetHp.cur < threshold)) {
      return { ok: true, skipped: true, reason: "target_above_threshold", targetHp: targetHp.cur, threshold: threshold, sniperDamage: sniperDamage };
    }

    sustain.sniperFinisherInProgress = true;
    sustain.lastSniperFinisherAt = now;
    sustain.lastSniperFinisherTargetHp = targetHp.cur;
    try {
      Logger.warn("COMBAT", "Archer Sniper Shot finisher triggered", {
        context: context || "combat",
        targetHp: targetHp.cur,
        threshold: threshold,
        sniperDamage: sniperDamage,
        slot: sniper.slot
      });
      recordDiagnosticDecision("sniper_shot_finisher_triggered", {
        context: context || "combat",
        targetHp: targetHp.cur,
        threshold: threshold,
        sniperDamage: sniperDamage,
        slot: sniper.slot
      });

      const preCancel = await clickPressToCancelAndWaitHidden("sniper_finisher_pre_cancel", { timeoutMs: 1500 });
      if (!preCancel || !preCancel.ok) {
        Logger.warn("COMBAT", "Sniper finisher aborted: current cast/progressbar could not be canceled/hidden", preCancel);
        return { ok: false, reason: "pre_cancel_failed", detail: preCancel };
      }

      if (typeof isActionBarSlotShowingCooldown === "function" && isActionBarSlotShowingCooldown(sniper.slot)) {
        return { ok: true, skipped: true, reason: "sniper_became_unready", slot: sniper.slot };
      }

      const clicked = typeof clickActionBarSlot === "function" && clickActionBarSlot(sniper.slot);
      if (!clicked) {
        return { ok: false, reason: "sniper_click_failed", slot: sniper.slot };
      }
      Runtime.autoFarm.combatQueue = { slot: sniper.slot, name: sniper.skill.name || "Sniper Shot", kind: "sniper_finisher" };
      sustain.lastActiveCastName = sniper.skill.name || "Sniper Shot";
      sustain.queuedThisCycle = true;

      await sleep(150);
      const release = await clickPressToCancelAndWaitHidden("sniper_finisher_release", { timeoutMs: 1500 });
      if (!release || !release.ok) {
        Logger.warn("COMBAT", "Sniper finisher release/cancel was not confirmed", release);
      }

      await sleep(200);
      const after = typeof readBasicState === "function" ? readBasicState() : null;
      const afterTarget = after && after.combat && after.combat.targetHp && after.combat.targetHp.valid ? after.combat.targetHp : null;
      const stillAlive = !!(afterTarget && afterTarget.cur > 0 && after.combat && after.combat.enemyCount > 0);
      let basicClicked = false;
      if (stillAlive && typeof hasBasicAttackOnBar === "function" && hasBasicAttackOnBar() && typeof clickBasicAttack === "function") {
        basicClicked = clickBasicAttack();
        if (basicClicked) {
          sustain.lastActiveCastName = "Attack";
          sustain.queuedThisCycle = false;
        }
      }
      return { ok: true, used: true, slot: sniper.slot, targetHpBefore: targetHp.cur, targetHpAfter: afterTarget, sniperDamage: sniperDamage, threshold: threshold, release: release, basicClicked: basicClicked };
    } finally {
      sustain.sniperFinisherInProgress = false;
    }
  }

  // 8. secureTileAndLootOnce (The Core Rebuilt Combat Orchestrator)
  //   - Handles pre-move buffs.
  //   - Performs double-click walking.
  //   - Triggers signal-driven targeting (Attackers Popup for basement, Find-Enemy for normal).
  //   - Manages our active stateless planner and visual icon queue ticks.
  //   - Handles immediate end-tile exit for basements.
  async function secureTileAndLootOnce(target) {
    if (!target || !target.key) {
      return { ok: false, reason: "invalid_target" };
    }

    // A. Global sustain and travel gate before spending resources or moving.
    await runGlobalSustainCheck("before_tile_prebuff");
    const preTravelReady = await waitForTravelResourcesForCurrentMode("before_tile_prebuff");
    if (!preTravelReady || !preTravelReady.ok) {
      return { ok: false, reason: "travel_resource_gate_failed", holdPosition: true, detail: preTravelReady };
    }

    // B. Pre-Move Safe Prep: Cast short buffs BEFORE entering the next tile
    await applyPreMoveSupportBuffsIfNeeded(target);
    const postBuffTravelReady = await waitForTravelResourcesForCurrentMode("after_tile_prebuff");
    if (!postBuffTravelReady || !postBuffTravelReady.ok) {
      return { ok: false, reason: "travel_resource_gate_failed", holdPosition: true, detail: postBuffTravelReady };
    }

    // C. Double-click Walk onto target
    setBotStatus("moving", `walking to tile ${target.key}`);
    let moved = await moveToScannedNeighbor(target);
    if (moved && !moved.ok && moved.reason === "move_coord_mismatch") {
      Logger.warn("MOVE", "Movement coordinate mismatch; retrying same target once", moved);
      if (typeof ensureMapCentered === "function") {
        await ensureMapCentered();
        await sleep(300);
      }
      const retryMoved = await moveToScannedNeighbor(target);
      if (retryMoved && retryMoved.ok) {
        Logger.log("MOVE", "Movement retry succeeded", retryMoved);
        moved = retryMoved;
      } else {
        Logger.warn("MOVE", "Movement retry failed; stopping safely", retryMoved);
        moved = retryMoved || moved;
      }
    }
    if (!moved || !moved.ok) {
      return {
        ok: false,
        reason: "movement_failed",
        holdPosition: !!(moved && moved.holdPosition),
        moved: moved || null
      };
    }

    // Ensure any tile-info popup left by scan/movement is gone before Find Enemy / combat clicks.
    if (closeHexPopupIfVisible("combat target acquisition")) {
      await sleep(80);
    }

    const targetHasBasementEntry = !!(target && target.basementEntry === true);

    // C. Target Engagement: on tile enter, use Find Enemy when either scan or live UI says enemies exist.
    setBotStatus("targeting", "acquiring target lock-on");
    const activeInBasement = isInBasement();
    const targetIsBasementEndCandidate = !!(activeInBasement && typeof isBasementEndCandidateTile === "function" && isBasementEndCandidateTile(target));
    let current = readBasicState();
    const scannedEnemies = Number.isFinite(target.enemies) ? target.enemies : 0;
    let liveEnemies = current && current.combat && Number.isFinite(current.combat.enemyCount) ? current.combat.enemyCount : 0;

    if (scannedEnemies > 0 && liveEnemies <= 0) {
      await waitForCondition(
        "post-move occupied tile UI settle",
        () => {
          const st = typeof readBasicState === "function" ? readBasicState() : null;
          liveEnemies = st && st.combat && Number.isFinite(st.combat.enemyCount) ? st.combat.enemyCount : liveEnemies;
          return liveEnemies > 0 || (typeof isFindEnemyButtonReady === "function" && isFindEnemyButtonReady());
        },
        { timeoutMs: 1000, pollMs: 50 }
      );
      current = readBasicState();
      liveEnemies = current && current.combat && Number.isFinite(current.combat.enemyCount) ? current.combat.enemyCount : liveEnemies;
    }

    const entryEnemyCount = Math.max(scannedEnemies, liveEnemies);
    Logger.log("COMBAT", "Post-move occupied tile check", {
      scannedEnemies: scannedEnemies,
      liveEnemies: liveEnemies,
      willFindEnemy: entryEnemyCount > 0
    });

    if (entryEnemyCount > 0) {
      const lock = await clickFindEnemyVerified();
      if (!lock || !lock.ok) {
        Logger.warn("COMBAT", "Occupied tile target lock failed; holding position instead of exploring away", lock);
        return { ok: false, reason: "occupied_tile_target_lock_failed", holdPosition: true, lock: lock };
      }
      current = readBasicState();
    } else {
      Logger.debug("COMBAT", "No enemies reported after tile entry; skipping target acquisition.");
    }

    // D. The Core Combat Burst Loop
    setBotStatus("combat", "engaging target");

    while (current && current.combat && current.combat.targetHp && current.combat.targetHp.valid && current.combat.targetHp.cur > 0 && current.combat.enemyCount > 0) {
      if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) {
        Logger.log("COMBAT", "Combat loop aborted: Stop requested");
        break;
      }

      // 1. Global resource sustain and emergency run check
      await runGlobalSustainCheck("combat_tick");

      // 2. Archer Sniper Shot finisher has priority when target is already in release-kill range.
      if (typeof maybeUseArcherSniperShotFinisher === "function") {
        const sniperFinisher = await maybeUseArcherSniperShotFinisher("combat_tick");
        if (sniperFinisher && sniperFinisher.used) {
          await sleep(100);
          current = readBasicState();
          continue;
        }
      }

      // 3. Queue Builder tick (evaluates cast bar icons and dispatches next cast)
      if (typeof plannerManageQueueTick === "function") {
        await plannerManageQueueTick();
      }

      // Yield 100ms between ticks to prevent browser freezing
      await sleep(100);
      current = readBasicState();
    }

    Logger.log("COMBAT", "Primary target cleared. Evaluating remaining threats.");
    await cancelActiveAoeCastIfNeeded("primary_target_dead");

    // E. Survivors Re-targeting (Clearing the pull)
    while (current && current.combat && current.combat.enemyCount > 0) {
      if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) {
        break;
      }

      setBotStatus("combat", "re-targeting survivor");
      let nextLock = false;

      // After a kill: give attackers badge a short moment to update, then decide retarget path.
      await sleep(50);
      const count = readAttackersCount();

      if (count > 0) {
        // If survivors are hitting us, switch through attackers popup
        const lock = await selectTargetFromAttackersPopup();
        if (lock && lock.ok) {
          nextLock = true;
          if (typeof armPostRetargetQueuePolicy === "function") {
            armPostRetargetQueuePolicy("attackers_popup_retarget");
          }
          current = readBasicState();
        }
      } else {
        // If survivors aren't hitting yet, click default Find Enemy
        const lock = await clickFindEnemyVerified();
        if (lock && lock.ok) {
          nextLock = true;
          current = readBasicState();
        }
      }

      if (!nextLock) {
        Logger.warn("COMBAT", "No survivor could be locked on. Breaking combat.");
        break;
      }

      // Clear survivors loop
      while (current && current.combat && current.combat.targetHp && current.combat.targetHp.valid && current.combat.targetHp.cur > 0 && current.combat.enemyCount > 0) {
        if (Runtime && Runtime.autoFarm && Runtime.autoFarm.stopRequested) break;
        await runGlobalSustainCheck("combat_survivor_tick");
        if (typeof maybeUseArcherSniperShotFinisher === "function") {
          const sniperFinisher = await maybeUseArcherSniperShotFinisher("combat_survivor_tick");
          if (sniperFinisher && sniperFinisher.used) {
            await sleep(100);
            current = readBasicState();
            continue;
          }
        }
        if (typeof plannerManageQueueTick === "function") {
          await plannerManageQueueTick();
        }
        await sleep(100);
        current = readBasicState();
      }

      await cancelActiveAoeCastIfNeeded("survivor_target_dead");

      // Update basic state at the end of the outer survivors loop to check if threats still remain
      current = readBasicState();
    }

    setBotStatus("looting", "clearing loot event");
    Logger.log("COMBAT", "Tile cleared completely. Harvesting loot event.");

    // F. Settle & Loot (Normal Loot vs Basement End-Tile Exit)
    if (Runtime && Runtime.autoFarm) {
      Runtime.autoFarm.combatQueue = null; // Cleanse queue state on target death.
    }

    if (!activeInBasement && targetHasBasementEntry && Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled) {
      const entryDet = await openCurrentTilePopupForBasementAction();
      if (!entryDet || !entryDet.found || !entryDet.button) {
        Logger.warn("BASEMENT", "Basement entry icon missing after entrance tile was cleared; stopping safely", entryDet);
        return { ok: false, reason: "basement_entry_missing_after_clear", holdPosition: true, detail: entryDet };
      }
      Logger.log("BASEMENT", "Entrance tile cleared. Entering basement via portal icon", entryDet);
      const clickInfo = clickLootButtonWithDiagnostics(entryDet.button, "basement entry button");
      if (!clickInfo || !clickInfo.clickDispatched) {
        return { ok: false, reason: "basement_entry_click_failed", holdPosition: true, clickInfo: clickInfo };
      }
      const enterSettle = await waitForLootSettled("basement_entry");
      if (!enterSettle || !enterSettle.ok) {
        return { ok: false, reason: "basement_entry_settle_timeout", holdPosition: true, settle: enterSettle };
      }
      markBasementEntered({ source: "entrance_tile_cleared" });
      setBotStatus("idle", "entered basement");
      return { ok: true, enteredBasement: true, enterSettle: enterSettle, state: getBasementState() };
    }

    current = readBasicState();
    if (activeInBasement) {
      if (!targetIsBasementEndCandidate && (!Runtime.basement || Runtime.basement.phase !== "complete")) {
        Logger.log("BASEMENT", "Exploration phase: loot/action buttons suppressed on non-end basement tile", {
          targetKey: target.key,
          targetName: target.tileName,
          phase: Runtime && Runtime.basement ? Runtime.basement.phase : null
        });
        setBotStatus("idle", "basement tile cleared; exploration continues");
        return { ok: true, basementExplorationContinues: true };
      }

      if (targetIsBasementEndCandidate) {
        basementSetPhase("atEnd", "end_champion_tile_cleared");
      }

      const lootBtn = document.querySelector(Config.selectors.lootButton);
      if (!lootBtn || !isElementVisible(lootBtn)) {
        Logger.warn("BASEMENT", "Basement end candidate cleared, but knowledge loot button is missing. Stopping safely.", { targetKey: target.key });
        return { ok: false, reason: "basement_knowledge_button_missing", holdPosition: true };
      }

      Logger.log("BASEMENT", "End candidate cleared. Looting Knowledge event.");
      const clickInfo = clickLootButtonWithDiagnostics(lootBtn, "collect knowledge button");
      if (!clickInfo || !clickInfo.clickDispatched) {
        return { ok: false, reason: "basement_knowledge_click_failed", holdPosition: true, clickInfo: clickInfo };
      }
      await retryLootClickOnceIfStillIdle("collect_knowledge");
      const lootSettle = await waitForLootSettled("collect_knowledge", { allowPortalActionVisible: true });
      if (!lootSettle || !lootSettle.ok) {
        return { ok: false, reason: "basement_knowledge_loot_settle_timeout", holdPosition: true, lootSettle: lootSettle };
      }

      if (Runtime && Runtime.basement) {
        Runtime.basement.objectiveCompleteAt = Date.now();
      }
      basementSetPhase("complete", "knowledge_looted");

      let exitDet = detectBasementExitButton();
      let exitButton = exitDet && exitDet.found ? exitDet.button : null;
      let exitMethod = "visible_exiting_button";

      if (!exitButton || !isElementVisible(exitButton)) {
        Logger.warn("BASEMENT", "Visible Exiting button missing; trying current-tile portal action fallback", exitDet);
        const portalDet = await openCurrentTilePopupForBasementAction();
        exitDet = portalDet;
        exitButton = portalDet && portalDet.found ? portalDet.button : null;
        exitMethod = "current_tile_portal_action";
      }

      if (exitButton && isElementVisible(exitButton)) {
        Logger.log("BASEMENT", exitMethod === "visible_exiting_button"
          ? "Visible Exiting button located after knowledge. Exiting basement."
          : "Current-tile portal action located after knowledge. Exiting basement.", exitDet);
        if (clickElementSafe(exitButton, exitMethod === "visible_exiting_button" ? "visible exiting button" : "basement portal exit button")) {
          if (Runtime && Runtime.basement) {
            Runtime.basement.exitClickedAt = Date.now();
          }
          basementSetPhase("exiting", `${exitMethod}_clicked`);
          const exitSettle = await waitForLootSettled("basement_exit");
          if (!exitSettle || !exitSettle.ok) {
            return { ok: false, reason: "basement_exit_settle_timeout", holdPosition: true, exitSettle: exitSettle, exitMethod: exitMethod };
          }

          const outsideCoords = Runtime && Runtime.basement ? (Runtime.basement.outsideEntranceCoords || Runtime.basement.entranceCoords) : null;
          if (outsideCoords && Runtime && Runtime.exploration) {
            Runtime.exploration.lastKnownCoords = { x: outsideCoords.x, y: outsideCoords.y };
            Logger.log("BASEMENT", `Exited basement. Coordinates restored to main map entrance: [${outsideCoords.x}, ${outsideCoords.y}]`, outsideCoords);
          }
          markBasementExited("exit_settled");
        } else {
          return { ok: false, reason: "basement_exit_click_failed", holdPosition: true, exit: exitDet, exitMethod: exitMethod };
        }
      } else {
        Logger.warn("BASEMENT", "Knowledge looted, but no basement exit control was visible. Stopping safely.", exitDet);
        return { ok: false, reason: "basement_exit_missing_after_complete", holdPosition: true, exit: exitDet, exitMethod: exitMethod };
      }
    } else {
      // Normal Map: Click collect/loot highlight button
      const lootBtn = document.querySelector(Config.selectors.lootButton);
      if (lootBtn) {
        if (isBasementPortalActionButtonElement(lootBtn) && !(Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled)) {
          Logger.log("BASEMENT", "Basement entry button suppressed because Basement Farming is OFF");
          setBotStatus("idle", "basement entry suppressed");
          return { ok: true, skipped: true, reason: "basement_entry_suppressed_disabled" };
        }
        if (Runtime && Runtime.preferences && Runtime.preferences.basementFarmingEnabled && isBasementPortalActionButtonElement(lootBtn)) {
          Logger.log("BASEMENT", "Highlighted portal icon detected on normal map; entering basement");
          const clickInfo = clickLootButtonWithDiagnostics(lootBtn, "basement entry button");
          if (clickInfo && clickInfo.clickDispatched) {
            const enterSettle = await waitForLootSettled("basement_entry");
            if (!enterSettle || !enterSettle.ok) {
              return { ok: false, reason: "basement_entry_settle_timeout", holdPosition: true, settle: enterSettle };
            }
            markBasementEntered({ source: "highlighted_entry_button" });
            return { ok: true, enteredBasement: true, enterSettle: enterSettle };
          }
          return { ok: false, reason: "basement_entry_click_failed", holdPosition: true };
        }

        const clickInfo = clickLootButtonWithDiagnostics(lootBtn, "collect button");
        if (clickInfo && clickInfo.clickDispatched) {
          await retryLootClickOnceIfStillIdle("normal_loot");
          const lootSettle = await waitForLootSettled("normal_loot");
          if (!lootSettle || !lootSettle.ok) {
            return { ok: false, reason: "loot_settle_timeout", holdPosition: true, lootSettle: lootSettle };
          }
        }
      }
    }

    setBotStatus("idle", "tile cleared and looted");
    return { ok: true };
  }

  // 9. startAutoFarmLoop (The Primary Orchestration Loop)
  async function startAutoFarmLoop() {
    if (Runtime && Runtime.autoFarm && Runtime.autoFarm.running) {
      Logger.warn("AUTO", "Loop is already running!");
      return false;
    }

    Logger.log("AUTO", "Activating Ligmar Farming Bot...");
    if (Runtime) {
      Runtime.resetForNewAutoSession();
    }
    enableGameInputBlocker();

    // Perform our clean scanning startup sequence
    const statsScan = await readHeroCombatStats();
    if (!statsScan || !statsScan.ok) {
      Logger.error("AUTO", "Aborted activation: Hero Stats Scan failed.");
      stopAutoFarmLoop();
      return false;
    }

    const skillsScan = await scanSkills();
    if (!skillsScan) {
      Logger.error("AUTO", "Aborted activation: Action Bar Skills Scan failed.");
      stopAutoFarmLoop();
      return false;
    }

    // Initialize Map Overlay
    const mapOpen = await ensureMapOpen();
    if (!mapOpen || !mapOpen.ok) {
      Logger.error("AUTO", "Aborted activation: Map Overlay failed to open.");
      stopAutoFarmLoop();
      return false;
    }

    const mapCentered = await ensureMapCentered();
    if (!mapCentered || !mapCentered.ok) {
      Logger.error("AUTO", "Aborted activation: Camera centering verification failed.");
      stopAutoFarmLoop();
      return false;
    }

    // Zoom out map overlay fully
    if (typeof ensureMapZoomedOut === "function") {
      ensureMapZoomedOut();
    }

    // Non-destructive, automated Lens Detection
    await detectLensState();

    Logger.log("AUTO", "Activation complete. Entering autonomous loop!");

    while (Runtime && Runtime.autoFarm && Runtime.autoFarm.running) {
      if (Runtime.autoFarm.stopRequested) {
        break;
      }

      beginDiagnosticCycle("auto_cycle");
      setBotStatus("preparing", "idle settle & buff maintenance");
      await waitUntilNotMoving("explore-prep");
      await runGlobalSustainCheck("auto_loop_start");
      const loopTravelReady = await waitForTravelResourcesForCurrentMode("before_scan");
      if (!loopTravelReady || !loopTravelReady.ok) {
        Logger.warn("AUTO", "Travel resource gate failed before scan", loopTravelReady);
        await sleep(Config.timings.cycleDelayMs || 900);
        continue;
      }

      // Maintain OOC Long-Buffs (duration >= 60s)
      await maintainLongbuffsOutOfCombat();

      // Scan adjacent tiles
      setBotStatus("scanning", "1-ring scan");

      const loopMapOpen = await ensureMapOpen();
      if (!loopMapOpen || !loopMapOpen.ok) {
        Logger.warn("AUTO", "Map could not be opened before scan. Retrying next cycle.", loopMapOpen);
        endDiagnosticCycle("map_not_open_before_scan", loopMapOpen);
        await sleep(Config.timings.cycleDelayMs || 900);
        continue;
      }

      // Re-center map before each scan to prevent camera drift
      await ensureMapCentered();
      await sleep(300);

      const scan = await scanNeighborRing();
      if (!scan || !scan.ok) {
        Logger.warn("AUTO", "Ring scan failed. Retrying next cycle.");
        endDiagnosticCycle("ring_scan_failed", scan);
        await sleep(Config.timings.cycleDelayMs || 900);
        continue;
      }

      // Score and select best direction, with lens-aware ring escalation.
      let best = chooseBestScannedNeighbor(scan);
      let selectedBy = "first_ring_best";
      const hasUsefulFirstRing = typeof ringHasUsefulLoot === "function" && ringHasUsefulLoot(scan);
      const lensState = typeof getLensState === "function" ? getLensState() : { hasLens: false };

      if (!hasUsefulFirstRing) {
        if (lensState && lensState.hasLens === true) {
          const secondClick = await scanSecondRingClickable();
          const usefulSecond = typeof chooseBestUsefulRingTarget === "function" ? chooseBestUsefulRingTarget(secondClick) : null;
          if (usefulSecond) {
            const step = chooseStepTowardRingTarget(scan, usefulSecond);
            if (step) {
              best = step;
              selectedBy = "second_ring_click_scan";
              Logger.log("SCAN", "Moving toward useful second-ring clicked target", { target: usefulSecond.key, chosen: step.key, score: usefulSecond.score });
            }
          } else {
            const cfg = Config.scan.thirdRing || {};
            const avoidChampions = Runtime && Runtime.preferences ? Runtime.preferences.avoidChampions !== false : true;
            if (!avoidChampions) {
              const red = Config.scan.secondRing.championRedColor || { r: 0xaa, g: 0x40, b: 0x40 };
              const thirdRed = await scanThirdRingForColor(red, { tolerance: Config.scan.secondRing.championRedTolerance || 75, minMatchRatio: Config.scan.secondRing.championRedMinMatchRatio || cfg.minMatchRatio || 0.004 });
              if (thirdRed && thirdRed.best) {
                const step = chooseStepTowardRingTarget(scan, thirdRed.best);
                if (step) {
                  best = step;
                  selectedBy = "third_ring_red_champion_die";
                  Logger.log("SCAN", "Moving toward third-ring red champion die", { hit: thirdRed.best, chosen: step.key });
                }
              }
            }
            if (selectedBy !== "third_ring_red_champion_die") {
              const yellow = Config.scan.secondRing.yellowDieColor || { r: 240, g: 184, b: 12 };
              const third = await scanThirdRingForColor(yellow, { tolerance: Config.scan.secondRing.yellowDieTolerance || 75, minMatchRatio: cfg.minMatchRatio || 0.004 });
              if (third && third.best) {
                const step = chooseStepTowardRingTarget(scan, third.best);
                if (step) {
                  best = step;
                  selectedBy = "third_ring_yellow_die";
                  Logger.log("SCAN", "Moving toward third-ring yellow die", { hit: third.best, chosen: step.key });
                }
              }
            }
          }
        } else {
          const avoidChampions = Runtime && Runtime.preferences ? Runtime.preferences.avoidChampions !== false : true;
          if (!avoidChampions) {
            const championDie = await scanSecondRingForChampion();
            if (championDie && championDie.best) {
              const step = chooseStepTowardRingTarget(scan, championDie.best);
              if (step) {
                best = step;
                selectedBy = "second_ring_red_champion_die";
                Logger.log("SCAN", "Moving toward second-ring red champion die", { hit: championDie.best, chosen: step.key });
              } else {
                Logger.warn("SCAN", "Second-ring red champion die found but no walkable first-ring step", championDie.best);
              }
            }
          }
          if (selectedBy !== "second_ring_red_champion_die") {
            const die = await scanSecondRingForDie();
            if (die && die.best) {
              const step = chooseStepTowardRingTarget(scan, die.best);
              if (step) {
                best = step;
                selectedBy = "second_ring_yellow_die";
                Logger.log("SCAN", "Moving toward second-ring yellow die", { hit: die.best, chosen: step.key });
              } else {
                Logger.warn("SCAN", "Second-ring yellow die found but no walkable first-ring step", die.best);
              }
            }
          }
        }
      }

      if (!best) {
        setBotStatus("waiting", "no safe neighbors found, standing still");
        Logger.log("AUTO", "No safe walkable neighbors found. Standing still before next scan.");
        endDiagnosticCycle("no_safe_neighbor", { scan: scan });
        await sleep(Config.timings.idleNoEnemyDelayMs || 4000);
        continue;
      }
      Logger.log("AUTO", "Selected next tile", { key: best.key, selectedBy: selectedBy, coords: best.coords });
      recordDiagnosticDecision("selected_tile", { key: best.key, selectedBy: selectedBy, tile: best });

      // Execute movement, combat, and looting on the chosen tile!
      const result = await secureTileAndLootOnce(best);
      recordDiagnosticDecision("secure_tile_result", result);
      if (result && result.ok) {
        if (Runtime && Runtime.autoFarm) {
          Runtime.autoFarm.cyclesCompleted += 1;
        }
        endDiagnosticCycle("success", result);
      } else {
        if (Runtime && Runtime.autoFarm) {
          Runtime.autoFarm.consecutiveFailures += 1;
        }
        endDiagnosticCycle(result && result.reason ? result.reason : "failure", result);
        if (result && result.holdPosition) {
          Logger.warn("AUTO", "Holding current occupied tile after target-lock failure; stopping AUTO to avoid walking away", result);
          createDiagnosticReport("hold_position_stop", result);
          stopAutoFarmLoop();
          break;
        }
      }

      // Yield cycle delay before next scan iteration
      await sleep(Config.timings.cycleDelayMs || 900);
    }

    disableGameInputBlocker();
    Logger.log("AUTO", "Ligmar Farming Bot successfully deactivated.");
    setBotStatus("idle", "bot offline");
    return true;
  }

  function stopAutoFarmLoop() {
    if (Runtime && Runtime.autoFarm) {
      Runtime.autoFarm.stopRequested = true;
      Runtime.autoFarm.running = false;
    }
    disableGameInputBlocker();
    setBotStatus("idle", "stopping");
  }
