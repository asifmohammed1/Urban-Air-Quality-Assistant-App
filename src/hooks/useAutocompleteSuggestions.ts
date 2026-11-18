import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export interface UseAutocompleteSuggestionsReturn {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  resetSession: () => void;
}

/**
 * Retrieves place autocomplete suggestions using the modern Places API (New)
 * AutocompleteSuggestion interface with proper AutocompleteSessionToken lifecycle.
 */
export function useAutocompleteSuggestions(
  inputString: string,
  requestOptions: Partial<google.maps.places.AutocompleteRequest> = {}
): UseAutocompleteSuggestionsReturn {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = inputString.trim();
    if (!placesLib || trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      setIsLoading(true);
      try {
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          ...requestOptions,
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res.suggestions ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setSuggestions([]);
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('RESOURCE_EXHAUSTED')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, inputString]);

  return {
    suggestions,
    isLoading,
    resetSession: () => {
      sessionTokenRef.current = null;
      setSuggestions([]);
    },
  };
}
