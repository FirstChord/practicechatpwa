import assert from 'node:assert/strict';
import test from 'node:test';

import { getTimeOfDaySky, skyBackground } from '../public/src/time-of-day-sky.js';

// A copy of the dashboard's lib/time-of-day-sky.mjs. These values were read
// from the dashboard's own function on 2026-10-08; if this test fails, one
// side changed and the panel no longer matches the page it opens over.
test('matches the dashboard sky at the times lessons happen', () => {
  const expected = { 720: '#bae6fd', 990: '#b7d5ef', 1125: '#a0b7d9', 1185: '#8297c2', 1275: '#63759c' };
  for (const [minutes, top] of Object.entries(expected)) {
    assert.equal(getTimeOfDaySky(Number(minutes)).top, top, `top colour at minute ${minutes}`);
  }
});

test('names the evening palettes', () => {
  assert.equal(getTimeOfDaySky(19 * 60 + 30).name, 'sunset');
  assert.equal(getTimeOfDaySky(18 * 60 + 30).name, 'golden-hour');
});

test('builds the same layered background as the dashboard', () => {
  const style = skyBackground(getTimeOfDaySky(19 * 60 + 30));
  assert.equal(style.backgroundColor, getTimeOfDaySky(19 * 60 + 30).base);
  assert.match(style.backgroundImage, /^radial-gradient\(ellipse 68% 44% at 78% 62%.*linear-gradient\(to top/);
});
