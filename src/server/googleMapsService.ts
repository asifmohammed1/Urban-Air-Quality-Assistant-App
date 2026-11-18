import {
  getAqiSeverityMeta,
  haversineDistanceMeters,
  type AirQualitySnapshot,
  type AqiIndexMetric,
  type AqiScale,
  type CleanSanctuary,
  type GeoCoordinates,
  type HourlyAirQualityPoint,
  type HourlyWeatherPoint,
  type PollutantMetric,
  type WeatherSnapshot,
} from '../shared/airQualityModel.ts';
import { TtlCache } from './cache.ts';

const MAPS_ATTRIBUTION_HEADER = 'gmp_mcp_codeassist_v1_aistudio';
const REQUEST_TIMEOUT_MS = 10000;

const aqCache = new TtlCache<AirQualitySnapshot>(150, 10 * 60 * 1000);
const aqForecastCache = new TtlCache<{ points: HourlyAirQualityPoint[]; scale: AqiScale }>(
  150,
  20 * 60 * 1000
);
const weatherCache = new TtlCache<WeatherSnapshot>(150, 10 * 60 * 1000);
const weatherForecastCache = new TtlCache<HourlyWeatherPoint[]>(150, 20 * 60 * 1000);
const placesCache = new TtlCache<CleanSanctuary[]>(150, 15 * 60 * 1000);
const reverseGeocodeCache = new TtlCache<string>(200, 30 * 60 * 1000);

export class UpstreamApiError extends Error {
  readonly status: number;
  readonly isQuotaExceeded: boolean;

  constructor(message: string, status: number, isQuotaExceeded = false) {
    super(message);
    this.name = 'UpstreamApiError';
    this.status = status;
    this.isQuotaExceeded = isQuotaExceeded;
  }
}

