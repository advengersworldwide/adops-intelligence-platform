import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: url });
await client.connect();

// Mirror derivePrefix(): first 4 alphanumerics, uppercased, right-padded with X.
const expr = `rpad(upper(left(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 4)), 4, 'X')`;
for (const table of ["clients", "partners"]) {
  const res = await client.query(
    `UPDATE ${table} SET code_prefix = ${expr} WHERE code_prefix IS NULL OR code_prefix = ''`,
  );
  console.log(`${table}: backfilled ${res.rowCount} row(s)`);
}

await client.end();
console.log("backfill done");
