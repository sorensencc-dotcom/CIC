export interface DocsRagSource {
  file: string;
  section: string;
  tags: string[];
  score: number;
}

export interface DocsRagAnswer {
  answer: string;
  sources: DocsRagSource[];
  confidence: number;
  not_in_docs: boolean;
}

export class TorqueQueryClient {
  constructor(private baseUrl: string) {}

  async resolveDocs(question: string, taskLabels: string[] = []): Promise<DocsRagAnswer> {
    const res = await fetch(`${this.baseUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, taskLabels }),
    });
    if (!res.ok) throw new Error(`TorqueQuery error: ${res.status}`);
    return (await res.json()) as DocsRagAnswer;
  }
}
