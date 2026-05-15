'use client';

import type { PersonaSeed } from '@/lib/personas';

interface PersonaCardProps {
  persona: PersonaSeed;
  selected: boolean;
  onViewDetails: (persona: PersonaSeed) => void;
}

export function PersonaCard({ persona, selected, onViewDetails }: PersonaCardProps) {
  return (
    <div className={`persona-card ${selected ? 'persona-card--selected' : ''}`}>
      <div className="persona-card__body">
        <h3 className="persona-card__name">{persona.name}</h3>
        <button type="button" className="persona-card__details-btn" onClick={() => onViewDetails(persona)}>
          View details
        </button>
      </div>
    </div>
  );
}
