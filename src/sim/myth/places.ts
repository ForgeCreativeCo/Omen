/** A place that exists only because something happened there (shaped land). */
export interface NamedSite {
  key: string;
  x: number;
  z: number;
  r: number;
}

/** Why a place got its name: picks the adjective (and the verse's explanation). */
export type NamingReason =
  | 'lightning'
  | 'storm'
  | 'rain'
  | 'raised'
  | 'lowered'
  | 'flooded'
  | 'bloom'
  | 'drought'
  | 'sacred'
  | 'cursed'
  | 'blight'
  | 'star'
  | 'quake'
  | 'wave';

export const PLACE_ADJ: Record<NamingReason, string[]> = {
  lightning: ['Burned', 'Scorched', 'Struck', 'Blackened'],
  storm: ['Thundering', 'Storm-beaten'],
  rain: ['Weeping', 'Rain-blessed'],
  raised: ['Risen', 'Heaved', 'Split'],
  lowered: ['Sunken', 'Split', 'Broken'],
  flooded: ['Weeping', 'Drowned'],
  bloom: ['Green', 'Flowering', 'Blooming'],
  drought: ['Thirsting', 'Cracked'],
  sacred: ['Holy', 'Blessed', 'Bright'],
  cursed: ['Forbidden', 'Silent', 'Black'],
  blight: ['Withered', 'Barren', 'Ashen'],
  star: ['Star-fallen', 'Sky-struck', 'Shining'],
  quake: ['Broken', 'Shaken', 'Riven'],
  wave: ['Drowned', 'Salt', 'Sea-taken'],
};

/** The noun for a landmark, by place key ('' = not nameable). */
export function placeNoun(key: string): string {
  const a = key.split(':')[1];
  switch (a) {
    case 'eastHill':
      return 'Hill';
    case 'ridge':
      return 'Mountain';
    case 'river':
      return 'River';
    case 'well':
      return 'Well';
    case 'fire':
      return 'Hearth';
    case 'fields':
      return 'Fields';
    case 'graveyard':
      return 'Barrow';
    case 'coast':
      return 'Shore';
    case 'cairn':
      return 'Stones';
    default:
      return '';
  }
}

/** Nouns for new places made by Shape Earth. */
export const SITE_NOUN = { raised: ['Mound', 'Tor', 'Knoll'], lowered: ['Crater', 'Hollow', 'Pit'], flooded: ['Crater', 'Pool', 'Mere'], crater: ['Crater', 'Star-Pit', 'Hollow'] };

/**
 * The names the people use for places (SPEC §11: "the land remembers"). A name,
 * once given, sticks. New sites appear where the god reshaped the land.
 */
export class PlaceNames {
  private readonly names = new Map<string, string>();
  readonly sites: NamedSite[] = [];
  /** Notable omens seen at each place so far. */
  readonly notable = new Map<string, number>();
  private nextSite = 1;

  name(key: string): string | undefined {
    return this.names.get(key) || undefined;
  }

  site(key: string): NamedSite | undefined {
    return this.sites.find((s) => s.key === key);
  }

  get all(): [string, string][] {
    return [...this.names];
  }

  taken(name: string): boolean {
    for (const n of this.names.values()) if (n === name) return true;
    return false;
  }

  give(key: string, name: string): void {
    this.names.set(key, name);
  }

  addSite(x: number, z: number, r: number): NamedSite {
    const s = { key: `place:site:${this.nextSite++}`, x, z, r };
    this.sites.push(s);
    return s;
  }

  /** The new site at (x, z), if any. */
  siteAt(x: number, z: number): NamedSite | undefined {
    return this.sites.find((s) => Math.hypot(s.x - x, s.z - z) <= s.r);
  }
}
