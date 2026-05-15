export function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

interface StreamSink {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

function isInvalidStateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Controller is already closed') || (error as Error & { code?: string }).code === 'ERR_INVALID_STATE';
}

export function createSseWriter(sink: StreamSink) {
  let closed = false;

  const sendRaw = (chunk: Uint8Array) => {
    if (closed) return;
    try {
      sink.enqueue(chunk);
    } catch (error) {
      if (isInvalidStateError(error)) {
        closed = true;
        return;
      }
      throw error;
    }
  };

  return {
    send(event: string, data: unknown) {
      sendRaw(encodeEvent(event, data));
    },
    sendRaw,
    close() {
      if (closed) return;
      closed = true;
      try {
        sink.close();
      } catch (error) {
        if (!isInvalidStateError(error)) throw error;
      }
    },
  };
}
