# RTL Smart Fixer

A free Chrome extension that fixes Hebrew and Arabic text direction on sites that do not handle RTL well.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Choose this project folder.

For local files like `test-page.html`, open the extension details page and enable `Allow access to file URLs`.

## Current behavior

- Detects Hebrew and Arabic text with Unicode-aware heuristics.
- Applies `dir="rtl"` only to text-like elements that appear to need it.
- Leaves code blocks, scripts, SVG, media, URL-heavy text, and unsupported input types alone.
- Watches dynamic pages with `MutationObserver`.
- Supports global on/off, per-site on/off, smart/aggressive modes, and input-field fixes.

## Test

Open `test-page.html` in Chrome after loading the extension. The Hebrew paragraphs, button, input, and textarea should become RTL while the English paragraph and code block remain LTR.
