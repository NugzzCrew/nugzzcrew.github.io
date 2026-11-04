
// @ts-check
"use strict";
/* =====================================================================
   EMBLEM ENGINE - pure, DOM-free, worker-compatible
   Emission matches the accepted format exactly: full 6-digit hex,
   leading-zero decimals (0.123), and a closing stop in gradients.
   Copyright (c) 2026 f1f2f0e0e4e0ede8ff0e - PolyForm-Noncommercial-1.0.0
   Required Notice: Copyright (c) 2026 f1f2f0e0e4e0ede8ff0e
   ===================================================================== */
var EMBLEM = 512, SLUG_W = 66.47, SLUG_H = 300;
/* slug path geometry, needed only to measure what the emitted rect actually paints. the path fills
   x in [0,66.437] but bulges left to -0.028 over a sliver of its height (the curve's own extremum at
   t=1/3 of -0.189(1-t)^2 t, not its control point), so its bounding box is wider than its fill. an
   objectBoundingBox gradient is laid out across that whole box, which shifts and stretches the ramp
   on the x axis; on y the path is exactly [0,300], which is why only row strips were mis-scored.
   the fill itself is measured at its nominal extent: it falls ~0.05% short of it, but the seam
   overlap makes neighbouring rects stack over that edge and cover it. */
var SLUG_FILL_W = 66.437, SLUG_BBOX_X0 = -0.028, SLUG_BBOX_W = SLUG_FILL_W - SLUG_BBOX_X0;   /* an objectBoundingBox gradient is laid across the BBOX, not the fill: the curve bulges past the left edge, so the two differ. */
/**
 * Shared engine value shapes. JSDoc only - no runtime effect.
 * @typedef {{data:Uint8ClampedArray,w?:number,h?:number}} ImgData
 * @typedef {{id?:string,type?:string,slug?:string,x:number,y:number,scaleX:number,scaleY:number,color:string,index?:number,name?:string,invertedX?:(number|boolean),invertedY?:(number|boolean),rotation?:number,opacity?:number,isFilled?:(number|boolean),internal?:(number|boolean),locked?:(number|boolean),tBold?:(number|boolean),tItalic?:(number|boolean),fontFamily?:(string|null),borderColor?:string,borderSize?:number,gradientStyle?:string,width?:number,height?:number}} Layer
 * @typedef {{enc:number,[k:string]:any}} Candidate
 * @typedef {{k:number,N:(number|string),autoN:number,method:string,precision:number,overlap:number,quantIters:number,alphaMode:string,autofit:boolean,dither:boolean,smoothPct:number,budget:number,ladder:number[],bright?:number,contrast?:number,sat?:number,noise?:number,bgTol?:number,pareto?:boolean,paretoLadder?:number[],paletteLadder?:number[],lean?:boolean,tol?:number,toleranceLadder?:number[],plOn?:boolean,sharpResize?:boolean}} EngineOpts
 */
/* engine tuning knobs, gathered so they can be adjusted in one place */
var TUNING = {
  smoothRadiusSplit: 0.4, smoothRadiusLo: 1, smoothRadiusHi: 2,
  smoothSpatialBase: 0.8, smoothSpatialScale: 1.6,
  smoothColorBase: 8, smoothColorScale: 38,
  kMidFactor: 0.72, kLowFactor: 0.5,
  boundK: 55, budgetPrune: 1.25, searchMaxMs: 24000,   /* soft time cap (ms) on the Auto-optimize sweep. it runs inside one worker job, so the bound it has to clear is jobTimeoutMs (30s), not the run watchdog. */
  resLadder: [512, 384, 256, 192, 128],
  paretoLadder: [512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 32],   /* dense (N) grid for the Pareto search */
  paletteLadder: [512, 384, 320, 256, 192, 160, 128, 96, 72, 60, 52, 44, 36, 28, 24, 20, 16, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],  /* single source for the Auto-optimize sweep and the benchmark, so they cannot disagree by a missing step. k=2..12 is every integer (at low k one colour is a large fraction of the palette, so a budget-limited optimum can land on any k); above 12 stays sparse. the ceiling is 512 because that is where the budget starts binding first: past it a detailed source cannot fit the extra colours anyway. enc is monotonic in k and the scan stops at the first rung over budget, so a rung too high costs at most one encode. */
  detailMax: 117, detailDefault: 59, toleranceMin: 0.3059, toleranceMax: 2700,   /* Detail 1..detailMax (higher=finer) maps geometrically onto the per-strip L2 tolerance
     [toleranceMin,toleranceMax]. detailMax-1 is 116 = 2*58 on purpose: saved projects and shared
     links store a Detail integer, so changing detailMax silently reinterprets every one of them,
     and only a multiple of 58 keeps the values that are already out there landing where they did. */
  toleranceLadder:/** @type {number[]} */([]),   /* filled below from detailToTolerance(1..detailMax). Auto-optimize sweeps exactly these steps, so every winner lands on an integer Detail that reproduces byte-for-byte when typed. a TUNING field so app.test can override it. */
  plManualTol: 520,   /* per-strip L2 tolerance for a manual PL encode when no tol is given (the Detail control normally sets it) */
  plAlphaW: 0.4,   /* alpha's weight as a 4th fitStops channel next to Lab L/a/b: keeps a knot at a sharp alpha edge so colour does not bleed across a cutout silhouette. opaque content (constant alpha) adds zero cost => byte-identical. */
  ssimWin: 8,   /* side of the search proxy's window, chosen by how often it ranks a pair of candidates the way the canonical gaussian metric does. over 9800 within-work pairs from 400 candidates on eight works: 2 -> 97.88%, 3 -> 98.78, 4 -> 99.11, 5 -> 99.43, 6 -> 99.34, 8 -> 98.92, 10 -> 98.60, 12 -> 98.47, 16 -> 98.29, 20 -> 98.03. agreement peaks at 5-6, about half a point above the 8 in use. the sliding sums make every size cost the same, so the value is purely an accuracy choice. it stays at 8 until a change is measured on finished output, because ranking agreement is only a proxy for what the sweep selects. */
  qChroma: 0.35,   /* a/b weight against L in the k-means palette distance. same reasoning as chromaW but a much milder value, and the difference is structural: here the palette IS the colour representation, so weighting chroma down removes hues from the output rather than just moving knots. over eight works through the full budgeted search, against equal weighting: 0.45 -> +0.56, 0.35 -> +0.63, 0.25 -> +0.80, 0.05 -> +1.24. the worst colour cost is +0.25 dE00 at 0.35 and +0.43 at 0.25, both well inside a JND. SSIM cannot see chroma and will keep paying for it, so a fixed weight has to stop somewhere; this is only the starting point, since autoChroma refits it per image against the colour that image actually loses. */
  chromaW: 0.06,   /* a/b weight against L in the knot-placement cost. fidelity is scored on luma, so weighting chroma equally spends knots on pure hue turns the score never sees. only knot POSITIONS shift: the stop colours still come from the least-squares solve, so the colour cost is small. at a fixed resolution and tolerance over eight works, where knot placement is the only thing that differs, it is +0.137 in CIEDE2000 (+0.19 in the Lab a/b units chromaShift reports). it also buys real bytes, and through the full budgeted search the lighter weight wins on all eight, +0.37 on average. */
  plColorAlphaPow: 2,   /* fitStops colour cost is weighted by alpha^this per sample: compositing shows a colour error at opacity a as ~a*error, so pow 2 is premultiplied-correct and near-transparent fringe colour stops stealing knots from the interior. opaque (alpha 255 => weight 1) is byte-identical. */
  segAlphaMin: 8,   /* PL gap-split: alpha>=this counts as opaque; below it is a transparent gap that gets no rect, so a gradient cannot ramp across it */
  segBridge: 6,   /* PL gap-split: transparent gaps shorter than this (512-space samples) are bridged, so a hairline break does not fragment one shape into many rects */
  dpSpan: 24,   /* how far a single shortest-path edge may reach. the optimum's segments are short and the flat-run escape carries the long solid stretches, so the bound is not binding: 24 through 160 land within a tenth of a point of each other on average, though a single work can differ by more, and the cost is linear in it. */
  dpTolRatio: 5,   /* the exact fit reaches a given byte count at roughly a fifth of the greedy fit's tolerance, so the refit's search starts there instead of walking down from the greedy winner */
  refitWidth: 7, refitRounds: 3, refitStop: 1.02,   /* the refit's probes per round, its rounds, and the bracket width below which another round cannot move the byte count. a round costs one encode of wall clock only while the probes fit the pool, so the parallel path takes the smaller of this and the pool it has; past about seven the bracket is already closing faster than the rounds can use. */
  refineMs: 8000,   /* bounds the serial refit instead, so a slow machine spends the same wall clock as a fast one and returns fewer probes rather than running long */
  qChromaMin: 0.03,   /* the lightest chroma weight the refit may reach. it is deliberately low: the colour the weight costs is measured on the picture itself, so the measurement is the guard and the floor only bounds the search. */
  chromaSlackMean: 0.6,   /* how much further, in Lab a/b units, the refit may move colour than the default weight already moves it on this picture. 0.6 is about a quarter of a JND in these units, where a JND is ~2.3. do not read it against a CIEDE2000 figure, whose JND is ~1.0: the two scales are not interchangeable. */
  chromaSlackP99: 3,   /* the same allowance at the 99th percentile, so a weight that holds the average and still shifts one region far is refused */
  chromaRefitSteps: 3,   /* bisection steps between qChromaMin and qChroma. the constraint is monotone in the weight, and the step is geometric (sqrt(lo*hi)), so three halvings cut the 0.03-to-0.35 span to an eighth in log terms: a surviving bracket 1.36x wide. */
  chromaRefitRungs: 3,   /* palette rungs the refit may step down at one weight before giving up on it */
  chromaRefitMs: 5000,   /* extra time the refit may use past the sweep's own cap */
  sgHalf: 2,   /* half-window of the along-axis smoother: 5 taps */
  sgRange: 12,   /* how far a neighbour may differ and still be averaged in. a symmetric window clips symmetrically, so a ramp comes through untouched while a step is not crossed. */
  chromaBlurHalf: 3,   /* half-window of the hue blur */
  deadbandTol: 2,   /* how far a sample may drift from its run's anchor and still be snapped onto it */
  codebookTol: 4,   /* largest per-channel deviation, on a 0-255 scale, a gradient may take on to reuse another definition. 4 is under a sixtieth of the range, about the step 6-digit hex already quantizes to at these values. */
  codebookSamples: 8,   /* fixed points a gradient is sampled at for comparison. stop-by-stop would miss that two profiles can describe the same shape with different knot counts. */
  knotChromaLadder: [0],   /* alternatives to chromaW the smooth winner tries. one entry: this weight never represents colour, it only moves knots, so the whole range worth exploring lies between the default and zero. */
  stripBins: 32,   /* along-axis bins the adaptive-height merge scores rows in. the boundary only has to land in the right place, so a coarse score is enough and 32 keeps the whole pass under a millisecond. */
  chromaBound: 6,   /* squared Lab a/b distance a segment may drift before it earns a knot. the weight it replaces costs +0.137 dE00 (measured); this pays only where the drift is real. */
  defringeAlphaMin: 64   /* defringe trusts a pixel's colour only at alpha>=this: a cutout's anti-aliased fringe (alpha 1..40) often carries unreliable rgb, so the reliable opaque colour is bled over it instead. opaque content (no sub-64 alpha) is untouched. */
};
/* alpha -> fitStops colour-cost weight (alpha^plColorAlphaPow), keyed by the 0..255 alpha byte. LUT[255]===1, so opaque strips are byte-identical. */
var PL_ACOLOR_LUT = (function () { var p = TUNING.plColorAlphaPow, t = new Float64Array(256), i; for (i = 0; i < 256; i++)t[i] = Math.pow(i / 255, p); return t; })();
/* Detail<->tolerance map, in engine scope so the worker sweep, the main thread and the app IIFE share
   one copy. Detail 1..detailMax maps geometrically: detailToTolerance(1)=toleranceMax (roughest),
   detailToTolerance(detailMax)=toleranceMin (finest). toleranceToDetail is its exact integer inverse, so an
   auto pick and the same Detail typed by hand encode identically. */
function detailToTolerance(v) {
  var mx = TUNING.detailMax, lo = TUNING.toleranceMin, hi = TUNING.toleranceMax;
  if (v == null) v = TUNING.detailDefault; if (v < 1) v = 1; else if (v > mx) v = mx;
  return hi * Math.pow(lo / hi, (v - 1) / (mx - 1));
}
function toleranceToDetail(tol) {
  var mx = TUNING.detailMax, lo = TUNING.toleranceMin, hi = TUNING.toleranceMax;
  if (!tol) return TUNING.detailDefault;
  var v = Math.round(1 + (mx - 1) * Math.log(tol / hi) / Math.log(lo / hi));
  return v < 1 ? 1 : v > mx ? mx : v;
}
TUNING.toleranceLadder = (function () { var a = [], v; for (v = TUNING.detailMax; v >= 1; v--)a.push(detailToTolerance(v)); return a; })();   /* ascending [toleranceMin..toleranceMax] = Detail detailMax..1 (fine -> coarse) */
/* default engine opts. runEncodeJob merges these under the caller's opts, so every
   downstream reader can rely on the full set being present. */
var ENGINE_DEFAULTS = {
  precision: 3, overlap: 2, quantIters: 8, alphaMode: "keep",   /* overlap: seam-safe strip bleed in 512-space units (the Overlap control, consumed in serializeStrips); >=1 hides the fractional-pixel seams that appear when the editor rescales the emblem off 512 */
  dither: false, smoothPct: 0, autofit: false, sharpResize: false
};
/* the output format the editor accepts. numbers may drop their leading zero, ".402". the slug path's d
   must be the exact string below, with no shorter or reshaped equivalent, stops cannot move into a
   <style> block, and every layer keeps its color and its zero coordinates: the editor validates both
   the d attribute and the layer schema. */
var V2 = {
  shortIds: true,        /* base-62 gradient ids in place of the content-hashed prefix */
  dropPixelTail: true,   /* omit the closing stop that spreadMethod="pad" already paints */
  hoistAlpha: true,      /* one shared stop-opacity becomes fill-opacity on the path */
  segPrecision: true,    /* offset decimals from the segment's own length, never more than the global */
  layerPrecision: true,  /* layer scale decimals from magnitude rather than from the svg's */
  emitBasis: true,       /* solve the stop colours against the emitted offsets */
  bboxOffsets: true,     /* map offsets through the slug bbox the gradient spans */
  tolRefine: true,       /* spend the budget left between two Detail rungs */
  noLeadZero: true,      /* ".402" for "0.402": the editor accepts it, and it is worth 2.06% of a smooth payload on average, 1.87% to 2.21% over eight works */
  dpKnots: true,         /* shortest-path knot placement instead of greedy removal */
  chromaConstraint: false,/* off: bounding the knot-placement chroma error loses fidelity outright: -1.08 on average over eight works, helping none of them, and worst on the dense ones it was meant to help */
  snapCoincident: true,  /* collapse a near-coincident knot pair onto one offset, so the second needs no offset attribute */
  autoChroma: true,      /* pick the palette's chroma weight per image, on the winner, against the budget */
  /* the two below smooth the profile before it is fit. both are disabled: measured over the full search
     on ten works at a full and a tight budget, turning them off is worth +0.167 on average and wins 18
     of 20 runs, including every run at 300 KB. */
  sgFilter: false,       /* off: a moving average along the fit axis. saves real bytes on flat work (38% on a graphic mark) but the fidelity it costs always exceeds what those bytes buy back */
  chromaLowpass: true,   /* blur hue, keep luma: fidelity is scored on luma only */
  deadband: false,       /* off: snapping near-equal neighbours onto a run anchor. it is a piecewise-constant flattener fed to a piecewise-linear fitter, so it turns a ramp into a staircase and the file grows: +45% on a photograph */
  linearLight: false,    /* off: correcting one averaging stage alone leaves it inconsistent with an sRGB-tuned pipeline. measured -0.15 on average over eight works, helping none */
  codebook: false,       /* off: snapping a gradient onto a near match costs more error than it saves bytes. measured -0.12 on average over eight works, helping none, and it does not fire at all on the dense ones */
  autoKnotChroma: false, /* off: a lighter knot-placement chroma weight never scores above the default. over eight works it changes the result by 0.000 every time */
  adaptiveStrips: false, /* off: content-fitted strip heights score below the uniform grid, whose flat runs already merge. measured -1.27 on average over eight works, helping none */
  msGain: false          /* off: a 1D strip profile has no variance left past the first pyramid level. measured +0.02 on average over eight works, which is the noise floor */
};
var B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function base62(n) { var s = ""; do { s = B62.charAt(n % 62) + s; n = (n / 62) | 0; } while (n > 0); return s; }
if (typeof window !== "undefined")/** @type {any} */(window).EMBLEM_V2 = V2;   /* the flags are readable and writable from the console, and travel to the workers with the job */
var SLUG = "M0,0H66.437V300H0V148.125C0,148.125,0.04,147.744,0,147.625C-0.063,147.437,0,147.062,0,147.062V0Z";   /* exact bytes required: the editor accepts only this form of the rectangle, not a shorter equivalent */
var backgroundLayer = { id: "background", name: "Background", type: "square", y: 0, x: 0, scaleY: 100, scaleX: 100, invertedY: false, invertedX: false, rotation: 0, opacity: 100, index: 0, color: "#transparent", isFilled: true, internal: true, locked: false, tBold: false, tItalic: false, fontFamily: null, borderColor: "#a1a1a1", borderSize: 0, gradientStyle: "Fill", slug: "rectangles/square", width: 512, height: 512 };
/* fixed background rectangle (exact bytes required) */
var BGRECT = '<rect x="0" y="0" width="512" height="512" rx="0" ry="0" fill="none" stroke="#a1a1a1" fill-opacity="1" stroke-opacity="0" stroke-width="0" stroke-miterlimit="10"></rect>';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function roundTo(v, p) { return Number(v.toFixed(p)) }
/* canonical JS form, rounded to p decimals: "0.123", "7.703", "300". under V2.noLeadZero the leading
   zero is then dropped, ".123", which the SVG number grammar allows and the editor accepts. */
function formatNum(v, p) { var s = String(roundTo(v, p)); return V2.noLeadZero ? s.replace(/^(-?)0\./, "$1.") : s; }
/* an offset is written as a fraction of the path's bounding box, and on the x axis that box is wider
   than the fill: the curve bulges SLUG_BBOX_X0 past the left edge. writing o as if the box were the fill
   lands every stop a fifth of a pixel short. renderCoverage already models the box, so correcting here
   is visible to the score. the y box and the fill coincide, so axis 1 needs nothing. */
function bboxOffset(o, axis) {
  if (!V2.bboxOffsets || axis !== 0) return o;
  var c = (o * SLUG_W - SLUG_BBOX_X0) / SLUG_BBOX_W;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}
function hexByte(c) { var h = c.toString(16); return h.length < 2 ? "0" + h : h }
/* full 6-digit hex. the editor also accepts and paints the short #rgb form, but it puts every channel
   on a 16-step grid, and that costs more fidelity than the 7.8% of extra stops it pays for: measured
   -3.9 on a photograph, -2.5 on a portrait, positive only on the two densest works. worth revisiting
   only for colours already on the grid, where it is free. */
function rgbToHex(r, g, b) { return "#" + hexByte(r) + hexByte(g) + hexByte(b) }
/* the snippet posts svgData and layerData as two separate base64 strings, so each pads to its own
   4-byte boundary. treating them as one buffer understates the payload by up to four bytes. */
