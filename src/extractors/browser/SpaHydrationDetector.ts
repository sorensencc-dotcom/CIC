import { logger } from "../../lib/logger"

export interface HydrationSignals {
  reactNextMarkers: boolean
  webflowMarker: boolean
  framerMarker: boolean
  wixMarker: boolean
  mutationCount: number
  nodeCountDelta: number
  nodeCountDeltaPercent: number
  scriptExecutionErrors: number
  stabilityAchieved: boolean
  stabilityTimeMs: number
}

export interface HydrationResult {
  score: number
  signals: HydrationSignals
  framework: "react" | "webflow" | "framer" | "wix" | "unknown"
  healthy: boolean
  timeMs: number
}

export class SpaHydrationDetector {
  private observeTimeoutMs = 1500
  private mutationWindowMs = 300
  private stabilityThresholdMs = 100
  private stabilityNodeDeltaPercent = 5

  async detect(page: any): Promise<HydrationResult> {
    const startTime = Date.now()
    logger.info("spa.hydration.start", { url: page.url() })

    try {
      const initialNodeCount = await this.getNodeCount(page)
      const signals = await this.observeHydration(page, initialNodeCount)
      const framework = this.classifyFramework(signals)
      const score = this.calculateScore(signals)
      const healthy = score >= 40
      const timeMs = Date.now() - startTime

      logger.info("spa.hydration.complete", {
        score,
        framework,
        healthy,
        timeMs,
        signals: {
          reactNextMarkers: signals.reactNextMarkers,
          mutationCount: signals.mutationCount,
          nodeCountDeltaPercent: signals.nodeCountDeltaPercent,
          stabilityAchieved: signals.stabilityAchieved
        }
      })

      return {
        score,
        signals,
        framework,
        healthy,
        timeMs
      }
    } catch (err) {
      logger.error("spa.hydration.error", {
        error: String(err),
        url: page.url()
      })

      return {
        score: 0,
        signals: {
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 0,
          nodeCountDelta: 0,
          nodeCountDeltaPercent: 0,
          scriptExecutionErrors: 0,
          stabilityAchieved: false,
          stabilityTimeMs: 0
        },
        framework: "unknown",
        healthy: false,
        timeMs: Date.now() - startTime
      }
    }
  }

  private async observeHydration(
    page: any,
    initialNodeCount: number
  ): Promise<HydrationSignals> {
    const detectionScript = `
      (async () => {
        const results = {
          reactNextMarkers: false,
          webflowMarker: false,
          framerMarker: false,
          wixMarker: false,
          mutationCount: 0,
          nodeCountDelta: 0,
          nodeCountDeltaPercent: 0,
          scriptExecutionErrors: 0,
          stabilityAchieved: false,
          stabilityTimeMs: 0
        };

        // React/Next.js markers
        const hasNextData = !!document.querySelector('script[id="__NEXT_DATA__"]');
        const hasReactRoot = !!(
          document.querySelector('[data-reactroot]') ||
          document.querySelector('#__next') ||
          document.querySelector('#root')
        );
        results.reactNextMarkers = hasNextData || hasReactRoot;

        // Webflow
        results.webflowMarker = typeof window.Webflow !== 'undefined';

        // Framer
        const hasFramerCanvas = !!document.querySelector('framer-canvas');
        const hasFramerWindow = typeof window.framer !== 'undefined';
        results.framerMarker = hasFramerCanvas || hasFramerWindow;

        // Wix
        const hasWixAnalytics = typeof window.wixDevelopersAnalytics !== 'undefined';
        const hasWixRoot = !!document.querySelector('[data-aid="site-root"]');
        results.wixMarker = hasWixAnalytics || hasWixRoot;

        // Mutation observation
        let lastMutationTime = Date.now();
        let mutationCount = 0;
        let lastNodeCount = document.querySelectorAll('*').length;

        const observer = new MutationObserver(() => {
          mutationCount++;
          lastMutationTime = Date.now();
          lastNodeCount = document.querySelectorAll('*').length;
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false
        });

        // Wait for stability
        const stabilityStart = Date.now();
        let stabilityAchieved = false;

        while (Date.now() - stabilityStart < ${this.observeTimeoutMs}) {
          const now = Date.now();
          const timeSinceLastMutation = now - lastMutationTime;

          if (
            timeSinceLastMutation >= ${this.stabilityThresholdMs} &&
            results.reactNextMarkers
          ) {
            stabilityAchieved = true;
            break;
          }

          await new Promise(r => setTimeout(r, 50));
        }

        observer.disconnect();

        results.mutationCount = mutationCount;
        results.nodeCountDelta = lastNodeCount - ${initialNodeCount};
        results.nodeCountDeltaPercent =
          (Math.abs(results.nodeCountDelta) / ${initialNodeCount}) * 100;
        results.stabilityAchieved = stabilityAchieved;
        results.stabilityTimeMs = Date.now() - stabilityStart;

        return results;
      })()
    `;

    try {
      return await page.evaluate(detectionScript);
    } catch (err) {
      logger.error("spa.hydration.script_error", { error: String(err) });
      throw err;
    }
  }

  private classifyFramework(
    signals: HydrationSignals
  ): "react" | "webflow" | "framer" | "wix" | "unknown" {
    if (signals.reactNextMarkers) return "react";
    if (signals.webflowMarker) return "webflow";
    if (signals.framerMarker) return "framer";
    if (signals.wixMarker) return "wix";
    return "unknown";
  }

  private calculateScore(signals: HydrationSignals): number {
    let score = 0;

    // React/Next.js markers (40 weight)
    if (signals.reactNextMarkers) score += 40;

    // DOM stability (30 weight)
    if (
      signals.stabilityAchieved &&
      signals.nodeCountDeltaPercent < this.stabilityNodeDeltaPercent
    ) {
      score += 30;
    }

    // Node count threshold (20 weight)
    if (signals.nodeCountDeltaPercent < 5) score += 20;

    // Script execution success (10 weight)
    if (signals.scriptExecutionErrors === 0) score += 10;

    return Math.min(score, 100);
  }

  private async getNodeCount(page: any): Promise<number> {
    try {
      return await page.evaluate(
        () => document.querySelectorAll("*").length
      );
    } catch (err) {
      logger.error("spa.hydration.nodecount_error", { error: String(err) });
      return 0;
    }
  }
}
