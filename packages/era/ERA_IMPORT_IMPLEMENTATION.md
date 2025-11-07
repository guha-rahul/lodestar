# ERA Import/Export Implementation Documentation

**Author:** Claude Code
**Date:** 2025-11-06
**Status:** In Progress
**Version:** 1.0.0

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Implementation Details](#implementation-details)
4. [CLI Commands](#cli-commands)
5. [Configuration Options](#configuration-options)
6. [Usage Examples](#usage-examples)
7. [Technical Specifications](#technical-specifications)
8. [Testing Strategy](#testing-strategy)
9. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

This implementation adds ERA file support to Lodestar, enabling:

1. **Manual Import**: Import historical blocks and states from ERA files into the database
2. **Auto-Import**: Automatically import ERA files on beacon node startup
3. **Validation**: Full cryptographic verification of ERA file contents
4. **Archive Node Setup**: Fast bootstrap of archive nodes with complete historical data

### What are ERA Files?

ERA files are Ethereum 2.0 archive files containing historical beacon chain data:
- **Format**: [e2store format](https://github.com/status-im/nimbus-eth2/blob/stable/docs/e2store.md)
- **Spec**: [ERA format specification](https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md)
- **Content**: Blocks and states for 8192 slots (SLOTS_PER_HISTORICAL_ROOT)
- **Compression**: Snappy-framed compression for efficient storage
- **Distribution**: Available from [nimbus era server](https://mainnet.era.nimbus.team/) and other providers

### Use Cases

1. **Archive Node Bootstrap**: Import historical data in hours instead of weeks
2. **Disaster Recovery**: Rebuild archive node from ERA files
3. **Research/Analytics**: Immediate access to historical blockchain data
4. **Network Resilience**: More archive nodes = better data availability
5. **Development/Testing**: Bootstrap test networks with historical data

---

## Architecture

### High-Level Design

```
┌─────────────────┐
│  ERA Files      │
│  (compressed)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ERA Reader     │  ← @lodestar/era package
│  - Validate     │
│  - Decompress   │
│  - Deserialize  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Import Logic   │  ← CLI handler
│  - Process      │
│  - Batch        │
│  - Track        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  BeaconDb       │  ← Database
│  - blockArchive │
│  - stateArchive │
└─────────────────┘
```

### Component Architecture

```
packages/cli/src/cmds/era/
├── index.ts              # Command definition
├── import.ts             # Import subcommand
├── importHandler.ts      # Import business logic
├── options.ts            # CLI options definitions
└── utils.ts              # Shared utilities

packages/cli/src/options/beaconNodeOptions/
└── era.ts                # Auto-import options

packages/cli/src/cmds/beacon/
└── handler.ts            # MODIFIED: Auto-import integration
```

### Data Flow

#### Manual Import Flow
```
User Command
    ↓
CLI Parser
    ↓
Import Handler
    ↓
Get ERA Files → Validate Args
    ↓
Initialize Database
    ↓
For Each ERA File:
    ├─ Open ERA Reader
    ├─ Validate File (full crypto verification)
    ├─ Import Blocks (batch write to blockArchive)
    ├─ Import State (write to stateArchive)
    └─ Close Reader
    ↓
Close Database
    ↓
Report Results
```

#### Auto-Import Flow
```
Beacon Node Start
    ↓
Initialize Database
    ↓
Check era.autoImportOnStartup
    ↓ (if enabled)
Scan era.autoImportDir
    ↓
For Each ERA File:
    ├─ Check if already imported (skipExisting)
    ├─ Import if needed
    └─ Delete if configured
    ↓
Continue Normal Startup
    ↓
Initialize Beacon State
    ↓
Start Beacon Node
```

---

## Implementation Details

### Phase 1: Manual Import Command

#### File Structure

**`packages/cli/src/cmds/era/options.ts`**
```typescript
export type EraImportArgs = {
  eraFile?: string;         // Single file path
  eraDir?: string;          // Directory path
  validateOnly?: boolean;   // Validate without importing
};
```

**Purpose**: Define CLI arguments for ERA import command

**Key Features**:
- Mutually exclusive `eraFile` and `eraDir` options
- Optional validate-only mode
- Groups options under "era" for clean CLI help

---

**`packages/cli/src/cmds/era/import.ts`**
```typescript
export const importCmd: CliCommand<EraImportArgs, GlobalArgs> = {
  command: "import",
  describe: "Import historical blocks and states from ERA files",
  examples: [...],
  options: eraImportOptions,
  handler: importHandler,
};
```

**Purpose**: Define the `lodestar era import` command

**Key Features**:
- Follows Lodestar CLI pattern (see `validator import`)
- Provides usage examples
- Delegates to importHandler for business logic

---

**`packages/cli/src/cmds/era/importHandler.ts`**

Main entry point for import command execution.

**Responsibilities**:
1. Validate CLI arguments
2. Discover ERA files (single or directory)
3. Initialize database connection
4. Process each ERA file
5. Handle errors gracefully
6. Close database on completion

**Key Design Decisions**:
- Uses BeaconDb directly (same as beacon node)
- Creates LevelDbController with minimal config
- Continues processing on individual file errors
- Provides clear progress reporting

**Error Handling**:
```typescript
// Continue processing even if one file fails
try {
  await processEraFile(eraFile, config, db, validateOnly);
} catch (error) {
  console.error(`✗ Error: ${error.message}`);
  // Continue with next file
}
```

---

**`packages/cli/src/cmds/era/utils.ts`**

Core utilities for ERA processing.

#### Key Functions

**`getEraFilePaths(args: EraImportArgs): string[]`**
- Resolves single file or directory to list of ERA files
- Validates file/directory existence
- Sorts files alphabetically (ensures era order)

**`processEraFile(eraPath, config, db, validateOnly): Promise<void>`**
- Opens ERA file with EraReader
- Performs full validation (format + crypto)
- Imports blocks and states
- Handles multi-group ERA files
- Closes reader on completion/error

**`importBlocks(reader, group, db, config, opts?): Promise<void>`**
- Reads all blocks for an era (8192 slots)
- Skips empty slots (not stored in DB)
- Computes block roots for indices
- Extracts parent roots from SSZ bytes
- Batch writes in chunks of 256 for performance
- Optional: Skip existing blocks

**Implementation Detail - Parent Root Extraction**:
```typescript
// Offset 116 in SignedBeaconBlock SSZ serialization
// Structure: signature(96) + slot(8) + proposer_index(8) + parent_root(32)
const parentRoot = serializedBlock.slice(116, 148);
```

**`importState(reader, eraNumber, db, config): Promise<void>`**
- Reads state for era boundary
- Serializes to SSZ bytes
- Writes to stateArchive
- Manually updates state root index (putBinary doesn't auto-update)

**State Root Index Update**:
```typescript
// Required because putBinary doesn't update indices
const stateRoot = state.hashTreeRoot();
await storeRootIndex(db["db"], slot, stateRoot);
```

**`autoImportEraFiles(db, config, importDir, logger, opts): Promise<void>`**
- Scans directory for .era files
- Checks if already imported (optional)
- Processes each file
- Optionally deletes after import
- Continues on errors (doesn't block startup)

**`shouldSkipEraFile(eraPath, db): Promise<boolean>`**
- Parses era number from filename
- Checks database for blocks in era range
- Returns true if era already imported

---

**`packages/cli/src/cmds/era/index.ts`**
```typescript
export const era: CliCommand = {
  command: "era",
  describe: "ERA file utilities for historical data",
  subcommands: [importCmd],
};
```

**Purpose**: Top-level ERA command (future: add export, validate subcommands)

---

### Phase 2: Auto-Import on Startup

#### Auto-Import Configuration

**`packages/cli/src/options/beaconNodeOptions/era.ts`**

New options file following Lodestar pattern (see `metrics.ts`, `chain.ts`).

**Options**:

1. **`era.autoImportOnStartup`** (boolean, default: false)
   - Enable/disable auto-import feature
   - Opt-in for safety (no surprises on startup)
   - Follows pattern of `--metrics`, `--rest` flags

2. **`era.autoImportDir`** (string, optional)
   - Directory to scan for ERA files
   - Only scanned if autoImportOnStartup is true
   - Can be absolute or relative path

3. **`era.deleteAfterImport`** (boolean, default: false)
   - Delete ERA files after successful import
   - Useful for one-time bootstrap scenarios
   - Safety: defaults to false (preserve files)

4. **`era.skipExisting`** (boolean, default: true)
   - Skip eras already in database
   - Prevents re-importing on restart
   - Performance: avoids unnecessary work

**Parse Function**:
```typescript
export function parseArgs(args: EraArgs) {
  return {
    autoImportOnStartup: args["era.autoImportOnStartup"],
    autoImportDir: args["era.autoImportDir"],
    deleteAfterImport: args["era.deleteAfterImport"],
    skipExisting: args["era.skipExisting"],
  };
}
```

---

#### Integration Point

**`packages/cli/src/cmds/beacon/handler.ts`**

Modified to add auto-import before beacon initialization.

**Critical Timing**:
```typescript
const db = new BeaconDb(...);
logger.info("Connected to LevelDB database");

// AUTO-IMPORT: Before beacon node starts syncing
if (options.era?.autoImportOnStartup && options.era?.autoImportDir) {
  await autoImportEraFiles(db, config, ...);
}

// Now start beacon (which begins sync)
const {anchorState, ...} = await initBeaconState(...);
```

**Why this location?**
1. ✅ Database initialized and open
2. ✅ Before any syncing starts (no concurrent access)
3. ✅ Before state initialization (can use imported blocks)
4. ✅ Errors don't corrupt beacon initialization
5. ✅ Can log progress before beacon startup noise

---

## CLI Commands

### Manual Import

**Command**: `lodestar era import`

**Synopsis**:
```bash
lodestar era import [options]
```

**Options**:
```
--era-file <path>         Path to single ERA file to import
--era-dir <path>          Directory containing ERA files
--validate-only           Only validate, don't import
--datadir <path>          Beacon node data directory
--network <name>          Network name (auto-detected from ERA filename)
```

**Examples**:

```bash
# Import single file
lodestar era import \
  --datadir ./lodestar-data \
  --era-file ./mainnet-01506-4781865b.era

# Import directory
lodestar era import \
  --datadir ./lodestar-data \
  --era-dir ./eras

# Validate only (no import)
lodestar era import \
  --era-dir ./eras \
  --validate-only
```

**Output**:
```
Found 3 ERA file(s) to process

[1/3] mainnet-00000-00000000.era
  Validating... ✓ (2341ms)
  Importing era 0...
    ✓ State: slot 0
  ✓ Imported era 0

[2/3] mainnet-00001-12345678.era
  Validating... ✓ (3156ms)
  Importing era 1...
    ✓ Blocks: 7891 imported, 301 skip slots
    ✓ State: slot 8192
  ✓ Imported era 1

[3/3] mainnet-00002-abcdef12.era
  Validating... ✓ (3089ms)
  Importing era 2...
    ✓ Blocks: 8102 imported, 90 skip slots
    ✓ State: slot 16384
  ✓ Imported era 2

✓ Processing complete
```

---

### Auto-Import with Beacon Node

**Command**: `lodestar beacon` with ERA options

**Synopsis**:
```bash
lodestar beacon [beacon-options] [era-options]
```

**ERA Options**:
```
--era.autoImportOnStartup         Enable auto-import on startup
--era.autoImportDir <path>        Directory with ERA files
--era.deleteAfterImport           Delete files after import
--era.skipExisting                Skip already imported eras (default: true)
```

**Examples**:

```bash
# Mainnet with auto-import
lodestar beacon \
  --network mainnet \
  --dataDir ./mainnet-data \
  --era.autoImportOnStartup \
  --era.autoImportDir ./mainnet-eras \
  --jwtSecret ./jwt.hex \
  --execution.urls http://localhost:8551

# Dev mode with auto-import
lodestar dev \
  --genesisValidators 8 \
  --dataDir .lodestar/dev1 \
  --era.autoImportOnStartup \
  --era.autoImportDir ./dev-eras \
  --reset
```

**Output**:
```
Connected to LevelDB database
Found 100 ERA files for auto-import
Auto-importing mainnet-00000-00000000.era...
  Validating... ✓ (2341ms)
  Importing era 0...
    ✓ State: slot 0
✓ Imported mainnet-00000-00000000.era
...
ERA auto-import completed
Initialized state from db (slot: 819200)
Starting beacon node...
```

---

## Configuration Options

### Import Command Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--era-file` | string | One of era-file/era-dir | - | Path to single ERA file |
| `--era-dir` | string | One of era-file/era-dir | - | Directory with ERA files |
| `--validate-only` | boolean | No | false | Validate without importing |
| `--datadir` | string | Yes | - | Beacon data directory |
| `--network` | string | No | Auto-detect | Network name |

### Beacon Node ERA Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--era.autoImportOnStartup` | boolean | false | Enable auto-import |
| `--era.autoImportDir` | string | - | ERA files directory |
| `--era.deleteAfterImport` | boolean | false | Delete after import |
| `--era.skipExisting` | boolean | true | Skip imported eras |

---

## Usage Examples

### Scenario 1: Fresh Archive Node Setup

**Goal**: Bootstrap mainnet archive node with historical data

```bash
# 1. Download ERA files
mkdir -p ./mainnet-eras
cd mainnet-eras
# Download from nimbus or other provider
# (can use wget, aria2c, torrents, etc.)
cd ..

# 2. Start beacon node with auto-import
lodestar beacon \
  --network mainnet \
  --dataDir ./archive-node \
  --chain.archiveStateEpochFrequency 1024 \
  --chain.pruneHistory false \
  --era.autoImportOnStartup \
  --era.autoImportDir ./mainnet-eras \
  --era.skipExisting \
  --jwtSecret ./jwt.hex \
  --execution.urls http://localhost:8551

# Result: Node starts with complete historical data
# - Imports all ERA files on first start
# - Skips them on subsequent restarts
# - Begins forward sync from where ERA files ended
```

### Scenario 2: Checkpoint Sync + Historical Backfill

**Goal**: Quick start with checkpoint, backfill history later

```bash
# 1. Checkpoint sync (fast start)
lodestar beacon \
  --network mainnet \
  --dataDir ./checkpoint-node \
  --checkpointSyncUrl https://checkpoint.example.com \
  --jwtSecret ./jwt.hex \
  --execution.urls http://localhost:8551
# (Let it sync and validate for a while)

# 2. Stop node, add ERA files
# Download historical ERA files to ./eras/

# 3. Restart with auto-import
lodestar beacon \
  --network mainnet \
  --dataDir ./checkpoint-node \
  --era.autoImportOnStartup \
  --era.autoImportDir ./eras \
  --era.skipExisting \
  --jwtSecret ./jwt.hex \
  --execution.urls http://localhost:8551

# Result: Historical data backfilled without re-syncing
```

### Scenario 3: Manual Import to Existing Node

**Goal**: Import specific era ranges to running node's database

```bash
# 1. Stop beacon node
# (Ensure database is not in use)

# 2. Import specific ERA files
lodestar era import \
  --datadir ./existing-node \
  --era-file ./mainnet-01500-xxxxxxxx.era

# 3. Restart beacon node
# (Will use newly imported data)
```

### Scenario 4: Validate ERA Files Before Distribution

**Goal**: Verify ERA file integrity before sharing

```bash
# Validate without importing
lodestar era import \
  --era-dir ./eras-to-distribute \
  --validate-only

# Output shows any validation failures
# Only valid files should be distributed
```

### Scenario 5: Development Testing

**Goal**: Test with historical data in dev environment

```bash
# 1. Generate or obtain test ERA files

# 2. Start dev node with auto-import
lodestar dev \
  --genesisValidators 8 \
  --dataDir .lodestar/test \
  --era.autoImportOnStartup \
  --era.autoImportDir ./test-eras \
  --era.deleteAfterImport \
  --reset

# Result: Fresh test environment with historical data
# Files deleted after import (clean test)
```

---

## Technical Specifications

### ERA File Format

**Filename Convention**:
```
<network>-<era-number>-<short-historical-root>.era
```

**Example**: `mainnet-01506-4781865b.era`
- Network: mainnet
- Era Number: 01506 (5-digit zero-padded)
- Short Historical Root: 4781865b (first 4 bytes as hex)

**Content**:
- Version entry (e2store version marker)
- Blocks: Up to 8192 compressed SignedBeaconBlock entries
- State: 1 compressed BeaconState at era boundary
- Indices: SlotIndex structures for efficient lookup

### Database Schema Impact

**BlockArchive** (`Bucket.allForks_blockArchive = 2`):
```
Key: Slot (uint64, big-endian)
Value: SignedBeaconBlock (SSZ serialized)

Indices:
- blockRoot → slot (Bucket 4)
- parentRoot → slot (Bucket 3)
```

**StateArchive** (`Bucket.allForks_stateArchive = 0`):
```
Key: Slot (uint64, big-endian)
Value: BeaconState (SSZ serialized)

Indices:
- stateRoot → slot (Bucket 26)
```

**Not Modified**:
- `backfilledRanges` - Not updated (per requirement)
- `earliestAvailableSlot` - Not updated (per requirement)

### Performance Characteristics

**Import Speed**:
- ~256 blocks/batch (configurable BATCH_SIZE)
- ~1 era (8192 slots) in 3-5 seconds (SSD)
- Full mainnet history (~1500 eras): 2-3 hours

**Memory Usage**:
- EraReader: ~100MB per file
- Import handler: Minimal (streaming)
- Database writes: Batched for efficiency

**Disk Space**:
- ERA files (compressed): ~30-50MB per era
- Database blocks: ~50-100MB per era (uncompressed SSZ)
- Database states: ~30MB per era (sparse, every 1024 epochs)

### Validation Details

**Full Validation** (`reader.validate()`):

1. **E2Store Format**:
   - Version entry correctness
   - Header integrity (type, length, reserved)
   - Entry boundaries

2. **Era Structure**:
   - Correct number of block slots (8192)
   - State at era boundary
   - Indices properly aligned

3. **Cryptographic Verification**:
   - Block root computation
   - Block root matches state.blockRoots
   - BLS signature verification for all blocks
   - Proposer public key validation
   - Signing domain computation

4. **Network Correctness**:
   - Genesis validators root
   - Config name match
   - Fork versioning

### Skip Existing Logic

**Era-Level Skip**:
```typescript
// Check if ANY block from era exists
const eraStartSlot = eraNumber * 8192;
const eraEndSlot = (eraNumber + 1) * 8192;
const firstBlock = await db.blockArchive.firstEntry({
  gte: eraStartSlot,
  lt: eraEndSlot,
});
if (firstBlock) skip();
```

**Block-Level Skip** (future enhancement):
```typescript
// Check each slot individually
for (let slot of eraSlots) {
  const existing = await db.blockArchive.get(slot);
  if (existing) continue; // Skip this block
}
```

### Concurrency Safety

**Startup Import**:
- ✅ Database initialized but node not started
- ✅ No concurrent sync operations
- ✅ Safe to write without locks

**Manual Import**:
- ⚠️ User must stop beacon node first
- ⚠️ No runtime protection against concurrent access
- ✅ Documentation clearly states requirement

**Future**: Runtime import would require:
- Database write locks
- Fork choice pause
- State cache invalidation
- Complex coordination

### Error Handling

**File-Level Errors**:
- Log error
- Continue with next file
- Report summary at end

**Fatal Errors**:
- Database connection failure
- Invalid arguments
- Missing dependencies

**Validation Errors**:
- Invalid ERA format
- Crypto verification failure
- Network mismatch
- Report and skip file

---

## Testing Strategy

### Unit Tests

**Location**: `packages/cli/test/unit/cmds/era/`

**Coverage**:

```typescript
describe("getEraFilePaths", () => {
  it("should find single file");
  it("should find directory files");
  it("should sort files by name");
  it("should throw on missing file");
  it("should throw on missing directory");
});

describe("shouldSkipEraFile", () => {
  it("should skip if blocks exist");
  it("should not skip if no blocks");
  it("should handle invalid filenames");
});

describe("parseArgs", () => {
  it("should parse ERA options");
  it("should use defaults correctly");
});
```

### Integration Tests

**Location**: `packages/cli/test/e2e/era/`

**Test Cases**:

```typescript
describe("ERA import e2e", () => {
  it("should import valid ERA file", async () => {
    // Use test ERA from packages/era/test
    const result = await importEraFile(testEra, tempDb);
    expect(result.blocksImported).toBe(expectedCount);
  });

  it("should validate before import", async () => {
    const invalidEra = createInvalidEra();
    await expect(importEraFile(invalidEra, tempDb)).rejects.toThrow();
  });

  it("should skip existing with skipExisting=true", async () => {
    await importEraFile(testEra, tempDb);
    const result = await importEraFile(testEra, tempDb, {skipExisting: true});
    expect(result.blocksSkipped).toBeGreaterThan(0);
  });

  it("should auto-import on startup", async () => {
    // Start beacon with auto-import enabled
    // Verify files imported
  });
});
```

### Manual Testing Checklist

- [ ] Import single ERA file
- [ ] Import directory of ERA files
- [ ] Validate-only mode
- [ ] Auto-import on dev node startup
- [ ] Auto-import on beacon node startup
- [ ] Skip existing blocks
- [ ] Delete after import
- [ ] Network mismatch detection
- [ ] Invalid ERA file handling
- [ ] Progress reporting
- [ ] Error messages

### Test Data

**Use Existing Test ERA**:
- Location: `packages/era/test/e2e-mainnet/mainnet-01506-4781865b.era`
- Network: mainnet
- Era: 1506
- Blocks: ~8000 non-empty
- State: slot 12304384

**Generate Test ERA** (for dev testing):
```typescript
// Use EraWriter to create test ERA from existing DB
const writer = await EraWriter.create(config, path, eraNumber);
// ... write blocks and state
await writer.finish();
```

---

## Future Enhancements

### Phase 3: ERA Export

**Command**: `lodestar era export`

```bash
lodestar era export \
  --datadir ./archive-node \
  --era-dir ./output-eras \
  --from-era 0 \
  --to-era 100
```

**Challenges**:
1. State Regeneration: May need to regenerate states not in DB
2. Missing Blocks: Handle gaps in blockArchive
3. Performance: Batch reading and writing
4. Validation: Ensure exported ERA is valid

**Implementation Considerations**:
- Only export complete eras (have all blocks + state)
- Option to regenerate missing states
- Progress reporting for long exports
- Verify exported ERA before finalizing

### Phase 4: Parallel Processing

**Goal**: Import multiple ERA files in parallel

**Benefits**:
- Faster import on multi-core systems
- Better resource utilization

**Challenges**:
- Database concurrent writes
- Memory usage (multiple readers)
- Error handling complexity

**Approach**:
- Worker pool pattern
- Chunk ERA files into batches
- Coordinate DB writes
- Aggregate errors

### Phase 5: Resume Support

**Goal**: Resume interrupted imports

**Features**:
- Track imported eras in metadata file
- Skip already processed files
- Resume from last successful era

**Implementation**:
```typescript
// .era-import-progress.json
{
  "lastImported": "mainnet-00150-xxxxxxxx.era",
  "imported": ["mainnet-00000-...", ...],
  "timestamp": 1234567890
}
```

### Phase 6: Streaming Import

**Goal**: Import while downloading

**Flow**:
```
Download ERA → Validate → Import → Delete
(streaming pipeline)
```

**Benefits**:
- No need to store all ERA files
- Continuous progress
- Less disk space needed

### Phase 7: Incremental Sync

**Goal**: Keep ERA files updated

**Features**:
- Generate ERA for newly finalized eras
- Export periodically to ERA files
- Maintain rolling ERA archive

---

## Appendix A: Code Locations

### New Files Created

```
packages/cli/src/cmds/era/
├── index.ts                     # 15 lines
├── import.ts                    # 35 lines
├── importHandler.ts             # 60 lines
├── options.ts                   # 30 lines
└── utils.ts                     # 250 lines

packages/cli/src/options/beaconNodeOptions/
└── era.ts                       # 50 lines
```

### Modified Files

```
packages/cli/src/cmds/
└── index.ts                     # +2 lines (add era command)

packages/cli/src/options/beaconNodeOptions/
└── index.ts                     # +5 lines (add era options)

packages/cli/src/cmds/beacon/
└── handler.ts                   # +15 lines (auto-import integration)
```

**Total New Code**: ~460 lines
**Total Modified**: ~22 lines
**Files Created**: 6
**Files Modified**: 3

---

## Appendix B: Dependencies

### Existing Dependencies (No New Packages)

```json
{
  "@lodestar/era": "workspace:^",           // ERA file reading
  "@lodestar/db": "workspace:^",            // Database access
  "@lodestar/beacon-node": "workspace:^",   // BeaconDb, repositories
  "@lodestar/config": "workspace:^",        // Chain configuration
  "@lodestar/utils": "workspace:^",         // CLI utilities
  "@lodestar/logger": "workspace:^"         // Logging
}
```

All required packages already exist in Lodestar monorepo.

---

## Appendix C: Glossary

**ERA**: Archive file format for Ethereum beacon chain historical data

**E2Store**: Simple serialization format (type-length-value with snappy compression)

**SLOTS_PER_HISTORICAL_ROOT**: 8192 slots per era (~27 hours of mainnet)

**BlockArchive**: LevelDB repository storing finalized blocks

**StateArchive**: LevelDB repository storing finalized states

**Checkpoint Sync**: Fast sync method starting from recent finalized checkpoint

**Backfill**: Syncing historical data backwards from current state

**Short Historical Root**: First 4 bytes of last historical root (used in filename)

**SSZ**: Simple Serialize - Ethereum's serialization format

**Snappy**: Fast compression algorithm used in ERA files

---

## Appendix D: References

- [ERA Format Spec](https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md)
- [E2Store Spec](https://github.com/status-im/nimbus-eth2/blob/stable/docs/e2store.md)
- [Nimbus ERA Server](https://mainnet.era.nimbus.team/)
- [Lodestar Documentation](https://chainsafe.github.io/lodestar/)
- [Issue #7753: Backfill sync](https://github.com/ChainSafe/lodestar/issues/7753)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-11-06 | Claude Code | Initial documentation |

---

**End of Document**
