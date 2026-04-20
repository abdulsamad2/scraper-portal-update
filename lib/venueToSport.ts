export type EventType = 'NFL' | 'MLB' | 'NHL' | 'NBA' | 'Other';

export const EVENT_TYPES: EventType[] = ['NFL', 'MLB', 'NHL', 'NBA', 'Other'];

// Venues used by only one league. Substring match on the lowercased venue.
// Keep this list conservative — shared arenas (MSG, TD Garden, etc.) deliberately
// omitted so the form leaves the dropdown empty and the user picks.
const SINGLE_LEAGUE_VENUES: Array<[string, Exclude<EventType, 'Other'>]> = [
  // NFL — dedicated football stadiums
  ['lambeau field', 'NFL'],
  ['arrowhead stadium', 'NFL'],
  ['geha field at arrowhead', 'NFL'],
  ['soldier field', 'NFL'],
  ['ford field', 'NFL'],
  ['gillette stadium', 'NFL'],
  ['m&t bank stadium', 'NFL'],
  ['mt bank stadium', 'NFL'],
  ['metlife stadium', 'NFL'],
  ['lincoln financial field', 'NFL'],
  ['at&t stadium', 'NFL'],
  ['att stadium', 'NFL'],
  ['sofi stadium', 'NFL'],
  ['levi\u2019s stadium', 'NFL'],
  ["levi's stadium", 'NFL'],
  ['lumen field', 'NFL'],
  ['mercedes-benz stadium', 'NFL'],
  ['mercedes benz stadium', 'NFL'],
  ['raymond james stadium', 'NFL'],
  ['hard rock stadium', 'NFL'],
  ['bank of america stadium', 'NFL'],
  ['caesars superdome', 'NFL'],
  ['nrg stadium', 'NFL'],
  ['lucas oil stadium', 'NFL'],
  ['paycor stadium', 'NFL'],
  ['huntington bank field', 'NFL'],
  ['acrisure stadium', 'NFL'],
  ['allegiant stadium', 'NFL'],
  ['empower field', 'NFL'],
  ['empower field at mile high', 'NFL'],
  ['us bank stadium', 'NFL'],
  ['u.s. bank stadium', 'NFL'],
  ['state farm stadium', 'NFL'],
  ['nissan stadium', 'NFL'],
  ['tiaa bank field', 'NFL'],
  ['everbank stadium', 'NFL'],
  ['highmark stadium', 'NFL'],
  ['fedexfield', 'NFL'],
  ['fedex field', 'NFL'],
  ['northwest stadium', 'NFL'],

  // MLB — dedicated ballparks
  ['yankee stadium', 'MLB'],
  ['fenway park', 'MLB'],
  ['wrigley field', 'MLB'],
  ['dodger stadium', 'MLB'],
  ['citi field', 'MLB'],
  ['citizens bank park', 'MLB'],
  ['oracle park', 'MLB'],
  ['petco park', 'MLB'],
  ['coors field', 'MLB'],
  ['american family field', 'MLB'],
  ['busch stadium', 'MLB'],
  ['great american ball park', 'MLB'],
  ['pnc park', 'MLB'],
  ['progressive field', 'MLB'],
  ['comerica park', 'MLB'],
  ['guaranteed rate field', 'MLB'],
  ['rate field', 'MLB'],
  ['kauffman stadium', 'MLB'],
  ['target field', 'MLB'],
  ['minute maid park', 'MLB'],
  ['globe life field', 'MLB'],
  ['angel stadium', 'MLB'],
  ['t-mobile park', 'MLB'],
  ['tropicana field', 'MLB'],
  ['camden yards', 'MLB'],
  ['oriole park at camden yards', 'MLB'],
  ['truist park', 'MLB'],
  ['loandepot park', 'MLB'],
  ['nationals park', 'MLB'],
  ['rogers centre', 'MLB'],
  ['chase field', 'MLB'],
  ['oakland coliseum', 'MLB'],

  // NBA-only arenas
  ['chase center', 'NBA'],
  ['fedexforum', 'NBA'],
  ['golden 1 center', 'NBA'],
  ['fiserv forum', 'NBA'],
  ['footprint center', 'NBA'],
  ['frost bank center', 'NBA'],
  ['gainbridge fieldhouse', 'NBA'],
  ['intuit dome', 'NBA'],
  ['kaseya center', 'NBA'],
  ['kia center', 'NBA'],
  ['moda center', 'NBA'],
  ['paycom center', 'NBA'],
  ['smoothie king center', 'NBA'],
  ['spectrum center', 'NBA'],
  ['state farm arena', 'NBA'],
  ['target center', 'NBA'],
  ['toyota center', 'NBA'],
  ['barclays center', 'NBA'],

  // NHL-only arenas
  ['amalie arena', 'NHL'],
  ['american airlines center', 'NHL'],
  ['bell centre', 'NHL'],
  ['bridgestone arena', 'NHL'],
  ['canada life centre', 'NHL'],
  ['canadian tire centre', 'NHL'],
  ['climate pledge arena', 'NHL'],
  ['enterprise center', 'NHL'],
  ['honda center', 'NHL'],
  ['keybank center', 'NHL'],
  ['lenovo center', 'NHL'],
  ['mullett arena', 'NHL'],
  ['nationwide arena', 'NHL'],
  ['ppg paints arena', 'NHL'],
  ['prudential center', 'NHL'],
  ['rogers arena', 'NHL'],
  ['rogers place', 'NHL'],
  ['scotiabank saddledome', 'NHL'],
  ['t-mobile arena', 'NHL'],
  ['ubs arena', 'NHL'],
  ['xcel energy center', 'NHL'],
  ['amerant bank arena', 'NHL'],
  ['fla live arena', 'NHL'],
];

export function detectSportFromVenue(venue: string | undefined | null): EventType | null {
  if (!venue) return null;
  const v = venue.trim().toLowerCase();
  if (!v) return null;
  for (const [needle, sport] of SINGLE_LEAGUE_VENUES) {
    if (v.includes(needle)) return sport;
  }
  return null;
}

export function isValidEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as string[]).includes(value);
}
