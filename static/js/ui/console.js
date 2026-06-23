/* ============================================================
   ui/console.js
   In-app output console — routes Python stdout, stderr,
   exceptions, and system messages into the UI panel.
   No browser DevTools dependency. No behavioral changes.
   ============================================================ */

function printToConsole(text, cssClass = 'out-stdout') {
    const consoleOutput = document.getElementById('console-output');
    const span = document.createElement('span');
    span.className = cssClass;
    span.textContent = text;
    consoleOutput.appendChild(span);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
