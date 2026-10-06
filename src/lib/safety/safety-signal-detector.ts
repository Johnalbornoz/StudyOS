/**
 * Human Agency P0-4 (Layer B) -- deterministic safety signal detector.
 *
 * Runs on Student-typed text BEFORE any generative model is invoked. Pure:
 * no I/O, no AI, no network -- the same input always gives the same status.
 *
 * Statuses:
 *   NO_SIGNAL                -- nothing in scope; the request continues.
 *   SAFETY_SIGNAL            -- a first-person disclosure that the Student may
 *                               be at risk (wanting to die, hurting oneself,
 *                               being abused or hurt by someone).
 *   IMMEDIATE_DANGER_SIGNAL  -- an explicit present/imminent intent, plan or
 *                               danger (to self or to others).
 *
 * Deliberately NARROW and FIRST-PERSON: it never labels, scores or
 * diagnoses the Student, and academic text about a topic ("el suicidio de
 * Séneca", "self-harm statistics", "Romeo kills himself") is out of scope.
 * It accepts over-detection inside its scope (a false positive costs a fixed
 * caring message; a miss costs much more). The model-side policy (Layer A,
 * student-facing-policy.ts) is the second, independent layer.
 *
 * Never returns which phrase matched to callers that persist data: the
 * event records only the status (minimal safety event data).
 */

export const SAFETY_DETECTOR_VERSION = 'safety-signal-detector-v1';

export type SafetySignalStatus = 'NO_SIGNAL' | 'SAFETY_SIGNAL' | 'IMMEDIATE_DANGER_SIGNAL';

