/* ============================================================
   canvas/canvas.js  — v2 color pass (fixed)
   Canvas state · zoom · coordinate translation · paint tools
   (pencil, eraser, bucket, replace-color, select-rect) ·
   drag-and-drop import · JS↔Python bridge · marching ants ·
   RGBA foreground color.
   ============================================================ */

// ── DOM refs (set in setupCanvasDrawInteractions) ─────────────
let canvas, ctx, canvasArea;

// ── Zoom ──────────────────────────────────────────────────────
const zoomSteps = [25, 50, 75, 100, 200, 300, 400, 600, 800, 1200, 1600];
let currentZoomIndex = 3;

// ── Tool state ────────────────────────────────────────────────
let currentTool      = 'pencil';
let isDrawing        = false;
let defaultBgColor   = '#ffffff';
let transparencyMode = 'transparent';
let brushSize        = 1;
let lastX = 0, lastY = 0;

// ── RGBA foreground color ─────────────────────────────────────
// fgHex   : '#rrggbb'  — hex component shown in the native color input
// fgAlpha : 0–255      — opacity component shown in the range slider
// foregroundColor : derived 'rgba(r,g,b,a)' string used by all painting ops
let fgHex         = '#000000';
let fgAlpha       = 255;
let foregroundColor = 'rgba(0,0,0,1)';

function fgColorString() {
    const [r, g, b] = hexToRGBParts(fgHex);
    // Use 4 decimal places so near-transparent values are not rounded to 0
    return `rgba(${r},${g},${b},${(fgAlpha / 255).toFixed(4)})`;
}

// Call whenever fgHex or fgAlpha changes to keep foregroundColor in sync
function syncForegroundColor() {
    foregroundColor = fgColorString();
}

// ── Selection state ───────────────────────────────────────────
// Purely region metadata — no floating layer, no detachment.
let selection   = null;     // null | { x, y, w, h } (always normalised after mouseup)
let selStart    = null;     // anchor pixel while dragging
let isSelecting = false;

// ── Overlay canvas ────────────────────────────────────────────
// Separate canvas element, overlaid on workspace-canvas.
// NEVER exported / stored / passed to Python. Pure rendering aid.
// pointer-events: none — visual only; events routed through canvas.
let overlayCanvas  = null;
let overlayCtx     = null;

// ── Selection handle drag state ───────────────────────────────
// activeHandle: which of the 8 handles is being dragged, or null.
// Format: 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
let activeHandle      = null;
let handleDragStart   = null; // { ix, iy } image-space coords at drag start
let selectionAtDragStart = null; // snapshot of selection when drag began
const HANDLE_RADIUS   = 5;   // display-pixels — hit-test radius

// ── Canvas history ───────────────────────────────────────────
// Snapshot-based undo/redo. Each entry stores raw pixel data +
// canvas dimensions. Using ImageData (Uint8ClampedArray) avoids
// async PNG encode/decode, keeping undo/redo synchronous and instant.
// History captures completed editing actions — not every mousemove.
const HISTORY_MAX = 40;
let historyStack  = [];  // [ { data: Uint8ClampedArray, w, h }, ... ]
let historyIndex  = -1;  // points at current state

// Capture current canvas state. Discards any redo states above pointer.
function historySave() {
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push({
        data: new Uint8ClampedArray(id.data),
        w: canvas.width,
        h: canvas.height
    });
    if (historyStack.length > HISTORY_MAX) historyStack.shift();
    historyIndex = historyStack.length - 1;
}

function historyUndo() {
    if (historyIndex <= 0) return; // index 0 = initial state, nothing before it
    historyIndex--;
    historyRestore(historyStack[historyIndex]);
}

function historyRedo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    historyRestore(historyStack[historyIndex]);
}

function historyRestore(snapshot) {
    if (!snapshot) return;
    canvas.width  = snapshot.w;
    canvas.height = snapshot.h;
    const imageData = ctx.createImageData(snapshot.w, snapshot.h);
    imageData.data.set(snapshot.data);
    ctx.putImageData(imageData, 0, 0);
    syncOverlaySize();
    applyZoom();
}

// ── Active image identity ─────────────────────────────────────
// Tracks the name of the currently loaded image, if it was loaded from
// or saved to the Image Bank. null = unnamed / unsaved canvas.
// Persisted to localStorage so identity survives session restore.
let activeImageName = null;

function setActiveImageName(name) {
    activeImageName = name || null;
    localStorage.setItem('paintlab_active_image_name', activeImageName || '');
    const label = document.getElementById('active-image-label');
    if (label) label.textContent = activeImageName || 'unsaved';
}

// ── Marching ants ─────────────────────────────────────────────
let marchingRaf    = null;  // requestAnimationFrame handle; null = not running
let antPhase       = 0;     // dash offset, advances each frame
const ANT_SPEED    = 0.5;   // pixels per frame — visibly animated at 60 fps
const ANT_PERIOD   = 8;     // dash-gap pattern length (4px dash + 4px gap)

// ─────────────────────────────────────────────────────────────
// DEFAULT CANVAS
// ─────────────────────────────────────────────────────────────
function initDefaultCanvas() {
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0,   '#0e639c');
    grad.addColorStop(0.5, '#4b11bb');
    grad.addColorStop(1,   '#f48771');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Active Canvas Area', w / 2, h / 2);
}

