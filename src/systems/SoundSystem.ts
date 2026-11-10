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

const fmt = (v: Vec3): string => v.map((n) => n.toFixed(2)).join(' ');

const stageToWorld = (s: Stage, x: number, y: number): Vec3 => [
  s.origin[0] + s.u[0] * x + s.v[0] * y,
  s.origin[1] + s.u[1] * x + s.v[1] * y,
  s.origin[2] + s.u[2] * x + s.v[2] * y,
];

/** Plays game events as spatial sounds on the wall and keeps the listener on the player's head. */
export class SoundSystem extends createSystem({}) {
  private readonly engine = new AudioEngine();
  private readonly v = new Vector3();
  private readonly f = new Vector3();
  private readonly q = new Quaternion();
  private ambientFor = -1;
  private tracedStage = -1;

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
      this.tracedStage = -1;
      if (import.meta.env.DEV) console.info('[ShadowZoo] ambient stop');
    });
  }

  update(): void {
    const stage = store.stage;
    this.engine.setMuted(!(store.session?.settings.sound ?? true));
    if (!stage) {
      store.events.length = 0;
      return;
    }
    if (this.engine.ready && this.ambientFor !== store.stageVersion) {
      this.engine.stopAmbient();
      this.engine.startAmbient(stage.origin);
      this.ambientFor = store.stageVersion;
    }
    // Dev-only traces (here and below) let headless runs check the sounds nobody can hear, and let
    // scripts/render-audio.mjs rebuild a recording's soundtrack from the game's own recipes.
    if (import.meta.env.DEV && this.tracedStage !== store.stageVersion) {
      this.tracedStage = store.stageVersion;
      console.info(`[ShadowZoo] ambient start @ ${fmt(stage.origin)}`);
    }
    this.player.head.getWorldPosition(this.v);
    this.player.head.getWorldQuaternion(this.q);
    this.f.set(0, 0, -1).applyQuaternion(this.q);
    this.engine.setListener(this.v.x, this.v.y, this.v.z, this.f.x, this.f.y, this.f.z);
    const muted = !(store.session?.settings.sound ?? true);
    for (const event of store.events) {
      const sound = soundFor(event);
      const at = stageToWorld(stage, event.x, event.y);
      this.engine.play(sound, at);
      if (import.meta.env.DEV) console.info(`[ShadowZoo] sound ${sound} (audio ${muted ? 'muted' : this.engine.ready ? 'on' : 'locked'}) @ ${fmt(at)}`);
    }
    store.events.length = 0;
  }
}
