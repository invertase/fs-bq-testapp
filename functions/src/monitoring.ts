// functions/src/monitoring.ts
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { BigQuery } from "@google-cloud/bigquery";

export interface MonitoringReport {
  writeTime: Timestamp;
  before_firestore: number;
  after_firestore: number;
  before_bigquery: number;
  after_bigquery: number;
}

export interface BigQueryConfig {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export class MonitoringService {
  private db = getFirestore();
  private bq: BigQuery;

  constructor(private bqConfig: BigQueryConfig) {
    this.bq = new BigQuery({ projectId: bqConfig.projectId });
  }

  private async getFirestoreCount(collectionPath: string): Promise<number> {
    const snapshot = await this.db.collection(collectionPath).count().get();
    return snapshot.data().count;
  }

  private async getBigQueryCount(): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM \`${this.bqConfig.projectId}.${this.bqConfig.datasetId}.${this.bqConfig.tableId}\`
    `;

    const [rows] = await this.bq.query({ query });
    return Number(rows[0].count);
  }

  async createReport(collectionPath: string): Promise<string> {
    const writeTime = Timestamp.now();

    try {
      // Get counts before operation
      const [beforeFirestore, beforeBigquery] = await Promise.all([
        this.getFirestoreCount(collectionPath),
        this.getBigQueryCount(),
      ]);

      // Store initial metrics with status pending
      const reportRef = this.db.collection("monitoring").doc();
      await reportRef.set({
        writeTime,
        before_firestore: beforeFirestore,
        before_bigquery: beforeBigquery,
        status: "pending",
      });

      return reportRef.id;
    } catch (error) {
      console.error("Error creating initial monitoring report:", error);
      throw error;
    }
  }

  async finalizeReport(
    reportId: string,
    collectionPath: string
  ): Promise<void> {
    try {
      // Get counts after operation
      const [afterFirestore, afterBigquery] = await Promise.all([
        this.getFirestoreCount(collectionPath),
        this.getBigQueryCount(),
      ]);

      // Update the report with final counts
      await this.db.collection("monitoring").doc(reportId).update({
        after_firestore: afterFirestore,
        after_bigquery: afterBigquery,
        status: "completed",
        completedAt: Timestamp.now(),
      });
    } catch (error) {
      // Mark the report as failed but still save the counts if available
      await this.db
        .collection("monitoring")
        .doc(reportId)
        .update({
          status: "failed",
          error: JSON.stringify(error),
          completedAt: Timestamp.now(),
        });

      throw error;
    }
  }
}
