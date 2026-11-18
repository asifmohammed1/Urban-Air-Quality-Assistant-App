import {
  analyzeForecastWindows,
  assessWinterInversionRisk,
  calculateChoiceImpact,
  getAqiSeverityMeta,
  haversineDistanceMeters,
  type AdvisorPlan,
  type AirQualitySnapshot,
  type CleanSanctuary,
  type GeoCoordinates,
  type HouseholdProfile,
  type HourlyAirQualityPoint,
  type HourlyWeatherPoint,
  type WeatherSnapshot,
} from '../shared/airQualityModel.ts';
import type { EnvironmentTelemetry } from '../hooks/useAirQualityDashboard.ts';

function degreesToCardinal(deg?: number): string {
  if (typeof deg !== 'number' || Number.isNaN(deg)) return 'CALM';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

function wmoCodeToCondition(code?: number): { text: string; type: string } {
  if (code === undefined) return { text: 'Clear', type: 'CLEAR' };
  if (code === 0) return { text: 'Clear sky', type: 'CLEAR' };
  if (code <= 3) return { text: 'Partly cloudy', type: 'PARTLY_CLOUDY' };
  if (code === 45 || code === 48) return { text: 'Fog / Winter Haze', type: 'FOG' };
  if (code >= 51 && code <= 67) return { text: 'Rain / Drizzle', type: 'RAIN' };
  if (code >= 71 && code <= 77) return { text: 'Snow', type: 'SNOW' };
  return { text: 'Cloudy', type: 'CLOUDY' };
}

/**
 * Browser-safe live Open-Meteo + OpenStreetMap fallback used if the /api backend
 * returns 404 (e.g., on a static-only host without serverless API routes).
 */
export async function fetchDirectBrowserTelemetry(
  coords: GeoCoordinates
): Promise<EnvironmentTelemetry> {
  const aqUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  aqUrl.searchParams.set('latitude', String(coords.lat));
  aqUrl.searchParams.set('longitude', String(coords.lng));
  aqUrl.searchParams.set(
    'current',
    'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide'
  );
  aqUrl.searchParams.set('hourly', 'us_aqi,pm2_5');
  aqUrl.searchParams.set('forecast_days', '2');
  aqUrl.searchParams.set('timezone', 'auto');

  const wxUrl = new URL('https://api.open-meteo.com/v1/forecast');
  wxUrl.searchParams.set('latitude', String(coords.lat));
  wxUrl.searchParams.set('longitude', String(coords.lng));
  wxUrl.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code,is_day'
  );
  wxUrl.searchParams.set(
    'hourly',
    'temperature_2m,wind_speed_10m,relative_humidity_2m,precipitation_probability'
  );
  wxUrl.searchParams.set('forecast_days', '2');
  wxUrl.searchParams.set('timezone', 'auto');

  const overpassQuery = `[out:json][timeout:6];(node["amenity"~"^(library|community_centre|pharmacy)$"](around:3500,${coords.lat},${coords.lng});node["tourism"="museum"](around:3500,${coords.lat},${coords.lng});node["railway"~"^(station|subway_entrance)$"](around:3500,${coords.lat},${coords.lng}););out body 12;`;

  const [aqRes, wxRes, osmRes] = await Promise.all([
    fetch(aqUrl.toString()),
    fetch(wxUrl.toString()),
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    }).catch(() => null),
  ]);

  if (!aqRes.ok) {
    throw new Error('Unable to load live air quality telemetry.');
  }

  const aqRaw = (await aqRes.json()) as {
    current?: {
      time?: string;
      us_aqi?: number;
      pm2_5?: number;
      pm10?: number;
      nitrogen_dioxide?: number;
      ozone?: number;
      carbon_monoxide?: number;
      sulphur_dioxide?: number;
    };
    hourly?: {
      time?: string[];
      us_aqi?: Array<number | null>;
      pm2_5?: Array<number | null>;
    };
  };

  const cur = aqRaw.current ?? {};
  const usAqi = Math.round(cur.us_aqi ?? 50);
  const pm25 = Number(cur.pm2_5 ?? 12);
  const pm10 = Number(cur.pm10 ?? 20);
  const no2 = Number(cur.nitrogen_dioxide ?? 15);
  const o3 = Number(cur.ozone ?? 40);
  const co = Number(cur.carbon_monoxide ?? 250);
  const so2 = Number(cur.sulphur_dioxide ?? 5);
  const meta = getAqiSeverityMeta(usAqi, true);

  const airQuality: AirQualitySnapshot = {
    dateTime: cur.time ? new Date(cur.time).toISOString() : new Date().toISOString(),
    regionCode: 'global',
    universalAqi: {
      code: 'us_epa',
      displayName: 'US EPA AQI',
      aqi: usAqi,
      aqiDisplay: String(usAqi),
      category: meta.level,
      dominantPollutant: pm25 >= 15 ? 'pm25' : 'pm10',
      colorHex: meta.hex,
    },
    localAqi: null,
    pollutants: [
      { code: 'pm25', displayName: 'PM2.5', fullName: 'Fine particulate matter (<2.5 µm)', value: pm25, units: 'MICROGRAMS_PER_CUBIC_METER' },
      { code: 'pm10', displayName: 'PM10', fullName: 'Inhalable particulate matter (<10 µm)', value: pm10, units: 'MICROGRAMS_PER_CUBIC_METER' },
      { code: 'no2', displayName: 'NO2', fullName: 'Nitrogen dioxide', value: no2, units: 'MICROGRAMS_PER_CUBIC_METER' },
      { code: 'o3', displayName: 'O3', fullName: 'Ground-level ozone', value: o3, units: 'MICROGRAMS_PER_CUBIC_METER' },
      { code: 'co', displayName: 'CO', fullName: 'Carbon monoxide', value: co, units: 'MICROGRAMS_PER_CUBIC_METER' },
      { code: 'so2', displayName: 'SO2', fullName: 'Sulfur dioxide', value: so2, units: 'MICROGRAMS_PER_CUBIC_METER' },
    ],
    healthRecommendations: {
      generalPopulation: meta.maskAdvice,
    },
    dataSource: 'Open-Meteo CAMS Atmospheric Model',
  };

  const nowMs = Date.now();
  const aqForecast: HourlyAirQualityPoint[] = [];
  const aqTimes = aqRaw.hourly?.time ?? [];
  const aqVals = aqRaw.hourly?.us_aqi ?? [];
  for (let i = 0; i < aqTimes.length && aqForecast.length < 24; i++) {
    const tMs = new Date(aqTimes[i]).getTime();
    if (!Number.isNaN(tMs) && tMs < nowMs - 3600000) continue;
    const val = typeof aqVals[i] === 'number' ? Math.round(aqVals[i]!) : usAqi;
    aqForecast.push({
      dateTime: new Date(aqTimes[i]).toISOString(),
      aqi: val,
      category: getAqiSeverityMeta(val, true).level,
      dominantPollutant: 'pm25',
    });
  }

  let weather: WeatherSnapshot | null = null;
  const wxForecast: HourlyWeatherPoint[] = [];
  if (wxRes.ok) {
    const wxRaw = (await wxRes.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        pressure_msl?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
        weather_code?: number;
        is_day?: number;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: Array<number | null>;
        wind_speed_10m?: Array<number | null>;
        relative_humidity_2m?: Array<number | null>;
        precipitation_probability?: Array<number | null>;
      };
    };
    const w = wxRaw.current ?? {};
    const cond = wmoCodeToCondition(w.weather_code);
    weather = {
      currentTime: w.time ? new Date(w.time).toISOString() : new Date().toISOString(),
      conditionText: cond.text,
      conditionType: cond.type,
      temperatureC: w.temperature_2m ?? 18,
      feelsLikeC: w.apparent_temperature ?? w.temperature_2m ?? 18,
      relativeHumidity: Math.round(w.relative_humidity_2m ?? 50),
      windSpeedKmh: w.wind_speed_10m ?? 8,
      windDirectionCardinal: degreesToCardinal(w.wind_direction_10m),
      pressureHpa: w.pressure_msl ?? 1015,
      visibilityKm: 10,
      isDaytime: w.is_day !== 0,
    };
    const wTimes = wxRaw.hourly?.time ?? [];
    for (let i = 0; i < wTimes.length && wxForecast.length < 24; i++) {
      const tMs = new Date(wTimes[i]).getTime();
      if (!Number.isNaN(tMs) && tMs < nowMs - 3600000) continue;
      wxForecast.push({
        startTime: new Date(wTimes[i]).toISOString(),
        temperatureC: wxRaw.hourly?.temperature_2m?.[i] ?? weather.temperatureC,
        windSpeedKmh: wxRaw.hourly?.wind_speed_10m?.[i] ?? weather.windSpeedKmh,
        relativeHumidity: Math.round(wxRaw.hourly?.relative_humidity_2m?.[i] ?? weather.relativeHumidity),
        precipitationPercent: Math.round(wxRaw.hourly?.precipitation_probability?.[i] ?? 0),
      });
    }
  }

  const sanctuaries: CleanSanctuary[] = [];
  if (osmRes && osmRes.ok) {
    try {
      const osmRaw = (await osmRes.json()) as {
        elements?: Array<{ id: number; lat?: number; lon?: number; tags?: Record<string, string> }>;
      };
      const seen = new Set<string>();
      for (const el of osmRaw.elements ?? []) {
        if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
        const name = el.tags?.name || el.tags?.['name:en'];
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        sanctuaries.push({
          id: `osm-${el.id}`,
          name,
          address: el.tags?.['addr:street'] || el.tags?.['addr:suburb'] || `${el.lat.toFixed(4)}, ${el.lon.toFixed(4)}`,
          category: el.tags?.amenity === 'library' ? 'Public Library' : el.tags?.amenity === 'pharmacy' ? 'Pharmacy' : 'Clean-Air Hub',
          lat: el.lat,
          lng: el.lon,
          openNow: null,
          mapsUri: `https://www.openstreetmap.org/?mlat=${el.lat}&mlon=${el.lon}#map=16/${el.lat}/${el.lon}`,
          distanceMeters: haversineDistanceMeters(coords, { lat: el.lat, lng: el.lon }),
        });
      }
      sanctuaries.sort((a, b) => a.distanceMeters - b.distanceMeters);
    } catch {
      // Ignore Overpass parse failure
    }
  }

  const inversionRisk = assessWinterInversionRisk(weather, airQuality);
  const forecastWindows = analyzeForecastWindows(aqForecast, wxForecast, 'us_epa');

  return {
    resolvedAddress: `${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`,
    airQuality,
    weather,
    inversionRisk,
    forecastWindows,
    sanctuaries: sanctuaries.slice(0, 8),
  };
}

