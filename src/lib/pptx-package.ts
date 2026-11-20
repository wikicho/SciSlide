import JSZip from "jszip";
import { MAX_ARCHIVE_BYTES, readBytes } from "./persistence";

const OPC_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELATIONSHIPS = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
];
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

export function children(parent: Element | null | undefined, name?: string) {
  return Array.from(parent?.children ?? []).filter(
    (element) => !name || element.localName === name,
  );
}

export function child(parent: Element | null | undefined, name: string) {
  return children(parent, name)[0];
}

export function attr(element: Element | null | undefined, name: string) {
  return element?.getAttribute(name) ?? undefined;
}

export function relationshipId(element: Element | undefined, name = "id") {
  for (const namespace of OFFICE_RELATIONSHIPS) {
    const id = element?.getAttributeNS(namespace, name);
    if (id) return id;
  }
  return undefined;
}

type Relationship = { kind: string; part?: string };

function resolvePart(source: string, target: string): string | undefined {
  if (/[\\:?#]/.test(target)) return undefined;
  const segments = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const encoded of target.replace(/^\//, "").split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
    if (!segment || /[\\/:\x00]/.test(segment)) return undefined;
    if (segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/") || undefined;
}

type ZipEntry = JSZip.JSZipObject & {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

export class PptxPackage {
  private xmlParts = new Map<string, Promise<Element>>();
  private partRelationships = new Map<
    string,
    Promise<Map<string, Relationship>>
  >();
  private unpackedBytes = 0;

  private constructor(private zip: JSZip) {}

  static async open(file: Blob) {
    if (!file.size || file.size > MAX_ARCHIVE_BYTES)
      throw new Error("Choose a PowerPoint (.pptx) file smaller than 64 MB.");
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await readBytes(file));
    } catch {
      throw new Error("This is not a readable .pptx archive.");
    }
    const entries = Object.values(zip.files) as ZipEntry[];
    if (entries.length > 12_000)
      throw new Error("The PowerPoint archive contains too many parts.");
    let declaredBytes = 0;
    for (const entry of entries) {
      const name = entry.dir ? entry.name.slice(0, -1) : entry.name;
      if (
        (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) ||
        /[\\:\x00]/.test(name) ||
        name.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error(
          "The PowerPoint archive contains an invalid part name.",
        );
      if (entry.dir) continue;
      const size = entry._data?.uncompressedSize ?? 0;
      if (!Number.isSafeInteger(size) || size < 0)
        throw new Error(
          "The PowerPoint archive contains an invalid part size.",
        );
      declaredBytes += size;
      if (declaredBytes > MAX_UNPACKED_BYTES)
        throw new Error("The PowerPoint archive exceeds 100 MB unpacked.");
    }
    return new PptxPackage(zip);
  }

  bytes(part: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    const entry = this.zip.file(part) as ZipEntry | null;
    if (!entry)
      return Promise.reject(new Error("The archive part is missing."));
    const size = entry._data?.uncompressedSize ?? 0;
    if (size > limit)
      return Promise.reject(new Error("The archive part is too large."));

    // Bound actual output as well as the directory's declared sizes.
    return new Promise((resolve, reject) => {
      const result = new Uint8Array(size);
      let offset = 0;
      const stream = entry.internalStream("uint8array");
      stream
        .on("data", (chunk) => {
          this.unpackedBytes += chunk.byteLength;
          if (
            offset + chunk.byteLength > size ||
            this.unpackedBytes > MAX_UNPACKED_BYTES
          ) {
            stream.pause();
            reject(new Error("The archive part exceeds its allowed size."));
            return;
          }
          result.set(chunk, offset);
          offset += chunk.byteLength;
        })
        .on("end", () => {
          if (offset === size) resolve(result);
          else reject(new Error("The archive part has an invalid size."));
        })
        .on("error", reject)
        .resume();
    });
  }

  xml(part: string): Promise<Element> {
    const cached = this.xmlParts.get(part);
    if (cached) return cached;
    const result = this.bytes(part, MAX_XML_BYTES).then((bytes) => {
      const utf16 =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? "utf-16le"
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? "utf-16be"
            : "utf-8";
      const source = new TextDecoder(utf16, { fatal: true }).decode(bytes);
      if (/<!DOCTYPE/i.test(source))
        throw new Error("PowerPoint XML cannot contain a document type.");
      const document = new DOMParser().parseFromString(
        source,
        "application/xml",
      );
      if (document.getElementsByTagName("parsererror").length)
        throw new Error("The PowerPoint archive contains invalid XML.");
      return document.documentElement;
    });
    this.xmlParts.set(part, result);
    return result;
  }

  relationships(source: string): Promise<Map<string, Relationship>> {
    const cached = this.partRelationships.get(source);
    if (cached) return cached;
    const slash = source.lastIndexOf("/") + 1;
    const path = `${source.slice(0, slash)}_rels/${source.slice(slash)}.rels`;
    const result = this.zip.file(path)
      ? this.xml(path).then((root) => {
          const relationships = new Map<string, Relationship>();
          if (
            root.localName !== "Relationships" ||
            root.namespaceURI !== OPC_RELATIONSHIPS
          )
            throw new Error("The PowerPoint relationship part is invalid.");
          for (const node of children(root, "Relationship")) {
            const id = attr(node, "Id"),
              type = attr(node, "Type"),
              target = attr(node, "Target");
            if (!id || !type || !target || relationships.has(id)) continue;
            const vocabulary = OFFICE_RELATIONSHIPS.find((prefix) =>
              type.startsWith(`${prefix}/`),
            );
            if (!vocabulary) continue;
            const mode = attr(node, "TargetMode");
            relationships.set(id, {
              kind: type.slice(vocabulary.length + 1),
              part:
                !mode || mode === "Internal"
                  ? resolvePart(source, target)
                  : undefined,
            });
          }
          return relationships;
        })
      : Promise.resolve(new Map<string, Relationship>());
    this.partRelationships.set(source, result);
    return result;
  }

  async related(source: string, kind: string) {
    return [...(await this.relationships(source)).values()].find(
      (relationship) => relationship.kind === kind,
    )?.part;
  }

  async reference(source: string, id: string | undefined, kind: string) {
    if (!id) return undefined;
    const relationship = (await this.relationships(source)).get(id);
    return relationship?.kind === kind ? relationship.part : undefined;
  }
}
