/* ============================================================
   ui/explorer.js — JinjaWorkbench
   Project Explorer — manages a virtual file tree backed by
   IndexedDB (project store) and kept in sync with Pyodide FS
   at /project/.

   Copied from PixelWorkbench. Changes from original:
     - localStorage key prefix changed: paintlab_ → jinjalab_
     - Default fallback filename: untitled.py → main.py
     - Jinja2 file extensions added to EXT_LANG map
     - No functional changes to file tree, drag/drop, Ctrl+S
   ============================================================ */

// ── Active file state ─────────────────────────────────────────
let activeProjectFile = null; // { id, path } or null

function setActiveProjectFile(record) {
    activeProjectFile = record ? { id: record.id, path: record.data.path } : null;
    const label = document.getElementById('editor-filename');
    if (label) label.textContent = activeProjectFile ? activeProjectFile.path : 'main.py';
    if (activeProjectFile) {
        localStorage.setItem('jinjalab_active_project_id',   activeProjectFile.id);
        localStorage.setItem('jinjalab_active_project_path', activeProjectFile.path);
    } else {
        localStorage.removeItem('jinjalab_active_project_id');
        localStorage.removeItem('jinjalab_active_project_path');
    }
}

// ── Language detection ────────────────────────────────────────
const EXT_LANG = {
    py:    'python',
    json:  'json',
    csv:   'plaintext',
    txt:   'plaintext',
    md:    'markdown',
    js:    'javascript',
    html:  'html',
    css:   'css',
    yaml:  'yaml',
    toml:  'plaintext',
    jinja: 'html',   // best Monaco approximation for Jinja2 templates
    j2:    'html',
    jinja2:'html',
};
function langFromPath(path) {
    const ext = path.split('.').pop().toLowerCase();
    return EXT_LANG[ext] || 'plaintext';
}

// ── Pyodide FS helpers ────────────────────────────────────────
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
    try { pyodideInstance.FS.unlink('/project/' + path); } catch (e) { /* ok */ }
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
    try { ensurePyoDirs('/project/' + path + '/_placeholder'); } catch (e) { /* ok */ }
}

function ensurePyoDirs(fullPath) {
    const parts = fullPath.split('/').slice(1, -1);
    let cur = '';
    for (const p of parts) {
        cur += '/' + p;
        try { pyodideInstance.FS.mkdir(cur); } catch (e) { /* exists */ }
    }
}

// ── Sync all project files → Pyodide FS ──────────────────────
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
        pyodideInstance.runPython(`import os; os.chdir('/project')`);
        printToConsole(`System: Project synced to /project (${records.filter(r=>r.data.type==='file').length} files).\n`, 'out-system');
    } catch (e) {
        console.warn('syncProjectToPyodide failed', e);
    }
}

// ── Drag state ────────────────────────────────────────────────
let dragSourcePath = null;
let dragSourceType = null;

