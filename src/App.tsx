import { useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AirQualityOverview } from './components/AirQualityOverview.tsx';
import { CommunityAdvisorPanel } from './components/CommunityAdvisorPanel.tsx';
import { HeaderBar } from './components/HeaderBar.tsx';
import { HouseholdProfileDrawer } from './components/HouseholdProfileDrawer.tsx';
import { LocationSearchBar } from './components/LocationSearchBar.tsx';
import { NeighborhoodMapPanel } from './components/NeighborhoodMapPanel.tsx';
import { TailoredActionPlan } from './components/TailoredActionPlan.tsx';
import { useAirQualityDashboard } from './hooks/useAirQualityDashboard.ts';
import { safeFetchJson } from './lib/http.ts';
import { getPrimaryAqiContext } from './shared/airQualityModel.ts';

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
  );
  const [mapsAuthFailed, setMapsAuthFailed] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const {
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
    reloadTelemetry,
    regeneratePlan,
  } = useAirQualityDashboard();

  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    const onAuthFailure = () => setMapsAuthFailed(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    window.addEventListener('gmp-auth-failure', onAuthFailure);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
      window.removeEventListener('gmp-auth-failure', onAuthFailure);
    };
  }, []);

  useEffect(() => {
    if (mapsApiKey) return;
    safeFetchJson<{ apiKey?: string }>('/api/config/maps')
      .then((data) => {
        if (data.apiKey) setMapsApiKey(data.apiKey);
      })
      .catch(() => {
        // Ignore config lookup error and use spatial fallback
      });
  }, [mapsApiKey]);

  const mapsEnabled = Boolean(mapsApiKey) && !mapsAuthFailed;
  const pm25UgM3 =
    telemetry?.airQuality.pollutants.find((p) => p.code === 'pm25')?.value ?? 12;
  const { metric: primaryAqi, scale: aqiScale } = getPrimaryAqiContext(
    telemetry?.airQuality ?? null
  );
  const currentUaqi = primaryAqi?.aqi ?? 55;

  const content = (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {quotaExceeded && (
        <div
          role="status"
          className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm"
        >
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <HeaderBar onOpenProfile={() => setIsProfileOpen(true)} />

      <main id="main-content" className="flex-1">
        <LocationSearchBar
          currentLocationLabel={locationLabel}
          currentCoords={coords}
          isLoading={isLoadingTelemetry}
          mapsEnabled={mapsEnabled}
          onSelectLocation={selectLocation}
          onRandomLocation={selectRandomLocation}
          onSearchAddress={searchAddress}
        />

        <AirQualityOverview
          locationLabel={locationLabel}
          telemetry={telemetry}
          profile={profile}
          isLoading={isLoadingTelemetry}
          error={error}
          onRetry={reloadTelemetry}
        />

        <TailoredActionPlan
          profile={profile}
          pm25UgM3={pm25UgM3}
          plan={plan}
          isLoading={isLoadingPlan}
          error={planError}
          onRegenerate={regeneratePlan}
        />

        <NeighborhoodMapPanel
          center={coords}
          locationLabel={locationLabel}
          sanctuaries={telemetry?.sanctuaries ?? []}
          mapsApiKey={mapsApiKey}
          mapsEnabled={mapsEnabled}
          onMapsAuthFailure={() => setMapsAuthFailed(true)}
          onSelectCoordinates={(next) => selectLocation(next)}
        />

        <CommunityAdvisorPanel
          locationLabel={locationLabel}
          coords={coords}
          currentUaqi={currentUaqi}
          aqiScale={aqiScale}
          pm25UgM3={pm25UgM3}
          profile={profile}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            ClearHearth · Built for families navigating winter smog & urban air pollution.
          </p>
          <p>
            Powered by Gemini, Open-Meteo / OpenStreetMap open telemetry & Google Maps Platform (
            <a
              href="https://maps.google.com/help/terms_maps/?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700"
            >
              Google Maps Terms
            </a>
            ).
          </p>
        </div>
      </footer>

      <HouseholdProfileDrawer
        isOpen={isProfileOpen}
        profile={profile}
        onClose={() => setIsProfileOpen(false)}
        onSave={updateProfile}
      />
    </div>
  );

  if (!mapsEnabled) {
    return content;
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['places', 'marker', 'routes']}
      language="en"
    >
      {content}
    </APIProvider>
  );
}
