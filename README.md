# P&ID Auditor

A browser-based engineering tool for auditing **Piping & Instrumentation Diagrams (P&IDs)** directly from PDF files.

Originally developed for the **Sakarya Gas Field** project, the application has been designed as a **project-agnostic auditing framework** that can be adapted to other engineering projects with different drawing standards, naming conventions, tag formats, and validation requirements.

The tool combines **text-based tag detection**, **line list comparison**, **symbol detection**, and an **interactive review workflow** into a single application. Everything runs locally in the browser—no installation, backend server, or database is required.

---

# Features

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

Supported formats:

- Excel (.xlsx)
- CSV

Comparison capabilities include:

- Missing from P&ID
- Missing from Line List
- Matching tags
- Attribute comparison
- Side-by-side inspection
- Interactive comparison drawer
- Direct navigation from comparison results to drawing locations
- Excel report export

This enables rapid validation between engineering databases and P&ID documentation.

---

# Symbol Detection (Experimental)

In addition to text recognition, the application supports template-based symbol detection.

Using **OpenCV.js**, symbols can be detected directly from drawing graphics.

Features include:

- Template matching
- Capture new symbol templates from drawings
- Detection progress indicator
- Symbol detection report
- Symbol location navigation
- Support for predefined symbol libraries

Current library includes multiple valve types, including:

- Ball Valve
- Butterfly Valve
- Gate Valve
- Globe Valve
- Knife Gate Valve
- Plug Valve
- Needle Valve
- Diaphragm Valve
- Shut-off Valve

Both open and closed variants are supported where available.

Additional symbol templates can easily be added.

---

# Export Options

## CSV Export

Export detected tags including:

- Tag
- Drawing Number
- Page Number
- Review Status

---

## Excel Export

Export Line List comparison results into an Excel workbook.

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
- Symbol libraries
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
8. (Optional) Load an Excel or CSV Line List for comparison.
9. (Optional) Run Symbol Detection.
10. Export:
    - CSV
    - Excel Comparison Report
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
│   ├── symbol-detector.js
│   ├── symbol-library.js
│   ├── predefined-symbols.js
│   ├── pdf.min.js
│   ├── pdf.worker.min.js
│   └── pdf-lib.min.js
│
├── symbols
│   └── Template symbol library
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
- OpenCV.js
- SheetJS (XLSX)

---

# Limitations

- Tag detection depends on searchable PDF text.
- Scanned drawings require OCR before processing.
- Symbol detection is template-based and performs best with consistent symbol scale and drawing quality.
- Highlight positioning may vary slightly depending on PDF fonts, transformations, and text metrics.

---

# Future Enhancements

Potential future improvements include:

- User-defined Regex patterns
- Project configuration profiles
- Batch processing of multiple PDFs
- OCR integration
- Additional symbol libraries
- AI-assisted symbol recognition
- Advanced reporting and dashboards
- Custom engineering validation rules
- Equipment and instrument tag validation
- Plugin architecture for project-specific modules

---

# Technologies Behind the Tool

The application combines multiple open-source libraries:

- **PDF.js** for PDF rendering and text extraction
- **pdf-lib** for annotated PDF generation
- **OpenCV.js** for image-based symbol detection
- **SheetJS** for Excel import/export
- **Vanilla JavaScript** for a lightweight, dependency-free frontend

---

# About

P&ID Auditor is a lightweight engineering review tool developed to simplify the auditing and validation of Piping & Instrumentation Diagrams.

While originally created for the Sakarya Gas Field project, the application has evolved into a reusable framework that can be adapted to different engineering projects with minimal effort by configuring project-specific tag formats, drawing extraction rules, symbol libraries, and validation workflows.

Its modular architecture makes it suitable as a foundation for future P&ID auditing and engineering quality assurance tools across a wide range of industries.
