/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

/** IWSDK's prebuilt WebXR emulator runtime, aliased in vite.config.ts (the desktop preview). */
declare module 'iwsdk-emulator-runtime' {
  export function startIwsdkDevRuntime(config: Record<string, unknown>): void;
}
