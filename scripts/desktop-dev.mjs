import { createServer } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
const app = spawn(electron, ["."], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SCISLIDE_DEV_URL: "http://127.0.0.1:5173/" },
});
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.kill(signal));
