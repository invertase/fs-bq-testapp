export const CONFIG = {
  collections: {
    stressTest: "stress_test_docs",
  },
  schedules: {
    bulkWrite: "* 9-16 * * *", // Every minute between 9:00-16:59 (9 AM - 5 PM)
    cleanup: "0 0 * * *", // At 00:00 (midnight) every day
  },
  write: {
    totalDocuments: 5000,
    batchSize: 450,
  },
  projectId: process.env.PROJECT_ID || "firestore-bigquery-testing",
  cleanupThresholdHours: 24,
  environment: process.env.ENVIRONMENT || "development",
  bigquery: {
    projectId: process.env.PROJECT_ID || "firestore-bigquery-testing",
    datasetId: "your_dataset",
    tableId: "your_table",
  },
} as const;