function base64Length(a, b) { return Math.ceil(a / 3) * 4 + (b ? Math.ceil(b / 3) * 4 : 0) }
// @ts-ignore Buffer is a Node global, present in the CLI/test context (never hit in the browser)
var base64Encode = (typeof btoa !== "undefined") ? btoa : function (s) { return Buffer.from(s, "binary").toString("base64") };
var NOW = (typeof performance !== "undefined" && performance.now) ? function () { return performance.now() } : function () { return 0 };

/* ---------- color space ---------- */
var linearLUT = new Float32Array(256);
(function () { for (var i = 0; i < 256; i++) { var c = i / 255; linearLUT[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; } })();
function rgbToLab(r, g, b, out, off) {
  var R = linearLUT[r], G = linearLUT[g], Bl = linearLUT[b];
  var x = (R * 0.4124 + G * 0.3576 + Bl * 0.1805) / 0.95047;
  var y = (R * 0.2126 + G * 0.7152 + Bl * 0.0722);
  var z = (R * 0.0193 + G * 0.1192 + Bl * 0.9505) / 1.08883;
  x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 0.137931;
  y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 0.137931;
  z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 0.137931;
  out[off] = 116 * y - 16; out[off + 1] = 500 * (x - y); out[off + 2] = 200 * (y - z);
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; } }

/* ---------- preprocessing ---------- */
function adjustColors(d, w, h, o) {
  var tol = o.bgTolerance | 0;
  if (tol > 0) {
    var kr = o.bgKey[0], kg = o.bgKey[1], kb = o.bgKey[2], t2 = tol * tol;
    if (o.bgEdge) {
      var vis = new Uint8Array(w * h), q = [], qi = 0;
      var isBackground = function (i) { var p = i << 2; if (d[p + 3] === 0) return false; var dr = d[p] - kr, dg = d[p + 1] - kg, db = d[p + 2] - kb; return dr * dr + dg * dg + db * db <= t2; };
      for (var x = 0; x < w; x++) { var a = x, b = (h - 1) * w + x; if (!vis[a] && isBackground(a)) { vis[a] = 1; q.push(a); } if (!vis[b] && isBackground(b)) { vis[b] = 1; q.push(b); } }
      for (var y = 0; y < h; y++) { var c = y * w, e = y * w + w - 1; if (!vis[c] && isBackground(c)) { vis[c] = 1; q.push(c); } if (!vis[e] && isBackground(e)) { vis[e] = 1; q.push(e); } }
      while (qi < q.length) {
        var i = q[qi++]; d[(i << 2) + 3] = 0;
        var ix = i % w, iy = (i - ix) / w;
        var nb = [i - 1, i + 1, i - w, i + w], nx = [ix - 1, ix + 1, ix, ix], ny = [iy, iy, iy - 1, iy + 1];
        for (var n = 0; n < 4; n++) { if (nx[n] < 0 || nx[n] >= w || ny[n] < 0 || ny[n] >= h) continue; var j = nb[n]; if (!vis[j] && isBackground(j)) { vis[j] = 1; q.push(j); } }
      }
    } else {
      for (var i2 = 0, n2 = w * h * 4; i2 < n2; i2 += 4) { if (d[i2 + 3] === 0) continue; var dr2 = d[i2] - kr, dg2 = d[i2 + 1] - kg, db2 = d[i2 + 2] - kb; if (dr2 * dr2 + dg2 * dg2 + db2 * db2 <= t2) d[i2 + 3] = 0; }
    }
  }
  var br = o.brightness * 2.55, cf = (259 * (o.contrast + 255)) / (255 * (259 - o.contrast)), sat = o.saturation / 100;
  if (o.brightness !== 0 || o.contrast !== 0 || sat !== 1) {
    for (var i3 = 0, n3 = w * h * 4; i3 < n3; i3 += 4) {
      if (d[i3 + 3] === 0) continue;
      var r = d[i3] + br, g = d[i3 + 1] + br, bl = d[i3 + 2] + br;
      r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; bl = cf * (bl - 128) + 128;
      if (sat !== 1) { var lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl; r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; bl = lum + (bl - lum) * sat; }
      d[i3] = clamp(r | 0, 0, 255); d[i3 + 1] = clamp(g | 0, 0, 255); d[i3 + 2] = clamp(bl | 0, 0, 255);
    }
  }
}
/* bleeds neighbor color into transparent pixels: prevents gradient/quantization fringing */
function defringe(d, w, h, iters) {
  var flag = new Uint8Array(w * h), amin = TUNING.defringeAlphaMin;
  for (var i = 0, n = w * h; i < n; i++)flag[i] = d[(i << 2) + 3] >= amin ? 1 : 0;   /* low-alpha cutout fringe carries unreliable colour: treat it as needing colour bled from the reliable core, not as a colour source */
  for (var it = 0; it < iters; it++) {
    var nf = new Uint8Array(flag);
    var changed = false;
    for (var y = 0; y < h; y++)for (var x = 0; x < w; x++) {
      var i2 = y * w + x; if (flag[i2]) continue;
      var sr = 0, sg = 0, sb = 0, c = 0;
      if (x > 0 && flag[i2 - 1]) { var p = (i2 - 1) << 2; sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; c++; }
      if (x < w - 1 && flag[i2 + 1]) { var p2 = (i2 + 1) << 2; sr += d[p2]; sg += d[p2 + 1]; sb += d[p2 + 2]; c++; }
      if (y > 0 && flag[i2 - w]) { var p3 = (i2 - w) << 2; sr += d[p3]; sg += d[p3 + 1]; sb += d[p3 + 2]; c++; }
      if (y < h - 1 && flag[i2 + w]) { var p4 = (i2 + w) << 2; sr += d[p4]; sg += d[p4 + 1]; sb += d[p4 + 2]; c++; }
      if (c) { var q = i2 << 2; d[q] = (sr / c) | 0; d[q + 1] = (sg / c) | 0; d[q + 2] = (sb / c) | 0; nf[i2] = 1; changed = true; }
    }
    flag = nf;
    if (!changed) break;
  }
}
/* 512 -> N area-weighted downscale (premultiplied, separable fractional box) */
function downscale(src, S, N, sharp) {
  if (N === S) return new Uint8ClampedArray(src);
  if (sharp) {   /* nearest-neighbor: no smoothing, keeps hard pixel edges (Sharp resize) */
    var nout = new Uint8ClampedArray(N * N * 4);
    for (var ny = 0; ny < N; ny++) {
      var sy = ((ny + 0.5) * S / N) | 0; if (sy >= S) sy = S - 1;
      for (var nx = 0; nx < N; nx++) {
        var sx = ((nx + 0.5) * S / N) | 0; if (sx >= S) sx = S - 1;
        var sp = (sy * S + sx) << 2, np = (ny * N + nx) << 2;
        nout[np] = src[sp]; nout[np + 1] = src[sp + 1]; nout[np + 2] = src[sp + 2]; nout[np + 3] = src[sp + 3];
      }
    }
    return nout;
  }
  var tmp = new Float64Array(N * S * 4);
  var r = N / S;
  for (var y = 0; y < S; y++) {
    var row = y * S, trow = y * N;
    for (var x = 0; x < S; x++) {
      var p = (row + x) << 2, a = src[p + 3] / 255;
      var f0 = x * r, f1 = f0 + r, i0 = f0 | 0, i1 = Math.min(N - 1, Math.ceil(f1) - 1);
      for (var ix = i0; ix <= i1; ix++) {
        var wgt = Math.min(f1, ix + 1) - Math.max(f0, ix); if (wgt <= 0) continue;
        var t = (trow + ix) << 2;
        tmp[t] += src[p] * a * wgt; tmp[t + 1] += src[p + 1] * a * wgt; tmp[t + 2] += src[p + 2] * a * wgt; tmp[t + 3] += a * wgt;
      }
    }
  }
  var out = new Uint8ClampedArray(N * N * 4);
  /* alpha normalization: geometric weight per output pixel is S/N (column coverage 1, row 1/r = S/N),
     not (S/N)^2, which under-weights opaque pixels and fades colour. */
  var area = S / N;
  for (var xx = 0; xx < N; xx++) {
    for (var yy = 0; yy < N; yy++) {
      var pr = 0, pg = 0, pb = 0, pa = 0;
      var f0y = yy / r, f1y = f0y + 1 / r, j0 = f0y | 0, j1 = Math.min(S - 1, Math.ceil(f1y) - 1);
      for (var jy = j0; jy <= j1; jy++) {
        var wy = Math.min(f1y, jy + 1) - Math.max(f0y, jy); if (wy <= 0) continue;
        var t2 = (jy * N + xx) << 2;
        pr += tmp[t2] * wy; pg += tmp[t2 + 1] * wy; pb += tmp[t2 + 2] * wy; pa += tmp[t2 + 3] * wy;
      }
      var q = (yy * N + xx) << 2;
      if (pa > 1e-6) { out[q] = pr / pa; out[q + 1] = pg / pa; out[q + 2] = pb / pa; out[q + 3] = pa / area * 255; }
    }
  }
  return out;
}
/* edge-preserving (bilateral) smoothing for the Smoothing slider: each pixel is averaged with its
   neighbours weighted by spatial AND colour distance, so flat areas flatten (fewer runs = smaller)
   while edges stay sharp. strength 0..100; transparent pixels untouched. */
function bilateralSmooth(d, N, strength) {
  if (strength <= 0) return;
  var s = strength / 100;
  var r = s < TUNING.smoothRadiusSplit ? TUNING.smoothRadiusLo : TUNING.smoothRadiusHi;
  var ss = TUNING.smoothSpatialBase + s * TUNING.smoothSpatialScale, sinv = 1 / (2 * ss * ss);
  var cs = TUNING.smoothColorBase + s * TUNING.smoothColorScale, cinv = 1 / (2 * cs * cs);       /* colour sigma: higher strength merges more */
  var src = new Float32Array(N * N * 4); src.set(d);
  for (var y = 0; y < N; y++)for (var x = 0; x < N; x++) {
    var p = (y * N + x) << 2;
    if (src[p + 3] === 0) continue;
    var c0 = src[p], c1 = src[p + 1], c2 = src[p + 2];
    var ar = 0, ag = 0, ab = 0, aa = 0, wsum = 0;
    for (var dy = -r; dy <= r; dy++) {
      var yy = y + dy; if (yy < 0 || yy >= N) continue;
      for (var dx = -r; dx <= r; dx++) {
        var xx = x + dx; if (xx < 0 || xx >= N) continue;
        var q = (yy * N + xx) << 2; if (src[q + 3] === 0) continue;
        var er = src[q] - c0, eg = src[q + 1] - c1, eb = src[q + 2] - c2;
        var w = Math.exp(-(dx * dx + dy * dy) * sinv - (er * er + eg * eg + eb * eb) * cinv);
        ar += src[q] * w; ag += src[q + 1] * w; ab += src[q + 2] * w; aa += src[q + 3] * w; wsum += w;
      }
    }
    if (wsum > 0) { d[p] = clamp(ar / wsum, 0, 255); d[p + 1] = clamp(ag / wsum, 0, 255); d[p + 2] = clamp(ab / wsum, 0, 255); d[p + 3] = clamp(aa / wsum, 0, 255); }
  }
}
/* add random film grain (strength 0..100); transparent pixels untouched. adds texture and bytes. */
function addNoise(d, w, h, strength) {
  if (strength <= 0) return;
  var amp = strength / 100 * 60, rng = mulberry32(0xAA231975);
  for (var y = 0; y < h; y++)for (var x = 0; x < w; x++) {
    var p = (y * w + x) << 2;
    if (d[p + 3] === 0) continue;
    var n = (rng() - 0.5) * amp * 2;
    d[p] = clamp(d[p] + n, 0, 255); d[p + 1] = clamp(d[p + 1] + n, 0, 255); d[p + 2] = clamp(d[p + 2] + n, 0, 255);
  }
}
function countColors(d, n4, cap) {
  var seen = new Set();
  for (var i = 0; i < n4; i += 4) { if (d[i + 3] < 8) continue; seen.add(d[i] * 65536 + d[i + 1] * 256 + d[i + 2]); if (seen.size > cap) return cap + 1; }
  return seen.size;
}
/* alpha posterization (budget-pressure step): 5 levels, lowers stop cost */
function posterizeAlpha(d, n4) {
  for (var i = 3; i < n4; i += 4) { var a = d[i]; if (a < 8) { d[i] = 0; continue } d[i] = clamp(Math.round(Math.round(a / 63.75) * 63.75), 0, 255); }
}

/* ---------- quantization: histogram k-means (Lab, k-means++ seed) ---------- */
function quantize(d, N, k, dither, iters) {
  var rgbaLen = N * N * 4;
  var uniq = new Map(), over = false;
  for (var i = 0; i < rgbaLen; i += 4) {
    if (d[i + 3] < 8) continue;
    var key = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
    if (!uniq.has(key)) { if (uniq.size >= 4096) { over = true; break } uniq.set(key, 1); }
  }
  if (!over && uniq.size <= k && !dither) {
    var pal0 = []; uniq.forEach(function (_, key) { pal0.push([(key >> 16) & 255, (key >> 8) & 255, key & 255]); });
    return { pal: pal0, exact: true };
  }
  /* 5-bit histogram */
  var hw = new Float64Array(32768), hr = new Float64Array(32768), hg = new Float64Array(32768), hb = new Float64Array(32768);
  for (var i2 = 0; i2 < rgbaLen; i2 += 4) {
    var a = d[i2 + 3]; if (a < 8) continue; var w = a / 255;
    var bk = ((d[i2] >> 3) << 10) | ((d[i2 + 1] >> 3) << 5) | (d[i2 + 2] >> 3);
    hw[bk] += w; hr[bk] += d[i2] * w; hg[bk] += d[i2 + 1] * w; hb[bk] += d[i2 + 2] * w;
  }
  var bins = [];
  for (var b = 0; b < 32768; b++)if (hw[b] > 0) bins.push(b);
  var m = bins.length;
  var brgb = new Float32Array(m * 3), blab = new Float32Array(m * 3), bw = new Float64Array(m);
  for (var j = 0; j < m; j++) {
    var bk2 = bins[j], w2 = hw[bk2];
    var r = hr[bk2] / w2, g = hg[bk2] / w2, bl = hb[bk2] / w2;
    brgb[j * 3] = r; brgb[j * 3 + 1] = g; brgb[j * 3 + 2] = bl; bw[j] = w2;
    rgbToLab(clamp(r | 0, 0, 255), clamp(g | 0, 0, 255), clamp(bl | 0, 0, 255), blab, j * 3);
  }
  var paletteSize = Math.min(k, m);
  var QC = TUNING.qChroma;   /* hoisted out of the four distance loops below */
  /* k-means++ */
  var rng = mulberry32(7);
  var cen = new Float32Array(paletteSize * 3), cenRGB = new Float32Array(paletteSize * 3);
  var dist = new Float64Array(m);
  var first = 0, bestw = -1;
  for (var j2 = 0; j2 < m; j2++)if (bw[j2] > bestw) { bestw = bw[j2]; first = j2; }
  cen.set(blab.subarray(first * 3, first * 3 + 3), 0); cenRGB.set(brgb.subarray(first * 3, first * 3 + 3), 0);
  for (var j3 = 0; j3 < m; j3++) { var dl = blab[j3 * 3] - cen[0], da = blab[j3 * 3 + 1] - cen[1], db = blab[j3 * 3 + 2] - cen[2]; dist[j3] = (dl * dl + QC * (da * da + db * db)) * bw[j3]; }
  for (var c = 1; c < paletteSize; c++) {
    var tot = 0; for (var j4 = 0; j4 < m; j4++)tot += dist[j4];
    var pickv = rng() * tot, acc = 0, pick = m - 1;
    for (var j5 = 0; j5 < m; j5++) { acc += dist[j5]; if (acc >= pickv) { pick = j5; break } }
    cen.set(blab.subarray(pick * 3, pick * 3 + 3), c * 3); cenRGB.set(brgb.subarray(pick * 3, pick * 3 + 3), c * 3);
    for (var j6 = 0; j6 < m; j6++) {
      var dl2 = blab[j6 * 3] - cen[c * 3], da2 = blab[j6 * 3 + 1] - cen[c * 3 + 1], db2 = blab[j6 * 3 + 2] - cen[c * 3 + 2];
      var dd = (dl2 * dl2 + QC * (da2 * da2 + db2 * db2)) * bw[j6];
      if (dd < dist[j6]) dist[j6] = dd;
    }
  }
  /* Lloyd */
  var asg = new Int32Array(m);
  for (var it = 0, ITN = iters || ENGINE_DEFAULTS.quantIters; it < ITN; it++) {
    var moved = false;
    for (var j7 = 0; j7 < m; j7++) {
      var bi = 0, bd = 1e18;
      for (var c2 = 0; c2 < paletteSize; c2++) {
        var dl3 = blab[j7 * 3] - cen[c2 * 3], da3 = blab[j7 * 3 + 1] - cen[c2 * 3 + 1], db3 = blab[j7 * 3 + 2] - cen[c2 * 3 + 2];
        var dd2 = dl3 * dl3 + QC * (da3 * da3 + db3 * db3);
        if (dd2 < bd) { bd = dd2; bi = c2; }
      }
      if (asg[j7] !== bi) { asg[j7] = bi; moved = true; }
    }
    if (!moved && it > 0) break;
    var sw = new Float64Array(paletteSize), sl = new Float64Array(paletteSize * 3), sr = new Float64Array(paletteSize * 3);
    for (var j8 = 0; j8 < m; j8++) {
      var a2 = asg[j8], w3 = bw[j8]; sw[a2] += w3;
      sl[a2 * 3] += blab[j8 * 3] * w3; sl[a2 * 3 + 1] += blab[j8 * 3 + 1] * w3; sl[a2 * 3 + 2] += blab[j8 * 3 + 2] * w3;
      sr[a2 * 3] += brgb[j8 * 3] * w3; sr[a2 * 3 + 1] += brgb[j8 * 3 + 1] * w3; sr[a2 * 3 + 2] += brgb[j8 * 3 + 2] * w3;
    }
    for (var c3 = 0; c3 < paletteSize; c3++)if (sw[c3] > 0) {
      cen[c3 * 3] = sl[c3 * 3] / sw[c3]; cen[c3 * 3 + 1] = sl[c3 * 3 + 1] / sw[c3]; cen[c3 * 3 + 2] = sl[c3 * 3 + 2] / sw[c3];
      cenRGB[c3 * 3] = sr[c3 * 3] / sw[c3]; cenRGB[c3 * 3 + 1] = sr[c3 * 3 + 1] / sw[c3]; cenRGB[c3 * 3 + 2] = sr[c3 * 3 + 2] / sw[c3];
    }
  }
  var pal = [], palLab = new Float32Array(paletteSize * 3);
  for (var c4 = 0; c4 < paletteSize; c4++) {
    var pr = clamp(Math.round(cenRGB[c4 * 3]), 0, 255), pg = clamp(Math.round(cenRGB[c4 * 3 + 1]), 0, 255), pb = clamp(Math.round(cenRGB[c4 * 3 + 2]), 0, 255);
    pal.push([pr, pg, pb]); rgbToLab(pr, pg, pb, palLab, c4 * 3);
  }
  var cache = new Map(), tmp3 = new Float32Array(3);
  function nearest(r, g, b) {
    var key = r * 65536 + g * 256 + b, hit = cache.get(key);
    if (hit !== undefined) return hit;
    rgbToLab(r, g, b, tmp3, 0);
    var bi = 0, bd = 1e18;
    for (var c5 = 0; c5 < paletteSize; c5++) {
      var dl4 = tmp3[0] - palLab[c5 * 3], da4 = tmp3[1] - palLab[c5 * 3 + 1], db4 = tmp3[2] - palLab[c5 * 3 + 2];
      var dd3 = dl4 * dl4 + QC * (da4 * da4 + db4 * db4);
      if (dd3 < bd) { bd = dd3; bi = c5; }
    }
    cache.set(key, bi); return bi;
  }
  if (dither) {
    /* Floyd-Steinberg, serpentine */
    var er = new Float32Array(N * 3);
    for (var y = 0; y < N; y++) {
      var ltr = (y % 2) === 0;
      var xs = ltr ? 0 : N - 1, xe = ltr ? N : -1, st = ltr ? 1 : -1;
      var next = new Float32Array(N * 3);
      for (var x = xs; x !== xe; x += st) {
        var p = (y * N + x) << 2;
        if (d[p + 3] < 8) { continue }
        var r2 = clamp(Math.round(d[p] + er[x * 3]), 0, 255), g2 = clamp(Math.round(d[p + 1] + er[x * 3 + 1]), 0, 255), b2 = clamp(Math.round(d[p + 2] + er[x * 3 + 2]), 0, 255);
        var pi = nearest(r2, g2, b2), pc = pal[pi];
        var e0 = r2 - pc[0], e1 = g2 - pc[1], e2 = b2 - pc[2];
        d[p] = pc[0]; d[p + 1] = pc[1]; d[p + 2] = pc[2];
        var xn = x + st;
        if (xn >= 0 && xn < N) { er[xn * 3] += e0 * 7 / 16; er[xn * 3 + 1] += e1 * 7 / 16; er[xn * 3 + 2] += e2 * 7 / 16; }
        if (y + 1 < N) {
          var xp = x - st;
          if (xp >= 0 && xp < N) { next[xp * 3] += e0 * 3 / 16; next[xp * 3 + 1] += e1 * 3 / 16; next[xp * 3 + 2] += e2 * 3 / 16; }
          next[x * 3] += e0 * 5 / 16; next[x * 3 + 1] += e1 * 5 / 16; next[x * 3 + 2] += e2 * 5 / 16;
          if (xn >= 0 && xn < N) { next[xn * 3] += e0 * 1 / 16; next[xn * 3 + 1] += e1 * 1 / 16; next[xn * 3 + 2] += e2 * 1 / 16; }
        }
      }
      er = next;
    }
  } else {
    for (var i4 = 0; i4 < rgbaLen; i4 += 4) {
      if (d[i4 + 3] < 8) continue;
      var pc2 = pal[nearest(d[i4], d[i4 + 1], d[i4 + 2])];
      d[i4] = pc2[0]; d[i4 + 1] = pc2[1]; d[i4 + 2] = pc2[2];
    }
  }
  return { pal: pal, exact: false };
}

