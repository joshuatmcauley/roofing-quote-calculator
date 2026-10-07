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
  if (!ui.showErrors) return "";
  const hit = lastCalc.errors.find((error) => error.field === field);
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
  return `<svg xmlns="http://www.w3.org/2000/svg" class="diagram" viewBox="-53.1 -144.6 303.4 176.6" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><ellipse cx="98.6" cy="10.0" rx="109.5" ry="6.2" fill="#1b2430" opacity="0.13"/><polygon points="0.0,0.0 217.6,0.0 217.6,-36.0 108.8,-86.0 0.0,-36.0" fill="#ffffff"/><path d="M 0.0 0.0 L 217.6 0.0 L 217.6 -36.0 L 108.8 -86.0 L 0.0 -36.0 Z" fill="none" stroke="#1c2126" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><polygon points="-18.7,-36.0 108.8,-86.0 88.4,-125.4 -39.1,-75.4" fill="#f7f8f9"/><polygon points="108.8,-86.0 236.3,-36.0 215.9,-75.4 88.4,-125.4" fill="#8b949c"/><line x1="12.9" y1="-52.7" x2="91.3" y2="-88.7" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="195.7" y1="-52.7" x2="117.4" y2="-88.7" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="8.8" y1="-60.6" x2="87.2" y2="-96.6" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="191.6" y1="-60.6" x2="113.3" y2="-96.6" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="4.8" y1="-68.5" x2="83.1" y2="-104.5" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="187.5" y1="-68.5" x2="109.2" y2="-104.5" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="0.7" y1="-76.3" x2="79.0" y2="-112.3" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="183.5" y1="-76.3" x2="105.1" y2="-112.3" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><polygon points="-18.7,-36.0 108.8,-86.0 108.8,-78.0 -18.7,-28.0" fill="#4c555d"/><polygon points="108.8,-86.0 236.3,-36.0 236.3,-28.0 108.8,-78.0" fill="#323940"/><polygon points="-18.7,-36.0 -39.1,-75.4 -39.1,-69.7 -18.7,-30.2" fill="#4c555d"/><polygon points="236.3,-36.0 215.9,-75.4 215.9,-69.7 236.3,-30.2" fill="#323940"/><polygon points="99.9,-85.4 109.1,-90.0 88.1,-130.6 78.9,-126.0" fill="#ffffff"/><polygon points="109.1,-90.0 118.3,-85.4 97.3,-126.0 88.1,-130.6" fill="#c5ced4"/><path d="M -18.7 -36.0 L 108.8 -86.0 L 88.4 -125.4 L -39.1 -75.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M 108.8 -86.0 L 236.3 -36.0 L 215.9 -75.4 L 88.4 -125.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M 99.9 -85.4 L 109.1 -90.0 L 88.1 -130.6 L 78.9 -126.0 Z" fill="none" stroke="#1c2126" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><path d="M 109.1 -90.0 L 118.3 -85.4 L 97.3 -126.0 L 88.1 -130.6 Z" fill="none" stroke="#1c2126" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><line x1="-18.7" y1="-28.0" x2="108.8" y2="-78.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/><line x1="108.8" y1="-78.0" x2="236.3" y2="-28.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

function monoArt() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="diagram" viewBox="-53.1 -158.9 303.4 190.9" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><ellipse cx="98.6" cy="10.0" rx="109.5" ry="6.2" fill="#1b2430" opacity="0.13"/><polygon points="0.0,0.0 217.6,0.0 217.6,-98.0 0.0,-36.0" fill="#ffffff"/><path d="M 0.0 0.0 L 217.6 0.0 L 217.6 -98.0 L 0.0 -36.0 Z" fill="none" stroke="#1c2126" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><polygon points="-18.7,-36.0 236.3,-98.0 215.9,-137.4 -39.1,-75.4" fill="#d4dbe1"/><line x1="17.3" y1="-50.9" x2="187.0" y2="-99.2" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="13.2" y1="-58.8" x2="182.9" y2="-107.1" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="9.1" y1="-66.7" x2="178.8" y2="-115.0" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="5.0" y1="-74.5" x2="174.8" y2="-122.9" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><polygon points="-18.7,-36.0 236.3,-98.0 236.3,-90.0 -18.7,-28.0" fill="#4c555d"/><polygon points="-18.7,-36.0 -39.1,-75.4 -39.1,-69.7 -18.7,-30.2" fill="#4c555d"/><polygon points="236.3,-98.0 215.9,-137.4 215.9,-129.4 236.3,-90.0" fill="#323940"/><polygon points="236.3,-98.0 215.9,-137.4 215.9,-144.9 236.3,-105.5" fill="#555e66"/><path d="M -18.7 -36.0 L 236.3 -98.0 L 215.9 -137.4 L -39.1 -75.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><line x1="-18.7" y1="-28.0" x2="236.3" y2="-90.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/><path d="M 236.3 -105.5 L 215.9 -144.9 L 215.9 -137.4 L 236.3 -98.0 Z" fill="none" stroke="#1c2126" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function bothArt() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="diagram" viewBox="-51.1 -156.9 616.8 186.9" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><ellipse cx="98.6" cy="10.0" rx="109.5" ry="6.2" fill="#1b2430" opacity="0.13"/><polygon points="0.0,0.0 217.6,0.0 217.6,-36.0 108.8,-86.0 0.0,-36.0" fill="#ffffff"/><path d="M 0.0 0.0 L 217.6 0.0 L 217.6 -36.0 L 108.8 -86.0 L 0.0 -36.0 Z" fill="none" stroke="#1c2126" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><polygon points="-18.7,-36.0 108.8,-86.0 88.4,-125.4 -39.1,-75.4" fill="#f7f8f9"/><polygon points="108.8,-86.0 236.3,-36.0 215.9,-75.4 88.4,-125.4" fill="#8b949c"/><line x1="12.9" y1="-52.7" x2="91.3" y2="-88.7" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="195.7" y1="-52.7" x2="117.4" y2="-88.7" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="8.8" y1="-60.6" x2="87.2" y2="-96.6" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="191.6" y1="-60.6" x2="113.3" y2="-96.6" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="4.8" y1="-68.5" x2="83.1" y2="-104.5" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="187.5" y1="-68.5" x2="109.2" y2="-104.5" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><line x1="0.7" y1="-76.3" x2="79.0" y2="-112.3" stroke="#c0c8ce" stroke-width="1.5" stroke-linecap="round"/><line x1="183.5" y1="-76.3" x2="105.1" y2="-112.3" stroke="#646d74" stroke-width="1.5" stroke-linecap="round"/><polygon points="-18.7,-36.0 108.8,-86.0 108.8,-78.0 -18.7,-28.0" fill="#4c555d"/><polygon points="108.8,-86.0 236.3,-36.0 236.3,-28.0 108.8,-78.0" fill="#323940"/><polygon points="-18.7,-36.0 -39.1,-75.4 -39.1,-69.7 -18.7,-30.2" fill="#4c555d"/><polygon points="236.3,-36.0 215.9,-75.4 215.9,-69.7 236.3,-30.2" fill="#323940"/><polygon points="99.9,-85.4 109.1,-90.0 88.1,-130.6 78.9,-126.0" fill="#ffffff"/><polygon points="109.1,-90.0 118.3,-85.4 97.3,-126.0 88.1,-130.6" fill="#c5ced4"/><path d="M -18.7 -36.0 L 108.8 -86.0 L 88.4 -125.4 L -39.1 -75.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M 108.8 -86.0 L 236.3 -36.0 L 215.9 -75.4 L 88.4 -125.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M 99.9 -85.4 L 109.1 -90.0 L 88.1 -130.6 L 78.9 -126.0 Z" fill="none" stroke="#1c2126" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><path d="M 109.1 -90.0 L 118.3 -85.4 L 97.3 -126.0 L 88.1 -130.6 Z" fill="none" stroke="#1c2126" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><line x1="-18.7" y1="-28.0" x2="108.8" y2="-78.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/><line x1="108.8" y1="-78.0" x2="236.3" y2="-28.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/><g transform="translate(0 0.0)"><ellipse cx="416.0" cy="10.0" rx="109.5" ry="6.2" fill="#1b2430" opacity="0.13"/><polygon points="317.4,0.0 535.0,0.0 535.0,-98.0 317.4,-36.0" fill="#ffffff"/><path d="M 317.4 0.0 L 535.0 0.0 L 535.0 -98.0 L 317.4 -36.0 Z" fill="none" stroke="#1c2126" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><polygon points="298.7,-36.0 553.7,-98.0 533.3,-137.4 278.3,-75.4" fill="#d4dbe1"/><line x1="334.7" y1="-50.9" x2="504.4" y2="-99.2" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="330.6" y1="-58.8" x2="500.3" y2="-107.1" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="326.5" y1="-66.7" x2="496.2" y2="-115.0" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><line x1="322.4" y1="-74.5" x2="492.2" y2="-122.9" stroke="#8b969e" stroke-width="1.55" stroke-linecap="round"/><polygon points="298.7,-36.0 553.7,-98.0 553.7,-90.0 298.7,-28.0" fill="#4c555d"/><polygon points="298.7,-36.0 278.3,-75.4 278.3,-69.7 298.7,-30.2" fill="#4c555d"/><polygon points="553.7,-98.0 533.3,-137.4 533.3,-129.4 553.7,-90.0" fill="#323940"/><polygon points="553.7,-98.0 533.3,-137.4 533.3,-144.9 553.7,-105.5" fill="#555e66"/><path d="M 298.7 -36.0 L 553.7 -98.0 L 533.3 -137.4 L 278.3 -75.4 Z" fill="none" stroke="#1c2126" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><line x1="298.7" y1="-28.0" x2="553.7" y2="-90.0" stroke="#1c2126" stroke-width="1.2" stroke-linecap="round"/><path d="M 553.7 -105.5 L 533.3 -144.9 L 533.3 -137.4 L 553.7 -98.0 Z" fill="none" stroke="#1c2126" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round"/></g></svg>`;
}

