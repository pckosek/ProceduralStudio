/* ============================================================
   app.js — Application boot sequence
   Three-phase startup (preserved from original):
     Phase 1 — UI + local systems
     Phase 2 — Workspace restoration
     Phase 3 — CDN runtime loading

   Updated for new DOM IDs and layout. All behavioral
   semantics preserved from canonical source.
   ============================================================ */

async function initializeApplication() {
    const runBtn         = document.getElementById('run-btn');
    const runBtnLabel    = document.getElementById('run-btn-label');
    const fontSizeSelect = document.getElementById('font-size-select');
    const themeSelect    = document.getElementById('theme-select');

    // ================================================================
    // PHASE 1 — Wire UI and local subsystems
    // ================================================================
    setupCanvasDrawInteractions();   // canvas/canvas.js
    setupAttributesModalHandlers();  // ui/modal.js
    setupImageBankHandlers();        // ui/banks.js
    setupCodeBankHandlers();         // ui/banks.js
    setupActivityBar();              // ui/banks.js
    setupConsoleClear();             // ui/banks.js
    setupExplorerKeybindings();      // ui/explorer.js — Ctrl+S
    initImportInput();               // ui/export.js — bind static ZIP file input
    setupRunButton();                // runtime/runtime.js
    setupSplitters();                // ui/splitters.js

    // ================================================================
    // PHASE 2 — Restore prior workspace state
    // ================================================================

    // Zoom
    const savedZoom = localStorage.getItem("paintlab_zoom_idx");
    if (savedZoom !== null) currentZoomIndex = parseInt(savedZoom, 10);

    // Tool — setActiveTool handles all tools generically
    const savedTool = localStorage.getItem("paintlab_tool");
    if (savedTool) setActiveTool(savedTool);

    // Foreground color — restored as hex + alpha separately
    const savedFgHex   = localStorage.getItem("paintlab_fg_hex");
    const savedFgAlpha = localStorage.getItem("paintlab_fg_alpha");
    if (savedFgHex) {
        fgHex = savedFgHex;
        document.getElementById('fg-color').value = fgHex;
    }
    if (savedFgAlpha !== null) {
        fgAlpha = parseInt(savedFgAlpha, 10);
        document.getElementById('fg-alpha').value = fgAlpha;
        const alphaNum = document.getElementById('fg-alpha-number');
        if (alphaNum) alphaNum.value = fgAlpha;
    }
    // Sync the derived rgba string and repaint the preview swatch
    syncForegroundColor();
    refreshColorPreview();

    // Background color + transparency mode
    const savedBg    = localStorage.getItem("paintlab_default_bg");
    const savedTrans = localStorage.getItem("paintlab_transparency");
    if (savedBg)    defaultBgColor   = savedBg;
    if (savedTrans) transparencyMode = savedTrans;

    // Brush size
    const savedBrush = localStorage.getItem("paintlab_brush_size");
    if (savedBrush) {
        brushSize = parseInt(savedBrush, 10);
        document.getElementById('brush-size').value = brushSize;
    }

    // Canvas autosave (IndexedDB)
    let restored = false;
    try {
        const saved = await dbGet("autosave_canvas");
        if (saved) {
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    canvas.width  = img.width;
                    canvas.height = img.height;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    restored = true;
                    resolve();
                };
                img.src = saved;
            });
        }
    } catch (err) {
        console.warn("Session restore skipped:", err);
    }

    // Active image name — restore identity label
    const savedImageName = localStorage.getItem('paintlab_active_image_name');
    if (savedImageName) setActiveImageName(savedImageName);

    if (!restored) initDefaultCanvas();
    else historySave(); // seed history with restored canvas state
    // initDefaultCanvas already calls historySave() internally

    applyZoom();
    await refreshImageBankUI();
    await refreshExplorerUI();

    // ================================================================
    // PHASE 3 — Load CDN runtimes in sequence
    // Order is intentional: Pyodide first (before AMD exists),
    // Monaco AMD loader, Monaco editor, then Pyodide init
    // (AMD suppression workaround inside initializePyodide).
    // ================================================================
    try {
        // 1. Pyodide script (AMD does not yet exist — safe)
        setStatus("Loading…", "badge-loading");
        await loadScript("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

        // 2. Monaco AMD loader
        setStatus("Editor…", "badge-loading");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.js");

        // 3. Monaco editor instance
        await initializeMonacoEditor(fontSizeSelect);
        setupEditorInterfaceListeners(fontSizeSelect, themeSelect);
        // Restore the previously-open project file (if any) — must happen after
        // Monaco is ready. This overrides the localStorage autosave buffer with the
        // authoritative IndexedDB content, keeping label and content in sync.
        await restoreActiveProjectFile();

        // 4. Pyodide runtime + Pillow + bridge (AMD workaround inside)
        await initializePyodide();

        // Ready
        setStatus("Ready", "badge-ready");
        runBtn.disabled     = false;
        runBtnLabel.textContent = 'Run';
        printToConsole(
            "System: Environment ready. Ctrl+Enter or ▶ to run.\n",
            "out-system"
        );

    } catch (err) {
        setStatus("Error", "badge-error");
        runBtnLabel.textContent = 'Error';
        printToConsole(`Initialization failed: ${err.message}\n`, "out-stderr");
    }
}

// Expose setupImageBankHandlers / setupCodeBankHandlers as no-ops
// if banks.js already handles setup via setupActivityBar
function setupImageBankHandlers() { /* driven by activity bar + btn */ }
function setupCodeBankHandlers()  { /* driven by activity bar + btn */ }

window.addEventListener('DOMContentLoaded', initializeApplication);
