'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PersonaCard } from '@/components/onboarding/PersonaCard';
import { PersonaDetailModal } from '@/components/onboarding/PersonaDetailModal';
import { isValidEmail } from '@/lib/email';
import type { PersonaSeed } from '@/lib/personas';
import { PERSONAS } from '@/lib/personas';

type Step = 1 | 2;

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isTouchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return /iPad|iPhone|iPod/.test(userAgent) || isTouchMac;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [microphoneGateRequired, setMicrophoneGateRequired] = useState(false);
  const [microphoneSubmitting, setMicrophoneSubmitting] = useState(false);
  const [bodyKey, setBodyKey] = useState(0);
  const [email, setEmail] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [committedEmail, setCommittedEmail] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [detailPersona, setDetailPersona] = useState<PersonaSeed | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeStep = microphoneGateRequired ? 0 : step;
  const progress = activeStep === 0 ? 12 : activeStep === 1 ? 50 : 100;
  const selectedPersona = useMemo(
    () => PERSONAS.find((p) => p.persona_id === selectedPersonaId) ?? null,
    [selectedPersonaId],
  );

  const bumpBody = useCallback(() => {
    setBodyKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setMicrophoneGateRequired(isIOSDevice());
  }, []);

  const goBack = useCallback(() => {
    if (microphoneGateRequired) return;
    if (step !== 2) return;
    setError('');
    setStep(1);
    bumpBody();
  }, [bumpBody, microphoneGateRequired, step]);

  const handleMicrophonePermission = useCallback(async () => {
    setError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone access is not available in this browser.');
      return;
    }

    setMicrophoneSubmitting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneGateRequired(false);
      bumpBody();
    } catch {
      setError('Please allow microphone access to start the voice-agent demo.');
    } finally {
      setMicrophoneSubmitting(false);
    }
  }, [bumpBody]);

  const handleEmailContinue = useCallback(async () => {
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (sessionId && committedEmail === trimmed) {
      setStep(2);
      bumpBody();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data === 'object' && data && 'error' in data && typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Something went wrong. Try again.';
        setError(message);
        return;
      }
      const sid =
        typeof data === 'object' && data && 'session_id' in data && typeof (data as { session_id: unknown }).session_id === 'string'
          ? (data as { session_id: string }).session_id
          : null;
      const persistedPersonaId =
        typeof data === 'object' && data && 'persona_id' in data && typeof (data as { persona_id: unknown }).persona_id === 'string'
          ? (data as { persona_id: string }).persona_id
          : null;
      if (!sid) {
        setError('Unexpected response from server.');
        return;
      }
      setSessionId(sid);
      setCommittedEmail(trimmed);
      if (persistedPersonaId) {
        setSelectedPersonaId(persistedPersonaId);
        router.push(`/agent?session_id=${encodeURIComponent(sid)}`);
        return;
      }
      setStep(2);
      bumpBody();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [bumpBody, committedEmail, email, router, sessionId]);

  const enterPersona = useCallback(async (personaId: string | null) => {
    if (!sessionId || !personaId) {
      setError('Please pick a persona to continue.');
      return;
    }

    setError('');
    setSelectedPersonaId(personaId);
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/select-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, persona_id: personaId }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data === 'object' && data && 'error' in data && typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Could not save your choice.';
        setError(message);
        return;
      }
      router.push(`/agent?session_id=${encodeURIComponent(sessionId)}`);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [router, sessionId]);

  const handlePersonaContinue = useCallback(async () => {
    await enterPersona(selectedPersonaId);
  }, [enterPersona, selectedPersonaId]);

  const primaryAction = microphoneGateRequired
    ? handleMicrophonePermission
    : step === 1
      ? handleEmailContinue
      : handlePersonaContinue;
  const continueDisabled =
    microphoneGateRequired
      ? microphoneSubmitting
      : submitting || (step === 2 && !selectedPersonaId) || (step === 1 && !email.trim());
  const continueLabel =
    microphoneGateRequired
      ? 'Enable microphone'
      : step === 1
        ? 'Continue'
        : selectedPersona
          ? `Enter as ${selectedPersona.name}`
          : 'Enter';

  return (
    <main className="onb">
      <div className="onb-card">
        <div className="onb-progress-bar">
          <div className="onb-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="onb-header">
          <button
            type="button"
            className="onb-back"
            onClick={goBack}
            disabled={microphoneGateRequired || step === 1}
            aria-label="Go back"
          >
            ‹
          </button>
          <span className="onb-step-label">
            {microphoneGateRequired ? 'Setup' : `${step} / 2`}
          </span>
        </div>

        <div
          className={step === 2 && !microphoneGateRequired ? 'onb-body onb-body--persona-step' : 'onb-body'}
          key={bodyKey}
        >
          {microphoneGateRequired ? (
            <div className="onb-content">
              <div className="onb-question">
                <h2>Enable microphone</h2>
                <p>iPhone and iPad need microphone access before the voice-agent demo can start.</p>
              </div>
              <div className="onb-answer">
                {error ? <p className="onb-error">{error}</p> : null}
              </div>
            </div>
          ) : step === 1 ? (
            <div className="onb-content">
              <div className="onb-question">
                <h2>Welcome to Stable Money</h2>
                <p>Enter your email to start the voice-agent demo.</p>
              </div>
              <div className="onb-answer">
                <label className="visually-hidden" htmlFor="onb-email">
                  Email address
                </label>
                <input
                  id="onb-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  className="onb-text-input"
                  placeholder="you@mail.com"
                  value={email}
                  disabled={submitting}
                  onChange={(e) => {
                    setError('');
                    setEmail(e.target.value);
                  }}
                />
                {error ? <p className="onb-error">{error}</p> : null}
              </div>
            </div>
          ) : (
            <div className="onb-content">
              <div className="onb-question">
                <h2>Who do you want to be today?</h2>
                <p>Select a demo customer scenario. You can revisit this persona anytime in this session.</p>
              </div>
              <div className="onb-answer">
                <div className="persona-grid">
                  {PERSONAS.map((persona) => (
                    <PersonaCard
                      key={persona.persona_id}
                      persona={persona}
                      selected={selectedPersonaId === persona.persona_id}
                      onViewDetails={(p) => setDetailPersona(p)}
                    />
                  ))}
                </div>
                {error ? <p className="onb-error">{error}</p> : null}
              </div>
            </div>
          )}
        </div>

        <div className="onb-footer">
          <button
            type="button"
            className="onb-continue"
            onClick={primaryAction}
            disabled={continueDisabled}
            aria-busy={microphoneGateRequired ? microphoneSubmitting : submitting}
          >
            <span className="onb-continue-inner">
              {(microphoneGateRequired ? microphoneSubmitting : submitting) ? (
                <span className="onb-continue-spinner" aria-hidden />
              ) : null}
              {submitting ? (step === 1 ? 'Saving…' : 'Entering…') : continueLabel}
            </span>
          </button>
        </div>
      </div>

      <PersonaDetailModal
        persona={detailPersona}
        onClose={() => setDetailPersona(null)}
        onChoose={async (id) => {
          setDetailPersona(null);
          await enterPersona(id);
        }}
      />
    </main>
  );
}
