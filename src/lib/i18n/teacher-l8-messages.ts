/**
 * L8 (TE-1, TE-2) -- copy for the Teacher's individual practice form on the
 * learner page and for the class exam-insights view. A standalone catalogue:
 * read through getTeacherL8Messages, not merged into messages.ts. The
 * compiler requires every key in every locale.
 */
import type { Locale } from './messages';

export type TeacherL8MessageKey =
  | 'l8.nav.exams'
  | 'l8.individual.title' | 'l8.individual.body' | 'l8.individual.concept' | 'l8.individual.none'
  | 'l8.individual.instructions' | 'l8.individual.submit' | 'l8.individual.done' | 'l8.individual.error'
  | 'l8.exams.title' | 'l8.exams.scope' | 'l8.exams.filter' | 'l8.exams.filter.all'
  | 'l8.exams.noLearners' | 'l8.exams.noLearners.body' | 'l8.exams.noData' | 'l8.exams.noData.body'
  | 'l8.exams.summary.learners' | 'l8.exams.summary.preparing' | 'l8.exams.summary.withGaps'
  | 'l8.exams.goals.title' | 'l8.exams.goals.empty'
  | 'l8.exams.domains.title' | 'l8.exams.objectives.title' | 'l8.exams.concepts.title' | 'l8.exams.gaps.empty'
  | 'l8.exams.learnerCount'
  | 'l8.exams.students.title' | 'l8.exams.students.goals' | 'l8.exams.students.noGoals' | 'l8.exams.students.examDate'
  | 'l8.exams.students.gaps' | 'l8.exams.students.noGaps' | 'l8.exams.students.concepts'
  | 'l8.exams.students.aice' | 'l8.exams.students.assign';

export type TeacherL8Messages = Record<TeacherL8MessageKey, string>;

const ES: TeacherL8Messages = {
  'l8.nav.exams': 'Exámenes',
  'l8.individual.title': 'Práctica individual',
  'l8.individual.body': 'Asigna a este estudiante una práctica sobre uno de sus propios temas de esta clase. Solo la recibe este estudiante.',
  'l8.individual.concept': 'Tema',
  'l8.individual.none': 'Este estudiante todavía no tiene temas de esta clase en su plan. Usa «Asignar» más arriba para añadir uno.',
  'l8.individual.instructions': 'Indicaciones (opcional)',
  'l8.individual.submit': 'Asignar práctica',
  'l8.individual.done': 'Práctica asignada.',
  'l8.individual.error': 'No pudimos asignar la práctica. Inténtalo de nuevo.',
  'l8.exams.title': 'Dificultades en exámenes',
  'l8.exams.scope': 'Solo ves a los estudiantes activos de esta clase. Los datos salen del último intento calificado de cada estudiante en cada examen; nunca se muestran respuestas individuales.',
  'l8.exams.filter': 'Examen',
  'l8.exams.filter.all': 'Todos',
  'l8.exams.noLearners': 'Esta clase todavía no tiene estudiantes activos.',
  'l8.exams.noLearners.body': 'Cuando haya estudiantes inscritos verás aquí sus exámenes y dificultades.',
  'l8.exams.noData': 'Aún no hay exámenes ni dificultades que mostrar.',
  'l8.exams.noData.body': 'Ningún estudiante de esta clase prepara un examen ni tiene un intento calificado con dificultades.',
  'l8.exams.summary.learners': 'Estudiantes activos',
  'l8.exams.summary.preparing': 'Preparan un examen',
  'l8.exams.summary.withGaps': 'Con dificultades en exámenes',
  'l8.exams.goals.title': 'Exámenes que prepara la clase',
  'l8.exams.goals.empty': 'Ningún estudiante de esta clase ha elegido un examen todavía.',
  'l8.exams.domains.title': 'Dificultades por área',
  'l8.exams.objectives.title': 'Dificultades por objetivo',
  'l8.exams.concepts.title': 'Dificultades por tema',
  'l8.exams.gaps.empty': 'No hay dificultades registradas en los intentos calificados.',
  'l8.exams.learnerCount': '{n} {n:estudiante|estudiantes}',
  'l8.exams.students.title': 'Por estudiante',
  'l8.exams.students.goals': 'Prepara',
  'l8.exams.students.noGoals': 'Sin examen elegido',
  'l8.exams.students.examDate': 'fecha {date}',
  'l8.exams.students.gaps': '{n} {n:objetivo con dificultad|objetivos con dificultad}',
  'l8.exams.students.noGaps': 'Sin dificultades registradas en exámenes',
  'l8.exams.students.concepts': 'Temas a reforzar',
  'l8.exams.students.aice': 'Plan AICE',
  'l8.exams.students.assign': 'Asignar refuerzo',
};

