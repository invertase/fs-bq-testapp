import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import { TestDocument } from "./types";
import { CONFIG } from "./config";

// functions/src/index.ts
import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { DocumentGenerator, BatchWriter } from "./utils";
import { BigQueryConfig, MonitoringService } from "./monitoring";

initializeApp({
  projectId: CONFIG.projectId,
});
const db = getFirestore();

const baseOpts = {
  memory: "1GiB" as const, // Increased memory for larger batches
  region: "us-central1",
  timeoutSeconds: 540, // Increased timeout
  retryCount: 3,
  maxInstances: 1,
};

export const bulkWriteDocuments = onSchedule(
  {
    ...baseOpts,
    schedule: CONFIG.schedules.bulkWrite,
  },
  async (event) => {
    const startTime = Date.now();
    const batchWriter = new BatchWriter();
    let totalWritten = 0;
    const batches: Promise<number>[] = [];

    const monitoring = new MonitoringService(CONFIG.bigquery);
    let reportId: string = "failed-to-create-report";

    try {
      // Create initial monitoring report
      reportId = await monitoring.createReport(CONFIG.collections.stressTest);

      // Calculate number of full batches needed
      const numberOfBatches = Math.ceil(
        CONFIG.write.totalDocuments / CONFIG.write.batchSize
      );

      for (let i = 0; i < numberOfBatches; i++) {
        const docsInThisBatch =
          i === numberOfBatches - 1
            ? CONFIG.write.totalDocuments - i * CONFIG.write.batchSize
            : CONFIG.write.batchSize;

        const documents = Array.from({ length: docsInThisBatch }, () =>
          DocumentGenerator.generateDocument()
        );

        batches.push(batchWriter.writeBatchWithRetry(documents, i));
      }

      // Wait for all batches to complete
      const results = await Promise.all(batches);
      totalWritten = results.reduce((acc, curr) => acc + curr, 0);

      // Finalize monitoring report
      await monitoring.finalizeReport(reportId, CONFIG.collections.stressTest);

      const endTime = Date.now();
      logger.info("Bulk write completed", {
        documentsWritten: totalWritten,
        collection: CONFIG.collections.stressTest,
        durationMs: endTime - startTime,
        batchesProcessed: numberOfBatches,
        monitoringReportId: reportId,
      });
    } catch (error) {
      logger.error("Error in bulk write", { error, totalWritten, reportId });
      throw error;
    }
  }
);

export const cleanupOldDocuments = onSchedule(
  {
    ...baseOpts,
    schedule: CONFIG.schedules.cleanup,
  },
  async (event) => {
    try {
      const threshold = Timestamp.fromDate(
        new Date(Date.now() - CONFIG.cleanupThresholdHours * 60 * 60 * 1000)
      );
      let totalDeleted = 0;

      while (true) {
        const snapshot = await db
          .collection(CONFIG.collections.stressTest)
          .where("timestamp", "<", threshold)
          .limit(500)
          .get();

        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        totalDeleted += snapshot.size;

        // If less than 500 documents were returned, we're done
        if (snapshot.size < 500) break;
      }

      logger.info("Cleanup completed", {
        deletedCount: totalDeleted,
        collection: CONFIG.collections.stressTest,
      });
    } catch (error) {
      logger.error("Error in cleanup", { error });
      throw error;
    }
  }
);
