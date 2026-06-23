/* ============================================================
   ui/modal.js
   Attributes modal — canvas resize, default background color,
   transparency mode. Updated for new CSS open/close pattern
   (.modal-backdrop.open vs display:flex) and new DOM IDs.
   All behavioral semantics preserved.
   ============================================================ */

function setupAttributesModalHandlers() {
    const modal         = document.getElementById('attributes-modal');
    const attrW         = document.getElementById('attr-width');
    const attrH         = document.getElementById('attr-height');
    const bgWhiteRadio  = document.getElementById('bg-white');
    const transTrueRadio = document.getElementById('trans-true');
    const openBtn       = document.getElementById('menu-attributes-btn');
    const closeBtn      = document.getElementById('modal-close');
    const cancelBtn     = document.getElementById('modal-cancel');
    const okBtn         = document.getElementById('modal-ok');

    openBtn.addEventListener('click', () => {
        attrW.value = canvas.width;
        attrH.value = canvas.height;
        (defaultBgColor === '#ffffff' ? bgWhiteRadio : document.getElementById('bg-black')).checked = true;
        (transparencyMode === 'transparent' ? transTrueRadio : document.getElementById('trans-false')).checked = true;
        modal.classList.add('open');
        attrW.focus();
    });

    const close = () => modal.classList.remove('open');
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // Keyboard close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });

    okBtn.addEventListener('click', () => {
        const w = parseInt(attrW.value, 10);
        const h = parseInt(attrH.value, 10);

        if (!isNaN(w) && !isNaN(h) && w >= 2 && h >= 2) {
            defaultBgColor   = bgWhiteRadio.checked   ? '#ffffff' : '#000000';
            transparencyMode = transTrueRadio.checked  ? 'transparent' : 'opaque';
            localStorage.setItem("paintlab_default_bg",  defaultBgColor);
            localStorage.setItem("paintlab_transparency", transparencyMode);

            // Cache current pixel content
            const tmp = document.createElement('canvas');
            tmp.width  = canvas.width;
            tmp.height = canvas.height;
            tmp.getContext('2d').drawImage(canvas, 0, 0);

            // Resize surface
            canvas.width  = w;
            canvas.height = h;

            if (transparencyMode === 'opaque') {
                ctx.fillStyle = defaultBgColor;
                ctx.fillRect(0, 0, w, h);
            } else {
                ctx.clearRect(0, 0, w, h);
            }

            // Restore content top-left aligned
            ctx.drawImage(tmp, 0, 0);

            applyZoom();
            writeSessionSnapshot();
            printToConsole(
                `System: Resized canvas to ${w}×${h}. Mode: ${transparencyMode.toUpperCase()}.\n`,
                "out-system"
            );
        } else {
            // Silent rejection — invalid dimensions
            printToConsole(
                "System: Resize ignored — dimensions must be ≥ 2×2.\n",
                "out-system"
            );
        }

        close();
    });
}
