import type { Pool } from '../core/creature.js';
import type { Handedness } from '../core/poses.js';
import { markerAt, placeMarkers, placeOf, yawFacing, type GlobeView, type Marker, type PlaceId } from '../core/world.js';
import type { HandShadow } from './hands.js';

/** What the player did on the globe this frame. */
export type TourAction = { readonly type: 'travel'; readonly place: PlaceId } | { readonly type: 'close' } | null;

/** How far the North Pole tips toward the player (radians), so most of the land shows. */
const TILT = 0.38;
/** The globe's slow turn while nobody spins it (radians per second). */
const IDLE_SPIN = 0.12;
/** How quickly a flick's spin dies away (per second). */
const SPIN_DRAG = 1.6;
/** A marker this close to the pinch point's shadow, as a share of the globe's radius, is under the hand. */
const REACH = 0.2;
/** Longitude facing the player when the zoo is at home (Africa and Europe). */
const HOME_LON = 15;

/**
 * The World Tour's globe, on the wall in the lantern's light: the hand shadow's pinch point hovers over a
 * place, a pinch there travels, a pinch-drag on the globe spins it, and a pinch off the globe closes it.
 * Pure game logic.
 */
export class Tour {
  open = false;
  /** Turn about the poles (radians): the longitude facing the player. */
  yaw = yawFacing(HOME_LON);
  /** The place under a hand shadow's pinch point, if any. */
  hover: PlaceId | null = null;
  time = 0;
  private spin = 0;
  private dragging: Handedness | null = null;
  private lastX = 0;
  private readonly markerList: Marker[] = [];

  /** Opens the globe turned toward a place (Africa and Europe from home). */
  show(at: PlaceId): void {
    this.open = true;
    this.hover = null;
    this.dragging = null;
    this.spin = 0;
    const place = placeOf(at).at;
    this.yaw = yawFacing(place ? place.lon : HOME_LON);
  }

  hide(): void {
    this.open = false;
    this.hover = null;
    this.dragging = null;
  }

  /** Where the globe sits in the light pool and how it is turned. */
  view(pool: Pool): GlobeView {
    return { cx: 0, cy: 0.04 * pool.v, r: 0.6 * pool.v, yaw: this.yaw, tilt: TILT };
  }

  /** Every place's marker this moment. */
  markers(pool: Pool): readonly Marker[] {
    return placeMarkers(this.view(pool), this.time, this.markerList);
  }

  update(dt: number, hands: readonly HandShadow[], pool: Pool): TourAction {
    if (!this.open) return null;
    this.time += dt;
    const view = this.view(pool);
    const markers = placeMarkers(view, this.time, this.markerList);
    this.hover = null;
    let action: TourAction = null;
    for (const hand of hands) {
      if (!hand.tracked) continue;
      const over = markerAt(markers, hand.pinchX, hand.pinchY, REACH * view.r);
      if (over) this.hover = over;
      if (hand.pinch !== 'start') continue;
      if (over) action = { type: 'travel', place: over };
      else if (Math.hypot(hand.pinchX - view.cx, hand.pinchY - view.cy) <= view.r) {
        this.dragging = hand.side;
        this.lastX = hand.pinchX;
        this.spin = 0;
      } else action ??= { type: 'close' };
    }
    this.turn(dt, hands, view);
    return action;
  }

  /** Dragging turns the globe with the hand (the surface follows it); after a flick it coasts, then idles. */
  private turn(dt: number, hands: readonly HandShadow[], view: GlobeView): void {
    let dragger: HandShadow | null = null;
    for (const h of hands) if (h.side === this.dragging) dragger = h;
    if (dragger && dragger.tracked && dragger.detector.pinched) {
      const turn = -(dragger.pinchX - this.lastX) / view.r;
      this.lastX = dragger.pinchX;
      this.yaw += turn;
      if (dt > 0) this.spin += (turn / dt - this.spin) * Math.min(1, dt * 12);
      return;
    }
    this.dragging = null;
    this.spin *= Math.exp(-SPIN_DRAG * dt);
    // It holds still under a hovering hand, so a place doesn't slide away from the pinch.
    if (!this.hover) this.yaw += (this.spin - IDLE_SPIN) * dt;
  }
}
