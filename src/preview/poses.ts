import { buildHandPose } from 'iwer/lib/device/configs/hand/builder.js';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import type { HandPose } from 'iwer/lib/device/XRHandInput.js';
import { CREATURES } from '../core/library.js';
import { creaturePoseId, REST_POSE } from './controls.js';

/**
 * The poses the desktop preview gives the emulated hand: a relaxed resting hand, and each creature's
 * shape and action built from the same joint angles the game matches (left-hand data, as IWER keeps it).
 */
export function previewHandPoses(): Map<string, HandPose> {
  const poses = new Map<string, HandPose>([[REST_POSE, relaxedHandPose]]);
  for (const def of CREATURES) {
    poses.set(creaturePoseId(def.id, false), buildHandPose(def.angles, relaxedHandPose, pinchHandPose));
    poses.set(creaturePoseId(def.id, true), buildHandPose(def.act, relaxedHandPose, pinchHandPose));
  }
  return poses;
}
