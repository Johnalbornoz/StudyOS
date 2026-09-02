import { Pool, PoolClient, types } from 'pg';

// Postgres DATE columns (OID 1082) are parsed by node-pg into JS Date
// objects at local midnight by default, which then serialize/compare
// unpredictably depending on the server's timezone offset. Since our
// schema only ever stores calendar dates (no time component), keep
// them as plain 'YYYY-MM-DD' strings instead -- unambiguous either way.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Export pool as 'db' for compatibility with services
export const db = pool;

// Export query function
export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

// Export testDB function
export async function testDB() {
  try {
    const result = await pool.query('SELECT NOW()');
    return { ok: true, time: result.rows[0].now };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// Pool connection for direct use if needed
export { Pool };

/**
 * Phase 2B: anything that can run a `.query(text, params)` -- the pool
 * itself (the default every existing caller already uses) or one
 * checked-out client from `db.connect()` mid-transaction. Threading
 * this type through a function's signature as an optional parameter
 * (defaulting to `db`) is StudyUs's chosen "smallest transaction-aware
 * refactor" pattern: it lets a caller opt a function into an existing
 * transaction without duplicating its logic or changing its behavior
 * for every other, non-transactional caller.
 */
export type DbExecutor = Pick<Pool | PoolClient, 'query'>;
