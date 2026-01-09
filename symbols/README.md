# Adding Symbols to the Library

## Quick Start

1. **Place PNG images** in the `/symbols` folder
2. **Name them descriptively**: `valve-open.png`, `pump.png`, `motor.png`
3. **Edit** `js/symbol-library.js` to register them
4. **Refresh** the app - they'll appear automatically!

---

## Step-by-Step Guide

### 1. Prepare Your Symbol Images

From your P&ID legend (like the one you shared):

1. Open the legend image in any image editor
2. Crop each symbol individually
3. Save as PNG with descriptive names:
   - `valve-open.png`
   - `valve-closed.png`
   - `valve-gate.png`
   - `valve-ball.png`
   - `valve-check.png`
   - `pump.png`
   - `motor.png`
   - `gauge.png`
   - etc.

**Tips:**
- Crop tightly around the symbol (no text labels)
- Keep transparent backgrounds if possible
- Size doesn't matter much (will be scaled automatically)
- Use PNG format for best quality

### 2. Add to `/symbols` Folder

Copy your PNG files into:
```
P-ID-Reader/
  └── symbols/
      ├── valve-open.png
      ├── valve-closed.png
      ├── pump.png
      └── ... (your images)
```

### 3. Register in `symbol-library.js`

Edit `js/symbol-library.js` and add entries to `SYMBOL_LIBRARY`:

```javascript
const SYMBOL_LIBRARY = {
    // Your new symbols:
    'pump.png': { name: 'Pump', category: 'Equipment' },
    'motor.png': { name: 'Motor', category: 'Equipment' },
    'valve-gate.png': { name: 'Gate Valve', category: 'Valves' },
    'valve-ball.png': { name: 'Ball Valve', category: 'Valves' },
    'valve-check.png': { name: 'Check Valve', category: 'Valves' },
    'gauge.png': { name: 'Gauge', category: 'Instruments' },
    // etc...
};
```

**Format:**
```javascript
'filename.png': { 
    name: 'Display Name',    // What users see
    category: 'CategoryName' // 'Valves', 'Equipment', 'Instruments', 'Actuators'
}
```

### 4. Use in the App

After adding symbols, they'll automatically appear when you:

- Click **🔧 Valves** - loads all symbols with `category: 'Valves'`
- Click **⚙️ Equipment** - loads all symbols with `category: 'Equipment'`
- Click **📚 Browse** - shows a visual browser with thumbnails of ALL symbols

---

## Categories

Organize your symbols into these categories:

- **Valves** - All valve types
- **Equipment** - Pumps, motors, heat exchangers, tanks, etc.
- **Instruments** - Gauges, indicators, transmitters
- **Actuators** - Manual, pneumatic, electric actuators
- **Other** - Anything else

---

## Current Symbols

You currently have:
- ✅ `valve-open.png` - Valve (Open)
- ✅ `valve-closed.png` - Valve (Closed)
- ✅ `valve-globe.png` - Globe Valve
- ✅ `valve-globe-closed.png` - Globe Valve (Closed)

---

## Example: Adding a Pump

1. **Crop** the pump symbol from your legend
2. **Save** as `pump.png` in `/symbols` folder
3. **Edit** `js/symbol-library.js`:
   ```javascript
   'pump.png': { name: 'Pump (Centrifugal)', category: 'Equipment' },
   ```
4. **Refresh** browser
5. **Click** "⚙️ Equipment" button
6. **See** pump template loaded!

---

## Troubleshooting

### Symbol doesn't load
- Check filename matches exactly (case-sensitive on some servers)
- Verify PNG format
- Check browser console (F12) for errors

### Symbol detects poorly
- Image might be too small - crop a larger version
- Try different threshold in detection
- Use "Draw on PDF" to capture a better template from actual document

### Symbol not in Browse dialog
- Make sure it's registered in `SYMBOL_LIBRARY` object
- Check spelling of filename
- Refresh the page
