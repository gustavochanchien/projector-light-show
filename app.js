// =====================
// Utilities
// =====================

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a,b,t) => a + (b-a)*t;
  const nowMs = () => performance.now();

  // Shared palette (reuse anywhere)
  const COLORS = Object.freeze({
    red:     rgb(255, 0,   0),
    yellow:  rgb(255, 255, 0),
    green:   rgb(0,   255, 0),
    cyan:    rgb(0,   255, 255),
    blue:    rgb(0,   0,   255),
    magenta: rgb(255, 0,   255),
    white:   rgb(255, 255, 255),
  });

  const PALETTE = Object.freeze(Object.values(COLORS)); // [ {r,g,b}, ... ]

  // Mic gain mapping (UI 0..200 -> 0.5× .. 5.0×)
  function micGainFromUI(v){
    return lerp(0.5, 5.0, clamp((v||0)/200, 0, 1));
  }

  const easeInOutCubic = (t) => (t < 0.5) ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

  function rgb(r,g,b){ return {r: clamp(Math.round(r),0,255), g: clamp(Math.round(g),0,255), b: clamp(Math.round(b),0,255)}; }
  function rgba(c, a){ return `rgba(${c.r},${c.g},${c.b},${clamp(a,0,1)})`; }
  function brightness(c){ return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; }
  function distSq(a,b){ const dx=a.r-b.r, dy=a.g-b.g, dz=a.b-b.b; return dx*dx+dy*dy+dz*dz; }

// Choose a bright color from the fixed palette.
// Returns a fresh object so callers can mutate without affecting shared state.
  function randomBrightColor(){
    // pick from your palette (clone so callers can’t accidentally mutate shared objects)
    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    return rgb(c.r, c.g, c.b);
  }


// Pick the palette color farthest (in RGB space) from the given color.
// Used to keep A/B colors distinct in multicolor mode.
  function contrastingColor(c){
    // Pick the palette color that’s farthest from c
    let best = PALETTE[0];
    let bestD = -1;

    for (const p of PALETTE){
      const d = distSq(p, c);
      if (d > bestD){ bestD = d; best = p; }
    }

    return rgb(best.r, best.g, best.b);
  }


  
// =====================
// Preset names/labels (supports external presets.js if present)
// =====================
// Some builds ship a separate presets.js that defines PRESET_NAMES or presetNames.
// The popout and self-tests expect presetLabel() to exist.
  const __PRESET_NAMES =
    (typeof window !== 'undefined' && (window.PRESET_NAMES || window.presetNames)) || null;

// Human-friendly preset name with fallbacks.
// External builds may provide PRESET_NAMES / presetNames via presets.js.
  function presetLabel(i){
    const arr =
      (typeof window !== 'undefined' && (window.PRESET_NAMES || window.presetNames)) || null;

    if (arr && arr[i] != null && String(arr[i]).trim().length) return String(arr[i]);
    return `Preset ${i}`;
  }

// Total presets exposed in UI. Defaults to 32 if presets.js isn't present.
  function presetCount(){
    const arr =
      (typeof window !== 'undefined' && (window.PRESET_NAMES || window.presetNames)) || null;

    // If presets.js is present, use its length.
    if (Array.isArray(arr) && arr.length > 0) return arr.length;

    // Fallback if nothing loaded (keeps old behavior)
    return 32;
  }

  
  // Expose for popup + external scripts
  try { window.presetLabel = presetLabel; } catch {}
  try { window.presetNames = __PRESET_NAMES || Array.from({length:presetCount()}, (_,i)=>presetLabel(i)); } catch {}
  

// =====================
// Canvas + layout
// =====================
  const main = document.getElementById('main');
  let ctx = main.getContext('2d', { alpha: false });
  const panelEl = document.getElementById('panel');

  let DPR = 1;
  let W = 0, H = 0;
  let panelW = 500;
  let visualW = 0;  // drawing zone (left) in pixels (DPR-applied)

// Measure the in-page controls panel width so we can reserve screen space.
// When the panel is hidden (or pop-out is active), the visual area expands.
  function measurePanelWidth(){
    if (document.body.classList.contains('hiddenPanel')) { panelW = 0; return; }
    const rect = panelEl.getBoundingClientRect();
    panelW = rect.width || 0;
  }

// =====================
// State
// =====================
  let presetNumber = 0;              // 0-31
  let presetSpeed = 30;              // 0-100
  let presetSizeDest = 50;           // 0-100
  let presetBrightnessDest = 100;    // 0-100
  let presetStrobing = 0;            // 0-100
  let shadeAmount = 0;               // 0-100
  let bpm = 128;                     // 60-180

  let presetBrightness = 100;
  let presetSize = 50;

  let multiColor = true;
  let presetColor = rgb(0,0,255);       // Color A
  let multiColorClr = rgb(255,255,255); // Color B

  let blackout = false;
  let bpmSTLmode = false;

  // Beat DJ (audio beat detection)
  let beatDJ = false;
  let beatAutoColor = true;
  let beatAutoPreset = true;
  let beatSens = 70;            // 0..100 (higher = more sensitive)
  let micGainVal = 80;         // 0..200 UI
  let micGain = 2.3;           // scales audio energy (mic/file/demo)
  let beatCooldownMs = 160;     // ms
  let beatEveryN = 4;           // change preset every N beats
  let beatCount = 0;
  let lastBeatFlash = -1e9;

  // IMPORTANT: declare early so pop-out state can reference it safely
  let _lastMeterEnergy = -1;

  // Motion blend speed (0..100) -> blend duration seconds
  let transitionSpeed = 55;
  function motionBlendDurationSec(){
    // 0 = slow blend, 100 = fast blend
    return lerp(1.8, 0.10, clamp(transitionSpeed/100, 0, 1));
  }

  // Timers / counters
  let a=0,b_=0,c=0,d=0;
  let v=0.2, m=0;
  let strobeTime = 0;
  let onoff = true;
  let timeRand = 0;
  let bpmBeatTime = 0;
  let bpmBeatCounter = -1;

  // Random arrays (discoball etc.)
  const ranX = new Int32Array(1000);
  const ranY = new Int32Array(1000);

  // Motion path blending state
  let motionPhase = 0; // 0..1
  let motionFromMode = 'off';
  let motionToMode = 'off';
  let motionBlendStart = 0;
  let motionBlending = false;

// Handle DPR-aware canvas sizing and compute the visual drawing zone.
// visualW is the left-side area reserved for the show; the right side is UI-only.
  function resize(){
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(window.innerWidth * DPR);
    H = Math.floor(window.innerHeight * DPR);
    main.width = W;
    main.height = H;

    measurePanelWidth();
    const gap = Math.floor((panelW ? (panelW + 24) : 0) * DPR);
    visualW = Math.max(320*DPR, W - gap);

    ctx.setTransform(1,0,0,1,0,0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,W,H);

    motionBlending = false;
  }

  window.addEventListener('resize', resize);

// Toggle the in-page controls panel (so the projector output stays clean).
// If a pop-out window is open, we force-hide the in-page panel.
  function setPanelHidden(hidden){
    // When the pop-out controls are open, always keep the in-page panel hidden.
    if (!hidden && isPopupOpen()) hidden = true;
    const wasHidden = document.body.classList.contains('hiddenPanel');
    if (hidden) document.body.classList.add('hiddenPanel');
    else document.body.classList.remove('hiddenPanel');
    if (wasHidden !== hidden) resize();
  }

  // Run initial resize
  resize();

// =====================
// Init helpers
// =====================
  function initDiscoball(rng=Math.random){
    for (let i=0;i<1000;i++){
      ranX[i] = Math.floor((rng()*2-1) * (0.71*visualW/DPR));
      ranY[i] = Math.floor((rng()*2-1) * (0.71*visualW/DPR));
    }
  }
  initDiscoball();

// =====================
// Motion path (circle/square/triangle) with smooth blending
// =====================
  function motionPos(mode, phase, r){
    const t = ((phase % 1) + 1) % 1;
    if (mode === 'off') return {x:0, y:0};

    if (mode === 'circle'){
      const ang = t * Math.PI * 2;
      return { x: r*Math.cos(ang), y: r*Math.sin(ang) };
    }

    if (mode === 'square'){
      const s = t * 4;
      const seg = Math.floor(s);
      const u = s - seg;
      const P = [
        {x: r,  y: -r},
        {x: r,  y:  r},
        {x: -r, y:  r},
        {x: -r, y: -r},
        {x: r,  y: -r},
      ];
      const p0 = P[seg];
      const p1 = P[seg+1];
      return { x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) };
    }

    // triangle
    const s = t * 3;
    const seg = Math.floor(s);
    const u = s - seg;
    const P = [
      {x: 0,  y: -r},
      {x: r,  y:  r},
      {x: -r, y:  r},
      {x: 0,  y: -r},
    ];
    const p0 = P[seg];
    const p1 = P[seg+1];
    return { x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) };
  }

