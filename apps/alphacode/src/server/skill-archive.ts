import { fromBuffer, type Entry } from "yauzl";
import { fail } from "./security";

export const skillUploadLimit = 10 * 1024 * 1024;
export const skillExpandedLimit = 40 * 1024 * 1024;
export interface SkillFile { path: string; bytes: Buffer; executable?: boolean }

// Use portable names so the same package cannot alias a file on Windows.
export function safeSkillPath(path: string) {
  const parts = path.replace(/\/$/, "").split("/");
  if (!path || path.length > 512 || parts.some(part => !part || part === "." || part === ".."
    || /[\\<>:"|?*]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) fail(400, "SKILL_UNSAFE_ARCHIVE");
  return parts.join("/");
}

export function unpackSkills(bytes: Buffer): Promise<SkillFile[]> {
  if (bytes.length > skillUploadLimit) fail(413, "SKILL_PACKAGE_TOO_LARGE");
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(Object.assign(new Error("SKILL_INVALID_ARCHIVE"), { status: 400, code: "SKILL_INVALID_ARCHIVE" })); return; }
      const files: SkillFile[] = [], seen = new Set<string>();
      let count = 0, expanded = 0;
      const stop = (cause: unknown) => {
        zip.close();
        reject((cause as { status?: number }).status ? cause : Object.assign(new Error("SKILL_INVALID_ARCHIVE"), { status: 400, code: "SKILL_INVALID_ARCHIVE" }));
      };
      zip.on("error", stop);
      zip.on("end", () => resolve(files));
      zip.on("entry", (entry: Entry) => {
        try {
          if (++count > 2048) fail(413, "SKILL_PACKAGE_TOO_LARGE");
          const path = safeSkillPath(entry.fileName), key = path.toLowerCase();
          if (seen.has(key)) fail(400, "SKILL_UNSAFE_ARCHIVE");
          seen.add(key);
          const mode = entry.externalFileAttributes >>> 16;
          const type = mode & 0o170000;
          if (entry.isEncrypted() || (type && type !== 0o100000 && type !== 0o040000)) fail(400, "SKILL_UNSAFE_ARCHIVE");
          expanded += entry.uncompressedSize;
          if (expanded > skillExpandedLimit) fail(413, "SKILL_PACKAGE_TOO_LARGE");
          if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
          zip.openReadStream(entry, (cause, stream) => {
            if (cause || !stream) { stop(cause ?? new Error()); return; }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", stop);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > skillExpandedLimit) { stream.destroy(); stop(Object.assign(new Error(), { status: 413, code: "SKILL_PACKAGE_TOO_LARGE" })); }
              else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (size !== entry.uncompressedSize) { stop(new Error()); return; }
              files.push({ path, bytes: Buffer.concat(chunks), executable: Boolean(mode & 0o111) });
              zip.readEntry();
            });
          });
        } catch (cause) { stop(cause); }
      });
      zip.readEntry();
    });
  });
}
