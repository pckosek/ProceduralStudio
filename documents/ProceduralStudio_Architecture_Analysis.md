# ProceduralStudio — Architecture Analysis
**Branch:** `jinja-workbench` · **Date:** June 2026
**Purpose:** Architecture inventory, subsystem documentation, reusability analysis, and Workbench Core recommendation.

---

## 1. Project Overview

ProceduralStudio (currently branded **PaintLab**) is a browser-only educational coding environment. It combines a Monaco code editor with a Python runtime (Pyodide + Pillow) and a pixel-canvas workspace. Students write Python, run it in the browser, and see pixel art output immediately — no server required.

The `jinja-workbench` branch is the live development branch. Despite its name, it does **not yet contain Jinja-specific features** — it is the latest stable state of PixelWorkbench, serving as the baseline for future workbench variants.

**Tech stack:**
- Flask (minimal: serves one Jinja2 template — `templates/index.html`)
- Monaco Editor (CDN, AMD loader)
- Pyodide 0.25 + Pillow (CDN)
- JSZip (CDN, lazy-loaded on first export)
- IndexedDB (browser-native persistence)
- localStorage (UI state, preferences, autosave buffer)
- Vanilla JS (no front-end framework)

---

## 2. Architecture Inventory — File Map

```
ProceduralStudio/
├── app.py                        Flask dev server (trivial)
├── templates/
│   └── index.html                Single-page app shell + all modals
└── static/
    ├── css/
    │   └── styles.css            VS Code-inspired design system (~700 lines CSS vars + rules)
    └── js/
        ├── app.js                Boot orchestrator (3-phase startup)
        ├── canvas/
        │   └── canvas.js         Graphics layer: tools, zoom, bridge, marching ants
        ├── editor/
        │   └── editor.js         Monaco init, autosave, keyboard shortcut
        ├── persistence/
        │   └── db.js             IndexedDB engine (3 object stores)
        ├── runtime/
        │   └── runtime.js        Pyodide init, bridge injection, Run button
        └── ui/
            ├── banks.js          Activity bar, sidebar, Image Bank, Code Bank, save-name modal
            ├── console.js        printToConsole() — output routing
            ├── explorer.js       Project Explorer: file tree, Pyodide FS sync, drag/drop
            ├── export.js         ZIP export + import
            ├── modal.js          Canvas Attributes modal
            └── splitters.js      Resizable panes (vertical + horizontal)
```

**Script load order** (from `index.html`):
```
console.js → db.js → canvas.js → editor.js → runtime.js → modal.js → banks.js → explorer.js → export.js → splitters.js → app.js
```

---

## 3. Subsystem Inventory

### 3.1 Editor Layer (`editor/editor.js` + portions of `app.js`)

**Purpose:** Embeds Monaco Editor as the primary code authoring surface.

**Responsibilities:**
- Monaco initialization via AMD `require()`
- Language set to `python` with `vs-dark` theme at startup
- Font size and theme dropdowns (header UI)
- Ctrl+Enter / Cmd+Enter → Run button click
- Silent keystroke autosave to `localStorage["paintlab_code"]`
- Default starter code template

**Dependencies:**
- Monaco 0.45 from cdnjs CDN (AMD loader + editor bundle)
- `editorInstance` global, consumed by `runtime.js` and `explorer.js`
- `printToConsole()` (from `console.js`)

**Public API (consumed by other modules):**
- `editorInstance` global — `getValue()`, `setValue()`, `setModel()`, `updateOptions()`
- `initializeMonacoEditor(fontSizeSelect)` → Promise
- `setupEditorInterfaceListeners(fontSizeSelect, themeSelect)`

**Coupling:**
- `runtime.js` reads `editorInstance.getValue()` to run code
- `explorer.js` calls `editorInstance.setModel()` on file open and reads `editorInstance.getValue()` on save
- `app.js` orchestrates initialization order

**Reusability:** The editor layer is **entirely generic**. The only workbench-specific detail is the default starter code (PIL/canvas example). Replacing that string makes this module immediately usable in JinjaWorkbench, AudioWorkbench, or any other text-editing context. The language passed to Monaco (`python`) could be made a configuration parameter.

---

### 3.2 Project Explorer (`ui/explorer.js`)

**Purpose:** File tree UI backed by IndexedDB. Replaces the earlier Code Bank. Mirrors the project file hierarchy into Pyodide's in-memory filesystem so Python `import` statements work.

