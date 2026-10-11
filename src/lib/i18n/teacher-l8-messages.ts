/**
 * L8 (TE-1, TE-2, L8-R1) -- copy for the Teacher's individual practice and
 * exam-practice forms on the learner page and for the class exam-insights view. A standalone catalogue:
 * read through getTeacherL8Messages, not merged into messages.ts. The
 * compiler requires every key in every locale.
 */
import type { Locale } from './messages';

export type TeacherL8MessageKey =
  | 'l8.nav.exams'
  | 'l8.individual.title' | 'l8.individual.body' | 'l8.individual.concept' | 'l8.individual.none'
  | 'l8.individual.instructions' | 'l8.individual.submit' | 'l8.individual.done' | 'l8.individual.error'
  | 'l8.exam.title' | 'l8.exam.body' | 'l8.exam.option' | 'l8.exam.none' | 'l8.exam.submit' | 'l8.exam.done' | 'l8.exam.error' | 'l8.exam.outOfScope'
  | 'l8.exam.kind.TOPIC_EXAM' | 'l8.exam.kind.DOMAIN_EXAM' | 'l8.exam.kind.MINI_MOCK'
  | 'l8.exams.withheld'
  | 'l8.exams.title' | 'l8.exams.scope'
  | 'l8.exams.noLearners' | 'l8.exams.noLearners.body' | 'l8.exams.noData' | 'l8.exams.noData.body'
  | 'l8.exams.summary.learners' | 'l8.exams.summary.withGaps'
 
  | 'l8.exams.concepts.title'
  | 'l8.exams.learnerCount'
  | 'l8.exams.students.title'
  | 'l8.exams.students.gaps' | 'l8.exams.students.noGaps' | 'l8.exams.students.concepts'
  | 'l8.exams.students.assign';

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
  'l8.exam.title': 'Práctica de examen',
  'l8.exam.body': 'Asigna a este estudiante una práctica de uno de los exámenes que prepara, dentro de la materia de esta clase. Solo la recibe este estudiante.',
  'l8.exam.option': 'Práctica',
  'l8.exam.none': 'Este estudiante no prepara ningún examen con práctica disponible para la materia de esta clase.',
  'l8.exam.submit': 'Asignar práctica de examen',
  'l8.exam.done': 'Práctica de examen asignada.',
  'l8.exam.error': 'No pudimos asignar la práctica de examen. Inténtalo de nuevo.',
  'l8.exam.outOfScope': 'Esa práctica ya no está disponible para este estudiante en esta clase. Actualiza la página.',
  'l8.exam.kind.TOPIC_EXAM': 'Tema: {target}',
  'l8.exam.kind.DOMAIN_EXAM': 'Área: {target}',
  'l8.exam.kind.MINI_MOCK': 'Mini simulacro',
  'l8.exams.withheld': 'Por ahora solo se muestran dificultades por tema. Los totales por área y por objetivo, los exámenes que prepara cada estudiante y los planes AICE no se muestran hasta que puedan limitarse a la materia de esta clase.',
  'l8.exams.title': 'Dificultades en exámenes',
  'l8.exams.scope': 'Solo ves a los estudiantes activos de esta clase y solo las dificultades de la materia de esta clase. Los datos salen del último intento calificado de cada estudiante en cada examen; nunca se muestran respuestas individuales.',
  'l8.exams.noLearners': 'Esta clase todavía no tiene estudiantes activos.',
  'l8.exams.noLearners.body': 'Cuando haya estudiantes inscritos verás aquí sus exámenes y dificultades.',
  'l8.exams.noData': 'Aún no hay dificultades que mostrar.',
  'l8.exams.noData.body': 'Ningún estudiante de esta clase tiene un intento calificado con dificultades en la materia de esta clase.',
  'l8.exams.summary.learners': 'Estudiantes activos',
  'l8.exams.summary.withGaps': 'Con dificultades en exámenes',
  'l8.exams.concepts.title': 'Dificultades por tema',
  'l8.exams.learnerCount': '{n} {n:estudiante|estudiantes}',
  'l8.exams.students.title': 'Por estudiante',
  'l8.exams.students.gaps': '{n} {n:tema con dificultad|temas con dificultad}',
  'l8.exams.students.noGaps': 'Sin dificultades registradas en exámenes',
  'l8.exams.students.concepts': 'Temas a reforzar',
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
  'l8.exam.title': 'Exam practice',
  'l8.exam.body': 'Assign this student practice from one of the exams they are preparing, within this class’s subject. Only this student receives it.',
  'l8.exam.option': 'Practice',
  'l8.exam.none': 'This student is not preparing any exam with practice available for this class’s subject.',
  'l8.exam.submit': 'Assign exam practice',
  'l8.exam.done': 'Exam practice assigned.',
  'l8.exam.error': 'We could not assign the exam practice. Try again.',
  'l8.exam.outOfScope': 'That practice is no longer available for this student in this class. Refresh the page.',
  'l8.exam.kind.TOPIC_EXAM': 'Topic: {target}',
  'l8.exam.kind.DOMAIN_EXAM': 'Area: {target}',
  'l8.exam.kind.MINI_MOCK': 'Mini mock',
  'l8.exams.withheld': 'For now only gaps by topic are shown. Totals by area and by objective, the exams each student is preparing and AICE plans are not shown until they can be limited to this class’s subject.',
  'l8.exams.title': 'Exam gaps',
  'l8.exams.scope': 'You only see the active students of this class, and only gaps in this class’s subject. The data comes from each student’s latest scored attempt in each exam; individual answers are never shown.',
  'l8.exams.noLearners': 'This class has no active students yet.',
  'l8.exams.noLearners.body': 'Once students are enrolled you will see their exams and gaps here.',
  'l8.exams.noData': 'There are no gaps to show yet.',
  'l8.exams.noData.body': 'No student in this class has a scored attempt with gaps in this class’s subject.',
  'l8.exams.summary.learners': 'Active students',
  'l8.exams.summary.withGaps': 'With exam gaps',
  'l8.exams.concepts.title': 'Gaps by topic',
  'l8.exams.learnerCount': '{n} {n:student|students}',
  'l8.exams.students.title': 'By student',
  'l8.exams.students.gaps': '{n} {n:topic with a gap|topics with gaps}',
  'l8.exams.students.noGaps': 'No exam gaps recorded',
  'l8.exams.students.concepts': 'Topics to reinforce',
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
  'l8.exam.title': 'Prüfungsübung',
  'l8.exam.body': 'Weise dieser Person eine Übung aus einer Prüfung zu, die sie vorbereitet, innerhalb des Fachs dieser Klasse. Nur diese Person erhält sie.',
  'l8.exam.option': 'Übung',
  'l8.exam.none': 'Diese Person bereitet keine Prüfung vor, für die es im Fach dieser Klasse eine Übung gibt.',
  'l8.exam.submit': 'Prüfungsübung zuweisen',
  'l8.exam.done': 'Prüfungsübung zugewiesen.',
  'l8.exam.error': 'Die Prüfungsübung konnte nicht zugewiesen werden. Versuche es erneut.',
  'l8.exam.outOfScope': 'Diese Übung ist für diese Person in dieser Klasse nicht mehr verfügbar. Lade die Seite neu.',
  'l8.exam.kind.TOPIC_EXAM': 'Thema: {target}',
  'l8.exam.kind.DOMAIN_EXAM': 'Bereich: {target}',
  'l8.exam.kind.MINI_MOCK': 'Mini-Probeprüfung',
  'l8.exams.withheld': 'Derzeit werden nur Lücken nach Thema angezeigt. Summen nach Bereich und Lernziel, die Prüfungen der einzelnen Lernenden und AICE-Pläne werden erst angezeigt, wenn sie auf das Fach dieser Klasse begrenzt werden können.',
  'l8.exams.title': 'Lücken in Prüfungen',
  'l8.exams.scope': 'Du siehst nur die aktiven Lernenden dieser Klasse und nur Lücken im Fach dieser Klasse. Die Daten stammen aus dem letzten bewerteten Versuch jeder Person pro Prüfung; einzelne Antworten werden nie angezeigt.',
  'l8.exams.noLearners': 'Diese Klasse hat noch keine aktiven Lernenden.',
  'l8.exams.noLearners.body': 'Sobald Lernende eingeschrieben sind, siehst du hier ihre Prüfungen und Lücken.',
  'l8.exams.noData': 'Es gibt noch keine Lücken anzuzeigen.',
  'l8.exams.noData.body': 'Niemand in dieser Klasse hat einen bewerteten Versuch mit Lücken im Fach dieser Klasse.',
  'l8.exams.summary.learners': 'Aktive Lernende',
  'l8.exams.summary.withGaps': 'Mit Lücken in Prüfungen',
  'l8.exams.concepts.title': 'Lücken nach Thema',
  'l8.exams.learnerCount': '{n} {n:Lernende:r|Lernende}',
  'l8.exams.students.title': 'Nach Lernenden',
  'l8.exams.students.gaps': '{n} {n:Thema mit Lücke|Themen mit Lücken}',
  'l8.exams.students.noGaps': 'Keine Lücken in Prüfungen erfasst',
  'l8.exams.students.concepts': 'Themen zum Festigen',
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
  'l8.exam.title': 'Pratique d’examen',
  'l8.exam.body': 'Attribuez à cet élève une pratique tirée d’un des examens qu’il prépare, dans la matière de cette classe. Seul cet élève la reçoit.',
  'l8.exam.option': 'Pratique',
  'l8.exam.none': 'Cet élève ne prépare aucun examen proposant une pratique pour la matière de cette classe.',
  'l8.exam.submit': 'Attribuer la pratique d’examen',
  'l8.exam.done': 'Pratique d’examen attribuée.',
  'l8.exam.error': 'Impossible d’attribuer la pratique d’examen. Réessayez.',
  'l8.exam.outOfScope': 'Cette pratique n’est plus disponible pour cet élève dans cette classe. Actualisez la page.',
  'l8.exam.kind.TOPIC_EXAM': 'Thème : {target}',
  'l8.exam.kind.DOMAIN_EXAM': 'Domaine : {target}',
  'l8.exam.kind.MINI_MOCK': 'Mini examen blanc',
  'l8.exams.withheld': 'Pour l’instant, seules les difficultés par thème sont affichées. Les totaux par domaine et par objectif, les examens préparés par chaque élève et les plans AICE ne sont pas affichés tant qu’ils ne peuvent pas être limités à la matière de cette classe.',
  'l8.exams.title': 'Difficultés aux examens',
  'l8.exams.scope': 'Vous ne voyez que les élèves actifs de cette classe, et seulement les difficultés dans la matière de cette classe. Les données proviennent de la dernière tentative notée de chaque élève à chaque examen ; les réponses individuelles ne sont jamais affichées.',
  'l8.exams.noLearners': 'Cette classe n’a pas encore d’élèves actifs.',
  'l8.exams.noLearners.body': 'Dès que des élèves seront inscrits, vous verrez ici leurs examens et leurs difficultés.',
  'l8.exams.noData': 'Aucune difficulté à afficher pour l’instant.',
  'l8.exams.noData.body': 'Aucun élève de cette classe n’a de tentative notée avec des difficultés dans la matière de cette classe.',
  'l8.exams.summary.learners': 'Élèves actifs',
  'l8.exams.summary.withGaps': 'Avec des difficultés aux examens',
  'l8.exams.concepts.title': 'Difficultés par thème',
  'l8.exams.learnerCount': '{n} {n:élève|élèves}',
  'l8.exams.students.title': 'Par élève',
  'l8.exams.students.gaps': '{n} {n:thème en difficulté|thèmes en difficulté}',
  'l8.exams.students.noGaps': 'Aucune difficulté enregistrée aux examens',
  'l8.exams.students.concepts': 'Thèmes à renforcer',
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
  'l8.exam.title': 'Prática de exame',
  'l8.exam.body': 'Atribui a este estudante uma prática de um dos exames que prepara, dentro da disciplina desta turma. Só este estudante a recebe.',
  'l8.exam.option': 'Prática',
  'l8.exam.none': 'Este estudante não prepara nenhum exame com prática disponível para a disciplina desta turma.',
  'l8.exam.submit': 'Atribuir prática de exame',
  'l8.exam.done': 'Prática de exame atribuída.',
  'l8.exam.error': 'Não foi possível atribuir a prática de exame. Tenta de novo.',
  'l8.exam.outOfScope': 'Essa prática já não está disponível para este estudante nesta turma. Atualiza a página.',
  'l8.exam.kind.TOPIC_EXAM': 'Tema: {target}',
  'l8.exam.kind.DOMAIN_EXAM': 'Área: {target}',
  'l8.exam.kind.MINI_MOCK': 'Mini simulado',
  'l8.exams.withheld': 'Por agora só se mostram dificuldades por tema. Os totais por área e por objetivo, os exames que cada estudante prepara e os planos AICE não são mostrados até poderem ser limitados à disciplina desta turma.',
  'l8.exams.title': 'Dificuldades em exames',
  'l8.exams.scope': 'Só vês os estudantes ativos desta turma e só as dificuldades da disciplina desta turma. Os dados vêm da última tentativa classificada de cada estudante em cada exame; nunca se mostram respostas individuais.',
  'l8.exams.noLearners': 'Esta turma ainda não tem estudantes ativos.',
  'l8.exams.noLearners.body': 'Quando houver estudantes inscritos verás aqui os seus exames e dificuldades.',
  'l8.exams.noData': 'Ainda não há dificuldades para mostrar.',
  'l8.exams.noData.body': 'Nenhum estudante desta turma tem uma tentativa classificada com dificuldades na disciplina desta turma.',
  'l8.exams.summary.learners': 'Estudantes ativos',
  'l8.exams.summary.withGaps': 'Com dificuldades em exames',
  'l8.exams.concepts.title': 'Dificuldades por tema',
  'l8.exams.learnerCount': '{n} {n:estudante|estudantes}',
  'l8.exams.students.title': 'Por estudante',
  'l8.exams.students.gaps': '{n} {n:tema com dificuldade|temas com dificuldade}',
  'l8.exams.students.noGaps': 'Sem dificuldades registadas em exames',
  'l8.exams.students.concepts': 'Temas a reforçar',
  'l8.exams.students.assign': 'Atribuir reforço',
};

export const TEACHER_L8_MESSAGES: Record<Locale, TeacherL8Messages> = { es: ES, en: EN, de: DE, fr: FR, pt: PT };

export function getTeacherL8Messages(locale: string | null | undefined): TeacherL8Messages {
  return TEACHER_L8_MESSAGES[(locale as Locale) in TEACHER_L8_MESSAGES ? (locale as Locale) : 'es'];
}
