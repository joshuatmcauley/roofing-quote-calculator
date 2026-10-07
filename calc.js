"use strict";

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// Keeps 4 decimals for unit prices that are stored ex-VAT (e.g. 10.3833), so
// they display and export cleanly. Totals are always worked from the exact rate.
function round4(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

function trimNum(n) {
  return round2(n).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function val(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const n = parseFloat(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function sheetCount(eaves, cover) {
  if (!(eaves > 0) || !(cover > 0)) return 0;
  const raw = eaves / cover;
  const nearest = Math.round(raw);
  if (Math.abs(raw - nearest) < 1e-6) return nearest;
  return Math.ceil(raw - 1e-9);
}

function roundUpToStock(length, stockLengths) {
  const stock = (stockLengths || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (!stock.length || !(length > 0)) return { ordered: length, special: true };
  const hit = stock.find((size) => size + 1e-9 >= length);
  if (hit == null) return { ordered: length, special: true };
  return { ordered: hit, special: false };
}

function piecesForRun(run, piece, overlap) {
  run = Number(run);
  piece = Number(piece);
  overlap = Number(overlap) || 0;
  if (!(run > 0) || !(piece > 0)) return 0;
  if (run <= piece + 1e-6) return 1;
  const step = piece - overlap;
  if (!(step > 0)) return 0;
  const n = (run - overlap) / step;
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < 1e-6) return nearest;
  return Math.ceil(n - 1e-9);
}

function describePieces(runs, piece, overlap, noun) {
  const word = noun || "length";
  piece = Number(piece);
  overlap = Number(overlap) || 0;
  const list = (runs || []).map(Number).filter((n) => n > 0);
  if (!(piece > 0)) {
    return { total: 0, text: "Add a piece length greater than 0 in the catalogue." };
  }
  if (overlap >= piece) {
    return { total: 0, text: "Overlap is as long as the flashing piece, so a quantity cannot be calculated. Reduce the overlap in the catalogue." };
  }
  if (!list.length) {
    return { total: 0, text: "Enter measurements to calculate a quantity." };
  }
  const groups = new Map();
  list.forEach((run) => {
    const key = trimNum(run);
    const found = groups.get(key);
    if (found) found.count += 1;
    else groups.set(key, { run, count: 1, pieces: piecesForRun(run, piece, overlap) });
  });
  const bits = [...groups.values()].map((group) => {
    const plural = group.count === 1 ? "" : "s";
    const pieceWord = group.pieces === 1 ? "piece" : "pieces";
    return `${group.count} × ${trimNum(group.run)} m ${word}${plural} (${group.pieces} ${pieceWord} each)`;
  });
  const total = [...groups.values()].reduce((sum, group) => sum + group.count * group.pieces, 0);
  return {
    total,
    text: `${bits.join("; ")}. Piece length ${trimNum(piece)} m, overlap ${trimNum(overlap)} m.`,
  };
}

function rectBoardCount(width, height, boardLen, cover, vertical) {
  if (!(width > 0) || !(height > 0) || !(boardLen > 0) || !(cover > 0)) return 0;
  if (vertical) return sheetCount(height, boardLen) * sheetCount(width, cover);
  return sheetCount(width, boardLen) * sheetCount(height, cover);
}

function gableBoardCount(width, height, boardLen, cover, vertical) {
  if (!(width > 0) || !(height > 0) || !(boardLen > 0) || !(cover > 0)) return 0;
  if (vertical) {
    const strips = sheetCount(width, cover);
    let total = 0;
    for (let i = 0; i < strips; i++) {
      const x = Math.min(width, (i + 0.5) * cover);
      const dist = Math.abs(x - width / 2);
      const stripH = height * Math.max(0, 1 - dist / (width / 2));
      total += sheetCount(stripH, boardLen);
    }
    return total;
  }
  const courses = sheetCount(height, cover);
  let total = 0;
  for (let i = 0; i < courses; i++) {
    const courseWidth = width * Math.max(0, 1 - (i * cover) / height);
    total += sheetCount(courseWidth, boardLen);
  }
  return total;
}

function wallBoardCount(wall, boardLen, cover) {
  const vertical = wall && wall.orientation === "vertical";
  const shape = (wall && wall.shape) || "full";
  let boards = 0;
  if (shape === "gable" || shape === "both") {
    boards += gableBoardCount(val(wall.gableW), val(wall.gableH), boardLen, cover, vertical);
  }
  if (shape !== "gable") {
    let count = rectBoardCount(val(wall.wallW), val(wall.wallH), boardLen, cover, vertical);
    if (wall.hasDoor) {
      const doorW = val(wall.doorW);
      const doorH = val(wall.doorH);
      if (doorW > 0 && doorH > 0) count = Math.max(0, count - rectBoardCount(doorW, doorH, boardLen, cover, vertical));
    }
    (wall.windows || []).forEach((win) => {
      const winW = val(win.w);
      const winH = val(win.h);
      if (winW > 0 && winH > 0) count = Math.max(0, count - rectBoardCount(winW, winH, boardLen, cover, vertical));
    });
    boards += count;
  }
  return boards;
}

function priceCladding(q, job, product, option, price, site, lengthM, coverM, waste) {
  const walls = Array.isArray(q.walls) ? q.walls : [];
  if (!walls.length) {
    return { lines: [], errors: [{ step: "clad-wall", message: "Add a wall to price the cladding." }], warnings: [], overview: [], ok: false };
  }
  if (!(lengthM > 0) || !(coverM > 0)) {
    return { lines: [], errors: [{ step: "clad-wall", message: "This board has no length or cover width." }], warnings: [], overview: [], ok: false };
  }
  const errors = [];
  let base = 0;
  const bits = [];
  walls.forEach((wall, index) => {
    const shape = wall.shape || "full";
    if (shape !== "gable" && !(val(wall.wallW) > 0 && val(wall.wallH) > 0)) {
      errors.push({ step: "clad-wall", message: `Wall ${index + 1} needs a height and a width.` });
    }
    if ((shape === "gable" || shape === "both") && !(val(wall.gableW) > 0 && val(wall.gableH) > 0)) {
      errors.push({ step: "clad-wall", message: `Wall ${index + 1} needs a gable height and width.` });
    }
    const count = wallBoardCount(wall, lengthM, coverM);
    base += count;
    const orient = wall.orientation === "vertical" ? "vertical" : "horizontal";
    bits.push(`Wall ${index + 1} ${orient}: ${count} board${count === 1 ? "" : "s"}`);
  });
  if (errors.length || !(base > 0)) {
    return {
      lines: [],
      errors: errors.length ? errors : [{ step: "clad-wall", message: "Enter a wall bigger than 0." }],
      warnings: [],
      overview: [],
      ok: false,
    };
  }
  if (!(price > 0)) {
    return { lines: [], errors: [], warnings: [{ step: "clad-wall", message: "This product has no price, so it is not on the quote." }], overview: [], ok: false };
  }
  const qty = waste > 0 ? Math.ceil(base * (1 + waste / 100) - 1e-9) : base;
  let detail = `${bits.join(". ")}.`;
  if (waste > 0) detail += ` ${trimNum(waste)}% extra brings the order to ${qty} board${qty === 1 ? "" : "s"}.`;
  detail += ` Boards are ${trimNum(lengthM)} m and cover ${trimNum(coverM * 1000)} mm. ${site(price)} each. Doors and windows are left out of the count. Boards are still sold whole.`;
  const name = option ? `${product.name}, ${option}` : product.name;
  const note = product.note ? ` ${product.note}` : "";
  return {
    lines: [{
      id: `job-${product.id}`,
      section: "Calculated",
      name,
      detail: detail + note,
      qty,
      qtyLabel: `${qty} board${qty === 1 ? "" : "s"}`,
      unitPrice: round4(price),
      total: round2(price * qty),
      layout: null,
    }],
    errors: [],
    warnings: [],
    overview: [`${job.name}: ${name}`, detail],
    ok: true,
  };
}

function setting(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function priceSizedJob(q, cfg, money) {
  const empty = { lines: [], errors: [], warnings: [], overview: [], ok: false };
  const vatPercent = setting((cfg.company || {}).vatPercent, 20);
  const site = (n) => money(round2((Number(n) || 0) * (1 + vatPercent / 100)));
  const jobs = Array.isArray(cfg.jobs) ? cfg.jobs : [];
  const job = jobs.find((item) => item.id === q.jobId) || null;
  if (!job || job.mode === "roof") return empty;
  const products = Array.isArray(job.products) ? job.products : [];
  const product = products.find((item) => item.id === q.jobProductId) || null;
  if (!product) {
    return { ...empty, errors: [{ step: "size", message: "Choose a product." }] };
  }
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const colours = Array.isArray(product.colours) ? product.colours : [];
  const colourPick = colours.find((item) => item.id === q.jobVariantId) || (colours.length ? colours[0] : null);
  const variant = colourPick ? null : (variants.find((item) => item.id === q.jobVariantId) || variants[0] || null);
  const chosen = colourPick || variant;
  const rawPrice = chosen && chosen.price != null && chosen.price !== "" ? Number(chosen.price) : Number(product.price);
  const price = Number.isFinite(rawPrice) ? rawPrice : 0;
  const option = chosen ? chosen.name : "";
  const unit = product.priceUnit || (job.mode === "linear" ? "m" : "piece");
  const errors = [];
  const wasteRaw = String(q.jobWaste ?? "").trim();
  let waste = Number(job.wasteDefault) || 0;
  if (wasteRaw !== "") {
    const parsed = val(wasteRaw);
    waste = Number.isFinite(parsed) && parsed >= 0 ? parsed : waste;
  }

  function need(field, label) {
    const n = val(q[field]);
    if (!(n > 0)) errors.push({ step: "size", field, message: `Enter a ${label} greater than 0.` });
    return n;
  }

  let qty = 0;
  let detail = "";
  let qtyLabel = "";
  let layout = null;
  const lengthM = Number((chosen && chosen.lengthM) || product.lengthM) || 0;
  const coverM = Number((chosen && chosen.coverM) || product.coverM) || 0;

  if (job.id === "cladding") {
    return priceCladding(q, job, product, option, price, site, lengthM, coverM, waste);
  }

  if (unit === "m2") {
    const length = need("jobLength", "length");
    const width = need("jobWidth", "width");
    if (!errors.length) {
      const area = length * width;
      const grown = area * (1 + waste / 100);
      qty = Math.max(1, Math.ceil(grown - 1e-9));
      qtyLabel = `${qty} m²`;
      detail = `${trimNum(length)} m × ${trimNum(width)} m is ${trimNum(area)} m².`;
      if (waste > 0) detail += ` ${trimNum(waste)}% waste brings the order to ${qty} m².`;
      detail += ` ${site(price)} per m².`;
      const stoneX = Number(product.lengthM) || 0;
      const stoneY = Number(product.coverM) || 0;
      layout = {
        kind: stoneX > 0 && stoneY > 0 ? "grid" : "rect",
        x: length,
        y: width,
        pieceX: stoneX,
        pieceY: stoneY,
        along: stoneX > 0 ? sheetCount(length, stoneX) : 0,
        across: stoneY > 0 ? sheetCount(width, stoneY) : 0,
        qty,
        waste,
        spare: 0,
        clip: true,
        unit: "m2",
        xName: "Length",
        yName: "Width",
      };
    }
  } else if (job.mode === "linear" || unit === "m") {
    const length = need("jobLength", "length");
    if (!errors.length) {
      qty = length;
      qtyLabel = `${trimNum(length)} m`;
      detail = `Cut to ${trimNum(length)} m. ${site(price)} per metre.`;
      layout = { kind: "bar", x: length, pieceX: 0, along: 1, qty, xName: "Cut length" };
    }
  } else if (job.mode === "each") {
    const entered = Math.round(val(q.jobCount));
    const count = entered > 0 ? entered : 1;
    qty = count;
    qtyLabel = `${qty}`;
    detail = `${site(price)} each, the website price.`;
  } else if (job.mode === "circles") {
    const count = Math.round(val(q.jobCount));
    if (!(count > 0)) errors.push({ step: "size", field: "jobCount", message: "Enter at least 1 circle." });
    else {
      const each = Math.max(1, Math.round(Number(product.perCircle) || 8));
      qty = count * each;
      qtyLabel = `${qty} kerb${qty === 1 ? "" : "s"}`;
      detail = `${count} full circle${count === 1 ? "" : "s"} × ${each} kerbs. ${site(price)} each.`;
    }
  } else if (job.mode === "steps") {
    const width = need("jobWidth", "width");
    const treads = Math.round(val(q.jobCount));
    if (!(treads > 0)) errors.push({ step: "size", field: "jobCount", message: "Enter at least 1 tread." });
    if (!errors.length) {
      const per = sheetCount(width, lengthM);
      qty = per * treads;
      qtyLabel = `${qty} piece${qty === 1 ? "" : "s"}`;
      detail = `${treads} tread${treads === 1 ? "" : "s"} × ${per} piece${per === 1 ? "" : "s"} of ${trimNum(lengthM)} m across ${trimNum(width)} m. ${site(price)} each.`;
      layout = {
        kind: "steps",
        x: width,
        y: Number(product.depthM) || 0,
        pieceX: lengthM,
        along: per,
        treads,
        qty,
        xName: "Width",
      };
    }
  } else if (job.mode === "perimeter") {
    const length = need("jobLength", "length");
    const width = need("jobWidth", "width");
    if (!errors.length) {
      const run = 2 * (length + width);
      qty = piecesForRun(run, lengthM, 0);
      qtyLabel = `${qty} length${qty === 1 ? "" : "s"}`;
      detail = `Perimeter ${trimNum(run)} m. Lengths of ${trimNum(lengthM)} m. ${site(price)} each.`;
      layout = { kind: "perimeter", x: length, y: width, pieceX: lengthM, qty, xName: "Length", yName: "Width" };
    }
  } else if (job.mode === "run") {
    const length = need("jobLength", "run length");
    if (!errors.length) {
      qty = sheetCount(length, lengthM);
      qtyLabel = `${qty}`;
      detail = `${trimNum(length)} m run, pieces of ${trimNum(lengthM)} m. ${site(price)} each.`;
      layout = { kind: "bar", x: length, pieceX: lengthM, along: qty, qty, xName: "Run" };
    }
  } else {
    const alongSpan = need("jobLength", job.mode === "wall" ? "run length" : "length");
    const acrossSpan = job.mode === "wall" ? need("jobHeight", "height") : need("jobWidth", "width");
    if (!errors.length) {
      const along = sheetCount(alongSpan, lengthM);
      const across = sheetCount(acrossSpan, coverM);
      const base = along * across;
      qty = waste > 0 ? Math.ceil(base * (1 + waste / 100) - 1e-9) : base;
      const noun = qty === 1 ? "piece" : "pieces";
      qtyLabel = `${qty} ${noun}`;
      const pieceArea = lengthM * coverM;
      detail = `${along} along × ${across} across = ${base} before waste.`;
      if (waste > 0) detail += ` ${trimNum(waste)}% waste makes ${qty}.`;
      detail += ` ${site(price)} each.`;
      if (pieceArea > 0) detail += ` About ${site(price / pieceArea)} per m².`;
      layout = {
        kind: "grid",
        x: alongSpan,
        y: acrossSpan,
        pieceX: lengthM,
        pieceY: coverM,
        along,
        across,
        base,
        qty,
        waste,
        spare: Math.max(0, qty - base),
        xName: job.mode === "wall" ? "Length" : "Length",
        yName: job.mode === "wall" ? "Height" : "Width",
      };
    }
  }

  if (errors.length || !(qty > 0)) {
    return { lines: [], errors, warnings: [], overview: [], ok: false };
  }
  if (!(price > 0)) {
    return {
      lines: [],
      errors: [],
      warnings: [{ step: "size", message: "This product has no price, so it is not on the quote." }],
      overview: [],
      ok: false,
    };
  }
  const name = option ? `${product.name}, ${option}` : product.name;
  const note = product.note ? ` ${product.note}` : "";
  const line = {
    id: `job-${product.id}`,
    section: "Calculated",
    name,
    detail: detail + note,
    qty,
    qtyLabel,
    unitPrice: round4(price),
    total: round2(price * qty),
    layout,
  };
  return {
    lines: [line],
    errors: [],
    warnings: [],
    overview: [`${job.name}: ${name}`, detail],
    ok: true,
  };
}

function calculate(quote, config) {
  const errors = [];
  const warnings = [];
  const lines = [];
  const q = quote || {};
  const cfg = config || {};
  const company = cfg.company || {};
  const rules = cfg.rules || {};
  const sym = company.currencySymbol || "£";
  const money = (n) => (round2(n) < 0 ? "-" : "") + sym + Math.abs(round2(n)).toFixed(2);
  const profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
  const roofTypes = Array.isArray(cfg.roofTypes) ? cfg.roofTypes : [];
  const roofing = q.jobId === "roof";
  const type = roofing ? (roofTypes.find((item) => item.id === q.roofTypeId) || null) : null;
  const profile = profiles.find((item) => item.id === q.profileId) || null;
  const finish = profile ? (profile.finishes || []).find((item) => item.id === q.finishId) || null : null;
  const colour = profile ? (profile.colours || []).find((item) => item.id === q.colourId) || null : null;
  const cover = profile ? Number(profile.coverWidthM) : 0;
  const stock = profile && Array.isArray(profile.stockLengthsM) && profile.stockLengthsM.length
    ? profile.stockLengthsM
    : (Array.isArray(rules.stockLengthsM) ? rules.stockLengthsM : []);
  const ownStock = !!(profile && Array.isArray(profile.stockLengthsM) && profile.stockLengthsM.length);
  const outLengths = profile && Array.isArray(profile.outOfStockLengthsM) ? profile.outOfStockLengthsM.map(Number) : [];
  const availableStock = stock.filter((len) => !outLengths.some((o) => Math.abs(o - Number(len)) < 1e-9));
  const shopPhone = company.phone ? ` Call ${company.phone}.` : "";
  const overlap = setting(rules.flashingOverlapM, 0.15);
  const vergeRuns = setting(rules.vergeRunsPerSlope, 2);
  const fixingsPerM2 = setting(rules.fixingsPerM2, 4);
  const stitchersPerFlashing = setting(rules.stitchersPerFlashing, 10);
  const vatPercent = setting(company.vatPercent, 20);
  const site = (n) => money(round2((Number(n) || 0) * (1 + vatPercent / 100)));

  function stepFlags(id, fallbackRequired) {
    const steps = Array.isArray(cfg.steps) ? cfg.steps : null;
    if (!steps) return { enabled: true, required: fallbackRequired };
    const step = steps.find((item) => (item.kind || item.id) === id);
    if (!step) return { enabled: true, required: fallbackRequired };
    return {
      enabled: step.enabled !== false,
      required: typeof step.required === "boolean" ? step.required : fallbackRequired,
    };
  }

  const typeFlags = stepFlags("type", true);
  const measureFlags = stepFlags("measure", true);
  const profileFlags = stepFlags("profile", true);
  const finishFlags = stepFlags("finish", true);
  const colourFlags = stepFlags("colour", true);

  if (typeFlags.enabled && typeFlags.required) {
    if (!type) errors.push({ step: "type", message: "Select a roof type." });
    else if (!type.includeApex && !type.includeMono) {
      errors.push({ step: "type", message: "This roof type has no measurements. Tick apex, single slope, or both in the catalogue." });
    }
  }

  function requireField(field) {
    if (String(q[field] ?? "").trim() === "" || !(val(q[field]) > 0)) {
      errors.push({ step: "measure", field, message: "Please enter a value greater than 0." });
    }
  }

  if (measureFlags.enabled && measureFlags.required) {
    if (!type) errors.push({ step: "measure", message: "Select a roof type before entering measurements." });
    else {
      if (type.includeApex) {
        requireField("apexA");
        requireField("apexB");
        requireField("apexC");
        if (!q.apexSame) requireField("apexD");
      }
      if (type.includeMono) {
        requireField("monoA");
        requireField("monoB");
        requireField("monoC");
      }
    }
  }

  if (profileFlags.enabled && profileFlags.required) {
    if (!profile) errors.push({ step: "profile", message: "Choose a profile." });
    else if (!(cover > 0)) errors.push({ step: "profile", message: "Set a cover width greater than 0 for this profile." });
  }
  if (finishFlags.enabled && finishFlags.required) {
    if (!profile) errors.push({ step: "finish", message: "Choose a profile first." });
    else if (!finish) errors.push({ step: "finish", message: "Choose a finish." });
  }
  if (colourFlags.enabled && colourFlags.required) {
    if (!profile) errors.push({ step: "colour", message: "Choose a profile first." });
    else if (!colour) errors.push({ step: "colour", message: "Select a colour." });
  }

  if (profile && profile.outOfStock) {
    warnings.push({ step: "profile", message: `${profile.name} is out of stock on bcmckeown.net at the moment.${shopPhone} Confirm before quoting.` });
  }

  const slopes = [];
  function addSlope(id, label, eavesRaw, slopeRaw) {
    const eaves = val(eavesRaw);
    const slope = val(slopeRaw);
    if (!(eaves > 0) || !(slope > 0)) return;
    const rounded = profile && profile.cutToSize
      ? { ordered: slope, special: false }
      : roundUpToStock(slope, availableStock);
    // A sheet that cannot be bought (too long, or the only long-enough size is out
    // of stock) is blocked instead of being priced at a length that does not exist.
    let blocked = false;
    let blockReason = "";
    if (profile && !profile.cutToSize && ownStock && rounded.special) {
      const anySize = roundUpToStock(slope, stock);
      const longestAll = Math.max(...stock.map(Number));
      const longestIn = availableStock.length ? Math.max(...availableStock.map(Number)) : 0;
      blocked = true;
      blockReason = anySize.special
        ? `${trimNum(slope)} m is longer than the longest sheet sold (${trimNum(longestAll)} m). Split the slope into two runs.${shopPhone}`
        : `${trimNum(slope)} m needs the ${trimNum(anySize.ordered)} m sheet, which is out of stock${longestIn ? ` (longest in stock is ${trimNum(longestIn)} m)` : ""}.${shopPhone}`;
      errors.push({ step: "measure", message: `${label}: ${blockReason}` });
    }
    const sheets = profile && cover > 0 ? sheetCount(eaves, cover) : null;
    const lightSelected = profile && (profile.rooflights || []).some((item) => item.id === q.rooflightId);
    let rooflights = lightSelected ? Math.max(0, Math.round(Number((q.rooflightQty || {})[id]) || 0)) : 0;
    if (sheets != null) rooflights = Math.min(rooflights, sheets);
    const metal = sheets == null ? null : sheets - rooflights;
    slopes.push({
      id,
      label,
      eaves,
      slope,
      ordered: rounded.ordered,
      special: rounded.special && !blocked,
      blocked,
      blockReason,
      cutToSize: !!(profile && profile.cutToSize),
      sheets,
      rooflights,
      metal,
    });
    if (rounded.special && !blocked) {
      warnings.push({
        step: "measure",
        message: `${label} is longer than your longest stock size, so the quote uses ${trimNum(slope)} m.`,
      });
    }
  }

  if (type && type.includeApex) {
    const side2 = q.apexSame ? q.apexA : q.apexD;
    addSlope("s1", "Apex side 1", q.apexA, q.apexC);
    addSlope("s2", "Apex side 2", side2, q.apexC);
  }
  if (type && type.includeMono) addSlope("m", "Single slope", q.monoA, q.monoC);

  const geometry = { bargeRuns: [], ridgeApex: 0, ridgeMono: 0, abutment: 0 };
  slopes.forEach((slope) => {
    const runs = Math.max(0, Math.round(vergeRuns));
    for (let i = 0; i < runs; i += 1) geometry.bargeRuns.push(slope.slope);
  });
  if (type && type.includeApex && type.apexRidge) {
    const a = val(q.apexA);
    const d = q.apexSame ? a : val(q.apexD);
    if (a > 0 && d > 0) geometry.ridgeApex = Math.max(a, d);
  }
  if (type && type.includeMono && type.monoRidge && val(q.monoA) > 0) geometry.ridgeMono = val(q.monoA);
  if (type && type.includeMono && type.abutment && val(q.monoA) > 0) geometry.abutment = val(q.monoA);

  let sheetArea = 0;
  slopes.forEach((slope) => {
    sheetArea += slope.eaves * slope.slope;
  });
  let planArea = 0;
  if (type && type.includeApex && val(q.apexA) > 0 && val(q.apexB) > 0) {
    const d = q.apexSame ? val(q.apexA) : val(q.apexD);
    planArea += (d > 0 ? Math.max(val(q.apexA), d) : val(q.apexA)) * val(q.apexB);
  }
  if (type && type.includeMono && val(q.monoA) > 0 && val(q.monoB) > 0) planArea += val(q.monoA) * val(q.monoB);

  const measurementsOk = !!type && (type.includeApex || type.includeMono) && !errors.some((error) => error.step === "measure");
  const profileOk = !!profile && cover > 0;
  const finishOk = !!finish;
  const colourOk = !!colour;
  const typeOk = !!type && (type.includeApex || type.includeMono);

  function chosenNumber(auto, raw) {
    if (String(raw ?? "").trim() === "") return auto;
    const n = val(raw);
    if (!Number.isFinite(n) || n < 0) return auto;
    return n;
  }

  const dripstopAllowed = !!(profile && finish && profile.allowsDripstop !== false && finish.allowsDripstop !== false);
  let autoDripMetres = 0;
  slopes.forEach((slope) => {
    if (slope.metal != null && !slope.blocked) autoDripMetres += slope.metal * slope.ordered;
  });
  const dripMetres = chosenNumber(autoDripMetres, (q.qtyAdjust || {}).dripstop);

  if (profile && finish) {
    const perM = Number(finish.pricePerMetre) || 0;
    if (!(perM > 0)) {
      warnings.push({ step: "finish", message: "This finish has no price per metre, so the sheets are priced at 0." });
    }
    slopes.forEach((slope) => {
      if (slope.sheets == null || slope.blocked) return;
      const rate = perM * slope.ordered;
      if (slope.metal > 0) {
        const colourName = colour ? `, ${colour.name}` : "";
        lines.push({
          id: `sheet-${slope.id}`,
          section: "Sheets",
          name: `${profile.name}, ${finish.name}${colourName}`,
          detail: `${slope.label}. ${slope.metal} metal sheet${slope.metal === 1 ? "" : "s"} at ${trimNum(slope.ordered)} m. Entered slope ${trimNum(slope.slope)} m. ${site(perM)} per metre.`,
          qty: slope.metal,
          qtyLabel: `${slope.metal} sheet${slope.metal === 1 ? "" : "s"}`,
          unitPrice: round4(rate),
          total: round2(rate * slope.metal),
        });
      }
      if (slope.rooflights > 0 && q.rooflightId) {
        const light = (profile.rooflights || []).find((item) => item.id === q.rooflightId);
        if (light) {
          const lightRate = (Number(light.pricePerMetre) || 0) * slope.ordered;
          lines.push({
            id: `light-${slope.id}`,
            section: "Sheets",
            name: light.name,
            detail: `${slope.label}. Replaces ${slope.rooflights} metal sheet${slope.rooflights === 1 ? "" : "s"} at ${trimNum(slope.ordered)} m. ${site(Number(light.pricePerMetre) || 0)} per metre.`,
            qty: slope.rooflights,
            qtyLabel: `${slope.rooflights} sheet${slope.rooflights === 1 ? "" : "s"}`,
            unitPrice: round4(lightRate),
            total: round2(lightRate * slope.rooflights),
          });
        }
      }
    });
  }

  if (q.dripstopOn && dripstopAllowed && dripMetres > 0 && cfg.dripstop) {
    const per = Number(cfg.dripstop.pricePerMetre) || 0;
    const adjusted = String((q.qtyAdjust || {}).dripstop ?? "").trim() !== "" && round2(dripMetres) !== round2(autoDripMetres);
    lines.push({
      id: "dripstop",
      section: "Dripstop",
      name: cfg.dripstop.name || "Anti-condensation liner",
      detail: adjusted
        ? `Quantity adjusted from ${trimNum(autoDripMetres)} m. ${site(per)} per metre.`
        : `${trimNum(autoDripMetres)} m from the metal sheets on the quote. ${site(per)} per metre.`,
      qty: dripMetres,
      qtyLabel: `${trimNum(dripMetres)} m`,
      unitPrice: round2(per),
      total: round2(per * dripMetres),
    });
  } else if (q.dripstopOn && dripstopAllowed && !(dripMetres > 0)) {
    warnings.push({ step: "dripstop", message: "Dripstop is selected, but there are no metal sheets to measure it from yet." });
  }

  function addFlashing(id, sectionName, product, runs, noun, slot) {
    if (!product) return;
    const described = describePieces(runs, product.pieceLengthM, overlap, noun);
    const qty = Math.round(chosenNumber(described.total, (q.qtyAdjust || {})[slot]));
    if (!(qty > 0)) return;
    const unitPrice = round2(Number(product.price) || 0);
    const adjusted = String((q.qtyAdjust || {})[slot] ?? "").trim() !== "" && qty !== described.total;
    lines.push({
      id,
      section: "Flashings",
      name: product.name,
      detail: described.text + (adjusted ? ` Quantity adjusted from ${described.total}.` : "") + ` ${site(unitPrice)} each.`,
      qty,
      qtyLabel: `${qty} piece${qty === 1 ? "" : "s"}`,
      unitPrice,
      total: round2(unitPrice * qty),
    });
  }

  if (profile) {
    addFlashing("barge", "Flashings", (profile.barges || []).find((item) => item.id === q.bargeId), geometry.bargeRuns, "verge", "barge");
    addFlashing("ridge-apex", "Flashings", (profile.ridges || []).find((item) => item.id === q.ridgeApexId), geometry.ridgeApex > 0 ? [geometry.ridgeApex] : [], "ridge", "ridgeApex");
    addFlashing("ridge-mono", "Flashings", (profile.ridges || []).find((item) => item.id === q.ridgeMonoId), geometry.ridgeMono > 0 ? [geometry.ridgeMono] : [], "ridge", "ridgeMono");
    addFlashing("abutment", "Flashings", (profile.abutments || []).find((item) => item.id === q.abutmentId), geometry.abutment > 0 ? [geometry.abutment] : [], "abutment", "abutment");
  }

  const flashingPiecesOnQuote = lines
    .filter((line) => line.section === "Flashings")
    .reduce((sum, line) => sum + line.qty, 0);

  function addPicked(product, section) {
    const pick = (q.picks || {})[product.id];
    if (!pick || !(Number(pick.qty) > 0)) return;
    if (product.profileIds && product.profileIds.length) {
      if (!profile || !product.profileIds.includes(profile.id)) return;
    }
    const variants = product.variants || [];
    const variant = variants.find((item) => item.id === pick.variantId) || variants[0];
    if (!variant) return;
    const qty = Math.max(0, Math.round(Number(pick.qty)));
    if (!qty) return;
    const unitPrice = round2(Number(variant.price) || 0);
    lines.push({
      id: product.id,
      section,
      name: product.name,
      detail: variant.name,
      qty,
      qtyLabel: `${qty} × ${variant.name}`,
      unitPrice,
      total: round2(unitPrice * qty),
    });
  }

  const sized = priceSizedJob(q, cfg, money);
  sized.errors.forEach((error) => errors.push(error));
  sized.warnings.forEach((warning) => warnings.push(warning));
  sized.lines.forEach((line) => lines.push(line));

  (cfg.fixings || []).forEach((product) => addPicked(product, "Fixings"));
  (cfg.extras || []).forEach((product) => addPicked(product, "Extras"));

  const exVat = round2(lines.reduce((sum, line) => sum + line.total, 0));
  const vat = round2(exVat * (vatPercent / 100));
  const incVat = round2(exVat + vat);

  const overview = [];
  if (type) overview.push(type.name);
  if (type && type.includeApex && val(q.apexA) > 0) {
    overview.push(`Apex side 1: ${trimNum(val(q.apexA))} m long, slope ${trimNum(val(q.apexC) || 0)} m, span ${trimNum(val(q.apexB) || 0)} m`);
    const side2 = q.apexSame ? val(q.apexA) : val(q.apexD);
    if (side2 > 0) overview.push(`Apex side 2: ${trimNum(side2)} m long`);
  }
  if (type && type.includeMono && val(q.monoA) > 0) {
    overview.push(`Single slope: ${trimNum(val(q.monoA))} m long, slope ${trimNum(val(q.monoC) || 0)} m, span ${trimNum(val(q.monoB) || 0)} m`);
  }
  sized.overview.forEach((row) => overview.push(row));

  const screwCount = measurementsOk && sheetArea > 0 ? Math.ceil(sheetArea * fixingsPerM2) : null;
  const stitcherCount = flashingPiecesOnQuote > 0 ? Math.ceil(flashingPiecesOnQuote * stitchersPerFlashing) : null;

  return {
    errors,
    warnings,
    typeOk,
    measurementsOk,
    profileOk,
    finishOk,
    colourOk,
    quoteReady: (!typeFlags.enabled || !typeFlags.required || typeOk)
      && (!measureFlags.enabled || !measureFlags.required || measurementsOk)
      && (!profileFlags.enabled || !profileFlags.required || profileOk)
      && (!finishFlags.enabled || !finishFlags.required || finishOk)
      && (!colourFlags.enabled || !colourFlags.required || colourOk)
      && !slopes.some((slope) => slope.blocked)
      && sized.errors.length === 0,
    jobOk: sized.ok,
    slopes,
    geometry,
    sheetArea,
    planArea,
    overview,
    lines,
    totals: { exVat, vat, incVat, vatPercent },
    recommendations: { areaM2: sheetArea, screwCount, stitcherCount },
    dripstop: {
      allowed: dripstopAllowed,
      metres: autoDripMetres,
      qty: dripMetres,
    },
    overlap,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculate,
    sheetCount,
    roundUpToStock,
    piecesForRun,
    describePieces,
    round2,
    round4,
    trimNum,
    val,
  };
}
