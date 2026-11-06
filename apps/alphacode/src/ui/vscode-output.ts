import { Writable } from "node:stream";

const kittyStart = Buffer.from("\x1b_G");
const sequenceEnd = Buffer.from("\x1b\\");

/** xterm puts negative Kitty layers behind its opaque cell backgrounds. */
export class VscodeImageOutput extends Writable {
  private pending = Buffer.alloc(0);

  constructor(private readonly destination: NodeJS.WriteStream) { super(); }
  get columns() { return this.destination.columns; }
  get rows() { return this.destination.rows; }
  get isTTY() { return this.destination.isTTY; }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    const output: Buffer[] = [];
    let offset = 0;
    while (offset < data.length) {
      const start = data.indexOf(kittyStart, offset);
      if (start < 0) {
        // Keep only a possible split APC introducer; never decode text or image bytes.
        const tail = data.at(-1) === 0x1b ? 1 : data.at(-2) === 0x1b && data.at(-1) === 0x5f ? 2 : 0;
        output.push(data.subarray(offset, data.length - tail));
        this.pending = Buffer.from(data.subarray(data.length - tail));
        break;
      }
      output.push(data.subarray(offset, start));
      const end = data.indexOf(sequenceEnd, start + kittyStart.length);
      if (end < 0) {
        // Kitty chunks are at most a few KiB. Bound buffering for malformed output.
        if (data.length - start > 65536) output.push(data.subarray(start));
        else this.pending = Buffer.from(data.subarray(start));
        break;
      }
      const command = data.subarray(start, end + sequenceEnd.length);
      const separator = command.indexOf(0x3b);
      const headerEnd = separator < 0 ? command.length - sequenceEnd.length : separator;
      const header = command.subarray(kittyStart.length, headerEnd).toString("ascii");
      if (/(?:^|,)a=(?:p|T)(?:,|$)/.test(header) && /(?:^|,)z=-\d+(?:,|$)/.test(header)) {
        // OpenTUI uses -2^30 + paint order for images above backgrounds, below text.
        // This app's image occupies its own cells, so a nonnegative layer is safe.
        const fixed = header.replace(/(^|,)z=-(\d+)(?=,|$)/, (_match, prefix: string, depth: string) =>
          `${prefix}z=${Math.max(0, 1073741824 - Number(depth))}`);
        output.push(kittyStart, Buffer.from(fixed, "ascii"), command.subarray(headerEnd));
      } else output.push(command);
      offset = end + sequenceEnd.length;
    }
    if (output.length) this.destination.write(Buffer.concat(output), done);
    else done();
  }

  override _final(done: (error?: Error | null) => void) {
    if (this.pending.length) this.destination.write(this.pending, done);
    else done();
  }
}
