/* ============================================================
   ui/inspector.js — JinjaWorkbench
   Render Inspector — the domain surface that replaces the canvas.

   Four read-only tabs:
     Template  — the raw template source that was rendered
     Context   — the JSON-serialized context dict passed to Jinja2
     Output    — the exact string returned by Jinja2
     Preview   — the Output after preprocessing, rendered in a
                 sandboxed iframe

   Preview Pipeline (Pass 2):
     Rendered HTML → resolveProjectResources() → iframe

   resolveProjectResources() walks the HTML for references to
   project-local static assets and embeds their content before
   the document is written to the iframe. Students write ordinary
   HTML; the Workbench adapts to it transparently.

   All panels are read-only. Students edit source artifacts in
   Monaco. The Inspector is a debugger, not an editor.
   ============================================================ */

// ── State ─────────────────────────────────────────────────────
let _lastResult = null; // { templatePath, templateSource, contextJson, output }
let _activeTab  = 'output'; // default — most important educational artifact

// ── Tab switching ─────────────────────────────────────────────
function setupInspectorTabs() {
    document.querySelectorAll('.inspector-tab').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
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

    if (_lastResult) populateTab(name, _lastResult);
}

// ── Populate a single tab ─────────────────────────────────────
// populatePreviewTab is async (reads IndexedDB); the others are sync.
// populateTab returns a Promise so callers can await if needed.
function populateTab(name, result) {
    switch (name) {
        case 'template': populateTemplateTab(result); return Promise.resolve();
        case 'context':  populateContextTab(result);  return Promise.resolve();
        case 'output':   populateOutputTab(result);   return Promise.resolve();
        case 'preview':  return populatePreviewTab(result);
        default:         return Promise.resolve();
    }
}

function populateTemplateTab({ templateSource }) {
    const el = document.getElementById('inspector-template');
    if (el) el.textContent = templateSource;
}

function populateContextTab({ contextJson }) {
    const el = document.getElementById('inspector-context');
    if (el) el.textContent = contextJson;
}

function populateOutputTab({ output }) {
    const el = document.getElementById('inspector-output');
    if (el) el.textContent = output;
}

async function populatePreviewTab({ output }) {
    const iframe = document.getElementById('inspector-preview-iframe');
    if (!iframe) return;

    // ── Preview pipeline ──────────────────────────────────────
    // Pass the raw rendered string through the preprocessor before
    // writing it to the iframe. The Output tab always shows the
    // original unmodified string; only the Preview sees the resolved
    // version. Students are never aware this step exists.
    const prepared = await resolveProjectResources(output);

    iframe.srcdoc = prepared;
}

// ══════════════════════════════════════════════════════════════
// Preview Preprocessor — resolveProjectResources()
//
// Parses the rendered HTML string, finds references to project-local
// static assets, reads them from the virtual project filesystem
// (IndexedDB), and replaces the references with embedded content.
//
// Pipeline:
//   Rendered HTML
//     → DOMParser (parse into document)
//     → each registered handler runs in order
//     → XMLSerializer (serialize back to string)
//     → iframe
//
// Adding a new resource type:
//   Add one entry to RESOURCE_HANDLERS below. Each handler receives
//   the parsed document and a lookup function, and returns a Promise.
//   No other code needs to change.
// ══════════════════════════════════════════════════════════════

