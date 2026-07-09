// Web Worker: runs preprocessing + wasm tracing off the main thread.
import init, { trace } from "../pkg/img2svg_wasm.js";
import {
  binarizeAlpha,
  boxBlur,
  detectBackgroundColor,
  finalizeSvg,
  knockOutColor,
  modeFilter,
  quantize,
  toGrayscale,
} from "./preprocess.js";

const ready = init();

self.onmessage = async (event) => {
  const { id, img, settings, sourceWidth, sourceHeight } = event.data;
  try {
    await ready;
    const started = performance.now();

    let hasAlpha = false;
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] < 255) {
        hasAlpha = true;
        break;
      }
    }

    // Knock out a background color to transparent if requested.
    // Runs before binarization so detection sees the original alpha.
    let knockedOut = null;
    if (settings.transparent === "auto") {
      const bg = detectBackgroundColor(img);
      if (bg) {
        knockOutColor(img, bg, settings.fuzz);
        knockedOut = bg;
        hasAlpha = true;
      }
    } else if (Array.isArray(settings.transparent)) {
      knockOutColor(img, settings.transparent, settings.fuzz);
      knockedOut = settings.transparent;
      hasAlpha = true;
    }

    if (settings.grayscale) toGrayscale(img);
    if (hasAlpha) binarizeAlpha(img);
    // Optional denoise for photographic sources; destroys intentional
    // dither/pixel-art texture, so it is opt-in.
    if (settings.denoise) boxBlur(img, 2);
    if (settings.colors < 256) {
      quantize(img, settings.colors);
      modeFilter(img);
    }

    const svg = trace(
      new Uint8Array(img.data.buffer),
      img.width,
      img.height,
      settings.mode,
      settings.speckle,
      8, // color_precision: colors already reduced above, like the CLI
      settings.layerDiff,
      60, // corner_threshold
      4.0, // length_threshold
      10, // max_iterations
      45, // splice_threshold
      3, // path_precision
    );

    const finalSvg = finalizeSvg(svg, sourceWidth, sourceHeight);
    self.postMessage({
      id,
      svg: finalSvg,
      knockedOut,
      ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
