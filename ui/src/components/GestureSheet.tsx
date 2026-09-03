import React, { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  ChevronDown,
  Ellipsis,
  Equal,
  File,
  Hand,
  Plus,
  RotateCcw,
  X as XIcon,
} from './icons';
import { GESTURE_RULES, type GestureGlyph } from './gestureGuide';
import { setGesturesSeen, useGesturesSeen } from './uiPreferences';
import { ToggleRow } from './controls';
import { MUTED } from './theme';

/**
 * iPad only: one scrollable sheet listing the touch gestures in the player's
 * own language. It explains, it does not replace anything: every gesture in
 * the list also has a visible control, per the HIG.
 *
 * Same shell as Settings (black takeover, X in the header, swipe down to
 * dismiss, which Plugin wires) so dismissing it needs nothing new to learn.
 */

const GLYPHS: Record<GestureGlyph, React.FC<{ size?: number }>> = {
  plus: Plus,
  grip: Hand,
  menu: Ellipsis,
  swipe: ArrowLeftRight,
  knob: ArrowUpDown,
  reset: RotateCcw,
  deck: Equal,
  back: ArrowLeft,
  down: ChevronDown,
  files: File,
};

const GestureSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const seen = useGesturesSeen();

  // Seen on open, not on close: a sheet the player swiped away or killed the
  // app on has still been shown, and must not come back by itself.
  useEffect(() => setGesturesSeen(true), []);

  return (
    <div
      className="hide-scrollbar"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000000',
        zIndex: 2000,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          maxWidth: '480rem',
          margin: '0 auto',
          padding: '28rem 24rem 40rem',
          color: '#ffffff',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20rem',
          }}
        >
          <span style={{ fontSize: '22rem', fontWeight: 600 }}>Gestures</span>
          <button
            onClick={onClose}
            aria-label="Close gestures"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4rem',
            }}
          >
            <XIcon size={20} />
          </button>
        </div>

        <p style={{ fontSize: '14rem', fontWeight: 400, color: MUTED, margin: '0 0 24rem' }}>
          Every one of these also has a button on screen. These are the shortcuts.
        </p>

        <ul style={{ listStyle: 'none', margin: '0 0 32rem', padding: 0 }}>
          {GESTURE_RULES.map((rule) => {
            const Glyph = GLYPHS[rule.glyph];
            return (
              <li
                key={rule.text}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14rem',
                  padding: '12rem 0',
                }}
              >
                <span style={{ flexShrink: 0, display: 'flex', paddingTop: '1rem' }}>
                  <Glyph size={20} />
                </span>
                <span style={{ fontSize: '15rem', fontWeight: 400, lineHeight: 1.45 }}>
                  {rule.text}
                </span>
              </li>
            );
          })}
        </ul>

        <ToggleRow
          label="Show on next launch"
          description="Open this list again the next time the app starts."
          value={!seen}
          onChange={(show) => setGesturesSeen(!show)}
          flush
        />
      </div>
    </div>
  );
};

export default GestureSheet;
