/**
 * Share links: the whole project, deflated and base64url-encoded into the URL fragment.
 * The fragment never reaches a server. See ADR 0009.
 *
 * Fragment format: `#p=1.<payload>`, where 1 is the link format version and the payload
 * is raw DEFLATE (RFC 1951) of the project JSON, in base64url without padding.
 */
import { Project, SCHEMA_VERSION } from '../model/schema';

export const LINK_FORMAT = 1;
/** Links longer than this are not offered by default; they break in some chat and email apps. */
export const DEFAULT_LINK_LIMIT = 8000;
const KEY = 'p=';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The project as link data. Catalogue parts and library templates travel as id and
 * version, as they do in the file; custom parts and templates are already embedded.
 */
export async function encodeProject(doc: Project): Promise<string> {
  const json = JSON.stringify(doc);
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return `${LINK_FORMAT}.${toBase64Url(packed)}`;
}

export class LinkError extends Error {}

export async function decodeProject(data: string): Promise<Project> {
  const dot = data.indexOf('.');
  const version = Number(data.slice(0, dot));
  if (dot < 1 || !Number.isInteger(version)) throw new LinkError('This is not a panel design link.');
  if (version > LINK_FORMAT) throw new LinkError('This link was made by a newer version of the app. Reload the page to update, then open it again.');
  let json: unknown;
  try {
    const bytes = await pipe(fromBase64Url(data.slice(dot + 1)), new DecompressionStream('deflate-raw'));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LinkError('This link is damaged or incomplete. Ask the sender for it again, or for a project file.');
  }
  const v = (json as { schemaVersion?: unknown })?.schemaVersion;
  if (typeof v === 'number' && v > SCHEMA_VERSION) throw new LinkError('This design was saved by a newer version of the app. Reload the page to update.');
  const parsed = Project.safeParse(json);
  if (!parsed.success) throw new LinkError(`This link does not hold a valid design: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  return parsed.data;
}

/** The share URL for a page address (without its fragment) and encoded data. */
export function shareUrl(base: string, data: string): string {
  return `${base.split('#')[0]}#${KEY}${data}`;
}

/** The link data in a URL fragment, or null if the fragment is not a share link. */
export function linkData(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  return h.startsWith(KEY) ? h.slice(KEY.length) : null;
}
