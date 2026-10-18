// Writes FreeLLM providers into the CC Switch v3 SQLite database.
// Runs in the bundled Node runtime because better-sqlite3 is built for it.
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (error) {
  fail(`invalid payload: ${error.message}`);
}

const core = process.env.FREELLM_CORE || path.resolve(__dirname, 'core');
let Database;
try {
  Database = require(path.join(core, 'node_modules', 'better-sqlite3'));
} catch (bundledError) {
  try {
    Database = require('better-sqlite3');
  } catch (fallbackError) {
    fail(`better-sqlite3 unavailable: ${bundledError.message}; ${fallbackError.message}`);
  }
}

if (!payload?.dbPath || !Array.isArray(payload.providers)) {
  fail('dbPath and providers are required');
}

const db = new Database(payload.dbPath);
try {
  db.pragma('busy_timeout = 5000');
  const upsert = db.prepare(`
    INSERT INTO providers (
      id, app_type, name, settings_config, website_url, category,
      created_at, sort_index, notes, icon, icon_color, meta,
      is_current, in_failover_queue, cost_multiplier, provider_type
    ) VALUES (
      @id, @app_type, @name, @settings_config, @website_url, @category,
      @created_at, @sort_index, @notes, @icon, @icon_color, @meta,
      0, 0, '1.0', NULL
    )
    ON CONFLICT(id, app_type) DO UPDATE SET
      name = excluded.name,
      settings_config = excluded.settings_config,
      website_url = excluded.website_url,
      category = excluded.category,
      notes = excluded.notes,
      icon = excluded.icon,
      icon_color = excluded.icon_color,
      meta = excluded.meta
  `);
  const nextSort = db.prepare('SELECT COALESCE(MAX(sort_index), 0) + 1 AS value FROM providers WHERE app_type = ?');
  const existingSort = db.prepare('SELECT sort_index FROM providers WHERE id = ? AND app_type = ?');

  const write = db.transaction((providers) => {
    for (const provider of providers) {
      const existing = existingSort.get(provider.id, provider.appType);
      upsert.run({
        id: provider.id,
        app_type: provider.appType,
        name: provider.name,
        settings_config: JSON.stringify(provider.settingsConfig || {}),
        website_url: provider.websiteUrl || '',
        category: provider.category || 'aggregator',
        created_at: Date.now(),
        sort_index: existing?.sort_index ?? nextSort.get(provider.appType).value,
        notes: provider.notes || 'FreeLLM Console',
        icon: provider.icon || '',
        icon_color: provider.iconColor || '',
        meta: JSON.stringify(provider.meta || {}),
      });
    }
  });
  write(payload.providers);
  process.stdout.write(JSON.stringify({ ok: true, count: payload.providers.length }));
} catch (error) {
  fail(`sqlite write failed: ${error.message}`);
} finally {
  db.close();
}
