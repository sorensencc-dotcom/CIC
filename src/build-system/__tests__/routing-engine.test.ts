import { RoutingEngine } from '../routing-engine';

describe('RoutingEngine', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine();
  });

  describe('validateRoute', () => {
    it('should allow valid route', () => {
      const result = engine.validateRoute({
        phase: '0.7',
        from: 'cic.ingestion',
        to: 'cic.evolution',
        channel: 'cic.events'
      });

      expect(result.allowed).toBe(true);
    });

    it('should reject invalid phase', () => {
      const result = engine.validateRoute({
        phase: '0.8',
        from: 'cic.ingestion',
        to: 'cic.evolution',
        channel: 'cic.events'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid phase');
    });

    it('should reject invalid channel', () => {
      const result = engine.validateRoute({
        phase: '0.7',
        from: 'cic.ingestion',
        to: 'cic.evolution',
        channel: 'invalid.channel'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid channel');
    });

    it('should reject wildcard destination', () => {
      const result = engine.validateRoute({
        phase: '0.7',
        from: 'cic.ingestion',
        to: '*',
        channel: 'cic.events'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Wildcards');
    });

    it('should allow telemetry from any source', () => {
      const result = engine.validateRoute({
        phase: '0.7',
        from: 'any.source',
        to: 'cic.observability',
        channel: 'cic.telemetry'
      });

      expect(result.allowed).toBe(true);
    });

    it('should reject unallowed route', () => {
      const result = engine.validateRoute({
        phase: '0.7',
        from: 'labs.outreach',
        to: 'cic.ingestion',
        channel: 'cic.events'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });
  });

  describe('validateChannel', () => {
    it('should validate allowed channel', () => {
      expect(engine.validateChannel('cic.events')).toBe(true);
      expect(engine.validateChannel('cic.telemetry')).toBe(true);
    });

    it('should reject invalid channel', () => {
      expect(engine.validateChannel('invalid.channel')).toBe(false);
    });
  });

  describe('getAllowedRoutes', () => {
    it('should return list of allowed routes', () => {
      const routes = engine.getAllowedRoutes();
      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0]).toHaveProperty('from');
      expect(routes[0]).toHaveProperty('to');
      expect(routes[0]).toHaveProperty('channel');
    });
  });

  describe('getAllowedChannels', () => {
    it('should return list of allowed channels', () => {
      const channels = engine.getAllowedChannels();
      expect(channels.length).toBeGreaterThan(0);
      expect(channels).toContain('cic.events');
      expect(channels).toContain('cic.telemetry');
    });
  });
});
