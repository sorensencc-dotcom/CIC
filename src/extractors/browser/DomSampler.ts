import { v4 as uuid } from "uuid"
import { logger } from "../../lib/logger"
import { SpaHydrationDetector, HydrationResult } from "./SpaHydrationDetector"

export interface SampleResult {
  url: string
  nodeCount: number
  textDensity: number
  imageCount: number
  linkCount: number
  hydrationScore: number
  errorCount: number
  completenessScore: number
  dom: string
}

export class DomSampler {
  private candidateUrls = ["/", "/home", "/services"]
  private minNodeCount = 50
  private maxNodeCount = 5000
  private minTextDensity = 0.05
  private maxTextDensity = 0.5
  private scoreThreshold = 40
  private hydrationDetector: SpaHydrationDetector

  constructor(hydrationDetector?: SpaHydrationDetector) {
    this.hydrationDetector =
      hydrationDetector || new SpaHydrationDetector()
  }

  async sample(
    baseUrl: string,
    browser: any,
    navigateTo: (url: string) => Promise<any>
  ): Promise<SampleResult> {
    logger.info("sampling.start", { baseUrl })

    const results: SampleResult[] = []

    for (const path of this.candidateUrls) {
      try {
        const url = this.normalizeUrl(baseUrl, path)
        logger.info("sampling.candidate.start", { url })

        const page = await navigateTo(url)
        const result = await this.extractSample(url, page)

        results.push(result)

        logger.info("sampling.candidate.complete", {
          url,
          nodeCount: result.nodeCount,
          completenessScore: result.completenessScore,
          hydrationScore: result.hydrationScore
        })

        await page.close()
      } catch (err) {
        logger.error("sampling.candidate.error", {
          url: this.normalizeUrl(baseUrl, path),
          error: String(err)
        })
      }
    }

    // Select best result
    const viable = results.filter((r) => r.completenessScore >= this.scoreThreshold)
    const best =
      viable.length > 0
        ? viable.sort((a, b) => b.completenessScore - a.completenessScore)[0]
        : results.length > 0
          ? results.sort((a, b) => b.completenessScore - a.completenessScore)[0]
          : results[0]

    logger.info("sampling.selected", {
      url: best.url,
      score: best.completenessScore
    })

    return best
  }

  private async extractSample(url: string, page: any): Promise<SampleResult> {
    // Hydration detection
    const hydrationResult = await this.hydrationDetector.detect(page)

    // Extract DOM metrics
    const metrics = await page.evaluate(() => {
      const dom = document.documentElement.outerHTML
      const nodeCount = document.querySelectorAll("*").length
      const textContent = document.body.innerText
      const textDensity = textContent.length / (window.innerWidth * window.innerHeight)
      const imageCount = document.querySelectorAll("img").length
      const linkCount = document.querySelectorAll("a").length

      return {
        dom,
        nodeCount,
        textDensity,
        imageCount,
        linkCount
      }
    })

    // Count JS errors
    const errorCount = await page.evaluate(
      () => (window as any).__jsErrors?.length || 0
    )

    // Calculate completeness score
    const completenessScore = this.calculateCompletenessScore({
      nodeCount: metrics.nodeCount,
      textDensity: metrics.textDensity,
      hydrationScore: hydrationResult.score,
      imageCount: metrics.imageCount,
      linkCount: metrics.linkCount
    })

    return {
      url,
      nodeCount: metrics.nodeCount,
      textDensity: metrics.textDensity,
      imageCount: metrics.imageCount,
      linkCount: metrics.linkCount,
      hydrationScore: hydrationResult.score,
      errorCount,
      completenessScore,
      dom: metrics.dom
    }
  }

  private calculateCompletenessScore(metrics: {
    nodeCount: number
    textDensity: number
    hydrationScore: number
    imageCount: number
    linkCount: number
  }): number {
    let score = 0

    // Node count (25 weight)
    const nodeScore = this.normalizeRange(
      metrics.nodeCount,
      this.minNodeCount,
      this.maxNodeCount,
      0,
      100
    )
    score += nodeScore * 0.25

    // Text density (25 weight)
    const textScore = this.normalizeRange(
      metrics.textDensity,
      this.minTextDensity,
      this.maxTextDensity,
      0,
      100
    )
    score += textScore * 0.25

    // Hydration score (25 weight)
    score += metrics.hydrationScore * 0.25

    // Image count (15 weight)
    const imageScore = Math.min((metrics.imageCount / 50) * 100, 100)
    score += imageScore * 0.15

    // Link count (10 weight)
    const linkScore = Math.min((metrics.linkCount / 100) * 100, 100)
    score += linkScore * 0.1

    return Math.min(Math.round(score), 100)
  }

  private normalizeRange(
    value: number,
    min: number,
    max: number,
    outMin: number,
    outMax: number
  ): number {
    const normalized = (value - min) / (max - min)
    const clamped = Math.max(outMin, Math.min(outMax, normalized * (outMax - outMin) + outMin))
    return clamped
  }

  private normalizeUrl(baseUrl: string, path: string): string {
    const url = new URL(path, baseUrl)
    return url.toString()
  }
}
