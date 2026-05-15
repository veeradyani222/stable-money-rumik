import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const onboardingSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'onboarding', 'OnboardingFlow.tsx'),
  'utf8',
);

test('onboarding asks iOS users for microphone permission before the email step', () => {
  assert.match(onboardingSource, /function isIOSDevice/);
  assert.match(onboardingSource, /const \[microphoneGateRequired, setMicrophoneGateRequired\] = useState\(false\);/);
  assert.match(onboardingSource, /setMicrophoneGateRequired\(isIOSDevice\(\)\);/);
  assert.match(onboardingSource, /microphoneGateRequired \? 0 : step/);
  assert.match(onboardingSource, /Enable microphone/);
  assert.match(onboardingSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(onboardingSource, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(onboardingSource, /setMicrophoneGateRequired\(false\)/);
});