const EN: TeacherL8Messages = {
  'l8.nav.exams': 'Exams',
  'l8.individual.title': 'Individual practice',
  'l8.individual.body': 'Assign this student practice on one of their own topics from this class. Only this student receives it.',
  'l8.individual.concept': 'Topic',
  'l8.individual.none': 'This student has no topics from this class in their plan yet. Use “Assign” above to add one.',
  'l8.individual.instructions': 'Instructions (optional)',
  'l8.individual.submit': 'Assign practice',
  'l8.individual.done': 'Practice assigned.',
  'l8.individual.error': 'We could not assign the practice. Try again.',
  'l8.exams.title': 'Exam gaps',
  'l8.exams.scope': 'You only see the active students of this class. The data comes from each student’s latest scored attempt in each exam; individual answers are never shown.',
  'l8.exams.filter': 'Exam',
  'l8.exams.filter.all': 'All',
  'l8.exams.noLearners': 'This class has no active students yet.',
  'l8.exams.noLearners.body': 'Once students are enrolled you will see their exams and gaps here.',
  'l8.exams.noData': 'There are no exams or gaps to show yet.',
  'l8.exams.noData.body': 'No student in this class is preparing an exam or has a scored attempt with gaps.',
  'l8.exams.summary.learners': 'Active students',
  'l8.exams.summary.preparing': 'Preparing an exam',
  'l8.exams.summary.withGaps': 'With exam gaps',
  'l8.exams.goals.title': 'Exams this class is preparing',
  'l8.exams.goals.empty': 'No student in this class has chosen an exam yet.',
  'l8.exams.domains.title': 'Gaps by area',
  'l8.exams.objectives.title': 'Gaps by objective',
  'l8.exams.concepts.title': 'Gaps by topic',
  'l8.exams.gaps.empty': 'No gaps are recorded in the scored attempts.',
  'l8.exams.learnerCount': '{n} {n:student|students}',
  'l8.exams.students.title': 'By student',
  'l8.exams.students.goals': 'Preparing',
  'l8.exams.students.noGoals': 'No exam chosen',
  'l8.exams.students.examDate': 'date {date}',
  'l8.exams.students.gaps': '{n} {n:objective with a gap|objectives with gaps}',
  'l8.exams.students.noGaps': 'No exam gaps recorded',
  'l8.exams.students.concepts': 'Topics to reinforce',
  'l8.exams.students.aice': 'AICE plan',
  'l8.exams.students.assign': 'Assign reinforcement',
};

