import React from 'react';
import { X } from './icons';
import { HELP, helpProps, setHintsEnabled, useHelpText, useHintsEnabled } from './helpText';
import { useCpuPercent } from '../hooks/useMeters';
import { IS_PHONE } from '../hooks/useUiScale';
import { BORDER, MUTED, WHITE } from './theme';

/** Chrome height added below the plugin when hints are enabled (see Plugin). */
export const HINT_HEIGHT = 36;
/** Phone strip: 10 design px go back to the chain lane (see useUiScale /
    IS_PHONE). The row still holds a 13px hint line, the CPU readout and the
    close button; only the slack around them is gone. */
const HINT_HEIGHT_PHONE = 26;

/** Live hint-strip height in design px. HINT_HEIGHT stays the design
    constant for every non-phone code path. */
export const hintHeight = (): number => (IS_PHONE ? HINT_HEIGHT_PHONE : HINT_HEIGHT);

/** Audio-callback load. Tabular numerals + a fixed-width value slot so the
    row doesn't shimmy as digits change. */
const CpuReadout: React.FC = () => {
  const cpu = useCpuPercent();
  return (
    <span
      {...helpProps(HELP.cpuLoad)}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'center',
        gap: '6rem',
        // Fixed footprint sized for the widest value ("100.0%") so digit
        // count changes never shift the row; the pair stays centered with a
        // normal gap instead of a right-aligned value slot.
        minWidth: '72rem',
        fontSize: '12rem',
        fontWeight: 400,
        color: MUTED,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        cursor: 'default',
      }}
    >
      <span>CPU</span>
      <span>{cpu.toFixed(1)}%</span>
    </span>
  );
};

/**
 * Dedicated hint strip under the faceplate: black (so it reads as chrome, not
 * part of the plate) and always present while hints are enabled, so showing a
 * hint never shifts layout. Like the banner, it grows the window rather than
 * eating into the plugin: Plugin adds HINT_HEIGHT to the window height.
 * The right side carries the CPU readout; the × hides the bar entirely, and
 * the Settings "Info Bar" toggle brings it back.
 */
export const HintBar: React.FC = () => {
  const enabled = useHintsEnabled();
  const text = useHelpText();
  if (!enabled) return null;

  return (
    <div
      style={{
        width: '100%',
        height: `${hintHeight()}rem`,
        display: 'flex',
        alignItems: 'center',
        gap: '16rem',
        flexShrink: 0,
        borderTop: BORDER,
        background: '#000000',
        padding: '0 24rem',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '13rem',
          // Hint sentences are body text: reset the global 600 default.
          fontWeight: 400,
          lineHeight: 1.35,
          color: MUTED,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {text ?? ''}
      </span>
      <CpuReadout />
      <button
        onClick={() => setHintsEnabled(false)}
        {...helpProps(HELP.hideHints)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: WHITE,
          cursor: 'pointer',
          padding: '2rem',
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
};