// ── Move file/folder ──────────────────────────────────────────
async function moveNode(sourcePath, targetFolderPath) {
    if (!sourcePath || sourcePath === targetFolderPath) return;
    if (targetFolderPath.startsWith(sourcePath + '/') || targetFolderPath === sourcePath) {
        printToConsole(`System: Cannot move a folder into itself.\n`, 'out-system');
        return;
    }

    const all = await dbProjectGetAll();
    const sourceRec = all.find(r => r.data.path === sourcePath);
    if (!sourceRec) return;

    const sourceName = sourcePath.split('/').pop();
    const newPath    = targetFolderPath ? targetFolderPath + '/' + sourceName : sourceName;

    const collision = all.find(r => r.data.path === newPath && r.id !== sourceRec.id);
    if (collision) {
        printToConsole(`System: Move failed — "${newPath}" already exists.\n`, 'out-system');
        return;
    }

    if (sourceRec.data.type === 'file') {
        pyoRename(sourcePath, newPath);
        sourceRec.data.path = newPath;
        await dbProjectSet(sourceRec.id, sourceRec.data);
        if (activeProjectFile && activeProjectFile.id === sourceRec.id) {
            activeProjectFile.path = newPath;
            localStorage.setItem('jinjalab_active_project_path', newPath);
            const label = document.getElementById('editor-filename');
            if (label) label.textContent = newPath;
        }
    } else {
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
                localStorage.setItem('jinjalab_active_project_path', childNewPath);
                const label = document.getElementById('editor-filename');
                if (label) label.textContent = childNewPath;
            }
        }
    }

    printToConsole(`System: Moved "${sourcePath}" → "${newPath}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── Tree building ─────────────────────────────────────────────
function buildTree(records) {
    const root = { name: 'Project', path: '', type: 'root', children: [] };
    const nodeMap = { '': root };

    const sorted = [...records].sort((a, b) => {
        if (a.data.type !== b.data.type) return a.data.type === 'folder' ? -1 : 1;
        return a.data.path.localeCompare(b.data.path);
    });

    for (const r of sorted) {
        const parts  = r.data.path.split('/');
        const name   = parts[parts.length - 1];
        const parent = parts.slice(0, -1).join('/');

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
            name, path: r.data.path, type: r.data.type, id: r.id,
            record: r, children: r.data.type === 'folder' ? [] : undefined
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

        header.querySelector('#exp-new-file-root').addEventListener('click', (e) => { e.stopPropagation(); promptNewFile(''); });
        header.querySelector('#exp-new-folder-root').addEventListener('click', (e) => { e.stopPropagation(); promptNewFolder(''); });
        header.querySelector('#exp-download').addEventListener('click', (e) => { e.stopPropagation(); downloadProject(); });
        header.querySelector('#exp-import').addEventListener('click', (e) => {
            e.stopPropagation();
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

        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
            dragSourcePath = node.path; dragSourceType = node.type;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.path);
        });
        row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('explorer-drop-target'); });
        row.addEventListener('dragleave', () => row.classList.remove('explorer-drop-target'));
        row.addEventListener('drop', (e) => {
            e.preventDefault(); row.classList.remove('explorer-drop-target');
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
        const icon = fileIcon(node.name);
        row.innerHTML = `
            <span class="explorer-arrow" style="visibility:hidden">▶</span>
            <span class="explorer-icon">${icon}</span>
            <span class="explorer-name">${escHtml(node.name)}</span>
            <span class="explorer-row-actions">
                <button class="explorer-icon-btn" data-action="rename" title="Rename">✎</button>
                <button class="explorer-icon-btn danger" data-action="delete" title="Delete">✕</button>
            </span>`;

        if (activeProjectFile && activeProjectFile.path === node.path) {
            row.classList.add('explorer-active');
        }

        row.addEventListener('click', (e) => {
            if (e.target.closest('.explorer-icon-btn')) return;
            // Single-click opens the file immediately — updates active state,
            // Monaco model, editor contents, and title label in one action.
            openProjectFile(node.record).then(() => refreshExplorerUI());
        });
        row.querySelector('[data-action="rename"]').addEventListener('click', e => { e.stopPropagation(); promptRename(node); });
        row.querySelector('[data-action="delete"]').addEventListener('click', e => { e.stopPropagation(); confirmDelete(node); });

        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
            dragSourcePath = node.path; dragSourceType = 'file';
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
    const icons = {
        py: '🐍', json: '{}', csv: '📊', txt: '📄', md: '📝',
        js: '⚡', html: '🌐', css: '🎨',
        jinja: '🧩', j2: '🧩', jinja2: '🧩',
    };
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
    } catch (e) { console.warn('Explorer refresh failed', e); }
}

// ── Open file → Monaco ────────────────────────────────────────
async function openProjectFile(record) {
    if (!editorInstance || !record) return;
    const content = record.data.content || '';
    const lang    = langFromPath(record.data.path);
    const model   = monaco.editor.createModel(content, lang);
    editorInstance.setModel(model);
    editorDirty = false;
    model.onDidChangeContent(() => {
        editorDirty = true;
        localStorage.setItem('jinjalab_code', editorInstance.getValue());
    });
    setActiveProjectFile(record);
    printToConsole(`System: Opened "${record.data.path}".\n`, 'out-system');
}

let editorDirty = false;

// ── Restore active project file ───────────────────────────────
async function restoreActiveProjectFile() {
    const savedId   = localStorage.getItem("jinjalab_active_project_id");
    const savedPath = localStorage.getItem("jinjalab_active_project_path");
    if (!savedId || !savedPath) return;

    try {
        const rec = await dbProjectGet(savedId);
        if (!rec) {
            localStorage.removeItem("jinjalab_active_project_id");
            localStorage.removeItem("jinjalab_active_project_path");
            return;
        }
        const content = rec.data.content || "";
        const lang    = langFromPath(savedPath);
        const model   = monaco.editor.createModel(content, lang);
        editorInstance.setModel(model);
        editorDirty = false;
        model.onDidChangeContent(() => {
            editorDirty = true;
            localStorage.setItem("jinjalab_code", editorInstance.getValue());
        });
        activeProjectFile = { id: savedId, path: savedPath };
        const label = document.getElementById("editor-filename");
        if (label) label.textContent = savedPath;
        printToConsole(`System: Restored ${savedPath} from project.`, "out-system");
    } catch (e) { console.warn("restoreActiveProjectFile failed", e); }
}

// ── Save active file ──────────────────────────────────────────
async function saveActiveFile() {
    if (!editorInstance) return;
    if (activeProjectFile) {
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
        await promptSaveNew();
    }
}

async function promptSaveNew() {
    const name = await openSaveNameModal('main.py');
    if (!name) return;
    const cleanPath = name.trim().replace(/^\/+/, '');
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

// ── Save As ───────────────────────────────────────────────────
function openSaveAsModal() {
    return new Promise((resolve) => {
        const modal       = document.getElementById('save-as-modal');
        const nameInput   = document.getElementById('save-as-name');
        const folderInput = document.getElementById('save-as-folder');
        const okBtn       = document.getElementById('save-as-ok');
        const cancelBtn   = document.getElementById('save-as-cancel');
        const closeBtn    = document.getElementById('save-as-close');

        const currentName   = activeProjectFile ? activeProjectFile.path.split('/').pop() : 'main.py';
        const currentFolder = activeProjectFile ? activeProjectFile.path.split('/').slice(0, -1).join('/') : '';
        nameInput.value   = currentName;
        folderInput.value = currentFolder;

        modal.classList.add('open');
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 60);

        function finish(value) {
            modal.classList.remove('open');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            nameInput.removeEventListener('keydown', onKey);
            resolve(value);
        }
        function onOk()     { finish({ name: nameInput.value, folder: folderInput.value }); }
        function onCancel() { finish(null); }
        function onKey(e)   { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        nameInput.addEventListener('keydown', onKey);
    });
}

async function saveActiveFileAs() {
    if (!editorInstance) return;
    const result = await openSaveAsModal();
    if (!result) return;
    const bareName = result.name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;
    const folder   = result.folder.trim().replace(/^\/+|\/+$/g, '');
    const fullPath = folder ? folder + '/' + bareName : bareName;
    const existing = await dbProjectFindByPath(fullPath);
    if (existing) { printToConsole(`System: Save As — "${fullPath}" already exists.\n`, 'out-system'); return; }
    const content = editorInstance.getValue();
    const key     = 'proj_' + Date.now();
    const data    = { type: 'file', path: fullPath, content, language: langFromPath(fullPath) };
    await dbProjectSet(key, data);
    pyoWrite(fullPath, content);
    const record = { id: key, data, timestamp: Date.now() };
    await openProjectFile(record);
    editorDirty = false;
    printToConsole(`System: Saved As "${fullPath}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── New file / folder prompts ─────────────────────────────────
async function promptNewFile(parentPath) {
    const name = await openSaveNameModal('untitled.py');
    if (!name) return;
    const bareName = name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;
    const path = parentPath ? parentPath + '/' + bareName : bareName;
    const existing = await dbProjectFindByPath(path);
    if (existing) { printToConsole(`System: File "${path}" already exists.\n`, 'out-system'); return; }
    const key  = 'proj_' + Date.now();
    const data = { type: 'file', path, content: '', language: langFromPath(path) };
    await dbProjectSet(key, data);
    pyoWrite(path, '');
    printToConsole(`System: Created "${path}".\n`, 'out-system');
    const record = { id: key, data, timestamp: Date.now() };
    await openProjectFile(record);
    await refreshExplorerUI();
}

async function promptNewFolder(parentPath) {
    const name = await openSaveNameModal('new_folder');
    if (!name) return;
    const bareName = name.trim().replace(/^\/+|\/+$/g, '');
    if (!bareName) return;
    const path = parentPath ? parentPath + '/' + bareName : bareName;
    const existing = await dbProjectFindByPath(path);
    if (existing) { printToConsole(`System: "${path}" already exists.\n`, 'out-system'); return; }
    const key  = 'proj_' + Date.now();
    const data = { type: 'folder', path };
    await dbProjectSet(key, data);
    pyoMkdir(path);
    printToConsole(`System: Created folder "${path}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── Rename modal ──────────────────────────────────────────────
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
            okBtn.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            close.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
            resolve(value);
        }
        function onOk()     { finish(input.value); }
        function onCancel() { finish(null); }
        function onKey(e)   { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
        okBtn.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        close.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
    });
}

async function promptRename(node) {
    if (!node.id) { printToConsole(`System: Cannot rename implicit folder.\n`, 'out-system'); return; }
    const parts       = node.path.split('/');
    const currentName = parts[parts.length - 1];
    const parentPath  = parts.slice(0, -1).join('/');
    const newName     = await openRenameModal(currentName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === currentName) return;
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        printToConsole(`System: Rename rejected — no path separators allowed.\n`, 'out-system'); return;
    }
    const newPath  = parentPath ? parentPath + '/' + trimmed : trimmed;
    const existing = await dbProjectFindByPath(newPath);
    if (existing && existing.id !== node.id) {
        printToConsole(`System: Rename rejected — "${newPath}" already exists.\n`, 'out-system'); return;
    }
    const rec = await dbProjectGet(node.id);
    if (!rec) return;
    if (node.type === 'file') {
        pyoRename(node.path, newPath);
    } else {
        const all      = await dbProjectGetAll();
        const children = all.filter(r => r.id !== node.id && r.data.path.startsWith(node.path + '/'));
        for (const child of children) {
            const childNewPath = newPath + child.data.path.slice(node.path.length);
            if (child.data.type === 'file') pyoRename(child.data.path, childNewPath);
            child.data.path = childNewPath;
            await dbProjectSet(child.id, child.data);
            if (activeProjectFile && activeProjectFile.id === child.id) {
                activeProjectFile.path = childNewPath;
                localStorage.setItem('jinjalab_active_project_path', childNewPath);
                const label = document.getElementById('editor-filename');
                if (label) label.textContent = childNewPath;
            }
        }
    }
    rec.data.path = newPath;
    await dbProjectSet(node.id, rec.data);
    if (activeProjectFile && activeProjectFile.id === node.id) {
        activeProjectFile.path = newPath;
        localStorage.setItem('jinjalab_active_project_path', newPath);
        const label = document.getElementById('editor-filename');
        if (label) label.textContent = newPath;
    }
    printToConsole(`System: Renamed "${node.path}" → "${newPath}".\n`, 'out-system');
    await refreshExplorerUI();
}

// ── Delete ────────────────────────────────────────────────────
async function confirmDelete(node) {
    if (!node.id) { printToConsole(`System: Cannot delete implicit folder.\n`, 'out-system'); return; }
    const all = await dbProjectGetAll();
    const toDelete = node.type === 'folder'
        ? all.filter(r => r.data.path === node.path || r.data.path.startsWith(node.path + '/'))
        : all.filter(r => r.data.path === node.path);
    for (const r of toDelete) {
        await dbProjectDelete(r.id);
        if (r.data.type === 'file') pyoDelete(r.data.path);
    }
    if (activeProjectFile && toDelete.some(r => r.id === activeProjectFile.id)) {
        setActiveProjectFile(null);
    }
    printToConsole(`System: Deleted "${node.path}".\n`, 'out-system');
    refreshExplorerUI();
}

// ── Ctrl+S / Ctrl+Shift+S ────────────────────────────────────
function setupExplorerKeybindings() {
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && e.key === 'S') {
            e.preventDefault(); saveActiveFileAs();
        } else if (mod && e.key === 's') {
            e.preventDefault(); saveActiveFile();
        }
    });
}
