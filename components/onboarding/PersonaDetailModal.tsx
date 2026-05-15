'use client';

import { useCallback, useEffect, useId } from 'react';

import type { PersonaSeed } from '@/lib/personas';
import { personaDetailSections } from '@/lib/personas-display';

function renderDetailValue(value: string) {
  return value.split('\n').map((line, lineIndex) => {
    const parts = line.split(/([A-Za-z][A-Za-z ]*:)/g);

    return (
      <span key={`${lineIndex}-${line}`}>
        {lineIndex > 0 ? <br /> : null}
        {parts.map((part, partIndex) => {
          if (/^[A-Za-z][A-Za-z ]*:$/.test(part)) {
            return <strong key={`${lineIndex}-${partIndex}`}>{part}</strong>;
          }
          return part;
        })}
      </span>
    );
  });
}

interface PersonaDetailModalProps {
  persona: PersonaSeed | null;
  onClose: () => void;
  onChoose: (personaId: string) => void | Promise<void>;
}

export function PersonaDetailModal({ persona, onClose, onChoose }: PersonaDetailModalProps) {
  const titleId = useId();
  const open = Boolean(persona);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, handleKeyDown]);

  if (!persona) return null;

  const sections = personaDetailSections(persona);

  return (
    <div
      className="persona-modal-root"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="persona-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="persona-modal-header">
          <div className="persona-modal-title-block">
            <h2 id={titleId} className="persona-modal-title">
              {persona.name}
            </h2>
          </div>
          <button
            type="button"
            className="persona-modal-close"
            onClick={onClose}
            aria-label="Close details"
          >
            ×
          </button>
        </div>

        <div className="persona-modal-body">
          {sections.map((section) => (
            <section key={section.heading} className="persona-modal-section">
              <h3 className="persona-modal-section-title">{section.heading}</h3>
              <dl className="persona-modal-dl">
                {section.rows.map((row) => (
                  <div
                    key={row.label}
                    className={row.pre ? 'persona-modal-row persona-modal-row--pre' : 'persona-modal-row'}
                  >
                    <dt>{row.label}</dt>
                    <dd className={row.pre ? 'persona-modal-dd--pre' : undefined}>
                      {row.pre ? renderDetailValue(row.value) : row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="persona-modal-footer">
          <button type="button" className="persona-modal-btn persona-modal-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="persona-modal-btn persona-modal-btn--primary"
            onClick={() => onChoose(persona.persona_id)}
          >
            Choose this persona
          </button>
        </div>
      </div>
    </div>
  );
}
