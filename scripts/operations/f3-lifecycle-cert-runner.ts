/**
 * F3 -- invoked by f3-entitlement-migration-cert.sh against a real,
 * ephemeral, local-only Postgres instance. Exercises the full
 * subscription/entitlement lifecycle end to end using the real
 * service functions (never mocked), then proves suspension and
 * reactivation preserve every row of learning history exactly.
 */
import { ensureSubscription, transitionSubscriptionStatus, canUseCapability, getSubscription } from '@/lib/entitlements';
import { recordPayment, getPaymentsForSubscription } from '@/lib/entitlements/payment.service';
import { resolvePrice } from '@/lib/entitlements/price-book.service';
import { db } from '@/lib/db';

const LEARNER_ID = '99999999-9999-4999-8999-999999999999';
const LEARNER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function learningHistoryCounts() {
  const [evidence, mastery] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence WHERE student_id = $1`, [LEARNER_ID]),
    db.query(`SELECT COUNT(*)::int AS c FROM mastery_records WHERE student_id = $1`, [LEARNER_ID]),
  ]);
  return { evidence: evidence.rows[0].c, mastery: mastery.rows[0].c };
}

async function main() {
  // --- Price Book resolution: real data, no FX conversion, no fabricated fallback ---
  const price = await resolvePrice('CO', 'COP', 'MONTHLY');
  assert(price !== null && price.amountCents === 3900000, 'Price Book resolves CO/COP/MONTHLY from real fixture data');
  const unsupported = await resolvePrice('ZZ', 'ZZZ', 'MONTHLY');
  assert(unsupported === null, 'an unsupported market resolves to null, never a fabricated fallback price');

  // --- Subscription creation: payer explicitly separate from learner (INV-F3-03) ---
  const sub = await ensureSubscription(LEARNER_ID, 'MONTHLY', PAYER_USER_ID);
  assert(sub.status === 'unpaid', 'a new subscription starts unpaid');
  assert(sub.payerUserId === PAYER_USER_ID, 'the payer is explicitly a DIFFERENT identity than the learner');

  const beforeAnyPayment = await learningHistoryCounts();
  assert(beforeAnyPayment.evidence === 1 && beforeAnyPayment.mastery === 1, 'baseline: 1 evidence row + 1 mastery row exist before any commercial activity');

  // --- Entitlement before payment: DENY paid access, ALLOW history ---
  assert(!(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS')), 'unpaid: LEARNING_FULL_ACCESS DENY');
  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_HISTORY_VIEW'), 'unpaid: LEARNING_HISTORY_VIEW still ALLOW (owner)');
  assert(!(await canUseCapability(PAYER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS')), 'the payer themself STILL cannot execute learning -- paying grants no academic access (AC-F3-06)');
  assert(await canUseCapability(PAYER_USER_ID, LEARNER_ID, 'BILLING_MANAGE'), 'the payer CAN manage billing');

  // --- Activation + payment recording (idempotent) ---
  await transitionSubscriptionStatus(LEARNER_ID, 'active');
  const payment1 = await recordPayment({
    subscriptionId: sub.id,
    payerUserId: PAYER_USER_ID,
    amountCents: 3900000,
    currency: 'COP',
    provider: 'mercadopago',
    providerReference: 'mp-evt-001',
    status: 'SUCCEEDED',
  });
  assert(payment1.inserted === true, 'first delivery of a payment event inserts a row');
  const paymentDuplicate = await recordPayment({
    subscriptionId: sub.id,
    payerUserId: PAYER_USER_ID,
    amountCents: 3900000,
    currency: 'COP',
    provider: 'mercadopago',
    providerReference: 'mp-evt-001', // SAME reference -- simulates Mercado Pago's aggressive retry
    status: 'SUCCEEDED',
  });
  assert(paymentDuplicate.inserted === false, 'a duplicate delivery of the SAME event id inserts nothing');
  const payments = await getPaymentsForSubscription(sub.id);
  assert(payments.length === 1, 'exactly one payment row exists after 2 deliveries of the same event');

  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS'), 'active: LEARNING_FULL_ACCESS ALLOW');

  // --- past_due -> suspended, with a rejected invalid jump along the way ---
  await transitionSubscriptionStatus(LEARNER_ID, 'past_due');
  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS'), 'past_due: LEARNING_FULL_ACCESS still ALLOW (grace period)');

  let invalidJumpRejected = false;
  try {
    await transitionSubscriptionStatus(LEARNER_ID, 'expired'); // NOT an allowed transition from past_due
  } catch {
    invalidJumpRejected = true;
  }
  assert(invalidJumpRejected, 'an invalid transition (past_due -> expired) is rejected, never silently applied');
  const statusAfterRejectedJump = await getSubscription(LEARNER_ID);
  assert(statusAfterRejectedJump.status === 'past_due', 'status is UNCHANGED after the rejected transition attempt');

  const beforeSuspension = await learningHistoryCounts();

  await transitionSubscriptionStatus(LEARNER_ID, 'suspended');
  assert(!(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS')), 'suspended: LEARNING_FULL_ACCESS DENY');
  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_HISTORY_VIEW'), 'suspended: LEARNING_HISTORY_VIEW still ALLOW (INV-F3-06)');
  assert(await canUseCapability(PAYER_USER_ID, LEARNER_ID, 'SUBSCRIPTION_REACTIVATE'), 'suspended: the payer CAN request reactivation');

  const duringSuspension = await learningHistoryCounts();
  assert(duringSuspension.evidence === beforeSuspension.evidence, 'ZERO learning_evidence rows lost during suspension');
  assert(duringSuspension.mastery === beforeSuspension.mastery, 'ZERO mastery_records rows lost during suspension');

  // Verify the learner/students/user_roles rows themselves are untouched too.
  const studentStillExists = await db.query(`SELECT 1 FROM students WHERE id = $1`, [LEARNER_ID]);
  assert(studentStillExists.rows.length === 1, 'the student row itself was not deleted by suspension');
  const rolesStillExist = await db.query(`SELECT COUNT(*)::int AS c FROM user_roles WHERE user_id = $1 AND status = 'ACTIVE'`, [LEARNER_USER_ID]);
  assert(rolesStillExist.rows[0].c === 1, 'the STUDENT role grant was not touched by suspension');

  // --- Reactivation: restores capability from PRESERVED state, never rebuilds anything ---
  await transitionSubscriptionStatus(LEARNER_ID, 'reactivated');
  await transitionSubscriptionStatus(LEARNER_ID, 'active');
  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS'), 'reactivated -> active: LEARNING_FULL_ACCESS restored');

  const afterReactivation = await learningHistoryCounts();
  assert(afterReactivation.evidence === beforeSuspension.evidence, 'learning_evidence count UNCHANGED after reactivation (nothing rebuilt/reissued)');
  assert(afterReactivation.mastery === beforeSuspension.mastery, 'mastery_records count UNCHANGED after reactivation');

  const masteryScoreAfter = await db.query(`SELECT mastery_score FROM mastery_records WHERE student_id = $1`, [LEARNER_ID]);
  assert(Number(masteryScoreAfter.rows[0].mastery_score) === 75, 'the ORIGINAL mastery score (75) is exactly preserved, never reset');

  // --- cancelled_at_period_end -> expired path (separate lifecycle branch) ---
  await transitionSubscriptionStatus(LEARNER_ID, 'cancelled_at_period_end');
  await transitionSubscriptionStatus(LEARNER_ID, 'expired');
  assert(!(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_FULL_ACCESS')), 'expired: LEARNING_FULL_ACCESS DENY');
  assert(!(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'SUBSCRIPTION_REACTIVATE')), 'expired: SUBSCRIPTION_REACTIVATE DENY (out of scope for direct reactivation)');
  assert(await canUseCapability(LEARNER_USER_ID, LEARNER_ID, 'LEARNING_HISTORY_VIEW'), 'expired: LEARNING_HISTORY_VIEW still ALLOW');

  const finalCounts = await learningHistoryCounts();
  assert(finalCounts.evidence === 1 && finalCounts.mastery === 1, 'FINAL: still exactly 1 evidence row + 1 mastery row -- identical to the very first count, through the ENTIRE lifecycle');

  console.log('\nAll F3 lifecycle assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F3 lifecycle cert failed:', err);
    process.exit(1);
  });
