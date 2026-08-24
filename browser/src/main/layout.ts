/**
 * Pure bounds math for the three-view layout. Kept separate from
 * WindowManager so the arithmetic can be read (and changed) without
 * wading through Electron view-management code.
 *
 *   +----------------------------------------+
 *   |               chrome view               |  <- CHROME_HEIGHT tall, full width
 *   +---------------------------+--------------+
 *   |                           |              |
 *   |        page view          |  chat view   |  <- CHAT_WIDTH wide, only when open
 *   |                           |              |
 *   +---------------------------+--------------+
 */

export const CHROME_HEIGHT = 92;
export const CHAT_WIDTH = 340;
/** Extra height reserved below the toolbar for the find-in-page bar. */
export const FIND_BAR_HEIGHT = 44;
/** Extra height reserved below the toolbar while a toolbar popover (the
 * bookmark star's "bookmark added" bubble, the subtitles button's
 * language/agent picker, the address bar's autocomplete dropdown) is open -
 * same "grow chrome, push page down" idea as the find bar, sized to
 * comfortably fit a popover bubble instead of a full-width strip. Shared
 * by every toolbar popover rather than tracked per-popover since only one
 * is ever open at a time. Sized for the tallest of the three - up to
 * MAX_SUGGESTIONS rows in the address bar dropdown (see Toolbar.tsx) -
 * confirmed by hand: without enough room here, the dropdown's own DOM
 * renders fine (queryable, has real content) but is invisibly clipped,
 * since it's the native chrome view's own bounds that don't extend far
 * enough for anything past them to ever paint, regardless of what CSS
 * position:absolute says. */
export const TOOLBAR_POPOVER_HEIGHT = 320;
/** Height of the subtitle overlay strip, anchored to the bottom of
 * whatever the page view's current bounds are (so it still sits over the
 * video in browserFullscreen, not just normal layout). */
export const SUBTITLE_HEIGHT = 110;

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  chrome: ViewBounds;
  page: ViewBounds;
  chat: ViewBounds;
  /** Bottom strip of `page` - only meaningful while the subtitle overlay
   * view is actually attached (see WindowManager.syncSubtitleOverlay). */
  subtitle: ViewBounds;
}

/**
 * Computes bounds for all three views from the window's content size.
 * Called on every resize, and on every tick while the chat panel is
 * sliding open/closed - keep it cheap and side-effect free.
 *
 * `chatSlotWidth` and `chatWidth` are deliberately separate. `chatSlotWidth`
 * is the width reserved from the PAGE view for chat - only ever 0 or
 * CHAT_WIDTH, changed exactly once per toggle (not tweened) - so the page
 * view's bounds stay constant for the whole slide instead of being resized
 * on every animation frame, which is what made the slide janky (resizing a
 * live webpage's native view every frame competes with its own reflow).
 * `chatWidth` is the chat panel's CURRENT width within that reserved slot,
 * tweened from 0 to CHAT_WIDTH (or back) across the animation - only the
 * (cheap) chat view's own bounds change per frame.
 *
 * `chromeFullscreen` is for the blocking username prompt: the chrome view
 * is only CHROME_HEIGHT tall, so a `position: fixed` overlay drawn inside
 * it can only ever cover that top strip - it can't fill the window on its
 * own. While the prompt is up, WindowManager grows the chrome view to the
 * full window (and raises it above the page/chat views) so the overlay
 * actually blocks the whole browser, then shrinks it back once a username
 * is set.
 *
 * `findBarOpen` reserves FIND_BAR_HEIGHT below the toolbar for the
 * find-in-page bar, the same "grow chrome, push page/chat down" idea as
 * chromeFullscreen but for a small strip instead of the whole window.
 * Ignored while chromeFullscreen is true - the find bar can't be visible
 * behind a fullscreen modal anyway.
 *
 * `toolbarPopoverOpen` does the same for a toolbar popover (the bookmark
 * star's "bookmark added" bubble, or the subtitles/translate buttons'
 * agent/language pickers) - reserves TOOLBAR_POPOVER_HEIGHT rather than
 * going fullscreen like chromeFullscreen does. Takes the larger of the two
 * if somehow both this and the find bar are open at once, rather than
 * stacking them. Unlike findBarOpen, this reservation grows ONLY the
 * chrome view's own bounds - page/chat keep their normal CHROME_HEIGHT-
 * based bounds and don't shrink, since a popover is meant to float over
 * them, not push them down. That only works visually because the chrome
 * view is transparent outside whatever it's actually drawing (see
 * WindowManager's setBackgroundColor call) and gets raised above page/
 * chat whenever this is open, so the reserved strip reveals the page
 * underneath instead of an empty/opaque gap. The find bar doesn't get
 * this treatment - it's real toolbar content (a persistent search bar),
 * not a transient popover, so it's fine for it to actually claim space.
 *
 * Chrome's grown width is clamped to exclude chat's own column
 * (`pageWidth`, not `contentWidth`) specifically while a popover is open -
 * confirmed by hand as a real bug, not just theoretical: chrome sitting
 * raised-and-transparent over chat's column is invisible, but it's still
 * ON TOP there, so it silently swallowed every click meant for chat's own
 * UI (its page/agents mode toggle, notably) for as long as any toolbar
 * popover - even a small one nowhere near chat - was open. None of this
 * app's popovers actually need to extend into chat's column (they all
 * live in the toolbar, well within the page column), so there's nothing
 * lost by keeping chrome's reservation strip out of chat's way entirely.
 *
 * `chatFullscreen` is the same "grow it to cover the whole window" trick
 * as chromeFullscreen, applied to the chat view instead - used for the
 * full-screen image lightbox, since the chat view is normally just a
 * CHAT_WIDTH-wide sidebar with no room to show a magnified screenshot.
 * Takes priority over chromeFullscreen in the (unlikely) case both are
 * somehow requested at once, since it's the more recent/topmost overlay.
 *
 * `browserFullscreen` is real browser fullscreen (the View menu's Toggle
 * Full Screen, or a page's own `element.requestFullscreen()` - see
 * tabManager.ts's enter/leave-html-full-screen handling): the active
 * tab's page view grows to cover the whole window, same idea as
 * chromeFullscreen/chatFullscreen but for whichever page is currently
 * showing, and paired with the OS window itself going fullscreen (see
 * WindowManager.setBrowserFullscreen) so the toolbar, tab strip, dock, and
 * menu bar all disappear too - not just this app's own chrome.
 *
 * `subtitle` is always computed (there's no on/off flag here) since
 * whether the overlay view is actually attached is WindowManager's call,
 * not layout's - it's just a bottom strip of `page`, so it tracks
 * fullscreen automatically for free.
 */
