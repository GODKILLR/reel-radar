// Runs the project's real migrate() against whatever DATABASE_URL points at.
import { migrate } from "../../src/lib/db";
if (!process.env.DATABASE_URL?.includes("localhost:5433")) throw new Error("not the scratch DB");
await migrate();
process.exit(0);
