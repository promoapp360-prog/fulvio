import { is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema";

export type ColumnReference = { table_name: string; column_name: string };

export function findMissingColumns(expected: ColumnReference[], actual: ColumnReference[]) {
  const existing = new Set(actual.map(column => `${column.table_name}.${column.column_name}`));
  return expected.filter(column => !existing.has(`${column.table_name}.${column.column_name}`));
}

export function expectedColumns(): ColumnReference[] {
  return Object.values(schema).flatMap(value => {
    if (!is(value, Table)) return [];
    const table = getTableConfig(value);
    return table.columns.map(column => ({ table_name: table.name, column_name: column.name }));
  });
}
