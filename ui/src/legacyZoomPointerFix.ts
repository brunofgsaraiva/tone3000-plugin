import { DESIGN_WIDTH } from './hooks/useUiScale';

/**
 * Reconciles pointer coordinates with element geometry under CSS `zoom` on
 * legacy-zoom engines (WKWebView on current macOS).
 *
 * Those engines report MouseEvent client/page coordinates in visual (zoomed)
 * pixels while getBoundingClientRect() for content inside the zoom root
 * stays in unzoomed layout pixels: at 1.39x, grabbing the left edge of a
 * tile whose rect starts at x=373 reports clientX=519. Anything comparing
 * pointer positions with rects (dnd-kit's drag tracking and drop-target
 * hit-testing above all) then drifts by the zoom factor.
 *
 * The whole UI lives inside the zoom root (useUiScale) and works in layout
 * px, so the boundary fix is to report pointer coordinates in layout px too:
 * divide by the current zoom. Engines with standardized CSS zoom (Chromium
 * 128+/WebView2, trunk WebKit) report both sides in visual px consistently
 * and are left untouched, as are the OAuth pages (remote origins; this
 * script never runs there).
 */
export function installLegacyZoomPointerFix(): void {
  if (!usesLegacyZoom()) return;

  // Same scale the UI applies (useUiScale): on legacy engines the <html>
  // element sits outside the zoom root, so its clientWidth is the real
  // (visual) viewport width.
  const zoom = () => Math.max(1, document.documentElement.clientWidth / DESIGN_WIDTH);

  for (const prop of ['clientX', 'clientY', 'pageX', 'pageY'] as const) {
    const base = Object.getOwnPropertyDescriptor(MouseEvent.prototype, prop);
    const get = base?.get;
    if (base == null || get == null) continue;
    Object.defineProperty(MouseEvent.prototype, prop, {
      ...base,
      get(this: MouseEvent): number {
        return (get.call(this) as number) / zoom();
      },
    });
  }
}

/** True when this engine keeps rects inside a zoomed subtree in unzoomed
    layout coordinates (legacy zoom). Standardized zoom scales them. */
function usesLegacyZoom(): boolean {
  const host = document.createElement('div');
  host.style.zoom = '2';
  host.style.position = 'absolute';
  host.style.visibility = 'hidden';
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.top = '50px';
  probe.style.width = '10px';
  probe.style.height = '10px';
  host.appendChild(probe);
  document.body.appendChild(host);
  const top = probe.getBoundingClientRect().top;
  host.remove();
  // Legacy engines report the raw 50; standardized ones scale it to 100.
  return top < 75;
}
