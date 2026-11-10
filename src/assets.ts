import { AssetType, defineAssets } from '@iwsdk/core';

const ui = (fileName: string, name: string) => ({
  url: `${import.meta.env.BASE_URL}ui/${fileName}`,
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'menu-panel': ui('menu.uikitml', 'Settings Menu'),
  'menu-chip': ui('menu-chip.uikitml', 'Menu Chip'),
});