// ─────────────────────────────────────────────────────────────
// ZOOM — CSS only, never resamples pixel data
// ─────────────────────────────────────────────────────────────
function applyZoom() {
    const scale = zoomSteps[currentZoomIndex] / 100;
    const cssW  = `${canvas.width  * scale}px`;
    const cssH  = `${canvas.height * scale}px`;
    canvas.style.width  = cssW;
    canvas.style.height = cssH;
    // Overlay lives in display-pixel space — resize its intrinsic surface
    // to match the new display dimensions after every zoom change.
    syncOverlaySize();
    document.getElementById('zoom-badge').textContent = `${zoomSteps[currentZoomIndex]}%`;
    localStorage.setItem('paintlab_zoom_idx', currentZoomIndex);
    if (!marchingRaf) redrawOverlay();
}

// ─────────────────────────────────────────────────────────────
// COORDINATE TRANSLATION
// ─────────────────────────────────────────────────────────────
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor((e.clientX - rect.left) * (canvas.width  / rect.width)),
        y: Math.floor((e.clientY - rect.top)  * (canvas.height / rect.height))
    };
}

// ─────────────────────────────────────────────────────────────
// BRESENHAM LINE
// ─────────────────────────────────────────────────────────────
function drawBresenhamLine(x0, y0, x1, y1, fn) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
        fn(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}

// ─────────────────────────────────────────────────────────────
// PAINT FUNCTIONS
// ─────────────────────────────────────────────────────────────
// Hard RGBA assignment — writes exact selected RGBA bytes to pixels
// via putImageData, bypassing canvas alpha-compositing entirely.
// Repeated strokes over the same pixel leave it at the exact selected
// value — no accumulation, no blending, no pressure simulation.
function hardPlot(x0, y0, r, g, b, a, size) {
    const o  = Math.floor(size / 2);
    const px = x0 - o, py = y0 - o;
    const pw = size,   ph = size;
    // Clamp to canvas bounds
    const cx = Math.max(0, px),         cy = Math.max(0, py);
    const cw = Math.min(pw, canvas.width  - cx);
    const ch = Math.min(ph, canvas.height - cy);
    if (cw <= 0 || ch <= 0) return;

    const imgData = ctx.getImageData(cx, cy, cw, ch);
    const d       = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        d[i]     = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = a;
    }
    ctx.putImageData(imgData, cx, cy);
}

function plotPencil(x, y) {
    const [r, g, b] = hexToRGBParts(fgHex);
    hardPlot(x, y, r, g, b, fgAlpha, brushSize);
}

// Eraser semantics: transparent mode clears pixels to fully transparent;
// opaque mode fills with the default background colour (hard assignment).
function plotEraser(x, y) {
    const o = Math.floor(brushSize / 2);
    if (transparencyMode === 'transparent') {
        ctx.clearRect(x - o, y - o, brushSize, brushSize);
    } else {
        const [r, g, b] = hexToRGBParts(defaultBgColor);
        hardPlot(x, y, r, g, b, 255, brushSize);
    }
}

