// Governance database interface
// Stub for PostgreSQL integration (Phase 24.3+)

export interface ExecuteResult {
  rowCount: number;
  affectedRows: number;
  insertId: number;
}

export interface Database {
  query(sql: string, params?: any[]): Promise<any[]>;
  execute(sql: string, params?: any[]): Promise<ExecuteResult>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class StubDatabase implements Database {
  async query(): Promise<any[]> {
    return [];
  }

  async execute(): Promise<ExecuteResult> {
    return { rowCount: 0, affectedRows: 0, insertId: 0 };
  }

  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {
    // noop
  }
}

export const db: Database = new StubDatabase();