/* ---------- strip encoder: hard runs -> solid fill or gradient stops ----------
   axis 0: horizontal strips (rows), 1: vertical strips (columns). */
function encodePixelStrips(d, N, axis, opt) {
  opt = opt || {};
  var prec = opt.precision != null ? opt.precision : ENGINE_DEFAULTS.precision;
  var overlap = opt.overlap != null ? opt.overlap : ENGINE_DEFAULTS.overlap;
  var stepL = axis === 0 ? N * 4 : 4, stepI = axis === 0 ? 4 : N * 4;
  var groups = []; /* {l0,span,solid,stops,model,sig,domColor} */
  var anchorGi = -1, anchorSig = null;

  for (var l = 0; l < N; l++) {
    var base = l * stepL;
    var vis = false;
    for (var i = 0; i < N; i++)if (d[base + i * stepI + 3] > 0) { vis = true; break }
    if (!vis) { anchorGi = -1; continue }

    var stops = null, model = null, solid = null, sig = "", domColor = null;
    var runs = [], cur = -1;
    for (var i2 = 0; i2 < N; i2++) {
      var o = base + i2 * stepI;
      var key = ((d[o] * 256 + d[o + 1]) * 256 + d[o + 2]) * 256 + d[o + 3];
      if (key !== cur) { runs.push([i2, d[o], d[o + 1], d[o + 2], d[o + 3]]); cur = key; }
    }
    /* dominant color: the longest run (fills the layer's editor color field) */
    var domLen = -1;
    for (var ri = 0; ri < runs.length; ri++) {
      var len = (ri + 1 < runs.length ? runs[ri + 1][0] : N) - runs[ri][0];
      if (runs[ri][4] > 0 && len > domLen) { domLen = len; domColor = [runs[ri][1], runs[ri][2], runs[ri][3]]; }
    }
    if (runs.length === 1) {
      var R0 = runs[0]; solid = [R0[1], R0[2], R0[3], R0[4]]; sig = "S" + cur;
      model = [[0, R0[1], R0[2], R0[3], R0[4]]];
    } else {
      stops = []; model = [];
      for (var j = 1; j < runs.length; j++) {
        var t = formatNum(bboxOffset(runs[j][0] / N, axis), prec), A = runs[j - 1], Bx = runs[j];
        stops.push([t, A[1], A[2], A[3], A[4]]);
        stops.push([t, Bx[1], Bx[2], Bx[3], Bx[4]]);
      }
      var RL = runs[runs.length - 1];
      /* the last coincident pair already carries the final run's colour, and pad paints it from there to
         the edge, so a closing stop at offset 1 states what the renderer would do anyway: 39 bytes per
         gradient with no rendered effect. */
      if (!V2.dropPixelTail) stops.push(["1", RL[1], RL[2], RL[3], RL[4]]);
      for (var j2 = 0; j2 < stops.length; j2++) { var s = stops[j2]; model.push([parseFloat(s[0]), s[1], s[2], s[3], s[4]]); }
      sig = stops.join("|");
    }

    /* span merge: adjacent identical strips become one taller layer */
    var merged = (anchorGi >= 0 && groups[anchorGi].l0 + groups[anchorGi].span === l && anchorSig === sig);
    if (merged) { groups[anchorGi].span++; continue }
    groups.push({ l0: l, span: 1, solid: solid, stops: stops, model: model, sig: sig, domColor: domColor });
    anchorGi = groups.length - 1; anchorSig = sig;
  }

  codebookSnap(groups);
  return serializeStrips(groups, N, axis, prec, overlap, "strip");
}
/* deterministic non-cryptographic 64-bit hash: two decorrelated 32-bit lanes, base36, each padded to a
   fixed width so the halves can never alias. sole use is deriving a per-emblem id prefix. */
function hash64(s) {
  var h1 = 0xcafebabe, h2 = 0x41c6ce57, i, c;
  for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  var a = (h1 >>> 0).toString(36), b = (h2 >>> 0).toString(36);
  return "0000000".slice(a.length) + a + "0000000".slice(b.length) + b;
}
/* per-emblem id prefix, hashed from the ordered strip signatures. gradient ids are scoped by this prefix
   so one emblem's gradients never bleed onto another when several share a single document: under a plain
   "0","1"... namespace, url(#) resolution binds every duplicate id to the first matching definition on the
   page. content-derived, so no persisted counter is needed and output stays reproducible; two identical
   emblems share a prefix harmlessly, since their gradient definitions match anyway. */
function emblemIdPrefix(groups, axis) {
  var s = "" + axis, i, g;
  for (i = 0; i < groups.length; i++) { g = groups[i]; s += ";" + g.l0 + "," + g.span + "," + g.sig; }
  return "g" + hash64(s).slice(0, 4);   /* 4 hash chars = 1.7M prefixes (36^4). a collision would make a second emblem on the same page resolve url(#id) to the first one's gradient, so it is worth a byte: at 10 emblems the odds fall from about 1 in 1000 on a 3-char prefix to 1 in 30000, for two bytes per gradient: 512 at N=256, measured. */
}
/* shared strip emission: turn strip groups into the accepted svg + min/full layer JSON. one source for
   both the hard-run and piecewise-linear encoders, so the two stay byte-identical in every format detail
   (gradient dedup, 6-digit hex, leading-zero decimals, matrix precision). kind ("strip" | "strip-pl")
   suffixes the method label; g.stops holds coincident pairs for hard steps, distinct offsets for smooth ramps. */
function serializeStrips(groups, N, axis, prec, overlap, kind, bounds) {
  var h = EMBLEM / N;
  function edge(l) { return bounds ? bounds[l] : l * h; }   /* the cross-axis position of boundary l: an integer row under adaptive heights, a multiple of h under the uniform grid */
  var defs = "", paths = "", gm = new Map(), idp = V2.shortIds ? "" : emblemIdPrefix(groups, axis);   /* content-hashed prefix: keeps this emblem's gradient ids from colliding with other emblems' on a shared page. the snippet posts one emblem into a page it then reloads, so under shortIds a plain counter is enough. */
  var Lmin =/** @type {Layer[]} */([backgroundLayer]), Lfull =/** @type {Layer[]} */([backgroundLayer]);
  var idx = 0, totalStops = 0;
  /* a layer scale is the matrix value times 100, so it reaches the same absolute accuracy two decimals earlier */
  var lprecA = V2.layerPrecision ? Math.max(0, prec - 2) : prec, lprecD = V2.layerPrecision ? Math.max(0, Math.max(4, prec) - 2) : prec;
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    var tx, ty, aS, dS;
    /* seam guard: the editor rescales the emblem to arbitrary sizes, so strip edges land on fractional
       pixels and its non-conflating renderer leaks the backing through as seams. extend each strip into
       the next by overlap units (the Overlap control) where an adjacent strip follows, capped at the
       contiguous opaque run below so nothing bleeds into a gap or past the edge. rasterizeStrips ignores
       this, so candidate selection is unchanged. */
    var OVeff = 0;
    if (g.a1 != null) { OVeff = g.ov || 0; }   /* PL gap-split segment: overlap precomputed per-segment against the source (PASS 3 of encodeSmoothStrips) */
    else if (overlap > 0 && gi + 1 < groups.length && groups[gi + 1].l0 === g.l0 + g.span) {
      var runEnd = g.l0 + g.span;
      for (var gj = gi + 1; gj < groups.length && groups[gj].l0 === runEnd; gj++)runEnd = groups[gj].l0 + groups[gj].span;
      OVeff = Math.min(overlap, edge(runEnd) - edge(g.l0 + g.span));
    }
    var yTop = edge(g.l0), yExt = edge(g.l0 + g.span) - yTop;
    var aLen = g.a1 != null ? g.a1 - g.a0 : EMBLEM, aPos = g.a1 != null ? g.a0 : 0;   /* along-axis extent: a partial segment for PL gap-split, full width for hard-run (a1 unset => byte-identical) */
    if (axis === 0) { tx = aPos; ty = yTop; aS = aLen / SLUG_W; dS = (yExt + OVeff) / SLUG_H; }
    else { ty = aPos; tx = yTop; aS = (yExt + OVeff) / SLUG_W; dS = aLen / SLUG_H; }
    var fill, layerColor;
    if (g.solid) {
      var hexS = rgbToHex(g.solid[0], g.solid[1], g.solid[2]);
      var op = g.solid[3] / 255;
      fill = 'fill="' + hexS + '"' + (op < 1 ? ' fill-opacity="' + formatNum(op, 3) + '"' : '');
      layerColor = hexS;
    } else {
      var stopsStr = "", stC = '/>';   /* both encoders self-close their stops, which the editor accepts and which is smaller than the verbose </stop> form. PL gap-split and hard-run coincident pairs emit the same way. */
      /* one alpha shared by every stop is a property of the whole gradient, and svg multiplies the
         fill's opacity into it, so stating it once on the path renders identically. it also lets two
         gradients that differ only in alpha dedup onto one definition. */
      var ca = g.stops[0][4], allA = true;
      for (var sa = 1; sa < g.stops.length; sa++)if (g.stops[sa][4] !== ca) { allA = false; break }
      var hoist = V2.hoistAlpha && allA && ca < 255;
      for (var si = 0; si < g.stops.length; si++) {
        var st = g.stops[si];
        var inferred = si === 0 ? "0" : String(g.stops[si - 1][0]);   /* an absent offset reads as 0 and is then clamped up to the largest offset already seen, so leaving it out states exactly this value */
        var off = String(st[0]) === inferred ? "" : ' offset="' + st[0] + '"';   /* free on the first stop, and on the second of every coincident pair - which is every run boundary the hard-run encoder writes, about a sixth of the payload. the editor renders the omitted offset identically. */
        stopsStr += '<stop' + off + ' stop-color="' + rgbToHex(st[1], st[2], st[3]) + '"' + (!hoist && st[4] < 255 ? ' stop-opacity="' + formatNum(st[4] / 255, 3) + '"' : '') + stC;
      }
      totalStops += g.stops.length;
      var gkey = (axis === 0 ? "h" : "v") + stopsStr;
      var gid = gm.get(gkey);
      if (gid === undefined) {
        gid = V2.shortIds ? "a" + base62(gm.size) : idp + "_" + gm.size; gm.set(gkey, gid);   /* prefix + local index: unique across emblems, deduped within one */
        defs += '<linearGradient id="' + gid + '"' + (axis === 0 ? '' : ' x2="0" y2="1"') + '>' + stopsStr + '</linearGradient>';
      }
      fill = 'fill="url(#' + gid + ')"' + (hoist ? ' fill-opacity="' + formatNum(ca / 255, 3) + '"' : '');
      layerColor = g.domColor ? rgbToHex(g.domColor[0], g.domColor[1], g.domColor[2]) : rgbToHex(g.stops[0][1], g.stops[0][2], g.stops[0][3]);
    }
    var mtx = 'matrix(' + formatNum(aS, prec) + ',0,0,' + formatNum(dS, Math.max(4, prec)) + ',' + formatNum(tx, prec) + ',' + formatNum(ty, prec) + ')';
    paths += '<path ' + fill + ' d="' + SLUG + '" transform="' + mtx + '"/>';
    idx++;
    var sx = Math.max(1, roundTo(aS * 100, lprecA)), sy = Math.max(1, roundTo(dS * 100, lprecD)), lx = roundTo(tx, prec), ly = roundTo(ty, prec);
    Lmin.push({ x: lx, y: ly, scaleX: sx, scaleY: sy, color: layerColor });   /* minimal layer: the editor infers id, slug, type and index from array order, so layerData is much smaller for the same render. color and zero coordinates must stay. Lfull is the explicit fallback. */
    Lfull.push({ id: "e" + idx, name: "21", type: "path", y: ly, x: lx, scaleY: sy, scaleX: sx, invertedY: 0, invertedX: 0, rotation: 0, opacity: 100, index: idx, color: layerColor, isFilled: 1, internal: 0, locked: 0, tBold: 0, tItalic: 0, fontFamily: null, borderColor: "#0", borderSize: 0, gradientStyle: "Fill", slug: "rectangles/21", width: 66.47, height: 300 });
  }
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" version="1.1"><defs>' + defs + '</defs>' + BGRECT + paths + '</svg>';
  var lmin = JSON.stringify(Lmin), lfull = JSON.stringify(Lfull);
  return {
    kind: kind, axis: axis, N: N, bounds: bounds, svg: svg, lmin: lmin, lfull: lfull,
    count: idx, stops: totalStops, defs: gm.size,
    enc: base64Length(svg.length, lmin.length), encFull: base64Length(svg.length, lfull.length),
    groups: groups,
    method: "Strip" + (axis === 0 ? "-H" : "-V") + (kind === "strip-pl" ? "-PL" : "")
  };
}
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }   /* clamp + round to a 0-255 byte */
/* ---------- input conditioning, along the fit axis ----------
   applied to the strip's own averaged profile, which is the signal the fit sees and the first point at
   which the axis is known. only the chroma lowpass is on: it blurs hue and writes luma back exactly, so
   it removes what the luma metric cannot see and nothing it can. the other two are off and measured:
   smoothing this signal is not free, and it is not spending bytes on detail the format cannot hold -
   with the cap lifted the format reaches 99.9 on every work in the benchmark, so what is scarce here is
   bytes, never representation. */
var _condTmp = null, _srgbLin = null, _linSrgb = null;
function condScratch(S) {
  if (!_condTmp || _condTmp.length < S * 4) _condTmp = new Float32Array(S * 4);
  return _condTmp;
}
/* disabled (V2.sgFilter). a symmetric moving average is the order-1 fit evaluated at the centre, so
   unlike a bilateral it reproduces a ramp with zero bias, and the range limit guards steps. it still
   loses: what it removes is not noise the fit was paying for but real detail, and the bytes it saves
   never buy that detail back, at a full budget or at 300 KB. */
function sgSmooth(row, S) {
  var h = TUNING.sgHalf, r = TUNING.sgRange, t = condScratch(S), i, k;
  for (i = 0; i < S * 4; i++)t[i] = row[i];
  for (i = 0; i < S; i++) {
    var o = i * 4, sr = 0, sg = 0, sb = 0, n = 0;
    for (k = -h; k <= h; k++) {
      var j = i + k; if (j < 0 || j >= S) continue;
      var p = j * 4;
      if (t[p] - t[o] > r || t[o] - t[p] > r || t[p + 1] - t[o + 1] > r || t[o + 1] - t[p + 1] > r || t[p + 2] - t[o + 2] > r || t[o + 2] - t[p + 2] > r) continue;
      sr += t[p]; sg += t[p + 1]; sb += t[p + 2]; n++;
    }
    if (n > 1) { row[o] = sr / n; row[o + 1] = sg / n; row[o + 2] = sb / n; }
  }
}
/* fidelity and the palette are both scored on luma, so hue detail buys nothing and still pays for
   knots. blur the colour and add each sample's luma difference back to all three channels: that shifts
   luma by exactly that difference, so the restore is exact and needs no colour space conversion. */
function chromaBlur(row, S) {
  var h = TUNING.chromaBlurHalf, t = condScratch(S), i, k;
  for (i = 0; i < S * 4; i++)t[i] = row[i];
  for (i = 0; i < S; i++) {
    var o = i * 4, sr = 0, sg = 0, sb = 0, n = 0;
    for (k = -h; k <= h; k++) { var j = i + k; if (j < 0 || j >= S) continue; var p = j * 4; sr += t[p]; sg += t[p + 1]; sb += t[p + 2]; n++; }
    sr /= n; sg /= n; sb /= n;
    var d = (0.2126 * t[o] + 0.7152 * t[o + 1] + 0.0722 * t[o + 2]) - (0.2126 * sr + 0.7152 * sg + 0.0722 * sb);
    row[o] = clampByte(sr + d); row[o + 1] = clampByte(sg + d); row[o + 2] = clampByte(sb + d);
  }
}
/* disabled (V2.deadband). on a smooth ramp the single-count steps between neighbours are the gradient
   itself, not noise, so snapping them onto a run anchor writes a staircase where a two-stop ramp would
   do. it costs bytes rather than saving them, +45% on a photograph, and loses fidelity on every work
   measured. it would need a run-length limit or slope adaptation to work. */
