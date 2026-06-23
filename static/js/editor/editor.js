/* ============================================================
   editor/editor.js
   Monaco editor initialization, autosave, keyboard shortcut,
   font-size and theme dropdown listeners.
   Updated to use #run-btn-label for the new header layout.
   All behavioral semantics preserved.
   ============================================================ */

let editorInstance = null;

const DEFAULT_CODE = `# PIL Image Bridge Test
from PIL import ImageOps

# 1. Grab current state of the browser canvas as a PIL Image
img = get_image()
print(f"Original dimensions: {img.size}")

# 2. Modify image (Invert RGB colors)
rgb_img = img.convert('RGB')
modified_img = ImageOps.invert(rgb_img)

# 3. Update the active workspace canvas
set_image(modified_img)`;

function initializeMonacoEditor(fontSizeSelect) {
    return new Promise((resolve) => {
        require.config({
            paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
        });
        require(['vs/editor/editor.main'], function () {
            const savedCode = localStorage.getItem("paintlab_code");

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

            // Ctrl+Enter / Cmd+Enter → Run button (identical execution path)
            editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                document.getElementById('run-btn').click();
            });

            // Silent autosave on every keystroke — session protection, not archival
            editorInstance.onDidChangeModelContent(() => {
                localStorage.setItem("paintlab_code", editorInstance.getValue());
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
