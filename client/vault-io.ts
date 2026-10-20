/** A policy refusal, before any repository read, write, or processing callback. */
export class ReadOnlyVaultError extends Error {
  readonly code = "VAULT_READ_ONLY";
  readonly operation: string;
  readonly path?: string;

  constructor(operation: string, path?: string) {
    super(`This GitHub vault is read-only. Save a local copy to edit its files. (${operation}${path ? ": " + path : ""})`);
    this.name = "ReadOnlyVaultError";
    this.operation = operation;
    this.path = path;
  }
}

export function assertVaultWritable(readOnly: boolean, operation = "write", path?: string): void {
  if (readOnly) { throw new ReadOnlyVaultError(operation, path); }
}
