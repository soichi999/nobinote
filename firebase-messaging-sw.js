// プッシュ通知（アプリを閉じている間）の受信用 Service Worker
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./firebase-config-sw.js"); // firebaseConfig をグローバルに定義

firebase.initializeApp(self.firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(({ notification }) => {
  self.registration.showNotification(notification?.title ?? "ノビノート", {
    body: notification?.body ?? "",
    icon: "./icon-192.png",
    badge: "./icon-192.png"
  });
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./index.html");
  }));
});
