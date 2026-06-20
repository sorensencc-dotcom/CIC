import { createAdapterWithWarmPool } from '../extractors/browser/CloakBrowserAdapter.WarmPool'

describe('Planning Server Integration', () => {
  it('adapter initializes without error', async () => {
    const adapter = createAdapterWithWarmPool(1)

    expect(adapter).toBeDefined()
    expect(adapter.init).toBeDefined()
    expect(adapter.navigate).toBeDefined()
    expect(adapter.sampleUrls).toBeDefined()
    expect(adapter.getWarmPoolMetrics).toBeDefined()
    expect(adapter.cleanup).toBeDefined()
  })

  it('adapter has required methods for server integration', async () => {
    const adapter = createAdapterWithWarmPool(1)

    const metrics = adapter.getWarmPoolMetrics()

    expect(metrics).toHaveProperty('poolSize')
    expect(metrics).toHaveProperty('targetSize')
    expect(metrics).toHaveProperty('healthySessionCount')
    expect(metrics).toHaveProperty('avgLatencyMs')
  })
})
