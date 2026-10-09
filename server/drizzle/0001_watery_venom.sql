ALTER TABLE `paths` ADD `search_text` text DEFAULT '' NOT NULL;
-- Unicode backfill is completed by runMigrations in server/src/db/migrate.ts.
-- SQLite lower() cannot express JS toLocaleLowerCase("und").
