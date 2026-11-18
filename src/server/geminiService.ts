import { GoogleGenAI, Type, type Schema } from '@google/genai';
import {
  calculateChoiceImpact,
  type AdvisorPlan,
  type GeoCoordinates,
  type HouseholdProfile,
  type IndoorHack,
  type RoutineRecommendation,
  type SustainableSwap,
} from '../shared/airQualityModel.ts';
import { TtlCache } from './cache.ts';

const planCache = new TtlCache<AdvisorPlan>(100, 15 * 60 * 1000);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface ActionPlanInput {
  locationName: string;
  coordinates: GeoCoordinates;
  householdProfile: HouseholdProfile;
  currentUaqi: number;
  aqiScale?: 'uaqi' | 'us_epa';
  currentCategory: string;
  dominantPollutant: string;
  pm25UgM3: number;
  no2Ppb: number;
  inversionSeverity: string;
  inversionSummary: string;
  cleanestWindowLabel: string | null;
  peakSmogWindowLabel: string | null;
  windSpeedKmh: number;
  temperatureC: number;
}

const ACTION_PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    headline: {
      type: Type.STRING,
      description: 'Concise 1-sentence actionable summary tailored to the family and local air quality.',
    },
    winterSmogSummary: {
      type: Type.STRING,
      description: '2-3 sentence explanation of why local air quality behaves this way today (winter inversion, pollutants, weather) and who is most affected.',
    },
    dailyRoutines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timeWindow: { type: Type.STRING },
          title: { type: Type.STRING },
          guidance: { type: Type.STRING },
          emissionImpact: { type: Type.STRING },
          exposureImpact: { type: Type.STRING },
          priority: { type: Type.STRING, enum: ['critical', 'recommended', 'optional'] },
        },
        required: ['timeWindow', 'title', 'guidance', 'emissionImpact', 'exposureImpact', 'priority'],
      },
    },
    indoorHacks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          mechanism: { type: Type.STRING },
          actionSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          directImpact: { type: Type.STRING },
          estimatedCostTier: { type: Type.STRING, enum: ['Free', 'Low-Cost', 'Upgrade'] },
        },
        required: ['title', 'mechanism', 'actionSteps', 'directImpact', 'estimatedCostTier'],
      },
    },
    sustainableSwaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          currentHabit: { type: Type.STRING },
          sustainableAlternative: { type: Type.STRING },
          directHealthBenefit: { type: Type.STRING },
          emissionReduction: { type: Type.STRING },
          feasibilityNote: { type: Type.STRING },
        },
        required: [
          'currentHabit',
          'sustainableAlternative',
          'directHealthBenefit',
          'emissionReduction',
          'feasibilityNote',
        ],
      },
    },
    communityAction: {
      type: Type.STRING,
      description: 'One practical neighborhood or school-community step to reduce local winter emissions.',
    },
  },
  required: [
    'headline',
    'winterSmogSummary',
    'dailyRoutines',
    'indoorHacks',
    'sustainableSwaps',
    'communityAction',
  ],
};

/**
 * Generates varied, telemetry-grounded household plans when Gemini quota/rate-limits
 * are reached so families always receive actionable guidance with zero errors.
 */