// ─────────────────────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────────────────────
function hexToRGBParts(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Parse current foregroundColor string ('rgba(r,g,b,a01)') → {r,g,b,a 0-255}
// Used by fill operations so they respect the selected alpha.
function parseFillColor(str) {
    // Remove all whitespace so we match regardless of spacing
    const clean = str.replace(/\s/g, '');
    const m = clean.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
    if (m) {
        return {
            r: parseInt(m[1], 10),
            g: parseInt(m[2], 10),
            b: parseInt(m[3], 10),
            a: Math.min(255, Math.round(parseFloat(m[4]) * 255))
        };
    }
    // Fallback: hex string → fully opaque
    const [r, g, b] = hexToRGBParts(str);
    return { r, g, b, a: 255 };
}

// ─────────────────────────────────────────────────────────────
// FLOOD FILL — contiguous 4-connected iterative fill
// ─────────────────────────────────────────────────────────────
function floodFill(startX, startY) {
    const w = canvas.width, h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data      = imageData.data;
    const fill      = parseFillColor(foregroundColor);

    const base  = (startY * w + startX) * 4;
    const tR = data[base],  tG = data[base + 1];
    const tB = data[base + 2], tA = data[base + 3];

    // No-op if target already equals fill (full RGBA match)
    if (fill.r === tR && fill.g === tG && fill.b === tB && fill.a === tA) return;

    const visited = new Uint8Array(w * h);
    const stack   = [startX + startY * w];

    while (stack.length) {
        const idx = stack.pop();
        if (visited[idx]) continue;
        visited[idx] = 1;

        const pi = idx * 4;
        if (data[pi]!==tR || data[pi+1]!==tG || data[pi+2]!==tB || data[pi+3]!==tA) continue;

        data[pi]   = fill.r;
        data[pi+1] = fill.g;
        data[pi+2] = fill.b;
        data[pi+3] = fill.a;

        const x = idx % w, y = (idx / w) | 0;
        if (x > 0)     stack.push(idx - 1);
        if (x < w - 1) stack.push(idx + 1);
        if (y > 0)     stack.push(idx - w);
        if (y < h - 1) stack.push(idx + w);
    }

    ctx.putImageData(imageData, 0, 0);
}

// ─────────────────────────────────────────────────────────────
// GLOBAL COLOR REPLACE — replaces every matching pixel in image
// ─────────────────────────────────────────────────────────────
function replaceColor(startX, startY) {
    const w = canvas.width, h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data      = imageData.data;
    const fill      = parseFillColor(foregroundColor);

    const base = (startY * w + startX) * 4;
    const tR = data[base], tG = data[base+1], tB = data[base+2], tA = data[base+3];

    if (fill.r===tR && fill.g===tG && fill.b===tB && fill.a===tA) return;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i]===tR && data[i+1]===tG && data[i+2]===tB && data[i+3]===tA) {
            data[i]   = fill.r;
            data[i+1] = fill.g;
            data[i+2] = fill.b;
            data[i+3] = fill.a;
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

// ─────────────────────────────────────────────────────────────
// OVERLAY CANVAS — marquee only, never image data
// ─────────────────────────────────────────────────────────────
// The overlay is sized in DISPLAY-PIXELS (the rendered dimensions of
// workspace-canvas), not in image-pixels.
//
// Coordinate vocabulary:
//   image-pixel  — one pixel in the PIL/canvas image data (canvas.width space)
//   canvas-pixel — one pixel in a canvas element's intrinsic drawing surface
//   display-pixel — one CSS pixel on screen
//
// workspace-canvas: intrinsic = image-pixels, CSS = display-pixels via applyZoom.
// overlay-canvas:   intrinsic = display-pixels, CSS = same display-pixels (1:1).
//   → lineWidth:1 on the overlay = exactly 1 display-pixel stroke.
//   → image-rendering:auto (default) allows sub-pixel anti-aliasing.
//   → drawing coordinates must be converted image→display via imageToDisplay().
//
// This matches JSPaint's approach: the selection overlay lives in display-space
// so lineWidth:1 is always a physical hairline regardless of zoom.
function initOverlayCanvas() {
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'selection-overlay';

    // Intrinsic size = display-pixels (set/updated by syncOverlaySize after applyZoom).
    // On first init, canvas.style.width may be empty, so fall back to image-pixel size.
    const dispW = parseInt(canvas.style.width)  || canvas.width;
    const dispH = parseInt(canvas.style.height) || canvas.height;
    overlayCanvas.width  = dispW;
    overlayCanvas.height = dispH;

    // CSS size matches intrinsic size (1:1 — no CSS scaling on the overlay).
    overlayCanvas.style.width  = dispW + 'px';
    overlayCanvas.style.height = dispH + 'px';

    overlayCanvas.style.position       = 'absolute';
    overlayCanvas.style.top            = '0';
    overlayCanvas.style.left           = '0';
    // pointer-events:none — overlay is visual only. All mouse events go to
    // workspace-canvas underneath. Handle hit-testing is done inside the
    // canvas mousedown/mousemove handlers using coordinate translation.
    overlayCanvas.style.pointerEvents  = 'none';
    // Do NOT set image-rendering:pixelated — we want smooth sub-pixel rendering
    // so a lineWidth:1 stroke is a clean 1-display-pixel hairline.

    const wrapper = document.createElement('div');
    wrapper.id = 'canvas-wrapper';
    wrapper.style.position   = 'relative';
    wrapper.style.display    = 'inline-block';
    wrapper.style.lineHeight = '0';
    wrapper.style.padding    = '0';
    wrapper.style.margin     = '0';
    wrapper.style.border     = '0';

    canvas.parentNode.insertBefore(wrapper, canvas);
    wrapper.appendChild(canvas);
    wrapper.appendChild(overlayCanvas);

    overlayCtx = overlayCanvas.getContext('2d');
}

// Called after applyZoom() changes the canvas CSS display size,
// and after canvas is resized (Attributes modal, drag-drop, setCanvasFromBase64).
// Resizes the overlay intrinsic surface to match the new display-pixel dimensions.
function syncOverlaySize() {
    if (!overlayCanvas) return;
    const dispW = parseInt(canvas.style.width)  || canvas.width;
    const dispH = parseInt(canvas.style.height) || canvas.height;
    overlayCanvas.width  = dispW;
    overlayCanvas.height = dispH;
    overlayCanvas.style.width  = dispW + 'px';
    overlayCanvas.style.height = dispH + 'px';
}

// Convert image-space coordinate to display-space coordinate.
// image-pixel (ix, iy) → display-pixel (dx, dy).
// scale = display-pixels per image-pixel = zoomSteps[currentZoomIndex] / 100.
function imageToDisplay(imageCoord) {
    const scale = zoomSteps[currentZoomIndex] / 100;
    return imageCoord * scale;
}

// ─────────────────────────────────────────────────────────────
// MARCHING ANTS ANIMATION
// ─────────────────────────────────────────────────────────────
function startMarchingAnts() {
    if (marchingRaf) return; // already running
    function tick() {
        antPhase = (antPhase + ANT_SPEED) % ANT_PERIOD;
        redrawOverlay();
        marchingRaf = selection ? requestAnimationFrame(tick) : null;
    }
    marchingRaf = requestAnimationFrame(tick);
}

function stopMarchingAnts() {
    if (marchingRaf) {
        cancelAnimationFrame(marchingRaf);
        marchingRaf = null;
    }
}

// Draw the marching-ants marquee and 8 selection handles on the overlay.
// All coordinates are in display-pixels (overlay intrinsic space).
function redrawOverlay() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!selection) return;

    const { x, y, w, h } = normalizeRect(selection);
    const dx  = imageToDisplay(x);
    const dy  = imageToDisplay(y);
    const drw = imageToDisplay(w + 1);  // inclusive rect width in display-pixels
    const drh = imageToDisplay(h + 1);

    // ── Marching ants ────────────────────────────────────────
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([4, 4]);
    overlayCtx.strokeStyle    = 'rgba(255,255,255,0.9)';
    overlayCtx.lineDashOffset = -antPhase;
    overlayCtx.strokeRect(dx + 0.5, dy + 0.5, drw, drh);
    overlayCtx.strokeStyle    = 'rgba(0,0,0,0.9)';
    overlayCtx.lineDashOffset = -(antPhase + 4);
    overlayCtx.strokeRect(dx + 0.5, dy + 0.5, drw, drh);
    overlayCtx.setLineDash([]);

    // ── 8 control handles ────────────────────────────────────
    // Centers in display-pixels: corners + midpoints
    const cx = dx + drw / 2, cy = dy + drh / 2;
    const handlePositions = {
        nw: [dx,       dy      ],  n: [cx,       dy      ],  ne: [dx + drw, dy      ],
         w: [dx,       cy      ],                              e: [dx + drw, cy      ],
        sw: [dx,       dy + drh],  s: [cx,       dy + drh], se: [dx + drw, dy + drh]
    };
    const HS = 4; // half-side of handle square in display-pixels
    overlayCtx.setLineDash([]);
    for (const [, [hx, hy]] of Object.entries(handlePositions)) {
        overlayCtx.fillStyle   = '#ffffff';
        overlayCtx.fillRect(hx - HS, hy - HS, HS * 2, HS * 2);
        overlayCtx.strokeStyle = '#000000';
        overlayCtx.lineWidth   = 1;
        overlayCtx.strokeRect(hx - HS + 0.5, hy - HS + 0.5, HS * 2 - 1, HS * 2 - 1);
    }
}

