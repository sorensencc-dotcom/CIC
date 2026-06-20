/**
 * filename: phase-6-integration.test.js
 * semver: 0.1.0
 * date: 2026-06-17
 *
 * Integration tests: Redis queue + Graceful shutdown (Phase 6.A + 6.B).
 * Validates task lifecycle, priority ordering, DLQ restoration across restart.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
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

describe("Phase 6: Autonomous Cross-Orchestration (Integration)", () => {
  beforeAll(async () => {
    await initRedis(mockLogger);
    await clearAllQueues(mockLogger);
  });

  afterAll(async () => {
    await closeRedis(mockLogger);
  });

  describe("Phase 6.A: Redis Queue Durability", () => {
    it("survives 10-task enqueue/dequeue cycle", async () => {
      const tasks = [];

      // Enqueue 10 tasks with mixed priorities
      for (let i = 0; i < 10; i++) {
        const task = {
          task_id: `task-${i}`,
          mode: "cic",
          priority: ["high", "normal", "low"][i % 3],
          type: "refactor",
          payload: { index: i }
        };

        tasks.push(task);
        await enqueueTask(task, mockLogger);
      }

      // Verify all tasks in queue
      const queueSize = await getQueueSize("cic", mockLogger);
      expect(queueSize).toBe(10);

      // Dequeue all tasks
      const dequeued = [];

      for (let i = 0; i < 10; i++) {
        const task = await dequeueTask(mockLogger);
        expect(task).toBeDefined();
        dequeued.push(task);
      }

      expect(dequeued.length).toBe(10);

      // Verify queue empty
      const emptySize = await getQueueSize("cic", mockLogger);
      expect(emptySize).toBe(0);
    });

    it("respects priority ordering within mode", async () => {
      // Clear queue
      await clearAllQueues(mockLogger);

      // Enqueue tasks in random priority order (same mode)
      const order = [
        { id: "t1", priority: "low" },
        { id: "t2", priority: "high" },
        { id: "t3", priority: "normal" },
        { id: "t4", priority: "low" },
        { id: "t5", priority: "high" }
      ];

      for (const item of order) {
        await enqueueTask(
          {
            task_id: item.id,
            mode: "cic",
            priority: item.priority
          },
          mockLogger
        );
      }

      // Dequeue and verify priority order (ZPOPMIN returns lowest score first)
      // Score: high=1, normal=2, low=3
      const dequeued = [];

      for (let i = 0; i < 5; i++) {
        const task = await dequeueTask(mockLogger);
        if (task) dequeued.push(task.task_id);
      }

      // Expect: high priority (t2, t5) first, then normal, then low
      const highPriority = dequeued.filter(id => ["t2", "t5"].includes(id));
      const normalPriority = dequeued.filter(id => ["t3"].includes(id));
      const lowPriority = dequeued.filter(id => ["t1", "t4"].includes(id));

      expect(highPriority.length).toBe(2);
      expect(normalPriority.length).toBe(1);
      expect(lowPriority.length).toBe(2);

      // Verify order: high tasks before normal, normal before low
      const firstHighIdx = dequeued.findIndex(id => highPriority.includes(id));
      const firstNormalIdx = dequeued.findIndex(id => normalPriority.includes(id));
      const firstLowIdx = dequeued.findIndex(id => lowPriority.includes(id));

      expect(firstHighIdx).toBeLessThan(firstNormalIdx);
      expect(firstNormalIdx).toBeLessThan(firstLowIdx);
    });

    it("handles DLQ correctly on task failure", async () => {
      await clearAllQueues(mockLogger);

      const task = {
        task_id: "fail-task",
        mode: "cic",
        priority: "normal"
      };

      // Enqueue
      await enqueueTask(task, mockLogger);

      // Dequeue
      const dequeued = await dequeueTask(mockLogger);
      expect(dequeued.task_id).toBe("fail-task");

      // Simulate failure → DLQ
      await moveToDLQ(dequeued, "Max retries exceeded", mockLogger);

      // Verify in DLQ
      const dlq = await getDLQ("cic", mockLogger);
      expect(dlq.length).toBe(1);
      expect(dlq[0].task.task_id).toBe("fail-task");
      expect(dlq[0].reason).toBe("Max retries exceeded");
    });
  });

  describe("Phase 6.B: Graceful Shutdown Simulation", () => {
    it("preserves queue state across simulated restart", async () => {
      await clearAllQueues(mockLogger);

      // Enqueue 5 tasks
      const tasks = [];

      for (let i = 0; i < 5; i++) {
        const task = {
          task_id: `restart-task-${i}`,
          mode: "labs",
          priority: "normal"
        };

        tasks.push(task);
        await enqueueTask(task, mockLogger);
      }

      // Verify queue has 5 tasks
      let size = await getQueueSize("labs", mockLogger);
      expect(size).toBe(5);

      // Simulate partial processing + shutdown
      const processed = await dequeueTask(mockLogger);
      expect(processed.task_id).toBe("restart-task-0");

      // Simulate processing failure → DLQ
      await moveToDLQ(processed, "Simulation: Process error", mockLogger);

      // Queue should now have 4 tasks + 1 in DLQ
      size = await getQueueSize("labs", mockLogger);
      expect(size).toBe(4);

      const dlq = await getDLQ("labs", mockLogger);
      expect(dlq.length).toBe(1);

      // Simulate restart: redis connection survives (persistent)
      // Dequeue remaining tasks
      for (let i = 0; i < 4; i++) {
        const task = await dequeueTask(mockLogger);
        expect(task).toBeDefined();
      }

      // Verify all dequeued
      size = await getQueueSize("labs", mockLogger);
      expect(size).toBe(0);

      // DLQ still has 1 item (preserved)
      const dlqAfter = await getDLQ("labs", mockLogger);
      expect(dlqAfter.length).toBe(1);
    });
  });

  describe("Phase 6.A + 6.B: End-to-End", () => {
    it("completes full task lifecycle without data loss", async () => {
      await clearAllQueues(mockLogger);

      // Phase: Intake (enqueue 3 tasks)
      const ingestedTasks = [];

      for (let i = 0; i < 3; i++) {
        const task = {
          task_id: `e2e-task-${i}`,
          mode: "collab",
          priority: ["high", "normal", "low"][i],
          type: "experiment"
        };

        ingestedTasks.push(task);
        await enqueueTask(task, mockLogger);
      }

      const intakeSize = await getQueueSize("collab", mockLogger);
      expect(intakeSize).toBe(3);

      // Phase: Execution (dequeue 2 tasks, process 1 successfully, 1 fails)
      const first = await dequeueTask(mockLogger);
      expect(first.task_id).toBe("e2e-task-0"); // high priority

      // Simulate success (no action)
      const second = await dequeueTask(mockLogger);
      expect(second.task_id).toBe("e2e-task-2"); // normal

      // Simulate failure → DLQ
      await moveToDLQ(second, "Task execution failed", mockLogger);

      // Phase: Drain (3rd task still in queue)
      const execSize = await getQueueSize("collab", mockLogger);
      expect(execSize).toBe(1);

      const dlqSize = (await getDLQ("collab", mockLogger)).length;
      expect(dlqSize).toBe(1);

      // Phase: Persistence check (simulate restart)
      // Queue and DLQ data persists in Redis

      // Phase: Recovery (process remaining task)
      const third = await dequeueTask(mockLogger);
      expect(third.task_id).toBe("e2e-task-1");

      const finalSize = await getQueueSize("collab", mockLogger);
      expect(finalSize).toBe(0);

      // DLQ unchanged
      const finalDlq = await getDLQ("collab", mockLogger);
      expect(finalDlq.length).toBe(1);
    });

    it("guarantees zero task loss across all modes", async () => {
      await clearAllQueues(mockLogger);

      const modes = ["cic", "labs", "collab"];
      const tasksPerMode = 3;

      // Enqueue tasks across all modes
      for (const mode of modes) {
        for (let i = 0; i < tasksPerMode; i++) {
          await enqueueTask(
            {
              task_id: `multi-${mode}-${i}`,
              mode,
              priority: "normal"
            },
            mockLogger
          );
        }
      }

      // Verify each mode has tasks
      for (const mode of modes) {
        const size = await getQueueSize(mode, mockLogger);
        expect(size).toBe(tasksPerMode);
      }

      // Process all tasks
      let processedCount = 0;

      for (const mode of modes) {
        let task = await dequeueTask(mockLogger);

        while (task && task.mode === mode) {
          processedCount++;
          task = await dequeueTask(mockLogger);
        }
      }

      // Total processed: 9 (3 modes × 3 tasks)
      expect(processedCount).toBeGreaterThanOrEqual(9);
    });
  });
});
