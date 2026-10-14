/**
 * Public API of the `furniture-ar` native module — the single source of truth for the
 * contract implemented in Kotlin (android/) and Swift (ios/). See CLAUDE.md 4.2.
 */
import FurnitureARModule from './src/FurnitureARModule';

export { default as FurnitureARView } from './src/FurnitureARView';
export * from './src/FurnitureAR.types';

export const FurnitureAR = {
  isSupported: (): Promise<boolean> => FurnitureARModule.isSupported(),
};
