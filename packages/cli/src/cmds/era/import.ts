import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {EraImportArgs, eraImportOptions} from "./options.js";
import {importHandler} from "./importHandler.js";

export const importCmd: CliCommand<EraImportArgs, GlobalArgs> = {
  command: "import",

  describe: "Import historical blocks and states from ERA files into the beacon database",

  examples: [
    {
      command: "era import --datadir ./lodestar-data --era-file ./mainnet-01506-4781865b.era",
      description: "Import a single ERA file",
    },
    {
      command: "era import --datadir ./lodestar-data --era-dir ./eras",
      description: "Import all ERA files from a directory",
    },
    {
      command: "era import --datadir ./lodestar-data --era-dir ./eras --validate-only",
      description: "Validate ERA files without importing",
    },
  ],

  options: eraImportOptions,

  handler: importHandler,
};
