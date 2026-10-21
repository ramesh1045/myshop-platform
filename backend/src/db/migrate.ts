/**
 * Versioned SQL migration runner (Flyway-style: V<n>__name.sql, checksum verified).
 * Replaces Flyway from the Spring Boot version — same file naming, so the same
 * folder can also be run with the Flyway CLI if you prefer.
 *   npm run migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

const DIR = process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), '../database/migrations');

async function main() {
  const root = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, multipleStatements: true,
  });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await root.end();

  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, multipleStatements: true,
  });
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INT UNSIGNED NOT NULL PRIMARY KEY,
      description VARCHAR(200) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      execution_ms INT UNSIGNED NOT NULL
    ) ENGINE=InnoDB`);

  // Only one instance may migrate at a time
  const [[lock]]: any = await conn.query("SELECT GET_LOCK('myshop_migrate', 60) AS l");
  if (lock.l !== 1) throw new Error('Could not obtain migration lock');

  try {
    const [rows]: any = await conn.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map<number, string>(rows.map((r: any) => [Number(r.version), r.checksum]));

    const files = fs.readdirSync(DIR)
      .filter((f) => /^V\d+__.+\.sql$/.test(f))
      .sort((a, b) => Number(a.match(/^V(\d+)/)![1]) - Number(b.match(/^V(\d+)/)![1]));

    for (const file of files) {
      const version = Number(file.match(/^V(\d+)/)![1]);
      const description = file.replace(/^V\d+__/, '').replace(/\.sql$/, '').replace(/_/g, ' ');
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (applied.has(version)) {
        if (applied.get(version) !== checksum) {
          throw new Error(`Checksum mismatch for ${file}. Never edit an applied migration — add a new V file.`);
        }
        continue;
      }
      const t0 = Date.now();
      process.stdout.write(`Applying ${file} ... `);
      await conn.query(sql); // MySQL DDL auto-commits; each file is written to be idempotent-safe on first run
      await conn.query(
        'INSERT INTO schema_migrations (version, description, checksum, execution_ms) VALUES (?,?,?,?)',
        [version, description, checksum, Date.now() - t0],
      );
      console.log(`ok (${Date.now() - t0} ms)`);
    }
    console.log('Database is up to date.');
  } finally {
    await conn.query("SELECT RELEASE_LOCK('myshop_migrate')");
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
