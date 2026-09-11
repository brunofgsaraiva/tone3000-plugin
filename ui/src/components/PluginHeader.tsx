import React from 'react';
import { IS_PHONE, rem } from '../hooks/useUiScale';
import { Undo2, Redo2 } from './icons';
import { AccountMenu } from './AccountMenu';
import { IconButton } from './IconButton';
import { PresetBar } from './PresetBar';
import { StereoModeToggle } from './StereoModeToggle';
import { HELP } from './helpText';
import { BORDER } from './theme';
import type { usePresets } from '../hooks/usePresets';
import type { ActivePreset } from '../types/chain';
import type { User } from '../types/tone';

type PresetStore = ReturnType<typeof usePresets>;

/** Top bar height in design px. The phone runs a shorter one and scales the
    bar's own content with it (smaller mark, narrower preset pill), so the 16
    design px it gives up go to the chain lane instead (see useUiScale /
    IS_PHONE). Same controls, same order, on both. */
const HEADER_HEIGHT = 64;
const HEADER_HEIGHT_PHONE = 48;
const headerHeight = (): number => (IS_PHONE ? HEADER_HEIGHT_PHONE : HEADER_HEIGHT);
/** The T3K wordmark, 210:32, so the phone's is 18 design px tall. */
const MARK_WIDTH = 160;
const MARK_WIDTH_PHONE = 116;
/** Gap between header items; tight pairs (undo/redo) group inside. */
const ITEM_GAP = 40;
const ITEM_GAP_PHONE = 22;

// Lucide has no tuning fork, so this mimics its 24x24 stroke style.
const TuningForkIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: rem(size), height: rem(size) }}
  >
    <path d="M8 3v7a4 4 0 0 0 8 0V3" />
    <line x1="12" y1="14" x2="12" y2="21" />
  </svg>
);

interface PluginHeaderProps {
  presetStore: PresetStore;
  activePreset: ActivePreset | null;
  /** Greys out the preset bar's New button (see PresetBar). */
  atDefault: boolean;
  onReset: () => void;
  stereoEnabled: boolean;
  onStereoToggle: (enabled: boolean) => void;
  showTuner: boolean;
  onToggleTuner: (show: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  user: User | null;
  authenticated: boolean;
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

/**
 * Full-width top bar: logo, preset controls, stereo toggle, tuner, undo/redo
 * and the account menu. Memoized because Plugin re-renders on every chain
 * poll tick while nothing up here changes.
 */
export const PluginHeader = React.memo(function PluginHeader({
  presetStore,
  activePreset,
  atDefault,
  onReset,
  stereoEnabled,
  onStereoToggle,
  showTuner,
  onToggleTuner,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  user,
  authenticated,
  onOpenSettings,
  onLogin,
  onLogout,
}: PluginHeaderProps) {
  return (
    <div
      style={{
        width: '100%',
        height: `${headerHeight()}rem`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#000000',
        padding: '0 24rem',
        boxSizing: 'border-box',
        borderBottom: BORDER,
      }}
    >
      <a
        href="https://www.tone3000.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16rem' }}
      >
        <img
          src="/t3k.svg"
          alt="T3K"
          style={{ width: rem(IS_PHONE ? MARK_WIDTH_PHONE : MARK_WIDTH) }}
        />
      </a>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: rem(IS_PHONE ? ITEM_GAP_PHONE : ITEM_GAP),
        }}
      >
        <PresetBar
          active={activePreset}
          presets={presetStore.presets}
          atDefault={atDefault}
          onSave={presetStore.actions.save}
          onLoad={presetStore.actions.load}
          onRename={presetStore.actions.rename}
          onDelete={presetStore.actions.remove}
          onMove={presetStore.actions.move}
          onReset={onReset}
        />
        <StereoModeToggle stereoEnabled={stereoEnabled} onToggle={onStereoToggle} />
        <IconButton
          onClick={() => onToggleTuner(!showTuner)}
          help={HELP.tuner}
          active={showTuner}
          fillWhenActive
          size={28}
        >
          <TuningForkIcon size={18} />
        </IconButton>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16rem' }}>
          <IconButton onClick={onUndo} disabled={!canUndo} help={HELP.undo} size={28}>
            <Undo2 size={18} />
          </IconButton>
          <IconButton onClick={onRedo} disabled={!canRedo} help={HELP.redo} size={28}>
            <Redo2 size={18} />
          </IconButton>
        </div>
        <AccountMenu
          user={user}
          authenticated={authenticated}
          onOpenSettings={onOpenSettings}
          onLogin={onLogin}
          onLogout={onLogout}
        />
      </div>
    </div>
  );
});