function snapFlat(row, S) {
  var d = TUNING.deadbandTol, a = 0, i;
  for (i = 1; i < S; i++) {
    var o = i * 4, p = a * 4;
    if (row[o + 3] === row[p + 3] && row[o] - row[p] <= d && row[p] - row[o] <= d && row[o + 1] - row[p + 1] <= d && row[p + 1] - row[o + 1] <= d && row[o + 2] - row[p + 2] <= d && row[p + 2] - row[o + 2] <= d) {
      row[o] = row[p]; row[o + 1] = row[p + 1]; row[o + 2] = row[p + 2];
    } else a = i;
  }
}
function conditionRow(row, S) {
  if (V2.sgFilter) sgSmooth(row, S);
  if (V2.chromaLowpass) chromaBlur(row, S);
  if (V2.deadband) snapFlat(row, S);
}
/* the strip profiles, conditioned, for one (strip count, axis). they depend on nothing the Detail
   search varies, so without a cache the search rebuilds the identical block at every rung. one slot,
   keyed on the source array itself: a search holds one source and walks one pair at a time, and a job
   starts cold (runEncodeJob), so a flag change cannot be served a stale block. */
var _profSrc = null, _profKey = "", _profRows = null;
function stripProfiles(d, S, N, axis, bounds) {
  var key = N + "_" + axis;
  if (_profSrc === d && _profKey === key && _profRows) return _profRows;
  var stepA = axis === 0 ? 4 : S * 4, stepC = axis === 0 ? S * 4 : 4;   /* step ALONG the gradient axis (length S) / ACROSS strips */
  var rows = new Uint8ClampedArray(N * S * 4), lin = V2.linearLight, l, i, c;
  if (lin) srgbLut();
  for (l = 0; l < N; l++) {
    var c0 = bounds ? bounds[l] : (l * S / N) | 0, c1 = bounds ? bounds[l + 1] : Math.max(c0 + 1, ((l + 1) * S / N) | 0), cn = c1 - c0, rb = l * S * 4;
    for (i = 0; i < S; i++) {
      var r = 0, g = 0, b = 0, a = 0, o = rb + (i << 2), p;
      if (lin) {
        for (c = c0; c < c1; c++) { p = c * stepC + i * stepA; r += _srgbLin[d[p]]; g += _srgbLin[d[p + 1]]; b += _srgbLin[d[p + 2]]; a += d[p + 3]; }
        rows[o] = _linSrgb[(r / cn * 4095) | 0]; rows[o + 1] = _linSrgb[(g / cn * 4095) | 0]; rows[o + 2] = _linSrgb[(b / cn * 4095) | 0]; rows[o + 3] = a / cn;
      } else {
        for (c = c0; c < c1; c++) { p = c * stepC + i * stepA; r += d[p]; g += d[p + 1]; b += d[p + 2]; a += d[p + 3]; }
        rows[o] = r / cn; rows[o + 1] = g / cn; rows[o + 2] = b / cn; rows[o + 3] = a / cn;
      }
    }
    conditionRow(rows.subarray(rb, rb + S * 4), S);
  }
  if (!bounds) { _profSrc = d; _profKey = key; _profRows = rows; }   /* adaptive bounds are not part of the key, so that block is not cached */
  return rows;
}
/* sRGB is a display encoding, so averaging in it darkens every mixed edge. the cross-strip average is
   an average of light, which is linear. */
