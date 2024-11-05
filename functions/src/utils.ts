// functions/src/utils.ts
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TestDocument } from "./types";
import { CONFIG } from "./config";

export class DocumentGenerator {
  private static testRunId = Math.random().toString(36).substring(7);

  public static generateDocument(): TestDocument {
    return {
      timestamp: Timestamp.now(),
      randomNumber: Math.floor(Math.random() * 1000),
      randomString: Math.random().toString(36).substring(7),
      nestedObject: {
        field1: Math.random().toString(36).substring(7),
        field2: Math.floor(Math.random() * 100),
      },
      arrayField: Array.from({ length: 5 }, () =>
        Math.random().toString(36).substring(7)
      ),
      metadata: {
        createdAt: Timestamp.now(),
        environment: CONFIG.environment,
        testRunId: this.testRunId,
        batchId: Math.random().toString(36).substring(7),
      },
    };
  }
}

export class BatchWriter {
  private db = getFirestore();

  public async writeBatchWithRetry(
    documents: TestDocument[],
    batchNumber: number,
    maxRetries = 3
  ): Promise<number> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const batch = this.db.batch();
        documents.forEach((doc) => {
          const docRef = this.db
            .collection(CONFIG.collections.stressTest)
            .doc();
          batch.set(docRef, doc);
        });
        await batch.commit();
        return documents.length;
      } catch (error) {
        attempt++;
        if (attempt === maxRetries) throw error;
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100)
        );
      }
    }
    return 0;
  }
}
