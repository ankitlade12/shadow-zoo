import { VisibilityState, type World } from '@iwsdk/core';

interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/** Shows the 2D welcome page outside XR and starts the AR session from its button. */
export function mountLanding(world: World): void {
  const landing = document.getElementById('landing');
  const start = document.getElementById('start');
  const support = document.getElementById('support');
  if (!landing || !start) return;
  start.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((state) => {
    landing.hidden = state !== VisibilityState.NonImmersive;
  });
  const xr = (navigator as Navigator & { xr?: XRSystemLike }).xr;
  const supported = xr ? xr.isSessionSupported('immersive-ar').catch(() => false) : Promise.resolve(false);
  void supported.then((ok) => {
    if (!ok && support) support.textContent = 'Open this page in Meta Quest Browser to play. This browser cannot start mixed reality.';
  });
}
