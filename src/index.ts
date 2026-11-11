import { World, type WorldOptions } from '@iwsdk/core';
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
import { mountLanding, prepareLanding, previewUnavailable } from './ui/landing.js';

async function main(): Promise<void> {
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
  if (preview.device) {
    world.registerSystem(PreviewSystem, { priority: -1 });
    mountPreviewControls(world);
  }
  mountLanding(world, mode);
}

void main();
