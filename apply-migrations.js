import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

const connectionString = "postgresql://postgres.odzonzxwqlhmcmyqhqcb:0808080808Animasaun1!@aws-0-us-east-2.pooler.supabase.com:5432/postgres";

const client = new Client({ connectionString });

async function applyMigrations() {
  await client.connect();
  console.log('Connected to database');
  
  const migrationsDir = './drizzle/migrations';
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  for (const file of files) {
    console.log(`\n--- Applying ${file} ---`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await client.query(sql);
      console.log(`✓ ${file} applied successfully`);
    } catch (err) {
      console.error(`✗ ${file} failed:`, err.message);
      // Continue with next migration
    }
  }
  
  await client.end();
  console.log('\nAll migrations processed');
}

applyMigrations().catch(console.error);
