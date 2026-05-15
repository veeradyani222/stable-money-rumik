import tls from 'node:tls';

const DEFAULT_GMAIL_SEND_TIMEOUT_MS = 20_000;
const DEFAULT_GMAIL_SEND_ATTEMPTS = 2;

export interface GmailMessageInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function renderEmailTemplate(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=DM+Sans:wght@400;500;700&display=swap');
  body { font-family: 'DM Sans', Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
  .header { background-color: #1c0030; padding: 30px 20px; text-align: center; border-bottom: 4px solid #d4af37; }
  .header h1 { font-family: 'Cinzel', serif; color: #d4af37; margin: 0; font-size: 28px; letter-spacing: 1px; }
  .content { padding: 40px 30px; color: #333333; line-height: 1.6; font-size: 16px; }
  .info-box { background-color: #f9f6ff; border-left: 4px solid #1c0030; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  .btn { display: inline-block; background-color: #1c0030; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin: 20px 0; border: 1px solid #d4af37; text-align: center; }
  .footer { background-color: #1a1a1a; color: #888888; text-align: center; padding: 20px; font-size: 14px; border-top: 1px solid #333; }
  .footer a { color: #d4af37; text-decoration: none; font-weight: 500; }
  .demo-notice { color: #1c0030; font-weight: 600; font-size: 14px; margin-bottom: 20px; text-align: center; padding: 10px; background-color: #f0e6ff; border-radius: 6px; border: 1px solid #d4af37; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
    </div>
    <div class="content">
      <div class="demo-notice">
        Note: This is a demo secure link / ticket for the assignment.
      </div>
      ${contentHtml}
    </div>
    <div class="footer">
      <p>Developed by <a href="https://veer.preffer.me" target="_blank">veer adyani</a></p>
    </div>
  </div>
</body>
</html>`;
}

export interface GmailSendResult {
  sent: boolean;
  to: string;
  error?: string;
}

export interface GmailTransportMessage {
  username: string;
  password: string;
  raw: string;
  timeoutMs?: number;
}

export type GmailTransport = (message: GmailTransportMessage) => Promise<void>;

export interface GmailSendOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  transport?: GmailTransport;
  timeoutMs?: number;
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function smtpDataSafe(value: string): string {
  return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function buildRawMessage(input: GmailMessageInput, username: string, fromName: string): string {
  const safeFrom = headerSafe(fromName || 'Stable Assist');
  const safeUser = headerSafe(username);
  const safeTo = headerSafe(input.to);
  const safeSubject = headerSafe(input.subject);
  const isHtml = Boolean(input.html);
  const body = smtpDataSafe(input.html || input.text);
  const contentType = isHtml ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8';

  return [
    `From: ${safeFrom} <${safeUser}>`,
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    body,
  ].join('\r\n');
}

export function readBufferedSmtpLine(bufferRef: { value: string }): string | null {
  const bufferedLineEnd = bufferRef.value.indexOf('\r\n');
  if (bufferedLineEnd !== -1) {
    const line = bufferRef.value.slice(0, bufferedLineEnd);
    bufferRef.value = bufferRef.value.slice(bufferedLineEnd + 2);
    return line;
  }
  return null;
}

function readLine(socket: tls.TLSSocket, bufferRef: { value: string }): Promise<string> {
  const bufferedLine = readBufferedSmtpLine(bufferRef);
  if (bufferedLine !== null) return Promise.resolve(bufferedLine);

  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      bufferRef.value += chunk.toString('utf8');
      const line = readBufferedSmtpLine(bufferRef);
      if (line === null) return;
      cleanup();
      resolve(line);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function expectCode(socket: tls.TLSSocket, bufferRef: { value: string }, expected: string[]): Promise<void> {
  let line = await readLine(socket, bufferRef);
  while (/^\d{3}-/.test(line)) {
    line = await readLine(socket, bufferRef);
  }
  if (!expected.some((code) => line.startsWith(code))) {
    throw new Error(`SMTP unexpected response: ${line}`);
  }
}

function writeLine(socket: tls.TLSSocket, line: string): void {
  socket.write(`${line}\r\n`);
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv | Record<string, string | undefined>, timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  const envTimeoutMs = Number(env.GMAIL_SEND_TIMEOUT_MS);
  if (Number.isFinite(envTimeoutMs) && envTimeoutMs > 0) {
    return envTimeoutMs;
  }

  return DEFAULT_GMAIL_SEND_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Gmail send timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout/i.test(message);
}

async function defaultGmailTransport(message: GmailTransportMessage): Promise<void> {
  const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
  const bufferRef = { value: '' };
  const timeoutMs = message.timeoutMs ?? DEFAULT_GMAIL_SEND_TIMEOUT_MS;
  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error(`Gmail SMTP timed out after ${timeoutMs}ms.`));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    await expectCode(socket, bufferRef, ['220']);
    writeLine(socket, 'EHLO localhost');
    await expectCode(socket, bufferRef, ['250']);
    writeLine(socket, 'AUTH LOGIN');
    await expectCode(socket, bufferRef, ['334']);
    writeLine(socket, Buffer.from(message.username).toString('base64'));
    await expectCode(socket, bufferRef, ['334']);
    writeLine(socket, Buffer.from(message.password).toString('base64'));
    await expectCode(socket, bufferRef, ['235']);
    writeLine(socket, `MAIL FROM:<${message.username}>`);
    await expectCode(socket, bufferRef, ['250']);
    const to = /^To:\s*(.+)$/im.exec(message.raw)?.[1]?.trim() ?? '';
    writeLine(socket, `RCPT TO:<${to}>`);
    await expectCode(socket, bufferRef, ['250']);
    writeLine(socket, 'DATA');
    await expectCode(socket, bufferRef, ['354']);
    socket.write(`${message.raw}\r\n.\r\n`);
    await expectCode(socket, bufferRef, ['250']);
    writeLine(socket, 'QUIT');
  } finally {
    socket.end();
  }
}

export async function sendGmailMessage(
  input: GmailMessageInput,
  options: GmailSendOptions = {},
): Promise<GmailSendResult> {
  const env = options.env ?? process.env;
  const username = env.GMAIL_USER?.trim();
  const password = env.GMAIL_APP_PASSWORD?.trim();
  const fromName = env.GMAIL_FROM_NAME?.trim() || 'Stable Assist';
  const timeoutMs = resolveTimeoutMs(env, options.timeoutMs);

  if (!username || !password) {
    return {
      sent: false,
      to: input.to,
      error: 'Gmail configuration is missing.',
    };
  }

  const transport = options.transport ?? defaultGmailTransport;
  let lastError: unknown;

  try {
    const raw = buildRawMessage(input, username, fromName);
    for (let attempt = 1; attempt <= DEFAULT_GMAIL_SEND_ATTEMPTS; attempt += 1) {
      try {
        await withTimeout(
          transport({
            username,
            password,
            raw,
            timeoutMs,
          }),
          timeoutMs,
        );
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!isTimeoutError(error) || attempt === DEFAULT_GMAIL_SEND_ATTEMPTS) {
          throw error;
        }
      }
    }
    if (lastError) throw lastError;
    return { sent: true, to: input.to };
  } catch (error) {
    return {
      sent: false,
      to: input.to,
      error: error instanceof Error ? error.message : 'Gmail send failed.',
    };
  }
}
