import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { SoundSystem } from './systems/SoundSystem.js';
import { GameSystem } from './systems/GameSystem.js';
import { HandSystem } from './systems/HandSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { StageSystem } from './systems/StageSystem.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(StageSystem, { priority: 1 })
    .registerSystem(GameSystem, { priority: 10 })
    .registerSystem(RenderSystem, { priority: 25 })
    .registerSystem(SoundSystem, { priority: 30 });
});
