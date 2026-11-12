// Throwaway local Postgres for testing. Data lives in ./data and is disposable.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const pg = new EmbeddedPostgres({
  databaseDir: "./.e2e-pg-data",
  user: "test",
  password: "test",
  port: 5433,
  persistent: false,
});

if (!existsSync("./.e2e-pg-data/PG_VERSION")) await pg.initialise();
await pg.start();
try { await pg.createDatabase("rr_test"); } catch {}
console.log("READY postgres://test:test@localhost:5433/rr_test");

// Keep running until killed.
process.on("SIGINT", async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
