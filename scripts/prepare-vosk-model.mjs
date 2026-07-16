import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import extract from 'extract-zip';
import * as tar from 'tar';

const MODEL_NAME = 'vosk-model-small-ja-0.22';
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;
const MODEL_SHA256 = 'efa092d280153a77615e9e0c7d7283e93e600de3d19d3bec686c57ef19d52eac';
const projectRoot = process.cwd();
const cacheRoot = path.join(projectRoot, '.cache', 'vosk');
const zipPath = path.join(cacheRoot, `${MODEL_NAME}.zip`);
const extractedPath = path.join(cacheRoot, MODEL_NAME);
const outputPath = path.join(projectRoot, 'public', 'models', `${MODEL_NAME}.tar.gz`);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function downloadModel() {
  if (await exists(zipPath)) {
    if (await sha256(zipPath) === MODEL_SHA256) return;
    await rm(zipPath);
  }

  console.log(`Downloading ${MODEL_NAME} from the official Vosk model repository...`);
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  await writeFile(zipPath, new Uint8Array(await response.arrayBuffer()));

  const actualHash = await sha256(zipPath);
  if (actualHash !== MODEL_SHA256) {
    await rm(zipPath);
    throw new Error(`Model checksum mismatch: expected ${MODEL_SHA256}, received ${actualHash}`);
  }
}

async function main() {
  await mkdir(cacheRoot, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (await exists(outputPath) && (await stat(outputPath)).size > 40_000_000) {
    console.log(`Using prepared Vosk model: ${path.relative(projectRoot, outputPath)}`);
    return;
  }

  await downloadModel();
  await rm(extractedPath, { recursive: true, force: true });
  await extract(zipPath, { dir: cacheRoot });

  await tar.create({
    cwd: cacheRoot,
    file: outputPath,
    gzip: true,
    portable: true,
  }, [MODEL_NAME]);

  console.log(`Prepared ${path.relative(projectRoot, outputPath)} (${Math.round((await stat(outputPath)).size / 1_000_000)} MB)`);
}

await main();