function srgbLut() {
  if (_srgbLin) return;
  _srgbLin = new Float32Array(256); _linSrgb = new Uint8ClampedArray(4096);
  var i, c;
  for (i = 0; i < 256; i++) { c = i / 255; _srgbLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  for (i = 0; i < 4096; i++) { c = i / 4095; _linSrgb[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
}
/* gradient codebook: let a gradient adopt an already-defined one when the two agree within a
   per-channel bound, so the exact dedup in serializeStrips collapses the definition away. compared on a
   fixed sample grid, since the same shape can be written with different knot counts. */
var _cbFeat = null, _cbBook = null;
function gradFeat(g, out, off) {
  var m = g.model, len = m.length, S = TUNING.codebookSamples, i, k = 0;
  for (i = 0; i < S; i++) {
    var t = (i + 0.5) / S, p = off + i * 4;
    while (k + 1 < len && m[k + 1][0] <= t) k++;
    var s0, s1, f;
    if (t <= m[0][0]) { out[p] = m[0][1]; out[p + 1] = m[0][2]; out[p + 2] = m[0][3]; out[p + 3] = m[0][4]; continue; }
    if (k >= len - 1) { s0 = m[len - 1]; out[p] = s0[1]; out[p + 1] = s0[2]; out[p + 2] = s0[3]; out[p + 3] = s0[4]; continue; }
    s0 = m[k]; s1 = m[k + 1];
    var sp = s1[0] - s0[0]; f = sp > 1e-9 ? (t - s0[0]) / sp : 1;
    if (f < 0) f = 0; else if (f > 1) f = 1;
    out[p] = s0[1] + (s1[1] - s0[1]) * f; out[p + 1] = s0[2] + (s1[2] - s0[2]) * f;
    out[p + 2] = s0[3] + (s1[3] - s0[3]) * f; out[p + 3] = s0[4] + (s1[4] - s0[4]) * f;
  }
}
function codebookSnap(groups) {
  if (!V2.codebook) return;
  var S = TUNING.codebookSamples, W = S * 4, tol = TUNING.codebookTol, n = groups.length, i, j, c;
  var need = n * W;
  if (!_cbFeat || _cbFeat.length < need) _cbFeat = new Float32Array(need);
  if (!_cbBook || _cbBook.length < n) _cbBook = new Int32Array(n);
  var F = _cbFeat, book = _cbBook, nb = 0;
  for (i = 0; i < n; i++) {
    var g = groups[i];
    if (!g.stops) { book[i] = -1; continue; }
    gradFeat(g, F, i * W);
    var hit = -1;
    for (j = 0; j < nb; j++) {
      var b = book[j] * W, a = i * W, worst = 0, ok = true;
      for (c = 0; c < W; c++) {
        var d = F[a + c] - F[b + c]; if (d < 0) d = -d;
        if (d > tol) { ok = false; break; }
        if (d > worst) worst = d;
      }
      if (ok) { hit = book[j]; break; }
    }
    if (hit >= 0) {   /* adopt: same stops, same signature, so the exact dedup collapses the definition away */
      var src = groups[hit];
      g.stops = src.stops; g.model = src.model; g.sig = src.sig;
    } else book[nb++] = i;
  }
}
/* adaptive strip heights: merge rows bottom up, always collapsing the cheapest adjacent pair, until N
   strips remain, so boundaries land where the picture changes. every boundary is an integer row index,
   because a fractional rect edge is antialiased into structure the source does not have. */
var _sbP = null, _sbCost = null, _sbPrev = null, _sbNext = null, _sbAlive = null;
function adaptiveBounds(d, S, N, axis) {
  var B = TUNING.stripBins, i, c, b;
  if (N >= S) return null;   /* one row per strip already: nothing to choose */
  var need = (S + 1) * B;
  if (!_sbP || _sbP.length < need) _sbP = new Float64Array(need);
  if (!_sbCost || _sbCost.length < S) { _sbCost = new Float64Array(S); _sbPrev = new Int32Array(S); _sbNext = new Int32Array(S); _sbAlive = new Uint8Array(S); }
  var P = _sbP, stepA = axis === 0 ? 4 : S * 4, stepC = axis === 0 ? S * 4 : 4;
  /* prefix sums of the per-row binned luma: P[(c+1)*B+b] - P[a*B+b] is the sum over rows [a,c] in bin b */
  for (b = 0; b < B; b++)P[b] = 0;
  for (c = 0; c < S; c++) {
    var base = c * stepC, o = (c + 1) * B, pb = c * B;
    for (b = 0; b < B; b++)P[o + b] = P[pb + b];
    for (i = 0; i < S; i++) {
      var q = base + i * stepA, y = (0.2126 * d[q] + 0.7152 * d[q + 1] + 0.0722 * d[q + 2]) * (d[q + 3] / 255);
      P[o + ((i * B / S) | 0)] += y;
    }
  }
  var prev = _sbPrev, next = _sbNext, alive = _sbAlive, cost = _sbCost, len = new Int32Array(S);
  for (c = 0; c < S; c++) { prev[c] = c - 1; next[c] = c + 1; alive[c] = 1; len[c] = 1; }
  next[S - 1] = -1;
  var start = new Int32Array(S); for (c = 0; c < S; c++)start[c] = c;
  /* what merging the run at k with the run after it adds to the total residual: the between-group sum
     of squares, which is the only part that moves. */
  function mergeCost(k) {
    var n = next[k]; if (n < 0) return Infinity;
    var a = start[k], la = len[k], lb = len[n], ab = la + lb, e = 0, bi;
    var oa = a * B, om = (a + la) * B, ob = (a + ab) * B;
    for (bi = 0; bi < B; bi++) {
      var sa = P[om + bi] - P[oa + bi], sb = P[ob + bi] - P[om + bi];
      e += sa * sa / la + sb * sb / lb - (sa + sb) * (sa + sb) / ab;
    }
    return e;
  }
  for (c = 0; c < S; c++)cost[c] = mergeCost(c);
  var cap = 3 * S + 8, hc = new Float64Array(cap), hi = new Int32Array(cap), hn = 0;
  function push(v, idx) { var p = hn++; hc[p] = v; hi[p] = idx; while (p > 0) { var pa = (p - 1) >> 1; if (hc[pa] < hc[p] || (hc[pa] === hc[p] && hi[pa] <= hi[p])) break; var t = hc[pa]; hc[pa] = hc[p]; hc[p] = t; var u = hi[pa]; hi[pa] = hi[p]; hi[p] = u; p = pa; } }
  function pop() { var r = hi[0]; hn--; hc[0] = hc[hn]; hi[0] = hi[hn]; var p = 0; for (; ;) { var l = 2 * p + 1, rr = l + 1, m = p; if (l < hn && (hc[l] < hc[m] || (hc[l] === hc[m] && hi[l] < hi[m]))) m = l; if (rr < hn && (hc[rr] < hc[m] || (hc[rr] === hc[m] && hi[rr] < hi[m]))) m = rr; if (m === p) break; var t = hc[p]; hc[p] = hc[m]; hc[m] = t; var u = hi[p]; hi[p] = hi[m]; hi[m] = u; p = m; } return r; }
  for (c = 0; c < S; c++)push(cost[c], c);
  var cnt = S;
  while (cnt > N && hn > 0) {
    var pc = hc[0], k = pop();
    if (!alive[k] || cost[k] !== pc || next[k] < 0) continue;   /* stale: the run was merged away or its cost changed */
    var n2 = next[k];
    len[k] += len[n2]; alive[n2] = 0; cnt--;
    next[k] = next[n2]; if (next[n2] >= 0) prev[next[n2]] = k;
    cost[k] = mergeCost(k); push(cost[k], k);
    var p2 = prev[k]; if (p2 >= 0) { cost[p2] = mergeCost(p2); push(cost[p2], p2); }
  }
  var out = new Int32Array(N + 1), w = 0, cur = 0;
  while (cur >= 0 && w < N) { out[w++] = start[cur]; cur = next[cur]; }
  out[N] = S;
  if (w < N) return null;   /* the merge could not reach N runs: fall back to the uniform grid */
  return out;
}
/* how far a quantization moved colour, as the mean and 99th percentile of the Lab a/b distance to the
   image it replaced: the axis the fidelity metric is blind to. both are reported because a weight can
   leave the average untouched and still move one saturated region far. the percentile comes off a 256-bin
   histogram, so the pass is linear and allocates nothing. */
var _shiftHist = null, _shiftLa = null, _shiftLb = null;
function chromaShift(before, after, px, out) {
  var h = _shiftHist || (_shiftHist = new Int32Array(256)), la = _shiftLa || (_shiftLa = new Float32Array(4)), lb = _shiftLb || (_shiftLb = new Float32Array(4));
  h.fill(0);
  var i, n = 0, sum = 0;
  for (i = 0; i < px; i++) {
    var o = i << 2; if (before[o + 3] < 8) continue;   /* a transparent pixel carries no colour to move */
    rgbToLab(before[o], before[o + 1], before[o + 2], la, 0);
    rgbToLab(after[o], after[o + 1], after[o + 2], lb, 0);
    var da = la[1] - lb[1], db = la[2] - lb[2], d = Math.sqrt(da * da + db * db);
    sum += d; n++;
    var b = d | 0; h[b > 255 ? 255 : b]++;
  }
  if (!n) { out[0] = 0; out[1] = 0; return; }
  out[0] = sum / n;
  var target = n * 0.99, c = 0, k;
  for (k = 0; k < 256; k++) { c += h[k]; if (c >= target) break; }
  out[1] = k;
}
/* shortest-path knot placement: greedy removal is not the L2 optimum at any knot count, because dropping
   the locally cheapest vertex commits to a segmentation the next removal cannot revisit. edge (i,j) costs
   the squared error of the straight line between samples i and j plus lambda for the knot it spends, and
   is O(1) from prefix sums, so the fit is O(N*span). lambda is the same Detail tolerance the greedy fit used
   as its threshold. about 30 flops per edge, so it refits the winner rather than running in the sweep. */
var _dpCap = 0, _dpArr = null, _dpCost = null, _dpFrom = null, _dpFlat = null;
function fitStopsDP(labs, N, lambda, wv) {
  var out = [], q;
  if (N < 3) { for (q = 0; q < N; q++)out.push(q); return out; }
  var W = TUNING.dpSpan;
  if (_dpCap < N + 1) {
    _dpCap = N + 1; _dpArr = []; for (q = 0; q < 15; q++)_dpArr.push(new Float64Array(_dpCap));
    _dpCost = new Float64Array(_dpCap); _dpFrom = new Int32Array(_dpCap); _dpFlat = new Int32Array(_dpCap);
  }
  var A = _dpArr, P0 = A[0], P1 = A[1], P2 = A[2],
    L0 = A[3], L1 = A[4], L2 = A[5], A0 = A[6], A1 = A[7], A2 = A[8], B0 = A[9], B1 = A[10], B2 = A[11],
    Y0 = A[12], Y1 = A[13], Y2 = A[14];
  var CW = V2.chromaConstraint ? 0 : TUNING.chromaW;   /* under the constraint the fit is luma and alpha only, and chroma is enforced afterwards */
  var t;
  P0[0] = P1[0] = P2[0] = L0[0] = L1[0] = L2[0] = A0[0] = A1[0] = A2[0] = B0[0] = B1[0] = B2[0] = Y0[0] = Y1[0] = Y2[0] = 0;
  for (t = 0; t < N; t++) {
    var w = wv ? wv[t] : 1, o = t * 4, xl = labs[o], xa = labs[o + 1], xb = labs[o + 2], xy = labs[o + 3], k = t + 1, wt = w * t;
    P0[k] = P0[t] + w; P1[k] = P1[t] + wt; P2[k] = P2[t] + wt * t;
    L0[k] = L0[t] + w * xl; L1[k] = L1[t] + wt * xl; L2[k] = L2[t] + w * xl * xl;
    A0[k] = A0[t] + w * xa; A1[k] = A1[t] + wt * xa; A2[k] = A2[t] + w * xa * xa;
    B0[k] = B0[t] + w * xb; B1[k] = B1[t] + wt * xb; B2[k] = B2[t] + w * xb * xb;
    Y0[k] = Y0[t] + xy; Y1[k] = Y1[t] + t * xy; Y2[k] = Y2[t] + xy * xy;
  }
  /* how far back the run of identical samples ending here reaches, so a flat region costs one edge
     however long it is and the span bound cannot force knots into a solid background. */
  var flat = _dpFlat; flat[0] = 0;
  for (t = 1; t < N; t++) {
    var c = t * 4, p = c - 4;
    flat[t] = (labs[c] === labs[p] && labs[c + 1] === labs[p + 1] && labs[c + 2] === labs[p + 2] && labs[c + 3] === labs[p + 3]) ? flat[t - 1] : t;
  }
  var dp = _dpCost, from = _dpFrom, i, j;
  for (j = 0; j < N; j++) { dp[j] = Infinity; from[j] = -1; }
  dp[0] = 0;
  for (j = 1; j < N; j++) {
    var lo = j - W; if (lo < 0) lo = 0;
    var fj = flat[j];
    if (fj < lo && dp[fj] < Infinity) { var cf = dp[fj] + lambda; if (cf < dp[j]) { dp[j] = cf; from[j] = fj; } }
    var oj = j * 4, yj = labs[oj + 3];
    for (i = lo; i < j; i++) {
      var di = dp[i];
      if (di === Infinity || di + lambda >= dp[j]) continue;   /* even a zero-cost edge cannot improve on the best path to j */
      var span = j - i, iL = 1 / span, iL2 = iL * iL, a1 = i + 1;
      var d0 = P0[j] - P0[a1], dt = P1[j] - P1[a1], s1 = dt - i * d0, s2 = (P2[j] - P2[a1]) - 2 * i * dt + i * i * d0;
      var q00 = d0 - 2 * s1 * iL + s2 * iL2, q01 = s1 * iL - s2 * iL2, q11 = s2 * iL2;
      var oi = i * 4, e, xi, xj, T0, T1;
      xi = labs[oi]; xj = labs[oj]; T0 = L0[j] - L0[a1]; T1 = (L1[j] - L1[a1]) - i * T0;
      e = (L2[j] - L2[a1]) - 2 * xi * (T0 - T1 * iL) - 2 * xj * T1 * iL + xi * xi * q00 + 2 * xi * xj * q01 + xj * xj * q11;
      if (CW > 0) {
        xi = labs[oi + 1]; xj = labs[oj + 1]; T0 = A0[j] - A0[a1]; T1 = (A1[j] - A1[a1]) - i * T0;
        e += CW * ((A2[j] - A2[a1]) - 2 * xi * (T0 - T1 * iL) - 2 * xj * T1 * iL + xi * xi * q00 + 2 * xi * xj * q01 + xj * xj * q11);
        xi = labs[oi + 2]; xj = labs[oj + 2]; T0 = B0[j] - B0[a1]; T1 = (B1[j] - B1[a1]) - i * T0;
        e += CW * ((B2[j] - B2[a1]) - 2 * xi * (T0 - T1 * iL) - 2 * xj * T1 * iL + xi * xi * q00 + 2 * xi * xj * q01 + xj * xj * q11);
      }
      var n1 = span - 1, u1 = n1 * span / 2, u2 = n1 * span * (2 * span - 1) / 6;   /* alpha carries no visibility weight, so its moments are closed form */
      xi = labs[oi + 3]; T0 = Y0[j] - Y0[a1]; T1 = (Y1[j] - Y1[a1]) - i * T0;
      e += (Y2[j] - Y2[a1]) - 2 * xi * (T0 - T1 * iL) - 2 * yj * T1 * iL
        + xi * xi * (n1 - 2 * u1 * iL + u2 * iL2) + 2 * xi * yj * (u1 * iL - u2 * iL2) + yj * yj * u2 * iL2;
      if (e < 0) e = 0;
      var cc = di + e + lambda;
      if (cc < dp[j]) { dp[j] = cc; from[j] = i; }
    }
  }
  var cur = N - 1;
  while (cur > 0) { out.push(cur); cur = from[cur]; if (cur < 0) return null; }
  out.push(0); out.reverse();
  return out;
}
/* chroma as a bound rather than a weight: the fit runs on luma and alpha, then any segment whose a/b
   drifts past a fixed distance gets a knot at its worst sample. a weight costs bytes on every segment;
   a bound costs them only where the colour would visibly move. */
function chromaSplit(labs, knots, bound, maxAdd) {
  var adds = [];
  function scan(a, b, depth) {
    if (b - a < 2 || depth > 4 || adds.length >= maxAdd) return;
    var span = b - a, ai = a * 4, bi = b * 4, worst = -1, wi = -1, t;
    var a0 = labs[ai + 1], b0 = labs[ai + 2], da = labs[bi + 1] - a0, db = labs[bi + 2] - b0;
    for (t = a + 1; t < b; t++) {
      var u = (t - a) / span, o = t * 4, ea = labs[o + 1] - (a0 + da * u), eb = labs[o + 2] - (b0 + db * u), d = ea * ea + eb * eb;
      if (d > worst) { worst = d; wi = t; }
    }
    if (worst <= bound || wi < 0) return;
    adds.push(wi); scan(a, wi, depth + 1); scan(wi, b, depth + 1);
  }
  for (var k = 0; k + 1 < knots.length && adds.length < maxAdd; k++)scan(knots[k], knots[k + 1], 0);
  if (!adds.length) return knots;
  var all = knots.concat(adds); all.sort(function (x, y) { return x - y; });
  var out = [all[0]], i;
  for (i = 1; i < all.length; i++)if (all[i] !== all[i - 1]) out.push(all[i]);
  return out;
}
/* L2-optimal knot placement: repeatedly drop the interior vertex whose removal adds the least squared
   error (Lab) to the linear interpolation, until the cheapest removal would exceed thresh. minimising
   squared error tracks what SSIM/PSNR measure. early removals shrink the active set, keeping it fast.
   @param {Float32Array} labs @param {number} N @param {number} thresh @param {Float64Array=} wv per-sample colour-cost weight (visibility); omitted => all-1 (byte-identical) @param {boolean=} useDP solve the objective exactly instead @returns {number[]} */
function fitStops(labs, N, thresh, wv, useDP) {
  var prev = new Int32Array(N), next = new Int32Array(N), alive = new Uint8Array(N), cost = new Float64Array(N), i;
  var CHROMA_W = V2.chromaConstraint ? 0 : TUNING.chromaW;   /* hoisted: segmentCost is the hot loop. under the constraint both fits run on luma and alpha, and chromaSplit enforces colour afterwards, so the two paths stay consistent. */
  for (i = 0; i < N; i++) { prev[i] = i - 1; next[i] = i + 1; alive[i] = 1; }
  next[N - 1] = -1;
  function segmentCost(k) {
    var p = prev[k], n = next[k]; if (p < 0 || n < 0) return Infinity;   /* endpoints are pinned */
    var e = 0, span = n - p, t;
    for (t = p + 1; t < n; t++) {
      var f = (t - p) / span,
        lr = labs[p * 4] + (labs[n * 4] - labs[p * 4]) * f, lg = labs[p * 4 + 1] + (labs[n * 4 + 1] - labs[p * 4 + 1]) * f, lb = labs[p * 4 + 2] + (labs[n * 4 + 2] - labs[p * 4 + 2]) * f, la = labs[p * 4 + 3] + (labs[n * 4 + 3] - labs[p * 4 + 3]) * f,
        dl = labs[t * 4] - lr, da = labs[t * 4 + 1] - lg, db = labs[t * 4 + 2] - lb, dA = labs[t * 4 + 3] - la,
        cw = wv ? wv[t] : 1;   /* colour cost weighted by sample visibility (alpha^plColorAlphaPow); wv omitted => weight 1 => byte-identical */
      e += cw * (dl * dl + CHROMA_W * (da * da + db * db)) + dA * dA;
    }
    return e;
  }
  if (useDP && V2.dpKnots) { var ex = fitStopsDP(labs, N, thresh, wv); if (ex) return ex; }
  for (i = 0; i < N; i++)cost[i] = segmentCost(i);
  /* greedy min-cost knot removal via a lazy binary min-heap keyed by (cost,index): O(N log N) with the
     same removal order and tie-break (lowest index) as an O(N^2) scan. removal cost is monotonic
     non-decreasing, so a stale heap entry (knot died or cost changed) is detected and skipped on pop. */
  var cap = 3 * N + 8, hc = new Float64Array(cap), hi = new Int32Array(cap), hn = 0;
  function heapPush(c, idx) { var p = hn++; hc[p] = c; hi[p] = idx; while (p > 0) { var par = (p - 1) >> 1; if (hc[par] < hc[p] || (hc[par] === hc[p] && hi[par] <= hi[p])) break; var tc = hc[par]; hc[par] = hc[p]; hc[p] = tc; var ti = hi[par]; hi[par] = hi[p]; hi[p] = ti; p = par; } }
  function heapPop() { var ri = hi[0]; hn--; hc[0] = hc[hn]; hi[0] = hi[hn]; var p = 0; for (; ;) { var l = 2 * p + 1, r = l + 1, m = p; if (l < hn && (hc[l] < hc[m] || (hc[l] === hc[m] && hi[l] < hi[m]))) m = l; if (r < hn && (hc[r] < hc[m] || (hc[r] === hc[m] && hi[r] < hi[m]))) m = r; if (m === p) break; var tc = hc[p]; hc[p] = hc[m]; hc[m] = tc; var ti = hi[p]; hi[p] = hi[m]; hi[m] = ti; p = m; } return ri; }
  for (i = 0; i < N; i++)heapPush(cost[i], i);
  var cnt = N;
  while (cnt > 2 && hn > 0) {
    var pc = hc[0], mk = heapPop();
    if (!alive[mk] || cost[mk] !== pc) continue;   /* stale entry (knot died or its cost was updated): skip */
    if (pc > thresh) break;
    alive[mk] = 0; cnt--;
    var pp = prev[mk], nn = next[mk]; next[pp] = nn; prev[nn] = pp;
    if (pp >= 0) { cost[pp] = segmentCost(pp); heapPush(cost[pp], pp); }
    if (nn >= 0) { cost[nn] = segmentCost(nn); heapPush(cost[nn], nn); }
  }
  var v = []; for (i = 0; i < N; i++)if (alive[i]) v.push(i);
  return v;
}
/* least-squares stop colours for fixed knot positions: the colour minimising squared error over each
   segment (not the pixel value at the knot), solved per channel as a symmetric tridiagonal system
   (Thomas). same stops, no extra bytes.
   with offs the hat functions are built against the emitted offsets, so the solve is exact for the basis
   the renderer uses rather than for evenly spaced sample indices it never sees.
   @param {Uint8ClampedArray} d @param {number} base @param {number} stepI @param {number} N @param {number[]} knots @param {number[]=} offs emitted offsets, one per knot; omitted => sample-index basis @returns {number[][]} */
function solveStopColors(d, base, stepI, N, knots, offs) {
  var k = knots.length, diag = new Float64Array(k), sup = new Float64Array(k), sub = new Float64Array(k),
    rR = new Float64Array(k), rG = new Float64Array(k), rB = new Float64Array(k), seg = 0, t, i;
  for (t = 0; t < N; t++) {
    var u;
    if (offs) {
      var pt = (t + 0.5) / N;
      while (seg < k - 2 && pt > offs[seg + 1]) seg++;
      var oa = offs[seg], ob = offs[seg + 1], OL = ob - oa;
      u = OL > 1e-12 ? (pt - oa) / OL : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
    } else {
      while (seg < k - 2 && t > knots[seg + 1]) seg++;
      var a = knots[seg], b = knots[seg + 1], L = b - a; u = L > 0 ? (t - a) / L : 0;
    }
    var wi = 1 - u, wj = u, o = base + t * stepI;
    diag[seg] += wi * wi; diag[seg + 1] += wj * wj; sup[seg] += wi * wj; sub[seg + 1] += wi * wj;
    rR[seg] += wi * d[o]; rR[seg + 1] += wj * d[o];
    rG[seg] += wi * d[o + 1]; rG[seg + 1] += wj * d[o + 1];
    rB[seg] += wi * d[o + 2]; rB[seg + 1] += wj * d[o + 2];
  }
  for (i = 1; i < k; i++) { var m = sub[i] / diag[i - 1]; diag[i] -= m * sup[i - 1]; rR[i] -= m * rR[i - 1]; rG[i] -= m * rG[i - 1]; rB[i] -= m * rB[i - 1]; }
  var cR = new Float64Array(k), cG = new Float64Array(k), cB = new Float64Array(k);
  cR[k - 1] = rR[k - 1] / diag[k - 1]; cG[k - 1] = rG[k - 1] / diag[k - 1]; cB[k - 1] = rB[k - 1] / diag[k - 1];
  for (i = k - 2; i >= 0; i--) { cR[i] = (rR[i] - sup[i] * cR[i + 1]) / diag[i]; cG[i] = (rG[i] - sup[i] * cG[i + 1]) / diag[i]; cB[i] = (rB[i] - sup[i] * cB[i + 1]) / diag[i]; }
  var out = new Array(k); for (i = 0; i < k; i++)out[i] = [clampByte(cR[i]), clampByte(cG[i]), clampByte(cB[i])];
  return out;
}
/* least-squares fitting systematically flattens local contrast (regression to the mean) while SSIM's
   contrast term peaks when the reconstruction's variance matches the source's. rescaling the stop
   colours about the RENDERED mean restores it. the optimal gain has a closed form - maximising
   (2*g*vy + C2)/(vx + g^2*vy + C2) gives g*sqrt below - so there is no free parameter and no cap to
   tune, and it costs no bytes: same stop count, different values. scaling about the rendered mean
   rather than the mean of the stop values matters because the stops are not evenly spaced, and
   shifting the mean would break SSIM's luminance term. */
function contrastRecover(row, a0, len, knots, cols, offs) {
  var k = knots.length; if (k < 2 || len < 2) return;
  var C2 = 58.5225, i, seg = 0, mr = 0, mg = 0, mb = 0;
  if (!_crY || _crY.length < len) { _crY = new Float64Array(len); _crX = new Float64Array(len); _crA = new Float64Array(len); _crB = new Float64Array(len); }
  var Y = _crY, X = _crX;
  for (i = 0; i < len; i++) {
    var u;
    if (offs) {
      var pt = (i + 0.5) / len;
      while (seg < k - 2 && pt > offs[seg + 1]) seg++;
      var oa = offs[seg], ob = offs[seg + 1], OL = ob - oa;
      u = OL > 1e-12 ? (pt - oa) / OL : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
    } else {
      while (seg < k - 2 && i > knots[seg + 1]) seg++;
      var a = knots[seg], b = knots[seg + 1], L = b - a; u = L > 0 ? (i - a) / L : 0;
    }
    var c0 = cols[seg], c1 = cols[seg + 1];
    var r = c0[0] + (c1[0] - c0[0]) * u, g = c0[1] + (c1[1] - c0[1]) * u, bl = c0[2] + (c1[2] - c0[2]) * u;
    mr += r; mg += g; mb += bl;
    Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    var o = (a0 + i) << 2; X[i] = 0.2126 * row[o] + 0.7152 * row[o + 1] + 0.0722 * row[o + 2];
  }
  var gm = V2.msGain ? msGain(Y, X, len, C2) : flatGain(Y, X, len, C2);
  if (!(gm > 1)) return;   /* only ever expands, never flattens further */
  mr /= len; mg /= len; mb /= len;
  for (i = 0; i < k; i++)cols[i] = [clampByte(mr + gm * (cols[i][0] - mr)), clampByte(mg + gm * (cols[i][1] - mg)), clampByte(mb + gm * (cols[i][2] - mb))];
}
/* the closed form for a single scale's contrast term: the default path, and the n=1 case of msGain. */
function flatGain(Y, X, len, C2) {
  var sy = 0, syy = 0, sx = 0, sxx = 0, i;
  for (i = 0; i < len; i++) { sy += Y[i]; syy += Y[i] * Y[i]; sx += X[i]; sxx += X[i] * X[i]; }
  var vy = (syy - sy * sy / len) / len, vx = (sxx - sx * sx / len) / len;
  if (vy <= 1e-9 || !(vx > vy)) return 1;
  return (-C2 + Math.sqrt(C2 * C2 + 4 * vy * (vx + C2))) / (2 * vy);
}
/* the same gain aimed at every scale the pyramid visits rather than the finest one alone: the weighted
   sum of log contrast terms has no closed form past one scale, so Newton solves it from the neutral gain.
   costs no bytes, since only the stop values change. */
var _crY = null, _crX = null, _crA = null, _crB = null, _gainVy = null, _gainVx = null;
function msGain(Y, X, len, C2) {
  var n = Math.min(MS_WEIGHTS.length, 1 + Math.max(0, Math.floor(Math.log(len / 16) / Math.LN2)));
  if (n < 1) n = 1;
  var vy = _gainVy || (_gainVy = new Float64Array(MS_WEIGHTS.length)), vx = _gainVx || (_gainVx = new Float64Array(MS_WEIGHTS.length));
  var A = _crA, B = _crB, L = len, i, sc;
  for (i = 0; i < len; i++) { A[i] = Y[i]; B[i] = X[i]; }
  for (sc = 0; sc < n; sc++) {
    var sy = 0, syy = 0, sx = 0, sxx = 0;
    for (i = 0; i < L; i++) { sy += A[i]; syy += A[i] * A[i]; sx += B[i]; sxx += B[i] * B[i]; }
    vy[sc] = (syy - sy * sy / L) / L; vx[sc] = (sxx - sx * sx / L) / L;
    if (sc + 1 < n) {
      var h = L >> 1;
      if (h < 8) { n = sc + 1; break; }
      for (i = 0; i < h; i++) { A[i] = (A[2 * i] + A[2 * i + 1]) * 0.5; B[i] = (B[2 * i] + B[2 * i + 1]) * 0.5; }
      L = h;
    }
  }
  if (vy[0] <= 1e-9) return 1;
  var g = 1, it;
  for (it = 0; it < 6; it++) {
    var f1 = 0, f2 = 0;
    for (sc = 0; sc < n; sc++) {
      var w = MS_WEIGHTS[sc], vys = vy[sc];
      if (vys <= 1e-12) continue;
      var da = 2 * g * vys + C2, db = vx[sc] + g * g * vys + C2;
      if (da <= 0 || db <= 0) continue;
      f1 += w * (2 * vys / da - 2 * g * vys / db);
      f2 += w * (-4 * vys * vys / (da * da) - 2 * vys / db + 4 * g * g * vys * vys / (db * db));
    }
    if (!(Math.abs(f2) > 1e-12)) break;
    var stepv = f1 / f2;
    g -= stepv;
    if (!(g > 0) || !(g < 1e9)) return 1;   /* a degenerate scale can send Newton off; the neutral gain is the safe fallback */
    if (Math.abs(stepv) < 1e-6) break;
  }
  return g;
}
/* piecewise-linear strip encoder: fit each strip's smooth (pre-quantize) signal as a few linear
   segments emitted as gradient stops at distinct offsets. knot positions from fitStops (L2-optimal),
   stop colours from solveStopColors (least-squares); both minimise squared error, tracking SSIM/PSNR.
   wins on gradient/photographic content; flat/graphic logos prefer hard-run (the RD search picks it). */
function encodeSmoothStrips(d, N, axis, opt) {
  opt = opt || {};
  var prec = opt.precision != null ? opt.precision : ENGINE_DEFAULTS.precision;
  var overlap = opt.overlap != null ? opt.overlap : ENGINE_DEFAULTS.overlap;
  var tol = opt.tol != null ? opt.tol : 90;   /* per-row L2 error budget (fitStops) */
  var useDP = !!opt.dp;   /* the sweep ranks with the greedy fit; the winner is refit with the exact one */
  /* asymmetric resolution: N is the strip count (cross-axis); the gradient axis is fit at the source's
     full resolution S=sqrt(pixels). when S>N (the app feeds the full 512 source) each strip's gradient
     is fit from S samples, so cross-axis detail survives the N downscale at the same bytes (stops carry
     fractional offsets vi/S). each strip is the box-average of the source cross-lines [c0,c1) it spans.
     S===N is the plain per-N fit. */
  var S = Math.round(Math.sqrt(d.length / 4));
  var labs = new Float32Array(S * 4);   /* per along-axis sample: [L,a,b,alpha*plAlphaW]; the 4th channel keeps knots at sharp alpha edges */
  var wv = new Float64Array(S);   /* per-sample colour-cost weight = alpha^plColorAlphaPow; near-transparent fringe colour stops stealing knots from the interior */
  var AW = TUNING.plAlphaW, AMIN = TUNING.segAlphaMin, BR = TUNING.segBridge;
  /* PASS 1 - gap-split: split each strip's along-axis profile into opaque segments and fit each alone.
     a single full-width gradient would ramp across the transparent gaps between content (SVG straight-
     alpha interpolation paints a faint wedge, visible on the editor's light backing); per-segment rects
     leave the gaps with no geometry. opaque content is one segment [0,S) per strip => identical to a
     full-width strip. */
  var bounds = V2.adaptiveStrips ? adaptiveBounds(d, S, N, axis) : null;
  var prof = stripProfiles(d, S, N, axis, bounds);
  var strips = new Array(N);
  for (var l = 0; l < N; l++) {
    var row = prof.subarray(l * S * 4, (l + 1) * S * 4);   /* this strip's conditioned profile; read only from here down */
    /* opaque runs (alpha>=AMIN), bridging sub-BR transparent gaps so hairline antialiased breaks don't over-fragment into many tiny rects */
    var runs = [], ii = 0;
    while (ii < S) { if (row[ii * 4 + 3] >= AMIN) { var rs = ii; while (ii < S && row[ii * 4 + 3] >= AMIN) ii++; runs.push([rs, ii]); } else ii++; }
    var seg = []; for (var ri = 0; ri < runs.length; ri++) { if (seg.length && runs[ri][0] - seg[seg.length - 1][1] < BR) seg[seg.length - 1][1] = runs[ri][1]; else seg.push([runs[ri][0], runs[ri][1]]); }
    var sl = [];
    for (var mi = 0; mi < seg.length; mi++) {
      var a0 = seg[mi][0], a1 = seg[mi][1], len = a1 - a0, b0 = a0 << 2, allSame = true;
      for (var ia = a0 + 1; ia < a1; ia++) { var oa = ia << 2; if (row[oa] !== row[b0] || row[oa + 1] !== row[b0 + 1] || row[oa + 2] !== row[b0 + 2] || row[oa + 3] !== row[b0 + 3]) { allSame = false; break } }
      var stops = null, model = null, solid = null, sig = "", domColor = null;
      if (allSame) {
        solid = [row[b0], row[b0 + 1], row[b0 + 2], row[b0 + 3]]; sig = "S" + (((solid[0] * 256 + solid[1]) * 256 + solid[2]) * 256 + solid[3]);
        model = [[0, solid[0], solid[1], solid[2], solid[3]]];
      } else {
        for (var ib = 0; ib < len; ib++) { var ob = (a0 + ib) << 2; rgbToLab(row[ob], row[ob + 1], row[ob + 2], labs, ib * 4); labs[ib * 4 + 3] = row[ob + 3] * AW; wv[ib] = PL_ACOLOR_LUT[row[ob + 3]]; }
        var v = fitStops(labs, len, tol, wv, useDP);         /* fit this segment only -> offsets are segment-relative (0..1 over [a0,a1)) */
        if (V2.chromaConstraint) v = chromaSplit(labs, v, TUNING.chromaBound, Math.max(2, v.length >> 2));
        /* offset decimals from the segment's own length. three decimals register a 512-wide segment to a
           quarter pixel and a 20-wide one to a fiftieth, so the short segments the gap-split produces are
           buying accuracy the geometry cannot hold. capped at the global precision, so this only ever
           removes digits. */
        var pOff = prec;
        if (V2.segPrecision) { var need = Math.ceil(Math.log(len / 0.3) / Math.LN10); pOff = need < 1 ? 1 : (need > prec ? prec : need); }
        /* the offsets as they will be written, rounding and bbox mapping included. the end knots stay
           pinned at 0 and 1: the gradient is clamped outside them either way. a knot describes sample vi,
           whose centre lies half a sample in, so vi/len would land the gradient on the sample's left edge. */
        var offs = new Array(v.length), qi;
        for (qi = 0; qi < v.length; qi++)offs[qi] = qi === 0 ? 0 : (qi === v.length - 1 ? 1 : roundTo(bboxOffset((v[qi] + 0.5) / len, axis), pOff));
        /* two knots inside one offset step round to the same written value, and collapsing them lets
           the second emit with no offset attribute at all under the clamp rule.
           the pair then renders as a hard step between two solved colours, which at a real edge is
           closer to the source than the steep ramp it replaces. */
        if (V2.snapCoincident && v.length > 2) {
          var quant = Math.pow(10, -pOff) * 1.5;
          for (qi = 1; qi < v.length - 1; qi++) { var gap = offs[qi] - offs[qi - 1]; if (gap > 0 && gap <= quant) offs[qi] = offs[qi - 1]; }
        }
        var cols = solveStopColors(row, a0 * 4, 4, len, v, V2.emitBasis ? offs : null);
        contrastRecover(row, a0, len, v, cols, V2.emitBasis ? offs : null);
        stops = []; model = [];
        for (var jv = 0; jv < v.length; jv++) {
          var vi = v[jv], ov = (a0 + vi) << 2, cc = cols[jv];
          var t = jv === 0 ? "0" : (jv === v.length - 1 ? "1" : formatNum(offs[jv], pOff));
          stops.push([t, cc[0], cc[1], cc[2], row[ov + 3]]);        /* colour from LS, alpha from the pixel */
          model.push([parseFloat(t), cc[0], cc[1], cc[2], row[ov + 3]]);
        }
        sig = (axis === 0 ? "h" : "v") + stops.join("|");
        var mo = (a0 + (len >> 1)) << 2; domColor = [row[mo], row[mo + 1], row[mo + 2]];
      }
      sl.push({ a0: a0, a1: a1, solid: solid, stops: stops, model: model, sig: sig, domColor: domColor });
    }
    strips[l] = sl;
  }
  /* PASS 2 - vertical merge: adjacent strips whose segment is identical (same span+colours) collapse
     into one taller rect, so a flat region is a few tall rects, not one per row. */
  var groups = [], open = {};
  for (var l2 = 0; l2 < N; l2++) {
    var ss = strips[l2], seen = {};
    for (var k2 = 0; k2 < ss.length; k2++) {
      var sg = ss[k2], key = sg.a0 + "_" + sg.a1 + "_" + sg.sig; seen[key] = 1;
      var og = open[key];
      if (og !== undefined && groups[og].l0 + groups[og].span === l2) groups[og].span++;
      else { groups.push({ l0: l2, span: 1, a0: sg.a0, a1: sg.a1, ov: 0, solid: sg.solid, stops: sg.stops, model: sg.model, sig: sg.sig, domColor: sg.domColor }); open[key] = groups.length - 1; }
    }
    for (var kk in open) { if (groups[open[kk]].l0 + groups[open[kk]].span !== l2 + 1) delete open[kk]; }
  }
  /* PASS 3 - per-segment seam overlap: extend a segment down while the strips below still cover its
     midpoint (capped at overlap). computed here, not in serializeStrips, because it needs source coverage per segment. */
  var hh = EMBLEM / N, sc = EMBLEM / S;
  function edgeAt(l) { return bounds ? bounds[l] * sc : l * hh; }
  for (var g3 = 0; g3 < groups.length; g3++) {
    var gg3 = groups[g3], mid = (gg3.a0 + gg3.a1) >> 1, foot = gg3.l0 + gg3.span, reach = 0;
    if (overlap > 0) for (var cc3 = foot; cc3 < N; cc3++) {
      var cov = false, slb = strips[cc3];
      for (var sbi = 0; sbi < slb.length; sbi++) { if (slb[sbi].a0 <= mid && mid < slb[sbi].a1) { cov = true; break } }
      if (!cov) break;
      reach = edgeAt(cc3 + 1) - edgeAt(foot);
      if (reach >= overlap) break;
    }
    gg3.ov = Math.min(overlap, reach);
  }
  codebookSnap(groups);
  return serializeStrips(groups, N, axis, prec, overlap, "strip-pl", bounds ?/** @type {any} */(Int32Array.from(bounds, function (v) { return Math.round(v * sc); })) : null);
}
/* piecewise-linear candidate pair (one per allowed axis), same shape as buildPixelCandidates. */
function buildSmoothCandidates(im, N, method, tol, o) {
  var so = { precision: o.precision, overlap: o.overlap, tol: tol };
  var cands = [];
  if (method === "auto" || method === "rows") cands.push(encodeSmoothStrips(im, N, 0, so));
  if (method === "auto" || method === "cols") cands.push(encodeSmoothStrips(im, N, 1, so));
  return cands;
}

/* rasterize the strip model: matches SVG gradient semantics exactly */
function rasterizeStrips(cand, N) {
  var out = new Uint8ClampedArray(N * N * 4);   /* starts transparent: PL gap-split leaves the between-segment gaps empty (a segment fills only its own along-axis span) */
  var axis = cand.axis, S = 512;
  var stepL = axis === 0 ? N * 4 : 4, stepI = axis === 0 ? 4 : N * 4;
  var line = new Uint8ClampedArray(N * 4);
  for (var gi = 0; gi < cand.groups.length; gi++) {
    var g = cand.groups[gi];
    /* a PL group covers only its along-axis segment [a0,a1) (512-space -> N raster); a hard-run / full-width group covers the whole line (a1 unset => xa=0,xb=N => byte-identical raster) */
    var seg = g.a1 != null, xa = seg ? Math.round(g.a0 * N / S) : 0, xb = seg ? Math.round(g.a1 * N / S) : N;
    if (xb <= xa) continue;
    var alen = xb - xa;
    if (g.solid) {
      for (var i = xa; i < xb; i++) { var p = i << 2; line[p] = g.solid[0]; line[p + 1] = g.solid[1]; line[p + 2] = g.solid[2]; line[p + 3] = g.solid[3]; }
    } else {
      var m = g.model, len = m.length, k = 0;
      for (var i2 = xa; i2 < xb; i2++) {
        var t = (i2 - xa + 0.5) / alen, p2 = i2 << 2;   /* t normalised over the segment (model offsets are segment-relative) */
        while (k + 1 < len && m[k + 1][0] <= t) k++;
        var r, gg, b, a;
        if (t <= m[0][0]) { r = m[0][1]; gg = m[0][2]; b = m[0][3]; a = m[0][4]; }
        else if (k >= len - 1) { var sL = m[len - 1]; r = sL[1]; gg = sL[2]; b = sL[3]; a = sL[4]; }
        else {
          var s0 = m[k], s1 = m[k + 1], sp = s1[0] - s0[0];
          var f = sp > 1e-9 ? (t - s0[0]) / sp : 1; if (f < 0) f = 0; if (f > 1) f = 1;
          r = s0[1] + (s1[1] - s0[1]) * f; gg = s0[2] + (s1[2] - s0[2]) * f; b = s0[3] + (s1[3] - s0[3]) * f; a = s0[4] + (s1[4] - s0[4]) * f;
        }
        line[p2] = r; line[p2 + 1] = gg; line[p2 + 2] = b; line[p2 + 3] = a;
      }
    }
    for (var s = 0; s < g.span; s++) {
      var l = g.l0 + s, base = l * stepL;
      for (var i3 = xa; i3 < xb; i3++) {
        var o = base + i3 * stepI, p3 = i3 << 2;
        out[o] = line[p3]; out[o + 1] = line[p3 + 1]; out[o + 2] = line[p3 + 2]; out[o + 3] = line[p3 + 3];
      }
    }
  }
  return out;
}

/* measurement raster: the candidate drawn on the true 512 grid with geometric area coverage.
   the emitted rects sit at fractional cross-axis positions (strip height 512/N) and a real
   rasterizer antialiases those edges, so scoring on the N grid mis-measures every N that does not
   divide 512 (up to 17 points at N=64) and fences the search into {512,256,128,64}.
   adjacent strips cover DISJOINT parts of a pixel, so their contributions are SUMMED, not
   source-over composited; groups are walked back to front and each takes min(coverage, remaining),
   which preserves painter order where the seam overlap makes two strips claim the same area. */
var _covColor = null, _covAlpha = null, _covRemain = null, _covOut = null, _covLine = null;   /* one 512-grid allocation, reused: the search measures thousands of candidates */
var _colSumA = null, _colSumB = null, _colSumAA = null, _colSumBB = null, _colSumAB = null;   /* likewise reused: sliding these down and across is what holds the overlapping window at O(1) */
var _lumaA = null, _lumaB = null;   /* the composited luma pair both SSIM windows read */
function sampleModel(g, n, t0, tw) {
  var line = _covLine, i, p;
  if (g.solid) {
    for (i = 0; i < n; i++) { p = i << 2; line[p] = g.solid[0]; line[p + 1] = g.solid[1]; line[p + 2] = g.solid[2]; line[p + 3] = g.solid[3]; }
    return line;
  }
  var m = g.model, len = m.length, k = 0;
  for (i = 0; i < n; i++) {
    var t = (i + 0.5 - t0) / tw; p = i << 2;   /* pixel centre, mapped through the gradient's own bounding box */
    if (t < 0) t = 0; else if (t > 1) t = 1;
    while (k + 1 < len && m[k + 1][0] <= t) k++;
    if (t <= m[0][0]) { line[p] = m[0][1]; line[p + 1] = m[0][2]; line[p + 2] = m[0][3]; line[p + 3] = m[0][4]; }
    else if (k >= len - 1) { var sL = m[len - 1]; line[p] = sL[1]; line[p + 1] = sL[2]; line[p + 2] = sL[3]; line[p + 3] = sL[4]; }
    else {
      var s0 = m[k], s1 = m[k + 1], sp = s1[0] - s0[0], f = sp > 1e-9 ? (t - s0[0]) / sp : 1;
      if (f < 0) f = 0; else if (f > 1) f = 1;
      line[p] = s0[1] + (s1[1] - s0[1]) * f; line[p + 1] = s0[2] + (s1[2] - s0[2]) * f;
      line[p + 2] = s0[3] + (s1[3] - s0[3]) * f; line[p + 3] = s0[4] + (s1[4] - s0[4]) * f;
    }
  }
  return line;
}
function renderCoverage(cand, S) {
  var N = cand.N, axis = cand.axis, h = S / N, px = S * S, groups = cand.groups, i;
  var bd = cand.bounds, bs = bd ? S / EMBLEM : 0;   /* boundaries are stated in 512-space; the score may run at another */
  if (!_covRemain || _covRemain.length !== px) { _covColor = new Float32Array(px * 3); _covAlpha = new Float32Array(px); _covRemain = new Float32Array(px); _covOut = new Uint8ClampedArray(px * 4); _covLine = new Float32Array(S * 4); }
  var col = _covColor, alpha = _covAlpha, remain = _covRemain, out = _covOut;
  col.fill(0); alpha.fill(0); remain.fill(1);
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi];
    var a0 = g.a1 != null ? g.a0 : 0, a1 = g.a1 != null ? g.a1 : S, alen = a1 - a0;   /* PL segment, or the whole line for a hard-run group */
    if (alen <= 0) continue;
    /* the slug path is SLUG_FILL_W wide but is scaled by the declared SLUG_W, so whichever extent that
       scale drives comes out SLUG_FILL_W/SLUG_W short. along the long axis that is a ~0.25px strip of
       background down the far edge, which a real rasterizer shows and the score must see. */
    var aS = alen / SLUG_W;
    var t0 = axis === 0 ? SLUG_BBOX_X0 * aS : 0, tw = axis === 0 ? SLUG_BBOX_W * aS : alen;   /* the gradient spans the path's bbox, which is wider than its fill on the x axis */
    var line = sampleModel(g, alen, t0, tw);
    var y0 = bd ? bd[g.l0] * bs : g.l0 * h, y1 = bd ? bd[g.l0 + g.span] * bs : y0 + h * g.span;   /* the rect's true fractional cross-axis extent */
    var c0 = Math.floor(y0), c1 = Math.ceil(y1);
    if (c0 < 0) c0 = 0; if (c1 > S) c1 = S;
    var pstep = axis === 0 ? 1 : S, nmax = alen < S - a0 ? alen : S - a0;
    for (var c = c0; c < c1; c++) {
      var lo = c > y0 ? c : y0, hi = (c + 1) < y1 ? (c + 1) : y1, cov = hi - lo;   /* this row's area share of the rect */
      if (cov <= 0) continue;
      var p = axis === 0 ? (c * S + a0) : (a0 * S + c);   /* the axis only decides where the run starts and how it strides */
      for (i = 0; i < nmax; i++, p += pstep) {
        var rp = remain[p];
        if (rp <= 0) continue;
        var take = cov < rp ? cov : rp, q = i << 2, sa = take * (line[q + 3] * (1 / 255)), p3 = p * 3;
        col[p3] += line[q] * sa; col[p3 + 1] += line[q + 1] * sa; col[p3 + 2] += line[q + 2] * sa;
        alpha[p] += sa; remain[p] = rp - take;
      }
    }
  }
  for (i = 0; i < px; i++) {
    var a = alpha[i], o = i << 2;
    if (a > 0) { var i3 = i * 3; out[o] = col[i3] / a; out[o + 1] = col[i3 + 1] / a; out[o + 2] = col[i3 + 2] / a; out[o + 3] = a * 255; }
    else { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; }
  }
  return out;
}
/* fidelity: composite over gray, then PSNR + multi-scale SSIM on luma. SSIM tracks structure and
   edges far better than PSNR, which is dominated by flat regions. one rasterization feeds both.

   Multi-scale, not single-scale: at one scale the metric reads fine structure almost exclusively and
   cannot see chroma at all, so it scores a Pixelization result whose palette has collapsed to a few
   colours above one that kept them. do not simplify it back.

   Two windows, and only one leaves the engine:
   - ssimCanonicalTerms is the gaussian window SSIM is defined with (sigma 1.5), so the number in the
     app, the lab and the comparison is one an outside tool reproduces. ~33x the proxy, once per job.
   - ssimProxyTerms is a sliding box, cheap enough for the thousands a sweep makes. it only has to
     rank the way the canonical would, and at its 8px window it agrees on 98.92% of 9800 candidate pairs
     drawn from eight works. see TUNING.ssimWin for the window sizes either side of it. */
/* one render + one luma pass, shared by both windows below. transparent areas are composited over a
   neutral grey so a gap is scored as a visible difference rather than silently matching anything. */
function lumaPair(cand, ref, S) {
  var img = renderCoverage(cand, S), G = 127, px = S * S, i;
  if (!_lumaA || _lumaA.length !== px) { _lumaA = new Float32Array(px); _lumaB = new Float32Array(px); }
  var A = _lumaA, B = _lumaB, se = 0;
  for (i = 0; i < px; i++) {                       /* the coverage render is already on the reference grid, so this is 1:1 */
    var p = i << 2, ar = ref[p + 3] / 255, ai = img[p + 3] / 255;
    var rr = ref[p] * ar + G * (1 - ar), rg = ref[p + 1] * ar + G * (1 - ar), rb = ref[p + 2] * ar + G * (1 - ar);
    var ir = img[p] * ai + G * (1 - ai), ig = img[p + 1] * ai + G * (1 - ai), ib = img[p + 2] * ai + G * (1 - ai);
    A[i] = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;   /* BT.709: the luma weights sRGB is defined against */
    B[i] = 0.2126 * ir + 0.7152 * ig + 0.0722 * ib;
    var dr = rr - ir, dg = rg - ig, db = rb - ib; se += dr * dr + dg * dg + db * db;
  }
  var mse = se / (px * 3);
  return mse <= 0.0001 ? 99 : 10 * Math.log10(65025 / mse);
}
/* the search proxy: SSIM over fully overlapping windows, held to O(1) per window by sliding the column
   sums down and across. a non-overlapping block grid is cheaper still but ranks candidates differently
   from the canonical metric, because structure landing on a block seam is scored by no window at all. */
function ssimProxyTerms(A, B, S, out) {
  var win = TUNING.ssimWin, C1 = SSIM_C1, C2 = SSIM_C2, nwin = win * win, winPos = S - win + 1, ssum = 0, lsum = 0, cssum = 0, wcnt = 0, wx, wy;
  if (!_colSumA || _colSumA.length < S) { _colSumA = new Float64Array(S); _colSumB = new Float64Array(S); _colSumAA = new Float64Array(S); _colSumBB = new Float64Array(S); _colSumAB = new Float64Array(S); }
  var ca = _colSumA, cb = _colSumB, caa = _colSumAA, cbb = _colSumBB, cab = _colSumAB;
  for (var by = 0; by < winPos; by++) {
    if (by === 0) {
      ca.fill(0); cb.fill(0); caa.fill(0); cbb.fill(0); cab.fill(0);
      for (wy = 0; wy < win; wy++) { var rb0 = wy * S; for (wx = 0; wx < S; wx++) { var av = A[rb0 + wx], bv = B[rb0 + wx]; ca[wx] += av; cb[wx] += bv; caa[wx] += av * av; cbb[wx] += bv * bv; cab[wx] += av * bv; } }
    } else {
      var rOut = (by - 1) * S, rIn = (by - 1 + win) * S;   /* one row leaves the band, one enters */
      for (wx = 0; wx < S; wx++) {
        var ao = A[rOut + wx], bo = B[rOut + wx], an = A[rIn + wx], bn = B[rIn + wx];
        ca[wx] += an - ao; cb[wx] += bn - bo; caa[wx] += an * an - ao * ao; cbb[wx] += bn * bn - bo * bo; cab[wx] += an * bn - ao * bo;
      }
    }
    var wa = 0, wb = 0, waa = 0, wbb = 0, wab = 0;
    for (wx = 0; wx < win; wx++) { wa += ca[wx]; wb += cb[wx]; waa += caa[wx]; wbb += cbb[wx]; wab += cab[wx]; }
    for (var bx = 0; bx < winPos; bx++) {
      if (bx > 0) { var xo = bx - 1, xi = bx - 1 + win; wa += ca[xi] - ca[xo]; wb += cb[xi] - cb[xo]; waa += caa[xi] - caa[xo]; wbb += cbb[xi] - cbb[xo]; wab += cab[xi] - cab[xo]; }
      var ma = wa / nwin, mb = wb / nwin,
        va = (waa - nwin * ma * ma) / (nwin - 1), vb = (wbb - nwin * mb * mb) / (nwin - 1), cov = (wab - nwin * ma * mb) / (nwin - 1);
      var lt = (2 * ma * mb + C1) / (ma * ma + mb * mb + C1), ct = (2 * cov + C2) / (va + vb + C2);
      lsum += lt; cssum += ct; ssum += lt * ct; wcnt++;   /* the product is single-scale SSIM; the two apart are what the multi-scale form needs, since it takes contrast-structure at every scale but luminance only at the coarsest */
    }
  }
  var n = wcnt || 1;
  out[0] = wcnt ? lsum / n : 1; out[1] = wcnt ? cssum / n : 1; out[2] = wcnt ? ssum / n : 1;
}
/* one scale: the building block the multi-scale form is built from, and the shape the tests pin. */
function ssimProxy(A, B, S) { var t = _msTerms; ssimProxyTerms(A, B, S, t); return t[2]; }
/* half-size by 2x2 average, the pooling every reference multi-scale implementation uses */
function halveInto(src, dst, S) {
  var H = S >> 1, x, y;
  for (y = 0; y < H; y++) {
    var r0 = (y << 1) * S, r1 = r0 + S, o = y * H;
    for (x = 0; x < H; x++) { var c = x << 1; dst[o + x] = (src[r0 + c] + src[r0 + c + 1] + src[r1 + c] + src[r1 + c + 1]) * 0.25; }
  }
}
/* Multi-scale SSIM, weights as published. Single-scale SSIM reads fine structure almost exclusively,
   which is why it kept choosing the higher strip count: more strips resolve luma detail, and it never
   sees what that costs elsewhere. Taking contrast-structure at five scales weighs the coarse shape of
   the picture too, and on every contested source that is the reading a person agrees with. */
var SSIM_C1 = 6.5025, SSIM_C2 = 58.5225;   /* (0.01*255)^2 and (0.03*255)^2, the stabilisers SSIM is defined with */
var MS_WEIGHTS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333];
var _msA = null, _msB = null, _msTerms = [0, 0, 0];
function msSsim(A, B, S, terms) {
  /* the window needs room to sit in, so the pyramid stops before the coarsest scale falls under 16px.
     at the 512 grid everything leaves the engine on, that is the full five scales. */
  var n = Math.min(MS_WEIGHTS.length, 1 + Math.max(0, Math.floor(Math.log(S / 16) / Math.LN2))), i;
  /* the published weights sum to 1.0001, and every reference implementation uses them as they are, so
     the full pyramid must not renormalise or the number stops matching an outside tool. a truncated
     pyramid has no standard to match, and there renormalising keeps the value on a comparable scale. */
  var wsum = 1; if (n < MS_WEIGHTS.length) { wsum = 0; for (i = 0; i < n; i++)wsum += MS_WEIGHTS[i]; }
  if (!_msA || _msA.length < S * S) { _msA = new Float64Array(S * S); _msB = new Float64Array(S * S); }
  for (i = 0; i < S * S; i++) { _msA[i] = A[i]; _msB[i] = B[i]; }
  var out = 1, cur = S, t = [0, 0, 0];
  for (i = 0; i < n; i++) {
    terms(_msA, _msB, cur, t);
    var w = MS_WEIGHTS[i] / wsum;                             /* renormalised so a short pyramid still returns a value on the same scale */
    out *= Math.pow(t[1] > 1e-9 ? t[1] : 1e-9, w);
    if (i === n - 1) out *= Math.pow(t[0] > 1e-9 ? t[0] : 1e-9, w);      /* luminance enters once, at the coarsest scale */
    else { halveInto(_msA, _msA, cur); halveInto(_msB, _msB, cur); cur >>= 1; }
  }
  return out;
}
function measureVsRef(cand, ref, S) { var psnr = lumaPair(cand, ref, S); return { psnr: psnr, ssim: msSsim(_lumaA, _lumaB, S, ssimProxyTerms) }; }
/* the canonical fidelity: SSIM exactly as it is defined, on the same 512 coverage render and the same
   BT.709 luma, with a gaussian window (sigma 1.5, truncated at 7px, edges reflected). run once on a
   finished candidate, never inside the sweep. */
