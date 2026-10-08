"use strict";

const CAT_KEY = "roofQuote.catalogue.v10";
const DRAFT_KEY = "roofQuote.draft.v1";
const SAVED_KEY = "roofQuote.saved.v1";

let config;
let quote;
let originalConfig;
let usingSavedCatalogue = false;
let lastCalc = null;
let focusSnapshot = null;
let pendingScroll = null;

const ui = {
  view: "quote",
  closed: {},
  modal: null,
  modalError: "",
  saveDone: false,
  savedLink: "",
  notice: "",
  added: false,
  showErrors: false,
  stockError: "",
  stockDraft: null,
  storageError: "",
  catalogueQuery: "",
  cladPhase: "shape",
  cladError: "",
};

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

function saveCladWall() {
  const draft = quote.wallDraft;
  if (!draft.shape || !draft.orientation || !wallDimsOk(draft)) {
    ui.cladError = "Choose the wall, the direction, and the measurements first.";
    ui.cladPhase = !draft.shape ? "shape" : !draft.orientation ? "direction" : "measure";
    return;
  }
  if (draft.hasDoor && !(val(draft.doorH) > 0 && val(draft.doorW) > 0)) {
    ui.cladError = "Enter the door height and width, or choose No.";
    ui.cladPhase = "openings";
    return;
  }
  const windows = (draft.windows || []).filter((win) => String(win.h || "").trim() || String(win.w || "").trim());
  if (windows.some((win) => !(val(win.h) > 0 && val(win.w) > 0))) {
    ui.cladError = "Each window needs a height and a width.";
    ui.cladPhase = "openings";
    return;
  }
  draft.windows = windows;
  const walls = quote.walls || [];
  const at = walls.findIndex((wall) => wall.id === draft.id);
  if (at >= 0) walls[at] = clone(draft);
  else walls.push(clone(draft));
  quote.walls = walls;
  ui.cladError = "";
  ui.cladPhase = "summary";
  ui.added = false;
}

function blankWall() {
  return {
    id: uid("wall"),
    shape: "",
    orientation: "",
    gableH: "",
    gableW: "",
    wallH: "",
    wallW: "",
    hasDoor: false,
    doorH: "",
    doorW: "",
    windows: [],
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeSrc(src) {
  const s = String(src || "").trim();
  if (!s || /^javascript:/i.test(s)) return "";
  if (/^data:(?!image\/)/i.test(s)) return "";
  return s;
}

function safeHex(value) {
  const v = String(value || "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : "#cccccc";
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    ui.storageError = "Could not save in this browser. Download a backup, or use smaller images.";
    return false;
  }
}

function money(n) {
  const sym = (config.company && config.company.currencySymbol) || "£";
  return (round2(n) < 0 ? "-" : "") + sym + Math.abs(round2(n)).toFixed(2);
}

function fieldId(path) {
  return "f_" + String(path).replace(/[^a-zA-Z0-9]+/g, "_");
}

function getPath(obj, path) {
  return String(path).split(".").reduce((cur, key) => (cur == null ? cur : cur[key]), obj);
}

function setPath(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur == null) return;
    cur = cur[parts[i]];
  }
  if (cur != null) cur[parts[parts.length - 1]] = value;
}

function defaultQuote() {
  return {
    roofTypeId: null,
    apexSame: true,
    apexA: "",
    apexB: "",
    apexC: "",
    apexD: "",
    monoA: "",
    monoB: "",
    monoC: "",
    profileId: null,
    finishId: null,
    colourId: null,
    dripstopOn: false,
    rooflightId: null,
    rooflightQty: { s1: 0, s2: 0, m: 0 },
    bargeId: null,
    ridgeApexId: null,
    ridgeMonoId: null,
    abutmentId: null,
    qtyAdjust: { dripstop: "", barge: "", ridgeApex: "", ridgeMono: "", abutment: "" },
    picks: {},
    jobId: null,
    jobProductId: null,
    jobVariantId: null,
    jobLength: "",
    jobWidth: "",
    jobHeight: "",
    jobCount: "",
    jobWaste: "",
    walls: [],
    wallDraft: null,
    notes: "",
    customer: { name: "", email: "", phone: "" },
    customNotes: {},
    ref: "",
  };
}

function normalizeQuote() {
  const base = defaultQuote();
  quote.rooflightQty = { ...base.rooflightQty, ...(quote.rooflightQty || {}) };
  quote.qtyAdjust = { ...base.qtyAdjust, ...(quote.qtyAdjust || {}) };
  quote.picks = quote.picks && typeof quote.picks === "object" ? quote.picks : {};
  quote.customer = { ...base.customer, ...(quote.customer || {}) };
  quote.customNotes = { ...(quote.customNotes || {}) };
  if (typeof quote.apexSame !== "boolean") quote.apexSame = true;
  if (quote.units !== "ft") quote.units = "m";
  if (!quote.slopeRise || typeof quote.slopeRise !== "object") quote.slopeRise = {};
  if (quote.roofTypeId === "roof-apex-mono") quote.roofTypeId = null;
  if (!Array.isArray(quote.walls)) quote.walls = [];
  if (!quote.wallDraft || typeof quote.wallDraft !== "object") quote.wallDraft = blankWall();
  if (!Array.isArray(quote.wallDraft.windows)) quote.wallDraft.windows = [];
}

function tidyProfile(profile) {
  if (!profile.id) profile.id = uid("profile");
  ["finishes", "colours", "rooflights", "barges", "ridges", "abutments"].forEach((key) => {
    if (!Array.isArray(profile[key])) profile[key] = [];
  });
  profile.finishes.forEach((item) => { if (!item.id) item.id = uid("finish"); });
  profile.colours.forEach((item) => { if (!item.id) item.id = uid("colour"); });
  profile.rooflights.forEach((item) => { if (!item.id) item.id = uid("light"); });
  profile.barges.forEach((item) => { if (!item.id) item.id = uid("flash"); });
  profile.ridges.forEach((item) => {
    if (!item.id) item.id = uid("flash");
    if (!item.kind) item.kind = "apex";
  });
  profile.abutments.forEach((item) => { if (!item.id) item.id = uid("flash"); });
  if (profile.allowsDripstop == null) profile.allowsDripstop = true;
  return profile;
}

function tidyVariantProduct(product) {
  if (!product.id) product.id = uid("item");
  if (!Array.isArray(product.variants) || !product.variants.length) {
    product.variants = [{ id: uid("var"), name: "Standard", price: 0, packSize: 1 }];
  }
  product.variants.forEach((variant) => {
    if (!variant.id) variant.id = uid("var");
    if (variant.packSize == null || variant.packSize === "") variant.packSize = 1;
  });
  if (!Array.isArray(product.profileIds)) product.profileIds = [];
  return product;
}

function normaliseSteps(steps) {
  const requiredByKind = { type: true, measure: true, profile: true, finish: true, colour: true, review: true };
  const builtins = (originalConfig.steps || [])
    .filter((step) => (step.kind || step.id) !== "custom")
    .map((step) => {
      const kind = step.kind || step.id;
      return {
        id: step.id || kind,
        kind,
        title: step.title || kind,
        hint: step.hint || "",
        body: step.body || "",
        enabled: step.enabled !== false,
        required: typeof step.required === "boolean" ? step.required : !!requiredByKind[kind],
      };
    });
  const incoming = Array.isArray(steps) ? steps : [];
  const used = new Set();
  const result = [];
  incoming.forEach((step) => {
    const kind = step.kind || step.id;
    if (kind === "custom") {
      result.push({
        id: step.id || uid("step"),
        kind: "custom",
        title: step.title || "New step",
        hint: step.hint || "",
        body: step.body || "",
        enabled: step.enabled !== false,
        required: !!step.required,
      });
      return;
    }
    const base = builtins.find((item) => item.kind === kind);
    if (!base || used.has(kind)) return;
    used.add(kind);
    result.push({
      ...base,
      id: base.id,
      title: step.title || base.title,
      hint: step.hint != null ? step.hint : base.hint,
      body: step.body || base.body || "",
      enabled: step.enabled !== false,
      required: typeof step.required === "boolean" ? step.required : base.required,
    });
  });
  builtins.forEach((step) => {
    if (used.has(step.kind)) return;
    const reviewAt = result.findIndex((item) => item.kind === "review");
    if (reviewAt >= 0) result.splice(reviewAt, 0, step);
    else result.push(step);
  });
  if (!result.some((step) => step.kind === "export")) {
    result.push({
      id: "export",
      kind: "export",
      title: "Export",
      hint: "Download this quote and the full catalogue as an Excel file.",
      enabled: true,
      required: false,
      body: "",
    });
  }
  return result;
}

function ensureConfig(data) {
  const next = data || {};
  next.version = 1;
  next.meta = next.meta || { sample: false };
  next.theme = { ...clone(originalConfig.theme), ...(next.theme || {}) };
  next.company = { ...clone(originalConfig.company), ...(next.company || {}) };
  next.copy = { ...clone(originalConfig.copy), ...(next.copy || {}) };
  next.rules = { ...clone(originalConfig.rules), ...(next.rules || {}) };
  if (!Array.isArray(next.rules.stockLengthsM) || !next.rules.stockLengthsM.length) {
    next.rules.stockLengthsM = clone(originalConfig.rules.stockLengthsM);
  }
  next.measureFields = next.measureFields || {};
  Object.keys(originalConfig.measureFields).forEach((key) => {
    next.measureFields[key] = { ...originalConfig.measureFields[key], ...(next.measureFields[key] || {}) };
  });
  next.steps = normaliseSteps(next.steps);
  if (!Array.isArray(next.roofTypes)) next.roofTypes = [];
  next.roofTypes = next.roofTypes.filter((roof) => roof && roof.id !== "roof-apex-mono");
  if (!Array.isArray(next.profiles)) next.profiles = [];
  if (!Array.isArray(next.fixings)) next.fixings = [];
  if (!Array.isArray(next.extras)) next.extras = [];
  next.jobs = clone(originalConfig.jobs || []);
  next.extras = clone(originalConfig.extras || []);
  next.dripstop = { ...clone(originalConfig.dripstop), ...(next.dripstop || {}) };
  next.profiles.forEach(tidyProfile);
  next.fixings.forEach(tidyVariantProduct);
  next.extras.forEach(tidyVariantProduct);
  next.roofTypes.forEach((roof) => {
    if (!roof.id) roof.id = uid("roof");
    ["includeApex", "includeMono", "apexRidge", "monoRidge", "abutment"].forEach((key) => {
      if (typeof roof[key] !== "boolean") roof[key] = false;
    });
  });
  const typeStep = (next.steps || []).find((step) => step.id === "type" || step.kind === "type");
  if (typeStep && /lean-to/i.test(String(typeStep.hint || ""))) {
    typeStep.hint = "An apex roof or a single slope.";
  }
  const colourStep = (next.steps || []).find((step) => step.kind === "colour");
  if (colourStep && /box profile is (black, green|juniper green)/i.test(String(colourStep.hint || ""))) {
    const freshHint = ((originalConfig.steps || []).find((step) => step.kind === "colour") || {}).hint;
    if (freshHint) colourStep.hint = freshHint;
  }
  const freshProfiles = new Map((originalConfig.profiles || []).map((profile) => [profile.id, profile]));
  next.profiles.forEach((profile) => {
    const fresh = freshProfiles.get(profile.id);
    if (!fresh) return;
    if (fresh.image) profile.image = fresh.image;
    // Stock status always comes from config.js, so saved browser edits cannot hide it.
    profile.outOfStock = !!fresh.outOfStock;
    profile.outOfStockLengthsM = Array.isArray(fresh.outOfStockLengthsM) ? fresh.outOfStockLengthsM.slice() : [];
    if (!Array.isArray(fresh.colours)) return;
    const byId = new Map((profile.colours || []).filter((colour) => colour && colour.id).map((colour) => [colour.id, colour]));
    const ordered = fresh.colours.map((colour) => {
      const current = byId.get(colour.id) || {};
      byId.delete(colour.id);
      return {
        ...current,
        id: colour.id,
        name: colour.name,
        hex: colour.hex,
        image: colour.image || current.image || "",
      };
    });
    byId.forEach((colour) => ordered.push(colour));
    profile.colours = ordered;
  });
  return next;
}

function loadCatalogue() {
  const raw = storageGet(CAT_KEY);
  if (!raw) return ensureConfig(clone(originalConfig));
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.profiles)) return clone(originalConfig);
    usingSavedCatalogue = true;
    return ensureConfig(data);
  } catch (err) {
    return clone(originalConfig);
  }
}

function saveCatalogue() {
  ui.storageError = "";
  storageSet(CAT_KEY, JSON.stringify(config));
}

function loadDraft() {
  const raw = storageGet(draftKey());
  const base = defaultQuote();
  if (!raw) return base;
  try {
    return { ...base, ...JSON.parse(raw) };
  } catch (err) {
    return base;
  }
}

function readSaved() {
  try { return JSON.parse(storageGet(SAVED_KEY) || "{}"); } catch (err) { return {}; }
}

function applySavedFromHash() {
  const match = location.hash.match(/quote=([a-z0-9]+)/i);
  if (!match) return;
  const found = readSaved()[match[1]];
  if (!found || !found.state) {
    ui.notice = "That saved quote is not stored in this browser.";
    return;
  }
  quote = { ...defaultQuote(), ...found.state };
  normalizeQuote();
  ui.notice = "Saved quote loaded.";
  ui.view = "quote";
}

function applyTheme() {
  const theme = config.theme || {};
  if (theme.accent) document.documentElement.style.setProperty("--accent", theme.accent);
  if (theme.ink) document.documentElement.style.setProperty("--ink", theme.ink);
}

function currentType() {
  return (config.roofTypes || []).find((item) => item.id === quote.roofTypeId) || null;
}

function currentProfile() {
  return (config.profiles || []).find((item) => item.id === quote.profileId) || null;
}

function findSellable(id) {
  return [...(config.fixings || []), ...(config.extras || [])].find((item) => item.id === id) || null;
}

function stepDone(id) {
  if (id === "type") return lastCalc.typeOk;
  if (id === "measure") return lastCalc.measurementsOk;
  if (id === "profile") return lastCalc.profileOk;
  if (id === "finish") return lastCalc.finishOk;
  if (id === "colour") return lastCalc.colourOk;
  if (id === "review") return lastCalc.quoteReady;
  if (id === "dripstop") return !!(quote.dripstopOn && lastCalc.dripstop.allowed);
  if (id === "rooflight") return lastCalc.slopes.some((slope) => slope.rooflights > 0);
  if (id === "barge") return !!quote.bargeId;
  if (id === "ridge") return !!(quote.ridgeApexId || quote.ridgeMonoId);
  if (id === "abutment") return !!quote.abutmentId;
  if (id === "fixings") return (config.fixings || []).some((item) => quote.picks[item.id] && Number(quote.picks[item.id].qty) > 0);
  if (id === "extras") return (config.extras || []).some((item) => quote.picks[item.id] && Number(quote.picks[item.id].qty) > 0);
  if (id === "job") return !!quote.jobId;
  if (id === "size") return quote.jobId === "cladding" ? !!quote.jobProductId : !!lastCalc.jobOk;
  if (id === "clad-wall") return quote.jobId === "cladding" && !!lastCalc.jobOk;
  if (id === "job-colour") {
    const colours = jobColours(currentJobProduct());
    if (colours.length < 2) return true;
    return colours.some((item) => item.id === quote.jobVariantId);
  }
  return false;
}

function stepMsg(step) {
  if (!ui.showErrors) return "";
  return allErrors()
    .filter((error) => error.step === step && !error.field)
    .map((error) => `<p class="err">${esc(error.message)}</p>`)
    .join("");
}

function fieldMsg(field) {
  // "always" errors are impossible measurements, not blanks: show them at once
  const hit = lastCalc.errors.find((error) => error.field === field && (ui.showErrors || error.always));
  return hit ? `<p class="err">${esc(hit.message)}</p>` : "";
}

function warnHtml(step) {
  return (lastCalc.warnings || [])
    .filter((warning) => warning.step === step)
    .map((warning) => `<p class="warn">${esc(warning.message)}</p>`)
    .join("");
}

