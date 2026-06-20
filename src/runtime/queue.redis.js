/**
 * filename: queue.redis.js
 * semver: 0.1.0
 * date: 2026-06-17
 *
 * Redis-backed priority queue for CIC/Labs/Collab tasks.
 * Durable, atomic, ready for horizontal scaling.
 */

import Redis from "redis";
import assert from "node:assert";

const QUEUE_PREFIX = "queue:";
const DLQ_PREFIX = "dlq:";
const PRIORITY_LEVELS = ["high", "normal", "low"];
const DEFAULT_REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient = null;
let isConnected = false;

/**
 * Initialize Redis connection.
 */
export async function initRedis(logger) {
  if (redisClient && isConnected) return redisClient;

  redisClient = Redis.createClient({ url: DEFAULT_REDIS_URL });

  redisClient.on("error", err => {
    isConnected = false;
    logger.error({ msg: "redis:error", error: String(err) });
  });

  redisClient.on("connect", () => {
    isConnected = true;
    logger.info({ msg: "redis:connected", url: DEFAULT_REDIS_URL });
  });

  try {
    await redisClient.connect();
    isConnected = true;
  } catch (err) {
    isConnected = false;
    logger.error({ msg: "redis:connect_failed", error: String(err) });
    throw err;
  }

  return redisClient;
}

/**
 * Enqueue a task with priority.
 * Tasks stored in Redis sorted sets with priority as score.
 */
export async function enqueueTask(task, logger) {
  if (!isConnected) {
    throw new Error("enqueueTask: Redis not connected");
  }

  assert(task.task_id, "enqueueTask: task_id required");
  assert(task.mode, "enqueueTask: mode required");
  assert(task.priority, "enqueueTask: priority required");
  assert(PRIORITY_LEVELS.includes(task.priority), `enqueueTask: invalid priority ${task.priority}`);

  const key = `${QUEUE_PREFIX}${task.mode}`;
  const score = priorityToScore(task.priority);
  const payload = JSON.stringify(task);

  try {
    await redisClient.zAdd(key, { score, member: payload });

    logger.info({
      msg: "queue:enqueue",
      task_id: task.task_id,
      mode: task.mode,
      priority: task.priority,
      queue_size: await redisClient.zCard(key)
    });
  } catch (err) {
    isConnected = false;
    logger.error({
      msg: "queue:enqueue:error",
      task_id: task.task_id,
      error: String(err)
    });
    throw err;
  }
}

/**
 * Dequeue a task atomically (ZPOPMIN).
 * Returns task from high → normal → low priority queues.
 * Scans all modes, respecting priority order within each mode.
 */
export async function dequeueTask(logger) {
  if (!isConnected) {
    throw new Error("dequeueTask: Redis not connected");
  }

  try {
    // Get all queue keys for all modes
    const allKeys = await redisClient.keys(`${QUEUE_PREFIX}*`);

    if (!allKeys || allKeys.length === 0) {
      return null;
    }

    // Try to dequeue from each queue, respecting priority (ZPOPMIN returns lowest score first)
    for (const key of allKeys) {
      const result = await redisClient.zPopMin(key, 1);

      if (result && result.length > 0) {
        const [member] = result;
        const task = JSON.parse(member.value);

        logger.info({
          msg: "queue:dequeue",
          task_id: task.task_id,
          mode: task.mode,
          priority: task.priority
        });

        return task;
      }
    }

    return null; // no tasks in any queue
  } catch (err) {
    isConnected = false;
    logger.error({
      msg: "queue:dequeue:error",
      error: String(err)
    });
    throw err;
  }
}

/**
 * Move failed task to dead-letter queue.
 */
export async function moveToDLQ(task, reason, logger) {
  if (!isConnected) {
    throw new Error("moveToDLQ: Redis not connected");
  }

  assert(task.task_id, "moveToDLQ: task_id required");
  assert(reason, "moveToDLQ: reason required");

  const key = `${DLQ_PREFIX}${task.mode}`;
  const payload = JSON.stringify({ task, reason, at: new Date().toISOString() });

  try {
    await redisClient.lPush(key, payload);

    logger.warn({
      msg: "queue:dlq",
      task_id: task.task_id,
      reason,
      dlq_size: await redisClient.lLen(key)
    });
  } catch (err) {
    isConnected = false;
    logger.error({
      msg: "queue:dlq:error",
      task_id: task.task_id,
      error: String(err)
    });
    throw err;
  }
}

/**
 * Retrieve all DLQ items for a mode.
 */
export async function getDLQ(mode, logger) {
  const key = `${DLQ_PREFIX}${mode}`;

  try {
    const items = await redisClient.lRange(key, 0, -1);
    const parsed = items.map(item => JSON.parse(item));

    logger.info({
      msg: "queue:dlq:retrieve",
      mode,
      count: parsed.length
    });

    return parsed;
  } catch (err) {
    logger.error({
      msg: "queue:dlq:retrieve:error",
      mode,
      error: String(err)
    });
    throw err;
  }
}

/**
 * Get queue size for a mode.
 */
export async function getQueueSize(mode, logger) {
  const key = `${QUEUE_PREFIX}${mode}`;

  try {
    const size = await redisClient.zCard(key);

    logger.debug({
      msg: "queue:size",
      mode,
      size
    });

    return size;
  } catch (err) {
    logger.error({
      msg: "queue:size:error",
      mode,
      error: String(err)
    });
    throw err;
  }
}

/**
 * Clear all queues and DLQ (useful for testing).
 */
export async function clearAllQueues(logger) {
  try {
    const queueKeys = await redisClient.keys(`${QUEUE_PREFIX}*`);
    const dlqKeys = await redisClient.keys(`${DLQ_PREFIX}*`);
    const allKeys = [...queueKeys, ...dlqKeys];

    for (const key of allKeys) {
      await redisClient.del(key);
    }

    logger.info({
      msg: "queue:clear",
      cleared_keys: allKeys.length
    });
  } catch (err) {
    logger.error({
      msg: "queue:clear:error",
      error: String(err)
    });
    throw err;
  }
}

/**
 * Close Redis connection gracefully.
 */
export async function closeRedis(logger) {
  if (!redisClient) return;

  try {
    await redisClient.quit();

    logger.info({ msg: "redis:closed" });
  } catch (err) {
    logger.error({
      msg: "redis:close:error",
      error: String(err)
    });
    throw err;
  }
}

/**
 * Convert priority string to Redis score (lower = higher priority).
 */
function priorityToScore(priority) {
  const scores = {
    high: 1,
    normal: 2,
    low: 3
  };
  return scores[priority] || 2;
}

export { PRIORITY_LEVELS, QUEUE_PREFIX, DLQ_PREFIX };
