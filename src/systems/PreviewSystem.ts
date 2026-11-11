import { createSystem, Quaternion, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { creatureDef } from '../core/library.js';
import { jointSetFromHandPose, type JointSet } from '../core/poses.js';
import type { Vec3 } from '../core/vec.js';
import { poseFor } from '../preview/controls.js';
import type { EmulatedDevice, EmulatedHand } from '../preview/emulator.js';
import { cursorOnWall, handPoint, placeHand, type RigidPose } from '../preview/hand.js';
import { previewHandPoses } from '../preview/poses.js';
import { preview } from '../preview/state.js';
import { stageToWorld } from '../runtime/testpose.js';
import { store } from '../runtime/store.js';

/** A resting hand held upright, palm to the wall, in stage axes (x right, y up, z toward the player). */
const REST_FACING = { fingers: [0, 1, 0] as Vec3, palm: [0, 0, -1] as Vec3 };
const SUB_POINTERS = ['ray', 'grab', 'touch'] as const;

/**
 * Desktop preview: steers the emulated left hand from the mouse and keyboard. The hand sits on the
 * line from the lantern to the wall point under the cursor, so its shadow follows the cursor, and it
 * holds the chosen creature's shape at the creature's canonical angle to the wall.
 */
export class PreviewSystem extends createSystem({}) {
  private readonly local = new Map<string, JointSet>();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly headPosition = new Vector3();
  private readonly headRotation = new Quaternion();
  private readonly deviceRotation = new Quaternion();
  private readonly toDevice = new Quaternion();
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  init(): void {
    for (const [id, pose] of previewHandPoses()) this.local.set(id, jointSetFromHandPose(pose));
  }

  update(): void {
    const device = preview.device;
    const hand = device?.hands.left;
    if (!device || !hand) return;
    // The emulated hand only casts shadows; the mouse works the menu, so the hand's own pointers stay off.
    const pointers = this.input.xr.multiPointers.left;
    for (const kind of SUB_POINTERS) pointers.toggleSubPointer(kind, false);

    const stage = store.stage;
    const input = preview.input;
    const wall = this.renderer.xr.isPresenting && stage && input.cursor ? this.cursorOnWall(input.cursor, stage) : null;
    if (!stage || !wall) {
      lower(hand);
      return;
    }
    const id = poseFor(input);
    const facing = input.shape ? creatureDef(input.shape).facing : REST_FACING;
    const target = { fingers: stageToWorld(stage, facing.fingers), palm: stageToWorld(stage, facing.palm) };
    this.place(device, hand, placeHand(this.local.get(id)!, 'left', target, handPoint(stage, wall, input.reach)));
    if (hand.poseId !== id) hand.poseId = id;
    if (!hand.connected) hand.connected = true;
    const pinch = input.pinch ? 1 : 0;
    if (hand.pinchValue !== pinch) hand.updatePinchValue(pinch);
  }

  private cursorOnWall(cursor: { x: number; y: number }, stage: NonNullable<typeof store.stage>): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc.set(cursor.x, cursor.y), this.camera);
    const { origin, direction } = this.raycaster.ray;
    return cursorOnWall([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], stage);
  }

  /** Sets the hand's target ray to a world pose. The emulator has its own space; the head is in both. */
  private place(device: EmulatedDevice, hand: EmulatedHand, pose: RigidPose): void {
    this.player.head.getWorldPosition(this.headPosition);
    this.player.head.getWorldQuaternion(this.headRotation);
    const d = device.quaternion;
    this.deviceRotation.set(d.x, d.y, d.z, d.w);
    // World to emulator: undo the head's world rotation, apply its emulator rotation.
    this.toDevice.copy(this.headRotation).invert().premultiply(this.deviceRotation);
    const p = pose.position;
    this.v.set(p[0], p[1], p[2]).sub(this.headPosition).applyQuaternion(this.toDevice);
    hand.position.set(this.v.x + device.position.x, this.v.y + device.position.y, this.v.z + device.position.z);
    const r = pose.quaternion;
    this.q.set(r[0], r[1], r[2], r[3]).premultiply(this.toDevice);
    hand.quaternion.set(this.q.x, this.q.y, this.q.z, this.q.w);
  }
}

/** Takes the hand out of view: an untracked hand casts no shadow. */
function lower(hand: EmulatedHand): void {
  if (hand.pinchValue !== 0) hand.updatePinchValue(0);
  if (hand.connected) hand.connected = false;
}
