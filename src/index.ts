import { VisibilityState, World, type WorldOptions } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { detectXRMode } from './preview/detect.js';
import { startEmulator } from './preview/emulator.js';
import { mountPreviewControls } from './preview/overlay.js';
import { preview } from './preview/state.js';
import { SoundSystem } from './systems/SoundSystem.js';
import { GameSystem } from './systems/GameSystem.js';
import { HandSystem } from './systems/HandSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { PreviewSystem } from './systems/PreviewSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { StageSystem } from './systems/StageSystem.js';
import { mountAtlas, type Atlas } from './ui/atlas.js';
import { labelPlaque, mountLanding, prepareLanding, previewUnavailable, setLandingZoo, startGame, startNote } from './ui/landing.js';
import { mountZooWalk, walkFromHash, type WalkControls } from './ui/zoowalk/mount.js';

async function main(): Promise<void> {
  // The atlas and the zoo walk work at once, while the world loads: turn the globe, pick a zoo, walk in.
  let atlas: Atlas | null = null;
  const walk: WalkControls | null = mountZooWalk({
    onOpen: (place) => atlas?.choose(place),
    onClose: () => document.getElementById('walk-in')?.focus({ preventScroll: true }),
    onStart: (place) => {
      const started = startGame(place);
      if (started) walk?.close();
      return started;
    },
    startNote,
    label: labelPlaque,
  });
  atlas = mountAtlas(setLandingZoo, (place) => walk?.open(place));
  // A shared #walk-<zoo> link walked straight in: the atlas behind it shows that zoo too.
  const linked = walkFromHash(location.hash);
  if (linked) atlas?.choose(linked);
  let mode = await detectXRMode();
  prepareLanding(mode);
  let options: WorldOptions = projectOptions;
  if (mode === 'preview') {
    try {
      // The emulator replaces navigator.xr, so it starts before the world looks for XR.
      preview.device = await startEmulator();
      // The mouse works the menu: canvas clicks reach the 3D UI during the emulated session too.
      options = { ...projectOptions, input: { ...projectOptions.input, canvasPointerEvents: { enabled: true, activeDuringXR: true } } };
    } catch (error) {
      console.error('[ShadowZoo] The desktop preview could not start:', error);
      mode = 'unsupported';
      previewUnavailable();
    }
  }
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, options);
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(StageSystem, { priority: 1 })
    .registerSystem(MenuSystem, { priority: 5 })
    .registerSystem(GameSystem, { priority: 10 })
    .registerSystem(RenderSystem, { priority: 25 })
    .registerSystem(SoundSystem, { priority: 30 });
  let controls;
  if (preview.device) {
    world.registerSystem(PreviewSystem, { priority: -1 });
    controls = mountPreviewControls(world);
  }
  mountLanding(world, mode, controls);
  // Back from a game, the atlas shows where the zoo is now and the passport's new stamps.
  let away = false;
  world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) away = true;
    else if (away) {
      away = false;
      atlas?.refresh();
    }
  });
}

void main();
