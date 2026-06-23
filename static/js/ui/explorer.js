/* ============================================================
   ui/explorer.js
   Project Explorer — replaces Code Bank.
   Manages a virtual file tree backed by IndexedDB (project store)
   and kept in sync with Pyodide FS at /project/.

   Single project root. Supported types: any text file.
   File/folder operations: create, rename, delete.
   Opening a file loads it into Monaco with active-file tracking.
   Ctrl+S saves the active file back to IndexedDB + Pyodide FS.
   ============================================================ */

// ── Active file state ─────────────────────────────────────────
// Tracks which project file is currently open in Monaco.
// null = untitled / not from project.
let activeProjectFile = null; // { id, path } or null

function setActiveProjectFile(record) {
    activeProjectFile = record ? { id: record.id, path: record.data.path } : null;
    const label = document.getElementById('editor-filename');
    if (label) label.textContent = activeProjectFile ? activeProjectFile.path : 'untitled.py';
    // Persist identity so refresh can restore the correct file
    if (activeProjectFile) {
        localStorage.setItem('paintlab_active_project_id',   activeProjectFile.id);
        localStorage.setItem('paintlab_active_project_path', activeProjectFile.path);
    } else {
        localStorage.removeItem('paintlab_active_project_id');
        localStorage.removeItem('paintlab_active_project_path');
    }
}

// ── Language detection from extension ────────────────────────
const EXT_LANG = {
    py: 'python', json: 'json', csv: 'plaintext',
    txt: 'plaintext', md: 'markdown', js: 'javascript',
    html: 'html', css: 'css', yaml: 'yaml', toml: 'plaintext'
};
function langFromPath(path) {
    const ext = path.split('.').pop().toLowerCase();
    return EXT_LANG[ext] || 'plaintext';
}

// ── Pyodide FS helpers ────────────────────────────────────────
// These are safe to call only after pyodideInstance is available.
// All paths are relative to /project/.

function pyoWrite(path, content) {
    if (!window.pyodideInstance) return;
    try {
        const fullPath = '/project/' + path;
        ensurePyoDirs(fullPath);
        pyodideInstance.FS.writeFile(fullPath, content, { encoding: 'utf8' });
    } catch (e) { console.warn('pyoWrite failed', path, e); }
}

function pyoDelete(path) {
    if (!window.pyodideInstance) return;
    try {
        pyodideInstance.FS.unlink('/project/' + path);
    } catch (e) { /* file may not exist in FS */ }
}

function pyoRename(oldPath, newPath) {
    if (!window.pyodideInstance) return;
    try {
        const src = '/project/' + oldPath;
        const dst = '/project/' + newPath;
        ensurePyoDirs(dst);
        pyodideInstance.FS.rename(src, dst);
    } catch (e) { console.warn('pyoRename failed', e); }
}

function pyoMkdir(path) {
    if (!window.pyodideInstance) return;
    try {
        ensurePyoDirs('/project/' + path + '/_placeholder');
    } catch (e) { /* ok if exists */ }
}

// Ensure all ancestor directories exist in Pyodide FS
function ensurePyoDirs(fullPath) {
    const parts = fullPath.split('/').slice(1, -1); // strip leading '' and filename
    let cur = '';
    for (const p of parts) {
        cur += '/' + p;
        try { pyodideInstance.FS.mkdir(cur); } catch (e) { /* exists */ }
    }
}

// ── Sync all project files → Pyodide FS ──────────────────────
// Called once during app boot after Pyodide is ready.
async function syncProjectToPyodide() {
    if (!window.pyodideInstance) return;
    try {
        try { pyodideInstance.FS.mkdir('/project'); } catch(e) {}
        const records = await dbProjectGetAll();
        for (const r of records) {
            if (r.data.type === 'folder') {
                pyoMkdir(r.data.path);
            } else if (r.data.type === 'file') {
                pyoWrite(r.data.path, r.data.content || '');
            }
        }
        // Set working directory to project root
        pyodideInstance.runPython(`import os; os.chdir('/project')`);
        printToConsole(`System: Project synced to /project (${records.filter(r=>r.data.type==='file').length} files).\n`, 'out-system');
    } catch (e) {
        console.warn('syncProjectToPyodide failed', e);
    }
}

