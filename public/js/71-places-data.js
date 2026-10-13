// ============================================================================
// PLACE SUGGESTIONS for the Find Leads "Where the job is" box (owner, 14 Oct: "state and city suggestions should be enabled in the
// location search box for find leads"). PACE serves the US and India, so this is a fixed list of every US state, the larger and
// the recruiting-heavy US cities, India's states and main cities, and "Remote". It is reference data (names of places), not a
// limit on anyone — nothing here is a number a customer is held to. It needs no server and no paid service.
//
// What a pick writes is the plain way a person would type it and a job search understands it: "Texas", "Austin, Texas",
// "Hyderabad, India". `window.PLACES.suggest(typed, max)` returns the best matches, most useful first: a city or state that
// STARTS with what was typed, then ones that contain it; "tx" finds Texas and its cities; "austin tx" finds Austin, Texas.
// ============================================================================
(function(){
  'use strict';
  var STATES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};

  // City lists by state (comma-separated). A city is written "City, State name".
  var CITIES = {
    AL:'Birmingham,Huntsville,Montgomery,Mobile,Tuscaloosa,Auburn',
    AK:'Anchorage,Fairbanks,Juneau',
    AZ:'Phoenix,Tucson,Mesa,Chandler,Scottsdale,Tempe,Gilbert,Glendale,Peoria,Flagstaff,Goodyear',
    AR:'Little Rock,Fayetteville,Fort Smith,Bentonville,Springdale,Jonesboro',
    CA:'Los Angeles,San Diego,San Jose,San Francisco,Fresno,Sacramento,Long Beach,Oakland,Bakersfield,Anaheim,Irvine,Riverside,Santa Ana,Stockton,San Bernardino,Ontario,Santa Clara,Sunnyvale,Fremont,Pasadena,Santa Barbara,Palo Alto,Torrance,Carlsbad,Oxnard,Modesto,Santa Rosa,Salinas,Mountain View,Redwood City,Pleasanton,Burbank,Glendale,Newport Beach,Costa Mesa,El Segundo,Ventura,Visalia,Temecula,Chico,Redding',
    CO:'Denver,Colorado Springs,Aurora,Fort Collins,Boulder,Lakewood,Littleton,Englewood,Greeley,Pueblo,Golden,Broomfield,Westminster',
    CT:'Hartford,New Haven,Stamford,Bridgeport,Norwalk,Waterbury,Danbury,Shelton',
    DE:'Wilmington,Dover,Newark',
    DC:'Washington',
    FL:'Jacksonville,Miami,Tampa,Orlando,St. Petersburg,Fort Lauderdale,Tallahassee,Hialeah,Gainesville,Fort Myers,Sarasota,Boca Raton,West Palm Beach,Pensacola,Lakeland,Clearwater,Daytona Beach,Naples,Ocala,Melbourne,Palm Beach Gardens,Doral,Coral Springs,Miramar',
    GA:'Atlanta,Augusta,Columbus,Savannah,Athens,Macon,Alpharetta,Marietta,Duluth,Norcross,Roswell,Kennesaw,Lawrenceville,Valdosta',
    HI:'Honolulu,Hilo',
    ID:'Boise,Meridian,Nampa,Idaho Falls,Coeur d\'Alene,Twin Falls',
    IL:'Chicago,Aurora,Naperville,Rockford,Joliet,Springfield,Peoria,Schaumburg,Elgin,Champaign,Oak Brook,Bloomington,Itasca,Lisle,Downers Grove,Rosemont',
    IN:'Indianapolis,Fort Wayne,Evansville,South Bend,Carmel,Fishers,Bloomington,Lafayette,Elkhart,Columbus',
    IA:'Des Moines,Cedar Rapids,Davenport,Sioux City,Iowa City,West Des Moines,Ames',
    KS:'Wichita,Overland Park,Kansas City,Topeka,Olathe,Lawrence,Lenexa',
    KY:'Louisville,Lexington,Bowling Green,Covington,Owensboro',
    LA:'New Orleans,Baton Rouge,Shreveport,Lafayette,Lake Charles,Metairie',
    ME:'Portland,Bangor,Lewiston,Augusta',
    MD:'Baltimore,Columbia,Germantown,Rockville,Frederick,Annapolis,Silver Spring,Bethesda,Towson,Hagerstown',
    MA:'Boston,Worcester,Springfield,Cambridge,Lowell,Waltham,Burlington,Framingham,Marlborough,Quincy,Andover,Woburn,Westborough',
    MI:'Detroit,Grand Rapids,Warren,Sterling Heights,Ann Arbor,Lansing,Troy,Southfield,Kalamazoo,Flint,Auburn Hills,Dearborn,Livonia',
    MN:'Minneapolis,Saint Paul,Rochester,Bloomington,Duluth,Eden Prairie,Plymouth,St. Cloud,Maple Grove',
    MS:'Jackson,Gulfport,Southaven,Biloxi,Hattiesburg,Tupelo',
    MO:'Kansas City,St. Louis,Springfield,Columbia,Independence,Chesterfield,Jefferson City,Joplin',
    MT:'Billings,Missoula,Bozeman,Great Falls,Helena',
    NE:'Omaha,Lincoln,Bellevue,Grand Island',
    NV:'Las Vegas,Henderson,Reno,Carson City,North Las Vegas,Sparks',
    NH:'Manchester,Nashua,Concord,Portsmouth',
    NJ:'Newark,Jersey City,Paterson,Edison,Princeton,Parsippany,Cherry Hill,Trenton,Piscataway,Iselin,Bridgewater,Somerset,Morristown,Hoboken,Mount Laurel,Secaucus',
    NM:'Albuquerque,Santa Fe,Las Cruces,Rio Rancho',
    NY:'New York City,Buffalo,Rochester,Yonkers,Syracuse,Albany,White Plains,Brooklyn,Long Island,Melville,Schenectady,Manhattan,Queens,Bronx,Staten Island,Poughkeepsie,Ithaca,Utica,Binghamton',
    NC:'Charlotte,Raleigh,Greensboro,Durham,Winston-Salem,Fayetteville,Cary,Wilmington,Asheville,Chapel Hill,Morrisville,Research Triangle Park,High Point,Concord,Gastonia,Greenville',
    ND:'Fargo,Bismarck,Grand Forks,Minot',
    OH:'Columbus,Cleveland,Cincinnati,Toledo,Akron,Dayton,Dublin,Canton,Youngstown,Mason,Westerville',
    OK:'Oklahoma City,Tulsa,Norman,Broken Arrow,Edmond,Lawton',
    OR:'Portland,Salem,Eugene,Beaverton,Hillsboro,Bend,Medford,Gresham,Tigard',
    PA:'Philadelphia,Pittsburgh,Allentown,Erie,Harrisburg,Reading,King of Prussia,Lancaster,Scranton,Bethlehem,Malvern,Wilkes-Barre,York',
    RI:'Providence,Warwick,Cranston',
    SC:'Charleston,Columbia,Greenville,Spartanburg,Myrtle Beach,North Charleston,Rock Hill',
    SD:'Sioux Falls,Rapid City,Aberdeen',
    TN:'Nashville,Memphis,Knoxville,Chattanooga,Clarksville,Franklin,Murfreesboro,Brentwood,Johnson City,Jackson',
    TX:'Houston,San Antonio,Dallas,Austin,Fort Worth,El Paso,Arlington,Corpus Christi,Plano,Laredo,Lubbock,Irving,Garland,Frisco,McKinney,Amarillo,Grand Prairie,Brownsville,Round Rock,Waco,Richardson,The Woodlands,Sugar Land,Katy,Beaumont,Odessa,Midland,Tyler,College Station,Denton,Pasadena,Allen,Lewisville,Conroe,Abilene,Pearland,Cypress,Spring,Mesquite,Carrollton,Killeen,San Marcos,Texarkana,Wichita Falls,Victoria,Longview',
    UT:'Salt Lake City,Provo,West Valley City,Orem,Ogden,St. George,Lehi,Sandy,Logan,Draper',
    VT:'Burlington,Montpelier,Rutland',
    VA:'Virginia Beach,Richmond,Norfolk,Chesapeake,Arlington,Reston,McLean,Alexandria,Newport News,Fairfax,Herndon,Roanoke,Charlottesville,Lynchburg,Hampton,Tysons,Chantilly',
    WA:'Seattle,Spokane,Tacoma,Bellevue,Redmond,Kent,Everett,Vancouver,Olympia,Kirkland,Renton,Bellingham,Yakima',
    WV:'Charleston,Huntington,Morgantown,Parkersburg,Wheeling',
    WI:'Milwaukee,Madison,Green Bay,Kenosha,Appleton,Racine,Oshkosh,Waukesha,Eau Claire',
    WY:'Cheyenne,Casper,Laramie,Gillette'
  };

  var INDIA_STATES = 'Andhra Pradesh,Assam,Bihar,Chhattisgarh,Delhi,Goa,Gujarat,Haryana,Himachal Pradesh,Jharkhand,Karnataka,Kerala,Madhya Pradesh,Maharashtra,Odisha,Punjab,Rajasthan,Tamil Nadu,Telangana,Uttar Pradesh,Uttarakhand,West Bengal,Chandigarh,Puducherry';
  var INDIA_CITIES = 'Hyderabad,Bengaluru,Chennai,Mumbai,Delhi,New Delhi,Pune,Kolkata,Ahmedabad,Noida,Gurugram,Kochi,Thiruvananthapuram,Jaipur,Lucknow,Chandigarh,Indore,Coimbatore,Visakhapatnam,Nagpur,Bhubaneswar,Mysuru,Vadodara,Surat,Mangaluru,Kozhikode,Patna,Bhopal,Navi Mumbai,Thane,Ghaziabad,Faridabad,Vijayawada,Madurai,Nashik,Ranchi,Guwahati,Dehradun,Raipur,Jamshedpur,Tiruchirappalli,Visakhapatnam,Warangal,Secunderabad';

  // Every place, once: { label (what is written), keys (what it can be found by), kind }.
  var list = [];
  var norm = function(v){ return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  list.push({ label:'Remote', keys:'remote work from home anywhere', kind:'other' });
  list.push({ label:'United States', keys:'united states usa us america', kind:'country' });
  list.push({ label:'India', keys:'india', kind:'country' });
  Object.keys(STATES).forEach(function(ab){
    list.push({ label:STATES[ab], keys:ab.toLowerCase() + ' ' + STATES[ab].toLowerCase(), kind:'state', ab:ab });
  });
  Object.keys(CITIES).forEach(function(ab){
    CITIES[ab].split(',').forEach(function(c){
      if (ab === 'DC') { list.push({ label:'Washington, DC', keys:'washington dc d c district of columbia', kind:'city', ab:ab, city:'washington' }); return; }
      list.push({ label:c + ', ' + STATES[ab], keys:c.toLowerCase() + ' ' + ab.toLowerCase() + ' ' + STATES[ab].toLowerCase(), kind:'city', ab:ab, city:c.toLowerCase() });
    });
  });
  INDIA_STATES.split(',').forEach(function(s){ list.push({ label:s + ', India', keys:s.toLowerCase() + ' india', kind:'state', city:'' }); });
  var seenIndia = {};
  INDIA_CITIES.split(',').forEach(function(c){ if (seenIndia[c]) return; seenIndia[c] = 1; list.push({ label:c + ', India', keys:c.toLowerCase() + ' india', kind:'city', city:c.toLowerCase() }); });
  list.forEach(function(p, i){ p.norm = norm(p.label); p.knorm = norm(p.keys); p.i = i; });

  // The best matches for what was typed. Rank 0: the label starts with it; 1: a word in the label starts with it; 2: the typed
  // words are all found among the keys (so "austin tx", "tx austin" and "austin texas" all find Austin, Texas); then states before
  // cities, then the order the lists are written in (a state's bigger cities first). Anything already added is left out.
  function suggest(typed, max, skip){
    var q = norm(typed);
    if (!q) return [];
    var words = q.split(' '), have = {};
    (skip || []).forEach(function(s){ have[norm(s)] = 1; });
    var out = [];
    list.forEach(function(p){
      if (have[p.norm]) return;
      var rank = -1;
      if (p.norm.indexOf(q) === 0) rank = 0;
      else if (p.norm.split(' ').some(function(w){ return w.indexOf(q) === 0; }) || p.norm.indexOf(' ' + q) > -1) rank = 1;
      else if (words.every(function(w){ return p.knorm.split(' ').some(function(k){ return k === w || (w.length > 2 && k.indexOf(w) === 0); }); })) rank = 2;
      if (rank < 0) return;
      out.push({ p:p, rank:rank, state: p.kind === 'state' || p.kind === 'country' || p.kind === 'other' ? 0 : 1 });
    });
    out.sort(function(a, b){ return a.rank - b.rank || a.state - b.state || a.p.i - b.p.i; });   // then the list's own order: a state's big cities come first
    return out.slice(0, max > 0 ? max : 8).map(function(x){ return { label:x.p.label, kind:x.p.kind }; });
  }

  window.PLACES = { suggest:suggest, count:list.length };
})();
