import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeftRight, ClipboardPaste, Copy, PlusCircle, Power, Trash2 } from 'lucide-react';
import { BlockEnergyBorder, BlockLed } from './BlockLed';
import { ToneImage } from './GearIcon';
import { LoadingDots } from './LoadingDots';
import { RetryLoadBadge } from './RetryLoadBadge';
import { meterId } from '../hooks/useMeters';
import { useChainActions } from '../hooks/useChainActions';
import { HELP, helpProps, toneTileHelp } from './helpText';
import type { ChainItem, ToneBlock } from '../types/chain';
import { isInsertSlot } from '../types/chain';
import { ChromeIconButton } from './ChromeIconButton';
import { TileMenu } from './TileMenu';
import type { TileMenuAnchor } from './TileMenu';
import { copyBlock } from '../hooks/useBlockClipboard';
import { useToast } from './Toast';
import { HIGHLIGHT, ICON_SIZE, SURFACE, SURFACE_RAISED } from './theme';

/**
 * Gallery view of a chain block: a square tone image with quick actions
 * (power / swap / trash) overlaid along the top edge and a simplified
 * horizontal output level + clip strip along the bottom. Tap/click opens
 * the detail card; dragging the tile reorders it.
 *
 * The full visual surface (TileSurface) is shared between the sortable tile
 * and the DragOverlay ghost, so the copy that follows the pointer during a
 * drag looks identical to the resting tile, just semi-transparent.
 */

/** Opacity of the moving copy while dragging (matches the old chain). */
const DRAG_GHOST_OPACITY = 0.75;

/** Keep tile buttons from taking focus on press: the webview scrolls the
    focused element into view, which nudges the whole lane by a pixel. */
const preventFocus = (e: React.MouseEvent) => e.preventDefault();

/** Right-click → tile-local anchor for the tile's action sheet (suppresses
    the OS context menu; macOS ctrl-click lands here too). Ctrl-click also
    fires a synthetic `click` after `contextmenu`; `shouldIgnoreClick`
    swallows that so the tile doesn't navigate away under the menu. */
const useTileMenu = () => {
  const [menuAnchor, setMenuAnchor] = useState<TileMenuAnchor | null>(null);
  const suppressClickRef = useRef(false);
  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = true;
    // Viewport coords: TileMenu portals to body (outside the CSS-zoom root)
    // and positions with position:fixed, so no layout-space conversion.
    setMenuAnchor({ clientX: e.clientX, clientY: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  /** True when a tile click should be ignored (followed a contextmenu, is a
      modifier-click, or the menu is already open, in which case it closes). */
  const shouldIgnoreClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return true;
      }
      if (e.ctrlKey || e.metaKey) return true;
      if (menuAnchor) {
        closeMenu();
        return true;
      }
      return false;
    },
    [menuAnchor, closeMenu]
  );
  return { menuAnchor, openMenu, closeMenu, shouldIgnoreClick };
};

/** Interactive wiring for a tile's chrome; omitted for the drag ghost. */
interface TileActions {
  onOpen: (e: React.MouseEvent) => void;
  onTogglePower: (e: React.MouseEvent) => void;
  onSwap: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
  /** Retry a failed model download (shown when block.loadFailed). */
  onRetryLoad: () => void;
  /** useSortable attributes + listeners for the whole tile (press+move to drag). */
  sortable: React.HTMLAttributes<HTMLElement>;
}

/**
 * The complete tile visual: artwork, loading scrim, top action strip and
 * bottom meter. Rendered inert (no handlers) inside the DragOverlay so the
 * moving copy matches the resting tile exactly.
 */