/** Lowercase, strip diacritics, keep letters/digits/apostrophes, collapse whitespace. */
export function normalizeForSafety(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9'ñß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

// Patterns run on normalized text (accent-free, lowercase, single spaces,
// padded with one leading/trailing space so `\b`-like boundaries are spaces).
const IMMEDIATE: RegExp[] = [
  // es
  / (me voy a|voy a|ya voy a|hoy voy a|esta noche voy a) (matarme|suicidarme|quitarme la vida|morir) /,
  / me voy a (matar|suicidar) /,
  / (hoy|esta noche|ahora|ahora mismo|manana) me (mato|suicido|quito la vida) /,
  / (quiero|voy a) (matarme|suicidarme) (hoy|ahora|esta noche|ya) /,
  / (tengo|ya tengo) (las pastillas|pastillas|una pistola|un arma|una cuerda|un cuchillo) para (matarme|suicidarme|morir) /,
  / me (tome|trague) (todas )?(las )?(pastillas|pildoras) /,
  / me estoy (cortando|desangrando|muriendo) /,
  / voy a (saltar|tirarme) (del|de un|de la|por la) /,
  / voy a matar a /,
  / (estoy|me siento) en peligro (ahora|ahora mismo|ya)? /,
  / me (van|quieren) a matar /,
  / me (esta|estan) (pegando|golpeando|haciendo dano) (ahora|ahora mismo) /,
  // en
  / i('m| am)? ?(going to|gonna|about to|will) (kill myself|end my life|end it all|take my (own )?life) /,
  / (kill|killing) myself (tonight|today|now|right now) /,
  / i (have|got) (the )?(pills|a gun|a knife|a rope) (to|so i can) (kill myself|end it|die) /,
  / i (took|swallowed) (all )?(the |my )?(pills|tablets) /,
  / i('m| am) (cutting|bleeding) (myself )?(right )?now /,
  / i('m| am)? ?(going to|gonna) jump (off|from) /,
  / i('m| am)? ?(going to|gonna) (kill|shoot|stab|hurt) (him|her|them|someone|somebody|my|people|everyone) /,
  / i('m| am) in danger (right now|now)? /,
  / (someone|somebody|he|she|they) (is|are) (going to kill|hurting|hitting|attacking) me (right )?now /,
  // pt
  / (vou|eu vou) (me matar|me suicidar|acabar com a minha vida|tirar a minha vida) /,
  / (tomei|engoli) (todos )?(os )?(comprimidos|remedios) /,
  / estou em perigo /,
  // fr / de (minimal)
  / je vais (me tuer|me suicider|mettre fin a mes jours) /,
  / ich (werde|will) mich (heute|jetzt)? ?(umbringen|toten) /,
  / ich bringe mich (heute|jetzt)? ?um /,
];

const SIGNAL: RegExp[] = [
  // es -- ideation / self-harm
  / (quiero|quisiera|ganas de|deseo) (morir|morirme|matarme|suicidarme|desaparecer para siempre|dejar de vivir) /,
  / me quiero (morir|matar|suicidar) /,
  / (pienso|pensando|he pensado|estoy pensando|pienso mucho) en (suicidarme|matarme|quitarme la vida|el suicidio|morirme) /,
  / no quiero (vivir|seguir viviendo|estar vivo|estar viva|seguir aqui) /,
  / (mejor|estaria mejor|estarian mejor) (muerto|muerta|sin mi) /,
  / no vale la pena (vivir|seguir) /,
  / me autolesiono /,
  / me (corto|lastimo|hago dano|hago cortes) (los brazos|las piernas|las munecas|a proposito|para no sentir|para sentir) /,
  / me (hago|estoy haciendo) dano a (mi mismo|mi misma|proposito) /,
  / (me he|he estado) (autolesionado|autolesionando) /,
  / (me he cortado|me he estado cortando|he estado cortandome) (los brazos|las piernas|las munecas|a proposito|otra vez) /,
  // es -- abuse / harm by others
  / (abusan|abusa|abuso|abusaron|abuso) de mi /,
  / me (pegan|golpean|maltratan|lastiman) (en (mi )?casa|mis padres|mi padre|mi madre|mi padrastro|mi madrastra) /,
  / (mi padre|mi madre|mi padrastro|mi madrastra|mi tio|mi novio|mi novia) me (pega|golpea|maltrata|toca|obliga) /,
  / me (toca|tocan|toco|tocaron) sin (mi )?permiso /,
  // en -- ideation / self-harm
  / i (want|wanna|wish i could) (to )?(die|kill myself|end my life|not be alive|disappear forever) /,
  / i('m| am| feel) suicidal /,
  / (thinking|thought|think) (about|of) (suicide|killing myself|ending my life|ending it all) /,
  / i (don'?t|do not) want to (live|be alive|exist) (anymore)? ?/,
  / (everyone|they|my family) (would be|is) better off without me /,
  / i('d| would) be better off dead /,
  / i (cut|harm|burn) myself (on purpose|again|to feel|every|when) /,
  / i (hurt|harm) myself on purpose /,
  / i('ve| have) been (cutting|hurting|harming) myself /,
  / i self ?harm /,
  // en -- abuse / harm by others
  / (he|she|they|my (dad|mom|mum|father|mother|stepdad|stepmom|uncle|boyfriend|girlfriend)) (abuses|abused|hits|beats|touches|touched|hurts) me /,
  / i('m| am) being (abused|hurt|beaten|touched) /,
  / (someone|somebody) (touches|touched|abuses|abused) me /,
  // pt
  / (quero|vontade de) (morrer|me matar|sumir para sempre) /,
  / nao quero (viver|mais viver|estar vivo|estar viva) /,
  / me automutilo /,
  / (me corto|me machuco|me cortei) (de proposito|os bracos|as pernas|os pulsos) /,
  / (abusam|abusa|abusou) de mim /,
  / me batem em casa /,
  // fr / de (minimal)
  / je veux (mourir|me tuer|disparaitre) /,
  / je me scarifie /,
  / je me (fais du mal|coupe) (expres|volontairement) /,
  / ich will (sterben|nicht mehr leben|mich umbringen) /,
  / ich (ritze|verletze) mich /,
];

export function detectSafetySignal(texts: string | ReadonlyArray<string | null | undefined>): SafetySignalStatus {
  const list = typeof texts === 'string' ? [texts] : texts;
  let status: SafetySignalStatus = 'NO_SIGNAL';
  for (const t of list) {
    if (typeof t !== 'string' || t.trim().length === 0) continue;
    const n = normalizeForSafety(t);
    if (IMMEDIATE.some((re) => re.test(n))) return 'IMMEDIATE_DANGER_SIGNAL';
    if (SIGNAL.some((re) => re.test(n))) status = 'SAFETY_SIGNAL';
  }
  return status;
}
