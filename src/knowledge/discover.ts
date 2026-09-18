import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
]);

const NON_KNOWLEDGE_ITEM_FILES = new Set(['SCHEMA.md']);

export async function discoverKnowledgeFiles(rootPath: string): Promise<string[]> {
  const discovered: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const resolvedPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(resolvedPath);
        }
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        !NON_KNOWLEDGE_ITEM_FILES.has(entry.name)
      ) {
        discovered.push(resolvedPath);
      }
    }
  };

  await walk(rootPath);
  return discovered;
}