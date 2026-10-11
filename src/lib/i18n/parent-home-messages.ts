/**
 * L7 PA-3 / PA-4 / PA-5 -- copy for the Parent workspace: released exam
 * results, first-time onboarding, and paying for a linked child. A standalone
 * catalogue (read through getParentHomeMessages, not merged into messages.ts).
 * The compiler requires every key in every locale.
 */
import type { Locale } from './messages';

export type ParentHomeMessageKey =
  | 'ph.results.title' | 'ph.results.body' | 'ph.results.empty' | 'ph.results.score' | 'ph.results.scoreFinal' | 'ph.results.noScore'
  | 'ph.results.invalidated' | 'ph.results.invalidatedNote' | 'ph.results.objectives' | 'ph.results.completion' | 'ph.results.minutes'
  | 'ph.onboarding.title' | 'ph.onboarding.body' | 'ph.onboarding.step1.title' | 'ph.onboarding.step1.body'
  | 'ph.onboarding.step2.title' | 'ph.onboarding.step2.body' | 'ph.onboarding.step2.invited' | 'ph.onboarding.step2.requested'
  | 'ph.onboarding.step3.title' | 'ph.onboarding.step3.body' | 'ph.onboarding.done' | 'ph.onboarding.current' | 'ph.onboarding.next'
  | 'ph.pay.title' | 'ph.pay.body' | 'ph.pay.button' | 'ph.pay.unavailable';

export type ParentHomeMessages = Record<ParentHomeMessageKey, string>;

const ES: ParentHomeMessages = {
  'ph.results.title': 'Resultados de exámenes',
  'ph.results.body': 'Un resumen de los exámenes de práctica que {name} ha entregado y que también ve en su historial. No incluye las preguntas ni sus respuestas.',
  'ph.results.empty': 'Todavía no hay resultados para mostrar.',
  'ph.results.score': '{earned} de {max} puntos',
  'ph.results.scoreFinal': 'Puntaje: {score}',
  'ph.results.noScore': 'Sin puntaje calculado',
  'ph.results.invalidated': 'Anulado',
  'ph.results.invalidatedNote': 'Este resultado fue anulado y no cuenta para su preparación.',
  'ph.results.objectives': 'Objetivos: {strengths} dominados · {developing} en desarrollo · {gaps} por reforzar',
  'ph.results.completion': '{answered} de {total} preguntas respondidas',
  'ph.results.minutes': '{minutes} min',
  'ph.onboarding.title': 'Empieza a acompañar a tu hijo o hija',
  'ph.onboarding.body': 'Tres pasos. Solo verás su progreso cuando ambos estén de acuerdo.',
  'ph.onboarding.step1.title': 'Tu cuenta de familiar está lista',
  'ph.onboarding.step1.body': 'Desde aquí solo puedes ver; nunca respondes ni cambias nada por tu hijo o hija.',
  'ph.onboarding.step2.title': 'Conéctate con su cuenta',
  'ph.onboarding.step2.body': 'Acepta la invitación que te haya enviado, o envíale una solicitud con el correo de su cuenta (más abajo).',
  'ph.onboarding.step2.invited': 'Tienes una invitación esperando arriba.',
  'ph.onboarding.step2.requested': 'Solicitud enviada. Pídele que la acepte desde su perfil.',
  'ph.onboarding.step3.title': 'Sigue su progreso',
  'ph.onboarding.step3.body': 'En cuanto la conexión esté aceptada, esta página mostrará sus materias, su actividad y sus resultados.',
  'ph.onboarding.done': 'Hecho',
  'ph.onboarding.current': 'Ahora',
  'ph.onboarding.next': 'Después',
  'ph.pay.title': 'Suscripción de {name}',
  'ph.pay.body': 'Puedes pagar la suscripción de {name}. La licencia es suya; tú quedas como quien paga mientras sigan conectados.',
  'ph.pay.button': 'Pagar la suscripción de {name}',
  'ph.pay.unavailable': 'No se puede iniciar un pago ahora. Puede que {name} ya tenga acceso activo.',
};

