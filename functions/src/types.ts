export interface TestDocument {
  timestamp: FirebaseFirestore.Timestamp;
  randomNumber: number;
  randomString: string;
  nestedObject: {
    field1: string;
    field2: number;
  };
  arrayField: string[];
  metadata: {
    createdAt: FirebaseFirestore.Timestamp;
    environment: string;
    testRunId: string;
    batchId: string;
  };
}
