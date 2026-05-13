// ==UserScript==
// @name         Ligmar Bot Loader
// @namespace    http://tampermonkey.net/
// @version      0.3.191
// @description  Local loader — pulls bundled Ligmar bot via @require from disk. Auto-bumped by bot/build.ps1.
// @author       Victor
// @match        https://ligmar.io/game/*
// @grant        none
// @require      file:///C:/Users/Victor/.cursor/projects/ligmarbot/bot/bot.user.js
// ==/UserScript==

// Loader stub. Actual bot lives in bot/bot.user.js (built from bot/modules/*.js).
// Tampermonkey re-fetches the @require'd file when this loader's @version changes,
// which build.ps1 bumps automatically on every build.
//
// One-time setup (Chrome):
//   1. chrome://extensions -> Tampermonkey -> Details -> enable "Allow access to file URLs".
//   2. Tampermonkey Dashboard -> Settings -> Config mode "Advanced" ->
//      Security -> "Allow scripts access to local file URIs" = Yes.
//   3. Install this loader (drag-drop into Tampermonkey).
//   4. Disable / delete the legacy "Ligmar Bot" script.
//   5. Reload https://ligmar.io/game/...
