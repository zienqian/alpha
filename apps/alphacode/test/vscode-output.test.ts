import { expect, test } from "bun:test";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { VscodeImageOutput } from "../src/ui/vscode-output";

test("VS Code Kitty placements stay visible while UTF-8 text, pixels, deletion and other protocols remain intact across chunk boundaries", async () => {
  const parts: Buffer[] = [];
  const destination = new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); } });
  const output = new VscodeImageOutput(destination as unknown as NodeJS.WriteStream);
  const source = Buffer.from("你好 👩‍💻\x1b[38;2;1;2;3mWorking…\x1b_Ga=t,f=32,s=1,v=1,i=7;AQIDBA==\x1b\\"
    + "\x1b_Ga=p,i=7,c=4,r=1,z=-1073741823,q=2\x1b\\\x1b_Ga=p,i=8,z=2\x1b\\"
    + "\x1b_Ga=d,d=I,i=7,q=2\x1b\\\x1bPq~\x1b\\\x1b_Ga=T,z=-1073741822;AQIDBA==\x1b\\\x1b_");
  // Native output buffers are reused. Split every byte and reuse the input allocation.
  const byte = Buffer.alloc(1);
  for (const value of source) {
    byte[0] = value;
    await new Promise<void>((resolve, reject) => output.write(byte, error => error ? reject(error) : resolve()));
  }
  output.end();
  await finished(output);
  expect(Buffer.concat(parts).toString()).toBe(source.toString().replace("z=-1073741823", "z=1").replace("z=-1073741822", "z=2"));
  expect(destination.writableEnded).toBe(false);
});