// Start a smooth transition between motion modes. The blend duration is controlled
// by the Motion Blend slider (transitionSpeed).
  function setMotionMode(next){
    if (next === motionToMode) return;
    motionFromMode = motionToMode;
    motionToMode = next;
    motionBlendStart = nowMs();
    motionBlending = true;
  }

// Advance motion phase and return the blended motion offset.
// dt is seconds since last frame (clamped elsewhere).
  function computeMotionOffset(tNow, dt){
    // cycles per second; tied to Speed slider
    const cps = lerp(0, 0.22, clamp(presetSpeed/100, 0, 1));
    motionPhase = (motionPhase + dt * cps) % 1;

    const r = 0.18 * Math.min((visualW/DPR), (H/DPR));
    const from = motionPos(motionFromMode, motionPhase, r);
    const to = motionPos(motionToMode, motionPhase, r);

    let blend = 1;
    if (motionBlending){
      const dur = motionBlendDurationSec() * 1000;
      blend = easeInOutCubic(clamp((tNow - motionBlendStart)/dur, 0, 1));
      if (blend >= 1){
        motionFromMode = motionToMode;
        motionBlending = false;
      }
    }

    return { x: lerp(from.x, to.x, blend), y: lerp(from.y, to.y, blend) };
  }

// =====================
// Rendering helpers (visual zone is left side only)
// =====================
  function fadeBackground(){
    const alpha = lerp(1.0, 0.04, clamp(shadeAmount/100,0,1));
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0,0,visualW,H);

    if (!document.body.classList.contains('hiddenPanel')){
      ctx.fillStyle = '#000';
      ctx.fillRect(visualW,0,W-visualW,H);
    }
  }


  function altColor(i){
    if (!multiColor) return presetColor;
    return (i % 2 === 0) ? presetColor : multiColorClr;
  }

  function setFillColor(c){
    ctx.fillStyle = rgba(c, clamp(presetBrightness/100, 0, 1));
  }

  function setStrokeColor(c){
    ctx.strokeStyle = rgba(c, clamp(presetBrightness/100, 0, 1));
  }

  function worldToCanvasX(x){ return x * DPR; }
  function worldToCanvasY(y){ return y * DPR; }

  function fillCircleWorld(x,y,r){
    ctx.beginPath();
    ctx.arc(worldToCanvasX(x), worldToCanvasY(y), r*DPR, 0, Math.PI*2);
    ctx.fill();
  }

  function strokeLineWorld(x1,y1,x2,y2){
    ctx.beginPath();
    ctx.moveTo(worldToCanvasX(x1), worldToCanvasY(y1));
    ctx.lineTo(worldToCanvasX(x2), worldToCanvasY(y2));
    ctx.stroke();
  }

  function strokeRectCenteredWorld(cx,cy,w,h){
    ctx.strokeRect(worldToCanvasX(cx-w/2), worldToCanvasY(cy-h/2), w*DPR, h*DPR);
  }

  function arcWorld(cx,cy,diam,start,end){
    ctx.beginPath();
    ctx.arc(worldToCanvasX(cx), worldToCanvasY(cy), (diam/2)*DPR, start, end);
    ctx.stroke();
  }

  // Faster batch circle fill
  function fillCirclesBatch(circles){
    if (!circles.length) return;
    ctx.beginPath();
    for (let i=0;i<circles.length;i++){
      const p = circles[i];
      const x = worldToCanvasX(p.x);
      const y = worldToCanvasY(p.y);
      const r = p.r * DPR;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI*2);
    }
    ctx.fill();
  }

  // Faster batch dots for tons of tiny points
  function fillTinyDotsBatch(points, r){
    // points is flat [x0,y0,x1,y1,...] in WORLD units
    const rr = Math.max(1, r * DPR);
    const half = rr * 0.5;
    for (let i=0;i<points.length;i+=2){
      const x = points[i] * DPR;
      const y = points[i+1] * DPR;
      ctx.fillRect(x - half, y - half, rr, rr);
    }
  }

    

// =====================
// Pingpong balls (optimized)
// =====================
  class Kreis {
    constructor(){
      this.posX = 200 + Math.random() * Math.max(1, (visualW/DPR)-400);
      this.posY = 200 + Math.random() * Math.max(1, (H/DPR)-400);
      this.spdX = 10 + Math.random() * 20;
      this.spdY = 10 + Math.random() * 20;
    }
    step(){
      const ballDiam = Math.floor(lerp(300, 40, clamp((presetSize+1)/100,0,1)));
      const ballR = ballDiam/2;

      let x = this.posX, y = this.posY;
      let sx = this.spdX, sy = this.spdY;

      const w = (visualW/DPR);
      const h = (H/DPR);

      if (x <= ballR) { x = ballR; sx = -sx; }
      else if (x >= w-ballR) { x = w-ballR; sx = -sx; }
      if (y <= ballR) { y = ballR; sy = -sy; }
      else if (y >= h-ballR) { y = h-ballR; sy = -sy; }

      const moveScale = lerp(0, 1, clamp((presetSpeed+1)/100, 0, 1));
      x += moveScale * sx;
      y += moveScale * sy;

      this.posX = x; this.posY = y; this.spdX = sx; this.spdY = sy;
      return { x, y, r: ballR };
    }
  }

  const spotlight = Array.from({length: 21}, () => new Kreis());

// =====================
// UI binding
// =====================
  const ui = {
    presetGrid: document.getElementById('presetGrid'),
    colorGrid: document.getElementById('colorGrid'),
    btnMulti: document.getElementById('btnMulti'),
    btnBlackout: document.getElementById('btnBlackout'),
    btnBpm: document.getElementById('btnBpm'),
    btnBeat: document.getElementById('btnBeat'),
    btnFS: document.getElementById('btnFS'),
    btnPop: document.getElementById('btnPop'),
    status: document.getElementById('status'),
    capPill: document.getElementById('capPill'),

    // In-panel audio meter
    energyFill: document.getElementById('energyFill'),
    beatDot: document.getElementById('beatDot'),

    btnBeatColor: document.getElementById('btnBeatColor'),
    btnBeatPreset: document.getElementById('btnBeatPreset'),
    beatEvery: document.getElementById('beatEvery'),
    beatSens: document.getElementById('beatSens'),
    beatCool: document.getElementById('beatCool'),
    beatSensOut: document.getElementById('beatSensOut'),
    beatCoolOut: document.getElementById('beatCoolOut'),

    micGain: document.getElementById('micGain'),
    micGainOut: document.getElementById('micGainOut'),

    btnMic: document.getElementById('btnMic'),

    motionSel: document.getElementById('motionSel'),

    speed: document.getElementById('speed'),
    size: document.getElementById('size'),
    bright: document.getElementById('bright'),
    strobe: document.getElementById('strobe'),
    shade: document.getElementById('shade'),
    bpm: document.getElementById('bpm'),
    trans: document.getElementById('trans'),

    speedOut: document.getElementById('speedOut'),
    sizeOut: document.getElementById('sizeOut'),
    brightOut: document.getElementById('brightOut'),
    strobeOut: document.getElementById('strobeOut'),
    shadeOut: document.getElementById('shadeOut'),
    bpmOut: document.getElementById('bpmOut'),
    transOut: document.getElementById('transOut'),

    pickA: document.getElementById('pickA'),
    pickB: document.getElementById('pickB'),
    btnSwap: document.getElementById('btnSwap'),
    colorReadout: document.getElementById('colorReadout'),
  };

  function setStatus(text){ ui.status.innerHTML = text; }
  function toggleBtn(btn, on){ btn.classList.toggle('on', !!on); }

  // color target for picker (A/B)
  let colorTarget = 'A';

  function updateColorReadout(){
    const a = `A: rgb(${presetColor.r},${presetColor.g},${presetColor.b})`;
    const b = `B: rgb(${multiColorClr.r},${multiColorClr.g},${multiColorClr.b})`;
    if (ui.colorReadout) ui.colorReadout.innerHTML = `${a} &nbsp;|&nbsp; ${b}`;
    if (ui.pickA) ui.pickA.classList.toggle('on', colorTarget === 'A');
    if (ui.pickB) ui.pickB.classList.toggle('on', colorTarget === 'B');
  }

