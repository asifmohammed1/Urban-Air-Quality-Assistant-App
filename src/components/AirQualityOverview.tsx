import { useState } from 'react';
import { Volume2, Wind, Thermometer, Gauge, ShieldAlert, Clock, Loader2 } from 'lucide-react';
import { safeFetchJson } from '../lib/http.ts';
import {
  getAqiSeverityMeta,
  getPrimaryAqiContext,
  type HouseholdProfile,
} from '../shared/airQualityModel.ts';
import type { EnvironmentTelemetry } from '../hooks/useAirQualityDashboard.ts';

interface AirQualityOverviewProps {
  locationLabel: string;
  telemetry: EnvironmentTelemetry | null;
  profile: HouseholdProfile;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function AirQualityOverview({
  locationLabel,
  telemetry,
  profile,
  isLoading,
  error,
  onRetry,
}: AirQualityOverviewProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isSpeakingLocal, setIsSpeakingLocal] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  if (isLoading && !telemetry) {
    return (
      <section id="conditions" aria-label="Current air quality conditions" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      </section>
    );
  }

  if (error && !telemetry) {
    return (
      <section id="conditions" aria-label="Air quality error" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
          <h2 className="text-base font-semibold">Unable to load air quality telemetry</h2>
          <p className="mt-1 text-sm text-rose-800">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-900 min-h-10 cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </section>
    );
  }

  if (!telemetry) return null;

  const { airQuality, weather, inversionRisk, forecastWindows } = telemetry;
  const { metric: primaryAqi, scale } = getPrimaryAqiContext(airQuality);
  const useUsScale = scale === 'us_epa';
  const localAqi = airQuality.localAqi;
  const pm25 = airQuality.pollutants.find((p) => p.code === 'pm25')?.value ?? 0;
  const whoMultiple = (pm25 / 15).toFixed(1);
  const severity = getAqiSeverityMeta(primaryAqi?.aqi ?? 55, useUsScale);

