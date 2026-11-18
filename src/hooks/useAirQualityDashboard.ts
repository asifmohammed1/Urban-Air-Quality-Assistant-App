import { useCallback, useEffect, useState } from 'react';
import { HttpFetchError, safeFetchJson } from '../lib/http.ts';
import {
  buildBrowserFallbackPlan,
  fetchDirectBrowserTelemetry,
  geocodeDirectBrowser,
} from '../lib/openTelemetryFallback.ts';
import {
  DEFAULT_HOUSEHOLD_PROFILE,
  getPrimaryAqiContext,
  type AdvisorPlan,
  type AirQualitySnapshot,
  type CleanSanctuary,
  type DailyWindowAnalysis,
  type GeoCoordinates,
  type HouseholdProfile,
  type InversionRiskAssessment,
  type WeatherSnapshot,
} from '../shared/airQualityModel.ts';

export interface CityPreset {
  id: string;
  label: string;
  subtitle: string;
  coords: GeoCoordinates;
}

export const WINTER_SMOG_PRESETS: CityPreset[] = [
  {
    id: 'hyderabad',
    label: 'Hyderabad, IN',
    subtitle: 'Deccan Winter Haze',
    coords: { lat: 17.385, lng: 78.4867 },
  },
  {
    id: 'delhi',
    label: 'New Delhi, IN',
    subtitle: 'Severe Winter Smog',
    coords: { lat: 28.6139, lng: 77.209 },
  },
  {
    id: 'slc',
    label: 'Salt Lake City, UT',
    subtitle: 'Mountain Basin Inversion',
    coords: { lat: 40.7608, lng: -111.891 },
  },
  {
    id: 'milan',
    label: 'Milan, IT',
    subtitle: 'Po Valley Stagnation',
    coords: { lat: 45.4642, lng: 9.19 },
  },
  {
    id: 'london',
    label: 'London, UK',
    subtitle: 'Urban Corridor',
    coords: { lat: 51.5072, lng: -0.1276 },
  },
  {
    id: 'fairbanks',
    label: 'Fairbanks, AK',
    subtitle: 'Subarctic Ice Fog & Smoke',
    coords: { lat: 64.8378, lng: -147.7164 },
  },
];

export const RANDOM_LOCATION_POOL: CityPreset[] = [
  ...WINTER_SMOG_PRESETS,
  {
    id: 'lahore',
    label: 'Lahore, PK',
    subtitle: 'Indus Basin Inversion',
    coords: { lat: 31.5204, lng: 74.3587 },
  },
  {
    id: 'kathmandu',
    label: 'Kathmandu, NP',
    subtitle: 'Himalayan Valley Bowl',
    coords: { lat: 27.7172, lng: 85.324 },
  },
  {
    id: 'warsaw',
    label: 'Warsaw, PL',
    subtitle: 'Winter Heating Smog',
    coords: { lat: 52.2297, lng: 21.0122 },
  },
  {
    id: 'ulaanbaatar',
    label: 'Ulaanbaatar, MN',
    subtitle: 'Cold-Air Basin Trap',
    coords: { lat: 47.8864, lng: 106.9057 },
  },
  {
    id: 'beijing',
    label: 'Beijing, CN',
    subtitle: 'North China Plain Haze',
    coords: { lat: 39.9042, lng: 116.4074 },
  },
  {
    id: 'bishkek',
    label: 'Bishkek, KG',
    subtitle: 'Foothill Winter Smog',
    coords: { lat: 42.8746, lng: 74.5698 },
  },
];

export interface EnvironmentTelemetry {
  resolvedAddress: string;
  airQuality: AirQualitySnapshot;
  weather: WeatherSnapshot | null;
  inversionRisk: InversionRiskAssessment;
  forecastWindows: DailyWindowAnalysis;
  sanctuaries: CleanSanctuary[];
}

const PROFILE_STORAGE_KEY = 'clearhearth_household_profile_v1';

function loadSavedProfile(): HouseholdProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_HOUSEHOLD_PROFILE;
    return { ...DEFAULT_HOUSEHOLD_PROFILE, ...(JSON.parse(raw) as Partial<HouseholdProfile>) };
  } catch {
    return DEFAULT_HOUSEHOLD_PROFILE;
  }
}

