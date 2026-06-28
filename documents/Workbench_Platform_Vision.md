# Educational Workbench Platform Vision
**Status:** Architectural Vision — Living Document
**Scope:** PixelWorkbench, JinjaWorkbench, and all future domain workbenches
**Author:** Platform Architecture
**Date:** June 2026

---

## Preamble

This document defines the long-term architectural and product vision for the Educational Workbench Platform. It is not a feature specification. It is not a roadmap. It is a statement of principles — the kind of document that should be read before any new workbench is designed, before any new feature is added to an existing workbench, and before any shared infrastructure decision is made.

The central question this document answers is: **what makes something a Workbench, and what makes it educational?**

---

## Part I: The Educational Philosophy

### 1.1 The Problem This Platform Solves

Traditional educational coding environments ask students to write code and then check whether the code is correct. The feedback loop is evaluative: right or wrong, pass or fail.

This platform takes a different position. The goal is not correctness — it is **observation**. Students should write code and immediately see what it does. The feedback loop is perceptual: interesting or uninteresting, expected or surprising, beautiful or broken.

When the feedback is immediate and sensory, students stop asking "is this right?" and start asking "what happens if I change this?" That shift — from compliance to curiosity — is the educational outcome the platform is designed to produce.

### 1.2 The Core Principle: Zero Distance Between Code and Consequence

Every workbench should minimize the distance between writing code and observing its effect.

"Distance" here is not primarily about speed — although fast execution matters. It is about **cognitive distance**: the number of things a student must understand, configure, or remember before they can see their code do something.

In PixelWorkbench, the consequence is pixels. In JinjaWorkbench, it is a rendered page. In AudioWorkbench, it will be sound. The domains are different. The principle is the same: the student writes, the workbench shows.

This principle has design implications that reach into every part of the system:
- Projects must open ready to run, not requiring configuration
- The Run action must be a single gesture (one keyboard shortcut, one button)
- Errors must be visible immediately and explain what went wrong
- The preview must update visually, not just print a success message
- The workbench must never ask the student to do something before it will show them a result

### 1.3 Creativity Over Correctness

A debugger confirms that code is correct. A workbench reveals what code creates.

These are not the same thing, and conflating them produces the wrong tool. Workbenches are not testing frameworks. They have no test runner, no assertion library, no pass/fail indicator. They have a preview surface that shows students what their code made.

This means workbenches should be used for open-ended, generative, exploratory assignments — not for algorithm verification or unit-tested functions. The appropriate educational contexts are:
- Procedural generation and creative coding (PixelWorkbench)
- Template design and data-driven content (JinjaWorkbench)
- Sound synthesis and music programming (AudioWorkbench)
- Interactive page design (WebWorkbench)

In all of these, the "correct" answer is a matter of authorship, not computation. The student's goal is to make something, not to prove something.

### 1.4 The Workbench as a Domain-Specific IDE

Each workbench is a small, focused IDE centered on a specific computational domain.

"Focused" is load-bearing. A workbench should feel like it was purpose-built for its domain. A student using PixelWorkbench should feel like they are in a pixel art environment that also has a Python editor — not in a Python editor that can also display images. The domain is the foreground. The code is the means.

This has an important implication: the preview surface is not an output panel. It is the primary workspace. The editor is a tool for authoring the thing that appears there.

---

## Part II: The Shared Interaction Model

Every workbench, regardless of domain, shares a single interaction model. Students who have used any workbench should immediately understand how to use a new one.

### 2.1 The Universal Workflow

```
Write → Run → Observe → Modify → Repeat
```

This loop is the product. Everything else supports it.

- **Write:** Edit code in the Monaco editor. Navigate files in the Project Explorer. The editor is always visible.
- **Run:** One action. Ctrl+Enter, or a Run button. No configuration, no build step, no selection required.
- **Observe:** The preview surface updates. The console shows output and errors. Something changes visibly.
- **Modify:** The student changes something — a number, a color, a template variable — and runs again.
- **Repeat:** Each iteration is immediate. The cost of experimentation is near zero.

