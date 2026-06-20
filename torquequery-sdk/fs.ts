/**
 * User Context representation for RBAC pruning at the FS layer.
 */
export interface UserContext {
  userId: string;
  groups: string[];      // e.g. ["admin", "billing", "engineering"]
  tenantId: string;
}

/**
 * Metadata associated with a specific path in the Virtual FS.
 */
export interface PathMeta {
  type: "page" | "spec" | "internal" | "asset";
  source: "mintlify" | "s3" | "github" | "confluence";
  isPublic: boolean;
  groups: string[];      // Required user groups if isPublic is false
  tags: string[];
  lazy: boolean;         // True if the resource is resolved on-demand
  sizeHint?: "small" | "medium" | "large";
}

/**
 * Single entry within a directory listing.
 */
export interface DirectoryEntry {
  name: string;
  fullPath: string;
  type: PathMeta["type"];
  lazy: boolean;
}

/**
 * API Requests & Responses
 */

export interface FSListResponse {
  path: string;
  entries: DirectoryEntry[];
}

export interface FSReadResponse {
  path: string;
  type: PathMeta["type"];
  content: string;
  source: PathMeta["source"];
  hasMore: boolean;            // True if offset + limit < totalLength
  totalLength?: number;        // Character length of the full resource
}

export type SearchMode = "exact" | "regex" | "semantic";

export interface SearchPattern {
  query: string;
  mode: SearchMode;
}

export interface SearchOptions {
  pathPrefix?: string;
  maxResults?: number;
}

export interface SearchSnippet {
  path: string;
  snippets: string[];
}

export interface FSSearchResponse {
  pattern: SearchPattern;
  matches: SearchSnippet[];
}

export interface FindFilters {
  tags?: string[];
  type?: PathMeta["type"];
  source?: PathMeta["source"];
  pathPrefix?: string;
}

export interface FSStatResponse {
  path: string;
  meta: PathMeta;
}

/**
 * Core Filesystem Interface
 */
export interface ITorqueQueryFS {
  list(user: UserContext, path: string): Promise<FSListResponse>;

  /**
   * Reconstructs or lazily retrieves the content of a path.
   * Supports paginated reads using character offsets and limits.
   */
  read(
    user: UserContext, 
    path: string, 
    options?: { offset?: number; limit?: number }
  ): Promise<FSReadResponse>;

  search(user: UserContext, pattern: SearchPattern, options?: SearchOptions): Promise<FSSearchResponse>;

  find(user: UserContext, filters: FindFilters): Promise<string[]>;

  stat(user: UserContext, path: string): Promise<FSStatResponse>;
}

/**
 * OpenAPI Spec specific structures
 */
export interface EndpointSpec {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
  route: string;
  summary?: string;
  description?: string;
  parameters?: any[];
  requestBodySchemaName?: string;
  responses: Record<string, any>;
}

export interface SpecSearchResponse {
  endpoints: EndpointSpec[];
  schemas: Record<string, any>;
}

export interface ISpecTools {
  listEndpoints(user: UserContext, specPath: string): Promise<EndpointSpec[]>;
  getEndpoint(
    user: UserContext, 
    specPath: string, 
    method: EndpointSpec["method"], 
    route: string
  ): Promise<EndpointSpec>;
  findSchema(user: UserContext, specPath: string, schemaName: string): Promise<any>;
  searchSpec(user: UserContext, specPath: string, query: string): Promise<SpecSearchResponse>;
}

/**
 * PDF outline structures
 */
export interface PDFSection {
  id: string;
  title: string;
  pageNumber: number;
}

export interface IPDFTools {
  listSections(user: UserContext, pdfPath: string): Promise<PDFSection[]>;
  extractSection(user: UserContext, pdfPath: string, sectionId: string): Promise<string>;
  extractPages(user: UserContext, pdfPath: string, startPage: number, endPage: number): Promise<string>;
  searchPDF(user: UserContext, pdfPath: string, query: string): Promise<SearchSnippet>;
}
