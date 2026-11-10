import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);
