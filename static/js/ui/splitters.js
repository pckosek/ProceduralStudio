/* ============================================================
   ui/splitters.js
   Resizable pane splitters — vertical (editor|inspector) and
   horizontal (inspector|console). Positions persisted to
   localStorage. No behavioral changes from PixelWorkbench.
   ============================================================ */

function setupSplitters() {
    setupVerticalSplitter();
    setupHorizontalSplitter();
}

// ── Vertical splitter: editor-col width ──────────────────────
function setupVerticalSplitter() {
    const resizer   = document.getElementById('v-resizer');
    const editorCol = document.getElementById('editor-col');
    const mainArea  = document.getElementById('main-area');

    const savedW = localStorage.getItem('jinjalab_editor_w');
    if (savedW) {
        editorCol.style.width = savedW;
        editorCol.style.flex  = 'none';
    }

    let startX, startW;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = editorCol.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.style.cursor    = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const delta  = e.clientX - startX;
            const totalW = mainArea.getBoundingClientRect().width;
            const newW   = Math.max(200, Math.min(totalW - 200, startW + delta));
            editorCol.style.width = newW + 'px';
            editorCol.style.flex  = 'none';
            localStorage.setItem('jinjalab_editor_w', newW + 'px');
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor    = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

// ── Horizontal splitter: inspector-area / console-area ───────
function setupHorizontalSplitter() {
    const resizer       = document.getElementById('h-resizer');
    const inspectorArea = document.getElementById('inspector-area');
    const inspectorCol  = document.getElementById('inspector-col');

    const savedH = localStorage.getItem('jinjalab_inspector_h');
    if (savedH) {
        inspectorArea.style.height = savedH;
        inspectorArea.style.flex   = 'none';
    }

    let startY, startH;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startH = inspectorArea.getBoundingClientRect().height;
        resizer.classList.add('dragging');
        document.body.style.cursor    = 'row-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const delta  = e.clientY - startY;
            const totalH = inspectorCol.getBoundingClientRect().height;
            const newH   = Math.max(120, Math.min(totalH - 80, startH + delta));
            inspectorArea.style.height = newH + 'px';
            inspectorArea.style.flex   = 'none';
            localStorage.setItem('jinjalab_inspector_h', newH + 'px');
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor    = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}
