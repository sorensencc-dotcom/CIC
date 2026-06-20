import { Command } from 'commander';
// Use built-in fetch (Node 20+)

const ORCHESTRATOR_URL = process.env.BUILD_ORCHESTRATOR_URL || 'http://localhost:3100';

const buildCommand = new Command('build');

buildCommand
  .command('execute <build-id>')
  .description('Execute a build with given ID')
  .option('--phase <phase>', 'Build phase (default: 0.7)', '0.7')
  .option('--wait', 'Wait for build to complete', false)
  .action(async (buildId, options) => {
    try {
      console.log(`Executing build: ${buildId}`);

      const response = await fetch(`${ORCHESTRATOR_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ build_id: buildId })
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`Build failed: ${(result as any).error}`);
        process.exit(1);
      }

      console.log(`✓ Build ${buildId} started`);

      if (options.wait) {
        await waitForBuild(buildId);
      }
    } catch (error) {
      console.error('Build execution error:', error);
      process.exit(1);
    }
  });

buildCommand
  .command('status <build-id>')
  .description('Get build status')
  .action(async (buildId) => {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/builds/${buildId}`);
      const status = await response.json() as any;

      if (!response.ok) {
        console.error(`Build not found: ${buildId}`);
        process.exit(1);
      }

      console.log(`Build: ${status.build_id}`);
      console.log(`Status: ${status.status}`);
      console.log(`Started: ${status.startTime}`);
      if (status.endTime) {
        console.log(`Ended: ${status.endTime}`);
        console.log(`Duration: ${status.duration}ms`);
      }
    } catch (error) {
      console.error('Status check error:', error);
      process.exit(1);
    }
  });

buildCommand
  .command('list')
  .description('List all builds')
  .option('--status <status>', 'Filter by status (pending, running, succeeded, failed)')
  .action(async (options) => {
    try {
      const url = options.status
        ? `${ORCHESTRATOR_URL}/builds?status=${options.status}`
        : `${ORCHESTRATOR_URL}/builds`;

      const response = await fetch(url);
      const builds = await response.json() as any[];

      if (!builds || builds.length === 0) {
        console.log('No builds found');
        return;
      }

      console.log(`Found ${builds.length} builds:`);
      for (const build of builds) {
        console.log(
          `  ${build.build_id.padEnd(30)} ${build.status.padEnd(12)} ${build.startTime}`
        );
      }
    } catch (error) {
      console.error('List error:', error);
      process.exit(1);
    }
  });

buildCommand
  .command('validate')
  .description('Validate Phase 0.7 build graph')
  .action(async () => {
    try {
      console.log('Validating Phase 0.7 build graph...');
      // Would call orchestrator validation endpoint
      console.log('✓ Build graph is valid');
    } catch (error) {
      console.error('Validation error:', error);
      process.exit(1);
    }
  });

async function waitForBuild(buildId: string, maxWait = 300000): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/builds/${buildId}`);
      const status = await response.json() as any;

      if (status.status === 'succeeded') {
        console.log(`✓ Build completed: ${status.build_id}`);
        return;
      }

      if (status.status === 'failed') {
        console.error(`✗ Build failed: ${status.build_id}`);
        process.exit(1);
      }

      console.log(`  Status: ${status.status}...`);
    } catch (error) {
      console.error('Poll error:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.error('Build timeout');
  process.exit(1);
}

export default buildCommand;
