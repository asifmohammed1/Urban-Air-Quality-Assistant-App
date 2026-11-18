export type SensitiveGroup =
  | 'children'
  | 'elderly'
  | 'respiratory'
  | 'pregnant'
  | 'athletes';

export type CommuteMode = 'gas_car' | 'hybrid_ev' | 'public_transit' | 'walk_bike';

export type HeatingSource = 'wood_coal' | 'natural_gas' | 'electric_heat_pump';

export type FiltrationLevel = 'none' | 'diy_merv13' | 'hepa_purifier';

export interface HouseholdProfile {
  householdName: string;
  householdSize: number;
  sensitiveGroups: SensitiveGroup[];
  commuteMode: CommuteMode;
  dailyCommuteKm: number;
  heatingSource: HeatingSource;
  filtrationLevel: FiltrationLevel;
  homeSizeSqM: number;
}

export const DEFAULT_HOUSEHOLD_PROFILE: HouseholdProfile = {
  householdName: 'Rivera Family',
  householdSize: 4,
  sensitiveGroups: ['children', 'elderly'],
  commuteMode: 'gas_car',
  dailyCommuteKm: 18,
  heatingSource: 'natural_gas',
  filtrationLevel: 'diy_merv13',
  homeSizeSqM: 110,
};

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

export interface PollutantMetric {
  code: string;
  displayName: string;
  fullName: string;
  value: number;
  units: string;
  sources?: string;
  effects?: string;
}

export interface AqiIndexMetric {
  code: string;
  displayName: string;
  aqi: number;
  aqiDisplay: string;
  category: string;
  dominantPollutant: string;
  colorHex: string;
}

export interface HealthRecommendationsMap {
  generalPopulation?: string;
  elderly?: string;
  lungDiseasePopulation?: string;
  heartDiseasePopulation?: string;
  athletes?: string;
  pregnantWomen?: string;
  children?: string;
}

export type AqiScale = 'uaqi' | 'us_epa';

export interface AirQualitySnapshot {
  dateTime: string;
  regionCode: string;
  universalAqi: AqiIndexMetric | null;
  localAqi: AqiIndexMetric | null;
  pollutants: PollutantMetric[];
  healthRecommendations: HealthRecommendationsMap;
  dataSource?: string;
}

export interface HourlyAirQualityPoint {
  dateTime: string;
  aqi: number;
  category: string;
  dominantPollutant: string;
  pm25Value?: number;
}

export interface WeatherSnapshot {
  currentTime: string;
  conditionText: string;
  conditionType: string;
  temperatureC: number;
  feelsLikeC: number;
  relativeHumidity: number;
  windSpeedKmh: number;
  windDirectionCardinal: string;
  pressureHpa: number;
  visibilityKm: number;
  isDaytime: boolean;
}

export interface HourlyWeatherPoint {
  startTime: string;
  temperatureC: number;
  windSpeedKmh: number;
  relativeHumidity: number;
  precipitationPercent: number;
}

export type InversionSeverity = 'Low' | 'Moderate' | 'High' | 'Severe';

export interface InversionRiskAssessment {
  severity: InversionSeverity;
  score: number; // 0-100 composite index of stagnation/trapping potential
  factors: string[];
  summary: string;
}

export interface DailyWindowAnalysis {
  scale: AqiScale;
  cleanestWindow: {
    startIso: string;
    endIso: string;
    avgAqi: number;
    label: string;
  } | null;
  peakSmogWindow: {
    startIso: string;
    endIso: string;
    avgAqi: number;
    label: string;
  } | null;
  hourlySeries: Array<{
    timeLabel: string;
    isoTime: string;
    aqi: number;
    windSpeedKmh: number | null;
    temperatureC: number | null;
  }>;
}

export interface CleanSanctuary {
  id: string;
  name: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
  openNow: boolean | null;
  mapsUri: string;
  distanceMeters: number;
}

export interface ImpactMetrics {
  dailyCo2SavedGrams: number;
  dailyNoxSavedGrams: number;
  pm25InhalationReductionPct: number;
  estimatedIndoorPm25DropPct: number;
  estimatedIndoorPm25UgM3: number;
  whoPm25Multiple: number;
}

