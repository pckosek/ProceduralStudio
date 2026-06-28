/* ============================================================
   ui/banks.js — JinjaWorkbench
   Activity bar + sidebar shell + save-name / rename modals.

   Image Bank removed — JinjaWorkbench has no image domain.
   Code Bank removed — replaced by Project Explorer.
   Activity bar wires only the Project Explorer panel.

   Save-name modal and rename modal are generic Workbench
   infrastructure retained unchanged.
   ============================================================ */

// ── Activity bar / sidebar wiring ────────────────────────────
let activeSidebarPanel = null; // 'explorer' | null

function setupActivityBar() {
    const sidebar      = document.getElementById('sidebar');
    const sidebarTitle = document.getElementById('sidebar-title');
    const closeBtn     = document.getElementById('sidebar-close-btn');
    const addBtn       = document.getElementById('sidebar-add-btn');

    document.querySelectorAll('.activity-btn[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;

            if (activeSidebarPanel === panelId) {
                closeSidebar();
                return;
            }

            activeSidebarPanel = panelId;
            document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.sidebar-body').forEach(p => p.classList.remove('active'));
            document.getElementById('panel-' + panelId).classList.add('active');

            const titles = { 'explorer': 'Project' };
            sidebarTitle.textContent = titles[panelId] || panelId;

            if (panelId === 'explorer') refreshExplorerUI();

            sidebar.classList.remove('collapsed');
        });
    });

    closeBtn.addEventListener('click', closeSidebar);

    // + button: context-sensitive per active panel
    addBtn.addEventListener('click', () => {
        if (activeSidebarPanel === 'explorer') promptNewFile('');
    });
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('collapsed');
    document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
    activeSidebarPanel = null;
}

// ── Save-name modal ───────────────────────────────────────────
function openSaveNameModal(defaultName = '') {
    return new Promise((resolve) => {
        const modal  = document.getElementById('save-name-modal');
        const input  = document.getElementById('save-name-input');
        const okBtn  = document.getElementById('save-name-ok');
        const cancel = document.getElementById('save-name-cancel');
        const close  = document.getElementById('save-name-close');

        input.value = defaultName;
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
        function onOk()     { finish(input.value.trim() || defaultName || 'Untitled'); }
        function onCancel() { finish(null); }
        function onKey(e)   {
            if (e.key === 'Enter')  onOk();
            if (e.key === 'Escape') onCancel();
        }
        okBtn.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        close.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
    });
}

// ── Console clear button ──────────────────────────────────────
function setupConsoleClear() {
    document.getElementById('console-clear-btn').addEventListener('click', () => {
        document.getElementById('console-output').textContent = '';
    });
}
