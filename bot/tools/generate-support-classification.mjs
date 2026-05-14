#!/usr/bin/env node
/**
 * Reads bot/data/ligmar_hero_skills_db.json and emits bot/modules/88-support-classification.generated.js
 * with per-class normalized-name metadata: duration band, scope (self vs mass), role (protective vs attacking),
 * and whether the skill is maintained by the permanent-self OOC renew path (>=60s self, not safety-like).
 *
 * Run from repo root or via bot/build.ps1:
 *   node bot/tools/generate-support-classification.mjs <path-to-skills-db.json> <output-88-module.js>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripLevelSuffix(name) {
  let s = String(name || "").trim();
  const m = s.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
  if (m) {
    s = m[1].trim();
  }
  return s;
}

function normKey(name) {
  return stripLevelSuffix(name).toLowerCase().trim();
}

function parseMaxDurationSecFromDescription(desc) {
  const d = String(desc || "");
  let best = null;
  const re = /(\d[\d.,]{0,8})\s*(?:s(?:ec(?:ond)?s?)?)\b/gi;
  let x;
  while ((x = re.exec(d)) !== null) {
    const v = parseFloat(String(x[1]).replace(/,/g, "."));
    if (Number.isFinite(v) && v > 0 && v < 200000 && (best === null || v > best)) {
      best = v;
    }
  }
  return best;
}

function tagsLower(tags) {
  return Array.isArray(tags) ? tags.map((t) => String(t || "").toLowerCase().trim()) : [];
}

function hasTagLoose(tags, want) {
  const w = String(want || "").toLowerCase();
  return tagsLower(tags).indexOf(w) !== -1;
}

function supportDescriptionSafetyLike(desc) {
  const d = String(desc || "").toLowerCase();
  if (
    (d.indexOf("absorb") !== -1 && d.indexOf("incoming") !== -1) ||
    (d.indexOf("absorbs") !== -1 && d.indexOf("incoming") !== -1) ||
    (d.indexOf("incoming damage") !== -1 && (d.indexOf("barrier") !== -1 || d.indexOf("shield") !== -1))
  ) {
    return true;
  }
  return false;
}

function classifyRole(desc) {
  const d = String(desc || "").toLowerCase();
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
    "immune",
    "avoid fatal",
    "visibility",
    "hide from all enemies"
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
    "rage",
    "accuracy",
    "additional",
    "restores health",
    "restores mana",
    "maximum mana",
    "maximum health"
  ];
  let hitsProt = false;
  let hitsAtt = false;
  for (let i = 0; i < protNeedles.length; i++) {
    if (d.indexOf(protNeedles[i]) !== -1) {
      hitsProt = true;
      break;
    }
  }
  for (let j = 0; j < attNeedles.length; j++) {
    if (d.indexOf(attNeedles[j]) !== -1) {
      hitsAtt = true;
      break;
    }
  }
  if (hitsProt && hitsAtt) {
    return "mixed";
  }
  if (hitsProt) {
    return "protective";
  }
  if (hitsAtt) {
    return "attacking";
  }
  return "unknown";
}

function classifyScope(tags, desc) {
  const t = tagsLower(tags);
  const hasParty = t.indexOf("party") !== -1;
  const hasSelf = t.indexOf("self") !== -1;
  const d = String(desc || "").toLowerCase();
  if (hasParty || d.indexOf("allies") !== -1 || d.indexOf("ally") !== -1 || d.indexOf("party") !== -1) {
    return "mass";
  }
  if (hasSelf) {
    return "self";
  }
  if (d.indexOf("his allies") !== -1 || d.indexOf("group") !== -1) {
    return "mass";
  }
  return "unknown";
}

const LONG_SEC = 60;

function buildEntry(classKey, row) {
  const tags = row.tags;
  if (!hasTagLoose(tags, "support") || hasTagLoose(tags, "attack")) {
    return null;
  }
  const desc = typeof row.description === "string" ? row.description : "";
  const dur = parseMaxDurationSecFromDescription(desc);
  const scope = classifyScope(tags, desc);
  const role = classifyRole(desc);
  let durationBand = "unknown";
  if (Number.isFinite(dur)) {
    durationBand = dur >= LONG_SEC ? "long" : "short";
  }
  const safetyLike = supportDescriptionSafetyLike(desc);
  const permanentSelfOoc =
    Number.isFinite(dur) &&
    dur >= LONG_SEC &&
    scope === "self" &&
    !safetyLike &&
    !hasTagLoose(tags, "attack");
  const excludeFromPrebuff = permanentSelfOoc === true;
  return {
    classKey,
    nameRaw: row.name,
    nameKey: normKey(row.name),
    scope,
    role,
    durationSecGuess: Number.isFinite(dur) ? dur : null,
    durationBand,
    permanentSelfOoc,
    excludeFromPrebuff,
    safetyLike
  };
}

function main() {
  const dbPath = process.argv[2] || path.join(__dirname, "../data/ligmar_hero_skills_db.json");
  const outPath =
    process.argv[3] || path.join(__dirname, "../modules/88-support-classification.generated.js");

  let raw = fs.readFileSync(dbPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const tree = JSON.parse(raw);
  const byClass = {};

  const classKeys = Object.keys(tree || {});
  for (let ci = 0; ci < classKeys.length; ci++) {
    const classKey = classKeys[ci];
    const list = tree[classKey];
    if (!Array.isArray(list)) {
      continue;
    }
    const bucket = Object.create(null);
    for (let j = 0; j < list.length; j++) {
      const row = list[j];
      if (!row || typeof row !== "object") {
        continue;
      }
      const meta = buildEntry(classKey, row);
      if (!meta) {
        continue;
      }
      const k = meta.nameKey;
      if (!k) {
        continue;
      }
      bucket[k] = {
        scope: meta.scope,
        role: meta.role,
        durationSecGuess: meta.durationSecGuess,
        durationBand: meta.durationBand,
        permanentSelfOoc: meta.permanentSelfOoc,
        excludeFromPrebuff: meta.excludeFromPrebuff
      };
    }
    if (Object.keys(bucket).length) {
      byClass[String(classKey).toLowerCase()] = bucket;
    }
  }

  const json = JSON.stringify(byClass, null, 2);
  const content = `  // AUTO-GENERATED by bot/tools/generate-support-classification.mjs — do not edit by hand.
  // Maps hero class -> normalizeSkillName(lower) -> { scope, role, durationSecGuess, durationBand, permanentSelfOoc, excludeFromPrebuff }.
  const SupportSkillClassificationByClass = ${json};

  function lookupSupportSkillClassificationFromGeneratedDb(classKey, rawOrBaseName) {
    const ck = String(classKey || "").trim().toLowerCase();
    if (!ck) {
      return null;
    }
    const bucket = SupportSkillClassificationByClass[ck];
    if (!bucket || typeof bucket !== "object") {
      return null;
    }
    const base =
      typeof normalizeSkillName === "function"
        ? String(normalizeSkillName(String(rawOrBaseName || ""))).trim().toLowerCase()
        : String(rawOrBaseName || "").trim().toLowerCase();
    if (!base) {
      return null;
    }
    const hit = bucket[base];
    return hit || null;
  }

  function listSupportSkillClassificationFromMasterDb(optClassKey) {
    const root = SupportSkillClassificationByClass || {};
    const want = String(optClassKey || "").trim().toLowerCase();
    if (want && root[want]) {
      const b = root[want];
      return Object.keys(b).map(function (k) {
        return { classKey: want, nameKey: k, meta: b[k] };
      });
    }
    const out = [];
    const ckeys = Object.keys(root);
    for (let i = 0; i < ckeys.length; i++) {
      const c = ckeys[i];
      const b = root[c];
      if (!b || typeof b !== "object") {
        continue;
      }
      const nk = Object.keys(b);
      for (let j = 0; j < nk.length; j++) {
        out.push({ classKey: c, nameKey: nk[j], meta: b[nk[j]] });
      }
    }
    return out;
  }
`;
  fs.writeFileSync(outPath, content + "\n", "utf8");
  console.log("Wrote", outPath, "classes:", Object.keys(byClass).length);
}

main();
