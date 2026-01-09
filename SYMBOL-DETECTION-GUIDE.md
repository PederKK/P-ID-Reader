# Symbol Detection Quick Guide

## What I Fixed

### Issue
- The capture overlay was looking for `.page-container` elements but your PDF renders as `.pdf-page` elements
- No visual feedback when capture succeeded/failed
- Coordinate conversion needed to account for zoom levels

### Solution
✅ Fixed canvas selector to use `.pdf-page > canvas`
✅ Added debug logging to console (press F12 to see)
✅ Improved visual feedback with toast notifications
✅ Better instruction overlay with gradient styling
✅ Glowing green selection box

---

## How to Use Symbol Detection

### Step 1: Load Your PDF
- Click the file selector and load your P&ID document

### Step 2: Capture a Template

1. In the sidebar, find **"Symbol Detection"** section
2. From the dropdown, select a symbol type (e.g., "Pump")
3. Click **"⬚ Draw on PDF"**
4. You'll see:
   - Dark semi-transparent overlay covering the screen
   - Purple instruction box at the top
   - Crosshair cursor

5. **Click and drag** a rectangle around a pump symbol in your PDF
   - Make sure you're drawing over the actual PDF page
   - The selection box will glow bright green
   - Try to capture just the symbol, not surrounding text

6. **Release the mouse** - you should see:
   - **"✓ Template Captured!"** green message
   - A blue chip appears showing "Pump (1)" 
   - The overlay disappears

### Step 3: Run Detection

1. Click **"🔍 Detect Symbols"**
2. The system scans all PDF pages for similar symbols
3. Results appear below with counts per symbol type
4. Colored boxes appear on the PDF highlighting found symbols

---

## Troubleshooting

### "Draw over the PDF page" warning
- Make sure you're drawing directly over the PDF canvas
- Try zooming out a bit (Ctrl + Mouse wheel)
- Draw from the center of the page, not the edges

### No template chip appears
- Open browser console (F12)
- Try capturing again and look for:
  - `Capture rect:` - your mouse coordinates
  - `Checking canvas:` - found canvases
  - `Found matching canvas!` - success
  - `Canvas coords:` - template extracted

### Detection finds nothing
- Try capturing a larger/clearer symbol
- Capture multiple variations of the same symbol type
- Check that the symbol in the diagram looks similar to your template

---

## Tips for Best Results

✅ **DO:**
- Capture symbols from the legend (cleanest examples)
- Draw tightly around the symbol
- Capture at normal zoom (100%)
- Capture 2-3 variations if symbols vary in size

❌ **DON'T:**
- Include text labels in the capture
- Capture rotated/distorted symbols
- Make the box too small (< 20x20 pixels)
- Capture from faded/low-quality areas

---

## Console Debug Commands

Open console (F12) and try:

```javascript
// Check if OpenCV is loaded
window.SymbolDetector.isReady

// List all templates
window.SymbolDetector.SYMBOL_TEMPLATES

// See detected symbols
window.SymbolDetector.detectedSymbols

// Check template count for "pump"
window.SymbolDetector.SYMBOL_TEMPLATES.pump.templates.length
```

---

## Known Limitations

- **Scale sensitivity**: Symbols must be similar size to template
- **Rotation**: Rotated symbols won't match
- **Quality**: Low-resolution PDFs have lower accuracy
- **Speed**: Large PDFs take 10-30 seconds to scan

For production use, consider server-side processing with Python + OpenCV or ML-based detection.