export function useAirQualityDashboard() {
  const [coords, setCoords] = useState<GeoCoordinates>(WINTER_SMOG_PRESETS[0].coords);
  const [locationLabel, setLocationLabel] = useState<string>(WINTER_SMOG_PRESETS[0].label);
  const [profile, setProfile] = useState<HouseholdProfile>(loadSavedProfile);
  const [telemetry, setTelemetry] = useState<EnvironmentTelemetry | null>(null);
  const [plan, setPlan] = useState<AdvisorPlan | null>(null);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState<boolean>(true);
  const [isLoadingPlan, setIsLoadingPlan] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const updateProfile = useCallback((next: HouseholdProfile) => {
    setProfile(next);
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const loadTelemetry = useCallback(async (targetCoords: GeoCoordinates, explicitLabel?: string) => {
    setIsLoadingTelemetry(true);
    setError(null);

    try {
      let data: EnvironmentTelemetry;
      try {
        data = await safeFetchJson<EnvironmentTelemetry>('/api/environment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetCoords),
        });
      } catch (apiErr) {
        if (apiErr instanceof HttpFetchError && (apiErr.status === 404 || apiErr.status >= 500)) {
          data = await fetchDirectBrowserTelemetry(targetCoords);
        } else {
          throw apiErr;
        }
      }

      setTelemetry(data);
      setLocationLabel(
        explicitLabel ||
          data.resolvedAddress ||
          `${targetCoords.lat.toFixed(3)}, ${targetCoords.lng.toFixed(3)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load environmental data.');
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, []);

  useEffect(() => {
    void loadTelemetry(coords, locationLabel);
  }, [coords]);

  const refreshPlan = useCallback(
    async (
      currentTelemetry: EnvironmentTelemetry,
      activeProfile: HouseholdProfile,
      activeLocationName: string,
      activeCoords: GeoCoordinates
    ) => {
      setIsLoadingPlan(true);
      setPlanError(null);
      try {
        const pm25 = currentTelemetry.airQuality.pollutants.find((p) => p.code === 'pm25')?.value ?? 12;
        const no2 = currentTelemetry.airQuality.pollutants.find((p) => p.code === 'no2')?.value ?? 15;
        const { metric, scale } = getPrimaryAqiContext(currentTelemetry.airQuality);
        const uaqi = metric?.aqi ?? 55;
        const category = metric?.category ?? 'Moderate air quality';
        const dominantPollutant = metric?.dominantPollutant ?? 'pm25';

        let nextPlan: AdvisorPlan;
        try {
          nextPlan = await safeFetchJson<AdvisorPlan>('/api/advisor/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationName: activeLocationName,
              coordinates: activeCoords,
              householdProfile: activeProfile,
              currentUaqi: uaqi,
              aqiScale: scale,
              currentCategory: category,
              dominantPollutant,
              pm25UgM3: pm25,
              no2Ppb: no2,
              inversionSeverity: currentTelemetry.inversionRisk.severity,
              inversionSummary: currentTelemetry.inversionRisk.summary,
              cleanestWindowLabel: currentTelemetry.forecastWindows.cleanestWindow?.label ?? null,
              peakSmogWindowLabel: currentTelemetry.forecastWindows.peakSmogWindow?.label ?? null,
              windSpeedKmh: currentTelemetry.weather?.windSpeedKmh ?? 8,
              temperatureC: currentTelemetry.weather?.temperatureC ?? 6,
            }),
          });
        } catch {
          nextPlan = buildBrowserFallbackPlan({
            locationName: activeLocationName,
            profile: activeProfile,
            pm25UgM3: pm25,
            aqi: uaqi,
            cleanWindow: currentTelemetry.forecastWindows.cleanestWindow?.label ?? null,
            peakWindow: currentTelemetry.forecastWindows.peakSmogWindow?.label ?? null,
            inversionSummary: currentTelemetry.inversionRisk.summary,
          });
        }

        setPlan(nextPlan);
      } catch (err) {
        setPlanError(
          err instanceof Error ? err.message : 'Could not generate tailored family guidance.'
        );
      } finally {
        setIsLoadingPlan(false);
      }
    },
    []
  );

  useEffect(() => {
    if (telemetry) {
      void refreshPlan(telemetry, profile, locationLabel, coords);
    }
    // Intentionally trigger once per resolved telemetry snapshot or profile update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry, profile, refreshPlan]);

  const selectLocation = useCallback((nextCoords: GeoCoordinates, label?: string) => {
    if (label) {
      setLocationLabel(label);
    }
    setCoords(nextCoords);
  }, []);

  const selectRandomLocation = useCallback(() => {
    const candidates = RANDOM_LOCATION_POOL.filter(
      (c) =>
        Math.abs(c.coords.lat - coords.lat) > 0.05 ||
        Math.abs(c.coords.lng - coords.lng) > 0.05
    );
    const chosen =
      candidates[Math.floor(Math.random() * candidates.length)] ?? RANDOM_LOCATION_POOL[0];
    setLocationLabel(chosen.label);
    setCoords(chosen.coords);
  }, [coords]);

  const searchAddress = useCallback(async (query: string) => {
    setError(null);
    let payload: { lat: number; lng: number; formattedAddress: string };
    try {
      payload = await safeFetchJson<{
        lat: number;
        lng: number;
        formattedAddress: string;
      }>('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: query }),
      });
    } catch (apiErr) {
      if (apiErr instanceof HttpFetchError && (apiErr.status === 404 || apiErr.status >= 500)) {
        payload = await geocodeDirectBrowser(query);
      } else {
        throw apiErr;
      }
    }
    setLocationLabel(payload.formattedAddress);
    setCoords({ lat: payload.lat, lng: payload.lng });
  }, []);

  return {
    coords,
    locationLabel,
    profile,
    telemetry,
    plan,
    isLoadingTelemetry,
    isLoadingPlan,
    error,
    planError,
    updateProfile,
    selectLocation,
    selectRandomLocation,
    searchAddress,
    reloadTelemetry: () => void loadTelemetry(coords, locationLabel),
    regeneratePlan: () => telemetry && void refreshPlan(telemetry, profile, locationLabel, coords),
  };
}