// ── Drag state ───────────────────────────────────────────────
let dragSourcePath = null;
let dragSourceType = null;

// ── Move file/folder to a new parent ────────────────────────
// Performs a move (not copy). Updates IndexedDB + Pyodide FS.
async function moveNode(sourcePath, targetFolderPath) {
    if (!sourcePath || sourcePath === targetFolderPath) return;
    // Prevent moving a folder into itself or its own descendant
    if (targetFolderPath.startsWith(sourcePath + '/') || targetFolderPath === sourcePath) {
        printToConsole(`System: Cannot move a folder into itself.
`, 'out-system');
        return;
    }

    const all = await dbProjectGetAll();
    const sourceRec = all.find(r => r.data.path === sourcePath);
    if (!sourceRec) return;

    const sourceName = sourcePath.split('/').pop();
    const newPath    = targetFolderPath
        ? targetFolderPath + '/' + sourceName
        : sourceName;

    // Check for collision
    const collision = all.find(r => r.data.path === newPath && r.id !== sourceRec.id);
    if (collision) {
        printToConsole(`System: Move failed — "${newPath}" already exists.
`, 'out-system');
        return;
    }

    if (sourceRec.data.type === 'file') {
        // Simple file move
        pyoRename(sourcePath, newPath);
        sourceRec.data.path = newPath;
        await dbProjectSet(sourceRec.id, sourceRec.data);

        // Update active file reference if this was the open file
        if (activeProjectFile && activeProjectFile.id === sourceRec.id) {
            activeProjectFile.path = newPath;
            localStorage.setItem('paintlab_active_project_path', newPath);
            const label = document.getElementById('editor-filename');
            if (label) label.textContent = newPath;
        }
    } else {
        // Folder move: rewrite source and all descendants
        const affected = all.filter(r =>
            r.data.path === sourcePath || r.data.path.startsWith(sourcePath + '/')
        );
        for (const r of affected) {
            const childNewPath = newPath + r.data.path.slice(sourcePath.length);
            if (r.data.type === 'file') pyoRename(r.data.path, childNewPath);
            r.data.path = childNewPath;
            await dbProjectSet(r.id, r.data);
            if (activeProjectFile && activeProjectFile.id === r.id) {
                activeProjectFile.path = childNewPath;
                localStorage.setItem('paintlab_active_project_path', childNewPath);
                const label = document.getElementById('editor-filename');
                if (label) label.textContent = childNewPath;
            }
        }
    }

    printToConsole(`System: Moved "${sourcePath}" → "${newPath}".
`, 'out-system');
    await refreshExplorerUI();
}

// ── Tree building ─────────────────────────────────────────────
// Build a nested tree from flat path list.
// Returns { name, path, type, id, children: [] }
function buildTree(records) {
    const root = { name: 'Project', path: '', type: 'root', children: [] };
    const nodeMap = { '': root };

    // Sort: folders first, then by path
    const sorted = [...records].sort((a, b) => {
        if (a.data.type !== b.data.type) return a.data.type === 'folder' ? -1 : 1;
        return a.data.path.localeCompare(b.data.path);
    });

    for (const r of sorted) {
        const parts  = r.data.path.split('/');
        const name   = parts[parts.length - 1];
        const parent = parts.slice(0, -1).join('/');

        // Ensure ancestor folder nodes exist (even if no explicit record)
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
            const prev = cur;
            cur = cur ? cur + '/' + parts[i] : parts[i];
            if (!nodeMap[cur]) {
                const n = { name: parts[i], path: cur, type: 'folder', id: null, children: [] };
                nodeMap[cur] = n;
                (nodeMap[prev] || root).children.push(n);
            }
        }

        const node = {
            name,
            path: r.data.path,
            type: r.data.type,
            id:   r.id,
            record: r,
            children: r.data.type === 'folder' ? [] : undefined
        };
        nodeMap[r.data.path] = node;
        (nodeMap[parent] || root).children.push(node);
    }

    return root;
}

// ── Collapsed folder state ────────────────────────────────────
const collapsedFolders = new Set();

