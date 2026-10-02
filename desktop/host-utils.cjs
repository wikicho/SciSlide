const path = require("node:path");
const fs = require("node:fs/promises");

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const COMMANDS = new Set([
  "new",
  "open",
  "save",
  "saveAs",
  "undo",
  "redo",
  "present",
  "exportPdf",
]);

function parseDevUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid SciSlide development URL.");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "5173" ||
    parsed.pathname !== "/" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "SciSlide development mode only accepts http://127.0.0.1:5173/.",
    );
  return parsed.href;
}

function isAppOrigin(value, devUrl = null) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    if (devUrl) return parsed.origin === new URL(devUrl).origin;
    return (
      parsed.protocol === "scislide:" &&
      parsed.hostname === "app" &&
      !parsed.port
    );
  } catch {
    return false;
  }
}

function isTrustedPage(value, devUrl = null) {
  if (!isAppOrigin(value, devUrl)) return false;
  const parsed = new URL(value);
  return (
    (parsed.pathname === "/" || parsed.pathname === "/index.html") &&
    !parsed.search
  );
}

function allowsFullscreen(permission, mainPageUrl, details, devUrl = null) {
  return Boolean(
    permission === "fullscreen" &&
    details?.isMainFrame === true &&
    isTrustedPage(mainPageUrl, devUrl) &&
    isTrustedPage(details.requestingUrl, devUrl),
  );
}

function isAllowedRequest(value, devUrl = null) {
  if (isAppOrigin(value, devUrl)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "data:") return true;
    if (parsed.protocol === "blob:") return isAppOrigin(value.slice(5), devUrl);
    return Boolean(
      devUrl &&
      parsed.protocol === "ws:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "5173" &&
      !parsed.username &&
      !parsed.password,
    );
  } catch {
    return false;
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value;
}

function assertKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains unsupported fields.`);
}

function checkedBytes(value, max, label) {
  if (
    !(value instanceof Uint8Array) ||
    !value.byteLength ||
    value.byteLength > max
  )
    throw new Error(`${label} is empty or exceeds the file limit.`);
  return Buffer.from(value);
}

function suggestedName(value, extension) {
  if (typeof value !== "string" || value.length > 300)
    throw new Error("Choose a short file name.");
  const cleaned =
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/^\.+|[. ]+$/g, "")
      .trim() || "Untitled";
  return cleaned.toLowerCase().endsWith(`.${extension}`)
    ? cleaned
    : `${cleaned}.${extension}`;
}

function validateSaveDocument(value) {
  assertRecord(value, "Save request");
  assertKeys(value, ["bytes", "suggestedName", "saveAs"], "Save request");
  if (value.saveAs !== undefined && typeof value.saveAs !== "boolean")
    throw new Error("Save As must be true or false.");
  const bytes = checkedBytes(value.bytes, MAX_DOCUMENT_BYTES, "Document");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("The document must be a .scislide archive.");
  return {
    bytes,
    suggestedName: suggestedName(value.suggestedName, "scislide"),
    saveAs: value.saveAs === true,
  };
}

function validateSaveExport(value) {
  assertRecord(value, "Export request");
  assertKeys(value, ["bytes", "suggestedName", "kind"], "Export request");
  if (value.kind !== "pdf" && value.kind !== "svg")
    throw new Error("Choose PDF or SVG export.");
  const bytes = checkedBytes(value.bytes, MAX_EXPORT_BYTES, "Export");
  if (
    value.kind === "pdf" &&
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    throw new Error("Invalid PDF export.");
  if (
    value.kind === "svg" &&
    !/<svg[\s>]/i.test(bytes.subarray(0, 4096).toString("utf8"))
  )
    throw new Error("Invalid SVG export.");
  return {
    bytes,
    suggestedName: suggestedName(value.suggestedName, value.kind),
    kind: value.kind,
  };
}

function validateJobId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new Error("Invalid equation job identifier.");
  return value;
}

function validateCompile(value) {
  assertRecord(value, "Equation request");
  assertKeys(
    value,
    [
      "jobId",
      "source",
      "preamble",
      "engine",
      "fontSize",
      "color",
      "displayMode",
    ],
    "Equation request",
  );
  validateJobId(value.jobId);
  if (
    typeof value.source !== "string" ||
    !value.source.trim() ||
    value.source.length > 65536
  )
    throw new Error("Equation source must contain 1–65536 characters.");
  if (typeof value.preamble !== "string" || value.preamble.length > 32768)
    throw new Error("Equation preamble exceeds 32768 characters.");
  if (value.engine !== "latex" && value.engine !== "xelatex")
    throw new Error("Choose LaTeX or XeLaTeX.");
  if (
    typeof value.fontSize !== "number" ||
    !Number.isFinite(value.fontSize) ||
    value.fontSize < 4 ||
    value.fontSize > 500
  )
    throw new Error("Equation size must be between 4 and 500.");
  if (
    typeof value.color !== "string" ||
    !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value.color)
  )
    throw new Error("Choose a hexadecimal equation color.");
  if (typeof value.displayMode !== "boolean")
    throw new Error("Equation display mode must be true or false.");
  return { ...value };
}

async function resolveAsset(value, distRoot) {
  if (!isAppOrigin(value)) throw new Error("Invalid app resource origin.");
  const parsed = new URL(value);
  const pathname = decodeURIComponent(parsed.pathname);
  if (
    pathname.includes("\\") ||
    pathname.includes("\0") ||
    pathname.split("/").some((part) => part === "..")
  )
    throw new Error("Invalid app resource path.");
  const assetPath = path.resolve(
    distRoot,
    pathname === "/" ? "index.html" : `.${pathname}`,
  );
  const root = await fs.realpath(distRoot);
  const candidate = await fs.realpath(assetPath);
  const relative = path.relative(root, candidate);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("App resource leaves the application directory.");
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES)
    throw new Error("Invalid app resource.");
  return candidate;
}

module.exports = {
  COMMANDS,
  MAX_DOCUMENT_BYTES,
  MAX_EXPORT_BYTES,
  parseDevUrl,
  isAppOrigin,
  isTrustedPage,
  allowsFullscreen,
  isAllowedRequest,
  validateSaveDocument,
  validateSaveExport,
  validateCompile,
  validateJobId,
  resolveAsset,
  suggestedName,
};
