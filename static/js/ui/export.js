/* ============================================================
   ui/export.js — JinjaWorkbench
   Project Export — Download Project as ZIP.

   Exports:
     project-YYYY-MM-DD.zip
       code/   ← Project Explorer files (hierarchy preserved)

   Image Bank removed — JinjaWorkbench has no image domain.
   Archive format is compatible with PixelWorkbench's code/ path.

   Uses JSZip (loaded lazily from CDN on first export).
   Fully browser-local. No backend.
   ============================================================ */

const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

// A single shared Promise so concurrent callers await the same load.
let _jszipPromise = null;

function ensureJSZip() {
    if (window.JSZip)  return Promise.resolve();
    if (_jszipPromise) return _jszipPromise;

    _jszipPromise = new Promise((resolve, reject) => {
        // ── AMD conflict workaround ──────────────────────────────────
        // Monaco's require.js leaves window.define.amd truthy on the page.
        // JSZip's UMD factory checks `typeof define === 'function' && define.amd`
        // and, when true, calls define() to register as an AMD module instead
        // of assigning window.JSZip. The script loads successfully but
        // window.JSZip is never set, so `new JSZip()` throws ReferenceError.
        //
        // Fix: null out define.amd before appending the script tag so the UMD
        // factory takes the global/CommonJS branch, then restore it in onload.
        // ────────────────────────────────────────────────────────────
        const amdBackup = (window.define && window.define.amd) || null;
        if (window.define) window.define.amd = null;

        const s = document.createElement('script');
        s.src = JSZIP_CDN;

        s.onload = () => {
            // Restore Monaco's AMD flag
            if (window.define) window.define.amd = amdBackup;

            if (window.JSZip) {
                resolve();
            } else {
                reject(new Error('JSZip loaded but window.JSZip is not defined'));
            }
        };

        s.onerror = () => {
            if (window.define) window.define.amd = amdBackup;
            reject(new Error('Failed to load JSZip from CDN'));
        };

        document.head.appendChild(s);
    });

    return _jszipPromise;
}

// ── Export ────────────────────────────────────────────────────
async function downloadProject() {
    try {
        printToConsole('System: Building project ZIP…\n', 'out-system');
        await ensureJSZip();

        const zip        = new JSZip();
        const codeFolder = zip.folder('code');

        const projectRecords = await dbProjectGetAll();
        const files = projectRecords.filter(r => r.data.type === 'file');
        for (const r of files) {
            codeFolder.file(r.data.path, r.data.content || '');
        }

        const date     = new Date();
        const pad      = n => String(n).padStart(2, '0');
        const datePart = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
        const zipName  = `project-${datePart}.zip`;

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = zipName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        printToConsole(`System: Project exported — ${files.length} file(s) → "${zipName}"\n`, 'out-system');
    } catch (err) {
        printToConsole(`System Error: Export failed — ${err.message}\n`, 'out-stderr');
    }
}

// ── Import ────────────────────────────────────────────────────
async function importProject(file) {
    const confirmed = confirm('Importing a project will replace the current project.\n\nContinue?');
    if (!confirmed) return;

    try {
        printToConsole('System: Reading ZIP archive…\n', 'out-system');
        await ensureJSZip();

        const zip  = await JSZip.loadAsync(file);
        const keys = Object.keys(zip.files);
        const hasCode = keys.some(k => k.startsWith('code/'));
        if (!hasCode) {
            printToConsole('System Error: Invalid archive — expected a code/ folder.\n', 'out-stderr');
            return;
        }

        // Clear existing project
        const oldProject = await dbProjectGetAll();
        for (const r of oldProject) await dbProjectDelete(r.id);
        setActiveProjectFile(null);

        // Import code/ → Project Explorer
        let fileCount = 0;
        const codeEntries = Object.values(zip.files).filter(f =>
            !f.dir &&
            f.name.startsWith('code/') &&
            !f.name.includes('__MACOSX') &&
            !f.name.includes('.DS_Store')
        );

        for (const entry of codeEntries) {
            const projectPath = entry.name.slice('code/'.length);
            if (!projectPath) continue;
            const content = await entry.async('string');
            const key     = 'proj_' + Date.now() + '_' + fileCount;
            const ext     = projectPath.split('.').pop().toLowerCase();
            const langMap = {
                py: 'python', json: 'json', csv: 'plaintext',
                txt: 'plaintext', md: 'markdown', js: 'javascript',
                html: 'html', css: 'css', jinja: 'html', j2: 'html',
            };
            await dbProjectSet(key, {
                type: 'file', path: projectPath,
                content, language: langMap[ext] || 'plaintext'
            });
            fileCount++;
        }

        await refreshExplorerUI();

        if (window.pyodideInstance) {
            await syncProjectToPyodide();
        }

        printToConsole(`System: Project imported — ${fileCount} file(s).\n`, 'out-system');
    } catch (err) {
        printToConsole(`System Error: Import failed — ${err.message}\n`, 'out-stderr');
    }
}

// ── Wire hidden file input ────────────────────────────────────
function initImportInput() {
    const input = document.getElementById('exp-import-input');
    if (!input) return;
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        await importProject(file);
        input.value = '';
    });
}