// ── Render tree ───────────────────────────────────────────────
function renderTree(node, container, depth = 0) {
    if (node.type === 'root') {
        const header = document.createElement('div');
        header.className = 'explorer-root-header';
        header.innerHTML = `
            <span class="explorer-root-label">PROJECT</span>
            <span class="explorer-root-actions">
                <button class="explorer-icon-btn" id="exp-new-file-root" title="New File">+📄</button>
                <button class="explorer-icon-btn" id="exp-new-folder-root" title="New Folder">+📁</button>
                <button class="explorer-icon-btn" id="exp-download" title="Download Project as ZIP">⬇</button>
                <button class="explorer-icon-btn" id="exp-import" title="Import Project from ZIP">⬆</button>
            </span>`;
        container.appendChild(header);

        header.querySelector('#exp-new-file-root').addEventListener('click', (e) => {
            e.stopPropagation();
            promptNewFile('');
        });
        header.querySelector('#exp-new-folder-root').addEventListener('click', (e) => {
            e.stopPropagation();
            promptNewFolder('');
        });
        header.querySelector('#exp-download').addEventListener('click', (e) => {
            e.stopPropagation();
            downloadProject();
        });
        header.querySelector('#exp-import').addEventListener('click', (e) => {
            e.stopPropagation();
            // Trigger the hidden file input — always present in static HTML
            const input = document.getElementById('exp-import-input');
            if (input) { input.value = ''; input.click(); }
        });

        for (const child of node.children) renderTree(child, container, 0);
        return;
    }

    const row = document.createElement('div');
    row.className = 'explorer-row' + (node.type === 'folder' ? ' explorer-folder' : ' explorer-file');
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.style.paddingLeft = (12 + depth * 14) + 'px';

    const isCollapsed = collapsedFolders.has(node.path);

    if (node.type === 'folder') {
        row.innerHTML = `
            <span class="explorer-arrow">${isCollapsed ? '▶' : '▼'}</span>
            <span class="explorer-icon">📁</span>
            <span class="explorer-name">${escHtml(node.name)}</span>
            <span class="explorer-row-actions">
                <button class="explorer-icon-btn" data-action="new-file" title="New File">+📄</button>
                <button class="explorer-icon-btn" data-action="new-folder" title="New Folder">+📁</button>
                <button class="explorer-icon-btn" data-action="rename" title="Rename">✎</button>
                <button class="explorer-icon-btn danger" data-action="delete" title="Delete">✕</button>
            </span>`;

        row.querySelector('[data-action="new-file"]').addEventListener('click', e => { e.stopPropagation(); promptNewFile(node.path); });
        row.querySelector('[data-action="new-folder"]').addEventListener('click', e => { e.stopPropagation(); promptNewFolder(node.path); });
        row.querySelector('[data-action="rename"]').addEventListener('click', e => { e.stopPropagation(); promptRename(node); });
        row.querySelector('[data-action="delete"]').addEventListener('click', e => { e.stopPropagation(); confirmDelete(node); });

        row.addEventListener('click', () => {
            if (collapsedFolders.has(node.path)) collapsedFolders.delete(node.path);
            else collapsedFolders.add(node.path);
            refreshExplorerUI();
        });

        // Drag: folder is both a draggable source and a drop target
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
            dragSourcePath = node.path;
            dragSourceType = node.type;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.path);
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('explorer-drop-target');
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('explorer-drop-target');
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('explorer-drop-target');
            const src = e.dataTransfer.getData('text/plain');
            if (src && src !== node.path) moveNode(src, node.path);
        });
        row.addEventListener('dragend', () => {
            dragSourcePath = null; dragSourceType = null;
            document.querySelectorAll('.explorer-drop-target').forEach(r => r.classList.remove('explorer-drop-target'));
        });

        container.appendChild(row);

        if (!isCollapsed) {
            for (const child of node.children) renderTree(child, container, depth + 1);
        }
    } else {
        // File
        const icon = fileIcon(node.name);
        row.innerHTML = `
            <span class="explorer-arrow" style="visibility:hidden">▶</span>
            <span class="explorer-icon">${icon}</span>
            <span class="explorer-name">${escHtml(node.name)}</span>
            <span class="explorer-row-actions">
                <button class="explorer-icon-btn" data-action="rename" title="Rename">✎</button>
                <button class="explorer-icon-btn danger" data-action="delete" title="Delete">✕</button>
            </span>`;

        // Highlight active file
        if (activeProjectFile && activeProjectFile.path === node.path) {
            row.classList.add('explorer-active');
        }

        // Single click: select (visual highlight + marks as active without reload)
        row.addEventListener('click', (e) => {
            if (e.target.closest('.explorer-icon-btn')) return;
            // Mark as active immediately on single click — ownership follows focus
            document.querySelectorAll('.explorer-row').forEach(r => r.classList.remove('explorer-active'));
            row.classList.add('explorer-active');
            // Update active file identity (does not reload content into editor)
            activeProjectFile = { id: node.id, path: node.path };
            localStorage.setItem('paintlab_active_project_id',   node.id);
            localStorage.setItem('paintlab_active_project_path', node.path);
            const label = document.getElementById('editor-filename');
            if (label) label.textContent = node.path;
        });
        // Double click: open file — loads content into Monaco
        row.addEventListener('dblclick', (e) => {
            if (e.target.closest('.explorer-icon-btn')) return;
            openProjectFile(node.record).then(() => refreshExplorerUI());
        });
        row.querySelector('[data-action="rename"]').addEventListener('click', e => { e.stopPropagation(); promptRename(node); });
        row.querySelector('[data-action="delete"]').addEventListener('click', e => { e.stopPropagation(); confirmDelete(node); });

        // Drag: file is a draggable source only (not a drop target)
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
            dragSourcePath = node.path;
            dragSourceType = 'file';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.path);
        });
        row.addEventListener('dragend', () => {
            dragSourcePath = null; dragSourceType = null;
            document.querySelectorAll('.explorer-drop-target').forEach(r => r.classList.remove('explorer-drop-target'));
        });

        container.appendChild(row);
    }
}

