# Workbench Evolution Plan
**From:** PixelWorkbench v1
**To:** A family of educational coding environments
**Date:** June 2026
**Philosophy:** Let the Core emerge from two successful products. Not from theory.

---

## Framing Principle

The architecture analysis identified what *could* be shared. This document answers a different question: what *should* be shared, *when*, and at what cost.

The guiding rule: **duplication is cheaper than the wrong abstraction.** A poorly designed Workbench Core would need to be changed twice — once to fit JinjaWorkbench, once to fit AudioWorkbench — and both products would drag along the breaking changes. Two independent products with clearly observed differences are a much stronger foundation for a shared core than one product plus a theory.

This plan protects PixelWorkbench from disruption, gives JinjaWorkbench the fastest possible path to working software, and defers the Core extraction until there is real evidence about where the two products actually agree.

---

## 1. Module Disposition Table

### 1.1 Modules That Should Remain Untouched

These live exclusively in PixelWorkbench. Nothing happening in JinjaWorkbench should touch them, read them, or depend on them.

| Module | Reason to leave alone |
|---|---|
| `canvas/canvas.js` | Entire graphics layer; zero relevance to Jinja |
| `ui/modal.js` | Canvas Attributes modal; PixelWorkbench-only |
| Image Bank portions of `ui/banks.js` | Image-specific UI; not relevant to template work |
| Image store portions of `persistence/db.js` | `images` object store + `autosave_canvas` key |
| Image ZIP path in `ui/export.js` | `images/` folder in archive |
| Phase 2 graphics restoration in `app.js` | Zoom, tool, color, brush, canvas autosave restore |
| All CSS paint toolbox rules in `styles.css` | Toolbox, alpha slider, color swatch, canvas mat |

These are safe because they have no consumers outside PixelWorkbench. They do not need to be moved, parameterized, or wrapped. They simply stay.

### 1.2 Modules That Should Be Copied Into JinjaWorkbench

These modules are generic enough to use as-is, but **not yet stable enough in their abstraction** to share as a library. Copy them, let them diverge, and observe how they diverge. That divergence is the design signal for a future Core.

| Module | What to copy | Expected divergence |
|---|---|---|
| `persistence/db.js` | The project store functions only (`dbProject*`) | JinjaWorkbench may add a "render cache" store; the schema may differ from PixelWorkbench's schema as requirements clarify |
| `ui/explorer.js` | Entire file | JinjaWorkbench may need multi-file awareness (template + data file run together); active file semantics may differ |
| `ui/export.js` | The `code/` path only | JinjaWorkbench may export rendered HTML alongside source; archive format may gain a `rendered/` folder |
| `ui/banks.js` | Activity bar + sidebar shell + save-name modal only | JinjaWorkbench sidebar panels will be different; copy the shell, replace the panel contents |
| `ui/splitters.js` | Entire file | Unlikely to diverge, but too small to formalize as a dependency |
| `ui/console.js` | Entire file | May gain output types (`out-render`, `out-template-error`); let it evolve before standardizing |
| `editor/editor.js` | Entire file | Default language, default starter code, and possibly multi-editor support will differ |
| `styles.css` | Design tokens + generic layout rules only | Preview panel will need new layout rules; let them grow in place |
| `app.js` | Structure (3-phase boot) | Phase 1/2/3 contents will be almost entirely different; value is in the pattern, not the code |

**The reason to copy rather than share:** if a shared `explorer.js` is changed to support JinjaWorkbench's multi-file execution model, that change must not silently affect PixelWorkbench. Copies are firewalls. Shared libraries are shared risk.

### 1.3 Modules That Should Become Shared Immediately

There is one and only one module that is small enough, stable enough, and dependency-free enough to share right now without risk:

| Module | Rationale |
|---|---|
| `ui/console.js` | 15 lines. One function. No state. No DOM dependencies other than `#console-output`. The only way this could diverge is if one workbench renames its console element, which would be a 1-line fix. |

This is not a library. It is a shared file. The distinction matters: it lives in the repository once, both products reference it, and changing it affects both. That is acceptable only because the risk is so low.

**Everything else waits.**

### 1.4 Modules That Should NOT Become Shared Until After JinjaWorkbench Exists

These are the candidates that *look* generic but need real-world evidence before they can be trusted as shared infrastructure.

