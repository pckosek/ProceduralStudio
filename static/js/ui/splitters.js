/* ============================================================
   ui/splitters.js
   Resizable pane splitters — vertical (editor|canvas) and
   horizontal (canvas|console). Positions persisted to
   localStorage. No behavioral changes to any other system.
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

    // Restore saved width, default to 50%
    const savedW = localStorage.getItem('paintlab_editor_w');
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
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const delta = e.clientX - startX;
            const totalW = mainArea.getBoundingClientRect().width;
            const minW   = 200;
            const maxW   = totalW - 200;
            const newW   = Math.max(minW, Math.min(maxW, startW + delta));
            editorCol.style.width = newW + 'px';
            editorCol.style.flex  = 'none';
            localStorage.setItem('paintlab_editor_w', newW + 'px');
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

// ── Horizontal splitter: workspace-area / console-area ───────
function setupHorizontalSplitter() {
    const resizer       = document.getElementById('h-resizer');
    const workspaceArea = document.getElementById('workspace-area');
    const canvasCol     = document.getElementById('canvas-col');

    // Restore saved height, default to 60%
    const savedH = localStorage.getItem('paintlab_canvas_h');
    if (savedH) {
        workspaceArea.style.height = savedH;
        workspaceArea.style.flex   = 'none';
    }

    let startY, startH;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startH = workspaceArea.getBoundingClientRect().height;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const delta  = e.clientY - startY;
            const totalH = canvasCol.getBoundingClientRect().height;
            const minH   = 120;
            const maxH   = totalH - 80;
            const newH   = Math.max(minH, Math.min(maxH, startH + delta));
            workspaceArea.style.height = newH + 'px';
            workspaceArea.style.flex   = 'none';
            localStorage.setItem('paintlab_canvas_h', newH + 'px');
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}
