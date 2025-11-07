import {CliCommandOptions} from "@lodestar/utils";

export type EraImportArgs = {
  eraFile?: string;
  eraDir?: string;
  validateOnly?: boolean;
};

export const eraImportOptions: CliCommandOptions<EraImportArgs> = {
  eraFile: {
    description: "Path to a single ERA file to import",
    type: "string",
    conflicts: "eraDir",
    group: "era",
  },

  eraDir: {
    description: "Path to directory containing ERA files (.era) to import",
    type: "string",
    conflicts: "eraFile",
    group: "era",
  },

  validateOnly: {
    description: "Only validate ERA files without importing to database",
    type: "boolean",
    default: false,
    group: "era",
  },
};
