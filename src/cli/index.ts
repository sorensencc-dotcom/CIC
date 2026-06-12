// CIC CLI Entry Point
// Main command dispatcher for CIC governance + SCP operations

import { Command } from "commander";
import { createManifestCommand } from "./commands/skill-manifest";
// Import DB and services when available
// import { ManifestService } from "../governance/services/manifest-service";

export function createCLI(): Command {
  const cli = new Command()
    .name("cic")
    .description("CIC Governance + SCP CLI")
    .version("1.0.0");

  // TODO: Initialize database connection
  // const db = new Database(process.env.DATABASE_URL);
  // const manifestService = new ManifestService(db);

  // TODO: Register skill-manifest command when DB is ready
  // cli.addCommand(createManifestCommand(manifestService));

  return cli;
}

// For now, export command factory for testing
export { createManifestCommand };
