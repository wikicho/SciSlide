import assert from "node:assert/strict";
import test from "node:test";
import { pdfResourcePolicy } from "../desktop/pdf-policy.cjs";

const baseCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
].join("; ");
const expectedCsp = baseCsp.replace(
  "script-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
);
const devUrl = "http://127.0.0.1:5173/";

test("allows WebAssembly only for packaged PDF.js worker filenames", () => {
  for (const url of [
    "scislide://app/assets/pdf.worker.mjs",
    "scislide://app/assets/pdf.worker-D4_n-81Q.mjs",
    "scislide://app/assets/pdf.worker-0.mjs",
  ]) {
    const result = pdfResourcePolicy(url, baseCsp);
    assert.equal(result, expectedCsp);
    assert.doesNotMatch(result, /(?:^|\s)'unsafe-eval'(?:\s|$)/);
    assert.match(result, /worker-src 'self'/);
    assert.equal(pdfResourcePolicy(url, result), result);
  }
});

test("allows the local development worker while preserving development policy", () => {
  const devCsp = baseCsp.replace(
    "script-src 'self'",
    "script-src 'self' 'unsafe-inline'",
  );
  const url =
    "http://127.0.0.1:5173/node_modules/pdfjs-dist/build/pdf.worker.mjs?worker_file&type=module";
  assert.equal(
    pdfResourcePolicy(url, devCsp, devUrl),
    devCsp.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"),
  );
  assert.equal(pdfResourcePolicy(url, baseCsp), baseCsp);
});

test("leaves main pages, renderer modules, resources, and filename spoofs unchanged", () => {
  for (const pathname of [
    "/",
    "/index.html",
    "/assets/index-abc.js",
    "/assets/pdf.mjs",
    "/assets/pdf.worker.js",
    "/assets/pdf.worker.mjs.js",
    "/assets/pdf.worker.mjs/other.mjs",
    "/assets/pdf.worker.mjs/",
    "/assets/other-pdf.worker.mjs",
    "/assets/pdf.worker-.mjs",
    "/assets/pdf.worker-a.b.mjs",
    "/assets/%70df.worker.mjs",
    "/assets/PDF.worker.mjs",
    "/index.html?file=pdf.worker.mjs",
    "/assets/index.mjs#pdf.worker.mjs",
    "/assets/pdf.worker-abc.wasm",
  ]) {
    assert.equal(
      pdfResourcePolicy(`scislide://app${pathname}`, baseCsp),
      baseCsp,
    );
    assert.equal(
      pdfResourcePolicy(new URL(pathname, devUrl).href, baseCsp, devUrl),
      baseCsp,
    );
  }
});

test("rejects external, credential-bearing, malformed, and different-origin worker URLs", () => {
  for (const url of [
    "https://example.com/pdf.worker.mjs",
    "scislide://other/pdf.worker.mjs",
    "scislide://app:1234/pdf.worker.mjs",
    "scislide://user@app/pdf.worker.mjs",
    "scislide://user:password@app/pdf.worker.mjs",
    "file:///pdf.worker.mjs",
    "data:text/javascript,pdf.worker.mjs",
    "blob:scislide://app/pdf.worker.mjs",
    "not a URL",
  ])
    assert.equal(pdfResourcePolicy(url, baseCsp), baseCsp);
  for (const url of [
    "http://127.0.0.1:5174/pdf.worker.mjs",
    "http://localhost:5173/pdf.worker.mjs",
    "https://127.0.0.1:5173/pdf.worker.mjs",
    "http://user@127.0.0.1:5173/pdf.worker.mjs",
    "http://user:password@127.0.0.1:5173/pdf.worker.mjs",
    "scislide://app/pdf.worker.mjs",
  ])
    assert.equal(pdfResourcePolicy(url, baseCsp, devUrl), baseCsp);
});

test("modifies only script-src and does not invent missing directives or sources", () => {
  const url = "scislide://app/assets/pdf.worker-abc.mjs";
  assert.equal(
    pdfResourcePolicy(url, "default-src 'none'; worker-src 'self'"),
    "default-src 'none'; worker-src 'self'",
  );
  assert.equal(
    pdfResourcePolicy(url, "script-src 'none'; worker-src 'self'"),
    "script-src 'none'; worker-src 'self'",
  );
  assert.equal(
    pdfResourcePolicy(
      url,
      "script-src-elem 'self'; script-src 'self'; style-src 'self'",
    ),
    "script-src-elem 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'",
  );
});
