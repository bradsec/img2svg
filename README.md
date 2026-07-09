# img2svg web app

Browser-based raster to SVG converter. Same pipeline as the Python CLI in the repository root, running entirely client-side: [vtracer](https://github.com/visioncortex/vtracer) compiled to WebAssembly plus a Canvas/JS preprocessing stage. Images never leave the machine.

## Features

- PNG, JPEG, WebP, GIF, BMP input (anything the browser decodes)
- Premultiplied-alpha upscaling (no edge halos), binary alpha (no fringe fragmentation)
- Median-cut + k-means color quantization with transparent-area backfill
- 3x3 majority filter to clean quantization dither
- Optional denoise blur for photographic sources
- Background removal: auto-detect from corners, hex color, or eyedropper pick from the image
- Presets matched to print practice: T-shirt 5 colors (screen-print spot-color sweet spot), Poster 6, Detailed 8, Simple 3, Logo 2 (two-color marks, stencils)
- Live re-trace on setting changes, SVG download and clipboard copy
- Responsive layout, keyboard operable, WCAG AA contrast

## Structure

```
index.html          app shell
css/styles.css      design tokens + layout (dark, family-matched)
js/preprocess.js    pure pixel/string ops (Node-testable, no browser APIs)
js/pipeline.js      decode, premultiplied rasterize, worker round-trip
js/worker.js        Web Worker: preprocessing + wasm trace off the main thread
js/app.js           UI wiring
pkg/                wasm-pack output (committed so Pages serves it as-is)
wasm/               Rust wrapper crate around vtracer
tests/              node --test unit tests
```

## Develop

```bash
npm test                 # unit tests (node --test)
npm run serve            # http://localhost:8137
npm run build:wasm       # rebuild pkg/ (needs rustup target wasm32-unknown-unknown + wasm-pack)
```

## Deploy

Static files only; any static host works. The repository ships a GitHub Actions workflow that publishes this directory to GitHub Pages on push to main.