var _gaussKernel = null, _gaussPass1 = null, _meanA = null, _meanB = null, _meanAA = null, _meanBB = null, _meanAB = null, _prodTmp = null;   /* the ssim window\'s local means, reused like the two families above. _prodTmp stages A*A, B*B or A*B before each blur; _gaussPass1 carries the separable pass between axes. */
function gaussKernel() {
  if (!_gaussKernel) {
    var R = 7, sig = 1.5, i, sum = 0;
    _gaussKernel = new Float64Array(2 * R + 1);
    for (i = -R; i <= R; i++) { _gaussKernel[i + R] = Math.exp(-(i * i) / (2 * sig * sig)); sum += _gaussKernel[i + R]; }
    for (i = 0; i < _gaussKernel.length; i++)_gaussKernel[i] /= sum;
  }
  return _gaussKernel;
}
function gaussBlur(src, dst, S) {
  var K = gaussKernel(), R = (K.length - 1) >> 1, x, y, k, i, acc;   /* self-contained: owns its kernel and scratch, so it is callable on its own */
  if (!_gaussPass1 || _gaussPass1.length < S * S) _gaussPass1 = new Float64Array(S * S);   /* the pyramid calls this at shrinking sizes, so a buffer that is already big enough is kept */
  var tmp = _gaussPass1;
  for (y = 0; y < S; y++) {
    var row = y * S;
    for (x = 0; x < S; x++) {
      acc = 0;
      for (k = -R; k <= R; k++) { i = x + k; if (i < 0) i = -i; else if (i >= S) i = 2 * S - 2 - i; acc += K[k + R] * src[row + i]; }
      tmp[row + x] = acc;
    }
  }
  for (x = 0; x < S; x++) {
    for (y = 0; y < S; y++) {
      acc = 0;
      for (k = -R; k <= R; k++) { i = y + k; if (i < 0) i = -i; else if (i >= S) i = 2 * S - 2 - i; acc += K[k + R] * tmp[i * S + x]; }
      dst[y * S + x] = acc;
    }
  }
}
function ssimCanonicalTerms(A, B, S, out) {
  var px = S * S, i;
  if (!_meanA || _meanA.length < px) {
    _meanA = new Float64Array(px); _meanB = new Float64Array(px);
    _meanAA = new Float64Array(px); _meanBB = new Float64Array(px); _meanAB = new Float64Array(px); _prodTmp = new Float64Array(px);
  }
  gaussBlur(A, _meanA, S); gaussBlur(B, _meanB, S);
  for (i = 0; i < px; i++)_prodTmp[i] = A[i] * A[i]; gaussBlur(_prodTmp, _meanAA, S);
  for (i = 0; i < px; i++)_prodTmp[i] = B[i] * B[i]; gaussBlur(_prodTmp, _meanBB, S);
  for (i = 0; i < px; i++)_prodTmp[i] = A[i] * B[i]; gaussBlur(_prodTmp, _meanAB, S);
  var C1 = SSIM_C1, C2 = SSIM_C2, ls = 0, cs = 0, sum = 0;
  for (i = 0; i < px; i++) {
    var ma = _meanA[i], mb = _meanB[i], va = _meanAA[i] - ma * ma, vb = _meanBB[i] - mb * mb, cov = _meanAB[i] - ma * mb;
    var lt = (2 * ma * mb + C1) / (ma * ma + mb * mb + C1), ct = (2 * cov + C2) / (va + vb + C2);
    ls += lt; cs += ct; sum += lt * ct;
  }
  out[0] = ls / px; out[1] = cs / px; out[2] = sum / px;
}
/* released rather than pooled: the canonical path runs once per finished job, and holding 14MB of
   doubles per worker for the rest of the session costs far more than re-allocating them next time. */
