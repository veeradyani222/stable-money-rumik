export function getDeepgramGrantErrorMessage(status: number, details: Record<string, unknown>): string {
  const providerMessage =
    typeof details.err_msg === 'string'
      ? details.err_msg
      : typeof details.message === 'string'
        ? details.message
        : '';

  if (status === 403 && /insufficient permissions/i.test(providerMessage)) {
    return 'Deepgram API key needs Member permission or higher to create temporary voice tokens.';
  }

  return providerMessage ? `Deepgram token request failed: ${providerMessage}` : 'Could not create Deepgram token';
}

export function getDeepgramListenProtocols(accessToken: string): string[] {
  return ['bearer', accessToken];
}
