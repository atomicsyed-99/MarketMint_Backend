import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

function serializeErr(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const serialized: Record<string, unknown> = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };
  if (err.cause !== undefined) {
    serialized.cause = serializeErr(err.cause);
  }
  return serialized;
}

export const logger = pino({
  level: isDev ? "debug" : "info",
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: serializeErr,
  },
});

export function createLogger(name: string) {
  return logger.child({ module: name });
}
