import { NativeModule, requireNativeModule } from 'expo';

declare class FurnitureARNativeModule extends NativeModule<Record<string, never>> {
  /** Whether this device can run the AR view (ARCore on Android, ARKit world tracking on iOS). */
  isSupported(): Promise<boolean>;
}

export default requireNativeModule<FurnitureARNativeModule>('FurnitureAR');
