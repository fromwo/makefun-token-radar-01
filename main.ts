// Token radar board builder: reads one snapshot, scores it under radar-2,
// and writes board.json, data.js, the dashboard, the screenshots and a
// dossier into the output directory. Node 22, standard library only.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { BASE_MULTIPLE, MODEL_VERSION, buildBoard, type SnapshotInput } from './lib/model.ts';

const TEXT_MAX_BYTES = 65536;
const SCREENSHOT_MAX = 8;
const SCREENSHOT_MAX_BYTES = 4194304;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4194304;

function inputPathFrom(argv: string[]): string {
  const at = argv.indexOf('--input');
  if (at === -1 || at + 1 >= argv.length) {
    throw new Error('usage: node main.ts --input <snapshot.json>');
  }
  return argv[at + 1]!;
}

function main(): void {
  const inputPath = inputPathFrom(process.argv.slice(2));
  const raw = readFileSync(inputPath, 'utf8');
  const snapshot = JSON.parse(raw) as SnapshotInput;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error('snapshot must hold protocols and watchlist arrays');
  }
  const built = buildBoard(snapshot);

  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? 'out');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: built.rows }, null, 2)}\n`, 'utf8');

  const radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: { version: MODEL_VERSION, base_multiple: BASE_MULTIPLE },
    rows: built.rows,
    live: built.live,
    set_aside: built.set_aside,
  };
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(radar, null, 2)};\n`, 'utf8');

  const dashboardSrc = join(repoRoot, 'dashboard');
  const shotsSrc = join(repoRoot, 'screenshots');
  if (existsSync(dashboardSrc)) cpSync(dashboardSrc, join(outDir, 'dashboard'), { recursive: true });
  if (existsSync(shotsSrc)) cpSync(shotsSrc, join(outDir, 'screenshots'), { recursive: true });

  const shotsOut = join(outDir, 'screenshots');
  const shotFiles = existsSync(shotsOut)
    ? readdirSync(shotsOut, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.'))
    : [];
  if (shotFiles.length === 0) {
    console.error('warning: screenshots/ holds no image, dossier not written');
    process.exit(1);
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  console.log(
    `protocols=${snapshot.protocols.length} watchlist=${snapshot.watchlist.length} board=${built.rows.length}`,
  );
}

main();