const TileSurface: React.FC<{
  block: ToneBlock;
  size: number;
  enabled: boolean;
  actions?: TileActions;
}> = ({ block, size, enabled, actions }) => {
  const { blockId, tone } = block;

  // A model download/prepare is in flight: `modelLoading` covers switches
  // (where the previous model keeps playing, so `loaded` stays true) and
  // `!loaded` covers fresh blocks that have nothing to play yet.
  const busy = block.modelLoading || (!block.loaded && !block.loadFailed);
  const outMeterId = meterId.blockOut(blockId);

  return (
    // Outer shell stays overflow-visible so inset energy glow isn't needed
    // outside the tile; kept for a stable size box around the face.
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        // Header reveals on :hover via CSS (see index.css), since JS hover state
        // dies across drag re-renders. The inert drag ghost pins it visible.
        className={actions ? 'gallery-tile' : 'gallery-tile tile-chrome-visible'}
        onClick={actions?.onOpen}
        // Sortable listeners live on the whole tile face (press+move to drag).
        {...(actions?.sortable ?? {})}
        // The inert drag ghost skips help: it rides under the pointer, so its
        // hover events would pin the hint for the whole drag.
        {...(actions ? helpProps(toneTileHelp(tone.title)) : {})}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '12px',
          backgroundColor: SURFACE,
          position: 'relative',
          overflow: 'hidden',
          cursor: actions ? 'pointer' : 'grabbing',
          boxSizing: 'border-box',
          // Touch drags: without this, touch devices claim the gesture for
          // lane scrolling and pointercancel kills the drag instantly. Drag
          // wins on the tile face; lanes still pan from the gaps around it.
          touchAction: 'none',
        }}
      >
        {/* Tone image (dimmed while powered off, loading, or failed) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: enabled && !busy && !block.loadFailed ? 1 : 0.35,
            transition: 'opacity 0.2s ease',
          }}
        >
          <ToneImage
            src={tone.images?.[0]}
            alt={tone.title}
            gear={tone.gear}
            local={tone.local}
            boxSize={size}
            draggable={false}
          />
        </div>

        {/* Busy dots while the model downloads natively; if the download
            failed, a retry affordance instead (dots would spin forever). */}
        {(busy || block.loadFailed) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Clicks pass through to the tile except on the retry button.
              pointerEvents: 'none',
            }}
          >
            {block.loadFailed && actions ? (
              <div style={{ pointerEvents: 'auto' }}>
                <RetryLoadBadge onRetry={actions.onRetryLoad} />
              </div>
            ) : (
              !block.loadFailed && <LoadingDots />
            )}
          </div>
        )}

        {/* Translucent strip under the quick actions so they read on any art.
            Fades in with the header (opacity only, never a layout change). */}
        <div
          className="tile-chrome"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '32px',
            background: 'rgba(0, 0, 0, 0.35)',
            pointerEvents: 'none',
          }}
        />

        {/* Top quick-action bar (hover-revealed): power on the left, swap and
            trash clustered on the right. */}
        <div
          className="tile-chrome"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px',
          }}
        >
          <ChromeIconButton
            tone="power"
            on={enabled}
            help={HELP.blockPower}
            onClick={(e) => actions?.onTogglePower(e)}
            onMouseDown={preventFocus}
            style={{ pointerEvents: actions ? undefined : 'none' }}
          >
            <Power size={ICON_SIZE} />
          </ChromeIconButton>
          <div style={{ display: 'flex', gap: '16px' }}>
            <ChromeIconButton
              help={HELP.swapTone}
              onClick={(e) => actions?.onSwap(e)}
              onMouseDown={preventFocus}
              style={{ pointerEvents: actions ? undefined : 'none' }}
            >
              <ArrowLeftRight size={ICON_SIZE} />
            </ChromeIconButton>
            <ChromeIconButton
              help={HELP.removeBlock}
              onClick={(e) => actions?.onRemove(e)}
              onMouseDown={preventFocus}
              style={{ pointerEvents: actions ? undefined : 'none' }}
            >
              <Trash2 size={ICON_SIZE} />
            </ChromeIconButton>
          </div>
        </div>

        {/* Clip latch lives outside the overflow:hidden face so it stacks
            above the inset glow; red dot only while clipped. */}
      </div>

      <BlockEnergyBorder meterId={outMeterId} borderRadius={12} />
      <div style={{ position: 'absolute', bottom: '8px', right: '8px', zIndex: 4 }}>
        <BlockLed meterId={outMeterId} size={10} />
      </div>
    </div>
  );
};

