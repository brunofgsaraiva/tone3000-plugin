import * as Juce from '@juce-framework/webview';
import { isNativeFunctionRegistered } from './backend/JuceBackend';

/**
 * Space passthrough to the host DAW.
 *
 * The webview owns keyboard focus once the user interacts with the plugin,
 * so Space (the universal DAW play/stop shortcut) lands in web content and
 * either beeps or scrolls instead of reaching the transport. Any press
 * outside an editable or interactive element is swallowed here and handed
 * to the host via `forwardSpaceToHost` (plugin builds; in the dev browser
 * the suppression alone stops the beep/scroll).
 *
 * Interactive includes the chain tiles: dnd-kit marks them role="button",
 * and Space on a focused tile starts a keyboard drag (intentional, since it
 * requires tabbing to the tile first). Space with focus anywhere else still
 * reaches the transport.
 *
 * Installed only on the plugin UI's own origin: OAuth pages are remote
 * origins with no injected scripts, so they keep full keyboard behavior.
 */
export function installSpacePassthrough(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'Space') return;
      // Editable and interactive elements keep Space (typing in preset
      // names/search, activating a focused button).
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input, textarea, select, button, a[href], [contenteditable], [role="button"]'
        )
      ) {
        return;
      }
      // Leave keyboard drags alone (Space/Enter/Escape end them; a focus
      // change mid-gesture would cancel the drag).
      if (document.querySelector('[data-dnd-dragging]') != null) return;
      // Always suppress: stops the caret scroll / system beep even where
      // there is no host to forward to (standalone, dev browser).
      e.preventDefault();
      // Forward the initial press only; the native side resigns the
      // webview's keyboard focus, so genuine repeats go to the host
      // directly, and any stragglers here must not spam play/stop.
      if (e.repeat) return;
      if (isNativeFunctionRegistered('forwardSpaceToHost'))
        void Juce.getNativeFunction('forwardSpaceToHost')();
    },
    { capture: true }
  );
}
