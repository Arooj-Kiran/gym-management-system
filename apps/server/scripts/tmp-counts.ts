const { pool, closeDb } = await import('../src/db/client');
const tables = ['users', 'members', 'membership_plans', 'audit_logs'];
const out: Record<string, number | string> = {};
for (const t of tables) {
  try {
    const r = await pool.query(`select count(*)::int as n from ${t}`);
    out[t] = r.rows[0].n;
  } catch {
    out[t] = 'missing';
  }
}
for (const t of ['memberships', 'membership_events']) {
  const r = await pool.query(`select to_regclass('public.${t}') is not null as e`);
  out[t] = r.rows[0].e ? 'exists' : 'missing';
}
console.log(JSON.stringify(out));
await closeDb();