function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = { py: '🐍', json: '{}', csv: '📊', txt: '📄', md: '📝', js: '⚡', html: '🌐', css: '🎨' };
    return icons[ext] || '📄';
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Refresh explorer UI ───────────────────────────────────────
async function refreshExplorerUI() {
    const container = document.getElementById('explorer-tree');
    if (!container) return;
    container.innerHTML = '';
    try {
        const records = await dbProjectGetAll();
        const tree    = buildTree(records);
        renderTree(tree, container);
    } catch (e) {
        console.warn('Explorer refresh failed', e);
    }
}

// ── Open file → Monaco ────────────────────────────────────────
async function openProjectFile(record) {
    if (!editorInstance) return;
    if (!record) return;

    const content = record.data.content || '';
    const lang    = langFromPath(record.data.path);

    // Switch Monaco language model
    const model = monaco.editor.createModel(content, lang);
    editorInstance.setModel(model);

    // Track dirty state: mark clean on open, dirty on any change
    editorDirty = false;
    model.onDidChangeContent(() => {
        editorDirty = true;
        // Keep localStorage autosave buffer in sync with current model
        localStorage.setItem('paintlab_code', editorInstance.getValue());
    });

    setActiveProjectFile(record);
    // NOTE: caller is responsible for calling refreshExplorerUI() if needed.
    // Do NOT call it here — callers that also call refreshExplorerUI() would
    // trigger a race producing a duplicate tree render.
    printToConsole(`System: Opened "${record.data.path}".\n`, 'out-system');
}

// Dirty tracking — set in openProjectFile, checked by Ctrl+S
let editorDirty = false;

// ── Restore active project file after page refresh ────────────
// Called from app.js Phase 3 after Monaco is initialized.
// Loads the previously-open project file content from IndexedDB into
// Monaco, overriding the localStorage autosave buffer which may contain
// stale or mismatched content from a different session.
async function restoreActiveProjectFile() {
    const savedId   = localStorage.getItem("paintlab_active_project_id");
    const savedPath = localStorage.getItem("paintlab_active_project_path");
    if (!savedId || !savedPath) return; // no project file was active — untitled is correct

    try {
        const rec = await dbProjectGet(savedId);
        if (!rec) {
            // Record was deleted — clear stale identity
            localStorage.removeItem("paintlab_active_project_id");
            localStorage.removeItem("paintlab_active_project_path");
            return;
        }
        // Load the saved content from IndexedDB — authoritative source of truth.
        // This overrides the localStorage autosave buffer (paintlab_code) which
        // reflects the editor keystroke state, not the persisted file state.
        const content = rec.data.content || "";
        const lang    = langFromPath(savedPath);
        const model   = monaco.editor.createModel(content, lang);
        editorInstance.setModel(model);
        editorDirty = false;
        model.onDidChangeContent(() => {
            editorDirty = true;
            localStorage.setItem("paintlab_code", editorInstance.getValue());
        });
        // Restore identity without triggering a full refreshExplorerUI
        activeProjectFile = { id: savedId, path: savedPath };
        const label = document.getElementById("editor-filename");
        if (label) label.textContent = savedPath;
        printToConsole(`System: Restored ${savedPath} from project.`, "out-system");
    } catch (e) {
        console.warn("restoreActiveProjectFile failed", e);
    }
}