interface GalleryBlockProps {
  block: ToneBlock;
  /** Tile edge, px. */
  size: number;
  /** Open the detail takeover for this block. */
  onOpen: (blockId: string) => void;
}

/** Memoized so a lane re-render (e.g. another tile's optimistic state) only
    reaches tiles whose block snapshot actually changed. Mutations come from
    the ChainActions context, so there are no per-render callback props to
    defeat the memo. */
export const GalleryBlock: React.FC<GalleryBlockProps> = React.memo(({ block, size, onOpen }) => {
  const { blockId, params } = block;
  const actions = useChainActions();
  const { menuAnchor, openMenu, closeMenu, shouldIgnoreClick } = useTileMenu();

  // Optimistic power state; native converges via the chainChanged resync
  // (same pattern as the detail card).
  const [enabled, setEnabled] = useState(params.enabled);
  useEffect(() => setEnabled(params.enabled), [params.enabled]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: blockId,
  });

  const handleTogglePower = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEnabled((prev) => {
        actions.setBlockParam(blockId, 'enabled', !prev);
        return !prev;
      });
    },
    [actions, blockId]
  );

  return (
    <div
      ref={setNodeRef}
      onContextMenu={openMenu}
      style={{
        // Translate only (no scale); scale transforms cause subpixel jitter
        // on the overlaid controls.
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        // The DragOverlay ghost is the moving copy; hiding the original
        // reveals the plus-circle rail behind the vacated slot.
        opacity: isDragging ? 0 : 1,
        flexShrink: 0,
        position: 'relative',
        // Above the neighboring tiles while the action sheet is up.
        zIndex: menuAnchor ? 5 : undefined,
      }}
    >
      <TileSurface
        block={block}
        size={size}
        enabled={enabled}
        actions={{
          onOpen: (e) => {
            if (shouldIgnoreClick(e)) return;
            onOpen(blockId);
          },
          onTogglePower: handleTogglePower,
          onSwap: (e) => {
            e.stopPropagation();
            actions.swapBlock(blockId);
          },
          onRemove: (e) => {
            e.stopPropagation();
            actions.removeBlock(blockId);
          },
          onRetryLoad: () => actions.retryLoad(blockId),
          sortable: { ...attributes, ...listeners },
        }}
      />
      {menuAnchor && (
        <TileMenu
          anchor={menuAnchor}
          onClose={closeMenu}
          items={[
            {
              label: 'Copy',
              icon: <Copy size={16} />,
              help: HELP.copyBlock,
              onSelect: () => copyBlock(blockId),
            },
          ]}
        />
      )}
    </div>
  );
});
GalleryBlock.displayName = 'GalleryBlock';

/** Radius of the PlusCircle glyph; routing lines run edge-to-circle. */
const PLUS_CIRCLE_RADIUS = 20;

/** Which tile edges get a routing line into the plus circle (signal-flow
    continuation of the lane's connector lines). */
export type AddTileRouting = 'left' | 'right' | 'both' | 'none';

/** Shared face of the insert slot tile (also used by the drag ghost). */
const addTileFaceStyle = (size: number): React.CSSProperties => ({
  width: `${size}px`,
  height: `${size}px`,
  borderRadius: '12px',
  backgroundColor: SURFACE_RAISED,
  // https://kovart.github.io/dashed-border-generator/
  backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='12' ry='12' stroke='%238D8D93FF' stroke-width='2' stroke-dasharray='6%2c 10' stroke-dashoffset='9' stroke-linecap='square'/%3e%3c/svg%3e")`,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  flexShrink: 0,
  boxSizing: 'border-box',
});