**Responsibilities:**
- Virtual file tree (folders + files) with flat-path storage in IndexedDB
- Build nested tree from flat record list (`buildTree()`)
- Render tree DOM with depth indentation (`renderTree()`)
- File operations: create, open (→ Monaco), save, save-as, rename, delete
- Drag-and-drop node moves within the tree
- Collapse/expand folders (state in memory `collapsedFolders` Set)
- Monaco model switching on file open (language auto-detected from extension)
- Dirty state tracking (`editorDirty` flag)
- Pyodide FS mirror: `pyoWrite`, `pyoDelete`, `pyoRename`, `pyoMkdir`, `ensurePyoDirs`
- `syncProjectToPyodide()` — boot-time full sync of IndexedDB → `/project/` and `os.chdir('/project')`
- Session restore: `restoreActiveProjectFile()` — reads last open file from localStorage IDs
- Keyboard shortcuts: Ctrl+S (save), Ctrl+Shift+S (save as)
- Modals: save-name, save-as, rename (all Promise-based, non-blocking)
- Active file label in editor header
- Multi-extension language map (`.py`, `.json`, `.csv`, `.txt`, `.md`, `.js`, `.html`, `.css`, `.yaml`, `.toml`)

**Folder hierarchy model:**
Records in IndexedDB are flat: `{ type: 'file'|'folder', path: 'src/maze.py', content?, language? }`. Hierarchy is reconstructed at render time by splitting paths and building a tree map. Implicit intermediate folders (paths without explicit folder records) are supported.

**Active file management:**
- `activeProjectFile = { id, path }` module-level variable
- Persisted to `localStorage["paintlab_active_project_id"]` and `["paintlab_active_project_path"]`
- Restored at Phase 3 (after Monaco ready) via `restoreActiveProjectFile()`

**Drag/drop:**
- HTML5 drag API (`draggable="true"`, `dragstart/dragover/dragleave/drop/dragend`)
- Files are draggable sources; folders are both sources and drop targets
- `moveNode(sourcePath, targetFolderPath)` — cascades path rewrites for folder moves, updates Pyodide FS

**Project synchronization:**
- `syncProjectToPyodide()` runs at boot and after ZIP import
- Every file mutation calls `pyoWrite/pyoDelete/pyoRename` immediately
- Pyodide FS is treated as a downstream cache of IndexedDB

**Dependencies:**
- `db.js` (project store functions)
- `editorInstance` (from `editor.js`)
- `printToConsole()` (from `console.js`)
- `openSaveNameModal()` (from `banks.js`)
- `window.pyodideInstance` (from `runtime.js`)
- `downloadProject()`, `importProject()` triggered from tree header buttons (in `export.js`)

**Reusability for other workbenches:**

The Project Explorer is **fully generic** — it has zero dependency on canvas, images, or PIL. It stores arbitrary text files. The Pyodide FS sync is the only Python-specific concern, but it is self-contained and could be disabled (or replaced with a different FS sync strategy) for non-Python workbenches.

| Target workbench | Reusable as-is? | Notes |
|---|---|---|
| JinjaWorkbench | ✅ Yes | Jinja templates are text files; same file management applies |
| AudioWorkbench | ✅ Yes | Python/DSP code files managed identically |
| WebWorkbench | ✅ Yes | HTML/CSS/JS files supported by existing language map |
| Other educational tools | ✅ Yes | Only change needed: remove or isolate Pyodide FS sync if no Python runtime |

---

### 3.3 Persistence Layer (`persistence/db.js`)

**Purpose:** Provides the sole durable storage interface. All persistent state lives here or in localStorage.

**Architecture:**
Single IndexedDB database `PaintLabStorage` at version 3, with three object stores:

| Store | Key pattern | Contents |
|---|---|---|
| `images` | `bank_<timestamp>` or `autosave_canvas` | Image Bank entries `{ name, base64 }` + canvas autosave PNG data URL |
| `codes` | `code_<timestamp>` | Legacy Code Bank snippets (retained, unused by Explorer) |
| `project` | `proj_<timestamp>` | Project Explorer records `{ type, path, content?, language? }` |

**Public API:**
- `dbSet(key, value)` / `dbGet(key)` / `dbDelete(key)` / `dbGetAllSavedImages()` → image store
- `dbProjectSet(key, value)` / `dbProjectGet(key)` / `dbProjectDelete(key)` / `dbProjectGetAll()` / `dbProjectFindByPath(path)` → project store
- (Code store functions referenced from banks.js: `dbSetCode`, `dbDeleteCode`, `dbGetAllCodes` — note: these are called but not defined in the visible `db.js` source, suggesting they exist elsewhere or are legacy stubs)

**Autosave behavior:**
- **Editor content:** every keystroke → `localStorage["paintlab_code"]` (fast, synchronous, no IndexedDB overhead)
- **Canvas (session snapshot):** `writeSessionSnapshot()` called on explicit user actions only (Image Bank save, canvas resize, drag-drop load). Stored as PNG data URL in image store under key `"autosave_canvas"`. Not called on every paint stroke.
- **Project files:** saved explicitly via Ctrl+S or the save modal; no background polling.

