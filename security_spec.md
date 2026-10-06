# Security Specification — Project 3D Firestore

## 1. Data Invariants
1. **Authentication & Email Verification**: Every read and write to `/estimates/{estimateId}` and `/estimateHistory/{historyId}` requires an authenticated user with `request.auth != null` and `request.auth.token.email_verified == true`.
2. **Strict Ownership & PII Isolation**: Because `/estimates/{estimateId}` contains contact PII (`nombre`, `empresa`, `email`, `telefono`), `get`, `list`, `create`, `update`, and `delete` operations are strictly restricted to the document owner (`resource.data.ownerId == request.auth.uid` on existing documents and `request.resource.data.ownerId == request.auth.uid` on incoming documents).
3. **Path Variable Hardening**: Single-document operations (`get`, `create`, `update`, `delete`) validate `isValidId(estimateId)` and `isValidId(historyId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
4. **Strict Key & Type Enforcement**: All writes use `hasAll` and `hasOnly` on `keys()`, bounded string `.size()` checks matching `firebase-blueprint.json`, and numeric range constraints.
5. **Temporal Integrity & Immutability**: `createdAt` must equal `request.time` on creation and remain immutable on update (`incoming().createdAt == existing().createdAt`). `updatedAt` must equal `request.time` on both creation and update. `ownerId` and `referenceCode` are immutable on update.
6. **Immutable Audit Trail**: Documents in `/estimateHistory/{historyId}` are append-only (`update` is strictly forbidden; only `create`, `get`, `list`, and `delete` by the verified owner are permitted).

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, creating `/estimates/est_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'user_1', token: { email_verified: false } }` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: `auth.uid = 'user_1'`, payload has `ownerId: 'user_2'` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Create**: Payload includes an extra field `isAdmin: true` -> `PERMISSION_DENIED`.
5. **Cross-Tenant PII Read (`get`)**: `auth.uid = 'user_2'` attempting `get` on `/estimates/est_1` owned by `'user_1'` -> `PERMISSION_DENIED`.
6. **Unfiltered `list` Query Scraping**: `auth.uid = 'user_1'` running `list` on `/estimates` without `where('ownerId', '==', 'user_1')` -> `PERMISSION_DENIED`.
7. **Owner Mutation on Update**: `auth.uid = 'user_1'` updating `ownerId` to `'user_2'` -> `PERMISSION_DENIED`.
8. **CreatedAt Tampering on Update**: `auth.uid = 'user_1'` modifying `createdAt` during an update -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: `createdAt` or `updatedAt` not matching `request.time` -> `PERMISSION_DENIED`.
10. **String Overflow (Denial of Wallet)**: `observaciones` string with 5,000 characters (> 1,000 maxLength) -> `PERMISSION_DENIED`.
11. **Invalid Reference Code Pattern**: `referenceCode: 'INVALID_CODE'` not matching `^P3D-[0-9]{4,8}$` -> `PERMISSION_DENIED`.
12. **Audit Log Mutation**: Attempting `update` on `/estimateHistory/hist_1` -> `PERMISSION_DENIED`.
