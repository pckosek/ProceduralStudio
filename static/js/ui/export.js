/* ============================================================
   ui/export.js
   Project Export — Download Project as ZIP.

   Exports:
     project.zip
       code/       ← Project Explorer files (hierarchy preserved)
       images/     ← Image Bank entries (PNG, named)

   Uses JSZip (loaded lazily from CDN on first export).
   Fully browser-local. No backend. No upload.
   ============================================================ */

const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let jszipLoaded = false;

async function ensureJSZip() {
    if (jszipLoaded || window.JSZip) { jszipLoaded = true; return; }
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSZIP_CDN;
        s.onload  = () => { jszipLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('Failed to load JSZip from CDN'));
        document.head.appendChild(s);
    });
}

// ── Main export function ──────────────────────────────────────
async function downloadProject() {
    try {
        printToConsole('System: Building project ZIP…\n', 'out-system');
        await ensureJSZip();

        const zip = new JSZip();
        const codeFolder   = zip.folder('code');
        const imagesFolder = zip.folder('images');

        // ── Code: Project Explorer files ─────────────────────
        const projectRecords = await dbProjectGetAll();
        const files = projectRecords.filter(r => r.data.type === 'file');

        for (const r of files) {
            // path is relative to project root e.g. "generators/maze.py"
            // Preserve full hierarchy under code/
            codeFolder.file(r.data.path, r.data.content || '');
        }

        // ── Images: Image Bank entries ────────────────────────
        const imageEntries = await dbGetAllSavedImages();

        for (const entry of imageEntries) {
            const name    = entry.data.name || ('image_' + entry.id);
            const base64  = entry.data.base64 || '';
            if (!base64) continue;

            // base64 may be a data URL ("data:image/png;base64,...")
            // Strip the header to get raw base64 for JSZip
            const raw = base64.startsWith('data:')
                ? base64.split(',')[1]
                : base64;

            // Ensure .png extension — Image Bank stores PNG only
            const filename = name.endsWith('.png') ? name : name + '.png';
            imagesFolder.file(filename, raw, { base64: true });
        }

        // ── Generate and trigger download ─────────────────────
        const date    = new Date();
        const pad     = n => String(n).padStart(2, '0');
        const datePart = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
        const zipName  = `project-${datePart}.zip`;

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        const fileCount  = files.length;
        const imageCount = imageEntries.length;
        printToConsole(
            `System: Project exported successfully — ${fileCount} code file(s), ${imageCount} image(s) → "${zipName}"\n`,
            'out-system'
        );

    } catch (err) {
        printToConsole(`System Error: Export failed — ${err.message}\n`, 'out-stderr');
        console.error('Export error:', err);
    }
}

// ── Import Project from ZIP ───────────────────────────────────
// Inverse of downloadProject(). Reads a ZIP and restores the
// project and Image Bank using the same persistence APIs as export.
// Replace-current-project semantics: clears existing state first.

async function importProject(file) {
    // ── Confirmation ──────────────────────────────────────────
    const confirmed = confirm(
        'Importing a project will replace the current project and Image Bank.\n\nContinue?'
    );
    if (!confirmed) return;

    try {
        printToConsole('System: Reading ZIP archive…\n', 'out-system');
        await ensureJSZip();

        const zip = await JSZip.loadAsync(file);

        // ── Validate: must have code/ or images/ (at least one) ──
        const keys   = Object.keys(zip.files);
        const hasCode   = keys.some(k => k.startsWith('code/'));
        const hasImages = keys.some(k => k.startsWith('images/'));
        if (!hasCode && !hasImages) {
            printToConsole(
                'System Error: Invalid archive — expected code/ or images/ folders.\n',
                'out-stderr'
            );
            return;
        }

        // ── Clear current project (Explorer + Image Bank) ─────
        printToConsole('System: Clearing current project…\n', 'out-system');

        const oldProject = await dbProjectGetAll();
        for (const r of oldProject) await dbProjectDelete(r.id);

        const oldImages = await dbGetAllSavedImages();
        for (const r of oldImages) await dbDelete(r.id);

        // Clear active file identity — Monaco will show untitled after import
        setActiveProjectFile(null);

        // ── Import code/ → Project Explorer ──────────────────
        let fileCount = 0;
        const codeEntries = Object.values(zip.files).filter(f =>
            !f.dir &&
            f.name.startsWith('code/') &&
            !f.name.includes('__MACOSX') &&
            !f.name.includes('.DS_Store')
        );

        for (const entry of codeEntries) {
            // Strip leading "code/" to get the project-relative path
            const projectPath = entry.name.slice('code/'.length);
            if (!projectPath) continue; // skip the code/ directory entry itself

            const content  = await entry.async('string');
            const key      = 'proj_' + Date.now() + '_' + fileCount;
            const ext      = projectPath.split('.').pop().toLowerCase();
            const langMap  = {
                py: 'python', json: 'json', csv: 'plaintext',
                txt: 'plaintext', md: 'markdown', js: 'javascript',
                html: 'html', css: 'css'
            };
            await dbProjectSet(key, {
                type: 'file',
                path: projectPath,
                content,
                language: langMap[ext] || 'plaintext'
            });
            fileCount++;
        }

        // ── Import images/ → Image Bank ───────────────────────
        let imageCount = 0;
        const imageEntries = Object.values(zip.files).filter(f =>
            !f.dir &&
            f.name.startsWith('images/') &&
            !f.name.includes('__MACOSX') &&
            !f.name.includes('.DS_Store')
        );

        for (const entry of imageEntries) {
            const filename = entry.name.slice('images/'.length);
            if (!filename) continue;

            // Name without .png extension (Image Bank stores name without extension)
            const name = filename.endsWith('.png')
                ? filename.slice(0, -4)
                : filename;

            try {
                const raw    = await entry.async('base64');
                const base64 = 'data:image/png;base64,' + raw;
                const key    = 'bank_' + Date.now() + '_' + imageCount;
                await dbSet(key, { name, base64 });
                imageCount++;
            } catch (imgErr) {
                printToConsole(
                    `System: Skipped "${filename}" — ${imgErr.message}\n`,
                    'out-stderr'
                );
            }
        }

        // ── Refresh UI ────────────────────────────────────────
        await refreshExplorerUI();
        await refreshImageBankUI();

        // ── Sync Pyodide filesystem ───────────────────────────
        // syncProjectToPyodide() creates /project/, writes all files,
        // and calls os.chdir('/project') — same as boot-time sync.
        if (window.pyodideInstance) {
            await syncProjectToPyodide();
        }

        printToConsole(
            `System: Project imported — ${fileCount} code file(s), ${imageCount} image(s).\n`,
            'out-system'
        );

    } catch (err) {
        printToConsole(`System Error: Import failed — ${err.message}\n`, 'out-stderr');
        console.error('Import error:', err);
    }
}

// ── Wire the hidden file input (called once from app.js Phase 1) ─
// #exp-import-input is in the static HTML and always present at DOMContentLoaded.
// The button (#exp-import) is dynamic (rendered by renderTree) and is wired
// directly inside renderTree — no setup needed here for the button itself.
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
