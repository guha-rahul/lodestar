import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconDb} from "@lodestar/beacon-node";
import {EraReader, era} from "@lodestar/era";
import {storeRootIndex} from "@lodestar/beacon-node/db/repositories/stateArchiveIndex.js";
import {BlockArchiveBatchPutBinaryItem} from "@lodestar/beacon-node/db/repositories/blockArchive.js";
import {Logger} from "@lodestar/utils";
import type {EraImportArgs} from "./options.js";

const SLOTS_PER_HISTORICAL_ROOT = 8192;
const BATCH_SIZE = 256;

export function getEraFilePaths(args: EraImportArgs): string[] {
  if (args.eraFile) {
    if (!fs.existsSync(args.eraFile)) {
      throw new Error(`ERA file not found: ${args.eraFile}`);
    }
    return [args.eraFile];
  }

  if (args.eraDir) {
    if (!fs.existsSync(args.eraDir)) {
      throw new Error(`Directory not found: ${args.eraDir}`);
    }

    const files = fs
      .readdirSync(args.eraDir)
      .filter((f) => f.endsWith(".era"))
      .map((f) => path.join(args.eraDir!, f))
      .sort();

    return files;
  }

  return [];
}

export async function processEraFile(
  eraPath: string,
  config: ChainForkConfig,
  db: BeaconDb | null,
  validateOnly: boolean
): Promise<void> {
  const reader = await EraReader.open(config, eraPath);

  try {
    // FULL VALIDATION - validates format, roots, signatures
    console.log(`  Validating...`);
    const startTime = Date.now();
    await reader.validate();
    const validationTime = Date.now() - startTime;
    console.log(`  ✓ Validation passed (${validationTime}ms)`);

    if (validateOnly || !db) {
      return;
    }

    // Import each group (era) in the file
    for (let groupIndex = 0; groupIndex < reader.groups.length; groupIndex++) {
      const eraNumber = reader.eraNumber + groupIndex;
      const group = reader.groups[groupIndex];

      console.log(`  Importing era ${eraNumber}...`);

      // Import blocks (if not genesis era)
      if (group.blocksIndex) {
        await importBlocks(reader, group, db, config);
      }

      // Import state
      await importState(reader, eraNumber, db, config);
    }

    console.log(`  ✓ Imported era ${reader.eraNumber}`);
  } finally {
    await reader.close();
  }
}

async function importBlocks(
  reader: EraReader,
  group: era.EraIndices,
  db: BeaconDb,
  config: ChainForkConfig
): Promise<void> {
  const blocksIndex = group.blocksIndex!;
  const items: BlockArchiveBatchPutBinaryItem[] = [];
  let nonEmptyCount = 0;

  for (let slot = blocksIndex.startSlot; slot < blocksIndex.startSlot + blocksIndex.offsets.length; slot++) {
    const serializedBlock = await reader.readSerializedBlock(slot);

    if (serializedBlock === null) {
      // Skip slot - don't write anything
      continue;
    }

    nonEmptyCount++;

    // Deserialize to compute block root
    const block = config.getForkTypes(slot).SignedBeaconBlock.deserialize(serializedBlock);
    const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);

    // Extract parent root from SSZ bytes (offset 116)
    const parentRoot = serializedBlock.slice(116, 148);

    items.push({
      key: slot,
      value: serializedBlock,
      slot: slot,
      blockRoot: blockRoot,
      parentRoot: parentRoot,
    });
  }

  // Write in batches of 256
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await db.blockArchive.batchPutBinary(batch); // SILENT OVERWRITE
  }

  const skipSlots = blocksIndex.offsets.length - nonEmptyCount;
  console.log(`    ✓ Blocks: ${nonEmptyCount} imported, ${skipSlots} skip slots`);
}

async function importState(
  reader: EraReader,
  eraNumber: number,
  db: BeaconDb,
  config: ChainForkConfig
): Promise<void> {
  const state = await reader.readState(eraNumber);
  const slot = state.slot;

  // Serialize to bytes
  const stateBytes = state.serialize();

  // Write to state archive
  await db.stateArchive.putBinary(slot, stateBytes); // SILENT OVERWRITE

  // Manually update state root index (putBinary doesn't do this automatically)
  const stateRoot = state.hashTreeRoot();
  await storeRootIndex(db["db"], slot, stateRoot);

  console.log(`    ✓ State: slot ${slot}`);
}

export async function autoImportEraFiles(
  db: BeaconDb,
  config: ChainForkConfig,
  importDir: string,
  logger: Logger,
  opts: {deleteAfterImport: boolean; skipExisting: boolean}
): Promise<void> {
  // Check if directory exists
  if (!fs.existsSync(importDir)) {
    logger.info("ERA auto-import directory not found, skipping", {importDir});
    return;
  }

  // Find all .era files
  const eraFiles = fs
    .readdirSync(importDir)
    .filter((f) => f.endsWith(".era"))
    .map((f) => path.join(importDir, f))
    .sort();

  if (eraFiles.length === 0) {
    logger.info("No ERA files found for auto-import");
    return;
  }

  logger.info(`Found ${eraFiles.length} ERA files for auto-import`);

  // Import each file
  for (const eraFile of eraFiles) {
    const filename = path.basename(eraFile);

    try {
      // Check if already imported (if skipExisting)
      if (opts.skipExisting) {
        const shouldSkip = await shouldSkipEraFile(eraFile, db);
        if (shouldSkip) {
          logger.info(`Skipping ${filename} - already imported`);
          continue;
        }
      }

      logger.info(`Auto-importing ${filename}...`);

      await processEraFile(eraFile, config, db, false);

      logger.info(`✓ Imported ${filename}`);

      // Delete if configured
      if (opts.deleteAfterImport) {
        fs.unlinkSync(eraFile);
        logger.info(`  Deleted ${filename}`);
      }
    } catch (error) {
      logger.error(`Failed to import ${filename}`, {}, error as Error);
      // Continue with next file (don't stop startup)
    }
  }

  logger.info("ERA auto-import completed");
}

async function shouldSkipEraFile(eraPath: string, db: BeaconDb): Promise<boolean> {
  const filename = path.basename(eraPath);

  // Parse era number from filename (e.g., "mainnet-01506-4781865b.era" -> 1506)
  const match = filename.match(/-(\d+)-/);
  if (!match) return false;

  const eraNumber = parseInt(match[1], 10);
  const startSlot = eraNumber * SLOTS_PER_HISTORICAL_ROOT;
  const endSlot = (eraNumber + 1) * SLOTS_PER_HISTORICAL_ROOT;

  // Check if we have any blocks from this era
  const firstBlock = await db.blockArchive.firstEntry({
    gte: startSlot,
    lt: endSlot,
  });

  return firstBlock !== null; // Skip if era already imported
}
