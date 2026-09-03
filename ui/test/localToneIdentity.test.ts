/**
 * Pure matching rules behind local `.nam` identity adoption.
 *
 * The ui has no test runner, so this is a plain `node --test` file; Node
 * strips the TypeScript types on import. Run it with:
 *
 *   node --test ui/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bytesMatchStash,
  fnv1a64Hex,
  namIdentityOf,
  pickCandidateTones,
  pickModel,
  stashAddressOf,
  MAX_CANDIDATE_TONES,
} from '../src/t3k/localToneIdentity.ts';

// The real file this feature was built against: tone 65989 / model 427332,
// "Fender® Vibroverb® 1964 ... (_Signature #83_)" by fabiozani. Its tone
// *title* is nothing like its model *name*, which is exactly why the author
// is the discriminator and the title is only a fallback.
const IDENTITY = {
  name: 'Fender® Vibroverb® 1964  - Dumble® Steel String Singer® #002 -  Two-Rock® John Mayer Signature Prototype (_Signature #83_)',
  author: 'fabiozani',
};

const tone = (id: number, title: string, username: string) =>
  ({ id, title, user: { username } }) as never;

test('namIdentityOf reads the metadata native carried over', () => {
  assert.deepEqual(namIdentityOf({ nam_name: '  Tone  ', nam_author: ' bob ' }), {
    name: 'Tone',
    author: 'bob',
  });
  // A .nam from anywhere else carries nothing to search on.
  assert.equal(namIdentityOf({}), null);
  assert.equal(namIdentityOf({ nam_name: '   ' }), null);
  // An author-less file still has a name worth searching.
  assert.deepEqual(namIdentityOf({ nam_name: 'Tone' }), { name: 'Tone', author: '' });
});

test('the author picks the tone even when the title does not match the name', () => {
  const hits = [
    tone(1, 'Fender Vibroverb 1964 - Dumble - Two-Rock - John Mayer', 'someone_else'),
    tone(65989, 'Fender Vibroverb 1964  - Dumble  -  Two-Rock -  John Mayer', 'fabiozani'),
  ];
  assert.deepEqual(
    pickCandidateTones(hits, IDENTITY).map((t: { id: number }) => t.id),
    [65989]
  );
});

test('author matching is case-insensitive and caps the candidate list', () => {
  const many = Array.from({ length: 6 }, (_, i) => tone(i, `T${i}`, 'FabioZani'));
  assert.equal(pickCandidateTones(many, IDENTITY).length, MAX_CANDIDATE_TONES);
});

test('without an author, only a title the model name extends is a candidate', () => {
  const anon = { name: 'Fender Vibroverb 1964 (OVER 2)', author: '' };
  const hits = [
    tone(1, 'Fender Vibroverb 1964', 'a'),
    tone(2, 'Marshall JCM800', 'b'),
    tone(3, 'FENDER VIBROVERB 1964', 'c'),
  ];
  assert.deepEqual(
    pickCandidateTones(hits, anon).map((t: { id: number }) => t.id),
    [1, 3]
  );
  // A named author that nobody matches must not silently widen to everyone.
  assert.deepEqual(pickCandidateTones([tone(1, 'Marshall', 'nobody')], IDENTITY), []);
});

test('pickModel takes the exact name, or the only model, and never guesses', () => {
  const wanted = { id: 427332, name: IDENTITY.name };
  const other = { id: 9, name: 'Something else' };
  assert.equal(pickModel([other, wanted] as never, IDENTITY), wanted);
  // Whitespace differences in the stored name are not a real difference.
  assert.equal(
    pickModel([{ id: 1, name: `  ${IDENTITY.name}  ` }] as never, IDENTITY)?.id,
    1
  );
  // A single model is worth the one download; the hash still decides.
  assert.equal(pickModel([other] as never, IDENTITY), other);
  // Several models and none named right: no download at all.
  assert.equal(pickModel([other, { id: 10, name: 'Nope' }] as never, IDENTITY), undefined);
});

test('stashAddressOf reads the content address out of a file:// stash URL', () => {
  assert.deepEqual(stashAddressOf('file:///Users/x/TONE3000/LocalModels/1a2b3c4d-295832.nam'), {
    hash: '1a2b3c4d',
    size: 295832,
  });
  // A catalog URL is not a stash address.
  assert.equal(stashAddressOf('https://www.tone3000.com/api/v1/models/427332/download/x.nam'), null);
  assert.equal(stashAddressOf('file:///Users/x/plain-name.nam'), null);
});

test('fnv1a64Hex matches the native stash hash (ProcessorModelLoader.cpp)', () => {
  // FNV-1a 64 reference vectors, hex without leading zeros (JUCE's
  // String::toHexString), which is how the stash file is named.
  assert.equal(fnv1a64Hex(new Uint8Array([])), 'cbf29ce484222325');
  assert.equal(fnv1a64Hex(new TextEncoder().encode('a')), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64Hex(new TextEncoder().encode('foobar')), '85944171f73967e8');
});

test('bytesMatchStash needs both the size and the hash', () => {
  const bytes = new TextEncoder().encode('foobar');
  const address = { hash: '85944171f73967e8', size: 6 };
  assert.equal(bytesMatchStash(bytes, address), true);
  // Right hash, wrong length: not the same file.
  assert.equal(bytesMatchStash(bytes, { ...address, size: 7 }), false);
  // Different bytes of the same length.
  assert.equal(bytesMatchStash(new TextEncoder().encode('foobaz'), address), false);
});
