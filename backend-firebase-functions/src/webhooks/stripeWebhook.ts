import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { isSelfServePlan, planForPriceId } from '../infra/stripe-plans';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

export const stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  const stripe = new Stripe(stripeSecretKey.value() || 'sk_test_mock_secret_key', { apiVersion: '2026-04-22.dahlia' as any });
  const sig = req.headers['stripe-signature'];

  let event: any;

  try {
    // In production, you must use the raw body for signature verification.
    // For Firebase v2 functions, req.rawBody is available.
    event = stripe.webhooks.constructEvent(req.rawBody, sig as string, stripeWebhookSecret.value() || 'whsec_test_mock');
  } catch (err: any) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const db = admin.firestore();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const orgId = session.metadata?.orgId;
        const planId = session.metadata?.planId;
        if (orgId) {
          const update: Record<string, unknown> = { planStatus: 'active' };
          if (isSelfServePlan(planId)) update['plan'] = planId;
          await db.collection('orgs').doc(orgId).update(update);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;

        // Find org by stripeCustomerId
        const orgsSnap = await db.collection('orgs').where('stripeCustomerId', '==', customerId).limit(1).get();
        if (!orgsSnap.empty) {
          const orgRef = orgsSnap.docs[0].ref;
          const update: Record<string, unknown> = { planStatus: subscription.status }; // e.g. 'active', 'past_due', 'canceled'
          // A plan switch made through Stripe's own customer portal (rather
          // than our checkout flow) doesn't carry our metadata, so reverse
          // the subscription's current price back to one of our plan names.
          const currentPriceId = subscription.items?.data?.[0]?.price?.id as string | undefined;
          const mappedPlan = planForPriceId(currentPriceId);
          if (mappedPlan) update['plan'] = mappedPlan;
          await orgRef.update(update);
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        
        const orgsSnap = await db.collection('orgs').where('stripeCustomerId', '==', customerId).limit(1).get();
        if (!orgsSnap.empty) {
          const orgRef = orgsSnap.docs[0].ref;
          await orgRef.update({
            planStatus: 'canceled',
            plan: 'free',
          });
        }
        break;
      }
      
      default:
        logger.info(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error handling Stripe webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});