// ── Save active file ──────────────────────────────────────────
async function saveActiveFile() {
    if (!editorInstance) return;

    if (activeProjectFile) {
        // Overwrite existing file — no prompt
        const content = editorInstance.getValue();
        const rec     = await dbProjectGet(activeProjectFile.id);
        if (!rec) return;
        rec.data.content = content;
        await dbProjectSet(activeProjectFile.id, rec.data);
        pyoWrite(activeProjectFile.path, content);
        editorDirty = false;
        printToConsole(`System: Saved "${activeProjectFile.path}".\n`, 'out-system');
        refreshExplorerUI();
    } else {
        // Untitled — prompt for name
        await promptSaveNew();
    }
}

async function promptSaveNew() {
    const name = await openSaveNameModal('untitled.py');
    if (!name) return;
    const cleanPath = name.trim().replace(/^\/+/, ''); // strip leading slashes
    if (!cleanPath) return;

    const content = editorInstance.getValue();
    const key     = 'proj_' + Date.now();
    const data    = { type: 'file', path: cleanPath, content, language: langFromPath(cleanPath) };
    await dbProjectSet(key, data);
    pyoWrite(cleanPath, content);

    const record = { id: key, data, timestamp: Date.now() };
    setActiveProjectFile(record);
    editorDirty = false;
    printToConsole(`System: Saved new file "${cleanPath}".\n`, 'out-system');
    refreshExplorerUI();
}

// ── Save As modal ────────────────────────────────────────────
// Returns { name, folder } or null if cancelled.
function openSaveAsModal() {
    return new Promise((resolve) => {
        const modal      = document.getElementById('save-as-modal');
        const nameInput  = document.getElementById('save-as-name');
        const folderInput = document.getElementById('save-as-folder');
        const okBtn      = document.getElementById('save-as-ok');
        const cancelBtn  = document.getElementById('save-as-cancel');
        const closeBtn   = document.getElementById('save-as-close');

        // Pre-fill with current file name
        const currentName = activeProjectFile
            ? activeProjectFile.path.split('/').pop()
            : 'untitled.py';
        const currentFolder = activeProjectFile
            ? activeProjectFile.path.split('/').slice(0, -1).join('/')
            : '';
        nameInput.value   = currentName;
        folderInput.value = currentFolder;

        modal.classList.add('open');
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 60);

        function finish(value) {
            modal.classList.remove('open');
            okBtn   .removeEventListener('click',   onOk);
            cancelBtn.removeEventListener('click',  onCancel);
            closeBtn.removeEventListener('click',   onCancel);
            nameInput.removeEventListener('keydown', onKey);
            resolve(value);
        }
        function onOk() {
            finish({ name: nameInput.value, folder: folderInput.value });
        }
        function onCancel() { finish(null); }
        function onKey(e) {
            if (e.key === 'Enter')  onOk();
            if (e.key === 'Escape') onCancel();
        }
        okBtn   .addEventListener('click',   onOk);
        cancelBtn.addEventListener('click',  onCancel);
        closeBtn.addEventListener('click',   onCancel);
        nameInput.addEventListener('keydown', onKey);
    });
}