const EN: ParentHomeMessages = {
  'ph.results.title': 'Exam results',
  'ph.results.body': 'A summary of the practice exams {name} has submitted and can also see in their own history. It does not include the questions or their answers.',
  'ph.results.empty': 'There are no results to show yet.',
  'ph.results.score': '{earned} of {max} marks',
  'ph.results.scoreFinal': 'Score: {score}',
  'ph.results.noScore': 'No score calculated',
  'ph.results.invalidated': 'Invalidated',
  'ph.results.invalidatedNote': 'This result was invalidated and does not count towards their preparation.',
  'ph.results.objectives': 'Objectives: {strengths} strong · {developing} developing · {gaps} to reinforce',
  'ph.results.completion': '{answered} of {total} questions answered',
  'ph.results.minutes': '{minutes} min',
  'ph.onboarding.title': 'Start following your child',
  'ph.onboarding.body': 'Three steps. You only see their progress once you both agree.',
  'ph.onboarding.step1.title': 'Your family account is ready',
  'ph.onboarding.step1.body': 'From here you can only view; you never answer or change anything for your child.',
  'ph.onboarding.step2.title': 'Connect to their account',
  'ph.onboarding.step2.body': 'Accept the invitation they sent you, or send them a request using their account email (below).',
  'ph.onboarding.step2.invited': 'You have an invitation waiting above.',
  'ph.onboarding.step2.requested': 'Request sent. Ask them to accept it from their profile.',
  'ph.onboarding.step3.title': 'Follow their progress',
  'ph.onboarding.step3.body': 'As soon as the connection is accepted, this page shows their subjects, activity and results.',
  'ph.onboarding.done': 'Done',
  'ph.onboarding.current': 'Now',
  'ph.onboarding.next': 'Next',
  'ph.pay.title': 'Subscription for {name}',
  'ph.pay.body': 'You can pay for {name}’s subscription. The licence is theirs; you stay as the payer while you remain connected.',
  'ph.pay.button': 'Pay for {name}’s subscription',
  'ph.pay.unavailable': 'A payment cannot be started right now. {name} may already have active access.',
};

const DE: ParentHomeMessages = {
  'ph.results.title': 'Prüfungsergebnisse',
  'ph.results.body': 'Eine Zusammenfassung der Übungsprüfungen, die {name} abgegeben hat und auch im eigenen Verlauf sieht. Fragen und Antworten sind nicht enthalten.',
  'ph.results.empty': 'Es gibt noch keine Ergebnisse.',
  'ph.results.score': '{earned} von {max} Punkten',
  'ph.results.scoreFinal': 'Ergebnis: {score}',
  'ph.results.noScore': 'Kein Ergebnis berechnet',
  'ph.results.invalidated': 'Ungültig',
  'ph.results.invalidatedNote': 'Dieses Ergebnis wurde für ungültig erklärt und zählt nicht für die Vorbereitung.',
  'ph.results.objectives': 'Lernziele: {strengths} sicher · {developing} in Entwicklung · {gaps} zu festigen',
  'ph.results.completion': '{answered} von {total} Fragen beantwortet',
  'ph.results.minutes': '{minutes} Min.',
  'ph.onboarding.title': 'Begleite dein Kind',
  'ph.onboarding.body': 'Drei Schritte. Du siehst den Fortschritt erst, wenn ihr beide zustimmt.',
  'ph.onboarding.step1.title': 'Dein Familienkonto ist bereit',
  'ph.onboarding.step1.body': 'Hier kannst du nur ansehen; du beantwortest oder änderst nie etwas für dein Kind.',
  'ph.onboarding.step2.title': 'Mit dem Konto deines Kindes verbinden',
  'ph.onboarding.step2.body': 'Nimm die Einladung deines Kindes an oder sende ihm eine Anfrage mit seiner Konto-E-Mail (unten).',
  'ph.onboarding.step2.invited': 'Oben wartet eine Einladung auf dich.',
  'ph.onboarding.step2.requested': 'Anfrage gesendet. Bitte dein Kind, sie im Profil anzunehmen.',
  'ph.onboarding.step3.title': 'Fortschritt verfolgen',
  'ph.onboarding.step3.body': 'Sobald die Verbindung angenommen ist, zeigt diese Seite Fächer, Aktivität und Ergebnisse.',
  'ph.onboarding.done': 'Erledigt',
  'ph.onboarding.current': 'Jetzt',
  'ph.onboarding.next': 'Danach',
  'ph.pay.title': 'Abonnement für {name}',
  'ph.pay.body': 'Du kannst das Abonnement für {name} bezahlen. Die Lizenz gehört deinem Kind; du bleibst Zahler, solange ihr verbunden seid.',
  'ph.pay.button': 'Abonnement für {name} bezahlen',
  'ph.pay.unavailable': 'Eine Zahlung kann gerade nicht gestartet werden. Vielleicht hat {name} bereits aktiven Zugang.',
};