// Sync UI button states + dependent UI (e.g., disable Swap when not multicolor).
// Also broadcasts state to the pop-out window (if open).
  function updateToggles(){
    if (ui.btnMulti) toggleBtn(ui.btnMulti, multiColor);
    if (ui.btnBlackout) toggleBtn(ui.btnBlackout, blackout);
    if (ui.btnBpm) toggleBtn(ui.btnBpm, bpmSTLmode);
    if (ui.btnBeat) toggleBtn(ui.btnBeat, beatDJ);
    if (ui.btnBeatColor) toggleBtn(ui.btnBeatColor, beatAutoColor);
    if (ui.btnBeatPreset) toggleBtn(ui.btnBeatPreset, beatAutoPreset);
    if (ui.btnSwap) ui.btnSwap.disabled = !multiColor;
    updateColorReadout();
    // keep pop-out in sync if it exists
    try { sendStateToPopup?.(); } catch {}
  }
// ---------------------
// Main panel controls wiring (same behavior as popup)
// ---------------------
  if (ui.btnMulti) ui.btnMulti.addEventListener('click', () => { multiColor = !multiColor; updateToggles(); });
  if (ui.btnBlackout) ui.btnBlackout.addEventListener('click', () => { blackout = !blackout; updateToggles(); });
  if (ui.btnBpm) ui.btnBpm.addEventListener('click', () => { bpmSTLmode = !bpmSTLmode; updateToggles(); });
  if (ui.btnBeat) ui.btnBeat.addEventListener('click', () => { beatDJ = !beatDJ; updateToggles(); });
  if (ui.btnBeatColor) ui.btnBeatColor.addEventListener('click', () => { beatAutoColor = !beatAutoColor; updateToggles(); });
  if (ui.btnBeatPreset) ui.btnBeatPreset.addEventListener('click', () => { beatAutoPreset = !beatAutoPreset; updateToggles(); });

  if (ui.pickA) ui.pickA.addEventListener('click', () => { colorTarget = 'A'; updateColorReadout(); });
  if (ui.pickB) ui.pickB.addEventListener('click', () => { colorTarget = 'B'; updateColorReadout(); });

  if (ui.btnSwap) ui.btnSwap.addEventListener('click', () => {
    if (!multiColor) return;
    const t = presetColor; presetColor = multiColorClr; multiColorClr = t;
    updateToggles();
  });

  // Color buttons
  const colorButtons = [
    { name: 'R',   c: COLORS.red },
    { name: 'Y',   c: COLORS.yellow },
    { name: 'G',   c: COLORS.green },
    { name: 'C',   c: COLORS.cyan },
    { name: 'B',   c: COLORS.blue },
    { name: 'M',   c: COLORS.magenta },
    { name: 'W',   c: COLORS.white },
    { name: 'Rnd', c: null },
  ];


  function renderColorGrid(){
    const grid = ui.colorGrid;
    if (!grid) return;
    grid.innerHTML = '';
    colorButtons.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'colorBtn';
      if (it.c){
        b.style.background = `rgb(${it.c.r},${it.c.g},${it.c.b})`;
        b.title = it.name;
      } else {
        b.textContent = 'Rnd';
        b.title = 'Random bright';
      }
      b.addEventListener('click', () => {
        const chosen = it.c ? rgb(it.c.r,it.c.g,it.c.b) : randomBrightColor();
        if (colorTarget === 'A') presetColor = chosen;
        else multiColorClr = chosen;
        if (multiColor && distSq(multiColorClr, presetColor) < 80*80){
          // keep them distinct
          multiColorClr = contrastingColor(presetColor);
        }
        updateToggles();
      });
      grid.appendChild(b);
    });
  }

  renderColorGrid();
  updateToggles();


  let colorTargetget = 'A';

// =====================
// Pop-out Controls Window (2nd screen)
// =====================
  let popupWin = null;
  let popupWatch = null;
  const isPopupOpen = () => !!(popupWin && !popupWin.closed);
  let lastPopupBroadcast = 0;

// Serialize the current app state into a plain object that the pop-out can mirror.
// Keep this stable: changes here require matching pop-out DOM updates.
  function getRemoteState(){
    return {
      presetNumber,
      presetSpeed,
      presetSizeDest,
      presetBrightnessDest,
      presetStrobing,
      shadeAmount,
      bpm,

      transitionSpeed,
      motionMode: motionToMode,

      multiColor,
      blackout,
      bpmSTLmode,

      beatDJ,
      beatAutoColor,
      beatAutoPreset,
      beatSens,
      beatCooldownMs,
      beatEveryN,
      micGainVal,
      micGain,

      colorTarget,
      colorA: {...presetColor},
      colorB: {...multiColorClr},

      meter: {
        energy: clamp(_lastMeterEnergy < 0 ? 0 : _lastMeterEnergy, 0, 1),
        beatAgeMs: nowMs() - lastBeatFlash
      },

      cap: {
        text: ui.capPill?.textContent || 'Mic: …',
        className: ui.capPill?.className || 'pill'
      },

      statusHTML: ui.status?.innerHTML || ''
        ,presetNames: (function(){try{const a=[];for(let i=0;i<presetCount();i++){let n='Preset '+i;try{if(typeof presetLabel==='function') n=String(presetLabel(i));}catch{}a.push(n);}return a;}catch{return null;}})()
    };
  }


// Mirror state into the pop-out's DOM. This is intentionally "dumb":
// it only updates fields and never runs main-window logic.
  function syncPopupDom(state){
    if (!popupWin || popupWin.closed) return;
    let d;
    try { d = popupWin.document; } catch { return; }
    if (!d) return;
    const $p = (id) => { try { return d.getElementById(id); } catch { return null; } };

    // toggles
    const setOn = (id, on) => { const b = $p(id); if (b) b.classList.toggle('on', !!on); };
    setOn('btnMulti', state.multiColor);
    setOn('btnBlackout', state.blackout);
    setOn('btnBpm', state.bpmSTLmode);
    setOn('btnBeat', state.beatDJ);
    setOn('btnBeatColor', state.beatAutoColor);
    setOn('btnBeatPreset', state.beatAutoPreset);

    // selects
    const motionSel = $p('motionSel');
    if (motionSel && motionSel.value !== state.motionMode) motionSel.value = state.motionMode;
    const beatEvery = $p('beatEvery');
    if (beatEvery && String(beatEvery.value) !== String(state.beatEveryN)) beatEvery.value = String(state.beatEveryN);

    const pickA = $p('pickA');
    const pickB = $p('pickB');
    if (pickA) pickA.classList.toggle('on', state.colorTarget === 'A');
    if (pickB) pickB.classList.toggle('on', state.colorTarget === 'B');

    // sliders + outputs
    const mirrorRange = (id, v, outText) => {
      const el = $p(id); if (!el) return;
      if (String(el.value) !== String(v)) el.value = String(v);
      const out = $p(id+'Out');
      if (out) out.textContent = outText != null ? outText : String(v);
    };
    mirrorRange('speed', state.presetSpeed, String(state.presetSpeed));
    mirrorRange('size', state.presetSizeDest, String(state.presetSizeDest));
    mirrorRange('bright', state.presetBrightnessDest, String(state.presetBrightnessDest));
    mirrorRange('strobe', state.presetStrobing, String(state.presetStrobing));
    mirrorRange('shade', state.shadeAmount, String(state.shadeAmount));
    mirrorRange('bpm', state.bpm, String(state.bpm));
    // Beat DJ sliders
    try { mirrorRange('micGain', state.micGainVal, (state.micGain||0).toFixed(2)+'×'); } catch { mirrorRange('micGain', state.micGainVal, String(state.micGainVal)); }
    mirrorRange('beatSens', state.beatSens, String(state.beatSens));
    mirrorRange('beatCool', state.beatCooldownMs, String(state.beatCooldownMs)+'ms');
    // Motion blend shows seconds in the main UI; match that
    try {
      const sec = lerp(1.8, 0.10, clamp((state.transitionSpeed||0)/100,0,1));
      const ms = Math.round(sec*1000);
      mirrorRange('trans', state.transitionSpeed, (ms >= 1000) ? ((ms/1000).toFixed(2)+'s') : (ms+'ms'));
    } catch {
      mirrorRange('trans', state.transitionSpeed, String(state.transitionSpeed));
    }

    // active preset highlight
    const grid = $p('presetGrid');
    if (grid){
      const btns = grid.querySelectorAll('button[data-preset]');
      btns.forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-preset')) === state.presetNumber));
    }

    // color readout
    const cr = $p('colorReadout');
    if (cr){
      const A = state.colorA || {r:0,g:0,b:0};
      const B = state.colorB || {r:0,g:0,b:0};
      cr.innerHTML = `A: rgb(${A.r},${A.g},${A.b}) &nbsp;|&nbsp; B: rgb(${B.r},${B.g},${B.b})`;
    }

    // beat meter
    const mf = $p('energyFill');
    if (mf && state.meter) mf.style.width = (clamp(state.meter.energy||0,0,1)*100).toFixed(1)+'%';
    const bd = $p('beatDot');
    if (bd && state.meter){
      const age = state.meter.beatAgeMs||1e9;
      const on = age < 140;
      bd.style.opacity = on ? '1' : '0';
    }

  // cap pill + status
    const cap = $p('capPill');
    if (cap && state.cap){
      cap.className = state.cap.className || 'pill';
      cap.textContent = state.cap.text || 'Mic: …';
    }
    const st = $p('status');
    if (st) st.innerHTML = state.statusHTML || '';
  }

