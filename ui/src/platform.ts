/**
 * Platform predicates with no window behind them, so the rule itself can be
 * unit tested (see ui/test/platform.test.ts). The live flags built on top of
 * these live in hooks/useUiScale.ts, which reads the real screen.
 */

/** Shorter screen side, in CSS px, that separates a phone from a tablet.
    An iPhone 17 Pro is 402 px across, an iPhone SE 375; the smallest iPad
    (mini) is 744. Anything in that gap splits the two cleanly and needs no
    device list to keep up to date. */
export const PHONE_MAX_SHORT_SIDE = 500;

/**
 * True for a phone-sized screen. Orientation independent on purpose: the app
 * is landscape locked, but iOS reports `screen.width`/`screen.height` in the
 * device's natural (portrait) orientation anyway, so the shorter side is the
 * only term that means the same thing in both.
 */
export const isPhoneScreen = (width: number, height: number): boolean =>
  Math.min(width, height) < PHONE_MAX_SHORT_SIDE;
