/**
 * filename: gracefulShutdown.js
 * semver: 0.1.0
 * date: 2026-06-17
 *
 * Graceful shutdown handler for containerized environments.
 * SIGTERM/SIGINT → drain tasks → flush metrics → close connections → exit clean.
 */

import assert from "node:assert";

let isShuttingDown = false;
let shutdownStartTime = null;
const SHUTDOWN_TIMEOUT_MS = 30000; // 30s max drain time
const FORCE_EXIT_MS = 35000; // Force exit if still running after 35s

/**
 * Install graceful shutdown handlers.
 * Call early in bootloader.
 */
export function installGracefulShutdown({
  drainFn,
  flushMetricsFn,
  closeConnectionsFn,
  logger
}) {
  assert(drainFn, "installGracefulShutdown: drainFn required");
  assert(logger, "installGracefulShutdown: logger required");

  const handleShutdown = async signal => {
    const now = Date.now();

    // Hard kill-switch: if shutdown already in progress > 35s, force exit immediately
    if (isShuttingDown && shutdownStartTime && now - shutdownStartTime > FORCE_EXIT_MS) {
      logger.error({
        msg: "shutdown:force_exit",
        signal,
        elapsed_ms: now - shutdownStartTime,
        reason: "Exceeded force exit timeout"
      });
      process.exit(1);
    }

    if (isShuttingDown) {
      logger.warn({
        msg: "shutdown:already_in_progress",
        signal,
        elapsed_ms: now - shutdownStartTime
      });
      return;
    }

    isShuttingDown = true;
    shutdownStartTime = now;

    logger.info({
      msg: "shutdown:start",
      signal,
      timeout_ms: SHUTDOWN_TIMEOUT_MS
    });

    const shutdownStart = Date.now();

    try {
      // Step 1: Stop accepting new tasks
      logger.info({ msg: "shutdown:stop_intake" });

      // Step 2: Drain in-flight tasks (with timeout)
      const drainPromise = drainFn();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Drain timeout")),
          SHUTDOWN_TIMEOUT_MS
        )
      );

      try {
        await Promise.race([drainPromise, timeoutPromise]);

        logger.info({
          msg: "shutdown:drain_complete",
          elapsed_ms: Date.now() - shutdownStart
        });
      } catch (drainErr) {
        logger.warn({
          msg: "shutdown:drain_timeout",
          error: String(drainErr),
          elapsed_ms: Date.now() - shutdownStart
        });
      }

      // Step 3: Flush metrics
      if (flushMetricsFn) {
        try {
          await flushMetricsFn();

          logger.info({
            msg: "shutdown:metrics_flushed",
            elapsed_ms: Date.now() - shutdownStart
          });
        } catch (metricsErr) {
          logger.error({
            msg: "shutdown:metrics_flush_error",
            error: String(metricsErr)
          });
        }
      }

      // Step 4: Close connections
      if (closeConnectionsFn) {
        try {
          await closeConnectionsFn();

          logger.info({
            msg: "shutdown:connections_closed",
            elapsed_ms: Date.now() - shutdownStart
          });
        } catch (connErr) {
          logger.error({
            msg: "shutdown:connection_close_error",
            error: String(connErr)
          });
        }
      }

      logger.info({
        msg: "shutdown:complete",
        total_elapsed_ms: Date.now() - shutdownStart,
        exit_code: 0
      });

      process.exit(0);
    } catch (err) {
      logger.error({
        msg: "shutdown:error",
        error: String(err),
        elapsed_ms: Date.now() - shutdownStart
      });

      process.exit(1);
    }
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));

  logger.info({ msg: "shutdown:handlers_installed" });
}

/**
 * Create a drain function that waits for all in-flight tasks to complete.
 * Used by bootloader when calling installGracefulShutdown.
 */
export function createDrainFunction(workerPool, logger) {
  return async () => {
    logger.info({ msg: "shutdown:drain:starting" });

    // Signal workers to stop accepting new tasks
    workerPool.pauseIntake();

    // Wait for all workers to finish current tasks
    const maxWaitMs = 25000; // leave 5s margin for other shutdown steps
    const checkInterval = 500;
    let elapsed = 0;

    while (elapsed < maxWaitMs) {
      const activeTaskCount = workerPool.getActiveTaskCount();

      if (activeTaskCount === 0) {
        logger.info({
          msg: "shutdown:drain:complete",
          waited_ms: elapsed
        });
        return;
      }

      logger.debug({
        msg: "shutdown:drain:waiting",
        active_tasks: activeTaskCount,
        elapsed_ms: elapsed
      });

      await new Promise(r => setTimeout(r, checkInterval));
      elapsed += checkInterval;
    }

    logger.warn({
      msg: "shutdown:drain:timeout",
      max_wait_ms: maxWaitMs,
      message: "Some tasks did not complete in time"
    });
  };
}

/**
 * Create a flush metrics function.
 */
export function createFlushMetricsFunction(metricsStore, logger) {
  return async () => {
    logger.info({ msg: "shutdown:flush_metrics:starting" });

    const metrics = metricsStore.export();

    logger.info({
      msg: "shutdown:flush_metrics:complete",
      metrics_count: Object.keys(metrics).length
    });

    // TODO: Send metrics to persistent store (Prometheus, etc.)
  };
}

/**
 * Create a close connections function.
 */
export function createCloseConnectionsFunction(connections, logger) {
  return async () => {
    logger.info({ msg: "shutdown:close_connections:starting" });

    const promises = [];

    if (connections.redis) {
      promises.push(
        connections.redis
          .quit()
          .then(() => logger.info({ msg: "shutdown:redis:closed" }))
          .catch(err =>
            logger.error({
              msg: "shutdown:redis:close_error",
              error: String(err)
            })
          )
      );
    }

    if (connections.postgres) {
      promises.push(
        connections.postgres
          .end()
          .then(() => logger.info({ msg: "shutdown:postgres:closed" }))
          .catch(err =>
            logger.error({
              msg: "shutdown:postgres:close_error",
              error: String(err)
            })
          )
      );
    }

    await Promise.all(promises);

    logger.info({
      msg: "shutdown:close_connections:complete",
      closed_count: promises.length
    });
  };
}
