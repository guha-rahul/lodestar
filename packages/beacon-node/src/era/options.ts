export type EraOptions = {
  /** Enable automatic ERA file import on startup */
  autoImportOnStartup: boolean;
  /** Directory to watch for ERA files to auto-import */
  autoImportDir: string;
  /** Delete ERA files after successful import */
  deleteAfterImport: boolean;
  /** Skip importing ERA files if data already exists in database */
  skipExisting: boolean;
};

export const defaultEraOptions: EraOptions = {
  autoImportOnStartup: false,
  autoImportDir: "",
  deleteAfterImport: false,
  skipExisting: true,
};
