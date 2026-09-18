import { resolve } from 'node:path';
import { validateKnowledgeRepository } from '../knowledge/repository.ts';
import type { KnowledgeRepositoryValidationResult } from '../knowledge/repository.ts';

function printSummary(heading: string, result: KnowledgeRepositoryValidationResult): void {
  console.log(heading);
  console.log(`Files checked: ${result.filesChecked}`);
  console.log(`Valid: ${result.validCount}`);
  console.log(`Invalid: ${result.invalidCount}`);
}

async function main(): Promise<void> {
  const rootArg = process.argv[2];
  const rootPath = resolve(process.cwd(), rootArg ?? 'knowledge');

  let result: KnowledgeRepositoryValidationResult;
  try {
    result = await validateKnowledgeRepository(rootPath);
  } catch (error) {
    console.error(`Knowledge validation failed: could not validate ${rootPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (result.invalidCount === 0) {
    printSummary('Knowledge validation passed', result);
    return;
  }

  printSummary('Knowledge validation failed', result);
  console.log('');
  for (const { filePath, error } of result.invalidFiles) {
    console.log(`Invalid file: ${filePath}`);
    console.log(`  ${error}`);
    console.log('');
  }
  process.exitCode = 1;
}

await main();