| Module | Why it must wait | What needs to be observed first |
|---|---|---|
| `ui/explorer.js` | The most complex module; active file model, Pyodide FS sync, dirty state, drag/drop. JinjaWorkbench may need "paired file" concepts (template + data), or a "run context" that is multiple files, not one. | Whether the active-file model generalizes to multi-file execution contexts. |
| `persistence/db.js` | DB schema, version numbers, and migration strategy need to be battle-tested. A shared DB module that goes through a breaking version migration would corrupt data in both products simultaneously. | How schema migrations behave in JinjaWorkbench; whether DB_VERSION conflict is a risk during parallel development. |
| `runtime/runtime.js` | Bridge injection is hardcoded. Package loading is hardcoded. AMD workaround may behave differently with future Pyodide versions. | What the Jinja runtime bridge actually looks like; whether `runPythonAsync` semantics hold for a template render workflow (which may be synchronous). |
| `ui/export.js` | Archive format may need to carry rendered output (`rendered/`), which would be nonsensical for PixelWorkbench. | Whether the ZIP format should be standardized across workbenches, and if so, what the common schema is. |
| `app.js` | Boot sequence is tightly coupled to each product's subsystem setup. | Whether the 3-phase pattern is the right abstraction, or whether JinjaWorkbench naturally wants a different initialization graph. |

The rule of thumb: **don't share a module until you have changed it for two different reasons across two products.** That is the signal that an abstraction boundary exists there.

### 1.5 Modules Likely to Evolve Differently Between the Two Workbenches

These are the architectural pressure points — places where the two products will pull in different directions. Understanding this in advance prevents premature convergence.

| Module | PixelWorkbench direction | JinjaWorkbench direction | Implication |
|---|---|---|---|
| `editor/editor.js` | Single active file, Python only, Ctrl+Enter runs it | Potentially two editors (template + data), or tab-based multi-file editing; possibly two languages (Jinja2 + JSON) simultaneously | Multi-editor support is a significant architectural change; do not attempt to share until both patterns are stable |
| `ui/explorer.js` | Active file = the file being run; execution context = single file | Active file may be a "template", but execution requires selecting both a template AND a data file; "run context" may be a pair or a folder | This is the deepest design question in JinjaWorkbench. Do not share until resolved. |
| `runtime/runtime.js` | `runPythonAsync(code)` where code IS the thing being run | `runPythonAsync(code)` where code renders a template against data; Python may be a coordination layer rather than the primary artifact | Bridge API will be completely different |
| `ui/banks.js` (panel contents) | Image Bank: visual thumbnails, load/save PNG | JinjaWorkbench needs no Image Bank; may need a "Data Bank" (JSON snippets) or a "Template Bank" | Sidebar panel contents diverge immediately; shell can be shared eventually |
| Phase 2 state restoration (`app.js`) | Restores zoom, tool, color, brush, canvas autosave | Restores last-open template, last-used data file, preview scroll position | Restoration logic will be entirely different; confirms these must not be in a shared module |
| `styles.css` (layout rules) | Three columns possible: sidebar + editor + canvas+console | Three columns possible: sidebar + editor + preview+console; but preview is an iframe, not a canvas — overflow, scrolling, and sizing behavior differ | CSS layout rules for the right panel will diverge; design tokens (colors, type, spacing) will stay identical |

---

## 2. What JinjaWorkbench Needs That PixelWorkbench Doesn't Have

This section documents the net-new requirements so they don't accidentally contaminate PixelWorkbench's codebase.

### 2.1 Preview Panel

JinjaWorkbench replaces the canvas column with a preview panel. This panel:
- Contains an `<iframe>` (sandboxed, no `allow-scripts` unless intentional)
- Receives rendered HTML from Python via a bridge function (`window.setPreviewHTML(html)`)
- Needs its own scroll state, zoom (CSS scale or browser zoom), and error state
- Has no paint tools, no overlay, no selection

This is entirely new infrastructure. It should be built from scratch in JinjaWorkbench with no borrowing from `canvas.js`.

### 2.2 Jinja Runtime Bridge

The Python bridge will be different in kind, not just in content:

| PixelWorkbench | JinjaWorkbench |
|---|---|
| `get_image()` / `set_image()` | `get_template(name)` / `get_data(name)` |
| `save_image(img, name)` | `set_output(html_string)` |
| Canvas state is mutable and persistent | Rendered output is ephemeral; inputs are the source of truth |

