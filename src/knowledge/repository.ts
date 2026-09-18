import { discoverKnowledgeFiles } from './discover.ts';
import { loadKnowledgeFile } from './loader.ts';

export interface InvalidKnowledgeFile {
  filePath: string;
  error: string;
}

export interface KnowledgeRepositoryValidationResult {
  rootPath: string;
  filesChecked: number;
  validCount: number;
  invalidCount: number;
  validFiles: string[];
  invalidFiles: InvalidKnowledgeFile[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function validateKnowledgeRepository(
  rootPath: string,
): Promise<KnowledgeRepositoryValidationResult> {
  const files = await discoverKnowledgeFiles(rootPath);

  const validFiles: string[] = [];
  const invalidFiles: InvalidKnowledgeFile[] = [];

  for (const filePath of files) {
    try {
      await loadKnowledgeFile(filePath);
      validFiles.push(filePath);
    } catch (error) {
      invalidFiles.push({ filePath, error: errorMessage(error) });
    }
  }

  return {
    rootPath,
    filesChecked: files.length,
    validCount: validFiles.length,
    invalidCount: invalidFiles.length,
    validFiles,
    invalidFiles,
  };
}