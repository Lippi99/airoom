import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

const API_PORT = 3333;

/**
 * Host of the machine serving the JS bundle (Metro) in development.
 * `expoConfig.hostUri` is set when running through Expo's dev tooling; plain debug builds
 * (`expo run:android` without expo-dev-client) leave it empty, so fall back to the URL the
 * bundle was actually loaded from.
 */
function devServerHost(): string | undefined {
  const fromExpo = Constants.expoConfig?.hostUri?.split(':')[0];
  if (fromExpo) return fromExpo;
  // SourceCode is a core RN native module; its shape differs between architectures.
  const sourceCode = NativeModules.SourceCode as
    | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
    | undefined;
  const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
  return scriptURL?.match(/^https?:\/\/([^/:]+)/)?.[1];
}

/**
 * Base URL of the API.
 * 1. `EXPO_PUBLIC_API_URL` when set (required for release builds).
 * 2. In development, the same host that serves the JS bundle (your PC), port 3333, so
 *    emulators and phones on the same Wi-Fi reach the local API without extra setup.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const host = __DEV__ ? devServerHost() : undefined;
  if (host) return `http://${host}:${API_PORT}`;

  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();
