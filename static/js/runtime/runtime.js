/* ============================================================
   runtime/runtime.js — JinjaWorkbench
   Pyodide runtime initialization, AMD compatibility workaround,
   Jinja2 bridge injection, and the Run button execution pipeline.

   Bridge replaces PixelWorkbench's PIL/canvas API with:
     render_template(template_path, **context)
       — reads template file from Pyodide FS,
         renders it with Jinja2,
         passes result to JS via window.setRenderResult()

   No canvas. No PIL. No image store.
   ============================================================ */

let pyodideInstance = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src   = src;
        script.async = true;
        script.onload  = resolve;
        script.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(script);
    });
}

function setStatus(text, badgeClass) {
    const badge = document.getElementById('status-badge');
    badge.textContent = text;
    badge.className   = badgeClass;
}

async function initializePyodide() {
    // ── WORKAROUND: Monaco AMD loader and Pyodide conflict ──────────
    const originalAmd = window.define && window.define.amd;
    if (window.define) window.define.amd = false;

    setStatus("Python…", "badge-loading");
    pyodideInstance = await loadPyodide({
        stdout: (text) => printToConsole(text + '\n', 'out-stdout'),
        stderr: (text) => printToConsole(text + '\n', 'out-stderr')
    });

    // Jinja2 ships with Pyodide's standard library — no loadPackage needed.
    // If the Pyodide build does not include it, uncomment the line below:
    // await pyodideInstance.loadPackage("jinja2");

    // Restore Monaco AMD loader
    if (window.define && originalAmd) window.define.amd = originalAmd;
    // ────────────────────────────────────────────────────────────────

    setStatus("Bridge…", "badge-loading");

    // ── Jinja2 Bridge ────────────────────────────────────────────────
    // render_template() intentionally mirrors Flask's API surface so that
    // students who later use Flask encounter familiar syntax.
    //
    // The bridge's job:
    //   1. Read the template file from Pyodide's /project/ filesystem
    //   2. Render it with Jinja2 using the supplied context dict
    //   3. Hand the rendered string + metadata to JS via window.setRenderResult()
    //
    // Students never call window.setRenderResult() directly —
    // that is Workbench infrastructure. Students call render_template().
    // ────────────────────────────────────────────────────────────────
    pyodideInstance.runPython(`
import js
import json
from jinja2 import Environment, FileSystemLoader, TemplateNotFound, TemplateSyntaxError

def render_template(template_path, **context):
    """Render a Jinja2 template and display the result in the Render Inspector.

    Works like Flask's render_template() — pass the template path relative to
    the project root, followed by any template variables as keyword arguments.

    The Workbench intercepts the rendered output and populates the Render
    Inspector tabs (Template source, Context, Output, Preview).

    No return value. The rendered result is a side-effect visible in the UI.

    Examples:
        render_template("templates/index.html", title="Home", items=items)
        render_template("report.html", data=rows)
    """
    import os

    # Resolve the template path relative to the current working directory
    # (/project/ after syncProjectToPyodide sets os.chdir('/project'))
    cwd = os.getcwd()

    # Split the template_path into loader base dir + template name so that
    # Jinja2's FileSystemLoader can find {% include %} and {% extends %} siblings.
    # e.g. "templates/index.html" → base="/project/templates", name="index.html"
    # e.g. "report.html" → base="/project", name="report.html"
    parts = template_path.replace('\\\\', '/').split('/')
    template_name = parts[-1]
    template_subdir = '/'.join(parts[:-1])
    loader_base = os.path.join(cwd, template_subdir) if template_subdir else cwd

    # Read raw template source for the inspector
    full_path = os.path.join(cwd, template_path)
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            template_source = f.read()
    except FileNotFoundError:
        raise FileNotFoundError(
            f"render_template(): template not found: '{template_path}'\\n"
            f"Expected at /project/{template_path}"
        )

    # Render via Jinja2 FileSystemLoader so {% extends %} and {% include %}
    # resolve relative to the template's own directory.
    env = Environment(
        loader=FileSystemLoader(loader_base),
        autoescape=False,   # students see raw output; auto-escaping is a
                            # separate learning topic, not a default here
        keep_trailing_newline=True,
    )

    template = env.get_template(template_name)
    rendered = template.render(**context)

    # Serialize context for the inspector — convert to JSON-safe representation.
    # Non-serializable values fall back to their repr() string so the inspector
    # always shows something meaningful rather than crashing.
    def to_json_safe(obj, depth=0):
        if depth > 5:
            return repr(obj)
        if isinstance(obj, (str, int, float, bool, type(None))):
            return obj
        if isinstance(obj, dict):
            return {str(k): to_json_safe(v, depth+1) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [to_json_safe(i, depth+1) for i in obj]
        return repr(obj)

    context_json = json.dumps(to_json_safe(context), indent=2, ensure_ascii=False)

    # Hand all three artifacts to the JS Render Inspector
    js.setRenderResult(template_path, template_source, context_json, rendered)

import __main__
__main__.render_template = render_template
    `);

    window.pyodideInstance = pyodideInstance;

    // Sync all saved project files into Pyodide FS and chdir to /project
    await syncProjectToPyodide();
}

function setupRunButton() {
    const runBtn        = document.getElementById('run-btn');
    const runBtnLabel   = document.getElementById('run-btn-label');
    const consoleOutput = document.getElementById('console-output');

    runBtn.addEventListener('click', async () => {
        if (!pyodideInstance || !editorInstance) return;

        consoleOutput.textContent = '';
        runBtn.disabled         = true;
        runBtnLabel.textContent = 'Running…';
        setStatus("Running", "badge-loading");

        try {
            await pyodideInstance.runPythonAsync(editorInstance.getValue());
            setStatus("OK", "badge-ready");
        } catch (err) {
            setStatus("Error", "badge-error");
            printToConsole(err.message + '\n', 'out-stderr');
        } finally {
            runBtn.disabled         = false;
            runBtnLabel.textContent = 'Run';
        }
    });
}
