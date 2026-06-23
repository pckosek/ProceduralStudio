paintlab/
├── /templates/index.html              ← thin shell: HTML + ordered <script> tags
├── /static/js/app.js                  ← boot sequence (3-phase init, DOMContentLoaded)
├── /static/css/
│   └── styles.css          ← all styles extracted verbatim
├── /static/js/canvas/
│   └── canvas.js           ← zoom, coords, Bresenham, pencil/eraser,
│                             drag-drop, JS↔Python bridge
├── /static/js/editor/
│   └── editor.js           ← Monaco init, autosave, Ctrl+Enter shortcut,
│                             font/theme listeners
├── /static/js/runtime/
│   └── runtime.js          ← loadScript, Pyodide init, AMD workaround,
│                             bridge injection, Run button handler
├── /static/js/persistence/
│   └── db.js               ← IndexedDB: image store + code store operations
└── /static/js/ui/
    ├── console.js           ← printToConsole (stdout/stderr/system routing)
    ├── modal.js             ← Attributes modal (resize, bg color, transparency)
    └── banks.js             ← Image Bank + Code Bank (save/load/delete/rename)