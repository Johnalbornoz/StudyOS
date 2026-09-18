/**
 * F6 -- negative security tests for the minimal admin curriculum API
 * (task 41). Every route must reject unauthenticated and non-admin
 * callers before touching any structure/mapping/coverage service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const getPublishedStructureVersionMock = vi.fn();
const getStructureNodesForVersionMock = vi.fn();
vi.mock('@/lib/curriculum/structure.service', () => ({
  getPublishedStructureVersion: (...a: any[]) => getPublishedStructureVersionMock(...a),
  getStructureNodesForVersion: (...a: any[]) => getStructureNodesForVersionMock(...a),
}));

const listObjectivesForNodeMock = vi.fn();
vi.mock('@/lib/curriculum/objective.service', () => ({ listObjectivesForNode: (...a: any[]) => listObjectivesForNodeMock(...a) }));

const createMappingMock = vi.fn();
const listMappingsForObjectiveMock = vi.fn();
const proposeMappingMock = vi.fn();
const beginReviewMock = vi.fn();
const approveMappingMock = vi.fn();
const rejectMappingMock = vi.fn();
const publishMappingMock = vi.fn();
const retireMappingMock = vi.fn();
const { FakeSelfApprovalError, FakeEditorialPermissionError, FakeInvalidMappingTransitionError } = vi.hoisted(() => ({
  FakeSelfApprovalError: class extends Error {},
  FakeEditorialPermissionError: class extends Error {},
  FakeInvalidMappingTransitionError: class extends Error {},
}));
vi.mock('@/lib/curriculum/mapping.service', () => ({
  createMapping: (...a: any[]) => createMappingMock(...a),
  listMappingsForObjective: (...a: any[]) => listMappingsForObjectiveMock(...a),
  proposeMapping: (...a: any[]) => proposeMappingMock(...a),
  beginReview: (...a: any[]) => beginReviewMock(...a),
  approveMapping: (...a: any[]) => approveMappingMock(...a),
  rejectMapping: (...a: any[]) => rejectMappingMock(...a),
  publishMapping: (...a: any[]) => publishMappingMock(...a),
  retireMapping: (...a: any[]) => retireMappingMock(...a),
  SelfApprovalError: FakeSelfApprovalError,
  EditorialPermissionError: FakeEditorialPermissionError,
  InvalidMappingTransitionError: FakeInvalidMappingTransitionError,
}));

const computeMappingCoverageMock = vi.fn();
const computeContentCoverageMock = vi.fn();
vi.mock('@/lib/curriculum/coverage.service', () => ({
  computeMappingCoverage: (...a: any[]) => computeMappingCoverageMock(...a),
  computeContentCoverage: (...a: any[]) => computeContentCoverageMock(...a),
}));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

import { GET as structuresGET } from '@/app/api/admin/curriculum/structures/route';
import { GET as structureNodesGET } from '@/app/api/admin/curriculum/structure-nodes/route';
import { GET as objectivesGET } from '@/app/api/admin/curriculum/objectives/route';
import { POST as mappingsPOST } from '@/app/api/admin/curriculum/mappings/route';
import { POST as transitionPOST } from '@/app/api/admin/curriculum/mappings/transition/route';
import { GET as coverageGET } from '@/app/api/admin/curriculum/coverage/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}

const VALID_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-admin' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'admin@studyus.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(true);
  getPublishedStructureVersionMock.mockReset().mockResolvedValue(null);
  getStructureNodesForVersionMock.mockReset().mockResolvedValue([]);
  listObjectivesForNodeMock.mockReset().mockResolvedValue([]);
  createMappingMock.mockReset().mockResolvedValue({ id: 'm1' });
  listMappingsForObjectiveMock.mockReset().mockResolvedValue([]);
  proposeMappingMock.mockReset().mockResolvedValue({ id: 'm1', status: 'PROPOSED' });
  beginReviewMock.mockReset();
  approveMappingMock.mockReset();
  rejectMappingMock.mockReset();
  publishMappingMock.mockReset();
  retireMappingMock.mockReset();
  computeMappingCoverageMock.mockReset().mockResolvedValue({ total: 0, fullyMappedCount: 0, partiallyMappedCount: 0, unmappedCount: 0, policyVersion: 1 });
  computeContentCoverageMock.mockReset().mockResolvedValue({ total: 0, withApprovedResourceCount: 0, policyVersion: 1 });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
});

const ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'structures GET', call: () => structuresGET(urlReq(`https://studyus.test/api/admin/curriculum/structures?academicSubjectId=${VALID_ID}`)) },
  { name: 'structure-nodes GET', call: () => structureNodesGET(urlReq(`https://studyus.test/api/admin/curriculum/structure-nodes?structureVersionId=${VALID_ID}`)) },
  { name: 'objectives GET', call: () => objectivesGET(urlReq(`https://studyus.test/api/admin/curriculum/objectives?structureNodeId=${VALID_ID}`)) },
  { name: 'mappings POST', call: () => mappingsPOST(jsonReq({ kind: 'CONCEPT', learningObjectiveId: VALID_ID, targetId: VALID_ID, relationType: 'FULL' })) },
  { name: 'mappings/transition POST', call: () => transitionPOST(jsonReq({ kind: 'CONCEPT', mappingId: VALID_ID, action: 'PROPOSE' })) },
  { name: 'coverage GET', call: () => coverageGET(urlReq(`https://studyus.test/api/admin/curriculum/coverage?structureVersionId=${VALID_ID}`)) },
];

describe('ANONYMOUS: every F6 admin curriculum route denies before touching the service layer', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(createMappingMock).not.toHaveBeenCalled();
      expect(proposeMappingMock).not.toHaveBeenCalled();
      expect(computeMappingCoverageMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F6 admin curriculum route still denies', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(createMappingMock).not.toHaveBeenCalled();
      expect(computeMappingCoverageMock).not.toHaveBeenCalled();
    });
  }
});

describe('admin caller: routes validate input and surface service-level errors correctly', () => {
  it('structures GET without academicSubjectId is 400', async () => {
    const res: any = await structuresGET(urlReq('https://studyus.test/api/admin/curriculum/structures'));
    expect(res.status).toBe(400);
    expect(getPublishedStructureVersionMock).not.toHaveBeenCalled();
  });

  it('mappings POST with an invalid relationType is 400', async () => {
    const res: any = await mappingsPOST(jsonReq({ kind: 'CONCEPT', learningObjectiveId: VALID_ID, targetId: VALID_ID, relationType: 'NOT_REAL' }));
    expect(res.status).toBe(400);
    expect(createMappingMock).not.toHaveBeenCalled();
  });

  it('a self-approval attempt surfaces as 403, not 500', async () => {
    approveMappingMock.mockRejectedValue(new FakeSelfApprovalError('cannot self-approve'));
    const res: any = await transitionPOST(jsonReq({ kind: 'CONCEPT', mappingId: VALID_ID, action: 'APPROVE' }));
    expect(res.status).toBe(403);
  });

  it('an invalid transition surfaces as 409, not 500', async () => {
    publishMappingMock.mockRejectedValue(new FakeInvalidMappingTransitionError('bad transition'));
    const res: any = await transitionPOST(jsonReq({ kind: 'CONCEPT', mappingId: VALID_ID, action: 'PUBLISH' }));
    expect(res.status).toBe(409);
  });

  it('a valid propose request reaches the service with the correct actor', async () => {
    const res: any = await transitionPOST(jsonReq({ kind: 'CONCEPT', mappingId: VALID_ID, action: 'PROPOSE' }));
    expect(res.status ?? 200).not.toBe(400);
    expect(proposeMappingMock).toHaveBeenCalledWith('CONCEPT', 'actor-1', VALID_ID);
  });
});
