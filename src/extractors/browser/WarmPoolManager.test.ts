import { WarmPoolManager, WarmPoolSession } from "./WarmPoolManager"
import { CloakBrowser } from "./CloakBrowser"

jest.mock("./CloakBrowser")

describe("WarmPoolManager", () => {
  let manager: WarmPoolManager
  let mockBrowser: any

  beforeEach(() => {
    mockBrowser = {
      newPage: jest.fn().mockResolvedValue({
        goto: jest.fn().mockResolvedValue(null),
        close: jest.fn().mockResolvedValue(void 0)
      }),
      close: jest.fn().mockResolvedValue(void 0)
    }

    ;(CloakBrowser.launch as jest.Mock).mockResolvedValue(mockBrowser)
    manager = new WarmPoolManager(3)
  })

  afterEach(async () => {
    await manager.drain()
  })

  describe("init", () => {
    it("initializes pool with target size", async () => {
      await manager.init()

      const metrics = manager.getMetrics()
      expect(metrics.poolSize).toBe(3)
      expect(metrics.spawnCount).toBe(3)
    })

    it("is idempotent", async () => {
      await manager.init()
      await manager.init()

      const metrics = manager.getMetrics()
      expect(metrics.spawnCount).toBe(3)
    })

    it("handles spawn errors gracefully", async () => {
      ;(CloakBrowser.launch as jest.Mock).mockRejectedValueOnce(
        new Error("Launch failed")
      )

      await expect(manager.init()).rejects.toThrow()
    })
  })

  describe("checkout", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("returns healthy session from pool", async () => {
      const session = await manager.checkout()

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.healthy).toBe(true)
    })

    it("removes session from pool on checkout", async () => {
      const metricsAfterInit = manager.getMetrics()
      const initialSize = metricsAfterInit.poolSize

      await manager.checkout()

      const metricsAfterCheckout = manager.getMetrics()
      expect(metricsAfterCheckout.poolSize).toBe(initialSize - 1)
    })

    it("increments checkout count", async () => {
      const metricsBefore = manager.getMetrics()
      const checkoutsBefore = metricsBefore.checkoutCount

      await manager.checkout()

      const metricsAfter = manager.getMetrics()
      expect(metricsAfter.checkoutCount).toBe(checkoutsBefore + 1)
    })

    it("waits when pool is empty", async () => {
      const session1 = await manager.checkout()
      const session2 = await manager.checkout()
      const session3 = await manager.checkout()

      const checkoutPromise = manager.checkout(500)
      setTimeout(() => {
        manager.checkin(session1)
      }, 100)

      const session = await checkoutPromise
      expect(session).toBeDefined()
    })

    it("times out when pool remains empty", async () => {
      await manager.checkout()
      await manager.checkout()
      await manager.checkout()

      await expect(manager.checkout(100)).rejects.toThrow("WARM_POOL_EMPTY_TIMEOUT")
    })
  })

  describe("checkin", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("returns healthy session to pool", async () => {
      const session = await manager.checkout()
      const metricsAfterCheckout = manager.getMetrics()

      await manager.checkin(session)

      const metricsAfterCheckin = manager.getMetrics()
      expect(metricsAfterCheckin.poolSize).toBe(
        metricsAfterCheckout.poolSize + 1
      )
    })

    it("increments checkin count", async () => {
      const session = await manager.checkout()
      const metricsBefore = manager.getMetrics()

      await manager.checkin(session)

      const metricsAfter = manager.getMetrics()
      expect(metricsAfter.checkinCount).toBe(metricsBefore.checkinCount + 1)
    })

    it("closes and replaces unhealthy session", async () => {
      const session = await manager.checkout()
      session.healthy = false

      await manager.checkin(session)

      const metrics = manager.getMetrics()
      expect(metrics.recycleCount).toBe(1)
      expect(metrics.spawnCount).toBeGreaterThan(3)
    })

    it("updates lastUsedAt on checkin", async () => {
      const session = await manager.checkout()

      await manager.checkin(session)

      expect(session.lastUsedAt).toBeGreaterThan(0)
    })
  })

  describe("recordNavigation", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("increments navigation count on success", async () => {
      const session = await manager.checkout()
      const countBefore = session.navigationCount

      await manager.recordNavigation(session, 250, true)

      expect(session.navigationCount).toBe(countBefore + 1)
    })

    it("tracks latency on success", async () => {
      const session = await manager.checkout()

      await manager.recordNavigation(session, 250, true)

      expect(session.latencyMs).toContain(250)
    })

    it("increments error count on failure", async () => {
      const session = await manager.checkout()
      const errorsBefore = session.errorCount

      await manager.recordNavigation(session, 5000, false)

      expect(session.errorCount).toBe(errorsBefore + 1)
    })

    it("marks session unhealthy after 3 errors", async () => {
      const session = await manager.checkout()

      await manager.recordNavigation(session, 5000, false)
      await manager.recordNavigation(session, 5000, false)
      expect(session.healthy).toBe(true)

      await manager.recordNavigation(session, 5000, false)
      expect(session.healthy).toBe(false)
    })

    it("marks session unhealthy after max navigations", async () => {
      const session = await manager.checkout()
      session.navigationCount = 49

      await manager.recordNavigation(session, 250, true)

      expect(session.healthy).toBe(false)
    })

    it("keeps only last 10 latencies", async () => {
      const session = await manager.checkout()

      for (let i = 0; i < 15; i++) {
        await manager.recordNavigation(session, 100 + i, true)
      }

      expect(session.latencyMs.length).toBe(10)
    })

    it("increments total navigations metric", async () => {
      const session = await manager.checkout()
      const metricsBefore = manager.getMetrics()

      await manager.recordNavigation(session, 250, true)

      const metricsAfter = manager.getMetrics()
      expect(metricsAfter.totalNavigations).toBe(
        metricsBefore.totalNavigations + 1
      )
    })
  })

  describe("metrics", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("reports pool size", async () => {
      const metrics = manager.getMetrics()

      expect(metrics.poolSize).toBe(3)
      expect(metrics.targetSize).toBe(3)
    })

    it("reports healthy and unhealthy counts", async () => {
      const metricsInitial = manager.getMetrics()
      expect(metricsInitial.healthySessionCount).toBe(3)
      expect(metricsInitial.unhealthySessionCount).toBe(0)
    })

    it("calculates average latency", async () => {
      const sessions = [
        await manager.checkout(),
        await manager.checkout(),
        await manager.checkout()
      ]

      // Record navigation on one session
      await manager.recordNavigation(sessions[0], 100, true)
      await manager.recordNavigation(sessions[0], 200, true)
      await manager.recordNavigation(sessions[0], 300, true)

      // Return all to pool
      for (const s of sessions) {
        await manager.checkin(s)
      }

      const metrics = manager.getMetrics()

      expect(metrics.avgLatencyMs).toBe(200)
    })

    it("reports spawn and recycle counts", async () => {
      const metrics = manager.getMetrics()

      expect(metrics.spawnCount).toBe(3)
      expect(metrics.recycleCount).toBe(0)
    })
  })

  describe("health check", () => {
    it("replaces unresponsive sessions", async () => {
      mockBrowser.newPage.mockRejectedValueOnce(new Error("Page creation failed"))

      await manager.init()

      const metrics = manager.getMetrics()
      expect(metrics.spawnCount).toBe(3)
    })
  })

  describe("drain", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("closes all sessions", async () => {
      await manager.drain()

      expect(mockBrowser.close).toHaveBeenCalledTimes(3)
    })

    it("clears pool", async () => {
      await manager.drain()

      const metrics = manager.getMetrics()
      expect(metrics.poolSize).toBe(0)
    })

    it("handles close errors gracefully", async () => {
      mockBrowser.close.mockRejectedValueOnce(new Error("Close failed"))

      await expect(manager.drain()).resolves.not.toThrow()

      expect(mockBrowser.close).toHaveBeenCalled()
    })
  })

  describe("integration", () => {
    beforeEach(async () => {
      await manager.init()
    })

    it("checkout → recordNavigation → checkin cycle", async () => {
      const session = await manager.checkout()

      await manager.recordNavigation(session, 250, true)

      await manager.checkin(session)

      const metrics = manager.getMetrics()
      expect(metrics.checkoutCount).toBe(1)
      expect(metrics.checkinCount).toBe(1)
      expect(metrics.totalNavigations).toBe(1)
    })

    it("handles multiple concurrent checkouts", async () => {
      const p1 = manager.checkout()
      const p2 = manager.checkout()
      const p3 = manager.checkout()

      const [s1, s2, s3] = await Promise.all([p1, p2, p3])

      expect(s1.id).not.toBe(s2.id)
      expect(s2.id).not.toBe(s3.id)

      const metrics = manager.getMetrics()
      expect(metrics.poolSize).toBe(0)
    })

    it("maintains pool size after recycles", async () => {
      const initialMetrics = manager.getMetrics()

      const session = await manager.checkout()
      session.healthy = false
      await manager.checkin(session)

      await new Promise((r) => setTimeout(r, 100))

      const finalMetrics = manager.getMetrics()
      expect(finalMetrics.poolSize).toBe(initialMetrics.poolSize)
    })
  })
})
