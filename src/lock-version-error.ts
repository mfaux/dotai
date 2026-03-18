/**
 * Error thrown when a lock file's schema version is newer than the CLI supports.
 *
 * All lock modules (`dotai-lock`, `local-lock`, `skill-lock`) throw this error
 * when they encounter a future version. Callers should catch it and display the
 * user-facing upgrade message via `error.message`.
 */
export class LockVersionError extends Error {
  /** The version found in the lock file. */
  readonly lockVersion: number;
  /** The highest version this CLI supports. */
  readonly supportedVersion: number;
  /** Which lock file triggered the error (e.g., ".dotai-lock.json"). */
  readonly lockFile: string;

  constructor(lockVersion: number, supportedVersion: number, lockFile: string) {
    super(
      `Lock file ${lockFile} has version ${lockVersion} which is not supported. ` +
        `This version of dotai supports version ${supportedVersion}. ` +
        `Please upgrade dotai to a newer version.`
    );
    this.name = 'LockVersionError';
    this.lockVersion = lockVersion;
    this.supportedVersion = supportedVersion;
    this.lockFile = lockFile;
  }
}
