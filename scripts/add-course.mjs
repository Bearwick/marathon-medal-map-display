#!/usr/bin/env node
// Adds a suggested course (proposal ZIP from the app) to public/community/ and prints a review report.
//
//   npm run course:add -- <proposal.zip | https://github.com/user-attachments/...zip> --issue <n>
//     --maintainer   publish as a maintainer-curated course (no review link needed)
//     --replace      replace an existing course with the same id
//     --dry-run      check and report only; write nothing
//     --report <f>   also write the Markdown report to a file
//     --json <f>     write a machine-readable summary (used by the GitHub workflow)
//
// Exit code 0 when the course was added (or would be, with --dry-run), 1 when there are problems.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const community = join(root, 'public/community');
const MAX_DOWNLOAD = 120 * 1024 * 1024;
const ALLOWED_URL = /^https:\/\/github\.com\/(?:user-attachments\/files\/\d+\/[^/?#]+\.zip|[\w.-]+\/[\w.-]+\/files\/\d+\/[^/?#]+\.zip)(?:\?.*)?$/;

function parseArgs(argv) {
  const options = { maintainer: false, replace: false, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--issue') options.issue = Number(argv[++i]);
    else if (arg === '--maintainer') options.maintainer = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--report') options.report = argv[++i];
    else if (arg === '--json') options.json = argv[++i];
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error('Usage: npm run course:add -- <proposal.zip | attachment URL> --issue <n> [--maintainer] [--replace] [--dry-run] [--report file]');
  if (options.issue !== undefined && !(Number.isInteger(options.issue) && options.issue > 0)) throw new Error('--issue must be a positive issue number.');
  return { source: rest[0], ...options };
}

async function readZip(source) {
  if (!/^https?:/i.test(source)) return new Uint8Array(await readFile(source));
  if (!ALLOWED_URL.test(source)) throw new Error('Only GitHub issue attachment URLs (https://github.com/user-attachments/files/… .zip) can be downloaded.');
  const response = await fetch(source, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error('The ZIP is larger than 120 MB.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_DOWNLOAD) throw new Error('The ZIP is larger than 120 MB.');
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function listPaths(dir, base = dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    out.push(relative(base, path).split('\\').join('/'));
    if (item.isDirectory()) out.push(...await listPaths(path, base));
  }
  return out;
}

async function loadIntake() {
  // Same DOM implementation the unit tests use; needed for GPX and 3MF parsing outside a browser.
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
  const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  const module = await server.ssrLoadModule('/src/intake.ts');
  return { intakeProposal: module.intakeProposal, close: () => server.close() };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { intakeProposal, close } = await loadIntake();
  try {
    const zip = await readZip(options.source);
    const result = intakeProposal(zip, await readFile(join(community, 'catalogue.json'), 'utf8'), {
      issue: options.issue, maintainer: options.maintainer, replace: options.replace, existingPaths: new Set(await listPaths(community)),
    });
    if (result.ok && !options.dryRun) {
      for (const [path, bytes] of Object.entries(result.files)) {
        await mkdir(dirname(join(community, path)), { recursive: true });
        await writeFile(join(community, path), bytes);
      }
      await writeFile(join(community, 'catalogue.json'), result.catalogue);
    }
    const footer = result.ok ? (options.dryRun ? '\n\n_Dry run: nothing was written._' : `\n\n_Added \`public/community/${result.folder}/\` and its catalogue entry._`) : '';
    const report = result.report + footer;
    console.log(report);
    if (options.report) await writeFile(options.report, `${report}\n`);
    if (options.json) await writeFile(options.json, JSON.stringify({ ok: result.ok, id: result.id, folder: result.folder, problems: result.problems }));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await close();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`add-course: ${message}`);
  const options = (() => { try { return parseArgs(process.argv.slice(2)); } catch { return {}; } })();
  if (options.report) await writeFile(options.report, `## Course intake report\n\n- ❌ ${message}\n`).catch(() => {});
  if (options.json) await writeFile(options.json, JSON.stringify({ ok: false, problems: [message] })).catch(() => {});
  process.exitCode = 1;
});
