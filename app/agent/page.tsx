import '@/styles/bloom-onboarding.css';
import '@/styles/stable-onboarding.css';
import '@/styles/agent-call.css';

import { Suspense } from 'react';

import { AgentCallClient } from '@/components/agent/AgentCallClient';

export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <div className="agent-shell">
          <div className="agent-card">
            <div className="agent-loading">
              <div className="onb-spinner" aria-hidden />
              <h1>Loading Stable Money...</h1>
              <p>Your demo session is connected. Hang tight.</p>
            </div>
          </div>
        </div>
      }
    >
      <AgentCallClient />
    </Suspense>
  );
}
