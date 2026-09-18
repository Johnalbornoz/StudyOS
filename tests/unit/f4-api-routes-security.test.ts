/**
 * F4 -- negative security tests for the minimal admin catalog API (task
 * 19). Every route must reject unauthenticated and non-admin callers
 * before touching the catalog, matching the existing /api/admin/*
 * convention (isAdminEmail allowlist).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const listCanonicalSubjectsMock = vi.fn();
const createCanonicalSubjectMock = vi.fn();
const listCanonicalConceptsMock = vi.fn();
const createCanonicalConceptMock = vi.fn();
const listSkillsMock = vi.fn();
const listCompetenciesMock = vi.fn();
const listContextsMock = vi.fn();
vi.mock('@/lib/catalog/canonical-catalog.service', () => ({
  listCanonicalSubjects: (...a: any[]) => listCanonicalSubjectsMock(...a),
  createCanonicalSubject: (...a: any[]) => createCanonicalSubjectMock(...a),
  listCanonicalConcepts: (...a: any[]) => listCanonicalConceptsMock(...a),
  createCanonicalConcept: (...a: any[]) => createCanonicalConceptMock(...a),
  listSkills: (...a: any[]) => listSkillsMock(...a),
  listCompetencies: (...a: any[]) => listCompetenciesMock(...a),
  listContexts: (...a: any[]) => listContextsMock(...a),
}));

const listMappingsByStatusMock = vi.fn();
const getCandidatesForMappingMock = vi.fn();
const confirmMappingMock = vi.fn();
vi.mock('@/lib/catalog/mapping.service', () => ({
  listMappingsByStatus: (...a: any[]) => listMappingsByStatusMock(...a),
  getCandidatesForMapping: (...a: any[]) => getCandidatesForMappingMock(...a),
  confirmMapping: (...a: any[]) => confirmMappingMock(...a),
}));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

import { GET as subjectsGET, POST as subjectsPOST } from '@/app/api/admin/catalog/subjects/route';
import { GET as conceptsGET, POST as conceptsPOST } from '@/app/api/admin/catalog/concepts/route';
import { GET as mappingsGET } from '@/app/api/admin/catalog/mappings/route';
import { POST as confirmPOST } from '@/app/api/admin/catalog/mappings/confirm/route';
import { GET as taxonomyGET } from '@/app/api/admin/catalog/taxonomy/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-admin' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'admin@studyus.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(true);
  listCanonicalSubjectsMock.mockReset().mockResolvedValue([]);
  createCanonicalSubjectMock.mockReset().mockResolvedValue({ id: 's1', name: 'Mathematics', status: 'ACTIVE' });
  listCanonicalConceptsMock.mockReset().mockResolvedValue([]);
  createCanonicalConceptMock.mockReset().mockResolvedValue({ id: 'c1' });
  listSkillsMock.mockReset().mockResolvedValue([]);
  listCompetenciesMock.mockReset().mockResolvedValue([]);
  listContextsMock.mockReset().mockResolvedValue([]);
  listMappingsByStatusMock.mockReset().mockResolvedValue([]);
  getCandidatesForMappingMock.mockReset().mockResolvedValue([]);
  confirmMappingMock.mockReset().mockResolvedValue(undefined);
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'reviewer-1' });
});

const ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'subjects GET', call: () => subjectsGET() },
  { name: 'subjects POST', call: () => subjectsPOST(jsonReq({ name: 'Mathematics' })) },
  { name: 'concepts GET', call: () => conceptsGET(urlReq('https://studyus.test/api/admin/catalog/concepts?canonicalSubjectId=s1')) },
  { name: 'concepts POST', call: () => conceptsPOST(jsonReq({ canonicalSubjectId: 's1', name: 'Linear Functions' })) },
  { name: 'mappings GET', call: () => mappingsGET(urlReq('https://studyus.test/api/admin/catalog/mappings?status=UNRESOLVED')) },
  { name: 'mappings confirm POST', call: () => confirmPOST(jsonReq({ mappingId: 'm1', canonicalConceptId: 'cc1' })) },
  { name: 'taxonomy GET', call: () => taxonomyGET() },
];

describe('ANONYMOUS: every F4 admin catalog route denies before touching the catalog', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(listCanonicalSubjectsMock).not.toHaveBeenCalled();
      expect(createCanonicalSubjectMock).not.toHaveBeenCalled();
      expect(listCanonicalConceptsMock).not.toHaveBeenCalled();
      expect(createCanonicalConceptMock).not.toHaveBeenCalled();
      expect(listMappingsByStatusMock).not.toHaveBeenCalled();
      expect(confirmMappingMock).not.toHaveBeenCalled();
      expect(listSkillsMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F4 admin catalog route still denies', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(listCanonicalSubjectsMock).not.toHaveBeenCalled();
      expect(createCanonicalSubjectMock).not.toHaveBeenCalled();
      expect(confirmMappingMock).not.toHaveBeenCalled();
    });
  }
});

describe('admin caller: routes validate input before delegating to the catalog', () => {
  it('concepts GET without canonicalSubjectId is 400, never reaches the service', async () => {
    const res: any = await conceptsGET(urlReq('https://studyus.test/api/admin/catalog/concepts'));
    expect(res.status).toBe(400);
    expect(listCanonicalConceptsMock).not.toHaveBeenCalled();
  });

  it('mappings GET with an invalid status is 400, never reaches the service', async () => {
    const res: any = await mappingsGET(urlReq('https://studyus.test/api/admin/catalog/mappings?status=MATCHED'));
    expect(res.status).toBe(400);
    expect(listMappingsByStatusMock).not.toHaveBeenCalled();
  });

  it('mappings confirm with a malformed body is 400, never reaches the service', async () => {
    const res: any = await confirmPOST(jsonReq({ mappingId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(confirmMappingMock).not.toHaveBeenCalled();
  });

  it('a valid confirm request records the reviewer and returns success', async () => {
    const res: any = await confirmPOST(
      jsonReq({ mappingId: '11111111-1111-4111-8111-111111111111', canonicalConceptId: '22222222-2222-4222-a222-222222222222' })
    );
    expect(res.status ?? 200).not.toBe(400);
    expect(confirmMappingMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-a222-222222222222',
      'reviewer-1'
    );
  });
});
