# ClearHearth — Urban Air Quality & Winter Smog Assistant

ClearHearth is a GenAI-powered environmental health and low-emission lifestyle assistant built to help **families and vulnerable households** navigate severe winter smog and urban air pollution.

- **Live Demo:** https://urban-air-quality-assistant-app.vercel.app/
- **GitHub Repository:** https://github.com/asifmohammed1/Urban-Air-Quality-Assistant-App

---

## 1. Chosen Challenge Vertical & Persona

- **Vertical:** **Families & Vulnerable Households** (parents with young children, older adults 65+, and individuals with asthma or cardiovascular sensitivity).
- **Problem Addressed:** Winter temperature inversions trap fine particulate matter ($\text{PM}_{2.5}$) and nitrogen dioxide ($\text{NO}_2$) close to street level—turning morning school runs, evening commutes, and indoor cooking/heating into concentrated health hazards. Families often receive raw AQI numbers without actionable timing, indoor filtration math, or visibility into how shifting daily habits directly lowers both their exposure and neighborhood emissions.

---

## 2. Approach & Decision Logic

ClearHearth combines a **deterministic environmental & emission engine** (`src/shared/airQualityModel.ts`) with **live Google Maps Platform telemetry** and **Gemini GenAI synthesis** (`src/server/geminiService.ts`):

1. **Winter Thermal Inversion Diagnostic (`assessWinterInversionRisk`)**
   - Combines real-time wind speed, sea-level barometric pressure, ambient temperature, relative humidity, and $\text{PM}_{2.5}$ concentration to score stagnation risk (`0–100` / `Low` to `Severe`).
   - Explains *why* smog is pooling (e.g., stagnant winds $< 6\text{ km/h}$ under high pressure $\ge 1022\text{ hPa}$ and sub-freezing air).
2. **24-Hour Clean-Window Detection (`analyzeForecastWindows`)**
   - Scans the next 24 hourly Air Quality and Weather forecasts to locate the **Cleanest Outdoor Window** (highest consecutive 2-hour UAQI block) and **Peak Smog Trap Window**, enabling families to schedule errands, stroller walks, and brief cross-ventilation safely.
3. **Direct Choice Impact Engine (`calculateChoiceImpact`)**
   - Quantifies the immediate impact of household choices using EPA/WHO emission factors and indoor infiltration/CADR reduction ratios:
     - **Tailpipe Emissions Avoided:** Daily $\text{CO}_{2}\text{e}$ (g/day) and $\text{NO}_x$ (g/day) avoided by swapping cold-start car trips for public transit or walking.
     - **Indoor $\text{PM}_{2.5}$ Reduction:** Estimated indoor $\mu\text{g/m}^3$ and `%` drop from timed ventilation + HEPA or DIY MERV-13 box-fan filtration + zero-combustion cooking/heating.
     - **Peak Inhaled Particulate Cut:** Cumulative exposure reduction (`%`) from off-peak scheduling and properly fitted N95/FFP2 masks.
4. **Tailored GenAI Guidance (`gemini-4-hydrogen`)**
   - Generates structured JSON recommendations (`Daily Routines`, `Indoor Air Hacks`, `Sustainable Swaps`, and `Community Action`) strictly tailored to the family's home size ($\text{m}^2$), heating/cooking fuel, commute distance, and sensitive household members.

---

## 3. Google Services Integrated

ClearHearth integrates **7 Google services** across server-side orchestration and the interactive React client:

| Google Service | How It Is Used |
| :--- | :--- |
| **Gemini API (`gemini-4-hydrogen`)** | Generates structured JSON household routines, indoor hacks, and sustainable swaps grounded in live telemetry. |
| **Gemini Search Grounding (`googleSearch`)** | Answers real-time community questions on local winter smog alerts, school outdoor-recess policies, and mask standards with clickable web citations. |
| **Gemini Maps Grounding (`googleMaps`)** | Recommends nearby indoor clean-air sanctuaries and transit alternatives with direct Google Maps grounding links. |
| **Gemini Text-to-Speech (`gemini-3.8-flash-lite-tts`)** | Synthesizes accessible WAV audio briefings (`audio/wav`) of daily conditions and protective advice for seniors, caregivers, and visually impaired users. |
| **Google Maps Air Quality API** | Fetches `currentConditions` (UAQI, Local AQI, $\text{PM}_{2.5}$, $\text{PM}_{10}$, $\text{NO}_2$, $\text{O}_3$, $\text{CO}$, $\text{SO}_2$, health recommendations), `forecast` (24-hour trajectory), and `US_AQI` heatmap tile overlays. |
| **Google Maps Weather API** | Supplies current and 24-hour hourly temperature, wind speed, humidity, and barometric pressure to drive the Winter Inversion Diagnostic. |
| **Google Maps JS, Places (New), Routes & Geocoding v4** | Renders the interactive `@vis.gl/react-google-maps` map (`AdvancedMarker` + `InfoWindow`), session-tokenized `AutocompleteSuggestion` search, `places:searchNearby` indoor shelter discovery, Geocoding v4 forward/reverse lookup, and `Route.computeRoutes` Transit vs. Walking vs. Driving comparisons. |

