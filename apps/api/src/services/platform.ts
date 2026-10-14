import type { RecordedClickPlatform } from '@airoom/shared';

/**
 * Best-effort platform detection from a User-Agent header.
 * iPadOS Safari reports a desktop macOS UA, so it may come back as `unknown`.
 */
export function inferPlatformFromUserAgent(userAgent: string | undefined): RecordedClickPlatform {
  if (!userAgent) return 'unknown';
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod|\bios\b|cfnetwork/i.test(userAgent)) return 'ios';
  return 'unknown';
}
