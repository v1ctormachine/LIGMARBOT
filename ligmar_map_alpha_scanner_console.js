(async function ligmarMapAlphaAwareScanner(){
  const OPTIONS = {
    radius: 7,
    stepPx: 30,
    verticalFactor: 0.86,
    sampleHalfSizePx: 18,
    useHexMask: true,
    tryBotCenterMap: true,
    waitAfterCenterMs: 350,
    canvasSelector: null,
    alphaThresholds: [1, 10, 30, 80, 150],
    includePixels: false
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

  function clampByte(n){ return Math.max(0, Math.min(255, Math.round(n))); }
  function rgbHex(r,g,b){
    const h = (n) => clampByte(n).toString(16).padStart(2,"0");
    return "#" + h(r) + h(g) + h(b);
  }
  function finalizeAverage(acc){
    if(!acc || !acc.count) return null;
    const r = acc.r / acc.count;
    const g = acc.g / acc.count;
    const b = acc.b / acc.count;
    const a = acc.a / acc.count;
    return {
      count: acc.count,
      avg: { r:+r.toFixed(3), g:+g.toFixed(3), b:+b.toFixed(3), a:+a.toFixed(3) },
      rounded: { r:clampByte(r), g:clampByte(g), b:clampByte(b), a:clampByte(a) },
      hex: rgbHex(r,g,b)
    };
  }
  function finalizeWeighted(acc){
    if(!acc || acc.weight <= 0) return null;
    const r = acc.r / acc.weight;
    const g = acc.g / acc.weight;
    const b = acc.b / acc.weight;
    return {
      weight:+acc.weight.toFixed(3),
      avg: { r:+r.toFixed(3), g:+g.toFixed(3), b:+b.toFixed(3) },
      rounded: { r:clampByte(r), g:clampByte(g), b:clampByte(b) },
      hex: rgbHex(r,g,b)
    };
  }

  function generateHexOffsets(radius, stepPx, h){
    const out = [];
    for(let q = -radius; q <= radius; q++){
      for(let r = -radius; r <= radius; r++){
        const s = -q - r;
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if(ring > radius) continue;
        out.push({ key:q+","+r, q, r, cube:{x:q,z:r,y:s}, ring, dx: stepPx * (q + r/2), dy: h*r });
      }
    }
    out.sort((a,b) => a.ring !== b.ring ? a.ring - b.ring : (a.r !== b.r ? a.r - b.r : a.q - b.q));
    return out;
  }

  function scanHex(pixels, width, height, centerX, centerY, scaleX, scaleY, opts){
    const halfSize = Math.round(opts.sampleHalfSizePx || 18);
    const step = opts.stepPx || 30;
    const hexRadius = step / Math.sqrt(3);
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const INV_SQRT3 = 1 / Math.sqrt(3);
    const startX = Math.round(centerX - halfSize * scaleX);
    const endX = Math.round(centerX + halfSize * scaleX);
    const startY = Math.round(centerY - halfSize * scaleY);
    const endY = Math.round(centerY + halfSize * scaleY);
    const raw = {count:0,r:0,g:0,b:0,a:0};
    const weighted = {weight:0,r:0,g:0,b:0};
    const opaque = {};
    const hist = {};
    const thresholds = opts.alphaThresholds || [1,10,30,80,150];
    thresholds.forEach(t => opaque[t] = {count:0,r:0,g:0,b:0,a:0});
    let minA = 255, maxA = 0;
    let minR = 255, minG = 255, minB = 255;
    let maxR = 0, maxG = 0, maxB = 0;
    let edgePixels = [];

    for(let y=startY; y<=endY; y++){
      if(y < 0 || y >= height) continue;
      for(let x=startX; x<=endX; x++){
        if(x < 0 || x >= width) continue;
        if(opts.useHexMask !== false){
          const dyCss = (y - centerY) / scaleY;
          const dxCss = (x - centerX) / scaleX;
          const absDx = Math.abs(dxCss);
          const absDy = Math.abs(dyCss);
          const outsideY = absDy > hexRadius;
          const outsideX = absDx > hexRadius * SQRT3_HALF;
          const outsideSlanted = (absDx * INV_SQRT3) + absDy > hexRadius;
          if(outsideY || outsideX || outsideSlanted) continue;
        }
        const idx = (y * width + x) * 4;
        const rr = pixels[idx], gg = pixels[idx+1], bb = pixels[idx+2], aa = pixels[idx+3];
        raw.count++; raw.r += rr; raw.g += gg; raw.b += bb; raw.a += aa;
        if(aa > 0){ weighted.weight += aa; weighted.r += rr * aa; weighted.g += gg * aa; weighted.b += bb * aa; }
        thresholds.forEach(t => { if(aa >= t){ const o = opaque[t]; o.count++; o.r += rr; o.g += gg; o.b += bb; o.a += aa; } });
        minA = Math.min(minA, aa); maxA = Math.max(maxA, aa);
        minR = Math.min(minR, rr); minG = Math.min(minG, gg); minB = Math.min(minB, bb);
        maxR = Math.max(maxR, rr); maxG = Math.max(maxG, gg); maxB = Math.max(maxB, bb);
        const bucket = Math.floor(aa / 16) * 16;
        hist[bucket] = (hist[bucket] || 0) + 1;
        if(OPTIONS.includePixels) edgePixels.push([x,y,rr,gg,bb,aa]);
      }
    }

    const rawFinal = finalizeAverage(raw);
    const opaqueFinal = {};
    thresholds.forEach(t => {
      const avg = finalizeAverage(opaque[t]);
      opaqueFinal[t] = avg ? Object.assign(avg, { ratio:+(opaque[t].count / Math.max(1, raw.count)).toFixed(4) }) : { count:0, ratio:0, avg:null, rounded:null, hex:null };
    });
    const alphaWeighted = finalizeWeighted(weighted);
    const alphaNonzero = opaque[1] ? opaque[1].count : 0;
    return {
      ok: raw.count > 0,
      samples: raw.count,
      raw: rawFinal,
      alphaWeighted,
      opaque: opaqueFinal,
      alpha: { min:minA, max:maxA, nonzero:alphaNonzero, nonzeroRatio:+(alphaNonzero/Math.max(1,raw.count)).toFixed(4), histogram16:hist },
      rgbMin: {r:minR,g:minG,b:minB},
      rgbMax: {r:maxR,g:maxG,b:maxB},
      pixels: OPTIONS.includePixels ? edgePixels : undefined
    };
  }

  async function tryPrepareMap(){
    const out = { tried:false, ensureMapOpen:null, ensureMapCentered:null };
    if(!OPTIONS.tryBotCenterMap || !window.ligmarBot) return out;
    out.tried = true;
    try{ if(typeof ligmarBot.ensureMapOpen === "function") out.ensureMapOpen = await ligmarBot.ensureMapOpen(); }catch(err){ out.ensureMapOpen = {ok:false,error:String(err)}; }
    try{ if(typeof ligmarBot.ensureMapCentered === "function") out.ensureMapCentered = await ligmarBot.ensureMapCentered(); }catch(err){ out.ensureMapCentered = {ok:false,error:String(err)}; }
    await sleep(OPTIONS.waitAfterCenterMs || 350);
    return out;
  }

  function getReadableCoordsIfAvailable(){
    try{ if(window.ligmarBot && typeof ligmarBot.readBasicState === "function"){ const st = ligmarBot.readBasicState(); return st && st.player ? st.player.coords : null; } }catch(err){}
    return null;
  }

  async function copyText(text){
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return {ok:true,method:"navigator.clipboard"}; } }catch(err){}
    try{ if(typeof copy === "function"){ copy(text); return {ok:true,method:"devtools_copy"}; } }catch(err){}
    return {ok:false,reason:"clipboard_unavailable"};
  }

  const prepared = await tryPrepareMap();
  const canvas = pickCanvas();
  if(!canvas){ console.error("[LigmarMapAlphaScan] No visible canvas found."); return {ok:false,reason:"no_visible_canvas"}; }
  const rect = canvas.getBoundingClientRect();
  const scaleX = (canvas.width || rect.width) / rect.width;
  const scaleY = (canvas.height || rect.height) / rect.height;
  let imageData = null, captureMethod = "";
  try{
    const ctx = canvas.getContext("2d", {willReadFrequently:true});
    if(ctx){ imageData = ctx.getImageData(0,0,canvas.width,canvas.height); captureMethod = "direct_getImageData"; }
  }catch(err){
    try{
      const temp = document.createElement("canvas"); temp.width = canvas.width; temp.height = canvas.height;
      const tctx = temp.getContext("2d", {willReadFrequently:true}); tctx.drawImage(canvas,0,0);
      imageData = tctx.getImageData(0,0,temp.width,temp.height); captureMethod = "drawImage_to_temp_getImageData";
    }catch(err2){
      const fail = {ok:false,reason:"canvas_read_failed",directError:String(err),tempError:String(err2)};
      console.error("[LigmarMapAlphaScan] Canvas read failed:", fail); return fail;
    }
  }
  if(!imageData) return {ok:false,reason:"no_image_data"};

  const stepPx = OPTIONS.stepPx;
  const h = Math.round(stepPx * OPTIONS.verticalFactor);
  const cssCenterX = rect.width / 2;
  const cssCenterY = rect.height / 2;
  const offsets = generateHexOffsets(OPTIONS.radius, stepPx, h);
  const tiles = [];
  for(const tile of offsets){
    const cssX = cssCenterX + tile.dx;
    const cssY = cssCenterY + tile.dy;
    if(cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height){
      tiles.push({key:tile.key,q:tile.q,r:tile.r,cube:tile.cube,ring:tile.ring,css:{x:+cssX.toFixed(2),y:+cssY.toFixed(2)},source:null,visibleCenter:false,ok:false,reason:"center_outside_canvas"});
      continue;
    }
    const srcX = Math.round(cssX * scaleX);
    const srcY = Math.round(cssY * scaleY);
    const stats = scanHex(imageData.data, imageData.width, imageData.height, srcX, srcY, scaleX, scaleY, OPTIONS);
    tiles.push({key:tile.key,q:tile.q,r:tile.r,cube:tile.cube,ring:tile.ring,css:{x:+cssX.toFixed(2),y:+cssY.toFixed(2)},source:{x:srcX,y:srcY},visibleCenter:true,scan:stats});
  }

  const report = {
    ok:true,
    type:"ligmar_map_alpha_aware_hex_scan",
    createdAt:new Date().toISOString(),
    note:"Use scan.alphaWeighted.hex and scan.opaque thresholds to classify transparent map tiles. q,r are local offsets from assumed center.",
    options:Object.assign({}, OPTIONS, {verticalStepPx:h}),
    prepared,
    currentCoordsIfAvailable:getReadableCoordsIfAvailable(),
    canvas:{className:String(canvas.className||""),tagName:canvas.tagName,captureMethod,cssRect:{left:+rect.left.toFixed(2),top:+rect.top.toFixed(2),width:+rect.width.toFixed(2),height:+rect.height.toFixed(2)},backingSize:{width:canvas.width,height:canvas.height},scale:{x:+scaleX.toFixed(4),y:+scaleY.toFixed(4)},assumedCssCenter:{x:+cssCenterX.toFixed(2),y:+cssCenterY.toFixed(2)},assumedSourceCenter:{x:Math.round(cssCenterX*scaleX),y:Math.round(cssCenterY*scaleY)}},
    tiles
  };
  window.__ligmarMapAlphaScanLast = report;
  const json = JSON.stringify(report, null, 2);
  const copied = await copyText(json);
  console.log("[LigmarMapAlphaScan] report:", report);
  if(copied.ok) console.log("[LigmarMapAlphaScan] Copied " + tiles.length + " tile samples to clipboard.", copied);
  else { console.warn("[LigmarMapAlphaScan] Clipboard failed; use window.__ligmarMapAlphaScanLast", copied); console.log(json); }
  return report;
})();
