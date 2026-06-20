/**
 * Phase 4 Load Test: Saturation Ramp
 * Scenario: 1 → 10 req/sec over 10 minutes
 * Expected: saturation at 4-6 req/sec, latency curve upward
 *
 * Run: k6 run phase4_saturation.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const latency = new Trend('navigate_latency_ms');
const saturationPoint = new Trend('rps');

export const options = {
  stages: [
    { duration: '1m', target: 1 },
    { duration: '1m', target: 2 },
    { duration: '1m', target: 4 },
    { duration: '1m', target: 6 },
    { duration: '1m', target: 8 },
    { duration: '1m', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'navigate_latency_ms': ['p(95) < 5000'],
    'errors': ['rate < 0.10'],
  },
};

const BASE_URL = 'http://localhost:3114';
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
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'Navigate' },
  };

  const res = http.post(`${BASE_URL}/navigate`, payload, params);

  latency.add(res.timings.duration);
  saturationPoint.add(__VU); // Track virtual users (proxy for RPS)

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 5000ms': (r) => r.timings.duration < 5000,
    'has response': (r) => r.body.length > 0,
  });

  errorRate.add(!ok);

  // No sleep; let k6 pace based on config
}
