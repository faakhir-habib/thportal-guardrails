import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// True only when this module is the file node was started with, so a module can carry a CLI without
// running it on import.
export const isMain = (moduleUrl) => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
};
