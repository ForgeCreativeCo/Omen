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
};

export function svgIcon(path: string, size = 24): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}
