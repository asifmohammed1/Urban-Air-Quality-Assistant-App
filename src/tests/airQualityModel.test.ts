import { describe, expect, it } from 'vitest';
import {
  analyzeForecastWindows,
  assessWinterInversionRisk,
  calculateChoiceImpact,
  DEFAULT_HOUSEHOLD_PROFILE,
  getAqiSeverityMeta,
  getPrimaryAqiContext,
  haversineDistanceMeters,
  type AirQualitySnapshot,
  type HourlyAirQualityPoint,
  type WeatherSnapshot,
} from '../shared/airQualityModel.ts';

describe('airQualityModel', () => {
  it('detects Severe winter thermal inversion when wind is stagnant, pressure is high, and air is cold', () => {
    const stagnantWeather: WeatherSnapshot = {
      currentTime: '2026-11-18T08:00:00Z',
      conditionText: 'Haze',
      conditionType: 'HAZE',
      temperatureC: -2.0,
      feelsLikeC: -4.0,
      relativeHumidity: 84,
      windSpeedKmh: 3.2,
      windDirectionCardinal: 'CALM',
      pressureHpa: 1028,
      visibilityKm: 3.0,
      isDaytime: true,
    };

    const heavySmogAq: AirQualitySnapshot = {
      dateTime: '2026-11-18T08:00:00Z',
      regionCode: 'us',
      universalAqi: {
        code: 'uaqi',
        displayName: 'Universal AQI',
        aqi: 22,
        aqiDisplay: '22',
        category: 'Low air quality',
        dominantPollutant: 'pm25',
        colorHex: '#c2410c',
      },
      localAqi: null,
      pollutants: [
        {
          code: 'pm25',
          displayName: 'PM2.5',
          fullName: 'Fine particulate matter',
          value: 78.4,
          units: 'MICROGRAMS_PER_CUBIC_METER',
        },
      ],
      healthRecommendations: {},
    };

    const result = assessWinterInversionRisk(stagnantWeather, heavySmogAq);
    expect(result.severity).toBe('Severe');
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.factors.length).toBeGreaterThanOrEqual(4);
  });

  it('detects Low inversion risk during breezy mild conditions', () => {
    const breezyWeather: WeatherSnapshot = {
      currentTime: '2026-11-18T14:00:00Z',
      conditionText: 'Windy',
      conditionType: 'WINDY',
      temperatureC: 16.5,
      feelsLikeC: 16.0,
      relativeHumidity: 42,
      windSpeedKmh: 26.0,
      windDirectionCardinal: 'WEST',
      pressureHpa: 1009,
      visibilityKm: 16.0,
      isDaytime: true,
    };

    const result = assessWinterInversionRisk(breezyWeather, null);
    expect(result.severity).toBe('Low');
    expect(result.score).toBeLessThan(28);
  });

  it('identifies cleanest outdoor window and peak smog window on Universal AQI (higher = cleaner)', () => {
    const forecast: HourlyAirQualityPoint[] = [
      { dateTime: '2026-11-18T08:00:00Z', aqi: 30, category: 'Low', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T09:00:00Z', aqi: 34, category: 'Low', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T14:00:00Z', aqi: 78, category: 'Good', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T15:00:00Z', aqi: 82, category: 'Excellent', dominantPollutant: 'pm25' },
    ];

    const windows = analyzeForecastWindows(forecast, [], 'uaqi');
    expect(windows.scale).toBe('uaqi');
    expect(windows.cleanestWindow?.avgAqi).toBe(80);
    expect(windows.peakSmogWindow?.avgAqi).toBe(32);
    expect(windows.hourlySeries).toHaveLength(4);
  });

  it('identifies cleanest outdoor window and peak smog window on US EPA AQI (lower = cleaner)', () => {
    const forecast: HourlyAirQualityPoint[] = [
      { dateTime: '2026-11-18T08:00:00Z', aqi: 160, category: 'Unhealthy', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T09:00:00Z', aqi: 150, category: 'Sensitive Risk', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T14:00:00Z', aqi: 54, category: 'Moderate', dominantPollutant: 'pm25' },
      { dateTime: '2026-11-18T15:00:00Z', aqi: 48, category: 'Excellent', dominantPollutant: 'pm25' },
    ];

    const windows = analyzeForecastWindows(forecast, [], 'us_epa');
    expect(windows.scale).toBe('us_epa');
    expect(windows.cleanestWindow?.avgAqi).toBe(51);
    expect(windows.peakSmogWindow?.avgAqi).toBe(155);
  });

  it('quantifies direct household emission and indoor PM2.5 impact accurately', () => {
    const impact = calculateChoiceImpact(DEFAULT_HOUSEHOLD_PROFILE, 60, {
      adoptTransitOrWalk: true,
      adoptTimedVentilationAndFiltration: true,
      adoptElectricCookingOrHeating: true,
      wearN95DuringPeak: true,
    });

    expect(impact.dailyCo2SavedGrams).toBeGreaterThan(2000);
    expect(impact.dailyNoxSavedGrams).toBeGreaterThan(3);
    expect(impact.estimatedIndoorPm25DropPct).toBeGreaterThanOrEqual(60);
    expect(impact.pm25InhalationReductionPct).toBe(90);
    expect(impact.whoPm25Multiple).toBe(4);
  });

  it('maps UAQI and US EPA scores to accessible severity metadata and detects active scale', () => {
    expect(getAqiSeverityMeta(88).level).toBe('Excellent');
    expect(getAqiSeverityMeta(45).level).toBe('Sensitive Risk');
    expect(getAqiSeverityMeta(12).level).toBe('Severe');

    expect(getAqiSeverityMeta(35, true).level).toBe('Excellent');
    expect(getAqiSeverityMeta(135, true).level).toBe('Sensitive Risk');
    expect(getAqiSeverityMeta(225, true).level).toBe('Severe');

    const ctx = getPrimaryAqiContext({
      dateTime: '2026-11-18T08:00:00Z',
      regionCode: 'global',
      universalAqi: {
        code: 'us_epa',
        displayName: 'US EPA AQI',
        aqi: 112,
        aqiDisplay: '112',
        category: 'Sensitive Risk',
        dominantPollutant: 'pm25',
        colorHex: '#c2410c',
      },
      localAqi: null,
      pollutants: [],
      healthRecommendations: {},
    });
    expect(ctx.scale).toBe('us_epa');
    expect(ctx.metric?.aqi).toBe(112);
  });

  it('computes Haversine distance accurately within 5%', () => {
    const dist = haversineDistanceMeters(
      { lat: 40.7608, lng: -111.891 },
      { lat: 40.7698, lng: -111.891 }
    );
    expect(dist).toBeGreaterThan(950);
    expect(dist).toBeLessThan(1050);
  });
});
