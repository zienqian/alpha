import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { BlockList, isIP } from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getProxyForUrl } from "proxy-from-env";
import { skillUploadLimit } from "./skill-archive";
import { fail } from "./security";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]] as const) blocked.addSubnet(address, prefix, "ipv6");

export function publicSkillAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, "ipv6");
}

export function skillLink(input: string): { url: URL; folder?: string; name?: string } {
  let url: URL;
  try { url = new URL(input); } catch { return fail(400, "SKILL_INVALID_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) fail(400, "SKILL_INVALID_URL");
  const parts = url.pathname.split("/").filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return fail(400, "SKILL_INVALID_URL"); }
  });
  if (url.hostname === "skills.sh" || url.hostname === "github.com") {
    const [owner, repository, action, ref, ...rest] = parts;
    if (!owner || !repository || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository)) return fail(400, "SKILL_INVALID_URL");
    if (url.hostname === "skills.sh") {
      if (parts.length !== 3 || !action || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(action)) fail(400, "SKILL_INVALID_URL");
      return { url: new URL(`https://codeload.github.com/${owner}/${repository}/zip/HEAD`), name: action };
    }
    if (!action) return { url: new URL(`https://codeload.github.com/${owner}/${repository.replace(/\.git$/, "")}/zip/HEAD`) };
    if ((action === "tree" || action === "blob") && ref) {
      if (action === "blob" && rest.at(-1) !== "SKILL.md") fail(400, "SKILL_INVALID_URL");
      return { url: new URL(`https://codeload.github.com/${owner}/${repository}/zip/${encodeURIComponent(ref)}`),
        folder: (action === "blob" ? rest.slice(0, -1) : rest).join("/") };
    }
    // GitHub archive/release URLs are downloaded with the same redirect checks.
    if (action !== "archive" && action !== "releases") fail(400, "SKILL_INVALID_URL");
  }
  return { url };
}

// Pin the verified DNS result to the socket; redirects repeat validation. This
// prevents a link from reaching local services or rebinding after the check.
export async function downloadSkill(url: URL, signal: AbortSignal, redirects = 0): Promise<Buffer> {
  skillLink(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicSkillAddress(address))) fail(400, "SKILL_UNSAFE_URL");
  const address = addresses.find(item => item.family === 4) ?? addresses[0];
  if (!address) return fail(400, "SKILL_UNSAFE_URL");
  const proxy = getProxyForUrl(url.href);
  const agent = proxy ? new HttpsProxyAgent(proxy, { signal }) : false;
  if (agent) {
    const connect = agent.connect.bind(agent);
    // Proxy settings belong to the trusted server environment. CONNECT targets
    // the vetted IP, while TLS still verifies the original hostname.
    agent.connect = (request, options) => connect(request, { ...options, secureEndpoint: true, host: address.address, port: 443, servername: hostname });
  }
  return new Promise<Buffer>((resolve, reject) => {
    const request = get(url, { signal, agent,
      headers: { Accept: "application/zip, text/plain, application/octet-stream", "User-Agent": "AlphaCode-Skills" },
      lookup: (_host, options, callback) => {
        // Keep all vetted addresses so the socket can fall back when one route
        // is unreachable, without performing another unvalidated DNS lookup.
        if (options.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy();
        if (redirects >= 4) { reject(Object.assign(new Error(), { status: 400, code: "SKILL_DOWNLOAD_FAILED" })); return; }
        let next: URL;
        try { next = new URL(response.headers.location, url); } catch (cause) { reject(cause); return; }
        downloadSkill(next, signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { response.destroy(); reject(Object.assign(new Error(), { status: 400, code: "SKILL_DOWNLOAD_FAILED" })); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > skillUploadLimit) response.destroy(Object.assign(new Error(), { status: 413, code: "SKILL_PACKAGE_TOO_LARGE" }));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}
