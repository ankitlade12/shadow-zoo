import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { BONES, JOINT_COUNT } from '../core/joints.js';
import type { CreatureDef } from '../core/library.js';
import { buildJointSet, createJointSet, mirrorJointSet, orientJointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';

/** A soft glowing 3D hand near the player's hands that demonstrates the visitor's shape. */
export class GhostHand {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({
    color: new Color(1, 0.82, 0.55),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly joints = new InstancedMesh(new SphereGeometry(1, 12, 8), this.material, JOINT_COUNT);
  private readonly bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 10, 1, true), this.material, BONES.length);
  private readonly pose = createJointSet();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly mid = new Vector3();
  private readonly dir = new Vector3();
  private readonly size = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private species: string | null = null;
  private wanted = false;
  private alpha = 0;
  private time = 0;

  constructor() {
    this.joints.frustumCulled = false;
    this.bones.frustumCulled = false;
    this.group.add(this.joints, this.bones);
    this.group.visible = false;
  }

  /**
   * Demonstrates `def` with the right hand (or the left), its wrist `shiftU` meters along the wall from
   * the comfortable hand point (a little to the left by default; a two-handed shape places each hand).
   */
  show(def: CreatureDef, stage: Stage, left: boolean, shiftU = -0.16): void {
    this.wanted = true;
    const key = `${def.id}:${left ? 'L' : 'R'}:${shiftU.toFixed(3)}`;
    if (key === this.species) return;
    this.species = key;
    const toWorld = (c: Vec3): Vec3 => {
      const x = left ? c[0] : -c[0];
      return [
        stage.u[0] * x + stage.v[0] * c[1] + stage.n[0] * c[2],
        stage.u[1] * x + stage.v[1] * c[1] + stage.n[1] * c[2],
        stage.u[2] * x + stage.v[2] * c[1] + stage.n[2] * c[2],
      ];
    };
    const anchor: Vec3 = [stage.hand[0] + stage.u[0] * shiftU, stage.hand[1] + 0.06, stage.hand[2] + stage.u[2] * shiftU];
    const base = buildJointSet(def.angles);
    const hand = left ? base : mirrorJointSet(base);
    orientJointSet(hand, left ? 'left' : 'right', { fingers: toWorld(def.facing.fingers), palm: toWorld(def.facing.palm) }, anchor, this.pose);
    this.layout();
  }

  hide(): void {
    this.wanted = false;
  }

  update(dt: number): void {
    this.time += dt;
    this.alpha = this.wanted ? Math.min(1, this.alpha + dt * 2.5) : Math.max(0, this.alpha - dt * 3);
    this.material.opacity = 0.32 * this.alpha * (0.85 + 0.15 * Math.sin(this.time * 3));
    this.group.position.y = 0.008 * Math.sin(this.time * 1.6);
    this.group.visible = this.alpha > 0.01;
    if (!this.wanted && this.alpha === 0) this.species = null;
  }

  private layout(): void {
    const p = this.pose.pos;
    const r = this.pose.rad;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const radius = Math.max(0.006, r[i]) * 1.05;
      this.m.makeScale(radius, radius, radius).setPosition(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.joints.setMatrixAt(i, this.m);
    }
    for (let k = 0; k < BONES.length; k++) {
      const bone = BONES[k];
      this.a.set(p[bone.a * 3], p[bone.a * 3 + 1], p[bone.a * 3 + 2]);
      this.b.set(p[bone.b * 3], p[bone.b * 3 + 1], p[bone.b * 3 + 2]);
      this.dir.subVectors(this.b, this.a);
      const length = Math.max(1e-4, this.dir.length());
      this.dir.multiplyScalar(1 / length);
      const radius = bone.radius ?? Math.max(0.006, (r[bone.a] + r[bone.b]) / 2);
      this.q.setFromUnitVectors(this.up, this.dir);
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.size.set(radius, length, radius);
      this.m.compose(this.mid, this.q, this.size);
      this.bones.setMatrixAt(k, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}