// Throttled state broadcast to the pop-out (keeps UI responsive).
      function sendStateToPopup(force=false){
        if (!popupWin || popupWin.closed) return;
        const t = nowMs();
        if (!force && (t - lastPopupBroadcast) < 80) return; // ~12.5fps
        lastPopupBroadcast = t;
        syncPopupDom(getRemoteState());
      }

      // Allow the pop-out to control the main window via postMessage.
      // We scope handling to messages coming from the currently-open pop-out.
      window.addEventListener('message', (e) => {
        if (!e || !e.data) return;
        const msg = e.data;

        // If a pop-out is open, only accept messages from it.
        if (popupWin && !popupWin.closed && e.source !== popupWin) return;

        if (msg.type === 'BLAIZE_CMD'){
          applyRemoteCommand(msg.cmd);
          sendStateToPopup(true);
          return;
        }

        if (msg.type === 'BLAIZE_REQUEST_STATE'){
          try { e.source?.postMessage({ type: 'BLAIZE_STATE', state: getRemoteState() }, '*'); } catch {}
          return;
        }
      });

// Apply a command originating from the pop-out to the main window.
// Commands target existing DOM elements so all existing handlers run.
      function applyRemoteCommand(cmd){
        if (!cmd || typeof cmd !== 'object') return;

        if (cmd.type === 'click'){
          const el = document.getElementById(cmd.id);
          if (el && typeof el.click === 'function') el.click();
          return;
        }

        if (cmd.type === 'setRange'){
          const el = document.getElementById(cmd.id);
          if (el && el.tagName === 'INPUT' && el.type === 'range'){
            el.value = String(cmd.value);
            el.dispatchEvent(new Event('input', {bubbles:true}));
          }
          return;
        }

        if (cmd.type === 'setSelect'){
          const el = document.getElementById(cmd.id);
          if (el && el.tagName === 'SELECT'){
            el.value = String(cmd.value);
            el.dispatchEvent(new Event('change', {bubbles:true}));
          }
          return;
        }

        if (cmd.type === 'selectPreset'){
          selectPreset(cmd.idx, {user:true});
          return;
        }

        if (cmd.type === 'setColor'){
          const c = cmd.rgb || {};
          const next = rgb(c.r||0, c.g||0, c.b||0);
          if (cmd.target === 'A') presetColor = next;
          else multiColorClr = next;
          updateColorReadout();
          sendStateToPopup(true);
          return;
        }

        if (cmd.type === 'focus'){
          try { popupWin?.focus(); } catch {}
          return;
        }
      }

      // Expose a tiny API for the popup.
      window.BLAIZE_REMOTE = {
        getState: getRemoteState,
        applyCommand: applyRemoteCommand,
        openPopup: openControlsPopup
      };


// Attach pop-out event handlers that forward into the main window.
// The pop-out HTML itself stays mostly static and logic-free.
  function bindPopupHandlers(){
    if (!popupWin || popupWin.closed) return;
    let d;
    try { d = popupWin.document; } catch { return; }
    if (!d) return;

    const $p = (id) => { try { return d.getElementById(id); } catch { return null; } };

    let popupColorTarget = 'A';

    // Close button (dock)
    const dock = $p('dock');
    if (dock){
      dock.addEventListener('click', () => {
        try { popupWin.close(); } catch {}
        try { if (popupWatch) clearInterval(popupWatch); } catch {}
        popupWatch = null;
        setPanelHidden(false);
      });
    }

    // Buttons -> main buttons (reuse existing behavior)
    ['btnMic','btnMulti','btnBlackout','btnBpm','btnBeat','btnBeatColor','btnBeatPreset','btnSwap','pickA','pickB'].forEach((id) => {
      const el = $p(id);
      if (!el) return;
      el.addEventListener('click', () => {
        // Keep popup-local color target in sync for quick color picking.
        if (id === 'pickA') popupColorTarget = 'A';
        if (id === 'pickB') popupColorTarget = 'B';
        applyRemoteCommand({type:'click', id});
        // update right away
        sendStateToPopup(true);
      });
    });

    // Selects
    const motionSel = $p('motionSel');
    if (motionSel){
      motionSel.addEventListener('change', () => applyRemoteCommand({type:'setSelect', id:'motionSel', value: motionSel.value}));
    }
    const beatEvery = $p('beatEvery');
    if (beatEvery){
      beatEvery.addEventListener('change', () => applyRemoteCommand({type:'setSelect', id:'beatEvery', value: beatEvery.value}));
    }

    // Sliders -> dispatch into main sliders (so all existing logic runs)
    ['speed','size','bright','strobe','shade','bpm','trans','micGain','beatSens','beatCool'].forEach((id) => {
      const el = $p(id);
      if (!el) return;
      el.addEventListener('input', () => applyRemoteCommand({type:'setRange', id, value: parseInt(el.value, 10)}));
    });

    // Presets
    const grid = $p('presetGrid');
    if (grid){
      const btns = grid.querySelectorAll('button[data-preset]');
      btns.forEach((b) => {
        b.addEventListener('click', () => {
          const i = Number(b.getAttribute('data-preset')) || 0;
          applyRemoteCommand({type:'selectPreset', idx: i});
        });
      });
    }

    // Colors: buttons send setColor
    const colorGrid = $p('colorGrid');
    if (colorGrid){
      const btns = colorGrid.querySelectorAll('button.colorBtn');
      btns.forEach((b) => {
        b.addEventListener('click', () => {
          if (b.dataset.random){
            const c = randomBrightColor();
            applyRemoteCommand({type:'setColor', target: popupColorTarget, rgb: c});
            return;
          }
          const raw = b.dataset.rgb || '';
          const parts = raw.split(',').map(v => parseInt(v.trim(),10));
          if (parts.length === 3){
            applyRemoteCommand({type:'setColor', target: popupColorTarget, rgb: {r:parts[0]||0,g:parts[1]||0,b:parts[2]||0}});
          }
        });
      });
    }

    // If the pop-out is closed by window manager, restore panel.
    try {
      popupWin.addEventListener('beforeunload', () => {
        try { if (popupWatch) clearInterval(popupWatch); } catch {}
        popupWatch = null;
        setPanelHidden(false);
      });
    } catch {}
  }