export function getMapsApiKey(): string {
  return (
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
}

function rgbToHex(color?: { red?: number; green?: number; blue?: number }): string {
  if (!color) return '#0f766e';
  const normalize = (val?: number): number => {
    if (val === undefined) return 0;
    return val <= 1 ? Math.round(val * 255) : Math.round(val);
  };
  const r = normalize(color.red).toString(16).padStart(2, '0');
  const g = normalize(color.green).toString(16).padStart(2, '0');
  const b = normalize(color.blue).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

async function fetchMapsJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Maps-Solution-ID': MAPS_ATTRIBUTION_HEADER,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let errorMessage = `Google Maps Platform error (${response.status})`;
    let isQuotaExceeded = response.status === 429;
    try {
      const payload = (await response.json()) as {
        error?: { message?: string; status?: string };
      };
      if (payload?.error?.message) {
        errorMessage = payload.error.message;
      }
      if (payload?.error?.status === 'RESOURCE_EXHAUSTED') {
        isQuotaExceeded = true;
      }
    } catch {
      // Ignore unparseable body
    }
    throw new UpstreamApiError(errorMessage, response.status, isQuotaExceeded);
  }

  return (await response.json()) as T;
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function degreesToCardinal(deg?: number): string {
  if (typeof deg !== 'number' || Number.isNaN(deg)) return 'CALM';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

function wmoCodeToCondition(code?: number): { text: string; type: string } {
  if (code === undefined) return { text: 'Clear', type: 'CLEAR' };
  if (code === 0) return { text: 'Clear sky', type: 'CLEAR' };
  if (code <= 3) return { text: 'Partly cloudy', type: 'PARTLY_CLOUDY' };
  if (code === 45 || code === 48) return { text: 'Fog / Winter Haze', type: 'FOG' };
  if (code >= 51 && code <= 67) return { text: 'Rain / Drizzle', type: 'RAIN' };
  if (code >= 71 && code <= 77) return { text: 'Snow', type: 'SNOW' };
  if (code >= 80 && code <= 82) return { text: 'Rain showers', type: 'SHOWERS' };
  if (code >= 95) return { text: 'Thunderstorm', type: 'THUNDERSTORM' };
  return { text: 'Cloudy', type: 'CLOUDY' };
}

function buildUsEpaHealthRecommendations(usAqi: number): AirQualitySnapshot['healthRecommendations'] {
  if (usAqi <= 50) {
    return {
      generalPopulation: 'Air quality is satisfactory. Ideal time for natural cross-ventilation.',
      children: 'Safe for normal outdoor play and school recess.',
    };
  }
  if (usAqi <= 100) {
    return {
      generalPopulation: 'Moderate particulate load. Sensitive individuals should avoid heavy outdoor cardio near busy roads.',
      children: 'Keep high-exertion outdoor play short if coughing or wheezing occurs.',
    };
  }
  if (usAqi <= 150) {
    return {
      generalPopulation: 'Unhealthy for sensitive groups. Shift errands to cleaner midday hours.',
      children: 'Children, seniors, and asthma-prone residents should wear fitted KN95/N95 masks outdoors.',
    };
  }
  return {
    generalPopulation: 'Unhealthy urban smog level. Keep windows sealed, run indoor HEPA/MERV-13 filtration, and wear N95 outdoors.',
    children: 'Move children and older adults to filtered indoor spaces and avoid roadside exposure.',
  };
}

function selectDominantPollutant(pm25: number, pm10: number, no2: number, o3: number): string {
  const ratios = [
    { code: 'pm25', ratio: pm25 / 15 },
    { code: 'pm10', ratio: pm10 / 45 },
    { code: 'no2', ratio: no2 / 25 },
    { code: 'o3', ratio: o3 / 100 },
  ];
  ratios.sort((a, b) => b.ratio - a.ratio);
  return ratios[0].code;
}

/**
 * Fetches live Open-Meteo CAMS Air Quality current & 24h forecast (zero API key required).
 */
async function fetchOpenMeteoAirQualityBundle(
  coords: GeoCoordinates
): Promise<{ snapshot: AirQualitySnapshot; forecast: HourlyAirQualityPoint[] }> {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lng));
  url.searchParams.set(
    'current',
    'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide'
  );
  url.searchParams.set('hourly', 'us_aqi,pm2_5');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new UpstreamApiError(`Open-Meteo Air Quality error (${response.status})`, response.status);
  }

  interface OpenMeteoAqRaw {
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
  }

  const raw = (await response.json()) as OpenMeteoAqRaw;
  const cur = raw.current ?? {};
  const usAqi = Math.round(cur.us_aqi ?? 50);
  const pm25 = Number(cur.pm2_5 ?? 12);
  const pm10 = Number(cur.pm10 ?? 20);
  const no2 = Number(cur.nitrogen_dioxide ?? 15);
  const o3 = Number(cur.ozone ?? 40);
  const co = Number(cur.carbon_monoxide ?? 250);
  const so2 = Number(cur.sulphur_dioxide ?? 5);

  const meta = getAqiSeverityMeta(usAqi, true);
  const dominantPollutant = selectDominantPollutant(pm25, pm10, no2, o3);

  const usIndex: AqiIndexMetric = {
    code: 'us_epa',
    displayName: 'US EPA AQI',
    aqi: usAqi,
    aqiDisplay: String(usAqi),
    category: meta.level,
    dominantPollutant,
    colorHex: meta.hex,
  };

  const pollutants: PollutantMetric[] = [
    {
      code: 'pm25',
      displayName: 'PM2.5',
      fullName: 'Fine particulate matter (<2.5 µm)',
      value: pm25,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
    {
      code: 'pm10',
      displayName: 'PM10',
      fullName: 'Inhalable particulate matter (<10 µm)',
      value: pm10,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
    {
      code: 'no2',
      displayName: 'NO2',
      fullName: 'Nitrogen dioxide',
      value: no2,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
    {
      code: 'o3',
      displayName: 'O3',
      fullName: 'Ground-level ozone',
      value: o3,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
    {
      code: 'co',
      displayName: 'CO',
      fullName: 'Carbon monoxide',
      value: co,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
    {
      code: 'so2',
      displayName: 'SO2',
      fullName: 'Sulfur dioxide',
      value: so2,
      units: 'MICROGRAMS_PER_CUBIC_METER',
    },
  ];

  const snapshot: AirQualitySnapshot = {
    dateTime: cur.time ? new Date(cur.time).toISOString() : new Date().toISOString(),
    regionCode: 'global',
    universalAqi: usIndex,
    localAqi: null,
    pollutants,
    healthRecommendations: buildUsEpaHealthRecommendations(usAqi),
    dataSource: 'Open-Meteo CAMS Atmospheric Model',
  };

  const times = raw.hourly?.time ?? [];
  const aqis = raw.hourly?.us_aqi ?? [];
  const pm25s = raw.hourly?.pm2_5 ?? [];
  const nowMs = Date.now();
  const forecast: HourlyAirQualityPoint[] = [];

  for (let i = 0; i < times.length && forecast.length < 24; i++) {
    const tMs = new Date(times[i]).getTime();
    if (!Number.isNaN(tMs) && tMs < nowMs - 3600000) continue;
    const hAqi = typeof aqis[i] === 'number' ? Math.round(aqis[i]!) : usAqi;
    forecast.push({
      dateTime: new Date(times[i]).toISOString(),
      aqi: hAqi,
      category: getAqiSeverityMeta(hAqi, true).level,
      dominantPollutant,
      pm25Value: typeof pm25s[i] === 'number' ? pm25s[i]! : undefined,
    });
  }

  return { snapshot, forecast };
}

/**
 * Fetches current air quality conditions, falling back to live Open-Meteo CAMS
 * telemetry when Google Air Quality API is unconfigured or returns 403/unavailable.
 */
export async function fetchCurrentAirQuality(
  coords: GeoCoordinates
): Promise<AirQualitySnapshot> {
  const key = `aq:${coordKey(coords.lat, coords.lng)}`;
  const cached = aqCache.get(key);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey) {
    interface RawAqResponse {
      dateTime?: string;
      regionCode?: string;
      indexes?: Array<{
        code?: string;
        displayName?: string;
        aqi?: number;
        aqiDisplay?: string;
        category?: string;
        dominantPollutant?: string;
        color?: { red?: number; green?: number; blue?: number };
      }>;
      pollutants?: Array<{
        code?: string;
        displayName?: string;
        fullName?: string;
        concentration?: { value?: number; units?: string };
        additionalInfo?: { sources?: string; effects?: string };
      }>;
      healthRecommendations?: AirQualitySnapshot['healthRecommendations'];
    }

    try {
      const data = await fetchMapsJson<RawAqResponse>(
        `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            universalAqi: true,
            location: {
              latitude: coords.lat,
              longitude: coords.lng,
            },
            extraComputations: [
              'HEALTH_RECOMMENDATIONS',
              'DOMINANT_POLLUTANT_CONCENTRATION',
              'POLLUTANT_CONCENTRATION',
              'LOCAL_AQI',
              'POLLUTANT_ADDITIONAL_INFO',
            ],
            languageCode: 'en',
          }),
        }
      );

      const mapIndex = (
        idx?: NonNullable<RawAqResponse['indexes']>[number]
      ): AqiIndexMetric | null => {
        if (!idx || typeof idx.aqi !== 'number') return null;
        return {
          code: idx.code ?? 'uaqi',
          displayName: idx.displayName ?? 'Air Quality Index',
          aqi: idx.aqi,
          aqiDisplay: idx.aqiDisplay ?? String(idx.aqi),
          category: idx.category ?? 'Unavailable',
          dominantPollutant: idx.dominantPollutant ?? 'pm25',
          colorHex: rgbToHex(idx.color),
        };
      };

      const uaqiRaw = data.indexes?.find((i) => i.code === 'uaqi') ?? data.indexes?.[0];
      const localRaw = data.indexes?.find((i) => i.code !== 'uaqi') ?? null;

      const pollutants: PollutantMetric[] = (data.pollutants ?? []).map((p) => ({
        code: p.code ?? 'unknown',
        displayName: p.displayName ?? p.code?.toUpperCase() ?? 'Pollutant',
        fullName: p.fullName ?? p.displayName ?? 'Air Pollutant',
        value: typeof p.concentration?.value === 'number' ? p.concentration.value : 0,
        units: p.concentration?.units ?? 'MICROGRAMS_PER_CUBIC_METER',
        sources: p.additionalInfo?.sources,
        effects: p.additionalInfo?.effects,
      }));

      const snapshot: AirQualitySnapshot = {
        dateTime: data.dateTime ?? new Date().toISOString(),
        regionCode: data.regionCode ?? 'us',
        universalAqi: mapIndex(uaqiRaw),
        localAqi: mapIndex(localRaw ?? undefined),
        pollutants,
        healthRecommendations: data.healthRecommendations ?? {},
        dataSource: 'Google Maps Air Quality API',
      };

      aqCache.set(key, snapshot);
      return snapshot;
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
      // Fall through to live Open-Meteo telemetry on 403/401/unavailable
    }
  }

  const bundle = await fetchOpenMeteoAirQualityBundle(coords);
  aqCache.set(key, bundle.snapshot);
  aqForecastCache.set(`aqf:${coordKey(coords.lat, coords.lng)}:us_epa`, {
    points: bundle.forecast,
    scale: 'us_epa',
  });
  return bundle.snapshot;
}

/**
 * Fetches 24-hour hourly Air Quality forecast matching the active AQI scale.
 */
export async function fetchAirQualityForecast(
  coords: GeoCoordinates,
  preferredScale: AqiScale = 'uaqi'
): Promise<{ points: HourlyAirQualityPoint[]; scale: AqiScale }> {
  const cacheKey = `aqf:${coordKey(coords.lat, coords.lng)}:${preferredScale}`;
  const cached = aqForecastCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey && preferredScale === 'uaqi') {
    const nextHourMs = Math.ceil(Date.now() / 3600000) * 3600000 + 3600000;
    const endHourMs = nextHourMs + 23 * 3600000;

    interface RawForecastResponse {
      hourlyForecasts?: Array<{
        dateTime?: string;
        indexes?: Array<{
          code?: string;
          aqi?: number;
          category?: string;
          dominantPollutant?: string;
        }>;
        pollutants?: Array<{
          code?: string;
          concentration?: { value?: number };
        }>;
      }>;
    }

    try {
      const data = await fetchMapsJson<RawForecastResponse>(
        `https://airquality.googleapis.com/v1/forecast:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            universalAqi: true,
            location: {
              latitude: coords.lat,
              longitude: coords.lng,
            },
            period: {
              startTime: new Date(nextHourMs).toISOString(),
              endTime: new Date(endHourMs).toISOString(),
            },
            pageSize: 24,
            languageCode: 'en',
            extraComputations: ['DOMINANT_POLLUTANT_CONCENTRATION'],
          }),
        }
      );

      const points: HourlyAirQualityPoint[] = (data.hourlyForecasts ?? []).map((entry) => {
        const uaqi = entry.indexes?.find((i) => i.code === 'uaqi') ?? entry.indexes?.[0];
        const pm25 = entry.pollutants?.find((p) => p.code === 'pm25')?.concentration?.value;
        return {
          dateTime: entry.dateTime ?? new Date().toISOString(),
          aqi: typeof uaqi?.aqi === 'number' ? uaqi.aqi : 50,
          category: uaqi?.category ?? 'Moderate',
          dominantPollutant: uaqi?.dominantPollutant ?? 'pm25',
          pm25Value: pm25,
        };
      });

      const result = { points, scale: 'uaqi' as const };
      aqForecastCache.set(cacheKey, result);
      return result;
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
      // Fall back to Open-Meteo below
    }
  }

  const bundle = await fetchOpenMeteoAirQualityBundle(coords);
  const result = { points: bundle.forecast, scale: 'us_epa' as const };
  aqForecastCache.set(`aqf:${coordKey(coords.lat, coords.lng)}:us_epa`, result);
  return result;
}

