import { createHash } from "crypto";
import { GovernanceVaultRecord24_5Schema } from "./schema";

export interface VaultWriteOptions {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
}

function canonicalize(value: unknown): string {
  const sortObject = (obj: any): any => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sortObject);

    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObject(obj[key]);
    }
    return sorted;
  };

  return JSON.stringify(sortObject(value));
}

export function computeVaultRecordDigest(
  record: unknown,
  algorithm: "sha256" | "sha512" = "sha256"
): string {
  const canonical = canonicalize(record);
  const hash = createHash(algorithm);
  hash.update(canonical, "utf8");
  return `${algorithm}:${hash.digest("hex")}`;
}

export async function writeGovernanceVaultRecord(
  record: unknown,
  options: VaultWriteOptions
): Promise<{ id: string; digest: string }> {
  const parsed = GovernanceVaultRecord24_5Schema.parse(record);
  const digest = computeVaultRecordDigest(parsed, "sha256");

  const payload = {
    ...parsed,
    vault_digest: digest,
  };

  const body = canonicalize(payload);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000
  );

  try {
    const res = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${options.apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Vault write failed: ${res.status} ${res.statusText} ${text}`
      );
    }

    const json = (await res.json()) as { id: string };
    return { id: json.id, digest };
  } finally {
    clearTimeout(timeout);
  }
}