export interface RoutineRecommendation {
  timeWindow: string;
  title: string;
  guidance: string;
  emissionImpact: string;
  exposureImpact: string;
  priority: 'critical' | 'recommended' | 'optional';
}

export interface IndoorHack {
  title: string;
  mechanism: string;
  actionSteps: string[];
  directImpact: string;
  estimatedCostTier: 'Free' | 'Low-Cost' | 'Upgrade';
}

export interface SustainableSwap {
  currentHabit: string;
  sustainableAlternative: string;
  directHealthBenefit: string;
  emissionReduction: string;
  feasibilityNote: string;
}

export interface AdvisorPlan {
  headline: string;
  winterSmogSummary: string;
  dailyRoutines: RoutineRecommendation[];
  indoorHacks: IndoorHack[];
  sustainableSwaps: SustainableSwap[];
  communityAction: string;
  generatedAt: string;
}

export interface AqiSeverityMeta {
  level: 'Excellent' | 'Moderate' | 'Sensitive Risk' | 'Unhealthy' | 'Severe';
  textClass: string;
  surfaceClass: string;
  borderClass: string;
  hex: string;
  maskAdvice: string;
}

const WHO_24H_PM25_LIMIT = 15; // ug/m3 (WHO 2021 Global Air Quality Guideline)

export function getPrimaryAqiContext(airQuality: AirQualitySnapshot | null): {
  metric: AqiIndexMetric | null;
  scale: AqiScale;
} {
  const metric = airQuality?.universalAqi ?? airQuality?.localAqi ?? null;
  const code = metric?.code?.toLowerCase() ?? 'uaqi';
  const scale: AqiScale =
    code === 'us_epa' || code === 'usa_epa' ? 'us_epa' : 'uaqi';
  return { metric, scale };
}

/**
 * Computes WCAG-friendly visual tokens, explicit textual severity label,
 * and protective mask guidance from a Universal AQI or US-AQI score.
 */
export function getAqiSeverityMeta(aqi: number, useUsScale = false): AqiSeverityMeta {
  // Google Universal AQI runs 0 (poor) -> 100 (excellent), whereas US EPA AQI runs 0 (good) -> 500 (hazardous).
  if (useUsScale) {
    if (aqi <= 50) {
      return {
        level: 'Excellent',
        textClass: 'text-emerald-800',
        surfaceClass: 'bg-emerald-50',
        borderClass: 'border-emerald-200',
        hex: '#047857',
        maskAdvice: 'Standard outdoor air; no respirator needed for most residents.',
      };
    }
    if (aqi <= 100) {
      return {
        level: 'Moderate',
        textClass: 'text-amber-900',
        surfaceClass: 'bg-amber-50',
        borderClass: 'border-amber-200',
        hex: '#b45309',
        maskAdvice: 'Sensitive children and seniors should keep high-exertion outdoor play brief.',
      };
    }
    if (aqi <= 150) {
      return {
        level: 'Sensitive Risk',
        textClass: 'text-orange-900',
        surfaceClass: 'bg-orange-50',
        borderClass: 'border-orange-200',
        hex: '#c2410c',
        maskAdvice: 'Wear a well-fitted KN95/N95 mask outdoors for sensitive groups and limit outdoor cardio.',
      };
    }
    if (aqi <= 200) {
      return {
        level: 'Unhealthy',
        textClass: 'text-rose-900',
        surfaceClass: 'bg-rose-50',
        borderClass: 'border-rose-200',
        hex: '#be123c',
        maskAdvice: 'N95/FFP2 masks strongly advised for all outdoor errands; keep windows sealed.',
      };
    }
    return {
      level: 'Severe',
      textClass: 'text-red-950',
      surfaceClass: 'bg-red-100',
      borderClass: 'border-red-300',
      hex: '#991b1b',
      maskAdvice: 'Hazardous smog: stay indoors with active HEPA filtration and use N95 masks if travel is unavoidable.',
    };
  }

  // Universal AQI (UAQI): higher is cleaner (80-100 Excellent, 60-79 Good, 40-59 Moderate, 20-39 Low, 0-19 Poor)
  if (aqi >= 80) {
    return {
      level: 'Excellent',
      textClass: 'text-emerald-800',
      surfaceClass: 'bg-emerald-50',
      borderClass: 'border-emerald-200',
      hex: '#047857',
      maskAdvice: 'Clean air window; safe for outdoor family activities and cross-ventilation.',
    };
  }
  if (aqi >= 60) {
    return {
      level: 'Moderate',
      textClass: 'text-teal-900',
      surfaceClass: 'bg-teal-50',
      borderClass: 'border-teal-200',
      hex: '#0f766e',
      maskAdvice: 'Acceptable air quality; sensitive respiratory groups should monitor symptoms.',
    };
  }
  if (aqi >= 40) {
    return {
      level: 'Sensitive Risk',
      textClass: 'text-amber-900',
      surfaceClass: 'bg-amber-50',
      borderClass: 'border-amber-200',
      hex: '#b45309',
      maskAdvice: 'Moderate winter haze; consider KN95/N95 for children, elderly, and asthma-prone commuters.',
    };
  }
  if (aqi >= 20) {
    return {
      level: 'Unhealthy',
      textClass: 'text-orange-950',
      surfaceClass: 'bg-orange-100',
      borderClass: 'border-orange-300',
      hex: '#c2410c',
      maskAdvice: 'High pollution load: wear N95/FFP2 outdoors and run indoor HEPA filtration.',
    };
  }
  return {
    level: 'Severe',
    textClass: 'text-red-950',
    surfaceClass: 'bg-red-100',
    borderClass: 'border-red-300',
    hex: '#991b1b',
    maskAdvice: 'Severe smog alert: avoid outdoor exertion, seal drafts, and filter indoor air continuously.',
  };
}

