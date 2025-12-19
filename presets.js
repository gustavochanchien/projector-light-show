/**
 * presets.js
 * Preset names + preset drawing logic.
 *
 * Based on Blaize V3 by BodgedButWorks (https://github.com/bodgedbutworks/Blaize_V3)
 *
 * -----------------------------------------------------------------------------
 * High-level overview
 * -----------------------------------------------------------------------------
 * - `presetNames` is the UI list. The index in this array MUST match the `case`
 *   number inside `drawPreset(...)`.
 * - `drawPreset(idx, feats, motion)` renders one frame of a given preset.
 * - Many presets depend on shared/global state (e.g., `v`, `m`, `a`, `b_`, `c`,
 *   `d`, `ranX/ranY`, `timeRand`, etc.). That state is intentionally persistent
 *   across frames to create animation.
 * 
 * To add a new preset, you’re really doing two coordinated edits: **(1) register the name**, and **(2) implement the drawing logic**. The key rule is that the **index in `presetNames` must match the `case` number in `drawPreset(idx, ...)`**, because the UI selection is passed into the switch.

* **Step 1: Add a name to `presetNames`**

  * Append (or insert) a new string in the `presetNames` array.
  * Whatever position you place it at becomes the preset’s `idx`. If you insert in the middle, you must shift/renumber the switch cases to keep alignment.
  * Best practice: **append to the end** to avoid breaking any saved selections or assumptions about indices.

* **Step 2: Add a matching `case` in `drawPreset`**

  * Create `case N: { ... break; }` where `N` equals the new name’s index in `presetNames`.
  * Keep the structure consistent: set any needed `ctx` parameters (line width, caps, joins, dash), draw using the world helpers (`fillCircleWorld`, `strokeLineWorld`, `arcWorld`, `strokeRectCenteredWorld`, etc.), then `break`.
  * Use the shared world center (`cx`, `cy`) and motion offsets (`tx`, `ty`) so your preset naturally supports motion/offset features.

* **Step 3: Use the existing conventions**

  * **World units vs canvas space:** Most presets draw in world space; only switch to raw canvas space (`ctx.setTransform(1,0,0,1,0,0)` / `ctx.save()` + `ctx.restore()`) if you specifically need stable pixel-perfect behavior (e.g., dashes).
  * **Color handling:** Use `presetColor` as the primary color. If you want a second color, respect `multiColor` and use `multiColorClr`. If you want cycling colors, use `altColor(i)`.
  * **Animation:** Reuse the existing accumulators (`v`, `m`) for motion. Increment them in a way that scales with `presetSpeed`. If you need random re-seeding, follow the pattern that uses `timeRand` and a speed-derived interval.
  * **Size/brightness:** Tie geometry to `presetSize` (often scaled relative to `(H/DPR)` or `(visualW/DPR)`) and alpha/limits to `presetBrightness` where relevant.

* **Step 4: Avoid leaking canvas state**

  * If you change `ctx` settings (transform, lineDash, lineCap, lineJoin, lineWidth), restore them when you’re done—either manually (store previous values and reset) or via `ctx.save()` / `ctx.restore()`—so one preset doesn’t accidentally affect the next.

 */

"use strict";

/**
 * UI-facing preset list.
 * IMPORTANT: index positions MUST match the `case` numbers in `drawPreset`.
 */
const presetNames = [
'Ring (sin)','Ring (rot)','3 Rings','Rand Lines','Rand Ring','Sinus','Sin Blocks','Cross',
      'Discoball','Rand Circles','Rand Rings','Scan |','Scan —','2 Scan','PingPong','Mouse Spot',
      'Multi |','Multi —','Sin Multi |','Sin Multi —','Half Arc','Sin + Rays','Rot Lines','Solid',
      '4 Scan','4 Rot','4 Rings','Crazy Rings','Ring Scan','Tunnel Rect','Dot Grid','Quad LED','Circle Spin', 'Square Spin', 'Triangle Spin'
];
window.presetNames = presetNames;

/**
 * Persistent rotation state for the segmented square/triangle presets.
 * These are intentionally module-scoped so their rotation continues across frames
 * regardless of preset switches (unless this module is reloaded).
 */
let _sqSpin = 0;
let _triSpin = 0;

/**
 * Draw a single frame of the selected preset.
 *
 * @param {number} idx - preset index (maps to `presetNames` and switch cases)
 * @param {*} feats - (currently unused here) audio/features input; left for parity/extensibility
 * @param {{x:number, y:number}} motion - motion offsets (e.g., gyro / tracking)
 *
 * Dependencies (globals/helpers used throughout):
 * - Dimensions: visualW, H, DPR
 * - State: onoff, v, m, a, b_, c, d, ranX, ranY, timeRand, mouseXw, mouseYw, spotlight, presetBrightness
 * - Controls: presetSize, presetSpeed, presetColor, multiColor, multiColorClr
 * - Helpers: setFillColor, setStrokeColor, altColor, rgba, lerp, clamp, nowMs,
 *            worldToCanvasX, worldToCanvasY, fillCircleWorld, strokeLineWorld, arcWorld,
 *            fillTinyDotsBatch, fillCirclesBatch, strokeRectCenteredWorld
 */