**Explicit save behavior:**
- Image Bank: modal → `dbSet(key, { name, base64 })`
- Project file: Ctrl+S → `dbProjectSet(key, { content })`
- Canvas: `writeSessionSnapshot()` → `dbSet('autosave_canvas', dataURL)`

**Generic vs. graphics-specific components:**

| Component | Classification |
|---|---|
| `images` store (Image Bank data) | Graphics-specific |
| `autosave_canvas` entry in `images` store | Graphics-specific |
| `codes` store (legacy Code Bank) | Core Platform (generic snippets) |
| `project` store (Explorer files) | Core Platform (fully generic) |
| `dbSet/Get/Delete` API | Graphics-specific (used for image store) |
| `dbProjectSet/Get/Delete/GetAll` API | Core Platform |

For a future Workbench Core, the project store and its API should be extracted as the canonical persistence interface. The image store is specific to PixelWorkbench.

---

### 3.4 ZIP Import / Export (`ui/export.js`)

**Purpose:** Snapshot the entire workspace (project files + Image Bank) as a portable ZIP archive, and restore from one.

**Export architecture:**
- Lazy-loads JSZip from CDN on first call
- Creates two folders: `code/` (project files, hierarchy preserved) and `images/` (Image Bank PNGs)
- ZIP filename: `project-YYYY-MM-DD.zip`
- Purely browser-local: `canvas.toDataURL` → base64 → JSZip → `URL.createObjectURL` → `<a download>`

**Import architecture:**
- Reads ZIP via JSZip
- Validates presence of `code/` or `images/` folders
- Clears all existing project records and image bank entries first (replace semantics)
- Reconstructs IndexedDB from ZIP contents
- Calls `syncProjectToPyodide()` after import if Pyodide is ready
- Calls `refreshExplorerUI()` and `refreshImageBankUI()` to update the UI

**Archive format:**
```
project-YYYY-MM-DD.zip
├── code/
│   └── <path relative to project root>    (text files)
└── images/
    └── <name>.png                          (Image Bank PNGs)
```

**Dependencies:**
- JSZip 3.10.1 (CDN)
- `dbProjectGetAll()`, `dbProjectSet()`, `dbProjectDelete()` (project store)
- `dbGetAllSavedImages()`, `dbSet()`, `dbDelete()` (image store)
- `refreshExplorerUI()` (explorer.js)
- `refreshImageBankUI()` (banks.js)
- `syncProjectToPyodide()` (explorer.js)
- `setActiveProjectFile(null)` (explorer.js)
- `printToConsole()` (console.js)

**Reusability:**
The `code/` folder export/import path is **fully generic** — it maps directly to the project store and Explorer, with no graphics dependency. The `images/` folder handling is **graphics-specific**.

For a Workbench Core, the export module should be split:
- Generic: project file ZIP export/import (the `code/` half)
- Plugin: image bank ZIP export/import (the `images/` half)

A JinjaWorkbench or WebWorkbench would only need the `code/` half.

---

### 3.5 Pyodide Runtime (`runtime/runtime.js`)

**Purpose:** Initializes the Python execution environment and wires the Run button.

**Pyodide initialization:**
1. `loadPyodide()` — loads Pyodide 0.25 with stdout/stderr routed to `printToConsole()`
2. `pyodideInstance.loadPackage("pillow")` — installs Pillow
3. AMD suppression workaround: `window.define.amd = false` before Pyodide init, restored after (prevents conflict between Monaco's AMD loader and Pyodide's stackframe detection)
4. Bridge injection: `pyodideInstance.runPython(...)` installs `get_image`, `set_image`, `get_selection`, `save_image` as globals in `__main__`

**Runtime lifecycle:**
- Phase 3 of app boot (after Pyodide CDN script loads, Monaco is ready)
- `pyodideInstance` exposed as `window.pyodideInstance` so other modules can call FS operations
- No teardown/restart — single instance per page load

**Package loading:**
- Pillow is the only explicit package loaded
- Pyodide's standard library is available
- No micropip calls in the current codebase

**Execution model:**
- `pyodideInstance.runPythonAsync(code)` — one async execution per Run button click
- Console cleared before each run
- Errors caught and printed as `out-stderr`
- No sandboxing beyond what Pyodide provides

**Console output routing:**
- `stdout` → `printToConsole(text, 'out-stdout')`
- `stderr` → `printToConsole(text, 'out-stderr')`
- System messages (bridge, FS sync) → `printToConsole(text, 'out-system')`

