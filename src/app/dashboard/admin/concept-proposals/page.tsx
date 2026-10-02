import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listConceptProposals } from '@/lib/learning-plan/concept-proposals.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';
import { ResolveProposal } from './ResolveProposal';

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: 'En revisión',
  MAPPED_TO_EXISTING: 'Vinculado a un concepto existente',
  APPROVED: 'Aprobado',
  MERGED: 'Fusionado',
  REJECTED: 'Rechazado',
};

/**
 * Track A -- StudyUS catalog governance: concept proposals from teachers and
 * coordinators. Equivalent existing concepts are suggested first so the
 * catalog is reused, not duplicated. Spanish-only like the admin console.
 */
export default async function AdminConceptProposalsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  const proposals = await listConceptProposals();

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title="Propuestas de conceptos" subtitle="Docentes y coordinadores proponen conceptos que no existen. Antes de crear uno nuevo, comprueba los equivalentes sugeridos." />
        <AdminSubNav active="concept-proposals" />
      </div>
      {proposals.length === 0 ? (
        <EmptyState title="No hay propuestas." />
      ) : (
        proposals.map((p) => (
          <article key={p.id} className="card ta-card" aria-label={p.title}>
            <div className="ta-coordinator">
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <strong>{p.title}</strong>
                <span className="ta-msg">{[p.subjectName, p.institutionName, p.className, p.requestedBy ? `Propuesto por ${p.requestedBy}` : null].filter(Boolean).join(' · ')}</span>
                {p.description && <span className="ta-msg">{p.description}</span>}
                {p.resolvedConceptName && <span className="ta-msg">→ {p.resolvedConceptName}</span>}
              </span>
              <span className={p.status === 'PROPOSED' ? 'chip chip-warn' : 'chip'}>{STATUS_LABEL[p.status] ?? p.status}</span>
            </div>
            {p.status === 'PROPOSED' && <ResolveProposal proposalId={p.id} candidates={p.candidates} canApprove={Boolean(p.subjectName)} />}
          </article>
        ))
      )}
    </div>
  );
}
