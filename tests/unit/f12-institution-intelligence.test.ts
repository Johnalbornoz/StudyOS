import { describe, expect, it, vi, beforeEach } from 'vitest';
const { query, canAccessInstitution, hasRole } = vi.hoisted(() => ({ query: vi.fn(), canAccessInstitution: vi.fn(), hasRole: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query } }));
vi.mock('@/lib/authorization', () => ({ canAccessInstitution }));
vi.mock('@/lib/identity', () => ({ hasRole }));
import { getInstitutionIntelligenceOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence/service';

describe('F12 aggregate institution intelligence', () => {
  beforeEach(() => { query.mockReset(); canAccessInstitution.mockReset(); hasRole.mockReset().mockResolvedValue(false); });
  it('suppresses sub-k cohort counts while keeping aggregate shape', async () => {
    canAccessInstitution.mockResolvedValue(true);
    query.mockResolvedValueOnce({ rows:[{ count: 12 }] }).mockResolvedValueOnce({ rows:[{id:'g1',name:'Grade 1',count:8}] }).mockResolvedValueOnce({ rows:[{id:'c1',grade_id:'g1',name:'A',count:8}] }).mockResolvedValueOnce({ rows:[{id:'ok'}] });
    // institution existence query occurs before aggregate queries
    query.mockReset();
    query.mockResolvedValueOnce({rows:[{id:'ok'}]}).mockResolvedValueOnce({rows:[{count:12}]}).mockResolvedValueOnce({rows:[{id:'g1',name:'Grade 1',count:8}]}).mockResolvedValueOnce({rows:[{id:'c1',grade_id:'g1',name:'A',count:8}]});
    const out = await getInstitutionIntelligenceOverview('u1','i1');
    expect(out.activeLearnerCount).toBe(12); expect(out.grades[0].activeLearnerCount).toBeNull(); expect(out.classes[0].activeLearnerCount).toBeNull();
  });
  it('denies an actor without tenant administration or coordinator membership', async () => {
    canAccessInstitution.mockResolvedValue(false); query.mockResolvedValueOnce({rows:[]});
    await expect(getInstitutionIntelligenceOverview('u2','i1')).rejects.toBeInstanceOf(InstitutionIntelligenceAccessDeniedError);
  });
});