**Reusability as a platform:**
The Pyodide initialization is moderately generic, but two things tie it to PixelWorkbench:
1. `loadPackage("pillow")` — Pillow is graphics-specific
2. The bridge injection block (see §3.6)

Extracting the generic parts (Pyodide init, AMD workaround, run button, stdout/stderr routing) into a `WorkbenchRuntime` module and making package loading and bridge injection configurable would create a reusable Python runtime platform.

---

### 3.6 Runtime Bridge (`runtime/runtime.js` + `canvas/canvas.js`)

This is the most architecturally significant seam. The bridge connects Python (Pyodide) to JavaScript (canvas, image storage, selection state).

#### Generic Bridge Capabilities

**Injected into Python `__main__` namespace by `runtime.js`:**

| Python function | JavaScript mechanism | Description |
|---|---|---|
| `get_image()` (no arg) | `window.getCanvasBase64()` | Canvas → PIL Image |
| `get_image("name")` | `window.getImageBankBase64(name)` | Image Bank → PIL Image |
| `set_image(pil_img)` | `window.setCanvasFromBase64(b64)` | PIL Image → Canvas |
| `get_selection()` | `window.getSelectionBase64()` | Selection region → PIL Image |
| `save_image(pil_img, name)` | `window.saveImageToBank(name, b64)` | PIL Image → Image Bank |

**The generic bridge pattern** is: Python functions wrap JS interop via `import js`, with base64 PNG as the data transport between the Pyodide world and the browser world.

The base64 PNG codec (`_b64_to_pil`, `pil_img.save(buffered, 'PNG')`) is a pure Python utility that would be needed in any PIL-based workbench. It is not inherently canvas-specific.

#### Graphics-Specific Bridge Capabilities

**Defined in `canvas.js` and exposed on `window`:**

| JS window function | Called from Python | Responsibility |
|---|---|---|
| `window.getCanvasBase64()` | `get_image()` | Serialize canvas to PNG data URL |
| `window.setCanvasFromBase64(b64)` | `set_image()` | Deserialize PNG, resize canvas, update display |
| `window.getImageBankBase64(name)` | `get_image("name")` | Lookup named image in IndexedDB |
| `window.saveImageToBank(name, b64)` | `save_image()` | Write PNG to Image Bank, refresh UI |
| `window.getSelectionBase64()` | `get_selection()` | Crop selection rectangle from canvas |

All five of these window-level functions directly read from or write to the HTML Canvas element or the Image Bank. They are entirely graphics-specific.

**Also relevant in `canvas.js` but not Python-facing:**
- `writeSessionSnapshot()` — used internally, calls `dbSet`
- `setCanvasFromBase64()` also calls `clearSelection()`, `applyZoom()`, `syncOverlaySize()` — tightly integrated with the canvas subsystem

#### Bridge Architecture Diagram

```
Python (Pyodide) __main__
    │
    ├── get_image()    ──→  js.getCanvasBase64()        →  canvas.toDataURL()
    │   get_image("x") ──→  js.getImageBankBase64("x")  →  dbGetAllSavedImages()
    │
    ├── set_image()    ──→  js.setCanvasFromBase64()    →  canvas resize + drawImage
    │
    ├── get_selection()──→  js.getSelectionBase64()    →  tmp canvas crop
    │
    └── save_image()   ──→  js.saveImageToBank()       →  dbSet() + refreshImageBankUI()
```

**What would need to change per workbench variant:**

| Workbench | Replace bridge with |
|---|---|
| JinjaWorkbench | `render_template(template_str, **context)` → returns rendered HTML string; `set_output(html_str)` → iframe/preview panel |
| AudioWorkbench | `get_audio()` / `set_audio()` using ArrayBuffer or base64 WAV; output to Web Audio API |
| WebWorkbench | `get_html()` / `get_css()` / `set_preview(html)` → sandboxed iframe |

The base64 transport pattern established here is sound and reusable as a pattern, but the specific functions are graphics-only.

---

### 3.7 Graphics Layer (`canvas/canvas.js` + `ui/modal.js` + portions of `ui/banks.js`)

**Purpose:** Everything related to the pixel canvas, paint tools, Image Bank, and selection state.

**Components:**

#### Canvas State & Zoom
- `canvas`, `ctx`, `canvasArea` DOM refs
- `zoomSteps` array + `currentZoomIndex` — CSS-only zoom (never resamples)
- `applyZoom()` — CSS width/height, overlay sync, badge update, localStorage persist
- `getCanvasCoords(e)` — mouse → image-pixel coordinate translation
- `initDefaultCanvas()` — starter gradient + text when no autosave exists

