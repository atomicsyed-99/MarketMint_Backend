import { describe, it, expect } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { createLogger, logger } from "../logger";

function createSinkLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("exports a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("createLogger returns a child with module binding", () => {
    const child = createLogger("test-module");
    expect(child).toBeDefined();
    const bindings = (child as any).bindings();
    expect(bindings.module).toBe("test-module");
  });

  it("outputs structured JSON with level as string", () => {
    const { lines, stream } = createSinkLogger();
    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      stream,
    );

    testLogger.info({ key: "value" }, "test message");
    stream.end();

    const output = JSON.parse(lines[0]);
    expect(output.level).toBe("info");
    expect(output.msg).toBe("test message");
    expect(output.key).toBe("value");
    expect(output.time).toBeDefined();
  });

  it("serializes errors with stack and cause", () => {
    const { lines, stream } = createSinkLogger();

    // Replicate the module's custom serializer to test the pattern
    function serializeErr(err: unknown): Record<string, unknown> {
      if (!(err instanceof Error)) return { message: String(err) };
      const s: Record<string, unknown> = {
        type: err.name,
        message: err.message,
        stack: err.stack,
      };
      if (err.cause !== undefined) s.cause = serializeErr(err.cause);
      return s;
    }

    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        serializers: { err: serializeErr },
      },
      stream,
    );

    const cause = new Error("root cause");
    const err = new Error("boom", { cause });
    testLogger.error({ err }, "something failed");
    stream.end();

    const output = JSON.parse(lines[0]);
    expect(output.err.message).toBe("boom");
    expect(output.err.stack).toBeDefined();
    expect(output.err.cause.message).toBe("root cause");
  });

  it("respects log level — debug suppressed at info level", () => {
    const { lines, stream } = createSinkLogger();
    const testLogger = pino({ level: "info" }, stream);

    testLogger.debug("should not appear");
    testLogger.info("should appear");
    stream.end();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe("should appear");
  });
});
