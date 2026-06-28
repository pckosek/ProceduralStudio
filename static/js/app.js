/* ============================================================
   app.js — JinjaWorkbench boot sequence
   Three-phase startup (structure preserved from PixelWorkbench):
     Phase 1 — UI + local systems
     Phase 2 — Workspace state restoration
     Phase 3 — CDN runtime loading

   Graphics removed: no canvas, no zoom, no tools, no image bank.
   Domain addition: Render Inspector setup in Phase 1.
   ============================================================ */

async function initializeApplication() {
    const runBtn         = document.getElementById('run-btn');
    const runBtnLabel    = document.getElementById('run-btn-label');
    const fontSizeSelect = document.getElementById('font-size-select');
    const themeSelect    = document.getElementById('theme-select');

    // ================================================================
    // PHASE 1 — Wire UI and local subsystems
    // ================================================================
    setupInspector();             // ui/inspector.js — Render Inspector tabs
    setupActivityBar();           // ui/banks.js — sidebar shell
    setupConsoleClear();          // ui/banks.js — console clear button
    setupExplorerKeybindings();   // ui/explorer.js — Ctrl+S
    initImportInput();            // ui/export.js — bind ZIP file input
    setupRunButton();             // runtime/runtime.js
    setupSplitters();             // ui/splitters.js

    // ================================================================
    // PHASE 2 — Restore prior workspace state
    // ================================================================
    // No graphics state to restore (no zoom, tools, colors, canvas).
    // Project file identity is restored in Phase 3 after Monaco is ready.

    await refreshExplorerUI();

    // ================================================================
    // PHASE 3 — Load CDN runtimes in sequence
    // Order is intentional: Pyodide script before Monaco AMD loader exists.
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
        // Restore the previously-open project file after Monaco is ready
        await restoreActiveProjectFile();

        // 4. Pyodide runtime + Jinja2 bridge (AMD workaround inside)
        await initializePyodide();

        // Ready
        setStatus("Ready", "badge-ready");
        runBtn.disabled         = false;
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

window.addEventListener('DOMContentLoaded', initializeApplication);
