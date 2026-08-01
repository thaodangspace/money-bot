export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
  forSignal(signal: AbortSignal): Logger;
}

export interface LogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const signalContexts = new WeakMap<AbortSignal, LogFields>();

/** Attach request fields to all downstream logs that use this signal. */
export function bindLogContext(signal: AbortSignal, fields: LogFields): void {
  signalContexts.set(signal, { ...signalContexts.get(signal), ...fields });
}

export function createTraceId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createLogger(level: LogLevel = 'info', sink: LogSink = console): Logger {
  return new JsonLogger(level, sink);
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      error: redact(error.message),
      ...(error.cause === undefined ? {} : { cause: errorFields(error.cause) }),
    };
  }
  return { error: redact(String(error)) };
}

export function elapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

class JsonLogger implements Logger {
  readonly #level: LogLevel;
  readonly #sink: LogSink;
  readonly #context: LogFields;

  constructor(level: LogLevel, sink: LogSink, context: LogFields = {}) {
    this.#level = level;
    this.#sink = sink;
    this.#context = context;
  }

  debug(event: string, fields: LogFields = {}): void {
    this.#write('debug', event, fields);
  }
  info(event: string, fields: LogFields = {}): void {
    this.#write('info', event, fields);
  }
  warn(event: string, fields: LogFields = {}): void {
    this.#write('warn', event, fields);
  }
  error(event: string, fields: LogFields = {}): void {
    this.#write('error', event, fields);
  }

  child(fields: LogFields): Logger {
    return new JsonLogger(this.#level, this.#sink, { ...this.#context, ...fields });
  }

  forSignal(signal: AbortSignal): Logger {
    return this.child(signalContexts.get(signal) ?? {});
  }

  #write(level: LogLevel, event: string, fields: LogFields): void {
    if (levels[level] < levels[this.#level]) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.#context,
      ...fields,
    };
    const output = safeJSONStringify(record);
    this.#sink[level](output);
  }
}

export const nullLogger: Logger = new JsonLogger('error', {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (key, nested) => {
      if (
        /token|authorization|private[_-]?key|api[_-]?key|assertion|credentials?(?:json|contents?)/iu
          .test(key)
      ) return '[REDACTED]';
      return nested instanceof Error ? errorFields(nested) : nested;
    }) ?? '{}';
  } catch {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'logger.serialization_failed',
    });
  }
}

function redact(value: string): string {
  return value
    .replace(/\/bot[^/\s]+/gu, '/bot[REDACTED]')
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/gu, '[REDACTED]');
}
