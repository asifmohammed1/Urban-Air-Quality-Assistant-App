import { useState, type FormEvent } from 'react';
import { ExternalLink, Globe, MapPin, Send } from 'lucide-react';
import { safeFetchJson } from '../lib/http.ts';
import type { AqiScale, GeoCoordinates, HouseholdProfile } from '../shared/airQualityModel.ts';

interface GroundedSourceLink {
  title: string;
  uri: string;
  kind: 'web' | 'maps';
}

interface CommunityAdvisorPanelProps {
  locationLabel: string;
  coords: GeoCoordinates;
  currentUaqi: number;
  aqiScale: AqiScale;
  pm25UgM3: number;
  profile: HouseholdProfile;
}

const SUGGESTED_QUESTIONS: Array<{ label: string; mode: 'search_policy' | 'maps_sanctuaries' }> = [
  {
    label: 'Are there winter smog or wood-burning advisories active here today?',
    mode: 'search_policy',
  },
  {
    label: 'How should we build a safe DIY box-fan MERV-13 filter for our kids’ bedroom?',
    mode: 'search_policy',
  },
  {
    label: 'Which nearby indoor libraries or transit hubs are best during peak smog?',
    mode: 'maps_sanctuaries',
  },
];

export function CommunityAdvisorPanel({
  locationLabel,
  coords,
  currentUaqi,
  aqiScale,
  pm25UgM3,
  profile,
}: CommunityAdvisorPanelProps) {
  const [mode, setMode] = useState<'search_policy' | 'maps_sanctuaries'>('search_policy');
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [answerMarkdown, setAnswerMarkdown] = useState<string | null>(null);
  const [sources, setSources] = useState<GroundedSourceLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submitQuery = async (
    targetQuestion: string,
    targetMode: 'search_policy' | 'maps_sanctuaries'
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const householdSummary = `${profile.householdSize} people (${profile.sensitiveGroups.join(', ') || 'general family'}), ${profile.commuteMode}, ${profile.heatingSource}`;
      const payload = await safeFetchJson<{
        markdown: string;
        sources?: GroundedSourceLink[];
      }>('/api/advisor/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: targetQuestion,
          locationName: locationLabel,
          coordinates: coords,
          mode: targetMode,
          currentUaqi,
          aqiScale,
          pm25UgM3,
          householdSummary,
        }),
      });
      setAnswerMarkdown(payload.markdown);
      setSources(payload.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach advisor.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 2) return;
    void submitQuery(trimmed, mode);
  };

  return (
    <section
      id="community-advisor"
      aria-label="Community and household air quality advisor"
      className="mx-auto max-w-7xl px-4 py-6 pb-12 sm:px-6 lg:px-8"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Grounded Community & Policy Advisor
            </h2>
            <p className="text-sm text-slate-600">
              Ask about local winter smog alerts, school recess thresholds, indoor filtration math, or nearby clean-air places.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setMode('search_policy')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'search_policy'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Web & Policy Search</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('maps_sanctuaries')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'maps_sanctuaries'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Maps Sanctuaries</span>
            </button>
          </div>
        </div>

        {/* Suggested Prompts */}
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setMode(item.mode);
                setQuestion(item.label);
                void submitQuery(item.label, item.mode);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer text-left"
            >
              {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="advisor-question-input" className="sr-only">
            Ask the air quality advisor a question
          </label>
          <input
            id="advisor-question-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={600}
            placeholder={
              mode === 'maps_sanctuaries'
                ? 'Ask for indoor clean-air libraries, museums, or transit near you...'
                : 'Ask about local smog advisories, school air rules, or mask grades...'
            }
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-teal-700 focus:outline-none min-h-11"
          />
          <button
            type="submit"
            disabled={isLoading || question.trim().length < 2}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 min-h-11 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>{isLoading ? 'Searching...' : 'Ask Advisor'}</span>
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        {answerMarkdown && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5" aria-live="polite">
            <div className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">
              {answerMarkdown}
            </div>

            {sources.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-700">
                  Verified Grounding Sources
                </h3>
                <ul className="mt-2 flex flex-wrap gap-3">
                  {sources.map((src, idx) => (
                    <li key={idx}>
                      <a
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline"
                      >
                        <span>{src.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
