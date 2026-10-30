import { randomUUID } from "node:crypto";
import { MongoClient, MongoServerError, type Collection } from "mongodb";

export type LegacyRecoveryRequest = {
  requestId: string;
  learnerId: string;
  replyEmail: string;
  createdAt: string;
  status: "pending" | "closed";
  closedAt?: string;
};

export interface LegacyRecoveryRequestInbox {
  submit(learnerId: string, replyEmail: string): Promise<LegacyRecoveryRequest>;
}

// A private support channel using the existing database configuration. There is
// deliberately no device/deck lookup and no public inbox-reading endpoint.
export class MongoLegacyRecoveryRequestInbox implements LegacyRecoveryRequestInbox {
  private collectionPromise: Promise<Collection<LegacyRecoveryRequest>> | undefined;
  private client: MongoClient | undefined;

  private getCollection(): Promise<Collection<LegacyRecoveryRequest>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.connect().catch(async error => {
        this.collectionPromise = undefined;
        await this.client?.close();
        this.client = undefined;
        throw error;
      });
    }
    return this.collectionPromise;
  }

  private async connect(): Promise<Collection<LegacyRecoveryRequest>> {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) throw new Error("The private recovery support inbox is not configured.");
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await this.client.connect();
    const collection = this.client.db(process.env.MONGODB_DATABASE || undefined)
      .collection<LegacyRecoveryRequest>("skillswipe_recovery_requests");
    // Atomic deduplication across retries, concurrent requests, and API instances.
    await collection.createIndex(
      { learnerId: 1 },
      { unique: true, partialFilterExpression: { status: "pending" } },
    );
    await collection.createIndex({ requestId: 1 }, { unique: true });
    return collection;
  }

  async submit(learnerId: string, replyEmail: string): Promise<LegacyRecoveryRequest> {
    const collection = await this.getCollection();
    const filter = { learnerId, status: "pending" as const };
    try {
      const request = await collection.findOneAndUpdate(filter, {
        $setOnInsert: {
          requestId: randomUUID(), learnerId, replyEmail,
          createdAt: new Date().toISOString(), status: "pending",
        },
      }, { upsert: true, returnDocument: "after" });
      if (!request) throw new Error("The recovery request was not saved.");
      return request;
    } catch (error) {
      // Another process may have won the unique-index race on first submission.
      if (error instanceof MongoServerError && error.code === 11000) {
        const existing = await collection.findOne(filter);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async *listPending(): AsyncGenerator<LegacyRecoveryRequest> {
    const collection = await this.getCollection();
    for await (const request of collection.find({ status: "pending" }).sort({ createdAt: 1 })) {
      yield {
        requestId: request.requestId, learnerId: request.learnerId,
        replyEmail: request.replyEmail, createdAt: request.createdAt, status: request.status,
      };
    }
  }

  async closeRequest(requestId: string): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.updateOne({ requestId, status: "pending" }, {
      $set: { status: "closed", closedAt: new Date().toISOString() },
    });
    return result.matchedCount === 1;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.collectionPromise = undefined;
  }
}
