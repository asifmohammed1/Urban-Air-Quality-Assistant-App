import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type {
  CommuteMode,
  FiltrationLevel,
  HeatingSource,
  HouseholdProfile,
  SensitiveGroup,
} from '../shared/airQualityModel.ts';

interface HouseholdProfileDrawerProps {
  isOpen: boolean;
  profile: HouseholdProfile;
  onClose: () => void;
  onSave: (updated: HouseholdProfile) => void;
}

const SENSITIVE_GROUP_OPTIONS: Array<{ id: SensitiveGroup; label: string }> = [
  { id: 'children', label: 'Infants & Children' },
  { id: 'elderly', label: 'Older Adults (65+)' },
  { id: 'respiratory', label: 'Asthma / Respiratory Sensitivity' },
  { id: 'pregnant', label: 'Pregnant Household Member' },
  { id: 'athletes', label: 'Outdoor Runners / Cyclists' },
];

export function HouseholdProfileDrawer({
  isOpen,
  profile,
  onClose,
  onSave,
}: HouseholdProfileDrawerProps) {
  const [draft, setDraft] = useState<HouseholdProfile>(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleGroup = (group: SensitiveGroup) => {
    setDraft((prev) => ({
      ...prev,
      sensitiveGroups: prev.sensitiveGroups.includes(group)
        ? prev.sensitiveGroups.filter((g) => g !== group)
        : [...prev.sensitiveGroups, group],
    }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-dialog-title"
    >
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl border-l border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="profile-dialog-title" className="text-lg font-bold text-slate-900">
              Household Air & Mobility Profile
            </h2>
            <p className="text-xs text-slate-600">
              Tailors routines, indoor CADR math, and emission swap impact
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close household profile panel"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 min-h-10 min-w-10 flex items-center justify-center cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="household-name" className="block text-sm font-medium text-slate-800">
                Household Label
              </label>
              <input
                id="household-name"
                type="text"
                required
                maxLength={60}
                value={draft.householdName}
                onChange={(e) => setDraft({ ...draft, householdName: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="household-size" className="block text-sm font-medium text-slate-800">
                People in Home
              </label>
              <input
                id="household-size"
                type="number"
                min={1}
                max={20}
                required
                value={draft.householdSize}
                onChange={(e) =>
                  setDraft({ ...draft, householdSize: Math.max(1, Number(e.target.value) || 1) })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">
              Vulnerable & Sensitive Groups
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SENSITIVE_GROUP_OPTIONS.map((opt) => {
                const checked = draft.sensitiveGroups.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                      checked
                        ? 'border-teal-700 bg-teal-50/70 text-teal-950 font-medium'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(opt.id)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="commute-mode" className="block text-sm font-medium text-slate-800">
                Primary Commute Mode
              </label>
              <select
                id="commute-mode"
                value={draft.commuteMode}
                onChange={(e) =>
                  setDraft({ ...draft, commuteMode: e.target.value as CommuteMode })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                <option value="gas_car">Gasoline / Diesel Car</option>
                <option value="hybrid_ev">Hybrid / Electric Vehicle</option>
                <option value="public_transit">Public Transit (Rail / Bus)</option>
                <option value="walk_bike">Walking / Cycling</option>
              </select>
            </div>

            <div>
              <label htmlFor="commute-km" className="block text-sm font-medium text-slate-800">
                Daily Round-Trip (km)
              </label>
              <input
                id="commute-km"
                type="number"
                min={0}
                max={300}
                required
                value={draft.dailyCommuteKm}
                onChange={(e) =>
                  setDraft({ ...draft, dailyCommuteKm: Math.max(0, Number(e.target.value) || 0) })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="heating-source" className="block text-sm font-medium text-slate-800">
                Heating & Cooking Fuel
              </label>
              <select
                id="heating-source"
                value={draft.heatingSource}
                onChange={(e) =>
                  setDraft({ ...draft, heatingSource: e.target.value as HeatingSource })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                <option value="wood_coal">Wood Stove / Solid Fuel</option>
                <option value="natural_gas">Natural Gas Furnace & Stove</option>
                <option value="electric_heat_pump">Electric Heat Pump & Induction</option>
              </select>
            </div>

            <div>
              <label htmlFor="filtration-level" className="block text-sm font-medium text-slate-800">
                Indoor Air Filtration
              </label>
              <select
                id="filtration-level"
                value={draft.filtrationLevel}
                onChange={(e) =>
                  setDraft({ ...draft, filtrationLevel: e.target.value as FiltrationLevel })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                <option value="none">No Active Purifier</option>
                <option value="diy_merv13">DIY Box Fan + MERV-13 Filter</option>
                <option value="hepa_purifier">True HEPA Air Purifier(s)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="home-size" className="block text-sm font-medium text-slate-800">
              Living Space Area (m²)
            </label>
            <input
              id="home-size"
              type="number"
              min={15}
              max={1500}
              required
              value={draft.homeSizeSqM}
              onChange={(e) =>
                setDraft({ ...draft, homeSizeSqM: Math.max(15, Number(e.target.value) || 80) })
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-10 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 min-h-10 cursor-pointer"
            >
              Save & Recompute Plan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
