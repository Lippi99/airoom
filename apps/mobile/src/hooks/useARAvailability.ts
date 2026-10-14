import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { FurnitureAR } from '../../modules/furniture-ar';

export type ARAvailability =
  | { status: 'checking' }
  | { status: 'unsupported' }
  | { status: 'permissionDenied'; canAskAgain: boolean }
  | { status: 'ready' };

/**
 * Checks AR support, then asks for the camera permission (Android).
 * On iOS ARKit shows the system prompt itself when the session starts.
 * Re-checks when the app returns to the foreground (e.g. back from Settings).
 */
export function useARAvailability() {
  const [state, setState] = useState<ARAvailability>({ status: 'checking' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    const supported = await FurnitureAR.isSupported().catch(() => false);
    if (!supported) {
      setState({ status: 'unsupported' });
      return;
    }
    if (Platform.OS !== 'android') {
      setState({ status: 'ready' });
      return;
    }
    const camera = PermissionsAndroid.PERMISSIONS.CAMERA;
    if (await PermissionsAndroid.check(camera)) {
      setState({ status: 'ready' });
      return;
    }
    const result = await PermissionsAndroid.request(camera, {
      title: 'Camera access',
      message: 'AIRoom uses the camera to show furniture at real size in your room.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    if (result === PermissionsAndroid.RESULTS.GRANTED) setState({ status: 'ready' });
    else setState({ status: 'permissionDenied', canAskAgain: result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN });
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && state.status === 'permissionDenied') check();
    });
    return () => sub.remove();
  }, [check, state.status]);

  return { availability: state, retry: check };
}
