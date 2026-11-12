export const distances = [
  { id: '5k', title: '5K', km: 5 },
  { id: '10k', title: '10K', km: 10 },
  { id: '15k', title: '15K', km: 15 },
  { id: '10mi', title: '10 MILE', km: 16.09344 },
  { id: '20k', title: '20K', km: 20 },
  { id: 'half', title: 'HALF MARATHON', km: 21.0975 },
  { id: '25k', title: '25K', km: 25 },
  { id: '30k', title: '30K', km: 30 },
  { id: 'marathon', title: 'MARATHON', km: 42.195 },
  { id: '50k', title: 'ULTRA · 50K', km: 50 },
  { id: '50mi', title: 'ULTRA · 50 MILE', km: 80.4672 },
  { id: '100k', title: 'ULTRA · 100K', km: 100 },
  { id: '100mi', title: 'ULTRA · 100 MILE', km: 160.9344 },
  { id: 'custom', title: 'CUSTOM DISTANCE', km: 42.195 },
];

export interface Race {
  id: string;
  name: string;
  city: string;
  country: string;
  url: string;
  /** City centre [longitude, latitude]; only used to centre the map picker. */
  center: [number, number];
  /** Default plate units for the race's country. */
  units: Units;
}

// Names are catalogue metadata, not claims that a course GPX is bundled.
export const races: Race[] = [
  { id: 'oslo', name: 'Oslo Maraton', city: 'Oslo', country: 'Norway', url: 'https://oslomaraton.no/', center: [10.7522, 59.9139], units: 'metric' },
  { id: 'bergen', name: 'Bergen City Marathon', city: 'Bergen', country: 'Norway', url: 'https://bergencitymarathon.no/en/', center: [5.3221, 60.3913], units: 'metric' },
  { id: 'copenhagen', name: 'Copenhagen Marathon', city: 'Copenhagen', country: 'Denmark', url: 'https://copenhagenmarathon.dk/en/', center: [12.5683, 55.6761], units: 'metric' },
  { id: 'stockholm', name: 'Stockholm Marathon', city: 'Stockholm', country: 'Sweden', url: 'https://stockholmmarathon.se/', center: [18.0686, 59.3293], units: 'metric' },
  { id: 'helsinki', name: 'Helsinki City Marathon', city: 'Helsinki', country: 'Finland', url: 'https://helsinkicityrun.fi/en/', center: [24.9384, 60.1699], units: 'metric' },
  { id: 'tokyo', name: 'Tokyo Marathon', city: 'Tokyo', country: 'Japan', url: 'https://www.marathon.tokyo/en/', center: [139.7671, 35.6812], units: 'metric' },
  { id: 'boston', name: 'Boston Marathon', city: 'Boston', country: 'USA', url: 'https://www.baa.org/', center: [-71.0589, 42.3601], units: 'imperial' },
  { id: 'london', name: 'London Marathon', city: 'London', country: 'UK', url: 'https://www.londonmarathonevents.co.uk/london-marathon', center: [-0.1276, 51.5072], units: 'metric' },
  { id: 'cape-town', name: 'Cape Town Marathon', city: 'Cape Town', country: 'South Africa', url: 'https://capetownmarathon.com/', center: [18.4241, -33.9249], units: 'metric' },
  { id: 'sydney', name: 'Sydney Marathon', city: 'Sydney', country: 'Australia', url: 'https://sydneymarathon.com/', center: [151.2093, -33.8688], units: 'metric' },
  { id: 'berlin', name: 'Berlin Marathon', city: 'Berlin', country: 'Germany', url: 'https://www.bmw-berlin-marathon.com/en/', center: [13.4050, 52.5200], units: 'metric' },
  { id: 'chicago', name: 'Chicago Marathon', city: 'Chicago', country: 'USA', url: 'https://www.chicagomarathon.com/', center: [-87.6298, 41.8781], units: 'imperial' },
  { id: 'new-york', name: 'New York City Marathon', city: 'New York', country: 'USA', url: 'https://www.nyrr.org/tcsnycmarathon', center: [-74.0060, 40.7128], units: 'imperial' },
  { id: 'valencia', name: 'Valencia Marathon', city: 'Valencia', country: 'Spain', url: 'https://www.valenciaciudaddelrunning.com/en/', center: [-0.3763, 39.4699], units: 'metric' },
  { id: 'paris', name: 'Paris Marathon', city: 'Paris', country: 'France', url: 'https://www.schneiderelectricparismarathon.com/en/', center: [2.3522, 48.8566], units: 'metric' },
];

