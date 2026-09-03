/**
 * The shipped wording of the iPad touch rules, in guitarist language.
 *
 * One source of truth: the table in `docs/ios.md` documents the same rules for
 * maintainers and points here for the text the app actually shows, so a rule
 * is never reworded in only one of the two places. Nothing here is
 * platform-specific code, so it stays importable (and testable) everywhere;
 * only the sheet that renders it is gated on IS_IOS.
 */

/** Which glyph a row draws. The sheet maps these to icons; keeping the ids
    here (rather than components) leaves this module free of JSX and React. */
export type GestureGlyph =
  | 'plus'
  | 'grip'
  | 'menu'
  | 'swipe'
  | 'knob'
  | 'reset'
  | 'deck'
  | 'back'
  | 'down'
  | 'files';

export interface GestureRule {
  glyph: GestureGlyph;
  /** One sentence, sentence case, no jargon ("pointer", "long press"). */
  text: string;
}

export const GESTURE_RULES: GestureRule[] = [
  { glyph: 'plus', text: 'Tap a "+" slot to pick a tone for it.' },
  { glyph: 'grip', text: 'Hold a tile to lift it, then drag to reorder your chain.' },
  {
    glyph: 'menu',
    text: 'Release without moving to open the tile menu, or use its "..." button.',
  },
  { glyph: 'swipe', text: 'Swipe across the tiles to scroll along the chain.' },
  { glyph: 'knob', text: 'Drag a knob up or down to set it.' },
  { glyph: 'reset', text: 'Double tap a knob to put it back to default.' },
  { glyph: 'deck', text: 'Hold Spread or Align to open the advanced deck.' },
  { glyph: 'back', text: 'Swipe in from the left edge to go back a screen.' },
  { glyph: 'down', text: 'Swipe down to close Settings or the Tuner.' },
  { glyph: 'files', text: 'Load files in Select Tone to play your own .nam and IR files.' },
];

/**
 * Whether the gestures sheet opens by itself. True only on iOS, and only
 * until the sheet has been seen once on this device (the flag lives in the
 * webview's localStorage, see uiPreferences). Pure so it can be tested
 * without a webview.
 */
export const shouldAutoOpenGestures = (isIos: boolean, seen: boolean): boolean => isIos && !seen;
