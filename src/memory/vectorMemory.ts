import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";

export interface MemoryRecord {
  id: string;
  namespace: string;
  content: string;
  metadata: Record<string, any>;
  embedding: number[];
  createdAt: string;
  score?: number;
}

export class VectorMemoryStore {
  private localStore: Map<string, MemoryRecord[]> = new Map();
  private dbInitialized = false;

  public async initDb(): Promise<void> {
    if (this.dbInitialized) return;
    try {
      await db.query(`
        CREATE SCHEMA IF NOT EXISTS system;
        CREATE TABLE IF NOT EXISTS system.agent_memories (
          id UUID PRIMARY KEY,
          namespace TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          embedding FLOAT8[] NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_agent_memories_namespace 
        ON system.agent_memories(namespace);
      `);
      this.dbInitialized = true;
    } catch {
      // Postgres unavailable; gracefully rely on local autonomous store
    }
  }

  public async store(
    namespace: string,
    content: string,
    embedding: number[],
    metadata: Record<string, any> = {}
  ): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: randomUUID(),
      namespace: namespace.toLowerCase(),
      content,
      metadata,
      embedding,
      createdAt: new Date().toISOString(),
    };

    // Store in local autonomous memory
    const existing = this.localStore.get(record.namespace) || [];
    existing.push(record);
    this.localStore.set(record.namespace, existing);

    // Attempt PostgreSQL persistence asynchronously
    try {
      await this.initDb();
      if (this.dbInitialized) {
        await db.query(
          `INSERT INTO system.agent_memories (id, namespace, content, metadata, embedding, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [record.id, record.namespace, record.content, JSON.stringify(record.metadata), record.embedding, record.createdAt]
        );
      }
    } catch {
      // Retained in local store
    }

    return record;
  }

  public async search(
    namespace: string,
    queryEmbedding: number[],
    topK = 5,
    minScore = -1.0
  ): Promise<MemoryRecord[]> {
    const ns = namespace.toLowerCase();
    const records = this.localStore.get(ns) || [];

    const scored = records
      .map((rec) => ({
        ...rec,
        score: this.cosineSimilarity(rec.embedding, queryEmbedding),
      }))
      .filter((rec) => (rec.score ?? 0) >= minScore)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);

    return scored;
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i];
      const b = vecB[i];
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  public clearNamespace(namespace: string): void {
    this.localStore.delete(namespace.toLowerCase());
  }
}

export const vectorMemory = new VectorMemoryStore();
