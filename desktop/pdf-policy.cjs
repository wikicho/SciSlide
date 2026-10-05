const { isAppOrigin } = require("./host-utils.cjs");

const PDF_WORKER_NAME = /^pdf\.worker(?:-[A-Za-z0-9_-]+)?\.mjs$/;

function pdfResourcePolicy(url, baseCsp, devUrl = null) {
  if (!isAppOrigin(url, devUrl)) return baseCsp;
  const filename = new URL(url).pathname.split("/").at(-1);
  if (!PDF_WORKER_NAME.test(filename)) return baseCsp;

  // PDF.js needs WebAssembly inside its dedicated worker for fonts and codecs.
  // Keep JavaScript evaluation blocked, and leave the renderer policy unchanged.
  return baseCsp.replace(
    /(^|;)(\s*script-src\s+)([^;]*)/,
    (directive, separator, name, sources) => {
      if (/(?:^|\s)'wasm-unsafe-eval'(?:\s|$)/.test(sources)) return directive;
      return (
        separator +
        name +
        sources.replace(/(^|\s)'self'(?=\s|$)/, "$1'self' 'wasm-unsafe-eval'")
      );
    },
  );
}

module.exports = { pdfResourcePolicy };