/**
 * Fetches live Open-Meteo meteorological current + hourly bundle (zero API key required).
 */
async function fetchOpenMeteoWeatherBundle(
  coords: GeoCoordinates
): Promise<{ current: WeatherSnapshot; hourly: HourlyWeatherPoint[] }> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lng));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code,is_day'
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,wind_speed_10m,relative_humidity_2m,precipitation_probability'
  );
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new UpstreamApiError(`Open-Meteo Weather error (${response.status})`, response.status);
  }

  interface OpenMeteoWeatherRaw {
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
  }

  const raw = (await response.json()) as OpenMeteoWeatherRaw;
  const c = raw.current ?? {};
  const cond = wmoCodeToCondition(c.weather_code);

  const current: WeatherSnapshot = {
    currentTime: c.time ? new Date(c.time).toISOString() : new Date().toISOString(),
    conditionText: cond.text,
    conditionType: cond.type,
    temperatureC: c.temperature_2m ?? 15,
    feelsLikeC: c.apparent_temperature ?? c.temperature_2m ?? 15,
    relativeHumidity: Math.round(c.relative_humidity_2m ?? 50),
    windSpeedKmh: c.wind_speed_10m ?? 8,
    windDirectionCardinal: degreesToCardinal(c.wind_direction_10m),
    pressureHpa: c.pressure_msl ?? 1015,
    visibilityKm: 10,
    isDaytime: c.is_day !== 0,
  };

  const times = raw.hourly?.time ?? [];
  const temps = raw.hourly?.temperature_2m ?? [];
  const winds = raw.hourly?.wind_speed_10m ?? [];
  const hums = raw.hourly?.relative_humidity_2m ?? [];
  const precips = raw.hourly?.precipitation_probability ?? [];
  const nowMs = Date.now();
  const hourly: HourlyWeatherPoint[] = [];

  for (let i = 0; i < times.length && hourly.length < 24; i++) {
    const tMs = new Date(times[i]).getTime();
    if (!Number.isNaN(tMs) && tMs < nowMs - 3600000) continue;
    hourly.push({
      startTime: new Date(times[i]).toISOString(),
      temperatureC: temps[i] ?? current.temperatureC,
      windSpeedKmh: winds[i] ?? current.windSpeedKmh,
      relativeHumidity: Math.round(hums[i] ?? current.relativeHumidity),
      precipitationPercent: Math.round(precips[i] ?? 0),
    });
  }

  return { current, hourly };
}