#### Paint Tools
- `currentTool` state + `setActiveTool(name)` — updates button UI + cursor
- Tool set: pencil, eraser, bucket (flood fill), replace-color (global replace), select-rect, eyedropper
- `hardPlot()` — hard RGBA assignment via `putImageData` (bypasses alpha compositing)
- `plotPencil()`, `plotEraser()`
- `drawBresenhamLine()` — sub-pixel line interpolation between mouse events
- `floodFill()` — 4-connected iterative flood fill via typed array
- `replaceColor()` — global RGBA exact-match replace
- Brush size stepper (1–64px)
- RGBA foreground color: hex input + alpha slider + alpha number + preview swatch

#### Undo/Redo History
- Snapshot-based via `ImageData` (no PNG encode/decode)
- Max 40 entries
- Ctrl+Z / Ctrl+Y with 100ms debounce

#### Selection System
- Rectangular selection drag
- `selection` state: `{ x, y, w, h }` in image-pixels, normalized
- `normalizeRect()` — handles negative-dimension drags
- `startMarchingAnts()` / `stopMarchingAnts()` — RAF-based animation
- `redrawOverlay()` — draws ants + 8 resize handles on overlay canvas
- `getHandlePositions()`, `hitTestHandle()` — handle interaction in display-px space
- `applyHandleDrag()` — resize selection by dragging handles
- Handle drag state: `activeHandle`, `handleDragStart`, `selectionAtDragStart`
- Clipboard: `clipboardCopy()`, `clipboardCut()`, `clipboardPaste()` via Web Clipboard API

#### Overlay Canvas
- `overlayCanvas` — separate canvas element, overlaid via absolute positioning in a wrapper div
- `pointer-events: none` — purely visual, all events go to main canvas
- Intrinsic size = display-pixels (not image-pixels), enabling hairline strokes at any zoom

#### JS ↔ Python Bridge (window-level)
- `window.getCanvasBase64()`
- `window.setCanvasFromBase64(b64)`
- `window.getImageBankBase64(name)`
- `window.getSelectionBase64()`
- `window.saveImageToBank(name, b64)`
(See §3.6 for full detail)

#### Image Bank (`ui/banks.js`)
- `refreshImageBankUI()` — renders bank entries (load / download / rename / delete)
- `triggerImageBankSave()` — save-name modal → dbSet → session snapshot
- `setActiveImageName(name)` — syncs identity label, localStorage
- `getAutogeneratedName()` — timestamp + canvas dimensions
- `writeSessionSnapshot()` — canvas → `autosave_canvas` IndexedDB entry
- Inline rename via contenteditable-style input swap

#### Canvas Attributes Modal (`ui/modal.js`)
- Canvas resize (W/H inputs)
- Default background color (white / black)
- Transparency mode (transparent / opaque)
- Resize preserves existing content top-left aligned

#### What would need to be replaced per workbench variant:

**JinjaWorkbench:** Remove entirely. Replace canvas column with a split-pane showing template source (Monaco) + rendered HTML preview (iframe). No paint tools, no Image Bank, no overlay canvas, no selection.

**AudioWorkbench:** Remove canvas. Replace with a waveform display (Web Audio API + Canvas or SVG), a timeline, and a spectrogram. Image Bank becomes a "Sample Bank". Selection becomes a time-range selection. Marching ants → time-range highlight.

**WebWorkbench:** Remove canvas paint tools. Keep the canvas area but replace it with a sandboxed iframe for HTML/CSS/JS preview. Image Bank becomes an "Asset Bank" (images and fonts). No selection system needed.

---

## 4. Reusability Analysis

### Classification Table

