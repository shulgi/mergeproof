#!/usr/bin/env node
const major = Number.parseInt(process.versions.node.split('.')[0], 10);

if (major < 22) {
  process.stderr.write(`mergeproof: error: Node.js 22 or newer is required (this is ${process.version}).\n`);
  process.exitCode = 2;
} else {
  const { run } = await import('../src/cli.js');
  await run();
}
