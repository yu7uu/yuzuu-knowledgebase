import { readFile } from 'node:fs/promises';
import { parseKnowledgeDocument } from './parse.js';
import type { ParsedKnowledgeDocument } from './parse.js';

export interface KnowledgeDocument extends ParsedKnowledgeDocument {
  filePath: string;
}

export async function loadKnowledgeFile(filePath: string): Promise<KnowledgeDocument> {
  const text = await readFile(filePath, 'utf8');
  const { metadata, body } = parseKnowledgeDocument(text, filePath);
  return { metadata, body, filePath };
}