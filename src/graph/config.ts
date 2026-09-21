import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { Neo4jConfigurationError } from './errors.ts';

export interface Neo4jConnectionConfig {
  uri: string;
  username: string;
  password: string;
}

export type Environment = Record<string, string | undefined>;

export function loadNeo4jConfig(env: Environment = process.env): Neo4jConnectionConfig {
  const uri = env.NEO4J_URI?.trim() ?? '';
  const username = env.NEO4J_USERNAME?.trim() ?? '';
  const password = env.NEO4J_PASSWORD ?? '';

  const missing: string[] = [];
  if (uri === '') missing.push('NEO4J_URI');
  if (username === '') missing.push('NEO4J_USERNAME');
  if (password === '') missing.push('NEO4J_PASSWORD');
  if (missing.length > 0) {
    throw new Neo4jConfigurationError(
      `missing Neo4j environment variables: ${missing.join(', ')}`,
    );
  }

  if (!/^(bolt|neo4j)(\+s|\+ssc)?:\/\//.test(uri)) {
    throw new Neo4jConfigurationError(
      `NEO4J_URI must use a bolt:// or neo4j:// scheme (got "${uri}")`,
    );
  }

  return { uri, username, password };
}

export function createNeo4jDriver(config: Neo4jConnectionConfig): Driver {
  return neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
}