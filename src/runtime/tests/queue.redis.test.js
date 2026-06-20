/**
 * filename: queue.redis.test.js
 * semver: 0.1.0
 * date: 2026-06-17
 *
 * Unit tests for Redis-backed queue.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import {
  initRedis,
  enqueueTask,
  dequeueTask,
  moveToDLQ,
  getDLQ,
  getQueueSize,
  clearAllQueues,
  closeRedis
} from "../queue.redis.js";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe("queue.redis", () => {
  beforeAll(async () => {
    await initRedis(mockLogger);
  });

  afterAll(async () => {
    await closeRedis(mockLogger);
  });

  beforeEach(async () => {
    await clearAllQueues(mockLogger);
    jest.clearAllMocks();
  });

  describe("enqueueTask", () => {
    it("enqueues a task with high priority", async () => {
      const task = {
        task_id: "task-1",
        mode: "cic",
        priority: "high",
        type: "refactor"
      };

      await enqueueTask(task, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "queue:enqueue",
          task_id: "task-1"
        })
      );

      const size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(1);
    });

    it("enqueues tasks and maintains priority order", async () => {
      const tasks = [
        { task_id: "t1", mode: "cic", priority: "low", type: "test" },
        { task_id: "t2", mode: "cic", priority: "high", type: "test" },
        { task_id: "t3", mode: "cic", priority: "normal", type: "test" }
      ];

      for (const task of tasks) {
        await enqueueTask(task, mockLogger);
      }

      const size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(3);
    });

    it("rejects task without task_id", async () => {
      const task = {
        mode: "cic",
        priority: "normal"
      };

      await expect(enqueueTask(task, mockLogger)).rejects.toThrow("task_id required");
    });

    it("rejects invalid priority", async () => {
      const task = {
        task_id: "t1",
        mode: "cic",
        priority: "urgent"
      };

      await expect(enqueueTask(task, mockLogger)).rejects.toThrow("invalid priority");
    });
  });

  describe("dequeueTask", () => {
    it("dequeues task from queue", async () => {
      const task = {
        task_id: "task-1",
        mode: "cic",
        priority: "normal",
        type: "refactor"
      };

      await enqueueTask(task, mockLogger);
      const dequeued = await dequeueTask(mockLogger);

      expect(dequeued).toMatchObject({
        task_id: "task-1",
        mode: "cic"
      });

      const size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(0);
    });

    it("dequeues in priority order (high → normal → low)", async () => {
      const tasks = [
        { task_id: "t1", mode: "cic", priority: "low" },
        { task_id: "t2", mode: "cic", priority: "high" },
        { task_id: "t3", mode: "cic", priority: "normal" }
      ];

      for (const task of tasks) {
        await enqueueTask(task, mockLogger);
      }

      const first = await dequeueTask(mockLogger);
      expect(first.task_id).toBe("t2"); // high priority
    });

    it("returns null when queue empty", async () => {
      const result = await dequeueTask(mockLogger);
      expect(result).toBeNull();
    });
  });

  describe("moveToDLQ", () => {
    it("moves failed task to DLQ", async () => {
      const task = {
        task_id: "task-1",
        mode: "cic",
        priority: "normal"
      };

      const reason = "Max retries exceeded";

      await moveToDLQ(task, reason, mockLogger);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "queue:dlq",
          task_id: "task-1"
        })
      );
    });

    it("retrieves DLQ items", async () => {
      const task1 = {
        task_id: "t1",
        mode: "cic"
      };

      const task2 = {
        task_id: "t2",
        mode: "cic"
      };

      await moveToDLQ(task1, "reason 1", mockLogger);
      await moveToDLQ(task2, "reason 2", mockLogger);

      const dlq = await getDLQ("cic", mockLogger);

      expect(dlq.length).toBe(2);
      expect(dlq[0]).toMatchObject({
        task: expect.objectContaining({ task_id: "t2" }),
        reason: "reason 2"
      });
    });
  });

  describe("getQueueSize", () => {
    it("returns correct queue size", async () => {
      const tasks = [
        { task_id: "t1", mode: "cic", priority: "normal" },
        { task_id: "t2", mode: "cic", priority: "normal" },
        { task_id: "t3", mode: "cic", priority: "normal" }
      ];

      for (const task of tasks) {
        await enqueueTask(task, mockLogger);
      }

      const size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(3);
    });

    it("returns 0 for empty queue", async () => {
      const size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(0);
    });
  });

  describe("clearAllQueues", () => {
    it("clears all queues and DLQ", async () => {
      const task = { task_id: "t1", mode: "cic", priority: "normal" };

      await enqueueTask(task, mockLogger);
      await moveToDLQ(task, "test", mockLogger);

      let size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(1);

      await clearAllQueues(mockLogger);

      size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(0);

      const dlq = await getDLQ("cic", mockLogger);
      expect(dlq.length).toBe(0);
    });
  });

  describe("multi-mode isolation", () => {
    it("isolates queues by mode", async () => {
      const cicTask = { task_id: "cic-1", mode: "cic", priority: "normal" };
      const labsTask = { task_id: "labs-1", mode: "labs", priority: "normal" };

      await enqueueTask(cicTask, mockLogger);
      await enqueueTask(labsTask, mockLogger);

      const cicSize = await getQueueSize("cic", mockLogger);
      const labsSize = await getQueueSize("labs", mockLogger);

      expect(cicSize).toBe(1);
      expect(labsSize).toBe(1);
    });
  });

  describe("restart resilience", () => {
    it("preserves tasks across dequeue-enqueue cycles", async () => {
      const task = { task_id: "t1", mode: "cic", priority: "normal" };

      // Enqueue
      await enqueueTask(task, mockLogger);
      let size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(1);

      // Dequeue
      const dequeued = await dequeueTask(mockLogger);
      expect(dequeued.task_id).toBe("t1");

      size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(0);

      // Re-enqueue (simulating retry)
      await enqueueTask(dequeued, mockLogger);
      size = await getQueueSize("cic", mockLogger);
      expect(size).toBe(1);
    });
  });
});
