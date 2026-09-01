# P&ID Auditor

A browser-based engineering tool for auditing **Piping & Instrumentation Diagrams (P&IDs)** directly from PDF files.

Originally developed for the **Sakarya Gas Field** project, the application has been designed as a **project-agnostic auditing framework** that can be adapted to other engineering projects with different drawing standards, naming conventions, tag formats, and validation requirements.

The tool combines **text-based tag detection**, **line list comparison**, **local line tracing**, and an **interactive review workflow** into a single application. Everything runs locally in the browser—no installation or backend server is required.

---

# Features

## 🗂️ Local Projects and Files

Projects can be created and kept locally in the browser. Each project can contain multiple P&ID PDFs, which remain available after a page refresh.

For users who want normal file-folder control, a project can also be connected to a folder on the computer. The application creates this structure automatically:

```
Project name/
├── 01_P&ID        # Source PDF drawings
├── 02_Line Lists  # CSV line lists
├── 03_Reports     # Audit and table reports
└── 04_Exports     # Annotated PDFs and other exports
```

The folder connection uses the browser's local file access and does not upload files to a server. Browser support for the File System Access API is required for writing directly to the selected folder; the browser library remains available as a fallback.

---

## 📄 PDF Viewer

View and inspect multi-page P&ID drawings directly in the browser using **PDF.js**.

Features include:

- Multi-page PDF rendering
- Smooth zooming
  - Zoom slider
  - Ctrl + Mouse Wheel
  - Ctrl + `+` / Ctrl + `-`
- Pan by click-and-drag
- Fast page navigation
- Collapsible sidebar for larger drawing workspace
- Responsive interface for reviewing large drawings

---

## 🔍 Intelligent Tag Detection

The application scans the **embedded text layer** of the PDF using configurable Regular Expressions (Regex).

Unlike OCR-based software, this provides very accurate detection for PDFs exported directly from CAD or engineering applications.

Multiple search modes can be enabled depending on project requirements.

### Line Tags

Detects process line identifiers.

Example:

```
10-2"-HC-1234-01-A
```

---

### Valve Tags

Detects manual valve identifiers.

Example:

```
10-HV-1234
```

---

### Actuated Valve Tags

Detects actuated valve identifiers.

Examples:

```
35PCV9061
35PSV9627A
35TV9069
```

---

Each detected tag becomes:

- A highlighted object on the drawing
- An entry in the review sidebar
- Clickable for instant navigation

---

## Local Line Tracing and Valve Register

After the normal text audit, Pipe Tracing can build a page-local topology from the stroked vector geometry already present in the PDF. No drawing data is sent to an external service.

The tracing policy is deliberately auditable:

- Start from nearby pipe geometry that is aligned with the selected line tag, rather than blindly choosing the closest stroke
- Continue through connected straight and curved pipe segments
- Reject reverse turns that would enter and double back through symbol outlines
- Bridge only short, collinear CAD gaps whose ends face each other
- Pass a tee only when there is one clearly aligned main continuation
- Probe clear side/main runs for another line tag so a tee can be classified as a line boundary
- Pass compact inline geometry only when closed/curved symbol evidence supports it
- Pass a clear aligned crossing, but mark competing, unresolved branch, same-line branch, complex-junction, and route-overlap cases as `REVIEW`
- Keep filtered geometry, candidate edges, node decisions, stop reasons, and valve candidates available in the debug inspector

Every detected manual or actuated valve tag is kept in the valve register, including valves that cannot be linked. A valve is marked `LINKED` only after every detected line occurrence on that page has a completed route and one distinct traced line is supported by proximity, tag direction, and matching nominal size. Incomplete page coverage, close competing lines, low-confidence proximity, or a reviewed line route are marked `REVIEW`; valves without a nearby compatible route remain `UNLINKED`. Provisional untagged side branches can suggest a candidate but cannot silently create an automatic link. When all repeated occurrences have been checked, duplicate routes with the same normalized line number do not create a false valve ambiguity.

The copied line/valve report and audit CSV include trace status, linked line, confidence, association method, candidate lines, linked valves, and reviewer comments.

---

## 🔄 Duplicate Handling

Repeated tags can be processed in two different ways.

### Count All

Every occurrence is reviewed individually.

Useful when each appearance must be verified.

### Combine

Groups repeated tags into a single review item while preserving occurrence information.

---

## 📑 Automatic Drawing Number Extraction

For every page, the application attempts to determine the drawing number automatically.

Primary search:

```
TP-OTC DRAWING NUMBER
```

Fallback searches can identify project-specific numbering schemes such as:

```
SC26-3-NOV...
```

The extraction logic can easily be modified for other projects.

---

# Review Workflow

Detected tags are presented in an interactive review panel.

Features include:

- Click a tag to jump directly to its location
- Automatic page navigation
- Current-page tag footer
- Search and review status
- Live statistics

Every detected tag can be marked as:

🟢 Correct

🔴 Incorrect

🟡 Unreviewed