/**
 * Fetches current meteorological conditions (Google Weather API -> Open-Meteo fallback).
 */
export async function fetchCurrentWeather(
  coords: GeoCoordinates
): Promise<WeatherSnapshot | null> {
  const key = `wx:${coordKey(coords.lat, coords.lng)}`;
  const cached = weatherCache.get(key);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey) {
    interface RawWeatherResponse {
      currentTime?: string;
      isDaytime?: boolean;
      weatherCondition?: {
        type?: string;
        description?: { text?: string };
      };
      temperature?: { degrees?: number };
      feelsLikeTemperature?: { degrees?: number };
      relativeHumidity?: number;
      airPressure?: { meanSeaLevelMillibars?: number };
      wind?: {
        direction?: { cardinal?: string };
        speed?: { value?: number };
      };
      visibility?: { distance?: number };
    }

    const url = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('location.latitude', String(coords.lat));
    url.searchParams.set('location.longitude', String(coords.lng));

    try {
      const data = await fetchMapsJson<RawWeatherResponse>(url.toString(), { method: 'GET' });
      const snapshot: WeatherSnapshot = {
        currentTime: data.currentTime ?? new Date().toISOString(),
        conditionText: data.weatherCondition?.description?.text ?? 'Clear',
        conditionType: data.weatherCondition?.type ?? 'CLEAR',
        temperatureC: data.temperature?.degrees ?? 10,
        feelsLikeC: data.feelsLikeTemperature?.degrees ?? data.temperature?.degrees ?? 10,
        relativeHumidity: data.relativeHumidity ?? 50,
        windSpeedKmh: data.wind?.speed?.value ?? 8,
        windDirectionCardinal: data.wind?.direction?.cardinal ?? 'CALM',
        pressureHpa: data.airPressure?.meanSeaLevelMillibars ?? 1015,
        visibilityKm: data.visibility?.distance ?? 10,
        isDaytime: data.isDaytime ?? true,
      };
      weatherCache.set(key, snapshot);
      return snapshot;
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
      // Fall back to Open-Meteo below
    }
  }

  try {
    const bundle = await fetchOpenMeteoWeatherBundle(coords);
    weatherCache.set(key, bundle.current);
    weatherForecastCache.set(`wxf:${coordKey(coords.lat, coords.lng)}`, bundle.hourly);
    return bundle.current;
  } catch {
    return null;
  }
}