// Return display-pixel positions of all 8 handles for the current selection.
function getHandlePositions() {
    if (!selection) return null;
    const { x, y, w, h } = normalizeRect(selection);
    const dx  = imageToDisplay(x),  dy  = imageToDisplay(y);
    const drw = imageToDisplay(w + 1), drh = imageToDisplay(h + 1);
    const cx  = dx + drw / 2,       cy  = dy + drh / 2;
    return {
        nw: [dx,       dy      ],  n: [cx,       dy      ],  ne: [dx + drw, dy      ],
         w: [dx,       cy      ],                              e: [dx + drw, cy      ],
        sw: [dx,       dy + drh],  s: [cx,       dy + drh], se: [dx + drw, dy + drh]
    };
}

// Cursor names per handle
const HANDLE_CURSORS = {
    nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
     w: 'w-resize',                   e: 'e-resize',
    sw: 'sw-resize', s: 's-resize',  se: 'se-resize'
};

// Hit-test: return handle key if mouse (display-px) is over a handle, else null.
function hitTestHandle(dpx, dpy) {
    const positions = getHandlePositions();
    if (!positions) return null;
    for (const [key, [hx, hy]] of Object.entries(positions)) {
        if (Math.abs(dpx - hx) <= HANDLE_RADIUS && Math.abs(dpy - hy) <= HANDLE_RADIUS) {
            return key;
        }
    }
    return null;
}

// Convert display-pixel coords to image-pixel coords (inverse of imageToDisplay)
function displayToImage(dpCoord) {
    const scale = zoomSteps[currentZoomIndex] / 100;
    return Math.floor(dpCoord / scale);
}

// ─────────────────────────────────────────────────────────────
// SELECTION HELPERS
// ─────────────────────────────────────────────────────────────
function normalizeRect({ x, y, w, h }) {
    return {
        x: w < 0 ? x + w : x,
        y: h < 0 ? y + h : y,
        w: Math.abs(w),
        h: Math.abs(h)
    };
}

function clearSelection() {
    selection = null;
    stopMarchingAnts();
    redrawOverlay();
}

// ─────────────────────────────────────────────────────────────
// ACTIVE TOOL SWITCHER
// ─────────────────────────────────────────────────────────────
// Return the CSS cursor for the currently active tool.
// Used by mousemove to restore the cursor after hovering a handle.
function currentToolCursor() {
    const cursors = {
        'pencil':        'crosshair',
        'eraser':        'cell',
        'bucket':        'crosshair',
        'replace-color': 'crosshair',
        'select-rect':   'default',
        'eyedropper':    'crosshair'
    };
    return cursors[currentTool] || 'crosshair';
}