Nothing in a workbench should interrupt this loop. Modals that appear during a run, slow initialization screens, required project configuration before first use — all of these break the loop and must be eliminated or deferred.

### 2.2 The Three-Column Layout

All workbenches share a three-column layout:

```
┌────────────┬───────────────────┬────────────────────┐
│  Sidebar   │   Code Editor     │  Preview Surface   │
│            │                   │                    │
│  Project   │   Monaco          │  Domain-specific   │
│  Explorer  │                   │  output            │
│            │                   ├────────────────────┤
│  Domain    │                   │  Console           │
│  Tools     │                   │                    │
└────────────┴───────────────────┴────────────────────┘
```

- **Sidebar** (left): Project Explorer on top. Domain-specific tools or banks below.
- **Editor** (center): Monaco editor. Always the center column. Always the primary authoring surface.
- **Preview Surface** (right, top): Domain-specific. The thing the code makes.
- **Console** (right, bottom): Output, errors, system messages. Always present. Never the focus.

All three columns are resizable. The layout is persistent per workbench. Column proportions may differ between workbenches (AudioWorkbench may give more space to the waveform), but the three-column identity is constant.

This layout is not arbitrary. It encodes the product's philosophy: the code and its consequence are always simultaneously visible. The student never has to switch views to see what their code did. The result of running is never a separate screen or a separate tab — it is always in the right column, always adjacent to the code that produced it.

### 2.3 The Run Gesture

Ctrl+Enter (or Cmd+Enter on Mac) always runs. This shortcut is sacred and must never be reassigned.

The Run button in the header is the visual equivalent. Both are always available. Neither requires the editor to be focused (the shortcut is global).

The Run action:
1. Clears the console
2. Executes the current run context (see §4.3)
3. Updates the preview surface
4. Prints errors or output to the console

The run action must never navigate away from the workbench, open a new window, or require confirmation. It must always complete (either with a result or an error) and leave the workbench in a ready state.

### 2.4 Error Visibility

When code fails, the student must know:
1. That it failed (visually, immediately)
2. Where it failed (file, line number if possible)
3. What the error says (console, styled distinctly from normal output)

Error messages are printed to the console in a visually distinct style (`out-stderr`). The preview surface does not change on error — the last successful output remains visible. This is intentional: the student can see both their broken code and the last good result simultaneously.

Errors are never modal. Errors never block the editor. The student can immediately start editing to fix the problem.

---

## Part III: The Shared Project Model

### 3.1 Projects Are Folders of Files

A project is a named collection of files. Nothing more.

Projects contain text files. The structure of those files — their names, their organization into subfolders — is entirely the student's choice. The workbench does not impose a required file structure, a required entry point name, or a required directory layout.

This is a deliberate educational choice. Imposing structure teaches the structure, not the domain. Students should learn to make meaningful decisions about how to organize their own work.

The only soft convention is a default entry point suggested by the new-project template — a single starter file with a name appropriate to the domain (`main.py`, `template.html.j2`, `sketch.py`). This is a suggestion, not a requirement. Students can rename it, move it, or ignore it.

### 3.2 The Run Context

Every workbench has a concept of a "run context" — the thing that executes when the student clicks Run.

The run context is not necessarily the active file. It is the unit of execution appropriate to the domain.

| Workbench | Run context |
|---|---|
| PixelWorkbench | The active Python file |
| JinjaWorkbench | A (template, data) pair — two files together |
| AudioWorkbench | A Python script that produces audio |
| WebWorkbench | A folder containing HTML + CSS + JS |

Each workbench defines and manages its own run context. The concept is shared; the implementation is domain-specific. The Core does not attempt to abstract over run contexts.

What is shared is the guarantee: the Run gesture always executes the run context, whatever that means in this domain.