function drawPreset(idx, feats, motion){
      const cx = (visualW/DPR)/2;
      const cy = (H/DPR)/2;
      const size = (0.9*presetSize + 10);

      // Motion offsets applied to many presets. These shift the whole pattern.
      const tx = motion.x;
      const ty = motion.y;

      // Global master enable; if off, do not draw anything this frame.
      if (!onoff) return;

      switch(idx){
        // 0: Ring (sin)
        // Dots arranged in a ring, with the angle driven by `v` per-dot to create a "traveling" effect.
        case 0: {
          for (let i=0;i<18;i++){
            setFillColor(altColor(i));
            const r = ((size)* (H/DPR)/240);
            const x = cx + tx + r*Math.sin(i*v);
            const y = cy + ty + r*Math.cos(i*v);
            fillCircleWorld(x, y, 0.4*size);
            v += presetSpeed/360000;
          }
          break;
        }

        // 1: Ring (rot)
        // 18 dots around a ring; whole ring rotates by advancing `v`.
        case 1: {
          v += presetSpeed/2000;
          for (let i=0;i<18;i++){
            setFillColor(altColor(i));
            const r = ((size)* (H/DPR)/240);
            const a2 = i*Math.PI/9 + v;
            const x = cx + tx + r*Math.sin(a2);
            const y = cy + ty + r*Math.cos(a2);
            fillCircleWorld(x, y, 0.4*size);
          }
          break;
        }

        // 2: 3 Rings
        // Three concentric rings with different radii, dot sizes, and rotation directions.
        case 2: {
          v += presetSpeed/3000;
          for (let ring=0; ring<3; ring++){
            const rr = ring===0 ? 1.0 : (ring===1 ? 0.35 : 0.6);
            const dot = ring===0 ? 0.2 : (ring===1 ? 0.08 : 0.12);
            const rot = ring===2 ? -2*v : v;
            for (let i=0;i<18;i++){
              setFillColor(altColor(i+ring));
              const r = rr*((size)* (H/DPR)/240);
              const a2 = i*Math.PI/9 + rot;
              const x = cx + tx + r*Math.sin(a2);
              const y = cy + ty + r*Math.cos(a2);
              fillCircleWorld(x, y, dot*(size+10));
            }
          }
          break;
        }

        // 3: Rand Lines
        // A line (or 3-segment multi-color line) between two random endpoints.
        // Endpoints refresh based on `presetSpeed`.
        case 3: {
          const w = (visualW/DPR);
          const h = (H/DPR);
          ctx.lineWidth = (1.4*presetSize+10) * DPR;
          ctx.lineCap = 'round';

          if (multiColor){
            setStrokeColor(presetColor);
            strokeLineWorld(a+tx, b_+ty, a + (c-a)/3 + tx, b_ + (d-b_)/3 + ty);
            strokeLineWorld(a + 2*(c-a)/3 + tx, b_ + 2*(d-b_)/3 + ty, c+tx, d+ty);
            setStrokeColor(multiColorClr);
            strokeLineWorld(a + (c-a)/3 + tx, b_ + (d-b_)/3 + ty, a + 2*(c-a)/3 + tx, b_ + 2*(d-b_)/3 + ty);
          } else {
            setStrokeColor(presetColor);
            strokeLineWorld(a+tx, b_+ty, c+tx, d+ty);
          }

          // Speed==0 effectively "freezes" the random selection.
          const interval = (presetSpeed===0) ? 1e9 : (1000 - 10*presetSpeed);
          if (nowMs() - timeRand >= interval){
            timeRand = nowMs();
            a = Math.floor(50 + Math.random()*(w-100));
            b_ = Math.floor(50 + Math.random()*(h-100));
            c = Math.floor(50 + Math.random()*(w-100));
            d = Math.floor(50 + Math.random()*(h-100));
          }
          break;
        }

        // 4: Rand Ring
        // Random ring center + random starting rotation (when multiColor, ring is segmented).
        case 4: {
          const w = (visualW/DPR);
          const h = (H/DPR);
          ctx.lineWidth = lerp(5, 60, presetSize/100) * DPR;
          ctx.fillStyle = 'rgba(0,0,0,0)';
          if (multiColor){
            for (let l=0;l<=7;l++){
              setStrokeColor((l%2===0)?presetColor:multiColorClr);
              const start = l*Math.PI/4 + c;
              const end = (l+1)*Math.PI/4 + c;
              arcWorld(a+tx, b_+ty, 500, start, end);
            }
          } else {
            setStrokeColor(presetColor);
            ctx.beginPath();
            ctx.arc(worldToCanvasX(a+tx), worldToCanvasY(b_+ty), 250*DPR, 0, Math.PI*2);
            ctx.stroke();
          }
          const interval = (presetSpeed===0) ? 1e9 : (1000 - 10*presetSpeed);
          if (nowMs() - timeRand >= interval){
            timeRand = nowMs();
            a = Math.floor(150 + Math.random()*(w-300));
            b_ = Math.floor(150 + Math.random()*(h-300));
            c = Math.random()*Math.PI*2;
          }
          break;
        }

        // 5: Sinus
        // A horizontal row of dots with vertical sine-wave displacement.
        case 5: {
          const w = (visualW/DPR);
          for (let f=0; f<w/16; f++){
            const col = multiColor ? ((f%20<=10)?presetColor:multiColorClr) : presetColor;
            setFillColor(col);
            const x = 16*f + tx;
            const y = cy + ty + 4.5*presetSize*Math.sin(v - f/15);
            fillCircleWorld(x, y, 35);
            v += presetSpeed/90000;
          }
          break;
        }

        // 6: Sin Blocks
        // Similar to Sinus but uses rectangles mirrored around a centerline.
        case 6: {
          const w = (visualW/DPR);
          for (let f=0; f<w/90; f++){
            const col = multiColor ? ((f%2===0)?presetColor:multiColorClr) : presetColor;
            setFillColor(col);
            const x = 100*f + tx;
            const y1 = 0.45*(H/DPR) + ty + 100*Math.sin(v - f/1) + presetSize*(H/DPR)*0.005;
            const y2 = 0.45*(H/DPR) + ty - 100*Math.sin(v - f/1) - presetSize*(H/DPR)*0.005;
            ctx.fillRect(worldToCanvasX(x), worldToCanvasY(y1), 60*DPR, (H/DPR/10)*DPR);
            ctx.fillRect(worldToCanvasX(x), worldToCanvasY(y2), 60*DPR, (H/DPR/10)*DPR);
            v += presetSpeed/15000;
          }
          break;
        }

        // 7: Cross
        // Crosshair with either solid strokes or multicolor segmented spokes.
        case 7: {
          v += presetSpeed/1000;
          ctx.lineWidth = (1.5*presetSize) * DPR;
          if (multiColor){
            for (let i=0;i<10;i++){
              setStrokeColor(altColor(i));
              const y1 = (i-5)*(H/DPR)/5;
              const y2 = (i-4)*(H/DPR)/5;
              strokeLineWorld(cx+tx, cy+ty+y1, cx+tx, cy+ty+y2);
              const x1 = (i-5)*(visualW/DPR)/5;
              const x2 = (i-4)*(visualW/DPR)/5;
              strokeLineWorld(cx+tx+x1, cy+ty, cx+tx+x2, cy+ty);
            }
          } else {
            setStrokeColor(presetColor);
            strokeLineWorld(cx+tx, cy+ty-(H/DPR), cx+tx, cy+ty+(H/DPR));
            strokeLineWorld(cx+tx-(visualW/DPR), cy+ty, cx+tx+(visualW/DPR), cy+ty);
          }
          break;
        }

        // 8: Discoball
        // Rotated point-cloud around center; batch rendering for performance.
        // Splits into two color groups if multiColor.
        case 8: {
          v += presetSpeed/5000;
          const ang = v;
          const cs = Math.cos(ang), sn = Math.sin(ang);
          const r = Math.max(1, presetSize/8);

          const ptsA = [];
          const ptsB = [];

          for (let i=0;i<1000;i++){
            const x = ranX[i];
            const y = ranY[i];
            const rx = x*cs - y*sn;
            const ry = x*sn + y*cs;
            const px = cx+tx + rx;
            const py = cy+ty + ry;
            if (multiColor && i>500){ ptsB.push(px, py); }
            else { ptsA.push(px, py); }
          }

          setFillColor(presetColor);
          if (r <= 2.2) fillTinyDotsBatch(ptsA, r);
          else {
            const circles = [];
            for (let i=0;i<ptsA.length;i+=2) circles.push({x:ptsA[i], y:ptsA[i+1], r});
            fillCirclesBatch(circles);
          }

          if (multiColor){
            setFillColor(multiColorClr);
            if (r <= 2.2) fillTinyDotsBatch(ptsB, r);
            else {
              const circles = [];
              for (let i=0;i<ptsB.length;i+=2) circles.push({x:ptsB[i], y:ptsB[i+1], r});
              fillCirclesBatch(circles);
            }
          }
          break;
        }

        // 9: Rand Circles
        // Filled circles randomly placed; positions refresh at speed-based intervals.
        case 9: {
          const w = (visualW/DPR);
          const h = (H/DPR);
          const count = Math.floor((presetSize+10)/10);
          for (let i=0;i<count;i++){
            if (multiColor && i>presetSize/20) setFillColor(multiColorClr);
            else setFillColor(presetColor);
            ctx.beginPath();
            ctx.arc(worldToCanvasX(ranX[i]+tx), worldToCanvasY(ranY[i]+ty), (150-1.35*presetSize)*DPR, 0, Math.PI*2);
            ctx.fill();
          }
          const interval = (presetSpeed===0) ? 1e9 : (1000 - 9.5*presetSpeed);
          if (nowMs() - timeRand >= interval){
            timeRand = nowMs();
            for (let i=0;i<count;i++){
              const rad = (300-2.7*presetSize)/2;
              ranX[i] = Math.floor(rad + Math.random()*(w-2*rad));
              ranY[i] = Math.floor(rad + Math.random()*(h-2*rad));
            }
          }
          break;
        }

        // 10: Rand Rings
        // Outlined rings randomly placed; positions refresh at speed-based intervals.
        case 10: {
          const w = (visualW/DPR);
          const h = (H/DPR);
          const count = Math.floor((presetSize+10)/10);
          ctx.lineWidth = (60-0.5*presetSize) * DPR;
          ctx.fillStyle = 'rgba(0,0,0,0)';
          for (let i=0;i<count;i++){
            if (multiColor && i>presetSize/20) setStrokeColor(multiColorClr);
            else setStrokeColor(presetColor);
            ctx.beginPath();
            ctx.arc(worldToCanvasX(ranX[i]+tx), worldToCanvasY(ranY[i]+ty), (250-2*presetSize)*DPR, 0, Math.PI*2);
            ctx.stroke();
          }
          const interval = (presetSpeed===0) ? 1e9 : (1000 - 9.5*presetSpeed);
          if (nowMs() - timeRand >= interval){
            timeRand = nowMs();
            for (let i=0;i<count;i++){
              const rad = (300-2.7*presetSize)/2;
              ranX[i] = Math.floor(rad + Math.random()*(w-2*rad));
              ranY[i] = Math.floor(rad + Math.random()*(h-2*rad));
            }
          }
          break;
        }

        // 11: Scan |
        // Vertical scanning line that oscillates using sine.
        case 11: {
          v += presetSpeed/1000;
          ctx.lineWidth = (1.5*presetSize) * DPR;
          const x = (cx/1.2)*Math.sin(v) + cx + tx;
          if (multiColor){
            setStrokeColor(presetColor);
            strokeLineWorld(x, 0, x, (H/DPR)/3);
            strokeLineWorld(x, 2*(H/DPR)/3, x, (H/DPR));
            setStrokeColor(multiColorClr);
            strokeLineWorld(x, (H/DPR)/3, x, 2*(H/DPR)/3);
          } else {
            setStrokeColor(presetColor);
            strokeLineWorld(x, 0, x, (H/DPR));
          }
          break;
        }

        // 12: Scan —
        // Horizontal scanning line that oscillates using sine.
        case 12: {
          v += presetSpeed/1000;
          ctx.lineWidth = (1.5*presetSize) * DPR;
          const y = (cy/1.2)*Math.sin(v) + cy + ty;
          if (multiColor){
            setStrokeColor(presetColor);
            strokeLineWorld(0, y, (visualW/DPR)/3, y);
            strokeLineWorld(2*(visualW/DPR)/3, y, (visualW/DPR), y);
            setStrokeColor(multiColorClr);
            strokeLineWorld((visualW/DPR)/3, y, 2*(visualW/DPR)/3, y);
          } else {
            setStrokeColor(presetColor);
            strokeLineWorld(0, y, (visualW/DPR), y);
          }
          break;
        }

        // 13: 2 Scan
        // Combined vertical+horizontal scan, with optional multicolor segmented cross.
        case 13: {
          v += presetSpeed/1000;
          ctx.lineWidth = (1.5*presetSize) * DPR;
          const x = (cx/1.2)*Math.sin(v*1.2) + cx + tx;
          const y = (cy/1.2)*Math.sin(v*0.8) + cy + ty;
          if (multiColor){
            for (let i=0;i<10;i++){
              setStrokeColor(altColor(i));
              const y1 = (i-5)*(H/DPR)/5;
              const y2 = (i-4)*(H/DPR)/5;
              strokeLineWorld(x, y+y1, x, y+y2);
              const x1 = (i-5)*(visualW/DPR)/5;
              const x2 = (i-4)*(visualW/DPR)/5;
              strokeLineWorld(x+x1, y, x+x2, y);
            }
          } else {
            setStrokeColor(presetColor);
            strokeLineWorld(x, y-(H/DPR), x, y+(H/DPR));
            strokeLineWorld(x-(visualW/DPR), y, x+(visualW/DPR), y);
          }
          break;
        }

        // 14: PingPong
        // "Spotlights" array provides animated circles (position+radius over time).
        // Clamped number of balls scales with Size slider.
        case 14: {
          const maxBalls = 12;
          const count = clamp(Math.floor(lerp(4, maxBalls, clamp(presetSize/100,0,1))), 4, maxBalls);

          const circlesA = [];
          const circlesB = [];

          for (let i=0;i<count;i++){
            const s = spotlight[i % spotlight.length].step();
            const cxp = s.x + tx;
            const cyp = s.y + ty;
            const rr = s.r;
            if (multiColor && (i & 1)) circlesB.push({x:cxp, y:cyp, r:rr});
            else circlesA.push({x:cxp, y:cyp, r:rr});
          }

          setFillColor(presetColor);
          fillCirclesBatch(circlesA);
          if (multiColor){
            setFillColor(multiColorClr);
            fillCirclesBatch(circlesB);
          }
          break;
        }

        // 15: Mouse Spot
        // Draws a circle at the current mouse position (world coords).
        case 15: {
          const r = 3*presetSize;
          setFillColor(presetColor);
          fillCircleWorld(mouseXw + tx, mouseYw + ty, r);
          if (multiColor){
            setFillColor(multiColorClr);
            fillCircleWorld(mouseXw + tx, mouseYw + ty, r*0.55);
          }
          break;
        }

        // 16: Multi |
        // Multiple vertical bars that scroll horizontally. `m` accumulates position.
        case 16: {
          ctx.lineWidth = presetSize * DPR;
          const w = (visualW/DPR);
          for (let r=-4;r<=4;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const x = (m + r*w/4) + tx;
            strokeLineWorld(x, 0, x, (H/DPR));
          }
          m += presetSpeed/3;
          if (m >= w-50) m = -50;
          break;
        }

        // 17: Multi —
        // Multiple horizontal bars that scroll vertically. `m` accumulates position.
        case 17: {
          ctx.lineWidth = presetSize * DPR;
          const h = (H/DPR);
          for (let r=-4;r<=4;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const y = (m + r*h/4) + ty;
            strokeLineWorld(0, y, (visualW/DPR), y);
          }
          m += presetSpeed/3;
          if (m >= h-50) m = -50;
          break;
        }

        // 18: Sin Multi |
        // Vertical bars with a sine-based vertical offset applied as a group.
        case 18: {
          v += presetSpeed/5000;
          ctx.lineWidth = 80 * DPR;
          const w = (visualW/DPR);
          const yShift = (H/DPR)/3 * Math.sin(v);
          for (let r=-4;r<=4;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const x = (m + r*w/4) + tx;
            const y1 = lerp((H/DPR)/2, 200, presetSize/100);
            const y2 = lerp((H/DPR)/2, (H/DPR)-200, presetSize/100);
            strokeLineWorld(x, yShift + y1 + ty, x, yShift + y2 + ty);
          }
          m += presetSpeed/4;
          if (m >= w-50) m = -50;
          break;
        }

        // 19: Sin Multi —
        // Horizontal bars with a sine-based horizontal offset applied as a group.
        case 19: {
          v += presetSpeed/5000;
          ctx.lineWidth = 80 * DPR;
          const h = (H/DPR);
          const xShift = (visualW/DPR)/3 * Math.sin(v);
          for (let r=-4;r<=4;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const y = (m + r*h/4) + ty;
            const x1 = lerp((visualW/DPR)/2, 200, presetSize/100);
            const x2 = lerp((visualW/DPR)/2, (visualW/DPR)-200, presetSize/100);
            strokeLineWorld(xShift + x1 + tx, y, xShift + x2 + tx, y);
          }
          m += presetSpeed/4;
          if (m >= h-50) m = -50;
          break;
        }

        // 20: Half Arc
        // Animated half-arc originating from one of four sides/corners, chosen randomly.
        // `v` acts like a step counter: resets when it hits 100.
        case 20: {
          ctx.lineWidth = presetSize * DPR;
          ctx.fillStyle = 'rgba(0,0,0,0)';
          setStrokeColor(multiColor ? multiColorClr : presetColor);
          v += presetSpeed/20;
          if (v >= 100){
            v = 0;
            a = Math.floor(Math.random()*21);
            b_ = Math.floor(Math.random()*21);
            c = Math.floor(350 + Math.random()*Math.max(1, (H/DPR)-400));
          }
          const ang = v*Math.PI/50;
          if (a<=10 && b_<=10) arcWorld((visualW/DPR) + tx, (H/DPR)/2 + ty, c, ang-Math.PI/2, ang+Math.PI/2);
          else if (a<=10 && b_>10) arcWorld((visualW/DPR)/2 + tx, (H/DPR) + ty, c, ang, ang+Math.PI);
          else if (a>10 && b_<=10) arcWorld(0 + tx, (H/DPR)/2 + ty, c, ang+Math.PI/2, ang+3*Math.PI/2);
          else arcWorld((visualW/DPR)/2 + tx, 0 + ty, c, ang-Math.PI, ang);
          break;
        }

        // 21: Sin + Rays
        // Sinus dots with periodic "ray" flashes (controlled by modulus on `f`).
        case 21: {
          const w = (visualW/DPR);
          for (let f=0; f<w/16; f++){
            if (f%14 < 1) ctx.fillStyle = rgba(multiColorClr, 1);
            else ctx.fillStyle = rgba(presetColor, clamp(presetBrightness/200,0,1));
            const x = 16*f + tx;
            const y = cy + ty + 4.5*presetSize*Math.sin(v - f/15);
            fillCircleWorld(x, y, 40);
            v += presetSpeed/90000;
          }
          break;
        }

        // 22: Rot Lines
        // Two horizontal rows of thick line segments moving across the screen.
        case 22: {
          v += presetSpeed/3000;
          const w = (visualW/DPR);
          ctx.lineWidth = (50+0.5*presetSize) * DPR;
          for (let r=-8;r<=8;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const x1 = (m + r*w/8) - w/2;
            const x2 = (m + (r+1)*w/8) - w/2;
            strokeLineWorld(cx+tx + x1, cy+ty - presetSize*(H/DPR)/200 + 30, cx+tx + x2, cy+ty - presetSize*(H/DPR)/200 + 30);
          }
          for (let r=-8;r<=8;r++){
            if (multiColor) setStrokeColor((r%2===0)?presetColor:multiColorClr);
            else setStrokeColor(presetColor);
            const x1 = (m + r*w/8) - w/2;
            const x2 = (m + (r+1)*w/8) - w/2;
            strokeLineWorld(cx+tx + x1, cy+ty + presetSize*(H/DPR)/200 - 30, cx+tx + x2, cy+ty + presetSize*(H/DPR)/200 - 30);
          }
          m += 1;
          if (m >= w-50) m = -50;
          break;
        }

        // 23: Solid
        // Full-screen rectangle fill; alpha controlled by presetBrightness.
        case 23: {
          ctx.setTransform(1,0,0,1,0,0);
          ctx.fillStyle = rgba(presetColor, clamp(presetBrightness/100,0,1));
          ctx.fillRect(0,0,visualW,H);
          break;
        }

        // 24: 4 Scan
        // Four scanning lines around quadrants with phase derived from `v`.
        case 24: {
          ctx.lineWidth = (0.8*presetSize) * DPR;
          const sp = 500*v;
          const rr = (presetSize*(H/DPR)/240);
          const sx = rr*Math.sin(sp);
          const cy1 = (H/DPR)/4 + ty;
          const cy2 = 3*(H/DPR)/4 + ty;
          const cx1 = (visualW/DPR)/4 + tx;
          const cx2 = 3*(visualW/DPR)/4 + tx;
          setStrokeColor(presetColor);
          strokeLineWorld(cx1+sx, cy1-rr*Math.cos(sp), cx1-sx, cy1-rr*Math.cos(sp));
          strokeLineWorld(cx2+sx, cy2-rr*Math.cos(sp), cx2-sx, cy2-rr*Math.cos(sp));
          if (multiColor) setStrokeColor(multiColorClr);
          strokeLineWorld(cx2-sx, cy1+rr*Math.cos(sp), cx2-sx, cy1-rr*Math.cos(sp));
          strokeLineWorld(cx1-sx, cy2+rr*Math.cos(sp), cx1-sx, cy2-rr*Math.cos(sp));
          v += presetSpeed/360000;
          break;
        }

        // 25: 4 Rot
        // Similar to 4 Scan but rotates the stroke directions.
        case 25: {
          ctx.lineWidth = (0.8*presetSize) * DPR;
          const sp = 500*v;
          const rr = (presetSize*(H/DPR)/240);
          const cy1 = (H/DPR)/4 + ty;
          const cy2 = 3*(H/DPR)/4 + ty;
          const cx1 = (visualW/DPR)/4 + tx;
          const cx2 = 3*(visualW/DPR)/4 + tx;
          setStrokeColor(presetColor);
          strokeLineWorld(cx1+rr*Math.sin(sp), cy1+rr*Math.cos(sp), cx1-rr*Math.sin(sp), cy1-rr*Math.cos(sp));
          strokeLineWorld(cx2+rr*Math.sin(sp), cy2+rr*Math.cos(sp), cx2-rr*Math.sin(sp), cy2-rr*Math.cos(sp));
          if (multiColor) setStrokeColor(multiColorClr);
          strokeLineWorld(cx2+rr*Math.cos(sp), cy1+rr*Math.sin(sp), cx2-rr*Math.cos(sp), cy1-rr*Math.sin(sp));
          strokeLineWorld(cx1+rr*Math.cos(sp), cy2+rr*Math.sin(sp), cx1-rr*Math.cos(sp), cy2-rr*Math.sin(sp));
          v += presetSpeed/360000;
          break;
        }

        // 26: 4 Rings
        // Four rotating mini-rings in quadrant centers, alternating rotation direction.
        case 26: {
          v += presetSpeed/4000;
          for (let q=0;q<4;q++){
            const qx = (q%2===0) ? (visualW/DPR)/4 : 3*(visualW/DPR)/4;
            const qy = (q<2) ? (H/DPR)/4 : 3*(H/DPR)/4;
            const rot = (q===0 || q===3) ? v : -v;
            for (let i=0;i<18;i++){
              setFillColor(altColor(i));
              const r = ((presetSize*0.6+3)*(H/DPR)/120);
              const a2 = i*Math.PI/9 + rot;
              const x = qx + tx + r*Math.sin(a2);
              const y = qy + ty + r*Math.cos(a2);
              fillCircleWorld(x, y, 0.25*presetSize+3);
            }
          }
          break;
        }

        // 27: Crazy Rings
        // Four rings with differing rotation multipliers based on quadrant index.
        case 27: {
          v += presetSpeed/20000;
          for (let xx=0;xx<=1;xx++){
            for (let yy=0;yy<=1;yy++){
              const qx = (2*xx+1)*(visualW/DPR)/4;
              const qy = (2*yy+1)*(H/DPR)/4;
              const rot = v * (1 + xx - yy);
              for (let i=0;i<18;i++){
                setFillColor(altColor(i+xx+yy));
                const r = ((presetSize+40)*(H/DPR)/240);
                const a2 = i*Math.PI/9 + rot;
                const x = qx + tx + r*Math.sin(a2);
                const y = qy + ty + r*Math.cos(a2);
                fillCircleWorld(x, y, 0.15*(presetSize+40));
              }
            }
          }
          break;
        }

        // 28: Ring Scan
        // Two orbiting circles with different radii and sizes.
        case 28: {
          v += presetSpeed/800;
          const x1 = cx + tx - presetSize*((visualW/DPR-45)/250)*Math.cos(v);
          const y1 = cy + ty + presetSize*((H/DPR-45)/250)*Math.sin(v);
          setFillColor(presetColor);
          fillCircleWorld(x1, y1, 22.5);
          const x2 = cx + tx + presetSize*((visualW/DPR-60)/190)*Math.cos(v);
          const y2 = cy + ty + presetSize*((H/DPR-60)/190)*Math.sin(v);
          if (multiColor) setFillColor(multiColorClr);
          fillCircleWorld(x2, y2, 30);
          break;
        }

        // 29: Tunnel Rect
        // Expanding/contracting centered rectangle. Switches color when passing a threshold.
        case 29: {
          const w = (visualW/DPR);
          const h = (H/DPR);
          const cx0 = cx + tx;
          const cy0 = cy + ty;
          ctx.fillStyle = 'rgba(0,0,0,0)';

          if (m >= 110){
            ctx.lineWidth = Math.max(0, (presetSize+1)*(220-m)/110) * DPR;
            setStrokeColor(multiColorClr);
            const s = (220-m);
            strokeRectCenteredWorld(cx0, cy0, s*w/100, s*h/100);
          } else {
            ctx.lineWidth = ((presetSize+1)*m/110) * DPR;
            setStrokeColor(presetColor);
            strokeRectCenteredWorld(cx0, cy0, m*w/100, m*h/100);
          }

          m += presetSpeed/40;
          if (m >= 220) m = 0;
          break;
        }

        // 30: Dot Grid
        // 10x10 grid of dots; brightness driven by a sine pattern and presetBrightness cap.
        case 30: {
          v += presetSpeed/1200;
          const w = (visualW/DPR);
          const dotSize = lerp(10, w/18, presetSize/100);
          for (let i=0;i<=9;i++){
            for (let j=0;j<=9;j++){
              const brightVal = clamp(-100 + 355*Math.sin(v + 31*(i+j)), 0, presetBrightness*255/100);
              const alpha2 = clamp(brightVal/255,0,1);
              const col = (multiColor && ((i+j)%2===1)) ? multiColorClr : presetColor;
              ctx.fillStyle = rgba(col, alpha2);
              const x = i*w/10 + w/30 + tx;
              const y = j*w/10 + w/30 + ty;
              fillCircleWorld(x, y, dotSize/2);
            }
          }
          break;
        }

        // 31: Quad LED
        // Draws tri-color LED clusters (R/G/B + optional white) with a blink/phase pattern.
        // NOTE: Uses an inner helper `drawQuadLED` scoped to this case.
        case 31: {
          const LEN = 5*(H/DPR)/40;
          const BLINKSPD = 3.0;
          const THRESH = 0.2;

          // v advances slowly forward/back depending on presetSpeed, producing a gentle phase drift.
          v += lerp(-0.06, 0.06, presetSpeed/100);

          function drawQuadLED(x,y,brightPct){
            const SIZE = Math.round(8*(presetSize+50)/100);
            const base = presetColor;
            const alt = multiColor ? multiColorClr : presetColor;

            // Determine which channels are "active" based on whether either palette has that channel.
            const redOn = (base.r>0 || alt.r>0);
            const greenOn = (base.g>0 || alt.g>0);
            const blueOn = (base.b>0 || alt.b>0);
            const a = clamp(brightPct/100,0,1);

            if (redOn){ ctx.fillStyle = `rgba(255,0,0,${a})`; ctx.fillRect(worldToCanvasX(x-SIZE-1), worldToCanvasY(y-SIZE-1), SIZE*DPR, SIZE*DPR); }
            if (greenOn){ ctx.fillStyle = `rgba(0,255,0,${a})`; ctx.fillRect(worldToCanvasX(x+1), worldToCanvasY(y-SIZE-1), SIZE*DPR, SIZE*DPR); }
            if (blueOn){ ctx.fillStyle = `rgba(0,0,255,${a})`; ctx.fillRect(worldToCanvasX(x-SIZE-1), worldToCanvasY(y+1), SIZE*DPR, SIZE*DPR); }
            if (base.r>0 && base.g>0 && base.b>0){ ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(worldToCanvasX(x+1), worldToCanvasY(y+1), SIZE*DPR, SIZE*DPR); }
          }

          // 3 clusters laid out in a triangle formation.
          const clusters = [
            {x: (visualW/DPR)*14/40 + tx, y: (H/DPR)*4/12 + ty, phase: 0},
            {x: (visualW/DPR)*26/40 + tx, y: (H/DPR)*4/12 + ty, phase: 2*Math.PI/3},
            {x: (visualW/DPR)*20/40 + tx, y: (H/DPR)*8/12 + ty, phase: 4*Math.PI/3},
          ];

          for (let k=0;k<clusters.length;k++){
            const cl = clusters[k];
            let BRIGHT = presetBrightness;
            const s = Math.sin(BLINKSPD*v + cl.phase);
            if (s > THRESH) BRIGHT = lerp(100, 0, (s-THRESH)/(1-THRESH));

            // Rotate the mini-grid around each cluster center.
            const rot = v;
            for (let e=0;e<=4;e++){
              for (let f=0;f<=4;f++){
                // Skip corners and center for the LED layout.
                if (!((e===0&&f===0)||(e===4&&f===0)||(e===0&&f===4)||(e===4&&f===4)||(e===2&&f===2))){
                  const x = cl.x + (LEN*e-2*LEN)*Math.cos(rot) - (LEN*f-2*LEN)*Math.sin(rot);
                  const y = cl.y + (LEN*e-2*LEN)*Math.sin(rot) + (LEN*f-2*LEN)*Math.cos(rot);
                  drawQuadLED(x, y, Math.round(BRIGHT*presetBrightness/100));
                }
              }
            }
          }
          break;
        }

        // 32: Circle Spin
        // Ring that spins; optionally segmented into alternating colored arcs.
        case 32: {
          // rotation speed tied to Speed slider
          v += presetSpeed / 2000;

          // circle size tied to Size slider
          const radius = lerp(60, (H/DPR) * 0.35, presetSize / 100);

          // thickness of the ring
          ctx.lineWidth = lerp(4, 60, presetSize / 100) * DPR;

          // alternating colors like Rand Ring
          if (multiColor) {
            for (let i = 0; i < 8; i++) {
              setStrokeColor(i % 2 === 0 ? presetColor : multiColorClr);
              const start = v + i * Math.PI / 4;
              const end   = start + Math.PI / 4;
              arcWorld(cx + tx, cy + ty, radius * 2, start, end);
            }
          } else {
            setStrokeColor(presetColor);
            arcWorld(cx + tx, cy + ty, radius * 2, 0, Math.PI * 2);
          }
          break;
        }

        // 33: Square Spin
        // Dashed/segmented square "ring" using a two-pass dash trick to alternate colors.
        // Implementation note:
        // - Works in canvas space (reset transform) to keep dash lengths stable.
        // - `_sqSpin` rotates the whole square slowly; `v` drives dash offset animation.
        case 33: {
  // Square Spin — dashed/segmented ring like the Circle Spin, but square.
  // stripesPerSide = number of segments along EACH side (alternating colors).
  // v advances the dash animation; _sqSpin rotates the whole square slowly.
  v += presetSpeed / 2000;

  // slow rotation of the whole shape (tied to Speed, but much slower)
  const shapeSpinMul = 20.0; // <— increase = faster whole-shape rotation
  _sqSpin += (presetSpeed / 60000) * shapeSpinMul;

  ctx.fillStyle = 'rgba(0,0,0,0)';

  // thickness similar to Circle Spin
  ctx.lineWidth = lerp(4, 60, presetSize / 100) * DPR;

  const prevCap = ctx.lineCap;
  const prevJoin = ctx.lineJoin;
  const prevDash = ctx.getLineDash();
  const prevDashOff = ctx.lineDashOffset;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Size controls the half-extent of the square in WORLD units
  const half = lerp(80, 0.38 * Math.min((visualW/DPR), (H/DPR)), presetSize / 100);

  // ===== segment controls =====
  const stripesPerSide = 6; // <— increase/decrease this (segments per side)
  const totalSeg = Math.max(4, Math.floor(stripesPerSide) * 4);

  // Work in canvas space for stable dashes
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate((cx + tx) * DPR, (cy + ty) * DPR);
  ctx.rotate(_sqSpin);

  const sidePx = 2 * half * DPR;
  const peri = 4 * sidePx;
  const segLen = peri / totalSeg;

  // Two-pass dash trick to get alternating colors with NO gaps:
  // Pass A draws every other segment, Pass B fills the skipped ones.
  ctx.setLineDash([segLen, segLen]);

  // animate: dash offset drives segment travel around the perimeter
  const dashSpeed = 2.0; // <— increase = faster segment motion
  const anim = -(v * segLen * dashSpeed);
  ctx.lineDashOffset = anim;

  // Path: centered square (rotated by ctx.rotate above)
  ctx.beginPath();
  ctx.rect(-sidePx/2, -sidePx/2, sidePx, sidePx);

  if (multiColor){
    setStrokeColor(presetColor);
    ctx.stroke();

    ctx.lineDashOffset = anim - segLen; // shift by one segment to alternate
    setStrokeColor(multiColorClr);
    ctx.stroke();
  } else {
    setStrokeColor(presetColor);
    ctx.stroke();
  }

  ctx.restore();

  // restore context state
  ctx.setLineDash(prevDash);
  ctx.lineDashOffset = prevDashOff;
  ctx.lineCap = prevCap;
  ctx.lineJoin = prevJoin;
  break;
}

        // 34: Triangle Spin
        // Dashed/segmented triangle "ring" using the same two-pass dash trick as Square Spin.
        // Implementation note:
        // - Vertices are defined in canvas space for stable dash lengths.
        // - `_triSpin` rotates the whole triangle slowly; `v` drives dash offset animation.
        case 34: {
  // Triangle Spin — dashed/segmented ring like the Circle Spin, but triangle.
  // stripesPerSide = number of segments along EACH side (alternating colors).
  // v advances the dash animation; _triSpin rotates the whole triangle slowly.
  v += presetSpeed / 2000;

  // slow rotation of the whole shape (tied to Speed, but much slower)
  const shapeSpinMul = 20.0; // <— increase = faster whole-shape rotation
  _triSpin += (presetSpeed / 60000) * shapeSpinMul;

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.lineWidth = lerp(4, 60, presetSize / 100) * DPR;

  const prevCap = ctx.lineCap;
  const prevJoin = ctx.lineJoin;
  const prevDash = ctx.getLineDash();
  const prevDashOff = ctx.lineDashOffset;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const r = lerp(90, 0.42 * Math.min((visualW/DPR), (H/DPR)), presetSize / 100);

  // ===== segment controls =====
  const stripesPerSide = 6; // <— increase/decrease this (segments per side)
  const totalSeg = Math.max(3, Math.floor(stripesPerSide) * 3);

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate((cx + tx) * DPR, (cy + ty) * DPR);
  ctx.rotate(_triSpin);

  const rrPx = r * DPR;

  // triangle vertices (point up), centered (rotated by ctx.rotate above)
  const p1 = {x: 0,           y: -rrPx};
  const p2 = {x: 0.866*rrPx,  y:  0.5*rrPx};
  const p3 = {x:-0.866*rrPx,  y:  0.5*rrPx};

  // perimeter in pixels
  const d12 = Math.hypot(p2.x-p1.x, p2.y-p1.y);
  const d23 = Math.hypot(p3.x-p2.x, p3.y-p2.y);
  const d31 = Math.hypot(p1.x-p3.x, p1.y-p3.y);
  const peri = d12 + d23 + d31;
  const segLen = peri / totalSeg;

  ctx.setLineDash([segLen, segLen]);

  const dashSpeed = 2.0; // <— increase = faster segment motion
  const anim = -(v * segLen * dashSpeed);
  ctx.lineDashOffset = anim;

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();

  if (multiColor){
    setStrokeColor(presetColor);
    ctx.stroke();

    ctx.lineDashOffset = anim - segLen;
    setStrokeColor(multiColorClr);
    ctx.stroke();
  } else {
    setStrokeColor(presetColor);
    ctx.stroke();
  }

  ctx.restore();

  ctx.setLineDash(prevDash);
  ctx.lineDashOffset = prevDashOff;
  ctx.lineCap = prevCap;
  ctx.lineJoin = prevJoin;
  break;
}

        // Default: unknown preset index.
        // No-op to avoid exceptions if presetNames and switch drift.
        default:
          break;
      }
    }