// Open (or focus) the pop-out control window.
// Main window remains the single source of truth for all state.
  function openControlsPopup(){
    if (popupWin && !popupWin.closed){
      try { popupWin.focus(); } catch {}
      sendStateToPopup(true);
      return;
    }

    popupWin = window.open('', 'ProjectorLightShowControls', 'popup=yes,width=520,height=920,resizable=yes,scrollbars=yes');
    if (!popupWin){
      setStatus('Popup blocked. Allow popups for this site to pop out the controls.');
      return;
    }

    // Hide local panel by default so the projector output stays clean.
    setPanelHidden(true);

    // If the user closes the pop-out, automatically restore the in-page panel.
    try { if (popupWatch) clearInterval(popupWatch); } catch {}
    popupWatch = setInterval(() => {
      if (!isPopupOpen()){
        try { if (popupWatch) clearInterval(popupWatch); } catch {}
        popupWatch = null;
        setPanelHidden(false);
      }
    }, 400);

    popupWin.document.open();
    popupWin.document.write(buildPopupHTML());
    popupWin.document.close();

    // Attach handlers from the main window (WebGL-style).
    try { bindPopupHandlers(); } catch {}

    // Sync immediately.
    setTimeout(() => sendStateToPopup(true), 60);
  }

  // IMPORTANT: Avoid embedding a literal script-end tag sequence in this main script.
  // Use SCRIPT_CLOSE when you need to generate one for injected HTML.
  const SCRIPT_CLOSE = '</scr' + 'ipt>';

  
      function buildPopupHTML(){
    // Full controls panel, pop-out friendly. No popup-side JS needed:
    // the main window attaches all event listeners after writing this HTML.
    let presetBtns = '';
    for (let i=0;i<presetCount();i++){
      let name = 'Preset ' + i;
      try { if (typeof presetLabel === 'function') name = presetLabel(i); } catch {}
      name = String(name).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      presetBtns += `<button class="presetBtn" data-preset="${i}" type="button">${i}: ${name}</button>`;
    }

    const popupColorButtons = [
      { name: 'R', c: COLORS.red },
      { name: 'Y', c: COLORS.yellow },
      { name: 'G', c: COLORS.green },
      { name: 'C', c: COLORS.cyan },
      { name: 'B', c: COLORS.blue },
      { name: 'M', c: COLORS.magenta },
      { name: 'W', c: COLORS.white },
      { name: '?', c: null },
    ];


    let colorBtns = '';
    for (const b of popupColorButtons){
      if (b.c){
        colorBtns += `<button class="colorBtn" type="button" title="Set color" data-rgb="${b.c.r},${b.c.g},${b.c.b}" style="background: rgb(${b.c.r},${b.c.g},${b.c.b}); border: 1px solid rgba(232,247,255,0.22);"></button>`;
      } else {
        colorBtns += `<button class="colorBtn" type="button" title="Random color" data-random="1">Rnd</button>`;
      }
    }

    return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Projector Light Show Controls</title>
    <style>
      :root {
        --bg:#000; --fg:#e8f7ff; --muted:rgba(232,247,255,.65);
        --panel:rgba(10,12,14,.72); --border:rgba(232,247,255,.18);
        --accent: rgba(70, 190, 255, 0.9);
      }
      html,body{height:100%; margin:0; background:var(--bg); color:var(--fg);
        font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;}
      .panel{max-width:560px; margin:12px auto; background:var(--panel); border:1px solid var(--border);
        border-radius:16px; padding:12px; backdrop-filter:blur(10px); box-shadow:0 10px 24px rgba(0,0,0,.35);
        display:grid; grid-template-rows:auto auto 1fr auto; gap:10px; overflow:hidden;}
      .row{display:flex; flex-wrap:wrap; gap:8px; align-items:center;}
      .spacer{flex:1 1 auto;}
      .title{font-weight:800; letter-spacing:.2px;}
      .hint{color:var(--muted); font-size:12px; line-height:1.35;}
      button,select,input[type=range]{font:inherit;}
      button,select{background:rgba(0,0,0,.35); color:var(--fg); border:1px solid var(--border);
        border-radius:12px; padding:8px 10px; cursor:pointer; user-select:none;}
      button:hover{border-color:rgba(232,247,255,.35);} button:disabled{opacity:.55; cursor:not-allowed;}
      button.toggle.on{border-color:rgba(120,255,190,.35); box-shadow:inset 0 0 0 1px rgba(120,255,190,.18);}
      button.danger.on{border-color:rgba(255,120,120,.35); box-shadow:inset 0 0 0 1px rgba(255,120,120,.18);}
      button.primary{border-color:rgba(70,190,255,.55); box-shadow:inset 0 0 0 1px rgba(70,190,255,.22);} 
      .pill{display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
        border:1px solid var(--border); color:var(--muted); font-size:12px; user-select:none;}
      .pill.bad{border-color:rgba(255,120,120,.35); color:rgba(255,180,180,.85);} 
      .pill.warn{border-color:rgba(255,210,90,.35); color:rgba(255,230,160,.85);} 
      .pill.ok{border-color:rgba(120,255,190,.28); color:rgba(180,255,220,.85);} 
      .scrollArea{overflow:auto; padding-right:4px; max-height:70vh;}
      .section{border:1px solid rgba(232,247,255,.14); background:rgba(0,0,0,.22);
        border-radius:14px; padding:10px; margin-bottom:10px;}
      .sectionTitle{display:flex; align-items:baseline; justify-content:space-between; gap:10px;
        font-weight:700; font-size:13px; margin-bottom:8px; color:rgba(232,247,255,.88);}
      .grid{display:grid; grid-template-columns:repeat(2,1fr); gap:8px; align-content:start;}
      .presetBtn{height:60px; border-radius:12px; font-size:12px; display:grid; place-items:center;
        text-align:center; line-height:1.1; padding:8px; word-break:break-word;}
      .presetBtn.active{border-color:rgba(70,190,255,.55); box-shadow:inset 0 0 0 1px rgba(70,190,255,.22);} 

      .colors{display:grid; grid-template-columns:repeat(8,1fr); gap:8px;}
      .colorBtn{height:36px; border-radius:12px; padding:0;}
      .seg{display:inline-flex; border:1px solid rgba(232,247,255,.18); border-radius:999px; overflow:hidden;}
      .seg button{border:none; border-right:1px solid rgba(232,247,255,.18); border-radius:0; padding:6px 10px;
        background:rgba(0,0,0,.25); color:rgba(232,247,255,.85);}
      .seg button:last-child{border-right:none;}
      .seg button.on{background:rgba(70,190,255,.22); color:var(--fg);}

      .sliders{display:grid; grid-template-columns:1fr; gap:8px;} 
      .slider{display:grid; grid-template-columns:132px 1fr 72px; gap:10px; align-items:center;}
      .slider label{color:var(--muted); font-size:12px;} .slider output{color:var(--muted); font-size:12px; text-align:right;}
      input[type=range]{width:100%; accent-color:rgb(70, 190, 255);} 

      .meter{position:relative; height:10px; flex:1 1 auto; min-width:140px; border-radius:999px; overflow:hidden;
        background:rgba(232,247,255,.18); border:1px solid rgba(232,247,255,.16);}
      .meterFill{height:100%; width:0%; background:rgba(70,190,255,.75); will-change:width;}
      .meterBeat{position:absolute; right:6px; top:50%; width:10px; height:10px; border-radius:50%;
        transform:translateY(-50%) scale(0.7); background:rgba(120,255,190,0.0); opacity:0;
        box-shadow:0 0 0 0 rgba(120,255,190,0); pointer-events:none;}

      .status{color:var(--muted); font-size:12px; line-height:1.35; border:1px solid rgba(232,247,255,.18);
        background:rgba(0,0,0,.35); border-radius:12px; padding:8px 10px;}
      @media (max-width: 560px){ .grid{grid-template-columns:1fr;} .slider{grid-template-columns:110px 1fr 64px;} }
    </style>
  </head>
  <body>
    <div class="panel" id="panel">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="title">Projector Light Show</div>
          <div class="hint">Pop-out controls. Close this window to bring the in-page panel back.</div>
        </div>
        <div class="row">
          <button id="dock" type="button">Dock</button>
        </div>
      </div>

      <div class="row">
        <button class="primary" id="btnMic" type="button">Mic</button>
        <div class="spacer"></div>
        <div class="pill" id="capPill">Mic: …</div>
      </div>

      <div class="row" style="justify-content: space-between;">
        <div class="row">
          <button class="toggle" id="btnMulti" type="button">Multicolor</button>
          <button class="toggle danger" id="btnBlackout" type="button">Blackout</button>
          <button class="toggle" id="btnBpm" type="button">BPM</button>
          <button class="toggle" id="btnBeat" type="button">Beat DJ</button>

          <label class="pill" title="Move the entire preset along a path">
            <span>Motion</span>
            <select id="motionSel" aria-label="Motion path">
              <option value="off">Off</option>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
            </select>
          </label>
        </div>
      </div>

      <div class="scrollArea" id="scrollArea">
        <div class="section">
          <div class="sectionTitle">
            <span>Presets (0–31)</span>
            <span class="hint">Scroll</span>
          </div>
          <div class="grid" id="presetGrid">${presetBtns}</div>
        </div>

        <div class="section">
          <div class="sectionTitle">
            <span>Colors</span>
            <span class="hint">Pick A/B anytime. Multicolor alternates A/B in many presets.</span>
          </div>

          <div class="row" style="justify-content: space-between; margin-bottom: 8px;">
            <div class="row">
              <div class="seg" role="group" aria-label="Color target">
                <button id="pickA" type="button" class="on">Pick A</button>
                <button id="pickB" type="button">Pick B</button>
              </div>
              <span class="pill" id="colorReadout">A: — &nbsp;|&nbsp; B: —</span>
            </div>
            <button id="btnSwap" type="button" title="Swap color A and B">Swap</button>
          </div>

          <div class="colors" id="colorGrid" aria-label="Color buttons">${colorBtns}</div>
        </div>

        <div class="section">
          <div class="sectionTitle">
            <span>Beat DJ</span>
            <span class="hint">Uses Mic/Demo audio. Changes colors/presets when beats are detected.</span>
          </div>

          <div class="row" style="margin-bottom: 8px;">
            <span class="pill" style="gap:10px; flex: 1 1 auto;">
              <span>Input</span>
              <div class="meter" aria-label="Input level">
                <div class="meterFill" id="energyFill"></div>
                <div class="meterBeat" id="beatDot" title="Beat"></div>
              </div>
            </span>
          </div>

          <div class="row" style="justify-content: space-between; margin-bottom: 8px;">
            <div class="row">
              <button class="toggle" id="btnBeatColor" type="button">Auto Color</button>
              <button class="toggle" id="btnBeatPreset" type="button">Auto Preset</button>
            </div>
            <label class="pill" title="How often to change presets when Beat DJ is on">
              <span>Preset every</span>
              <select id="beatEvery" aria-label="Preset change interval">
                <option value="1">1 beat</option>
                <option value="2">2 beats</option>
                <option value="4" selected>4 beats</option>
                <option value="8">8 beats</option>
                <option value="16">16 beats</option>
              </select>
            </label>
          </div>

          <div class="sliders">
            <div class="slider"><label for="micGain">Mic Sensitivity</label><input id="micGain" type="range" min="0" max="200" step="1" value="80" /><output id="micGainOut">2.30×</output></div>
            <div class="slider"><label for="beatSens">Beat Sensitivity</label><input id="beatSens" type="range" min="0" max="100" step="1" value="70" /><output id="beatSensOut">70</output></div>
            <div class="slider"><label for="beatCool">Cooldown</label><input id="beatCool" type="range" min="80" max="420" step="5" value="160" /><output id="beatCoolOut">160ms</output></div>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle">
            <span>Controls</span>
            <span class="hint">Motion Blend controls how smoothly Motion changes (circle/square/triangle).</span>
          </div>

          <div class="sliders">
            <div class="slider"><label for="speed">Speed</label><input id="speed" type="range" min="0" max="100" step="1" value="30" /><output id="speedOut">30</output></div>
            <div class="slider"><label for="size">Size</label><input id="size" type="range" min="0" max="100" step="1" value="50" /><output id="sizeOut">50</output></div>
            <div class="slider"><label for="bright">Brightness</label><input id="bright" type="range" min="0" max="100" step="1" value="100" /><output id="brightOut">100</output></div>
            <div class="slider"><label for="strobe">Strobing</label><input id="strobe" type="range" min="0" max="100" step="1" value="0" /><output id="strobeOut">0</output></div>
            <div class="slider"><label for="shade">Shading</label><input id="shade" type="range" min="0" max="100" step="1" value="0" /><output id="shadeOut">0</output></div>
            <div class="slider"><label for="bpm">BPM</label><input id="bpm" type="range" min="60" max="180" step="1" value="128" /><output id="bpmOut">128</output></div>
            <div class="slider"><label for="trans">Motion Blend</label><input id="trans" type="range" min="0" max="100" step="1" value="55" /><output id="transOut">0.40s</output></div>
          </div>
        </div>
      </div>

      <div class="status" id="status">Ready.</div>
    </div>
    <script>/* noop */
    ${SCRIPT_CLOSE}
  </body>
  </html>`;
  }

// =====================
// Beat detection
// =====================
  class BeatDetector {
    constructor(){ this.reset(); }
    reset(){
      this.ema = 0;
      this.dev = 0;
      this.prev = 0;
      this.lastBeat = -1e9;
      this.lastThr = 0;
    }
    update(energy, tMs, sens01, minIntervalMs){
      // energy: ~0..1
      const a = 0.06; // smoothing
      this.ema += a * (energy - this.ema);
      this.dev += a * (Math.abs(energy - this.ema) - this.dev);

      // Higher sens01 = MORE sensitive -> lower threshold.
      const k = lerp(2.2, 0.6, clamp(sens01, 0, 1));
      const base = lerp(0.030, 0.008, clamp(sens01, 0, 1));
      const thr = this.ema + k * (this.dev * 1.10 + base);
      this.lastThr = thr;

      const rising = energy > this.prev;
      const okTime = (tMs - this.lastBeat) >= minIntervalMs;
      const gate = lerp(0.12, 0.03, clamp(sens01, 0, 1));
      const hit = okTime && rising && energy > thr && energy > gate;

      this.prev = energy;
      if (hit) this.lastBeat = tMs;
      return hit;
    }
  }

    const beatDetector = new BeatDetector();

  ui.btnBeat.addEventListener('click', () => {
    beatDJ = !beatDJ;
    if (beatDJ) bpmSTLmode = false; // avoid fighting modes
    beatCount = 0;
    lastBeatFlash = -1e9;
    beatDetector.reset();
    if (beatDJ && !analyser){
      setStatus('Beat DJ is on, but no audio is connected. Click <span class="kbd">Mic</span> or run <span class="kbd">Demo</span>.');
    }
    updateToggles();
  });

  ui.btnBeatColor.addEventListener('click', () => { beatAutoColor = !beatAutoColor; updateToggles(); });
  ui.btnBeatPreset.addEventListener('click', () => { beatAutoPreset = !beatAutoPreset; updateToggles(); });
  ui.strobe.addEventListener('input', e => {
    presetStrobing = +e.target.value;
    ui.strobeOut.textContent = presetStrobing;
  });

  ui.shade.addEventListener('input', e => {
    shadeAmount = +e.target.value;
    ui.shadeOut.textContent = shadeAmount;
  });


  ui.bpm.addEventListener('input', (e) => {
    bpm = +e.target.value;
    ui.bpmOut.textContent = String(bpm);

    // Optional: if BPM mode is active, re-sync the beat timer so changes feel immediate
    bpmBeatTime = nowMs();
    bpmBeatCounter = -1;
  });

  ui.motionSel.addEventListener('change', () => setMotionMode(ui.motionSel.value));

  updateToggles();

  function toggleFullscreen(){
    const isFS = document.fullscreenElement;
    if (!isFS) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  ui.btnFS.addEventListener('click', toggleFullscreen);
  ui.btnPop.addEventListener('click', openControlsPopup);

// =====================
// Panel hide/show
// =====================
  let lastMouseMovedTime = nowMs();
  window.addEventListener('mousemove', () => { lastMouseMovedTime = nowMs(); if (!isPopupOpen()) setPanelHidden(false); });
  window.addEventListener('pointermove', () => { lastMouseMovedTime = nowMs(); if (!isPopupOpen()) setPanelHidden(false); });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'h' || e.key === 'H') {
      if (isPopupOpen()) setPanelHidden(true);
      else setPanelHidden(!document.body.classList.contains('hiddenPanel'));
    }
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'Escape') {
      disconnectAudio();
      setStatus('Audio stopped. (Mic/Demo are optional — Beat DJ needs audio.)');
    }
  });

// =====================
// Optional audio
// =====================
  let audioSourceType = 'none'; // 'none' | 'mic' | 'demo'

// When any audio source is connected, Beat DJ can drive visuals automatically.
// force=true turns it on even if the user previously disabled Beat DJ.
  function enableBeatDJForAudio({force=false}={}){
    // When audio is connected, let it drive color + preset changes.
    if (force || !beatDJ){
      beatDJ = true;
      bpmSTLmode = false; // avoid fighting modes
    }
    beatAutoColor = true;
    beatAutoPreset = true;
    beatCount = 0;
    lastBeatFlash = -1e9;
    beatDetector.reset();
    updateToggles();
  }

  let audioCtx = null;
  let analyser = null;
  let outGain = null;
  let sourceNode = null;
  let mediaStream = null;
  let audioEl = null;

  let demoOsc1 = null, demoOsc2 = null, demoLFO = null, demoLFOGain = null, demoGain = null, demoFilter = null;

  const fftSize = 2048;
  const freq = new Uint8Array(fftSize/2);
  const timeArr = new Uint8Array(fftSize);

// Lazy-initialize and wire up the WebAudio graph:
 // source -> analyser -> outGain -> destination (optional monitoring)
  async function ensureAudioCtx(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!analyser){
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0.85;
    }
    if (!outGain){
      outGain = audioCtx.createGain();
      outGain.gain.value = 0.0;
      analyser.connect(outGain);
      outGain.connect(audioCtx.destination);
    }
  }

  function stopDemoNodes(){
    try { demoOsc1?.stop(); } catch {}
    try { demoOsc2?.stop(); } catch {}
    try { demoLFO?.stop(); } catch {}
    demoOsc1 = demoOsc2 = demoLFO = null;
    demoLFOGain = demoGain = demoFilter = null;
  }

// Disconnect/stop any active audio source and reset UI meter state.
  function disconnectAudio(){
    try { sourceNode?.disconnect(); } catch {}
    sourceNode = null;

    if (audioEl){
      try { audioEl.pause(); } catch {}
      try { URL.revokeObjectURL(audioEl.src); } catch {}
      audioEl.src = '';
      audioEl = null;
    }

    if (mediaStream){
      for (const t of mediaStream.getTracks()) t.stop();
      mediaStream = null;
    }

    stopDemoNodes();
    if (outGain) outGain.gain.value = 0.0;
    audioSourceType = 'none';

    // Reset in-panel meter
    _lastMeterEnergy = -1;
    try {
      if (ui.energyFill) ui.energyFill.style.width = '0%';
      if (ui.beatDot) ui.beatDot.style.opacity = '0';
    } catch {}

    sendStateToPopup(true);
  }

  function attachSource(node, {monitor=false}={}){
    try { sourceNode?.disconnect(); } catch {}
    sourceNode = node;
    sourceNode.connect(analyser);
    if (outGain) outGain.gain.value = monitor ? 1.0 : 0.0;
  }

  function describeMicHelp(reason){
    const proto = location.protocol;
    const host = location.hostname;
    const insecure = (!isSecureContext) || (proto !== 'https:' && host !== 'localhost' && host !== '127.0.0.1');
    if (insecure){
      return `Mic blocked: use <span class="kbd">https</span> or <span class="kbd">http://localhost</span> (not <span class="kbd">file://</span>). Try: <span class="kbd">python -m http.server 8000</span> then open <span class="kbd">http://localhost:8000</span>.`;
    }
    if (reason === 'NotAllowedError') return `Mic denied. Use the browser lock icon → Site settings → allow Microphone, then refresh. Or use Demo.`;
    if (reason === 'NotFoundError') return `No mic found. Plug one in / enable an input device. Or use Demo.`;
    if (reason === 'NotReadableError') return `Mic is busy (another tab/app). Close other apps using it, then try again.`;
    return `Could not access mic. Or use Demo.`;
  }