function releaseMetricScratch() { _gaussPass1 = _meanA = _meanB = _meanAA = _meanBB = _meanAB = _prodTmp = _msA = _msB = null; }   /* the kernel is tiny and stays */
/* one scale, exactly as SSIM is defined: the building block of the multi-scale form above. */
function ssimCanonical(A, B, S) { var t = _msTerms; ssimCanonicalTerms(A, B, S, t); releaseMetricScratch(); return t[2]; }
/* every candidate that leaves the engine is measured this way, including the over-budget ones a lean
   sweep returns: the benchmark lab plots those on the same axis as the fitting ones, and a chart that
   mixed two metrics would be worse than the ~80ms this costs per finished job. */
function measureCanonical(cand, ref, S) {
  var psnr = lumaPair(cand, ref, S);   /* same render and luma as the proxy path; only the window differs */
  var v = msSsim(_lumaA, _lumaB, S, ssimCanonicalTerms);
  releaseMetricScratch();
  return { psnr: psnr, ssim: v };
}

/* ---------- pipeline / auto-fit ---------- */
function prepImage(ref, S, N, smoothPct, sharp) {
  var im = downscale(ref, S, N, sharp);
  if (smoothPct > 0) bilateralSmooth(im, N, smoothPct);
  return im;
}
function buildPixelCandidates(im, N, method, o) {
  o = o || {};
  var so = { precision: o.precision, overlap: o.overlap };
  var cands = [];
  if (method === "auto" || method === "rows") cands.push(encodePixelStrips(im, N, 0, so));
  if (method === "auto" || method === "cols") cands.push(encodePixelStrips(im, N, 1, so));
  return cands;
}
function smallestCandidate(cands) {
  var best = null;
  for (var i = 0; i < cands.length; i++)if (cands[i] && (!best || cands[i].enc < best.enc)) best = cands[i];
  return best;
}
function resolutionLadder(start, L) {
  L = L || TUNING.resLadder; var out = [];
  for (var i = 0; i < L.length; i++)if (L[i] <= start) out.push(L[i]);
  if (!out.length) out.push(start);
  return out;
}
/* cheap lower bound on stop bytes: colour transitions along the cheaper axis, counted once per distinct
   line (FNV-1a hashed). encodePixelStrips dedups identical rows/cols into one gradient, so counting every
   identical line would over-state the floor and wrongly prune repetitive images. all-distinct images are
   unchanged; hash collisions only lower the bound (prune less), so it stays admissible. */
function minTransitions(d, N) {
  var ch = 0, cv = 0, seenR = new Set(), seenC = new Set(), h, t, x, y, p, pr, pg, pb, pa, r, g, b, a, row;
  for (y = 0; y < N; y++) {
    row = y * N; h = 2166136261; t = 0; pr = pg = pb = pa = -1;
    for (x = 0; x < N; x++) {
      p = (row + x) << 2; r = d[p]; g = d[p + 1]; b = d[p + 2]; a = d[p + 3];
      h = Math.imul(h ^ r, 16777619); h = Math.imul(h ^ g, 16777619); h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ a, 16777619);
      if (x > 0 && (r !== pr || g !== pg || b !== pb || a !== pa)) t++;
      pr = r; pg = g; pb = b; pa = a;
    }
    h >>>= 0; if (!seenR.has(h)) { seenR.add(h); ch += t; }
  }
  for (x = 0; x < N; x++) {
    h = 2166136261; t = 0; pr = pg = pb = pa = -1;
    for (y = 0; y < N; y++) {
      p = (y * N + x) << 2; r = d[p]; g = d[p + 1]; b = d[p + 2]; a = d[p + 3];
      h = Math.imul(h ^ r, 16777619); h = Math.imul(h ^ g, 16777619); h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ a, 16777619);
      if (y > 0 && (r !== pr || g !== pg || b !== pb || a !== pa)) t++;
      pr = r; pg = g; pb = b; pa = a;
    }
    h >>>= 0; if (!seenC.has(h)) { seenC.add(h); cv += t; }
  }
  return Math.min(ch, cv);
}
/* hard alpha: force every pixel fully opaque or fully transparent (crisp, small) */
function hardenAlpha(d, n4) { for (var i = 3; i < n4; i += 4)d[i] = d[i] < 128 ? 0 : 255; }
/* return a hard-alpha copy of a buffer when the mode asks for it, else the buffer unchanged (single source for the copy-then-harden idiom) */
function hardenedCopy(buf, len, mode) { if (mode !== "hard") return buf; var c = new Uint8ClampedArray(buf); hardenAlpha(c, len); return c; }
/* Auto-smooth resolution+Detail search. byte size is monotonic in Detail (a finer Detail never removes
   stops), so per (resolution,axis) the finest Detail that fits the budget is found by binary search over
   the Detail grid (~log2(grid) encodes, not the whole ladder). budget-limited content: the finest-fitting
   Detail is the max-SSIM winner; with headroom it returns the finest that fits. the per-(N,axis) worker
   body; runSweep fans one job out per (resolution,axis). */
/* the refit narrows the budget boundary on the pair the sweep picked. byte size falls monotonically as
   the tolerance rises, so the best candidate is the finest tolerance that still fits and finding it is a
   bisection. the sweep leaves its whole pool idle at this point, so a round of probes is encoded at once
   and divides the bracket by one more than the probe count, where a serial bisection step only halves it.
   two brackets are narrowed together: the exact (shortest-path) fit, which reaches a given byte count at
   roughly a fifth of the greedy tolerance and so starts a cube of that ratio wide, and the greedy fit,
   between the winning Detail rung and the next finer one, which the geometric grid left unspent. */
function refitBrackets(tol, ladder) {
  var L = ladder || TUNING.toleranceLadder, i = L.indexOf(tol), r = TUNING.dpTolRatio, out = [];
  if (V2.dpKnots) out.push({ dp: true, lo: tol / (r * r * r), hi: tol });
  if (V2.tolRefine) out.push({ dp: false, lo: i > 0 ? L[i - 1] : tol * 0.5, hi: tol });
  return out;
}
/* one round's probes: the round's width is shared out over the brackets still wide enough to hold one,
   so once the greedy bracket closes - it starts one Detail rung wide and takes a single round - the
   whole round goes to the exact fit, which starts far wider. geometric points, since the bracket is. */
function refitProbes(brackets, width) {
  var open = [], pts = [], j, k, b;
  for (k = 0; k < brackets.length; k++)if (brackets[k].hi / brackets[k].lo > TUNING.refitStop) open.push(k);
  if (!open.length) return pts;
  var n = Math.floor(width / open.length); if (n < 1) n = 1;
  for (k = 0; k < open.length; k++) {
    b = brackets[open[k]];
    for (j = 1; j <= n; j++)pts.push({ tol: b.lo * Math.pow(b.hi / b.lo, j / (n + 1)), dp: b.dp, br: open[k] });
  }
  return pts;
}
/* lo is a tolerance whose output overflows, hi one that fits: an overflowing probe raises the floor,
   a fitting one lowers the ceiling. fits[j] is three-valued, because a probe that never answered - a
   timed-out or respawned worker - says nothing about the boundary, and reading it as an overflow would
   raise the floor past the point being looked for. a bracket whose floor already fits cannot be
   narrowed downward, so it closes from the top and the round returns the finest point it tried. */
