/**
 * Human Agency P0-4 -- FIXED, reviewed safety copy (never model-generated).
 * Student-facing response after a deterministic safety signal, plus the
 * minimal notification shown to the designated safety contact. No clinical
 * labels, no diagnosis, no blame. All 5 locales; merged into ROLES_MESSAGES.
 */

export type SafetyMessageKey =
  | 'safety.title.SAFETY_SIGNAL' | 'safety.body.SAFETY_SIGNAL'
  | 'safety.title.IMMEDIATE_DANGER_SIGNAL' | 'safety.body.IMMEDIATE_DANGER_SIGNAL'
  | 'safety.generic' | 'safety.resources.title' | 'safety.notified' | 'safety.continue'
  | 'notif.SAFETY_SIGNAL' | 'notif.SAFETY_IMMEDIATE_DANGER';

type Catalog = Record<SafetyMessageKey, string>;

const es: Catalog = {
  'safety.title.SAFETY_SIGNAL': 'Gracias por contármelo',
  'safety.body.SAFETY_SIGNAL': 'Lo que sientes importa y no tienes que pasar por esto sin ayuda. Habla hoy con un adulto de confianza: alguien de tu familia, un profesor o la persona de orientación de tu centro.',
  'safety.title.IMMEDIATE_DANGER_SIGNAL': 'Tu seguridad es lo primero',
  'safety.body.IMMEDIATE_DANGER_SIGNAL': 'Si estás en peligro ahora mismo, llama a los servicios de emergencia de tu país o pide ayuda a un adulto que esté cerca de ti. No te quedes sin compañía.',
  'safety.generic': 'Si estás en peligro, llama ahora a los servicios de emergencia locales y cuéntaselo a un adulto de confianza.',
  'safety.resources.title': 'También puedes contactar con:',
  'safety.notified': 'Hemos avisado a la persona responsable de seguridad para que pueda ayudarte.',
  'safety.continue': 'Puedes volver a estudiar cuando quieras.',
  'notif.SAFETY_SIGNAL': 'Aviso de seguridad sobre {learnerName}. Contacta con el estudiante según tu protocolo.',
  'notif.SAFETY_IMMEDIATE_DANGER': 'Aviso de seguridad URGENTE sobre {learnerName}. Actúa ahora según tu protocolo.',
};

const en: Catalog = {
  'safety.title.SAFETY_SIGNAL': 'Thank you for telling me',
  'safety.body.SAFETY_SIGNAL': 'What you feel matters and you don’t have to go through this without help. Talk today with an adult you trust: someone in your family, a teacher or your school counsellor.',
  'safety.title.IMMEDIATE_DANGER_SIGNAL': 'Your safety comes first',
  'safety.body.IMMEDIATE_DANGER_SIGNAL': 'If you are in danger right now, call your country’s emergency services or ask an adult near you for help. Don’t stay on your own.',
  'safety.generic': 'If you are in danger, call your local emergency services now and tell an adult you trust.',
  'safety.resources.title': 'You can also contact:',
  'safety.notified': 'We have let the person responsible for safety know, so they can help you.',
  'safety.continue': 'You can come back to studying whenever you want.',
  'notif.SAFETY_SIGNAL': 'Safety alert about {learnerName}. Contact the student following your protocol.',
  'notif.SAFETY_IMMEDIATE_DANGER': 'URGENT safety alert about {learnerName}. Act now following your protocol.',
};

