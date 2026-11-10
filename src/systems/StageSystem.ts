import { createSystem, Quaternion, Vector3, XRPlane } from '@iwsdk/core';
import { buildStage, chooseWall, type HeadPose, type PlaneInfo } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import { store } from '../runtime/store.js';

interface XRPlaneLike {
  readonly orientation?: string;
  readonly semanticLabel?: string;
  readonly polygon: ReadonlyArray<{ x: number; y: number; z: number }>;
}

/** Seconds to wait for plane detection before falling back to the paper screen. */
const PLANE_WAIT = 2;

/** Chooses the wall in front of the player once per XR session (or on Re-light). */
export class StageSystem extends createSystem({ planes: { required: [XRPlane] } }) {
  private waited = 0;
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  update(delta: number): void {
    if (!this.renderer.xr.isPresenting) {
      if (store.stage) {
        store.stage = null;
        store.stageVersion++;
      }
      this.waited = 0;
      return;
    }
    if (store.stage && !store.relightRequested) return;
    const head = this.headPose();
    const wall = chooseWall(this.collectPlanes(), head);
    this.waited += delta;
    if (!wall && this.waited < PLANE_WAIT && !store.relightRequested) return;
    store.stage = buildStage(head, wall, { narrow: store.session?.settings.narrow ?? store.narrow });
    store.stageVersion++;
    store.relightRequested = false;
    this.waited = 0;
    if (import.meta.env.DEV) {
      const s = store.stage;
      const r = (v: number) => Math.round(v * 100) / 100;
      console.info('[ShadowZoo] stage', JSON.stringify({ fallback: s.fallback, distance: r(s.distance), poolU: r(s.poolU), poolV: r(s.poolV), origin: s.origin.map(r), n: s.n.map(r), head: head.position.map(r), planes: this.queries.planes.entities.size }));
    }
  }

  private headPose(): HeadPose {
    this.player.head.getWorldPosition(this.v);
    const position: Vec3 = [this.v.x, this.v.y, this.v.z];
    this.player.head.getWorldQuaternion(this.q);
    this.v.set(0, 0, -1).applyQuaternion(this.q);
    return { position, forward: [this.v.x, this.v.y, this.v.z] };
  }

  private collectPlanes(): PlaneInfo[] {
    const planes: PlaneInfo[] = [];
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlaneLike | undefined;
      const object = entity.object3D;
      if (!plane || !object) continue;
      object.updateWorldMatrix(true, false);
      const m = object.matrixWorld;
      const c = new Vector3().setFromMatrixPosition(m);
      const n = new Vector3(0, 1, 0).transformDirection(m);
      const polygon = plane.polygon.map((p): Vec3 => {
        const w = new Vector3(p.x, p.y, p.z).applyMatrix4(m);
        return [w.x, w.y, w.z];
      });
      planes.push({
        center: [c.x, c.y, c.z],
        normal: [n.x, n.y, n.z],
        polygon,
        vertical: plane.orientation === 'vertical',
        label: plane.semanticLabel,
      });
    }
    return planes;
  }
}
