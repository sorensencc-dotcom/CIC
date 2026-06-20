import {
  ITorqueQueryFS,
  ISpecTools,
  IPDFTools,
  UserContext,
  FSSearchResponse,
  FSListResponse,
  FSReadResponse
} from "../torquequery-sdk/fs";

export interface TraversalResult {
  answer: string;
  sources: string[];
  strategy: string;
}

export class FSTraversalPolicy {
  constructor(
    private fs: ITorqueQueryFS,
    private spec: ISpecTools,
    private pdf: IPDFTools
  ) {}

  async answer(user: UserContext, query: string): Promise<TraversalResult> {
    const pathPrefix = this.inferPathPrefix(query);

    // 1. Exact search
    const keyTerm = this.extractKeyTerm(query);
    const exact = await this.fs.search(
      user,
      { query: keyTerm, mode: "exact" },
      { pathPrefix }
    );
    if (this.hasStrongMatches(exact)) {
      return this.synthesizeFromMatches(user, exact, "exact-search");
    }

    // 2. Semantic search
    const semantic = await this.fs.search(
      user,
      { query, mode: "semantic" },
      { pathPrefix }
    );
    if (this.hasStrongMatches(semantic)) {
      return this.synthesizeFromMatches(user, semantic, "semantic-search");
    }

    // 3. Spec branch
    if (this.looksLikeApiQuestion(query)) {
      const specPath = this.inferSpecPath(pathPrefix);
      const endpoints = await this.spec.listEndpoints(user, specPath);
      const endpoint = this.pickEndpoint(endpoints, query);
      if (endpoint) {
        return {
          answer: JSON.stringify(endpoint, null, 2),
          sources: [specPath],
          strategy: "spec-tools"
        };
      }
    }

    // 4. PDF branch
    if (this.looksLikePdfQuestion(query)) {
      const pdfPath = this.inferPdfPath(pathPrefix);
      const sections = await this.pdf.listSections(user, pdfPath);
      const section = this.pickSection(sections, query);
      if (section) {
        const text = await this.pdf.extractSection(user, pdfPath, section.id);
        return {
          answer: text,
          sources: [pdfPath],
          strategy: "pdf-tools"
        };
      }
    }

    // 5. Directory exploration
    const listing = await this.fs.list(user, pathPrefix);
    const candidates = this.pickLikelyPaths(listing, query);
    if (candidates.length) {
      const texts: string[] = [];
      for (const c of candidates) {
        const page = await this.fs.read(user, c.fullPath, { offset: 0, limit: 20000 });
        texts.push(page.content);
      }
      return {
        answer: texts.join("\n\n"),
        sources: candidates.map(c => c.fullPath),
        strategy: "directory-exploration"
      };
    }

    // 6. Failure
    return {
      answer: `I couldn't find relevant content under ${pathPrefix}. Try searching another directory.`,
      sources: [],
      strategy: "failure"
    };
  }

  // -------------------------
  // Inference helpers
  // -------------------------

  inferPathPrefix(query: string): string {
    const q = query.toLowerCase();
    if (q.includes("auth")) return "docs/auth";
    if (q.includes("billing")) return "docs/billing";
    if (q.includes("api") || q.includes("endpoint")) return "api-specs";
    if (q.includes("pdf") || q.includes("guide")) return "docs/pdfs";
    return "docs";
  }

  extractKeyTerm(query: string): string {
    const tokens = query.split(/\s+/);
    return tokens.length > 1 ? tokens[tokens.length - 1] : query;
  }

  hasStrongMatches(resp: FSSearchResponse): boolean {
    return resp.matches && resp.matches.length > 0;
  }

  looksLikeApiQuestion(query: string): boolean {
    const q = query.toLowerCase();
    return (
      q.includes("endpoint") ||
      q.includes("route") ||
      q.includes("schema") ||
      q.includes("openapi") ||
      q.includes("swagger")
    );
  }

  looksLikePdfQuestion(query: string): boolean {
    const q = query.toLowerCase();
    return q.includes("pdf") || q.includes("manual") || q.includes("guide");
  }

  inferSpecPath(prefix: string): string {
    return prefix.startsWith("api-specs") ? prefix : "api-specs/v2.json";
  }

  inferPdfPath(prefix: string): string {
    return prefix.startsWith("docs/pdfs") ? prefix : "docs/pdfs/guide.pdf";
  }

  pickEndpoint(endpoints: any[], query: string): any | null {
    const q = query.toLowerCase();
    return endpoints.find(e =>
      e.route.toLowerCase().includes(q) ||
      e.method.toLowerCase().includes(q)
    ) || null;
  }

  pickSection(sections: any[], query: string): any | null {
    const q = query.toLowerCase();
    return sections.find(s => s.title.toLowerCase().includes(q)) || null;
  }

  pickLikelyPaths(listing: FSListResponse, query: string) {
    const q = query.toLowerCase();
    return listing.entries.filter(e => e.name.toLowerCase().includes(q));
  }

  async synthesizeFromMatches(
    user: UserContext,
    resp: FSSearchResponse,
    strategy: string
  ): Promise<TraversalResult> {
    const top = resp.matches.slice(0, 3);
    const texts: string[] = [];

    for (const m of top) {
      const page = await this.fs.read(user, m.path, { offset: 0, limit: 20000 });
      texts.push(page.content);
    }

    return {
      answer: texts.join("\n\n"),
      sources: top.map(m => m.path),
      strategy
    };
  }
}