function setActiveTool(name) {
    currentTool = name;
    localStorage.setItem('paintlab_tool', name);

    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
    const btn = document.getElementById('tool-' + name);
    if (btn) btn.classList.add('active-tool');

    if (name !== 'select-rect') clearSelection();

    const cursors = {
        'pencil':        'crosshair',
        'eraser':        'cell',
        'bucket':        'crosshair',
        'replace-color': 'crosshair',
        'select-rect':   'default',
        'eyedropper':    'crosshair'
    };
    // Cursor is always set on canvas (the event receiver).
    // overlayCanvas has pointer-events:none and never receives events.
    if (canvas) canvas.style.cursor = cursors[name] || 'crosshair';
}

// ─────────────────────────────────────────────────────────────
// SESSION SNAPSHOT
// ─────────────────────────────────────────────────────────────
// Writes the current canvas to IndexedDB under 'autosave_canvas'
// so the working image survives a page refresh (point 4 of persistence
// semantics). This is NOT image autosave — it is called only from
// explicit user actions (Image Bank save, canvas resize, drag-drop load)
// and NOT from paint strokes. Paint strokes do not trigger persistence.
async function writeSessionSnapshot() {
    try {
        await dbSet('autosave_canvas', canvas.toDataURL('image/png'));
    } catch (err) {
        console.warn('Session snapshot failed', err);
    }
}

// ─────────────────────────────────────────────────────────────
// JS ↔ PYTHON BRIDGE
// ─────────────────────────────────────────────────────────────
window.getCanvasBase64 = function () {
    return canvas.toDataURL('image/png');
};

window.setCanvasFromBase64 = function (base64Data) {
    const img = new Image();
    img.onload = function () {
        historySave(); // capture state before applying new image
        canvas.width  = img.width;
        canvas.height = img.height;
        const aw = document.getElementById('attr-width');
        const ah = document.getElementById('attr-height');
        if (aw) aw.value = img.width;
        if (ah) ah.value = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        syncOverlaySize();
        clearSelection();
        applyZoom();
        printToConsole('System: Canvas updated.\n', 'out-system');
    };
    img.src = base64Data.startsWith('data:')
        ? base64Data
        : 'data:image/png;base64,' + base64Data;
};

// Look up an Image Bank entry by name and return its base64 PNG data URL.
// Called by Python get_image(name). Returns null if not found.
// Async — returns a Promise that Python awaits via js.getImageBankBase64(name).
window.getImageBankBase64 = async function (name) {
    try {
        const entries = await dbGetAllSavedImages();
        const match = entries.find(e => e.data.name === name);
        if (!match) return null;
        return match.data.base64;
    } catch (err) {
        console.warn('getImageBankBase64 error:', err);
        return null;
    }
};

// Return a base64 PNG data URL of the current selection region.
// Called by Python get_selection(). Returns null if no selection.
window.getSelectionBase64 = function () {
    if (!selection) return null;
    const { x, y, w, h } = normalizeRect(selection);
    // Inclusive dimensions: w+1 image-pixels wide, h+1 image-pixels tall
    const sw = w + 1;
    const sh = h + 1;
    const tmp    = document.createElement('canvas');
    tmp.width    = sw;
    tmp.height   = sh;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(canvas, x, y, sw, sh, 0, 0, sw, sh);
    return tmp.toDataURL('image/png');
};

// Save a PIL image (as base64 PNG) to the Image Bank by name.
// Called by Python save_image(img, name). Overwrites if name exists.
window.saveImageToBank = async function (name, base64Data) {
    try {
        const b64 = base64Data.startsWith('data:')
            ? base64Data
            : 'data:image/png;base64,' + base64Data;
        const entries     = await dbGetAllSavedImages();
        const existingIdx = entries.findIndex(e => e.data.name === name);
        if (existingIdx !== -1) {
            const existing  = entries[existingIdx];
            existing.data.base64 = b64;
            await dbSet(existing.id, existing.data);
        } else {
            await dbSet('bank_' + Date.now(), { name, base64: b64 });
        }
        if (typeof refreshImageBankUI === 'function') refreshImageBankUI();
        printToConsole(`System: Saved image "${name}" to Image Bank.\n`, 'out-system');
        return true;
    } catch (err) {
        console.warn('saveImageToBank failed', err);
        return false;
    }
};

// ─────────────────────────────────────────────────────────────
// COLOR PREVIEW — called from canvas.js and from app.js after restore
// ─────────────────────────────────────────────────────────────
// Exposed at module scope so app.js can call it after restoring saved values.
function refreshColorPreview() {
    const preview     = document.getElementById('fg-color-preview');
    const alphaNumber = document.getElementById('fg-alpha-number');
    if (!preview) return;

    const [r, g, b] = hexToRGBParts(fgHex);
    const a01       = (fgAlpha / 255).toFixed(3);

    // Solid colour layer over checkerboard — transparency visually indicated
    preview.style.background =
        `linear-gradient(rgba(${r},${g},${b},${a01}), rgba(${r},${g},${b},${a01})),` +
        `conic-gradient(#c0c0c0 25%, #fff 0 50%, #c0c0c0 0 75%, #fff 0)`;
    preview.style.backgroundSize = 'auto, 8px 8px';

    // Keep both alpha controls in sync with current state
    const alphaRange = document.getElementById('fg-alpha');
    if (alphaRange)  alphaRange.value  = fgAlpha;
    if (alphaNumber) alphaNumber.value = fgAlpha;
}

