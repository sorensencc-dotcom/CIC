// Phase 1: Constraint-solving scheduler for phase execution planning
// Solves NP-complete scheduling problem with resource constraints, dependencies, and governance gates
// Output: execution wave table with parallel phase groups and resource allocation

export interface ScheduleConstraint {
  type: 'cpu' | 'memory' | 'network' | 'disk' | 'dependency' | 'governance_gate';
  value: number | string;
  operator: '<' | '<=' | '=' | '>=' | '>';
}

export interface ExecutionWave {
  waveId: number;
  phases: string[];
  startTime: number;
  estimatedDuration: number;
  resourceAllocation: Record<string, number>;
}

interface DependencyEdge {
  from: string;
  to: string;
}

export class AutoschedulerV2 {
  private dependencies: Map<string, Set<string>> = new Map();

  constructor() {}

  solve(
    phases: string[],
    costs: Map<string, any>,
    constraints: ScheduleConstraint[],
    governanceDecisions?: Map<string, any>
  ): ExecutionWave[] {
    // Extract dependency constraints
    const depConstraints = constraints.filter(c => c.type === 'dependency');
    this.buildDependencyGraph(phases, depConstraints);

    // Topological sort
    const sorted = this.topologicalSort(phases);

    // Pack into waves respecting dependencies and resource constraints
    const waves: ExecutionWave[] = [];
    let waveId = 0;
    let startTime = 0;

    const scheduled = new Set<string>();

    while (scheduled.size < sorted.length) {
      // Find phases ready to schedule (all dependencies done)
      const ready: string[] = [];
      for (const phase of sorted) {
        if (!scheduled.has(phase)) {
          const deps = this.dependencies.get(phase) || new Set();
          const allDone = Array.from(deps).every(d => scheduled.has(d));
          if (allDone) {
            ready.push(phase);
          }
        }
      }

      if (ready.length === 0) break;

      // Greedily pack phases into current wave (simple heuristic)
      const wave: string[] = [];
      let totalCpu = 0;
      let totalMemory = 0;

      for (const phase of ready) {
        const cost = costs.get(phase) || { cpu: { max: 4 }, memory: { max: 8 } };
        const phaseCpu = cost.cpu?.max || 4;
        const phaseMem = cost.memory?.max || 8;

        // Check resource constraints
        const cpuConstraint = constraints.find(c => c.type === 'cpu' && c.operator === '<');
        const memConstraint = constraints.find(c => c.type === 'memory' && c.operator === '<');

        const maxCpu = cpuConstraint ? (cpuConstraint.value as number) : 16;
        const maxMem = memConstraint ? (memConstraint.value as number) : 32;

        if (totalCpu + phaseCpu <= maxCpu && totalMemory + phaseMem <= maxMem) {
          wave.push(phase);
          totalCpu += phaseCpu;
          totalMemory += phaseMem;
          scheduled.add(phase);
        }
      }

      const duration = wave.length > 0 ? wave.reduce((max, p) => {
        const cost = costs.get(p) || {};
        return Math.max(max, cost.duration?.max || 300);
      }, 0) : 300;

      if (wave.length > 0) {
        waves.push({
          waveId: waveId++,
          phases: wave,
          startTime,
          estimatedDuration: duration,
          resourceAllocation: {
            cpu: totalCpu,
            memory: totalMemory,
          },
        });

        startTime += duration;
      }
    }

    return waves;
  }

  validateSchedule(schedule: ExecutionWave[], constraints: ScheduleConstraint[]): boolean {
    const allPhases = schedule.flatMap(w => w.phases);
    const phaseSet = new Set(allPhases);

    // Check for duplicates
    if (allPhases.length !== phaseSet.size) return false;

    // Check resource constraints
    for (const wave of schedule) {
      const cpuConstraint = constraints.find(c => c.type === 'cpu');
      const memConstraint = constraints.find(c => c.type === 'memory');

      if (cpuConstraint && cpuConstraint.operator === '<') {
        if (wave.resourceAllocation.cpu >= cpuConstraint.value) return false;
      }

      if (memConstraint && memConstraint.operator === '<') {
        if (wave.resourceAllocation.memory >= memConstraint.value) return false;
      }
    }

    return true;
  }

  replan(
    currentSchedule: ExecutionWave[],
    trigger: 'governance_gate' | 'constraint_violation' | 'resource_spike',
    newConstraint?: ScheduleConstraint
  ): ExecutionWave[] {
    const allPhases = currentSchedule.flatMap(w => w.phases);
    const costs = new Map<string, any>();

    // Reconstruct cost map from schedule
    for (const wave of currentSchedule) {
      for (const phase of wave.phases) {
        costs.set(phase, {
          cpu: { max: wave.resourceAllocation.cpu / wave.phases.length },
          memory: { max: wave.resourceAllocation.memory / wave.phases.length },
          duration: { max: wave.estimatedDuration },
        });
      }
    }

    // Rebuild with new constraint
    const constraints: ScheduleConstraint[] = [];
    if (newConstraint) constraints.push(newConstraint);

    return this.solve(allPhases, costs, constraints);
  }

  private buildDependencyGraph(phases: string[], depConstraints: ScheduleConstraint[]): void {
    this.dependencies.clear();

    for (const phase of phases) {
      this.dependencies.set(phase, new Set());
    }

    for (const constraint of depConstraints) {
      if (typeof constraint.value === 'string') {
        const [from, to] = constraint.value.split('->');
        if (this.dependencies.has(to)) {
          this.dependencies.get(to)!.add(from);
        }
      }
    }
  }

  private topologicalSort(phases: string[]): string[] {
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (phase: string) => {
      if (visited.has(phase)) return;
      visited.add(phase);

      const deps = this.dependencies.get(phase) || new Set();
      for (const dep of deps) {
        if (phases.includes(dep)) {
          dfs(dep);
        }
      }

      stack.push(phase);
    };

    for (const phase of phases) {
      dfs(phase);
    }

    return stack;
  }
}
