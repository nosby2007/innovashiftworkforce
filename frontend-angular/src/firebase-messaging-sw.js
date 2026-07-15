// Handles Firebase Cloud Messaging push notifications while the app tab is
// closed or backgrounded. Registered by PushNotificationsService at an
// isolated scope (/firebase-cloud-messaging-push-scope) so it never takes
// over navigation/fetch from ngsw-worker.js, which owns the app shell.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAF1HZp-9xE_4-MaT_mS-H0KIP_k9j-Org',
  authDomain: 'atlanta-e04aa.firebaseapp.com',
  projectId: 'atlanta-e04aa',
  storageBucket: 'atlanta-e04aa.firebasestorage.app',
  messagingSenderId: '404381833719',
  appId: '1:404381833719:web:20c22d5b673fe2134d36f2',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || payload.notification?.title || 'InnovaShift';
  const body = data.body || payload.notification?.body || '';
  const actions = [];
  if (data.acceptUrl) actions.push({ action: 'accept', title: 'Accept' });
  actions.push({ action: 'view', title: 'View' });

  self.registration.showNotification(title, {
    body,
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    data,
    actions,
    tag: data.shiftId ? `shift-${data.shiftId}` : undefined,
  });
});

function focusOrOpen(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
    const target = new URL(url, self.location.origin).href;
    const existing = clientsArr.find((c) => 'focus' in c);
    if (existing) {
      if ('navigate' in existing) existing.navigate(target).catch(() => {});
      return existing.focus();
    }
    return self.clients.openWindow(target);
  });
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  if (event.action === 'accept' && data.acceptUrl) {
    event.waitUntil(
      fetch(data.acceptUrl, { mode: 'cors' })
        .catch(() => {})
        .then(() => focusOrOpen(data.deepLink || '/app/marketplace'))
    );
    return;
  }

  event.waitUntil(focusOrOpen(data.deepLink || '/app/notifications'));
});
