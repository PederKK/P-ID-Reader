# P&ID Auditor

A small, browser-based helper for auditing Piping & Instrumentation Diagrams (P&IDs) in PDF form.

You load a PDF, the app scans the PDF text layer for tags using regex patterns, highlights matches on the drawing, and lets you mark each match as **Correct** or **Incorrect**. You can then export results to CSV and/or save an **annotated PDF**.

## What it does

### PDF viewing

- Renders PDF pages in the browser using **PDF.js**.
- Zoom via slider, Ctrl + mouse wheel, or Ctrl + \+ / Ctrl + \-.
- Pan by click-dragging the canvas area.

### Tag detection (regex)

The app scans the PDF **text layer** (not pixels/OCR). That means results depend on how the PDF was generated.

Search modes (choose in the sidebar):

- **Line Tags** (default)
  - Pattern (current): `\d+-\d+"-[A-Z]+-[A-Z0-9]+-\d+-[A-Z]+`
  - Example: `10-2"-HC-1234-01-A`
- **Valve Tags**
  - Pattern (current): `\d+(?:-\d+")?-[A-Z0-9]+-\d+`
  - Example: `10-HV-1234`
- **Both**
  - Combines the above patterns.

Each match becomes a clickable highlight on the page and an entry in the sidebar.

### Drawing number / title extraction

For each page, the app attempts to extract a sheet title by searching the text layer for the label:

- `TP-OTC DRAWING NUMBER`

It then looks ahead in nearby text items for the likely drawing number/title. If that fails, it falls back to looking for strings beginning with `SC26-3-NOV`.

### Review workflow

- Sidebar lists all detected tags.
- Clicking a tag scrolls the viewer to its location.
- You can mark each tag as:
  - **Correct** (green)
  - **Incorrect** (red)
  - Unmarked/default (yellow)
- A sticky footer shows tags for the currently visible page.

### Export

- **Export CSV**: outputs Tag, sheet title, page number, and review status.
- **Print / Save PDF**:
  - Uses **pdf-lib** to write translucent colored rectangles (yellow/green/red) into the PDF.
  - Downloads an annotated file named `audited_pid.pdf`.

## How to run locally

This is a static web app (no build step).

### Option A: Open the file directly

Open `index.html` in a modern browser.

> Note: Some browsers restrict local file access in ways that can impact PDF loading. If you run into that, use Option B.

### Option B: Use a simple local web server (recommended)

If you have Python installed:

```powershell
python -m http.server 8000
```

Then open:

- http://localhost:8000/

## How to use

1. Choose **Search Mode** (Line / Valve / Both).
2. Choose **Duplicates**:
  - **Count all**: every match is listed/counts separately (useful when you want to review every occurrence)
  - **Combine**: repeated tags across pages are grouped into one row in the sidebar and CSV
2. Upload a PDF using the file picker.
3. Wait for scanning to finish (status line shows pages scanned and total tags found).
4. Click tags in the sidebar to jump to the highlight.
5. Mark tags correct/incorrect as you review.
6. Export results:
   - **Export CSV** for a spreadsheet-friendly list
   - **Print / Save PDF** for an annotated PDF

## Troubleshooting

### “Found 0 tags” but I can see tags on the drawing

This app searches the **PDF text layer**. If the PDF is scanned imagery or the text isn’t embedded, PDF.js won’t extract the tag strings.

Options:

- Try a source PDF exported from CAD (not a scanned print).
- Add an OCR step upstream and regenerate the PDF with searchable text.

### Highlight boxes seem slightly offset

Tag rectangles are derived from PDF text item transforms and approximated dimensions. Rotation and font metrics can vary between PDFs.

### “Print / Save PDF” doesn’t include highlights

The annotated PDF is created from the extracted match coordinates. If extraction fails (no tags), nothing can be drawn.

## Project layout

- `index.html` – UI layout and library includes (PDF.js + pdf-lib)
- `css/styles.css` – styling, layout, and print rules
- `js/script.js` – main app logic (PDF rendering, scanning, UI, CSV export)
- `js/print-service.js` – annotated PDF creation via pdf-lib
