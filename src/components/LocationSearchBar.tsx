import { useState, type FormEvent } from 'react';
import { LocateFixed, MapPin, Search, Shuffle } from 'lucide-react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions.ts';
import { WINTER_SMOG_PRESETS } from '../hooks/useAirQualityDashboard.ts';
import type { GeoCoordinates } from '../shared/airQualityModel.ts';

interface LocationSearchBarProps {
  currentLocationLabel: string;
  currentCoords: GeoCoordinates;
  isLoading: boolean;
  mapsEnabled: boolean;
  onSelectLocation: (coords: GeoCoordinates, label?: string) => void;
  onRandomLocation: () => void;
  onSearchAddress: (address: string) => Promise<void>;
}

function MapsAutocompleteDropdown({
  query,
  onSelectSuggestion,
  onError,
}: {
  query: string;
  onSelectSuggestion: (coords: GeoCoordinates, label: string) => void;
  onError: (msg: string) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const { suggestions, resetSession } = useAutocompleteSuggestions(query);

  if (suggestions.length === 0) return null;

  const handleSuggestionClick = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      if (place.location) {
        const label =
          place.formattedAddress ||
          place.displayName ||
          suggestion.placePrediction.text.text;
        onSelectSuggestion(
          { lat: place.location.lat(), lng: place.location.lng() },
          label
        );
      }
      resetSession();
    } catch {
      onError('Could not resolve that place. Try another neighborhood or city.');
    }
  };

  return (
    <ul
      role="listbox"
      aria-label="Address suggestions"
      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
    >
      {suggestions.map((s, idx) => (
        <li key={s.placePrediction?.placeId ?? idx}>
          <button
            type="button"
            onClick={() => void handleSuggestionClick(s)}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 cursor-pointer"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
            <span className="truncate">{s.placePrediction?.text.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LocationSearchBar({
  currentLocationLabel,
  currentCoords,
  isLoading,
  mapsEnabled,
  onSelectLocation,
  onRandomLocation,
  onSearchAddress,
}: LocationSearchBarProps) {
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setSearchError(null);
    try {
      await onSearchAddress(trimmed);
      setQuery('');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Unable to locate that address.');
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setSearchError('Browser geolocation is unavailable on this device.');
      return;
    }
    setIsLocating(true);
    setSearchError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        onSelectLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setIsLocating(false);
        setSearchError('Location permission denied. You can search any city or neighborhood above.');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  return (
    <section aria-label="Location selection" className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
              <span className="font-medium text-slate-700">Active monitoring area</span>
              <span aria-hidden="true">·</span>
              <span>
                {currentCoords.lat.toFixed(3)}°, {currentCoords.lng.toFixed(3)}°
              </span>
            </div>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl text-balance">
              {currentLocationLabel}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <form onSubmit={handleSubmit} className="relative w-full sm:w-72">
              <label htmlFor="location-search-input" className="sr-only">
                Search neighborhood, city, or street address
              </label>
              <div className="relative flex items-center">
                <Search
                  className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="location-search-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search city (e.g. Hyderabad)..."
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-20 text-sm text-slate-900 placeholder:text-slate-500 focus:border-teal-700 focus:bg-white focus:outline-none min-h-10"
                />
                <button
                  type="submit"
                  disabled={isLoading || query.trim().length < 2}
                  className="absolute right-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                >
                  Check
                </button>
              </div>

              {mapsEnabled && (
                <MapsAutocompleteDropdown
                  query={query}
                  onSelectSuggestion={(nextCoords, label) => {
                    setSearchError(null);
                    setQuery('');
                    onSelectLocation(nextCoords, label);
                  }}
                  onError={setSearchError}
                />
              )}
            </form>

            <button
              type="button"
              onClick={handleUseMyLocation}
              disabled={isLocating || isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-10 cursor-pointer"
            >
              <LocateFixed className="h-4 w-4 text-teal-700" aria-hidden="true" />
              <span>{isLocating ? 'Locating...' : 'Use My Location'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSearchError(null);
                onRandomLocation();
              }}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-10 cursor-pointer"
            >
              <Shuffle className="h-4 w-4 text-teal-700" aria-hidden="true" />
              <span>Random Location</span>
            </button>
          </div>
        </div>

        {/* Benchmark Winter Smog Quick-Switch Tabs */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-medium text-slate-500 mr-1">Featured cities:</span>
          {WINTER_SMOG_PRESETS.map((preset) => {
            const isSelected =
              Math.abs(preset.coords.lat - currentCoords.lat) < 0.02 &&
              Math.abs(preset.coords.lng - currentCoords.lng) < 0.02;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectLocation(preset.coords, preset.label)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {searchError && (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
            {searchError}
          </p>
        )}
      </div>
    </section>
  );
}