function buildAdaptiveLocalActionPlan(input: ActionPlanInput): AdvisorPlan {
  const { householdProfile: prof } = input;
  const cleanWin = input.cleanestWindowLabel ?? '1:00 PM – 3:00 PM';
  const peakWin = input.peakSmogWindowLabel ?? '7:00 PM – 10:00 PM';
  const impact = calculateChoiceImpact(prof, input.pm25UgM3, {
    adoptTransitOrWalk: true,
    adoptTimedVentilationAndFiltration: true,
    adoptElectricCookingOrHeating: true,
    wearN95DuringPeak: true,
  });

  const sensitiveLabel =
    prof.sensitiveGroups.length > 0
      ? prof.sensitiveGroups.join(' & ')
      : 'all household members';
  const scaleLabel = input.aqiScale === 'us_epa' ? 'US EPA AQI' : 'Universal AQI';
  const whoRatio = Math.max(0.2, input.pm25UgM3 / 15).toFixed(1);
  const purifierCadr = Math.round(prof.homeSizeSqM * 4.5);

  const headlines = [
    `Protect ${prof.householdName} in ${input.locationName} by scheduling outdoor errands during ${cleanWin} and filtering indoor air through ${peakWin}.`,
    `With PM2.5 at ${input.pm25UgM3.toFixed(1)} µg/m³ in ${input.locationName}, shift trips to ${cleanWin} and cut indoor particulates by up to ${impact.estimatedIndoorPm25DropPct}%.`,
    `Keep ${sensitiveLabel} safe in ${input.locationName} today: seal drafts before ${peakWin} and use zero-tailpipe travel for your ${prof.dailyCommuteKm} km routine.`,
  ];

  const summaries = [
    `${input.locationName} currently reads ${scaleLabel} ${Math.round(input.currentUaqi)} (${input.currentCategory}) with PM2.5 at ${input.pm25UgM3.toFixed(1)} µg/m³ (${whoRatio}× the WHO 24-hour guideline). ${input.inversionSummary} Special care is advised for ${sensitiveLabel}.`,
    `At ${input.temperatureC.toFixed(1)}°C and ${input.windSpeedKmh.toFixed(0)} km/h wind, ${input.inversionSeverity.toLowerCase()} inversion trapping is concentrating ${input.dominantPollutant.toUpperCase()} near street level in ${input.locationName}. Timing ventilation to ${cleanWin} and running ${prof.filtrationLevel.replace('_', ' ')} filtration keeps indoor exposure near ${impact.estimatedIndoorPm25UgM3} µg/m³.`,
  ];

  const routinePool: RoutineRecommendation[] = [
    {
      timeWindow: 'Morning Rush (7:00 AM – 9:30 AM)',
      title: 'Low-Exposure School & Commute Dispatch',
      guidance:
        prof.commuteMode === 'gas_car'
          ? `Combine errands or take metro/bus instead of cold-starting your car for today's ${prof.dailyCommuteKm} km trip; equip ${sensitiveLabel} with fitted KN95/N95 masks.`
          : `Stick to quieter residential side streets away from arterial traffic and wear a snug KN95/N95 respirator if haze lingers.`,
      emissionImpact: `Avoids ~${impact.dailyCo2SavedGrams.toLocaleString()} g CO2e and ${impact.dailyNoxSavedGrams} g NOx`,
      exposureImpact: `Cuts peak roadside PM2.5 inhalation by ~${impact.pm25InhalationReductionPct}%`,
      priority: 'critical',
    },
    {
      timeWindow: `Cleanest Window (${cleanWin})`,
      title: '15-Minute Cross-Ventilation & Fresh Errands',
      guidance:
        'Open opposite windows briefly to flush indoor CO2 and cooking VOCs when outdoor dispersion peaks, then close and latch windows before afternoon cooling.',
      emissionImpact: 'Zero energy penalty compared to mechanical ventilation',
      exposureImpact: 'Refreshes indoor oxygen while keeping PM2.5 buildup minimal',
      priority: 'recommended',
    },
    {
      timeWindow: 'Cooking & Evening Prep (5:30 PM – 7:30 PM)',
      title: 'Clean-Kitchen Exhaust & Particle Capture',
      guidance:
        prof.heatingSource === 'electric_heat_pump'
          ? 'Run your range hood on medium-high and keep a portable HEPA unit in the adjacent living area while simmering or frying.'
          : 'Favor electric kettle, induction burner, or pressure cooker over open gas/solid fuel flames to avoid indoor NO2 and ultrafine spikes.',
      emissionImpact: 'Eliminates indoor combustion NO2 spikes (~18% lower indoor particulate load)',
      exposureImpact: `Protects indoor baseline near ${impact.estimatedIndoorPm25UgM3} µg/m³`,
      priority: 'recommended',
    },
    {
      timeWindow: `Peak Smog Trap (${peakWin})`,
      title: 'Clean-Room Lockdown & Nighttime Filtration',
      guidance: `Keep ${prof.householdSize} family members indoors in your main sleeping zone (${Math.round(prof.homeSizeSqM * 0.35)} m² clean room), place damp towels or weatherstripping along drafty door sweeps, and run filtration continuously.`,
      emissionImpact: 'Reduces HVAC thermal loss via draft sealing',
      exposureImpact: `Lowers overnight indoor PM2.5 by ${impact.estimatedIndoorPm25DropPct}%`,
      priority: 'critical',
    },
    {
      timeWindow: 'Midday Check-In (12:00 PM – 2:00 PM)',
      title: 'Outdoor Play & Senior Walk Verification',
      guidance:
        input.pm25UgM3 > 35
          ? 'Keep outdoor walks under 20 minutes in tree-lined parks away from intersections and watch for throat irritation.'
          : 'Ideal window for brisk walking and stroller outings away from main avenues.',
      emissionImpact: 'Replaces short midday car trips with zero-emission walking',
      exposureImpact: 'Avoids stagnant morning and evening plume peaks',
      priority: 'optional',
    },
  ];

  const indoorPool: IndoorHack[] = [
    {
      title:
        prof.filtrationLevel === 'diy_merv13'
          ? 'Optimize Your DIY MERV-13 Box-Fan Cube'
          : prof.filtrationLevel === 'hepa_purifier'
            ? `Position HEPA Unit for ${purifierCadr} m³/h Clean Air Delivery`
            : 'Build a 4-Filter Corsi-Rosenthal MERV-13 Cube',
      mechanism:
        'High-surface-area MERV-13 / H13 pleated media captures 85–99% of PM2.5 combustion aerosols on every pass without generating ozone.',
      actionSteps: [
        `Target ${purifierCadr} m³/h total airflow (~4.5 air changes/hour) across your ${prof.homeSizeSqM} m² home.`,
        'Place the unit 60 cm away from walls in the room where sensitive family members spend the most hours.',
        'Run on medium speed continuously rather than toggling off at night.',
      ],
      directImpact: `Lowers indoor PM2.5 by ${impact.estimatedIndoorPm25DropPct}% (to ~${impact.estimatedIndoorPm25UgM3} µg/m³)`,
      estimatedCostTier: prof.filtrationLevel === 'none' ? 'Low-Cost' : 'Free',
    },
    {
      title: 'Door-Sweep & Window-Sash Draft Sealing',
      mechanism:
        'During winter temperature inversions, pressure differentials pull cold polluted street air through 2–4 mm perimeter gaps.',
      actionSteps: [
        'Check exterior door bottoms and sliding window tracks with a tissue strip for air leaks.',
        'Apply peel-and-stick foam tape or rolled draft stoppers before evening cooling starts.',
        'Close fireplace dampers and unused exhaust vents tightly.',
      ],
      directImpact: 'Cuts outdoor smog infiltration rate by 25–35% overnight',
      estimatedCostTier: 'Free',
    },
    {
      title: 'Wet-Dusting & Zero-Smoke Surface Care',
      mechanism:
        'Dry sweeping and vacuuming without HEPA exhaust resuspends settled PM2.5 back into children’s breathing height.',
      actionSteps: [
        'Use damp microfiber cloths on window sills and floors every 2–3 days.',
        'Skip incense, scented candles, and aerosol sprays during smog episodes.',
        'Leave outdoor shoes at the entry mat to stop tracked brake/tire dust.',
      ],
      directImpact: 'Prevents indoor resuspended particle spikes of 20–40 µg/m³',
      estimatedCostTier: 'Free',
    },
    {
      title: 'Positive-Pressure Bedroom Clean Zone',
      mechanism:
        'Concentrating filtration inside one sealed sleeping room raises air changes per hour (ACH) to 6+ during severe haze.',
      actionSteps: [
        'Close bedroom doors after 8:00 PM and keep the air purifier beside the head of the bed.',
        'Keep indoor humidity between 40–55% to support airway clearance without mold growth.',
      ],
      directImpact: 'Protects children and older adults during 8 hours of sleep',
      estimatedCostTier: 'Low-Cost',
    },
  ];

  const swapPool: SustainableSwap[] = [
    {
      currentHabit: `${prof.dailyCommuteKm} km/day by ${prof.commuteMode.replace('_', ' ')}`,
      sustainableAlternative:
        prof.commuteMode === 'walk_bike' || prof.commuteMode === 'public_transit'
          ? 'Keep transit/walking habit and shift timing to cleanest midday corridor'
          : 'Shift 3+ weekly trips to Metro/bus, e-bike, or carpool',
      directHealthBenefit: 'Avoids concentrated cabin exhaust from stop-and-go winter idling.',
      emissionReduction: `Saves ~${impact.dailyCo2SavedGrams.toLocaleString()} g CO2e & ${impact.dailyNoxSavedGrams} g NOx daily`,
      feasibilityNote: 'Trip-chaining errands cuts cold-start tailpipe emissions where catalytic converters are least effective.',
    },
    {
      currentHabit: `Primary heating/cooking via ${prof.heatingSource.replace('_', ' ')}`,
      sustainableAlternative:
        prof.heatingSource === 'electric_heat_pump'
          ? 'Pair heat pump with smart setback & induction simmering'
          : 'Use induction/electric kettle & pressure cooker for high-heat meals',
      directHealthBenefit: 'Eliminates indoor NO2, CO, and ultrafine combustion aerosols in the kitchen.',
      emissionReduction: 'Cuts household winter combustion PM2.5 & NO2 by 40–70%',
      feasibilityNote: 'A single portable induction burner handles boiling and stir-frying for minimal cost.',
    },
    {
      currentHabit: 'All-day window cracking for fresh air',
      sustainableAlternative: `Timed 15-min purge strictly during ${cleanWin}`,
      directHealthBenefit: 'Prevents continuous PM2.5 seepage while still clearing indoor CO2.',
      emissionReduction: 'Reduces winter space-heating energy demand by 8–12%',
      feasibilityNote: 'Set a daily phone reminder matching the cleanest forecast block.',
    },
    {
      currentHabit: 'Single-use cloth masks or unsealed commutes',
      sustainableAlternative: 'Reusable elastomeric or fitted KN95/N95 masks rotated every 5 days',
      directHealthBenefit: 'Filters >=95% of 0.3–2.5 µm winter smog particles during peak rush hour.',
      emissionReduction: 'Rotating 4 N95s in paper bags cuts disposable mask waste by 75%',
      feasibilityNote: 'Press the nose bridge wire firmly to stop eyewear fogging and side leaks.',
    },
  ];

  const communityActions = [
    `Coordinate a "No-Idling School Drop-Off" pledge with neighboring families in ${input.locationName} so car engines turn off while waiting.`,
    `Share daily clean-air window alerts (${cleanWin}) in your neighborhood or parent group so outdoor sports avoid peak ${peakWin} smog.`,
    `Organize a neighborhood bulk buy for MERV-13 filters and box fans to equip elderly residents and local classrooms in ${input.locationName}.`,
  ];

  return {
    headline: pickRandom(headlines),
    winterSmogSummary: pickRandom(summaries),
    dailyRoutines: shuffleArray(routinePool).slice(0, 4),
    indoorHacks: shuffleArray(indoorPool).slice(0, 3),
    sustainableSwaps: shuffleArray(swapPool).slice(0, 3),
    communityAction: pickRandom(communityActions),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a structured, personalized family air-quality & low-emission plan
 * grounded in live air quality, winter inversion telemetry, and household profile.
 * Automatically falls back to adaptive local synthesis on Gemini quota/rate limits.
 */
export async function generateHouseholdActionPlan(
  input: ActionPlanInput
): Promise<AdvisorPlan> {
  const activeScale = input.aqiScale ?? 'uaqi';
  const cacheKey = JSON.stringify({
    loc: input.locationName,
    uaqi: Math.round(input.currentUaqi),
    scale: activeScale,
    pm25: Math.round(input.pm25UgM3),
    inv: input.inversionSeverity,
    prof: input.householdProfile,
  });

  const cached = planCache.get(cacheKey);
  if (cached) return cached;

  const ai = getGeminiClient();
  if (!ai) {
    return buildAdaptiveLocalActionPlan(input);
  }

  const aqiDescription =
    activeScale === 'us_epa'
      ? `US EPA AQI: ${input.currentUaqi} (${input.currentCategory}) — Note: US EPA scale 0 = good, 500 = hazardous`
      : `Universal AQI: ${input.currentUaqi} (${input.currentCategory}) — Note: UAQI scale 100 = cleanest, 0 = poorest`;

  const prompt = `
You are ClearHearth, an environmental health & low-emission family advisor specializing in severe winter smog and urban air pollution.

LIVE LOCAL CONDITIONS FOR ${input.locationName}:
- ${aqiDescription}
- Dominant Pollutant: ${input.dominantPollutant.toUpperCase()}
- PM2.5 Concentration: ${input.pm25UgM3.toFixed(1)} µg/m³ (WHO 24h guideline is 15 µg/m³)
- NO2 Concentration: ${input.no2Ppb.toFixed(1)} ppb/µg/m³
- Temperature: ${input.temperatureC.toFixed(1)}°C | Wind: ${input.windSpeedKmh.toFixed(1)} km/h
- Winter Inversion Risk: ${input.inversionSeverity} — ${input.inversionSummary}
- Cleanest Forecast Window: ${input.cleanestWindowLabel ?? 'Midday afternoon window'}
- Peak Smog Risk Window: ${input.peakSmogWindowLabel ?? 'Evening commute and overnight cooling'}

HOUSEHOLD PROFILE:
- Household: ${input.householdProfile.householdName} (${input.householdProfile.householdSize} people, ${input.householdProfile.homeSizeSqM} m² home)
- Vulnerable / Sensitive Groups: ${input.householdProfile.sensitiveGroups.join(', ') || 'None specified'}
- Daily Commute: ${input.householdProfile.commuteMode} (${input.householdProfile.dailyCommuteKm} km/day)
- Home Heating / Cooking: ${input.householdProfile.heatingSource}
- Air Filtration Setup: ${input.householdProfile.filtrationLevel}

REQUIREMENTS:
1. Create 4 time-windowed Daily Routines aligned with the cleanest and peak smog forecast windows.
2. Create 3 practical Indoor Air Quality Hacks specific to their ${input.householdProfile.homeSizeSqM} m² home, ${input.householdProfile.heatingSource} heating/cooking, and ${input.householdProfile.filtrationLevel} setup (include concrete CADR / air-change / PM2.5 % reduction numbers).
3. Create 3 Sustainable Alternatives tailored to their ${input.householdProfile.commuteMode} (${input.householdProfile.dailyCommuteKm} km/day) and heating setup, clearly quantifying BOTH personal health protection AND direct emission reductions (grams CO2e / NOx / PM2.5 avoided).
4. Keep every item practical, non-alarmist, evidence-based, and directly usable by busy families.
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Respond strictly with valid JSON matching the schema. Keep strings concise, specific, and grounded in environmental health science.',
        responseMimeType: 'application/json',
        responseSchema: ACTION_PLAN_SCHEMA,
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return buildAdaptiveLocalActionPlan(input);
    }

    const parsed = JSON.parse(rawText) as Omit<AdvisorPlan, 'generatedAt'>;
    const result: AdvisorPlan = {
      ...parsed,
      generatedAt: new Date().toISOString(),
    };

    planCache.set(cacheKey, result);
    return result;
  } catch {
    return buildAdaptiveLocalActionPlan(input);
  }
}

export interface GroundedSourceLink {
  title: string;
  uri: string;
  kind: 'web' | 'maps';
}

export interface AdvisorAnswer {
  markdown: string;
  sources: GroundedSourceLink[];
}

function buildAdaptiveLocalAnswer(params: {
  question: string;
  locationName: string;
  coordinates: GeoCoordinates;
  mode: 'search_policy' | 'maps_sanctuaries';
  currentUaqi: number;
  aqiScale?: 'uaqi' | 'us_epa';
  pm25UgM3: number;
  householdSummary: string;
}): AdvisorAnswer {
  const q = params.question.toLowerCase();
  const aqiLabel = params.aqiScale === 'us_epa' ? 'US EPA AQI' : 'UAQI';
  const whoMult = Math.max(0.2, params.pm25UgM3 / 15).toFixed(1);

  if (params.mode === 'maps_sanctuaries' || q.includes('librar') || q.includes('sanctuar') || q.includes('transit')) {
    const tips = shuffleArray([
      `• **Public Libraries & Civic Centers:** These buildings maintain positive HVAC pressure with MERV-11 to MERV-13 filtration—ideal for 2–3 hour family breaks during peak haze in ${params.locationName}.`,
      `• **Electric Metro / Rail Stations:** Choosing metro or electric transit over arterial road driving shields children from roadside exhaust plumes while cutting cold-start NOx.`,
      `• **Timing Strategy:** Visit indoor sanctuaries near your home (${params.coordinates.lat.toFixed(3)}, ${params.coordinates.lng.toFixed(3)}) during rush-hour smog spikes, and inspect the Clean-Air Sanctuaries panel above for exact walking distances.`,
    ]);
    return {
      markdown: [
        `For **${params.locationName}** (currently **${aqiLabel} ${Math.round(params.currentUaqi)}**, PM2.5 **${params.pm25UgM3.toFixed(1)} µg/m³**, ${whoMult}× WHO limit) and your household (${params.householdSummary}):`,
        '',
        ...tips,
      ].join('\n'),
      sources: [
        {
          title: `Explore Clean-Air Spaces near ${params.locationName} (OpenStreetMap)`,
          uri: `https://www.openstreetmap.org/?mlat=${params.coordinates.lat}&mlon=${params.coordinates.lng}#map=14/${params.coordinates.lat}/${params.coordinates.lng}`,
          kind: 'maps',
        },
        {
          title: `View ${params.locationName} on Google Maps`,
          uri: `https://www.google.com/maps/search/public+library+transit/@${params.coordinates.lat},${params.coordinates.lng},14z`,
          kind: 'maps',
        },
      ],
    };
  }

  if (q.includes('box') || q.includes('merv') || q.includes('diy') || q.includes('filter')) {
    const steps = shuffleArray([
      'Use **four 20×20×1" MERV-13 pleated filters** taped into a cube with a 20-inch UL-listed box fan on top blowing **upward** (higher airflow and lower motor heat than a single filter).',
      'Seal all cardboard seam corners tightly with painter’s tape or duct tape so polluted air is forced through the MERV-13 media rather than bypassing gaps.',
      'Add a cardboard shroud covering the fan corners to eliminate backflow eddies, boosting Clean Air Delivery Rate (CADR) into the **450–650 CFM** range.',
      'Place the cube at least 50 cm from walls in the bedroom and run continuously on **Low or Medium** speed—quiet enough for sleep while cutting indoor PM2.5 by ~50–65%.',
    ]);
    return {
      markdown: [
        `For your home in **${params.locationName}** (PM2.5 **${params.pm25UgM3.toFixed(1)} µg/m³**), a DIY Corsi-Rosenthal MERV-13 cube is an effective, zero-ozone clean-air safeguard:`,
        '',
        ...steps.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n'),
      sources: [
        {
          title: 'US EPA Guide to Air Cleaners in the Home',
          uri: 'https://www.epa.gov/indoor-air-quality-iaq/air-cleaners-and-air-filters-home',
          kind: 'web',
        },
      ],
    };
  }

  const guidancePool = shuffleArray([
    `• **Respiratory Protection:** With PM2.5 at **${params.pm25UgM3.toFixed(1)} µg/m³** (${whoMult}× the WHO 24-hour guideline of 15 µg/m³), wear well-fitted **KN95 / N95 / FFP2** masks during outdoor commutes for sensitive groups (${params.householdSummary}).`,
    `• **School & Outdoor Recess:** When ${aqiLabel} enters Sensitive Risk or Unhealthy ranges, move vigorous outdoor sports indoors and keep necessary outdoor walks brief during the cleanest midday window.`,
    `• **Zero-Emission Routine Shifts:** Avoid outdoor burning, reduce car idling near schools, and switch stovetop cooking to electric/induction with exhaust ventilation to prevent indoor NO2 spikes.`,
    `• **Indoor Seal & Filtration:** Keep exterior windows latched during evening cooling inversions and run continuous HEPA or MERV-13 filtration in sleeping spaces.`,
  ]);

  return {
    markdown: [
      `Live local context for **${params.locationName}** (${aqiLabel} **${Math.round(params.currentUaqi)}**, PM2.5 **${params.pm25UgM3.toFixed(1)} µg/m³**):`,
      '',
      ...guidancePool.slice(0, 3),
    ].join('\n'),
    sources: [
      {
        title: 'WHO Global Air Quality Guidelines',
        uri: 'https://www.who.int/news-room/feature-stories/detail/what-are-the-who-air-quality-guidelines',
        kind: 'web',
      },
      {
        title: 'AirNow AQI & School Flag Guidance',
        uri: 'https://www.airnow.gov/aqi/aqi-basics/',
        kind: 'web',
      },
    ],
  };
}