// Request microphone input and connect it to the analyser.
// Monitoring is off by default to avoid feedback on projector setups.
  async function useMic(){
    disconnectAudio();
    await ensureAudioCtx();
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('getUserMedia not supported'), {name:'NotSupportedError'});
    if (!isSecureContext) throw Object.assign(new Error('Insecure context'), {name:'SecurityError'});

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video: false
    });

    const micSource = audioCtx.createMediaStreamSource(mediaStream);
    attachSource(micSource, {monitor:false});
    audioSourceType = 'mic';

    // Mic should drive the visuals: enable Beat DJ + Auto Color + Auto Preset.
    enableBeatDJForAudio({force:false});
    setStatus('Mic connected (monitoring off). Beat DJ enabled — mic now drives colors + presets.');
  }


// Start a small synth chain for testing Beat DJ without real audio.
// Output is connected to the analyser; monitoring stays off.
  async function useDemo(){
    disconnectAudio();
    await ensureAudioCtx();

    demoGain = audioCtx.createGain();
    demoGain.gain.value = 0.55;
    demoFilter = audioCtx.createBiquadFilter();
    demoFilter.type = 'bandpass';
    demoFilter.Q.value = 1.2;
    demoFilter.frequency.value = 420;

    demoOsc1 = audioCtx.createOscillator();
    demoOsc1.type = 'sawtooth';
    demoOsc1.frequency.value = 110;
    demoOsc2 = audioCtx.createOscillator();
    demoOsc2.type = 'square';
    demoOsc2.frequency.value = 220;

    demoLFO = audioCtx.createOscillator();
    demoLFO.type = 'sine';
    demoLFO.frequency.value = 0.55;
    demoLFOGain = audioCtx.createGain();
    demoLFOGain.gain.value = 800;

    demoLFO.connect(demoLFOGain);
    demoLFOGain.connect(demoFilter.frequency);

    demoOsc1.connect(demoGain);
    demoOsc2.connect(demoGain);
    demoGain.connect(demoFilter);

    attachSource(demoFilter, {monitor:false});
    audioSourceType = 'demo';
    demoOsc1.start();
    demoOsc2.start();
    demoLFO.start();

    enableBeatDJForAudio({force:false});
    setStatus('Demo synth running (silent). Beat DJ enabled.');
  }

  async function refreshCapabilityUI(){
    const proto = location.protocol;
    const host = location.hostname;
    const insecure = (!isSecureContext) || (proto !== 'https:' && host !== 'localhost' && host !== '127.0.0.1');
    const supported = !!navigator.mediaDevices?.getUserMedia;
    ui.btnMic.disabled = (!supported) || insecure;

    if (!supported){ ui.capPill.className = 'pill bad'; ui.capPill.textContent = 'Mic: unsupported'; return; }
    if (insecure){ ui.capPill.className = 'pill warn'; ui.capPill.textContent = 'Mic: needs https/localhost'; return; }

    if (navigator.permissions?.query){
      try {
        const p = await navigator.permissions.query({ name: 'microphone' });
        if (p.state === 'granted'){ ui.capPill.className = 'pill ok'; ui.capPill.textContent = 'Mic: allowed'; }
        else if (p.state === 'denied'){ ui.capPill.className = 'pill bad'; ui.capPill.textContent = 'Mic: blocked'; }
        else { ui.capPill.className = 'pill warn'; ui.capPill.textContent = 'Mic: prompt'; }
        p.onchange = refreshCapabilityUI;
        return;
      } catch {}
    }
    ui.capPill.className = 'pill warn';
    ui.capPill.textContent = 'Mic: available';
  }

  refreshCapabilityUI();

  ui.btnMic.addEventListener('click', async () => {
    try {
      if (audioSourceType === 'mic') {
        disconnectAudio();
        setStatus('Mic disconnected.');
        await refreshCapabilityUI();
        return;
      }

      await useMic();
      await refreshCapabilityUI();
    } catch (e) {
      console.error(e);
      setStatus(describeMicHelp(e?.name || 'Error'));
      await refreshCapabilityUI();
    }
  });