| Subsystem | Module | Classification | Reusable As-Is? | Notes |
|---|---|---|---|---|
| Editor (Monaco) | `editor/editor.js` | Core Platform | ✅ Yes | Default code is the only workbench-specific detail |
| Project Explorer | `ui/explorer.js` | Core Platform | ✅ Yes | Zero canvas dependency; text files only |
| Persistence — project store | `persistence/db.js` | Core Platform | ✅ Yes | Generic key-value + project tree storage |
| Persistence — image store | `persistence/db.js` | Graphics-Specific | ❌ No | Tightly coupled to Image Bank |
| Persistence — codes store | `persistence/db.js` | Core Platform | ⚠️ Legacy | Unused by Explorer; safe to drop |
| ZIP Export (code/ only) | `ui/export.js` | Core Platform | ✅ Yes | The `code/` export path is generic |
| ZIP Export (images/ only) | `ui/export.js` | Graphics-Specific | ❌ No | Image Bank-specific |
| Pyodide Runtime (init + run) | `runtime/runtime.js` | Core Platform | ⚠️ Partial | Remove Pillow; bridge injection is generic |
| Pyodide AMD workaround | `runtime/runtime.js` | Core Platform | ✅ Yes | Monaco + Pyodide conflict is universal |
| Console output routing | `ui/console.js` | Core Platform | ✅ Yes | Pure utility, no domain coupling |
| Splitters | `ui/splitters.js` | Core Platform | ✅ Yes | Pure layout utility |
| Activity bar + sidebar shell | `ui/banks.js` | Core Platform | ✅ Yes | Panel toggle logic is generic |
| Save-name modal | `ui/banks.js` | Core Platform | ✅ Yes | Generic text input modal |
| Runtime Bridge (generic pattern) | `runtime/runtime.js` | Core Platform | ⚠️ Pattern | base64 transport pattern reusable; specific functions are not |
| Runtime Bridge (JS window API) | `canvas/canvas.js` | Graphics-Specific | ❌ No | All 5 functions are canvas/image-specific |
| Boot sequence (app.js) | `app.js` | Core Platform | ⚠️ Partial | Phase 1/3 structure is good; Phase 2 restores graphics state |
| Canvas drawing, tools | `canvas/canvas.js` | Graphics-Specific | ❌ No | Core of PixelWorkbench |
| Image Bank UI | `ui/banks.js` | Graphics-Specific | ❌ No | Image-specific UI |
| Canvas Attributes modal | `ui/modal.js` | Graphics-Specific | ❌ No | Canvas resize/background settings |
| Overlay canvas + marching ants | `canvas/canvas.js` | Graphics-Specific | ❌ No | Selection visualization |
| Undo/redo (ImageData snapshots) | `canvas/canvas.js` | Graphics-Specific | ❌ No | Image-specific approach |
| Zoom system | `canvas/canvas.js` | Graphics-Specific | ❌ No | Canvas-specific CSS scaling |
| Drag-and-drop image import | `canvas/canvas.js` | Graphics-Specific | ❌ No | Drops images onto canvas |
| Clipboard (image) | `canvas/canvas.js` | Graphics-Specific | ❌ No | Image clipboard operations |
| Flask server | `app.py` | Core Platform | ✅ Yes (trivial) | One route, serves template |
| CSS design system | `styles.css` | Core Platform | ✅ Yes | VS Code-inspired tokens, fully generic |

---

## 5. Workbench Core Recommendation

### 5.1 What should become the shared Workbench Core

The following modules have zero graphics coupling and can be extracted verbatim:

**Core Platform — extract to `WorkbenchCore`:**

```
WorkbenchCore/
├── persistence/
│   └── db.js          (project store only — drop or isolate image store)
├── editor/
│   └── editor.js      (parameterize: defaultCode, defaultLanguage)
├── ui/
│   ├── console.js     (no changes needed)
│   ├── explorer.js    (no changes needed — only remove pyoWrite/pyoDelete if no Python)
│   ├── export.js      (keep code/ path; make images/ path optional)
│   ├── splitters.js   (no changes needed)
│   └── banks.js       (activity bar + sidebar shell + save-name modal only)
├── runtime/
│   └── runtime.js     (parameterize: packages[], bridgeInjectionCode)
├── app.js             (parameterize: Phase 1 setup calls, Phase 2 restores)
└── styles.css         (the design system is already fully generic)
```

### 5.2 What should become optional plugins/modules

| Plugin | Contains |
|---|---|
| `PixelWorkbenchPlugin` | `canvas/canvas.js`, Image Bank, `ui/modal.js` (attributes), image store in `db.js`, image ZIP path |
| `JinjaRenderPlugin` | HTML preview iframe, Jinja-specific bridge, template/context split-pane |
| `AudioPlugin` | Waveform display, Web Audio API bridge, sample bank |
| `WebPreviewPlugin` | Sandboxed iframe, HTML/CSS/JS asset bank |

### 5.3 What refactors would most improve reuse

**Priority order:**

1. **Decouple `canvas.js` from `db.js`** — `canvas.js` directly calls `dbSet` and `dbGetAllSavedImages`. The image bank operations should go through a dedicated `ImageBankService` that wraps `db.js`. This isolates the image store from the Core Platform storage layer.

2. **Parameterize the boot sequence (`app.js`)** — Phase 2 currently restores canvas-specific state (zoom, tool, foreground color, brush size). Phase 1 calls graphics-specific setup functions. These should be plugin-supplied callbacks: `workbench.setupUI()`, `workbench.restoreState()`, `workbench.getAdditionalScripts()`.

3. **Parameterize the runtime bridge injection** — `runtime.js` injects a hardcoded Python string that imports PIL and defines canvas-specific functions. This should be a configuration parameter: `runtimeConfig.bridgeCode`. The generic startup (Pyodide init, AMD fix, FS sync, run button) should be separate from bridge injection.

