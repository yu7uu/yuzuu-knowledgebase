export class DuplicateKnowledgeItemIdError extends Error {
  readonly id: string;
  readonly filePaths: readonly string[];

  constructor(id: string, filePaths: readonly string[]) {
    super(`duplicate canonical knowledge id "${id}" in files: ${filePaths.join(', ')}`);
    this.name = 'DuplicateKnowledgeItemIdError';
    this.id = id;
    this.filePaths = filePaths;
  }
}

export class InvalidRelationshipTypeError extends Error {
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;

  constructor(type: string, sourceId: string, targetId: string) {
    super(`invalid relationship type "${type}" for ${sourceId} -> ${targetId}`);
    this.name = 'InvalidRelationshipTypeError';
    this.type = type;
    this.sourceId = sourceId;
    this.targetId = targetId;
  }
}

export class Neo4jConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Neo4jConfigurationError';
  }
}