function roofArt(type) {
  const src = safeSrc(type.image);
  if (src) return `<div class="media"><img src="${esc(src)}" alt=""></div>`;
  let drawing = apexArt();
  if (type.includeApex && type.includeMono) drawing = bothArt();
  else if (type.includeMono) drawing = monoArt();
  return `<div class="media">${drawing}</div>`;
}

function renderMeasureInput(key) {
  const field = config.measureFields[key];
  const value = key === "apexD" && quote.apexSame ? quote.apexA : quote[key];
  const disabled = key === "apexD" && quote.apexSame;
  const bad = ui.showErrors && lastCalc.errors.some((error) => error.field === key);
  return `<label class="field${bad ? " has-error" : ""}" for="m_${key}">
    <span>${esc(field.label)}</span>
    <input id="m_${key}" data-action="measure" data-field="${key}" value="${esc(value)}" ${disabled ? "disabled" : ""} inputmode="decimal" autocomplete="off">
    <small>${esc(field.help)}</small>
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

function roofBackedText(x, y, text, anchor, size) {
  const label = String(text);
  const font = size || 13;
  const textW = Math.max(28, label.length * font * 0.56);
  const ax = anchor === "middle" ? x - textW / 2 : anchor === "end" ? x - textW : x;
  return `<rect x="${svgNum(ax - 3)}" y="${svgNum(y - font)}" width="${svgNum(textW + 6)}" height="${svgNum(font + 5)}" fill="#ffffff" fill-opacity="0.92"/>
    <text x="${svgNum(x)}" y="${svgNum(y)}" text-anchor="${anchor || "start"}" font-size="${font}" font-family="Lato, sans-serif" fill="#1e428b">${esc(label)}</text>`;
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

function renderRoofDiagram(mode) {
  const apex = mode === "apex";
  const length = val(apex ? quote.apexA : quote.monoA);
  const span = val(apex ? quote.apexB : quote.monoB);
  const slope = val(apex ? quote.apexC : quote.monoC);
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
  const pad = { l: 86, r: 24, t: 18, b: longer ? 78 : 52 };
  const scale = fitScale(worldW, span, 520, 220);
  const x0 = pad.l;
  const y0 = pad.t;
  const drawW = length * scale;
  const fullW = worldW * scale;
  const drawH = span * scale;
  const face = profile ? `url(#sheet-face-${key})` : "rgba(155,176,196,0.45)";
  const parts = [roofSheetDefs(key, look)];
  const bands = apex ? [0, span / 2, span] : [0, span];
  if (sheets > 0) {
    for (let band = 0; band < bands.length - 1; band += 1) {
      const yA = y0 + bands[band] * scale;
      const yB = y0 + bands[band + 1] * scale;
      for (let col = 0; col < sheets; col += 1) {
        const x = x0 + col * cover * scale;
        const w = cover * scale;
        parts.push(`<rect x="${svgNum(x)}" y="${svgNum(yA)}" width="${svgNum(w)}" height="${svgNum(yB - yA)}" fill="${face}"/>`);
        if (x + w > x0 + drawW + 0.4) {
          const hx = Math.max(x, x0 + drawW);
          parts.push(`<rect x="${svgNum(hx)}" y="${svgNum(yA)}" width="${svgNum(x + w - hx)}" height="${svgNum(yB - yA)}" fill="url(#sheet-hatch-${key})"/>`);
        }
      }
    }
    for (let band = 0; band < bands.length - 1; band += 1) {
      const yA = y0 + bands[band] * scale;
      const yB = y0 + bands[band + 1] * scale;
      for (let col = 0; col < sheets; col += 1) {
        const x = x0 + col * cover * scale;
        const w = cover * scale;
        parts.push(`<rect x="${svgNum(x)}" y="${svgNum(yA)}" width="${svgNum(w)}" height="${svgNum(yB - yA)}" fill="none" stroke="#1e428b" stroke-width="1"/>`);
      }
    }
  } else {
    parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="${face}"/>`);
  }
  parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="none" stroke="#1e428b" stroke-width="2.4"/>`);
  if (apex) {
    const ridge = y0 + drawH / 2;
    parts.push(`<line x1="${svgNum(x0)}" y1="${svgNum(ridge)}" x2="${svgNum(x0 + drawW)}" y2="${svgNum(ridge)}" stroke="#1e428b" stroke-width="1.6" stroke-dasharray="5 4"/>`);
    parts.push(roofBackedText(x0 + 8, ridge - 6, "Ridge", "start", 12));
  }
  if (slope > 0) {
    parts.push(roofBackedText(x0 + drawW / 2, y0 + (apex ? drawH / 4 : drawH / 2), `${trimNum(slope)} m up the slope`, "middle", 13));
  }
  parts.push(dimAcross(x0, x0 + drawW, y0 + drawH + 24, `${trimNum(length)} m eaves`, key));
  if (longer) parts.push(dimAcross(x0, x0 + fullW, y0 + drawH + 50, `${trimNum(covered)} m of covers`, key));
  parts.push(dimDown(x0 - 8, y0, y0 + drawH, `${trimNum(span)} m span`, key));
  let caption = `Plan of the ${apex ? "apex" : "single slope"}: ${roofMaterialCaption(look)} The filled area is ${trimNum(length)} m along the eaves by ${trimNum(span)} m across.`;
  if (sheets > 0) caption += ` ${sheets} sheet${sheets === 1 ? "" : "s"} cover the eaves at ${trimNum(cover)} m cover. Hatched sheet past the eaves is still a whole cover width.`;
  else caption += " Choose a sheet to see the covers along the eaves.";
  if (slope > 0) caption += ` Each sheet follows the ${trimNum(slope)} m eave-to-ridge length.`;
  const svg = scaleFrame(pad.l + fullW + pad.r, pad.t + drawH + pad.b, parts.join(""), caption, key);
  return `<div class="scale-diagram"><h3>To scale</h3>${svg}<p class="scale-caption">${esc(caption)}</p></div>`;
}

function renderMeasureStep() {
  const type = currentType();
  if (!type) return `<p class="muted">${esc(config.copy.needType)}</p>`;
  let html = `<p class="note">${esc(config.copy.measurementNote)} Stock lengths: ${esc((config.rules.stockLengthsM || []).join(", "))} m.</p>`;
  if (type.includeApex) {
    html += `<h3>Apex Roof Measurements</h3><div class="step-grid">
      ${renderMeasureInput("apexA")}
      ${renderMeasureInput("apexB")}
      ${renderMeasureInput("apexC")}
      <div>${renderMeasureInput("apexD")}
        <label class="check" for="apex_same"><input id="apex_same" type="checkbox" data-action="apex-same" ${quote.apexSame ? "checked" : ""}><span>${esc(config.copy.sameSide)}</span></label>
      </div>
    </div>${renderRoofDiagram("apex")}`;
  }
  if (type.includeMono) {
    html += `<h3>Single Slope Measurements</h3><div class="step-grid">
      ${renderMeasureInput("monoA")}
      ${renderMeasureInput("monoB")}
      ${renderMeasureInput("monoC")}
    </div>${renderRoofDiagram("mono")}`;
  }
  if (lastCalc.slopes.length) {
    html += `<ul class="preview">${lastCalc.slopes.map((slope) => {
      const sheets = slope.sheets == null ? "Choose a profile to count sheets" : `${slope.sheets} sheet${slope.sheets === 1 ? "" : "s"}`;
      const same = Math.abs(slope.ordered - slope.slope) < 0.001;
      const round = slope.blocked
        ? slope.blockReason
        : slope.cutToSize
        ? `${trimNum(slope.slope)} m cut to size`
        : slope.special
          ? `${trimNum(slope.slope)} m is above your longest stock size`
          : same
            ? `${trimNum(slope.slope)} m matches a stock length`
            : `${trimNum(slope.slope)} m rounds up to ${trimNum(slope.ordered)} m`;
      return `<li><strong>${esc(slope.label)}</strong> — ${esc(round)}. ${esc(sheets)}.</li>`;
    }).join("")}</ul>`;
  }
  if (lastCalc.planArea > 0) html += `<p class="muted">Plan area for reference: ${trimNum(lastCalc.planArea)} m². Sheet area: ${trimNum(lastCalc.sheetArea)} m².</p>`;
  return html;
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
      ${thumb(profile.image, profile.name)}
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
      ${colourChip(colour)}
      <strong>${esc(colour.name)}</strong>
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
      <strong>${esc(job.name)}</strong>
      <p>${esc(job.blurb)}</p>
    </button>`).join("")}</div>
    <p class="muted">Pick what you want to size, then enter the measurements on the next step.</p>`;
}

function jobInput(field, label, numeric) {
  const bad = ui.showErrors && lastCalc.errors.some((error) => error.field === field);
  return `<label class="field${bad ? " has-error" : ""}" for="job_${field}"><span>${esc(label)}</span>
    <input id="job_${field}" data-action="job-measure" data-field="${field}" value="${esc(quote[field] || "")}" inputmode="${numeric ? "numeric" : "decimal"}" autocomplete="off">
    ${fieldMsg(field)}</label>`;
}

function svgNum(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

function scaleFrame(width, height, body, label, key) {
  const id = key || "main";
  return `<svg class="diagram" viewBox="0 0 ${svgNum(width)} ${svgNum(height)}" role="img" aria-label="${esc(label)}">
    <defs>
      <marker id="dim-arrow-${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L8 4 L0 8 Z" fill="#1e428b"></path>
      </marker>
      <pattern id="offcut-hatch-${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
        <rect width="7" height="7" fill="#f4f7fb"></rect>
        <line x1="0" y1="0" x2="0" y2="7" stroke="#b7c3d6" stroke-width="2"></line>
      </pattern>
    </defs>
    ${body}
  </svg>`;
}

function dimAcross(x1, x2, y, label, key) {
  const id = key || "main";
  const mid = (x1 + x2) / 2;
  const textW = Math.max(42, String(label).length * 7.2);
  return `<line x1="${svgNum(x1)}" y1="${svgNum(y)}" x2="${svgNum(x2)}" y2="${svgNum(y)}" stroke="#1e428b" stroke-width="1.4" marker-start="url(#dim-arrow-${id})" marker-end="url(#dim-arrow-${id})"/>
    <rect x="${svgNum(mid - textW / 2)}" y="${svgNum(y - 9)}" width="${svgNum(textW)}" height="16" fill="#fff"/>
    <text x="${svgNum(mid)}" y="${svgNum(y + 4)}" text-anchor="middle" font-size="13" font-family="Lato, sans-serif" fill="#1e428b">${esc(label)}</text>`;
}

function dimDown(x, y1, y2, label, key) {
  const id = key || "main";
  const mid = (y1 + y2) / 2;
  return `<line x1="${svgNum(x)}" y1="${svgNum(y1)}" x2="${svgNum(x)}" y2="${svgNum(y2)}" stroke="#1e428b" stroke-width="1.4" marker-start="url(#dim-arrow-${id})" marker-end="url(#dim-arrow-${id})"/>
    <text x="${svgNum(x - 8)}" y="${svgNum(mid + 4)}" text-anchor="end" font-size="13" font-family="Lato, sans-serif" fill="#1e428b">${esc(label)}</text>`;
}

function scaleCaption(layout) {
  const spare = Number(layout.spare) || 0;
  if (layout.kind === "grid") {
    const coverMm = Math.round((Number(layout.pieceY) || 0) * 1000);
    const boardsW = (Number(layout.along) || 0) * (Number(layout.pieceX) || 0);
    const boardsH = (Number(layout.across) || 0) * (Number(layout.pieceY) || 0);
    const overhang = boardsW > Number(layout.x) + 0.01 || boardsH > Number(layout.y) + 0.01;
    let text = `The filled area is the ${trimNum(layout.x)} m × ${trimNum(layout.y)} m you entered. Each piece is ${trimNum(layout.pieceX)} m long`;
    if (coverMm > 0) text += ` and covers ${coverMm} mm`;
    text += overhang ? ". Hatched is the rest of a whole piece." : ". The pieces cover that size exactly.";
    if (layout.unit === "m2") {
      return `The filled area is ${trimNum(layout.x)} m × ${trimNum(layout.y)} m. Each cobble is ${Math.round(layout.pieceX * 1000)} × ${Math.round(layout.pieceY * 1000)} mm. This product is sold by the square metre, so the order is ${layout.qty} m².`;
    }
    if (spare > 0) {
      const word = spare === 1 ? "piece is" : "pieces are";
      text += ` ${spare} more ${word} the ${trimNum(layout.waste)}% waste, drawn underneath.`;
    }
    return text;
  }
  if (layout.kind === "perimeter") {
    const run = 2 * (Number(layout.x) + Number(layout.y));
    return `The rectangle is ${trimNum(layout.x)} m × ${trimNum(layout.y)} m. The edge is ${trimNum(run)} m, covered by ${layout.qty} whole lengths of ${trimNum(layout.pieceX)} m.`;
  }
  if (layout.kind === "bar" && layout.pieceX > 0) {
    return `The filled area is the ${trimNum(layout.x)} m run. Each piece is ${trimNum(layout.pieceX)} m. Hatched is the rest of a whole piece.`;
  }
  if (layout.kind === "bar") return `Drawn to the ${trimNum(layout.x)} m cut length.`;
  if (layout.kind === "steps") {
    const depth = Number(layout.y) || 0;
    const rows = Math.max(1, Math.round(layout.treads) || 1);
    let text = `Each band is one tread, ${trimNum(layout.x)} m wide.`;
    if (depth > 0) text += ` The going is ${trimNum(depth)} m, so ${rows} treads run ${trimNum(depth * rows)} m.`;
    text += ` Pieces are ${trimNum(layout.pieceX)} m and are sold whole.`;
    return text;
  }
  if (layout.pieceX > 0) return `The rectangle is ${trimNum(layout.x)} m × ${trimNum(layout.y)} m. Lengths are ${trimNum(layout.pieceX)} m.`;
  return `The rectangle is ${trimNum(layout.x)} m × ${trimNum(layout.y)} m, drawn to scale.`;
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

function gridDiagram(layout, label) {
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
  const pad = { l: 78, r: taller ? 78 : 20, t: 16, b: longer ? 78 : 46 };
  const scale = fitScale(worldW, worldH, 540, 240);
  const drawW = worldW * scale;
  const drawH = worldH * scale;
  const X = (m) => pad.l + m * scale;
  const Y = (m) => pad.t + m * scale;
  const parts = [];
  if (clip) {
    parts.push(`<clipPath id="area-clip"><rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}"/></clipPath>`);
  }
  if (pieceX > 0 && pieceY > 0) {
    const pieceOpen = clip ? `<g clip-path="url(#area-clip)">` : "";
    const pieceClose = clip ? `</g>` : "";
    if (pieceOpen) parts.push(pieceOpen);
    const many = along * across > 500;
    if (many) {
      parts.push(`<rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="1.2"/>`);
      for (let col = 1; col < along; col += 1) {
        const x = X(Math.min(col * pieceX, layout.x));
        parts.push(`<line x1="${svgNum(x)}" y1="${svgNum(Y(0))}" x2="${svgNum(x)}" y2="${svgNum(Y(layout.y))}" stroke="#1e428b" stroke-width="0.8"/>`);
      }
      for (let row = 1; row < across; row += 1) {
        const y = Y(Math.min(row * pieceY, layout.y));
        parts.push(`<line x1="${svgNum(X(0))}" y1="${svgNum(y)}" x2="${svgNum(X(layout.x))}" y2="${svgNum(y)}" stroke="#1e428b" stroke-width="0.8"/>`);
      }
    } else {
      for (let row = 0; row < across; row += 1) {
        for (let col = 0; col < along; col += 1) {
          parts.push(`<rect x="${svgNum(X(col * pieceX))}" y="${svgNum(Y(row * pieceY))}" width="${svgNum(pieceX * scale)}" height="${svgNum(pieceY * scale)}" fill="url(#offcut-hatch-main)" stroke="#1e428b" stroke-width="1.2"/>`);
        }
      }
    }
    if (pieceClose) parts.push(pieceClose);
  }
  parts.push(`<rect x="${svgNum(X(0))}" y="${svgNum(Y(0))}" width="${svgNum(layout.x * scale)}" height="${svgNum(layout.y * scale)}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="2.4"/>`);
  let yDim = pad.t + drawH + 22;
  parts.push(dimAcross(X(0), X(layout.x), yDim, `${trimNum(layout.x)} m`));
  if (longer) {
    yDim += 28;
    parts.push(dimAcross(X(0), X(boardsW), yDim, `${trimNum(boardsW)} m ordered`));
  }
  parts.push(dimDown(pad.l - 8, Y(0), Y(layout.y), `${trimNum(layout.y)} m`));
  if (taller) parts.push(dimDown(pad.l + drawW + 28, Y(0), Y(boardsH), `${trimNum(boardsH)} m`));
  const spare = Math.max(0, Math.round(layout.spare) || 0);
  let extraH = 0;
  if (spare > 0 && pieceX > 0 && pieceY > 0) {
    const shown = Math.min(spare, 4);
    const gap = 8;
    const spareH = Math.max(pieceY * scale, 18);
    const spareW = Math.min(pieceX * scale, 540);
    let sx = pad.l;
    let sy = yDim + 28;
    parts.push(`<text x="${svgNum(sx)}" y="${svgNum(sy)}" font-size="13" font-family="Lato, sans-serif" fill="#1e428b">${esc(`${spare} spare for ${trimNum(layout.waste)}% waste`)}</text>`);
    sy += 8;
    for (let i = 0; i < shown; i += 1) {
      parts.push(`<rect x="${svgNum(sx)}" y="${svgNum(sy)}" width="${svgNum(spareW)}" height="${svgNum(spareH)}" fill="url(#offcut-hatch-main)" stroke="#1e428b" stroke-width="1.2"/>`);
      sx += spareW + gap;
      if (i < shown - 1 && sx + spareW > pad.l + drawW) {
        sx = pad.l;
        sy += spareH + gap;
      }
    }
    const spareBottom = sy + spareH;
    extraH = spareBottom;
    if (spare > shown) {
      parts.push(`<text x="${svgNum(sx)}" y="${svgNum(sy + spareH / 2)}" font-size="13" font-family="Lato, sans-serif" fill="#1e428b">${esc(`+${spare - shown}`)}</text>`);
    }
  }
  const width = pad.l + drawW + pad.r;
  const height = (extraH > 0 ? extraH : pad.t + drawH + pad.b) + 18;
  return scaleFrame(width, height, parts.join(""), label);
}

function barDiagram(layout, label) {
  const pieceX = Number(layout.pieceX) || 0;
  const along = Math.max(1, Math.round(layout.along) || 1);
  const boardsW = pieceX > 0 ? along * pieceX : layout.x;
  const worldW = Math.max(layout.x, boardsW, 0.01);
  const longer = boardsW > layout.x + 0.01;
  const pad = { l: 16, r: 16, t: 16, b: longer ? 78 : 46 };
  const scale = fitScale(worldW, 1, 560, 36);
  const barH = 36;
  const drawW = worldW * scale;
  const parts = [];
  if (pieceX > 0) {
    for (let col = 0; col < along; col += 1) {
      parts.push(`<rect x="${svgNum(pad.l + col * pieceX * scale)}" y="${svgNum(pad.t)}" width="${svgNum(pieceX * scale)}" height="${barH}" fill="url(#offcut-hatch-main)" stroke="#1e428b" stroke-width="1.2"/>`);
    }
  }
  parts.push(`<rect x="${svgNum(pad.l)}" y="${svgNum(pad.t)}" width="${svgNum(layout.x * scale)}" height="${barH}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="2.4"/>`);
  parts.push(dimAcross(pad.l, pad.l + layout.x * scale, pad.t + barH + 22, `${trimNum(layout.x)} m`));
  if (longer) parts.push(dimAcross(pad.l, pad.l + boardsW * scale, pad.t + barH + 50, `${trimNum(boardsW)} m ordered`));
  return scaleFrame(pad.l + drawW + pad.r, pad.t + barH + pad.b, parts.join(""), label);
}

function rectDiagram(layout, label) {
  const pad = { l: 78, r: 20, t: 16, b: 46 };
  const scale = fitScale(layout.x, layout.y, 540, 220);
  const drawW = layout.x * scale;
  const drawH = layout.y * scale;
  const parts = [
    `<rect x="${svgNum(pad.l)}" y="${svgNum(pad.t)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="2.4"/>`,
    dimAcross(pad.l, pad.l + drawW, pad.t + drawH + 22, `${trimNum(layout.x)} m`),
    dimDown(pad.l - 8, pad.t, pad.t + drawH, `${trimNum(layout.y)} m`),
  ];
  return scaleFrame(pad.l + drawW + pad.r, pad.t + drawH + pad.b, parts.join(""), label);
}

function stepsDiagram(layout, label) {
  const treads = Math.max(1, Math.round(layout.treads) || 1);
  const along = Math.max(1, Math.round(layout.along) || 1);
  const pieceX = Number(layout.pieceX) || layout.x;
  const depth = Number(layout.y) || 0;
  const boardsW = along * pieceX;
  const worldW = Math.max(layout.x, boardsW, 0.01);
  const worldH = depth > 0 ? treads * depth : 1;
  const pad = { l: depth > 0 ? 78 : 16, r: 16, t: 16, b: 46 };
  const scale = depth > 0 ? fitScale(worldW, worldH, 520, 240) : fitScale(worldW, 1, 540, 28);
  const rowH = depth > 0 ? depth * scale : 28;
  const gap = depth > 0 ? 0 : 8;
  const drawW = worldW * scale;
  const parts = [];
  for (let row = 0; row < treads; row += 1) {
    const y = pad.t + row * (rowH + gap);
    for (let col = 0; col < along; col += 1) {
      parts.push(`<rect x="${svgNum(pad.l + col * pieceX * scale)}" y="${svgNum(y)}" width="${svgNum(pieceX * scale)}" height="${rowH}" fill="url(#offcut-hatch-main)" stroke="#1e428b" stroke-width="1.2"/>`);
    }
    parts.push(`<rect x="${svgNum(pad.l)}" y="${svgNum(y)}" width="${svgNum(layout.x * scale)}" height="${rowH}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="2.4"/>`);
  }
  const rowsH = treads * rowH + (treads - 1) * gap;
  parts.push(dimAcross(pad.l, pad.l + layout.x * scale, pad.t + rowsH + 22, `${trimNum(layout.x)} m`));
  if (depth > 0) parts.push(dimDown(pad.l - 8, pad.t, pad.t + rowsH, `${trimNum(depth * treads)} m`));
  return scaleFrame(pad.l + drawW + pad.r, pad.t + rowsH + pad.b, parts.join(""), label);
}

function perimeterDiagram(layout, label) {
  const length = Number(layout.x) || 0;
  const width = Number(layout.y) || 0;
  const piece = Number(layout.pieceX) || 0;
  const pad = { l: 78, r: 28, t: 20, b: 52 };
  const scale = fitScale(length, width, 500, 220);
  const x0 = pad.l;
  const y0 = pad.t;
  const drawW = length * scale;
  const drawH = width * scale;
  const total = 2 * (length + width);
  const band = Math.max(8, Math.min(16, Math.min(drawW, drawH) * 0.08));
  const parts = [
    `<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(drawW)}" height="${svgNum(drawH)}" fill="${selectedFill()}" stroke="#1e428b" stroke-width="1.4"/>`,
  ];
  function pointAt(dist) {
    const p = ((dist % total) + total) % total;
    if (p <= length) return { x: x0 + p * scale, y: y0 };
    if (p <= length + width) return { x: x0 + drawW, y: y0 + (p - length) * scale };
    if (p <= 2 * length + width) return { x: x0 + drawW - (p - length - width) * scale, y: y0 + drawH };
    return { x: x0, y: y0 + drawH - (p - 2 * length - width) * scale };
  }
  if (piece > 0 && total > 0) {
    let start = 0;
    let guard = 0;
    while (start < total - 1e-6 && guard < 80) {
      const len = Math.min(piece, total - start);
      const pts = [pointAt(start)];
      let walked = 0;
      let at = start;
      const corners = [length, length + width, 2 * length + width, total];
      while (walked < len - 1e-6) {
        const next = corners.find((corner) => corner > at + 1e-6) || total;
        const step = Math.min(len - walked, next - at);
        at += step;
        walked += step;
        pts.push(pointAt(Math.min(at, total)));
      }
      const points = pts.map((pt) => `${svgNum(pt.x)},${svgNum(pt.y)}`).join(" ");
      const whole = len + 1e-6 >= piece;
      parts.push(`<polyline points="${points}" fill="none" stroke="${whole ? "#1e428b" : "#8aa0c8"}" stroke-width="${svgNum(band)}" stroke-linejoin="miter" stroke-linecap="butt"/>`);
      start += len;
      guard += 1;
    }
  }
  parts.push(dimAcross(x0, x0 + drawW, y0 + drawH + 24, `${trimNum(length)} m`));
  parts.push(dimDown(x0 - 8, y0, y0 + drawH, `${trimNum(width)} m`));
  return scaleFrame(pad.l + drawW + pad.r, pad.t + drawH + pad.b, parts.join(""), label);
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
  let fields = "";
  if (job.mode === "wall") {
    fields = jobInput("jobLength", "Length of wall or fence to cover (metres)", false) + jobInput("jobHeight", "Height to cover (metres)", false) + waste;
  } else if (job.mode === "run" || job.mode === "linear") {
    fields = jobInput("jobLength", "Length (metres)", false);
  } else if (job.mode === "steps") {
    fields = jobInput("jobWidth", "Step width (metres)", false) + jobInput("jobCount", "Number of treads", true);
  } else if (job.mode === "circles") {
    fields = jobInput("jobCount", "Number of full circles", true);
  } else if (job.mode === "each") {
    fields = jobInput("jobCount", "Quantity (blank means 1)", true);
  } else {
    fields = jobInput("jobLength", "Length (metres)", false) + jobInput("jobWidth", "Width (metres)", false) + waste;
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

function renderSteps() {
  const steps = visibleSteps();
  const current = currentNavStep(steps);
  return `<div class="steps">${steps.map((step, index) => {
    const shown = displayStep(step);
    return `
    <section class="step${step.id === current ? " is-current" : ""}" data-step-anchor="${esc(step.id)}">
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
      lastCalc = calculate(quote, config);
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
  lastCalc = calculate(quote, config);
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
