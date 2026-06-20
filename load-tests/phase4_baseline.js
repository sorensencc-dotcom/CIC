/**
 * Phase 4 Load Test: Baseline Throughput
 * Scenario: 1 req/sec for 5 minutes
 * Expected: stable latency, ≤5% retries, success rate ≥95%
 *
 * Run: k6 run phase4_baseline.js
 * With Prometheus: k6 run --out=experimental-prometheus-rw phase4_baseline.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const latency = new Trend('navigate_latency_ms');

export const options = {
  stages: [
    { duration: '1m', target: 1 },  // Ramp up to 1 req/sec
    { duration: '3m', target: 1 },  // Hold at 1 req/sec
    { duration: '1m', target: 0 },  // Ramp down
  ],
  thresholds: {
    'navigate_latency_ms': ['p(95) < 3500'], // p95 latency SLO
    'errors': ['rate < 0.05'],              // Error rate SLO
  },
};

const BASE_URL = 'http://localhost:3114';

// Test URLs: simple, SPA, slow
const TEST_URLS = [
  'https://example.com',
  'https://github.com',
  'https://www.wikipedia.org',
];

export default function () {
  const url = TEST_URLS[Math.floor(Math.random() * TEST_URLS.length)];

  const payload = JSON.stringify({
    url: url,
    retryCount: 2,
    timeoutMs: 10000,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'Navigate' },
  };

  // Make request
  const res = http.post(`${BASE_URL}/navigate`, payload, params);

  // Record latency
  latency.add(res.timings.duration);

  // Check response
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 3000ms': (r) => r.timings.duration < 3000,
    'has dom': (r) => {
      try {
        const data = JSON.parse(r.body);
        return data.dom && data.dom.length > 0;
      } catch {
        return false;
      }
    },
    'has hydration score': (r) => {
      try {
        const data = JSON.parse(r.body);
        return typeof data.hydrationScore === 'number';
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);

  // Pacing
  sleep(1);
}