/**
 * Answers community & family air quality questions using Gemini 4 Hydrogen
 * with Google Search grounding or Google Maps grounding, falling back cleanly
 * to adaptive telemetry-grounded guidance when rate-limited.
 */
export async function askAirAdvisor(params: {
  question: string;
  locationName: string;
  coordinates: GeoCoordinates;
  mode: 'search_policy' | 'maps_sanctuaries';
  currentUaqi: number;
  aqiScale?: 'uaqi' | 'us_epa';
  pm25UgM3: number;
  householdSummary: string;
}): Promise<AdvisorAnswer> {
  const ai = getGeminiClient();
  if (!ai) {
    return buildAdaptiveLocalAnswer(params);
  }

  try {
    if (params.mode === 'maps_sanctuaries') {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find indoor clean-air sanctuaries (such as public libraries, museums, community centers) and practical low-emission public transit hubs near ${params.locationName} for a family (${params.householdSummary}) during urban smog (PM2.5: ${params.pm25UgM3.toFixed(1)} µg/m³). Question: ${params.question}`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: params.coordinates.lat,
                longitude: params.coordinates.lng,
              },
            },
          },
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources: GroundedSourceLink[] = [];
      for (const chunk of chunks) {
        const mapsChunk = (chunk as { maps?: { uri?: string; title?: string } }).maps;
        if (mapsChunk?.uri) {
          sources.push({
            title: mapsChunk.title ?? 'View on Google Maps',
            uri: mapsChunk.uri,
            kind: 'maps',
          });
        }
      }

      return {
        markdown: response.text ?? buildAdaptiveLocalAnswer(params).markdown,
        sources,
      };
    }

    const aqiLabel = params.aqiScale === 'us_epa' ? 'US EPA AQI' : 'UAQI';
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Location: ${params.locationName} (${aqiLabel} ${params.currentUaqi}, PM2.5 ${params.pm25UgM3.toFixed(1)} µg/m³). Household context: ${params.householdSummary}. User question: ${params.question}. Provide concise, actionable, evidence-based guidance for families navigating winter smog, referencing current local air quality advisories or transit/clean-air programs where relevant.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: GroundedSourceLink[] = [];
    for (const chunk of chunks) {
      const webChunk = (chunk as { web?: { uri?: string; title?: string } }).web;
      if (webChunk?.uri) {
        sources.push({
          title: webChunk.title ?? webChunk.uri,
          uri: webChunk.uri,
          kind: 'web',
        });
      }
    }

    return {
      markdown: response.text ?? buildAdaptiveLocalAnswer(params).markdown,
      sources,
    };
  } catch {
    return buildAdaptiveLocalAnswer(params);
  }
}

/**
 * Generates an accessible WAV audio briefing using Gemini 3.8 Flash Lite TTS,
 * returning null when rate-limited so the client can seamlessly use Web Speech API.
 */
export async function synthesizeBriefingAudio(text: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: {
                style: 'Warm, calm, reassuring family health advisor',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
  } catch {
    return null;
  }
}