### 3.3 Project Identity and Persistence

Each workbench stores its own projects independently. Projects are not cross-workbench portable at the execution level (a PixelWorkbench project is not meaningful to JinjaWorkbench's runtime). They may be portable at the file level (ZIP export/import uses a simple folder structure that any workbench can read), but the workbench is not responsible for making foreign projects execute.

Project identity consists of:
- A name (student-assigned)
- A collection of files with paths and content
- A record of the last active file or run context (restored on next open)

Projects do not have versions, branches, or history. They are live, editable, single-state documents. Version control is outside the scope of the platform.

---

## Part IV: The Shared Runtime Model

### 4.1 Python as the Universal Language

All workbenches use Python as the primary programming language, executed by Pyodide in the browser.

This is a product decision, not a technical one. Python is:
- The dominant language in secondary and post-secondary CS education
- Readable enough for beginners, expressive enough for advanced students
- Supported by Pyodide with access to the scientific Python ecosystem (NumPy, Pillow, etc.)
- Domain-appropriate for every planned workbench

The consequence of this decision is that every workbench inherits Pyodide's initialization cost, Pyodide's package model, and Pyodide's browser constraints. These are known and acceptable tradeoffs.

**The one exception:** if a future workbench domain is more naturally served by a JavaScript-native runtime (e.g., a pure HTML/CSS/JS workbench), Python is not required. The platform does not mandate Python — it mandates a runtime that supports the workflow. Python via Pyodide is the default.

### 4.2 The Bridge Contract

The bridge is the seam between the Python world and the workbench's domain. It is the most important per-domain design decision.

Every workbench defines a small set of Python functions that students can call to interact with the preview surface. These functions:
- Have simple, memorable names (`set_image`, `render`, `play`, `show`)
- Accept and return Python-native types (PIL Images, strings, dicts, NumPy arrays)
- Never require the student to understand JavaScript, base64, or browser APIs
- Are documented as the workbench's primary API

The bridge is domain-specific. The transport mechanism (base64, JSON strings, binary buffers) is an implementation detail invisible to the student. The contract — "call this Python function, see the result in the preview" — is universal.

**Bridge design principles:**
- The fewest possible functions. Students should be able to hold the entire bridge API in working memory.
- No required boilerplate. A one-line Python program should be runnable and produce visible output.
- Errors in bridge calls must produce readable Python exceptions, not JavaScript errors.
- The bridge should feel like a domain library (`from pixel import set_image`), not like an API.

### 4.3 Package Loading

Each workbench loads only the Python packages it needs. There is no universal package set.

| Workbench | Packages |
|---|---|
| PixelWorkbench | Pillow |
| JinjaWorkbench | Jinja2 (included in Pyodide stdlib) |
| AudioWorkbench | NumPy, SciPy (or similar DSP library) |
| WebWorkbench | None (Python is optional in this domain) |

Package loading happens at workbench initialization, before the student's first run. The student sees a loading indicator but does not manage packages. There is no `pip install` in the workbench — the workbench is pre-configured for its domain.

---

## Part V: The Shared Persistence Model

### 5.1 Everything Lives in the Browser

All persistence is local to the browser. There is no server, no cloud storage, no account system, no sync.

This is a design constraint and a feature. It means:
- The workbench works offline and on any device with a modern browser
- There is no login, no account creation, no data leaving the student's machine
- There is no dependency on any backend service
- Student work is private by default

The tradeoff is that work can be lost if the browser's IndexedDB is cleared, and work cannot be shared between devices without ZIP export. These limitations are acceptable for the educational use case and should be disclosed clearly to students.

### 5.2 The Three Layers of Persistence

Each workbench uses three persistence mechanisms, each appropriate for a different kind of state:

**Layer 1 — IndexedDB (project store):** Durable, structured storage for project files. Everything in the Project Explorer is here. This is the canonical state of student work. It survives page refresh, browser restart, and OS restart.

**Layer 2 — localStorage (UI state):** Lightweight key-value storage for UI preferences and session context. Active file, zoom level, sidebar width, theme, font size. This data is cheap to lose (it can be reconstructed from user action) but worth preserving across sessions. It never stores file content.

**Layer 3 — Session memory:** Runtime state that exists only while the page is open. Pyodide's in-memory filesystem, undo/redo history, the current console output, unsaved edits. This state does not survive a page refresh, and that is expected.

### 5.3 Autosave Philosophy

The workbench autosaves continuously. Students should never lose work because they forgot to save.

Autosave operates at Layer 1 (IndexedDB) via a debounced keystroke listener. Every change to a file's content is flushed to IndexedDB within a short window. There is no "dirty state" warning on page close.

Explicit save (Ctrl+S) is still supported and should be encouraged — it is the conceptual separator between "drafting" and "a version I want to keep." But it is a courtesy, not a requirement.

**Domain-specific assets** (images in PixelWorkbench's Image Bank, audio clips in AudioWorkbench's Sample Bank) follow the same philosophy: persisted to IndexedDB immediately, available on next session.

### 5.4 ZIP Export as the Portability Primitive

ZIP export is the platform's answer to sharing, backup, and submission.

A student who wants to:
- Back up their work → ZIP export
- Submit an assignment → ZIP export
- Share work with a classmate → ZIP export
- Move work to another device → ZIP export

The ZIP archive is the workbench's external format. It is a plain folder structure with all project files at their relative paths. Any workbench can import a ZIP. The files will appear in the Project Explorer. Whether they execute correctly depends on the domain.

ZIP import is also used by instructors to distribute starter projects. An instructor creates a ZIP, uploads it to a course site, students download and import it. This is the distribution model — no server required.

---

## Part VI: The Shared UI Philosophy

### 6.1 The Visual Language

All workbenches share a single visual design language.

The design language is a dark-mode IDE aesthetic, inspired by VS Code but simplified. It uses a consistent set of CSS custom properties (design tokens) for color, typography, and spacing. These tokens do not change between workbenches. A student who has used PixelWorkbench and opens JinjaWorkbench should immediately recognize it as the same family.

The visual language communicates:
- **Seriousness:** this is a real tool, not a toy. Students are doing real programming.
- **Focus:** dark backgrounds reduce visual noise, helping students focus on code and preview simultaneously.
- **Consistency:** the same colors mean the same things. Error messages are always red. System messages are always distinguished from program output.

### 6.2 Domain Identity Within the Shared Language

Each workbench has a distinct domain identity within the shared language. The identity is expressed through:
- The preview surface (the largest visual element in the workbench)
- The sidebar tools and banks (domain-specific panels below the Explorer)
- The workbench name and any domain-specific iconography in the header

The identity is not expressed through different color schemes, different typography, or different layout. Those remain constant. The domain distinguishes itself through what it does, not through how it looks.

### 6.3 The Sidebar Architecture

The sidebar has two zones:

**Zone 1 — Project Explorer (always present, always at top):** The same across all workbenches. Files, folders, drag and drop, create, rename, delete. This is the universal zone.

**Zone 2 — Domain Tools (always present, contents are domain-specific):** PixelWorkbench puts the Image Bank here. JinjaWorkbench might put a Data Browser here (showing the parsed JSON of the current data file). AudioWorkbench puts a Sample Bank here. WebWorkbench might put an Asset Manager here.

The activity bar (the narrow icon strip on the far left) controls which sidebar panel is visible. The icons are domain-specific. The mechanism is shared.

### 6.4 The Console Is Always a Second-Class Citizen

The console shows output. It is not the primary feedback surface. It is never the largest element on screen. It is always below the preview surface, always smaller.

This is a deliberate inversion of the typical educational coding environment, where the console *is* the output. In a workbench, printing to the console is a debugging tool, not the goal. Students are not printing strings; they are creating things. The thing they created is in the preview. The console confirms the process.

This means:
- `print()` works and is useful
- But a workbench that only uses `print()` is not using the workbench well
- Assignments should be designed around the preview surface, not the console

### 6.5 Modals Are Temporary, Non-Blocking

Modals appear for one reason: to collect a short piece of information that cannot be inferred (a filename, a project name, a canvas size). They are immediately dismissed after confirmation. They do not stack. They do not block navigation or editing.

Modals are not used for:
- Confirmations of destructive actions (delete is immediate with undo possible via `Ctrl+Z` or by navigating away)
- Settings panels (settings are inline, in the header or sidebar)
- Error displays (errors go to the console)

---

## Part VII: Domain-Specific Ownership

Each workbench owns its domain completely. The following is a declaration of domain scope — what each workbench is responsible for and what belongs exclusively to it.

### 7.1 PixelWorkbench — The Pixel Domain

PixelWorkbench owns everything related to pixel manipulation and raster graphics.

**Owned exclusively:**
- The canvas element and its rendering context
- Paint tools (pencil, eraser, flood fill, replace color, eyedropper)
- Selection system (rectangular selection, marching ants, resize handles, clipboard operations)
- Zoom system (CSS-based, non-destructive)
- Image Bank (named raster images, persistent, accessible from Python)
- Canvas Attributes (dimensions, background, transparency)
- Undo/redo via `ImageData` snapshots
- The Python bridge: `get_image()`, `set_image()`, `get_selection()`, `save_image()`

**Educational focus:** Students learn procedural generation, algorithmic art, pixel manipulation, and image processing. The bridge connects Python's image semantics to a live canvas.

### 7.2 JinjaWorkbench — The Template Domain

JinjaWorkbench owns everything related to template rendering and data-driven HTML generation.

**Owned exclusively:**
- The HTML preview panel (sandboxed iframe)
- Template file type support and syntax (`.jinja`, `.j2`, `.html.j2`)
- The run context model (template + data pair)
- The Data Browser sidebar panel (parsed view of the active JSON data file)
- Error display for template syntax errors (distinct from Python runtime errors)
- The Python bridge: `render(template_name, data)`, `set_output(html_string)`, `get_template(name)`, `get_data(name)`

**Educational focus:** Students learn templating, data-driven design, separation of content and presentation, and iterative document design. The bridge connects Python's string and dict semantics to a live HTML preview.

### 7.3 AudioWorkbench — The Sound Domain (Planned)

AudioWorkbench owns everything related to audio synthesis, processing, and playback.

**Owned exclusively:**
- The waveform display (Canvas or SVG, time-domain visualization)
- Playback controls (play, stop, loop, scrub)
- Sample Bank (named audio clips, accessible from Python as NumPy arrays or similar)
- Spectrogram display (frequency-domain visualization, optional)
- Time-range selection (the audio analog of pixel selection)
- The Python bridge: `get_audio(name)`, `set_audio(array, sample_rate)`, `play(array)`, `save_audio(array, name)`

**Educational focus:** Students learn digital signal processing, sound synthesis, music programming, and audio transformation. The bridge connects Python's array semantics to a live audio engine.

### 7.4 WebWorkbench — The Web Domain (Possible)

WebWorkbench owns everything related to live HTML/CSS/JS authoring.

**Owned exclusively:**
- The sandboxed iframe preview (full-featured, with scripts enabled within sandbox)
- Hot-reload on file save (optionally without clicking Run)
- Asset Manager (images, fonts, files accessible from the preview iframe)
- Multi-file execution context (the folder, not a single file, is the run unit)
- Error display for HTML parse errors, CSS errors, and JS runtime errors
- The Python bridge: optional (Python could generate HTML strings that are injected into the preview)

**Educational focus:** Students learn front-end web development, HTML structure, CSS layout and styling, and the relationship between files in a web project. Python's role is optional — the workbench may be the first in the family where Python is not the primary language.

### 7.5 Future Domain Workbenches

Additional workbenches can be defined by following the same ownership pattern. A new workbench must declare:

1. **The preview surface:** what does the student see after clicking Run?
2. **The run context:** what is the unit of execution?
3. **The domain tools:** what goes in the sidebar below the Explorer?
4. **The domain bank:** what named assets can students save and reuse?
5. **The Python bridge API:** what functions does the student call from Python to interact with the preview?
6. **The educational focus:** what computational concept is this workbench teaching through making?

If a proposed workbench cannot clearly answer all six, it is not yet ready to be designed.

---

## Part VIII: What the Platform Does Not Do

Defining what the platform is requires defining what it is not. These are explicit non-goals.

**The platform is not a learning management system.** It has no concept of assignments, submissions, grading, or progress tracking. Those are the instructor's responsibility, handled by external tools. ZIP export is the bridge to those systems.

**The platform is not a collaborative tool.** There is no real-time multiplayer editing, no comments, no sharing links, no version history. Students work alone on their own machines.

**The platform is not a debugging environment.** There are no breakpoints, no watch variables, no step-through execution. The feedback model is run-and-observe, not step-and-inspect. Students who need a debugger are using the wrong tool.

**The platform is not a production deployment environment.** Student work runs only in the browser, for the student. There is no publish, no hosting, no deployment pipeline.

**The platform is not language-agnostic.** Python is the default and primary language. Workbenches that use other languages (WebWorkbench using JavaScript) are exceptions that must be justified by the domain, not by a desire to support multiple languages.

**The platform does not enforce correctness.** There are no tests, no assertions, no expected outputs. The student is the judge of whether the result is what they wanted.

---

## Part IX: Principles for Platform Evolution

These are the principles that should guide every future decision about the platform — adding a workbench, modifying the Core, changing the persistence model, or redesigning the UI.

**1. The loop first.** Every feature request should be evaluated by asking: does this improve the Write → Run → Observe → Modify loop? If it does not, it should be deferred or rejected.

**2. The preview surface is the product.** Features that make the preview more expressive, more responsive, or more informative are the highest priority. Features that improve the editor, the sidebar, or the console are secondary.

**3. New workbenches are discovered, not designed.** A workbench earns its place by demonstrating a clear, distinct educational focus with a sensory, immediate feedback surface. Workbenches should not be added because the technology is available, but because a domain of computation is taught better through making than through testing.

**4. The Core grows from evidence.** Shared infrastructure is extracted from two successful workbenches, not designed in advance. The risk of premature abstraction is higher than the cost of some duplication.

**5. Simplicity is a product feature.** Students are the users. Every new feature adds cognitive load. The workbench that teaches by existing is better than the workbench that teaches by explaining itself.

**6. Browser-only is non-negotiable.** The zero-infrastructure constraint is not a technical limitation to be worked around — it is a feature. It means the workbench can be used in any classroom, on any school device, with no setup and no IT involvement. Any feature that requires a server, a build step, or an account is contrary to the platform's core value.

---

## Summary: The Workbench Contract

A workbench is an educational application that fulfills the following contract:

| Guarantee | Means |
|---|---|
| Immediate feedback | Code runs and produces visible output in under 3 seconds |
| Zero configuration | A new project is ready to run without any setup |
| Domain identity | The preview surface defines the domain; the tool feels purpose-built |
| Persistent work | Students never lose work due to forgetting to save |
| Portable projects | ZIP export/import is always available |
| Shared vocabulary | Students who know one workbench can orient in any other |
| No infrastructure | Everything runs in the browser; nothing requires a server |
| Python first | All workbenches speak Python unless the domain requires otherwise |

These are not aspirational goals. They are pass/fail criteria. A workbench that does not meet all of them is not a Workbench — it is a prototype.