export function computeLayout(
  contentWidth: number,
  contentHeight: number,
  chatSlotWidth: number,
  chatWidth: number,
  chromeFullscreen: boolean,
  findBarOpen: boolean,
  chatFullscreen: boolean,
  toolbarPopoverOpen = false,
  browserFullscreen = false,
): Layout {
  // Real toolbar content (the find bar) grows the chrome view's bounds AND
  // pushes page/chat down to make room. A toolbar popover only grows
  // chrome's own bounds - page/chat stay at their normal CHROME_HEIGHT-
  // based size, since the popover floats over them via transparency
  // instead (see the doc comment above).
  const findBarHeight = chromeFullscreen ? 0 : findBarOpen ? FIND_BAR_HEIGHT : 0;
  const popoverHeight = chromeFullscreen ? 0 : toolbarPopoverOpen ? TOOLBAR_POPOVER_HEIGHT : 0;
  const chromeHeight = CHROME_HEIGHT + Math.max(findBarHeight, popoverHeight);
  const belowToolbarHeight = Math.max(0, contentHeight - CHROME_HEIGHT - findBarHeight);
  const clampedSlotWidth = Math.max(0, Math.min(chatSlotWidth, contentWidth));
  const clampedChatWidth = Math.max(0, Math.min(chatWidth, clampedSlotWidth));
  const pageWidth = Math.max(0, contentWidth - clampedSlotWidth);
  const barBottom = CHROME_HEIGHT + findBarHeight;

  const page: ViewBounds = browserFullscreen
    ? { x: 0, y: 0, width: contentWidth, height: contentHeight }
    : { x: 0, y: barBottom, width: pageWidth, height: belowToolbarHeight };

  return {
    chrome: chromeFullscreen
      ? { x: 0, y: 0, width: contentWidth, height: contentHeight }
      : { x: 0, y: 0, width: toolbarPopoverOpen ? pageWidth : contentWidth, height: chromeHeight },
    page,
    chat: chatFullscreen
      ? { x: 0, y: 0, width: contentWidth, height: contentHeight }
      : { x: pageWidth, y: barBottom, width: clampedChatWidth, height: belowToolbarHeight },
    subtitle: {
      x: page.x,
      y: page.y + Math.max(0, page.height - SUBTITLE_HEIGHT),
      width: page.width,
      height: Math.min(SUBTITLE_HEIGHT, page.height),
    },
  };
}

/** Standard ease-out-cubic, for the chat-panel slide tween. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
