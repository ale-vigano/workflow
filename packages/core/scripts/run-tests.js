#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { exit, platform } from 'node:process';

const child = spawn('pnpm', ['vitest', 'run', 'src'], {
  stdio: 'inherit',
  shell: platform === 'win32',
  env: {
    ...process.env,
    WORKFLOW_TARGET_WORLD: process.env.WORKFLOW_TARGET_WORLD || 'embedded',
  },
});

child.on('exit', (code) => {
  exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  exit(1);
});
