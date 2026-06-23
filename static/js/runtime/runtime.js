/* ============================================================
   runtime/runtime.js
   Pyodide runtime initialization, AMD compatibility workaround,
   Python bridge injection, and the Run button execution pipeline.
   Updated for new DOM IDs: #status-badge, #run-btn-label.
   All behavioral semantics preserved.
   ============================================================ */

let pyodideInstance = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src   = src;
        script.async = true;
        script.onload  = resolve;
        script.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(script);
    });
}

function setStatus(text, badgeClass) {
    const badge = document.getElementById('status-badge');
    badge.textContent = text;
    badge.className   = badgeClass;
}

async function initializePyodide() {
    // ---> WORKAROUND: Monaco AMD loader and Pyodide stackframe behavior conflict.
    // Suppress AMD temporarily while Pyodide initializes, then restore.
    const originalAmd = window.define && window.define.amd;
    if (window.define) window.define.amd = false;

    setStatus("Python…", "badge-loading");
    pyodideInstance = await loadPyodide({
        stdout: (text) => printToConsole(text + '\n', 'out-stdout'),
        stderr: (text) => printToConsole(text + '\n', 'out-stderr')
    });

    setStatus("Pillow…", "badge-loading");
    await pyodideInstance.loadPackage("pillow");

    // Restore Monaco AMD loader
    if (window.define && originalAmd) window.define.amd = originalAmd;
    // --------------------------------------------------------

    setStatus("Bridge…", "badge-loading");
    pyodideInstance.runPython(`
import io, base64, js
from PIL import Image

def _b64_to_pil(data_url):
    """Convert a PNG data-URL string to a PIL Image (alpha-safe)."""
    _header, _data = data_url.split(',', 1)
    return Image.open(io.BytesIO(base64.b64decode(_data)))

async def get_image(name=None):
    """Return a PIL Image.

    get_image()
        Returns the active canvas as a PIL Image. Unchanged behaviour.

    get_image("name")
        Fetches a named image from the Image Bank by exact name.
        Raises ValueError if no image with that name exists.

    Examples:
        img = await get_image()
        img = await get_image("maze_seed")
    """
    if name is None:
        return _b64_to_pil(js.getCanvasBase64())
    data_url = await js.getImageBankBase64(name)
    if data_url is None:
        raise ValueError(f'Image Bank: no image named "{name}"')
    return _b64_to_pil(data_url)

def set_image(pil_img):
    """Write a PIL Image back to the active canvas.

    Example:
        set_image(modified_img)
    """
    buffered = io.BytesIO()
    pil_img.save(buffered, format="PNG")
    js.setCanvasFromBase64(base64.b64encode(buffered.getvalue()).decode('utf-8'))

def get_selection():
    """Return the currently selected region as a PIL Image.

    The original canvas is unchanged. The selection rectangle remains active.
    Returns None if no selection is currently active.

    Example:
        region = get_selection()
        if region:
            region_inverted = ImageOps.invert(region.convert('RGB'))
    """
    data_url = js.getSelectionBase64()
    if data_url is None:
        print("get_selection(): no active selection. Use the Select tool first.")
        return None
    return _b64_to_pil(data_url)

async def save_image(pil_img, name):
    """Save a PIL Image to the Image Bank by name.

    Creates a new entry or overwrites an existing entry with the same name.
    This matches the overwrite-by-name semantics of the manual Save button.

    After saving, the image is immediately available via:
        await get_image("name")
    and via the Image Bank UI (click the Image Bank icon in the sidebar).

    Example:
        img = generate_maze()
        await save_image(img, "maze_01")
    """
    buffered = io.BytesIO()
    pil_img.save(buffered, format="PNG")
    b64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    ok = await js.saveImageToBank(name, b64)
    if not ok:
        print(f"save_image(): failed to save '{name}'")

import __main__
__main__.get_image     = get_image
__main__.set_image     = set_image
__main__.get_selection = get_selection
__main__.save_image    = save_image
    `);

    // Expose globally so explorer.js pyoWrite/pyoDelete etc. can access it
    window.pyodideInstance = pyodideInstance;

    // Sync all saved project files into Pyodide FS and chdir to /project
    await syncProjectToPyodide();
}

function setupRunButton() {
    const runBtn      = document.getElementById('run-btn');
    const runBtnLabel = document.getElementById('run-btn-label');
    const consoleOutput = document.getElementById('console-output');

    runBtn.addEventListener('click', async () => {
        if (!pyodideInstance || !editorInstance) return;

        consoleOutput.textContent = '';
        runBtn.disabled      = true;
        runBtnLabel.textContent = 'Running…';
        setStatus("Running", "badge-loading");

        try {
            await pyodideInstance.runPythonAsync(editorInstance.getValue());
            setStatus("OK", "badge-ready");
        } catch (err) {
            setStatus("Error", "badge-error");
            printToConsole(err.message + '\n', 'out-stderr');
        } finally {
            runBtn.disabled     = false;
            runBtnLabel.textContent = 'Run';
        }
    });
}
