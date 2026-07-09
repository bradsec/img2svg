import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertRasterBudget,
  MAX_TRACE_PIXELS,
  binarizeAlpha,
  countPaths,
  detectBackgroundColor,
  dominantOpaqueColor,
  finalizeSvg,
  knockOutColor,
  modeFilter,
  parseHexColor,
  quantize,
  resolveSettings,
  toGrayscale,
  toHexColor,
} from "../js/preprocess.js";

function makeImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { data, width, height };
}

function setPixel(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 4)];
}

test("parseHexColor accepts #RRGGBB and RRGGBB", () => {
  assert.deepEqual(parseHexColor("#FFAA00"), [255, 170, 0]);
  assert.deepEqual(parseHexColor("ffaa00"), [255, 170, 0]);
  assert.equal(parseHexColor("notacolor"), null);
  assert.equal(parseHexColor("#FFF"), null);
});

test("toHexColor round-trips", () => {
  assert.equal(toHexColor([17, 25, 15]), "#11190F");
  assert.deepEqual(parseHexColor(toHexColor([1, 2, 3])), [1, 2, 3]);
});

test("detectBackgroundColor picks most common opaque corner", () => {
  const img = makeImage(4, 4, [10, 20, 30, 255]);
  setPixel(img, 3, 3, [200, 0, 0, 255]);
  assert.deepEqual(detectBackgroundColor(img), [10, 20, 30]);
});

test("detectBackgroundColor returns null for transparent corners", () => {
  const img = makeImage(4, 4, [10, 20, 30, 0]);
  assert.equal(detectBackgroundColor(img), null);
});

test("knockOutColor zeroes alpha within fuzz only", () => {
  const img = makeImage(2, 1, [100, 100, 100, 255]);
  setPixel(img, 1, 0, [130, 100, 100, 255]);
  knockOutColor(img, [100, 100, 100], 16);
  assert.equal(getPixel(img, 0, 0)[3], 0); // exact match removed
  assert.equal(getPixel(img, 1, 0)[3], 255); // 30 > fuzz, kept
});

test("binarizeAlpha thresholds at 128", () => {
  const img = makeImage(3, 1);
  setPixel(img, 0, 0, [0, 0, 0, 127]);
  setPixel(img, 1, 0, [0, 0, 0, 128]);
  setPixel(img, 2, 0, [0, 0, 0, 255]);
  binarizeAlpha(img);
  assert.equal(getPixel(img, 0, 0)[3], 0);
  assert.equal(getPixel(img, 1, 0)[3], 255);
  assert.equal(getPixel(img, 2, 0)[3], 255);
});

test("toGrayscale preserves alpha", () => {
  const img = makeImage(1, 1, [255, 0, 0, 200]);
  toGrayscale(img);
  const [r, g, b, a] = getPixel(img, 0, 0);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(a, 200);
});

test("dominantOpaqueColor ignores transparent pixels", () => {
  const img = makeImage(4, 1, [9, 9, 9, 0]);
  setPixel(img, 0, 0, [50, 60, 70, 255]);
  assert.deepEqual(dominantOpaqueColor(img), [50, 60, 70]);
});

test("dominantOpaqueColor falls back to white when fully transparent", () => {
  const img = makeImage(2, 2, [9, 9, 9, 0]);
  assert.deepEqual(dominantOpaqueColor(img), [255, 255, 255]);
});

test("quantize reduces distinct colors and leaves alpha untouched", () => {
  const img = makeImage(16, 1);
  for (let x = 0; x < 16; x++) setPixel(img, x, 0, [x * 16, 255 - x * 16, 128, 255]);
  quantize(img, 4);
  const unique = new Set();
  for (let x = 0; x < 16; x++) {
    const [r, g, b, a] = getPixel(img, x, 0);
    unique.add(`${r},${g},${b}`);
    assert.equal(a, 255);
  }
  assert.ok(unique.size <= 4, `expected <= 4 colors, got ${unique.size}`);
});

test("quantize backfills transparent pixels so they do not skew the palette", () => {
  // 1 opaque red pixel + 63 transparent garbage-black pixels.
  const img = makeImage(8, 8, [1, 2, 0, 0]);
  setPixel(img, 4, 4, [255, 0, 0, 255]);
  quantize(img, 2);
  const [r, g, b] = getPixel(img, 4, 4);
  assert.deepEqual([r, g, b], [255, 0, 0]);
});

test("quantize is a no-op when colors already fit", () => {
  const img = makeImage(2, 1, [10, 20, 30, 255]);
  const before = [...img.data];
  quantize(img, 8);
  assert.deepEqual([...img.data], before);
});

test("modeFilter removes isolated speck, keeps solid regions", () => {
  const img = makeImage(5, 5, [10, 10, 10, 255]);
  setPixel(img, 2, 2, [200, 0, 0, 255]); // lone speck
  modeFilter(img);
  assert.deepEqual(getPixel(img, 2, 2).slice(0, 3), [10, 10, 10]);
  assert.deepEqual(getPixel(img, 0, 0).slice(0, 3), [10, 10, 10]);
});

test("modeFilter ignores transparent pixels and preserves alpha", () => {
  const img = makeImage(3, 3, [10, 10, 10, 0]);
  setPixel(img, 1, 1, [200, 0, 0, 255]);
  modeFilter(img);
  // Lone opaque pixel has no opaque majority around it: unchanged.
  assert.deepEqual(getPixel(img, 1, 1), [200, 0, 0, 255]);
  assert.equal(getPixel(img, 0, 0)[3], 0);
});

test("finalizeSvg restores source size and adds viewBox", () => {
  const svg = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="400">\n</svg>';
  const out = finalizeSvg(svg, 100, 200);
  assert.match(out, /width="100" height="200" viewBox="0 0 200 400"/);
});

test("finalizeSvg leaves unexpected roots unchanged", () => {
  const svg = "<svg><path/></svg>";
  assert.equal(finalizeSvg(svg, 10, 10), svg);
});

test("countPaths counts path elements", () => {
  assert.equal(countPaths('<svg><path d="M0 0"/><path d="M1 1"/></svg>'), 2);
  assert.equal(countPaths("<svg></svg>"), 0);
});

test("assertRasterBudget passes typical sizes, rejects oversize", () => {
  assert.equal(assertRasterBudget(1000, 1000, 2), 4_000_000);
  assert.equal(assertRasterBudget(4000, 4000, 2), MAX_TRACE_PIXELS);
  assert.throws(() => assertRasterBudget(8000, 8000, 4), /too large to trace at 4x/);
  assert.throws(() => assertRasterBudget(8000, 8001, 1), /Lower the upscale/);
});

test("logo preset resolves to 2 colors", () => {
  const s = resolveSettings("logo", {});
  assert.deepEqual([s.colors, s.speckle, s.layerDiff], [2, 16, 48]);
});

test("resolveSettings: explicit beats preset beats defaults", () => {
  const s = resolveSettings("tshirt", { colors: 8 });
  assert.equal(s.colors, 8); // explicit wins
  assert.equal(s.speckle, 8); // from tshirt preset
  assert.equal(s.layerDiff, 24); // from tshirt preset
  const d = resolveSettings(null, {});
  assert.equal(d.colors, 256);
  assert.equal(d.speckle, 8);
  assert.equal(d.layerDiff, 16);
});