/**
 * Evaluates winter thermal inversion trapping risk from live meteorological telemetry.
 * Cold surface air + weak winds (< 8 km/h) + high barometric pressure (> 1018 hPa)
 * creates a shallow boundary layer that traps urban combustion PM2.5 near street level.
 */
export function assessWinterInversionRisk(
  weather: WeatherSnapshot | null,
  airQuality: AirQualitySnapshot | null
): InversionRiskAssessment {
  if (!weather) {
    return {
      severity: 'Moderate',
      score: 45,
      factors: ['Meteorological telemetry unavailable; using baseline urban dispersion estimate.'],
      summary: 'Monitor wind speed and evening cooling, which frequently trap winter PM2.5 near street level.',
    };
  }

  let score = 0;
  const factors: string[] = [];

  if (weather.windSpeedKmh < 6) {
    score += 35;
    factors.push(`Stagnant wind (${weather.windSpeedKmh.toFixed(1)} km/h) prevents horizontal smog dispersion.`);
  } else if (weather.windSpeedKmh < 12) {
    score += 20;
    factors.push(`Light breeze (${weather.windSpeedKmh.toFixed(1)} km/h) allows partial urban plume accumulation.`);
  } else {
    factors.push(`Active wind (${weather.windSpeedKmh.toFixed(1)} km/h) helps ventilate street canyons.`);
  }

  if (weather.pressureHpa >= 1022) {
    score += 25;
    factors.push(`High pressure (${Math.round(weather.pressureHpa)} hPa) suppresses vertical air mixing.`);
  } else if (weather.pressureHpa >= 1016) {
    score += 12;
    factors.push(`Elevated pressure (${Math.round(weather.pressureHpa)} hPa) slightly caps atmospheric mixing.`);
  }

  if (weather.temperatureC <= 5) {
    score += 20;
    factors.push(`Cold surface air (${weather.temperatureC.toFixed(1)}°C) intensifies evening thermal inversion & heating emissions.`);
  } else if (weather.temperatureC <= 13) {
    score += 10;
    factors.push(`Cool boundary layer (${weather.temperatureC.toFixed(1)}°C) slows morning inversion breakup.`);
  }

  if (weather.relativeHumidity >= 75) {
    score += 10;
    factors.push(`High humidity (${weather.relativeHumidity}%) promotes hygroscopic particle growth and haze.`);
  }

  const pm25 = airQuality?.pollutants.find((p) => p.code === 'pm25')?.value ?? 0;
  if (pm25 > 35) {
    score += 15;
    factors.push(`Elevated PM2.5 (${pm25.toFixed(1)} µg/m³) confirms fine particulate buildup.`);
  }

  const boundedScore = Math.min(100, Math.max(0, score));
  let severity: InversionSeverity = 'Low';
  if (boundedScore >= 75) severity = 'Severe';
  else if (boundedScore >= 52) severity = 'High';
  else if (boundedScore >= 28) severity = 'Moderate';

  const summaryBySeverity: Record<InversionSeverity, string> = {
    Severe:
      'Strong winter inversion trap: stagnant cold air under high pressure is locking exhaust and heating particles near ground level.',
    High:
      'Elevated trapping risk: weak surface winds and cool air are slowing pollution dispersion until midday warming.',
    Moderate:
      'Moderate dispersion: pollutants may pool during evening rush hour and calm overnight cooling.',
    Low:
      'Favorable atmospheric mixing: current wind and pressure help disperse urban emissions.',
  };

  return {
    severity,
    score: boundedScore,
    factors,
    summary: summaryBySeverity[severity],
  };
}