4. **Extract Pyodide FS sync from Explorer** — `syncProjectToPyodide()` and the `pyo*` functions live in `explorer.js` but are called from `runtime.js` and `export.js`. Moving them to a `PyodideFSBridge` module (part of Core, optional for non-Python workbenches) would clean up the dependency graph.

5. **Separate image store from project store in `db.js`** — create `db-images.js` and `db-project.js` as separate modules. Core only loads `db-project.js`. PixelWorkbenchPlugin loads `db-images.js`.

### 5.4 Architectural boundaries that currently exist

| Boundary | Quality | Notes |
|---|---|---|
| `console.js` ↔ everything | Strong | Clean single function, no coupling |
| `db.js` ↔ rest of code | Weak | Image + project stores mixed; called from canvas.js directly |
| `editor.js` ↔ rest | Moderate | `editorInstance` global leaks into multiple modules |
| `runtime.js` ↔ canvas | Weak | Bridge code baked into runtime; tight dependency |
| `explorer.js` ↔ Pyodide | Weak | FS operations mixed into UI module |
| `banks.js` ↔ Image Bank | Moderate | Activity bar logic (generic) mixed with Image Bank logic (specific) |
| `canvas.js` ↔ everything | Very weak | Calls db.js, refreshes banks UI, prints to console, updates DOM labels |

### 5.5 Architectural boundaries that should be strengthened

1. **Storage** — clear separation: `CorePersistence` (project) vs. `MediaPersistence` (images/audio/assets). No cross-calls.

2. **Runtime bridge** — all `window.*` functions exposed to Python should be defined in a single `bridge.js` per workbench. The generic bridge setup (run button, stdout/stderr) lives in `WorkbenchRuntime`. The domain-specific API (canvas, audio, template) lives in the plugin.

3. **Editor** — expose only one stable API: `getEditorInstance()` returning an interface (`getValue`, `setValue`, `setLanguage`, `setModel`, `onDidChange`). Other modules should never import `editorInstance` as a raw global.

4. **App boot** — the three phases should accept plugin-supplied callbacks. Phase 1 setup and Phase 2 restore should not name specific subsystems.

---

## 6. Graphics-Specific Component Inventory

Everything listed here is **exclusive to PixelWorkbench** and has **no role** in a generic Workbench Core.

### 6.1 canvas/canvas.js (entire file, ~780 lines)
- Canvas DOM setup (`canvas`, `ctx`, `canvasArea`)
- Zoom system (`zoomSteps`, `applyZoom`, `currentZoomIndex`)
- Tool state machine (`currentTool`, `setActiveTool`, tool button wiring)
- Paint operations: `hardPlot`, `plotPencil`, `plotEraser`, `floodFill`, `replaceColor`
- Bresenham line algorithm
- RGBA foreground color state (`fgHex`, `fgAlpha`, `foregroundColor`, `syncForegroundColor`)
- Color preview swatch (`refreshColorPreview`)
- Brush size state + stepper
- Undo/redo via `ImageData` snapshots (`historySave`, `historyUndo`, `historyRedo`)
- Active image identity (`activeImageName`, `setActiveImageName`)
- Session snapshot (`writeSessionSnapshot` → `dbSet('autosave_canvas', ...)`)
- Overlay canvas (`overlayCanvas`, `overlayCtx`, `initOverlayCanvas`, `syncOverlaySize`)
- Marching ants animation (`startMarchingAnts`, `stopMarchingAnts`, `redrawOverlay`)
- Selection handle drag (`applyHandleDrag`, `hitTestHandle`, `getHandlePositions`)
- Coordinate translation (`getCanvasCoords`, `imageToDisplay`, `displayToImage`)
- Clipboard operations (`clipboardCopy`, `clipboardCut`, `clipboardPaste`)
- Drag-and-drop image import
- Default canvas splash (`initDefaultCanvas`)
- JS ↔ Python bridge window functions (5 total — see §3.6)

### 6.2 ui/modal.js (entire file)
- Canvas Attributes modal: resize, background color, transparency mode

### 6.3 ui/banks.js (Image Bank portion only)
- `refreshImageBankUI()`
- `triggerImageBankSave()`
- `getAutogeneratedName()`, `getUniqueAutogeneratedName()`
- Image Bank DOM rendering (thumbnail entries, load/export/delete/rename)

### 6.4 persistence/db.js (image store portion only)
- `dbSet`, `dbGet`, `dbDelete`, `dbGetAllSavedImages` (all operate on `images` store)
- `autosave_canvas` key convention

### 6.5 ui/export.js (images/ ZIP path only)
- Image Bank ZIP export (`imagesFolder.file(...)`)
- Image Bank ZIP import (entries under `images/`)

