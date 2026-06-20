import { ITorqueQueryFS, UserContext, FSReadResponse, DirectoryEntry } from "./fs";

export class TorqueQueryFSRuntime {
  constructor(
    private fs: ITorqueQueryFS,
    private user: UserContext
  ) {}

  /**
   * Walk a directory recursively and execute a callback on each file.
   */
  async walk(
    dirPath: string, 
    callback: (entry: DirectoryEntry) => Promise<void>
  ): Promise<void> {
    const listRes = await this.fs.list(this.user, dirPath);
    for (const entry of listRes.entries) {
      if (entry.type === "page" || entry.type === "spec" || entry.type === "internal") {
        await callback(entry);
      } else {
        // Recursive walk for subdirectories
        await this.walk(entry.fullPath, callback);
      }
    }
  }

  /**
   * Helper to read the entire file by automatically concatenating paginated chunks.
   */
  async readFully(path: string, chunkSize = 50000): Promise<string> {
    let offset = 0;
    let accumulated = "";
    let hasMore = true;

    while (hasMore) {
      const chunk: FSReadResponse = await this.fs.read(this.user, path, {
        offset,
        limit: chunkSize
      });
      accumulated += chunk.content;
      hasMore = chunk.hasMore;
      offset += chunkSize;
    }

    return accumulated;
  }
}