---

## 4. How the Solution Works

1. **Location & Persona Context:** Users default to **Hyderabad, IN** and can switch instantaneously via a **Random Location** selector (12 global winter-smog cities), featured quick-switch tabs (Hyderabad, New Delhi, Salt Lake City, Milan, London, Fairbanks), address search, browser geolocation, or Places API (New) autocomplete. Households customize their **Household Profile** (children, seniors, asthma sensitivity, commute mode/km, home area, heating fuel, filtration).
2. **Resilient Unified Telemetry Pipeline (`/api/environment`):** The Express backend validates coordinates with Zod, checks bounded-memory TTL caches, and queries Google Maps Platform Air Quality, Weather, Places Nearby, and Geocoding v4 in parallel—automatically falling back to live **Open-Meteo CAMS Air Quality**, **Open-Meteo Weather**, **Open-Meteo Geocoding**, **Nominatim**, and **OpenStreetMap Overpass** endpoints whenever a Maps API key is unconfigured or restricted.
3. **Personalized GenAI & Audio Briefing (`/api/advisor/plan`, `/api/advisor/tts`, `/api/advisor/ask`):** Gemini generates the household-specific plan, answers grounded policy/sanctuary questions, and produces playable WAV audio summaries. All API keys stay strictly server-side for Gemini and Maps REST endpoints.
4. **Interactive Neighborhood Action & Spatial Fallback:** Families toggle choices in the **Direct Impact Simulator**, inspect nearby filtered indoor spaces (libraries, museums, pharmacies, transit stations) on either the interactive Google Map with AQI Heatmap & Routes comparison or the zero-key **Spatial Sanctuary Radar**, and quantify low-emission commute savings.

---

## 5. Engineering Quality, Security, Efficiency, Testing & Accessibility

- **Code Quality:** Modular TypeScript across `src/shared/`, `src/server/`, `src/hooks/`, `src/lib/`, and `src/components/`, strict `tsconfig` linting (`npm run lint`), and zero legacy Maps APIs.
- **Security:** All Gemini and Google Maps REST calls run server-side; strict `zod` schema validation on every endpoint; security response headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); sliding-window per-IP rate limiting; zero hardcoded secrets.
- **Efficiency:** Bounded-memory LRU TTL caches (`src/server/cache.ts`) prevent redundant upstream calls; debounced Place Autocomplete with `AutocompleteSessionToken`; minimal `X-Goog-FieldMask` headers on Places/Geocoding requests.
- **Testing:** Automated Vitest suite (`npm test`) covering winter inversion physics, dual-scale (`uaqi` & `us_epa`) forecast window detection, household emission/CADR impact math, cache eviction/expiration, and Zod input validation.
- **Accessibility:** Semantic landmarks, skip-to-main-content link, `aria-live` announcements, WCAG AA contrast with explicit text+icon state labels (never color alone), `prefers-reduced-motion` support, keyboard-accessible drawer with `Escape` handling, and Gemini TTS audio briefings.

---

## 6. Assumptions Made

- **Dual-Scale AQI Compatibility:** When Google Air Quality API is active, Universal AQI (`0–100`, higher = cleaner air) is used as the primary trajectory; when Open-Meteo CAMS fallback is active, US EPA AQI (`0–500`, lower = cleaner air) is automatically detected and normalized across charts, severity thresholds, and Gemini prompts alongside raw $\text{PM}_{2.5}$ ($\mu\text{g/m}^3$) vs. the WHO 24-hour guideline ($15\ \mu\text{g/m}^3$).
- **Emission & Infiltration Factors:** Daily $\text{CO}_{2}\text{e}$ and $\text{NO}_x$ savings use standard passenger vehicle averages ($\sim 192\text{ g CO}_2/\text{km}$ with a $1.18\times$ winter cold-start factor); indoor $\text{PM}_{2.5}$ reductions model typical winter infiltration ($0.65$) plus portable HEPA / MERV-13 filtration attenuation.
- **Server Runtime:** Designed for Node.js `v22+` with `tsx` in development and `node server.ts` in production on port `3000`.

---

## 7. Local Setup & Verification

```bash
npm install
cp .env.example .env   # Add GEMINI_API_KEY and VITE_GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_API_KEY
npm test               # Run Vitest unit & validation suite
npm run lint           # TypeScript type-check
npm run build          # Build production client bundle
npm run dev            # Start Express + Vite dev server on port 3000
```
