import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
const app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, SCISLIDE_DEV_URL: "http://127.0.0.1:5173/" },
});
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.kill(signal));