/**
 * Fetches 24-hour meteorological forecast (Google Weather API -> Open-Meteo fallback).
 */
export async function fetchHourlyWeatherForecast(
  coords: GeoCoordinates
): Promise<HourlyWeatherPoint[]> {
  const key = `wxf:${coordKey(coords.lat, coords.lng)}`;
  const cached = weatherForecastCache.get(key);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey) {
    interface RawHourlyWeatherResponse {
      forecastHours?: Array<{
        interval?: { startTime?: string };
        temperature?: { degrees?: number };
        wind?: { speed?: { value?: number } };
        relativeHumidity?: number;
        precipitation?: { probability?: { percent?: number } };
      }>;
    }

    const url = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('location.latitude', String(coords.lat));
    url.searchParams.set('location.longitude', String(coords.lng));
    url.searchParams.set('hours', '24');
    url.searchParams.set('pageSize', '24');

    try {
      const data = await fetchMapsJson<RawHourlyWeatherResponse>(url.toString(), { method: 'GET' });
      const points: HourlyWeatherPoint[] = (data.forecastHours ?? []).map((h) => ({
        startTime: h.interval?.startTime ?? new Date().toISOString(),
        temperatureC: h.temperature?.degrees ?? 10,
        windSpeedKmh: h.wind?.speed?.value ?? 8,
        relativeHumidity: h.relativeHumidity ?? 50,
        precipitationPercent: h.precipitation?.probability?.percent ?? 0,
      }));
      weatherForecastCache.set(key, points);
      return points;
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
    }
  }

  try {
    const bundle = await fetchOpenMeteoWeatherBundle(coords);
    weatherCache.set(`wx:${coordKey(coords.lat, coords.lng)}`, bundle.current);
    weatherForecastCache.set(key, bundle.hourly);
    return bundle.hourly;
  } catch {
    return [];
  }
}

