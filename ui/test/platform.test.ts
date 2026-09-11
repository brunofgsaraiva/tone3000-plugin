/**
 * The pure predicate behind the phone layout (IS_PHONE in useUiScale).
 *
 * The ui has no test runner, so this is a plain `node --test` file; Node
 * strips the TypeScript types on import. Run it with:
 *
 *   node --test ui/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isPhoneScreen } from '../src/platform.ts';

test('every iPhone the app can run on is a phone, either way up', () => {
  // iPhone SE (3rd gen), iPhone 17, iPhone 17 Pro Max.
  for (const [w, h] of [
    [375, 667],
    [393, 852],
    [440, 956],
  ]) {
    assert.equal(isPhoneScreen(w, h), true);
    assert.equal(isPhoneScreen(h, w), true);
  }
});

test('every iPad is not, including the smallest one', () => {
  // iPad mini (A17 Pro), iPad Pro 11", iPad Pro 13".
  for (const [w, h] of [
    [744, 1133],
    [834, 1210],
    [1032, 1376],
  ]) {
    assert.equal(isPhoneScreen(w, h), false);
    assert.equal(isPhoneScreen(h, w), false);
  }
});

test('the cut sits in the empty gap between the two families', () => {
  assert.equal(isPhoneScreen(499, 900), true);
  assert.equal(isPhoneScreen(500, 900), false);
});
