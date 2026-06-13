import * as fs from 'fs';
import * as path from 'path';
import { BuildGraphEngine } from './graph-engine';
import { BuildGraph, BuildProvenance } from './types';

interface OrchestrationConfig {
  phase: string;
  lineageUrl: string;
  routingUrl: string;
  nemotronUrl: string;
  nimGatewayUrl: string;
  port: number;
}

export class BuildOrchestrator {
  private config: OrchestrationConfig;
  private engine: BuildGraphEngine | null = null;
  private builds: Map<string, { status: string; startTime: Date; endTime?: Date }> = new Map();

  constructor(config: Partial<OrchestrationConfig> = {}) {
    this.config = {
      phase: config.phase || process.env.BUILD_PHASE || '0.7',
      lineageUrl: config.lineageUrl || process.env.LINEAGE_URL || 'http://localhost:3102',
      routingUrl: config.routingUrl || process.env.ROUTING_URL || 'http://localhost:3103',
      nemotronUrl: config.nemotronUrl || process.env.NEMOTRON_URL || 'http://localhost:9000',
      nimGatewayUrl: config.nimGatewayUrl || process.env.NIM_GATEWAY_URL || 'http://localhost:8000',
      port: config.port || parseInt(process.env.PORT || '3100', 10)
    };
  }

  async initialize(): Promise<void> {
    let graphContent: string;
    const graphPath = path.join(__dirname, '../../phase0.7/build-system/graph/phase0.7.json');

    try {
      graphContent = fs.readFileSync(graphPath, 'utf8');
    } catch (fsErr) {
      const err = fsErr as NodeJS.ErrnoException;
      const msg = `Failed to read graph file at ${graphPath}: ${err.code} - ${err.message}`;
      console.error(msg);
      throw new Error(msg);
    }

    let graph: BuildGraph;
    try {
      graph = JSON.parse(graphContent);
    } catch (parseErr) {
      const err = parseErr as SyntaxError;
      const msg = `Invalid JSON in graph file at ${graphPath}: ${err.message}`;
      console.error(msg);
      console.error('Content preview:', graphContent.substring(0, 200));
      throw new Error(msg);
    }

    try {
      const validation = new BuildGraphEngine(graph).validateGraph();
      if (!validation.valid) {
        throw new Error(`Graph validation failed: ${validation.errors.join(', ')}`);
      }

      this.engine = new BuildGraphEngine(graph);
      console.log(`✓ Orchestrator initialized for Phase ${this.config.phase} (git: ${process.env.GIT_SHA || 'unknown'})`);
      console.log(`  Lineage: ${this.config.lineageUrl}`);
      console.log(`  Routing: ${this.config.routingUrl}`);
      console.log(`  Nemotron: ${this.config.nemotronUrl}`);
      console.log(`  NIM Gateway: ${this.config.nimGatewayUrl}`);
    } catch (error) {
      const err = error as Error;
      console.error('Failed to initialize orchestrator:', err.message);
      console.error('Stack:', err.stack);
      throw error;
    }
  }

  async executeBuild(build_id: string): Promise<{ success: boolean; build_id: string; error?: string }> {
    if (!this.engine) {
      return { success: false, build_id, error: 'Orchestrator not initialized' };
    }

    this.builds.set(build_id, { status: 'running', startTime: new Date() });

    try {
      const plan = this.engine.createExecutionPlan(build_id);
      console.log(`Created execution plan for build ${build_id}:`, plan.execution_order);

      const provenance: BuildProvenance = {
        git_sha: process.env.GIT_SHA || 'unknown',
        timestamp: new Date().toISOString(),
        sbom_ref: `sbom-${build_id}`
      };

      const result = await this.engine.executePlan(plan, provenance);

      const buildRecord = this.builds.get(build_id)!;
      buildRecord.status = result.success ? 'succeeded' : 'failed';
      buildRecord.endTime = new Date();

      if (result.errors.length > 0) {
        console.error(`Build ${build_id} failed with errors:`, result.errors);
        return { success: false, build_id, error: result.errors[0].message };
      }

      const lineage = this.engine.getLineageRegistry().exportLineage(build_id);
      console.log(`Build ${build_id} completed:`, lineage);

      return { success: true, build_id };
    } catch (error) {
      const buildRecord = this.builds.get(build_id)!;
      buildRecord.status = 'failed';
      buildRecord.endTime = new Date();

      const err = error as Error;
      console.error(`Build ${build_id} execution error:`, err.message);
      return { success: false, build_id, error: err.message };
    }
  }

  getBuildStatus(build_id: string): object | null {
    const record = this.builds.get(build_id);
    if (!record) return null;

    return {
      build_id,
      status: record.status,
      startTime: record.startTime.toISOString(),
      endTime: record.endTime?.toISOString(),
      duration: record.endTime ? record.endTime.getTime() - record.startTime.getTime() : null
    };
  }

  listBuilds(status?: string): object[] {
    return Array.from(this.builds.entries())
      .filter(([_, record]) => !status || record.status === status)
      .map(([build_id, record]) => ({
        build_id,
        status: record.status,
        startTime: record.startTime.toISOString(),
        endTime: record.endTime?.toISOString()
      }));
  }

  getGraph(): BuildGraph | null {
    if (!this.engine) return null;
    // Return graph info from engine
    return null;
  }

  startServer(): void {
    const http = require('http');

    const server = http.createServer(async (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy' }));
        return;
      }

      if (req.url === '/builds' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(this.listBuilds()));
        return;
      }

      if (req.url.startsWith('/builds/') && req.method === 'GET') {
        const build_id = req.url.split('/')[2];
        const status = this.getBuildStatus(build_id);
        if (status) {
          res.writeHead(200);
          res.end(JSON.stringify(status));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Build not found' }));
        }
        return;
      }

      if (req.url === '/execute' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => (body += chunk.toString()));
        req.on('end', async () => {
          try {
            const { build_id } = JSON.parse(body);
            const result = await this.executeBuild(build_id);
            res.writeHead(result.success ? 200 : 400);
            res.end(JSON.stringify(result));
          } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(this.config.port, () => {
      console.log(`Build Orchestrator listening on port ${this.config.port}`);
    });
  }
}

// Main entry point
async function main() {
  const orchestrator = new BuildOrchestrator();
  await orchestrator.initialize();
  orchestrator.startServer();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default BuildOrchestrator;