/**
 * Formats an ISO timestamp into a compact 24-hour or local-friendly hour label.
 */
function formatHourLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    hour12: true,
  });
}

/**
 * Analyzes hourly AQI and weather forecasts to identify the cleanest outdoor window
 * and peak smog risk window for family schedule planning.
 */
export function analyzeForecastWindows(
  hourlyAq: HourlyAirQualityPoint[],
  hourlyWeather: HourlyWeatherPoint[],
  scale: AqiScale = 'uaqi'
): DailyWindowAnalysis {
  const weatherByHour = new Map<string, HourlyWeatherPoint>();
  for (const w of hourlyWeather) {
    weatherByHour.set(w.startTime.slice(0, 13), w);
  }

  const hourlySeries = hourlyAq.slice(0, 24).map((pt) => {
    const matchedWeather = weatherByHour.get(pt.dateTime.slice(0, 13));
    return {
      timeLabel: formatHourLabel(pt.dateTime),
      isoTime: pt.dateTime,
      aqi: pt.aqi,
      windSpeedKmh: matchedWeather ? matchedWeather.windSpeedKmh : null,
      temperatureC: matchedWeather ? matchedWeather.temperatureC : null,
    };
  });

  if (hourlySeries.length < 2) {
    return {
      scale,
      cleanestWindow: null,
      peakSmogWindow: null,
      hourlySeries,
    };
  }

  // UAQI: higher = cleaner air. US EPA AQI: lower = cleaner air.
  let bestIdx = 0;
  let bestAvg = scale === 'us_epa' ? Infinity : -Infinity;
  let worstIdx = 0;
  let worstAvg = scale === 'us_epa' ? -Infinity : Infinity;

  for (let i = 0; i < hourlySeries.length - 1; i++) {
    const avg = (hourlySeries[i].aqi + hourlySeries[i + 1].aqi) / 2;
    const isBetter = scale === 'us_epa' ? avg < bestAvg : avg > bestAvg;
    const isWorse = scale === 'us_epa' ? avg > worstAvg : avg < worstAvg;
    if (isBetter) {
      bestAvg = avg;
      bestIdx = i;
    }
    if (isWorse) {
      worstAvg = avg;
      worstIdx = i;
    }
  }

  return {
    scale,
    cleanestWindow: {
      startIso: hourlySeries[bestIdx].isoTime,
      endIso: hourlySeries[bestIdx + 1].isoTime,
      avgAqi: Math.round(bestAvg),
      label: `${hourlySeries[bestIdx].timeLabel} – ${hourlySeries[bestIdx + 1].timeLabel}`,
    },
    peakSmogWindow: {
      startIso: hourlySeries[worstIdx].isoTime,
      endIso: hourlySeries[worstIdx + 1].isoTime,
      avgAqi: Math.round(worstAvg),
      label: `${hourlySeries[worstIdx].timeLabel} – ${hourlySeries[worstIdx + 1].timeLabel}`,
    },
    hourlySeries,
  };
}

