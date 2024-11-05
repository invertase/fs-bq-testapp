// functions/src/utils.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DocumentGenerator, BatchWriter } from "./utils";
import { TestDocument } from "./types";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { CONFIG } from "./config";

// Mock firebase-admin/firestore
vi.mock("firebase-admin/firestore", () => {
  const mockTimestamp = {
    now: () => ({ seconds: 1234567890, nanoseconds: 123456789 }),
  };

  const mockBatch = {
    set: vi.fn(),
    commit: vi.fn(),
  };

  const mockDocRef = {
    id: "mock-doc-id",
  };

  const mockCollection = {
    doc: vi.fn().mockReturnValue(mockDocRef),
  };

  const mockDb = {
    collection: vi.fn().mockReturnValue(mockCollection),
    batch: vi.fn().mockReturnValue(mockBatch),
  };

  return {
    getFirestore: vi.fn().mockReturnValue(mockDb),
    Timestamp: mockTimestamp,
  };
});

// 1. Checks if generated documents have all the required fields and nested fields
// 2. Verifies that each field has the correct data type (numbers are numbers, strings are strings, etc.)
// 3. Makes sure all documents from the same test run share the same testRunId
// 4. Confirms random numbers are generated within their specified ranges (0-1000 and 0-100)
describe("DocumentGenerator", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a document with all required fields", () => {
    const doc = DocumentGenerator.generateDocument();

    expect(doc).toHaveProperty("timestamp");
    expect(doc).toHaveProperty("randomNumber");
    expect(doc).toHaveProperty("randomString");
    expect(doc).toHaveProperty("nestedObject");
    expect(doc).toHaveProperty("arrayField");
    expect(doc).toHaveProperty("metadata");

    expect(doc.nestedObject).toHaveProperty("field1");
    expect(doc.nestedObject).toHaveProperty("field2");

    expect(doc.metadata).toHaveProperty("createdAt");
    expect(doc.metadata).toHaveProperty("environment");
    expect(doc.metadata).toHaveProperty("testRunId");
    expect(doc.metadata).toHaveProperty("batchId");
  });

  it("should generate valid data types", () => {
    const doc = DocumentGenerator.generateDocument();

    expect(doc.timestamp).toBeInstanceOf(Object);
    expect(typeof doc.randomNumber).toBe("number");
    expect(typeof doc.randomString).toBe("string");
    expect(typeof doc.nestedObject.field1).toBe("string");
    expect(typeof doc.nestedObject.field2).toBe("number");
    expect(Array.isArray(doc.arrayField)).toBe(true);
    expect(doc.arrayField).toHaveLength(5);
  });

  it("should generate documents with the same testRunId", () => {
    const doc1 = DocumentGenerator.generateDocument();
    const doc2 = DocumentGenerator.generateDocument();

    expect(doc1.metadata.testRunId).toBe(doc2.metadata.testRunId);
  });

  it("should generate random numbers within expected ranges", () => {
    const doc = DocumentGenerator.generateDocument();

    expect(doc.randomNumber).toBeGreaterThanOrEqual(0);
    expect(doc.randomNumber).toBeLessThan(1000);
    expect(doc.nestedObject.field2).toBeGreaterThanOrEqual(0);
    expect(doc.nestedObject.field2).toBeLessThan(100);
  });
});

// BatchWriter tests:

// 1. Checks if it can write documents successfully on first try
// 2. Verifies retry behavior - if it fails once, it should try again and succeed
// 3. Tests that it gives up after hitting max retry attempts
// 4. Makes sure it's writing to the correct Firestore collection
// 5. Confirms it can handle an empty list of documents without crashing
// 6. Verifies it respects the custom max retries parameter (if you say try 2 times, it should try exactly 2 times)
describe("BatchWriter", () => {
  let batchWriter: BatchWriter;
  let mockDocuments: TestDocument[];
  let db: any;
  let mockBatch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    batchWriter = new BatchWriter();
    mockDocuments = Array(3)
      .fill(null)
      .map(() => DocumentGenerator.generateDocument());

    db = vi.mocked(getFirestore());
    mockBatch = db.batch();
    // Set default successful behavior
    vi.mocked(mockBatch.commit).mockResolvedValue([]);
  });

  it("should successfully write documents on first attempt", async () => {
    const result = await batchWriter.writeBatchWithRetry(mockDocuments, 1);
    expect(result).toBe(mockDocuments.length);
  });

  it("should retry on failure and eventually succeed", async () => {
    vi.mocked(mockBatch.commit)
      .mockRejectedValueOnce(new Error("Temporary error"))
      .mockResolvedValueOnce([]);

    const result = await batchWriter.writeBatchWithRetry(mockDocuments, 1);

    expect(result).toBe(mockDocuments.length);
    expect(mockBatch.commit).toHaveBeenCalledTimes(2);
  });

  it("should fail after max retries", async () => {
    vi.mocked(mockBatch.commit).mockRejectedValue(
      new Error("Persistent error")
    );

    await expect(
      batchWriter.writeBatchWithRetry(mockDocuments, 1)
    ).rejects.toThrow("Persistent error");
  });

  it("should use correct collection from CONFIG", async () => {
    await batchWriter.writeBatchWithRetry(mockDocuments, 1);

    expect(db.collection).toHaveBeenCalledWith(CONFIG.collections.stressTest);
  });

  it("should handle empty document array", async () => {
    const result = await batchWriter.writeBatchWithRetry([], 1);
    expect(result).toBe(0);
  });

  it("should respect maxRetries parameter", async () => {
    const customMaxRetries = 2;
    vi.mocked(mockBatch.commit).mockRejectedValue(new Error("Test error"));

    await expect(
      batchWriter.writeBatchWithRetry(mockDocuments, 1, customMaxRetries)
    ).rejects.toThrow("Test error");

    expect(mockBatch.commit).toHaveBeenCalledTimes(customMaxRetries);
  });
});
