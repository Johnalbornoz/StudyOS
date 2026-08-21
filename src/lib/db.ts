import { Pool } from 'pg';

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
