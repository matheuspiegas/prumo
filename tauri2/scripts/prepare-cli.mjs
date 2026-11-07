// Compila o CLI (crate ../cli) e o copia para src-tauri/binaries/prumo-cli-<triple>,
// onde o Tauri espera o sidecar (bundle.externalBin). Roda antes do dev e do build.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const ext = triple.includes("windows") ? ".exe" : "";
const release = process.argv.includes("--release");

execSync(`cargo build ${release ? "--release " : ""}--target ${triple}`, {
  cwd: join(root, "cli"),
  stdio: "inherit",
});
const src = join(root, "cli", "target", triple, release ? "release" : "debug", `prumo-cli${ext}`);
const dest = join(root, "tauri2", "src-tauri", "binaries", `prumo-cli-${triple}${ext}`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`sidecar: ${dest}`);
