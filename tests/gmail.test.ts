import test from 'node:test';
import assert from 'node:assert/strict';

import { readBufferedSmtpLine, renderEmailTemplate, sendGmailMessage, type GmailTransportMessage } from '../lib/gmail';

test('renderEmailTemplate injects the email title and body content', () => {
  const html = renderEmailTemplate('Support ticket created', '<p>Your ticket is ready.</p>');

  assert.match(html, /Support ticket created/);
  assert.match(html, /<p>Your ticket is ready\.<\/p>/);
  assert.doesNotMatch(html, /\$\{title\}/);
  assert.doesNotMatch(html, /\$\{contentHtml\}/);
});

test('sendGmailMessage returns a config error without attempting transport when Gmail env is missing', async () => {
  let calls = 0;

  const result = await sendGmailMessage(
    {
      to: 'customer@example.com',
      subject: 'Ticket created',
      text: 'Your ticket is ready.',
    },
    {
      env: {},
      transport: async () => {
        calls += 1;
      },
    },
  );

  assert.equal(result.sent, false);
  assert.equal(result.to, 'customer@example.com');
  assert.match(result.error ?? '', /Gmail configuration/i);
  assert.equal(calls, 0);
});

test('sendGmailMessage builds a Gmail SMTP message and reports success from injected transport', async () => {
  const messages: GmailTransportMessage[] = [];

  const result = await sendGmailMessage(
    {
      to: 'customer@example.com',
      subject: 'Secure link',
      text: 'Use this secure link.',
    },
    {
      env: {
        GMAIL_USER: 'support@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
        GMAIL_FROM_NAME: 'Stable Assist',
      },
      transport: async (input) => {
        messages.push(input);
      },
    },
  );

  assert.equal(result.sent, true, result.error);
  assert.equal(result.to, 'customer@example.com');
  assert.equal(result.error, undefined);
  assert.equal(messages.length, 1);

  const message = messages[0];
  assert.ok(message);
  assert.equal(message.username, 'support@example.com');
  assert.equal(message.password, 'app-password');
  assert.match(message.raw, /From: Stable Assist <support@example.com>/);
  assert.match(message.raw, /To: customer@example.com/);
  assert.match(message.raw, /Subject: Secure link/);
  assert.match(message.raw, /Use this secure link\./);
});

test('sendGmailMessage reports transport failures without throwing', async () => {
  const result = await sendGmailMessage(
    {
      to: 'customer@example.com',
      subject: 'Ticket created',
      text: 'Your ticket is ready.',
    },
    {
      env: {
        GMAIL_USER: 'support@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
      },
      transport: async () => {
        throw new Error('SMTP rejected credentials');
      },
    },
  );

  assert.equal(result.sent, false);
  assert.equal(result.to, 'customer@example.com');
  assert.match(result.error ?? '', /SMTP rejected credentials/);
});

test('sendGmailMessage times out a hanging Gmail transport', async () => {
  const result = await sendGmailMessage(
    {
      to: 'customer@example.com',
      subject: 'Ticket created',
      text: 'Your ticket is ready.',
    },
    {
      env: {
        GMAIL_USER: 'support@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
      },
      timeoutMs: 5,
      transport: async () => {
        await new Promise<void>(() => {});
      },
    },
  );

  assert.equal(result.sent, false);
  assert.equal(result.to, 'customer@example.com');
  assert.match(result.error ?? '', /timed out/i);
});

test('sendGmailMessage retries once after a timed-out Gmail transport', async () => {
  let calls = 0;

  const result = await sendGmailMessage(
    {
      to: 'customer@example.com',
      subject: 'Ticket created',
      text: 'Your ticket is ready.',
    },
    {
      env: {
        GMAIL_USER: 'support@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
      },
      timeoutMs: 5,
      transport: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>(() => {});
        }
      },
    },
  );

  assert.equal(result.sent, true, result.error);
  assert.equal(result.to, 'customer@example.com');
  assert.equal(result.error, undefined);
  assert.equal(calls, 2);
});

test('readBufferedSmtpLine drains multiline SMTP responses already in the buffer', () => {
  const bufferRef = { value: '250-smtp.gmail.com at your service\r\n250 AUTH LOGIN\r\n' };

  assert.equal(readBufferedSmtpLine(bufferRef), '250-smtp.gmail.com at your service');
  assert.equal(readBufferedSmtpLine(bufferRef), '250 AUTH LOGIN');
  assert.equal(readBufferedSmtpLine(bufferRef), null);
});
