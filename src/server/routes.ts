import express, { type NextFunction, type Request, type Response } from 'express';
import {
  analyzeForecastWindows,
  assessWinterInversionRisk,
  getPrimaryAqiContext,
} from '../shared/airQualityModel.ts';
import {
  askAirAdvisor,
  generateHouseholdActionPlan,
  synthesizeBriefingAudio,
} from './geminiService.ts';
import {
  fetchAirQualityForecast,
  fetchCurrentAirQuality,
  fetchCurrentWeather,
  fetchHourlyWeatherForecast,
  fetchNearbyCleanSanctuaries,
  forwardGeocodeAddress,
  getMapsApiKey,
  reverseGeocodeCoordinates,
  UpstreamApiError,
} from './googleMapsService.ts';
import {
  actionPlanRequestSchema,
  advisorChatSchema,
  coordinatesSchema,
  geocodeQuerySchema,
  ttsRequestSchema,
} from './validation.ts';

// Lightweight sliding-window rate limiter per IP (protects upstream API quotas)
const ipRequestLog = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const timestamps = (ipRequestLog.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before refreshing.',
      isQuotaExceeded: false,
    });
    return;
  }
  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  next();
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.use(rateLimitMiddleware);

  // Provides client runtime config for @vis.gl/react-google-maps without hardcoding keys
  router.get('/config/maps', (_req: Request, res: Response) => {
    res.json({
      apiKey: getMapsApiKey(),
    });
  });

  // Combined environmental telemetry endpoint (Air Quality + Weather + Forecast + Places + Address)
  router.post('/environment', async (req: Request, res: Response) => {
    const parsed = coordinatesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid coordinates provided.' });
      return;
    }

    const coords = parsed.data;
    try {
      const [airQuality, weather, wxForecast, sanctuaries, resolvedAddress] =
        await Promise.all([
          fetchCurrentAirQuality(coords),
          fetchCurrentWeather(coords),
          fetchHourlyWeatherForecast(coords),
          fetchNearbyCleanSanctuaries(coords),
          reverseGeocodeCoordinates(coords),
        ]);

      const { scale: currentScale } = getPrimaryAqiContext(airQuality);
      const aqForecastBundle = await fetchAirQualityForecast(coords, currentScale).catch(() => ({
        points: [],
        scale: currentScale,
      }));

      const inversionRisk = assessWinterInversionRisk(weather, airQuality);
      const forecastWindows = analyzeForecastWindows(
        aqForecastBundle.points,
        wxForecast,
        aqForecastBundle.scale
      );

      res.json({
        resolvedAddress,
        airQuality,
        weather,
        inversionRisk,
        forecastWindows,
        sanctuaries,
      });
    } catch (error) {
      if (error instanceof UpstreamApiError) {
        res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
          error: error.message,
          isQuotaExceeded: error.isQuotaExceeded,
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to fetch environmental telemetry.';
      res.status(500).json({ error: message, isQuotaExceeded: false });
    }
  });

  // Geocode an unstructured address / city query via Geocoding API v4
  router.post('/geocode', async (req: Request, res: Response) => {
    const parsed = geocodeQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter a valid city or address (2-200 characters).' });
      return;
    }

    try {
      const location = await forwardGeocodeAddress(parsed.data.address);
      if (!location) {
        res.status(404).json({ error: 'Location not found. Try a city name or street address.' });
        return;
      }
      res.json(location);
    } catch (error) {
      if (error instanceof UpstreamApiError) {
        res.status(error.status).json({
          error: error.message,
          isQuotaExceeded: error.isQuotaExceeded,
        });
        return;
      }
      res.status(500).json({ error: 'Geocoding request failed.' });
    }
  });

  // Generate tailored family routines, indoor hacks, and sustainable swaps via Gemini
  router.post('/advisor/plan', async (req: Request, res: Response) => {
    const parsed = actionPlanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid household or telemetry parameters.' });
      return;
    }

    try {
      const plan = await generateHouseholdActionPlan(parsed.data);
      res.json(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate action plan.';
      const status = message.includes('PERMISSION_DENIED') ? 403 : message.includes('RESOURCE_EXHAUSTED') ? 429 : 500;
      res.status(status).json({ error: message });
    }
  });

  // Grounded Q&A via Gemini + Google Search or Google Maps grounding
  router.post('/advisor/ask', async (req: Request, res: Response) => {
    const parsed = advisorChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a question between 2 and 600 characters.' });
      return;
    }

    try {
      const answer = await askAirAdvisor(parsed.data);
      res.json(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Advisor query failed.';
      res.status(500).json({ error: message });
    }
  });

  // Accessible audio briefing synthesis via Gemini TTS
  router.post('/advisor/tts', async (req: Request, res: Response) => {
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Briefing text must be between 10 and 1500 characters.' });
      return;
    }

    try {
      const audioBase64 = await synthesizeBriefingAudio(parsed.data.text);
      if (!audioBase64) {
        res.json({ fallbackSpeech: true, text: parsed.data.text });
        return;
      }
      res.json({ audioBase64, mimeType: 'audio/wav' });
    } catch {
      res.json({ fallbackSpeech: true, text: parsed.data.text });
    }
  });

  return router;
}