const FR: ParentHomeMessages = {
  'ph.results.title': 'Résultats d’examens',
  'ph.results.body': 'Un résumé des examens d’entraînement que {name} a rendus et voit aussi dans son historique. Il ne contient ni les questions ni ses réponses.',
  'ph.results.empty': 'Aucun résultat à afficher pour le moment.',
  'ph.results.score': '{earned} sur {max} points',
  'ph.results.scoreFinal': 'Note : {score}',
  'ph.results.noScore': 'Aucune note calculée',
  'ph.results.invalidated': 'Invalidé',
  'ph.results.invalidatedNote': 'Ce résultat a été invalidé et ne compte pas pour sa préparation.',
  'ph.results.objectives': 'Objectifs : {strengths} acquis · {developing} en cours · {gaps} à renforcer',
  'ph.results.completion': '{answered} questions répondues sur {total}',
  'ph.results.minutes': '{minutes} min',
  'ph.onboarding.title': 'Commence à suivre ton enfant',
  'ph.onboarding.body': 'Trois étapes. Tu ne vois ses progrès que lorsque vous êtes tous les deux d’accord.',
  'ph.onboarding.step1.title': 'Ton compte famille est prêt',
  'ph.onboarding.step1.body': 'Ici tu peux seulement consulter ; tu ne réponds ni ne modifies jamais rien pour ton enfant.',
  'ph.onboarding.step2.title': 'Connecte-toi à son compte',
  'ph.onboarding.step2.body': 'Accepte l’invitation qu’il t’a envoyée, ou envoie-lui une demande avec l’e-mail de son compte (plus bas).',
  'ph.onboarding.step2.invited': 'Une invitation t’attend plus haut.',
  'ph.onboarding.step2.requested': 'Demande envoyée. Demande-lui de l’accepter depuis son profil.',
  'ph.onboarding.step3.title': 'Suis ses progrès',
  'ph.onboarding.step3.body': 'Dès que la connexion est acceptée, cette page affiche ses matières, son activité et ses résultats.',
  'ph.onboarding.done': 'Fait',
  'ph.onboarding.current': 'Maintenant',
  'ph.onboarding.next': 'Ensuite',
  'ph.pay.title': 'Abonnement de {name}',
  'ph.pay.body': 'Tu peux payer l’abonnement de {name}. La licence lui appartient ; tu restes le payeur tant que vous êtes connectés.',
  'ph.pay.button': 'Payer l’abonnement de {name}',
  'ph.pay.unavailable': 'Impossible de lancer un paiement pour le moment. {name} a peut-être déjà un accès actif.',
};

const PT: ParentHomeMessages = {
  'ph.results.title': 'Resultados de exames',
  'ph.results.body': 'Um resumo dos exames de prática que {name} entregou e que também vê no seu histórico. Não inclui as perguntas nem as respostas.',
  'ph.results.empty': 'Ainda não há resultados para mostrar.',
  'ph.results.score': '{earned} de {max} pontos',
  'ph.results.scoreFinal': 'Pontuação: {score}',
  'ph.results.noScore': 'Sem pontuação calculada',
  'ph.results.invalidated': 'Anulado',
  'ph.results.invalidatedNote': 'Este resultado foi anulado e não conta para a preparação.',
  'ph.results.objectives': 'Objetivos: {strengths} dominados · {developing} em desenvolvimento · {gaps} a reforçar',
  'ph.results.completion': '{answered} de {total} perguntas respondidas',
  'ph.results.minutes': '{minutes} min',
  'ph.onboarding.title': 'Começa a acompanhar o teu filho ou filha',
  'ph.onboarding.body': 'Três passos. Só vês o progresso quando ambos estiverem de acordo.',
  'ph.onboarding.step1.title': 'A tua conta de familiar está pronta',
  'ph.onboarding.step1.body': 'Aqui só podes ver; nunca respondes nem alteras nada pelo teu filho ou filha.',
  'ph.onboarding.step2.title': 'Liga-te à conta dele ou dela',
  'ph.onboarding.step2.body': 'Aceita o convite que te enviou, ou envia um pedido com o e-mail da conta (mais abaixo).',
  'ph.onboarding.step2.invited': 'Tens um convite à espera acima.',
  'ph.onboarding.step2.requested': 'Pedido enviado. Pede-lhe que o aceite no perfil.',
  'ph.onboarding.step3.title': 'Acompanha o progresso',
  'ph.onboarding.step3.body': 'Assim que a ligação for aceite, esta página mostra as disciplinas, a atividade e os resultados.',
  'ph.onboarding.done': 'Feito',
  'ph.onboarding.current': 'Agora',
  'ph.onboarding.next': 'Depois',
  'ph.pay.title': 'Subscrição de {name}',
  'ph.pay.body': 'Podes pagar a subscrição de {name}. A licença é dele ou dela; ficas como pagador enquanto estiverem ligados.',
  'ph.pay.button': 'Pagar a subscrição de {name}',
  'ph.pay.unavailable': 'Não é possível iniciar um pagamento agora. {name} talvez já tenha acesso ativo.',
};

export const PARENT_HOME_MESSAGES: Record<Locale, ParentHomeMessages> = { es: ES, en: EN, de: DE, fr: FR, pt: PT };

export function getParentHomeMessages(locale: string | null | undefined): ParentHomeMessages {
  return PARENT_HOME_MESSAGES[(locale as Locale) in PARENT_HOME_MESSAGES ? (locale as Locale) : 'es'];
}
