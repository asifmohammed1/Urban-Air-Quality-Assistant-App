import { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  APILoadingStatus,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Compass, ExternalLink, Layers, Navigation } from 'lucide-react';
import type { CleanSanctuary, GeoCoordinates } from '../shared/airQualityModel.ts';

interface NeighborhoodMapPanelProps {
  center: GeoCoordinates;
  locationLabel: string;
  sanctuaries: CleanSanctuary[];
  mapsApiKey: string;
  mapsEnabled: boolean;
  onMapsAuthFailure: () => void;
  onSelectCoordinates: (coords: GeoCoordinates) => void;
}

interface RouteComparison {
  destinationName: string;
  transitSummary: string | null;
  walkSummary: string | null;
  driveSummary: string | null;
  co2SavedGrams: number | null;
}

function estimateFallbackComparison(sanctuary: CleanSanctuary): RouteComparison {
  const km = sanctuary.distanceMeters / 1000;
  const walkMins = Math.max(2, Math.round((km / 4.8) * 60));
  const transitMins = Math.max(3, Math.round((km / 20) * 60) + 4);
  const driveMins = Math.max(2, Math.round((km / 24) * 60));
  const co2SavedGrams = Math.round(km * 192 * 0.72);

  return {
    destinationName: sanctuary.name,
    transitSummary: `~${transitMins} min (${km.toFixed(1)} km)`,
    walkSummary: km <= 3.5 ? `~${walkMins} min (${km.toFixed(1)} km)` : null,
    driveSummary: `~${driveMins} min (${km.toFixed(1)} km)`,
    co2SavedGrams,
  };
}

function MapsApiStatusWatcher({ onFailure }: { onFailure: () => void }) {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (
      status === APILoadingStatus.AUTH_FAILURE ||
      status === APILoadingStatus.FAILED
    ) {
      onFailure();
    }
  }, [status, onFailure]);
  return null;
}

function HeatmapOverlayController({
  enabled,
  apiKey,
}: {
  enabled: boolean;
  apiKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !apiKey) return;
    if (!enabled) {
      map.overlayMapTypes.clear();
      return;
    }

    const airQualityLayer = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => {
        if (zoom < 0 || zoom > 16) return null;
        const numTiles = 1 << zoom;
        if (coord.y < 0 || coord.y >= numTiles) return null;
        const x = ((coord.x % numTiles) + numTiles) % numTiles;
        return `https://airquality.googleapis.com/v1/mapTypes/US_AQI/heatmapTiles/${zoom}/${x}/${coord.y}?key=${encodeURIComponent(apiKey)}`;
      },
      tileSize: new google.maps.Size(256, 256),
      maxZoom: 16,
      minZoom: 0,
      name: 'US AQI Heatmap',
      opacity: 0.55,
    });

    map.overlayMapTypes.clear();
    map.overlayMapTypes.insertAt(0, airQualityLayer);

    return () => {
      map.overlayMapTypes.clear();
    };
  }, [map, enabled, apiKey]);

  return null;
}

