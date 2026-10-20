/**
 * QF V5.1 / STEP 4B -- builds the human review packet and the pilot instance set (offline, deterministic).
 *
 *   npx tsx scripts/operations/qf-step4b/build-review-packet.ts            writes the three artefacts
 *   npx tsx scripts/operations/qf-step4b/build-review-packet.ts --check    fails if the artefacts on disk differ
 *
 * No provider, no database, no network, no clock: the same sources give the same bytes. It certifies nothing and
 * fills in no decision: every decision field it writes is blank.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import { adapterById, adapterConflicts, coreSemantics, envelopeHashOf, itemStructuresOf, rangesOutsideTheCore, reconcileAdapterDifferences, responseRepresentationsOf, STUDYUS_ASSESSMENT_REGISTRY, studentBandsOf, type RendererEnvelope } from '@/lib/assessment-instance';
import {
  PILOT_BANDS, PILOT_BLUEPRINTS, PILOT_CORE_REASONING, PILOT_CORE_SOURCES, PILOT_CORES, PILOT_ENVELOPES, PILOT_IB, PILOT_ID, PILOT_INSTANCE_RIGHTS, PILOT_PAA, PILOT_REVIEWER_ID, PILOT_REVIEWER_SCOPES, PILOT_TARGET_IB,
  PILOT_TARGET_PAA, pilotApplicability, pilotDecisionObjects, preparePilotInstances, renderPilotInstance, WITHDRAWN_CORE_VERSIONS, type PilotInstance,
} from '@/lib/assessment-instance/pilot/step4b-pilot-slice';
import { proportionInstanceCapacity } from '@/lib/assessment-instance/strategy-proportion-missing-value';
import { quadraticSolveInstanceCapacity as quadraticInstanceCapacity } from '@/lib/assessment-instance/strategy-quadratic-solve';

const OUT = join(process.cwd(), 'docs/exams/question-factory/step4b');
const FILES = { packet: 'STEP4B_HUMAN_REVIEW_PACKET.md', instances: 'STEP4B_PILOT_INSTANCES.json', decisions: 'STEP4B_CERTIFICATION_DECISIONS.csv' } as const;
const DECISION_LINE = 'Decision:  [ ] APPROVE   [ ] APPROVE_WITH_CHANGES   [ ] REJECT';
const cell = (s: unknown): string => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: unknown[][]): string => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const list = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');

const decisions = pilotDecisionObjects();
const { instances, refusals } = preparePilotInstances();
if (refusals.length > 0) throw new Error(`PILOT_INSTANCES_REFUSED: ${JSON.stringify(refusals)}`);
let decisionNo = 0;
const decisionBlock = (objectType: string, objectId: string, what: string): string => {
  const rows = decisions.filter((d) => d.objectType === objectType && d.objectId === objectId);
  if (rows.length === 0) throw new Error(`NO_DECISION_OBJECT: ${objectType} ${objectId}`);
  return rows.map((d) => {
    decisionNo += 1;
    return [`> **D${String(decisionNo).padStart(2, '0')} — ${what}** (${d.scope.canonicalSubject} × ${d.scope.systemId})`, `> ${d.objectType} \`${d.objectId}\` @ \`${d.objectVersion}\` · evidence \`${d.contentHash.slice(0, 16)}…\`${d.withinProposedScopes ? '' : ' · **scope not among the pilot scopes stated so far**'}`, `> ${DECISION_LINE}`, '> Notes:'].join('\n');
  }).join('\n\n');
};

// ---------------------------------------------------------------------------------------------- blueprints
const BLUEPRINT_TEXT: Record<string, { official: string[]; runtime: string[]; coverage: string[]; formats: string[]; evidence: string[]; gaps: string[]; sources: string[] }> = {
  'v2.paa/matematicas': {
    official: ['55 questions in 60 minutes (recorded in `v2.paa > sections[matematicas] > definition`).', 'Five domains named by the official guide: Aritmética, Álgebra, Geometría, Análisis de datos, Probabilidad.', 'No weight per domain is recorded: every value of the "Dominio" distribution is "—".', 'No calculator; produced responses are positive integers, fractions or decimals.'],
    runtime: ['12 governed positions: Aritmética 3, Álgebra 3, Geometría 3, Análisis de datos 2, Probabilidad 1.', 'The configuration states it itself: "Reducido: 12 de 55 preguntas".', 'No position carries a slot constraint; no `blueprintSpecification` is recorded for the section.'],
    coverage: ['All five domains have at least one position.', 'The two pilot buckets: `paa.mat.algebra` (quadratics, topic 040) and `paa.mat.aritmetica` (ratio and proportion, topic 028).', 'Objectives carry codes, not concept ids: the bucket → concept link below is part of this decision.'],
    formats: ['Recorded: SELECTED_RESPONSE and NUMERIC_ENTRY. The split between them is not recorded.'],
    evidence: ['Item count: official 55, governed 12.', 'Marks: none recorded (the examination reports a scale).'],
    gaps: ['43 of 55 positions are not governed.', 'The distribution across domains is StudyUs\'s own allocation: nothing official is recorded to compare it with.', 'The certified Q1 PAA plan (55 Mathematics items in the full form) is not bound to this runtime blueprint.'],
    sources: ['src/lib/exam-core/verticals/v2/paa.ts (PAA_V2, section matematicas)', 'src/lib/curriculum/paa/paa-hierarchy.ts (domains, topics 028 and 040)', 'docs/audits/BLUEPRINT_GOVERNANCE_INVENTORY.csv', 'cb-paa-guia-2021 (cited by the configuration)'],
  },
  'v2.ib.math-aa-hl/p1': {
    official: ['A marks-based paper: 110 marks in 120 minutes, 30 % of the grade, no calculator.', 'Section A short response ≈ 55 marks; Section B extended response ≈ 55 marks.', 'No number of questions is fixed: there is no official item count to reach.'],
    runtime: ['5 governed positions in 30 minutes: algebra 1, functions 1, calculus 2, extended response 1.', 'No position carries a marks budget or a slot constraint; no `blueprintSpecification` is recorded.', 'The configuration states it itself: "StudyUS delivers a reduced form".'],
    coverage: ['Three syllabus areas have a position (number and algebra, functions, calculus) plus one extended-response position.', 'Geometry and trigonometry, and statistics and probability, have no position.', 'The pilot bucket: `aahl.p1.functions` (quadratics). Its concept link is DECLARED_REVIEWED in the repository, not certified.'],
    formats: ['Recorded: MATH_EXPRESSION, SHORT_RESPONSE, EXTENDED_RESPONSE.'],
    evidence: ['Marks: official 110; the governed positions state no marks, so the form cannot be compared with 110.', 'Item count: not applicable to this paper. Five positions is a count of positions, not a share of an official count.'],
    gaps: ['The Section A / Section B marks split is not reproduced by the positions.', 'Two of five syllabus areas are absent.', 'Readiness for this paper counts items; a marks budget does not exist yet.'],
    sources: ['src/lib/exam-core/verticals/v2/ib-math-aa-hl.ts (section p1)', 'docs/audits/BLUEPRINT_GOVERNANCE_INVENTORY.csv', 'ibo-math-aa-guide-2021, ibo-math-aa-brief-2021 (cited by the configuration)'],
  },
};
const CLASS_MEANING = 'FULL: the full official form is governed · ALIGNED: follows the official distribution without the full length · REDUCED: a shortened form on StudyUs\'s own allocation · DEMO: a demonstration, never production · NOT_APPLICABLE: nothing can be delivered for it.';
function blueprintSection(n: number, blueprintId: string): string {
  const b = PILOT_BLUEPRINTS.find((x) => x.blueprintId === blueprintId)!;
  const t = BLUEPRINT_TEXT[blueprintId];
  const adapter = STUDYUS_ASSESSMENT_REGISTRY.adapter(b.adapterId)!;
  return [
    `## ${n}. Blueprint — ${b.adapterId}`, '',
    table(['Field', 'Value'], [['BLUEPRINT_ID', `\`${b.blueprintId}\``], ['SYSTEM_VERSION', `${adapter.systemId} @ ${adapter.systemVersionId}`], ['COMPONENT', adapter.component], ['PROPOSED_CLASSIFICATION', `**${b.proposedClass}** (proposed; not certified)`]]), '',
    '**Official / governed structure**', list(t.official), '', '**Current runtime structure**', list(t.runtime), '', '**Slot / objective coverage**', list(t.coverage), '', '**Format coverage**', list(t.formats), '',
    '**Marks / item-count evidence**', list(t.evidence), '', '**Gaps**', list(t.gaps), '',
    '**Why this class.** The class is derived from the structure alone; the content status of the items the configuration ships (`DEV_CERT_FIXTURE`) is not an input.',
    `Recorded facts: \`${JSON.stringify(b.facts)}\`. ${CLASS_MEANING}`,
    `A ${b.proposedClass} blueprint may serve practice and a reduced mock. It never serves a full mock.`, '',
    '**Bucket → concept links proposed with this classification**', table(['Bucket', 'Concept', 'Link'], b.buckets.map((x) => [`\`${x.bucket.bucketId}\``, x.bucket.primaryConceptStableIds.join(', '), x.conceptLink])), '',
    '**Evidence sources**', list(t.sources), '', decisionBlock('BLUEPRINT_CLASSIFICATION', b.blueprintId, `Classify ${b.blueprintId} as ${b.proposedClass}, with the bucket links above`), '',
  ].join('\n');
}

// --------------------------------------------------------------------------------------------------- cores
const envelopeFor = (familyId: string): RendererEnvelope => PILOT_ENVELOPES.find((e) => e.constructFamilyId === familyId)!;
function coreSection(n: number, index: number): string {
  const core = PILOT_CORES[index];
  const s = coreSemantics(core);
  const f = core.family as unknown as { specialization: { relationships: string[]; variables: { symbol: string; meaning: string; role: string }[]; parameterRanges: { symbol: string; min: number; max: number; step: number | null; note: string | null }[]; misconceptionModels: { id: string; description: string; producesError: string }[]; numericalDifficultyLevers: Record<string, string>[]; calculatorDependency: string }; responseConstraints: { allowedFormats: string[]; stimulusNeed: string; stimulusKinds: string[] }; supportedContexts: { kind: string }[] };
  const sp = f.specialization;
  const env = envelopeFor(core.constructFamilyId);
  const reasoning = PILOT_CORE_REASONING[core.constructFamilyId];
  const source = PILOT_CORE_SOURCES[core.constructFamilyId];
  const applicability = env.adapterIds.map((a) => pilotApplicability(core, a));
  const conditional = applicability.filter((a) => a.status === 'CONDITIONAL');
  return [
    `## ${n}. Core — ${s.primaryConcept.canonicalName}`, '',
    table(['Field', 'Value'], [
      ['CORE_ID', `\`${core.constructFamilyId}\``], ['VERSION', `\`${core.familyVersion}\` (lifecycle ${core.lifecycle})`], ['WRITTEN_FROM', `draft \`${source.draftId}\` @ ${source.draftVersion}. ${source.change}`],
      ['CANONICAL_CONCEPT', `\`${s.primaryConcept.stableId}\` — ${s.primaryConcept.canonicalName} (canonical subject: ${s.primaryConcept.canonicalSubject})`], ['TARGET_UNDERSTANDING', s.targetUnderstanding], ['OBSERVED_ON', s.observableEvidenceTarget], ['CONTENT_HASH', `\`${core.contentHash}\``],
    ]), '',
    '**Minimum successful reasoning path** (proposed wording)', reasoning.minimumSuccessfulPath.map((x, i) => `${i + 1}. ${x}`).join('\n'), '',
    table(['Reasoning', 'Value'], [['SUPPORTED_REASONING_STRATEGIES', reasoning.supportedStrategies.join(', ')], ['REQUIRED_OBSERVABLE_METHOD', reasoning.requiredObservableMethod ?? 'NONE — no method is required, and none is claimed from an answer-only response'], ['Construct necessity (the claim to check)', reasoning.necessity]]), '',
    '**Solution invariants**', list([...sp.relationships.map((r) => `Relationship: ${r}`), ...s.constraints.map((c) => `Constraint: ${c}`), ...s.validSolutionRules.map((r) => `Solution rule: ${r}`)]), '',
    '**Misconception models**', table(['Id', 'Description', 'Produces'], sp.misconceptionModels.map((m) => [m.id, m.description, m.producesError])), '',
    '**Shortcut / bypass constraints**', table(['Id', 'Bypass', 'Excluded formats', 'Rule every instance follows'], core.shortcutConstraints.map((c) => [c.id, c.bypass, c.excludedFormats.join(', ') || '—', c.instanceRule ?? 'none: the bypass stays open'])), '',
    '**Parameter envelope of the core**', table(['Symbol', 'Meaning', 'Min', 'Max', 'Step', 'Note'], sp.parameterRanges.map((r) => [r.symbol, sp.variables.find((v) => v.symbol === r.symbol)?.meaning ?? '', r.min, r.max, r.step ?? '—', r.note ?? ''])), '',
    '**Representation requirements**', list([`Response formats the core allows: ${f.responseConstraints.allowedFormats.join(', ')}.`, `Stimulus: ${f.responseConstraints.stimulusNeed}${f.responseConstraints.stimulusKinds.length ? ` (${f.responseConstraints.stimulusKinds.join(', ')})` : ''}. No diagram is needed.`, `Contexts: ${f.supportedContexts.map((c) => c.kind).join(', ')}.`, `Calculator dependency: ${sp.calculatorDependency}.`]), '',
    '**Applicability**', table(['Component', 'Status', 'Behaviour fit', 'Concept assessed there', 'Constraint / reason'], applicability.map((a) => [a.componentId, a.status, a.basis.behaviourSupport, `${a.basis.conceptApplicability.status} (${a.basis.conceptApplicability.basis})`, a.reason ?? '—'])), '',
    '**Difficulty mechanism** (the core\'s levers; the numbers are decided with the renderer, sections 7–8)', table(['Lever', 'Kind', ...PILOT_BANDS], sp.numericalDifficultyLevers.map((l) => [l.lever, l.kind, ...PILOT_BANDS.map((b) => l[b])])), '',
    '**Rights / provenance**', list([`Authored by ${s.provenance.authoredBy} (${s.provenance.authoringKind}); copied protected expression: ${s.provenance.containsCopiedProtectedExpression ? 'yes' : 'none'}.`, `Recorded note on the draft: "${s.provenance.note}"`, `Reference sources: ${s.provenance.referenceSourceKeys.join(', ')}.`]), '',
    decisionBlock('CONSTRUCT_CORE', core.constructFamilyId, `Certify core ${core.constructFamilyId} @ ${core.familyVersion}`),
    ...(conditional.length ? ['', ...conditional.map((a) => decisionBlock('CORE_APPLICABILITY', `${core.constructFamilyId} x ${a.componentId}`, `Approve the CONDITIONAL applicability to ${a.componentId}: ${a.constraints.map((c) => `${c.kind} = ${JSON.stringify((c as { formats?: unknown; bands?: unknown; contexts?: unknown; policies?: unknown }).formats ?? (c as { bands?: unknown }).bands ?? (c as { contexts?: unknown }).contexts ?? (c as { policies?: unknown }).policies)}`).join('; ')}`))] : []), '',
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ adapters
const RULE_AREA: Record<string, string> = {
  responseFormats: 'Formats / response types', commandTerms: 'Command terms', markStructure: 'Marks semantics', rubricStyle: 'Marks semantics', reasoningDepth: 'Response types', responseLength: 'Response types', calculatorPolicy: 'Calculator policy',
  stimulusExpectations: 'Representation constraints', contextExpectations: 'Representation constraints', timePressure: 'Component rules', competencyEmphasis: 'Component rules', competencyElicitation: 'Component rules', transferExpectations: 'Component rules',
  authenticityRequirements: 'Component rules', blueprintConstraints: 'Component rules',
};
const isEmpty = (v: unknown): boolean => (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);
function adapterSection(n: number, adapterId: string, extra: string[]): string {
  const pair = STUDYUS_ASSESSMENT_REGISTRY.profilePairOf(adapterId)!;
  const adapter = STUDYUS_ASSESSMENT_REGISTRY.adapter(adapterId)!;
  const resolved = resolveProfile(pair.system, pair.component);
  if (!resolved.ok) throw new Error(`ADAPTER_DOES_NOT_RESOLVE: ${adapterId}`);
  // a difference from a generation profile is read for what it is; it marks an adapter rule CONFLICT only when it asks something of the adapter
  const conflicts = reconcileAdapterDifferences(adapterConflicts().filter((c) => c.adapterId === adapterId), adapterById).filter((e) => !e.adapterIsValidAsItIs);
  const rows = Object.entries(resolved.resolved.rules as Record<string, { ruleId: string; value: unknown; authority: { kind: string; provisional?: boolean; assumption?: string; sources?: { sourceKey: string }[] } }>).map(([dimension, rule]) => {
    const conflict = conflicts.find((c) => c.dimension === dimension);
    const cls = conflict ? 'CONFLICT' : rule.authority.kind === 'OFFICIAL' ? 'OFFICIAL/GOVERNED' : isEmpty(rule.value) ? 'NOT_APPLICABLE' : rule.authority.provisional ? 'PROVISIONAL' : 'STUDYUS_POLICY';
    const basis = rule.authority.kind === 'OFFICIAL' ? `Sources: ${[...new Set((rule.authority.sources ?? []).map((x) => x.sourceKey))].join(', ')}` : rule.authority.assumption ?? '';
    return [RULE_AREA[dimension] ?? dimension, `\`${rule.ruleId}\``, `\`${JSON.stringify(rule.value)}\``, cls, basis, '[ ] ok  [ ] change'];
  });
  const count = (c: string) => rows.filter((r) => r[3] === c).length;
  return [
    `## ${n}. Adapter — ${adapterId}`, '',
    table(['Field', 'Value'], [['ADAPTER_ID', `\`${adapterId}\``], ['VERSION', `\`${adapter.version}\` (status ${adapter.status})`], ['SYSTEM_VERSION', `${adapter.systemId} @ ${adapter.systemVersionId}`], ['COMPONENT', adapter.component], ['Version binding', `\`${JSON.stringify((pair.component as { versionBinding?: { targetIdentity?: string; version?: string; componentKey?: string } }).versionBinding ?? null)}\``.slice(0, 400)]]), '',
    `Rules: ${rows.length} — OFFICIAL/GOVERNED ${count('OFFICIAL/GOVERNED')}, STUDYUS_POLICY ${count('STUDYUS_POLICY')}, PROVISIONAL ${count('PROVISIONAL')}, CONFLICT ${count('CONFLICT')}, NOT_APPLICABLE ${count('NOT_APPLICABLE')}.`,
    'PROVISIONAL = a StudyUs working assumption that nobody has confirmed. NOT_APPLICABLE = the rule is recorded as empty for this component. Approving the adapter confirms every PROVISIONAL line as StudyUs policy for this version.', '',
    table(['Area', 'Rule', 'Value', 'Class', 'Basis', 'Line check'], rows), '',
    '**Two dimensions the rules above keep apart**', table(['Dimension', 'What the adapter admits', 'Read from'], [['Item structure', itemStructuresOf(adapter).join(', '), `mark structure \`${adapter.marksRubric.markStructure}\``], ['Response representation', responseRepresentationsOf(adapter).join(', '), 'response formats'], ['Command terms (governed set)', adapter.commandTerms.use === 'NONE' ? 'none: plain questions' : `${adapter.commandTerms.terms.length}: ${adapter.commandTerms.terms.join(', ')}`, 'command-term rule']]), '', ...extra, '',
    decisionBlock('ASSESSMENT_ADAPTER', adapterId, `Certify adapter ${adapterId} @ ${adapter.version}`), '',
  ].join('\n');
}
const ibAdapter = adapterById(PILOT_IB)!;
const ibReading = reconcileAdapterDifferences(adapterConflicts().filter((c) => c.adapterId === PILOT_IB), adapterById);
const ibStructure = ibReading.find((e) => e.kind === 'STRUCTURE_LISTED_AS_A_RESPONSE_FORMAT');
const ibWider = ibReading.filter((e) => e.kind === 'ADAPTER_GOVERNS_MORE_THAN_THE_PROFILE_USES');
const ibUngoverned = ibReading.find((e) => e.kind === 'PROFILE_USES_A_VALUE_THE_ADAPTER_DOES_NOT_GOVERN' && e.dimension === 'commandTerms');
const pilotIbTerms = PILOT_ENVELOPES.filter((e) => e.adapterIds.includes(PILOT_IB)).flatMap((e) => e.commandTerms);
const PAA_EXTRA = [
  '**Language behaviour.** The adapter records no language rule. The pilot renders PAA instances in Spanish; that is fixed in the renderer envelopes (sections 7–8), not here.',
  '**Generation profile.** No difference was found between this adapter and the generation profile of the same component.',
];
const IB_EXTRA = [
  '**Language behaviour.** The adapter records no language rule. The pilot renders IB instances in English; that is fixed in the renderer envelope (section 7).', '',
  '### Item structure and response representation are two dimensions', '',
  `MULTI_PART says how an item is **structured** (several marked parts). MATH_EXPRESSION, SHORT_RESPONSE and EXTENDED_RESPONSE say how a response is **represented**. They do not compete: a multi-part item may have a part answered by a mathematical expression. This adapter admits the structures ${itemStructuresOf(ibAdapter).join(' and ')} and the representations ${responseRepresentationsOf(ibAdapter).join(', ')}.`, '',
  `The historical generation profile \`IB.MATH_AA.HL.P1\` lists ${(ibStructure?.values ?? []).join(', ')} among its "formats". That is a structure code; it is read here as structure, which the adapter ${ibStructure?.structureAdmitted ? 'admits' : 'does NOT admit'}. Nothing is chosen between the two, and the adapter is not changed.`,
  `The adapter also governs ${ibWider.filter((e) => e.dimension === 'responseFormats').flatMap((e) => e.values).join(', ') || 'no representation'} that the generation profile never asks for. A generator using less than the assessment model allows is not a defect of the model.`, '',
  'To note when deciding: the multi-part structure rests on `ib.marks = MULTI_MARK_PARTS`, a PROVISIONAL line of the table above (StudyUs\'s reading of the two recorded sections). Approving the adapter confirms it.', '',
  '### Command terms: what the adapter governs, and what the pilot renders', '',
  table(['Set', 'Count', 'Terms', 'Basis'], [
    ['Governed by this adapter', ibAdapter.commandTerms.terms.length, ibAdapter.commandTerms.terms.join(', '), 'Recorded in the configuration `v2.ib.math-aa-hl` (`commandTerms`), each with a description, cited to ibo-math-aa-guide-2021 / ibo-math-aa-brief-2021'],
    ['Written by the pilot renderer', pilotIbTerms.length, pilotIbTerms.join(', '), 'Renderer envelope, section 7: a subset of the governed set'],
    ['In the historical generation profile and not governed', ibUngoverned?.values.length ?? 0, (ibUngoverned?.values ?? []).join(', '), 'A bare list in `production/v5/generation-profile.ts` (`IB_MATH_TERMS`): no source and no description is recorded for these terms'],
  ]), '',
  'The adapter exposes the complete set the repository governs. It is not narrowed to what a renderer writes, and it is not widened from a list that cites no source. If the authoritative IB source supports further terms, they enter the adapter by being recorded in the configuration with their source and description; that is a new adapter version, decided again.', '',
  'Command-term set to certify now:  [ ] the governed set shown above   [ ] record further terms from the source first (which: ______)', '',
];

// ----------------------------------------------------------------------------------------------- renderers
const coreRangesOf = (familyId: string) => (PILOT_CORES.find((c) => c.constructFamilyId === familyId)!.family as unknown as { specialization: { parameterRanges: { symbol: string; min: number; max: number; step: number | null }[] } }).specialization.parameterRanges;
const capacityOf = (env: RendererEnvelope, band: (typeof PILOT_BANDS)[number]): number => (env.construct.startsWith('QUADRATIC') ? quadraticInstanceCapacity(band, coreRangesOf(env.constructFamilyId)) : proportionInstanceCapacity(band, coreRangesOf(env.constructFamilyId)));
function rendererSection(n: number, env: RendererEnvelope, title: string): string {
  const outside = rangesOutsideTheCore(env, coreRangesOf(env.constructFamilyId));
  return [
    `## ${n}. Renderer — ${title}`, '',
    table(['Field', 'Value'], [
      ['RENDERER_VERSION', `\`${env.rendererVersion}\` (status PROVISIONAL)`], ['STRATEGY', `${env.strategy}: the same seed gives the same instance; no model is called`], ['CORE', `\`${env.constructFamilyId}\` @ \`${env.constructFamilyVersion}\``],
      ['ADAPTERS', env.adapterIds.join(', ')], ['LANGUAGES', env.languages.join(', ')], ['RESPONSE_FORMATS', env.responseFormats.join(', ')], ['COMMAND_TERMS written', env.commandTerms.length ? `${env.commandTerms.join(', ')} — a subset of what each adapter governs` : 'none (plain questions)'], ['REPRESENTATION', env.stimulusKinds.length ? env.stimulusKinds.join(', ') : 'Text only: no stimulus, no table, no diagram'],
      ['ENVELOPE_HASH', `\`${envelopeHashOf(env)}\``], ['Envelope ranges inside the core\'s ranges', outside.length === 0 ? 'yes' : `NO: ${outside.join('; ')}`],
    ]), '',
    '**Parameter envelope**', table(['Symbol', 'Min', 'Max', 'Step'], env.parameterRanges.map((r) => [r.symbol, r.min, r.max, r.step ?? '—'])), '',
    '**Bands and the item difficulty proposed for each** — the number is yours to set; the Student-facing band follows from it (1–2 LOW, 3 MEDIUM, 4–5 HIGH)',
    table(['Planning band (internal)', 'What its instances are', 'Distinct instances available', 'Proposed item difficulty', 'Your item difficulty (1–5)'], env.bands.map((b) => [b.planningBand, b.leverSettings.join(' '), capacityOf(env, b.planningBand), b.itemDifficulty, '____'])), '',
    `With the proposed numbers this envelope supplies the Student bands: ${studentBandsOf(env).join(', ')}. Any change to a number changes the envelope hash; the changed envelope is decided again.`, '',
    '**Left out on purpose**', list(env.exclusions), '',
    'Key and marking: the key is computed from the parameter set by the renderer; an answer-only response is judged as one exact value (integer, fraction or decimal, either decimal separator). Samples are in section 9.', '',
    decisionBlock('RENDERER_ENVELOPE', env.rendererVersion, `Certify the envelope of ${env.rendererVersion} with the item difficulties you set above`), '',
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------- samples
const sampleRows = (list_: PilotInstance[]) => list_.map((i) => [`\`${i.instanceId.split(':')[1]}\``, i.planningBand, i.prompt, i.answers.join(' ; '), i.marks, '[ ] ok  [ ] defect']);
function edgeSamples(coreIndex: number, measure: (i: PilotInstance) => number): PilotInstance[] {
  const out: PilotInstance[] = [];
  for (const band of PILOT_BANDS) {
    let lo: PilotInstance | null = null; let hi: PilotInstance | null = null;
    for (let n = 1; n <= 1500; n += 1) {
      const r = renderPilotInstance(PILOT_CORES[coreIndex], PILOT_TARGET_PAA, band, `${PILOT_ID}/edge/${band.toLowerCase()}/${n}`, 'STUDENT_SUPPLY_CANDIDATE');
      if (!r.ok) throw new Error(`EDGE_SAMPLE_REFUSED: ${r.code} ${r.detail}`);
      if (!lo || measure(r.instance) < measure(lo)) lo = r.instance;
      if (!hi || measure(r.instance) > measure(hi)) hi = r.instance;
    }
    out.push(lo!, hi!);
  }
  return out;
}
const num = (i: PilotInstance, k: string): number => Number(i.rendered.parameterSet[k]);
function samplesSection(n: number): string {
  const of = (familyId: string, role: PilotInstance['role']) => instances.filter((i) => i.coreId === familyId && i.role === role);
  const [quad, prop] = PILOT_CORES;
  const ib = of(quad.constructFamilyId, 'CROSS_MODEL_PROOF');
  const quadEdges = edgeSamples(0, (i) => Math.abs(num(i, 'r1')) + Math.abs(num(i, 'r2')));
  const propEdges = edgeSamples(1, (i) => num(i, 'c') / num(i, 'a') + num(i, 'b') / 1000);
  return [
    `## ${n}. Per-band samples`, '',
    'These are real outputs of the two renderers. The first three rows of each band are the pilot instances themselves; the "edge" rows are the smallest and the largest parameter sets met in 1,500 seeds per band. Mark any row that has a defect; a defect in a row is a reason to answer the renderer decision with APPROVE_WITH_CHANGES or REJECT.', '',
    '### 9.1 Quadratics — PAA Matemáticas (Spanish, numeric entry, 1 mark)', table(['Instance', 'Band', 'Prompt', 'Key', 'Marks', 'Check'], sampleRows(of(quad.constructFamilyId, 'STUDENT_SUPPLY_CANDIDATE'))), '',
    '### 9.2 Quadratics — the same seeds under IB Mathematics AA HL Paper 1 (English, short response, working marked; any valid method earns the method mark)', table(['Instance', 'Band', 'Prompt', 'Key', 'Marks', 'Check'], sampleRows(ib)), '',
    'Mark scheme the renderer produced for the first IB instance of each band:', '', ...PILOT_BANDS.map((b) => { const i = ib.find((x) => x.planningBand === b)!; return `- ${b} — ${i.prompt}\n${i.rendered.rubric.map((r) => `  - ${r.code} (${r.marks}): ${r.criterion}`).join('\n')}`; }), '',
    '### 9.3 Quadratics — edge parameter sets (PAA form)', table(['Instance', 'Band', 'Prompt', 'Key', 'Marks', 'Check'], sampleRows(quadEdges)), '',
    '### 9.4 Proportion — PAA Matemáticas (Spanish, numeric entry, 1 mark)', table(['Instance', 'Band', 'Prompt', 'Key', 'Marks', 'Check'], sampleRows(of(prop.constructFamilyId, 'STUDENT_SUPPLY_CANDIDATE'))), '',
    '### 9.5 Proportion — edge parameter sets', table(['Instance', 'Band', 'Prompt', 'Key', 'Marks', 'Check'], sampleRows(propEdges)), '',
  ].join('\n');
}

// -------------------------------------------------------------------------------------------------- output
const [quadEnv, propEnv] = PILOT_ENVELOPES;
const sections = [
  blueprintSection(1, 'v2.paa/matematicas'), blueprintSection(2, 'v2.ib.math-aa-hl/p1'), coreSection(3, 0), coreSection(4, 1), adapterSection(5, PILOT_PAA, PAA_EXTRA), adapterSection(6, PILOT_IB, IB_EXTRA),
  rendererSection(7, quadEnv, 'quadratics, solve (method-neutral)'), rendererSection(8, propEnv, 'proportion, missing value'), samplesSection(9),
];
const outOfScope = decisions.filter((d) => !d.withinProposedScopes);
const packet = [
  '# Step 4B — human review packet', '',
  `Pilot \`${PILOT_ID}\` · reviewer: \`${PILOT_REVIEWER_ID}\` (an internal StudyUs certification authority for this pilot; not an external academic accreditation).`,
  `Scopes stated for the reviewer: ${PILOT_REVIEWER_SCOPES.map((s) => `${s.canonicalSubject} × ${s.systemId}`).join(', ')}.`, '',
  `Generated by \`scripts/operations/qf-step4b/build-review-packet.ts\` from the repository; no decision in this file is filled in. There are ${decisions.length} decisions. Each allows APPROVE, APPROVE_WITH_CHANGES or REJECT.`,
  'APPROVE certifies exactly what is shown, identified by its evidence hash. APPROVE_WITH_CHANGES certifies nothing: the changed object is prepared again and decided again. Record the decisions in `STEP4B_CERTIFICATION_DECISIONS.csv`.', '',
  '**This packet replaces the earlier Step 4B packet.** Every evidence hash of the earlier packet is void. Withdrawn before any decision was recorded:', list(WITHDRAWN_CORE_VERSIONS.map((w) => `\`${w.constructFamilyId}\` @ ${w.version} — ${w.reason}`)), '',
  ...(outOfScope.length ? ['**Scope question to settle before sections 4 and 8.** The proportion core belongs to the canonical subject "Matemáticas", and the repository keeps "Matemáticas" and "Mathematics" as two canonical subjects that are never inferred from one another. The scopes stated above are both "Mathematics". These decisions are therefore outside the stated scopes until a "Matemáticas × PAA" scope is stated for the reviewer:', list(outOfScope.map((d) => `${d.objectType} \`${d.objectId}\``)), ''] : []),
  ...sections,
].join('\n');

const instancesJson = `${JSON.stringify({
  pilot: PILOT_ID, status: 'NOT_STUDENT_ELIGIBLE_PENDING_HUMAN_CERTIFICATION', rights: PILOT_INSTANCE_RIGHTS,
  note: 'Rendered locally and deterministically. In no database. Not Student-eligible: no certification record exists for any object these instances depend on.',
  counts: { total: instances.length, studentSupplyCandidates: instances.filter((i) => i.role === 'STUDENT_SUPPLY_CANDIDATE').length, crossModelProof: instances.filter((i) => i.role === 'CROSS_MODEL_PROOF').length, studentEligible: instances.filter((i) => i.studentEligible).length },
  instances: instances.map((i) => ({
    INSTANCE_ID: i.instanceId, ROLE: i.role, CORE_ID: i.coreId, CORE_VERSION: i.coreVersion, CONCEPT: i.conceptId, SYSTEM: i.systemId, ADAPTER_ID: i.adapterId, ADAPTER_VERSION: i.adapterVersion, RENDERER_VERSION: i.rendererVersion,
    BLUEPRINT: i.blueprintBucketId, BLUEPRINT_CLASS_PROPOSED: i.blueprintClass, SEED: i.seed, DIFFICULTY_1_TO_5: i.itemDifficulty, DIFFICULTY_BAND: i.difficultyBand, PROMPT: i.prompt, ANSWER: i.answers, MARKS: i.marks,
    RESPONSE_FORMAT: i.rendered.learner.itemType, LANGUAGE: i.rendered.learner.language, RUBRIC: i.rendered.rubric, RESPONSE_POLICY: i.rendered.responsePolicy, PARAMETER_SET: i.rendered.parameterSet,
    LINEAGE: i.certifiedLineage.lineage, ENVELOPE_HASH: i.certifiedLineage.envelopeHash, CONTENT_HASH: i.certifiedLineage.contentHash, LINEAGE_HASH: i.certifiedLineage.digest, INSIDE_ENVELOPE: i.envelopeIssues.length === 0,
    CERTIFICATION_INHERITANCE_STATUS: i.certification.certified ? i.certification.mode : 'NOT_CERTIFIED', CERTIFICATION_BLOCKERS: i.certification.certified ? [] : i.certification.inheritance, STUDENT_ELIGIBLE: i.studentEligible,
  })),
}, null, 2)}\n`;

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const decisionsCsv = `${[
  ['DECISION_ID', 'SECTION', 'OBJECT_TYPE', 'OBJECT_ID', 'OBJECT_VERSION', 'CANONICAL_SUBJECT', 'SYSTEM', 'EVIDENCE_HASH', 'WITHIN_STATED_SCOPES', 'DECISION', 'REVIEWER', 'DECIDED_AT', 'NOTES'],
  ...[...decisions].sort((x, y) => order(x) - order(y)).map((d, i) => [`D${String(i + 1).padStart(2, '0')}`, d.section, d.objectType, d.objectId, d.objectVersion, d.scope.canonicalSubject, d.scope.systemId, d.contentHash, d.withinProposedScopes ? 'YES' : 'NO', '', '', '', '']),
].map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
function order(d: { objectType: string; objectId: string }): number {
  const key = `${d.objectType}|${d.objectId}`;
  const sequence = [
    `BLUEPRINT_CLASSIFICATION|v2.paa/matematicas`, `BLUEPRINT_CLASSIFICATION|v2.ib.math-aa-hl/p1`, `CONSTRUCT_CORE|${PILOT_CORES[0].constructFamilyId}`, `CORE_APPLICABILITY|${PILOT_CORES[0].constructFamilyId} x ${PILOT_PAA}`,
    `CONSTRUCT_CORE|${PILOT_CORES[1].constructFamilyId}`, `ASSESSMENT_ADAPTER|${PILOT_PAA}`, `ASSESSMENT_ADAPTER|${PILOT_IB}`, `RENDERER_ENVELOPE|${quadEnv.rendererVersion}`, `RENDERER_ENVELOPE|${propEnv.rendererVersion}`,
  ];
  const at = sequence.indexOf(key);
  return at === -1 ? sequence.length : at;
}
if (decisionNo !== decisions.length) throw new Error(`PACKET_DOES_NOT_ASK_EVERY_DECISION: ${decisionNo} of ${decisions.length}`);
void PILOT_TARGET_IB;

const outputs: [string, string][] = [[FILES.packet, `${packet}\n`], [FILES.instances, instancesJson], [FILES.decisions, decisionsCsv]];
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([name, content]) => { try { return readFileSync(join(OUT, name), 'utf8') !== content; } catch { return true; } }).map(([name]) => name);
  if (stale.length > 0) { console.error(`STEP4B_ARTEFACTS_STALE: ${stale.join(', ')}`); process.exit(1); }
  console.log('STEP4B_ARTEFACTS = CURRENT');
} else {
  for (const [name, content] of outputs) writeFileSync(join(OUT, name), content);
  const by = (band: string) => instances.filter((i) => i.role === 'STUDENT_SUPPLY_CANDIDATE' && i.difficultyBand === band).length;
  console.log(`decisions ${decisions.length} · instances ${instances.length} (supply candidates ${instances.filter((i) => i.role === 'STUDENT_SUPPLY_CANDIDATE').length}: LOW ${by('LOW')} / MEDIUM ${by('MEDIUM')} / HIGH ${by('HIGH')}; cross-model ${instances.filter((i) => i.role === 'CROSS_MODEL_PROOF').length}) · Student-eligible ${instances.filter((i) => i.studentEligible).length}`);
}
