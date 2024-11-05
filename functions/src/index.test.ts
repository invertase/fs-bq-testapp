// functions/src/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { CONFIG } from "./config";
import { ScheduledEvent } from "firebase-functions/v2/scheduler";
import { bulkWriteDocuments, cleanupOldDocuments } from "./index";

// Mock firebase-admin/firestore
vi.mock("firebase-admin/firestore", () => {
  const mockBatch = {
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(),
  };

  const mockCollection = {
    doc: vi.fn(),
    where: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    batch: vi.fn(() => mockBatch),
  };

  return {
    getFirestore: vi.fn(() => mockDb),
    Timestamp: {
      now: () => ({ seconds: 1234567890, nanoseconds: 123456789 }),
      fromDate: vi.fn(),
    },
  };
});

// Mock firebase-functions
vi.mock("firebase-functions", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

let mockCreateReport: any;
let mockFinalizeReport: any;

vi.mock("./monitoring", () => {
  return {
    MonitoringService: vi.fn().mockImplementation(() => ({
      createReport: mockCreateReport,
      finalizeReport: mockFinalizeReport,
    })),
  };
});

const mockScheduledEvent: ScheduledEvent = {
  scheduleTime: new Date().toISOString(),
  jobName: "test-job",
};

describe("Cloud Functions", () => {
  const mockedLogger = vi.mocked(logger);
  let db: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = vi.mocked(getFirestore());
    mockScheduledEvent.scheduleTime = new Date().toISOString();

    // Reset mock functions for each test
    mockCreateReport = vi.fn().mockResolvedValue("test-report-id");
    mockFinalizeReport = vi.fn().mockResolvedValue(undefined);
  });

  describe("bulkWriteDocuments", () => {
    it("should execute bulk write successfully", async () => {
      // Setup
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);

      // Execute
      const handler = bulkWriteDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      expect(mockCreateReport).toHaveBeenCalledWith(
        CONFIG.collections.stressTest
      );
      expect(mockFinalizeReport).toHaveBeenCalledWith(
        "test-report-id",
        CONFIG.collections.stressTest
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "Bulk write completed",
        expect.objectContaining({
          documentsWritten: expect.any(Number),
          collection: CONFIG.collections.stressTest,
          durationMs: expect.any(Number),
          batchesProcessed: expect.any(Number),
          monitoringReportId: "test-report-id",
        })
      );
    });

    it("should handle bulk write errors", async () => {
      // Setup
      const mockBatch = db.batch();
      mockBatch.commit.mockRejectedValue(new Error("Bulk write failed"));

      // Execute & Verify
      const handler = bulkWriteDocuments.run;
      await expect(handler(mockScheduledEvent)).rejects.toThrow(
        "Bulk write failed"
      );

      expect(mockCreateReport).toHaveBeenCalled();
      expect(mockedLogger.error).toHaveBeenCalledWith(
        "Error in bulk write",
        expect.objectContaining({
          error: expect.any(Error),
          reportId: "test-report-id",
        })
      );
    });

    it("should handle monitoring errors", async () => {
      // Setup
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);
      mockCreateReport.mockRejectedValue(new Error("Monitoring failed"));

      // Execute & Verify
      const handler = bulkWriteDocuments.run;
      await expect(handler(mockScheduledEvent)).rejects.toThrow(
        "Monitoring failed"
      );

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "Error in bulk write",
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });

    it("should handle finalize report errors", async () => {
      // Setup
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);
      mockFinalizeReport.mockRejectedValue(new Error("Finalize failed"));

      // Execute & Verify
      const handler = bulkWriteDocuments.run;
      await expect(handler(mockScheduledEvent)).rejects.toThrow(
        "Finalize failed"
      );

      expect(mockCreateReport).toHaveBeenCalled();
      expect(mockedLogger.error).toHaveBeenCalledWith(
        "Error in bulk write",
        expect.objectContaining({
          error: expect.any(Error),
          reportId: "test-report-id",
        })
      );
    });
  });

  describe("cleanupOldDocuments", () => {
    it("should execute cleanup successfully", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: false,
          size: 3,
          docs: Array(3).fill({ ref: { id: "doc" } }),
        }),
      };

      db.collection.mockReturnValue(mockQuery);
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);

      // Execute
      const handler = cleanupOldDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "Cleanup completed",
        expect.objectContaining({
          deletedCount: 3,
          collection: CONFIG.collections.stressTest,
        })
      );
    });

    it("should handle empty snapshots", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: true,
          size: 0,
          docs: [],
        }),
      };

      db.collection.mockReturnValue(mockQuery);

      // Execute
      const handler = cleanupOldDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "Cleanup completed",
        expect.objectContaining({
          deletedCount: 0,
          collection: CONFIG.collections.stressTest,
        })
      );
    });

    it("should handle cleanup errors", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error("Cleanup failed")),
      };

      db.collection.mockReturnValue(mockQuery);

      // Execute & Verify
      const handler = cleanupOldDocuments.run;
      await expect(handler(mockScheduledEvent)).rejects.toThrow(
        "Cleanup failed"
      );

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "Error in cleanup",
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });

    it("should process all documents in batches", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi
          .fn()
          .mockResolvedValueOnce({
            empty: false,
            size: 500,
            docs: Array(500).fill({ ref: { id: "doc" } }),
          })
          .mockResolvedValueOnce({
            empty: false,
            size: 300,
            docs: Array(300).fill({ ref: { id: "doc" } }),
          })
          .mockResolvedValueOnce({
            empty: true,
            size: 0,
            docs: [],
          }),
      };

      db.collection.mockReturnValue(mockQuery);
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);

      // Execute
      const handler = cleanupOldDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "Cleanup completed",
        expect.objectContaining({
          deletedCount: 800,
          collection: CONFIG.collections.stressTest,
        })
      );
    });

    it("should use correct threshold time", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: true,
          size: 0,
          docs: [],
        }),
      };

      db.collection.mockReturnValue(mockQuery);
      const now = new Date();
      vi.setSystemTime(now);

      // Execute
      const handler = cleanupOldDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      const expectedThreshold = new Date(
        now.getTime() - CONFIG.cleanupThresholdHours * 60 * 60 * 1000
      );
      expect(Timestamp.fromDate).toHaveBeenCalledWith(expectedThreshold);
    });

    it("should stop processing when batch size is less than 500", async () => {
      // Setup
      const mockQuery = {
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: false,
          size: 300,
          docs: Array(300).fill({ ref: { id: "doc" } }),
        }),
      };

      db.collection.mockReturnValue(mockQuery);
      const mockBatch = db.batch();
      mockBatch.commit.mockResolvedValue([]);

      // Execute
      const handler = cleanupOldDocuments.run;
      await handler(mockScheduledEvent);

      // Verify
      expect(mockQuery.get).toHaveBeenCalledTimes(1);
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "Cleanup completed",
        expect.objectContaining({
          deletedCount: 300,
          collection: CONFIG.collections.stressTest,
        })
      );
    });
  });
});
