/**
 * The pure predicate behind the first-launch gestures sheet, and the wording
 * table it renders. Plain `node --test`; Node strips the TypeScript types.
 *
 *   node --test ui/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GESTURE_RULES, shouldAutoOpenGestures } from '../src/components/gestureGuide.ts';

test('auto-opens once on a device that has never seen it', () => {
  assert.equal(shouldAutoOpenGestures(true, false), true);
});

test('never auto-opens again once the flag is stored', () => {
  assert.equal(shouldAutoOpenGestures(true, true), false);
});

test('never auto-opens off iOS, flag or not', () => {
  assert.equal(shouldAutoOpenGestures(false, false), false);
  assert.equal(shouldAutoOpenGestures(false, true), false);
});

test('every rule carries a glyph and one plain sentence', () => {
  assert.ok(GESTURE_RULES.length > 0);
  for (const rule of GESTURE_RULES) {
    assert.ok(rule.glyph.length > 0, 'glyph missing');
    assert.match(rule.text, /^[A-Z].*\.$/, `not a sentence: ${rule.text}`);
    // Guitarist language: no interface jargon leaks in from the rules table.
    assert.doesNotMatch(rule.text, /pointer|long press|dnd|pointerup/i, rule.text);
  }
});
