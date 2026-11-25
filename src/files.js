import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { InputError } from './errors.js';

/**
 * Confirm that `path` is an existing, readable regular file. Input files are
 * only ever read; nothing in MergeProof opens them for writing.
 */
export async function statInputFile(path, what) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw accessError(error, path, what);
  }
  if (!info.isFile()) {
    throw new InputError(`${what} path is not a regular file: ${path}`);
  }
  try {
    await access(path, constants.R_OK);
  } catch (error) {
    throw accessError(error, path, what);
  }
  return info;
}

/** Read a whole file as strict UTF-8 (a leading BOM is removed by the decoder). */
export async function readUtf8File(path, what, maxBytes) {
  const info = await statInputFile(path, what);
  if (info.size > maxBytes) {
    throw new InputError(`${what} file is larger than the ${formatBytes(maxBytes)} limit: ${path}`);
  }
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw accessError(error, path, what);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError(`${what} file is not valid UTF-8: ${path}. Save or export it as UTF-8.`);
  }
}

export function formatBytes(bytes) {
  const mib = bytes / (1024 * 1024);
  return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`;
}

function accessError(error, path, what) {
  const code = error?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new InputError(`${what} file not found: ${path}`, { cause: error });
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new InputError(`${what} file is not readable (permission denied): ${path}`, { cause: error });
  }
  return new InputError(`Cannot read ${what} file ${path}: ${error?.message ?? String(error)}`, {
    cause: error,
  });
}
