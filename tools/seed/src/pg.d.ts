// The part of `pg` 8.23.1 (pinned in decision 0001, from the catalog) that `@kd/seed` uses. `pg`
// ships no type declarations and the repository has no `@types/pg` (the API reaches `pg` through
// TypeORM), so the few members used are declared here instead of adding a dependency. Checked
// against `pg/esm/index.mjs` and `pg/lib/client.js` of 8.23.1.
declare module 'pg' {
  export interface QueryResult<Row> {
    readonly rows: Row[];
    readonly rowCount: number | null;
  }

  export interface ClientConfig {
    readonly connectionString: string;
    readonly application_name?: string;
  }

  export class Client {
    constructor(config: ClientConfig);
    connect(): Promise<void>;
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