// ── Save As ──────────────────────────────────────────────────
// Ctrl+Shift+S: save current editor contents as a new file.
// Does NOT overwrite the original. Editor switches to the new file.
async function saveActiveFileAs() {
    if (!editorInstance) return;

    const result = await openSaveAsModal();
    if (!result) return;

    const bareName = result.name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;
    const folder   = result.folder.trim().replace(/^\/+|\/+$/g, '');
    const fullPath = folder ? folder + '/' + bareName : bareName;

    // Save As never silently overwrites
    const existing = await dbProjectFindByPath(fullPath);
    if (existing) {
        printToConsole(`System: Save As — "${fullPath}" already exists. Choose a different name.
`, 'out-system');
        return;
    }

    const content = editorInstance.getValue();
    const key     = 'proj_' + Date.now();
    const data    = { type: 'file', path: fullPath, content, language: langFromPath(fullPath) };
    await dbProjectSet(key, data);
    pyoWrite(fullPath, content);

    const record = { id: key, data, timestamp: Date.now() };
    await openProjectFile(record);
    editorDirty = false;
    printToConsole(`System: Saved As "${fullPath}".
`, 'out-system');
    await refreshExplorerUI();
}

// ── New file prompt ───────────────────────────────────────────
async function promptNewFile(parentPath) {
    // Show only the bare filename in the prompt — the parent location is implicit.
    // The user should not need to type or see the parent path prefix.
    const name = await openSaveNameModal('untitled.py');
    if (!name) return;
    const bareName = name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;

    // Construct the full path by prepending the parent — user never types this
    const path = parentPath ? parentPath + '/' + bareName : bareName;

    const existing = await dbProjectFindByPath(path);
    if (existing) {
        printToConsole(`System: File "${path}" already exists.\n`, 'out-system'); return;
    }

    const key  = 'proj_' + Date.now();
    const data = { type: 'file', path, content: '', language: langFromPath(path) };
    await dbProjectSet(key, data);
    pyoWrite(path, '');
    printToConsole(`System: Created "${path}".\n`, 'out-system');

    const record = { id: key, data, timestamp: Date.now() };
    await openProjectFile(record);
    await refreshExplorerUI();
}

