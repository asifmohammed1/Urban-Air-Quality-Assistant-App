import { useState } from 'react';
import { RefreshCw, CheckSquare, Square, Users } from 'lucide-react';
import {
  calculateChoiceImpact,
  type AdvisorPlan,
  type HouseholdProfile,
} from '../shared/airQualityModel.ts';

interface TailoredActionPlanProps {
  profile: HouseholdProfile;
  pm25UgM3: number;
  plan: AdvisorPlan | null;
  isLoading: boolean;
  error: string | null;
  onRegenerate: () => void;
}

type PlanTab = 'routines' | 'indoor' | 'swaps';

export function TailoredActionPlan({
  profile,
  pm25UgM3,
  plan,
  isLoading,
  error,
  onRegenerate,
}: TailoredActionPlanProps) {
  const [activeTab, setActiveTab] = useState<PlanTab>('routines');
  const [choices, setChoices] = useState({
    adoptTransitOrWalk: true,
    adoptTimedVentilationAndFiltration: true,
    adoptElectricCookingOrHeating: false,
    wearN95DuringPeak: true,
  });

  const impact = calculateChoiceImpact(profile, pm25UgM3, choices);

  const toggleChoice = (key: keyof typeof choices) => {
    setChoices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section
      id="action-plan"
      aria-label="Tailored family action plan and direct impact simulator"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
    >
      {/* Direct Choice Impact Simulator Strip */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Direct Impact of Your Daily Choices
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Toggle protective habits below to quantify real-time emissions avoided and indoor PM2.5 reduction for {profile.householdName}.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-100 pt-4 lg:border-t-0 lg:pt-0">
            <div>
              <div className="text-xs text-slate-500">CO2e Avoided</div>
              <div className="font-mono text-xl font-semibold text-teal-800 tabular-nums">
                {impact.dailyCo2SavedGrams.toLocaleString()} g/day
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">NOx Avoided</div>
              <div className="font-mono text-xl font-semibold text-teal-800 tabular-nums">
                {impact.dailyNoxSavedGrams.toFixed(1)} g/day
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Indoor PM2.5 Drop</div>
              <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
                -{impact.estimatedIndoorPm25DropPct}% ({impact.estimatedIndoorPm25UgM3} µg/m³)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Peak Inhaled Cut</div>
              <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
                -{impact.pm25InhalationReductionPct}%
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Choice Toggles */}
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 border-t border-slate-100 pt-4">
          {[
            {
              key: 'adoptTransitOrWalk' as const,
              label: `Transit / clean commute (${profile.dailyCommuteKm} km)`,
            },
            {
              key: 'adoptTimedVentilationAndFiltration' as const,
              label: 'Timed ventilation + HEPA / MERV-13',
            },
            {
              key: 'adoptElectricCookingOrHeating' as const,
              label: 'Zero-combustion heating & cooking',
            },
            {
              key: 'wearN95DuringPeak' as const,
              label: 'N95/FFP2 during peak smog hours',
            },
          ].map((item) => {
            const active = choices[item.key];
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleChoice(item.key)}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors min-h-10 cursor-pointer ${
                  active
                    ? 'border-teal-700 bg-teal-50/70 text-teal-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {active ? (
                  <CheckSquare className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                ) : (
                  <Square className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* GenAI Tailored Guidance Section */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Personalized Family Action Plan
            </h2>
            {plan && (
              <p className="mt-1 text-sm text-slate-700">{plan.headline}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'routines', label: 'Daily Routines' },
                  { id: 'indoor', label: 'Indoor Air Hacks' },
                  { id: 'swaps', label: 'Sustainable Swaps' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onRegenerate}
              disabled={isLoading}
              aria-label="Regenerate AI action plan"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 min-h-10 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh Plan</span>
            </button>
          </div>
        </div>

        {isLoading && !plan && (
          <div className="py-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
          </div>
        )}

        {error && !plan && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        )}

        {plan && (
          <div className="mt-5">
            <p className="mb-5 text-sm text-slate-600 leading-relaxed">
              {plan.winterSmogSummary}
            </p>

            {activeTab === 'routines' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {plan.dailyRoutines.map((routine, idx) => (
                  <article
                    key={idx}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono font-medium text-slate-800 tabular-nums">
                        {routine.timeWindow}
                      </span>
                      <span className="capitalize font-medium text-teal-800">
                        {routine.priority} priority
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                      {routine.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">
                      {routine.guidance}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-slate-200/80 pt-3 text-xs text-slate-600 sm:grid-cols-2">
                      <div>
                        <span className="font-semibold text-slate-800">Exposure: </span>
                        {routine.exposureImpact}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Emissions: </span>
                        {routine.emissionImpact}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {activeTab === 'indoor' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {plan.indoorHacks.map((hack, idx) => (
                  <article
                    key={idx}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                  >
                    <div>
                      <div className="text-xs text-slate-500">
                        <span>{hack.estimatedCostTier}</span>
                        <span aria-hidden="true"> · </span>
                        <span>Indoor Protection</span>
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                        {hack.title}
                      </h3>
                      <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                        {hack.mechanism}
                      </p>
                      <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                        {hack.actionSteps.map((step, sIdx) => (
                          <li key={sIdx} className="leading-snug">
                            • {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-3 text-xs font-medium text-teal-900">
                      Direct impact: {hack.directImpact}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {activeTab === 'swaps' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {plan.sustainableSwaps.map((swap, idx) => (
                  <article
                    key={idx}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                  >
                    <div>
                      <div className="text-xs text-slate-500">
                        Instead of: {swap.currentHabit}
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                        {swap.sustainableAlternative}
                      </h3>
                      <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                        {swap.feasibilityNote}
                      </p>
                    </div>
                    <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs">
                      <div className="font-medium text-teal-900">
                        Health benefit: {swap.directHealthBenefit}
                      </div>
                      <div className="font-medium text-slate-700">
                        Emissions cut: {swap.emissionReduction}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="mt-5 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">Neighborhood Collective Step: </span>
                {plan.communityAction}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
