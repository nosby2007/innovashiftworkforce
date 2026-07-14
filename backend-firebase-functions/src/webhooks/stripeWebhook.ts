import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_secret_key';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_mock';

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' as any });

export const stripeWebhook = onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event: any;

  try {
    // In production, you must use the raw body for signature verification.
    // For Firebase v2 functions, req.rawBody is available.
    event = stripe.webhooks.constructEvent(req.rawBody, sig as string, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const db = admin.firestore();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const orgId = session.metadata?.orgId;
        if (orgId) {
          // Assume checkout is for a new subscription
          await db.collection('orgs').doc(orgId).update({
            planStatus: 'active',
            // Typically you'd map the price ID to your internal plan name here
            // plan: 'pro',
          });
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
          await orgRef.update({
            planStatus: subscription.status, // e.g. 'active', 'past_due', 'canceled'
          });
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
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling Stripe webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});
