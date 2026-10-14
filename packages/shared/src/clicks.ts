export const CLICK_PLATFORMS = ['ios', 'android'] as const;

/** Platform the app can report in `/go/:productId?platform=`. */
export type ClickPlatform = (typeof CLICK_PLATFORMS)[number];

/** Platform stored on a click event. `unknown` when it could not be determined. */
export type RecordedClickPlatform = ClickPlatform | 'unknown';

export function isClickPlatform(value: unknown): value is ClickPlatform {
  return typeof value === 'string' && (CLICK_PLATFORMS as readonly string[]).includes(value);
}