export async function geocodeDirectBrowser(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string }> {
  const omUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  omUrl.searchParams.set('name', address);
  omUrl.searchParams.set('count', '1');
  omUrl.searchParams.set('language', 'en');
  omUrl.searchParams.set('format', 'json');
  const res = await fetch(omUrl.toString());
  if (!res.ok) throw new Error('Unable to locate that city.');
  const raw = (await res.json()) as {
    results?: Array<{ name?: string; admin1?: string; country?: string; latitude?: number; longitude?: number }>;
  };
  const m = raw.results?.[0];
  if (!m || typeof m.latitude !== 'number' || typeof m.longitude !== 'number') {
    throw new Error('Location not found. Try a city name.');
  }
  return {
    lat: m.latitude,
    lng: m.longitude,
    formattedAddress: [m.name, m.admin1, m.country].filter(Boolean).join(', ') || address,
  };
}

export function buildBrowserFallbackPlan(params: {
  locationName: string;
  profile: HouseholdProfile;
  pm25UgM3: number;
  aqi: number;
  cleanWindow: string | null;
  peakWindow: string | null;
  inversionSummary: string;
}): AdvisorPlan {
  const cleanWin = params.cleanWindow ?? '1:00 PM – 3:00 PM';
  const peakWin = params.peakWindow ?? '7:00 PM – 10:00 PM';
  const impact = calculateChoiceImpact(params.profile, params.pm25UgM3, {
    adoptTransitOrWalk: true,
    adoptTimedVentilationAndFiltration: true,
    adoptElectricCookingOrHeating: true,
    wearN95DuringPeak: true,
  });

  return {
    headline: `Protect ${params.profile.householdName} in ${params.locationName} by ventilating during ${cleanWin} and sealing windows before ${peakWin}.`,
    winterSmogSummary: `${params.locationName} is at AQI ${Math.round(params.aqi)} with PM2.5 at ${params.pm25UgM3.toFixed(1)} µg/m³. ${params.inversionSummary}`,
    dailyRoutines: [
      {
        timeWindow: `Peak Trap (${peakWin})`,
        title: 'Seal Drafts & Run Continuous Filtration',
        guidance: `Keep windows shut and run ${params.profile.filtrationLevel.replace('_', ' ')} filtration in bedrooms.`,
        emissionImpact: 'Reduces overnight space-heating heat loss',
        exposureImpact: `Cuts indoor PM2.5 by ~${impact.estimatedIndoorPm25DropPct}%`,
        priority: 'critical',
      },
      {
        timeWindow: `Cleanest Window (${cleanWin})`,
        title: 'Timed 15-Minute Cross-Ventilation',
        guidance: 'Open opposite windows briefly when outdoor air disperses best, then close before cooling.',
        emissionImpact: 'Zero mechanical ventilation energy',
        exposureImpact: 'Flushes indoor CO2 and cooking fumes safely',
        priority: 'recommended',
      },
      {
        timeWindow: 'Morning & Evening Commute',
        title: 'Low-Emission Transit & KN95/N95 Masking',
        guidance: `Shift ${params.profile.dailyCommuteKm} km daily trips away from idling cars when haze spikes.`,
        emissionImpact: `Avoids ~${impact.dailyCo2SavedGrams.toLocaleString()} g CO2e/day`,
        exposureImpact: `Cuts peak inhaled PM2.5 by ~${impact.pm25InhalationReductionPct}%`,
        priority: 'critical',
      },
      {
        timeWindow: 'Meal Preparation',
        title: 'Clean-Kitchen Exhaust & Induction',
        guidance: 'Use electric kettle/induction where possible and run exhaust hoods during high-heat cooking.',
        emissionImpact: 'Eliminates indoor combustion NO2 spikes',
        exposureImpact: `Keeps indoor baseline near ${impact.estimatedIndoorPm25UgM3} µg/m³`,
        priority: 'recommended',
      },
    ],
    indoorHacks: [
      {
        title: 'Continuous Bedroom Clean-Air Zone',
        mechanism: 'MERV-13 / HEPA filtration captures 85–99% of fine combustion aerosols without ozone.',
        actionSteps: [
          `Size airflow for your ${params.profile.homeSizeSqM} m² home.`,
          'Place units 60 cm from walls and run continuously on medium.',
        ],
        directImpact: `-${impact.estimatedIndoorPm25DropPct}% indoor PM2.5`,
        estimatedCostTier: 'Low-Cost',
      },
      {
        title: 'Door & Window Perimeter Sealing',
        mechanism: 'Stops cold polluted outdoor air from seeping in during evening temperature inversions.',
        actionSteps: ['Check door sweeps and window tracks for drafts.', 'Add foam weatherstripping or door stoppers.'],
        directImpact: '25–35% lower smog infiltration',
        estimatedCostTier: 'Free',
      },
      {
        title: 'Damp Microfiber Cleaning',
        mechanism: 'Prevents settled street particulate dust from resuspending indoors.',
        actionSteps: ['Wipe sills with damp cloths every 2–3 days.', 'Leave outdoor shoes at the entrance.'],
        directImpact: 'Avoids 20–40 µg/m³ indoor dust spikes',
        estimatedCostTier: 'Free',
      },
    ],
    sustainableSwaps: [
      {
        currentHabit: `${params.profile.dailyCommuteKm} km/day by ${params.profile.commuteMode.replace('_', ' ')}`,
        sustainableAlternative: 'Metro, bus, walking, or batched errands',
        directHealthBenefit: 'Avoids concentrated cabin exhaust during cold-start idling.',
        emissionReduction: `Saves ~${impact.dailyCo2SavedGrams.toLocaleString()} g CO2e & ${impact.dailyNoxSavedGrams} g NOx/day`,
        feasibilityNote: 'Combining errands avoids multiple cold engine starts.',
      },
      {
        currentHabit: `Cooking/heating via ${params.profile.heatingSource.replace('_', ' ')}`,
        sustainableAlternative: 'Electric kettle, induction burner & pressure cooker',
        directHealthBenefit: 'Eliminates indoor NO2 and ultrafine cooking aerosols.',
        emissionReduction: '40–70% lower indoor combustion pollution',
        feasibilityNote: 'Single portable induction units work on standard outlets.',
      },
      {
        currentHabit: 'Unsealed outdoor walks at peak smog',
        sustainableAlternative: 'Fitted KN95/N95 masks rotated in paper bags',
        directHealthBenefit: 'Blocks ≥95% of fine winter smog particles.',
        emissionReduction: 'Rotating 4 masks reduces disposable waste by 75%',
        feasibilityNote: 'Press nose clip snugly before stepping outside.',
      },
    ],
    communityAction: `Organize a no-idling school drop-off pledge with neighbors in ${params.locationName} and share daily ${cleanWin} clean-window alerts.`,
    generatedAt: new Date().toISOString(),
  };
}
