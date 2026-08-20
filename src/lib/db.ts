import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function testDB() {
  try {
    const result = await pool.query('SELECT NOW()');
    return { ok: true, time: result.rows[0].now };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