export type Units = 'metric' | 'imperial';
export const KM_PER_MILE = 1.609344;
export const fonts = [
  { id: 'helvetiker', name: 'Helvetiker Bold (basic Latin only)', file: 'helvetiker_bold.typeface.json' },
  { id: 'droid-sans', name: 'Droid Sans Bold (Æ Ø Å Ä Ö Ü É…)', file: 'droid_sans_bold.typeface.json' },
  { id: 'droid-serif', name: 'Droid Serif Bold (Æ Ø Å Ä Ö Ü É…)', file: 'droid_serif_bold.typeface.json' },
] as const;
export type FontId = typeof fonts[number]['id'];

export type Placement = 'attached' | 'separate' | 'hidden';
export const resultKeys = ['time', 'pace', 'bib'] as const;
export type ResultKey = typeof resultKeys[number];
export const kitCharacters = '0123456789:';
export type KitCounts = Record<string, number>;

export function validateResults(design: Design, keys: readonly ResultKey[]): void {
  if (keys.includes('time') || (keys.includes('pace') && design.autoPace)) parseTime(design.time);
  if (keys.includes('pace')) paceText(design);
  if (keys.includes('bib')) {
    const pattern = design.placements.bib === 'separate' ? /^\d{1,10}$/ : /^[A-Za-z0-9-]{1,10}$/;
    if (!pattern.test(design.bib)) throw new Error(design.placements.bib === 'separate'
      ? 'Glue-on BIB must contain 1–10 digits.'
      : 'BIB must contain 1–10 letters, numbers or hyphens.');
  }
}
export type ColourKey = 'base' | 'title' | 'location' | 'date' | 'distance' | 'time' | 'pace' | 'bib' | 'route';
export interface Design {
  distanceId: string;
  customKm: string;
  title: string;
  raceId: string;
  location: string;
  date: string;
  time: string;
  pace: string;
  autoPace: boolean;
  bib: string;
  units: Units;
  font: FontId;
  placements: Record<'time' | 'pace' | 'bib', Placement>;
  colours: Record<ColourKey, string>;
}

export function initialDesign(): Design {
  return {
    distanceId: 'marathon', customKm: '42.195', title: 'MARATHON',
    raceId: 'oslo', location: 'OSLO', date: '2026-09-12',
    time: '03:42:18', pace: '', autoPace: true, bib: '2048',
    units: 'metric', font: 'droid-sans',
    placements: { time: 'attached', pace: 'attached', bib: 'attached' },
    colours: {
      base: '#283b37', title: '#f1eadb', location: '#f1eadb', date: '#d3c9b3',
      distance: '#d7e5a5', time: '#f1eadb', pace: '#f1eadb', bib: '#f1eadb', route: '#e97845',
    },
  };
}

export function distanceKm(design: Design): number {
  return design.distanceId === 'custom' ? Number(design.customKm) : distances.find((d) => d.id === design.distanceId)!.km;
}

/** Distance as printed on the plate, e.g. 42.195K or 26.2MI. */
export function distanceText(design: Design): string {
  const km = distanceKm(design);
  return design.units === 'imperial' ? `${Number((km / KM_PER_MILE).toFixed(1))}MI` : `${Number(km.toFixed(3))}K`;
}

export function unitLabel(design: Design): 'KM' | 'MI' {
  return design.units === 'imperial' ? 'MI' : 'KM';
}

export function parseTime(value: string): number {
  if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(value)) throw new Error('Use H:MM:SS for finish time (for example 03:42:18).');
  const [hours, minutes, seconds] = value.split(':').map(Number);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total <= 0) throw new Error('Finish time must be greater than zero.');
  return total;
}

export function paceText(design: Design): string {
  if (!design.autoPace) {
    if (!/^\d{1,3}:[0-5]\d$/.test(design.pace) || Number(design.pace.replace(':', '')) === 0) {
      throw new Error('Use M:SS for pace (for example 5:16).');
    }
    return design.pace;
  }
  const km = distanceKm(design);
  const seconds = Math.round(parseTime(design.time) / (design.units === 'imperial' ? km / KM_PER_MILE : km));
  if (!Number.isFinite(seconds)) throw new Error('Enter a valid distance to calculate pace.');
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function dateText(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid race date.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid race date.');
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date).toUpperCase();
}

export function validateDesign(design: Design): void {
  if (!design.title.trim()) throw new Error('Enter a title for your plate.');
  if (!design.location.trim()) throw new Error('Enter the race location.');
  if (design.title.length > 40 || design.location.length > 48) throw new Error('Keep the title under 41 characters and location under 49 characters.');
  const km = distanceKm(design);
  if (!Number.isFinite(km) || km < 0.1 || km > 1000) throw new Error('Distance must be between 0.1 and 1,000 km.');
  dateText(design.date);
  validateResults(design, resultKeys.filter((key) => design.placements[key] === 'attached'));
}