// ─────────────────────────────────────────────────────────────
// SELECTION HANDLE DRAG
// ─────────────────────────────────────────────────────────────
// Apply drag for active handle: update selection bounds in image-space.
// Only selection geometry changes — pixels are untouched.
function applyHandleDrag(ix, iy) {
    if (!activeHandle || !selectionAtDragStart) return;
    const s   = selectionAtDragStart;
    const sel = { ...s };

    // Each handle controls which edge(s) move:
    //   nw: top+left   n: top       ne: top+right
    //    w: left                     e: right
    //   sw: bottom+left s: bottom   se: bottom+right
    //
    // sel.x/y is the top-left corner, sel.w/h is the drag vector to bottom-right.
    // We compute right = x + w, bottom = y + h, then adjust the appropriate edges.
    let l = s.x, t = s.y, r = s.x + s.w, b = s.y + s.h;

    if (activeHandle.includes('w')) l = Math.min(ix, r);  // drag left edge
    if (activeHandle.includes('e')) r = Math.max(ix, l);  // drag right edge
    if (activeHandle.includes('n')) t = Math.min(iy, b);  // drag top edge
    if (activeHandle.includes('s')) b = Math.max(iy, t);  // drag bottom edge

    // Clamp to canvas bounds
    l = Math.max(0, Math.min(l, canvas.width  - 1));
    r = Math.max(0, Math.min(r, canvas.width));
    t = Math.max(0, Math.min(t, canvas.height - 1));
    b = Math.max(0, Math.min(b, canvas.height));

    selection = { x: l, y: t, w: r - l, h: b - t };
    redrawOverlay();
}

// ─────────────────────────────────────────────────────────────
// CLIPBOARD
// ─────────────────────────────────────────────────────────────
// Copy selected pixels to system clipboard as PNG.
async function clipboardCopy() {
    if (!selection) return;
    const { x, y, w, h } = normalizeRect(selection);
    const sw = w + 1, sh = h + 1; // inclusive dimensions

    const tmp    = document.createElement('canvas');
    tmp.width    = sw; tmp.height = sh;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(canvas, x, y, sw, sh, 0, 0, sw, sh);

    try {
        const blob = await new Promise(resolve => tmp.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);
        printToConsole(`System: Copied ${sw}×${sh} pixels to clipboard.
`, 'out-system');
    } catch (err) {
        printToConsole(`System: Clipboard write failed — ${err.message}
`, 'out-stderr');
    }
}

// Cut: copy then clear selected pixels (respects transparency mode).
async function clipboardCut() {
    if (!selection) return;
    await clipboardCopy();

    historySave();
    const { x, y, w, h } = normalizeRect(selection);
    const sw = w + 1, sh = h + 1;
    if (transparencyMode === 'transparent') {
        ctx.clearRect(x, y, sw, sh);
    } else {
        ctx.fillStyle = defaultBgColor;
        ctx.fillRect(x, y, sw, sh);
    }
    printToConsole(`System: Cut ${sw}×${sh} pixels.
`, 'out-system');
}

// Paste clipboard image: draw at selection origin (or canvas top-left).
// After paste: select the pasted region and save history.
async function clipboardPaste() {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (!imageType) continue;

            const blob = await item.getType(imageType);
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            await new Promise((resolve, reject) => {
                img.onload  = resolve;
                img.onerror = reject;
                img.src     = url;
            });
            URL.revokeObjectURL(url);

            // Paste origin: current selection top-left, or (0,0)
            const ox = selection ? normalizeRect(selection).x : 0;
            const oy = selection ? normalizeRect(selection).y : 0;

            historySave();
            ctx.drawImage(img, ox, oy); // composite paste (respects RGBA)

            // Select the pasted region
            selection = { x: ox, y: oy, w: img.width - 1, h: img.height - 1 };
            startMarchingAnts();

            const pw = img.width, ph = img.height;
            printToConsole(`System: Pasted ${pw}×${ph} image at (${ox}, ${oy}).
`, 'out-system');
            return; // use first image item only
        }
        printToConsole(`System: No image on clipboard.
`, 'out-system');
    } catch (err) {
        printToConsole(`System: Clipboard read failed — ${err.message}
`, 'out-stderr');
    }
}

