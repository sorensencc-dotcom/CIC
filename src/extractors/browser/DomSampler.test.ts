import { DomSampler } from "./DomSampler"
import { SpaHydrationDetector } from "./SpaHydrationDetector"

describe("DomSampler", () => {
  let sampler: DomSampler
  let mockHydrationDetector: jest.Mocked<SpaHydrationDetector>

  beforeEach(() => {
    mockHydrationDetector = {
      detect: jest.fn()
    } as any

    sampler = new DomSampler(mockHydrationDetector)
  })

  describe("sample", () => {
    it("samples all candidate URLs", async () => {
      const mockNavigateTo = jest.fn().mockResolvedValue({
        evaluate: jest.fn().mockResolvedValue({
          dom: "<html>test</html>",
          nodeCount: 500,
          textDensity: 0.2,
          imageCount: 5,
          linkCount: 15
        }),
        close: jest.fn()
      })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 80,
        signals: {} as any,
        framework: "react",
        healthy: true,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(mockNavigateTo).toHaveBeenCalledTimes(3)
      expect(result).toBeDefined()
      expect(result.url).toMatch(/\/(|home|services)/)
    })

    it("selects URL with highest completeness score", async () => {
      const mockNavigateTo = jest.fn().mockImplementation((url) => {
        let nodeCount = 500
        let textDensity = 0.2

        if (url.includes("/home")) {
          nodeCount = 1000
          textDensity = 0.3
        } else if (url.includes("/services")) {
          nodeCount = 2000
          textDensity = 0.4
        }

        return Promise.resolve({
          evaluate: jest
            .fn()
            .mockResolvedValue({
              dom: "<html>test</html>",
              nodeCount,
              textDensity,
              imageCount: 10,
              linkCount: 20
            }),
          close: jest.fn()
        })
      })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 80,
        signals: {} as any,
        framework: "react",
        healthy: true,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(result.url).toContain("/services")
      expect(result.completenessScore).toBeGreaterThan(50)
    })

    it("filters out scores below threshold", async () => {
      const mockNavigateTo = jest.fn().mockImplementation((url) => {
        const nodeCount = url.includes("/services") ? 3000 : 100

        return Promise.resolve({
          evaluate: jest
            .fn()
            .mockResolvedValue({
              dom: "<html>test</html>",
              nodeCount,
              textDensity: 0.05,
              imageCount: 2,
              linkCount: 5
            }),
          close: jest.fn()
        })
      })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 50,
        signals: {} as any,
        framework: "react",
        healthy: true,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(result.url).toContain("/services")
    })

    it("falls back to best available when all scores low", async () => {
      const mockNavigateTo = jest.fn().mockResolvedValue({
        evaluate: jest.fn().mockResolvedValue({
          dom: "<html>test</html>",
          nodeCount: 30,
          textDensity: 0.01,
          imageCount: 0,
          linkCount: 2
        }),
        close: jest.fn()
      })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 20,
        signals: {} as any,
        framework: "unknown",
        healthy: false,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(result).toBeDefined()
      expect(result.completenessScore).toBeLessThan(40)
    })

    it("handles navigation errors gracefully", async () => {
      const mockNavigateTo = jest
        .fn()
        .mockRejectedValueOnce(new Error("Navigation failed"))
        .mockResolvedValueOnce({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 500,
            textDensity: 0.2,
            imageCount: 5,
            linkCount: 15
          }),
          close: jest.fn()
        })
        .mockResolvedValueOnce({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 800,
            textDensity: 0.25,
            imageCount: 8,
            linkCount: 20
          }),
          close: jest.fn()
        })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 80,
        signals: {} as any,
        framework: "react",
        healthy: true,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(result).toBeDefined()
      expect(mockNavigateTo).toHaveBeenCalledTimes(3)
    })
  })

  describe("completeness scoring", () => {
    it("scores high for rich DOM", async () => {
      const mockNavigateTo = jest.fn().mockResolvedValue({
        evaluate: jest.fn().mockResolvedValue({
          dom: "<html>test</html>",
          nodeCount: 3000,
          textDensity: 0.35,
          imageCount: 20,
          linkCount: 50
        }),
        close: jest.fn()
      })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 90,
        signals: {} as any,
        framework: "react",
        healthy: true,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      const richResult = result
      expect(richResult.completenessScore).toBeGreaterThan(60)
    })

    it("scores low for sparse DOM", async () => {
      const mockNavigateTo = jest
        .fn()
        .mockResolvedValue({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 80,
            textDensity: 0.08,
            imageCount: 1,
            linkCount: 3
          }),
          close: jest.fn()
        })
        .mockResolvedValueOnce({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 80,
            textDensity: 0.08,
            imageCount: 1,
            linkCount: 3
          }),
          close: jest.fn()
        })
        .mockResolvedValueOnce({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 80,
            textDensity: 0.08,
            imageCount: 1,
            linkCount: 3
          }),
          close: jest.fn()
        })
        .mockResolvedValueOnce({
          evaluate: jest.fn().mockResolvedValue({
            dom: "<html>test</html>",
            nodeCount: 80,
            textDensity: 0.08,
            imageCount: 1,
            linkCount: 3
          }),
          close: jest.fn()
        })

      mockHydrationDetector.detect.mockResolvedValue({
        score: 30,
        signals: {} as any,
        framework: "unknown",
        healthy: false,
        timeMs: 150
      })

      const result = await sampler.sample(
        "https://example.com",
        null,
        mockNavigateTo
      )

      expect(result.completenessScore).toBeLessThan(40)
    })
  })
})
