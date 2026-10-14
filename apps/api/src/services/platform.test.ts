import { describe, expect, it } from 'vitest';
import { inferPlatformFromUserAgent } from './platform';

describe('inferPlatformFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15', 'ios'],
    ['airoom/1 CFNetwork/1490.0.4 Darwin/23.2.0', 'ios'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ])('%s -> %s', (ua, expected) => {
    expect(inferPlatformFromUserAgent(ua)).toBe(expected);
  });
});