const DE: TeacherL8Messages = {
  'l8.nav.exams': 'Prüfungen',
  'l8.individual.title': 'Individuelle Übung',
  'l8.individual.body': 'Weise dieser Schülerin oder diesem Schüler eine Übung zu einem eigenen Thema dieser Klasse zu. Nur diese Person erhält sie.',
  'l8.individual.concept': 'Thema',
  'l8.individual.none': 'Im Plan dieser Person gibt es noch keine Themen dieser Klasse. Nutze oben „Zuweisen“, um eines hinzuzufügen.',
  'l8.individual.instructions': 'Hinweise (optional)',
  'l8.individual.submit': 'Übung zuweisen',
  'l8.individual.done': 'Übung zugewiesen.',
  'l8.individual.error': 'Die Übung konnte nicht zugewiesen werden. Versuche es erneut.',
  'l8.exams.title': 'Lücken in Prüfungen',
  'l8.exams.scope': 'Du siehst nur die aktiven Lernenden dieser Klasse. Die Daten stammen aus dem letzten bewerteten Versuch jeder Person pro Prüfung; einzelne Antworten werden nie angezeigt.',
  'l8.exams.filter': 'Prüfung',
  'l8.exams.filter.all': 'Alle',
  'l8.exams.noLearners': 'Diese Klasse hat noch keine aktiven Lernenden.',
  'l8.exams.noLearners.body': 'Sobald Lernende eingeschrieben sind, siehst du hier ihre Prüfungen und Lücken.',
  'l8.exams.noData': 'Es gibt noch keine Prüfungen oder Lücken anzuzeigen.',
  'l8.exams.noData.body': 'Niemand in dieser Klasse bereitet eine Prüfung vor oder hat einen bewerteten Versuch mit Lücken.',
  'l8.exams.summary.learners': 'Aktive Lernende',
  'l8.exams.summary.preparing': 'Bereiten eine Prüfung vor',
  'l8.exams.summary.withGaps': 'Mit Lücken in Prüfungen',
  'l8.exams.goals.title': 'Prüfungen, die die Klasse vorbereitet',
  'l8.exams.goals.empty': 'Niemand in dieser Klasse hat bisher eine Prüfung gewählt.',
  'l8.exams.domains.title': 'Lücken nach Bereich',
  'l8.exams.objectives.title': 'Lücken nach Lernziel',
  'l8.exams.concepts.title': 'Lücken nach Thema',
  'l8.exams.gaps.empty': 'In den bewerteten Versuchen sind keine Lücken erfasst.',
  'l8.exams.learnerCount': '{n} {n:Lernende:r|Lernende}',
  'l8.exams.students.title': 'Nach Lernenden',
  'l8.exams.students.goals': 'Bereitet vor',
  'l8.exams.students.noGoals': 'Keine Prüfung gewählt',
  'l8.exams.students.examDate': 'Termin {date}',
  'l8.exams.students.gaps': '{n} {n:Lernziel mit Lücke|Lernziele mit Lücken}',
  'l8.exams.students.noGaps': 'Keine Lücken in Prüfungen erfasst',
  'l8.exams.students.concepts': 'Themen zum Festigen',
  'l8.exams.students.aice': 'AICE-Plan',
  'l8.exams.students.assign': 'Förderung zuweisen',
};

const FR: TeacherL8Messages = {
  'l8.nav.exams': 'Examens',
  'l8.individual.title': 'Pratique individuelle',
  'l8.individual.body': 'Attribuez à cet élève une pratique sur l’un de ses propres thèmes de cette classe. Seul cet élève la reçoit.',
  'l8.individual.concept': 'Thème',
  'l8.individual.none': 'Cet élève n’a pas encore de thèmes de cette classe dans son plan. Utilisez « Attribuer » plus haut pour en ajouter un.',
  'l8.individual.instructions': 'Consignes (facultatif)',
  'l8.individual.submit': 'Attribuer la pratique',
  'l8.individual.done': 'Pratique attribuée.',
  'l8.individual.error': 'Impossible d’attribuer la pratique. Réessayez.',
  'l8.exams.title': 'Difficultés aux examens',
  'l8.exams.scope': 'Vous ne voyez que les élèves actifs de cette classe. Les données proviennent de la dernière tentative notée de chaque élève à chaque examen ; les réponses individuelles ne sont jamais affichées.',
  'l8.exams.filter': 'Examen',
  'l8.exams.filter.all': 'Tous',
  'l8.exams.noLearners': 'Cette classe n’a pas encore d’élèves actifs.',
  'l8.exams.noLearners.body': 'Dès que des élèves seront inscrits, vous verrez ici leurs examens et leurs difficultés.',
  'l8.exams.noData': 'Aucun examen ni aucune difficulté à afficher pour l’instant.',
  'l8.exams.noData.body': 'Aucun élève de cette classe ne prépare un examen ni n’a de tentative notée avec des difficultés.',
  'l8.exams.summary.learners': 'Élèves actifs',
  'l8.exams.summary.preparing': 'Préparent un examen',
  'l8.exams.summary.withGaps': 'Avec des difficultés aux examens',
  'l8.exams.goals.title': 'Examens préparés par la classe',
  'l8.exams.goals.empty': 'Aucun élève de cette classe n’a encore choisi d’examen.',
  'l8.exams.domains.title': 'Difficultés par domaine',
  'l8.exams.objectives.title': 'Difficultés par objectif',
  'l8.exams.concepts.title': 'Difficultés par thème',
  'l8.exams.gaps.empty': 'Aucune difficulté n’est enregistrée dans les tentatives notées.',
  'l8.exams.learnerCount': '{n} {n:élève|élèves}',
  'l8.exams.students.title': 'Par élève',
  'l8.exams.students.goals': 'Prépare',
  'l8.exams.students.noGoals': 'Aucun examen choisi',
  'l8.exams.students.examDate': 'date {date}',
  'l8.exams.students.gaps': '{n} {n:objectif en difficulté|objectifs en difficulté}',
  'l8.exams.students.noGaps': 'Aucune difficulté enregistrée aux examens',
  'l8.exams.students.concepts': 'Thèmes à renforcer',
  'l8.exams.students.aice': 'Plan AICE',
  'l8.exams.students.assign': 'Attribuer un renforcement',
};

