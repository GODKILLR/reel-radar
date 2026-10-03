import { migrate } from "../src/lib/db";

migrate()
  .then(() => {
    console.log("Schema applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
