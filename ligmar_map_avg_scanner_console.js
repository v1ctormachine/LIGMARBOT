(async function ligmarMapAverageColorScanner(){
  const OPTIONS = {
    radius: 7,
    stepPx: 30,
    verticalFactor: 0.86,
    sampleHalfSizePx: 18,
    useHexMask: true,
    tryBotCenterMap: true,
    waitAfterCenterMs: 350,
    canvasSelector: null
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el){
    if(!el) return false;
    const r = el.getBoundingClientRect();
    if(r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) !== 0;
  }

  function pickCanvas(){
    if(OPTIONS.canvasSelector){
      const c = document.querySelector(OPTIONS.canvasSelector);
      if(c && isVisible(c)) return c;
    }
    const canvases = Array.from(document.querySelectorAll("canvas"))
      .filter(isVisible)
      .map((c, i) => {
        const r = c.getBoundingClientRect();
        return { i, canvas: c, area: r.width * r.height, cssWidth: r.width, cssHeight: r.height, width: c.width, height: c.height, className: String(c.className || "") };
      })
      .sort((a,b) => b.area - a.area);
    return canvases.length ? canvases[0].canvas : null;
  }

  function hexToRgbHex(r,g,b){
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,"0");
    return "#" + h(r) + h(g) + h(b);
  }

  function clampByte(n){
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  function generateHexOffsets(radius, stepPx, h){
    const out = [];
    for(let q = -radius; q <= radius; q++){
      for(let r = -radius; r <= radius; r++){
        const s = -q - r;
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if(ring > radius) continue;
        out.push({
          key: q + "," + r,
          q,
          r,
          cube: { x: q, z: r, y: s },
          ring,
          dx: stepPx * (q + r / 2),
          dy: h * r
        });
      }
    }
    out.sort((a,b) => a.ring !== b.ring ? a.ring - b.ring : (a.r !== b.r ? a.r - b.r : a.q - b.q));
    return out;
  }

  function rgbaStatsFromImageData(pixels, width, height, centerX, centerY, scaleX, scaleY, opts){
    const halfSize = Math.round(opts.sampleHalfSizePx || 18);
    const step = opts.stepPx || 30;
    const hexRadius = step / Math.sqrt(3);
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const INV_SQRT3 = 1 / Math.sqrt(3);
    const startX = Math.round(centerX - halfSize * scaleX);
    const endX = Math.round(centerX + halfSize * scaleX);
    const startY = Math.round(centerY - halfSize * scaleY);
    const endY = Math.round(centerY + halfSize * scaleY);
    let count = 0;
    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    let sumR2 = 0, sumG2 = 0, sumB2 = 0;
    let minR = 255, minG = 255, minB = 255, minA = 255;
    let maxR = 0, maxG = 0, maxB = 0, maxA = 0;

    for(let y = startY; y <= endY; y++){
      if(y < 0 || y >= height) continue;
      for(let x = startX; x <= endX; x++){
        if(x < 0 || x >= width) continue;
        if(opts.useHexMask !== false){
          const dyCss = (y - centerY) / scaleY;
          const dxCss = (x - centerX) / scaleX;
          const absDx = Math.abs(dxCss);
          const absDy = Math.abs(dyCss);
          if(absDy > hexRadius) continue;
          if(absDx > hexRadius * SQRT3_HALF) continue;
          if((absDx * INV_SQRT3) + absDy > hexRadius) continue;
        }
        const idx = (y * width + x) * 4;
        const rr = pixels[idx];
        const gg = pixels[idx + 1];
        const bb = pixels[idx + 2];
        const aa = pixels[idx + 3];
        count++;
        sumR += rr; sumG += gg; sumB += bb; sumA += aa;
        sumR2 += rr * rr; sumG2 += gg * gg; sumB2 += bb * bb;
        if(rr < minR) minR = rr;
        if(gg < minG) minG = gg;
        if(bb < minB) minB = bb;
        if(aa < minA) minA = aa;
        if(rr > maxR) maxR = rr;
        if(gg > maxG) maxG = gg;
        if(bb > maxB) maxB = bb;
        if(aa > maxA) maxA = aa;
      }
    }

    if(!count) return { ok: false, samples: 0, avg: null, hex: null };
    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const avgA = sumA / count;
    const varianceR = Math.max(0, sumR2 / count - avgR * avgR);
    const varianceG = Math.max(0, sumG2 / count - avgG * avgG);
    const varianceB = Math.max(0, sumB2 / count - avgB * avgB);
    return {
      ok: true,
      samples: count,
      avg: { r: +avgR.toFixed(3), g: +avgG.toFixed(3), b: +avgB.toFixed(3), a: +avgA.toFixed(3) },
      avgRounded: { r: clampByte(avgR), g: clampByte(avgG), b: clampByte(avgB), a: clampByte(avgA) },
      hex: hexToRgbHex(avgR, avgG, avgB),
      min: { r: minR, g: minG, b: minB, a: minA },
      max: { r: maxR, g: maxG, b: maxB, a: maxA },
      stddev: { r: +Math.sqrt(varianceR).toFixed(3), g: +Math.sqrt(varianceG).toFixed(3), b: +Math.sqrt(varianceB).toFixed(3) }
    };
  }

  async function tryPrepareMap(){
    const out = { tried: false, ensureMapOpen: null, ensureMapCentered: null };
    if(!OPTIONS.tryBotCenterMap || !window.ligmarBot) return out;
    out.tried = true;
    try{
      if(typeof ligmarBot.ensureMapOpen === "function") out.ensureMapOpen = await ligmarBot.ensureMapOpen();
    }catch(err){ out.ensureMapOpen = { ok: false, error: String(err) }; }
    try{
      if(typeof ligmarBot.ensureMapCentered === "function") out.ensureMapCentered = await ligmarBot.ensureMapCentered();
    }catch(err){ out.ensureMapCentered = { ok: false, error: String(err) }; }
    await sleep(OPTIONS.waitAfterCenterMs || 350);
    return out;
  }

  function getReadableCoordsIfAvailable(){
    try{
      if(window.ligmarBot && typeof ligmarBot.readBasicState === "function"){
        const st = ligmarBot.readBasicState();
        return st && st.player ? st.player.coords : null;
      }
    }catch(err){}
    return null;
  }

  async function copyText(text){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return { ok: true, method: "navigator.clipboard" };
      }
    }catch(err){
      return { ok: false, method: "navigator.clipboard", error: String(err) };
    }
    try{
      if(typeof copy === "function"){
        copy(text);
        return { ok: true, method: "devtools_copy" };
      }
    }catch(err){
      return { ok: false, method: "devtools_copy", error: String(err) };
    }
    return { ok: false, reason: "clipboard_unavailable" };
  }

  const prepared = await tryPrepareMap();
  const canvas = pickCanvas();
  if(!canvas){
    console.error("[LigmarMapAvgScan] No visible canvas found.");
    return { ok: false, reason: "no_visible_canvas" };
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = (canvas.width || rect.width) / rect.width;
  const scaleY = (canvas.height || rect.height) / rect.height;
  let imageData = null;
  let captureMethod = "";

  try{
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if(ctx){
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      captureMethod = "direct_getImageData";
    }
  }catch(err){
    try{
      const temp = document.createElement("canvas");
      temp.width = canvas.width;
      temp.height = canvas.height;
      const tctx = temp.getContext("2d", { willReadFrequently: true });
      tctx.drawImage(canvas, 0, 0);
      imageData = tctx.getImageData(0, 0, temp.width, temp.height);
      captureMethod = "drawImage_to_temp_getImageData";
    }catch(err2){
      const fail = {
        ok: false,
        reason: "canvas_read_failed",
        directError: String(err),
        tempError: String(err2),
        canvas: {
          width: canvas.width,
          height: canvas.height,
          className: String(canvas.className || ""),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
      };
      console.error("[LigmarMapAvgScan] Canvas read failed:", fail);
      return fail;
    }
  }

  if(!imageData){
    console.error("[LigmarMapAvgScan] No image data captured.");
    return { ok: false, reason: "no_image_data" };
  }

  const stepPx = OPTIONS.stepPx;
  const h = Math.round(stepPx * OPTIONS.verticalFactor);
  const cssCenterX = rect.width / 2;
  const cssCenterY = rect.height / 2;
  const sourceCenterX = Math.round(cssCenterX * scaleX);
  const sourceCenterY = Math.round(cssCenterY * scaleY);
  const offsets = generateHexOffsets(OPTIONS.radius, stepPx, h);
  const tiles = [];

  for(const tile of offsets){
    const cssX = cssCenterX + tile.dx;
    const cssY = cssCenterY + tile.dy;
    if(cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height){
      tiles.push({
        key: tile.key,
        q: tile.q,
        r: tile.r,
        cube: tile.cube,
        ring: tile.ring,
        css: { x: +cssX.toFixed(2), y: +cssY.toFixed(2) },
        source: null,
        visibleCenter: false,
        ok: false,
        reason: "center_outside_canvas"
      });
      continue;
    }
    const srcX = Math.round(cssX * scaleX);
    const srcY = Math.round(cssY * scaleY);
    const stats = rgbaStatsFromImageData(imageData.data, imageData.width, imageData.height, srcX, srcY, scaleX, scaleY, OPTIONS);
    tiles.push({
      key: tile.key,
      q: tile.q,
      r: tile.r,
      cube: tile.cube,
      ring: tile.ring,
      css: { x: +cssX.toFixed(2), y: +cssY.toFixed(2) },
      source: { x: srcX, y: srcY },
      visibleCenter: true,
      ok: stats.ok,
      samples: stats.samples,
      avg: stats.avg,
      avgRounded: stats.avgRounded,
      hex: stats.hex,
      min: stats.min,
      max: stats.max,
      stddev: stats.stddev
    });
  }

  const report = {
    ok: true,
    type: "ligmar_map_avg_hex_color_scan",
    createdAt: new Date().toISOString(),
    note: "q,r are local axial offsets from assumed current/center tile. avg is average color inside virtual hex mask.",
    options: Object.assign({}, OPTIONS, { verticalStepPx: h }),
    prepared,
    currentCoordsIfAvailable: getReadableCoordsIfAvailable(),
    canvas: {
      className: String(canvas.className || ""),
      tagName: canvas.tagName,
      captureMethod,
      cssRect: { left: +rect.left.toFixed(2), top: +rect.top.toFixed(2), width: +rect.width.toFixed(2), height: +rect.height.toFixed(2) },
      backingSize: { width: canvas.width, height: canvas.height },
      scale: { x: +scaleX.toFixed(4), y: +scaleY.toFixed(4) },
      assumedCssCenter: { x: +cssCenterX.toFixed(2), y: +cssCenterY.toFixed(2) },
      assumedSourceCenter: { x: sourceCenterX, y: sourceCenterY }
    },
    tiles
  };

  window.__ligmarMapAvgColorScanLast = report;
  const json = JSON.stringify(report, null, 2);
  const copyResult = await copyText(json);
  console.log("[LigmarMapAvgScan] report:", report);
  if(copyResult.ok){
    console.log("[LigmarMapAvgScan] Copied " + tiles.length + " tile samples to clipboard.", copyResult);
  }else{
    console.warn("[LigmarMapAvgScan] Clipboard copy failed. Copy window.__ligmarMapAvgColorScanLast manually.", copyResult);
    console.log(json);
  }
  return report;
})();