Review status updates instantly throughout the application.

---

# Line List Comparison

The application can compare detected P&ID tags against external engineering Line Lists.

Supported format:

- CSV

Comparison capabilities include:

- Missing from P&ID
- Missing from Line List
- Matching tags
- Attribute comparison
- Side-by-side inspection
- Interactive comparison drawer
- Direct navigation from comparison results to drawing locations
- CSV report export

This enables rapid validation between engineering databases and P&ID documentation.

---

# Export Options

## CSV Export

Export detected tags including:

- Tag
- Drawing Number
- Page Number
- Review Status

---

## Line List Comparison CSV Export

Export Line List comparison results into a CSV file.

---

## Annotated PDF

Generate an audited PDF containing embedded review highlights.

The application uses **pdf-lib** to write colored rectangles directly into the PDF.

Highlight colors:

- 🟡 Yellow — Unreviewed
- 🟢 Green — Correct
- 🔴 Red — Incorrect

The resulting PDF can be shared independently of the application.

---

# Project Adaptability

Although initially developed for the **Sakarya Gas Field** project, the application has been intentionally designed to be **adaptable to virtually any P&ID project**.

The core auditing engine is independent of project-specific rules.

Customization typically involves updating configuration values rather than changing application logic.

The following can be customized:

- Regular expressions for line tags
- Valve tag formats
- Equipment tag formats
- Drawing number extraction logic
- Project naming conventions
- Line List column mappings
- Validation rules
- Export formats
- Engineering workflows

This makes the tool suitable for:

- EPC contractors
- Engineering consultants
- Owner/operators
- Brownfield projects
- Greenfield projects
- Oil & Gas
- Chemical
- Petrochemical
- Energy
- Water treatment
- Industrial facilities

Supporting a new project generally requires updating only the project-specific patterns and configuration while leaving the core application unchanged.

---

# How It Works

The application analyzes the **embedded text layer** inside the PDF.

This means:

✅ Best results are obtained using PDFs exported directly from CAD or engineering software.

⚠️ Scanned PDFs without searchable text require OCR before tag detection can be performed.

---

# Running Locally

This project is completely static and requires no build process.

## Option 1 — Open Directly

Open

```
index.html
```

in any modern browser.

Some browsers restrict local file access.

If PDF loading fails, use Option 2.

---

## Option 2 — Local Web Server (Recommended)

If Python is installed:

```bash
python -m http.server 8000
```

Then open:

```
http://localhost:8000
```

---

# Usage

1. Open the application.
2. Load a PDF drawing.
3. Select one or more search modes:
   - Line Tags
   - Valve Tags
   - Actuated Valve Tags
4. Choose duplicate handling:
   - Count All
   - Combine
5. Run the scan.
6. Review detected tags.
7. Mark each tag as Correct or Incorrect.
8. (Optional) Enable Pipe Tracing, check one line or all lines, and review line/valve results.
9. (Optional) Load a CSV Line List for comparison.
10. Export:
    - CSV
    - Line List Comparison CSV
    - Annotated PDF

---

# Project Structure

```
.
├── index.html
├── css
│   ├── styles.css
│   └── loading.css
│
├── js
│   ├── script.js
│   ├── print-service.js
│   ├── pdf.min.js
│   ├── pdf.worker.min.js
│   └── pdf-lib.min.js
│
└── loading
    └── Loading screen assets
```

---

# Technologies

- HTML5
- CSS3
- Vanilla JavaScript
- PDF.js
- pdf-lib

---

# Limitations

- Tag detection depends on searchable PDF text.
- Scanned drawings require OCR before processing.
- Highlight positioning may vary slightly depending on PDF fonts, transformations, and text metrics.
- Line tracing requires stroked vector geometry and is page-local; raster/scanned pipework cannot be traced without a separate image/OCR workflow.
- Valve-to-line association starts from detected valve tag text; untagged or ambiguous valves require manual review.
- Ambiguous topology is intentionally reported for review instead of being assigned silently.

---

# Future Enhancements

Potential future improvements include:

- User-defined Regex patterns
- Project configuration profiles
- Batch processing of multiple PDFs
- OCR integration
- Advanced reporting and dashboards
- Custom engineering validation rules
- Equipment and instrument tag validation
- Plugin architecture for project-specific modules

---

# Technologies Behind the Tool

The application combines multiple open-source libraries:

- **PDF.js** for PDF rendering and text extraction
- **pdf-lib** for annotated PDF generation
- **Vanilla JavaScript** for a lightweight, dependency-free frontend

---

# About

P&ID Auditor is a lightweight engineering review tool developed to simplify the auditing and validation of Piping & Instrumentation Diagrams.

While originally created for the Sakarya Gas Field project, the application has evolved into a reusable framework that can be adapted to different engineering projects with minimal effort by configuring project-specific tag formats, drawing extraction rules, and validation workflows.

Its modular architecture makes it suitable as a foundation for future P&ID auditing and engineering quality assurance tools across a wide range of industries.
