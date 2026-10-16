/* Compile only in an explicit, existing Vencord development checkout. */
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = process.env.VENCORD_SOURCE;
if (!checkout) throw new Error("Set VENCORD_SOURCE to a Vencord development checkout with pnpm install already completed");
const root = path.resolve(checkout);
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.name !== "vencord") throw new Error("VENCORD_SOURCE is not a Vencord checkout");
const target = path.join(root, "src", "userplugins", "neuroDesktop.desktop");
try {
    await stat(target);
    throw new Error("Refusing to replace an existing neuroDesktop.desktop userplugin; choose a clean checkout");
} catch (error) {
    if (error.code !== "ENOENT") throw error;
}
await mkdir(path.dirname(target), { recursive: true });
await cp(path.join(packageRoot, "plugin"), target, { recursive: true });
try {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    for (const args of [["testTsc"], ["build", "--standalone"]]) {
        const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Vencord ${args.join(" ")} failed (${result.status})`);
    }
} finally {
    await rm(target, { recursive: true, force: true });
}
