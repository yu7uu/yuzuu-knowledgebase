import { resolve } from 'node:path';
import { discoverKnowledgeFiles, loadKnowledgeFile } from '../knowledge/index.ts';
import {
  applyKnowledgeGraphProjection,
  createNeo4jDriver,
  ensureKnowledgeGraphSchema,
  loadNeo4jConfig,
  projectKnowledgeGraph,
} from '../graph/index.ts';
import type { KnowledgeDocument } from '../knowledge/loader.ts';

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
    throw new Error(`knowledge validation failed (${loadErrors.length} invalid file(s)):\n  ${loadErrors.join('\n  ')}`);
  }
  return documents;
}

async function main(): Promise<void> {
  const repoRoot = resolve(process.cwd());
  const knowledgeRoot = resolve(repoRoot, 'knowledge');

  let config;
  try {
    config = loadNeo4jConfig();
  } catch (error) {
    console.error(`Knowledge graph sync failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let documents: KnowledgeDocument[];
  try {
    documents = await loadAllKnowledgeFiles(knowledgeRoot);
  } catch (error) {
    console.error(`Knowledge graph sync failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  let projection;
  try {
    projection = projectKnowledgeGraph(documents, repoRoot);
  } catch (error) {
    console.error(`Knowledge graph sync failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    await ensureKnowledgeGraphSchema(driver);
    const report = await applyKnowledgeGraphProjection(driver, projection);

    console.log('Knowledge graph sync complete');
    console.log(`Documents loaded: ${documents.length}`);
    console.log(`Nodes projected: ${report.nodesProjected}, created: ${report.nodesCreated}`);
    console.log(`Relationships projected: ${report.relationshipsProjected}, created: ${report.relationshipsCreated}`);
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
    if (report.errors.length > 0) {
      console.error(`Errors: ${report.errors.length}`);
      for (const error of report.errors) {
        console.error(`  ${error}`);
      }
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(`Knowledge graph sync failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await driver.close();
  }
}

await main();