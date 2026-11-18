import { SlidersHorizontal } from 'lucide-react';

interface HeaderBarProps {
  onOpenProfile: () => void;
}

export function HeaderBar({ onOpenProfile }: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#conditions"
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ClearHearth
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a
            href="#conditions"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 py-1"
          >
            Conditions
          </a>
          <a
            href="#action-plan"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 py-1"
          >
            Action Plan
          </a>
          <a
            href="#neighborhood-map"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 py-1"
          >
            Neighborhood Map
          </a>
          <a
            href="#community-advisor"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 py-1"
          >
            Advisor
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 min-h-10 cursor-pointer"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span>Household Profile</span>
          </button>
        </div>
      </div>
    </header>
  );
}
