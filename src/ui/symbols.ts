import type { DreamSymbol } from '../sim/miracles/defs';
import type { MiracleId } from '../sim/miracles/defs';

/**
 * Line icons on a 24×24 grid, as SVG path data. Used both in DOM (inline SVG) and
 * in 3D (drawn onto canvas textures via Path2D), so the dream the player picks is
 * the glyph that floats over the sleeper.
 */
export const SYMBOL_PATHS: Record<DreamSymbol, string> = {
  water: 'M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0',
  fire: 'M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 1 4 3 4 0-3-1-5 0-8z',
  mountain: 'M2 20 9 7l4 7 3-4 6 10z',
  boat: 'M3 14h18l-3 5H6zM12 14V4l6 8h-6',
  child: 'M12 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM12 9v6M8 11.5h8M12 15l-3 6M12 15l3 6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  moon: 'M15 3a9 9 0 1 0 6 13A7 7 0 0 1 15 3z',
  bird: 'M2 10c3-2 6-1 10 3 4-4 7-5 10-3M12 13v2',
  snake: 'M3 18c3 0 3-5 6-5s3 5 6 5 3-5 5-7l2-1',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4.5-2.5 7.5-6.5 7.5-2 0-3.5-1-4.5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 15',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  house: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
};

/** Miracle bar icons. */
export const MIRACLE_PATHS: Record<MiracleId, string> = {
  rain: 'M7 14a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 7.5a3.5 3.5 0 0 1-.5 6.5zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  lightning: 'M13 2 5 13h6l-1 9 8-12h-6z',
  shapeEarth: 'M2 20h20M4 20l5-9 3 4 3-7 5 12',
  bloom: 'M12 21v-8M12 13c-4 0-6-3-6-6 3 0 6 2 6 6zM12 13c4 0 6-3 6-6-3 0-6 2-6 6zM12 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  dream: 'M15 3a9 9 0 1 0 6 13A7 7 0 0 1 15 3zM17 6h3l-3 3h3',
  light: 'M9 2h6l2 18H7zM4 21h16M12 2v-1M5 6l2 1M19 6l-2 1',
  bless: 'M7 21v-7l-2-4a1.5 1.5 0 0 1 2.6-1.5L9 11V4a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v9a7 7 0 0 1-3 6v1M3 4l1 1M3 9h1',
  blight: 'M12 21v-9M12 12c-3 0-5-2-6-5 3 0 5 1 6 5zM12 15c3 0 4-1 5-3-2 0-4 0-5 3zM5 21h14M8 18l-1 3M16 18l1 3',
  meteor: 'M15 9a3 3 0 1 1-6 6 3 3 0 0 1 6-6zM14 10l7-7M11 9l5-6M15 13l6-5',
  quake: 'M2 18h7l2-3 2 4 2-3h7M4 13l3-6 3 3 3-6 3 4 3-2M12 15v6',
  firestorm: 'M7 3l-1 4M12 2l-1 5M17 3l-1 4M8 21a4 4 0 0 1-2-6c1-2 3-3 3-6 2 2 2 4 1 6 2-1 2-3 2-3 2 3 2 9-4 9zM16 21c2 0 3-2 2-4-1 1-2 1-2 0 0-1 1-2 0-4-1 2-3 3-2 6 0 1 1 2 2 2z',
  wave: 'M2 16c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M2 20c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M4 12c0-5 4-8 9-8 3 0 5 2 5 4-2-1-4-1-5 1-1 1 0 3 2 3',
  plague: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19',
  swarm: 'M5 8h.01M9 5h.01M14 7h.01M18 4h.01M7 12h.01M12 11h.01M17 10h.01M4 16h.01M10 15h.01M15 14h.01M20 13h.01M3 21h18M8 21v-3M12 21v-2M16 21v-3',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V11M17 11V8a1.5 1.5 0 0 1 3 0v6c0 4.5-3 8-7.5 8-2.5 0-4-1-5.5-3l-3-4.5a1.5 1.5 0 0 1 2.5-1.7L8 15',
};

export function svgIcon(path: string, size = 24): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

/** What someone is doing, shown over their head. */
export type DoingIcon =
  | 'dance'
  | 'pray'
  | 'pilgrim'
  | 'build'
  | 'love'
  | 'quarrel'
  | 'theft'
  | 'flee'
  | 'leave'
  | 'dissent'
  | 'farm'
  | 'chop'
  | 'quarry'
  | 'forage'
  | 'eat'
  | 'sleep'
  | 'fire'
  | 'hurt'
  | 'judge';

export const DOING_PATHS: Record<DoingIcon, string> = {
  dance: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  pray: 'M12 3v9l-4 4v5M12 3v9l4 4v5M8 21h8',
  pilgrim: 'M7 21 13 3M13 3c3 0 5 2 5 4s-2 3-4 3M4 21h8',
  build: 'M14 6l4 4M4 20l9-9M12 4l8 8-3 3-8-8z',
  love: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  quarrel: 'M4 4l9 9M20 4l-9 9M7 13l-3 3 4 4 3-3M17 13l3 3-4 4-3-3',
  theft: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7-2 0-3.5-1-4.5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 15',
  flee: 'M13 4a2 2 0 1 1 0 .1M9 21l3-6-2-3 3-4 3 3h3M12 15l-4-1-2 3M13 8l-4 1-2 3',
  leave: 'M6 9h12l-1 11H7zM9 9V6a3 3 0 0 1 6 0v3',
  dissent: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM5.6 5.6l12.8 12.8',
  farm: 'M4 20c4 0 8-3 9-9M13 11c2-4 5-6 8-6-1 5-4 7-8 6zM4 20l3-3',
  chop: 'M5 21 15 11M13 4l7 7-3 3-7-7z',
  quarry: 'M4 21l9-9M14 3c3 0 7 4 7 7l-5-2-3 3-3-3 3-3z',
  forage: 'M4 10h16l-2 10H6zM8 10a4 4 0 0 1 8 0',
  eat: 'M3 12h18a9 9 0 0 1-18 0zM8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4',
  sleep: 'M5 6h6l-6 8h6M13 12h5l-5 6h5',
  fire: 'M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 1 4 3 4 0-3-1-5 0-8z',
  hurt: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  judge: 'M12 3v18M7 21h10M4 7h16M4 7l-2 6a3 3 0 0 0 4 0zM20 7l-2 6a3 3 0 0 0 4 0z',
};
