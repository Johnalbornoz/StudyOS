import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { reviewQueue, type ReviewQueueFilters } from '@/lib/exam-core/question-bank/review-admin.service';
import { listBankVersions } from '@/lib/exam-core/question-bank/health.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../../AdminSubNav';
import { Table, TD, ROW, DIFFICULTY_LABEL, USAGE_LABEL, ALIGNMENT_LABEL, REVIEW_LABEL } from '../ui';
import { reviewQueueHref, reviewRowAction } from '../review-links';

const ENUMS = {
  band: ['LOW', 'MEDIUM', 'HIGH'],
  validation: ['PASS', 'FAIL'],
  usage: ['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK'],
  alignment: ['PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL'],
  status: ['PENDING', 'ALL'],
} as const;
const safe = (v: string | undefined, re: RegExp) => (v && re.test(v) ? v : undefined);

/** Pending academic review: generated questions that passed automated validation, waiting for a human decision. */
export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  const sp = await searchParams;
  const pick = <K extends keyof typeof ENUMS>(k: K) => ((ENUMS[k] as readonly string[]).includes(sp[k] ?? '') ? (sp[k] as any) : undefined);
  const filters: ReviewQueueFilters = {
    examVersionId: safe(sp.examVersionId, /^[0-9a-f-]{36}$/i),
    examConfigKey: safe(sp.examConfigKey, /^[a-z0-9._-]{1,120}$/i),
    sectionKey: safe(sp.sectionKey, /^[a-z0-9._-]{1,80}$/),
    objectiveCode: safe(sp.objectiveCode, /^[a-z0-9._-]{1,80}$/),
    band: pick('band'),
    generatedFrom: safe(sp.generatedFrom, /^\d{4}-\d{2}-\d{2}$/),
    generatedTo: safe(sp.generatedTo, /^\d{4}-\d{2}-\d{2}$/),
    validation: pick('validation'),
    usage: pick('usage'),
    alignment: pick('alignment'),
    status: pick('status') ?? 'PENDING',
  };
  const [items, versions] = await Promise.all([reviewQueue(filters), listBankVersions()]);
  // The detail page's "volver" returns here with the same filters (stable exam identity: examConfigKey).
  const queueHref = reviewQueueHref(filters);
  const generatable = [...new Map(
    versions
      .filter((v): v is typeof v & { configKey: string } => !v.structureOnly && typeof v.configKey === 'string' && v.configKey.length > 0)
      .map((v) => [v.configKey, v])
  ).values()];
  return (
    <div>
      <PageHeader title="Revisión académica" subtitle="Preguntas generadas que superaron la validación automática y esperan una decisión humana: aprobar, solicitar corrección o rechazar." />
      <AdminSubNav active="question-bank" />
      <p style={{ marginBottom: 'var(--space-4)' }}><Link href="/dashboard/admin/question-bank" className="btn btn-ghost">← Salud del banco</Link></p>
      <form method="get" className="card" style={{ padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'end', fontSize: 13, marginBottom: 'var(--space-4)' }}>
        <label>Examen<br /><select name="examConfigKey" defaultValue={filters.examConfigKey ?? ''}><option value="">Todos</option>{generatable.map((v) => <option key={v.configKey} value={v.configKey}>{v.definitionName}</option>)}</select></label>
        <label>Sección<br /><input name="sectionKey" defaultValue={filters.sectionKey ?? ''} placeholder="p. ej. matematicas" size={12} /></label>
        <label>Objetivo / concepto<br /><input name="objectiveCode" defaultValue={filters.objectiveCode ?? ''} placeholder="p. ej. paa.mat.algebra" size={16} /></label>
        <label>Dificultad<br /><select name="band" defaultValue={filters.band ?? ''}><option value="">Todas</option>{ENUMS.band.map((b) => <option key={b} value={b}>{DIFFICULTY_LABEL[b]}</option>)}</select></label>
        <label>Desde<br /><input type="date" name="generatedFrom" defaultValue={filters.generatedFrom ?? ''} /></label>
        <label>Hasta<br /><input type="date" name="generatedTo" defaultValue={filters.generatedTo ?? ''} /></label>
        <label>Validación<br /><select name="validation" defaultValue={filters.validation ?? ''}><option value="">Todas</option><option value="PASS">Superada</option><option value="FAIL">No superada</option></select></label>
        <label>Uso<br /><select name="usage" defaultValue={filters.usage ?? ''}><option value="">Todos</option>{ENUMS.usage.map((u) => <option key={u} value={u}>{USAGE_LABEL[u]}</option>)}</select></label>
        <label>Alineación<br /><select name="alignment" defaultValue={filters.alignment ?? ''}><option value="">Todas</option>{ENUMS.alignment.map((a) => <option key={a} value={a}>{ALIGNMENT_LABEL[a]}</option>)}</select></label>
        <label>Mostrar<br /><select name="status" defaultValue={filters.status}><option value="PENDING">Pendientes</option><option value="ALL">Todas</option></select></label>
        <button className="btn btn-secondary" type="submit">Filtrar</button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="No hay preguntas pendientes con estos filtros." />
      ) : (
        <Table head={['Pregunta', 'Examen · sección', 'Objetivo', 'Dificultad', 'Uso', 'Alineación', 'Validación', 'Revisión', 'Generada', 'Acción']} stickyLastColumn>
          {items.map((i) => {
            const action = reviewRowAction(i, queueHref);
            return (
            <tr key={i.versionId} style={ROW}>
              <TD style={{ minWidth: 260, maxWidth: 420 }}>
                <Link href={action.href} style={{ color: 'inherit', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={i.question}>{i.question}</Link>
              </TD>
              <TD muted>{i.exam ?? '—'}{i.section ? ` · ${i.section}` : ''}</TD>
              <TD muted>{i.objectiveCode}</TD>
              <TD>{i.difficulty ? DIFFICULTY_LABEL[i.difficulty] : '—'}</TD>
              <TD muted>{i.usage.map((u) => USAGE_LABEL[u] ?? u).join(', ')}</TD>
              <TD>{ALIGNMENT_LABEL[i.alignment] ?? i.alignment}</TD>
              <TD><span className={`chip ${i.automatedValidation === 'PASS' ? 'chip-good' : 'chip-warn'}`}>{i.automatedValidation === 'PASS' ? 'Superada' : 'No superada'}</span>{i.findings ? ` · ${i.findings} hallazgo(s)` : ''}</TD>
              <TD>{REVIEW_LABEL[i.review] ?? i.review}</TD>
              <TD muted>{new Date(i.createdAt).toLocaleDateString('es')}</TD>
              <TD sticky>
                <Link className={`btn ${action.mode === 'REVIEW' ? 'btn-primary' : 'btn-ghost'}`} href={action.href} aria-label={`${action.label}: ${i.question.slice(0, 80)}`} data-review-action={action.mode}>{action.label}</Link>
              </TD>
            </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
