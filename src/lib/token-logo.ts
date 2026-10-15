/**
 * Token logos come from Birdeye's `logo_uri`, which points at Arweave, IPFS
 * or a project's own CDN. The image is drawn into the video canvas, so it must
 * load with CORS: an image without it would taint the canvas and block the
 * export. IPFS logos are tried on several public gateways at once, because the
 * busiest ones rate-limit (HTTP 429); anything else is tried directly and
 * through an open image proxy that sends CORS. The first image to load wins;
 * when none does, the clip draws a monogram.
 */

const LOAD_TIMEOUT_MS = 8_000;

/** Public gateways that answer with `access-control-allow-origin: *`, fastest first. */
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://4everland.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

/** The CID and path of an IPFS URI or gateway URL, or null. */
export function ipfsPath(uri: string): string | null {
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  const gateway = uri.match(/^https:\/\/[^/]+\/ipfs\/(.+)$/i);
  if (gateway) return gateway[1]!;
  const subdomain = uri.match(/^https:\/\/([a-z0-9]{46,})\.ipfs\.[^/]+\/?(.*)$/i);
  if (subdomain) return subdomain[2] ? `${subdomain[1]}/${subdomain[2]}` : subdomain[1]!;
  return null;
}

const proxied = (url: string) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=160&h=160&fit=cover&output=png`;

export function logoCandidates(uri?: string): string[] {
  if (!uri) return [];
  const path = ipfsPath(uri);
  if (path) return [...IPFS_GATEWAYS.map((gateway) => `${gateway}${path}`), proxied(`${IPFS_GATEWAYS[0]}${path}`)];
  if (!/^https:\/\//i.test(uri)) return [];
  return [uri, proxied(uri)];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error("timeout")), LOAD_TIMEOUT_MS);
    function finish(error?: Error) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error || image.naturalWidth === 0) reject(error ?? new Error("empty image"));
      else resolve(image);
    }
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => finish();
    image.onerror = () => finish(new Error("load failed"));
    image.src = src;
  });
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadTokenLogo(uri?: string): Promise<HTMLImageElement | null> {
  if (!uri) return Promise.resolve(null);
  let held = cache.get(uri);
  if (!held) {
    const candidates = logoCandidates(uri);
    held = candidates.length === 0 ? Promise.resolve(null) : Promise.any(candidates.map(loadImage)).catch(() => null);
    cache.set(uri, held);
  }
  return held;
}
