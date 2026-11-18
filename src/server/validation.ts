import { z } from 'zod';

export const coordinatesSchema = z.object({
  lat: z.number().finite().min(-85).max(85),
  lng: z.number().finite().min(-180).max(180),
});

export const householdProfileSchema = z.object({
  householdName: z.string().trim().min(1).max(80),
  householdSize: z.number().int().min(1).max(20),
  sensitiveGroups: z
    .array(z.enum(['children', 'elderly', 'respiratory', 'pregnant', 'athletes']))
    .max(5),
  commuteMode: z.enum(['gas_car', 'hybrid_ev', 'public_transit', 'walk_bike']),
  dailyCommuteKm: z.number().finite().min(0).max(300),
  heatingSource: z.enum(['wood_coal', 'natural_gas', 'electric_heat_pump']),
  filtrationLevel: z.enum(['none', 'diy_merv13', 'hepa_purifier']),
  homeSizeSqM: z.number().finite().min(15).max(1500),
});

export const actionPlanRequestSchema = z.object({
  locationName: z.string().trim().min(1).max(160),
  coordinates: coordinatesSchema,
  householdProfile: householdProfileSchema,
  currentUaqi: z.number().finite().min(0).max(500),
  aqiScale: z.enum(['uaqi', 'us_epa']).optional(),
  currentCategory: z.string().trim().min(1).max(120),
  dominantPollutant: z.string().trim().min(1).max(40),
  pm25UgM3: z.number().finite().min(0).max(2000),
  no2Ppb: z.number().finite().min(0).max(2000),
  inversionSeverity: z.enum(['Low', 'Moderate', 'High', 'Severe']),
  inversionSummary: z.string().trim().min(1).max(400),
  cleanestWindowLabel: z.string().trim().max(100).nullable(),
  peakSmogWindowLabel: z.string().trim().max(100).nullable(),
  windSpeedKmh: z.number().finite().min(0).max(300),
  temperatureC: z.number().finite().min(-70).max(60),
});

export const advisorChatSchema = z.object({
  question: z.string().trim().min(2).max(600),
  locationName: z.string().trim().min(1).max(160),
  coordinates: coordinatesSchema,
  mode: z.enum(['search_policy', 'maps_sanctuaries']),
  currentUaqi: z.number().finite().min(0).max(500),
  aqiScale: z.enum(['uaqi', 'us_epa']).optional(),
  pm25UgM3: z.number().finite().min(0).max(2000),
  householdSummary: z.string().trim().min(1).max(300),
});

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(10).max(1500),
});

export const geocodeQuerySchema = z.object({
  address: z.string().trim().min(2).max(200),
});
