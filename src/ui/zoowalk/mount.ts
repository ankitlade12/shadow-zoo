import { PLACE_IDS, type PlaceId } from '../../core/world.js';
import { ZooWalk, type WalkHooks } from './ZooWalk.js';

/** The zoo a `#walk-<zoo>` link walks into, if any. */
export function walkFromHash(hash: string): PlaceId | null {
  const m = /^#walk-([a-z]+)$/.exec(hash);
  return m && (PLACE_IDS as readonly string[]).includes(m[1]) ? (m[1] as PlaceId) : null;
}

export interface WalkControls {
  open(place: PlaceId): void;
  close(): void;
}

/**
 * Mounts the zoo walk. Walking in pushes a `#walk-<zoo>` entry, so the link can be shared and the
 * browser's Back button walks out; a page opened on such a link walks straight in.
 */
export function mountZooWalk(hooks: Omit<WalkHooks, 'onClose'> & { onOpen?(place: PlaceId): void; onClose?(): void }): WalkControls | null {
  const root = document.getElementById('zoo-walk');
  const canvas = document.getElementById('walk-scene');
  if (!root || !(canvas instanceof HTMLCanvasElement)) return null;
  let pushed = false;
  const walk = new ZooWalk(root, canvas, {
    ...hooks,
    onClose: () => {
      if (pushed) {
        pushed = false;
        history.back();
      } else if (walkFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      hooks.onClose?.();
    },
  });
  const open = (place: PlaceId, fromHistory: boolean): void => {
    hooks.onOpen?.(place);
    walk.open(place);
    if (!fromHistory) {
      history.pushState({ walk: place }, '', `#walk-${place}`);
      pushed = true;
    }
  };
  addEventListener('popstate', () => {
    const place = walkFromHash(location.hash);
    if (place) open(place, true);
    else if (walk.isOpen) {
      pushed = false;
      walk.close();
    }
  });
  const initial = walkFromHash(location.hash);
  if (initial) open(initial, true);
  return { open: (place) => open(place, false), close: () => walk.close() };
}
