import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { isSelfServePlan, priceIdForPlan } from '../infra/stripe-plans';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

export const stripeCreateCheckout = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const stripe = new Stripe(stripeSecretKey.value() || 'sk_test_mock_secret_key', { apiVersion: '2026-04-22.dahlia' as any });
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to upgrade plan.');
  }

  const { orgId, planId, successUrl, cancelUrl } = request.data;
  if (!orgId || !planId) {
    throw new HttpsError('invalid-argument', 'Missing orgId or planId.');
  }
  if (!isSelfServePlan(planId)) {
    throw new HttpsError('invalid-argument', 'planId must be "starter" or "pro" — Enterprise is custom pricing, sold through sales.');
  }
  const priceId = priceIdForPlan(planId);
  if (!priceId) {
    throw new HttpsError('failed-precondition', `Billing is not configured for the ${planId} plan yet (missing Stripe price id).`);
  }

  // Verify user is an org admin
  const db = admin.firestore();
  const userRef = db.collection(`orgs/${orgId}/users`).doc(uid);
  const userSnap = await userRef.get();
  
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User does not belong to this organization.');
  }

  const userRole = userSnap.data()?.accessRole;
  if (userRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only org admins can upgrade the subscription.');
  }

  // Fetch org data to see if customer exists
  const orgRef = db.collection('orgs').doc(orgId);
  const orgSnap = await orgRef.get();
  const orgData = orgSnap.data();

  if (!orgData) {
    throw new HttpsError('not-found', 'Organization not found.');
  }

  let customerId = orgData.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: orgData.contactEmail || '',
      name: orgData.name,
      metadata: { orgId }
    });
    customerId = customer.id;
    await orgRef.update({ stripeCustomerId: customerId });
  }

  // Create checkout session
  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: successUrl || 'http://localhost:4200/admin/settings?billing=success',
      cancel_url: cancelUrl || 'http://localhost:4200/admin/settings?billing=cancel',
      // planId (our own tier name, not the raw Stripe price id) lets the
      // webhook set orgs/{orgId}.plan directly on checkout.session.completed
      // without needing to reverse-map a price id.
      metadata: { orgId, planId },
      subscription_data: { metadata: { orgId, planId } },
    });

    return { url: session.url };
  } catch (error: any) {
    logger.error('Stripe error:', error);
    throw new HttpsError('internal', error.message || 'Failed to create checkout session.');
  }
});
