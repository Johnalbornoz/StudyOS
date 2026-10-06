import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { questionDetail } from '@/lib/exam-core/question-bank/review-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../../AdminSubNav';
import { Table, TD, ROW, DIFFICULTY_LABEL, USAGE_LABEL, ALIGNMENT_LABEL, REVIEW_LABEL, LIFECYCLE_LABEL, pct } from '../../ui';
import { ReviewActions } from '../../ReviewActions';
import { PILOT_REVIEW_CONTRACT } from '@/lib/exam-core/question-bank/pilots/human-review';

const PROVENANCE_LABEL: Record<string, string> = { OFFICIAL: 'Oficial', LICENSED: 'Licenciada', STUDYUS_GENERATED: 'Generada por StudyUs (IA)', FIXTURE: 'Contenido de certificación StudyUs' };
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--space-2)', padding: '4px 0' }}><span style={{ color: 'var(--text-muted)' }}>{k}</span><span>{v}</span></div>
);

/** Question detail: everything a reviewer needs to certify one version, plus exposure and history. */
export default async function QuestionDetailPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) notFound();
  const d = await questionDetail(versionId);
  if (!d) notFound();
  const official = d.provenance === 'OFFICIAL' || d.provenance === 'LICENSED';
  const reviewable = d.isCurrent || ['PILOT', 'VALIDATED', 'REVIEW_REQUIRED'].includes(d.lifecycle ?? '');
  const scale = (b: string | null) => (b ? DIFFICULTY_LABEL[b] : '—');
  return (
    <div>
      <PageHeader title={`Pregunta v${d.version}`} subtitle={`${d.exam.name ?? '—'} · ${d.section ?? '—'} · ${d.objective.code}`} />
      <AdminSubNav active="question-bank" />
      <p style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <Link href="/dashboard/admin/question-bank/review" className="btn btn-ghost">← Revisión académica</Link>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
        <section className="card" style={{ padding: 'var(--space-4)', fontSize: 14 }}>
          {d.content.stimulus && (
            <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--surface-subtle, #f6f7f9)', borderRadius: 8 }}>
              {d.content.stimulus.title && <strong>{d.content.stimulus.title}</strong>}
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{d.content.stimulus.text}</p>
            </div>
          )}
          <h2 style={{ fontSize: 16 }}>{d.content.question}</h2>
          <ol style={{ listStyle: 'none', paddingLeft: 0 }}>
            {d.content.options.map((o: any) => (
              <li key={o.id} style={{ padding: '4px 0', fontWeight: o.id === d.content.answer ? 700 : 400 }}>
                {o.id}) {o.text} {o.id === d.content.answer ? <span className="chip chip-good">Respuesta</span> : d.content.distractorRationale?.[o.id] ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {d.content.distractorRationale[o.id]}</span> : null}
              </li>
            ))}
          </ol>
          <Row k="Explicación" v={d.content.explanation} />
          <Row k="Concepto" v={d.concepts.length ? d.concepts.join(', ') : 'sin concepto vinculado'} />
          <Row k="Objetivo" v={`${d.objective.code} — ${d.objective.description ?? ''}`} />
          <Row k="Idioma" v={d.content.language} />
          {d.pilot && (
            <>
              <Row k="Piloto" v={`${d.pilot.key ?? '—'} · ${d.pilot.batch ?? '—'}`} />
              <Row k="Solicitado" v={`${d.pilot.requested.competency ?? '—'} · ${d.pilot.requested.contentCategory ?? '—'} · dificultad StudyUs ${(d.pilot.requested.difficulty as string[]).join(', ') || '—'} · ${d.pilot.requested.locale ?? '—'}`} />
              <Row k="Competencia (ítem)" v={d.pilot.tags.competency ?? 'sin etiqueta'} />
              <Row k="Afirmación" v={d.pilot.tags.assertion ?? 'sin etiqueta'} />
              <Row k="Evidencia (propuesta por el generador; verificar con el marco Icfes)" v={d.pilot.tags.evidence ?? 'sin evidencia'} />
              <Row k="Categoría de contenido" v={d.pilot.tags.contentCategory ?? 'sin etiqueta'} />
              {d.pilot.cell && (
                <Row
                  k="Celda Blueprint V2.1 (competencia × contenido)"
                  v={`${d.pilot.cell.cell} · ${d.pilot.cell.declaredInV21 ? 'declarada en V2.1' : 'NO declarada en V2.1'}${d.pilot.cell.problems.length ? ` · ${d.pilot.cell.problems.join(', ')}` : ''}`}
                />
              )}
              <Row
                k="Validador independiente (IA; no es una aprobación)"
                v={d.automatedValidation.validatorVerdict ? `eligió ${d.automatedValidation.validatorVerdict.selectedOption ?? '—'} · dificultad estimada ${d.automatedValidation.validatorVerdict.estimatedDifficulty ?? '—'} · distractores implausibles ${d.automatedValidation.validatorVerdict.implausibleDistractors.join(', ') || 'ninguno'}` : '—'}
              />
            </>
          )}
        </section>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <section className="card" style={{ padding: 'var(--space-4)', fontSize: 13.5 }}>
            <Row k="Dificultad" v={<strong>{scale(d.difficulty.effective)}</strong>} />
            <Row k="· declarada / validada / observada" v={`${scale(d.difficulty.declared)} / ${scale(d.difficulty.validated)} / ${d.difficulty.observed ? scale(d.difficulty.observed) : 'sin datos suficientes'}`} />
            <Row k="Uso" v={d.usage.map((u) => USAGE_LABEL[u] ?? u).join(', ')} />
            <Row k="Alineación con el examen" v={ALIGNMENT_LABEL[d.alignment] ?? d.alignment} />
            <Row k="Ciclo de vida" v={LIFECYCLE_LABEL[d.lifecycle] ?? d.lifecycle} />
            <Row k="Validación automática" v={<span className={`chip ${d.automatedValidation.result === 'PASS' ? 'chip-good' : 'chip-warn'}`}>{d.automatedValidation.result === 'PASS' ? 'Superada' : d.automatedValidation.result === 'NOT_APPLICABLE' ? 'No aplica' : 'No superada'}</span>} />
            {d.automatedValidation.findings.length > 0 && <Row k="· hallazgos" v={d.automatedValidation.findings.map((f) => `${f.code}${f.severity === 'WARN' ? ' (aviso)' : ''}`).join(', ')} />}
            <Row k="Revisión humana" v={REVIEW_LABEL[d.humanReview.status] ?? d.humanReview.status} />
            <Row k="Origen" v={`${PROVENANCE_LABEL[d.provenance] ?? d.provenance} · autor: ${d.author ?? '—'}`} />
            <Row k="Exposición" v={`${d.exposure.totalUses} usos · ${d.exposure.uniqueStudents} estudiantes · repetición ${pct(d.exposure.repeatRate)} · último uso ${d.exposure.lastUsed ? new Date(d.exposure.lastUsed).toLocaleDateString('es') : '—'}`} />
          </section>
          {reviewable && d.lifecycle !== 'REJECTED' && d.lifecycle !== 'SUPERSEDED' && d.lifecycle !== 'RETIRED' && (
            <ReviewActions versionId={d.versionId} official={official} initial={{ difficulty: d.difficulty.validatedScale ?? d.difficulty.declaredScale, usage: [...d.usage].filter((u) => u !== 'FORMAL_ASSESSMENT'), alignment: d.alignment }} checklist={d.pilot?.checklist ?? []}
              pilot={d.pilot ? { contract: PILOT_REVIEW_CONTRACT, proposal: d.pilot.proposal, attentionPoints: d.pilot.attentionPoints, competencyOptions: d.pilot.competencyOptions, contentOptions: d.pilot.contentOptions, options: d.content.options } : null}
            />
          )}
        </div>
      </div>
      <h2 style={{ fontSize: 15, margin: 'var(--space-6) 0 var(--space-2)' }}>Historial y auditoría</h2>
      <Table head={['Cuándo', 'De', 'A', 'Motivo', 'Actor']}>
        {d.audit.map((a, i) => (
          <tr key={i} style={ROW}>
            <TD muted>{a.at ? new Date(a.at).toLocaleString('es') : '—'}</TD>
            <TD>{a.from ? LIFECYCLE_LABEL[a.from] ?? a.from : '—'}</TD>
            <TD>{LIFECYCLE_LABEL[a.to] ?? a.to}</TD>
            <TD muted>{a.reason}</TD>
            <TD muted>{a.actor}</TD>
          </tr>
        ))}
      </Table>
      {d.humanReview.history.length > 0 && (
        <Table head={['Revisión', 'Cuándo', 'Revisor', 'Notas']}>
          {d.humanReview.history.map((h, i) => (
            <tr key={i} style={ROW}>
              <TD>{REVIEW_LABEL[h.decision] ?? h.decision}</TD>
              <TD muted>{h.at ? new Date(h.at).toLocaleString('es') : '—'}</TD>
              <TD muted>{h.reviewer ?? '—'}</TD>
              <TD muted>{h.notes ?? '—'}</TD>
            </tr>
          ))}
        </Table>
      )}
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Versiones: {d.versions.map((v) => `v${v.version} (${LIFECYCLE_LABEL[v.lifecycle] ?? v.lifecycle})`).join(' · ')}</p>
    </div>
  );
}
