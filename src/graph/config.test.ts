import { describe, expect, it } from 'vitest';
import { loadNeo4jConfig, Neo4jConfigurationError } from './index.ts';
import type { Environment } from './config.ts';

const validEnv: Environment = {
  NEO4J_URI: 'bolt://localhost:7687',
  NEO4J_USERNAME: 'neo4j',
  NEO4J_PASSWORD: 'local-dev-password',
};

describe('loadNeo4jConfig', () => {
  it('returns an error listing the missing variables when none are set', () => {
    expect(() => loadNeo4jConfig({})).toThrow(Neo4jConfigurationError);
    try {
      loadNeo4jConfig({});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Neo4jConfigurationError);
      const message = (error as Neo4jConfigurationError).message;
      expect(message).toContain('NEO4J_URI');
      expect(message).toContain('NEO4J_USERNAME');
      expect(message).toContain('NEO4J_PASSWORD');
    }
  });

  it('reports exactly which variables are missing', () => {
    try {
      loadNeo4jConfig({ NEO4J_URI: 'bolt://localhost:7687' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Neo4jConfigurationError).message;
      expect(message).toContain('NEO4J_USERNAME');
      expect(message).toContain('NEO4J_PASSWORD');
      expect(message).not.toContain('NEO4J_URI');
    }
  });

  it('returns the expected typed configuration for valid variables', () => {
    expect(loadNeo4jConfig(validEnv)).toEqual({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'local-dev-password',
    });
  });

  it('trims whitespace around the uri and username', () => {
    expect(
      loadNeo4jConfig({
        NEO4J_URI: '  bolt://localhost:7687  ',
        NEO4J_USERNAME: '  neo4j  ',
        NEO4J_PASSWORD: 'pwd',
      }),
    ).toEqual({ uri: 'bolt://localhost:7687', username: 'neo4j', password: 'pwd' });
  });

  it('rejects an unsupported uri scheme without repeating the password', () => {
    try {
      loadNeo4jConfig({ ...validEnv, NEO4J_URI: 'http://localhost:7474' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Neo4jConfigurationError);
      const message = (error as Neo4jConfigurationError).message;
      expect(message).toContain('bolt:// or neo4j://');
      expect(message).not.toContain('local-dev-password');
    }
  });

  it('never includes the password value in any error message', () => {
    try {
      loadNeo4jConfig({
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_PASSWORD: validEnv.NEO4J_PASSWORD,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Neo4jConfigurationError).message;
      expect(message).not.toContain('local-dev-password');
    }
  });
});