The data transport for PixelWorkbench is base64 PNG. For JinjaWorkbench it will be UTF-8 strings (template source, JSON data, rendered HTML). The bridge pattern — Python calls `js.*` functions — is the same, but the payload and semantics are different.

### 2.3 Multi-File Execution Context

PixelWorkbench has a single active file. Running code = running the active file.

JinjaWorkbench likely needs a "render context": a template file + a data file (JSON), possibly selected independently. The Run button would mean "render this template with this data." This affects:
- The editor header (which file is shown?)
- The Explorer (how is the "run pair" indicated?)
- The Run button (what does it execute?)
- State restoration (which template + which data was last used?)

This is the defining design question of JinjaWorkbench and should be resolved empirically during development, not pre-specified.

### 2.4 Multi-Language Editor

JinjaWorkbench files include `.html.j2` (or `.jinja`), `.json`, `.css`, and possibly `.py`. Monaco supports all of these. The extension-to-language map in `explorer.js` already handles JSON, HTML, and CSS, but Jinja2 syntax is not a built-in Monaco language. A TextMate grammar or a simple tokenizer will need to be added or a CDN source found.

---

## 3. Risk Analysis

### 3.1 Risk: Premature Sharing Breaks PixelWorkbench

**Likelihood:** High, if shared modules are introduced before JinjaWorkbench's requirements are clear.
**Impact:** Students encounter bugs or regressions in a working, stable product.
**Mitigation:** The module disposition above is conservative by design. `console.js` is the only shared file. Everything else is copied. PixelWorkbench's codebase is frozen with respect to JinjaWorkbench development.

### 3.2 Risk: Copies Diverge So Far They Can Never Be Reunited

**Likelihood:** Medium. Developers working on JinjaWorkbench will fix bugs in the copied `explorer.js` or `db.js`. Those fixes will not propagate back to PixelWorkbench.
**Impact:** Two separately maintained codebases with the same bugs fixed twice (or not fixed in one).
**Mitigation:** Keep a shared bug-fix log during JinjaWorkbench development. When a fix is made in a copied module, note it explicitly. This becomes the input to the Core extraction phase. Accept this cost — it is real but bounded.

### 3.3 Risk: The "Run Context" Problem Is Harder Than Expected

**Likelihood:** Medium-High. Multi-file execution (template + data) is a design problem without a clear solution yet.
**Impact:** JinjaWorkbench's Explorer and editor architecture could be significantly different from PixelWorkbench's. If a Core was already shared, it would need to be redesigned.
**Mitigation:** This is precisely why the Explorer is not shared. Let JinjaWorkbench solve this problem freely. Observe the solution. Then decide what the Core's execution model should be.

### 3.4 Risk: IndexedDB Schema Conflicts During Development

**Likelihood:** Low, if repositories are separate. Medium, if development happens in one repo with shared DB names.
**Impact:** A schema migration in JinjaWorkbench's copy of `db.js` that bumps `DB_VERSION` would have no effect on PixelWorkbench because they are separate. But if they share a database name (`PaintLabStorage`), a version conflict on the same browser would corrupt one product's data.
**Mitigation:** JinjaWorkbench must use a different `DB_NAME` from the start. Suggest `JinjaWorkbenchStorage`. This is a one-line change in the copied `db.js` and completely eliminates the risk.

### 3.5 Risk: Workbench Core Is Designed Too Early and Becomes a Constraint

**Likelihood:** Medium, given enthusiasm after seeing the architecture analysis.
**Impact:** A premature Core would be designed around one product's assumptions. JinjaWorkbench would be forced to contort itself to fit, or the Core would need breaking changes.
**Mitigation:** The plan explicitly defers Core extraction until JinjaWorkbench v1 is complete. The architecture analysis is a description, not a prescription. Core extraction is Milestone 4, not Milestone 1.

### 3.6 Risk: Flask Remains a Development Dependency

