import { createSystem, Quaternion, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { JOINT_COUNT } from '../core/joints.js';
import { canonicalPair, CREATURES, creatureDef } from '../core/library.js';
import { createJointSet, handFrame, jointSetFromHandPose, mirrorJointSet, type Handedness, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import { creaturePoseId, poseFor } from '../preview/controls.js';
import type { EmulatedDevice, EmulatedHand } from '../preview/emulator.js';
import { centroid, cursorOnWall, handPoint, placeHand, type RigidPose } from '../preview/hand.js';
import { previewHandPoses } from '../preview/poses.js';
import { preview } from '../preview/state.js';
import { stageToWorld } from '../runtime/testpose.js';
import { store } from '../runtime/store.js';

/** A resting hand held upright, palm to the wall, in stage axes (x right, y up, z toward the player). */
const REST_FACING = { fingers: [0, 1, 0] as Vec3, palm: [0, 0, -1] as Vec3 };
const SUB_POINTERS = ['ray', 'grab', 'touch'] as const;

/** A two-handed shape's hands in canonical stage space, and their shared center. */
interface Pair {
  readonly left: JointSet;
  readonly right: JointSet;
  readonly center: Vec3;
}

/**
 * Desktop preview: steers the emulated hands from the mouse and keyboard. The left hand sits on the
 * line from the lantern to the wall point under the cursor, so its shadow follows the cursor, and it
 * holds the chosen creature's shape at the creature's canonical angle to the wall. A two-handed shape
 * (the bird) brings in the right hand too, both placed as the shape lays them out.
 */
export class PreviewSystem extends createSystem({}) {
  private readonly local = new Map<string, JointSet>();
  /** IWER mirrors left-hand pose data for the right hand. */
  private readonly mirrored = new Map<string, JointSet>();
  private readonly pairs = new Map<string, Pair>();
  private readonly room = createJointSet();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly headPosition = new Vector3();
  private readonly headRotation = new Quaternion();
  private readonly deviceRotation = new Quaternion();
  private readonly toDevice = new Quaternion();
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  init(): void {
    for (const [id, pose] of previewHandPoses()) {
      const js = jointSetFromHandPose(pose);
      this.local.set(id, js);
      this.mirrored.set(id, mirrorJointSet(js));
    }
    for (const def of CREATURES) {
      if (!def.pair) continue;
      for (const act of [false, true]) {
        const { left, right } = canonicalPair(def, act ? def.act : def.angles);
        const c = centroid(left);
        const d = centroid(right);
        this.pairs.set(creaturePoseId(def.id, act), { left, right, center: [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2, (c[2] + d[2]) / 2] });
      }
    }
  }

  update(): void {
    const device = preview.device;
    const hand = device?.hands.left;
    const other = device?.hands.right;
    if (!device || !hand || !other) return;
    // The emulated hands only cast shadows; the mouse works the menu, so their own pointers stay off.
    for (const side of ['left', 'right'] as const) {
      const pointers = this.input.xr.multiPointers[side];
      for (const kind of SUB_POINTERS) pointers.toggleSubPointer(kind, false);
    }

    const stage = store.stage;
    const input = preview.input;
    // Real hands from the camera take over from the mouse.
    const wall = this.renderer.xr.isPresenting && stage && input.cursor && !store.handSource ? this.cursorOnWall(input.cursor, stage) : null;
    if (!stage || !wall) {
      lower(hand);
      lower(other);
      return;
    }
    const id = poseFor(input);
    const center = handPoint(stage, wall, input.reach);
    const pair = this.pairs.get(id);
    if (pair) {
      this.placeInPair(device, hand, 'left', pair.left, pair.center, this.local.get(id)!, stage, center);
      this.placeInPair(device, other, 'right', pair.right, pair.center, this.mirrored.get(id)!, stage, center);
      show(other, id);
    } else {
      const facing = input.shape ? creatureDef(input.shape).facing : REST_FACING;
      const target = { fingers: stageToWorld(stage, facing.fingers), palm: stageToWorld(stage, facing.palm) };
      this.place(device, hand, placeHand(this.local.get(id)!, 'left', target, center));
      lower(other);
    }
    show(hand, id);
    const pinch = input.pinch ? 1 : 0;
    if (hand.pinchValue !== pinch) hand.updatePinchValue(pinch);
  }

  /** Places one hand of a pair where the canonical pair puts it, the pair centered on `center`. */
  private placeInPair(device: EmulatedDevice, hand: EmulatedHand, side: Handedness, joints: JointSet, pairCenter: Vec3, local: JointSet, stage: Stage, center: Vec3): void {
    const { u, v, n } = stage;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const x = joints.pos[j * 3] - pairCenter[0];
      const y = joints.pos[j * 3 + 1] - pairCenter[1];
      const z = joints.pos[j * 3 + 2] - pairCenter[2];
      for (let a = 0; a < 3; a++) this.room.pos[j * 3 + a] = center[a] + u[a] * x + v[a] * y + n[a] * z;
    }
    const frame = handFrame(this.room, side);
    this.place(device, hand, placeHand(local, side, { fingers: frame.fingers, palm: frame.palm }, centroid(this.room)));
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

/** Shows the hand in a pose. */
function show(hand: EmulatedHand, id: string): void {
  if (hand.poseId !== id) hand.poseId = id;
  if (!hand.connected) hand.connected = true;
}

/** Takes the hand out of view: an untracked hand casts no shadow. */
function lower(hand: EmulatedHand): void {
  if (hand.pinchValue !== 0) hand.updatePinchValue(0);
  if (hand.connected) hand.connected = false;
}