  const handlePlayAudioBriefing = async () => {
    if (isSpeakingLocal && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeakingLocal(false);
      return;
    }

    setIsGeneratingAudio(true);
    setAudioError(null);
    setAudioUrl(null);
    try {
      const cleanWindowText = forecastWindows.cleanestWindow
        ? `The cleanest outdoor window is ${forecastWindows.cleanestWindow.label}.`
        : '';
      const scaleName = useUsScale ? 'US EPA AQI' : 'Universal AQI';
      const briefingText = [
        `ClearHearth daily air quality briefing for ${locationLabel}.`,
        `Current ${scaleName} is ${primaryAqi?.aqi ?? 'unavailable'}, rated ${primaryAqi?.category ?? severity.level}.`,
        `Fine particulate PM 2.5 is ${pm25.toFixed(1)} micrograms per cubic meter, which is ${whoMultiple} times the World Health Organization 24-hour guideline.`,
        `Winter thermal inversion risk is ${inversionRisk.severity}. ${inversionRisk.summary}`,
        cleanWindowText,
        `Guidance for ${profile.householdName}: ${severity.maskAdvice}`,
      ]
        .filter(Boolean)
        .join(' ');

      const payload = await safeFetchJson<{
        audioBase64?: string;
        fallbackSpeech?: boolean;
        text?: string;
      }>('/api/advisor/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: briefingText }),
      });

      if (payload.audioBase64) {
        setAudioUrl(`data:audio/wav;base64,${payload.audioBase64}`);
        return;
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(payload.text || briefingText);
        utterance.rate = 0.98;
        utterance.onend = () => setIsSpeakingLocal(false);
        utterance.onerror = () => setIsSpeakingLocal(false);
        setIsSpeakingLocal(true);
        window.speechSynthesis.speak(utterance);
        return;
      }

      throw new Error('Audio briefing is unavailable on this browser.');
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Audio briefing failed.');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  // Build clean SVG polyline points for the 24h forecast chart
  const series = forecastWindows.hourlySeries;
  const chartScale = forecastWindows.scale;
  const isChartUsScale = chartScale === 'us_epa';
  const maxChartAqi = isChartUsScale
    ? Math.max(200, ...series.map((s) => s.aqi))
    : 100;

  const chartWidth = 640;
  const chartHeight = 148;
  const padX = 24;
  const padY = 18;
  const plotW = chartWidth - padX * 2;
  const plotH = chartHeight - padY * 2;

  const yForValue = (val: number) => {
    const clamped = Math.max(0, Math.min(maxChartAqi, val));
    return padY + (1 - clamped / maxChartAqi) * plotH;
  };

  const polyPoints =
    series.length > 1
      ? series
          .map((pt, idx) => {
            const x = padX + (idx / (series.length - 1)) * plotW;
            const y = yForValue(pt.aqi);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  const shortScaleTag = isChartUsScale ? 'US-AQI' : 'UAQI';

  return (
    <section id="conditions" aria-label="Live air quality and winter inversion telemetry" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        {/* Primary AQI & Forecast Card */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {airQuality.dataSource ?? 'Live Environmental Telemetry'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Updated {new Date(airQuality.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {localAqi && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {localAqi.displayName}: {localAqi.aqiDisplay}
                    </span>
                  </>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-4">
                <div>
                  <span className="font-mono text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {primaryAqi?.aqiDisplay ?? '--'}
                  </span>
                  <span className="ml-2 text-xs font-medium text-slate-500">
                    {primaryAqi?.displayName ?? 'AQI'}
                  </span>
                </div>
                <div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${severity.surfaceClass} ${severity.borderClass} ${severity.textClass}`}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{severity.level} · {primaryAqi?.category ?? 'Monitoring'}</span>
                  </span>
                  <p className="mt-1.5 text-sm text-slate-600">
                    Dominant pollutant: <strong className="font-semibold text-slate-900">{(primaryAqi?.dominantPollutant ?? 'pm25').toUpperCase()}</strong>
                    <span aria-hidden="true"> · </span>
                    <span className="tabular-nums">PM2.5 is {pm25.toFixed(1)} µg/m³ ({whoMultiple}× WHO 24h limit)</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => void handlePlayAudioBriefing()}
                disabled={isGeneratingAudio}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 min-h-10 cursor-pointer whitespace-nowrap"
              >
                {isGeneratingAudio ? (
                  <Loader2 className="h-4 w-4 animate-spin text-teal-700" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4 text-teal-700" aria-hidden="true" />
                )}
                <span>
                  {isGeneratingAudio
                    ? 'Synthesizing...'
                    : isSpeakingLocal
                      ? 'Stop Briefing'
                      : 'Listen to Briefing'}
                </span>
              </button>
            </div>
          </div>

          {audioUrl && (
            <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/60 p-3">
              <p className="mb-1.5 text-xs font-medium text-teal-950">
                Daily Family Audio Briefing (Gemini Speech)
              </p>
              <audio controls src={audioUrl} className="w-full h-9" />
            </div>
          )}
          {audioError && (
            <p role="alert" className="mt-2 text-xs text-rose-700">
              {audioError}
            </p>
          )}

          {/* Protective Mask & Sensitive Group Notice */}
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">
              Immediate Respiratory Guidance for {profile.householdName}
            </p>
            <p className="mt-1 text-sm text-slate-700 leading-relaxed">
              {severity.maskAdvice}{' '}
              {airQuality.healthRecommendations.children ||
                airQuality.healthRecommendations.generalPopulation ||
                ''}
            </p>
          </div>

          {/* 24-Hour Air Quality & Window Forecast Chart */}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {isChartUsScale
                  ? 'Next 24-Hour US EPA AQI Trajectory (Lower = Cleaner Air)'
                  : 'Next 24-Hour Universal AQI Trajectory (Higher = Cleaner Air)'}
              </h2>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 tabular-nums">
                {forecastWindows.cleanestWindow && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    Cleanest window: {forecastWindows.cleanestWindow.label} ({shortScaleTag} {forecastWindows.cleanestWindow.avgAqi})
                  </span>
                )}
                {forecastWindows.peakSmogWindow && (
                  <span className="inline-flex items-center gap-1.5 text-amber-900 font-medium">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    Peak smog trap: {forecastWindows.peakSmogWindow.label} ({shortScaleTag} {forecastWindows.peakSmogWindow.avgAqi})
                  </span>
                )}
              </div>
            </div>

            {series.length > 1 ? (
              <div className="mt-3 overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="h-36 w-full min-w-[460px]"
                  role="img"
                  aria-label="24-hour AQI forecast trend"
                >
                  {/* Reference thresholds */}
                  <line
                    x1={padX}
                    y1={yForValue(isChartUsScale ? 50 : 80)}
                    x2={chartWidth - padX}
                    y2={yForValue(isChartUsScale ? 50 : 80)}
                    stroke="#a7f3d0"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={padX}
                    y1={yForValue(isChartUsScale ? 150 : 40)}
                    x2={chartWidth - padX}
                    y2={yForValue(isChartUsScale ? 150 : 40)}
                    stroke="#fcd34d"
                    strokeDasharray="4 4"
                  />
                  <polyline
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polyPoints}
                  />
                  {series.map((pt, idx) => {
                    const x = padX + (idx / (series.length - 1)) * plotW;
                    const y = yForValue(pt.aqi);
                    const showTick = idx % 4 === 0 || idx === series.length - 1;
                    return (
                      <g key={pt.isoTime}>
                        <circle cx={x} cy={y} r="3" fill="#0f766e">
                          <title>{`${pt.timeLabel}: ${shortScaleTag} ${pt.aqi}`}</title>
                        </circle>
                        {showTick && (
                          <text
                            x={x}
                            y={chartHeight - 2}
                            textAnchor="middle"
                            className="fill-slate-500 text-[10px] font-mono"
                          >
                            {pt.timeLabel}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Hourly forecast curve is temporarily unavailable for this coordinate.
              </p>
            )}
          </div>
        </div>

        {/* Winter Thermal Inversion & Weather Diagnostic Card */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Winter Inversion Diagnostic</h2>
              <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                Risk {inversionRisk.score}/100 · {inversionRisk.severity}
              </span>
            </div>

            <p className="mt-2.5 text-sm text-slate-700 leading-relaxed">
              {inversionRisk.summary}
            </p>

            {weather && (
              <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-slate-100 py-4 text-center">
                <div>
                  <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Thermometer className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Temp</span>
                  </dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {weather.temperatureC.toFixed(1)}°C
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Wind className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Wind</span>
                  </dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {weather.windSpeedKmh.toFixed(0)} km/h
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pressure</span>
                  </dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {Math.round(weather.pressureHpa)} hPa
                  </dd>
                </div>
              </dl>
            )}

            <ul className="mt-4 space-y-2 text-xs text-slate-600">
              {inversionRisk.factors.map((factor, idx) => (
                <li key={idx} className="leading-relaxed">
                  • {factor}
                </li>
              ))}
            </ul>
          </div>

          {/* Compact Pollutant Table */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold text-slate-800 mb-2">
              Measured Urban Pollutants
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 font-medium">Pollutant</th>
                    <th className="py-1.5 text-right font-medium">Concentration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {airQuality.pollutants.slice(0, 5).map((p) => (
                    <tr key={p.code} className="hover:bg-slate-50">
                      <td className="py-1.5 font-medium text-slate-800">{p.displayName}</td>
                      <td className="py-1.5 text-right font-mono text-slate-700 tabular-nums">
                        {p.value.toFixed(1)}{' '}
                        <span className="text-[11px] text-slate-500">
                          {p.units === 'MICROGRAMS_PER_CUBIC_METER' ? 'µg/m³' : 'ppb'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