// ── Path normalisation ────────────────────────────────────────
// Treat these as equivalent and project-local:
//   static/css/style.css
//   ./static/css/style.css
//
// Absolute URLs (http://, https://, //, data:) and root-relative
// paths starting with / that don't match static/ are left alone.
function normaliseHref(href) {
    if (!href) return null;
    // Strip leading ./ — makes ./static/... equivalent to static/...
    let path = href.replace(/^\.\//, '');
    // A bare static/... or the stripped form is project-local
    if (path.startsWith('static/')) return path;
    // Everything else (absolute URLs, other relative paths) is external
    return null;
}

// ── Virtual filesystem lookup ─────────────────────────────────
// Returns the file content string for a project-relative path,
// or null if the file doesn't exist in the virtual project.
async function readProjectFile(projectPath) {
    try {
        const record = await dbProjectFindByPath(projectPath);
        return (record && record.data && record.data.content != null)
            ? record.data.content
            : null;
    } catch (e) {
        return null;
    }
}

// ── Resource handlers ─────────────────────────────────────────
// Each handler is an async function(doc, readFile) → void.
// They mutate the parsed document in place.
//
// To add a new resource type (e.g. <img src="static/...">,
// <script src="static/...">), append a new entry here.
const RESOURCE_HANDLERS = [

    // ── CSS: <link rel="stylesheet" href="static/..."> ───────
    // Replaced with an inline <style> element containing the
    // file's content. The <link> element is removed.
    async function inlineStylesheets(doc, readFile) {
        const links = Array.from(
            doc.querySelectorAll('link[rel="stylesheet"][href]')
        );
        for (const link of links) {
            const projectPath = normaliseHref(link.getAttribute('href'));
            if (!projectPath) continue; // external — leave untouched

            const css = await readFile(projectPath);
            if (css === null) {
                // File not found — leave the <link> in place so the
                // student sees a missing-resource symptom rather than
                // silent failure. A future pass could add a console warning.
                continue;
            }

            const style = doc.createElement('style');
            // Preserve the original href as a comment so students
            // inspecting the Preview source can trace back to the file.
            style.setAttribute('data-src', projectPath);
            style.textContent = css;
            link.parentNode.replaceChild(style, link);
        }
    },

    // ── Future handlers go here ──────────────────────────────
    // Examples (not yet implemented):
    //
    // async function inlineImages(doc, readFile) { ... }
    //   <img src="static/..."> → <img src="data:image/...;base64,...">
    //
    // async function inlineScripts(doc, readFile) { ... }
    //   <script src="static/..."> → <script>...content...</script>
    //
    // async function inlineFavicon(doc, readFile) { ... }
    //   <link rel="icon" href="static/..."> → data: URI

];

// ── Main preprocessor entry point ────────────────────────────
async function resolveProjectResources(html) {
    // Guard: if there are no static/ references anywhere in the
    // string, skip parsing entirely — common case, zero cost.
    if (!html.includes('static/')) return html;

    let doc;
    try {
        doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
        // If parsing fails, return the original string unmodified.
        // The iframe will display whatever it can.
        return html;
    }

    // Run all handlers in sequence against the same document.
    for (const handler of RESOURCE_HANDLERS) {
        try {
            await handler(doc, readProjectFile);
        } catch (e) {
            // A handler failure must never break the Preview entirely.
            console.warn('Preview preprocessor handler failed:', e);
        }
    }

    // Serialize back to a string.
    // XMLSerializer preserves the full document including <!DOCTYPE>.
    return new XMLSerializer().serializeToString(doc);
}

// ── JS bridge entry point ─────────────────────────────────────
// Called by Python render_template() via js.setRenderResult().
window.setRenderResult = function(templatePath, templateSource, contextJson, output) {
    _lastResult = {
        templatePath:   String(templatePath),
        templateSource: String(templateSource),
        contextJson:    String(contextJson),
        output:         String(output),
    };

    const label = document.getElementById('inspector-template-label');
    if (label) label.textContent = String(templatePath);

    // populateTab returns a Promise for the preview tab;
    // we fire-and-forget here since there's nothing to await on.
    populateTab(_activeTab, _lastResult);

    const activeBtn = document.querySelector(`.inspector-tab[data-tab="${_activeTab}"]`);
    if (activeBtn) {
        activeBtn.classList.add('tab-flash');
        setTimeout(() => activeBtn.classList.remove('tab-flash'), 400);
    }

    printToConsole(`System: Rendered "${String(templatePath)}".\n`, 'out-system');
};

// ── Clear state ───────────────────────────────────────────────
function clearInspector() {
    _lastResult = null;
    const placeholder = '— run your program to see results —';
    const templateEl  = document.getElementById('inspector-template');
    const contextEl   = document.getElementById('inspector-context');
    const outputEl    = document.getElementById('inspector-output');
    const iframe      = document.getElementById('inspector-preview-iframe');
    if (templateEl) templateEl.textContent = placeholder;
    if (contextEl)  contextEl.textContent  = placeholder;
    if (outputEl)   outputEl.textContent   = placeholder;
    if (iframe)     iframe.srcdoc          = '';
}

// ── Setup ─────────────────────────────────────────────────────
function setupInspector() {
    setupInspectorTabs();
    clearInspector();
    activateTab(_activeTab);
}
