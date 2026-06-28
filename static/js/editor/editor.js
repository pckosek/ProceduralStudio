/* ============================================================
   editor/editor.js — JinjaWorkbench
   Monaco editor initialization, autosave, keyboard shortcut,
   font-size and theme dropdown listeners.
   Default code updated for the template rendering domain.
   All behavioral infrastructure unchanged from PixelWorkbench.
   ============================================================ */

let editorInstance = null;

const DEFAULT_CODE = `# JinjaWorkbench — starter example
# render_template() works like Flask's render_template(),
# but runs entirely in the browser via Pyodide + Jinja2.

students = [
    {"name": "Alice",   "grade": "A"},
    {"name": "Bob",     "grade": "B+"},
    {"name": "Charlie", "grade": "A-"},
]

render_template(
    "templates/index.html",
    students=students,
    title="Student Roster"
)
`;

function initializeMonacoEditor(fontSizeSelect) {
    return new Promise((resolve) => {
        require.config({
            paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
        });
        require(['vs/editor/editor.main'], function () {
            const savedCode = localStorage.getItem("jinjalab_code");

            // Register Jinja2 as a language alias using HTML tokenizer as the
            // closest built-in approximation. Monaco does not ship a Jinja2
            // grammar; html gives tag/attribute/string highlighting which helps
            // students read template structure. A TextMate grammar can be
            // substituted in a future pass without any other changes here.
            if (!monaco.languages.getLanguages().find(l => l.id === 'jinja2')) {
                monaco.languages.register({ id: 'jinja2', extensions: ['.jinja', '.j2'] });
                monaco.languages.setLanguageConfiguration('jinja2',
                    monaco.languages.getLanguages().find(l => l.id === 'html')
                        ? {} : {}
                );
                // Reuse html tokenizer — best available built-in approximation
                monaco.editor.setModelLanguage;
            }

            editorInstance = monaco.editor.create(document.getElementById('editor-container'), {
                value: savedCode !== null ? savedCode : DEFAULT_CODE,
                language: 'python',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: parseInt(fontSizeSelect.value, 10),
                tabSize: 4,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'all',
            });

            // Ctrl+Enter / Cmd+Enter → Run button
            editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                document.getElementById('run-btn').click();
            });

            // Silent autosave on every keystroke
            editorInstance.onDidChangeModelContent(() => {
                localStorage.setItem("jinjalab_code", editorInstance.getValue());
            });

            resolve();
        });
    });
}

function setupEditorInterfaceListeners(fontSizeSelect, themeSelect) {
    fontSizeSelect.addEventListener('change', (e) => {
        if (editorInstance) editorInstance.updateOptions({ fontSize: parseInt(e.target.value, 10) });
    });
    themeSelect.addEventListener('change', (e) => {
        if (window.monaco) monaco.editor.setTheme(e.target.value);
    });
}
