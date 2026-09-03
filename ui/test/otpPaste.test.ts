/**
 * The iOS one-time-code helper injected by EditorWebViewSetup.cpp.
 *
 * The script ships as a raw string inside the C++ so there is no module to
 * import; this test extracts that exact source between its markers and runs
 * it against a fake DOM small enough to live here. Testing the shipped
 * string, rather than a copy, is the point.
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
const source = cpp.split('// __T3K_OTP_HELPER_BEGIN__')[1]?.split('// __T3K_OTP_HELPER_END__')[0];
assert.ok(source, 'helper markers not found in EditorWebViewSetup.cpp');

/** Minimal DOM: inputs in one container, plus document-level capture
    listeners, which is all the helper touches. */
function makeDom(host: string, count: number) {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  class HTMLInputElement {
    tagName = 'INPUT';
    value = '';
    maxLength = 1;
    focused = false;
    attrs: Record<string, string> = { inputmode: 'numeric', type: 'text' };
    parentElement: any = null;
    getAttribute(n: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
    }
    setAttribute(n: string, v: string) {
      this.attrs[n] = v;
      if (n === 'maxlength') this.maxLength = Number(v);
    }
    hasAttribute(n: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, n);
    }
    focus() {
      this.focused = true;
    }
    dispatchEvent(e: any) {
      e.target = this;
      (listeners[e.type] || []).forEach((fn) => fn(e));
      return true;
    }
  }
  const boxes = Array.from({ length: count }, () => new HTMLInputElement());
  const container = { children: boxes };
  boxes.forEach((b) => (b.parentElement = container));
  const doc: any = {
    readyState: 'complete',
    documentElement: {},
    querySelectorAll: () => boxes,
    addEventListener: (t: string, fn: any) => ((listeners[t] ||= []).push(fn), undefined),
    dispatchEvent(e: any) {
      (listeners[e.type] || []).forEach((fn) => fn(e));
    },
  };
  const win: any = {
    HTMLInputElement,
    location: { hostname: host },
    document: doc,
    Event: class {
      type: string;
      target: any = null;
      defaultPrevented = false;
      constructor(type: string) {
        this.type = type;
      }
      preventDefault() {
        this.defaultPrevented = true;
      }
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn: any) => fn(),
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source!, win);
  return { win, boxes };
}

const paste = (win: any, box: any, text: string) => {
  const e = new win.Event('paste');
  e.target = box;
  e.clipboardData = { getData: () => text };
  win.document.dispatchEvent(e);
  return e;
};

const beforeInput = (win: any, box: any, data: string, inputType = 'insertText') => {
  const e = new win.Event('beforeinput');
  e.target = box;
  e.data = data;
  e.inputType = inputType;
  win.document.dispatchEvent(e);
  return e;
};

const typeInto = (win: any, box: any, text: string) => {
  box.value = text;
  const e = new win.Event('input');
  e.target = box;
  win.document.dispatchEvent(e);
};

const values = (boxes: any[]) => boxes.map((b) => b.value).join('');

test('paste of the whole code into box 1 fills all six', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  const e = paste(win, boxes[0], '123456');
  assert.equal(values(boxes), '123456');
  assert.equal(e.defaultPrevented, true);
  assert.equal(boxes[5].focused, true);
});

test('a single input event carrying the whole code (iOS autofill) fills all six', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  typeInto(win, boxes[0], '123456');
  assert.equal(values(boxes), '123456');
});

test('typing one digit still lands only in that box', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  typeInto(win, boxes[0], '1');
  typeInto(win, boxes[1], '2');
  assert.deepEqual(
    boxes.map((b) => b.value),
    ['1', '2', '', '', '', ''],
  );
});

test('a paste into the middle box fills from there', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  paste(win, boxes[2], '789');
  assert.deepEqual(
    boxes.map((b) => b.value),
    ['', '', '7', '8', '9', ''],
  );
});

test('the first box is marked so iOS offers the code suggestion', () => {
  const { boxes } = makeDom('www.tone3000.com', 6);
  assert.equal(boxes[0].getAttribute('autocomplete'), 'one-time-code');
  assert.equal(boxes[0].getAttribute('inputmode'), 'numeric');
  assert.equal(boxes[1].getAttribute('autocomplete'), null);
  // Relaxed so an autofill that never fires beforeinput is not clipped to
  // one character before we can see it.
  assert.equal(boxes[0].maxLength, 6);
});

// The keyboard's one-time-code suggestion: WebKit clips the insertion to
// maxlength before the input event, so beforeinput is the only place the
// whole code is still visible.
test('beforeinput carrying the whole code fills all six', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  const e = beforeInput(win, boxes[0], '123456');
  assert.equal(values(boxes), '123456');
  assert.equal(e.defaultPrevented, true);
});

test('beforeinput of a single digit is left to the page', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  const e = beforeInput(win, boxes[0], '7');
  assert.equal(e.defaultPrevented, false);
  assert.equal(values(boxes), '');
});

test('a deletion is never treated as a code', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  const e = beforeInput(win, boxes[0], '123456', 'deleteContentBackward');
  assert.equal(e.defaultPrevented, false);
});

// Belt and braces: an autofill that bypasses beforeinput lands whole in the
// relaxed first box, and the input path spreads it and restores maxlength.
test('an autofill landing whole in the relaxed first box is spread', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  assert.equal(boxes[0].maxLength, 6);
  typeInto(win, boxes[0], '123456');
  assert.equal(values(boxes), '123456');
  assert.equal(boxes[0].maxLength, 1);
});

test('the helper stays off any other host', () => {
  const { win, boxes } = makeDom('example.com', 6);
  assert.equal(win.__t3kOtpHelper, undefined);
  paste(win, boxes[0], '123456');
  assert.equal(values(boxes), '');
});

test('non-digit clipboard content is left to the page', () => {
  const { win, boxes } = makeDom('www.tone3000.com', 6);
  const e = paste(win, boxes[0], 'hello');
  assert.equal(values(boxes), '');
  assert.equal(e.defaultPrevented, false);
});
