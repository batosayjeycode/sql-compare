/** File upload helpers (FR-1.1): type check, size warning, encoding detection. */

export const ACCEPTED_EXTENSIONS = ['.sql', '.txt', '.ddl'] as const;
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');
/** Soft limit: larger files still load, but with a warning. */
export const SOFT_SIZE_LIMIT = 5 * 1024 * 1024;

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: Encoding;
}

export interface LoadedFile extends DecodedText {
  name: string;
  warnings: string[];
}

export class FileLoadError extends Error {}

export function isAcceptedFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Decode raw bytes. Honors UTF-8 / UTF-16 BOMs; without a BOM, tries strict
 * UTF-8 and falls back to Windows-1252 so legacy dumps still open.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

export async function loadSqlFile(file: File): Promise<LoadedFile> {
  if (!isAcceptedFileName(file.name)) {
    throw new FileLoadError(
      `"${file.name}" isn't a supported file type. Use ${ACCEPTED_EXTENSIONS.join(', ')}.`,
    );
  }
  const warnings: string[] = [];
  if (file.size > SOFT_SIZE_LIMIT) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    warnings.push(`"${file.name}" is ${mb} MB. Large files may make comparison slow.`);
  }
  const decoded = decodeBytes(await readBytes(file));
  if (decoded.encoding === 'windows-1252') {
    warnings.push(`"${file.name}" isn't valid UTF-8; decoded as Windows-1252.`);
  }
  return { ...decoded, name: file.name, warnings };
}
