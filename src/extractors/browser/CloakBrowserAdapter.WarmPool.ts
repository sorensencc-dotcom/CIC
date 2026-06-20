import { logger } from "../../lib/logger"
import { WarmPoolManager, WarmPoolSession } from "./WarmPoolManager"
import { SpaHydrationDetector } from "./SpaHydrationDetector"
import { DomSampler } from "./DomSampler"

/**
 * CloakBrowserAdapter with WarmPool integration.
 * Manages session lifecycle: checkout → navigate → recordMetrics → checkin
 */
export class CloakBrowserAdapterWithWarmPool {
  private warmPool: WarmPoolManager
  private hydrationDetector: SpaHydrationDetector
  private domSampler: DomSampler

  constructor(warmPoolSize = 3) {
    this.warmPool = new WarmPoolManager(warmPoolSize)
    this.hydrationDetector = new SpaHydrationDetector()
    this.domSampler = new DomSampler(this.hydrationDetector)
  }

  async init(): Promise<void> {
    logger.info("adapter.warm_pool.init", {})
    await this.warmPool.init()
  }

  /**
   * Navigate to URL using warm pool session
   */
  async navigate(
    url: string,
    options?: { retryCount?: number; timeoutMs?: number }
  ): Promise<{
    dom: string
    hydrationScore: number
    latencyMs: number
    screenshot: Buffer
  }> {
    const sessionCheckoutStart = Date.now()
    const maxRetries = options?.retryCount ?? 2
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let session: WarmPoolSession | null = null

      try {
        // Checkout session
        session = await this.warmPool.checkout(options?.timeoutMs ?? 10000)

        logger.info("adapter.navigate.attempt", {
          url,
          attempt,
          sessionId: session.id
        })

        const navigationStart = Date.now()

        // Create page
        const page = await session.browser.newPage()

        try {
          // Navigate to URL
          await page.goto(url, { waitUntil: "domContentLoaded" })

          // Detect hydration
          const hydrationResult = await this.hydrationDetector.detect(page)

          // Extract DOM
          const dom = await page.evaluate(() => document.documentElement.outerHTML)

          // Take screenshot
          const screenshot = await page.screenshot({ fullPage: true })

          const latencyMs = Date.now() - navigationStart

          // Record success
          await this.warmPool.recordNavigation(session, latencyMs, true)

          logger.info("adapter.navigate.success", {
            url,
            sessionId: session.id,
            latencyMs,
            hydrationScore: hydrationResult.score
          })

          // Checkin session
          await this.warmPool.checkin(session)

          return {
            dom,
            hydrationScore: hydrationResult.score,
            latencyMs,
            screenshot
          }
        } finally {
          try {
            await page.close()
          } catch (err) {
            logger.error("adapter.page_close_error", { error: String(err) })
          }
        }
      } catch (err) {
        lastError = err as Error

        const latencyMs = Date.now() - navigationStart

        logger.warn("adapter.navigate.attempt_failed", {
          url,
          attempt,
          error: String(err),
          sessionId: session?.id,
          latencyMs
        })

        // Record failure and checkin
        if (session) {
          await this.warmPool.recordNavigation(session, latencyMs, false)
          await this.warmPool.checkin(session)
        }

        // Retry on transient errors
        if (attempt < maxRetries) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt), 5000)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    logger.error("adapter.navigate.exhausted_retries", {
      url,
      maxRetries,
      error: String(lastError)
    })

    throw lastError || new Error("Navigation failed after retries")
  }

  /**
   * Sample multiple URLs and select best DOM
   */
  async sampleUrls(
    baseUrl: string
  ): Promise<{
    selectedUrl: string
    completenessScore: number
    dom: string
  }> {
    logger.info("adapter.sample.start", { baseUrl })

    const navigateTo = (url: string) => this.navigate(url)

    const result = await this.domSampler.sample(baseUrl, null, navigateTo)

    logger.info("adapter.sample.complete", {
      baseUrl,
      selectedUrl: result.url,
      score: result.completenessScore
    })

    return {
      selectedUrl: result.url,
      completenessScore: result.completenessScore,
      dom: result.dom
    }
  }

  /**
   * Get warm pool metrics
   */
  getWarmPoolMetrics() {
    return this.warmPool.getMetrics()
  }

  /**
   * Drain warm pool and cleanup
   */
  async cleanup(): Promise<void> {
    logger.info("adapter.cleanup.start", {})
    await this.warmPool.drain()
    logger.info("adapter.cleanup.complete", {})
  }
}

/**
 * Factory function for testing
 */
export function createAdapterWithWarmPool(warmPoolSize = 3) {
  return new CloakBrowserAdapterWithWarmPool(warmPoolSize)
}
