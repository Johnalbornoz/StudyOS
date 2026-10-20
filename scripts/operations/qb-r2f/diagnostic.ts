/**
 * QB-R2F -- DIAGNOSTIC ONLY: validators revision 4 run over the STORED QB-R2D and QB-R2E candidates (read only; no
 * network; writes nothing unless a path is given).
 *
 * NOT CERTIFICATION EVIDENCE AND NOT A RESCORE. QB-R2D was scored by revision 2 and QB-R2E by revision 3; those
 * reports stand as they are. This only answers: of the defects that are now known, which does revision 4 flag that
 * the scoring revision missed, and does any item change outcome for a reason that is not a defect?
 *
 *   npx tsx scripts/operations/qb-r2f/diagnostic.ts            print the diagnostic as JSON
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { SpecificationBatchSchema, type SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { storedR2dSelection } from '../qb-r2d/stored-selection';
import { buildR2eSelection } from '../qb-r2e/selection';

export interface DiagnosticRow { run: 'QB-R2D' | 'QB-R2E'; unitKey: string; scoredBy: string; scoredOutcome: Record<string, string>; revision4: Record<string, string>; changes: Array<{ gate: string; from: string; to: string; why: string }>; notApplicable: string[] }

function rowsOf(run: 'QB-R2D' | 'QB-R2E', candidates: readonly SpecificationCandidate[], stimuli: readonly CandidateStimulus[], specs: ReadonlyMap<string, AdaptationSpecification>): DiagnosticRow[] {
  return candidates.map((c) => {
    const specification = specs.get(c.specificationId)!;
    const v = validateSpecificationCandidateR4({ candidate: c, specification, stimulus: c.stimulusKey ? stimuli.find((s) => s.stimulusKey === c.stimulusKey) ?? null : null, siblings: candidates });
    // QB-R2D specifications were made before a specification stated its marks: the marks check does not apply to them
    const noMarks = specification.variable.marks === undefined;
    const changes = v.revision4.changesFromRevision3.filter((x) => !(noMarks && x.gate === 'profileCompliance' && v.revision4.demandPolicy.issues.length === 0));
    const profile = noMarks && v.revision3.revision2.profileCompliance.outcome === 'PASS' && v.revision3.additions.commandTerms.length === 0 && v.revision4.demandPolicy.issues.length === 0 ? 'PASS' : v.gates.profileCompliance;
    return { run, unitKey: c.unitKey, scoredBy: run === 'QB-R2D' ? 'revision 2' : 'revision 3', scoredOutcome: { ...v.revision3.gates, ...(noMarks ? { profileCompliance: v.revision3.revision2.profileCompliance.outcome } : {}) }, revision4: { ...v.gates, profileCompliance: profile }, changes, notApplicable: noMarks ? ['marks against the specification (the specification states none)'] : [] };
  });
}

export function runDiagnostic(root: string = process.cwd()): { label: string; rows: DiagnosticRow[] } {
  const r2d = SpecificationBatchSchema.parse(JSON.parse(readFileSync(join(root, 'docs/exams/question-bank/pilots/qb-r2d/generated-batch.json'), 'utf8')));
  const r2e = SpecificationBatchSchema.parse((JSON.parse(readFileSync(join(root, 'docs/exams/question-bank/pilots/qb-r2e/generated-batch.json'), 'utf8')) as { batch: unknown }).batch);
  return {
    label: 'DIAGNOSTIC ONLY -- validators revision 4 over stored QB-R2D and QB-R2E candidates -- NOT certification evidence, NOT a rescore',
    rows: [
      ...rowsOf('QB-R2D', r2d.candidates, r2d.stimuli, new Map(storedR2dSelection(root).map((s) => [s.specification.specificationId, s.specification]))),
      ...rowsOf('QB-R2E', r2e.candidates, r2e.stimuli, new Map(buildR2eSelection().map((s) => [s.specification.specificationId, s.specification]))),
    ],
  };
}

if (process.argv[1] && /qb-r2f[\\/]diagnostic\.ts$/.test(process.argv[1])) console.log(JSON.stringify(runDiagnostic(), null, 1));