/**
 * Quantifies the direct household emission & exposure impact of low-emission choices
 * based on EPA/WHO reference emission factors and CADR indoor infiltration models.
 */
export function calculateChoiceImpact(
  profile: HouseholdProfile,
  pm25UgM3: number,
  options: {
    adoptTransitOrWalk: boolean;
    adoptTimedVentilationAndFiltration: boolean;
    adoptElectricCookingOrHeating: boolean;
    wearN95DuringPeak: boolean;
  }
): ImpactMetrics {
  // Average passenger car tailpipe ~192g CO2/km & ~0.35g NOx/km (higher during winter cold starts)
  const coldStartMultiplier = 1.18;
  let dailyCo2SavedGrams = 0;
  let dailyNoxSavedGrams = 0;

  if (options.adoptTransitOrWalk) {
    if (profile.commuteMode === 'gas_car') {
      // Switching gas car trips to rail/bus saves ~68% CO2e and ~75% NOx per passenger-km
      dailyCo2SavedGrams = Math.round(profile.dailyCommuteKm * 192 * coldStartMultiplier * 0.68);
      dailyNoxSavedGrams = Number((profile.dailyCommuteKm * 0.35 * coldStartMultiplier * 0.75).toFixed(2));
    } else if (profile.commuteMode === 'hybrid_ev') {
      dailyCo2SavedGrams = Math.round(profile.dailyCommuteKm * 85 * 0.6);
      dailyNoxSavedGrams = Number((profile.dailyCommuteKm * 0.12 * 0.7).toFixed(2));
    } else {
      // Already transit/walk: quantify daily baseline avoided vs driving
      dailyCo2SavedGrams = Math.round(profile.dailyCommuteKm * 192 * 0.75);
      dailyNoxSavedGrams = Number((profile.dailyCommuteKm * 0.35 * 0.8).toFixed(2));
    }
  }

  // Baseline indoor/outdoor infiltration ratio during winter sealed home ~0.65 (higher with indoor combustion)
  const indoorSourceAddition =
    profile.heatingSource === 'wood_coal'
      ? 14
      : profile.heatingSource === 'natural_gas'
        ? 4.5
        : 0;

  const baselineIndoorPm25 = pm25UgM3 * 0.65 + indoorSourceAddition;

  let reductionFactor = 0;
  if (options.adoptTimedVentilationAndFiltration) {
    reductionFactor += profile.filtrationLevel === 'hepa_purifier' ? 0.58 : profile.filtrationLevel === 'diy_merv13' ? 0.48 : 0.25;
  }
  if (options.adoptElectricCookingOrHeating && profile.heatingSource !== 'electric_heat_pump') {
    reductionFactor += 0.18;
  }
  const cappedIndoorDrop = Math.min(0.82, reductionFactor);
  const estimatedIndoorPm25UgM3 = Number(Math.max(1.5, baselineIndoorPm25 * (1 - cappedIndoorDrop)).toFixed(1));

  // Outdoor inhalation reduction from shifting errands to clean window + N95 filtration (~90-95% fit efficiency)
  let inhalationReduction = 0;
  if (options.adoptTimedVentilationAndFiltration) inhalationReduction += 25;
  if (options.wearN95DuringPeak) inhalationReduction += 55;
  if (options.adoptElectricCookingOrHeating) inhalationReduction += 10;

  return {
    dailyCo2SavedGrams,
    dailyNoxSavedGrams,
    pm25InhalationReductionPct: Math.min(92, inhalationReduction),
    estimatedIndoorPm25DropPct: Math.round(cappedIndoorDrop * 100),
    estimatedIndoorPm25UgM3,
    whoPm25Multiple: Number((pm25UgM3 / WHO_24H_PM25_LIMIT).toFixed(1)),
  };
}

/**
 * Calculates great-circle distance in meters using the Haversine formula.
 */
export function haversineDistanceMeters(a: GeoCoordinates, b: GeoCoordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Math.round(2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
