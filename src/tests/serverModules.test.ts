import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../server/cache.ts';
import {
  advisorChatSchema,
  coordinatesSchema,
  geocodeQuerySchema,
  householdProfileSchema,
} from '../server/validation.ts';

describe('TtlCache', () => {
  it('stores and retrieves items within TTL and evicts oldest entry past maxEntries', () => {
    const cache = new TtlCache<number>(2, 5000);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // 'a' refreshed; 'b' is now oldest
    cache.set('c', 3); // Evicts 'b'

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('expires entries after TTL elapses', () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(10, 1000);
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');

    vi.advanceTimersByTime(1500);
    expect(cache.get('key')).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('API validation schemas', () => {
  it('validates geographic coordinate bounds strictly', () => {
    expect(coordinatesSchema.safeParse({ lat: 40.76, lng: -111.89 }).success).toBe(true);
    expect(coordinatesSchema.safeParse({ lat: 95, lng: 0 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ lat: 0, lng: 200 }).success).toBe(false);
  });

  it('rejects malformed household profile inputs', () => {
    const invalid = householdProfileSchema.safeParse({
      householdName: '',
      householdSize: 0,
      sensitiveGroups: ['unknown'],
      commuteMode: 'jetpack',
      dailyCommuteKm: -5,
      heatingSource: 'natural_gas',
      filtrationLevel: 'hepa_purifier',
      homeSizeSqM: 100,
    });
    expect(invalid.success).toBe(false);
  });

  it('validates advisor question length and geocode queries', () => {
    expect(geocodeQuerySchema.safeParse({ address: 'a' }).success).toBe(false);
    expect(geocodeQuerySchema.safeParse({ address: 'Salt Lake City, UT' }).success).toBe(true);
    expect(
      advisorChatSchema.safeParse({
        question: 'x',
        locationName: 'Delhi',
        coordinates: { lat: 28.6, lng: 77.2 },
        mode: 'search_policy',
        currentUaqi: 20,
        pm25UgM3: 110,
        householdSummary: '4 people',
      }).success
    ).toBe(false);
  });
});
