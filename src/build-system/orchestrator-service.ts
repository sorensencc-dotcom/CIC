const http = require('http');

class OrchestratorService {
  constructor() {
    this.port = parseInt(process.env.PORT || '3104', 10);
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.lineageUrl = process.env.LINEAGE_URL || 'http://localhost:3102';
    this.routingUrl = process.env.ROUTING_URL || 'http://localhost:3103';
    this.buildQueue = {
      jobs: new Map(),
      nextJobId: 1,
    };
  }

  initialize() {
    console.log(`[Orchestrator] Initializing on port ${this.port}`);
    console.log(`[Orchestrator] Redis: ${this.redisUrl}`);
    console.log(`[Orchestrator] Lineage: ${this.lineageUrl}`);
    console.log(`[Orchestrator] Routing: ${this.routingUrl}`);
  }

  generateJobId() {
    const id = `build-${this.buildQueue.nextJobId++}`;
    return id;
  }

  validateBuildDAG(dag) {
    if (!Array.isArray(dag) || dag.length === 0) {
      return { valid: false, error: 'DAG must be non-empty array of nodes' };
    }

    // Check required fields
    for (const node of dag) {
      if (!node.id || !node.phase) {
        return { valid: false, error: `Node missing id or phase: ${JSON.stringify(node)}` };
      }
    }

    // Check for cycles (simple DFS)
    const hasCycle = (nodeId, visited, stack, nodeMap) => {
      visited.add(nodeId);
      stack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node && node.dependencies) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            if (hasCycle(dep, visited, stack, nodeMap)) return true;
          } else if (stack.has(dep)) {
            return true;
          }
        }
      }

      stack.delete(nodeId);
      return false;
    };

    const nodeMap = new Map(dag.map((n) => [n.id, n]));
    for (const node of dag) {
      const visited = new Set();
      const stack = new Set();
      if (hasCycle(node.id, visited, stack, nodeMap)) {
        return { valid: false, error: `Cycle detected in DAG at node ${node.id}` };
      }
    }

    return { valid: true };
  }

  createExecutionPlan(dag) {
    // Topological sort
    const visited = new Set();
    const layers = [];
    const nodeMap = new Map(dag.map((n) => [n.id, n]));

    const dfs = (nodeId, layer) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) return;

      while (layers.length <= layer) {
        layers.push([]);
      }
      layers[layer].push(nodeId);

      // Add dependents to next layer
      for (const dep of dag) {
        if (dep.dependencies && dep.dependencies.includes(nodeId)) {
          dfs(dep.id, layer + 1);
        }
      }
    };

    // Start DFS from nodes with no dependencies
    for (const node of dag) {
      if (!node.dependencies || node.dependencies.length === 0) {
        dfs(node.id, 0);
      }
    }

    return {
      layerCount: layers.length,
      executionOrder: layers,
    };
  }

  executeDAG(job) {
    job.state = 'RUNNING';
    job.startTime = Date.now();
    job.logs.push(`[${new Date().toISOString()}] Build started`);

    const executeLayer = async (layerIndex) => {
      try {
        if (layerIndex >= job.executionPlan.executionOrder.length) {
          job.state = 'SUCCESS';
          job.endTime = Date.now();
          job.logs.push(`[${new Date().toISOString()}] Build completed (${job.endTime - job.startTime}ms)`);
          return;
        }

        const layer = job.executionPlan.executionOrder[layerIndex];
        job.logs.push(`[${new Date().toISOString()}] Executing layer ${layerIndex + 1}/${job.executionPlan.layerCount}`);

        await Promise.all(
          layer.map((nodeId) => {
            const node = job.dag.find((n) => n.id === nodeId);
            if (!node) return Promise.resolve();

            job.logs.push(`[${new Date().toISOString()}] Node ${nodeId} started`);

            return new Promise((resolve) => {
              setTimeout(() => {
                const context = {
                  nodeId,
                  phase: node.phase,
                  executionTime: 250,
                  status: 'success',
                  artifacts: {
                    nodeId,
                    timestamp: new Date().toISOString(),
                    data: { result: 'mock result' },
                  },
                  error: null,
                };

                job.nodeResults.set(nodeId, context);
                job.logs.push(`[${new Date().toISOString()}] Node ${nodeId} completed`);
                resolve();
              }, Math.random() * 500 + 100);
            });
          }),
        );

        await executeLayer(layerIndex + 1);
      } catch (err) {
        job.state = 'FAILED';
        job.endTime = Date.now();
        job.error = err instanceof Error ? err.message : 'Unknown layer execution error';
        job.logs.push(`[${new Date().toISOString()}] Layer ${layerIndex + 1} failed: ${job.error}`);
        console.error(`[Orchestrator] Layer ${layerIndex + 1} execution error:`, err);
      }
    };

    executeLayer(0).catch((err) => {
      console.error('[Orchestrator] Fatal error in DAG execution:', err);
      if (job.state !== 'FAILED') {
        job.state = 'FAILED';
        job.endTime = Date.now();
        job.error = 'Fatal DAG execution error';
      }
    });
  }

  handleRequest(req, res) {
    const { method, url } = req;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: 1, service: 'orchestrator', version: '0.7' }));
      return;
    }

    // List builds
    if (url === '/builds' && method === 'GET') {
      const builds = Array.from(this.buildQueue.jobs.values()).map((job) => ({
        id: job.id,
        state: job.state,
        startTime: job.startTime,
        endTime: job.endTime,
        nodeCount: job.dag.length,
        completedNodes: job.nodeResults.size,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ builds }));
      return;
    }

    // Execute build
    if (url === '/execute' && method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        try {
          const { dag } = JSON.parse(body);

          const validation = this.validateBuildDAG(dag);
          if (!validation.valid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: validation.error }));
            return;
          }

          const jobId = this.generateJobId();
          const job = {
            id: jobId,
            state: 'QUEUED',
            dag,
            executionPlan: this.createExecutionPlan(dag),
            startTime: Date.now(),
            nodeResults: new Map(),
            logs: [`[${new Date().toISOString()}] Build queued`],
          };

          this.buildQueue.jobs.set(jobId, job);

          setTimeout(() => this.executeDAG(job), 100);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jobId, state: 'QUEUED' }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // Get build status
    const statusMatch = url.match(/^\/builds\/([^/]+)$/);
    if (statusMatch && method === 'GET') {
      const jobId = statusMatch[1];
      const job = this.buildQueue.jobs.get(jobId);

      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Build not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: job.id,
          state: job.state,
          startTime: job.startTime,
          endTime: job.endTime,
          nodeCount: job.dag.length,
          completedNodes: job.nodeResults.size,
          error: job.error,
        }),
      );
      return;
    }

    // Get build logs
    const logsMatch = url.match(/^\/builds\/([^/]+)\/logs$/);
    if (logsMatch && method === 'GET') {
      const jobId = logsMatch[1];
      const job = this.buildQueue.jobs.get(jobId);

      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Build not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: job.logs }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  start() {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    server.listen(this.port, () => {
      console.log(`[Orchestrator] Listening on port ${this.port}`);
    });
  }
}

// Start service
const service = new OrchestratorService();
service.initialize();
service.start();
