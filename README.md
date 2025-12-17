# P&ID Auditor Project

## Overview
This project is a web-based tool designed to assist in the auditing and review of Piping and Instrumentation Diagrams (P&IDs) in PDF format. It automates the detection of specific equipment or line tags and provides an interface for human verification.

## Current Features

### 1. PDF Processing
- **Library:** Uses `pdf.js` to render PDF documents directly in the browser.
- **Rendering:** Renders pages to HTML5 Canvas elements.
- **Zoom:** Includes a custom zoom toolbar to scale the document view.

### 2. Automated Tag Detection
- **Mechanism:** Scans the text layer of the PDF using Regular Expressions.
- **Current Pattern:** Detects tags matching the format: `Digits - Digits" - Letters - Alphanum - Digits - Letters` (e.g., `10-2"-HC-1234-01-A`).
- **Visualization:** Overlays interactive highlight boxes on the PDF where tags are found.

### 3. Drawing Title Extraction
- **Mechanism:** Attempts to automatically identify the drawing number/title for each sheet.
- **Logic:** Looks for the label "TP-OTC DRAWING NUMBER" or specific project codes (e.g., "SC26-3-NOV") to locate the title text.

### 4. Review Interface
- **Sidebar:** Displays a list of all detected tags grouped by occurrence.
- **Interaction:** Clicking a tag in the list scrolls the PDF to the specific location and highlights it.
- **Validation:** Users can mark tags as "Correct" (Green) or "Incorrect" (Red).

### 5. Export & Print
- **CSV Export:** Generates a CSV file containing Tag Number, Sheet Title, Page Number, and Review Status.
- **Print:** Optimized CSS for printing the marked-up document.

## Project Structure
The project is organized to separate concerns for easier maintenance and expansion:

- **`index.html`**: The main entry point. Contains the HTML skeleton and loads external resources.
- **`css/styles.css`**: Contains all visual styling, including layout, sidebar design, and print overrides.
- **`js/script.js`**: Contains the application logic:
  - PDF loading and rendering.
  - Text extraction and Regex matching.
  - UI interaction (zoom, scroll, review buttons).
  - Export functionality.

## Goals for Future Iterations
- **Expandability:** The code is modularized to allow easy addition of new Regex patterns or extraction logic.
- **Navigation:** The split structure makes it easier for developers to locate specific logic (e.g., changing the tag pattern in `script.js` or the color scheme in `styles.css`).
