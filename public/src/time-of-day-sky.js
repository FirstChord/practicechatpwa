// The dashboard's time-of-day sky, so the Practice Chat panel matches the
// page it opens over: morning blue through golden hour and sunset to dusk.
//
// A copy of the dashboard's lib/time-of-day-sky.mjs (palette and blending)
// and the background recipe in components/shared/TimeOfDaySky.js. The two
// live in separate repositories with no shared package, so keep them in step
// by hand if the dashboard's sky changes.

const MINUTES_IN_DAY = 24 * 60;

export const TIME_OF_DAY_SKY_STOPS = [
  {
    minute: 0,
    name: 'night',
    top: '#53627f',
    horizon: '#98a7c2',
    low: '#aebbc6',
    base: '#81999d',
    glow: '#92a6c2',
    glowOpacity: 0.04,
    header: '#dbe4f0',
  },
  {
    minute: 5 * 60,
    name: 'dawn',
    top: '#667999',
    horizon: '#b0a9c1',
    low: '#d2c5c0',
    base: '#aebfba',
    glow: '#eab6aa',
    glowOpacity: 0.08,
    header: '#e4dce8',
  },
  {
    minute: 7 * 60,
    name: 'morning',
    top: '#93c5fd',
    horizon: '#bfdbfe',
    low: '#d7f0e2',
    base: '#c7e6d8',
    glow: '#edd2b5',
    glowOpacity: 0.03,
    header: '#dbeafe',
  },
  {
    minute: 12 * 60,
    name: 'day',
    top: '#bae6fd',
    horizon: '#cfe8fb',
    low: '#d9f4e7',
    base: '#d5f4e5',
    glow: '#c8e4f4',
    glowOpacity: 0.02,
    header: '#dbeafe',
  },
  {
    minute: 16 * 60,
    name: 'afternoon',
    top: '#b9d8f2',
    horizon: '#d9e7f5',
    low: '#dcefe2',
    base: '#d0ecdf',
    glow: '#e3d1b5',
    glowOpacity: 0.04,
    header: '#dbeafe',
  },
  {
    minute: 18 * 60,
    name: 'early-evening',
    top: '#afcce7',
    horizon: '#cdddec',
    low: '#d9eddf',
    base: '#c3ddd4',
    glow: '#e8c9aa',
    glowOpacity: 0.06,
    header: '#dbeafe',
  },
  {
    minute: 18 * 60 + 30,
    name: 'golden-hour',
    top: '#a8bfdf',
    horizon: '#d2c5dc',
    low: '#d3d9cd',
    base: '#b5d0cb',
    glow: '#edbda5',
    glowOpacity: 0.1,
    header: '#dce6f2',
  },
  {
    minute: 19 * 60 + 30,
    name: 'sunset',
    top: '#879dc7',
    horizon: '#c7adc7',
    low: '#c4cbc2',
    base: '#96b3b4',
    glow: '#e4aa9d',
    glowOpacity: 0.15,
    header: '#d9dfed',
  },
  {
    minute: 21 * 60,
    name: 'dusk',
    top: '#687ba6',
    horizon: '#9da1bf',
    low: '#aab4b5',
    base: '#7f9ba3',
    glow: '#b9a0bd',
    glowOpacity: 0.07,
    header: '#d5ddeb',
  },
  {
    minute: 22 * 60,
    name: 'night',
    top: '#53627f',
    horizon: '#8493b0',
    low: '#96a7ac',
    base: '#708894',
    glow: '#899bbc',
    glowOpacity: 0.04,
    header: '#dbe4f0',
  },
  {
    minute: MINUTES_IN_DAY,
    name: 'night',
    top: '#53627f',
    horizon: '#98a7c2',
    low: '#aebbc6',
    base: '#81999d',
    glow: '#92a6c2',
    glowOpacity: 0.04,
    header: '#dbe4f0',
  },
];

const COLOUR_KEYS = ['top', 'horizon', 'low', 'base', 'glow', 'header'];
const NUMBER_KEYS = ['glowOpacity'];

function normaliseMinutes(minutes) {
  const value = Number.isFinite(Number(minutes)) ? Number(minutes) : 12 * 60;
  return ((value % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function rgbToHex(rgb) {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixHex(from, to, amount) {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);
  return rgbToHex(fromRgb.map((channel, index) => channel + (toRgb[index] - channel) * amount));
}

export function getTimeOfDaySky(minutes) {
  const localMinutes = normaliseMinutes(minutes);
  const nextIndex = TIME_OF_DAY_SKY_STOPS.findIndex((stop) => stop.minute > localMinutes);
  const to = TIME_OF_DAY_SKY_STOPS[nextIndex];
  const from = TIME_OF_DAY_SKY_STOPS[nextIndex - 1];
  const progress = (localMinutes - from.minute) / (to.minute - from.minute);

  return {
    name: progress < 0.5 ? from.name : to.name,
    ...Object.fromEntries(
      COLOUR_KEYS.map((key) => [key, mixHex(from[key], to[key], progress)]),
    ),
    ...Object.fromEntries(
      NUMBER_KEYS.map((key) => [key, from[key] + (to[key] - from[key]) * progress]),
    ),
  };
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** The same layered background TimeOfDaySky gives the dashboard. */
export function skyBackground(sky) {
  const glow = withAlpha(sky.glow, sky.glowOpacity);
  const glowEdge = withAlpha(sky.glow, sky.glowOpacity * 0.4);
  return {
    backgroundColor: sky.base,
    backgroundImage: `radial-gradient(ellipse 68% 44% at 78% 62%, ${glow} 0%, ${glowEdge} 32%, transparent 70%), linear-gradient(to top, ${sky.base} 0%, ${sky.base} 18%, ${sky.low} 42%, ${sky.horizon} 67%, ${sky.top} 100%)`
  };
}
