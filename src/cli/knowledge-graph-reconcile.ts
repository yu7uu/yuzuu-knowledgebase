import { resolve } from 'node:path';
import { discoverKnowledgeFiles, loadKnowledgeFile } from '../knowledge/index.ts';
import {
  createNeo4jDriver,
  ensureKnowledgeGraphSchema,
  loadNeo4jConfig,
  projectKnowledgeGraph,
  reconcileKnowledgeGraph,
} from '../graph/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';
import type { ReconciliationReport } from '../graph/index.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadAllKnowledgeFiles(rootPath: string): Promise<KnowledgeDocument[]> {
  const filePaths = await discoverKnowledgeFiles(rootPath);
  const documents: KnowledgeDocument[] = [];
  const loadErrors: string[] = [];
  for (const filePath of filePaths) {
    try {
      documents.push(await loadKnowledgeFile(filePath));
    } catch (error) {
      loadErrors.push(`${filePath}: ${errorMessage(error)}`);
    }
  }
  if (loadErrors.length > 0) {
    throw new Error(
      `knowledge validation failed (${loadErrors.length} invalid file(s)):\n  ${loadErrors.join('\n  ')}`,
    );
  }
  return documents;
}

function printReport(report: ReconciliationReport, documents: number): void {
  console.log(`Node count projected: ${report.nodesProjected}`);
  console.log(`Nodes created: ${report.nodesCreated}, updated: ${report.nodesUpdated}, removed: ${report.nodesRemoved}, unchanged: ${report.nodesUnchanged}`);
  console.log(`Relationship count projected: ${report.relationshipsProjected}`);
  console.log(`Relationships created: ${report.relationshipsCreated}, removed: ${report.relationshipsRemoved}, unchanged: ${report.relationshipsUnchanged}`);
  if (report.nodesRemoved > 0) {
    console.log('Removed nodes: (stale KnowledgeItems no longer canonical)');
  }
  if (report.relationshipsRemoved > 0) {
    console.log('Removed relationships: (stale KnowledgeItem-to-KnowledgeItem edges)');
  }
  if (report.unresolvedRelationships.length > 0) {
    console.log(`Unresolved relationship targets (skipped): ${report.unresolvedRelationships.length}`);
    for (const edge of report.unresolvedRelationships) {
      console.log(`  ${edge.sourceId} -[${edge.type}]-> ${edge.targetId} (no matching node)`);
    }
  }
  if (report.relationshipsMissingEndpoint.length > 0) {
    console.log(`Relationships with missing endpoint in graph (skipped): ${report.relationshipsMissingEndpoint.length}`);
    for (const edge of report.relationshipsMissingEndpoint) {
      console.log(`  ${edge.sourceId} -[${edge.type}]-> ${edge.targetId}`);
    }
  }
  console.log(`Documents loaded: ${documents}`);
  console.log(`Dry run: ${report.dryRun ? 'yes' : 'no'}`);
}

async function main(): Promise<void> {
  const repoRoot = resolve(process.cwd());
  const knowledgeRoot = resolve(repoRoot, 'knowledge');
  const dryRun = process.argv.includes('--dry-run');

  let config;
  try {
    config = loadNeo4jConfig();
  } catch (error) {
    console.error(`Knowledge graph reconciliation failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let documents: KnowledgeDocument[];
  try {
    documents = await loadAllKnowledgeFiles(knowledgeRoot);
  } catch (error) {
    console.error(`Knowledge graph reconciliation failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let projection;
  try {
    projection = projectKnowledgeGraph(documents, repoRoot);
  } catch (error) {
    console.error(`Knowledge graph reconciliation failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    await ensureKnowledgeGraphSchema(driver);
    const heading = dryRun
      ? 'Knowledge graph reconciliation preview (dry run)'
      : 'Knowledge graph reconciliation complete';
    console.log(heading);
    const report = await reconcileKnowledgeGraph(driver, projection, { dryRun });
    printReport(report, documents.length);

    if (!dryRun && report.errors.length > 0) {
      console.error(`Errors: ${report.errors.length}`);
      for (const error of report.errors) {
        console.error(`  ${error}`);
      }
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(`Knowledge graph reconciliation failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await driver.close();
  }
}

await main();