// Pure planning of the SQL migration runner (decision 0005, section 7).

/** `NNNN_snake_case_description.sql` */
const FILE_NAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export const NO_TRANSACTION_MARKER = '-- kd:no-transaction';

export interface MigrationFile {
  readonly fileName: string;
  readonly sha256: string;
}

export interface PlannedMigration extends MigrationFile {
  readonly version: number;
  readonly name: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly sha256: string;
}

export interface MigrationPlan {
  /** Files to apply, in version order. Empty when `problems` is not. */
  readonly pending: readonly PlannedMigration[];
  /** Integrity problems, one line each; any problem refuses the run (exit 4). */
  readonly problems: readonly string[];
}

export function isMigrationFileName(fileName: string): boolean {
  return FILE_NAME.test(fileName);
}

function label(migration: { version: number; name: string }): string {
  return `${String(migration.version).padStart(4, '0')}_${migration.name}`;
}

/** Compares the `.sql` files of the folder with `public.schema_migrations`. */
export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const problems: string[] = [];
  const byVersion = new Map<number, PlannedMigration>();

  for (const file of files) {
    const match = FILE_NAME.exec(file.fileName);
    if (match === null) {
      problems.push(`${file.fileName}: invalid name, expected NNNN_snake_case_description.sql`);
      continue;
    }
    const planned: PlannedMigration = {
      ...file,
      version: Number(match[1]),
      name: match[2] as string,
    };
    const existing = byVersion.get(planned.version);
    if (existing !== undefined) {
      problems.push(`${file.fileName}: version already used by ${existing.fileName}`);
      continue;
    }
    byVersion.set(planned.version, planned);
  }

  const appliedVersions = new Set<number>();
  for (const record of applied) {
    appliedVersions.add(record.version);
    const file = byVersion.get(record.version);
    if (file === undefined) {
      problems.push(`${label(record)}: applied but the file is missing`);
    } else if (file.name !== record.name) {
      problems.push(`${file.fileName}: version applied as ${label(record)}`);
    } else if (file.sha256 !== record.sha256) {
      problems.push(`${file.fileName}: changed after it was applied`);
    }
  }

  const lastApplied = Math.max(0, ...appliedVersions);
  const pending = [...byVersion.values()]
    .filter((file) => !appliedVersions.has(file.version))
    .sort((a, b) => a.version - b.version);
  for (const file of pending) {
    if (file.version < lastApplied) {
      problems.push(`${file.fileName}: sorts below the last applied version ${lastApplied}`);
    }
  }

  return problems.length > 0 ? { pending: [], problems } : { pending, problems };
}

/** A file whose first line is the marker runs outside a transaction. */
export function hasNoTransactionMarker(sql: string): boolean {
  const firstLine = sql.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return firstLine.trim() === NO_TRANSACTION_MARKER;
}
