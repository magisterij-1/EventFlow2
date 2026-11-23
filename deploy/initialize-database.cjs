const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Client } = require('pg');

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const schema = await readFile(join(__dirname, 'database', 'schema.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventflow-schema'))");
    await client.query(schema);
    await client.query(`
      INSERT INTO categories (id, name) VALUES
        (1, 'Koncerti'), (2, 'Šport'), (3, 'Izobraževanje'), (4, 'Kultura'), (5, 'Drugo')
      ON CONFLICT (id) DO NOTHING;

      SELECT setval('categories_id_seq', GREATEST(
        (SELECT last_value FROM categories_id_seq), (SELECT MAX(id) FROM categories)
      ));
    `);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

initializeDatabase().catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exitCode = 1;
});
