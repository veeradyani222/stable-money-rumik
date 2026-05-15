export function shouldLogDiagnosticEvent(input: { label?: string; event?: string }): boolean {
  const label = (input.label ?? '').toString();
  const event = (input.event ?? '').toString();
  const value = `${label} ${event}`.trim();

  if (!value) return false;
  if (process.env.DEBUG_LOG_ALL === '1') return true;

  if (label === '[stable-agent:route]') return true;
  if (label === '[stable-agent:tool]') return true;

  return /(^|[:_\-\s])(error|failed|failure|timeout|invalid|missing)([:_\-\s]|$)/i.test(value);
}