function thumb(src, label) {
  const safe = safeSrc(src);
  if (safe) {
    const pattern = /\.svg(?:$|[?#])/i.test(safe);
    return `<div class="media${pattern ? " pattern" : ""}"><img src="${esc(safe)}" alt=""></div>`;
  }
  const letter = esc(String(label || "?").trim().charAt(0).toUpperCase() || "?");
  return `<div class="media"><span class="letter">${letter}</span></div>`;
}

function apexArt() {
  return `<svg class="diagram" preserveAspectRatio="xMidYMid meet" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 170" role="img"><defs><filter id="apshf" x="-30%" y="-60%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.2"/></filter></defs><ellipse cx="170.0" cy="153.5" rx="72.2" ry="4.6" fill="#0b1118" fill-opacity=".22" filter="url(#apshf)"/><path d="M 98.06,149.45 L 188.10,149.45 L 188.10,108.04 L 98.06,108.04 Z" fill="#b2b6ba" stroke="#b2b6ba" stroke-width=".35"/><path d="M 188.10,149.45 L 241.94,90.93 L 241.94,49.51 L 188.10,108.04 Z" fill="#9a9ea2" stroke="#9a9ea2" stroke-width=".35"/><path d="M 98.06,108.04 L 188.10,108.04 L 241.94,49.51 L 151.90,49.51 Z" fill="#e2e5e7" stroke="#e2e5e7" stroke-width=".35"/><path d="M 98.06,108.04 L 188.10,108.04 L 143.08,77.43 Z" fill="#b2b6ba" stroke="#b2b6ba" stroke-width=".35"/><path d="M 134.03,149.50 L 152.04,149.50 L 152.04,124.29 L 134.03,124.29 Z" fill="#333a42" stroke="#333a42" stroke-width=".35"/><path d="M 140.18,80.58 L 87.96,116.09 L 147.60,51.26 L 199.82,15.75 Z" fill="#5a6670" stroke="#5a6670" stroke-width=".35"/><path d="M 140.18,80.58 L 192.40,116.09 L 252.04,51.26 L 199.82,15.75 Z" fill="#404953" stroke="#404953" stroke-width=".35"/><path d="M 192.40,116.09 L 252.04,51.26 L 252.04,53.96 L 192.40,118.79 Z" fill="#2b3239" stroke="#2b3239" stroke-width=".35"/><path d="M 140.18,80.58 L 87.96,116.09 L 87.96,118.79 L 140.18,83.28 Z" fill="#333a42" stroke="#333a42" stroke-width=".35"/><path d="M 140.18,80.58 L 192.40,116.09 L 192.40,118.79 L 140.18,83.28 Z" fill="#333a42" stroke="#333a42" stroke-width=".35"/><path d="M 135.68,81.48 L 144.68,81.48 L 144.68,78.33 L 135.68,78.33 Z" fill="#6b747c" stroke="#6b747c" stroke-width=".35"/><path d="M 144.68,81.48 L 204.32,16.65 L 204.32,13.50 L 144.68,78.33 Z" fill="#586067" stroke="#586067" stroke-width=".35"/><path d="M 135.68,78.33 L 144.68,78.33 L 204.32,13.50 L 195.32,13.50 Z" fill="#8f99a2" stroke="#8f99a2" stroke-width=".35"/><line x1="131.5" y1="86.5" x2="191.1" y2="21.7" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="122.8" y1="92.4" x2="182.4" y2="27.6" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="114.1" y1="98.3" x2="173.7" y2="33.5" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="105.4" y1="104.3" x2="165.0" y2="39.4" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="96.7" y1="110.2" x2="156.3" y2="45.3" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="148.9" y1="86.5" x2="208.5" y2="21.7" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="157.6" y1="92.4" x2="217.2" y2="27.6" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="166.3" y1="98.3" x2="225.9" y2="33.5" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="175.0" y1="104.3" x2="234.6" y2="39.4" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="183.7" y1="110.2" x2="243.3" y2="45.3" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/></svg>`;
}

function monoArt() {
  return `<svg class="diagram" preserveAspectRatio="xMidYMid meet" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 170" role="img"><defs><filter id="moshf" x="-30%" y="-60%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.2"/></filter></defs><ellipse cx="170.0" cy="153.5" rx="76.0" ry="4.6" fill="#0b1118" fill-opacity=".22" filter="url(#moshf)"/><path d="M 94.24,149.45 L 189.06,149.45 L 189.06,107.73 L 94.24,107.73 Z" fill="#b2b6ba" stroke="#b2b6ba" stroke-width=".35"/><path d="M 189.06,149.45 L 245.76,87.82 L 245.76,46.10 L 189.06,107.73 Z" fill="#9a9ea2" stroke="#9a9ea2" stroke-width=".35"/><path d="M 94.24,107.73 L 189.06,107.73 L 245.76,46.10 L 150.94,46.10 Z" fill="#e2e5e7" stroke="#e2e5e7" stroke-width=".35"/><path d="M 94.24,107.73 L 189.06,107.73 L 94.24,83.08 Z" fill="#b2b6ba" stroke="#b2b6ba" stroke-width=".35"/><path d="M 149.19,149.50 L 166.26,149.50 L 166.26,122.95 L 149.19,122.95 Z" fill="#333a42" stroke="#333a42" stroke-width=".35"/><path d="M 83.60,84.43 L 193.59,113.02 L 256.40,44.75 L 146.41,16.15 Z" fill="#525d68" stroke="#525d68" stroke-width=".35"/><path d="M 193.59,113.02 L 256.40,44.75 L 256.40,47.60 L 193.59,115.87 Z" fill="#2b3239" stroke="#2b3239" stroke-width=".35"/><path d="M 83.60,84.43 L 193.59,113.02 L 193.59,115.87 L 83.60,87.27 Z" fill="#333a42" stroke="#333a42" stroke-width=".35"/><path d="M 83.60,84.90 L 90.24,84.90 L 90.24,81.77 L 83.60,81.77 Z" fill="#6b747c" stroke="#6b747c" stroke-width=".35"/><path d="M 90.24,84.90 L 153.05,16.63 L 153.05,13.50 L 90.24,81.77 Z" fill="#586067" stroke="#586067" stroke-width=".35"/><path d="M 83.60,81.77 L 90.24,81.77 L 153.05,13.50 L 146.41,13.50 Z" fill="#8f99a2" stroke="#8f99a2" stroke-width=".35"/><line x1="97.3" y1="88.0" x2="160.2" y2="19.7" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="111.1" y1="91.6" x2="173.9" y2="23.3" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="124.8" y1="95.1" x2="187.7" y2="26.9" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="138.6" y1="98.7" x2="201.4" y2="30.5" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="152.3" y1="102.3" x2="215.2" y2="34.0" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="166.1" y1="105.9" x2="228.9" y2="37.6" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/><line x1="179.8" y1="109.4" x2="242.7" y2="41.2" stroke="#000000" stroke-width="0.9" stroke-opacity="0.12" stroke-linecap="round"/></svg>`;
}

function bothArt() {
  return apexArt();
}

function roofArt(type) {
  const src = safeSrc(type.image);
  if (src) return `<div class="media"><img src="${esc(src)}" alt=""></div>`;
  let drawing = apexArt();
  if (type.includeApex && type.includeMono) drawing = bothArt();
  else if (type.includeMono) drawing = monoArt();
  return `<div class="media pattern">${drawing}</div>`;
}

/* ---- Metres or feet -------------------------------------------------------
   Everything is priced per metre, so measurements are converted to metres at
   one boundary (metricQuote) before they reach calc.js. The stored numbers are
   whatever the person typed, in whichever unit was on at the time.          */
const FT_PER_M = 3.280839895;
const LENGTH_FIELDS = ["apexA", "apexB", "apexC", "apexD", "monoA", "monoB", "monoC",
  "jobLength", "jobWidth", "jobHeight"];
const WALL_LENGTH_FIELDS = ["height", "width", "gableHeight", "gableWidth", "doorH", "doorW"];

function useFeet() { return quote.units === "ft"; }
function unitShort() { return useFeet() ? "ft" : "m"; }
function unitWord() { return useFeet() ? "feet" : "metres"; }
/* Feet come back to metres rounded to 0.1 mm. Without this, a 3 m slope typed
   in metres, switched to feet and back lands on 3.000019 m, which rounds up to
   the next stock length and moves the price. */
function metresFromFeet(ft) { return Math.round((ft / FT_PER_M) * 10000) / 10000; }
function toMetres(n) { const v = Number(n); if (!Number.isFinite(v)) return v; return useFeet() ? metresFromFeet(v) : v; }
function fromMetres(n) { const v = Number(n); if (!Number.isFinite(v)) return v; return useFeet() ? v * FT_PER_M : v; }

/* a length that calc.js produced (always metres), shown in the chosen unit */
function fmtLen(metres) {
  const v = Number(metres);
  if (!Number.isFinite(v)) return "";
  return `${trimNum(useFeet() ? v * FT_PER_M : v)} ${unitShort()}`;
}

function unitLabel(text) {
  if (!useFeet()) return text;
  return String(text).replace(/\(metres\)/gi, "(feet)").replace(/\bmetres\b/g, "feet").replace(/\bmetre\b/g, "foot");
}

/* the quote as calc.js wants it: every length in metres */
function metricQuote() {
  if (!useFeet()) return quote;
  const copy = { ...quote };
  LENGTH_FIELDS.forEach((key) => {
    const raw = copy[key];
    if (raw === "" || raw == null) return;
    const v = Number(raw);
    if (Number.isFinite(v)) copy[key] = metresFromFeet(v);
  });
  const convertWall = (wall) => {
    const w = { ...wall };
    WALL_LENGTH_FIELDS.forEach((key) => {
      const v = Number(w[key]);
      if (w[key] !== "" && w[key] != null && Number.isFinite(v)) w[key] = metresFromFeet(v);
    });
    if (Array.isArray(w.windows)) {
      w.windows = w.windows.map((win) => {
        const o = { ...win };
        ["h", "w"].forEach((key) => {
          const v = Number(o[key]);
          if (o[key] !== "" && o[key] != null && Number.isFinite(v)) o[key] = metresFromFeet(v);
        });
        return o;
      });
    }
    return w;
  };
  if (Array.isArray(copy.walls)) copy.walls = copy.walls.map(convertWall);
  if (copy.wallDraft && typeof copy.wallDraft === "object") copy.wallDraft = convertWall(copy.wallDraft);
  return copy;
}

/* switching units rewrites what is on screen so the real size does not change */
function setUnits(next) {
  if (next !== "m" && next !== "ft") return;
  if (quote.units === next) return;
  const factor = next === "ft" ? FT_PER_M : 1 / FT_PER_M;
  const conv = (raw) => {
    if (raw === "" || raw == null) return raw;
    const v = Number(raw);
    if (!Number.isFinite(v)) return raw;
    return String(Math.round(v * factor * 10000) / 10000);
  };
  LENGTH_FIELDS.forEach((key) => { quote[key] = conv(quote[key]); });
  const convWall = (wall) => {
    if (!wall || typeof wall !== "object") return wall;
    WALL_LENGTH_FIELDS.forEach((key) => { wall[key] = conv(wall[key]); });
    if (Array.isArray(wall.windows)) wall.windows.forEach((win) => { win.h = conv(win.h); win.w = conv(win.w); });
    return wall;
  };
  if (Array.isArray(quote.walls)) quote.walls.forEach(convWall);
  convWall(quote.wallDraft);
  quote.units = next;
}

function unitNote() {
  return useFeet()
    ? `<p class="note unit-note">Measurements are in feet. The shop sells by the metre, so the quote itself stays in metres.</p>`
    : "";
}

function unitToggle() {
  return `<div class="unit-toggle" role="group" aria-label="Measurement units">
    <span>Measure in</span>
    <button type="button" class="unit-btn${useFeet() ? "" : " is-on"}" data-action="units" data-unit="m"
      aria-pressed="${useFeet() ? "false" : "true"}">Metres</button>
    <button type="button" class="unit-btn${useFeet() ? " is-on" : ""}" data-action="units" data-unit="ft"
      aria-pressed="${useFeet() ? "true" : "false"}">Feet</button>
  </div>`;
}

function renderMeasureInput(key) {
  const field = config.measureFields[key];
  const value = key === "apexD" && quote.apexSame ? quote.apexA : quote[key];
  const disabled = key === "apexD" && quote.apexSame;
  const bad = ui.showErrors && lastCalc.errors.some((error) => error.field === key);
  const letter = (String(field.label).match(/^([A-D])\b/) || [])[1] || "";
  const warm = key === "apexD";
  return `<label class="field${bad ? " has-error" : ""}${letter ? " has-letter" : ""}" for="m_${key}">
    <span>${letter ? `<i class="dim-letter${warm ? " is-warm" : ""}">${letter}</i>` : ""}${esc(unitLabel(field.label).replace(/^[A-D]\s*—\s*/, ""))}</span>
    <input id="m_${key}" data-action="measure" data-field="${key}" value="${esc(value)}" ${disabled ? "disabled" : ""} inputmode="decimal" autocomplete="off">
    <small>${esc(unitLabel(field.help))}</small>
    ${fieldMsg(key)}
  </label>`;
}

function renderTypeStep() {
  if (!config.roofTypes.length) return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  return `<div class="choices">${config.roofTypes.map((type) => `
    <button type="button" class="choice${quote.roofTypeId === type.id ? " is-selected" : ""}" data-action="select-roof" data-id="${esc(type.id)}">
      ${roofArt(type)}
      <strong>${esc(type.name)}</strong>
      <p>${esc(type.blurb || "")}</p>
    </button>`).join("")}</div>`;
}

function hexChannels(hex) {
  const raw = safeHex(hex).slice(1);
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(hex, toward, amount) {
  const a = hexChannels(hex);
  const b = hexChannels(toward);
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function hexLuma(hex) {
  const [r, g, b] = hexChannels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function roofPatternKind(profile) {
  const id = profile && profile.id;
  if (id === "profile-tile") return "tile";
  if (id === "profile-corr-clear" || id === "profile-corr-bronze") return "corr";
  if (id === "profile-diamond") return "diamond";
  if (id === "profile-poly") return "flat";
  if (id === "profile-box" || id === "profile-clear-box" || id === "profile-frp" || id === "profile-sandwich") return "box";
  return "plain";
}

function roofSurface(profile, colour) {
  if (!profile) return "plain";
  const profileName = String(profile.name || "");
  const colourName = String(colour && colour.name || "");
  if (/bronze/i.test(profileName) || /bronze/i.test(colourName)) return "bronze";
  const clearIds = ["profile-poly", "profile-corr-clear", "profile-frp", "profile-clear-box", "profile-diamond"];
  if (clearIds.includes(profile.id) || /\bclear\b/i.test(profileName) || /\bclear\b/i.test(colourName)) return "clear";
  return "metal";
}

function roofLook() {
  const profile = currentProfile();
  const finish = profile && (profile.finishes || []).find((item) => item.id === quote.finishId) || null;
  const colour = profile && (profile.colours || []).find((item) => item.id === quote.colourId) || null;
  return {
    profile,
    finish,
    colour,
    kind: roofPatternKind(profile),
    surface: roofSurface(profile, colour),
    hex: colour ? safeHex(colour.hex) : "#9bb0c4",
  };
}

function roofMaterialCaption(look) {
  const chosen = [look.profile && look.profile.name, look.finish && look.finish.name, look.colour && look.colour.name].filter(Boolean);
  const missing = [];
  if (!look.profile) missing.push("sheet");
  if (!look.finish) missing.push("thickness");
  if (!look.colour) missing.push("colour");
  if (!look.profile) return "Sheet, thickness, and colour are not chosen yet, so the plan stays a plain fill.";
  const list = missing.length === 1
    ? missing[0]
    : missing.length === 2
      ? `${missing[0]} and ${missing[1]}`
      : missing.length
        ? `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`
        : "";
  let text = `${chosen.join(", ")}.`;
  if (list) text += ` ${list.charAt(0).toUpperCase()}${list.slice(1)} not chosen yet.`;
  return text;
}

function roofShadeStops(look) {
  const hex = look.hex;
  if (look.surface === "clear") {
    return [
      [0, "#5d98ad", 0.62],
      [0.16, hex, 0.3],
      [0.4, "#ffffff", 0.95],
      [0.52, "#f4fbfe", 0.72],
      [0.7, hex, 0.34],
      [1, "#3d7f96", 0.66],
    ];
  }
  if (look.surface === "bronze") {
    const deep = mixHex(hex, "#1a1008", 0.42);
    const warm = mixHex(hex, "#f6e6d0", 0.48);
    return [
      [0, deep, 0.88],
      [0.18, hex, 0.7],
      [0.4, warm, 0.82],
      [0.5, "#fff6ea", 0.5],
      [0.68, hex, 0.74],
      [1, deep, 0.88],
    ];
  }
  const light = hexLuma(hex) > 0.62;
  const hi = light ? "#ffffff" : mixHex(hex, "#ffffff", 0.78);
  const lo = light ? mixHex(hex, "#1a2126", 0.45) : mixHex(hex, "#000000", 0.42);
  return [
    [0, lo, 1],
    [0.18, hex, 1],
    [0.42, hi, 1],
    [0.55, hex, 1],
    [0.82, lo, 1],
    [1, lo, 1],
  ];
}

function roofGradient(id, stops) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops.map(([offset, color, opacity]) =>
    `<stop offset="${Math.round(offset * 100)}%" stop-color="${color}" stop-opacity="${opacity}"/>`
  ).join("")}</linearGradient>`;
}

function roofDiamond(cx, cy, stroke) {
  const rx = 3.15;
  const ry = 2.9;
  const outline = `M${svgNum(cx)} ${svgNum(cy - ry)} L${svgNum(cx + rx)} ${svgNum(cy)} L${svgNum(cx)} ${svgNum(cy + ry)} L${svgNum(cx - rx)} ${svgNum(cy)} Z`;
  return `<path d="M${svgNum(cx)} ${svgNum(cy - ry)} L${svgNum(cx + rx)} ${svgNum(cy)} L${svgNum(cx)} ${svgNum(cy)} Z" fill="#ffffff" fill-opacity="0.78"/>
    <path d="M${svgNum(cx)} ${svgNum(cy)} L${svgNum(cx + rx)} ${svgNum(cy)} L${svgNum(cx)} ${svgNum(cy + ry)} L${svgNum(cx - rx)} ${svgNum(cy)} Z" fill="${stroke}" fill-opacity="0.22"/>
    <path d="${outline}" fill="none" stroke="${stroke}" stroke-width="0.6"/>`;
}

function roofSheetDefs(key, look) {
  if (!look.profile) return "";
  const hex = look.hex;
  const light = hexLuma(hex) > 0.62;
  const face = `sheet-face-${key}`;
  const hatch = `sheet-hatch-${key}`;
  const shade = `sheet-shade-${key}`;
  let width = 8;
  let height = 8;
  let extra = "";
  let inner = "";
  if (look.kind === "box") {
    width = 22;
    height = 10;
    if (look.surface === "clear") {
      inner = `<rect width="22" height="10" fill="${hex}" fill-opacity="0.38"/>
        <rect x="17" width="5" height="10" fill="#ffffff" fill-opacity="0.62"/>
        <rect x="17" width="1.15" height="10" fill="#ffffff"/>
        <rect x="21" width="1" height="10" fill="#3d7f96" fill-opacity="0.7"/>
        <rect x="5" width="0.8" height="10" fill="#ffffff" fill-opacity="0.55"/>`;
    } else if (look.surface === "bronze") {
      inner = `<rect width="22" height="10" fill="${hex}" fill-opacity="0.74"/>
        <rect x="17" width="5" height="10" fill="${mixHex(hex, "#f4e4cc", 0.5)}" fill-opacity="0.9"/>
        <rect x="17" width="1.15" height="10" fill="#fff4e4" fill-opacity="0.8"/>
        <rect x="21" width="1" height="10" fill="#2a1c10" fill-opacity="0.5"/>`;
    } else {
      const rib = light ? mixHex(hex, "#1a2126", 0.4) : mixHex(hex, "#ffffff", 0.55);
      const edge = light ? mixHex(hex, "#14181c", 0.7) : mixHex(hex, "#ffffff", 0.9);
      const shadow = mixHex(hex, "#000000", light ? 0.35 : 0.55);
      inner = `<rect width="22" height="10" fill="${hex}"/>
        <rect x="17" width="5" height="10" fill="${rib}"/>
        <rect x="17" width="1.2" height="10" fill="${edge}"/>
        <rect x="21" width="1" height="10" fill="${shadow}"/>`;
    }
  } else if (look.kind === "tile") {
    width = 24;
    height = 16;
    const band = light ? mixHex(hex, "#1a2126", 0.34) : mixHex(hex, "#ffffff", 0.42);
    const line = light ? mixHex(hex, "#14181c", 0.72) : mixHex(hex, "#ffffff", 0.92);
    const lip = light ? mixHex(hex, "#ffffff", 0.5) : mixHex(hex, "#000000", 0.35);
    inner = `<rect width="24" height="16" fill="${look.surface === "metal" ? hex : hexToRgba(hex, 0.78)}"/>
      <path d="M0 13.2 C4 13.2 4 7.2 8 7.2 C12 7.2 12 13.2 16 13.2 C20 13.2 20 7.2 24 7.2 L24 16 L0 16 Z" fill="${band}"/>
      <path d="M0 12.2 C4 12.2 4 6.2 8 6.2 C12 6.2 12 12.2 16 12.2 C20 12.2 20 6.2 24 6.2" fill="none" stroke="${line}" stroke-width="1.6"/>
      <path d="M0 2.4 H24" fill="none" stroke="${lip}" stroke-width="1.15"/>`;
  } else if (look.kind === "corr" || look.kind === "diamond") {
    width = look.kind === "diamond" ? 16 : 14;
    height = look.kind === "diamond" ? 16 : 8;
    extra = roofGradient(shade, roofShadeStops(look));
    inner = `<rect width="${width}" height="${height}" fill="url(#${shade})"/>`;
    if (look.kind === "corr") {
      const crest = look.surface === "bronze" ? "#fff1df" : "#ffffff";
      inner += `<line x1="5.6" y1="0" x2="5.6" y2="8" stroke="${crest}" stroke-width="0.9" stroke-opacity="0.85"/>`;
    } else {
      const stroke = look.surface === "bronze" ? "#4a3018" : "#1f6f8a";
      inner += [4, 12].map((cx) => roofDiamond(cx, 4, stroke)).join("");
      inner += [0, 8, 16].map((cx) => roofDiamond(cx, 12, stroke)).join("");
    }
  } else if (look.kind === "flat") {
    width = 46;
    height = 46;
    const sheen = `sheet-sheen-${key}`;
    const opacity = look.surface === "bronze" ? 0.72 : look.surface === "clear" ? 0.42 : 1;
    extra = `<linearGradient id="${sheen}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="46%" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.88"/>
      <stop offset="54%" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.16"/>
    </linearGradient>`;
    inner = `<rect width="46" height="46" fill="${hex}" fill-opacity="${opacity}"/>
      <rect width="46" height="46" fill="url(#${sheen})"/>`;
  } else {
    const opacity = look.surface === "metal" ? 1 : look.surface === "bronze" ? 0.72 : 0.45;
    inner = `<rect width="8" height="8" fill="${hex}" fill-opacity="${opacity}"/>`;
  }
  const hatchWash = look.surface === "metal" ? (light ? 0.16 : 0.22) : look.surface === "bronze" ? 0.4 : 0.36;
  const hatchStroke = look.surface === "metal"
    ? (light ? "rgba(20,24,28,0.55)" : "rgba(255,255,255,0.72)")
    : look.surface === "bronze"
      ? "rgba(255,236,214,0.72)"
      : "rgba(31,111,138,0.55)";
  return `<defs>
    ${extra}
    <pattern id="${face}" width="${width}" height="${height}" patternUnits="userSpaceOnUse">${inner}</pattern>
    <pattern id="${hatch}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
      <rect width="8" height="8" fill="${hex}" fill-opacity="${hatchWash}"/>
      <line x1="0" y1="0" x2="0" y2="8" stroke="${hatchStroke}" stroke-width="2.2"/>
    </pattern>
  </defs>`;
}

/* ---- Scale drawings -------------------------------------------------------
   Every diagram shares one canvas width and one set of drawing conventions, so
   text size, line weight and colour stay identical whichever one is on screen.
   The drawing is scaled to fit the content box and centred inside it.        */
const DIA = {
  W: 680, padL: 76, padR: 48, padT: 40, padB: 30, maxH: 232,
  rule: "#2f5080", soft: "#8aa0bd", ink: "#334155", paper: "#ffffff",
  grid: "#e8eef6", waste: "#c8822b", wasteBg: "#fdf4e6",
};

function diaScale(worldW, worldH, maxH) {
  const boxW = DIA.W - DIA.padL - DIA.padR;
  const h = Math.max(worldH, 0.01);
  return Math.min(boxW / Math.max(worldW, 0.01), (maxH || DIA.maxH) / h);
}

function diaFrame(drawW, drawH, body, label, key) {
  const id = key || "main";
  const H = DIA.padT + drawH + DIA.padB;
  return `<svg class="diagram" viewBox="0 0 ${svgNum(DIA.W)} ${svgNum(H)}" role="img" aria-label="${esc(label)}">
    <defs>
      <marker id="da-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.2" markerHeight="5.2" orient="auto-start-reverse">
        <path d="M0.5 1.6 L9.4 5 L0.5 8.4 Z" fill="${DIA.rule}"></path>
      </marker>
      <pattern id="waste-${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="${DIA.wasteBg}"></rect>
        <line x1="0" y1="0" x2="0" y2="7" stroke="${DIA.waste}" stroke-width="1.6" stroke-opacity=".55"></line>
      </pattern>
      <filter id="halo-${id}" x="-12%" y="-28%" width="124%" height="156%">
        <feFlood flood-color="#ffffff" flood-opacity="0.92"></feFlood>
        <feComposite in2="SourceAlpha" operator="in"></feComposite>
        <feGaussianBlur stdDeviation="1.6"></feGaussianBlur>
        <feComponentTransfer><feFuncA type="linear" slope="6"></feFuncA></feComponentTransfer>
        <feComposite in="SourceGraphic"></feComposite>
      </filter>
    </defs>
    ${body}
  </svg>`;
}

function diaX0(drawW) {
  const boxW = DIA.W - DIA.padL - DIA.padR;
  return DIA.padL + Math.max(0, (boxW - drawW) / 2);
}

function diaText(x, y, text, anchor, size, colour, weight) {
  return `<text x="${svgNum(x)}" y="${svgNum(y)}" text-anchor="${anchor || "start"}" font-size="${size || 12}"
    font-family="Outfit, Lato, system-ui, sans-serif" font-weight="${weight || 500}" fill="${colour || DIA.ink}">${esc(String(text))}</text>`;
}

function diaChip(x, y, text, anchor, key, size) {
  const id = key || "main";
  return `<g filter="url(#halo-${id})">${diaText(x, y, text, anchor, size || 12.5, DIA.ink, 600)}</g>`;
}

/* horizontal dimension with witness ticks */
function dimAcross(x1, x2, y, label, key) {
  const id = key || "main";
  const mid = (x1 + x2) / 2;
  return `<g>
    <line x1="${svgNum(x1)}" y1="${svgNum(y - 7)}" x2="${svgNum(x1)}" y2="${svgNum(y + 5)}" stroke="${DIA.soft}" stroke-width="1"/>
    <line x1="${svgNum(x2)}" y1="${svgNum(y - 7)}" x2="${svgNum(x2)}" y2="${svgNum(y + 5)}" stroke="${DIA.soft}" stroke-width="1"/>
    <line x1="${svgNum(x1)}" y1="${svgNum(y)}" x2="${svgNum(x2)}" y2="${svgNum(y)}" stroke="${DIA.rule}" stroke-width="1.1"
      marker-start="url(#da-${id})" marker-end="url(#da-${id})"/>
    ${diaChip(mid, y + 4.5, label, "middle", id)}
  </g>`;
}

/* vertical dimension, label rotated to sit beside the line */
function dimDown(x, y1, y2, label, key) {
  const id = key || "main";
  const mid = (y1 + y2) / 2;
  return `<g>
    <line x1="${svgNum(x - 5)}" y1="${svgNum(y1)}" x2="${svgNum(x + 7)}" y2="${svgNum(y1)}" stroke="${DIA.soft}" stroke-width="1"/>
    <line x1="${svgNum(x - 5)}" y1="${svgNum(y2)}" x2="${svgNum(x + 7)}" y2="${svgNum(y2)}" stroke="${DIA.soft}" stroke-width="1"/>
    <line x1="${svgNum(x)}" y1="${svgNum(y1)}" x2="${svgNum(x)}" y2="${svgNum(y2)}" stroke="${DIA.rule}" stroke-width="1.1"
      marker-start="url(#da-${id})" marker-end="url(#da-${id})"/>
    <g transform="translate(${svgNum(x - 7)} ${svgNum(mid)}) rotate(-90)">${diaChip(0, 0, label, "middle", id)}</g>
  </g>`;
}

function diaTitle(x, y, text, key) {
  return diaText(x, y, text, "start", 12, DIA.soft, 600);
}

function diaLegend(x, y, swatch, text, hatch, key) {
  const id = key || "main";
  const fill = hatch ? `url(#waste-${id})` : swatch;
  return `<g><rect x="${svgNum(x)}" y="${svgNum(y - 8)}" width="13" height="10" rx="1.5" fill="${fill}"
    fill-opacity="${hatch ? 1 : 0.44}" stroke="${hatch ? DIA.waste : DIA.soft}" stroke-width=".9" stroke-opacity=".8"/>
    ${diaText(x + 18, y, text, "start", 11.5, DIA.soft, 500)}</g>`;
}

/* ---- Realistic roof preview ----------------------------------------------
   Draws the building in 3D with the chosen sheet pressed into the roof: the
   real profile shape, the real colour, and the real number of covers along the
   eaves. Shading is Blinn-Phong per rib facet, so curves read as metal or
   polycarbonate rather than as flat vector fill.                            */
const PV = { KX: 0.52, KY: 0.40, W: 680, H: 330 };

function pvProj(p) { return [p[0] + PV.KX * p[1], -(p[2] + PV.KY * p[1])]; }
function pvNorm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const PV_LIGHT = pvNorm([-0.42, -0.34, 0.84]);
const PV_VIEW = pvNorm([PV.KX, -1, PV.KY]);
const PV_HALF = pvNorm([PV_LIGHT[0] + PV_VIEW[0], PV_LIGHT[1] + PV_VIEW[1], PV_LIGHT[2] + PV_VIEW[2]]);

function pvShade(base, N, mat) {
  const nl = N[0] * PV_LIGHT[0] + N[1] * PV_LIGHT[1] + N[2] * PV_LIGHT[2];
  const nh = N[0] * PV_HALF[0] + N[1] * PV_HALF[1] + N[2] * PV_HALF[2];
  const nv = Math.abs(N[0] * PV_VIEW[0] + N[1] * PV_VIEW[1] + N[2] * PV_VIEW[2]);
  const dif = Math.max(0, nl);
  const spec = Math.pow(Math.max(0, nh), mat.shin) * mat.spec;
  const trans = mat.trans * Math.pow(Math.max(0, -nl), 0.7);
  const i = mat.amb + mat.dif * dif + trans;
  let col = base;
  if (i < 1) col = mixHex(mat.cool, col, Math.min(1, 0.3 + 0.7 * i));
  else col = mixHex(col, "#ffffff", Math.min(0.5, (i - 1) * 0.8));
  if (spec > 0) col = mixHex(col, "#ffffff", Math.min(0.9, spec));
  if (mat.rim) col = mixHex(col, "#ffffff", mat.rim * Math.pow(1 - nv, 2.2));
  return col;
}

function pvMaterial(surface) {
  if (surface === "clear") return { amb: 0.52, dif: 0.44, spec: 0.74, shin: 44, trans: 0.40, rim: 0.26, cool: "#2d4c5e", op: 0.88 };
  if (surface === "bronze") return { amb: 0.42, dif: 0.58, spec: 0.76, shin: 40, trans: 0.30, rim: 0.22, cool: "#3a2208", op: 0.95 };
  return { amb: 0.33, dif: 0.70, spec: 0.40, shin: 30, trans: 0, rim: 0, cool: "#0a1016", op: 1 };
}

/* profile height (metres) across the sheet, and its slope dh/dx */
function pvProfile(kind, cover) {
  const c = cover > 0 ? cover : 1;
  if (kind === "corr" || kind === "diamond") {
    const pitch = c / 10, amp = 0.018;
    return { h: (x) => amp / 2 - amp / 2 * Math.cos(2 * Math.PI * x / pitch),
             d: (x) => Math.PI * amp / pitch * Math.sin(2 * Math.PI * x / pitch), step: pitch / 14 };
  }
  if (kind === "tile") {
    const pitch = c / 6, amp = 0.022;
    return { h: (x) => { const u = (x % pitch) / pitch; if (u < 0.6) return 0; const t = (u - 0.6) / 0.4; return amp * Math.pow(Math.sin(Math.PI * t), 1.25); },
             d: (x) => { const u = (x % pitch) / pitch; if (u < 0.6) return 0; const t = (u - 0.6) / 0.4;
               return amp * 1.25 * Math.pow(Math.sin(Math.PI * t), 0.25) * Math.cos(Math.PI * t) * Math.PI / (0.4 * pitch); }, step: pitch / 16 };
  }
  if (kind === "flat") {
    const amp = 0.03;
    return { h: (x) => { const u = (x % c) / c; return (u < 0.06 || u > 0.94) ? amp : 0; },
             d: () => 0, step: c / 40 };
  }
  // box / sandwich: wide flat pans, narrow upstand ribs
  const pitch = c / 5, rib = pitch * 0.22, flank = pitch * 0.09, amp = kind === "plain" ? 0.012 : 0.024;
  return {
    h: (x) => { const u = x % pitch; if (u < pitch - rib - flank) return 0;
      if (u < pitch - rib) return amp * (u - (pitch - rib - flank)) / flank;
      if (u < pitch - flank) return amp;
      return amp * (1 - (u - (pitch - flank)) / flank); },
    d: (x) => { const u = x % pitch; if (u < pitch - rib - flank) return 0;
      if (u < pitch - rib) return amp / flank;
      if (u < pitch - flank) return 0;
      return -amp / flank; },
    step: pitch / 18,
  };
}

function renderRoofPreview(mode) {
  const apex = mode === "apex";
  const mq = metricQuote();
  const A = val(apex ? mq.apexA : mq.monoA);     // along the eaves
  const B = val(apex ? mq.apexB : mq.monoB);     // span across
  const C = val(apex ? mq.apexC : mq.monoC);     // eave to ridge
  if (!(A > 0) || !(B > 0)) return "";
  const look = roofLook();
  const base = look.hex || "#9bb0c4";
  const mat = pvMaterial(look.surface);
  const cover = look.profile ? Number(look.profile.coverWidthM) || 0 : 0;
  const sheets = cover > 0 ? sheetCount(A, cover) : 0;
  const prof = pvProfile(look.kind, cover || 1);
  const run = apex ? B / 2 : B;                         // horizontal run of one slope
  const rise = C > run ? Math.sqrt(Math.max(C * C - run * run, 0)) : run * 0.28;
  const wall = Math.max(Math.min(A, B) * 0.30, 0.9);
  const over = Math.min(0.25, Math.min(A, B) * 0.05);   // eaves overhang
  const parts = [];
  const pts = [];
  const add = (p) => { pts.push(pvProj(p)); return p; };

  // ---- walls
  const wallMat = { amb: 0.46, dif: 0.56, spec: 0.08, shin: 8, trans: 0, rim: 0, cool: "#1b222b", op: 1 };
  function quad(p, N, fill, op, zFix) {
    p.forEach(add);
    const d = p.map((q) => { const s = pvProj(q); return `${s[0]},${s[1]}`; });
    const z = zFix != null ? zFix : p.reduce((a, q) => a + PV.KX * q[0] - q[1] + PV.KY * q[2], 0) / p.length;
    return { d, fill, op: op == null ? 1 : op, z };
  }
  const faces = [];
  const wallCol = "#e8ebee";
  faces.push(quad([[0, 0, 0], [A, 0, 0], [A, 0, wall], [0, 0, wall]], [0, -1, 0], pvShade(wallCol, [0, -1, 0], wallMat), 1, -1e6));
  faces.push(quad([[A, 0, 0], [A, B, 0], [A, B, wall], [A, 0, wall]], [1, 0, 0], pvShade(wallCol, [1, 0, 0], wallMat), 1, -1.01e6));
  // gable above the wall
  if (apex) {
    const g = [[A, 0, wall], [A, B, wall], [A, B / 2, wall + rise]];
    faces.push(quad(g, [1, 0, 0], pvShade(wallCol, [1, 0, 0], wallMat), 1, -1.005e6));
  } else {
    const g = [[A, 0, wall], [A, B, wall + rise], [A, B, wall], [A, 0, wall]];
    faces.push(quad(g, [1, 0, 0], pvShade(wallCol, [1, 0, 0], wallMat), 1, -1.005e6));
  }
  // door
  const dw = Math.min(A * 0.18, 1.1), dh = Math.min(wall * 0.72, 2.1);
  faces.push(quad([[A / 2 - dw / 2, -0.01, 0], [A / 2 + dw / 2, -0.01, 0], [A / 2 + dw / 2, -0.01, dh], [A / 2 - dw / 2, -0.01, dh]],
    [0, -1, 0], "#55606b", 1, -0.99e6));

  // ---- roof planes, pressed with the chosen profile
  function slope(y0, z0, y1, z1, flip, zBias) {
    const dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dy, dz) || 1;
    const v = [0, dy / len, dz / len];                      // up the slope
    const n = pvNorm([0, -v[2], v[1]]);                     // plane normal
    const step = Math.max(prof.step, cover / 60 || 0.02);
    const x1 = A;
    for (let x = 0; x < x1 - 1e-9; x += step) {
      const xb = Math.min(x + step, x1);
      const xm = (x + xb) / 2;
      const t = prof.d(Math.max(0, xm));
      const N = pvNorm([flip ? t : -t, -v[2] * (flip ? -1 : 1), v[1]]);
      const Nn = N[2] < 0 ? [-N[0], -N[1], -N[2]] : N;
      const col = pvShade(base, Nn, mat);
      const ha = prof.h(Math.max(0, x)), hb = prof.h(Math.max(0, xb));
      const P = (xx, hh, s) => [xx, y0 + dy * s + n[1] * hh, z0 + dz * s + n[2] * hh];
      const q = quad([P(x, ha, 0), P(xb, hb, 0), P(xb, hb, 1), P(x, ha, 1)], Nn, col, mat.op);
      q.z += (zBias || 0);
      faces.push(q);
    }
    // sheet seams along the slope
    if (sheets > 0 && cover > 0) {
      for (let k = 1; k < sheets; k += 1) {
        const x = k * cover;
        if (x >= A) break;
        const hh = prof.h(x);
        const a = pvProj([x, y0 + n[1] * hh, z0 + n[2] * hh]);
        const b = pvProj([x, y0 + dy + n[1] * hh, z0 + dz + n[2] * hh]);
        faces.push({ line: [a, b], z: (zBias || 0) + 1000 });
      }
    }
    // tile courses run across the slope
    if (look.kind === "tile") {
      const courses = Math.max(2, Math.round(len / 0.35));
      for (let k = 1; k < courses; k += 1) {
        const s = k / courses;
        const a = pvProj([0, y0 + dy * s, z0 + dz * s]);
        const b = pvProj([A, y0 + dy * s, z0 + dz * s]);
        faces.push({ line: [a, b], z: (zBias || 0) + 900, soft: true });
        const a2 = pvProj([0, y0 + dy * s + 0.012, z0 + dz * s + 0.012]);
        const b2 = pvProj([A, y0 + dy * s + 0.012, z0 + dz * s + 0.012]);
        faces.push({ line: [a2, b2], z: (zBias || 0) + 890, lip: true });
      }
    }
  }
  if (apex) {
    slope(B + over, wall - over * (rise / Math.max(run, 0.01)), B / 2, wall + rise, true, -4e5);
    slope(-over, wall - over * (rise / Math.max(run, 0.01)), B / 2, wall + rise, false, 0);
  } else {
    slope(-over, wall - over * (rise / Math.max(run, 0.01)), B + over, wall + rise + over * (rise / Math.max(run, 0.01)), false);
  }

  // eaves fascia, so the roof has real thickness at the edge
  const fth = Math.max(0.05, Math.min(A, B) * 0.016);
  const tanS = rise / Math.max(run, 0.01);
  const eaveZ = wall - over * tanS;
  const fasciaCol = mixHex(base, "#0a1016", 0.45);
  faces.push(quad([[0, -over, eaveZ], [A, -over, eaveZ], [A, -over, eaveZ - fth], [0, -over, eaveZ - fth]],
    [0, -1, 0], pvShade(fasciaCol, [0, -1, 0], { amb: 0.4, dif: 0.5, spec: 0.1, shin: 8, trans: 0, rim: 0, cool: "#05080b" }), 1, 9.8e5));
  if (!apex) {
    const topZ = wall + rise + over * tanS;
    faces.push(quad([[A, -over, eaveZ], [A, B + over, topZ], [A, B + over, topZ - fth], [A, -over, eaveZ - fth]],
      [1, 0, 0], pvShade(fasciaCol, [1, 0, 0], { amb: 0.44, dif: 0.5, spec: 0.12, shin: 8, trans: 0, rim: 0, cool: "#05080b" }), 1, 9.7e5));
  } else {
    faces.push(quad([[A, B + over, eaveZ], [A, -over, eaveZ], [A, -over, eaveZ - fth], [A, B + over, eaveZ - fth]],
      [1, 0, 0], pvShade(fasciaCol, [1, 0, 0], { amb: 0.44, dif: 0.5, spec: 0.12, shin: 8, trans: 0, rim: 0, cool: "#05080b" }), 1, 9.7e5));
    faces.push(quad([[0, B + over, eaveZ], [A, B + over, eaveZ], [A, B + over, eaveZ - fth], [0, B + over, eaveZ - fth]],
      [0, 1, 0], pvShade(fasciaCol, [0, 1, 0], { amb: 0.4, dif: 0.5, spec: 0.1, shin: 8, trans: 0, rim: 0, cool: "#05080b" }), 1, -1.02e6));
  }

  if (apex) {
    const capH = Math.max(0.05, Math.min(A, B) * 0.012);
    const capW = Math.min(0.22, B * 0.03);
    const capCol = mixHex(base, "#ffffff", look.surface === "clear" ? 0.1 : 0.22);
    faces.push(quad([[0, B / 2 - capW, wall + rise + capH], [A, B / 2 - capW, wall + rise + capH],
                     [A, B / 2 + capW, wall + rise + capH], [0, B / 2 + capW, wall + rise + capH]],
                    [0, 0, 1], pvShade(capCol, [0, 0, 1], mat), 1, 9.5e5));
  }

  // ---- fit to the canvas
  pts.push(pvProj([0, 0, 0]), pvProj([A, B, wall + rise]));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1b = Math.max(...xs), y0b = Math.min(...ys), y1b = Math.max(...ys);
  const pad = 26;
  const s = Math.min((PV.W - 2 * pad) / Math.max(x1b - x0, 0.01), (PV.H - 2 * pad - 14) / Math.max(y1b - y0b, 0.01));
  const ox = (PV.W - (x1b - x0) * s) / 2 - x0 * s;
  const oy = (PV.H - (y1b - y0b) * s) / 2 - y0b * s - 6;
  const F = (p) => [p[0] * s + ox, p[1] * s + oy];

  faces.sort((a, b) => (a.z || 0) - (b.z || 0));
  const body = [];
  const cx = ((x0 + x1b) / 2) * s + ox, gy = y1b * s + oy;
  body.push(`<ellipse cx="${svgNum(cx)}" cy="${svgNum(gy + 6)}" rx="${svgNum((x1b - x0) * s * 0.42)}" ry="6"
    fill="#0b1118" fill-opacity=".16" filter="url(#pv-blur)"/>`);
  for (const f of faces) {
    if (f.skip) continue;
    if (f.line) {
      const a = F(f.line[0]), b = F(f.line[1]);
      body.push(`<line x1="${svgNum(a[0])}" y1="${svgNum(a[1])}" x2="${svgNum(b[0])}" y2="${svgNum(b[1])}"
        stroke="${f.lip ? "#ffffff" : "#0b1118"}" stroke-opacity="${f.lip ? 0.3 : (f.soft ? 0.34 : 0.26)}" stroke-width="${f.soft || f.lip ? 0.9 : 0.9}"/>`);
      continue;
    }
    const d = f.d.map((q) => { const p = q.split(","); return F([parseFloat(p[0]), parseFloat(p[1])]); })
      .map((p) => `${svgNum(p[0])},${svgNum(p[1])}`).join(" ");
    body.push(`<polygon points="${d}" fill="${f.fill}"${f.op < 1 ? ` fill-opacity="${f.op}"` : ""} stroke="${f.fill}" stroke-width=".4"/>`);
  }
  // ---- labelled dimensions on the actual edges, so A/B/C/D are unmistakable.
  // The offset direction comes from the real outward normal in 3D, not from a
  // screen-space guess, or a label ends up lying across the roof.
  const dims = [];
  const tanS2 = rise / Math.max(run, 0.01);
  const eaveZ2 = wall - over * tanS2;
  const active = ui.focusField || "";
  function dim(p0, p1, letter, field, outward, warm, offScale) {
    const a = F(pvProj(p0)), b = F(pvProj(p1));
    const mid3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    const step = Math.max(A, B) * 0.12;
    const m0 = F(pvProj(mid3));
    const m1 = F(pvProj([mid3[0] + outward[0] * step, mid3[1] + outward[1] * step, mid3[2] + outward[2] * step]));
    let nx = m1[0] - m0[0], ny = m1[1] - m0[1];
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const off = 22 * (offScale || 1);
    const A2 = [a[0] + nx * off, a[1] + ny * off];
    const B2 = [b[0] + nx * off, b[1] + ny * off];
    const on = active === field;
    const col = on ? "#1d4ed8" : (warm ? "#c9682c" : "#4a5a73");
    const w = on ? 2.3 : 1.5;
    const lx = (A2[0] + B2[0]) / 2 + nx * 15;
    const ly = (A2[1] + B2[1]) / 2 + ny * 15 + 5;
    dims.push(`<line x1="${svgNum(a[0] + nx * 5)}" y1="${svgNum(a[1] + ny * 5)}" x2="${svgNum(A2[0])}" y2="${svgNum(A2[1])}" stroke="${col}" stroke-width=".8" stroke-opacity=".5"/>
      <line x1="${svgNum(b[0] + nx * 5)}" y1="${svgNum(b[1] + ny * 5)}" x2="${svgNum(B2[0])}" y2="${svgNum(B2[1])}" stroke="${col}" stroke-width=".8" stroke-opacity=".5"/>
      <line x1="${svgNum(A2[0])}" y1="${svgNum(A2[1])}" x2="${svgNum(B2[0])}" y2="${svgNum(B2[1])}" stroke="${col}" stroke-width="${w}"
        marker-start="url(#pv-ar)" marker-end="url(#pv-ar)"/>
      <circle cx="${svgNum(lx)}" cy="${svgNum(ly - 5)}" r="${on ? 12 : 10.5}" fill="#ffffff" stroke="${col}" stroke-width="${on ? 1.6 : 1}"/>
      <text x="${svgNum(lx)}" y="${svgNum(ly)}" text-anchor="middle" font-size="${on ? 15 : 13}" font-weight="700"
        font-family="Outfit, Lato, system-ui, sans-serif" fill="${col}">${letter}</text>`);
  }
  const fA = apex ? "apexA" : "monoA";
  const fB = apex ? "apexB" : "monoB";
  const fC = apex ? "apexC" : "monoC";
  // A: along the front eaves, measured at the base so it clears the wall
  dim([0, -over, 0], [A, -over, 0], "A", fA, [0, -1, 0]);
  // B: the span, down the right-hand side at the base
  dim([A, -over, 0], [A, B + over, 0], "B", fB, [1, 0, 0]);
  // C: up the visible slope, on the left-hand gable edge
  if (apex) {
    dim([0, -over, eaveZ2], [0, B / 2, wall + rise], "C", fC, [-1, 0, 0.35]);
    // D only earns its place when the two sides differ; otherwise it repeats A
    if (!quote.apexSame) {
      dim([0, B + over, eaveZ2], [A, B + over, eaveZ2], "D", "apexD", [0, 0.1, 1], true, 3.2);
    }
  } else {
    dim([0, -over, eaveZ2], [0, B + over, wall + rise + over * tanS2], "C", fC, [-1, 0, 0.35]);
  }

  const bits = [];
  if (look.profile) bits.push(look.profile.name);
  if (look.colour) bits.push(look.colour.name);
  if (sheets > 0) bits.push(`${sheets} sheet${sheets === 1 ? "" : "s"}`);
  const caption = bits.join(" · ");
  return `<div class="roof-preview">
    <svg class="diagram" viewBox="0 0 ${PV.W} ${PV.H}" role="img" aria-label="${esc(caption || "Roof preview")}">
      <defs><filter id="pv-blur" x="-30%" y="-80%" width="160%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
        <marker id="pv-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0.5 1.6 L9.4 5 L0.5 8.4 Z" fill="context-stroke"/></marker></defs>
      ${body.join("")}
      ${dims.join("")}
    </svg>
    ${caption ? `<p class="preview-caption">${esc(caption)}</p>` : ""}
  </div>`;
}

function renderRoofDiagram(mode) {
  const apex = mode === "apex";
  const mq = metricQuote();
  const length = val(apex ? mq.apexA : mq.monoA);
  const span = val(apex ? mq.apexB : mq.monoB);
  const slope = val(apex ? mq.apexC : mq.monoC);
  if (!(length > 0) || !(span > 0)) {
    return `<div class="scale-diagram"><h3>To scale</h3><p class="muted">Enter the eaves length and the span to draw this roof.</p></div>`;
  }
  const look = roofLook();
  const profile = look.profile;
  const cover = profile ? Number(profile.coverWidthM) || 0 : 0;
  const sheets = cover > 0 ? sheetCount(length, cover) : 0;
  const key = apex ? "apex" : "mono";
  const covered = sheets > 0 ? sheets * cover : length;
  const worldW = Math.max(length, covered);
  const longer = covered > length + 0.01;
  const scale = diaScale(worldW, span, 206);
  const drawW = length * scale;
  const fullW = worldW * scale;
  const drawH = span * scale;
  const x0 = diaX0(fullW);
  const y0 = DIA.padT;
  const base = look.hex || "#9bb0c4";
  const parts = [];

  parts.push(diaTitle(DIA.padL - 2, 18, apex ? "Plan of the apex roof" : "Plan of the single slope", key));

  // sheets laid along the eaves
  if (sheets > 0) {
    for (let col = 0; col < sheets; col += 1) {
      const x = x0 + col * cover * scale;
      const w = cover * scale;
      const tint = col % 2 ? 0.30 : 0.44;
      parts.push(`<rect x="${svgNum(x)}" y="${svgNum(y0)}" width="${svgNum(w)}" height="${svgNum(drawH)}"
        fill="${base}" fill-opacity="${tint}"/>`);
      if (x + w > x0 + drawW + 0.4) {
        const hx = Math.max(x, x0 + drawW);
        parts.push(`<rect x="${svgNum(hx)}" y="${svgNum(y0)}" width="${svgNum(x + w - hx)}" height="${svgNum(drawH)}"
          fill="url(#waste-${key})"/>`);
      }
      if (col > 0) {
        parts.push(`<line x1="${svgNum(x)}" y1="${svgNum(y0)}" x2="${svgNum(x)}" y2="${svgNum(y0 + drawH)}"
          stroke="#ffffff" stroke-width="1.6" stroke-opacity=".85"/>
          <line x1="${svgNum(x)}" y1="${svgNum(y0)}" x2="${svgNum(x)}" y2="${svgNum(y0 + drawH)}"
          stroke="${DIA.soft}" stroke-width=".7" stroke-opacity=".7"/>`);
      }
      if (w > 18) {
        parts.push(diaText(x + w / 2, y0 - 7, String(col + 1), "middle", 10, DIA.soft, 600));
      }
    }
  } else {
    parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}"
      fill="${base}" fill-opacity="0.34"/>`);
  }

  // the roof itself
  parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}"
    fill="none" stroke="${DIA.rule}" stroke-width="1.8"/>`);

  if (apex) {
    const ridge = y0 + drawH / 2;
    parts.push(`<line x1="${svgNum(x0)}" y1="${svgNum(ridge)}" x2="${svgNum(x0 + drawW)}" y2="${svgNum(ridge)}"
      stroke="${DIA.rule}" stroke-width="1.3" stroke-dasharray="7 5"/>`);
    parts.push(diaChip(x0 + 7, ridge - 6, "Ridge", "start", key, 11.5));
  }

  // eave-to-ridge run, drawn as an arrow up one slope
  if (slope > 0) {
    const ax = x0 + drawW / 2;
    const top = apex ? y0 + drawH / 2 : y0;
    const bot = y0 + drawH;
    parts.push(`<line x1="${svgNum(ax)}" y1="${svgNum(bot - 5)}" x2="${svgNum(ax)}" y2="${svgNum(top + 5)}"
      stroke="${DIA.rule}" stroke-width="1.1" stroke-opacity=".75" marker-end="url(#da-${key})"/>`);
    parts.push(diaChip(ax, (top + bot) / 2 + 4, `${fmtLen(slope)} up the slope`, "middle", key, 11.5));
  }

  parts.push(dimAcross(x0, x0 + drawW, y0 + drawH + 26, `${fmtLen(length)} eaves`, key));
  if (longer) parts.push(dimAcross(x0, x0 + fullW, y0 + drawH + 52, `${fmtLen(covered)} of cover`, key));
  parts.push(dimDown(x0 - 16, y0, y0 + drawH, `${fmtLen(span)} span`, key));

  const legendY = DIA.padT + drawH + (longer ? 74 : 50);
  if (sheets > 0) {
    parts.push(diaLegend(x0, legendY, base, `${sheets} sheet${sheets === 1 ? "" : "s"} at ${fmtLen(cover)} cover`, false, key));
    if (longer) parts.push(diaLegend(x0 + 196, legendY, "", `${fmtLen(covered - length)} past the eaves`, true, key));
  }

  let caption = `Plan of the ${apex ? "apex" : "single slope"}: ${roofMaterialCaption(look)} The filled area is ${fmtLen(length)} along the eaves by ${fmtLen(span)} across.`;
  if (sheets > 0) caption += ` ${sheets} sheet${sheets === 1 ? "" : "s"} cover the eaves at ${fmtLen(cover)} cover. Hatched sheet past the eaves is still a whole cover width.`;
  else caption += " Choose a sheet to see the covers along the eaves.";
  if (slope > 0) caption += ` Each sheet follows the ${fmtLen(slope)} eave-to-ridge length.`;
  const bodyH = (legendY - DIA.padT) + (sheets > 0 ? 14 : -18);
  const svg = diaFrame(fullW, bodyH, parts.join(""), caption, key);
  const preview = renderRoofPreview(mode);
  return `${preview}<div class="scale-diagram"><h3>Plan, to scale</h3>${svg}<p class="scale-caption">${esc(caption)}</p></div>`;
}
/* Work out the sheet length (C) from the span and the height difference.
   Pythagoras: the slope is the hypotenuse over the span and the rise. */
function slopeHelper(mode) {
  const apex = mode === "apex";
  const spanField = apex ? "apexB" : "monoB";
  const slopeField = apex ? "apexC" : "monoC";
  const open = ui.slopeHelp === mode;
  const span = val(metricQuote()[spanField]);
  const run = apex ? span / 2 : span;
  const riseRaw = (quote.slopeRise || {})[mode] || "";
  const rise = useFeet() ? metresFromFeet(Number(riseRaw)) : Number(riseRaw);
  let answer = "";
  if (open && run > 0 && Number.isFinite(rise) && rise > 0) {
    const c = Math.sqrt(run * run + rise * rise);
    answer = `<p class="ok">That makes <strong>${fmtLen(c)}</strong> from eave to ridge.
      <button type="button" class="text-btn" data-action="use-slope" data-mode="${esc(mode)}" data-value="${svgNum(fromMetres(c))}">Use this for C</button></p>`;
  } else if (open && !(run > 0)) {
    answer = `<p class="muted">Fill in the span (B) first.</p>`;
  }
  return `<div class="slope-help">
    <button type="button" class="text-btn" data-action="slope-help" data-mode="${esc(mode)}">
      ${open ? "Hide" : "Not sure what C is? Work it out"}
    </button>
    ${open ? `<div class="slope-help-body">
      <p class="muted">Measure the span (B) flat on the ground, then how much higher the top edge sits than the bottom.</p>
      <label class="field" for="rise_${esc(mode)}"><span>Height difference, bottom edge to top (${unitShort()})</span>
        <input id="rise_${esc(mode)}" data-action="slope-rise" data-mode="${esc(mode)}" value="${esc(riseRaw)}" inputmode="decimal" autocomplete="off"></label>
      ${answer}
    </div>` : ""}
  </div>`;
}

function renderMeasureStep() {
  const type = currentType();
  if (!type) return `<p class="muted">${esc(config.copy.needType)}</p>`;
  let html = unitToggle() + unitNote() + `<p class="note">${esc(unitLabel(config.copy.measurementNote))} Stock lengths: ${esc((config.rules.stockLengthsM || []).map((len) => trimNum(useFeet() ? len * FT_PER_M : len)).join(", "))} ${unitShort()}.</p>`;
  if (type.includeApex) {
    html += `<h3>Apex Roof Measurements</h3><div class="step-grid">
      ${renderMeasureInput("apexA")}
      ${renderMeasureInput("apexB")}
      ${renderMeasureInput("apexC")}
      <div>${renderMeasureInput("apexD")}
        <label class="check" for="apex_same"><input id="apex_same" type="checkbox" data-action="apex-same" ${quote.apexSame ? "checked" : ""}><span>${esc(config.copy.sameSide)}</span></label>
      </div>
    </div>${slopeHelper("apex")}${renderRoofDiagram("apex")}`;
  }
  if (type.includeMono) {
    html += `<h3>Single Slope Measurements</h3><div class="step-grid">
      ${renderMeasureInput("monoA")}
      ${renderMeasureInput("monoB")}
      ${renderMeasureInput("monoC")}
    </div>${slopeHelper("mono")}${renderRoofDiagram("mono")}`;
  }
  if (lastCalc.slopes.length) {
    html += `<ul class="preview">${lastCalc.slopes.map((slope) => {
      const sheets = slope.sheets == null ? "Choose a profile to count sheets" : `${slope.sheets} sheet${slope.sheets === 1 ? "" : "s"}`;
      const same = Math.abs(slope.ordered - slope.slope) < 0.001;
      const round = slope.blocked
        ? slope.blockReason
        : slope.cutToSize
        ? `${fmtLen(slope.slope)} cut to size`
        : slope.special
          ? `${fmtLen(slope.slope)} is above your longest stock size`
          : same
            ? `${fmtLen(slope.slope)} matches a stock length`
            : `${fmtLen(slope.slope)} rounds up to ${fmtLen(slope.ordered)}`;
      return `<li><strong>${esc(slope.label)}</strong> — ${esc(round)}. ${esc(sheets)}.</li>`;
    }).join("")}</ul>`;
  }
  if (lastCalc.planArea > 0) html += `<p class="muted">Plan area for reference: ${trimNum(lastCalc.planArea)} m². Sheet area: ${trimNum(lastCalc.sheetArea)} m².</p>`;
  return html;
}

// Sheet picture: a drawing by default, or the shop's own product photo when config.js says imageMode: "photo".
function profileImage(profile) {
  if (originalConfig && originalConfig.imageMode === "photo") {
    const fresh = (originalConfig.profiles || []).find((item) => item.id === profile.id);
    if (fresh && fresh.photo) return fresh.photo;
  }
  return profile.image;
}

function profileGroup(profile) {
  const id = profile && profile.id;
  if (id === "profile-box" || id === "profile-tile" || id === "profile-sandwich") return "Metal roofing";
  return "Clear roofing";
}

function profileFromPrice(profile) {
  const prices = (profile.finishes || []).map((finish) => Number(finish.pricePerMetre) || 0).filter((price) => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function renderProfileStep() {
  if (!config.profiles.length) return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  const groups = ["Metal roofing", "Clear roofing"];
  return `<p class="note">Metal sheets first, then clear sheets. Tile effect 0.5mm Non Drip is £18 a metre, on the next step.</p>` + groups.map((name) => {
    const profiles = config.profiles.filter((profile) => profileGroup(profile) === name);
    if (!profiles.length) return "";
    return `<h3>${esc(name)}</h3><div class="choices">${profiles.map((profile) => `
    <button type="button" class="choice${quote.profileId === profile.id ? " is-selected" : ""}" data-action="select-profile" data-id="${esc(profile.id)}">
      ${thumb(profileImage(profile), profile.name)}
      <strong>${esc(profile.name)}</strong>
      <p>From ${esc(incMoney(profileFromPrice(profile)))}&nbsp;/&nbsp;m · cover&nbsp;${trimNum(profile.coverWidthM)}&nbsp;m${profile.outOfStock ? " · <strong>Out of stock</strong>" : (Array.isArray(profile.outOfStockLengthsM) && profile.outOfStockLengthsM.length ? ` · ${esc(profile.outOfStockLengthsM.map(trimNum).join(", "))}&nbsp;m out of stock` : "")}</p>
    </button>`).join("")}</div>`;
  }).join("");
}

function renderFinishStep() {
  const profile = currentProfile();
  if (!profile) return `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  if (!profile.finishes.length) return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  return profile.finishes.map((finish) => `
    <button type="button" class="choice${quote.finishId === finish.id ? " is-selected" : ""}" data-action="select-finish" data-id="${esc(finish.id)}">
      <strong>${esc(finish.name)}</strong>
      <p>${incMoney(Number(finish.pricePerMetre) || 0)} per metre, inc VAT</p>
    </button>`).join("");
}

/* A live sheet swatch: the chosen profile pressed and lit, painted in one colour.
   Same shading as the roof preview, so the colour step shows the real material
   rather than a flat square of paint. */
function sheetSwatchSvg(profile, colour, id) {
  const kind = roofPatternKind(profile);
  const surface = roofSurface(profile, colour);
  const mat = pvMaterial(surface);
  const base = safeHex(colour && colour.hex);
  const cover = Number(profile && profile.coverWidthM) || 1;
  const raw = pvProfile(kind, cover);
  // real sheets are shallow (a 24 mm rib over a 1 m cover); lift the relief a
  // little so the shape still reads at swatch size
  const EX = 2.0;
  const prof = { h: (x) => raw.h(x) * EX, d: (x) => raw.d(x) * EX, step: raw.step };
  const wide = cover * 1.25;
  const L = cover * 1.05;
  const step = Math.max(prof.step, cover / 90);
  const quads = [];
  const pts = [];
  for (let x = 0; x < wide - 1e-9; x += step) {
    const xb = Math.min(x + step, wide);
    const t = prof.d((x + xb) / 2);
    let N = pvNorm([-t, 0, 1]);
    if (N[2] < 0) N = [-N[0], -N[1], -N[2]];
    const ha = prof.h(x), hb = prof.h(xb);
    const q = [[x, 0, ha], [xb, 0, hb], [xb, L, hb], [x, L, ha]];
    q.forEach((p) => pts.push(pvProj(p)));
    quads.push({ q, fill: pvShade(base, N, mat) });
  }
  const th = cover * 0.035;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const W = 260, H = 150, pad = 10;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((W - 2 * pad) / Math.max(x1 - x0, 0.01), (H - 2 * pad) / Math.max(y1 - y0 + th, 0.01));
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s;
  const oy = (H - (y1 - y0) * s) / 2 - y0 * s - th * s * 0.4;
  const F = (p) => { const q = pvProj(p); return [q[0] * s + ox, q[1] * s + oy]; };
  const body = [];
  for (const it of quads) {
    const d = it.q.map((p) => { const a = F(p); return `${svgNum(a[0])},${svgNum(a[1])}`; }).join(" ");
    body.push(`<polygon points="${d}" fill="${it.fill}"${mat.op < 1 ? ` fill-opacity="${mat.op}"` : ""} stroke="${it.fill}" stroke-width=".5"/>`);
  }
  // cut edge at the front, so the sheet reads as material with thickness
  const edge = mixHex(base, "#0a0f14", 0.5);
  const top = [], bot = [];
  for (let x = 0; x <= wide + 1e-9; x += step) {
    const xx = Math.min(x, wide);
    top.push(F([xx, 0, prof.h(xx)]));
    bot.unshift(F([xx, 0, prof.h(xx) - th]));
  }
  const edgePts = top.concat(bot).map((p) => `${svgNum(p[0])},${svgNum(p[1])}`).join(" ");
  body.push(`<polygon points="${edgePts}" fill="${edge}"${mat.op < 1 ? ` fill-opacity="${mat.op}"` : ""}/>`);
  if (kind === "tile") {
    const courses = 3;
    for (let k = 1; k < courses; k += 1) {
      const y = L * k / courses;
      const a = F([0, y, 0]), b = F([wide, y, 0]);
      const a2 = F([0, y + cover * 0.02, 0]), b2 = F([wide, y + cover * 0.02, 0]);
      body.push(`<line x1="${svgNum(a[0])}" y1="${svgNum(a[1])}" x2="${svgNum(b[0])}" y2="${svgNum(b[1])}" stroke="#0b1118" stroke-opacity=".34" stroke-width="1.1"/>`);
      body.push(`<line x1="${svgNum(a2[0])}" y1="${svgNum(a2[1])}" x2="${svgNum(b2[0])}" y2="${svgNum(b2[1])}" stroke="#ffffff" stroke-opacity=".26" stroke-width="1"/>`);
    }
  }
  if (kind === "diamond") {
    const pid = `pyr-${String(id || "d").replace(/[^a-z0-9_-]/gi, "")}`;
    const area = top.concat(bot.slice()).map((p) => `${svgNum(p[0])},${svgNum(p[1])}`).join(" ");
    const face = quads.map((it) => it.q.map((p) => { const a = F(p); return `${svgNum(a[0])},${svgNum(a[1])}`; }).join(" "));
    body.push(`<defs><pattern id="${pid}" width="5" height="5" patternUnits="userSpaceOnUse">
      <polygon points="2.5,0 0,2.5 2.5,2.5" fill="#ffffff" fill-opacity=".46"/>
      <polygon points="2.5,0 5,2.5 2.5,2.5" fill="#cfdcea" fill-opacity=".26"/>
      <polygon points="0,2.5 2.5,5 2.5,2.5" fill="#6d82a0" fill-opacity=".24"/>
      <polygon points="5,2.5 2.5,5 2.5,2.5" fill="#32425c" fill-opacity=".22"/></pattern></defs>`);
    face.forEach((d) => body.push(`<polygon points="${d}" fill="url(#${pid})"/>`));
  }
  return `<svg class="chip chip-sheet" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true"
    preserveAspectRatio="xMidYMid slice">${body.join("")}</svg>`;
}

function colourChip(colour) {
  const src = safeSrc(colour.image);
  if (src) return `<img class="chip" src="${esc(src)}" alt="">`;
  const hex = safeHex(colour.hex);
  const name = String(colour.name || "").toLowerCase();
  if (/\bclear\b/.test(name)) return `<span class="chip is-clear" style="--swatch:${hex}"></span>`;
  if (/bronze/.test(name)) return `<span class="chip is-bronze" style="--swatch:${hex}"></span>`;
  return `<span class="chip" style="background:${hex}"></span>`;
}

function renderColourStep() {
  const profile = currentProfile();
  if (!profile) return `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  if (!profile.colours.length) return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  return `<div class="swatches roof-colours">${profile.colours.map((colour) => `
    <button type="button" class="swatch${quote.colourId === colour.id ? " is-selected" : ""}" data-action="select-colour" data-id="${esc(colour.id)}">
      ${sheetSwatchSvg(profile, colour, colour.id)}
      <strong>${esc(colour.name)}</strong>
      <small>${esc(profile.name)}</small>
    </button>`).join("")}</div>`;
}

function renderDripstopStep() {
  const profile = currentProfile();
  const finish = profile && (profile.finishes || []).find((item) => item.id === quote.finishId);
  if (!profile || !finish) return `<p class="muted">Choose a profile and a finish to see if this liner is available.</p>`;
  if (!lastCalc.dripstop.allowed) return `<p class="note">${esc(config.copy.dripstopBlocked)}</p>`;
  const item = config.dripstop || {};
  const on = !!quote.dripstopOn;
  const metres = lastCalc.dripstop.metres;
  return `<article class="pick${on ? " is-on" : ""}">
    ${thumb(item.image, item.name)}
    <div>
      <strong>${esc(item.name || "Anti-condensation liner")}</strong>
      <p>${money(Number(item.pricePerMetre) || 0)} per metre</p>
      <p class="muted">${esc(config.copy.dripstopHelp)}</p>
      <p><strong>${trimNum(metres)} m</strong> · ${money((Number(item.pricePerMetre) || 0) * metres)}</p>
      ${on ? `<label class="field" for="adj_drip"><span>Adjust metres</span><input id="adj_drip" data-action="adjust-qty" data-slot="dripstop" value="${esc(quote.qtyAdjust.dripstop)}" inputmode="decimal" placeholder="Blank uses the calculated metres"></label>` : ""}
      <button type="button" class="text-btn" data-action="toggle-dripstop">${on ? "Remove" : "Add"}</button>
      <p>${on ? "Added to quote" : "Not yet added to quote"}</p>
    </div>
  </article>`;
}

function renderRooflightStep() {
  const profile = currentProfile();
  let html = `<p class="note">${esc(config.copy.rooflightNote)}</p>`;
  if (!profile) return html + `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  const lights = profile.rooflights || [];
  if (!lights.length) return html + `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  html += `<div class="choices">${lights.map((item) => `
    <button type="button" class="choice${quote.rooflightId === item.id ? " is-selected" : ""}" data-action="select-rooflight" data-id="${esc(item.id)}">
      ${thumb(item.image, item.name)}
      <strong>${esc(item.name)}</strong>
      <p>${money(Number(item.pricePerMetre) || 0)} per metre</p>
    </button>`).join("")}</div>`;
  if (!quote.rooflightId) return html;
  if (!lastCalc.slopes.length) return html + `<p class="muted">Enter measurements to choose how many sheets to replace.</p>`;
  html += lastCalc.slopes.map((slope) => {
    const max = slope.sheets == null ? 0 : slope.sheets;
    const qty = quote.rooflightQty[slope.id] || 0;
    return `<div class="editor-card"><strong>${esc(slope.label)}</strong>
      <p class="muted">${max} sheet${max === 1 ? "" : "s"} on this side.</p>
      <div class="stepper">
        <button type="button" data-action="rl-step" data-slope="${esc(slope.id)}" data-dir="-1" aria-label="Decrease">−</button>
        <input id="rl_${esc(slope.id)}" data-action="rl-qty" data-slope="${esc(slope.id)}" value="${qty}" inputmode="numeric">
        <button type="button" data-action="rl-step" data-slope="${esc(slope.id)}" data-dir="1" aria-label="Increase">+</button>
      </div></div>`;
  }).join("");
  html += `<button type="button" class="text-btn" data-action="clear-rooflight">Remove rooflights</button>`;
  return html;
}

function flashingList(products, idField, adjustKey, runs, noun) {
  if (!products.length) return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  return products.map((product) => {
    const info = describePieces(runs, Number(product.pieceLengthM), lastCalc.overlap, noun);
    const on = quote[idField] === product.id;
    const override = String(quote.qtyAdjust[adjustKey] ?? "").trim();
    const qty = on && override !== "" ? override : info.total;
    return `<article class="pick${on ? " is-on" : ""}">
      ${thumb(product.image, product.name)}
      <div>
        <strong>${esc(product.name)}</strong>
        <p>${money(Number(product.price) || 0)} each · ${trimNum(product.pieceLengthM)} m lengths</p>
        <p class="muted">${esc(info.text)}</p>
        <p><strong>${esc(qty)} pieces</strong> · ${money((Number(product.price) || 0) * (Number(qty) || 0))}</p>
        ${on ? `<label class="field" for="adj_${esc(adjustKey)}"><span>Adjust quantity</span><input id="adj_${esc(adjustKey)}" data-action="adjust-qty" data-slot="${esc(adjustKey)}" value="${esc(quote.qtyAdjust[adjustKey] || "")}" inputmode="decimal" placeholder="Blank uses the calculated quantity"></label>` : ""}
        <button type="button" class="text-btn" data-action="toggle-flash" data-field="${esc(idField)}" data-id="${esc(product.id)}">${on ? "Remove" : "Add"}</button>
        <p>${on ? "Added to quote" : "Not yet added to quote"}</p>
      </div>
    </article>`;
  }).join("");
}

function renderBargeStep() {
  const profile = currentProfile();
  let html = `<p class="note">${esc(config.copy.bargeNote)}</p>`;
  if (!profile) return html + `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  return html + flashingList(profile.barges || [], "bargeId", "barge", lastCalc.geometry.bargeRuns, "verge");
}

function renderRidgeStep() {
  const type = currentType();
  const profile = currentProfile();
  let html = `<p class="note">${esc(config.copy.ridgeNote)}</p>`;
  if (!type) return html + `<p class="muted">${esc(config.copy.needType)}</p>`;
  if (!profile) return html + `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  if (!type.apexRidge && !type.monoRidge) return html + `<p class="muted">This roof type does not use a ridge flashing.</p>`;
  if (type.apexRidge) {
    const ridges = (profile.ridges || []).filter((item) => item.kind === "apex" || !item.kind);
    html += `<h3>Apex ridge</h3>${flashingList(ridges, "ridgeApexId", "ridgeApex", lastCalc.geometry.ridgeApex > 0 ? [lastCalc.geometry.ridgeApex] : [], "ridge")}`;
  }
  if (type.monoRidge) {
    const ridges = (profile.ridges || []).filter((item) => item.kind === "mono");
    html += `<h3>Mono ridge</h3>${flashingList(ridges, "ridgeMonoId", "ridgeMono", lastCalc.geometry.ridgeMono > 0 ? [lastCalc.geometry.ridgeMono] : [], "ridge")}`;
  }
  return html;
}

function renderAbutmentStep() {
  const type = currentType();
  if (!type) return `<p class="muted">${esc(config.copy.needType)}</p>`;
  if (!type.abutment) return `<p class="note">${esc(config.copy.abutmentUnavailable)}</p>`;
  const profile = currentProfile();
  if (!profile) return `<p class="muted">${esc(config.copy.needProfile)}</p>`;
  return flashingList(profile.abutments || [], "abutmentId", "abutment", lastCalc.geometry.abutment > 0 ? [lastCalc.geometry.abutment] : [], "abutment");
}

function rawRecommendation(product) {
  if (product.recommend === "fixings") return lastCalc.recommendations.screwCount;
  if (product.recommend === "stitchers") return lastCalc.recommendations.stitcherCount;
  return null;
}

function suggestionFor(product, variant) {
  const raw = rawRecommendation(product);
  if (!(raw > 0) || !variant) return null;
  const pack = Number(variant.packSize) > 0 ? Number(variant.packSize) : 1;
  return Math.ceil(raw / pack);
}

function visibleProducts(products) {
  const profile = currentProfile();
  return (products || []).filter((item) => !item.profileIds || !item.profileIds.length || (profile && item.profileIds.includes(profile.id)));
}

function renderPick(product) {
  const variants = product.variants || [];
  if (!variants.length) return "";
  const pick = quote.picks[product.id] || { variantId: "", qty: 0 };
  const variant = variants.find((item) => item.id === pick.variantId) || variants[0];
  const qty = Number(pick.qty) || 0;
  const suggested = suggestionFor(product, variant);
  const options = variants.map((item) => `<option value="${esc(item.id)}"${item.id === variant.id ? " selected" : ""}>${esc(item.name)} — ${incMoney(item.price)}</option>`).join("");
  const chooser = variants.length > 1
    ? `<label class="field"><span>Option</span><select id="var_${esc(product.id)}" data-action="variant" data-id="${esc(product.id)}">${options}</select></label>`
    : `<p><strong>${incMoney(variant.price)}</strong></p>`;
  const stockNote = Number(variant.stock) === 0 ? `<p class="muted">Out of stock on bcmckeown.net when this list was exported.</p>` : "";
  let suggestText = "";
  if (suggested) {
    const pack = Number(variant.packSize) > 0 ? Number(variant.packSize) : 1;
    suggestText = pack > 1
      ? `<p class="muted">Suggested: ${suggested} packs (${rawRecommendation(product)} items, ${trimNum(pack)} per pack).</p>`
      : `<p class="muted">Suggested: ${suggested}.</p>`;
  }
  return `<article class="pick${qty > 0 ? " is-on" : ""}">
    ${thumb(product.image, product.name)}
    <div>
      <strong>${esc(product.name)}</strong>
      ${chooser}
      ${stockNote}
      ${suggestText}
      <div class="stepper">
        <button type="button" data-action="qty" data-id="${esc(product.id)}" data-dir="-1" aria-label="Decrease">−</button>
        <input id="qty_${esc(product.id)}" data-action="qty-set" data-id="${esc(product.id)}" value="${qty}" inputmode="numeric">
        <button type="button" data-action="qty" data-id="${esc(product.id)}" data-dir="1" aria-label="Increase">+</button>
      </div>
      ${qty > 0
        ? `<button type="button" class="text-btn" data-action="remove-pick" data-id="${esc(product.id)}">Remove</button>`
        : `<button type="button" class="text-btn" data-action="add-pick" data-id="${esc(product.id)}">${suggested ? "Add suggested" : "Add"}</button>`}
      <p>${qty > 0 ? `${qty} added · ${incMoney((Number(variant.price) || 0) * qty)}` : "Not yet added to quote"}</p>
    </div>
  </article>`;
}

function renderSellables(products) {
  const list = visibleProducts(products);
  if (!list.length) {
    if ((products || []).length && (products || []).every((item) => item.profileIds && item.profileIds.length) && !quote.profileId) {
      return `<p class="muted">${esc(config.copy.needProfile)}</p>`;
    }
    return `<p class="muted">${esc(config.copy.emptyProducts)}</p>`;
  }
  return list.map(renderPick).join("");
}

function renderCatalogue(products) {
  const query = String(ui.catalogueQuery || "").trim().toLowerCase();
  const list = (products || []).filter((item) => {
    if (!query) return true;
    return `${item.category || ""} ${item.name || ""}`.toLowerCase().includes(query);
  });
  const order = [
    "Composite decking",
    "Composite fencing",
    "Composite wall cladding",
    "Composite sheds and garden rooms",
    "Gates",
    "V mesh fencing",
    "Granite and landscaping",
    "Granite paving",
    "Porcelain paving",
    "Granite kerbs",
    "Granite steps",
    "Granite gate posts",
    "Stone wall cladding",
    "Metal roofing",
    "Clear roofing and flat sheets",
    "Purlins",
  ];
  const groups = new Map();
  list.forEach((item) => {
    const name = item.category || "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  });
  const names = [...groups.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
  const body = names.map((name) => `<h3>${esc(name)}</h3>${groups.get(name).map(renderPick).join("")}`).join("");
  return `<p class="note">Every product currently listed on bcmckeown.net. The price shown is the website price, including VAT.</p>
    <label class="field" for="catalogue-filter"><span>Search products</span>
      <input id="catalogue-filter" data-action="catalogue-filter" value="${esc(ui.catalogueQuery || "")}" placeholder="Decking, granite, gate, sheet">
    </label>
    <p class="muted">${list.length} product${list.length === 1 ? "" : "s"}</p>
    ${body || `<p class="muted">No products match that search.</p>`}`;
}

function renderFixingsStep() {
  const area = lastCalc.recommendations.areaM2;
  const screws = lastCalc.recommendations.screwCount;
  const stitch = lastCalc.recommendations.stitcherCount;
  let tip = `Suggested rates: ${trimNum(config.rules.fixingsPerM2)} screws per m² and ${trimNum(config.rules.stitchersPerFlashing)} stitcher screws per flashing piece.`;
  if (screws) tip += ` Roof area ${trimNum(area)} m² suggests ${screws} screws.`;
  tip += stitch ? ` Flashings on the quote suggest ${stitch} stitchers.` : " Stitchers are suggested after you add flashings.";
  return `<p class="note">${esc(tip)}</p>${renderSellables(config.fixings)}`;
}

function renderLines(lines) {
  if (!lines.length) return `<p class="muted">Complete the steps to build the materials list.</p>`;
  let html = `<p class="muted">Line prices include VAT, the same as the website. The total below shows the VAT part of that price.</p>`;
  let section = "";
  lines.forEach((line) => {
    if (line.section !== section) {
      section = line.section;
      html += `<h3 class="line-section">${esc(section)}</h3>`;
    }
    html += `<div class="line"><div><strong>${esc(line.name)}</strong><p class="detail">${esc(line.detail || "")}</p></div><div class="line-price"><span>${esc(line.qtyLabel)} × ${incMoney(line.unitPrice)}</span><strong>${incMoney(line.total)}</strong></div></div>`;
  });
  return html;
}

function totalsHtml() {
  const totals = lastCalc.totals;
  return `<div class="totals">
    <div><span>Subtotal (ex. VAT)</span><strong>${money(totals.exVat)}</strong></div>
    <div><span>VAT (${trimNum(totals.vatPercent)}%)</span><strong>${money(totals.vat)}</strong></div>
    <div class="total-row"><span>Total (inc. VAT)</span><strong>${money(totals.incVat)}</strong></div>
  </div>`;
}

function renderReviewStep() {
  const missing = ui.showErrors
    ? `<ul class="err">${allErrors().map((error) => `<li>${esc(error.message)}</li>`).join("")}</ul>`
    : "";
  return `<p>${esc(config.copy.disclaimer)}</p>
    <p class="muted">${esc(config.copy.basketNote)}</p>
    ${missing}
    ${renderLines(lastCalc.lines)}
    ${totalsHtml()}
    <label class="field" for="notes"><span>Notes on the quote</span><textarea id="notes" data-action="notes">${esc(quote.notes)}</textarea></label>
    <button type="button" class="primary" data-action="add-basket">Add all to basket</button>
    <button type="button" class="ghost" data-action="open-email">Email quote</button>`;
}

const ROOF_KINDS = ["type", "measure", "profile", "finish", "colour", "dripstop", "rooflight", "barge", "ridge", "abutment", "fixings"];

function currentJob() {
  return (config.jobs || []).find((item) => item.id === quote.jobId) || null;
}

function incMoney(ex) {
  const pct = Number(config.company && config.company.vatPercent);
  const rate = Number.isFinite(pct) ? pct : 20;
  return money(round2(round2(Number(ex) || 0) * (1 + rate / 100)));
}

function jobColours(product) {
  return product && Array.isArray(product.colours) ? product.colours : [];
}

function jobOptions(product) {
  const colours = jobColours(product);
  if (colours.length) return colours;
  return product && Array.isArray(product.variants) ? product.variants : [];
}

function currentJobProduct() {
  const job = currentJob();
  if (!job) return null;
  return (job.products || []).find((item) => item.id === quote.jobProductId) || null;
}

function syncJobChoice() {
  const job = currentJob();
  if (!job) return;
  let product = (job.products || []).find((item) => item.id === quote.jobProductId);
  if (quote.jobProductId && !product) {
    quote.jobProductId = null;
    quote.jobVariantId = null;
    product = null;
  }
  if (!product && (job.products || []).length === 1) {
    product = job.products[0];
    quote.jobProductId = product.id;
  }
  if (!product) return;
  const options = jobOptions(product);
  if (options.length && !options.some((item) => item.id === quote.jobVariantId)) quote.jobVariantId = options[0].id;
  if (!options.length) quote.jobVariantId = null;
}

function productFromPrice(product) {
  const options = jobOptions(product);
  if (!options.length) return Number(product.price) || 0;
  return Math.min(...options.map((item) => Number(item.price) || 0));
}

function productPriceVaries(product) {
  const options = jobOptions(product);
  if (options.length < 2) return false;
  const prices = options.map((item) => Number(item.price) || 0);
  return Math.min(...prices) !== Math.max(...prices);
}

function hexToRgba(hex, alpha) {
  const raw = safeHex(hex).slice(1);
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function selectedFill() {
  const product = currentJobProduct();
  const colour = jobColours(product).find((item) => item.id === quote.jobVariantId);
  const hex = (colour && colour.hex) || (product && product.swatch);
  return hex ? hexToRgba(hex, 0.78) : "rgba(30,66,139,0.22)";
}

function pageMode() {
  return document.body && document.body.dataset.page === "other" ? "other" : "roof";
}

function draftKey() {
  return pageMode() === "other" ? "roofQuote.draft.other" : "roofQuote.draft.roof";
}

function applyPageMode() {
  if (!quote) return;
  if (pageMode() === "roof") {
    quote.jobId = "roof";
    return;
  }
  if (quote.jobId === "roof") quote.jobId = null;
}

function renderJobStep() {
  const jobs = (config.jobs || []).filter((job) => pageMode() === "roof" || job.id !== "roof");
  if (!jobs.length) return `<p class="muted">No calculators are set up yet.</p>`;
  return `<div class="choices">${jobs.map((job) => `
    <button type="button" class="choice${quote.jobId === job.id ? " is-selected" : ""}" data-action="select-job" data-id="${esc(job.id)}">
      ${job.id === "roof" ? "" : thumb("images/jobs/" + job.id + ".svg?v=22", job.name)}
      <strong>${esc(job.name)}</strong>
      <p>${esc(job.blurb)}</p>
    </button>`).join("")}</div>
    <p class="muted">Pick what you want to size, then enter the measurements on the next step.</p>`;
}

function jobInput(field, label, numeric) {
  const bad = ui.showErrors && lastCalc.errors.some((error) => error.field === field);
  return `<label class="field${bad ? " has-error" : ""}" for="job_${field}"><span>${esc(unitLabel(label))}</span>
    <input id="job_${field}" data-action="job-measure" data-field="${field}" value="${esc(quote[field] || "")}" inputmode="${numeric ? "numeric" : "decimal"}" autocomplete="off">
    ${fieldMsg(field)}</label>`;
}

function svgNum(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

function gridDiagram(layout, label) {
  const key = "grid";
  const pieceX = Number(layout.pieceX) || 0;
  const pieceY = Number(layout.pieceY) || 0;
  const along = Math.max(0, Math.round(layout.along) || 0);
  const across = Math.max(0, Math.round(layout.across) || 0);
  const boardsW = along * pieceX;
  const boardsH = across * pieceY;
  const clip = !!layout.clip;
  const worldW = clip ? Math.max(layout.x, 0.01) : Math.max(layout.x, boardsW, 0.01);
  const worldH = clip ? Math.max(layout.y, 0.01) : Math.max(layout.y, boardsH, 0.01);
  const longer = !clip && boardsW > layout.x + 0.01;
  const taller = !clip && boardsH > layout.y + 0.01;
  const scale = diaScale(worldW, worldH, 212);
  const drawW = worldW * scale;
  const drawH = worldH * scale;
  const x0 = diaX0(drawW);
  const y0 = DIA.padT;
  const X = (m) => x0 + m * scale;
  const Y = (m) => y0 + m * scale;
  const base = selectedFill();
  const parts = [diaTitle(DIA.padL - 2, 18, "How the pieces fall", key)];
  if (clip) parts.push(`<clipPath id="area-clip-${key}"><rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}"/></clipPath>`);
  parts.push(`<rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}" fill="${base}" fill-opacity=".9"/>`);
  if (pieceX > 0 && pieceY > 0) {
    if (clip) parts.push(`<g clip-path="url(#area-clip-${key})">`);
    const many = along * across > 420;
    if (many) {
      for (let col = 1; col < along; col += 1) {
        const x = X(Math.min(col * pieceX, layout.x));
        parts.push(`<line x1="${svgNum(x)}" y1="${svgNum(Y(0))}" x2="${svgNum(x)}" y2="${svgNum(Y(layout.y))}" stroke="${DIA.soft}" stroke-width=".7"/>`);
      }
      for (let row = 1; row < across; row += 1) {
        const y = Y(Math.min(row * pieceY, layout.y));
        parts.push(`<line x1="${svgNum(X(0))}" y1="${svgNum(y)}" x2="${svgNum(X(layout.x))}" y2="${svgNum(y)}" stroke="${DIA.soft}" stroke-width=".7"/>`);
      }
    } else {
      for (let row = 0; row < across; row += 1) {
        for (let col = 0; col < along; col += 1) {
          const tint = (row + col) % 2 ? 0.34 : 0.5;
          parts.push(`<rect x="${svgNum(X(col * pieceX) + 0.6)}" y="${svgNum(Y(row * pieceY) + 0.6)}"
            width="${svgNum(Math.max(1, pieceX * scale - 1.2))}" height="${svgNum(Math.max(1, pieceY * scale - 1.2))}"
            rx="1" fill="${base}" fill-opacity="${tint}" stroke="${DIA.soft}" stroke-width=".8"/>`);
        }
      }
    }
    if (clip) parts.push(`</g>`);
  }
  parts.push(`<rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}" fill="none" stroke="${DIA.rule}" stroke-width="1.8"/>`);
  let yDim = y0 + drawH + 26;
  parts.push(dimAcross(X(0), X(layout.x), yDim, `${fmtLen(layout.x)}`, key));
  if (longer) { yDim += 26; parts.push(dimAcross(X(0), X(boardsW), yDim, `${fmtLen(boardsW)} ordered`, key)); }
  parts.push(dimDown(x0 - 16, Y(0), Y(layout.y), `${fmtLen(layout.y)}`, key));
  if (taller) parts.push(dimDown(x0 + drawW + 22, Y(0), Y(boardsH), `${fmtLen(boardsH)}`, key));
  const spare = Math.max(0, Math.round(layout.spare) || 0);
  let legendY = yDim + 24;
  const total = along * across;
  if (total > 0) parts.push(diaLegend(x0, legendY, base, `${along} along × ${across} across = ${total}`, false, key));
  if (spare > 0) parts.push(diaLegend(x0 + 212, legendY, "", `${spare} spare for ${trimNum(layout.waste)}% waste`, true, key));
  return diaFrame(drawW, (legendY - DIA.padT) + 10, parts.join(""), label, key);
}

function barDiagram(layout, label) {
  const key = "bar";
  const pieceX = Number(layout.pieceX) || 0;
  const along = Math.max(0, Math.round(layout.along) || 0);
  const boardsW = along * pieceX;
  const worldW = Math.max(layout.x, boardsW, 0.01);
  const longer = boardsW > layout.x + 0.01;
  const scale = diaScale(worldW, 1, 999);
  const drawW = worldW * scale;
  const x0 = diaX0(drawW);
  const y0 = DIA.padT + 10;
  const barH = 46;
  const base = selectedFill();
  const parts = [diaTitle(DIA.padL - 2, 18, pieceX > 0 ? "Lengths along the run" : "Cut to length", key)];
  if (pieceX > 0 && along > 0) {
    for (let col = 0; col < along; col += 1) {
      const w = Math.min(pieceX, Math.max(0, worldW - col * pieceX)) * scale;
      parts.push(`<rect x="${svgNum(x0 + col * pieceX * scale + 0.6)}" y="${svgNum(y0)}" width="${svgNum(Math.max(1, w - 1.2))}" height="${barH}"
        rx="1.5" fill="${base}" fill-opacity="${col % 2 ? 0.36 : 0.52}" stroke="${DIA.soft}" stroke-width=".8"/>`);
      if (pieceX * scale > 20) parts.push(diaText(x0 + (col + 0.5) * pieceX * scale, y0 + barH / 2 + 4, String(col + 1), "middle", 11, DIA.soft, 600));
    }
  } else {
    parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(layout.x * scale)}" height="${barH}" rx="2" fill="${base}" fill-opacity=".5"/>`);
  }
  parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(layout.x * scale)}" height="${barH}" fill="none" stroke="${DIA.rule}" stroke-width="1.8"/>`);
  if (longer) {
    parts.push(`<rect x="${svgNum(x0 + layout.x * scale)}" y="${svgNum(y0)}" width="${svgNum((boardsW - layout.x) * scale)}" height="${barH}" fill="url(#waste-${key})"/>`);
  }
  parts.push(dimAcross(x0, x0 + layout.x * scale, y0 + barH + 26, `${fmtLen(layout.x)}`, key));
  let legendY = y0 + barH + 50;
  if (longer) { parts.push(dimAcross(x0, x0 + boardsW * scale, y0 + barH + 52, `${fmtLen(boardsW)} ordered`, key)); legendY += 26; }
  const hasLegend = along > 0 && pieceX > 0;
  if (hasLegend) parts.push(diaLegend(x0, legendY, base, `${along} × ${fmtLen(pieceX)} length${along === 1 ? "" : "s"}`, false, key));
  const bodyH = hasLegend ? (legendY - DIA.padT) + 10 : (y0 + barH + 34) - DIA.padT;
  return diaFrame(drawW, bodyH, parts.join(""), label, key);
}

function rectDiagram(layout, label) {
  const key = "rect";
  const scale = diaScale(Math.max(layout.x, 0.01), Math.max(layout.y, 0.01), 212);
  const drawW = layout.x * scale;
  const drawH = layout.y * scale;
  const x0 = diaX0(drawW);
  const y0 = DIA.padT;
  const parts = [
    diaTitle(DIA.padL - 2, 18, "Area, to scale", key),
    `<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="${selectedFill()}" fill-opacity=".75" stroke="${DIA.rule}" stroke-width="1.8"/>`,
    dimAcross(x0, x0 + drawW, y0 + drawH + 26, `${fmtLen(layout.x)}`, key),
    dimDown(x0 - 16, y0, y0 + drawH, `${fmtLen(layout.y)}`, key),
  ];
  return diaFrame(drawW, drawH + 24, parts.join(""), label, key);
}

function stepsDiagram(layout, label) {
  const key = "steps";
  const treads = Math.max(1, Math.round(layout.treads) || 1);
  const along = Math.max(1, Math.round(layout.along) || 1);
  const pieceX = Number(layout.pieceX) || layout.x;
  const depth = Number(layout.y) || 0;
  const boardsW = along * pieceX;
  const worldW = Math.max(layout.x, boardsW, 0.01);
  const worldH = depth > 0 ? treads * depth : 1;
  const scale = depth > 0 ? diaScale(worldW, worldH, 206) : diaScale(worldW, 1, 999);
  const rowH = depth > 0 ? depth * scale : 30;
  const gap = depth > 0 ? 2 : 9;
  const drawW = worldW * scale;
  const x0 = diaX0(drawW);
  const base = selectedFill();
  const parts = [diaTitle(DIA.padL - 2, 18, `${treads} tread${treads === 1 ? "" : "s"}, ${along} piece${along === 1 ? "" : "s"} across`, key)];
  for (let row = 0; row < treads; row += 1) {
    const y = DIA.padT + row * (rowH + gap);
    for (let col = 0; col < along; col += 1) {
      parts.push(`<rect x="${svgNum(x0 + col * pieceX * scale + 0.6)}" y="${svgNum(y)}" width="${svgNum(Math.max(1, pieceX * scale - 1.2))}" height="${svgNum(rowH)}"
        rx="1.5" fill="${base}" fill-opacity="${col % 2 ? 0.36 : 0.52}" stroke="${DIA.soft}" stroke-width=".8"/>`);
    }
    if (boardsW > layout.x + 0.01) {
      parts.push(`<rect x="${svgNum(x0 + layout.x * scale)}" y="${svgNum(y)}" width="${svgNum((boardsW - layout.x) * scale)}" height="${svgNum(rowH)}" fill="url(#waste-${key})"/>`);
    }
    parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y)}" width="${svgNum(layout.x * scale)}" height="${svgNum(rowH)}" fill="none" stroke="${DIA.rule}" stroke-width="1.6"/>`);
  }
  const rowsH = treads * rowH + (treads - 1) * gap;
  parts.push(dimAcross(x0, x0 + layout.x * scale, DIA.padT + rowsH + 26, `${fmtLen(layout.x)} wide`, key));
  if (depth > 0) parts.push(dimDown(x0 - 16, DIA.padT, DIA.padT + rowsH, `${fmtLen(depth * treads)}`, key));
  const legendY = DIA.padT + rowsH + 50;
  parts.push(diaLegend(x0, legendY, base, `${along * treads} piece${along * treads === 1 ? "" : "s"} of ${fmtLen(pieceX)}`, false, key));
  return diaFrame(drawW, (legendY - DIA.padT) + 10, parts.join(""), label, key);
}

function perimeterDiagram(layout, label) {
  const key = "perim";
  const length = Number(layout.x) || 0;
  const width = Number(layout.y) || 0;
  const piece = Number(layout.pieceX) || 0;
  const scale = diaScale(Math.max(length, 0.01), Math.max(width, 0.01), 200);
  const drawW = length * scale;
  const drawH = width * scale;
  const x0 = diaX0(drawW);
  const y0 = DIA.padT;
  const total = 2 * (length + width);
  const band = Math.max(7, Math.min(15, Math.min(drawW, drawH) * 0.08));
  const base = selectedFill();
  const parts = [
    diaTitle(DIA.padL - 2, 18, "Lengths around the edge", key),
    `<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="${base}" fill-opacity=".34" stroke="${DIA.soft}" stroke-width="1"/>`,
  ];
  function pointAt(dist) {
    const p = ((dist % total) + total) % total;
    if (p <= length) return { x: x0 + p * scale, y: y0 };
    if (p <= length + width) return { x: x0 + drawW, y: y0 + (p - length) * scale };
    if (p <= 2 * length + width) return { x: x0 + drawW - (p - length - width) * scale, y: y0 + drawH };
    return { x: x0, y: y0 + drawH - (p - 2 * length - width) * scale };
  }
  let whole = 0;
  if (piece > 0 && total > 0) {
    let start = 0, guard = 0, idx = 0;
    while (start < total - 1e-6 && guard < 90) {
      const len = Math.min(piece, total - start);
      const pts = [pointAt(start)];
      let walked = 0, at = start;
      const corners = [length, length + width, 2 * length + width, total];
      while (walked < len - 1e-6) {
        const next = corners.find((corner) => corner > at + 1e-6) || total;
        const step = Math.min(len - walked, next - at);
        at += step; walked += step;
        pts.push(pointAt(Math.min(at, total)));
      }
      const points = pts.map((pt) => `${svgNum(pt.x)},${svgNum(pt.y)}`).join(" ");
      const full = len + 1e-6 >= piece;
      if (full) whole += 1;
      parts.push(`<polyline points="${points}" fill="none" stroke="${full ? DIA.rule : DIA.waste}" stroke-opacity="${full ? (idx % 2 ? 0.74 : 1) : 0.8}"
        stroke-width="${svgNum(band)}" stroke-linejoin="miter" stroke-linecap="butt"/>`);
      start += len; guard += 1; idx += 1;
    }
  }
  parts.push(dimAcross(x0, x0 + drawW, y0 + drawH + 26, `${fmtLen(length)}`, key));
  parts.push(dimDown(x0 - 16, y0, y0 + drawH, `${fmtLen(width)}`, key));
  const legendY = y0 + drawH + 50;
  if (piece > 0) {
    parts.push(diaLegend(x0, legendY, DIA.rule, `${fmtLen(piece)} lengths, perimeter ${fmtLen(total)}`, false, key));
  }
  return diaFrame(drawW, (legendY - DIA.padT) + 10, parts.join(""), label, key);
}

function scaleCaption(layout) {
  const spare = Number(layout.spare) || 0;
  if (layout.kind === "grid") {
    const coverMm = Math.round((Number(layout.pieceY) || 0) * 1000);
    const boardsW = (Number(layout.along) || 0) * (Number(layout.pieceX) || 0);
    const boardsH = (Number(layout.across) || 0) * (Number(layout.pieceY) || 0);
    const overhang = boardsW > Number(layout.x) + 0.01 || boardsH > Number(layout.y) + 0.01;
    let text = `The filled area is the ${fmtLen(layout.x)} × ${fmtLen(layout.y)} you entered. Each piece is ${fmtLen(layout.pieceX)} long`;
    if (coverMm > 0) text += ` and covers ${coverMm} mm`;
    text += overhang ? ". Hatched is the rest of a whole piece." : ". The pieces cover that size exactly.";
    if (layout.unit === "m2") {
      return `The filled area is ${fmtLen(layout.x)} × ${fmtLen(layout.y)}. Each cobble is ${Math.round(layout.pieceX * 1000)} × ${Math.round(layout.pieceY * 1000)} mm. This product is sold by the square metre, so the order is ${layout.qty} m².`;
    }
    if (spare > 0) {
      const word = spare === 1 ? "piece is" : "pieces are";
      text += ` ${spare} more ${word} the ${trimNum(layout.waste)}% waste, drawn underneath.`;
    }
    return text;
  }
  if (layout.kind === "perimeter") {
    const run = 2 * (Number(layout.x) + Number(layout.y));
    return `The rectangle is ${fmtLen(layout.x)} × ${fmtLen(layout.y)}. The edge is ${fmtLen(run)}, covered by ${layout.qty} whole lengths of ${fmtLen(layout.pieceX)}.`;
  }
  if (layout.kind === "bar" && layout.pieceX > 0) {
    return `The filled area is the ${fmtLen(layout.x)} run. Each piece is ${fmtLen(layout.pieceX)}. Hatched is the rest of a whole piece.`;
  }
  if (layout.kind === "bar") return `Drawn to the ${fmtLen(layout.x)} cut length.`;
  if (layout.kind === "steps") {
    const depth = Number(layout.y) || 0;
    const rows = Math.max(1, Math.round(layout.treads) || 1);
    let text = `Each band is one tread, ${fmtLen(layout.x)} wide.`;
    if (depth > 0) text += ` The going is ${trimNum(depth)} m, so ${rows} treads run ${trimNum(depth * rows)} m.`;
    text += ` Pieces are ${fmtLen(layout.pieceX)} and are sold whole.`;
    return text;
  }
  if (layout.pieceX > 0) return `The rectangle is ${fmtLen(layout.x)} × ${fmtLen(layout.y)}. Lengths are ${fmtLen(layout.pieceX)}.`;
  return `The rectangle is ${fmtLen(layout.x)} × ${fmtLen(layout.y)}, drawn to scale.`;
}

function renderScaleDiagram() {
  const line = (lastCalc.lines || []).find((item) => item.section === "Calculated" && item.layout);
  if (!line) {
    return `<div class="scale-diagram"><h3>To scale</h3><p class="muted">Enter the size to see it drawn here. The drawing uses the same metres as the boxes above.</p></div>`;
  }
  const layout = line.layout;
  const label = scaleCaption(layout);
  let svg = "";
  if (layout.kind === "grid") svg = gridDiagram(layout, label);
  else if (layout.kind === "bar") svg = barDiagram(layout, label);
  else if (layout.kind === "steps") svg = stepsDiagram(layout, label);
  else if (layout.kind === "perimeter") svg = perimeterDiagram(layout, label);
  else svg = rectDiagram(layout, label);
  return `<div class="scale-diagram"><h3>To scale</h3>${svg}<p class="scale-caption">${esc(label)}</p></div>`;
}

function fitScale(worldW, worldH, maxW, maxH) {
  const w = Math.max(worldW, 0.01);
  const h = Math.max(worldH, 0.01);
  return Math.min(maxW / w, maxH / h);
}

function renderSizeStep() {
  const job = currentJob();
  if (!job || job.mode === "roof") return `<p>Choose a calculator above.</p>`;
  const products = job.products || [];
  const product = products.find((item) => item.id === quote.jobProductId) || null;
  const cards = products.map((item) => {
    const from = productFromPrice(item);
    const many = productPriceVaries(item);
    return `<button type="button" class="choice${product && product.id === item.id ? " is-selected" : ""}" data-action="select-job-product" data-id="${esc(item.id)}">
      <strong>${esc(item.name)}</strong>
      <p>${many ? "From " : ""}${esc(incMoney(from))}</p>
    </button>`;
  }).join("");
  let options = "";
  if (product && (product.variants || []).length > 1 && !jobColours(product).length) {
    const selected = quote.jobVariantId || product.variants[0].id;
    options = `<label class="field" for="job-variant"><span>Option</span>
      <select id="job-variant" data-action="job-variant">${product.variants.map((item) =>
        `<option value="${esc(item.id)}"${item.id === selected ? " selected" : ""}>${esc(item.name)} — ${esc(incMoney(item.price))}</option>`
      ).join("")}</select></label>`;
  }
  const wasteDefault = Number(job.wasteDefault) || 0;
  const waste = wasteDefault > 0 || String(quote.jobWaste || "").trim() !== ""
    ? jobInput("jobWaste", `Extra waste % (blank uses ${trimNum(wasteDefault)})`, false)
    : "";
  const needsLength = ["wall", "run", "linear", "steps", "area", "grid"].includes(job.mode) || !["circles", "each"].includes(job.mode);
  let fields = needsLength ? unitToggle() + unitNote() : "";
  if (job.mode === "wall") {
    fields += jobInput("jobLength", "Length of wall or fence to cover (metres)", false) + jobInput("jobHeight", "Height to cover (metres)", false) + waste;
  } else if (job.mode === "run" || job.mode === "linear") {
    fields += jobInput("jobLength", "Length (metres)", false);
  } else if (job.mode === "steps") {
    fields += jobInput("jobWidth", "Step width (metres)", false) + jobInput("jobCount", "Number of treads", true);
  } else if (job.mode === "circles") {
    fields = jobInput("jobCount", "Number of full circles", true);
  } else if (job.mode === "each") {
    fields = jobInput("jobCount", "Quantity (blank means 1)", true);
  } else {
    fields += jobInput("jobLength", "Length (metres)", false) + jobInput("jobWidth", "Width (metres)", false) + waste;
  }
  const preview = (lastCalc.lines || []).filter((line) => line.section === "Calculated");
  const result = preview.length
    ? preview.map((line) => {
      const shown = incMoney(line.total);
      const quoteInc = round2(lastCalc.totals && lastCalc.totals.incVat);
      const lineInc = round2((Number(line.total) || 0) * (1 + ((Number(config.company && config.company.vatPercent) || 20) / 100)));
      const other = quoteInc - lineInc > 0.02
        ? `<br>This product is ${shown}. The quote total is ${money(quoteInc)} because other products are already in the basket. Clear basket to remove them.`
        : "";
      return `<p class="ok"><strong>${esc(line.qtyLabel)}</strong> — ${esc(line.name)}<br>${esc(line.detail)}<br>${shown}${other}</p>`;
    }).join("")
    : "";
  const note = [job.note, product && product.note].filter(Boolean).map((text) => `<p class="muted">${esc(text)}</p>`).join("");
  const missing = stepMsg("size");
  if (job.id === "cladding") {
    return `${missing}<p class="muted">Pick the board style. Colour is the next step, then you add each wall.</p><div class="choices">${cards}</div>`;
  }
  return `${missing}${note}<div class="choices">${cards}</div>${options}<div class="step-grid">${fields}</div>${renderScaleDiagram()}${result}`;
}

function renderJobColourStep() {
  const product = currentJobProduct();
  const colours = jobColours(product);
  if (colours.length < 2) return `<p class="muted">Choose a product above to see its colours.</p>`;
  const lengths = colours.map((item) => Number(item.lengthM) || Number(product.lengthM) || 0);
  const showLength = Math.max(...lengths) - Math.min(...lengths) > 0.01;
  return `<div class="swatches">${colours.map((colour) => {
    const background = colour.hex2
      ? `linear-gradient(90deg, ${safeHex(colour.hex)} 0 50%, ${safeHex(colour.hex2)} 50% 100%)`
      : safeHex(colour.hex);
    const length = showLength && colour.lengthM ? `<small>${esc(trimNum(colour.lengthM))} m</small>` : "";
    const house = quote.jobId === "cladding" ? houseIcon("both", "horizontal", safeHex(colour.hex)) : "";
    return `<button type="button" class="swatch${quote.jobVariantId === colour.id ? " is-selected" : ""}" data-action="select-job-colour" data-id="${esc(colour.id)}">
      ${house}<span class="chip" style="background:${background}"></span>
      <strong>${esc(colour.name)}</strong>${length}
    </button>`;
  }).join("")}</div>`;
}

function houseIcon(shape, orientation, fill) {
  const dark = fill || "#3a3a3a";
  const light = "#ffffff";
  const roof = "#6a6a6a";
  const line = "#222";
  const wallFill = shape === "gable" ? light : dark;
  const gableFill = shape === "gable" || shape === "both" ? dark : light;
  const half = shape === "half";
  const stripes = orientation === "vertical"
    ? `<g stroke="${shape === "gable" ? "#bbb" : "#fff"}" stroke-width="1.2" opacity="0.55"><path d="M58 86 V132 M78 86 V132 M98 86 V132 M118 86 V132 M138 86 V132 M158 86 V132"/></g>`
    : orientation === "horizontal"
      ? `<g stroke="${shape === "gable" ? "#bbb" : "#fff"}" stroke-width="1.2" opacity="0.55"><path d="M48 96 H172 M48 110 H172 M48 124 H172"/></g>`
      : "";
  return `<svg viewBox="0 0 220 168" aria-hidden="true">
    <polygon points="28,78 110,28 192,78" fill="${roof}" stroke="${line}" stroke-width="1.4"/>
    <polygon points="48,78 110,36 172,78" fill="${gableFill}" stroke="${line}" stroke-width="1"/>
    <rect x="70" y="16" width="16" height="28" fill="${light}" stroke="${line}"/>
    <rect x="46" y="78" width="128" height="58" fill="${half ? light : wallFill}" stroke="${line}" stroke-width="1.4"/>
    ${half ? `<rect x="46" y="108" width="128" height="28" fill="${dark}"/>` : ""}
    ${stripes}
    <rect x="62" y="88" width="28" height="16" fill="#eee" stroke="${line}" stroke-width="1"/>
    <rect x="130" y="88" width="28" height="16" fill="#eee" stroke="${line}" stroke-width="1"/>
    <rect x="98" y="108" width="22" height="28" fill="#6d6d6d" stroke="${line}" stroke-width="1"/>
  </svg>`;
}

function arrowV(x, y1, y2, color, label) {
  const down = y2 >= y1;
  const mid = (Number(y1) + Number(y2)) / 2;
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="1.6"/>
    <polygon points="${x},${y1} ${x - 4},${down ? Number(y1) + 7 : Number(y1) - 7} ${x + 4},${down ? Number(y1) + 7 : Number(y1) - 7}" fill="${color}"/>
    <polygon points="${x},${y2} ${x - 4},${down ? Number(y2) - 7 : Number(y2) + 7} ${x + 4},${down ? Number(y2) - 7 : Number(y2) + 7}" fill="${color}"/>
    <text x="${Number(x) + 7}" y="${mid + 4}" fill="${color}" font-size="13" font-weight="700">${label}</text>`;
}

function arrowH(x1, x2, y, color, label) {
  const mid = (Number(x1) + Number(x2)) / 2;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.6"/>
    <polygon points="${x1},${y} ${Number(x1) + 7},${Number(y) - 4} ${Number(x1) + 7},${Number(y) + 4}" fill="${color}"/>
    <polygon points="${x2},${y} ${Number(x2) - 7},${Number(y) - 4} ${Number(x2) - 7},${Number(y) + 4}" fill="${color}"/>
    <text x="${mid - 6}" y="${Number(y) - 8}" fill="${color}" font-size="13" font-weight="700">${label}</text>`;
}

function measureHouseSvg(draft) {
  const shape = draft.shape || "full";
  const showG = shape === "gable" || shape === "both";
  const showW = shape !== "gable";
  const gH = Math.max(val(draft.gableH), showG ? 0.5 : 0);
  const gW = Math.max(val(draft.gableW), showG ? 1 : 0);
  const wH = Math.max(val(draft.wallH), showW ? 0.5 : 0);
  const wW = Math.max(val(draft.wallW), showW ? 1 : 0);
  const span = Math.max(showG ? gW : 0, showW ? wW : 0, 1);
  const total = (showG ? gH : 0) + (showW ? wH : 0) || 1;
  const padL = 58;
  const padT = 24;
  const drawW = 240;
  const drawH = 190;
  const sx = drawW / span;
  const sy = drawH / total;
  const x0 = padL;
  let y = padT;
  let parts = "";
  if (showG) {
    const gw = gW * sx;
    const gh = gH * sy;
    const left = x0 + (span * sx - gw) / 2;
    parts += `<polygon points="${left},${y + gh} ${left + gw / 2},${y} ${left + gw},${y + gh}" fill="#d7eef8" stroke="#1e428b" stroke-width="2"/>`;
    parts += `<rect x="${left + gw * 0.16}" y="${y + gh * 0.08}" width="${Math.max(12, gw * 0.08)}" height="${gh * 0.42}" fill="#f7f7f7" stroke="#333"/>`;
    parts += arrowV(left + gw / 2, y + 14, y + gh - 14, "#1e428b", "H");
    parts += arrowH(left + 10, left + gw - 10, y + gh - 12, "#1e428b", "W");
    y += gh;
  }
  if (showW) {
    const ww = wW * sx;
    const wh = wH * sy;
    const left = x0 + (span * sx - ww) / 2;
    parts += `<rect x="${left}" y="${y}" width="${ww}" height="${wh}" fill="${shape === "half" ? "#fff" : "#f8d5dc"}" stroke="#c0392b" stroke-width="2"/>`;
    if (shape === "half") parts += `<rect x="${left}" y="${y + wh / 2}" width="${ww}" height="${wh / 2}" fill="#f8d5dc"/>`;
    const markTop = shape === "half" ? y + wh / 2 : y;
    parts += arrowV(left - 18, markTop + 8, y + wh - 8, "#c0392b", "H");
    parts += arrowH(left + 10, left + ww - 10, y + wh + 18, "#c0392b", "W");
  }
  return `<svg class="house-diagram" viewBox="0 0 ${padL + drawW + 28} ${padT + drawH + 42}">${parts}</svg>`;
}

function wallShapeLabel(shape) {
  if (shape === "half") return "Half";
  if (shape === "gable") return "Gable only";
  if (shape === "both") return "Full";
  return "Full";
}

function wallDimsOk(draft) {
  const shape = draft.shape || "full";
  if (shape !== "gable" && !(val(draft.wallH) > 0 && val(draft.wallW) > 0)) return false;
  if ((shape === "gable" || shape === "both") && !(val(draft.gableH) > 0 && val(draft.gableW) > 0)) return false;
  return true;
}

function dimBox(kind, title, heightField, widthField, draft) {
  return `<div class="dim-box ${kind}">
    <strong>${title}</strong>
    <div class="dim-row">
      <label>Height
        <input data-action="clad-field" data-field="${heightField}" value="${esc(draft[heightField] || "")}" inputmode="decimal" autocomplete="off">
        <small>Metres</small>
      </label>
      <span>×</span>
      <label>Width
        <input data-action="clad-field" data-field="${widthField}" value="${esc(draft[widthField] || "")}" inputmode="decimal" autocomplete="off">
        <small>Metres</small>
      </label>
    </div>
  </div>`;
}

function cladBoardPreview(draft) {
  const product = currentJobProduct();
  if (!product || !wallDimsOk(draft)) return "";
  const colour = jobColours(product).find((item) => item.id === quote.jobVariantId) || jobColours(product)[0];
  const lengthM = Number((colour && colour.lengthM) || product.lengthM) || 0;
  const coverM = Number((colour && colour.coverM) || product.coverM) || 0;
  const count = wallBoardCount(draft, lengthM, coverM);
  if (!(count > 0)) return "";
  return `<p class="ok">This wall needs <strong>${count} board${count === 1 ? "" : "s"}</strong> before the extra waste is added.</p>`;
}

function renderCladWallStep() {
  if (quote.jobId !== "cladding") return "";
  const draft = quote.wallDraft || blankWall();
  const phase = ui.cladPhase || "shape";
  const error = ui.cladError ? `<p class="err">${esc(ui.cladError)}</p>` : "";
  if (phase === "summary") return error + renderWallSummary();
  if (phase === "direction") {
    return `${error}<h3 class="wizard-title">Will you fit the cladding vertically or horizontally?</h3>
      <p>The same wall uses a different number of boards if they run up the wall or along it.</p>
      <div class="wall-choices">
        <button type="button" class="wall-choice${draft.orientation === "vertical" ? " is-selected" : ""}" data-action="clad-orient" data-value="vertical">
          ${houseIcon(draft.shape || "both", "vertical")}
          <span>Vertical</span>
        </button>
        <button type="button" class="wall-choice${draft.orientation === "horizontal" ? " is-selected" : ""}" data-action="clad-orient" data-value="horizontal">
          ${houseIcon(draft.shape || "both", "horizontal")}
          <span>Horizontal</span>
        </button>
      </div>
      <div class="wizard-nav"><button type="button" class="ghost" data-action="clad-back">Back</button><button type="button" class="primary" data-action="clad-next">Next</button></div>`;
  }
  if (phase === "measure") {
    const shape = draft.shape || "full";
    const boxes = `${shape === "gable" || shape === "both" ? dimBox("gable", "GABLE", "gableH", "gableW", draft) : ""}
      ${shape !== "gable" ? dimBox("wall", "WALL", "wallH", "wallW", draft) : ""}`;
    const halfNote = shape === "half" ? `<p class="muted">Enter the lower part of the wall you are cladding, not the whole house.</p>` : "";
    return `${error}<h3 class="wizard-title">Now please enter your wall area measurements</h3>
      <p>Enter height and width in metres. The gable and the wall are measured separately.</p>
      ${halfNote}
      <div class="measure-layout">${boxes}${measureHouseSvg(draft)}</div>
      ${cladBoardPreview(draft)}
      <div class="wizard-nav"><button type="button" class="ghost" data-action="clad-back">Back</button><button type="button" class="primary" data-action="clad-next">Next</button></div>`;
  }
  if (phase === "openings") {
    const windows = (draft.windows || []).map((win, index) => `<div class="dim-row window-row">
      <strong>Window ${index + 1}</strong>
      <label>Height <input data-action="clad-win" data-id="${esc(win.id)}" data-field="h" value="${esc(win.h || "")}" inputmode="decimal" autocomplete="off"> <small>m</small></label>
      <span>×</span>
      <label>Width <input data-action="clad-win" data-id="${esc(win.id)}" data-field="w" value="${esc(win.w || "")}" inputmode="decimal" autocomplete="off"> <small>m</small></label>
      <button type="button" class="ghost" data-action="clad-window-remove" data-id="${esc(win.id)}">Remove</button>
    </div>`).join("");
    const doorFields = draft.hasDoor ? `<div class="dim-row">
      <label>Height <input data-action="clad-field" data-field="doorH" value="${esc(draft.doorH || "")}" inputmode="decimal" autocomplete="off"> <small>m</small></label>
      <span>×</span>
      <label>Width <input data-action="clad-field" data-field="doorW" value="${esc(draft.doorW || "")}" inputmode="decimal" autocomplete="off"> <small>m</small></label>
    </div>` : "";
    return `${error}<h3 class="wizard-title">Does this wall have a door?</h3>
      <p>Entering a door or window counts fewer boards. Leave them out if you want spare boards for cutting around the opening.</p>
      <p>Boards are not cut to size before they are sold. Every board is the full length, and any cutting is done after you buy them.</p>
      <div class="yes-no">
        <button type="button" class="wall-choice${draft.hasDoor ? " is-selected" : ""}" data-action="clad-door" data-value="yes">Yes</button>
        <button type="button" class="wall-choice${!draft.hasDoor ? " is-selected" : ""}" data-action="clad-door" data-value="no">No</button>
      </div>
      ${doorFields}
      <h3 class="wizard-title">Windows</h3>
      ${windows || `<p class="muted">No windows added.</p>`}
      <button type="button" class="ghost" data-action="clad-window-add">Add a window</button>
      ${cladBoardPreview(draft)}
      <div class="wizard-nav"><button type="button" class="ghost" data-action="clad-back">Back</button><button type="button" class="primary" data-action="clad-save">Save wall</button></div>`;
  }
  const shapes = [
    ["full", "Full standard wall area"],
    ["half", "Half standard wall area"],
    ["gable", "Gable end only area"],
    ["both", "Full wall gable area"],
  ];
  return `${error}<h3 class="wizard-title">What kind of wall area would you like to clad?</h3>
    <p>Measure each wall you want to clad on its own. The calculator then estimates how many boards that wall needs. Measure the length by the height.</p>
    <div class="wall-choices">${shapes.map(([id, label]) => `
      <button type="button" class="wall-choice${draft.shape === id ? " is-selected" : ""}" data-action="clad-shape" data-value="${id}">
        ${houseIcon(id, "")}
        <span>${label}</span>
      </button>`).join("")}</div>
    <div class="wizard-nav"><span></span><button type="button" class="primary" data-action="clad-next">Next</button></div>`;
}

function renderWallSummary() {
  const walls = quote.walls || [];
  const cards = walls.map((wall, index) => {
    const windows = (wall.windows || []).filter((win) => val(win.h) > 0 && val(win.w) > 0);
    const windowText = windows.length
      ? windows.map((win, n) => `Window ${n + 1}: ${trimNum(val(win.h))} m × ${trimNum(val(win.w))} m`).join("<br>")
      : "There are no windows on this wall.";
    const doorText = wall.hasDoor && val(wall.doorH) > 0
      ? `Door: ${trimNum(val(wall.doorH))} m × ${trimNum(val(wall.doorW))} m`
      : "There are no doors on this wall.";
    const gable = wall.shape === "gable" || wall.shape === "both"
      ? `<p>Gable area: ${esc(trimNum(val(wall.gableW)))} m × ${esc(trimNum(val(wall.gableH)))} m</p>` : "";
    const wallSize = wall.shape !== "gable"
      ? `<p>Wall area: ${esc(trimNum(val(wall.wallW)))} m × ${esc(trimNum(val(wall.wallH)))} m</p>` : "";
    return `<article class="wall-card">
      <h3>WALL AREA ${index + 1}</h3>
      <div class="wall-card-grid">
        ${houseIcon(wall.shape, wall.orientation)}
        <div>
          <p>Gable type: ${esc(wallShapeLabel(wall.shape))}</p>
          <p>Orientation: ${wall.orientation === "vertical" ? "Vertical" : "Horizontal"}</p>
          ${gable}${wallSize}
        </div>
        <div class="opening-notes">
          <p><strong>Windows:</strong><br>${windowText}</p>
          <p><strong>Doors:</strong><br>${esc(doorText)}</p>
        </div>
      </div>
      <div class="wizard-nav">
        <button type="button" class="ghost" data-action="clad-edit" data-id="${esc(wall.id)}">Edit wall</button>
        <button type="button" class="danger" data-action="clad-remove" data-id="${esc(wall.id)}">Remove wall</button>
      </div>
    </article>`;
  }).join("");
  const preview = (lastCalc.lines || []).filter((line) => line.section === "Calculated").map((line) =>
    `<p class="ok"><strong>${esc(line.qtyLabel)}</strong> — ${esc(line.name)}<br>${esc(line.detail)}<br>${esc(incMoney(line.total))}</p>`
  ).join("");
  return `${cards || `<p>No walls saved yet.</p>`}
    <div class="step-grid">${jobInput("jobWaste", "Extra waste % (blank uses 10)", false)}</div>
    <div class="wizard-nav">
      <button type="button" class="primary" data-action="clad-add">Add another area</button>
    </div>
    ${preview}`;
}

const STEP_VIEWS = {
  job: renderJobStep,
  size: renderSizeStep,
  "job-colour": renderJobColourStep,
  "clad-wall": renderCladWallStep,
  type: renderTypeStep,
  measure: renderMeasureStep,
  profile: renderProfileStep,
  finish: renderFinishStep,
  colour: renderColourStep,
  dripstop: renderDripstopStep,
  rooflight: renderRooflightStep,
  barge: renderBargeStep,
  ridge: renderRidgeStep,
  abutment: renderAbutmentStep,
  fixings: renderFixingsStep,
  extras: () => renderCatalogue(config.extras),
  review: renderReviewStep,
};

function visibleSteps() {
  const jobId = quote.jobId || "";
  const steps = (config.steps || []).filter((step) => {
    if (step.enabled === false) return false;
    const kind = step.kind || step.id;
    if (kind === "extras") return false;
    if (pageMode() === "roof" && kind === "job") return false;
    if (ROOF_KINDS.includes(kind)) return jobId === "roof";
    if (kind === "size") return !!jobId && jobId !== "roof";
    if (kind === "job-colour") return jobColours(currentJobProduct()).length > 1;
    if (kind === "clad-wall") return jobId === "cladding";
    return true;
  });
  if (jobId !== "roof") return steps;
  const rank = { job: 0, type: 1, profile: 2, finish: 3, colour: 4, measure: 5, review: 8, export: 9 };
  return steps.slice().sort((a, b) => (rank[a.kind || a.id] ?? 6) - (rank[b.kind || b.id] ?? 6));
}

function customMissing() {
  return (config.steps || [])
    .filter((step) => step.kind === "custom" && step.enabled !== false && step.required && !String((quote.customNotes || {})[step.id] || "").trim())
    .map((step) => ({ step: step.id, message: "Please fill in this step." }));
}

function allErrors() {
  return (lastCalc.errors || []).concat(customMissing());
}

function stepSatisfied(step) {
  if (!step) return false;
  if (step.kind === "custom") return String((quote.customNotes || {})[step.id] || "").trim() !== "";
  if (step.kind === "export") return true;
  if ((step.kind || step.id) === "review") {
    return visibleSteps().filter((item) => item.required && item.id !== step.id).every((item) => stepSatisfied(item));
  }
  return stepDone(step.kind || step.id);
}

function markDone(step) {
  if (!step || step.kind === "export") return false;
  if (step.kind === "custom") return stepSatisfied(step);
  if ((step.kind || step.id) === "review") return !!(step.required && stepSatisfied(step));
  return stepDone(step.kind || step.id);
}

function renderCustomStep(step) {
  const bad = ui.showErrors && customMissing().some((error) => error.step === step.id);
  return `${step.body ? `<p>${esc(step.body)}</p>` : ""}
    <label class="field${bad ? " has-error" : ""}" for="custom_${esc(step.id)}"><span>Your answer</span>
      <textarea id="custom_${esc(step.id)}" data-action="custom-note" data-step="${esc(step.id)}">${esc((quote.customNotes || {})[step.id] || "")}</textarea>
    </label>
    ${bad ? `<p class="err">Please fill in this step.</p>` : ""}`;
}

function renderExportStep() {
  return `<p>Download one Excel file with this quote, the measurements, every priced line, your answers, and the full product catalogue.</p>
    <p class="muted">You can export before the quote is finished. Empty choices are left blank.</p>
    <button type="button" class="primary" data-action="export-excel">Export to Excel</button>`;
}

function renderStepBody(step) {
  if (step.kind === "custom") return renderCustomStep(step);
  if (step.kind === "export") return renderExportStep();
  const view = STEP_VIEWS[step.kind || step.id];
  return view ? view() : "";
}

function continueBtn(id) {
  if (id === "clad-wall" && ui.cladPhase !== "summary") return "";
  const ids = visibleSteps().map((step) => step.id);
  if (ids[ids.length - 1] === id) return "";
  return `<button type="button" class="primary continue" data-action="next" data-step="${esc(id)}">Continue</button>`;
}

function displayStep(step) {
  if (quote.jobId === "cladding" && (step.kind || step.id) === "size") {
    return { ...step, title: "Choose cladding style", hint: "Wood grain and slatted boards are different sizes and prices." };
  }
  return step;
}

function navSwatches(step) {
  if ((step.kind || step.id) !== "job-colour") return "";
  const colours = jobColours(currentJobProduct());
  if (colours.length < 2) return "";
  return `<span class="nav-swatches">${colours.map((colour) => {
    const background = colour.hex2
      ? `linear-gradient(90deg, ${safeHex(colour.hex)} 0 50%, ${safeHex(colour.hex2)} 50% 100%)`
      : safeHex(colour.hex);
    const on = quote.jobVariantId === colour.id ? " is-on" : "";
    return `<i class="${on.trim()}" style="background:${background}" title="${esc(colour.name)}"></i>`;
  }).join("")}</span>`;
}

function currentNavStep(steps) {
  if (ui.navStep && steps.some((step) => step.id === ui.navStep)) return ui.navStep;
  return steps.length ? steps[0].id : "";
}

function renderStepNav() {
  const steps = visibleSteps();
  const current = currentNavStep(steps);
  return `<nav class="step-nav" aria-label="Calculator steps">
    ${steps.map((step, index) => {
      const shown = displayStep(step);
      return `
      <button type="button" class="nav-link${step.id === current ? " is-active" : ""}" data-action="jump" data-target="${esc(step.id)}">
        <span class="num">${index + 1}</span>
        <span>${esc(shown.title)}</span>
        ${navSwatches(step)}
      </button>`;
    }).join("")}
    <div class="nav-total"><span>Total (inc. VAT)</span><strong>${money(lastCalc.totals.incVat)}</strong></div>
    <button type="button" class="nav-clear" data-action="clear-basket">Clear basket</button>
    <button type="button" class="primary nav-save" data-action="open-save">Save quote</button>
    <button type="button" class="nav-reset" data-action="open-start">Start over</button>
  </nav>`;
}

let lastStepShown = null;
let animateStep = null;

function renderSteps() {
  const steps = visibleSteps();
  const current = currentNavStep(steps);
  animateStep = current !== lastStepShown ? current : null;
  lastStepShown = current;
  return `<div class="steps">${steps.map((step, index) => {
    const shown = displayStep(step);
    return `
    <section class="step${step.id === current ? " is-current" : ""}${step.id === animateStep ? " step-enter" : ""}" data-step-anchor="${esc(step.id)}">
      <div class="step-head">
        <span class="num">${index + 1}</span>
        <h2>${esc(shown.title)}</h2>
      </div>
      ${shown.hint ? `<p class="step-hint">${esc(shown.hint)}</p>` : ""}
      <div class="step-body">${stepMsg(step.id)}${warnHtml(step.id)}${renderStepBody(step)}${continueBtn(step.id)}</div>
    </section>`;
  }).join("")}</div>`;
}

function renderSummary() {
  const phone = config.company.phone ? `<p>${esc(config.company.phone)}</p>` : "";
  const email = config.company.email ? `<p>${esc(config.company.email)}</p>` : "";
  const customer = quote.customer.name ? `<p><strong>${esc(quote.customer.name)}</strong><br>${esc(quote.customer.email)} ${esc(quote.customer.phone)}</p>` : "";
  const overview = lastCalc.overview.length ? `<p class="muted">${esc(lastCalc.overview.join(" · "))}</p>` : "";
  const added = ui.added ? `<p class="ok">Added to your quote on this device${quote.ref ? `. Reference ${esc(quote.ref)}` : ""}.</p>` : "";
  return `<aside class="summary" id="summary">
    <h2>${esc(config.company.name || "Your quote")}</h2>
    ${phone}${email}${customer}
    ${quote.ref ? `<p class="muted">Reference ${esc(quote.ref)}</p>` : ""}
    ${overview}${added}
    ${renderLines(lastCalc.lines)}
    ${totalsHtml()}
    ${quote.notes.trim() ? `<p><strong>Notes</strong><br>${esc(quote.notes.trim())}</p>` : ""}
    <p class="muted">${esc(config.copy.disclaimer)}</p>
    <button type="button" class="primary no-print" data-action="add-basket">Add all to basket</button>
    <button type="button" class="ghost no-print" data-action="print-quote">Print / Save PDF</button>
    <button type="button" class="ghost no-print" data-action="copy-quote">Copy quote</button>
    <button type="button" class="ghost no-print" data-action="open-email">Email quote</button>
    <button type="button" class="ghost no-print" data-action="export-excel">Export to Excel</button>
  </aside>`;
}

function shopIcon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">${path}</svg>`;
}

function renderHeader() {
  const shop = "https://bcmckeown.net";
  const roof = pageMode() === "roof";
  const logo = "https://bcmckeown.net/cdn/shop/files/Untitled_design_76_6a5283c2-c78c-4027-9a25-b7819b59d6af.png?v=1750868402";
  const phrase = "Call us on 02844615148 ★ Delivery available ★ New arrivals every week ★ ";
  return `<div class="site-chrome no-print">
    <div class="announce"><a href="tel:02844615148">Call Now On 02844615148</a></div>
    <header class="site-head">
      <a class="head-icon" href="${shop}/search" aria-label="Search">${shopIcon('<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5" stroke-linecap="round"/>')}</a>
      <a class="site-logo" href="${shop}/"><img src="${logo}" alt="B&amp;C McKeown"></a>
      <div class="head-icons">
        <a class="head-icon" href="${shop}/account" aria-label="Account">${shopIcon('<circle cx="12" cy="8" r="3"/><path d="M5.5 19c1.2-2.8 3.4-4 6.5-4s5.3 1.2 6.5 4" stroke-linecap="round"/>')}</a>
        <a class="head-icon" href="${shop}/" aria-label="Wishlist">${shopIcon('<path d="M12 19s-6.2-3.8-8.2-7.2C2.4 9.6 3.2 6.8 5.8 6.2 7.4 5.8 9 6.4 12 9c3-2.6 4.6-3.2 6.2-2.8 2.6.6 3.4 3.4 2 5.6C18.2 15.2 12 19 12 19z" stroke-linejoin="round"/>')}</a>
        <a class="head-icon" href="${shop}/cart" aria-label="Cart">${shopIcon('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1" stroke-linecap="round"/>')}</a>
      </div>
    </header>
    <nav class="site-nav" aria-label="Shop">
      <a href="${shop}/">Home</a>
      <a href="${shop}/collections/composite-decking">Composites</a>
      <a href="${shop}/collections/granite">Granite / Landscaping</a>
      <a href="index.html"${roof ? ' class="is-current"' : ""}>Roofing</a>
      <a href="${shop}/collections/security-fencing-v-mesh-kits">V Mesh Fencing / Gates</a>
      <a href="${shop}/pages/contact">More</a>
    </nav>
    <div class="ticker"><div class="ticker-track"><span>${phrase}${phrase}</span><span>${phrase}${phrase}</span></div></div>
  </div>`;
}

function renderBanners() {
  let html = "";
  if (ui.notice) html += `<p class="ok">${esc(ui.notice)} <button type="button" class="text-btn" data-action="dismiss-notice">Dismiss</button></p>`;
  if (config.meta && config.meta.sample) {
    html += `<p class="banner"><strong>Sample products.</strong> Prices and names are examples. Use Edit products & prices to replace them.</p>`;
  }
  if (usingSavedCatalogue) {
    html += `<p class="banner"><strong>Using edits saved in this browser.</strong> They override config.js until you reset them.</p>`;
  }
  return html;
}

function renderQuotePage() {
  const roofPage = pageMode() === "roof";
  const title = roofPage ? "Roofing quote" : "Other calculators";
  const lede = roofPage
    ? "Choose the roof shape, then the sheet, the thickness, and the colour, then enter the size."
    : "Decking, cladding, fencing, paving, kerbs, and the other size calculators.";
  const otherLink = roofPage
    ? `<a href="other.html">Other calculators</a>`
    : `<a href="index.html">Roofing calculator</a>`;
  return `${renderHeader()}
    <section class="calc-intro">
      <h1>${esc(title)}</h1>
      <p>${esc(lede)}</p>
      <p class="proto-links no-print">${otherLink}<button type="button" data-action="view" data-view="edit">Edit products &amp; prices</button></p>
    </section>
    <div class="wrap no-print">${renderBanners()}</div>
    <div class="layout">
      ${renderStepNav()}
      ${renderSteps()}
    </div>
    <div class="wrap"><p class="foot no-print">${esc(config.copy.footer || "")}</p></div>
    <div class="mobile-total no-print">
      <div><span>Total (inc. VAT)</span><strong>${money(lastCalc.totals.incVat)}</strong></div>
      <button type="button" data-action="clear-basket">Clear basket</button>
    </div>
    ${renderModal()}`;
}

function customerFields() {
  return `<label class="field" for="cust-name"><span>Full name</span><input id="cust-name" data-action="customer" data-field="name" value="${esc(quote.customer.name)}" autocomplete="name" required></label>
    <label class="field" for="cust-email"><span>Email address</span><input id="cust-email" data-action="customer" data-field="email" value="${esc(quote.customer.email)}" autocomplete="email" required></label>
    <label class="field" for="cust-phone"><span>Telephone</span><input id="cust-phone" data-action="customer" data-field="phone" value="${esc(quote.customer.phone)}" autocomplete="tel"></label>`;
}

function renderModal() {
  if (!ui.modal) return "";
  if (ui.modal === "start") {
    return `<div class="overlay no-print"><div class="modal" role="dialog" aria-modal="true">
      <h2>Start over?</h2>
      <p>This clears the measurements and choices on this quote. Your product catalogue stays as it is.</p>
      <div class="row-actions"><button type="button" class="primary" data-action="start-over">Yes</button><button type="button" class="ghost" data-action="close-modal">Cancel</button></div>
    </div></div>`;
  }
  if (ui.modal === "save") {
    const done = ui.saveDone
      ? `<p class="ok">Quote saved in this browser.</p><label class="field" for="saved-link"><span>Link</span><input id="saved-link" readonly value="${esc(ui.savedLink)}"></label><p class="muted">This link only reopens the quote on this computer and browser.</p>`
      : `<form data-action="save-quote">${customerFields()}<p class="err">${esc(ui.modalError)}</p><button type="submit" class="primary">Save quote</button></form>`;
    return `<div class="overlay no-print"><div class="modal" role="dialog" aria-modal="true"><h2>Save your quote</h2>${done}<button type="button" class="ghost" data-action="close-modal">Close</button></div></div>`;
  }
  if (ui.modal === "email") {
    return `<div class="overlay no-print"><div class="modal" role="dialog" aria-modal="true">
      <h2>Email your quote</h2>
      <p class="muted">This opens your email app with the quote written out. It does not send email by itself.</p>
      <form data-action="email-quote">
        ${customerFields()}
        <p class="err">${esc(ui.modalError)}</p>
        <div class="row-actions">
          <button type="submit" class="primary" data-target="customer">Email quote to customer</button>
          <button type="submit" class="ghost" data-target="business">Email quote to business</button>
        </div>
      </form>
      <button type="button" class="text-btn" data-action="close-modal">Close</button>
    </div></div>`;
  }
  return "";
}

function textField(path, label, value) {
  const id = fieldId(path);
  return `<label class="field" for="${id}"><span>${esc(label)}</span><input id="${id}" data-action="cfg" data-path="${esc(path)}" value="${esc(value ?? "")}"></label>`;
}

function numField(path, label, value) {
  const id = fieldId(path);
  return `<label class="field" for="${id}"><span>${esc(label)}</span><input id="${id}" data-action="cfg" data-kind="number" data-path="${esc(path)}" value="${esc(value ?? "")}" inputmode="decimal"></label>`;
}

function areaField(path, label, value) {
  const id = fieldId(path);
  return `<label class="field" for="${id}"><span>${esc(label)}</span><textarea id="${id}" data-action="cfg" data-path="${esc(path)}">${esc(value ?? "")}</textarea></label>`;
}

function checkField(path, label, value) {
  const id = fieldId(path);
  return `<label class="check" for="${id}"><input id="${id}" type="checkbox" data-action="cfg" data-kind="bool" data-path="${esc(path)}" ${value ? "checked" : ""}><span>${esc(label)}</span></label>`;
}

function imageEditor(path, src) {
  const fileId = fieldId(path + "_file");
  const preview = safeSrc(src) ? `<img src="${esc(safeSrc(src))}" alt="">` : `<span class="letter">+</span>`;
  return `<div class="image-edit"><div class="ph-box">${preview}</div>${textField(path, "Image link or file name", src || "")}<label class="file-btn" for="${fileId}">Upload image<input id="${fileId}" type="file" accept="image/*" data-action="upload" data-path="${esc(path)}"></label><p class="muted">Or type images/your-photo.jpg and keep that file in an images folder.</p></div>`;
}

function itemTools(listPath, index, factory) {
  return `<div class="item-tools">
    <button type="button" data-action="move-item" data-list-path="${esc(listPath)}" data-index="${index}" data-dir="-1">Up</button>
    <button type="button" data-action="move-item" data-list-path="${esc(listPath)}" data-index="${index}" data-dir="1">Down</button>
    <button type="button" data-action="duplicate-item" data-list-path="${esc(listPath)}" data-index="${index}" data-factory="${esc(factory)}">Duplicate</button>
    <button type="button" class="danger" data-action="remove-item" data-list-path="${esc(listPath)}" data-index="${index}">Remove</button>
  </div>`;
}

function addButton(listPath, factory, label) {
  return `<button type="button" class="add-btn" data-action="add-item" data-list-path="${esc(listPath)}" data-factory="${esc(factory)}">${esc(label)}</button>`;
}

function renderStepsEditor() {
  return (config.steps || []).map((step, index) => {
    const kind = step.kind || step.id;
    const builtin = kind !== "custom";
    const remove = kind === "custom"
      ? `<button type="button" class="danger" data-action="remove-item" data-list-path="steps" data-index="${index}">Remove</button>`
      : "";
    const duplicate = kind === "custom"
      ? `<button type="button" data-action="duplicate-item" data-list-path="steps" data-index="${index}" data-factory="custom">Duplicate</button>`
      : "";
    return `<article class="editor-card">
      <div class="item-tools">
        <button type="button" data-action="move-item" data-list-path="steps" data-index="${index}" data-dir="-1">Up</button>
        <button type="button" data-action="move-item" data-list-path="steps" data-index="${index}" data-dir="1">Down</button>
        ${duplicate}
        ${remove}
      </div>
      <p class="muted">${builtin ? `Built-in step · ${esc(kind)}` : "Custom step"}</p>
      <div class="editor-grid">
        ${textField(`steps.${index}.title`, "Title", step.title)}
        ${textField(`steps.${index}.hint`, "Short hint", step.hint)}
      </div>
      ${kind === "custom" ? areaField(`steps.${index}.body`, "Text shown on the step", step.body) : ""}
      ${checkField(`steps.${index}.enabled`, "Show this step", step.enabled !== false)}
      ${kind === "export" ? "" : checkField(`steps.${index}.required`, "Required before send", !!step.required)}
    </article>`;
  }).join("");
}

function renderEditorPage() {
  const stockValue = ui.stockDraft != null ? ui.stockDraft : (config.rules.stockLengthsM || []).join(", ");
  const roofs = config.roofTypes.map((roof, index) => `<article class="editor-card">
      ${itemTools("roofTypes", index, "roof")}
      <div class="editor-grid">
        ${textField(`roofTypes.${index}.name`, "Name", roof.name)}
        ${areaField(`roofTypes.${index}.blurb`, "Description", roof.blurb)}
      </div>
      ${imageEditor(`roofTypes.${index}.image`, roof.image)}
      ${checkField(`roofTypes.${index}.includeApex`, "Ask for apex measurements", roof.includeApex)}
      ${checkField(`roofTypes.${index}.includeMono`, "Ask for single slope measurements", roof.includeMono)}
      ${checkField(`roofTypes.${index}.apexRidge`, "Uses an apex ridge", roof.apexRidge)}
      ${checkField(`roofTypes.${index}.monoRidge`, "Uses a mono ridge", roof.monoRidge)}
      ${checkField(`roofTypes.${index}.abutment`, "Uses abutment flashings", roof.abutment)}
    </article>`).join("");

  const profiles = config.profiles.map((profile, index) => `<article class="editor-card">
      ${itemTools("profiles", index, "profile")}
      <div class="editor-grid">
        ${textField(`profiles.${index}.name`, "Profile name", profile.name)}
        ${numField(`profiles.${index}.coverWidthM`, "Cover width (m)", profile.coverWidthM)}
      </div>
      ${checkField(`profiles.${index}.allowsDripstop`, "Anti-condensation liner can be used", profile.allowsDripstop)}
      ${imageEditor(`profiles.${index}.image`, profile.image)}
      <h3>Finishes</h3>
      ${(profile.finishes || []).map((finish, fin) => `<div class="editor-card">
        ${itemTools(`profiles.${index}.finishes`, fin, "finish")}
        <div class="editor-grid">
          ${textField(`profiles.${index}.finishes.${fin}.name`, "Finish", finish.name)}
          ${numField(`profiles.${index}.finishes.${fin}.pricePerMetre`, "Price per metre", finish.pricePerMetre)}
        </div>
        ${checkField(`profiles.${index}.finishes.${fin}.allowsDripstop`, "Liner available with this finish", finish.allowsDripstop)}
      </div>`).join("")}
      ${addButton(`profiles.${index}.finishes`, "finish", "Add finish")}
      <h3>Colours</h3>
      ${(profile.colours || []).map((colour, colourIndex) => `<div class="editor-card">
        ${itemTools(`profiles.${index}.colours`, colourIndex, "colour")}
        <div class="editor-grid">
          ${textField(`profiles.${index}.colours.${colourIndex}.name`, "Colour", colour.name)}
          ${textField(`profiles.${index}.colours.${colourIndex}.hex`, "Swatch colour", colour.hex)}
        </div>
        <input type="color" data-action="cfg" data-path="profiles.${index}.colours.${colourIndex}.hex" value="${safeHex(colour.hex)}" aria-label="Pick colour">
        ${imageEditor(`profiles.${index}.colours.${colourIndex}.image`, colour.image)}
      </div>`).join("")}
      ${addButton(`profiles.${index}.colours`, "colour", "Add colour")}
      <h3>Rooflights</h3>
      ${simplePricedList(`profiles.${index}.rooflights`, profile.rooflights, "rooflight", "Price per metre", "pricePerMetre")}
      <h3>Barge flashings</h3>
      ${flashingEditorList(`profiles.${index}.barges`, profile.barges, "barge")}
      <h3>Ridge flashings</h3>
      ${(profile.ridges || []).map((ridge, ridgeIndex) => `<div class="editor-card">
        ${itemTools(`profiles.${index}.ridges`, ridgeIndex, "ridge")}
        <div class="editor-grid">
          ${textField(`profiles.${index}.ridges.${ridgeIndex}.name`, "Name", ridge.name)}
          ${numField(`profiles.${index}.ridges.${ridgeIndex}.pieceLengthM`, "Piece length (m)", ridge.pieceLengthM)}
          ${numField(`profiles.${index}.ridges.${ridgeIndex}.price`, "Price each", ridge.price)}
        </div>
        <label class="field"><span>Used on</span><select data-action="cfg" data-path="profiles.${index}.ridges.${ridgeIndex}.kind">
          <option value="apex"${ridge.kind === "apex" ? " selected" : ""}>Apex ridge</option>
          <option value="mono"${ridge.kind === "mono" ? " selected" : ""}>Mono ridge</option>
        </select></label>
        ${imageEditor(`profiles.${index}.ridges.${ridgeIndex}.image`, ridge.image)}
      </div>`).join("")}
      ${addButton(`profiles.${index}.ridges`, "ridge", "Add ridge")}
      <h3>Abutment flashings</h3>
      ${flashingEditorList(`profiles.${index}.abutments`, profile.abutments, "abutment")}
    </article>`).join("");

  return `${renderHeader()}
    <div class="wrap editor-page">
      <div class="editor-bar">
        <strong>Catalogue</strong>
        <div class="row-actions">
          <button type="button" class="ghost" data-action="view" data-view="quote">Back to calculator</button>
          <button type="button" class="ghost" data-action="download-catalogue">Download backup</button>
          <label class="file-btn">Import<input type="file" accept=".js,.json,application/json" data-action="import-catalogue"></label>
          <button type="button" class="ghost" data-action="export-excel">Export to Excel</button>
          <button type="button" class="ghost" data-action="reset-catalogue">Reset saved edits</button>
        </div>
      </div>
      ${ui.storageError ? `<p class="err">${esc(ui.storageError)}</p>` : ""}
      <p>Change names, prices, and photos here. What you save stays in this browser. Download a backup so you do not lose it. You can also edit <strong>config.js</strong> in this folder. If you do that, reload the page and click Reset saved edits when a browser copy is still in use.</p>
      <section class="editor-section"><h2>Business</h2><div class="editor-card"><div class="editor-grid">
        ${textField("company.name", "Company name", config.company.name)}
        ${textField("company.phone", "Phone", config.company.phone)}
        ${textField("company.email", "Email", config.company.email)}
        ${textField("company.currencySymbol", "Currency symbol", config.company.currencySymbol)}
        ${numField("company.vatPercent", "VAT %", config.company.vatPercent)}
        ${textField("copy.headline", "Main heading", config.copy.headline)}
        ${areaField("copy.subheading", "Introduction", config.copy.subheading)}
      </div>
      ${imageEditor("company.logo", config.company.logo)}
      <div class="editor-grid">
        ${textField("theme.accent", "Accent colour", config.theme.accent)}
        ${textField("theme.ink", "Header colour", config.theme.ink)}
      </div></div></section>
      <section class="editor-section"><h2>Calculation rules</h2><div class="editor-card">
        <label class="field" for="stock-lengths"><span>Stock sheet lengths (m)</span><input id="stock-lengths" data-action="stock" value="${esc(stockValue)}"></label>
        ${ui.stockError ? `<p class="err">${esc(ui.stockError)}</p>` : ""}
        <div class="editor-grid">
          ${numField("rules.flashingOverlapM", "Flashing overlap (m)", config.rules.flashingOverlapM)}
          ${numField("rules.vergeRunsPerSlope", "Barge edges per slope", config.rules.vergeRunsPerSlope)}
          ${numField("rules.fixingsPerM2", "Screws per m²", config.rules.fixingsPerM2)}
          ${numField("rules.stitchersPerFlashing", "Stitchers per flashing piece", config.rules.stitchersPerFlashing)}
        </div>
        <p class="muted">Sheet price is the finish price per metre multiplied by the stock length. Sheet count is the eaves length divided by the cover width, rounded up.</p>
      </div></section>
      <section class="editor-section"><h2>Roof types</h2>${roofs}${addButton("roofTypes", "roof", "Add roof type")}</section>
      <section class="editor-section"><h2>Profiles</h2><p class="muted">Cover width is how many metres of roof one sheet covers. Copy a profile with Duplicate when you add another sheet.</p>${profiles}${addButton("profiles", "profile", "Add profile")}</section>
      <section class="editor-section"><h2>Dripstop</h2><div class="editor-card">
        ${textField("dripstop.name", "Name", config.dripstop.name)}
        ${numField("dripstop.pricePerMetre", "Price per metre", config.dripstop.pricePerMetre)}
        ${imageEditor("dripstop.image", config.dripstop.image)}
      </div></section>
      <section class="editor-section"><h2>Fixings</h2>${variantProductList("fixings", config.fixings, "fixing", true)}</section>
      <section class="editor-section"><h2>Additional items</h2>${variantProductList("extras", config.extras, "extra", false)}</section>
      <section class="editor-section"><h2>Steps</h2>
        <p class="muted">Rename, reorder, or hide steps. Required steps must be completed before the quote can be emailed or added to the basket. Built-in steps keep their calculator. Custom steps are a title, some text, and an answer box.</p>
        ${renderStepsEditor()}
        ${addButton("steps", "custom", "Add a custom step")}
      </section>
      <section class="editor-section"><h2>Wording</h2><div class="editor-card">
        ${Object.keys(originalConfig.copy).filter((key) => key !== "headline" && key !== "subheading").map((key) => areaField(`copy.${key}`, key, config.copy[key])).join("")}
        ${Object.keys(config.measureFields).map((key) => `${textField(`measureFields.${key}.label`, key + " label", config.measureFields[key].label)}${areaField(`measureFields.${key}.help`, key + " help", config.measureFields[key].help)}`).join("")}
      </div></section>
    </div>`;
}

function simplePricedList(listPath, items, factory, priceLabel, priceKey) {
  const rows = (items || []).map((item, index) => `<div class="editor-card">
    ${itemTools(listPath, index, factory)}
    <div class="editor-grid">
      ${textField(`${listPath}.${index}.name`, "Name", item.name)}
      ${numField(`${listPath}.${index}.${priceKey}`, priceLabel, item[priceKey])}
    </div>
    ${imageEditor(`${listPath}.${index}.image`, item.image)}
  </div>`).join("");
  const label = factory === "rooflight" ? "Add rooflight" : "Add item";
  return rows + addButton(listPath, factory, label);
}

function flashingEditorList(listPath, items, factory) {
  const rows = (items || []).map((item, index) => `<div class="editor-card">
    ${itemTools(listPath, index, factory)}
    <div class="editor-grid">
      ${textField(`${listPath}.${index}.name`, "Name", item.name)}
      ${numField(`${listPath}.${index}.pieceLengthM`, "Piece length (m)", item.pieceLengthM)}
      ${numField(`${listPath}.${index}.price`, "Price each", item.price)}
    </div>
    ${imageEditor(`${listPath}.${index}.image`, item.image)}
  </div>`).join("");
  return rows + addButton(listPath, factory, "Add flashing");
}

function variantProductList(listKey, items, factory, showRecommend) {
  const rows = (items || []).map((product, index) => {
    const path = `${listKey}.${index}`;
    const recommend = showRecommend ? `<label class="field"><span>Suggestion</span><select data-action="cfg" data-path="${path}.recommend">
      <option value=""${product.recommend === "" || !product.recommend ? " selected" : ""}>None</option>
      <option value="fixings"${product.recommend === "fixings" ? " selected" : ""}>Main roof fixings</option>
      <option value="stitchers"${product.recommend === "stitchers" ? " selected" : ""}>Stitchers</option>
    </select></label>` : "";
    const checks = (config.profiles || []).map((profile) => `<label class="check"><input type="checkbox" data-action="profile-toggle" data-list-path="${esc(path)}" data-profile-id="${esc(profile.id)}" ${(product.profileIds || []).includes(profile.id) ? "checked" : ""}><span>${esc(profile.name)}</span></label>`).join("");
    const variants = (product.variants || []).map((variant, variantIndex) => `<div class="editor-grid">
      ${textField(`${path}.variants.${variantIndex}.name`, "Option", variant.name)}
      ${numField(`${path}.variants.${variantIndex}.price`, "Price", variant.price)}
      ${numField(`${path}.variants.${variantIndex}.packSize`, "Pieces per pack", variant.packSize)}
      <button type="button" class="text-btn danger" data-action="remove-item" data-list-path="${esc(path + ".variants")}" data-index="${variantIndex}">Remove option</button>
    </div>`).join("");
    return `<article class="editor-card">
      ${itemTools(listKey, index, factory)}
      ${textField(`${path}.name`, "Product name", product.name)}
      ${imageEditor(`${path}.image`, product.image)}
      ${recommend}
      <p class="muted">Tick a profile to limit where this appears. Leave them all unticked to show it every time.</p>
      ${checks}
      <h3>Options</h3>
      ${variants}
      ${addButton(`${path}.variants`, "variant", "Add option")}
    </article>`;
  }).join("");
  return rows + addButton(listKey, factory, factory === "fixing" ? "Add fixing" : "Add item");
}

function render() {
  try {
    applyPageMode();
    normalizeQuote();
    applyTheme();
    document.title = (config.copy && config.copy.headline) || "Roofing Quote Calculator";
    document.body.className = ui.view === "edit" ? "is-edit" : "is-quote";
    if (ui.view === "quote") {
      syncJobChoice();
      lastCalc = calculate(metricQuote(), config);
    }
    if (pendingScroll && pendingScroll !== "summary") ui.navStep = pendingScroll;
    const y = pendingScroll ? null : window.scrollY;
    document.getElementById("app").innerHTML = ui.view === "edit" ? renderEditorPage() : renderQuotePage();
    restoreFocus();
    if (pendingScroll) {
      const target = pendingScroll;
      pendingScroll = null;
      const el = document.getElementById(target) || document.querySelector(`[data-step-anchor="${target}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (y != null) {
      window.scrollTo(0, y);
    }
    try { localStorage.setItem(draftKey(), JSON.stringify(quote)); } catch (err) { /* keep going */ }
  } catch (err) {
    console.error(err);
    document.getElementById("app").innerHTML = `<div class="wrap fatal"><h1>The calculator hit an error</h1><p>${esc(err.message)}</p><button type="button" class="primary" data-action="reset-catalogue">Reset saved edits</button></div>`;
  }
}

function restoreFocus() {
  if (!focusSnapshot) return;
  const snap = focusSnapshot;
  focusSnapshot = null;
  const el = document.getElementById(snap.id);
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
    if (snap.start != null && el.setSelectionRange) el.setSelectionRange(snap.start, snap.end);
  } catch (err) { /* ignore */ }
}

function rememberFocus(el) {
  if (!el || !el.id) return;
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
  if (["checkbox", "radio", "file", "color"].includes(el.type)) return;
  focusSnapshot = { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}

function touchCatalogue() {
  config.meta = config.meta || {};
  config.meta.sample = false;
  usingSavedCatalogue = true;
  saveCatalogue();
}

function blankFinish() {
  return { id: uid("finish"), name: "New finish", pricePerMetre: 0, allowsDripstop: true };
}
function blankColour() {
  return { id: uid("colour"), name: "New colour", hex: "#8a8f98", image: "" };
}
function blankRooflight() {
  return { id: uid("light"), name: "New rooflight", pricePerMetre: 0, image: "" };
}
function blankFlashing(kind) {
  const item = { id: uid("flash"), name: "New flashing", pieceLengthM: 3, price: 0, image: "" };
  if (kind) item.kind = kind;
  return item;
}
function blankProfile() {
  return tidyProfile({
    id: uid("profile"),
    name: "New profile",
    coverWidthM: 1,
    image: "",
    allowsDripstop: true,
    finishes: [blankFinish()],
    colours: [blankColour()],
    rooflights: [],
    barges: [],
    ridges: [],
    abutments: [],
  });
}
function blankRoof() {
  return {
    id: uid("roof"),
    name: "New roof type",
    blurb: "Describe this roof.",
    image: "",
    includeApex: true,
    includeMono: false,
    apexRidge: true,
    monoRidge: false,
    abutment: false,
  };
}
function blankVariantProduct() {
  return tidyVariantProduct({
    id: uid("item"),
    name: "New product",
    image: "",
    recommend: "",
    profileIds: [],
    variants: [{ id: uid("var"), name: "Standard", price: 0, packSize: 1 }],
  });
}

function factoryItem(factory) {
  if (factory === "roof") return blankRoof();
  if (factory === "profile") return blankProfile();
  if (factory === "finish") return blankFinish();
  if (factory === "colour") return blankColour();
  if (factory === "rooflight") return blankRooflight();
  if (factory === "barge" || factory === "abutment") return blankFlashing();
  if (factory === "ridge") return blankFlashing("apex");
  if (factory === "fixing" || factory === "extra") return blankVariantProduct();
  if (factory === "variant") return { id: uid("var"), name: "New option", price: 0, packSize: 1 };
  if (factory === "custom") {
    return { id: uid("step"), kind: "custom", title: "New step", hint: "", body: "Add your own instructions here.", enabled: true, required: false };
  }
  return null;
}

function stampIds(item, factory) {
  item.id = uid("id");
  if (factory === "profile") {
    ["finishes", "colours", "rooflights", "barges", "ridges", "abutments"].forEach((key) => {
      (item[key] || []).forEach((child) => { child.id = uid("id"); });
    });
  }
  if (Array.isArray(item.variants)) item.variants.forEach((variant) => { variant.id = uid("var"); });
}

function forgetId(id) {
  ["roofTypeId", "profileId", "finishId", "colourId", "rooflightId", "bargeId", "ridgeApexId", "ridgeMonoId", "abutmentId"].forEach((field) => {
    if (quote[field] === id) quote[field] = null;
  });
  if (quote.picks) delete quote.picks[id];
  if (quote.customNotes) delete quote.customNotes[id];
}

function ensurePick(id) {
  const product = findSellable(id);
  if (!product) return null;
  if (!quote.picks[id]) quote.picks[id] = { variantId: product.variants[0].id, qty: 0 };
  if (!product.variants.some((item) => item.id === quote.picks[id].variantId)) {
    quote.picks[id].variantId = product.variants[0].id;
  }
  return product;
}

function nextStepId(afterId) {
  const ids = visibleSteps().map((step) => step.id);
  const at = ids.indexOf(afterId);
  return at >= 0 ? ids[at + 1] || "" : "";
}

function goNext(id) {
  const next = nextStepId(id);
  if (!next) return;
  ui.closed[next] = false;
  pendingScroll = next;
  render();
}

function requireReady() {
  lastCalc = calculate(metricQuote(), config);
  if (lastCalc.quoteReady && !customMissing().length) return true;
  ui.showErrors = true;
  ui.added = false;
  const first = allErrors()[0];
  if (first) {
    ui.closed[first.step] = false;
    pendingScroll = first.step;
  }
  render();
  return false;
}

function makeRef() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Q${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function buildQuoteText() {
  const result = calculate(quote, config);
  const lines = [];
  lines.push(config.company.name || "Quote");
  if (config.company.phone) lines.push(config.company.phone);
  if (config.company.email) lines.push(config.company.email);
  lines.push("");
  lines.push(config.copy.headline || "Quote");
  if (quote.ref) lines.push("Reference: " + quote.ref);
  lines.push(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
  lines.push("");
  if (quote.customer.name) lines.push("Name: " + quote.customer.name);
  if (quote.customer.email) lines.push("Email: " + quote.customer.email);
  if (quote.customer.phone) lines.push("Phone: " + quote.customer.phone);
  if (result.overview.length) {
    lines.push("");
    result.overview.forEach((row) => lines.push(row));
  }
  lines.push("");
  if (!result.lines.length) lines.push("No materials yet.");
  result.lines.forEach((line) => {
    lines.push(`${line.qtyLabel} × ${money(line.unitPrice)} = ${money(line.total)}`);
    lines.push(line.name);
    if (line.detail) lines.push(line.detail);
    lines.push("");
  });
  lines.push("Subtotal (ex. VAT): " + money(result.totals.exVat));
  lines.push(`VAT (${trimNum(result.totals.vatPercent)}%): ${money(result.totals.vat)}`);
  lines.push("Total (inc. VAT): " + money(result.totals.incVat));
  if (String(quote.notes || "").trim()) {
    lines.push("");
    lines.push("Notes:");
    lines.push(quote.notes.trim());
  }
  lines.push("");
  lines.push(config.copy.disclaimer || "");
  return lines.join("\n");
}

function quoteSubject() {
  return `${config.company.name || "Quote"} ${quote.ref || ""}`.trim();
}

function parseStock(text) {
  const parts = String(text).split(/[, ]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const nums = parts.map((part) => Number(String(part).replace(",", ".")));
  if (nums.some((n) => !(n > 0))) return null;
  return nums;
}

function parseCatalogueText(text) {
  const trimmed = String(text || "").trim().replace(/^\uFEFF/, "");
  let json = trimmed;
  if (!trimmed.startsWith("{")) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("No catalogue found in that file.");
    json = trimmed.slice(start, end + 1);
  }
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.profiles) || !Array.isArray(data.roofTypes)) {
    throw new Error("That file is not a catalogue from this calculator.");
  }
  return data;
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 720;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

function imageCell(src) {
  const value = String(src || "");
  if (!value) return "";
  if (value.startsWith("data:")) return "(uploaded image)";
  return value;
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function excelSheet(name, rows) {
  const safe = String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
  const body = rows.map((row) => `<Row>${row.map((cell) => {
    if (typeof cell === "number" && Number.isFinite(cell)) return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`;
  }).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${xmlEscape(safe)}"><Table>${body}</Table></Worksheet>`;
}

function cellNum(raw) {
  const n = val(raw);
  return Number.isFinite(n) ? n : "";
}

function downloadExcel() {
  const result = calculate(quote, config);
  const type = currentType();
  const profile = currentProfile();
  const finish = profile && (profile.finishes || []).find((item) => item.id === quote.finishId);
  const colour = profile && (profile.colours || []).find((item) => item.id === quote.colourId);
  const light = profile && (profile.rooflights || []).find((item) => item.id === quote.rooflightId);
  const named = (list, id) => {
    const found = (list || []).find((item) => item.id === id);
    return found ? found.name : "";
  };
  const yesNo = (value) => (value ? "Yes" : "No");
  const sheets = [];

  sheets.push(excelSheet("Quote", [
    ["Field", "Value"],
    ["Company", config.company.name || ""],
    ["Phone", config.company.phone || ""],
    ["Email", config.company.email || ""],
    ["Reference", quote.ref || ""],
    ["Date", new Date().toLocaleString("en-GB")],
    ["Customer name", quote.customer.name || ""],
    ["Customer email", quote.customer.email || ""],
    ["Customer phone", quote.customer.phone || ""],
    ["Roof type", type ? type.name : ""],
    ["Profile", profile ? profile.name : ""],
    ["Finish", finish ? finish.name : ""],
    ["Colour", colour ? colour.name : ""],
    ["Dripstop added", yesNo(quote.dripstopOn && result.dripstop.allowed)],
    ["Dripstop metres", result.dripstop.metres || 0],
    ["Rooflight", light ? light.name : ""],
    ["Rooflights apex side 1", Number(quote.rooflightQty.s1) || 0],
    ["Rooflights apex side 2", Number(quote.rooflightQty.s2) || 0],
    ["Rooflights single slope", Number(quote.rooflightQty.m) || 0],
    ["Barge", named(profile && profile.barges, quote.bargeId)],
    ["Apex ridge", named(profile && profile.ridges, quote.ridgeApexId)],
    ["Mono ridge", named(profile && profile.ridges, quote.ridgeMonoId)],
    ["Abutment", named(profile && profile.abutments, quote.abutmentId)],
    ["Notes", quote.notes || ""],
    ["Plan area m2", round2(result.planArea)],
    ["Sheet area m2", round2(result.sheetArea)],
    ["Subtotal ex VAT", result.totals.exVat],
    ["VAT percent", result.totals.vatPercent],
    ["VAT", result.totals.vat],
    ["Total inc VAT", result.totals.incVat],
  ].concat((result.overview || []).map((line, index) => [index === 0 ? "Overview" : "", line]))));

  sheets.push(excelSheet("Measurements", [
    ["Field", "Value"],
    ["Side 2 matches side 1", yesNo(quote.apexSame)],
    ["Apex A length side 1 m", cellNum(quote.apexA)],
    ["Apex B span m", cellNum(quote.apexB)],
    ["Apex C eave to ridge m", cellNum(quote.apexC)],
    ["Apex D length side 2 m", cellNum(quote.apexSame ? quote.apexA : quote.apexD)],
    ["Single slope A length m", cellNum(quote.monoA)],
    ["Single slope B span m", cellNum(quote.monoB)],
    ["Single slope C eave to ridge m", cellNum(quote.monoC)],
  ].concat((result.slopes || []).flatMap((slope) => [
    [`${slope.label} sheets`, slope.sheets == null ? "" : slope.sheets],
    [`${slope.label} ordered length m`, slope.ordered],
    [`${slope.label} metal sheets`, slope.metal == null ? "" : slope.metal],
    [`${slope.label} rooflights`, slope.rooflights],
  ]))));

  const materials = [["Section", "Item", "Detail", "Quantity", "Unit price", "Line total"]];
  if (!result.lines.length) materials.push(["", "No materials yet", "", "", "", ""]);
  result.lines.forEach((line) => {
    materials.push([line.section || "", line.name || "", line.detail || "", line.qtyLabel || "", line.unitPrice, line.total]);
  });
  sheets.push(excelSheet("Materials", materials));

  const answers = [["Step", "Required", "Answer"]];
  (config.steps || []).filter((step) => step.kind === "custom").forEach((step) => {
    answers.push([step.title || "", yesNo(!!step.required), (quote.customNotes || {})[step.id] || ""]);
  });
  if (answers.length === 1) answers.push(["", "", "No custom steps"]);
  sheets.push(excelSheet("Custom answers", answers));

  sheets.push(excelSheet("Steps", [["Order", "Title", "Kind", "Shown", "Required", "Hint", "Text"]].concat((config.steps || []).map((step, index) => [
    index + 1,
    step.title || "",
    step.kind || "",
    yesNo(step.enabled !== false),
    yesNo(!!step.required),
    step.hint || "",
    step.body || "",
  ]))));

  sheets.push(excelSheet("Roof types", [["Name", "Description", "Apex measurements", "Single slope", "Apex ridge", "Mono ridge", "Abutment", "Image"]].concat((config.roofTypes || []).map((roof) => [
    roof.name || "",
    roof.blurb || "",
    yesNo(roof.includeApex),
    yesNo(roof.includeMono),
    yesNo(roof.apexRidge),
    yesNo(roof.monoRidge),
    yesNo(roof.abutment),
    imageCell(roof.image),
  ]))));

  const finishRows = [["Profile", "Finish", "Price per metre", "Liner available"]];
  const colourRows = [["Profile", "Colour", "Swatch", "Image"]];
  const lightRows = [["Profile", "Rooflight", "Price per metre", "Image"]];
  const flashRows = [["Profile", "Group", "Name", "Kind", "Piece length m", "Price each", "Image"]];
  (config.profiles || []).forEach((item) => {
    (item.finishes || []).forEach((finishItem) => finishRows.push([item.name, finishItem.name || "", Number(finishItem.pricePerMetre) || 0, yesNo(finishItem.allowsDripstop !== false)]));
    (item.colours || []).forEach((colourItem) => colourRows.push([item.name, colourItem.name || "", colourItem.hex || "", imageCell(colourItem.image)]));
    (item.rooflights || []).forEach((lightItem) => lightRows.push([item.name, lightItem.name || "", Number(lightItem.pricePerMetre) || 0, imageCell(lightItem.image)]));
    (item.barges || []).forEach((flash) => flashRows.push([item.name, "Barge", flash.name || "", "", Number(flash.pieceLengthM) || 0, Number(flash.price) || 0, imageCell(flash.image)]));
    (item.ridges || []).forEach((flash) => flashRows.push([item.name, "Ridge", flash.name || "", flash.kind || "", Number(flash.pieceLengthM) || 0, Number(flash.price) || 0, imageCell(flash.image)]));
    (item.abutments || []).forEach((flash) => flashRows.push([item.name, "Abutment", flash.name || "", "", Number(flash.pieceLengthM) || 0, Number(flash.price) || 0, imageCell(flash.image)]));
  });
  sheets.push(excelSheet("Profiles", [["Name", "Cover width m", "Liner available", "Image"]].concat((config.profiles || []).map((item) => [
    item.name || "",
    Number(item.coverWidthM) || 0,
    yesNo(item.allowsDripstop !== false),
    imageCell(item.image),
  ]))));
  sheets.push(excelSheet("Finishes", finishRows));
  sheets.push(excelSheet("Colours", colourRows));
  sheets.push(excelSheet("Rooflights", lightRows));
  sheets.push(excelSheet("Flashings", flashRows));
  sheets.push(excelSheet("Dripstop", [
    ["Name", "Price per metre", "Image"],
    [config.dripstop.name || "", Number(config.dripstop.pricePerMetre) || 0, imageCell(config.dripstop.image)],
  ]));

  const optionRows = (products, label) => {
    const rows = [[label, "Option", "Price", "Pieces per pack", "Suggestion", "Limit to profiles", "Image"]];
    (products || []).forEach((product) => {
      const limit = (product.profileIds || []).map((id) => {
        const match = (config.profiles || []).find((item) => item.id === id);
        return match ? match.name : id;
      }).join(", ");
      (product.variants || []).forEach((variant) => {
        rows.push([
          product.name || "",
          variant.name || "",
          Number(variant.price) || 0,
          Number(variant.packSize) || 1,
          product.recommend || "",
          limit,
          imageCell(product.image),
        ]);
      });
    });
    return rows;
  };
  sheets.push(excelSheet("Fixings", optionRows(config.fixings, "Fixing")));
  sheets.push(excelSheet("Extras", optionRows(config.extras, "Item")));
  sheets.push(excelSheet("Rules", [
    ["Rule", "Value"],
    ["Stock lengths m", (config.rules.stockLengthsM || []).join(", ")],
    ["Flashing overlap m", Number(config.rules.flashingOverlapM) || 0],
    ["Barge edges per slope", Number(config.rules.vergeRunsPerSlope) || 0],
    ["Screws per m2", Number(config.rules.fixingsPerM2) || 0],
    ["Stitchers per flashing", Number(config.rules.stitchersPerFlashing) || 0],
    ["VAT percent", Number(config.company.vatPercent) || 0],
    ["Currency", config.company.currencySymbol || ""],
  ]));

  const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join("")}</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `roof-quote-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  ui.notice = "Excel file downloaded. Open it in Excel.";
  render();
}

function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el || el.matches("input, textarea, select")) return;
  const action = el.dataset.action;
  if (action === "view") {
    ui.view = el.dataset.view === "edit" ? "edit" : "quote";
    pendingScroll = null;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (action === "slope-help") {
    ui.slopeHelp = ui.slopeHelp === el.dataset.mode ? null : el.dataset.mode;
    render();
    return;
  }
  if (action === "use-slope") {
    const mode = el.dataset.mode;
    quote[mode === "apex" ? "apexC" : "monoC"] = el.dataset.value;
    ui.slopeHelp = null;
    ui.added = false;
    render();
    return;
  }
  if (action === "units") {
    setUnits(el.dataset.unit);
    ui.added = false;
    render();
    return;
  }
  if (action === "toggle-step") {
    ui.closed[el.dataset.step] = !ui.closed[el.dataset.step];
    render();
    return;
  }
  if (action === "next") {
    goNext(el.dataset.step);
    return;
  }
  if (action === "jump") {
    pendingScroll = el.dataset.target;
    render();
    return;
  }
  if (action === "select-job") {
    const nextId = el.dataset.id;
    if (quote.jobId !== nextId) {
      quote.jobId = nextId;
      quote.jobProductId = null;
      quote.jobVariantId = null;
      const job = currentJob();
      if (job && (job.products || []).length === 1) {
        quote.jobProductId = job.products[0].id;
        const options = jobOptions(job.products[0]);
        quote.jobVariantId = options.length ? options[0].id : null;
      }
    }
    ui.added = false;
    pendingScroll = nextStepId("job") || "size";
    render();
    return;
  }
  if (action === "select-job-product") {
    quote.jobProductId = el.dataset.id;
    const job = currentJob();
    const product = job && (job.products || []).find((item) => item.id === quote.jobProductId);
    const options = jobOptions(product);
    quote.jobVariantId = options.length ? options[0].id : null;
    ui.added = false;
    if (quote.jobId === "cladding") pendingScroll = "job-colour";
    render();
    return;
  }
  if (action === "select-job-colour") {
    quote.jobVariantId = el.dataset.id;
    ui.added = false;
    if (quote.jobId === "cladding") pendingScroll = "clad-wall";
    render();
    return;
  }
  if (action === "clad-shape") {
    quote.wallDraft.shape = el.dataset.value;
    ui.cladError = "";
    render();
    return;
  }
  if (action === "clad-orient") {
    quote.wallDraft.orientation = el.dataset.value;
    ui.cladError = "";
    render();
    return;
  }
  if (action === "clad-door") {
    quote.wallDraft.hasDoor = el.dataset.value === "yes";
    render();
    return;
  }
  if (action === "clad-back") {
    const order = ["shape", "direction", "measure", "openings"];
    const at = order.indexOf(ui.cladPhase);
    ui.cladPhase = order[Math.max(0, at - 1)] || "shape";
    ui.cladError = "";
    render();
    return;
  }
  if (action === "clad-next") {
    const draft = quote.wallDraft;
    if (ui.cladPhase === "shape") {
      if (!draft.shape) { ui.cladError = "Choose a wall type."; render(); return; }
      ui.cladPhase = "direction";
    } else if (ui.cladPhase === "direction") {
      if (!draft.orientation) { ui.cladError = "Choose vertical or horizontal."; render(); return; }
      ui.cladPhase = "measure";
    } else if (ui.cladPhase === "measure") {
      if (!wallDimsOk(draft)) { ui.cladError = "Enter the height and width in metres."; render(); return; }
      ui.cladPhase = "openings";
    }
    ui.cladError = "";
    render();
    return;
  }
  if (action === "clad-save") {
    saveCladWall();
    render();
    return;
  }
  if (action === "clad-window-add") {
    quote.wallDraft.windows.push({ id: uid("win"), h: "", w: "" });
    render();
    return;
  }
  if (action === "clad-window-remove") {
    quote.wallDraft.windows = (quote.wallDraft.windows || []).filter((win) => win.id !== el.dataset.id);
    render();
    return;
  }
  if (action === "clad-edit") {
    const wall = (quote.walls || []).find((item) => item.id === el.dataset.id);
    if (wall) quote.wallDraft = clone(wall);
    ui.cladPhase = "shape";
    ui.cladError = "";
    render();
    return;
  }
  if (action === "clad-remove") {
    quote.walls = (quote.walls || []).filter((item) => item.id !== el.dataset.id);
    ui.added = false;
    render();
    return;
  }
  if (action === "clad-add") {
    quote.wallDraft = blankWall();
    ui.cladPhase = "shape";
    ui.cladError = "";
    render();
    return;
  }
  if (action === "select-roof") {
    const changed = quote.roofTypeId !== el.dataset.id;
    quote.roofTypeId = el.dataset.id;
    ui.added = false;
    if (changed) pendingScroll = nextStepId("type") || "profile";
    render();
    return;
  }
  if (action === "select-profile") {
    const changed = quote.profileId !== el.dataset.id;
    quote.profileId = el.dataset.id;
    const profile = currentProfile();
    const has = (list, selected) => (list || []).some((item) => item.id === selected);
    if (profile) {
      if (!has(profile.finishes, quote.finishId)) quote.finishId = null;
      if (!has(profile.colours, quote.colourId)) quote.colourId = null;
      if (!has(profile.rooflights, quote.rooflightId)) quote.rooflightId = null;
      if (!has(profile.barges, quote.bargeId)) quote.bargeId = null;
      if (!has(profile.ridges, quote.ridgeApexId)) quote.ridgeApexId = null;
      if (!has(profile.ridges, quote.ridgeMonoId)) quote.ridgeMonoId = null;
      if (!has(profile.abutments, quote.abutmentId)) quote.abutmentId = null;
    }
    ui.added = false;
    if (changed) pendingScroll = "finish";
    render();
    return;
  }
  if (action === "select-finish") {
    quote.finishId = el.dataset.id;
    ui.added = false;
    pendingScroll = "colour";
    render();
    return;
  }
  if (action === "select-colour") {
    quote.colourId = el.dataset.id;
    ui.added = false;
    pendingScroll = nextStepId("colour") || "measure";
    render();
    return;
  }
  if (action === "toggle-dripstop") {
    if (lastCalc.dripstop.allowed) quote.dripstopOn = !quote.dripstopOn;
    ui.added = false;
    render();
    return;
  }
  if (action === "select-rooflight") {
    quote.rooflightId = quote.rooflightId === el.dataset.id ? null : el.dataset.id;
    ui.added = false;
    render();
    return;
  }
  if (action === "clear-rooflight") {
    quote.rooflightId = null;
    ui.added = false;
    render();
    return;
  }
  if (action === "toggle-flash") {
    quote[el.dataset.field] = quote[el.dataset.field] === el.dataset.id ? null : el.dataset.id;
    ui.added = false;
    render();
    return;
  }
  if (action === "qty") {
    const product = ensurePick(el.dataset.id);
    if (!product) return;
    const dir = Number(el.dataset.dir) || 0;
    quote.picks[el.dataset.id].qty = Math.max(0, Math.round(Number(quote.picks[el.dataset.id].qty) || 0) + dir);
    ui.added = false;
    render();
    return;
  }
  if (action === "add-pick") {
    const product = ensurePick(el.dataset.id);
    if (!product) return;
    const variant = product.variants.find((item) => item.id === quote.picks[el.dataset.id].variantId) || product.variants[0];
    quote.picks[el.dataset.id].qty = suggestionFor(product, variant) || 1;
    ui.added = false;
    render();
    return;
  }
  if (action === "remove-pick") {
    if (quote.picks[el.dataset.id]) quote.picks[el.dataset.id].qty = 0;
    ui.added = false;
    render();
    return;
  }
  if (action === "rl-step") {
    const slope = (lastCalc.slopes || []).find((item) => item.id === el.dataset.slope);
    const max = slope && slope.sheets != null ? slope.sheets : 0;
    const current = Number(quote.rooflightQty[el.dataset.slope]) || 0;
    quote.rooflightQty[el.dataset.slope] = Math.max(0, Math.min(max, current + (Number(el.dataset.dir) || 0)));
    ui.added = false;
    render();
    return;
  }
  if (action === "add-basket") {
    if (!requireReady()) return;
    if (!quote.ref) quote.ref = makeRef();
    ui.added = true;
    ui.closed.review = false;
    pendingScroll = "summary";
    render();
    return;
  }
  if (action === "print-quote") {
    window.print();
    return;
  }
  if (action === "export-excel") {
    downloadExcel();
    return;
  }
  if (action === "copy-quote") {
    const text = buildQuoteText();
    const done = () => { ui.notice = "Quote copied."; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => { ui.notice = "Could not copy automatically. Use Print instead."; render(); });
    } else {
      ui.notice = "Could not copy automatically. Use Print instead.";
      render();
    }
    return;
  }
  if (action === "open-save") {
    ui.modal = "save";
    ui.modalError = "";
    ui.saveDone = false;
    render();
    return;
  }
  if (action === "open-email") {
    if (!requireReady()) return;
    ui.modal = "email";
    ui.modalError = "";
    render();
    return;
  }
  if (action === "clear-basket") {
    const jobId = quote.jobId;
    quote = defaultQuote();
    quote.jobId = jobId;
    ui.added = false;
    ui.showErrors = false;
    ui.notice = "";
    ui.cladPhase = "shape";
    ui.cladError = "";
    render();
    return;
  }
  if (action === "open-start") {
    ui.modal = "start";
    render();
    return;
  }
  if (action === "close-modal") {
    ui.modal = null;
    ui.modalError = "";
    render();
    return;
  }
  if (action === "start-over") {
    quote = defaultQuote();
    applyPageMode();
    ui.added = false;
    ui.showErrors = false;
    ui.modal = null;
    ui.closed = {};
    ui.notice = "";
    ui.cladPhase = "shape";
    ui.cladError = "";
    if (location.hash) history.replaceState(null, "", location.href.split("#")[0]);
    render();
    return;
  }
  if (action === "dismiss-notice") {
    ui.notice = "";
    render();
    return;
  }
  if (action === "download-catalogue") {
    const blob = new Blob(["const QUOTE_CONFIG = " + JSON.stringify(config, null, 2) + ";\n"], { type: "text/javascript" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "config.js";
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  if (action === "reset-catalogue") {
    if (!confirm("This clears products and prices saved in this browser and brings back the catalogue from config.js.")) return;
    try { localStorage.removeItem(CAT_KEY); } catch (err) { /* ignore */ }
    config = clone(originalConfig);
    usingSavedCatalogue = false;
    ui.storageError = "";
    ui.view = "quote";
    render();
    return;
  }
  if (action === "add-item") {
    const arr = getPath(config, el.dataset.listPath);
    const item = factoryItem(el.dataset.factory);
    if (!arr || !item) return;
    arr.push(item);
    touchCatalogue();
    render();
    return;
  }
  if (action === "duplicate-item") {
    const arr = getPath(config, el.dataset.listPath);
    const index = Number(el.dataset.index);
    if (!arr || !arr[index]) return;
    const copy = clone(arr[index]);
    stampIds(copy, el.dataset.factory);
    if (copy.name) copy.name += " copy";
    if (copy.title) copy.title += " copy";
    arr.splice(index + 1, 0, copy);
    touchCatalogue();
    render();
    return;
  }
  if (action === "remove-item") {
    const arr = getPath(config, el.dataset.listPath);
    const index = Number(el.dataset.index);
    if (!arr || !arr[index]) return;
    if (el.dataset.listPath === "steps" && arr[index].kind !== "custom") return;
    if (!confirm("Remove this?")) return;
    const removed = arr.splice(index, 1)[0];
    if (removed && removed.id) forgetId(removed.id);
    touchCatalogue();
    render();
    return;
  }
  if (action === "move-item") {
    const arr = getPath(config, el.dataset.listPath);
    const index = Number(el.dataset.index);
    const next = index + Number(el.dataset.dir);
    if (!arr || next < 0 || next >= arr.length) return;
    const [item] = arr.splice(index, 1);
    arr.splice(next, 0, item);
    touchCatalogue();
    render();
  }
}

function handleField(el) {
  const action = el.dataset.action;
  if (action === "job-measure") {
    rememberFocus(el);
    quote[el.dataset.field] = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "clad-field") {
    rememberFocus(el);
    quote.wallDraft[el.dataset.field] = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "clad-win") {
    rememberFocus(el);
    const win = (quote.wallDraft.windows || []).find((item) => item.id === el.dataset.id);
    if (win) win[el.dataset.field] = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "job-variant") {
    quote.jobVariantId = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "slope-rise") {
    rememberFocus(el);
    quote.slopeRise = { ...(quote.slopeRise || {}), [el.dataset.mode]: el.value };
    render();
    return;
  }
  if (action === "measure") {
    rememberFocus(el);
    quote[el.dataset.field] = el.value;
    if (el.dataset.field === "apexA" && quote.apexSame) quote.apexD = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "catalogue-filter") {
    rememberFocus(el);
    ui.catalogueQuery = el.value;
    render();
    return;
  }
  if (action === "notes") {
    rememberFocus(el);
    quote.notes = el.value;
    render();
    return;
  }
  if (action === "custom-note") {
    rememberFocus(el);
    if (!quote.customNotes) quote.customNotes = {};
    quote.customNotes[el.dataset.step] = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "customer") {
    rememberFocus(el);
    quote.customer[el.dataset.field] = el.value;
    render();
    return;
  }
  if (action === "qty-set") {
    rememberFocus(el);
    const product = ensurePick(el.dataset.id);
    if (!product) return;
    const n = Math.round(val(el.value));
    quote.picks[el.dataset.id].qty = Number.isFinite(n) && n > 0 ? n : 0;
    ui.added = false;
    render();
    return;
  }
  if (action === "rl-qty") {
    rememberFocus(el);
    const slope = (lastCalc.slopes || []).find((item) => item.id === el.dataset.slope);
    let n = Math.round(val(el.value));
    if (!Number.isFinite(n) || n < 0) n = 0;
    const max = slope && slope.sheets != null ? slope.sheets : 0;
    quote.rooflightQty[el.dataset.slope] = Math.min(n, max);
    ui.added = false;
    render();
    return;
  }
  if (action === "adjust-qty") {
    rememberFocus(el);
    quote.qtyAdjust[el.dataset.slot] = el.value;
    ui.added = false;
    render();
    return;
  }
  if (action === "apex-same") {
    quote.apexSame = el.checked;
    if (quote.apexSame) quote.apexD = quote.apexA;
    ui.added = false;
    render();
    return;
  }
  if (action === "stock") {
    const parsed = parseStock(el.value);
    if (!parsed) {
      ui.stockError = "Use numbers separated by commas, such as 1, 1.5, 2, 3.";
      ui.stockDraft = el.value;
      render();
      return;
    }
    config.rules.stockLengthsM = parsed;
    ui.stockError = "";
    ui.stockDraft = null;
    touchCatalogue();
    render();
    return;
  }
  if (action === "cfg") {
    rememberFocus(el);
    let value = el.type === "checkbox" ? el.checked : el.value;
    setPath(config, el.dataset.path, value);
    touchCatalogue();
    render();
    return;
  }
  if (action === "variant") {
    const product = ensurePick(el.dataset.id);
    if (!product) return;
    quote.picks[el.dataset.id].variantId = el.value;
    ui.added = false;
    render();
  }
}

function onInput(event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  if (el.tagName === "SELECT" || ["checkbox", "file", "color"].includes(el.type)) return;
  if (el.dataset.action === "stock") return;
  handleField(el);
}

function onChange(event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  if (el.dataset.action === "upload") {
    onUpload(el);
    return;
  }
  if (el.dataset.action === "import-catalogue") {
    onImport(el);
    return;
  }
  if (el.dataset.action === "profile-toggle") {
    const product = getPath(config, el.dataset.listPath);
    if (!product) return;
    if (!Array.isArray(product.profileIds)) product.profileIds = [];
    const at = product.profileIds.indexOf(el.dataset.profileId);
    if (el.checked && at < 0) product.profileIds.push(el.dataset.profileId);
    if (!el.checked && at >= 0) product.profileIds.splice(at, 1);
    touchCatalogue();
    render();
    return;
  }
  if (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" || el.dataset.action === "stock") {
    handleField(el);
  }
}

async function onUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    alert("Choose an image file.");
    return;
  }
  try {
    const data = await shrinkImage(file);
    if (data.length > 500000) {
      alert("That photo is still quite large. Use a smaller image, or type images/your-photo.jpg.");
      return;
    }
    setPath(config, input.dataset.path, data);
    touchCatalogue();
    render();
  } catch (err) {
    alert("Could not use that image. Try a smaller photo, or type an image file name instead.");
  }
}

function onImport(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      config = ensureConfig(parseCatalogueText(String(reader.result || "")));
      config.meta.sample = false;
      usingSavedCatalogue = true;
      saveCatalogue();
      ui.notice = "Catalogue imported.";
      render();
    } catch (err) {
      alert(err.message || "Could not read that file.");
    }
  };
  reader.readAsText(file);
}

function onSubmit(event) {
  event.preventDefault();
  const action = event.target.dataset.action;
  if (action === "save-quote") {
    const name = quote.customer.name.trim();
    const email = quote.customer.email.trim();
    if (!name || !validEmail(email)) {
      ui.modalError = "Enter a name and a valid email. Phone is optional.";
      render();
      return;
    }
    const id = Math.random().toString(36).slice(2, 8);
    const all = readSaved();
    all[id] = { state: clone(quote), savedAt: Date.now() };
    storageSet(SAVED_KEY, JSON.stringify(all));
    ui.savedLink = location.href.split("#")[0] + "#quote=" + id;
    ui.saveDone = true;
    ui.modalError = "";
    render();
    return;
  }
  if (action === "email-quote") {
    if (!lastCalc.quoteReady) {
      ui.modal = null;
      requireReady();
      return;
    }
    const email = quote.customer.email.trim();
    if (!quote.customer.name.trim() || !validEmail(email)) {
      ui.modalError = "Enter the customer name and a valid email.";
      render();
      return;
    }
    const target = event.submitter && event.submitter.dataset.target;
    const to = target === "business" ? String(config.company.email || "").trim() : email;
    if (target === "business" && !validEmail(to)) {
      ui.modalError = "Add your business email in Edit products & prices first.";
      render();
      return;
    }
    if (!quote.ref) quote.ref = makeRef();
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(quoteSubject())}&body=${encodeURIComponent(buildQuoteText())}`;
    if (href.length > 1800) {
      ui.modalError = "This quote is too long for an email link. Use Copy quote or Print instead.";
      render();
      return;
    }
    ui.modal = null;
    ui.notice = "Your email app should open with the quote filled in.";
    render();
    window.location.href = href;
  }
}

function init() {
  originalConfig = clone(QUOTE_CONFIG);
  if (typeof RANGE_EXTRAS !== "undefined" && RANGE_EXTRAS.length) {
    originalConfig.extras = RANGE_EXTRAS;
  }
  if (typeof JOBS !== "undefined" && JOBS.length) {
    originalConfig.jobs = JOBS;
  }
  config = loadCatalogue();
  config.theme.accent = "#222222";
  config.theme.ink = "#333333";
  quote = loadDraft();
  normalizeQuote();
  if (quote.jobId && !(config.jobs || []).some((item) => item.id === quote.jobId)) quote.jobId = null;
  applySavedFromHash();
  const app = document.getElementById("app");
  // highlight the matching letter on the 3D preview while a measurement is focused
  app.addEventListener("focusin", (event) => {
    const el = event.target.closest('[data-action="measure"]');
    const field = el ? el.dataset.field : null;
    if (ui.focusField === field) return;
    ui.focusField = field;
    if (field || ui.focusField === null) render();
  });
  app.addEventListener("focusout", (event) => {
    const el = event.target.closest('[data-action="measure"]');
    if (!el) return;
    window.setTimeout(() => {
      const still = document.activeElement && document.activeElement.closest('[data-action="measure"]');
      if (!still && ui.focusField) { ui.focusField = null; render(); }
    }, 0);
  });
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onChange);
  app.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.modal) {
      ui.modal = null;
      render();
    }
  });
  window.addEventListener("hashchange", () => {
    applySavedFromHash();
    render();
  });
  render();
}

init();