// ── New folder prompt ─────────────────────────────────────────
async function promptNewFolder(parentPath) {
    // Show only the bare folder name — parent location is implicit from context.
    const name = await openSaveNameModal('new_folder');
    if (!name) return;
    const bareName = name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;

    // Construct full path from parent — user never types the prefix
    const path = parentPath ? parentPath + '/' + bareName : bareName;

    const existing = await dbProjectFindByPath(path);
    if (existing) {
        printToConsole(`System: "${path}" already exists.\n`, 'out-system'); return;
    }

    const key  = 'proj_' + Date.now();
    const data = { type: 'folder', path };
    await dbProjectSet(key, data);
    pyoMkdir(path);
    printToConsole(`System: Created folder "${path}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── Rename modal ──────────────────────────────────────────────
// Dedicated modal for rename operations. Shows "Rename" semantics,
// not "Save to Bank". Returns the entered string, or null if cancelled.
function openRenameModal(currentName) {
    return new Promise((resolve) => {
        const modal  = document.getElementById('rename-modal');
        const input  = document.getElementById('rename-input');
        const okBtn  = document.getElementById('rename-ok');
        const cancel = document.getElementById('rename-cancel');
        const close  = document.getElementById('rename-close');

        input.value = currentName;
        modal.classList.add('open');
        setTimeout(() => { input.focus(); input.select(); }, 60);

        function finish(value) {
            modal.classList.remove('open');
            okBtn   .removeEventListener('click',   onOk);
            cancel  .removeEventListener('click',   onCancel);
            close   .removeEventListener('click',   onCancel);
            input   .removeEventListener('keydown', onKey);
            resolve(value);
        }
        function onOk()     { finish(input.value); }
        function onCancel() { finish(null); }
        function onKey(e) {
            if (e.key === 'Enter')  onOk();
            if (e.key === 'Escape') onCancel();
        }
        okBtn  .addEventListener('click',   onOk);
        cancel .addEventListener('click',   onCancel);
        close  .addEventListener('click',   onCancel);
        input  .addEventListener('keydown', onKey);
    });
}

// ── Rename ────────────────────────────────────────────────────
// Rename mutates ONE node's identity: same hierarchy position, new bare name.
// Rules:
//   1. Accepts only a bare name — no path separators allowed.
//   2. New full path = original parent path + '/' + new bare name.
//   3. Does not create hierarchy. Does not behave like save/create.
async function promptRename(node) {
    if (!node.id) {
        printToConsole(`System: Cannot rename implicit folder. Create it explicitly first.\n`, 'out-system');
        return;
    }

    // Extract the bare current name (last segment of the path)
    const parts       = node.path.split('/');
    const currentName = parts[parts.length - 1];
    const parentPath  = parts.slice(0, -1).join('/'); // '' for root-level items

    // Prompt with rename-specific modal — shows "Rename" not "Save"
    const newName = await openRenameModal(currentName);
    if (newName === null) return;             // cancelled

    const trimmed = newName.trim();
    if (!trimmed) return;                     // empty — ignore

    // Reject any path separators — rename does not construct hierarchy
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        printToConsole(`System: Rename rejected — name must not contain path separators. Use New Folder to create hierarchy.\n`, 'out-system');
        return;
    }

    // Same name — no-op
    if (trimmed === currentName) return;

    // Construct new full path by preserving parent position
    const newPath = parentPath ? parentPath + '/' + trimmed : trimmed;

    // Check for collision
    const existing = await dbProjectFindByPath(newPath);
    if (existing && existing.id !== node.id) {
        printToConsole(`System: Rename rejected — "${newPath}" already exists.\n`, 'out-system');
        return;
    }

    const rec = await dbProjectGet(node.id);
    if (!rec) return;

    // Sync Pyodide FS before updating db record
    if (node.type === 'file') {
        pyoRename(node.path, newPath);
    } else if (node.type === 'folder') {
        // Rename all children paths too — folder rename is a prefix replace
        const all = await dbProjectGetAll();
        const children = all.filter(r =>
            r.id !== node.id && r.data.path.startsWith(node.path + '/')
        );
        for (const child of children) {
            const childNewPath = newPath + child.data.path.slice(node.path.length);
            if (child.data.type === 'file') pyoRename(child.data.path, childNewPath);
            child.data.path = childNewPath;
            await dbProjectSet(child.id, child.data);
            // Update active file reference if a child was open
            if (activeProjectFile && activeProjectFile.id === child.id) {
                activeProjectFile.path = childNewPath;
                localStorage.setItem('paintlab_active_project_path', childNewPath);
                const label = document.getElementById('editor-filename');
                if (label) label.textContent = childNewPath;
            }
        }
    }

    rec.data.path = newPath;
    await dbProjectSet(node.id, rec.data);

    // Update active file reference if this was the open file
    if (activeProjectFile && activeProjectFile.id === node.id) {
        activeProjectFile.path = newPath;
        localStorage.setItem('paintlab_active_project_path', newPath);
        const label = document.getElementById('editor-filename');
        if (label) label.textContent = newPath;
    }

    printToConsole(`System: Renamed "${node.path}" → "${newPath}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── Delete ────────────────────────────────────────────────────
async function confirmDelete(node) {
    if (!node.id) {
        printToConsole(`System: Cannot delete implicit folder.\n`, 'out-system'); return;
    }

    // For folders: also delete all children
    const all = await dbProjectGetAll();
    const toDelete = node.type === 'folder'
        ? all.filter(r => r.data.path === node.path || r.data.path.startsWith(node.path + '/'))
        : all.filter(r => r.data.path === node.path);

    for (const r of toDelete) {
        await dbProjectDelete(r.id);
        if (r.data.type === 'file') pyoDelete(r.data.path);
    }

    // Clear active file if deleted
    if (activeProjectFile && toDelete.some(r => r.id === activeProjectFile.id)) {
        setActiveProjectFile(null);
    }

    printToConsole(`System: Deleted "${node.path}".\n`, 'out-system');
    refreshExplorerUI();
}

// ── Activity bar wiring (replaces code-bank panel) ────────────
function setupExplorerActivityButton() {
    // The activity bar button for explorer is id="act-code" data-panel="explorer"
    // Already handled by setupActivityBar() in banks.js for the open/close toggle.
    // Explorer-specific add button behaviour:
    const addBtn = document.getElementById('sidebar-add-btn');
    // addBtn click is context-sensitive — handled per-panel in banks.js setupActivityBar
}

// ── Ctrl+S / Cmd+S — save  |  Ctrl+Shift+S — save as ────────
function setupExplorerKeybindings() {
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && e.key === 'S') {
            // Ctrl+Shift+S → Save As
            e.preventDefault();
            saveActiveFileAs();
        } else if (mod && e.key === 's') {
            // Ctrl+S → Save (overwrite)
            e.preventDefault();
            saveActiveFile();
        }
    });
}
