/**
 * Security Rules Verification Suite — Project 3D
 * Verifies the "Dirty Dozen" adversarial payloads against /estimates/{estimateId} and /estimateHistory/{historyId}.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collection: 'estimates' | 'estimateHistory';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated create on /estimates/est_1',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: null, ownerId: 'user_1', referenceCode: 'P3D-1001' },
  },
  {
    id: 2,
    name: 'Unverified email spoof attack on /estimates/est_1',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: false }, ownerId: 'user_1', referenceCode: 'P3D-1001' },
  },
  {
    id: 3,
    name: 'Identity spoofing (ownerId mismatch) on create',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, ownerId: 'user_2', referenceCode: 'P3D-1001' },
  },
  {
    id: 4,
    name: 'Shadow field injection (isVerified: true) on create',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, ownerId: 'user_1', isVerified: true },
  },
  {
    id: 5,
    name: 'Cross-tenant PII read (get by non-owner)',
    collection: 'estimates',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_2', email_verified: true }, targetDocOwnerId: 'user_1' },
  },
  {
    id: 6,
    name: 'Unfiltered list query scraping across users',
    collection: 'estimates',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_2', email_verified: true }, queryFilter: null },
  },
  {
    id: 7,
    name: 'Owner mutation during update',
    collection: 'estimates',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, ownerId: 'user_2' },
  },
  {
    id: 8,
    name: 'Immortal field (createdAt) mutation during update',
    collection: 'estimates',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, createdAt: '2020-01-01T00:00:00Z' },
  },
  {
    id: 9,
    name: 'Client timestamp forgery (updatedAt != request.time)',
    collection: 'estimates',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, updatedAt: '2099-01-01T00:00:00Z' },
  },
  {
    id: 10,
    name: 'Denial of Wallet string overflow (observaciones > 1000 chars)',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, observacionesLength: 5000 },
  },
  {
    id: 11,
    name: 'Invalid referenceCode pattern injection',
    collection: 'estimates',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, referenceCode: 'DROP_TABLE_ESTIMATES' },
  },
  {
    id: 12,
    name: 'Immutable audit trail mutation on /estimateHistory/hist_1',
    collection: 'estimateHistory',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { auth: { uid: 'user_1', email_verified: true }, summary: 'Tampered history entry' },
  },
];
