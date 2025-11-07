import {defaultEraOptions, EraOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

export type EraArgs = {
  "era.autoImportOnStartup"?: boolean;
  "era.autoImportDir"?: string;
  "era.deleteAfterImport"?: boolean;
  "era.skipExisting"?: boolean;
};

export function parseArgs(args: EraArgs): EraOptions {
  return {
    autoImportOnStartup: args["era.autoImportOnStartup"] ?? defaultEraOptions.autoImportOnStartup,
    autoImportDir: args["era.autoImportDir"] ?? defaultEraOptions.autoImportDir,
    deleteAfterImport: args["era.deleteAfterImport"] ?? defaultEraOptions.deleteAfterImport,
    skipExisting: args["era.skipExisting"] ?? defaultEraOptions.skipExisting,
  };
}

export const options: CliCommandOptions<EraArgs> = {
  "era.autoImportOnStartup": {
    type: "boolean",
    description: "Enable automatic ERA file import on beacon node startup",
    default: defaultEraOptions.autoImportOnStartup,
    group: "era",
  },

  "era.autoImportDir": {
    type: "string",
    description: "Directory to watch for ERA files to auto-import on startup (e.g., ./era-files)",
    default: defaultEraOptions.autoImportDir,
    group: "era",
  },

  "era.deleteAfterImport": {
    type: "boolean",
    description: "Delete ERA files after successful import during auto-import",
    default: defaultEraOptions.deleteAfterImport,
    group: "era",
  },

  "era.skipExisting": {
    type: "boolean",
    description: "Skip importing ERA files if data already exists in database",
    default: defaultEraOptions.skipExisting,
    group: "era",
  },
};