function RoutePolylineController({
  origin,
  destination,
  onComparisonReady,
}: {
  origin: GeoCoordinates;
  destination: CleanSanctuary | null;
  onComparisonReady: (cmp: RouteComparison | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');

  useEffect(() => {
    if (!map || !routesLib || !destination) {
      onComparisonReady(destination ? estimateFallbackComparison(destination) : null);
      return;
    }

    let cancelled = false;
    let activePolylines: google.maps.Polyline[] = [];

    const runComparison = async () => {
      try {
        const destLatLng = { lat: destination.lat, lng: destination.lng };
        const fields = ['durationMillis', 'distanceMeters', 'path'];

        const formatRoute = (
          res?: { routes?: google.maps.routes.Route[] }
        ): { label: string; distanceMeters: number; route: google.maps.routes.Route } | null => {
          const r = res?.routes?.[0];
          if (!r) return null;
          const distKm = ((r.distanceMeters ?? 0) / 1000).toFixed(1);
          const mins = r.durationMillis ? Math.max(1, Math.round(r.durationMillis / 60000)) : null;
          return {
            label: mins ? `${mins} min (${distKm} km)` : `${distKm} km`,
            distanceMeters: r.distanceMeters ?? 0,
            route: r,
          };
        };

        const [transitRes, walkRes, driveRes] = await Promise.allSettled([
          routesLib.Route.computeRoutes({
            origin,
            destination: destLatLng,
            travelMode: routesLib.TravelMode.TRANSIT,
            fields,
          }),
          routesLib.Route.computeRoutes({
            origin,
            destination: destLatLng,
            travelMode: routesLib.TravelMode.WALKING,
            fields,
          }),
          routesLib.Route.computeRoutes({
            origin,
            destination: destLatLng,
            travelMode: routesLib.TravelMode.DRIVING,
            fields,
          }),
        ]);

        if (cancelled) return;

        const transit = transitRes.status === 'fulfilled' ? formatRoute(transitRes.value) : null;
        const walk = walkRes.status === 'fulfilled' ? formatRoute(walkRes.value) : null;
        const drive = driveRes.status === 'fulfilled' ? formatRoute(driveRes.value) : null;

        const chosenRoute = transit?.route || walk?.route || drive?.route;
        if (chosenRoute) {
          activePolylines = chosenRoute.createPolylines({
            polylineOptions: {
              strokeColor: '#0f766e',
              strokeOpacity: 0.9,
              strokeWeight: 5,
            },
          });
          for (const line of activePolylines) {
            line.setMap(map);
          }
        }

        if (!transit && !walk && !drive) {
          onComparisonReady(estimateFallbackComparison(destination));
          return;
        }

        const driveMeters = drive?.distanceMeters ?? destination.distanceMeters;
        const co2SavedGrams = Math.round((driveMeters / 1000) * 192 * 0.72);

        onComparisonReady({
          destinationName: destination.name,
          transitSummary: transit?.label ?? null,
          walkSummary: walk?.label ?? null,
          driveSummary: drive?.label ?? null,
          co2SavedGrams,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('RESOURCE_EXHAUSTED')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onComparisonReady(estimateFallbackComparison(destination));
      }
    };

    void runComparison();

    return () => {
      cancelled = true;
      for (const line of activePolylines) {
        line.setMap(null);
      }
    };
  }, [map, routesLib, origin, destination, onComparisonReady]);

  return null;
}

function SanctuaryMarker({
  sanctuary,
  isSelected,
  onSelect,
}: {
  sanctuary: CleanSanctuary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: sanctuary.lat, lng: sanctuary.lng }}
        onClick={onSelect}
        title={sanctuary.name}
      >
        <Pin
          background={isSelected ? '#0f766e' : '#1e293b'}
          borderColor="#ffffff"
          glyphColor="#ffffff"
        />
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onSelect}>
          <div className="max-w-xs p-1 text-slate-900">
            <div className="text-xs text-slate-500">{sanctuary.category}</div>
            <div className="font-semibold text-sm">{sanctuary.name}</div>
            <div className="mt-0.5 text-xs text-slate-600">{sanctuary.address}</div>
            <a
              href={sanctuary.mapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-800 underline"
            >
              <span>Open Map Link</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

/**
 * Interactive SVG spatial radar rendered whenever Google Maps JS is unconfigured
 * or unavailable ("no api for maps"), plotting nearby shelters by true bearing & distance.
 */
function SpatialSanctuaryRadar({
  center,
  locationLabel,
  sanctuaries,
  selectedSanctuary,
  onSelectSanctuary,
}: {
  center: GeoCoordinates;
  locationLabel: string;
  sanctuaries: CleanSanctuary[];
  selectedSanctuary: CleanSanctuary | null;
  onSelectSanctuary: (s: CleanSanctuary) => void;
}) {
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const maxRadiusPx = 158;
  const maxRangeMeters = Math.max(
    4000,
    ...sanctuaries.map((s) => s.distanceMeters + 300)
  );
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1;

  const project = (lat: number, lng: number) => {
    const dxMeters = (lng - center.lng) * cosLat * 111320;
    const dyMeters = (lat - center.lat) * 111320;
    const scale = maxRadiusPx / maxRangeMeters;
    return {
      x: cx + dxMeters * scale,
      y: cy - dyMeters * scale,
    };
  };

  return (
    <div className="relative flex h-[420px] w-full flex-col items-center justify-between overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex w-full items-center justify-between text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
          <Compass className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
          <span>Spatial Sanctuary Radar · {locationLabel}</span>
        </span>
        <a
          href={`https://www.openstreetmap.org/?mlat=${center.lat}&mlon=${center.lng}#map=14/${center.lat}/${center.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
        >
          <span>Open in OpenStreetMap</span>
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-[325px] w-full max-w-[360px]"
        role="img"
        aria-label="Radial neighborhood map of nearby clean-air shelters and transit hubs"
      >
        {[0.25, 0.5, 0.75, 1].map((fraction, idx) => {
          const r = maxRadiusPx * fraction;
          const kmLabel = `${((maxRangeMeters * fraction) / 1000).toFixed(1)} km`;
          return (
            <g key={idx}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="#cbd5e1"
                strokeDasharray={idx === 3 ? undefined : '4 4'}
              />
              <text
                x={cx + 4}
                y={cy - r + 11}
                className="fill-slate-400 text-[9px] font-mono"
              >
                {kmLabel}
              </text>
            </g>
          );
        })}

        <line x1={cx} y1={cy - maxRadiusPx - 8} x2={cx} y2={cy + maxRadiusPx + 8} stroke="#e2e8f0" />
        <line x1={cx - maxRadiusPx - 8} y1={cy} x2={cx + maxRadiusPx + 8} y2={cy} stroke="#e2e8f0" />

        <text x={cx} y={cy - maxRadiusPx - 12} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">N</text>
        <text x={cx} y={cy + maxRadiusPx + 20} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">S</text>
        <text x={cx + maxRadiusPx + 14} y={cy + 3} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">E</text>
        <text x={cx - maxRadiusPx - 14} y={cy + 3} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">W</text>

        {selectedSanctuary && (() => {
          const destPt = project(selectedSanctuary.lat, selectedSanctuary.lng);
          return (
            <line
              x1={cx}
              y1={cy}
              x2={destPt.x}
              y2={destPt.y}
              stroke="#0f766e"
              strokeWidth="2"
              strokeDasharray="5 3"
            />
          );
        })()}

        {sanctuaries.map((s) => {
          const pt = project(s.lat, s.lng);
          const isSel = selectedSanctuary?.id === s.id;
          return (
            <g
              key={s.id}
              onClick={() => onSelectSanctuary(s)}
              className="cursor-pointer"
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSel ? 7 : 5}
                fill={isSel ? '#0f766e' : '#1e293b'}
                stroke="#ffffff"
                strokeWidth="2"
              >
                <title>{`${s.name} (${(s.distanceMeters / 1000).toFixed(2)} km)`}</title>
              </circle>
            </g>
          );
        })}

        {/* Active household center */}
        <circle cx={cx} cy={cy} r="7" fill="#0f766e" stroke="#ffffff" strokeWidth="2.5" />
        <text x={cx} y={cy + 19} textAnchor="middle" className="fill-slate-800 text-[10px] font-semibold">
          Active Area
        </text>
      </svg>

      <div className="w-full text-center text-xs text-slate-500 tabular-nums">
        {selectedSanctuary ? (
          <span>
            Selected: <strong className="text-slate-800">{selectedSanctuary.name}</strong> ({(selectedSanctuary.distanceMeters / 1000).toFixed(2)} km)
          </span>
        ) : (
          <span>Select any shelter dot or list item to inspect distance & zero-tailpipe savings.</span>
        )}
      </div>
    </div>
  );
}

export function NeighborhoodMapPanel({
  center,
  locationLabel,
  sanctuaries,
  mapsApiKey,
  mapsEnabled,
  onMapsAuthFailure,
  onSelectCoordinates,
}: NeighborhoodMapPanelProps) {
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [selectedSanctuary, setSelectedSanctuary] = useState<CleanSanctuary | null>(null);
  const [routeComparison, setRouteComparison] = useState<RouteComparison | null>(null);

  const handleSelectSanctuary = (place: CleanSanctuary) => {
    setSelectedSanctuary((prev) => {
      const next = prev?.id === place.id ? null : place;
      if (!mapsEnabled) {
        setRouteComparison(next ? estimateFallbackComparison(next) : null);
      }
      return next;
    });
  };

  return (
    <section
      id="neighborhood-map"
      aria-label="Interactive air quality map and clean-air sanctuaries"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Clean-Air Sanctuaries & Low-Emission Routes
            </h2>
            <p className="text-sm text-slate-600">
              Click any indoor shelter, pharmacy, or transit hub to compare zero-tailpipe routes vs. driving.
            </p>
          </div>

          {mapsEnabled && (
            <button
              type="button"
              aria-pressed={showHeatmap}
              onClick={() => setShowHeatmap((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors min-h-10 cursor-pointer whitespace-nowrap shrink-0 ${
                showHeatmap
                  ? 'border-teal-700 bg-teal-50 text-teal-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Layers className="h-4 w-4" aria-hidden="true" />
              <span>{showHeatmap ? 'AQI Heatmap: On' : 'AQI Heatmap: Off'}</span>
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-8">
            {mapsEnabled && mapsApiKey ? (
              <div className="h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                <GoogleMap
                  defaultCenter={center}
                  center={center}
                  defaultZoom={13}
                  mapId="DEMO_MAP_ID"
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  onClick={(ev) => {
                    if (ev.detail.latLng) {
                      onSelectCoordinates({
                        lat: ev.detail.latLng.lat,
                        lng: ev.detail.latLng.lng,
                      });
                    }
                  }}
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapsApiStatusWatcher onFailure={onMapsAuthFailure} />
                  <HeatmapOverlayController enabled={showHeatmap} apiKey={mapsApiKey} />
                  <RoutePolylineController
                    origin={center}
                    destination={selectedSanctuary}
                    onComparisonReady={setRouteComparison}
                  />

                  <AdvancedMarker position={center} title={locationLabel}>
                    <Pin background="#0f766e" borderColor="#ffffff" glyphColor="#ffffff" scale={1.15} />
                  </AdvancedMarker>

                  {sanctuaries.map((s) => (
                    <SanctuaryMarker
                      key={s.id}
                      sanctuary={s}
                      isSelected={selectedSanctuary?.id === s.id}
                      onSelect={() => handleSelectSanctuary(s)}
                    />
                  ))}
                </GoogleMap>
              </div>
            ) : (
              <SpatialSanctuaryRadar
                center={center}
                locationLabel={locationLabel}
                sanctuaries={sanctuaries}
                selectedSanctuary={selectedSanctuary}
                onSelectSanctuary={handleSelectSanctuary}
              />
            )}

            {routeComparison && (
              <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/60 p-3.5 text-xs text-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-teal-950">
                    Low-Emission Route to {routeComparison.destinationName}
                  </span>
                  {routeComparison.co2SavedGrams !== null && (
                    <span className="font-mono font-semibold text-teal-800 tabular-nums">
                      ~{routeComparison.co2SavedGrams} g CO2e avoided vs driving
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-slate-700 tabular-nums">
                  {routeComparison.transitSummary && (
                    <span>Transit: <strong>{routeComparison.transitSummary}</strong></span>
                  )}
                  {routeComparison.walkSummary && (
                    <span>Walk: <strong>{routeComparison.walkSummary}</strong></span>
                  )}
                  {routeComparison.driveSummary && (
                    <span>Drive baseline: <strong>{routeComparison.driveSummary}</strong></span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Nearby Clean-Air Sanctuaries List */}
          <div className="flex flex-col lg:col-span-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Nearby Filtered Spaces & Transit ({sanctuaries.length})
            </h3>
            {sanctuaries.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                No indoor public spaces found within 3.5 km. Try selecting another city or using the Advisor below.
              </div>
            ) : (
              <ul className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
                {sanctuaries.map((place) => {
                  const selected = selectedSanctuary?.id === place.id;
                  return (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectSanctuary(place)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-teal-700 bg-teal-50/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{place.category}</span>
                          <span className="font-mono tabular-nums shrink-0">
                            {(place.distanceMeters / 1000).toFixed(2)} km
                          </span>
                        </div>
                        <div className="mt-1 font-medium text-sm text-slate-900 truncate">
                          {place.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600 truncate">
                          {place.address}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-slate-600">
                            {place.openNow === true
                              ? 'Open now'
                              : place.openNow === false
                                ? 'Closed'
                                : 'Hours vary'}
                          </span>
                          <span className="inline-flex items-center gap-1 font-medium text-teal-800">
                            <Navigation className="h-3 w-3" aria-hidden="true" />
                            <span>Compare route</span>
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