/**
 * Fallback clean-air sanctuary search using OpenStreetMap Overpass API.
 */
async function fetchOverpassSanctuaries(coords: GeoCoordinates): Promise<CleanSanctuary[]> {
  const query = `[out:json][timeout:6];(node["amenity"~"^(library|community_centre|pharmacy)$"](around:3500,${coords.lat},${coords.lng});node["tourism"="museum"](around:3500,${coords.lat},${coords.lng});node["railway"~"^(station|subway_entrance)$"](around:3500,${coords.lat},${coords.lng}););out body 16;`;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      signal: AbortSignal.timeout(7000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) return [];

    interface OverpassRaw {
      elements?: Array<{
        id: number;
        lat?: number;
        lon?: number;
        tags?: Record<string, string>;
      }>;
    }

    const raw = (await response.json()) as OverpassRaw;
    const seen = new Set<string>();
    const results: CleanSanctuary[] = [];

    for (const el of raw.elements ?? []) {
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
      const name = el.tags?.name || el.tags?.['name:en'];
      if (!name) continue;
      const dedupeKey = name.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const category =
        el.tags?.amenity === 'library'
          ? 'Public Library'
          : el.tags?.amenity === 'community_centre'
            ? 'Community Center'
            : el.tags?.amenity === 'pharmacy'
              ? 'Pharmacy'
              : el.tags?.tourism === 'museum'
                ? 'Museum'
                : 'Rail / Metro Hub';

      const street = [el.tags?.['addr:housenumber'], el.tags?.['addr:street']]
        .filter(Boolean)
        .join(' ');
      const address =
        street ||
        el.tags?.['addr:suburb'] ||
        el.tags?.['addr:city'] ||
        `${el.lat.toFixed(4)}, ${el.lon.toFixed(4)}`;

      results.push({
        id: `osm-${el.id}`,
        name,
        address,
        category,
        lat: el.lat,
        lng: el.lon,
        openNow: null,
        mapsUri: `https://www.openstreetmap.org/?mlat=${el.lat}&mlon=${el.lon}#map=16/${el.lat}/${el.lon}`,
        distanceMeters: haversineDistanceMeters(coords, { lat: el.lat, lng: el.lon }),
      });
    }

    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results.slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Searches nearby indoor clean-air sanctuaries, pharmacies, and low-emission transit hubs
 * using Google Places API (New), falling back to OpenStreetMap Overpass API if unavailable.
 */
export async function fetchNearbyCleanSanctuaries(
  coords: GeoCoordinates
): Promise<CleanSanctuary[]> {
  const key = `places:${coordKey(coords.lat, coords.lng)}`;
  const cached = placesCache.get(key);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey) {
    interface RawPlacesResponse {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        primaryType?: string;
        primaryTypeDisplayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
        googleMapsUri?: string;
        currentOpeningHours?: { openNow?: boolean };
      }>;
    }

    try {
      const data = await fetchMapsJson<RawPlacesResponse>(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.primaryTypeDisplayName,places.googleMapsUri,places.currentOpeningHours.openNow',
          },
          body: JSON.stringify({
            includedTypes: [
              'library',
              'museum',
              'community_center',
              'pharmacy',
              'subway_station',
              'train_station',
            ],
            maxResultCount: 8,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: {
                  latitude: coords.lat,
                  longitude: coords.lng,
                },
                radius: 4000,
              },
            },
            languageCode: 'en',
          }),
        }
      );

      const results: CleanSanctuary[] = (data.places ?? [])
        .filter((p) => p.location?.latitude !== undefined && p.location?.longitude !== undefined)
        .map((p) => {
          const placeCoords = {
            lat: p.location!.latitude!,
            lng: p.location!.longitude!,
          };
          return {
            id: p.id ?? `${placeCoords.lat}-${placeCoords.lng}`,
            name: p.displayName?.text ?? 'Community Location',
            address: p.formattedAddress ?? 'Address unavailable',
            category: p.primaryTypeDisplayName?.text ?? p.primaryType ?? 'Indoor Space',
            lat: placeCoords.lat,
            lng: placeCoords.lng,
            openNow: p.currentOpeningHours?.openNow ?? null,
            mapsUri:
              p.googleMapsUri ??
              `https://www.google.com/maps/search/?api=1&query=${placeCoords.lat},${placeCoords.lng}`,
            distanceMeters: haversineDistanceMeters(coords, placeCoords),
          };
        });

      placesCache.set(key, results);
      return results;
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
      // Fall back to Overpass API below
    }
  }

  const osmResults = await fetchOverpassSanctuaries(coords);
  placesCache.set(key, osmResults);
  return osmResults;
}