// ─────────────────────────────────────────────────────────────
// SETUP — wires all DOM elements; called from app.js Phase 1
// ─────────────────────────────────────────────────────────────
function setupCanvasDrawInteractions() {
    canvas     = document.getElementById('workspace-canvas');
    ctx        = canvas.getContext('2d');
    canvasArea = document.getElementById('canvas-draw-area');

    initOverlayCanvas();

    // ── Tool buttons ──────────────────────────────────────────
    document.getElementById('tool-pencil')      .addEventListener('click', () => setActiveTool('pencil'));
    document.getElementById('tool-eraser')      .addEventListener('click', () => setActiveTool('eraser'));
    document.getElementById('tool-bucket')      .addEventListener('click', () => setActiveTool('bucket'));
    document.getElementById('tool-replace-color').addEventListener('click', () => setActiveTool('replace-color'));
    document.getElementById('tool-select-rect') .addEventListener('click', () => setActiveTool('select-rect'));
    document.getElementById('tool-eyedropper')  .addEventListener('click', () => setActiveTool('eyedropper'));

    // ── RGBA color controls ───────────────────────────────────
    const hexInput    = document.getElementById('fg-color');
    const alphaRange  = document.getElementById('fg-alpha');
    const alphaNumber = document.getElementById('fg-alpha-number');

    // Shared handler — called whenever either alpha control changes value
    function applyAlpha(val) {
        fgAlpha = Math.max(0, Math.min(255, isNaN(val) ? 255 : val));
        alphaRange.value  = fgAlpha;
        alphaNumber.value = fgAlpha;
        syncForegroundColor();
        refreshColorPreview();
        localStorage.setItem('paintlab_fg_hex',   fgHex);
        localStorage.setItem('paintlab_fg_alpha', fgAlpha);
    }

    hexInput.addEventListener('input', (e) => {
        fgHex = e.target.value;
        syncForegroundColor();
        refreshColorPreview();
        localStorage.setItem('paintlab_fg_hex',   fgHex);
        localStorage.setItem('paintlab_fg_alpha', fgAlpha);
    });

    alphaRange .addEventListener('input', (e) => applyAlpha(parseInt(e.target.value, 10)));
    alphaNumber.addEventListener('input', (e) => applyAlpha(parseInt(e.target.value, 10)));
    alphaNumber.addEventListener('blur',  (e) => applyAlpha(parseInt(e.target.value, 10)));

    // Initial preview
    syncForegroundColor();
    refreshColorPreview();

    // ── Brush size stepper ────────────────────────────────────
    const brushInput = document.getElementById('brush-size');
    const brushDec   = document.getElementById('brush-dec');
    const brushInc   = document.getElementById('brush-inc');

    function setBrushSize(val) {
        val = Math.max(1, Math.min(64, isNaN(val) ? 1 : val));
        brushSize = val;
        brushInput.value = val;
        localStorage.setItem('paintlab_brush_size', val);
    }
    brushInput.addEventListener('input', (e) => setBrushSize(parseInt(e.target.value, 10)));
    brushDec.addEventListener('click', () => setBrushSize(brushSize - 1));
    brushInc.addEventListener('click', () => setBrushSize(brushSize + 1));

    // ── Mouse routing ─────────────────────────────────────────
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        // ── Handle hit-test first ─────────────────────────
        // Translate to display-px (same coord space as overlay/handles).
        // canvas and overlayCanvas share the same screen position and size.
        const rect = canvas.getBoundingClientRect();
        const dpx  = e.clientX - rect.left;
        const dpy  = e.clientY - rect.top;
        const h    = hitTestHandle(dpx, dpy);
        if (h) {
            // Consume this event for handle drag — do not route to tools
            e.preventDefault();
            activeHandle         = h;
            handleDragStart      = { dpx, dpy };
            selectionAtDragStart = { ...normalizeRect(selection) };
            canvas.style.cursor  = HANDLE_CURSORS[h];
            return;
        }

        const c = getCanvasCoords(e);

        if (currentTool === 'pencil' || currentTool === 'eraser') {
            isDrawing = true;
            lastX = c.x; lastY = c.y;
            currentTool === 'pencil' ? plotPencil(c.x, c.y) : plotEraser(c.x, c.y);

        } else if (currentTool === 'bucket') {
            historySave();
            floodFill(c.x, c.y);

        } else if (currentTool === 'replace-color') {
            historySave();
            replaceColor(c.x, c.y);

        } else if (currentTool === 'eyedropper') {
            // Sample exact RGBA from image-pixel at click location
            const px = ctx.getImageData(c.x, c.y, 1, 1).data;
            const r  = px[0], g = px[1], b = px[2], a = px[3];
            // Convert r,g,b to hex for the color input
            fgHex   = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
            fgAlpha = a;
            // Update hex input swatch
            const hexInput = document.getElementById('fg-color');
            if (hexInput) hexInput.value = fgHex;
            syncForegroundColor();
            refreshColorPreview();
            localStorage.setItem('paintlab_fg_hex',   fgHex);
            localStorage.setItem('paintlab_fg_alpha', fgAlpha);
            printToConsole(
                `System: Sampled RGBA(${r}, ${g}, ${b}, ${a}).\n`,
                'out-system'
            );

        } else if (currentTool === 'select-rect') {
            // Starting a new drag clears any existing selection
            stopMarchingAnts();
            redrawOverlay(); // clear old marquee immediately
            isSelecting = true;
            selStart    = { x: c.x, y: c.y };
            selection   = { x: c.x, y: c.y, w: 0, h: 0 };
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const dpx  = e.clientX - rect.left;
        const dpy  = e.clientY - rect.top;

        // ── Active handle drag ────────────────────────────
        if (activeHandle) {
            const ix = Math.max(0, Math.min(canvas.width  - 1, displayToImage(dpx)));
            const iy = Math.max(0, Math.min(canvas.height - 1, displayToImage(dpy)));
            applyHandleDrag(ix, iy);
            return; // handle drag is exclusive — skip tool processing
        }

        // ── Cursor: show resize hint when hovering a handle ───
        const h = hitTestHandle(dpx, dpy);
        canvas.style.cursor = h ? HANDLE_CURSORS[h] : currentToolCursor();

        const c = getCanvasCoords(e);

        if (isDrawing) {
            const fn = currentTool === 'pencil' ? plotPencil : plotEraser;
            drawBresenhamLine(lastX, lastY, c.x, c.y, fn);
            lastX = c.x; lastY = c.y;
        }

        if (isSelecting && selStart) {
            selection = { x: selStart.x, y: selStart.y,
                          w: c.x - selStart.x, h: c.y - selStart.y };
            redrawOverlay(); // live preview while dragging (no RAF needed)
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            historySave(); // one snapshot per completed stroke
        }

        if (isSelecting) {
            isSelecting = false;
            if (selection) {
                const norm = normalizeRect(selection);
                // norm.w/h is the drag vector magnitude (endPx - startPx).
                // A same-pixel click gives w=0, which is a valid 1×1 selection.
                // No negative check needed — normalizeRect already takes abs().
                // Store the normalised drag-vector rect for rendering.
                selection = norm;
                startMarchingAnts();
                // Reported dimensions are inclusive pixel counts: +1 on each axis.
                // Dragging from pixel 0 to pixel 9 → vector 9 → 10 pixels selected.
                const reportW = norm.w + 1;
                const reportH = norm.h + 1;
                printToConsole(
                    `System: Selection — ${reportW}×${reportH} at (${norm.x}, ${norm.y}).\n`,
                    'out-system'
                );
            }
        }
    });

    // Escape clears selection | Ctrl+Z undo | Ctrl+Y redo
    // Debounce undo/redo: 100ms cooldown prevents key-repeat from
    // racing through the entire history stack on a held keypress.
    let lastUndoRedoTime = 0;
    const UNDO_DEBOUNCE_MS = 100;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && selection) {
            clearSelection();
            return;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            const now = Date.now();
            if (now - lastUndoRedoTime >= UNDO_DEBOUNCE_MS) {
                lastUndoRedoTime = now;
                historyUndo();
            }
        } else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
            e.preventDefault();
            const now = Date.now();
            if (now - lastUndoRedoTime >= UNDO_DEBOUNCE_MS) {
                lastUndoRedoTime = now;
                historyRedo();
            }
        }
    });

    // ── Alt + Scroll zoom ─────────────────────────────────────
    canvasArea.addEventListener('wheel', (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        if (e.deltaY < 0 && currentZoomIndex < zoomSteps.length - 1) currentZoomIndex++;
        else if (e.deltaY > 0 && currentZoomIndex > 0) currentZoomIndex--;
        applyZoom();
    }, { passive: false });

    // ── Clipboard: Ctrl+C copy, Ctrl+X cut, Ctrl+V paste ─────
    // Uses Web Clipboard API (requires HTTPS or localhost).
    window.addEventListener('keydown', async (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;

        if (e.key === 'c' && selection) {
            e.preventDefault();
            await clipboardCopy();
        } else if (e.key === 'x' && selection) {
            e.preventDefault();
            await clipboardCut();
        } else if (e.key === 'v') {
            e.preventDefault();
            await clipboardPaste();
        }
    });

    // ── Selection handle interaction — routed through canvas ─────
    // overlayCanvas has pointer-events:none. All events arrive on canvas.
    // We convert canvas display-coords to overlay-space for handle hit-testing.
    // canvasToDisplayPx: canvas.getBoundingClientRect() gives us the same
    // screen position as the overlay, since both are same size + position.

    window.addEventListener('mouseup', () => {
        if (activeHandle) {
            activeHandle         = null;
            handleDragStart      = null;
            selectionAtDragStart = null;
            // Restore tool cursor after handle drag
            canvas.style.cursor  = currentToolCursor();
        }
    });

    // ── Drag-and-drop image import ────────────────────────────
    canvasArea.addEventListener('dragenter', (e) => { e.preventDefault(); canvasArea.classList.add('drag-hover'); });
    canvasArea.addEventListener('dragover',  (e) => { e.preventDefault(); canvasArea.classList.add('drag-hover'); });
    canvasArea.addEventListener('dragleave', (e) => { e.preventDefault(); canvasArea.classList.remove('drag-hover'); });
    canvasArea.addEventListener('drop', (e) => {
        e.preventDefault();
        canvasArea.classList.remove('drag-hover');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            printToConsole('System Error: Dropped file is not an image.\n', 'out-stderr');
            return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                canvas.width  = img.width;
                canvas.height = img.height;
                const aw = document.getElementById('attr-width');
                const ah = document.getElementById('attr-height');
                if (aw) aw.value = img.width;
                if (ah) ah.value = img.height;
                historySave(); // capture before drag-drop replaces canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                syncOverlaySize();
                clearSelection();
                setActiveImageName(null);  // dropped file has no bank identity
                applyZoom();
                printToConsole(`System: Loaded "${file.name}" (${img.width}×${img.height}).\n`, 'out-system');
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });
}
