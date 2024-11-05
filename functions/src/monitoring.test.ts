// functions/src/monitoring.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitoringService } from "./monitoring";

// Set up mocks
const mockCountGet = vi.fn();
const mockDocSet = vi.fn();
const mockDocUpdate = vi.fn();
const mockBigQueryQuery = vi.fn();

// Mock firebase-admin/firestore
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: mockDocSet,
        update: mockDocUpdate,
        id: "test-report-id",
      })),
      count: vi.fn(() => ({
        get: mockCountGet,
      })),
    })),
  })),
  Timestamp: {
    now: () => ({ seconds: 1234567890, nanoseconds: 123456789 }),
  },
}));

// Mock @google-cloud/bigquery
vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn(() => ({
    query: mockBigQueryQuery,
  })),
}));

describe("MonitoringService", () => {
  let monitoringService: MonitoringService;

  const testConfig = {
    projectId: "test-project",
    datasetId: "test_dataset",
    tableId: "test_table",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful responses
    mockCountGet.mockResolvedValue({ data: () => ({ count: 200 }) });
    mockBigQueryQuery.mockResolvedValue([[{ count: 100 }]]);
    mockDocSet.mockResolvedValue(undefined);
    mockDocUpdate.mockResolvedValue(undefined);

    monitoringService = new MonitoringService(testConfig);
  });

  describe("createReport", () => {
    it("should create initial report successfully", async () => {
      const reportId = await monitoringService.createReport("test-collection");

      expect(reportId).toBe("test-report-id");
      expect(mockCountGet).toHaveBeenCalled();
      expect(mockBigQueryQuery).toHaveBeenCalledWith({
        query: expect.stringContaining(testConfig.tableId),
      });
      expect(mockDocSet).toHaveBeenCalledWith({
        writeTime: expect.any(Object),
        before_firestore: 200,
        before_bigquery: 100,
        status: "pending",
      });
    });

    it("should handle Firestore count errors", async () => {
      mockCountGet.mockRejectedValue(new Error("Count failed"));

      await expect(
        monitoringService.createReport("test-collection")
      ).rejects.toThrow("Count failed");

      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it("should handle BigQuery errors", async () => {
      mockBigQueryQuery.mockRejectedValue(new Error("BigQuery failed"));

      await expect(
        monitoringService.createReport("test-collection")
      ).rejects.toThrow("BigQuery failed");

      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe("finalizeReport", () => {
    it("should finalize report successfully", async () => {
      await monitoringService.finalizeReport(
        "test-report-id",
        "test-collection"
      );

      expect(mockDocUpdate).toHaveBeenCalledWith({
        after_firestore: 200,
        after_bigquery: 100,
        status: "completed",
        completedAt: expect.any(Object),
      });
    });

    it("should handle Firestore count errors during finalization", async () => {
      const error = new Error("Count failed");
      mockCountGet.mockRejectedValue(error);

      await expect(
        monitoringService.finalizeReport("test-report-id", "test-collection")
      ).rejects.toThrow("Count failed");

      // Check that update was called with the stringified error
      const expectedError = JSON.stringify(new Error("Count failed"));
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expectedError,
          completedAt: expect.any(Object),
        })
      );
    });

    it("should handle BigQuery errors during finalization", async () => {
      const error = new Error("BigQuery failed");
      mockBigQueryQuery.mockRejectedValue(error);

      await expect(
        monitoringService.finalizeReport("test-report-id", "test-collection")
      ).rejects.toThrow("BigQuery failed");

      // Check that update was called with the stringified error
      const expectedError = JSON.stringify(new Error("BigQuery failed"));
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expectedError,
          completedAt: expect.any(Object),
        })
      );
    });
  });
});
