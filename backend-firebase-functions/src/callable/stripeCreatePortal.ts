import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

export const stripeCreatePortal = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const stripe = new Stripe(stripeSecretKey.value() || 'sk_test_mock_secret_key', { apiVersion: '2026-04-22.dahlia' as any });
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { orgId, returnUrl } = request.data;
  if (!orgId) {
    throw new HttpsError('invalid-argument', 'Missing orgId.');
  }

  // Verify user is an org admin
  const db = admin.firestore();
  const userRef = db.collection(`orgs/${orgId}/users`).doc(uid);
  const userSnap = await userRef.get();
  
  if (!userSnap.exists || userSnap.data()?.accessRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only org admins can manage billing.');
  }

  const orgRef = db.collection('orgs').doc(orgId);
  const orgSnap = await orgRef.get();
  const orgData = orgSnap.data();

  if (!orgData?.stripeCustomerId) {
    throw new HttpsError('failed-precondition', 'Organization has no active billing customer. Please upgrade first.');
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: orgData.stripeCustomerId,
      return_url: returnUrl || 'http://localhost:4200/admin/settings',
    });

    return { url: portalSession.url };
  } catch (error: any) {
    logger.error('Stripe Portal error:', error);
    throw new HttpsError('internal', error.message || 'Failed to create portal session.');
  }
});
