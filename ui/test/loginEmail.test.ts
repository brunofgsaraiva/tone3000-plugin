/**
 * The iOS login-email capture injected by EditorWebViewSetup.cpp.
 *
 * GET /api/v1/user never returns an email, so the sign-in page itself is the
 * only place the address exists. The script ships as a raw string inside the
 * C++; like otpPaste.test.ts, this extracts that exact source between its
 * markers and runs it against a fake DOM, so the test cannot drift from what
 * ships.
 *
 *   node --test ui/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const cppPath = fileURLToPath(new URL('../../plugin/src/EditorWebViewSetup.cpp', import.meta.url));
const cpp = readFileSync(cppPath, 'utf8');
const source = cpp
  .split('// __T3K_LOGIN_EMAIL_BEGIN__')[1]
  ?.split('// __T3K_LOGIN_EMAIL_END__')[0];
assert.ok(source, 'login email markers not found in EditorWebViewSetup.cpp');

/** Minimal DOM: a flat list of inputs matched by a stub selector engine,
    plus the JUCE bridge fallback the script posts through. */
function makeDom(host: string, inputs: { type?: string; name?: string; value: string }[]) {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const sent: any[] = [];
  const match = (i: any, sel: string) =>
    (sel === 'input[type=email]' && i.type === 'email') ||
    (sel === 'input[name=email]' && i.name === 'email');
  const query = (list: any[]) => (sel: string) =>
    sel
      .split(',')
      .map((s) => s.trim())
      .flatMap((s) => list.filter((i) => match(i, s)))
      .filter((i, idx, a) => a.indexOf(i) === idx);
  const doc: any = {
    readyState: 'complete',
    documentElement: {},
    querySelectorAll: query(inputs),
    addEventListener: (t: string, fn: any) => ((listeners[t] ||= []).push(fn), undefined),
    dispatchEvent(e: any) {
      (listeners[e.type] || []).forEach((fn) => fn(e));
    },
  };
  const win: any = {
    location: { hostname: host },
    document: doc,
    console: { log: () => {} },
    JSON,
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn: any) => fn(),
    __JUCE__: {
      postMessage: (json: string) => sent.push(JSON.parse(json).payload),
    },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source!, win);
  return { win, doc, sent, query };
}

const submit = (win: any, doc: any, form: any) => {
  const e: any = { type: 'submit', target: form };
  doc.dispatchEvent(e);
};

test('the address typed on the sign-in form is sent to native on submit', () => {
  const inputs = [{ type: 'email', value: '' }];
  const { win, doc, sent, query } = makeDom('www.tone3000.com', inputs);
  inputs[0].value = 'player@example.com';
  submit(win, doc, { querySelectorAll: query(inputs) });
  assert.deepEqual(sent, [{ name: 'setLoginEmail', params: ['player@example.com'], resultId: -1 }]);
});

test('the hidden field on the code step is picked up without a submit', () => {
  // The script scans once at start-up, which is the path the MutationObserver
  // re-runs after the code form renders.
  const { sent } = makeDom('www.tone3000.com', [{ name: 'email', value: 'player@example.com' }]);
  assert.deepEqual(sent, [{ name: 'setLoginEmail', params: ['player@example.com'], resultId: -1 }]);
});

test('the same address is not sent twice', () => {
  const inputs = [{ name: 'email', value: 'player@example.com' }];
  const { win, doc, sent, query } = makeDom('www.tone3000.com', inputs);
  submit(win, doc, { querySelectorAll: query(inputs) });
  assert.equal(sent.length, 1);
});

test('anything that is not an address is dropped', () => {
  for (const value of ['', 'not-an-email', 'a@b', 'two words@x.com', '@x.com']) {
    const { sent } = makeDom('www.tone3000.com', [{ type: 'email', value }]);
    assert.deepEqual(sent, [], `sent for ${JSON.stringify(value)}`);
  }
});

test('the capture stays off any other host', () => {
  const { win, sent } = makeDom('example.com', [{ type: 'email', value: 'player@example.com' }]);
  assert.equal(win.__t3kLoginEmail, undefined);
  assert.deepEqual(sent, []);
});
