import { CIRCLES_RPC } from "./contract";

// Thin client for the indexer's `circles_query` (the Nethermind plugin behind
// rpc.aboutcircles.com). Tables/columns are discoverable via `circles_tables`;
// every wave-1 tool reads through this helper.

export interface QueryFilter {
  column: string;
  // "In" takes an array value; the scalar predicates take a scalar.
  value: string | number | Array<string | number>;
  filterType?: "Equals" | "GreaterThan" | "LessThan" | "In";
}

export interface QueryOrder {
  column: string;
  desc?: boolean;
}

export interface CirclesQuery {
  namespace: string;
  table: string;
  filter?: QueryFilter[];
  order?: QueryOrder[];
  limit?: number;
}

// Rows come back as a column-name array + value matrix; zip them into objects
// so callers never juggle indices.
export async function circlesQuery(
  q: CirclesQuery,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(CIRCLES_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "circles_query",
      params: [
        {
          Namespace: q.namespace,
          Table: q.table,
          ...(q.filter?.length
            ? {
                Filter: q.filter.map((f) => ({
                  Type: "FilterPredicate",
                  FilterType: f.filterType ?? "Equals",
                  Column: f.column,
                  Value: f.value,
                })),
              }
            : {}),
          ...(q.order?.length
            ? {
                Order: q.order.map((o) => ({
                  Column: o.column,
                  SortOrder: o.desc ? "DESC" : "ASC",
                })),
              }
            : {}),
          ...(q.limit ? { Limit: q.limit } : {}),
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message ?? `${q.table} query failed`);
  }
  const { columns, rows } = data.result as {
    columns: string[];
    rows: unknown[][];
  };
  return rows.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]])),
  );
}
