import { requireNativeView } from 'expo';
import type { Ref } from 'react';

import type { FurnitureARViewProps, FurnitureARViewRef } from './FurnitureAR.types';

type NativeProps = FurnitureARViewProps & { ref?: Ref<FurnitureARViewRef> };

const NativeView = requireNativeView<NativeProps>('FurnitureAR');

/**
 * AR camera view. Imperative methods (`placeItem`, `removeItem`, `clearScene`,
 * `captureSnapshot`) are available on the ref; they are the view's native async functions.
 */
export default function FurnitureARView({
  ref,
  showPlaneOverlay = true,
  ...props
}: FurnitureARViewProps & { ref?: Ref<FurnitureARViewRef> }) {
  return <NativeView ref={ref} showPlaneOverlay={showPlaneOverlay} {...props} />;
}
