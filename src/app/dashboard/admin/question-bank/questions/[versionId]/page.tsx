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
import { safeReviewReturnTo } from '../../review-links';

const PROVENANCE_LABEL: Record<string, string> = { OFFICIAL: 'Oficial', LICENSED: 'Licenciada', STUDYUS_GENERATED: 'Generada por StudyUs (IA)', FIXTURE: 'Contenido de certificación StudyUs' };
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 240px) 1fr', gap: 'var(--space-3)', padding: '4px 0' }}><span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={{ overflowWrap: 'anywhere' }}>{v}</span></div>
);
/** One fact of the academic context (definition-grid cell). */
const Def = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="qbr-def"><dt>{k}</dt><dd>{v}</dd></div>
);

/** Question detail: everything a reviewer needs to certify one version, plus exposure and history. */
export default async function QuestionDetailPage({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams?: Promise<Record<string, string | undefined>> }) {
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
  const readOnly = !reviewable || d.lifecycle === 'REJECTED' || d.lifecycle === 'SUPERSEDED' || d.lifecycle === 'RETIRED';
  // Back to the queue WITH its filters (internal review-queue path only; anything else falls back to the plain queue).
  const backHref = safeReviewReturnTo((await searchParams)?.returnTo);
  const scale = (b: string | null) => (b ? DIFFICULTY_LABEL[b] : '—');
  const findings = d.automatedValidation.findings;
  const validationLabel = d.automatedValidation.result === 'PASS' ? 'Superada' : d.automatedValidation.result === 'NOT_APPLICABLE' ? 'No aplica' : 'No superada';
  const validatorSummary = d.automatedValidation.validatorVerdict
    ? `Validador independiente (IA; no es una aprobación): eligió ${d.automatedValidation.validatorVerdict.selectedOption ?? '—'} · dificultad estimada ${d.automatedValidation.validatorVerdict.estimatedDifficulty ?? '—'} · distractores implausibles ${d.automatedValidation.validatorVerdict.implausibleDistractors.join(', ') || 'ninguno'}`
    : null;
  const humanRejected = d.humanReview.history.some((h) => h.decision === 'REJECTED');
  const rejectionReason = [...d.audit].reverse().find((a) => a.to === 'REJECTED')?.reason ?? null;
  const competencyLabel = d.pilot?.tags.competency ?? null;
  const categoryLabel = d.pilot?.tags.contentCategory ?? null;
  return (
    <div className="qbr-page">
      {/* A. Header: what is being reviewed and where it stands. */}
      <div>
        <PageHeader title={`Pregunta v${d.version}`} subtitle={`${d.exam.name ?? '—'}${competencyLabel || categoryLabel ? ` · ${[competencyLabel, categoryLabel].filter(Boolean).join(' · ')}` : ` · ${d.section ?? '—'}`}`} />
        <AdminSubNav active="question-bank" />
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href={backHref} className="btn btn-ghost">← Revisión académica</Link>
          <div className="qbr-chips" aria-label="Estado">
            <span className="chip">{REVIEW_LABEL[d.humanReview.status] ?? d.humanReview.status}</span>
            <span className={`chip ${d.automatedValidation.result === 'PASS' ? 'chip-good' : 'chip-warn'}`}>Validación automática: {validationLabel}</span>
            <span className="chip">{findings.length === 1 ? '1 hallazgo' : `${findings.length} hallazgos`}</span>
            <span className="chip">Dificultad: {scale(d.difficulty.effective)}</span>
          </div>
        </div>
      </div>
      {readOnly && (
        <section className="card qbr-card" role="status" style={{ borderColor: d.lifecycle === 'REJECTED' ? 'var(--error)' : undefined }}>
          {d.lifecycle === 'REJECTED' ? (
            <>
              <h2 style={{ margin: 0 }}>{humanRejected ? 'Rechazada' : 'Rechazada automáticamente'}</h2>
              <p style={{ margin: 'var(--space-2) 0 0' }}>Esta pregunta no está disponible para revisión humana · solo lectura.{rejectionReason ? ` Causa registrada: ${rejectionReason}.` : ''}</p>
            </>
          ) : (
            <p style={{ margin: 0 }}>Solo lectura: esta versión no es la versión revisable.</p>
          )}
        </section>
      )}
      {/* B. The question, full width: read it and solve it before anything administrative. */}
      <section className="card qbr-card" aria-labelledby="qbr-question">
        <p className="qbr-kicker" id="qbr-question">Pregunta</p>
        {d.content.stimulus && (
          <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--bg-subtle)', borderRadius: 8 }}>
            {d.content.stimulus.title && <strong>{d.content.stimulus.title}</strong>}
            <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{d.content.stimulus.text}</p>
          </div>
        )}
        <p style={{ fontSize: 17, lineHeight: 1.5, margin: '0 0 var(--space-3)', fontWeight: 600 }}>{d.content.question}</p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          {d.content.options.map((o: any) => (
            <li key={o.id} className={`qbr-option${o.id === d.content.answer ? ' qbr-option--proposed' : ''}`}>
              <strong>{o.id})</strong>
              <span style={{ flex: 1 }}>
                {o.text}
                {o.id === d.content.answer && <> <span className="chip" style={{ marginLeft: 6 }}>Respuesta propuesta</span></>}
                {o.id !== d.content.answer && d.content.distractorRationale?.[o.id] ? <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 13.5 }}>Racional del distractor: {d.content.distractorRationale[o.id]}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <p className="qbr-kicker" style={{ marginTop: 'var(--space-4)' }}>Explicación propuesta</p>
        <p style={{ margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{d.content.explanation}</p>
      </section>
      {/* C. Academic context: compact grid; technical metadata collapsed. */}
      <section className="card qbr-card" aria-labelledby="qbr-context">
        <h2 id="qbr-context">Contexto académico</h2>
        <dl className="qbr-defs" style={{ margin: 0 }}>
          {d.pilot && <Def k="Competencia propuesta" v={competencyLabel ?? 'sin etiqueta'} />}
          {d.pilot && <Def k="Categoría" v={categoryLabel ?? 'sin etiqueta'} />}
          <Def k="Dificultad propuesta" v={scale(d.difficulty.declared)} />
          <Def k="Objetivo" v={d.objective.code} />
          <Def k="Uso" v={d.usage.map((u) => USAGE_LABEL[u] ?? u).join(' · ') || '—'} />
          <Def k="Alineación" v={ALIGNMENT_LABEL[d.alignment] ?? d.alignment} />
          <Def k="Idioma" v={d.content.language ?? '—'} />
        </dl>
        {d.pilot?.tags.assertion && <p style={{ margin: 'var(--space-3) 0 0', fontSize: 14 }}><span style={{ color: 'var(--text-muted)' }}>Afirmación:</span> {d.pilot.tags.assertion}</p>}
        {d.pilot?.tags.evidence && <p style={{ margin: 'var(--space-1, 4px) 0 0', fontSize: 14 }}><span style={{ color: 'var(--text-muted)' }}>Evidencia (propuesta por el generador; verificar con el marco Icfes):</span> {d.pilot.tags.evidence}</p>}
        <details className="qbr-details" style={{ marginTop: 'var(--space-3)', fontSize: 14 }}>
          <summary>Ver información técnica</summary>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <Row k="Objetivo" v={`${d.objective.code} — ${d.objective.description ?? ''}`} />
            <Row k="Concepto" v={d.concepts.length ? d.concepts.join(', ') : 'sin concepto vinculado'} />
            <Row k="Sección" v={d.section ?? '—'} />
            <Row k="Dificultad declarada / validada / observada" v={`${scale(d.difficulty.declared)} / ${scale(d.difficulty.validated)} / ${d.difficulty.observed ? scale(d.difficulty.observed) : 'sin datos suficientes'}`} />
            <Row k="Ciclo de vida" v={LIFECYCLE_LABEL[d.lifecycle] ?? d.lifecycle} />
            <Row k="Origen" v={`${PROVENANCE_LABEL[d.provenance] ?? d.provenance} · autor: ${d.author ?? '—'}`} />
            {d.pilot && (
              <>
                <Row k="Piloto" v={`${d.pilot.key ?? '—'} · ${d.pilot.batch ?? '—'}`} />
                <Row k="Solicitado" v={`${d.pilot.requested.competency ?? '—'} · ${d.pilot.requested.contentCategory ?? '—'} · dificultad StudyUs ${(d.pilot.requested.difficulty as string[]).join(', ') || '—'} · ${d.pilot.requested.locale ?? '—'}`} />
                {d.pilot.cell && (
                  <Row
                    k="Celda Blueprint V2.1 (competencia × contenido)"
                    v={`${d.pilot.cell.cell} · ${d.pilot.cell.declaredInV21 ? 'declarada en V2.1' : 'NO declarada en V2.1'}${d.pilot.cell.problems.length ? ` · ${d.pilot.cell.problems.join(', ')}` : ''}`}
                  />
                )}
              </>
            )}
            <Row k="Exposición" v={`${d.exposure.totalUses} usos · ${d.exposure.uniqueStudents} estudiantes · repetición ${pct(d.exposure.repeatRate)} · último uso ${d.exposure.lastUsed ? new Date(d.exposure.lastUsed).toLocaleDateString('es') : '—'}`} />
          </div>
        </details>
      </section>
      {/* D-H. Automated review (reference) -> human checklist -> classification -> notes -> decision. */}
      {readOnly ? (
        <section className="card qbr-card" aria-labelledby="qbr-auto-ro">
          <h2 id="qbr-auto-ro">Revisión automática</h2>
          <p className="qbr-sub">La validación automática no equivale a una aprobación humana.</p>
          <div className="qbr-chips" style={{ marginBottom: 'var(--space-2)' }}>
            <span className={`chip ${d.automatedValidation.result === 'PASS' ? 'chip-good' : 'chip-warn'}`}>Validación automática: {validationLabel}</span>
            <span className="chip">{findings.length === 1 ? '1 hallazgo' : `${findings.length} hallazgos`}</span>
            {findings.map((f) => <span key={f.code} className="chip">{f.code}{f.severity === 'WARN' ? ' (aviso)' : ''}</span>)}
          </div>
          {validatorSummary && <p style={{ margin: 0, fontSize: 14 }}>{validatorSummary}</p>}
        </section>
      ) : (
        <ReviewActions versionId={d.versionId} official={official} initial={{ difficulty: d.difficulty.validatedScale ?? d.difficulty.declaredScale, usage: [...d.usage].filter((u) => u !== 'FORMAL_ASSESSMENT'), alignment: d.alignment }} checklist={d.pilot?.checklist ?? []}
          pilot={d.pilot ? { contract: PILOT_REVIEW_CONTRACT, proposal: d.pilot.proposal, attentionPoints: d.pilot.attentionPoints, competencyOptions: d.pilot.competencyOptions, contentOptions: d.pilot.contentOptions, options: d.content.options } : null}
          automated={{ result: d.automatedValidation.result, findings, validatorSummary }}
        />
      )}
      {/* I. Traceability, last and collapsed: not the main workflow. */}
      <details className="card qbr-card qbr-details" aria-label="Historial y auditoría">
        <summary>Historial y auditoría · Ver historial ({d.audit.length} {d.audit.length === 1 ? 'evento' : 'eventos'})</summary>
        <div style={{ marginTop: 'var(--space-3)' }}>
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
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Versiones: {d.versions.map((v) => `v${v.version} (${LIFECYCLE_LABEL[v.lifecycle] ?? v.lifecycle})`).join(' · ')}</p>
        </div>
      </details>
    </div>
  );
}