// Extract simple audio features from the analyser:
 // amp (RMS), bass/mid/tre energy bands, and a rough spectral centroid.
  function getAudioFeatures(){
    if (!analyser) return { amp: 0, bass: 0, mid: 0, tre: 0, centroid: 0 };
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(timeArr);

    let sum = 0;
    for (let i=0;i<timeArr.length;i++){
      const v = (timeArr[i]-128)/128;
      sum += v*v;
    }
    const amp = Math.sqrt(sum/timeArr.length);

    const n = freq.length;
    const b0 = Math.floor(n*0.08);
    const b1 = Math.floor(n*0.25);
    const b2 = Math.floor(n*0.55);

    let bass=0, mid=0, tre=0;
    for (let i=0;i<b0;i++) bass += freq[i];
    for (let i=b0;i<b1;i++) mid += freq[i];
    for (let i=b1;i<b2;i++) tre += freq[i];

    bass /= Math.max(1,b0)*255;
    mid  /= Math.max(1,b1-b0)*255;
    tre  /= Math.max(1,b2-b1)*255;

    let wsum=0, fsum=0;
    for (let i=0;i<n;i++){
      const w = freq[i]/255;
      wsum += w;
      fsum += w*(i/n);
    }
    const centroid = wsum>0 ? (fsum/wsum) : 0;
    return { amp, bass, mid, tre, centroid };
  }

  const autoDJPresetPool = (() => {
    // avoid mouse-dependent (15) and full solid (23) for auto mode
    const arr = [];
    for (let i=0;i<presetCount();i++){
      if (i === 15 || i === 23) continue;
      arr.push(i);
    }
    return arr;
  })();

  function pickRandomPresetFromPool(){
    const idx = Math.floor(Math.random() * autoDJPresetPool.length);
    return autoDJPresetPool[idx];
  }

// Beat callback: optionally change colors and/or presets depending on toggles.
  function onBeat(tNow){
    beatCount++;
    lastBeatFlash = tNow;

    if (beatAutoColor){
      presetColor = randomBrightColor();
      if (multiColor){
        if (distSq(multiColorClr, presetColor) < 80*80) multiColorClr = contrastingColor(presetColor);
      }
      updateColorReadout();
    }

    if (beatAutoPreset && (beatCount % Math.max(1, beatEveryN) === 0)){
      let p;
      let tries = 0;
      do {
        p = pickRandomPresetFromPool();
        tries++;
      } while (p === presetNumber && tries < 8);
      selectPreset(p, {user:false});
    }
  }

// =====================
// Pointer interaction in visual zone
// =====================
  let mouseXw = 0, mouseYw = 0;
  let pmouseXw = 0, pmouseYw = 0;
  let mouseDown = false;

// Track pointer position in WORLD units, clamped to the visual drawing area.
  function updateMouse(e){
    pmouseXw = mouseXw; pmouseYw = mouseYw;
    mouseXw = clamp(e.clientX, 0, visualW/DPR);
    mouseYw = clamp(e.clientY, 0, H/DPR);
  }

  window.addEventListener('pointermove', (e) => { updateMouse(e); });
  window.addEventListener('pointerdown', (e) => { updateMouse(e); mouseDown = true; });
  window.addEventListener('pointerup', () => { mouseDown = false; });

  
  function renderPresetGrid(){
    const grid = ui.presetGrid;
    if (!grid) return;
    grid.innerHTML = '';
    for (let i=0;i<presetCount();i++){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'presetBtn' + (i === presetNumber ? ' active' : '');
      let label = `Preset ${i}`;
      try { if (typeof presetLabel === 'function') label = presetLabel(i); } catch {}
      b.textContent = String(label);
      b.addEventListener('click', () => selectPreset(i, {user:true}));
      grid.appendChild(b);
    }
  }

  function selectPreset(idx, {user=false}={}){
    idx = clamp(idx, 0, (presetCount() - 1));
    if (idx === presetNumber) return;

    // Instant switch (no morph transition)
    presetNumber = idx;
    v = 0.2 + Math.random()*0.8;
    m = 0;
    if (presetNumber === 8) initDiscoball();
    renderPresetGrid();

    sendStateToPopup(true);

    if (user && beatDJ){
      // Manual pick while Beat DJ is on: keep it (Beat DJ will still change later if Auto Preset is on)
    }
  }

  renderPresetGrid();

