#!/usr/bin/env python3
"""Builds Q1C1_paa_certified_topics.csv mechanically from
  - Q1C_paa_topic_catalog_draft.csv   (78 rows, Q1-C)
  - the five Topic splits certified in Q1-C.1 (one is three-way: +6 rows)
  - the Q1-C.1 concept dispositions (draft concept -> certified stable id).
No Topic wording is authored here beyond the split labels certified in Q1-C.1."""
import csv, os
HERE = os.path.dirname(os.path.abspath(__file__))
SPLITS = {
    'Ecuaciones cuadráticas, racionales, con radicales y valor absoluto': [('Ecuaciones cuadráticas', 'math.alg.quadratics'), ('Ecuaciones racionales, con radicales y con valor absoluto', 'math.alg.rational-radical-absolute-equations')],
    'Funciones lineales, cuadráticas y exponenciales': [('Funciones lineales', 'math.fun.linear-functions-lines'), ('Funciones cuadráticas', 'math.alg.quadratics'), ('Funciones exponenciales', 'math.fun.exponential')],
    'Círculos y polígonos': [('Círculo', 'math.geo.circles'), ('Polígonos: clasificación y propiedades', 'math.geo.plane-figures-area-perimeter')],
    'Notación científica, valor posicional y estimación': [('Notación científica', 'math.num.powers-scientific-notation'), ('Valor posicional y estimación', 'math.num.real-numbers')],
    'Inflection (verbs, noun forms, comparatives, parallel structure)': [('Verb forms (tense, agreement, voice, auxiliaries)', 'efl.grammar.verb-forms'), ('Noun, adjective and adverb forms (plural, possessive, comparative)', 'efl.grammar.noun-adjective-forms')],
}
TOPIC_OVERRIDE = {  # Topics whose certified concept differs from the draft concept's general mapping
    'Propósito o tesis de la lectura': 'read.central-idea',
    'Identificación de evidencias': 'read.textual-evidence',
    'Comparación y contraste de información y argumentos': 'read.cross-text-relations',
    'Géneros literarios': 'lit.genres',
    'Estructura del texto literario y tipos de discurso': 'read.text-structure',
}
CONCEPT = {
    'Vocabulario en contexto': 'read.vocabulary-in-context', 'Ideas explícitas y tesis': 'read.explicit-information', 'Tema y resumen': 'read.central-idea',
    'Inferencia textual': 'read.inference', 'Relaciones lógicas en el texto': 'read.text-structure', 'Tipos de discurso y estructura textual': 'read.text-structure',
    'Lectura de tablas y gráficos': 'read.tables-and-graphics', 'Elementos narrativos': 'lit.narrative-elements', 'Elementos poéticos': 'lit.poetic-elements', 'Figuras retóricas': 'lit.figurative-language',
    'Elisión': 'write.concision-elision', 'Adición': 'write.stylistic-addition', 'Generalización': 'write.generalization', 'Integración': 'write.global-synthesis', 'Particularización': 'write.indirect-expression',
    'Operaciones con números reales': 'math.num.real-numbers', 'Fracciones': 'math.num.fractions-decimals', 'Proporcionalidad': 'math.num.ratio-proportion', 'Porcentajes': 'math.num.percent',
    'Patrones numéricos': 'math.alg.patterns-sequences', 'Divisibilidad, MCD y MCM': 'math.num.divisibility', 'Exponentes enteros': 'math.num.powers-scientific-notation',
    'Expresiones algebraicas': 'math.alg.expressions', 'Ecuaciones lineales': 'math.alg.linear-equations', 'Inecuaciones lineales': 'math.alg.linear-inequalities',
    'Exponentes racionales y radicales': 'math.alg.radicals-rational-exponents', 'Polinomios': 'math.alg.polynomials', 'Variación directa e inversa': 'math.alg.variation',
    'Patrones algebraicos y sucesiones': 'math.alg.patterns-sequences', 'Rectas y pendiente': 'math.fun.linear-functions-lines', 'Funciones': 'math.fun.functions',
    'Operaciones con funciones': 'math.fun.functions', 'Relaciones de cambio': 'math.fun.linear-functions-lines', 'Sistemas de ecuaciones': 'math.alg.linear-systems', 'Razones trigonométricas': 'math.trig.ratios',
    'Coordenadas cartesianas': 'math.geo.coordinate-plane', 'Transformaciones geométricas': 'math.geo.transformations', 'Distancia y punto medio': 'math.geo.coordinate-plane', 'Rectas y ángulos': 'math.geo.angles-lines',
    'Semejanza y congruencia': 'math.geo.similarity-congruence', 'Teorema de Pitágoras': 'math.geo.pythagorean-theorem', 'Área y perímetro': 'math.geo.plane-figures-area-perimeter', 'Volumen y área de superficie': 'math.geo.solids-volume-surface',
    'Medidas de tendencia central': 'math.stat.central-tendency', 'Medidas de dispersión': 'math.stat.dispersion', 'Interpretación de tablas y gráficas estadísticas': 'math.stat.data-representation',
    'Técnicas de conteo': 'math.prob.counting', 'Probabilidad': 'math.prob.probability', 'Población y muestra': 'math.stat.population-sample', 'Probabilidad condicional': 'math.prob.conditional',
    'English vocabulary in context': 'efl.vocabulary', 'English sentence structure': 'efl.grammar.sentence-structure', 'English function words': 'efl.grammar.function-words',
    'Reading comprehension in English': 'efl.reading.literal', 'Inference in English texts': 'efl.reading.interpretive', 'Author purpose, tone and fact vs opinion': 'efl.reading.interpretive',
    'English sentence correction and error identification': '', 'English sentence combining': 'efl.writing.complex-sentences', 'English paragraph revision': 'efl.writing.paragraph-organization',
}
draft = list(csv.DictReader(open(os.path.join(HERE, 'Q1C_paa_topic_catalog_draft.csv'), encoding='utf-8')))
assert len(draft) == 78
certified = {r['stable_id'] for r in csv.DictReader(open(os.path.join(HERE, 'Q1C1_paa_certified_concepts.csv'), encoding='utf-8'))}
out, used_splits = [], set()
for r in draft:
    base = dict(section=r['section'], official_domain=r['official_domain'], topic_authority='OFFICIAL' if r['topic_authority'] == 'OFFICIAL_SOURCE_LINE' else 'STUDYUS_POLICY', source_reference=r['source_reference'])
    if r['topic'] in SPLITS:
        used_splits.add(r['topic'])
        for label, cid in SPLITS[r['topic']]:
            out.append(dict(base, topic=label, certified_concept_id=cid, q1c1_status='SPLIT', draft_topic=r['topic'], note=''))
        continue
    cid = TOPIC_OVERRIDE.get(r['topic'], CONCEPT[r['target_concept']] if r['target_concept'] in CONCEPT else None)
    assert cid is not None, r
    out.append(dict(base, topic=r['topic'], certified_concept_id=cid, q1c1_status='KEEP', draft_topic=r['topic'],
                    note='Exam Skill; PRIMARY concept is the grammar concept the item tests' if cid == '' else ''))
assert used_splits == set(SPLITS), set(SPLITS) - used_splits
assert len(out) == 84, len(out)
ids = {o['certified_concept_id'] for o in out if o['certified_concept_id']}
assert ids <= certified, ids - certified
assert ids == certified, certified - ids
for i, o in enumerate(out, 1):
    o['order'] = i
with open(os.path.join(HERE, 'Q1C1_paa_certified_topics.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=['order', 'section', 'official_domain', 'topic', 'topic_authority', 'source_reference', 'certified_concept_id', 'q1c1_status', 'draft_topic', 'note'])
    w.writeheader(); w.writerows(out)
import collections
print(len(out), dict(collections.Counter(o['section'] for o in out)), 'domains', len({(o['section'], o['official_domain']) for o in out}), 'concepts referenced', len(ids), 'policy topics', sum(o['topic_authority'] == 'STUDYUS_POLICY' for o in out))