interface AddTileProps {
  /** Insert slot block id. */
  id: string;
  size: number;
  routing: AddTileRouting;
  onClick: () => void;
  /** Paste the copied block into this slot; null while there's nothing valid
      to paste (the action sheet shows Paste disabled). */
  onPaste?: (() => void) | null;
}

/** The insert slot as a dashed add tile, sortable so the insert point can be
    repositioned within its lane, like any other block. Routing lines continue
    the lane's connector line through to the plus circle. Also the drop zone
    for local .nam / IR .wav files (loaded natively, no browser flow). */
export const AddTile: React.FC<AddTileProps> = ({ id, size, routing, onClick, onPaste = null }) => {
  const { menuAnchor, openMenu, closeMenu, shouldIgnoreClick } = useTileMenu();
  const actions = useChainActions();
  const toast = useToast();
  // True while an OS file drag hovers the tile (drop-target highlight).
  const [dropArmed, setDropArmed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  // The global drop swallow (main.tsx) only stops the webview navigating
  // away; accepting the drop here still needs the dragover cancelled with
  // the file-copy effect, or the OS shows a rejection cursor.
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropArmed(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropArmed(false);
    // The item (not files[0]): folders only surface through the entry API.
    const item = e.dataTransfer.items[0];
    if (!item) return;
    const error = await actions.loadLocalFile(id, item);
    if (error) toast.show(error);
  };

  const routingLine = (edge: 'left' | 'right') => (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        [edge]: 0,
        width: `${size / 2 - PLUS_CIRCLE_RADIUS}px`,
        height: '1px',
        backgroundColor: '#ffffff',
      }}
    />
  );

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        if (shouldIgnoreClick(e)) return;
        onClick();
      }}
      onContextMenu={openMenu}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropArmed(false)}
      onDrop={handleDrop}
      {...attributes}
      {...listeners}
      {...helpProps(HELP.addTile)}
      style={{
        ...addTileFaceStyle(size),
        backgroundColor: dropArmed ? HIGHLIGHT : SURFACE_RAISED,
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        opacity: isDragging ? 0 : 1,
        cursor: 'pointer',
        // Touch drags need the gesture (see the tone tile face).
        touchAction: 'none',
        // Above the neighboring tiles while the action sheet is up.
        zIndex: menuAnchor ? 5 : undefined,
      }}
    >
      {!isDragging && (routing === 'left' || routing === 'both') && routingLine('left')}
      {!isDragging && (routing === 'right' || routing === 'both') && routingLine('right')}
      <PlusCircle size={40} strokeWidth={1} />
      {menuAnchor && (
        <TileMenu
          anchor={menuAnchor}
          onClose={closeMenu}
          items={[
            {
              label: 'Paste',
              icon: <ClipboardPaste size={16} />,
              help: HELP.pasteBlock,
              disabled: onPaste == null,
              onSelect: () => onPaste?.(),
            },
          ]}
        />
      )}
    </div>
  );
};

/** Tile clone for the DragOverlay: the full tile surface at reduced opacity
    (identical chrome, dimmed like the old chain's dragged card), following
    the pointer so drags can cross lanes without being clipped by the lane's
    overflow. */
export const GalleryTileGhost: React.FC<{
  item: ChainItem;
  size: number;
}> = ({ item, size }) => {
  if (isInsertSlot(item)) {
    return (
      <div style={{ ...addTileFaceStyle(size), opacity: DRAG_GHOST_OPACITY, cursor: 'grabbing' }}>
        <PlusCircle size={40} strokeWidth={1} />
      </div>
    );
  }

  return (
    <div style={{ opacity: DRAG_GHOST_OPACITY, cursor: 'grabbing' }}>
      <TileSurface block={item} size={size} enabled={item.params.enabled} />
    </div>
  );
};
