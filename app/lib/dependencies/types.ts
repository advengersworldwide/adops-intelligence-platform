export const MAX_DEPTH = 4;
export const MAX_ROWS_PER_LEVEL = 50;
export const CASCADE_SAMPLE_SIZE = 3;

export type ImpactNode = {
  table: string;
  id: number | string;
  label: string;
  singular: string;
  href: string | null;
  canDelete: boolean;
  requiredPermission: string;
  deleteEndpoint: string | null;
  children: ImpactNode[];
  truncated: boolean;   // more children exist than MAX_ROWS_PER_LEVEL
};

export type CascadeGroup = {
  table: string;
  label: string;         // plural descriptor label
  count: number;         // transitive: includes this table's own cascade descendants
  sample: ImpactNode[];
  canDelete: boolean;
  requiredPermission: string;
};

export type NullifyGroup = {
  table: string;
  column: string;
  label: string;
  count: number;
};

export type Impact = {
  target: { table: string; id: number | string; label: string; singular: string };
  blockers: ImpactNode[];
  cascades: CascadeGroup[];
  nullifies: NullifyGroup[];
  canDeleteAll: boolean;
  blockedReason: string | null;
  missingPermissions: string[];
  totals: { deletes: number; nullifies: number; touchesFinancial: boolean };
  fingerprint: string;
};