### 6.6 app.js (Phase 2, graphics restoration)
- Zoom index restore
- Tool restore
- Foreground color + alpha restore
- Background color + transparency mode restore
- Brush size restore
- Canvas autosave (`dbGet('autosave_canvas')`) restore
- Active image name restore
- `initDefaultCanvas()` / `historySave()` on first load
- `applyZoom()` call
- `refreshImageBankUI()` call

### 6.7 styles.css (graphics-specific sections)
- `#paint-toolbox` styles
- `.fg-color-preview` (color swatch)
- `#canvas-draw-area`, `#workspace-canvas`, `#selection-overlay`
- `.canvas-mat` (checkered background)
- Brush size stepper styles
- Alpha slider + number input styles
- `#workspace-area`, `#workspace-header`

---

## 7. Suggested Future Architecture

### Conceptual Package Structure

```
packages/
├── workbench-core/            (shared across all workbenches)
│   ├── persistence/
│   │   └── db-project.js      project store only
│   ├── editor/
│   │   └── editor.js          Monaco, parameterized language + defaultCode
│   ├── ui/
│   │   ├── console.js         printToConsole()
│   │   ├── explorer.js        Project Explorer (Pyodide FS sync = optional callback)
│   │   ├── export.js          code/ ZIP path only
│   │   ├── splitters.js       resizable panes
│   │   ├── sidebar.js         activity bar + sidebar shell (extracted from banks.js)
│   │   └── modals.js          save-name modal + rename modal (generic dialogs)
│   ├── runtime/
│   │   └── runtime.js         Pyodide init + AMD fix + run button; bridgeCode is a parameter
│   ├── app.js                 3-phase boot with plugin callback hooks
│   └── styles.css             design system tokens + generic layout
│
├── workbench-pixel/           (PixelWorkbench plugin)
│   ├── canvas/
│   │   └── canvas.js          all graphics layer code
│   ├── persistence/
│   │   └── db-images.js       image store only
│   ├── ui/
│   │   ├── image-bank.js      Image Bank UI (extracted from banks.js)
│   │   └── modal-attributes.js canvas attributes modal
│   ├── export/
│   │   └── export-images.js   images/ ZIP path
│   ├── bridge.js              window.getCanvasBase64 etc.
│   └── bridge-python.py       Python bridge injection code (get_image, set_image, etc.)
│
├── workbench-jinja/           (JinjaWorkbench plugin — future)
│   ├── preview/
│   │   └── preview.js         iframe preview panel + Jinja template render
│   ├── bridge.js              window functions for render output
│   └── bridge-python.py       render_template(), set_output() etc.
│
└── workbench-web/             (WebWorkbench plugin — future)
    ├── preview/
    │   └── preview.js         sandboxed iframe, asset injection
    └── bridge.js              window functions for HTML/CSS/JS preview
```

### Key Architectural Principles for the Family

1. **Core is a framework, not an application.** It provides structure, not domain behavior. Domain behavior lives entirely in plugins.

2. **Bridge as the seam.** Each workbench variant defines its own `bridge.js` (JS → Python window API) and `bridge-python.py` (Python functions injected into `__main__`). The Core runtime calls a plugin-supplied `getBridgeCode()` function.

3. **The explorer is the universal truth.** All workbench variants use the same Project Explorer and project store. "Files are files" regardless of whether they're Python scripts, Jinja templates, or HTML.

4. **Plugin registration at boot.** `app.js` accepts a `WorkbenchPlugin` object with hooks:
   - `plugin.setup()` — Phase 1 UI wiring
   - `plugin.restore()` — Phase 2 state restore
   - `plugin.getPackages()` — Python packages to load
   - `plugin.getBridgeCode()` — Python bridge string to inject
   - `plugin.getSidebarPanels()` — additional activity bar panels

5. **No globals between plugins and core.** All cross-module communication happens through declared APIs, not global variables (`editorInstance`, `canvas`, etc.).

---

## Summary

The `jinja-workbench` branch of ProceduralStudio is a well-structured, fully functional browser coding environment with a clean functional separation between most subsystems. The **Project Explorer, Monaco editor, persistence layer (project store), ZIP export, console, splitters, and activity bar** are all generic and could be extracted into a Workbench Core with minimal changes. The **canvas paint system, Image Bank, marching ants selection, and the Python-to-canvas bridge** are PixelWorkbench-specific and should become a plugin. The primary architectural work needed before extracting a core is: (1) parameterizing the runtime bridge injection, (2) separating the image store from the project store in `db.js`, and (3) isolating Phase 2 boot restoration into plugin-supplied callbacks.
