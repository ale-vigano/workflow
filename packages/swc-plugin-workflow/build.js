import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runCommand(command) {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { stdio: 'inherit', shell: true });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(1);
  }
}

function checkCommand(command) {
  try {
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Try to build the WASM plugin
try {
  // Add cargo to PATH if it's in the default location
  const cargoPath = path.join(
    process.env.USERPROFILE || '',
    '.cargo',
    'bin',
    'cargo.exe'
  );
  console.log('Checking cargo at:', cargoPath);
  console.log('Cargo exists:', fs.existsSync(cargoPath));

  let cargoCmd = 'cargo';
  if (fs.existsSync(cargoPath)) {
    cargoCmd = `"${cargoPath}"`;
    console.log('Using cargo command:', cargoCmd);
  }

  runCommand(`${cargoCmd} build-wasm32 --release -p swc_plugin_workflow`);
  console.log('WASM plugin built successfully');
} catch (error) {
  console.log('Failed to build WASM plugin, using existing file if available');
}

// Copy the WASM file
const source = path.join(
  __dirname,
  '..',
  '..',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'swc_plugin_workflow.wasm'
);
const dest = path.join(__dirname, 'swc_plugin_workflow.wasm');

if (fs.existsSync(source)) {
  fs.copyFileSync(source, dest);
  console.log('WASM file copied successfully');
} else if (fs.existsSync(dest)) {
  console.log('Using existing WASM file');
} else {
  console.error(`WASM file not found. Please build the Rust plugin first.`);
  console.log(`Expected at: ${source}`);
  process.exit(1);
}