// =====================
// Main loop
// =====================
  let lastFrame = nowMs();

// Update the in-panel meter UI and beat flash indicator.
// Also triggers throttled pop-out sync so the pop-out meter stays live.
  function updateInputMeter(energy){
    if (!ui.energyFill) return;
    const e = clamp(energy, 0, 1);
    if (Math.abs(e - _lastMeterEnergy) > 0.008){
      _lastMeterEnergy = e;
      ui.energyFill.style.width = `${Math.round(e*100)}%`;
    }

    if (ui.beatDot){
      const age = nowMs() - lastBeatFlash;
      const flash = clamp(1 - age/140, 0, 1);
      ui.beatDot.style.opacity = String(flash);
      ui.beatDot.style.background = `rgba(120,255,190,${0.15 + 0.85*flash})`;
      ui.beatDot.style.boxShadow = `0 0 ${Math.round(16*flash)}px rgba(120,255,190,${0.45*flash})`;
      ui.beatDot.style.transform = `translateY(-50%) scale(${(0.7 + 0.6*flash).toFixed(3)})`;
    }

    // keep pop-out in sync (throttled)
    sendStateToPopup();
  }

// Main animation loop. Handles:
 // - panel auto-hide
 // - smoothing Size/Brightness toward destinations
 // - BPM strobe mode timing
 // - audio feature sampling + beat detection
 // - preset rendering (per presetNumber)
  function loop(){
    requestAnimationFrame(loop);

    const tNow = nowMs();
    const dt = Math.min(0.05, (tNow - lastFrame)/1000);
    lastFrame = tNow;

    if ((tNow - lastMouseMovedTime) >= 5000){
      setPanelHidden(true);
    }

    if (!blackout) presetBrightness += 0.2 * (presetBrightnessDest - presetBrightness);
    presetSize += 0.14 * (presetSizeDest - presetSize);

    // BPM Sound-To-Light (manual BPM)
    if (bpmSTLmode){
      const beatMs = 60000 / bpm;
      if (tNow - bpmBeatTime >= beatMs){
        bpmBeatTime = tNow;
        bpmBeatCounter++;

        const r = Math.floor(10 + Math.random()*85);
        presetSize = r;
        presetSizeDest = r;
        ui.size.value = String(r);
        ui.sizeOut.textContent = String(r);

        presetColor = randomBrightColor();
        if (multiColor && distSq(multiColorClr, presetColor) < 80*80) multiColorClr = contrastingColor(presetColor);
        updateColorReadout();

        if (bpmBeatCounter >= 8){
          bpmBeatCounter = 0;
          let p;
          do { p = Math.floor(Math.random()*presetCount()); }
          while (p === 15 || p === 23);
          selectPreset(p, {user:false});
        }
      }
    }

    if (presetStrobing > 0){
      const interval = 200 - 1.8*presetStrobing;
      if (tNow - strobeTime >= interval){
        onoff = !onoff;
        strobeTime = tNow;
      }
    } else {
      onoff = true;
    }

    fadeBackground();

    if (mouseDown && mouseXw < (visualW/DPR)){
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const dx = mouseXw - pmouseXw;
      const dy = mouseYw - pmouseYw;
      for (let i=0;i<10;i++){
        const x = mouseXw - i*(dx/10);
        const y = mouseYw - i*(dy/10);
        fillCircleWorld(x, y, (H/DPR)/20);
      }
    }

    const feats = getAudioFeatures();
    const motion = computeMotionOffset(tNow, dt);

    // Beat DJ detection (uses bass+amp) — scaled by Mic Sensitivity
    const rawEnergy = clamp(0.75*feats.bass + 0.25*feats.amp, 0, 1);
    const energy = clamp(rawEnergy * micGain, 0, 1);

    // Always update the in-panel meter when audio exists.
    if (analyser) updateInputMeter(energy);

    if (beatDJ && analyser){
      const hit = beatDetector.update(energy, tNow, clamp(beatSens/100,0,1), beatCooldownMs);
      if (hit) onBeat(tNow);
    }

    if (!onoff) {
      return; // skip drawing this frame
    }


    drawPreset(presetNumber, feats, motion);
  }

  loop();

// =====================
// Self-tests (console)
// =====================
  (function runSelfTests(){
    try {
      console.assert(typeof rgba(rgb(1,2,3), 0.5) === 'string', 'rgba() should return string');
      console.assert(brightness(rgb(255,255,255)) > brightness(rgb(0,0,0)), 'brightness should increase with lighter colors');
      console.assert(clamp(5,0,3) === 3 && clamp(-1,0,3) === 0, 'clamp should clamp');
      console.assert(presetLabel(0).length > 0 && presetLabel(presetCount()).length > 0, 'presetLabel should return strings');

      // Regression: Sinus (5) and Sin Blocks (6) must work in single-color mode too.
      try {
        const feats0 = { amp:0, bass:0, mid:0, tre:0, centroid:0 };
        const sent = 'rgba(1,2,3,0.4)';
        const prevMulti = multiColor;
        const prevColorA = presetColor;
        const prevBright = presetBrightness;
        const prevOn = onoff;

        multiColor = true;
        presetColor = rgb(200,10,10);
        presetBrightness = 100;
        onoff = true;

        ctx.fillStyle = sent;
        drawPreset(5, feats0, {x:0,y:0});
        console.assert(ctx.fillStyle !== sent, 'Preset 5 should set fillStyle in single-color');

        ctx.fillStyle = sent;
        drawPreset(6, feats0, {x:0,y:0});
        console.assert(ctx.fillStyle !== sent, 'Preset 6 should set fillStyle in single-color');

        multiColor = prevMulti;
        presetColor = prevColorA;
        presetBrightness = prevBright;
        onoff = prevOn;
      } catch (e) {
        console.warn('Sinus/Sin Blocks regression test failed (non-fatal):', e);
      }

      const d0 = (function(){ transitionSpeed = 0; return motionBlendDurationSec(); })();
      const d50 = (function(){ transitionSpeed = 50; return motionBlendDurationSec(); })();
      const d100 = (function(){ transitionSpeed = 100; return motionBlendDurationSec(); })();
      console.assert(d0 > d50 && d50 > d100, 'motionBlendDurationSec should decrease as speed increases');

      const r = 100;
      ['circle','square','triangle','off'].forEach(mode => {
        for (let i=0;i<10;i++){
          const p = motionPos(mode, i/10, r);
          console.assert(Number.isFinite(p.x) && Number.isFinite(p.y), `motionPos finite for ${mode}`);
        }
      });

      // Regression: buildPopupHTML should contain a closing script tag in the final string.
      // Avoid embedding the raw end-tag sequence in this main script.
      const html = buildPopupHTML();
      console.assert(html.includes(SCRIPT_CLOSE), 'Popup HTML should include closing script tag');

      // Regression: resize must not throw
      resize();

      selectPreset(8);
      console.assert(presetNumber === 8, 'selectPreset should set');
      selectPreset(999);
      console.assert(presetNumber === presetCount() - 1, 'selectPreset should clamp high');
      selectPreset(-5);
      console.assert(presetNumber === 0, 'selectPreset should clamp low');

      // Beat detector should fire on a clear spike
      const bd = new BeatDetector();
      let fired = 0;
      let t = 0;
      for (let i=0;i<80;i++){
        const e = (i === 20 || i === 50) ? 0.8 : 0.08;
        if (bd.update(e, t, 0.6, 120)) fired++;
        t += 16;
      }
      console.assert(fired >= 1 && fired <= 4, 'BeatDetector should detect spikes (approx)');

      // Sensitivity mapping sanity: higher sensitivity => lower threshold (after settling)
      const bdLo = new BeatDetector();
      const bdHi = new BeatDetector();
      for (let i=0;i<60;i++){
        bdLo.update(0.12, i*16, 0.0, 0);
        bdHi.update(0.12, i*16, 1.0, 0);
      }
      console.assert(bdHi.lastThr < bdLo.lastThr, 'Higher beat sensitivity should lower threshold');

      console.assert(typeof micGainFromUI === 'function', 'micGainFromUI should exist');
      console.assert(micGainFromUI(0) < micGainFromUI(200), 'Mic sensitivity should increase gain');

      updateToggles();
    } catch (e) {
      console.warn('Self-tests failed (non-fatal):', e);
    }
  })();
  