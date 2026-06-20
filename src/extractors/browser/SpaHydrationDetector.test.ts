import { SpaHydrationDetector } from "./SpaHydrationDetector"

describe("SpaHydrationDetector", () => {
  let detector: SpaHydrationDetector

  beforeEach(() => {
    detector = new SpaHydrationDetector()
  })

  describe("detect", () => {
    it("detects React/Next.js hydration", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: true,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 42,
          nodeCountDelta: 50,
          nodeCountDeltaPercent: 2,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 250
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.score).toBeGreaterThanOrEqual(70)
      expect(result.framework).toBe("react")
      expect(result.healthy).toBe(true)
    })

    it("detects Webflow hydration", async () => {
      const mockPage = {
        url: () => "https://example.webflow.io",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: false,
          webflowMarker: true,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 30,
          nodeCountDelta: 45,
          nodeCountDeltaPercent: 2,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 200
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.framework).toBe("webflow")
    })

    it("detects Framer hydration", async () => {
      const mockPage = {
        url: () => "https://example.framer.app",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: true,
          wixMarker: false,
          mutationCount: 25,
          nodeCountDelta: 40,
          nodeCountDeltaPercent: 2,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 180
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.framework).toBe("framer")
    })

    it("detects Wix hydration", async () => {
      const mockPage = {
        url: () => "https://example.wix.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: true,
          mutationCount: 35,
          nodeCountDelta: 35,
          nodeCountDeltaPercent: 2,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 220
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.framework).toBe("wix")
    })

    it("marks unhealthy when score < 40", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 0,
          nodeCountDelta: 0,
          nodeCountDeltaPercent: 0,
          scriptExecutionErrors: 5,
          stabilityAchieved: false,
          stabilityTimeMs: 1500
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.score).toBeLessThan(40)
      expect(result.healthy).toBe(false)
    })

    it("handles page.evaluate errors gracefully", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockRejectedValue(new Error("Page crashed"))
      }

      const result = await detector.detect(mockPage)

      expect(result.score).toBe(0)
      expect(result.healthy).toBe(false)
      expect(result.framework).toBe("unknown")
    })

    it("returns timeMs metric", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: true,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 10,
          nodeCountDelta: 20,
          nodeCountDeltaPercent: 1,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 100
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.timeMs).toBeGreaterThan(0)
      expect(result.timeMs).toBeLessThan(5000)
    })
  })

  describe("scoring", () => {
    it("scores perfectly when all signals present", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: true,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 5,
          nodeCountDelta: 10,
          nodeCountDeltaPercent: 1,
          scriptExecutionErrors: 0,
          stabilityAchieved: true,
          stabilityTimeMs: 150
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.score).toBe(100)
    })

    it("scores low when node count delta exceeds threshold", async () => {
      const mockPage = {
        url: () => "https://example.com",
        evaluate: jest.fn().mockResolvedValue({
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 100,
          nodeCountDelta: 300,
          nodeCountDeltaPercent: 10,
          scriptExecutionErrors: 3,
          stabilityAchieved: false,
          stabilityTimeMs: 1500
        })
      }

      const result = await detector.detect(mockPage)

      expect(result.score).toBeLessThan(20)
    })
  })
})
