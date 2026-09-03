/**
 * localToneIdentity.ts: give a locally loaded `.nam` back its TONE3000
 * identity (artwork, title, gear, author).
 *
 * A `.nam` trained on TONE3000 carries `metadata.name` (the model's name)
 * and `metadata.modeled_by` (the author's username), but no tone id, so the
 * catalog entry has to be *found*. Search by name, keep the tones by that
 * author, then prove the match by content: download the candidate model and
 * check its bytes against the local file's.
 *
 * The proof is a content hash, not a name comparison, because names are not
 * unique and a wrong tone would put someone else's artwork on the tile.
 *
 * Why FNV-1a rather than SHA-256: the local bytes are not reachable from the
 * webview (the stash copy lives behind a `file://` URL, which the DOM cannot
 * read), so the local side of the comparison has to be something native
 * already published. Native content-addresses every stash file as
 * `<fnv1a64 hex>-<size>.<ext>` and that name is right there in the model's
 * `model_url`, so hashing only the *downloaded* bytes closes the loop with
 * no new native surface. Size must match too. This is a "did we find the
 * right tone" check, not a security boundary: the worst case is a generic
 * glyph (no match) and the bytes that actually play are always the local
 * ones.
 *
 * Budget per local file: one search, at most 3 model listings, one download.
 * Failures are silent -- the tile keeps the generic file glyph.
 */

import type { Model, Tone } from '../types/tone';

/** What a local `.nam` says about itself. Native lifts these out of the
    file's `metadata` block at stash time (see ProcessorModelLoader.cpp). */
export interface NamIdentity {
  /** `metadata.name`: the *model* name, which is usually longer and more
      specific than the tone's title (it names the variant too). */
  name: string;
  /** `metadata.modeled_by`: the author's TONE3000 username. */
  author: string;
}

/** At most this many tones get their models listed (one API call each). */
export const MAX_CANDIDATE_TONES = 3;

/** Reads the identity a local block's active model carries, if any. */
export function namIdentityOf(model: {
  nam_name?: string;
  nam_author?: string;
}): NamIdentity | null {
  const name = model.nam_name?.trim();
  if (!name) return null;
  return { name, author: model.nam_author?.trim() ?? '' };
}

/**
 * Which search hits are worth a models call, best first.
 *
 * The author is the discriminator: `modeled_by` is a username, so an exact
 * match on `user.username` is a strong signal even when the tone's title
 * differs from the model's name (it usually does). Without an author to go
 * on, fall back to tones whose title is a prefix of the model name -- how
 * TONE3000 names variants ("<tone title> (OVER 2)").
 */
export function pickCandidateTones(tones: Tone[], identity: NamIdentity): Tone[] {
  const namLower = identity.name.toLowerCase();
  const authorLower = identity.author.toLowerCase();

  const byAuthor = authorLower
    ? tones.filter((t) => t.user?.username?.toLowerCase() === authorLower)
    : [];
  if (byAuthor.length > 0) return byAuthor.slice(0, MAX_CANDIDATE_TONES);

  // No author on the file (or nobody matched): a title the model name
  // starts with is the only other honest signal.
  return tones
    .filter((t) => {
      const title = t.title?.trim().toLowerCase();
      return !!title && namLower.startsWith(title);
    })
    .slice(0, MAX_CANDIDATE_TONES);
}

/**
 * The one model in a tone worth downloading: the one whose name is the
 * file's `metadata.name`. Exact once trimmed; nothing fuzzy, because a
 * wrong pick costs a download and still fails the hash check.
 */
export function pickModel(models: Model[], identity: NamIdentity): Model | undefined {
  const wanted = identity.name.trim();
  const exact = models.find((m) => m.name?.trim() === wanted);
  if (exact) return exact;
  // A tone with exactly one model and nothing else to go on: the hash still
  // has the final say.
  return models.length === 1 ? models[0] : undefined;
}

/**
 * Native's stash address for a local model: `<fnv1a64 hex>-<size>.<ext>`.
 * Returns null for anything else (a catalog URL, an older stash name).
 */
export function stashAddressOf(modelUrl: string): { hash: string; size: number } | null {
  if (!modelUrl.startsWith('file:')) return null;
  const file = decodeURIComponent(modelUrl.split('/').pop() ?? '');
  const match = /^([0-9a-f]+)-(\d+)\.[a-z0-9]+$/i.exec(file);
  if (!match) return null;
  return { hash: match[1].toLowerCase(), size: Number(match[2]) };
}

/**
 * FNV-1a 64, the hash behind those stash names (ProcessorModelLoader.cpp).
 * Hex, no leading zeros, to match `juce::String::toHexString`.
 */
export function fnv1a64Hex(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash ^ BigInt(bytes[i])) * prime) & mask;
  }
  return hash.toString(16);
}

/** Whether downloaded bytes are the local file, byte for byte. */
export function bytesMatchStash(
  bytes: Uint8Array,
  address: { hash: string; size: number }
): boolean {
  return bytes.length === address.size && fnv1a64Hex(bytes) === address.hash;
}

/** The identity fields adopted from a catalog tone. Playback stays local:
    `local` and the stored `models` (with their `file://` URLs) are the
    block's own, preserved natively by refreshToneMetadata. */
export function adoptedToneJson(tone: Tone): string {
  return JSON.stringify({ ...tone, local: true });
}
