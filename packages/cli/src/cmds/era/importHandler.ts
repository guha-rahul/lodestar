import path from "node:path";
import {BeaconDb} from "@lodestar/beacon-node";
import {LevelDbController} from "@lodestar/db";
import {getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {YargsError} from "../../util/index.js";
import {processEraFile, getEraFilePaths} from "./utils.js";
import type {EraImportArgs} from "./options.js";
import type {GlobalArgs} from "../../options/index.js";

export async function importHandler(args: EraImportArgs & GlobalArgs): Promise<void> {
  // 1. Validate arguments
  if (!args.eraFile && !args.eraDir) {
    throw new YargsError("Must specify either --era-file or --era-dir");
  }

  // 2. Get list of ERA files to import
  const eraFiles = getEraFilePaths(args);

  if (eraFiles.length === 0) {
    throw new YargsError("No ERA files found");
  }

  console.log(`Found ${eraFiles.length} ERA file(s) to process\n`);

  // 3. Get beacon config
  const {config} = getBeaconConfigFromArgs(args);

  // 4. Initialize database (only if not validate-only mode)
  let db: BeaconDb | null = null;

  if (!args.validateOnly) {
    const logger = getNodeLogger({level: LogLevel.info, module: "era-import"});
    const beaconPaths = getBeaconPaths(args, config.CONFIG_NAME);
    const dbController = await LevelDbController.create({name: beaconPaths.dbDir}, {logger, metrics: null});
    db = new BeaconDb(config, dbController);
  }

  try {
    // 5. Process each ERA file
    for (let i = 0; i < eraFiles.length; i++) {
      const eraFile = eraFiles[i];
      const filename = path.basename(eraFile);

      console.log(`[${i + 1}/${eraFiles.length}] ${filename}`);

      try {
        await processEraFile(eraFile, config, db, args.validateOnly ?? false);
      } catch (error) {
        console.error(`✗ Error: ${(error as Error).message}`);
        // Continue with next file
      }
    }

    console.log(`\n✓ Processing complete`);
  } finally {
    // 6. Close database
    if (db) {
      await db.close();
    }
  }
}