const de: Catalog = {
  'safety.title.SAFETY_SIGNAL': 'Danke, dass du es mir erzählst',
  'safety.body.SAFETY_SIGNAL': 'Was du fühlst, ist wichtig, und du musst da nicht ohne Hilfe durch. Sprich heute mit einem Erwachsenen, dem du vertraust: jemand aus deiner Familie, eine Lehrkraft oder die Beratung an deiner Schule.',
  'safety.title.IMMEDIATE_DANGER_SIGNAL': 'Deine Sicherheit geht vor',
  'safety.body.IMMEDIATE_DANGER_SIGNAL': 'Wenn du gerade in Gefahr bist, ruf den Notruf deines Landes an oder bitte einen Erwachsenen in deiner Nähe um Hilfe. Bleib nicht allein.',
  'safety.generic': 'Wenn du in Gefahr bist, ruf jetzt den örtlichen Notruf an und sag es einem Erwachsenen, dem du vertraust.',
  'safety.resources.title': 'Du kannst dich auch hierhin wenden:',
  'safety.notified': 'Wir haben die für Sicherheit zuständige Person informiert, damit sie dir helfen kann.',
  'safety.continue': 'Du kannst jederzeit weiterlernen.',
  'notif.SAFETY_SIGNAL': 'Sicherheitshinweis zu {learnerName}. Nimm gemäß deinem Protokoll Kontakt auf.',
  'notif.SAFETY_IMMEDIATE_DANGER': 'DRINGENDER Sicherheitshinweis zu {learnerName}. Handle jetzt gemäß deinem Protokoll.',
};

const fr: Catalog = {
  'safety.title.SAFETY_SIGNAL': 'Merci de me l’avoir dit',
  'safety.body.SAFETY_SIGNAL': 'Ce que tu ressens compte et tu n’as pas à traverser ça sans aide. Parles-en aujourd’hui à un adulte de confiance : quelqu’un de ta famille, un professeur ou le conseiller de ton établissement.',
  'safety.title.IMMEDIATE_DANGER_SIGNAL': 'Ta sécurité passe avant tout',
  'safety.body.IMMEDIATE_DANGER_SIGNAL': 'Si tu es en danger maintenant, appelle les services d’urgence de ton pays ou demande de l’aide à un adulte près de toi. Ne reste pas seul.',
  'safety.generic': 'Si tu es en danger, appelle maintenant les services d’urgence locaux et parles-en à un adulte de confiance.',
  'safety.resources.title': 'Tu peux aussi contacter :',
  'safety.notified': 'Nous avons prévenu la personne responsable de la sécurité pour qu’elle puisse t’aider.',
  'safety.continue': 'Tu peux reprendre tes études quand tu veux.',
  'notif.SAFETY_SIGNAL': 'Alerte de sécurité concernant {learnerName}. Contacte l’élève selon ton protocole.',
  'notif.SAFETY_IMMEDIATE_DANGER': 'Alerte de sécurité URGENTE concernant {learnerName}. Agis maintenant selon ton protocole.',
};

const pt: Catalog = {
  'safety.title.SAFETY_SIGNAL': 'Obrigado por me contares',
  'safety.body.SAFETY_SIGNAL': 'O que sentes importa e não tens de passar por isto sem ajuda. Fala hoje com um adulto de confiança: alguém da tua família, um professor ou a pessoa de orientação da tua escola.',
  'safety.title.IMMEDIATE_DANGER_SIGNAL': 'A tua segurança vem primeiro',
  'safety.body.IMMEDIATE_DANGER_SIGNAL': 'Se estás em perigo agora, liga para os serviços de emergência do teu país ou pede ajuda a um adulto perto de ti. Não fiques sem companhia.',
  'safety.generic': 'Se estás em perigo, liga agora para os serviços de emergência locais e conta a um adulto de confiança.',
  'safety.resources.title': 'Também podes contactar:',
  'safety.notified': 'Avisámos a pessoa responsável pela segurança para que te possa ajudar.',
  'safety.continue': 'Podes voltar a estudar quando quiseres.',
  'notif.SAFETY_SIGNAL': 'Alerta de segurança sobre {learnerName}. Contacta o estudante segundo o teu protocolo.',
  'notif.SAFETY_IMMEDIATE_DANGER': 'Alerta de segurança URGENTE sobre {learnerName}. Age agora segundo o teu protocolo.',
};

export const SAFETY_MESSAGES = { es, en, de, fr, pt } as const;
