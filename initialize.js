import 'dotenv/config';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables starting with PUBLIC_ into the environment,
// so we don't need to specify duplicate variables in .env
for (const key in process.env) {
  if (key.startsWith('PUBLIC_')) {
    process.env[key.substring(7)] = process.env[key];
  }
}

console.log("###################### Initializing ########################");

// Get dirname (equivalent to the Bash version)
const __filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(__filename);

// variable for later setting pinned version of soroban in "$(dirname/target/bin/soroban)"
const soroban = "soroban"

// Function to execute and log shell commands
function exe(command) {
  console.log(command);
  execSync(command, { stdio: 'inherit' });
}

function fund_all() {
  exe(`${soroban} keys generate ${process.env.SOROBAN_ACCOUNT}`);
  exe(`${soroban} keys fund ${process.env.SOROBAN_ACCOUNT}`);
}

function build_all() {
  exe(`rm -f ${dirname}/target/wasm32-unknown-unknown/release/*.wasm`);
  exe(`rm -f ${dirname}/target/wasm32-unknown-unknown/release/*.d`);
  exe(`${soroban} contract build`);
}

function filenameNoExtension(filename) {
  return path.basename(filename, path.extname(filename));
}

function deploy(wasm) {
  exe(`(${soroban} contract deploy --wasm ${wasm} --ignore-checks) > ${dirname}/.soroban/contract-ids/${filenameNoExtension(wasm)}.txt`);
}

function deploy_all() {
  const contractsDir = `${dirname}/.soroban/contract-ids`;
  mkdirSync(contractsDir, { recursive: true });

  const wasmFiles = readdirSync(`${dirname}/target/wasm32-unknown-unknown/release`).filter(file => file.endsWith('.wasm'));
  
  wasmFiles.forEach(wasmFile => {
    deploy(`${dirname}/target/wasm32-unknown-unknown/release/${wasmFile}`);
  });
}

function bind(contract) {
  const filenameNoExt = filenameNoExtension(contract);
  exe(`${soroban} contract bindings typescript --contract-id $(cat ${contract}) --output-dir ${dirname}/packages/${filenameNoExt} --overwrite`);
}

function bind_all() {
  const contractIdsDir = `${dirname}/.soroban/contract-ids`;
  const contractFiles = readdirSync(contractIdsDir);

  contractFiles.forEach(contractFile => {
    const contractPath = path.join(contractIdsDir, contractFile);
    if (statSync(contractPath).size > 0) {  // Check if file is not empty
      bind(contractPath);
    }
  });
}

function importContract(contract) {
  const filenameNoExt = filenameNoExtension(contract);
  const outputDir = `${dirname}/src/contracts/`;
  mkdirSync(outputDir, { recursive: true });

  const importContent =
    `import * as Client from '${filenameNoExt}';\n` +
    `import { rpcUrl } from './util';\n\n` +
    `export default new Client.Contract({\n` +
    `  ...Client.networks.${process.env.SOROBAN_NETWORK},\n` +
    `  rpcUrl,\n` +
    `});\n`;

  const outputPath = `${outputDir}/${filenameNoExt}.ts`;
  writeFileSync(outputPath, importContent);
  console.log(`Created import for ${filenameNoExt}`);
}

function import_all() {
  const contractIdsDir = `${dirname}/.soroban/contract-ids`;
  const contractFiles = readdirSync(contractIdsDir);

  contractFiles.forEach(contractFile => {
    const contractPath = path.join(contractIdsDir, contractFile);
    if (statSync(contractPath).size > 0) {  // Check if file is not empty
      importContract(contractPath);
    }
  });
}

// Calling the functions (equivalent to the last part of your bash script)
fund_all();
build_all();
deploy_all();
bind_all();
import_all();
