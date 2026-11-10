import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { AudioEngine } from '../audio/AudioEngine.js';
import type { SoundName } from '../audio/recipes.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import type { GameEvent } from '../game/events.js';
import { store } from '../runtime/store.js';

function soundFor(event: GameEvent): SoundName {
  switch (event.type) {
    case 'voice':
      return `voice-${event.species}`;
    case 'reveal':
      return 'reveal';
    case 'eat':
      return 'eat';
    case 'pet':
      return 'pet';
    case 'flee':
      return 'flee';
    case 'firefly':
      return 'firefly';
  }
}

const stageToWorld = (s: Stage, x: number, y: number): Vec3 => [
  s.origin[0] + s.u[0] * x + s.v[0] * y,
  s.origin[1] + s.u[1] * x + s.v[1] * y,
  s.origin[2] + s.u[2] * x + s.v[2] * y,
];

/** Plays game events as spatial sounds on the wall and keeps the listener on the player's head. */
export class AudioSystem extends createSystem({}) {
  private readonly engine = new AudioEngine();
  private readonly v = new Vector3();
  private readonly f = new Vector3();
  private readonly q = new Quaternion();
  private ambientFor = -1;

  init(): void {
    const unlock = (): void => this.engine.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    this.renderer.xr.addEventListener('sessionstart', () => {
      unlock();
      this.renderer.xr.getSession()?.addEventListener('selectstart', unlock);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.engine.stopAmbient();
      this.ambientFor = -1;
    });
  }

  update(): void {
    const stage = store.stage;
    if (!stage) {
      store.events.length = 0;
      return;
    }
    if (this.engine.ready && this.ambientFor !== store.stageVersion) {
      this.engine.stopAmbient();
      this.engine.startAmbient(stage.origin);
      this.ambientFor = store.stageVersion;
    }
    this.player.head.getWorldPosition(this.v);
    this.player.head.getWorldQuaternion(this.q);
    this.f.set(0, 0, -1).applyQuaternion(this.q);
    this.engine.setListener(this.v.x, this.v.y, this.v.z, this.f.x, this.f.y, this.f.z);
    for (const event of store.events) this.engine.play(soundFor(event), stageToWorld(stage, event.x, event.y));
    store.events.length = 0;
  }
}
