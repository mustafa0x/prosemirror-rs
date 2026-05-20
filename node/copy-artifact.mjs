/**
 * Copies the compiled Rust native addon to a platform-specific .node file.
 *
 * The filename follows the napi-rs triple convention so that index.js can
 * load the correct binary at runtime.  Called automatically by `npm run build`
 * after `cargo build --release`.
 */
import { cpSync } from 'fs';
import { platform, arch } from 'os';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Map OS → shared library extension
function libExtension() {
  const p = platform();
  if (p === 'win32') return '.dll';
  if (p === 'darwin') return '.dylib';
  return '.so';
}

// Map Node platform+arch → napi-rs triple
function triple() {
  const p = platform();
  const a = arch();
  if (p === 'darwin' && a === 'x64')       return 'darwin-x64';
  if (p === 'darwin' && a === 'arm64')     return 'darwin-arm64';
  if (p === 'linux'  && a === 'x64')       return 'linux-x64-gnu';
  if (p === 'linux'  && a === 'arm64')     return 'linux-arm64-gnu';
  if (p === 'win32'  && a === 'x64')       return 'win32-x64-msvc';
  throw new Error(`Unsupported platform/arch: ${p}-${a}`);
}

const src  = join(__dirname, '..', 'target', 'release', `libprosemirror_rs${libExtension()}`);
const dest = join(__dirname, `prosemirror-rs.${triple()}.node`);

cpSync(src, dest);
console.log(`Copied ${src} → ${dest}`);
