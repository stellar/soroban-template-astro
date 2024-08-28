import "dotenv/config";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { sync as glob } from "glob";

// Load environment variables starting with PUBLIC_ into the environment,
// so we don't need to specify duplicate variables in .env
for (const key in process.env) {
  if (key.startsWith("PUBLIC_")) {
    process.env[key.substring(7)] = process.env[key];
  }
}

console.log("###################### Initializing ########################");

// Get dirname (equivalent to __dirname in CommonJS modules)
const __filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(__filename);

/**
 * Execute and log a shell command
 */
function run(command) {
  console.log(command);
  execSync(command, { stdio: "inherit" });
}

/**
 * Generate a new keypair for the account specified by `SOROBAN_ACCOUNT` in the
 * `.env` file (loaded into the environment by `dotenv`)
 */
function generateAccount() {
  run(`stellar keys generate ${process.env.SOROBAN_ACCOUNT}`);
}

function removeFiles(pattern) {
  console.log(`remove ${pattern}`);
  glob(pattern).forEach((entry) => rmSync(entry));
}

/**
 * Build all contracts, removing outdated `.wasm` files so stale artifacts
 * don't accidentally get deployed, bound, and imported later
 */
function buildAll() {
  removeFiles(`${dirname}/target/wasm32-unknown-unknown/release/*.wasm`);
  removeFiles(`${dirname}/target/wasm32-unknown-unknown/release/*.d`);
  run(`stellar contract build`);
}

/**
 * Get the filename without the extension
 */
function filenameNoExtension(filename) {
  return path.basename(filename, path.extname(filename));
}

/**
 * Deploy a contract, given its `.wasm` file, creating an alias for it based on
 * the filename. The alias will create a `.soroban/contract-ids` directory,
 * which is assumed to be present later.
 */
function deploy(wasm) {
  run(
    `stellar contract deploy --wasm ${wasm} --ignore-checks --alias ${filenameNoExtension(
      wasm
    )}`
  );
}

/**
 * Deploy all contracts in the `target/wasm32-unknown-unknown/release`
 * directory. These need to be built first, so this function should be called
 * after `buildAll`.
 */
function deployAll() {
  const wasmFiles = glob(
    `${dirname}/target/wasm32-unknown-unknown/release/*.wasm`
  );

  wasmFiles.forEach(deploy);
}

/**
 * Get contract aliases and IDs from the `.soroban/contract-ids` directory,
 * using the filename as the alias. Filters out contracts that weren't deployed
 * to the network specified in the `.env` file.
 */
function contracts() {
  const contractFiles = glob(`${dirname}/.soroban/contract-ids/*.json`);

  return contractFiles
    .map((path) => ({
      alias: filenameNoExtension(path),
      ...JSON.parse(readFileSync(path)),
    }))
    .filter((data) => data.ids[process.env.SOROBAN_NETWORK_PASSPHRASE])
    .map((data) => ({
      alias: data.alias,
      id: data.ids[process.env.SOROBAN_NETWORK_PASSPHRASE],
    }));
}

/**
 * Generate TypeScript bindings for a contract, given its alias and ID. The
 * bindings will be output to a directory named after the alias in the
 * `packages` directory. Everything in `packages` is set up as part of the NPM
 * workspace in `package.json`.
 */
function bind({ alias, id }) {
  run(
    `stellar contract bindings typescript --contract-id ${id} --output-dir ${dirname}/packages/${alias} --overwrite`
  );
}

/**
 * Generate TypeScript bindings for all contracts
 */
function bindAll() {
  contracts().forEach(bind);
}

/**
 * Create a file in the project's `src/contracts` directory that imports the
 * contract client from a package generated with `soroban contract bindings
 * typescript`, as in `bindAll` above. Then instantiate the client with the
 * environment settings from `.env`. This file will be used to import the
 * contract client in the rest of the project.
 */
function importContract({ id, alias }) {
  const outputDir = `${dirname}/src/contracts/`;

  mkdirSync(outputDir, { recursive: true });

  const importContent =
    `import * as Client from '${alias}';\n` +
    `import { rpcUrl } from './util';\n\n` +
    `export default new Client.Client({\n` +
    `  contractId: '${id}',\n` +
    `  networkPassphrase: '${process.env.SOROBAN_NETWORK_PASSPHRASE}',\n` +
    `  rpcUrl,\n` +
    `${
      process.env.SOROBAN_NETWORK_PASSPHRASE ===
      "Standalone Network ; February 2017"
        ? `  allowHttp: true,\n`
        : null
    }` +
    `});\n`;

  const outputPath = `${outputDir}/${alias}.ts`;

  writeFileSync(outputPath, importContent);

  console.log(`Created import for ${alias}`);
}

/**
 * Create import files in `src/contracts` for all contracts
 */
function importAll() {
  contracts().forEach(importContract);
}

// Main part of script. Run all functions.
generateAccount();
buildAll();
deployAll();
bindAll();
importAll();
