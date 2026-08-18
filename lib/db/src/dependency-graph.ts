import { is, getTableName } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type FkAction = "cascade" | "restrict" | "set null" | "set default" | "no action";

export type FkEdge = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  onDelete: FkAction;
};

const tables = Object.values(schema).filter(v => is(v, PgTable)) as PgTable[];

export const allTableNames: readonly string[] = tables.map(getTableName);

export const fkEdges: readonly FkEdge[] = tables.flatMap((table) => {
  const childTable = getTableName(table);
  return getTableConfig(table).foreignKeys.map((fk): FkEdge => {
    const ref = fk.reference();
    if (ref.columns.length !== 1) {
      throw new Error(
        `Composite foreign key on ${childTable} is not supported by the dependency graph`,
      );
    }
    return {
      childTable,
      childColumn: ref.columns[0]!.name,
      parentTable: getTableName(ref.foreignTable),
      parentColumn: ref.foreignColumns[0]!.name,
      // Postgres defaults an unspecified action to NO ACTION, which blocks deletes.
      onDelete: (fk.onDelete ?? "no action") as FkAction,
    };
  });
});

export const dependentsOf: ReadonlyMap<string, FkEdge[]> = (() => {
  const map = new Map<string, FkEdge[]>();
  for (const e of fkEdges) {
    const existing = map.get(e.parentTable);
    if (existing) existing.push(e);
    else map.set(e.parentTable, [e]);
  }
  return map;
})();

/** RESTRICT and NO ACTION both prevent the parent row from being deleted. */
export function isBlocking(action: FkAction): boolean {
  return action === "restrict" || action === "no action";
}
