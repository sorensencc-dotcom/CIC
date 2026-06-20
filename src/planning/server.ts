import express from 'express'
import { createAdapterWithWarmPool } from '../extractors/browser/CloakBrowserAdapter.WarmPool'
import { logger } from '../lib/logger'

const app = express()
const port = process.env.PORT || 3114
const warmPoolSize = parseInt(process.env.WARM_POOL_SIZE || '3', 10)

// Initialize adapter globally
const adapter = createAdapterWithWarmPool(warmPoolSize)

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'planning-engine', timestamp: new Date().toISOString() })
})

/**
 * POST /navigate
 * Navigate to URL and extract DOM with hydration detection
 */
app.post('/navigate', async (req, res) => {
  const { url, retryCount, timeoutMs } = req.body

  if (!url) {
    return res.status(400).json({ error: 'url required' })
  }

  try {
    const result = await adapter.navigate(url, { retryCount, timeoutMs })
    res.json(result)
  } catch (err) {
    logger.error('planning.navigate.error', { url, error: String(err) })
    res.status(500).json({ error: String(err) })
  }
})

/**
 * POST /sample
 * Sample multiple URLs and select best DOM
 */
app.post('/sample', async (req, res) => {
  const { baseUrl } = req.body

  if (!baseUrl) {
    return res.status(400).json({ error: 'baseUrl required' })
  }

  try {
    const result = await adapter.sampleUrls(baseUrl)
    res.json(result)
  } catch (err) {
    logger.error('planning.sample.error', { baseUrl, error: String(err) })
    res.status(500).json({ error: String(err) })
  }
})

/**
 * GET /metrics
 * Get warm pool metrics
 */
app.get('/metrics', (req, res) => {
  try {
    const metrics = adapter.getWarmPoolMetrics()
    res.json(metrics)
  } catch (err) {
    logger.error('planning.metrics.error', { error: String(err) })
    res.status(500).json({ error: String(err) })
  }
})

/**
 * POST /cleanup
 * Drain warm pool and cleanup resources
 */
app.post('/cleanup', async (req, res) => {
  try {
    await adapter.cleanup()
    res.json({ status: 'cleaned' })
  } catch (err) {
    logger.error('planning.cleanup.error', { error: String(err) })
    res.status(500).json({ error: String(err) })
  }
})

// Initialize warm pool and start server
async function start() {
  try {
    await adapter.init()
    logger.info('planning.server.adapter_initialized', { warmPoolSize })

    app.listen(port, () => {
      logger.info('planning.server.started', { port, warmPoolSize })
    })

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('planning.server.shutdown')
      await adapter.cleanup()
      process.exit(0)
    })
  } catch (err) {
    logger.error('planning.server.startup_error', { error: String(err) })
    process.exit(1)
  }
}

start()
