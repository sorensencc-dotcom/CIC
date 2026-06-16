import { 
  ITorqueQueryFS, 
  ISpecTools, 
  IPDFTools,
  UserContext, 
  FSListResponse, 
  FSReadResponse, 
  FSSearchResponse, 
  FSStatResponse,
  SearchPattern,
  SearchOptions,
  FindFilters,
  EndpointSpec,
  SpecSearchResponse,
  PDFSection,
  SearchSnippet
} from "../torquequery-sdk/fs";

export class TorqueQueryFSClient implements ITorqueQueryFS, ISpecTools, IPDFTools {
  constructor(private baseUrl: string) {}

  /**
   * Helper to execute API requests
   */
  private async request<T>(endpoint: string, body: any): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`TorqueQuery FS API Error [${res.status}]: ${errorText}`);
    }
    return (await res.json()) as T;
  }

  // --- ITorqueQueryFS Implementation ---

  async list(user: UserContext, path: string): Promise<FSListResponse> {
    return this.request<FSListResponse>("/api/fs/list", { user, path });
  }

  async read(
    user: UserContext, 
    path: string, 
    options?: { offset?: number; limit?: number }
  ): Promise<FSReadResponse> {
    return this.request<FSReadResponse>("/api/fs/read", { 
      user, 
      path, 
      offset: options?.offset ?? 0, 
      limit: options?.limit ?? 50000 
    });
  }

  async search(
    user: UserContext, 
    pattern: SearchPattern, 
    options?: SearchOptions
  ): Promise<FSSearchResponse> {
    return this.request<FSSearchResponse>("/api/fs/search", {
      user,
      query: pattern.query,
      mode: pattern.mode,
      pathPrefix: options?.pathPrefix,
      maxResults: options?.maxResults ?? 10
    });
  }

  async find(user: UserContext, filters: FindFilters): Promise<string[]> {
    return this.request<string[]>("/api/fs/find", {
      user,
      tags: filters.tags,
      type: filters.type,
      source: filters.source,
      pathPrefix: filters.pathPrefix
    });
  }

  async stat(user: UserContext, path: string): Promise<FSStatResponse> {
    return this.request<FSStatResponse>("/api/fs/stat", { user, path });
  }

  /**
   * Rebuild the in-memory path tree.
   */
  async rebuild(): Promise<{ status: string; rebuildDurationMs: number }> {
    const res = await fetch(`${this.baseUrl}/api/fs/rebuild`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Rebuild failed: ${res.statusText}`);
    }
    return (await res.json()) as { status: string; rebuildDurationMs: number };
  }

  // --- ISpecTools Implementation ---

  async listEndpoints(user: UserContext, specPath: string): Promise<EndpointSpec[]> {
    return this.request<EndpointSpec[]>("/api/fs/spec/list", { user, specPath });
  }

  async getEndpoint(
    user: UserContext, 
    specPath: string, 
    method: EndpointSpec["method"], 
    route: string
  ): Promise<EndpointSpec> {
    return this.request<EndpointSpec>("/api/fs/spec/get", { user, specPath, method, route });
  }

  async findSchema(user: UserContext, specPath: string, schemaName: string): Promise<any> {
    return this.request<any>("/api/fs/spec/schema", { user, specPath, schemaName });
  }

  async searchSpec(user: UserContext, specPath: string, query: string): Promise<SpecSearchResponse> {
    return this.request<SpecSearchResponse>("/api/fs/spec/search", { user, specPath, query });
  }

  // --- IPDFTools Implementation ---

  async listSections(user: UserContext, pdfPath: string): Promise<PDFSection[]> {
    return this.request<PDFSection[]>("/api/fs/pdf/list", { user, pdfPath });
  }

  async extractSection(user: UserContext, pdfPath: string, sectionId: string): Promise<string> {
    const res = await this.request<{ content: string }>("/api/fs/pdf/extract-section", { user, pdfPath, sectionId });
    return res.content;
  }

  async extractPages(user: UserContext, pdfPath: string, startPage: number, endPage: number): Promise<string> {
    const res = await this.request<{ content: string }>("/api/fs/pdf/extract-pages", { user, pdfPath, startPage, endPage });
    return res.content;
  }

  async searchPDF(user: UserContext, pdfPath: string, query: string): Promise<SearchSnippet> {
    return this.request<SearchSnippet>("/api/fs/pdf/search", { user, pdfPath, query });
  }
}
