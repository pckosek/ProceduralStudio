/* ============================================================
   ui/inspector.js — JinjaWorkbench
   Render Inspector — the domain surface that replaces the canvas.

   Four read-only tabs:
     Template  — the raw template source that was rendered
     Context   — the JSON-serialized context dict passed to Jinja2
     Output    — the exact string returned by Jinja2
     Preview   — the Output interpreted as HTML in a sandboxed iframe

   All panels are read-only. Students edit source artifacts in
   Monaco. The Inspector is a debugger, not an editor.

   The bridge entry point is window.setRenderResult(), called by
   the Python render_template() function in runtime.js.
   ============================================================ */

// ── State ─────────────────────────────────────────────────────
// Holds the most recent render result so tabs can display it
// regardless of which tab was active at render time.
let _lastResult = null; // { templatePath, templateSource, contextJson, output }

let _activeTab = 'output'; // default tab — most educational artifact

// ── Tab switching ─────────────────────────────────────────────
function setupInspectorTabs() {
    document.querySelectorAll('.inspector-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            activateTab(tab);
        });
    });
}

function activateTab(name) {
    _activeTab = name;

    document.querySelectorAll('.inspector-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === name);
    });
    document.querySelectorAll('.inspector-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === name);
    });

    // If we already have a result, render the newly-active tab
    if (_lastResult) populateTab(name, _lastResult);
}

// ── Populate a single tab ─────────────────────────────────────
function populateTab(name, result) {
    switch (name) {
        case 'template': populateTemplateTab(result); break;
        case 'context':  populateContextTab(result);  break;
        case 'output':   populateOutputTab(result);   break;
        case 'preview':  populatePreviewTab(result);  break;
    }
}

function populateTemplateTab({ templatePath, templateSource }) {
    const el = document.getElementById('inspector-template');
    if (!el) return;
    // Show path as a header comment so students know which file rendered
    el.textContent = `{# ${templatePath} #}\n` + templateSource;
}

function populateContextTab({ contextJson }) {
    const el = document.getElementById('inspector-context');
    if (!el) return;
    el.textContent = contextJson;
}

function populateOutputTab({ output }) {
    const el = document.getElementById('inspector-output');
    if (!el) return;
    el.textContent = output;
}

function populatePreviewTab({ output }) {
    const iframe = document.getElementById('inspector-preview-iframe');
    if (!iframe) return;

    // Write the rendered HTML into the sandboxed iframe.
    // sandbox="allow-same-origin" is required for srcdoc + document.write.
    // allow-scripts is intentionally omitted in this first pass — script
    // execution is a separate educational topic and introduces security
    // surface that is not needed for template rendering lessons.
    // Students who need JS in their previews will discover this constraint
    // naturally; it can be made a workbench setting in a future pass.
    try {
        iframe.srcdoc = output;
    } catch (e) {
        // srcdoc not supported (very old browsers) — fall back to blob URL
        const blob = new Blob([output], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        iframe.src = url;
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
}

// ── JS bridge entry point ─────────────────────────────────────
// Called by Python render_template() via js.setRenderResult().
// All four arguments are plain strings.
window.setRenderResult = function(templatePath, templateSource, contextJson, output) {
    _lastResult = {
        templatePath:   String(templatePath),
        templateSource: String(templateSource),
        contextJson:    String(contextJson),
        output:         String(output),
    };

    // Update the inspector header to show which template rendered
    const label = document.getElementById('inspector-template-label');
    if (label) label.textContent = String(templatePath);

    // Populate active tab immediately; other tabs populate on click
    populateTab(_activeTab, _lastResult);

    // Flash the active tab indicator so students notice a new result
    const activeBtn = document.querySelector(`.inspector-tab[data-tab="${_activeTab}"]`);
    if (activeBtn) {
        activeBtn.classList.add('tab-flash');
        setTimeout(() => activeBtn.classList.remove('tab-flash'), 400);
    }

    printToConsole(`System: Rendered "${String(templatePath)}".\n`, 'out-system');
};

// ── Clear state (called before each run) ─────────────────────
// Not currently called automatically — the last render result
// persists until the next successful render_template() call.
// This mirrors the canvas behavior: last good output stays visible.
function clearInspector() {
    _lastResult = null;
    const placeholderText = '— run your program to see results —';

    const templateEl = document.getElementById('inspector-template');
    const contextEl  = document.getElementById('inspector-context');
    const outputEl   = document.getElementById('inspector-output');
    const iframe     = document.getElementById('inspector-preview-iframe');

    if (templateEl) templateEl.textContent = placeholderText;
    if (contextEl)  contextEl.textContent  = placeholderText;
    if (outputEl)   outputEl.textContent   = placeholderText;
    if (iframe)     iframe.srcdoc          = '';
}

// ── Setup ─────────────────────────────────────────────────────
function setupInspector() {
    setupInspectorTabs();
    // Set initial empty state
    clearInspector();
    // Activate default tab
    activateTab(_activeTab);
}