**Likelihood:** Certain (Flask is currently required to serve the Jinja2 template for `url_for`).
**Impact:** Low for development, but it means the app is not a pure static site. For JinjaWorkbench, there is a philosophical question: should the app server's Jinja2 be used, or should all template rendering happen in Pyodide? Using Pyodide for rendering is the educationally correct answer (students see the same engine they're learning), but it requires serving `index.html` as a static file (no `url_for`).
**Mitigation:** Consider whether JinjaWorkbench should serve a static `index.html` with hardcoded asset paths. This decouples the educational content (Jinja2 in Pyodide) from the server-side Jinja2 (Flask template rendering). Decide this early — it affects deployment.

---

## 4. Git Branching Strategy

### 4.1 Recommended Approach: Two Separate Repositories

The cleanest strategy, given the philosophy of avoiding premature abstraction, is to create a separate repository for JinjaWorkbench. This provides:
- No risk of JinjaWorkbench commits accidentally modifying PixelWorkbench files
- Independent version histories, issues, and release cycles
- A natural forcing function for the Core extraction later ("what would it take to share this?")
- Freedom for JinjaWorkbench to develop at its own pace without affecting PixelWorkbench's `main`

**Repository structure:**
```
pckosek/PixelWorkbench      (renamed from ProceduralStudio, or keep as-is)
pckosek/JinjaWorkbench      (new repository)
pckosek/WorkbenchCore       (created at Milestone 4, currently does not exist)
```

**Not recommended:** A monorepo with `packages/pixel-workbench` and `packages/jinja-workbench`. Monorepos are appropriate when sharing is already happening. They introduce tooling overhead (workspace managers, build tools) that is not yet justified. Create the monorepo when the Core exists, not before.

### 4.2 PixelWorkbench Branch Strategy (Existing Repo)

The current `jinja-workbench` branch name is already a source of confusion. Before starting JinjaWorkbench development:

```
main                    ← stable, deployed PixelWorkbench v1
jinja-workbench         ← rename to something less confusing, or merge to main
                          (this branch is just the latest stable state — not Jinja-specific)
```

**Suggested immediate action:**
1. Merge `jinja-workbench` → `main` in PixelWorkbench repo (it is stable)
2. Tag `v1.0.0` on that merge commit
3. Rename the repo from `ProceduralStudio` to `PixelWorkbench` (optional but clarifying)
4. Freeze `main` — only bug fixes go in during JinjaWorkbench development

**PixelWorkbench branches going forward:**
```
main                    ← v1 stable
hotfix/*                ← bug fixes only, merged to main and tagged
feature/*               ← new PixelWorkbench features (deferred until after JinjaWorkbench v1)
```

### 4.3 JinjaWorkbench Branch Strategy (New Repo)

```
main                    ← production-ready (empty until Milestone 2 complete)
dev                     ← active development
feature/*               ← feature branches off dev
```

Bootstrap the repo by copying the relevant files (per §1.2), committing them as `feat: initial scaffold from PixelWorkbench v1`, and immediately making the JinjaWorkbench-specific changes (DB name, default code, remove graphics restoration from boot). This commit history makes the lineage explicit without creating a formal dependency.

---

## 5. Repository Strategy

### 5.1 What Goes in JinjaWorkbench at Creation

Files copied verbatim from PixelWorkbench (noted as such in commit message):
- `persistence/db.js` (project store functions only; image store removed; DB_NAME changed)
- `ui/explorer.js` (full copy; Pyodide FS sync kept; Image Bank UI removed)
- `ui/export.js` (code/ path only; images/ path removed)
- `ui/banks.js` (activity bar + sidebar shell + save-name modal; Image Bank panel removed)
- `ui/splitters.js` (full copy)
- `ui/console.js` (full copy — or linked if same-repo; see §1.3)
- `editor/editor.js` (full copy; default language and code changed)
- `styles.css` (design tokens + generic layout; paint toolbox rules removed)

Files created from scratch:
- `preview/preview.js` (iframe preview panel — new)
- `runtime/runtime.js` (Pyodide init copied; bridge injection replaced entirely)
- `app.js` (3-phase structure copied; Phase 1/2/3 contents replaced)
- `templates/index.html` (new DOM; no canvas, no toolbox; add preview iframe)

Files not created (do not exist in JinjaWorkbench):
- `canvas/canvas.js`
- `ui/modal.js` (canvas attributes)
- Any image store code

### 5.2 What to Record for Future Core Extraction

Create a `DIVERGENCE.md` file in each repository. This is a lightweight engineering diary, not a formal changelog. When a copied module is modified for workbench-specific reasons, note it:

