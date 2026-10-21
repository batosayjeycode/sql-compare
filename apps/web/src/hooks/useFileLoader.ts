import { useCallback } from 'react';
import { FileLoadError, loadSqlFile } from '../lib/files';
import { useCompareStore, type Side } from '../store/compare';

/** Load a user-supplied file into one side, surfacing errors/warnings as notices. */
export function useFileLoader() {
  const loadFile = useCompareStore((s) => s.loadFile);
  const notify = useCompareStore((s) => s.notify);

  return useCallback(
    async (side: Side, file: File) => {
      try {
        const loaded = await loadSqlFile(file);
        loadFile(side, loaded.text, loaded.name);
        if (loaded.warnings.length > 0) notify('warning', loaded.warnings.join(' '));
      } catch (err) {
        const message =
          err instanceof FileLoadError ? err.message : `Could not read "${file.name}".`;
        notify('error', message);
      }
    },
    [loadFile, notify],
  );
}