function refitNarrow(brackets, pts, fits) {
  for (var j = 0; j < pts.length; j++) {
    var b = brackets[pts[j].br], t = pts[j].tol;
    if (fits[j] == null) continue;
    if (fits[j]) { if (t < b.hi) b.hi = t; } else if (t > b.lo) b.lo = t;
  }
  return brackets;
}
function smoothSearch(o, ref, S, Ns, smoothSource, cancelled, yieldFn, t0) {
  var axes = o.method === "rows" ? [0] : o.method === "cols" ? [1] : [0, 1];
  var tolL = o.toleranceLadder || TUNING.toleranceLadder;   /* ascending [toleranceMin..toleranceMax] = the Detail grid, index 0 = finest (most bytes) .. last = coarsest (fewest) */
  var n = tolL.length;
  var base = smoothSource();
  var plim = hardenedCopy(base, S * S * 4, o.alphaMode);
  var pairs = [], ni, ai; for (ni = 0; ni < Ns.length; ni++)for (ai = 0; ai < axes.length; ai++)pairs.push([Ns[ni], axes[ai]]);
  var bestFit =/** @type {Candidate|null} */(null), bestAny =/** @type {Candidate|null} */(null), pi = 0;
  function encodeStep(N, axis, idx, cache) {   /* encode+measure one Detail step, memoized per (N,axis) */
    if (cache[idx]) return cache[idx];
    var c =/** @type {Candidate} */(encodeSmoothStrips(plim, N, axis, { precision: o.precision, overlap: o.overlap, tol: tolL[idx] }));
    c.tol = tolL[idx]; var m = measureVsRef(c, ref, S); c.psnr = m.psnr; c.ssim = m.ssim; c.fits = c.enc <= o.budget;
    if (!bestAny || c.enc < bestAny.enc) bestAny = c;   /* the smallest candidate seen anywhere, for the nothing-fits fallback */
    cache[idx] = c; return c;
  }
  function bestForPair(N, axis) {   /* finest-fitting candidate at this (N,axis), or null if even the coarsest overflows */
    var cache = {};
    return yieldFn().then(function () { return encodeStep(N, axis, n - 1, cache); }).then(function (cHi) {   /* coarsest rung, so the smallest output: does anything fit at all? */
      if (!cHi || cHi.enc > o.budget) return null;
      return yieldFn().then(function () { return encodeStep(N, axis, 0, cache); }).then(function (cLo) {    /* finest = heaviest: does everything fit (headroom)? */
        if (cLo.enc <= o.budget) return cLo;
        var lo = 0, hi = n - 1;   /* enc decreases as idx rises; invariant enc(lo)>budget, enc(hi)<=budget. find the smallest fitting idx = finest Detail that fits. */
        function binarySearch() {
          if (hi - lo <= 1) return Promise.resolve(cache[hi]);
          if (cancelled && cancelled()) return Promise.resolve(cache[hi]);
          return yieldFn().then(function () { var mid = (lo + hi) >> 1; var cM = encodeStep(N, axis, mid, cache); if (cM.enc <= o.budget) hi = mid; else lo = mid; return binarySearch(); });
        }
        return binarySearch();
      });
    });
  }
  function nextPair() {
    if (pi >= pairs.length || (cancelled && cancelled()) || (bestFit && NOW() - t0 > TUNING.searchMaxMs)) return Promise.resolve();
    var pr = pairs[pi++];
    return bestForPair(pr[0], pr[1]).then(function (cand) {
      if (cand && cand.enc <= o.budget && (!bestFit || cand.ssim > bestFit.ssim + 1e-9 || (cand.ssim > bestFit.ssim - 1e-9 && cand.enc < bestFit.enc))) bestFit = cand;
      return nextPair();
    });
  }
  function encodeAt(N, axis, tol, dp) {
    var c =/** @type {Candidate} */(encodeSmoothStrips(plim, N, axis, { precision: o.precision, overlap: o.overlap, tol: tol, dp: dp }));
    c.tol = tol; var m = measureVsRef(c, ref, S); c.psnr = m.psnr; c.ssim = m.ssim; c.fits = c.enc <= o.budget;
    return c;
  }
  /* the winner alone is refit, since every probe is a full encode. two things the sweep leaves on the
     table: the Detail ladder is geometric, so the finest rung that fits leaves a few percent of the
     budget unspent and everything down to the next rung is free; and the sweep ranked with the greedy
     fit, so the exact one is retried here. both are narrowed as brackets (refitBrackets), refitRounds
     rounds of refitWidth probes, under refineMs. this is the serial path, taken by a single-job run;
     runSweep runs the same probes across the pool instead. */
  function refine(res) {
    if (!res || !(res.enc <= o.budget)) return Promise.resolve(res);
    var best = res, brs = refitBrackets(res.tol, tolL), round = 0, deadline = NOW() + TUNING.refineMs;
    /* every probe keeps the best candidate seen, so the deadline costs quality and never correctness */
    function nextRound() {
      if (round++ >= TUNING.refitRounds || NOW() > deadline || (cancelled && cancelled())) return Promise.resolve();
      var pts = refitProbes(brs, TUNING.refitWidth), fits = [], pi = 0;
      if (!pts.length) return Promise.resolve();
      function go() {
        if (pi >= pts.length || NOW() > deadline || (cancelled && cancelled())) return Promise.resolve();
        var p = pts[pi];
        return yieldFn().then(function () {
          var c = encodeAt(res.N, res.axis, p.tol, p.dp);
          fits[pi++] = c.fits;
          if (c.fits && c.ssim > best.ssim) best = c;
          return go();
        });
      }
      return go().then(function () { refitNarrow(brs, pts.slice(0, fits.length), fits); return nextRound(); });
    }
    /* disabled (V2.autoKnotChroma). the knot-placement chroma weight never chooses a colour, only where
       knots land, so dropping it should trade payload for detail, with the alternative encode walked
       toward a finer tolerance to collect it. over eight works it changes the result by 0.000 every
       time: the tolerance walk gives the bytes straight back. */
    function knotChromaSearch() {
      if (!V2.autoKnotChroma) return Promise.resolve();
      var save = TUNING.chromaW, ladder = TUNING.knotChromaLadder, li = 0;
      function nextW() {
        if (li >= ladder.length || (cancelled && cancelled())) { TUNING.chromaW = save; return Promise.resolve(); }
        TUNING.chromaW = ladder[li++];
        var tol = best.tol, step = 0;
        function spend() {
          if (step++ >= 3) return Promise.resolve();
          return yieldFn().then(function () {
            var c = encodeAt(res.N, res.axis, tol, true);
            if (!c.fits) return Promise.resolve();
            if (c.ssim > best.ssim) best = c;
            tol *= 0.65;
            return spend();
          });
        }
        return spend().then(nextW);
      }
      return nextW();
    }
    return nextRound().then(knotChromaSearch).then(function () { return best; });
  }
  /* the sweep fans one job out per (resolution,axis) and only one of them ships, so the refit passes
     do not run inside a fanned-out job: runSweep dispatches them once, on the pair that won, seeded
     with its Detail (the encoder is deterministic, so one encode rebuilds that winner exactly). a
     single-job run - manual, the inline fallback, the benchmark's recommendation - refines in place. */
  var seed = o.refineTol != null
    ? yieldFn().then(function () { return encodeAt(Ns[0], axes[0], o.refineTol, !!o.refineDp); })   /* one probe: runSweep asks for a single tolerance and fit kind, and refine:false returns it unchanged */
    : nextPair().then(function () { return bestFit || bestAny; });
  return seed.then(function (res) { return o.refine === false ? res : refine(res); })
    .then(function (res) { if (res) res.fits = res.enc <= o.budget; return res || null; });
}
function findBestEncode(ref, S, o, yieldFn, limitN, cancelled) {
  return Promise.resolve().then(function () {
    var t0 = NOW();
    var pareto = !!o.pareto && o.autofit && !limitN;   /* max-SSIM selection over a finer ladder */
    var Ns = o.N === "auto" ? resolutionLadder(o.autoN, pareto ? (o.paretoLadder || TUNING.paretoLadder) : o.ladder) : resolutionLadder(o.N, o.ladder);
    if (!o.autofit || limitN) Ns = [Ns[0]];
    var kStart = (typeof o.k === "number" && o.k > 0) ? o.k : 512;   /* defend against a non-numeric k (e.g. the "exact" marker fed back from a result): quantize would compute Math.min("exact",m)=NaN and crash */
    var prepCache = {};   /* the downscale at a given N is independent of k; reuse it across the palette sweep */
    function cachedPrep(N) { var c = prepCache[N] || (prepCache[N] = prepImage(ref, S, N, o.smoothPct, o.sharpResize)); return new Uint8ClampedArray(c); }
    var _plSrc = null;   /* full-resolution (S) PL source, prepped once: encodeSmoothStrips fits the gradient axis at S and cross-downsamples to N strips (asymmetric resolution) */
    function smoothSource() { if (_plSrc) return _plSrc; var s = new Uint8ClampedArray(ref); if (o.smoothPct > 0) bilateralSmooth(s, S, o.smoothPct); _plSrc = s; return s; }
    var tryCandidate = function (N, param, aPost, fam, isLast) {
      if (fam === "pl") {   /* piecewise-linear: fit the smooth pre-quantize signal at full resolution S (no quantize; not subject to the hard-transition prune below, whose bound counts hard steps PL never pays) */
        var plim = smoothSource();
        plim = hardenedCopy(plim, S * S * 4, o.alphaMode);
        var pb = smallestCandidate(buildSmoothCandidates(plim, N, o.method, param, o));
        if (pb) pb.tol = param;
        return pb;
      }
      var im =/** @type {any} */(cachedPrep(N));
      if (o.alphaMode === "hard") hardenAlpha(im.data ? im.data : im, N * N * 4);
      if (aPost) posterizeAlpha(im, N * N * 4); /* only under budget pressure: preserves AA edge quality */
      var q = quantize(im, N, param, o.dither, o.quantIters);
      if (o.autofit && !isLast && TUNING.boundK * minTransitions(im, N) > o.budget * TUNING.budgetPrune) return null; /* hopeless: skip building */
      var cands = buildPixelCandidates(im, N, o.method, o);
      var best = smallestCandidate(cands);
      if (best) { best.k = q.exact ? "exact" : param; best.kx = q.pal.length; }   /* kx = actual palette size, so the UI can show a number even when k is "exact" */
      return best;
    };
    if (pareto && o.plOn === true) return smoothSearch(o, ref, S, Ns, smoothSource, cancelled, yieldFn, t0);   /* Auto-smooth: byte size is monotonic in Detail, so binary-search the finest Detail that fits per (N,axis) instead of encoding the whole ladder. See smoothSearch. */
    function pixelScan() {   /* Auto-optimize, Pixelization: enc is monotonic in k but SSIM is not (the best palette can be a low k on flat content), so scan k ascending and stop at the first overflow (every larger k overflows too). skipping an over-budget k only skips its expensive quantize; it can never be the best-fitting winner. */
      var kA = (o.paletteLadder || TUNING.paletteLadder).slice().sort(function (a, b) { return a - b; }), kMin = kA[0];
      var pFit =/** @type {Candidate|null} */(null), pAny =/** @type {Candidate|null} */(null);
      function consider(cand) {
        if (!cand) return;
        if (!pAny || cand.enc < pAny.enc) pAny = cand;   /* the smallest candidate seen anywhere, for the nothing-fits fallback */
        if (cand.enc <= o.budget) {
          var m = measureVsRef(cand, ref, S); cand.psnr = m.psnr; cand.ssim = m.ssim;
          if (!pFit || cand.ssim > pFit.ssim + 1e-9 || (cand.ssim > pFit.ssim - 1e-9 && cand.enc < pFit.enc)) pFit = cand;
        }
      }
      var ni = 0;
      function scanResolution(N) {
        return yieldFn().then(function () { consider(tryCandidate(N, kMin, true, "hard", false)); }).then(function () {   /* posterized smallest palette first: it fits even when the plain k-min encode overflows */
          var i = 0;
          function scanColorCount() {
            if (i >= kA.length || (cancelled && cancelled()) || (pFit && NOW() - t0 > TUNING.searchMaxMs)) return Promise.resolve();
            var k = kA[i++];
            return yieldFn().then(function () {
              var c = tryCandidate(N, k, false, "hard", false); consider(c);
              if (!c || c.enc > o.budget) return Promise.resolve();   /* pruned (bound over budget) or overflow: enc rises with k, so every larger k overflows too - stop this resolution */
              return scanColorCount();
            });
          }
          return scanColorCount();
        });
      }
      function nextResolution() {
        if (ni >= Ns.length || (cancelled && cancelled())) return Promise.resolve();
        return scanResolution(Ns[ni++]).then(nextResolution);
      }
      /* the palette's chroma weight is not one number for every picture: through the full budgeted
         search, dropping it from 0.35 to 0.05 moves a flat graphic mark by +0.17 and a dense painting
         by +1.40. it also costs bytes, and the palette ladder is integer, so a lighter weight has to be
         paid for by stepping the palette down until the heavier output fits. the ladder floors at 0.10
         because the metric is luma-blind and would otherwise keep buying luma with colour it cannot
         see. */
      var _shiftOut = [0, 0];
      function chromaTry(N, k, q) {   /* one palette at one chroma weight, with the colour it moved measured against the image it replaced */
        var save = TUNING.qChroma; TUNING.qChroma = q;
        var im =/** @type {any} */(cachedPrep(N));
        if (o.alphaMode === "hard") hardenAlpha(im, N * N * 4);
        var pre = new Uint8ClampedArray(im);
        var qz = quantize(im, N, k, o.dither, o.quantIters);
        TUNING.qChroma = save;
        var best = smallestCandidate(buildPixelCandidates(im, N, o.method, o));
        if (!best) return null;
        best.k = qz.exact ? "exact" : k; best.kx = qz.pal.length;
        chromaShift(pre, im, N * N, _shiftOut);
        best.cMean = _shiftOut[0]; best.cP99 = _shiftOut[1];
        return best;
      }
      function chromaRefit(res) {
        if (!V2.autoChroma || !res || !res.fits || typeof res.k !== "number") return Promise.resolve(res);
        var kIdx = kA.indexOf(res.k); if (kIdx < 0) return Promise.resolve(res);
        var best = res, deadline = t0 + TUNING.searchMaxMs + TUNING.chromaRefitMs;
        function atWeight(q) {   /* the finest palette that fits at this weight. enc rises with k, so the first rung that fits is the best one, and a lighter weight costs bytes, which is why this walks down. */
          var j = kIdx, tried = 0;
          function down() {
            if (j < 0 || tried >= TUNING.chromaRefitRungs || NOW() > deadline || (cancelled && cancelled())) return Promise.resolve(null);
            return yieldFn().then(function () {
              tried++;
              var c = chromaTry(res.N, kA[j--], q);
              if (!c || c.enc > o.budget) return down();
              var m = measureVsRef(c, ref, S); c.psnr = m.psnr; c.ssim = m.ssim; c.fits = true;
              return c;
            });
          }
          return down();
        }
        /* the colour the default weight already costs on THIS picture is the reference. an absolute
           bound does not work: over the 36-work corpus that baseline runs from 2 to 16 at the 99th
           percentile (Lab a/b, the unit chromaShift computes), an eightfold spread, so a single
           threshold is far too tight for a dense painting and far too loose for a flat mark. */
        return atWeight(TUNING.qChroma).then(function (base) {
          if (!base) return best;
          var lo = TUNING.qChromaMin, hi = TUNING.qChroma, step = 0;
          /* the constraint is monotone in the weight - lighter always moves colour further - so the
             lowest acceptable weight is found by bisection rather than a fixed ladder. quality is not monotone,
             because the palette ladder is integer, so every accepted point is scored and the best kept. */
          function go() {
            if (step++ >= TUNING.chromaRefitSteps || NOW() > deadline || (cancelled && cancelled())) return Promise.resolve();
            var mid = Math.sqrt(lo * hi);
            return atWeight(mid).then(function (c) {
              if (!c) { lo = mid; return go(); }   /* nothing fit the budget here: the weight has to get heavier */
              if (c.cMean <= base.cMean + TUNING.chromaSlackMean && c.cP99 <= base.cP99 + TUNING.chromaSlackP99) {
                hi = mid; if (c.ssim > best.ssim) best = c;
              } else lo = mid;
              return go();
            });
          }
          return go().then(function () { return best; });
        });
      }
      return nextResolution().then(function () { var res = pFit || pAny; if (res) { if (res.ssim == null) { var mm = measureVsRef(res, ref, S); res.psnr = mm.psnr; res.ssim = mm.ssim; } res.fits = res.enc <= o.budget; } return res || null; })
        .then(chromaRefit).then(function (res) { if (res) res.fits = res.enc <= o.budget; return res || null; });
    }
    if (pareto) return pixelScan();   /* Auto-smooth returned via smoothSearch above; this covers Auto-pixel. Both manual paths fall through to the small plan below. */
    var k72 = Math.max(8, Math.floor(kStart * TUNING.kMidFactor)), k50 = Math.max(6, Math.floor(kStart * TUNING.kLowFactor));
    var plan = [];   /* MANUAL (non-Auto) only: both Auto-optimize paths (smoothSearch / pixelScan) returned above */
    var mtol = (o.tol != null) ? o.tol : TUNING.plManualTol;
    for (var nj = 0; nj < Ns.length; nj++) {
      var N2 = Ns[nj];
      if (o.plOn === true) { plan.push([N2, mtol, false, "pl"]); continue; }   /* Smooth gradients on: encode this resolution piecewise-linear so the toggle has a visible effect in manual mode too */
      plan.push([N2, kStart, false, "hard"]);
      plan.push([N2, kStart, true, "hard"]);
      plan.push([N2, k72, true, "hard"]);
      plan.push([N2, k50, true, "hard"]);
    }
    /* selection: without pareto, the first fitting candidate (largest N). with pareto, score every fitting
       candidate by SSIM (fewest bytes on ties), so a smaller N with more colours can beat a colour-starved
       large-N fit. a near-perfect fit ends the sweep; otherwise every non-hopeless candidate is scored
       (the admissible prune bounds the work). */
    var best =/** @type {Candidate|null} */(null), fitted =/** @type {Candidate|null} */(null);
    var bestFit =/** @type {Candidate|null} */(null);
    /* deterministic engine: a single family is swept per run, so candidates are compared by raw MS-SSIM (fewest bytes on ties) - no cross-engine handicap */
    return (function runStep(i) {
      if (bestFit && NOW() - t0 > TUNING.searchMaxMs) fitted = bestFit;   /* soft time cap, as insurance against the watchdog: return the best fit found so far rather than keep searching */
      if (cancelled && cancelled()) return Promise.resolve();   /* superseded (new encode / resolution change): stop the search at the next candidate instead of running the whole plan, so the worker frees immediately */
      if (i >= plan.length || fitted) return Promise.resolve();
      var p = plan[i];
      var cand = tryCandidate(p[0], p[1], p[2], p[3], i === plan.length - 1 && !best);
      if (cand) {
        if (!best || cand.enc < best.enc) best = cand;
        if (cand.enc <= o.budget) {
          if (pareto) {   /* score every fitting candidate: richest-k / largest-N is not always best (gradients prefer fewer colours), so no first-fit shortcut */
            var mc = measureVsRef(cand, ref, S); cand.psnr = mc.psnr; cand.ssim = mc.ssim;
            if (!bestFit || cand.ssim > bestFit.ssim + 1e-9 || (cand.ssim > bestFit.ssim - 1e-9 && cand.enc < bestFit.enc)) bestFit = cand;
            /* the RD optimum for smooth/photographic content is a low-resolution, high-colour point a stall
               counter would exit before reaching, so the sweep runs to the end (bounded by the prune + time cap);
               only a near-perfect fit ends it early. */
            if (bestFit && bestFit.ssim >= 0.999) fitted = bestFit;
          } else fitted = cand;
        }
      }
      if (!o.autofit) fitted = fitted || cand || best;
      return yieldFn().then(function () { return runStep(i + 1) });
    })(0).then(function () {
      var res = (pareto && bestFit) || fitted || best;
      if (!res) return null;
      if (res.ssim == null) { var m = measureVsRef(res, ref, S); res.psnr = m.psnr; res.ssim = m.ssim; }
      /* the Detail grid (toleranceLadder == detailToTolerance(1..detailMax)) is swept directly, so the
         winner sits on an integer Detail step the box can reproduce; the 40-step grid keeps that step
         close under the budget. */
      res.fits = res.enc <= o.budget;
      return res;
    });
  });
}
function runEncodeJob(msg, cancelled, yieldFn) {
  var t0 = NOW();
  _profSrc = null;   /* a worker outlives its jobs: start every one with a cold profile cache, so a changed flag or source can never be served an old block */
  var o = Object.assign({}, ENGINE_DEFAULTS, msg.opts), S = 512;
  if (o.v2) for (var vk in o.v2) if (vk in V2) V2[vk] = !!o.v2[vk];   /* a worker starts from the file defaults, so the job carries whatever the console changed */
  var ref = new Uint8ClampedArray(msg.raw);
  adjustColors(ref, S, S, o);   /* brightness/contrast/saturation only; bg removal done main-thread */
  if (o.noise > 0) addNoise(ref, S, S, o.noise);
  defringe(ref, S, S, 6);
  var uniq = countColors(ref, S * S * 4, 1600);
  return findBestEncode(ref, S, o, yieldFn, false, cancelled).then(function (w) {
    if (cancelled()) return Promise.reject("cancelled");
    if (!w) return { id: msg.id, ok: false, adj: ref.buffer, ms: NOW() - t0 };
    var lean = o.lean && !w.fits;   /* a lean (parallel-sweep) job drops the heavy strings of an over-budget candidate: something always fits, so an over-budget rung can never win, and its megabyte SVG never crosses the worker boundary. metrics stay, so selection is identical; the rare nothing-fits case re-encodes non-lean. */
    var fin = measureCanonical(w, ref, S);   /* the sweep ranked with the proxy; what leaves the engine is the canonical number, so the app, the lab and the published comparison all quote the same metric */
    w.psnr = fin.psnr; w.ssim = fin.ssim;
    return {
      id: msg.id, ok: true, ms: NOW() - t0, adj: ref.buffer, uniq: uniq,
      res: {
        svg: lean ? "" : w.svg, lmin: lean ? "" : w.lmin, lfull: lean ? "" : w.lfull, enc: w.enc, encFull: w.encFull,
        count: w.count, stops: w.stops, defs: lean ? "" : w.defs, method: w.method,
        N: w.N, k: w.k, kx: w.kx, tol: w.tol, psnr: w.psnr, ssim: w.ssim, fits: w.fits
      }
    };   /* tol: the piecewise-linear tolerance when method is a *-PL family (undefined for hard-run), so the app can re-encode / display it */
  });
}
/* a yield that lets the event loop turn. the worker needs it so a cancel message can be delivered
   between steps, which means a microtask will not do: microtasks drain before the message queue. a
   nested setTimeout(0) is clamped to 4ms by every browser, and a sweep yields a couple of hundred
   times, so MessageChannel is used where it exists and setTimeout only as the fallback. */
function makeYield() {
  if (typeof MessageChannel === "function") {
    var ch = new MessageChannel(), q = [];
    ch.port1.onmessage = function () { var f = q.shift(); if (f) f(); };
    return function () { return new Promise(function (r) { q.push(r); ch.port2.postMessage(0); }); };
  }
  return function () { return new Promise(function (r) { setTimeout(r, 0); }); };
}
/* worker link */
// @ts-ignore importScripts is a Worker global, absent from the dom lib used by the type check
if (typeof document === "undefined" && typeof self !== "undefined" && typeof importScripts === "function") {
  var MINGEN = {};                                             /* per lane: a job aborts at its next yield once its lane's gen passes it (the editor and the benchmark are independent streams) */
  self.onmessage = function (e) {
    var m = e.data, l = m.lane || "m";
    if (m.cmd === "cancel") { if (m.gen > (MINGEN[l] || 0)) MINGEN[l] = m.gen; return; }   /* a newer generation in this lane cancels its older in-flight jobs cooperatively */
    if (m.cmd !== "run") return;
    var cancelled = function () { return (m.gen || 0) < (MINGEN[l] || 0) };
    runEncodeJob(m, cancelled, makeYield()).then(function (res) {
      if (res && !cancelled())/** @type {any} */(self).postMessage(res, [res.adj]);
      else self.postMessage({ id: m.id, ok: false, cancelled: true });   /* always answer so the pool frees this worker, even when the job was cancelled */
    }).catch(function (err) {
      self.postMessage({ id: m.id, ok: false, err: String(err) });
    });
  };
}