```markdown
## explorer.js
- 2026-07-15: Added "run context" concept — active file + active data file pair.
  PixelWorkbench's explorer has no equivalent. This is a JinjaWorkbench-specific extension.

## db.js
- 2026-07-20: Added `render_cache` store for storing last rendered output per template.
  PixelWorkbench has no equivalent. DB_VERSION bumped to 4.
```

This file becomes the primary input to the Core extraction design session at Milestone 4. Without it, the extraction would require re-reading both codebases in full.

---

## 6. Milestones

### Milestone 0: PixelWorkbench Stabilization (Now → 1 week)
*Goal: Lock the baseline before JinjaWorkbench begins.*

- [ ] Merge `jinja-workbench` branch to `main` in PixelWorkbench repo
- [ ] Tag `v1.0.0`
- [ ] Confirm no open bugs that would affect the copied modules
- [ ] Write brief `ARCHITECTURE.md` in PixelWorkbench repo summarizing the subsystem map (can be adapted from the analysis document)
- [ ] Decision: rename repo from `ProceduralStudio` to `PixelWorkbench`?

**Exit criteria:** PixelWorkbench has a tagged v1.0.0. No active development branches in flight.

---

### Milestone 1: JinjaWorkbench Scaffold (1–2 weeks)
*Goal: A working shell with Monaco, Pyodide, Project Explorer, and a preview panel — no rendering yet.*

- [ ] Create `JinjaWorkbench` repository
- [ ] Copy modules per §5.1, commit with lineage note
- [ ] Modify DB_NAME to `JinjaWorkbenchStorage`
- [ ] Remove all graphics restoration from boot sequence
- [ ] Remove canvas column from HTML; add preview iframe placeholder
- [ ] Confirm Monaco loads and accepts a `.jinja` or `.html` file
- [ ] Confirm Pyodide loads (no Pillow)
- [ ] Confirm Project Explorer works: create, rename, delete, ZIP export/import
- [ ] Confirm console output works
- [ ] Create `DIVERGENCE.md`

**Exit criteria:** A browser page that looks like PixelWorkbench but has a preview panel instead of a canvas, with working file management and a Python runtime.

---

### Milestone 2: JinjaWorkbench v1 — Template Rendering (4–8 weeks)
*Goal: Students can write Jinja2 templates and JSON data files, run them, and see rendered HTML in the preview panel.*

**Phase A — Bridge design:**
- [ ] Decide on the Python bridge API: what functions does Python expose? (`render()`, `set_output()`, `get_template()`, `get_data()`?)
- [ ] Implement `window.setPreviewHTML(html)` in preview.js
- [ ] Inject bridge into Pyodide `__main__`
- [ ] Confirm round-trip: write template → click Run → see rendered HTML in iframe

**Phase B — Run context:**
- [ ] Decide: single active file, or template+data pair?
- [ ] Implement chosen execution model in Explorer
- [ ] Update Run button to execute the appropriate context
- [ ] Update state restoration for the new context model

**Phase C — Jinja2 syntax support:**
- [ ] Investigate Monaco Jinja2 language support (TextMate grammar or CDN package)
- [ ] Add `.jinja`, `.j2`, `.html.j2` to extension-language map
- [ ] Confirm syntax highlighting in editor

**Phase D — Polish:**
- [ ] Preview panel error display (Jinja render errors are different from Python runtime errors)
- [ ] ZIP import/export tested with template projects
- [ ] Default starter project (a template + JSON data + CSS)
- [ ] README and educational context

**Exit criteria:** A student can create a Jinja2 project, write a template and data file, click Run, and see rendered HTML. ZIP export and import preserve the project.

---

### Milestone 3: JinjaWorkbench v1 Retrospective (1 week)
*Goal: Extract design lessons before building anything shared.*

Before writing a single line of WorkbenchCore:

- [ ] Review `DIVERGENCE.md` in both repositories
- [ ] Document: what did the copied `explorer.js` become in JinjaWorkbench? Is it still recognizably the same?
- [ ] Document: what is actually the same between the two boot sequences?
- [ ] Document: what is the right abstraction for "run context"? Single file? Multi-file? Plugin-supplied?
- [ ] Document: did the ZIP format stay the same, or did JinjaWorkbench's archive look different?
- [ ] Document: where did bugs get fixed in JinjaWorkbench copies that were not fixed in PixelWorkbench?
- [ ] Answer: is `console.js` still the only thing that truly stayed the same?
- [ ] Answer: what would break if we tried to share `explorer.js` today?