const PT: TeacherL8Messages = {
  'l8.nav.exams': 'Exames',
  'l8.individual.title': 'Prática individual',
  'l8.individual.body': 'Atribui a este estudante uma prática sobre um dos seus próprios temas desta turma. Só este estudante a recebe.',
  'l8.individual.concept': 'Tema',
  'l8.individual.none': 'Este estudante ainda não tem temas desta turma no seu plano. Usa «Atribuir» mais acima para adicionar um.',
  'l8.individual.instructions': 'Indicações (opcional)',
  'l8.individual.submit': 'Atribuir prática',
  'l8.individual.done': 'Prática atribuída.',
  'l8.individual.error': 'Não foi possível atribuir a prática. Tenta de novo.',
  'l8.exams.title': 'Dificuldades em exames',
  'l8.exams.scope': 'Só vês os estudantes ativos desta turma. Os dados vêm da última tentativa classificada de cada estudante em cada exame; nunca se mostram respostas individuais.',
  'l8.exams.filter': 'Exame',
  'l8.exams.filter.all': 'Todos',
  'l8.exams.noLearners': 'Esta turma ainda não tem estudantes ativos.',
  'l8.exams.noLearners.body': 'Quando houver estudantes inscritos verás aqui os seus exames e dificuldades.',
  'l8.exams.noData': 'Ainda não há exames nem dificuldades para mostrar.',
  'l8.exams.noData.body': 'Nenhum estudante desta turma prepara um exame nem tem uma tentativa classificada com dificuldades.',
  'l8.exams.summary.learners': 'Estudantes ativos',
  'l8.exams.summary.preparing': 'Preparam um exame',
  'l8.exams.summary.withGaps': 'Com dificuldades em exames',
  'l8.exams.goals.title': 'Exames que a turma prepara',
  'l8.exams.goals.empty': 'Nenhum estudante desta turma escolheu um exame ainda.',
  'l8.exams.domains.title': 'Dificuldades por área',
  'l8.exams.objectives.title': 'Dificuldades por objetivo',
  'l8.exams.concepts.title': 'Dificuldades por tema',
  'l8.exams.gaps.empty': 'Não há dificuldades registadas nas tentativas classificadas.',
  'l8.exams.learnerCount': '{n} {n:estudante|estudantes}',
  'l8.exams.students.title': 'Por estudante',
  'l8.exams.students.goals': 'Prepara',
  'l8.exams.students.noGoals': 'Sem exame escolhido',
  'l8.exams.students.examDate': 'data {date}',
  'l8.exams.students.gaps': '{n} {n:objetivo com dificuldade|objetivos com dificuldade}',
  'l8.exams.students.noGaps': 'Sem dificuldades registadas em exames',
  'l8.exams.students.concepts': 'Temas a reforçar',
  'l8.exams.students.aice': 'Plano AICE',
  'l8.exams.students.assign': 'Atribuir reforço',
};

export const TEACHER_L8_MESSAGES: Record<Locale, TeacherL8Messages> = { es: ES, en: EN, de: DE, fr: FR, pt: PT };

export function getTeacherL8Messages(locale: string | null | undefined): TeacherL8Messages {
  return TEACHER_L8_MESSAGES[(locale as Locale) in TEACHER_L8_MESSAGES ? (locale as Locale) : 'es'];
}
