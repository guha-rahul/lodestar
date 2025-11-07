import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {importCmd} from "./import.js";

export const era: CliCommand<Record<never, never>, GlobalArgs> = {
  command: "era",
  describe: "ERA file utilities for historical data",
  subcommands: [importCmd],
};