**Produce a 1-page "Core Extraction Brief"** that answers: what belongs in the Core, what the Core's API should look like, and what the migration path is for both existing products.

**Exit criteria:** The Core Extraction Brief exists and has been reviewed. The decision to proceed with extraction is explicit and informed.

---

### Milestone 4: WorkbenchCore v0.1 (4–6 weeks)
*Goal: Extract the Core from the evidence of two products. Do not introduce new abstractions.*

The Core should contain only things that:
1. Exist in both products
2. Are genuinely identical or differ only by configuration
3. Have been tested in production (by students, not just developers)

**Likely Core candidates at this point** (to be confirmed by M3 retrospective):
- Design system CSS tokens
- `console.js`
- Sidebar shell + activity bar
- Splitters
- Save-name / rename modals
- The ZIP `code/` path
- Project store `db.js` functions (if schema converged)

**Likely NOT Core at this point** (confirmed by M3 retrospective):
- `explorer.js` in full (unless run context model converged)
- `runtime.js` (bridge injection differs per workbench)
- `editor.js` (if multi-editor needed for JinjaWorkbench)

Migration path:
- Create `WorkbenchCore` repository (or `workbench-core` npm package)
- Both products replace their copied modules with the shared dependency
- Each product still owns its domain-specific modules entirely
- No product is required to change its architecture to fit the Core

**Exit criteria:** Both products depend on WorkbenchCore. The Core has at least one failing test that would prevent an accidental regression in either product.

---

### Milestone 5: AudioWorkbench or WebWorkbench (future)
*Goal: A third workbench confirms or refutes the Core's API.*

The Core becomes trusted when a third product can be built using it without modifying it. If building the third workbench requires changes to the Core, that is information about where the abstractions were wrong. This milestone is out of scope for the current plan but is the natural successor.

---

## 7. Lessons to Learn Before Introducing the Core

These are the open questions that must be answered by JinjaWorkbench's existence, not by design sessions:

**1. What is the right model for "run context"?**
PixelWorkbench: run = execute the active file.
JinjaWorkbench: run = render template X with data Y.
AudioWorkbench (future): run = process audio through pipeline Z.
The Core's execution model must accommodate all of these. It cannot be designed until at least two are understood.

**2. Does the Explorer need to know about execution, or just files?**
Currently the Explorer owns Pyodide FS sync and the active file concept. If JinjaWorkbench decouples these concerns (Explorer manages files; a separate RunContext module manages what gets executed), that is a better design. But this should emerge from building JinjaWorkbench, not be imposed on it.

**3. Is Pyodide always the right runtime?**
JinjaWorkbench might discover that Jinja2 in Pyodide is slower than a pure JavaScript Nunjucks implementation (which is semantically compatible). If performance is a problem for student feedback loops, the runtime abstraction matters. The Core should not assume Pyodide.

**4. Do the ZIP archive formats need to be compatible?**
If a student exports a JinjaWorkbench project and imports it into PixelWorkbench, what happens? Probably nothing useful. But if the `code/` folder convention is identical, a cross-workbench import would correctly populate the Explorer with the files, even if they can't run. This is a low-risk compatibility decision — but it should be confirmed, not assumed.

**5. What do students actually find confusing?**
This is the most important question and the only one that cannot be answered before shipping. Educational tool design is empirical. The Workbench Core should encode the patterns that students find intuitive — not the patterns that are architecturally elegant. The retrospective at Milestone 3 should include student feedback, not just developer observation.

---

## Summary

| Decision | Answer |
|---|---|
| Share anything immediately? | Only `console.js` |
| Copy or share the rest? | Copy — let it diverge |
| Separate repos? | Yes |
| When to extract Core? | After JinjaWorkbench v1 is in student use |
| What protects PixelWorkbench? | Tag v1.0.0, freeze main, separate repository |
| What generates the Core spec? | DIVERGENCE.md + M3 retrospective |
| Biggest risk? | Sharing `explorer.js` before run-context model is resolved |
| Biggest opportunity? | JinjaWorkbench forces the run-context problem to be solved cleanly |