/**
 * Reverse geocodes coordinates using Google Geocoding API v4 with Nominatim fallback.
 */
export async function reverseGeocodeCoordinates(
  coords: GeoCoordinates
): Promise<string> {
  const cacheKey = `rev:${coordKey(coords.lat, coords.lng)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = getMapsApiKey();
  if (apiKey) {
    interface RawGeocodeResponse {
      results?: Array<{
        formattedAddress?: string;
      }>;
    }

    try {
      const url = new URL('https://geocode.googleapis.com/v4/geocode/location');
      url.searchParams.set('location.latitude', String(coords.lat));
      url.searchParams.set('location.longitude', String(coords.lng));
      url.searchParams.set('languageCode', 'en');

      const data = await fetchMapsJson<RawGeocodeResponse>(url.toString(), {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'results.formattedAddress',
        },
      });
      const resolved = data.results?.[0]?.formattedAddress;
      if (resolved) {
        reverseGeocodeCache.set(cacheKey, resolved);
        return resolved;
      }
    } catch {
      // Fall back to Nominatim below
    }
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lng}&zoom=12`;
    const res = await fetch(nomUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'ClearHearthUrbanAirAssistant/1.0',
        'Accept-Language': 'en',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        display_name?: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          country?: string;
        };
      };
      const city = data.address?.city || data.address?.town || data.address?.village;
      const concise = [city, data.address?.state, data.address?.country]
        .filter(Boolean)
        .join(', ');
      const resolved = concise || data.display_name;
      if (resolved) {
        reverseGeocodeCache.set(cacheKey, resolved);
        return resolved;
      }
    }
  } catch {
    // Ignore reverse-geocode timeout
  }

  return `${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`;
}

/**
 * Forward geocodes an address or city query using Google Geocoding API v4
 * with Open-Meteo Geocoding fallback when Maps API is unavailable.
 */
export async function forwardGeocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const apiKey = getMapsApiKey();

  if (apiKey) {
    interface RawGeocodeResponse {
      results?: Array<{
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }>;
    }

    try {
      const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?languageCode=en`;
      const data = await fetchMapsJson<RawGeocodeResponse>(url, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'results.location,results.formattedAddress',
        },
      });

      const first = data.results?.[0];
      if (
        first &&
        typeof first.location?.latitude === 'number' &&
        typeof first.location?.longitude === 'number'
      ) {
        return {
          lat: first.location.latitude,
          lng: first.location.longitude,
          formattedAddress: first.formattedAddress ?? address,
        };
      }
    } catch (error) {
      if (error instanceof UpstreamApiError && error.isQuotaExceeded) {
        throw error;
      }
      // Fall back to Open-Meteo Geocoding below
    }
  }

  const omUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  omUrl.searchParams.set('name', address);
  omUrl.searchParams.set('count', '1');
  omUrl.searchParams.set('language', 'en');
  omUrl.searchParams.set('format', 'json');

  const response = await fetch(omUrl.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new UpstreamApiError('Location search service unavailable.', response.status);
  }

  const raw = (await response.json()) as {
    results?: Array<{
      name?: string;
      admin1?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    }>;
  };
  const match = raw.results?.[0];
  if (
    !match ||
    typeof match.latitude !== 'number' ||
    typeof match.longitude !== 'number'
  ) {
    return null;
  }

  const formattedAddress = [match.name, match.admin1, match.country]
    .filter(Boolean)
    .join(', ');

  return {
    lat: match.latitude,
    lng: match.longitude,
    formattedAddress: formattedAddress || address,
  };
}
