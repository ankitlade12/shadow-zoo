import { createSystem } from '@iwsdk/core';
import { JOINT_COUNT, JOINT_INDEX } from '../core/joints.js';
import { placeTestPose, readTestPose } from '../runtime/testpose.js';
import { SIDES, store } from '../runtime/store.js';

/** WebXR Hand Input frame methods; optional because some runtimes and typings lack them. */
interface HandInputFrame {
  fillPoses?(spaces: readonly XRSpace[], baseSpace: XRSpace, transforms: Float32Array): boolean;
  fillJointRadii?(jointSpaces: readonly XRJointSpace[], radii: Float32Array): boolean;
}

/** Copies tracked hand joints (world space) into the store and hides the virtual hand meshes. */
export class HandSystem extends createSystem({}) {
  private readonly poses = new Float32Array(JOINT_COUNT * 16);
  private readonly radii = new Float32Array(JOINT_COUNT);
  private readonly test = readTestPose(globalThis.location?.search ?? '', import.meta.env.VITE_TESTPOSE as string | undefined);

  update(): void {
    // Hands-first: the player's real hands are visible in passthrough, so never draw virtual hands or controllers.
    const visuals = this.input.xr.visualAdapters;
    for (const side of SIDES) {
      visuals.hand[side]?.toggleVisual(false);
      visuals.controller[side]?.toggleVisual(false);
    }
    if (this.test) {
      for (const side of SIDES) store.hands[side].tracked = false;
      if (store.stage) placeTestPose(this.test, store.stage, store.hands[this.test.side]);
      return;
    }
    const source = store.handSource;
    if (source) {
      for (const side of SIDES) {
        store.hands[side].tracked = false;
        if (store.stage) source(side, store.stage, store.hands[side]);
      }
      return;
    }
    const frame = this.xrFrame as (XRFrame & HandInputFrame) | undefined;
    const ref = this.xrManager.getReferenceSpace();
    const m = this.player.matrixWorld.elements;
    for (const side of SIDES) {
      const sample = store.hands[side];
      sample.tracked = false;
      const adapter = this.input.xr.visualAdapters.hand[side];
      if (!frame || !ref || !adapter || adapter.jointSpaces.length !== JOINT_COUNT) continue;
      adapter.toggleVisual(false);
      if (!frame.fillPoses?.(adapter.jointSpaces, ref, this.poses)) continue;
      const hasRadii = frame.fillJointRadii?.(adapter.jointSpaces, this.radii) ?? false;
      const { pos, rad } = sample.joints;
      for (let k = 0; k < JOINT_COUNT; k++) {
        const i = JOINT_INDEX[adapter.jointSpaces[k].jointName];
        if (i === undefined) continue;
        const x = this.poses[k * 16 + 12];
        const y = this.poses[k * 16 + 13];
        const z = this.poses[k * 16 + 14];
        pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        rad[i] = hasRadii ? this.radii[k] : 0;
      }
      sample.tracked = true;
    }
  }
}
