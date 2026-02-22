import { detectTimezoneFromVenue, getTimezoneAbbr, getTimezoneLabel } from './lib/timezone';

// Test venues from the user's error list + international + edge cases
const testVenues = [
  // Previously failing venues
  'Carolina',
  'Columbia',
  'Jersey',
  'Centre Bell, MONTREAL, QC',
  'Canadian Tire Centre, Ottawa, ON',
  
  // US venues
  'Madison Square Garden, New York, NY',
  'SoFi Stadium, Inglewood, CA',
  'TD Garden, Boston, MA',
  'Hard Rock Stadium, MIAMI GARDENS, FL',
  'United Center, Chicago, IL',
  'Allegiant Stadium, Las Vegas, NV',
  'Ball Arena, Denver, CO',
  'Capital One Arena, Washington, DC',
  'Chase Field, Phoenix, AZ',
  'Lumen Field, Seattle, WA',
  'State Farm Arena, Atlanta, GA',
  
  // Canadian venues
  'Scotiabank Arena, Toronto, ON',
  'Rogers Place, Edmonton, AB',
  'Rogers Arena, Vancouver, BC',
  'Canada Life Centre, Winnipeg, MB',
  
  // International cities (the user wants these covered too)
  'O2 Arena, London',
  'Wembley Stadium, London',
  'AccorHotels Arena, Paris',
  'Allianz Arena, Munich',
  'Tokyo Dome, Tokyo',
  'Melbourne Cricket Ground, Melbourne',
  'Estadio Azteca, Mexico City',
  'Santiago Bernabéu, Madrid',
  'Camp Nou, Barcelona',
  'San Siro, Milan',
  'Olympic Stadium, Berlin',
  
  // Edge cases
  'Some Random Venue, Charlotte, North Carolina',
  'Arena, Raleigh, NC',
  'Venue Name Only No Location',
];

console.log('=== Timezone Detection Test ===\n');
let passed = 0;
let failed = 0;

for (const venue of testVenues) {
  const tz = detectTimezoneFromVenue(venue);
  const abbr = tz ? getTimezoneAbbr(tz) : 'N/A';
  const label = tz ? getTimezoneLabel(tz) : 'NOT DETECTED';
  const status = tz ? '✅' : '❌';
  if (tz) passed++; else failed++;
  console.log(`  ${status} ${venue.padEnd(50)} → ${(abbr).padEnd(6)} ${tz || 'null'}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${testVenues.length} ===`);
