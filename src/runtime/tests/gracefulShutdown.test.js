/**
 * filename: gracefulShutdown.test.js
 * semver: 0.1.0
 * date: 2026-06-17
 *
 * Unit tests for graceful shutdown handler.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  installGracefulShutdown,
  createDrainFunction,
  createFlushMetricsFunction,
  createCloseConnectionsFunction
} from "../gracefulShutdown.js";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe("gracefulShutdown", () => {
  let originalExit;
  let exitCode = null;

  beforeEach(() => {
    jest.clearAllMocks();
    exitCode = null;

    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn(code => {
      exitCode = code;
    });
  });

  afterEach(() => {
    process.exit = originalExit;

    // Clean up all SIGTERM and SIGINT listeners to prevent accumulation
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  describe("installGracefulShutdown", () => {
    it("installs SIGTERM and SIGINT handlers", () => {
      const drainFn = jest.fn().mockResolvedValue(undefined);
      const onSpy = jest.spyOn(process, "on");

      installGracefulShutdown({
        drainFn,
        logger: mockLogger
      });

      expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

      onSpy.mockRestore();
    });

    it("requires drainFn", () => {
      expect(() => {
        installGracefulShutdown({
          logger: mockLogger
        });
      }).toThrow("drainFn required");
    });

    it("requires logger", () => {
      expect(() => {
        installGracefulShutdown({
          drainFn: jest.fn()
        });
      }).toThrow("logger required");
    });

    it("drains tasks on SIGTERM", async () => {
      const drainFn = jest.fn().mockResolvedValue(undefined);

      installGracefulShutdown({
        drainFn,
        logger: mockLogger
      });

      // Manually trigger SIGTERM by emitting the event
      process.emit("SIGTERM");

      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(drainFn).toHaveBeenCalled();
      expect(exitCode).toBe(0);
    });

    it("flushes metrics on shutdown", async () => {
      const drainFn = jest.fn().mockResolvedValue(undefined);
      const flushMetricsFn = jest.fn().mockResolvedValue(undefined);

      installGracefulShutdown({
        drainFn,
        flushMetricsFn,
        logger: mockLogger
      });

      process.emit("SIGTERM");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(flushMetricsFn).toHaveBeenCalled();
      expect(exitCode).toBe(0);
    });

    it("closes connections on shutdown", async () => {
      const drainFn = jest.fn().mockResolvedValue(undefined);
      const closeConnectionsFn = jest.fn().mockResolvedValue(undefined);

      installGracefulShutdown({
        drainFn,
        closeConnectionsFn,
        logger: mockLogger
      });

      process.emit("SIGTERM");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(closeConnectionsFn).toHaveBeenCalled();
      expect(exitCode).toBe(0);
    });

    it("exits with code 1 on drain error", async () => {
      const drainError = new Error("Drain failed");
      const drainFn = jest.fn().mockRejectedValue(drainError);

      installGracefulShutdown({
        drainFn,
        logger: mockLogger
      });

      process.emit("SIGTERM");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(exitCode).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:error"
        })
      );
    });

    it("handles drain timeout gracefully", async () => {
      let drainCalled = false;

      const drainFn = jest.fn(async () => {
        drainCalled = true;
        // Simulate long-running drain that doesn't complete within timeout
        return new Promise(() => {}); // Never resolves
      });

      installGracefulShutdown({
        drainFn,
        logger: mockLogger
      });

      process.emit("SIGTERM");

      // Wait for drain timeout to occur (30s in prod, but mocked to be quick in tests)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have called drain
      expect(drainFn).toHaveBeenCalled();

      // Should log timeout warning and exit despite drain not completing
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:drain_timeout"
        })
      );
    });
  });

  describe("createDrainFunction", () => {
    it("creates a drain function that pauses intake", async () => {
      const mockWorkerPool = {
        pauseIntake: jest.fn(),
        getActiveTaskCount: jest.fn().mockReturnValue(0)
      };

      const drainFn = createDrainFunction(mockWorkerPool, mockLogger);
      await drainFn();

      expect(mockWorkerPool.pauseIntake).toHaveBeenCalled();
    });

    it("waits for active tasks to complete", async () => {
      const mockWorkerPool = {
        pauseIntake: jest.fn(),
        getActiveTaskCount: jest
          .fn()
          .mockReturnValueOnce(2)
          .mockReturnValueOnce(1)
          .mockReturnValueOnce(0)
      };

      const drainFn = createDrainFunction(mockWorkerPool, mockLogger);
      await drainFn();

      expect(mockWorkerPool.getActiveTaskCount).toHaveBeenCalled();
    });

    it("logs drain completion", async () => {
      const mockWorkerPool = {
        pauseIntake: jest.fn(),
        getActiveTaskCount: jest.fn().mockReturnValue(0)
      };

      const drainFn = createDrainFunction(mockWorkerPool, mockLogger);
      await drainFn();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:drain:complete"
        })
      );
    });
  });

  describe("createFlushMetricsFunction", () => {
    it("flushes metrics from store", async () => {
      const mockMetricsStore = {
        export: jest.fn().mockReturnValue({
          "gauge:roi": 42,
          "counter:tasks": 100
        })
      };

      const flushFn = createFlushMetricsFunction(mockMetricsStore, mockLogger);
      await flushFn();

      expect(mockMetricsStore.export).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:flush_metrics:complete"
        })
      );
    });
  });

  describe("createCloseConnectionsFunction", () => {
    it("closes Redis connection", async () => {
      const mockRedis = {
        quit: jest.fn().mockResolvedValue(undefined)
      };

      const closeFn = createCloseConnectionsFunction(
        { redis: mockRedis },
        mockLogger
      );
      await closeFn();

      expect(mockRedis.quit).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:redis:closed"
        })
      );
    });

    it("closes Postgres connection", async () => {
      const mockPostgres = {
        end: jest.fn().mockResolvedValue(undefined)
      };

      const closeFn = createCloseConnectionsFunction(
        { postgres: mockPostgres },
        mockLogger
      );
      await closeFn();

      expect(mockPostgres.end).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:postgres:closed"
        })
      );
    });

    it("closes multiple connections", async () => {
      const mockRedis = {
        quit: jest.fn().mockResolvedValue(undefined)
      };

      const mockPostgres = {
        end: jest.fn().mockResolvedValue(undefined)
      };

      const closeFn = createCloseConnectionsFunction(
        { redis: mockRedis, postgres: mockPostgres },
        mockLogger
      );
      await closeFn();

      expect(mockRedis.quit).toHaveBeenCalled();
      expect(mockPostgres.end).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:close_connections:complete",
          closed_count: 2
        })
      );
    });

    it("handles connection close errors gracefully", async () => {
      const mockRedis = {
        quit: jest.fn().mockRejectedValue(new Error("Quit failed"))
      };

      const closeFn = createCloseConnectionsFunction(
        { redis: mockRedis },
        mockLogger
      );
      await closeFn();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "shutdown:redis:close_error"
        })
      );
    });
  });
});
