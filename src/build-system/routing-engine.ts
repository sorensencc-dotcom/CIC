import { RouteRequest } from './types';

export class RoutingEngine {
  private validPhases = ['0.7'];
  private validChannels = [
    'cic.events',
    'labs.discovery.requests',
    'labs.extractor.requests',
    'labs.redesign.requests',
    'labs.outreach.requests',
    'inference.requests',
    'cic.telemetry'
  ];

  private allowedRoutes = [
    { from: 'cic.ingestion', to: 'cic.evolution', channel: 'cic.events' },
    { from: 'cic.evolution', to: 'labs.discovery', channel: 'labs.discovery.requests' },
    { from: 'labs.discovery', to: 'labs.extractor', channel: 'labs.extractor.requests' },
    { from: 'labs.extractor', to: 'labs.redesign.gpu', channel: 'labs.redesign.requests' },
    { from: 'labs.redesign.gpu', to: 'labs.outreach', channel: 'labs.outreach.requests' },
    { from: 'labs.redesign.gpu', to: 'inference.nemotron', channel: 'inference.requests' }
  ];

  validateRoute(request: RouteRequest): { allowed: boolean; reason?: string } {
    // Validate phase
    if (!this.validPhases.includes(request.phase)) {
      return { allowed: false, reason: `Invalid phase: ${request.phase}` };
    }

    // Validate channel
    if (!this.validChannels.includes(request.channel)) {
      return { allowed: false, reason: `Invalid channel: ${request.channel}` };
    }

    // Check for wildcards
    if (request.to.startsWith('*')) {
      return { allowed: false, reason: 'Wildcards not allowed in route destinations' };
    }

    // Special case: telemetry sink accepts from any source
    if (request.to === 'cic.observability' && request.channel === 'cic.telemetry') {
      return { allowed: true };
    }

    // Check allowed routes
    const routeExists = this.allowedRoutes.some(
      (route) => route.from === request.from && route.to === request.to && route.channel === request.channel
    );

    if (!routeExists) {
      return {
        allowed: false,
        reason: `Route not allowed: ${request.from} → ${request.to} on ${request.channel}`
      };
    }

    return { allowed: true };
  }

  validateChannel(channel: string): boolean {
    return this.validChannels.includes(channel);
  }

  getAllowedRoutes(): object[] {
    return this.allowedRoutes.map((r) => ({
      from: r.from,
      to: r.to,
      channel: r.channel
    }));
  }

  getAllowedChannels(): string[] {
    return [...this.validChannels];
  }
}
