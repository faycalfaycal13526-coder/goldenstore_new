/* Golden Store — curated EN/FR/ES content for the legal pages.
   Arabic is the canonical static HTML (see about/privacy/terms.html); this file
   swaps it for reviewed translations when the UI language is not Arabic.
   Revised to match the current store: Google sign-in + consent, instant search,
   ratings/reviews, text-only support chat, clickable links and Web Push.
   NEVER machine-translated: final wording should be reviewed by counsel. */
(function () {
  'use strict';
  var CONTENT = {
  "en": {
    "about": {
      "title": "About us — Golden Store",
      "h2": "About us",
      "kicker": "Legal",
      "lead": "An independent Arabic store for apps and games, with a clear interface and four languages.",
      "updated": "Last updated: 5 November 2026 — revised edition",
      "tocTitle": "On this page",
      "note": "These clauses have been revised to reflect the store’s current features: Google sign-in, mandatory consent, ratings and reviews, instant search, text-only support chat, clickable links and web notifications. Final wording should be reviewed by counsel.",
      "toc": [
        "About us",
        "Official website",
        "Our mission",
        "Current features",
        "Support & contact"
      ],
      "sections": [
        {
          "title": "About us",
          "paras": [
            "Golden Store is an independent Arabic store for Android apps and games. It presents APK files with clear metadata and supports Arabic, English, French and Spanish, with dark and light themes.",
            "The store has been updated with ratings, reviews, likes and reports, instant search, rich detail pages with screenshots, a standalone support page, and mandatory legal consent before sign-in."
          ]
        },
        {
          "title": "Official website",
          "paras": [
            "The official website is the only reference for the current store and its policies:",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Our mission",
          "paras": [
            "To provide a simple, safe download experience: every app shows its name, developer, category, version, size, ratings and screenshots, plus its publish date or last update depending on status — without unnecessary steps."
          ]
        },
        {
          "title": "Current features",
          "paras": [
            "The store now includes:"
          ],
          "items": [
            "Browsing apps and games by category and instant no-reload search.",
            "Detail pages with screenshots, ratings, reviews, likes, reports, category, version and publish/update date.",
            "Google sign-in with mandatory Terms and Privacy consent before access.",
            "A download library, Web Push notifications, and a Telegram group join button on the account page.",
            "A full notification center, a dedicated offline page, a manual update check, and a New & Updated tab next to Categories.",
            "A standalone /support page for one ongoing text-only chat with the admin; links open in a new tab, no images or voice notes are sent, and there are no in-app notifications.",
            "Four languages, dark/light themes, and a golden chat design. There are currently no payments or subscriptions in the store."
          ]
        },
        {
          "title": "Support & contact",
          "paras": [
            "For questions or reports use the <a class=\"legal-inline-link\" href=\"/support\">Support page</a> inside the store, the Telegram group button on the account page, or the official website above."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Privacy Policy — Golden Store",
      "h2": "Privacy Policy",
      "kicker": "Legal",
      "lead": "This policy explains what the updated store collects, how it is used and how it is deleted.",
      "updated": "Last updated: 5 November 2026 — revised edition",
      "tocTitle": "On this page",
      "note": "These clauses have been revised to reflect the store’s current features. Final wording should be reviewed by counsel.",
      "toc": [
        "Introduction",
        "Data we collect",
        "Cookies & local storage",
        "Firebase Auth & consent",
        "Notifications",
        "Support chat",
        "Future advertising",
        "Sharing & deletion",
        "Changes to this policy"
      ],
      "sections": [
        {
          "title": "Introduction",
          "paras": [
            "This policy explains how Golden Store collects, uses and protects data when you browse the store, sign in, rate an app, or message support. By using the store you agree to this policy and to the <a class=\"legal-inline-link\" href=\"/terms\">Terms of Service</a>.",
            "The clauses were updated for the current features: mandatory legal consent, search, ratings and reviews, and a text-only support chat with no voice or image attachments."
          ]
        },
        {
          "title": "Data we collect",
          "paras": [
            "We collect the minimum needed to run the service:"
          ],
          "items": [
            "Google account data: display name, email, profile picture and user ID (UID).",
            "Ratings, reviews, likes, reports and reviews you choose to hide.",
            "Text of support-chat messages and their timestamps; we no longer accept images or voice recordings in chat.",
            "Download history, local preferences, theme, language, and Web Push/FCM device tokens if you grant permission.",
            "A record of your consent to the current Terms and Privacy version."
          ]
        },
        {
          "title": "Cookies & local storage",
          "paras": [
            "The store uses localStorage/sessionStorage for language, theme, download history and chat drafts, plus a secure cookie for legal-consent receipt and authentication sessions when needed. We do not currently use third-party advertising tracking cookies."
          ]
        },
        {
          "title": "Firebase Auth & consent",
          "paras": [
            "Authentication uses Firebase Authentication with a Google account; we never store or see your password. Before signing in you must tick the mandatory Terms and Privacy consent box, and a receipt for the current version is recorded through /api/legal/consent."
          ]
        },
        {
          "title": "Notifications",
          "paras": [
            "If you grant permission we store a device token to send Web Push notifications about new apps and updates. Support chat does not trigger in-app notifications; messages refresh by polling only while the page is open. You can disable notifications in your browser or device settings."
          ]
        },
        {
          "title": "Support chat",
          "paras": [
            "The /support page opens one ongoing text conversation with the admin. Only text is stored; the admin can read, reply to, or permanently delete the thread and its messages. Links you type become safe links that open in a new tab. No images or audio files are uploaded and attachment blobs are no longer stored."
          ]
        },
        {
          "title": "Future advertising",
          "paras": [
            "We may later add advertising or analytics services to support the store; if so we will update this policy, explain the data involved and request consent where required. We currently show no targeted ads and the store has no payments or subscriptions."
          ]
        },
        {
          "title": "Sharing & deletion",
          "paras": [
            "We do not sell your data. We share it only with authentication, hosting, storage and notification providers as needed to run the service, or when legally required. Admins can permanently delete reviews, reports, support threads and their messages from the dashboard, and you can request deletion or correction of your account data through support."
          ]
        },
        {
          "title": "Changes to this policy",
          "paras": [
            "We may update this policy when features change; the last-updated date appears at the top, and we may request fresh consent to a revised version before you continue signing in."
          ]
        }
      ]
    },
    "terms": {
      "title": "Terms of Service — Golden Store",
      "h2": "Terms of Service",
      "kicker": "Legal",
      "lead": "Updated terms for using Golden Store with its current features.",
      "updated": "Last updated: 5 November 2026 — revised edition",
      "tocTitle": "On this page",
      "note": "These clauses have been revised to reflect the store’s current features. Final wording should be reviewed by counsel.",
      "toc": [
        "Acceptance of terms",
        "Use of the service",
        "Accounts & consent",
        "APK files & downloads",
        "Intellectual property",
        "Advertising & external links",
        "Disclaimer",
        "Termination & changes",
        "Applicable law & contact"
      ],
      "sections": [
        {
          "title": "Acceptance of terms",
          "paras": [
            "By using Golden Store or signing in, you confirm that you have read and agree to these Terms and the <a class=\"legal-inline-link\" href=\"/privacy\">Privacy Policy</a>. Sign-in cannot complete until the mandatory consent box is ticked."
          ]
        },
        {
          "title": "Use of the service",
          "paras": [
            "The store is for personal, lawful use only. Do not tamper with the service, scrape it aggressively, bypass access controls, impersonate others, or post abusive or illegal content in ratings, reviews, reports or support messages. Admins may hide or remove violating content."
          ]
        },
        {
          "title": "Accounts & consent",
          "paras": [
            "Accounts are created through Google and identified by a UID. You are responsible for your device, account security and accurate data. Consent to the current Terms and Privacy version is recorded before access, and admins may suspend violating accounts. There are currently no payments or subscriptions in the store."
          ]
        },
        {
          "title": "APK files & downloads",
          "paras": [
            "Installing some apps may require enabling “install from unknown sources”. You do so at your own responsibility; check the file source and requested permissions before installing. The store shows name, developer, category, version, size and publish/update date, but does not guarantee that a file works on your device or is error-free."
          ]
        },
        {
          "title": "Intellectual property",
          "paras": [
            "Trademarks, names, logos and app rights belong to their owners. The store displays content for discovery and access and does not claim ownership of third-party apps. For rights objections, contact us to remove the relevant content."
          ]
        },
        {
          "title": "Advertising & external links",
          "paras": [
            "Advertising or external links may be added later; we are not responsible for their content or practices. Links in support messages open in a new tab with safety attributes, and external sites are governed by their own terms. The Telegram group button on the account page is also an external link."
          ]
        },
        {
          "title": "Disclaimer",
          "paras": [
            "The service is provided “as is” without express or implied warranties. Support chat is text-only, with no images or voice notes, and produces no in-app notifications. We are not liable for indirect damages or data loss arising from using the store or installing any file, to the extent permitted by law."
          ]
        },
        {
          "title": "Termination & changes",
          "paras": [
            "Admins may permanently delete reviews, reports, support threads and their messages, close a support conversation, modify these Terms, or discontinue part of the service, with the last-updated date shown. We may request fresh consent after a material change."
          ]
        },
        {
          "title": "Applicable law & contact",
          "paras": [
            "These Terms are governed by the laws applicable in the user’s country, and we first seek to resolve disputes amicably through the <a class=\"legal-inline-link\" href=\"/support\">Support page</a> or via <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>."
          ]
        }
      ]
    }
  },
  "fr": {
    "about": {
      "title": "À propos — Golden Store",
      "h2": "À propos",
      "kicker": "Mentions légales",
      "lead": "Un store arabe indépendant pour applications et jeux, avec une interface claire et quatre langues.",
      "updated": "Dernière mise à jour : 5 novembre 2026 — version révisée",
      "tocTitle": "Sur cette page",
      "note": "Ces clauses ont été révisées pour refléter les fonctions actuelles du store : connexion Google, consentement obligatoire, notes et avis, recherche instantanée, chat d’assistance texte, liens cliquables et notifications web. La rédaction finale doit être relue par un conseil juridique.",
      "toc": [
        "À propos",
        "Site officiel",
        "Notre mission",
        "Fonctionnalités actuelles",
        "Assistance et contact"
      ],
      "sections": [
        {
          "title": "À propos",
          "paras": [
            "Golden Store est un store arabe indépendant d’applications et de jeux Android. Il présente des fichiers APK avec des métadonnées claires et prend en charge l’arabe, l’anglais, le français et l’espagnol, avec thèmes clair et sombre.",
            "Le store a été mis à jour avec notes, avis, mentions « J’aime » et signalements, recherche instantanée, pages détaillées avec captures d’écran, une page d’assistance dédiée et un consentement légal obligatoire avant la connexion."
          ]
        },
        {
          "title": "Site officiel",
          "paras": [
            "Le site officiel est la seule référence pour la version actuelle du store et ses politiques :",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Notre mission",
          "paras": [
            "Offrir une expérience de téléchargement simple et sûre : chaque application affiche son nom, développeur, catégorie, version, taille, notes et captures, ainsi que sa date de publication ou de dernière mise à jour selon son état — sans étapes inutiles."
          ]
        },
        {
          "title": "Fonctionnalités actuelles",
          "paras": [
            "Le store comprend désormais :"
          ],
          "items": [
            "Navigation par catégorie et recherche instantanée sans rechargement.",
            "Pages détaillées avec captures, notes, avis, mentions « J’aime », signalements, catégorie, version et date de publication/mise à jour.",
            "Connexion Google avec consentement obligatoire aux Conditions et à la Confidentialité avant l’accès.",
            "Bibliothèque de téléchargements, notifications Web Push et bouton pour rejoindre le groupe Telegram sur la page Compte.",
            "Un centre de notifications complet, une page hors ligne dédiée, une vérification manuelle des mises à jour et un onglet « Nouveautés et mises à jour » à côté des Catégories.",
            "Page /support pour une conversation texte unique avec l’admin ; les liens s’ouvrent dans un nouvel onglet, aucune image ni note vocale n’est envoyée, et aucune notification interne n’est générée.",
            "Quatre langues, thèmes clair/sombre et design doré pour le chat. Aucun paiement ni abonnement n’est proposé actuellement."
          ]
        },
        {
          "title": "Assistance et contact",
          "paras": [
            "Pour toute question ou signalement, utilisez la <a class=\"legal-inline-link\" href=\"/support\">page d’assistance</a> du store, le bouton du groupe Telegram sur la page Compte, ou le site officiel ci-dessus."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Politique de confidentialité — Golden Store",
      "h2": "Politique de confidentialité",
      "kicker": "Mentions légales",
      "lead": "Cette politique explique les données collectées par le store mis à jour, leur usage et leur suppression.",
      "updated": "Dernière mise à jour : 5 novembre 2026 — version révisée",
      "tocTitle": "Sur cette page",
      "note": "Ces clauses ont été révisées pour refléter les fonctions actuelles du store. La rédaction finale doit être relue par un conseil juridique.",
      "toc": [
        "Introduction",
        "Données collectées",
        "Cookies et stockage local",
        "Firebase Auth et consentement",
        "Notifications",
        "Chat d’assistance",
        "Publicité future",
        "Partage et suppression",
        "Modifications"
      ],
      "sections": [
        {
          "title": "Introduction",
          "paras": [
            "Cette politique explique comment Golden Store collecte, utilise et protège les données lors de la navigation, de la connexion, des notes ou des messages d’assistance. En utilisant le store, vous acceptez cette politique et les <a class=\"legal-inline-link\" href=\"/terms\">Conditions d’utilisation</a>.",
            "Les clauses ont été mises à jour pour les fonctions actuelles : consentement légal obligatoire, recherche, notes et avis, et chat d’assistance texte sans pièces jointes vocales ou image."
          ]
        },
        {
          "title": "Données collectées",
          "paras": [
            "Nous collectons le minimum nécessaire au service :"
          ],
          "items": [
            "Données du compte Google : nom affiché, e-mail, photo de profil et identifiant utilisateur (UID).",
            "Notes, avis, mentions « J’aime », signalements et avis que vous choisissez de masquer.",
            "Texte des messages du chat d’assistance et leur horodatage ; nous n’acceptons plus d’images ni d’enregistrements vocaux dans le chat.",
            "Historique de téléchargements, préférences locales, thème, langue et jetons d’appareil Web Push/FCM si vous autorisez les notifications.",
            "Trace de votre consentement à la version actuelle des Conditions et de la Confidentialité."
          ]
        },
        {
          "title": "Cookies et stockage local",
          "paras": [
            "Le store utilise localStorage/sessionStorage pour la langue, le thème, l’historique et les brouillons de chat, ainsi qu’un cookie sécurisé pour l’accusé de consentement et les sessions d’authentification si besoin. Nous n’utilisons pas actuellement de cookies de suivi publicitaire tiers."
          ]
        },
        {
          "title": "Firebase Auth et consentement",
          "paras": [
            "L’authentification passe par Firebase Authentication avec un compte Google ; nous ne stockons ni ne voyons votre mot de passe. Avant la connexion, vous devez cocher la case obligatoire des Conditions et de la Confidentialité, et un accusé de la version actuelle est enregistré via /api/legal/consent."
          ]
        },
        {
          "title": "Notifications",
          "paras": [
            "Si vous autorisez les notifications, nous conservons un jeton d’appareil pour envoyer des Web Push sur les nouveautés et mises à jour. Le chat d’assistance ne déclenche aucune notification interne ; les messages se rafraîchissent par interrogation tant que la page est ouverte. Vous pouvez désactiver les notifications dans le navigateur ou l’appareil."
          ]
        },
        {
          "title": "Chat d’assistance",
          "paras": [
            "La page /support ouvre une conversation texte unique avec l’admin. Seul le texte est stocké ; l’admin peut lire, répondre ou supprimer définitivement le fil et ses messages. Les liens saisis deviennent des liens sûrs ouvrant un nouvel onglet. Aucune image ni audio n’est téléversé et les blobs de pièces jointes ne sont plus stockés."
          ]
        },
        {
          "title": "Publicité future",
          "paras": [
            "Nous pourrions ajouter plus tard publicité ou analyse pour soutenir le store ; nous mettrions alors cette politique à jour, préciserions les données et demanderions le consentement requis. Aucune publicité ciblée n’est affichée actuellement et le store ne propose ni paiement ni abonnement."
          ]
        },
        {
          "title": "Partage et suppression",
          "paras": [
            "Nous ne vendons pas vos données. Elles sont partagées uniquement avec les fournisseurs d’authentification, d’hébergement, de stockage et de notifications selon le besoin, ou sur obligation légale. Les admins peuvent supprimer définitivement avis, signalements, fils d’assistance et messages depuis le tableau de bord, et vous pouvez demander la suppression ou la correction de vos données via l’assistance."
          ]
        },
        {
          "title": "Modifications",
          "paras": [
            "Cette politique peut être mise à jour lors de changements de fonctionnalités ; la date de dernière mise à jour figure en haut, et un nouveau consentement peut être demandé avant de poursuivre la connexion."
          ]
        }
      ]
    },
    "terms": {
      "title": "Conditions d’utilisation — Golden Store",
      "h2": "Conditions d’utilisation",
      "kicker": "Mentions légales",
      "lead": "Conditions mises à jour pour l’utilisation de Golden Store avec ses fonctions actuelles.",
      "updated": "Dernière mise à jour : 5 novembre 2026 — version révisée",
      "tocTitle": "Sur cette page",
      "note": "Ces clauses ont été révisées pour refléter les fonctions actuelles du store. La rédaction finale doit être relue par un conseil juridique.",
      "toc": [
        "Acceptation",
        "Utilisation du service",
        "Comptes et consentement",
        "Fichiers APK et téléchargements",
        "Propriété intellectuelle",
        "Publicité et liens externes",
        "Limitation de responsabilité",
        "Résiliation et modifications",
        "Droit applicable et contact"
      ],
      "sections": [
        {
          "title": "Acceptation",
          "paras": [
            "En utilisant Golden Store ou en vous connectant, vous confirmez avoir lu et accepté les présentes Conditions et la <a class=\"legal-inline-link\" href=\"/privacy\">Politique de confidentialité</a>. La connexion ne peut aboutir sans la case de consentement obligatoire."
          ]
        },
        {
          "title": "Utilisation du service",
          "paras": [
            "Le store est réservé à un usage personnel et légal. Il est interdit de perturber le service, d’en faire un scraping intensif, de contourner les contrôles d’accès, d’usurper une identité ou de publier un contenu abusif ou illégal dans les notes, avis, signalements ou messages d’assistance. Les admins peuvent masquer ou supprimer le contenu contrevenant."
          ]
        },
        {
          "title": "Comptes et consentement",
          "paras": [
            "Les comptes sont créés via Google et identifiés par un UID. Vous êtes responsable de votre appareil, de la sécurité du compte et de l’exactitude des données. Le consentement à la version actuelle est enregistré avant l’accès, et les admins peuvent suspendre les comptes contrevenants. Aucun paiement ni abonnement n’est proposé actuellement."
          ]
        },
        {
          "title": "Fichiers APK et téléchargements",
          "paras": [
            "Installer certaines applications peut nécessiter d’activer les « sources inconnues ». Vous le faites sous votre responsabilité ; vérifiez la source du fichier et les permissions avant installation. Le store affiche nom, développeur, catégorie, version, taille et date de publication/mise à jour, mais ne garantit pas le fonctionnement du fichier sur votre appareil ni l’absence d’erreurs."
          ]
        },
        {
          "title": "Propriété intellectuelle",
          "paras": [
            "Marques, noms, logos et droits des applications appartiennent à leurs propriétaires. Le store affiche le contenu pour la découverte et l’accès et ne revendique pas la propriété des applications tierces. Pour toute objection de droits, contactez-nous afin de retirer le contenu concerné."
          ]
        },
        {
          "title": "Publicité et liens externes",
          "paras": [
            "Publicité ou liens externes pourront être ajoutés plus tard ; nous ne sommes pas responsables de leur contenu ni de leurs pratiques. Les liens des messages d’assistance s’ouvrent dans un nouvel onglet avec attributs de sécurité, et les sites externes sont régis par leurs propres conditions. Le bouton du groupe Telegram sur la page Compte est aussi un lien externe."
          ]
        },
        {
          "title": "Limitation de responsabilité",
          "paras": [
            "Le service est fourni « tel quel » sans garantie expresse ou implicite. Le chat d’assistance est uniquement texte, sans images ni notes vocales, et ne génère aucune notification interne. Nous ne sommes pas responsables des dommages indirects ou pertes de données liés à l’usage du store ou à l’installation d’un fichier, dans la limite permise par la loi."
          ]
        },
        {
          "title": "Résiliation et modifications",
          "paras": [
            "Les admins peuvent supprimer définitivement avis, signalements, fils d’assistance et messages, clore une conversation, modifier les présentes Conditions ou interrompre une partie du service, avec la date de dernière mise à jour indiquée. Un nouveau consentement peut être demandé après une modification substantielle."
          ]
        },
        {
          "title": "Droit applicable et contact",
          "paras": [
            "Les présentes Conditions sont régies par le droit applicable dans le pays de l’utilisateur, et nous cherchons d’abord à résoudre tout litige à l’amiable via la <a class=\"legal-inline-link\" href=\"/support\">page d’assistance</a> ou via <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>."
          ]
        }
      ]
    }
  },
  "es": {
    "about": {
      "title": "Sobre nosotros — Golden Store",
      "h2": "Sobre nosotros",
      "kicker": "Legal",
      "lead": "Una tienda árabe independiente de aplicaciones y juegos, con interfaz clara y cuatro idiomas.",
      "updated": "Última actualización: 5 de noviembre de 2026 — edición revisada",
      "tocTitle": "En esta página",
      "note": "Estas cláusulas se han revisado para reflejar las funciones actuales de la tienda: acceso con Google, consentimiento obligatorio, valoraciones y reseñas, búsqueda instantánea, chat de soporte solo texto, enlaces pulsables y notificaciones web. La redacción final debe ser revisada por un asesor legal.",
      "toc": [
        "Sobre nosotros",
        "Sitio oficial",
        "Nuestra misión",
        "Funciones actuales",
        "Soporte y contacto"
      ],
      "sections": [
        {
          "title": "Sobre nosotros",
          "paras": [
            "Golden Store es una tienda árabe independiente de aplicaciones y juegos Android. Presenta archivos APK con metadatos claros y admite árabe, inglés, francés y español, con temas claro y oscuro.",
            "La tienda se ha actualizado con valoraciones, reseñas, «me gusta» y reportes, búsqueda instantánea, páginas de detalle con capturas, una página de soporte independiente y consentimiento legal obligatorio antes de iniciar sesión."
          ]
        },
        {
          "title": "Sitio oficial",
          "paras": [
            "El sitio oficial es la única referencia de la versión actual de la tienda y sus políticas:",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Nuestra misión",
          "paras": [
            "Ofrecer una experiencia de descarga sencilla y segura: cada app muestra nombre, desarrollador, categoría, versión, tamaño, valoraciones y capturas, además de su fecha de publicación o última actualización según corresponda, sin pasos innecesarios."
          ]
        },
        {
          "title": "Funciones actuales",
          "paras": [
            "La tienda incluye ahora:"
          ],
          "items": [
            "Navegación por categoría y búsqueda instantánea sin recargar la página.",
            "Páginas de detalle con capturas, valoraciones, reseñas, «me gusta», reportes, categoría, versión y fecha de publicación/actualización.",
            "Acceso con Google y consentimiento obligatorio de Términos y Privacidad antes de entrar.",
            "Biblioteca de descargas, notificaciones Web Push y botón para unirse al grupo de Telegram en la página Cuenta.",
            "Un centro de notificaciones completo, una página sin conexión dedicada, una comprobación manual de actualizaciones y una pestaña «Novedades y actualizaciones» junto a Categorías.",
            "Página /support con un único chat de texto con el administrador; los enlaces se abren en una pestaña nueva, no se envían imágenes ni notas de voz y no hay notificaciones internas.",
            "Cuatro idiomas, temas claro/oscuro y diseño dorado en el chat. Actualmente no hay pagos ni suscripciones en la tienda."
          ]
        },
        {
          "title": "Soporte y contacto",
          "paras": [
            "Para consultas o reportes usa la <a class=\"legal-inline-link\" href=\"/support\">página de soporte</a> dentro de la tienda, el botón del grupo de Telegram en Cuenta, o el sitio oficial indicado arriba."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Política de privacidad — Golden Store",
      "h2": "Política de privacidad",
      "kicker": "Legal",
      "lead": "Esta política explica qué datos recopila la tienda actualizada, cómo se usan y cómo se eliminan.",
      "updated": "Última actualización: 5 de noviembre de 2026 — edición revisada",
      "tocTitle": "En esta página",
      "note": "Estas cláusulas se han revisado para reflejar las funciones actuales de la tienda. La redacción final debe ser revisada por un asesor legal.",
      "toc": [
        "Introducción",
        "Datos que recopilamos",
        "Cookies y almacenamiento local",
        "Firebase Auth y consentimiento",
        "Notificaciones",
        "Chat de soporte",
        "Publicidad futura",
        "Compartir y eliminación",
        "Cambios en la política"
      ],
      "sections": [
        {
          "title": "Introducción",
          "paras": [
            "Esta política explica cómo Golden Store recopila, usa y protege los datos al navegar, iniciar sesión, valorar una app o escribir al soporte. Al usar la tienda aceptas esta política y los <a class=\"legal-inline-link\" href=\"/terms\">Términos del servicio</a>.",
            "Las cláusulas se actualizaron para las funciones actuales: consentimiento legal obligatorio, búsqueda, valoraciones y reseñas, y chat de soporte solo texto sin adjuntos de voz o imagen."
          ]
        },
        {
          "title": "Datos que recopilamos",
          "paras": [
            "Recopilamos lo mínimo necesario para el servicio:"
          ],
          "items": [
            "Datos de la cuenta de Google: nombre visible, correo, foto de perfil e identificador de usuario (UID).",
            "Valoraciones, reseñas, «me gusta», reportes y reseñas que decidas ocultar.",
            "Texto de los mensajes del chat de soporte y su hora; ya no aceptamos imágenes ni grabaciones de voz en el chat.",
            "Historial de descargas, preferencias locales, tema, idioma y tokens de dispositivo Web Push/FCM si das permiso.",
            "Registro de tu consentimiento a la versión actual de Términos y Privacidad."
          ]
        },
        {
          "title": "Cookies y almacenamiento local",
          "paras": [
            "La tienda usa localStorage/sessionStorage para idioma, tema, historial y borradores del chat, además de una cookie segura para el justificante de consentimiento y las sesiones de autenticación cuando hacen falta. Actualmente no usamos cookies de seguimiento publicitario de terceros."
          ]
        },
        {
          "title": "Firebase Auth y consentimiento",
          "paras": [
            "La autenticación usa Firebase Authentication con una cuenta de Google; nunca guardamos ni vemos tu contraseña. Antes de entrar debes marcar la casilla obligatoria de Términos y Privacidad, y se registra un justificante de la versión actual mediante /api/legal/consent."
          ]
        },
        {
          "title": "Notificaciones",
          "paras": [
            "Si das permiso guardamos un token de dispositivo para enviar notificaciones Web Push sobre novedades y actualizaciones. El chat de soporte no genera notificaciones internas; los mensajes se actualizan por sondeo solo mientras la página está abierta. Puedes desactivarlas en el navegador o el dispositivo."
          ]
        },
        {
          "title": "Chat de soporte",
          "paras": [
            "La página /support abre una única conversación de texto con el administrador. Solo se guarda el texto; el administrador puede leer, responder o eliminar definitivamente el hilo y sus mensajes. Los enlaces que escribes se convierten en enlaces seguros que abren una pestaña nueva. No se suben imágenes ni audio y ya no se almacenan blobs de adjuntos."
          ]
        },
        {
          "title": "Publicidad futura",
          "paras": [
            "Más adelante podríamos añadir publicidad o análisis para sostener la tienda; entonces actualizaríamos esta política, explicaríamos los datos y pediríamos el consentimiento necesario. Actualmente no mostramos publicidad dirigida y la tienda no tiene pagos ni suscripciones."
          ]
        },
        {
          "title": "Compartir y eliminación",
          "paras": [
            "No vendemos tus datos. Solo se comparten con proveedores de autenticación, alojamiento, almacenamiento y notificaciones según lo necesario, o por obligación legal. Los administradores pueden eliminar definitivamente reseñas, reportes, hilos de soporte y mensajes desde el panel, y tú puedes pedir la eliminación o corrección de tus datos a través del soporte."
          ]
        },
        {
          "title": "Cambios en la política",
          "paras": [
            "Podemos actualizar esta política cuando cambien las funciones; la fecha de última actualización aparece arriba y podemos pedir un nuevo consentimiento antes de continuar con el inicio de sesión."
          ]
        }
      ]
    },
    "terms": {
      "title": "Términos del servicio — Golden Store",
      "h2": "Términos del servicio",
      "kicker": "Legal",
      "lead": "Términos actualizados para usar Golden Store con sus funciones actuales.",
      "updated": "Última actualización: 5 de noviembre de 2026 — edición revisada",
      "tocTitle": "En esta página",
      "note": "Estas cláusulas se han revisado para reflejar las funciones actuales de la tienda. La redacción final debe ser revisada por un asesor legal.",
      "toc": [
        "Aceptación",
        "Uso del servicio",
        "Cuentas y consentimiento",
        "Archivos APK y descargas",
        "Propiedad intelectual",
        "Publicidad y enlaces externos",
        "Limitación de responsabilidad",
        "Terminación y modificaciones",
        "Ley aplicable y contacto"
      ],
      "sections": [
        {
          "title": "Aceptación",
          "paras": [
            "Al usar Golden Store o iniciar sesión confirmas que has leído y aceptas estos Términos y la <a class=\"legal-inline-link\" href=\"/privacy\">Política de privacidad</a>. El acceso no puede completarse sin marcar la casilla de consentimiento obligatoria."
          ]
        },
        {
          "title": "Uso del servicio",
          "paras": [
            "La tienda es para uso personal y legal. Se prohíbe manipular el servicio, hacer scraping intensivo, eludir controles de acceso, suplantar identidades o publicar contenido abusivo o ilegal en valoraciones, reseñas, reportes o mensajes de soporte. Los administradores pueden ocultar o eliminar el contenido infractor."
          ]
        },
        {
          "title": "Cuentas y consentimiento",
          "paras": [
            "Las cuentas se crean con Google y se identifican por un UID. Eres responsable de tu dispositivo, de la seguridad de la cuenta y de la veracidad de los datos. El consentimiento a la versión actual se registra antes del acceso y los administradores pueden suspender cuentas infractoras. Actualmente no hay pagos ni suscripciones en la tienda."
          ]
        },
        {
          "title": "Archivos APK y descargas",
          "paras": [
            "Instalar algunas apps puede requerir activar «fuentes desconocidas». Lo haces bajo tu responsabilidad; revisa el origen del archivo y los permisos antes de instalar. La tienda muestra nombre, desarrollador, categoría, versión, tamaño y fecha de publicación/actualización, pero no garantiza que el archivo funcione en tu dispositivo ni que esté libre de errores."
          ]
        },
        {
          "title": "Propiedad intelectual",
          "paras": [
            "Marcas, nombres, logos y derechos de las apps pertenecen a sus dueños. La tienda muestra el contenido para descubrirlo y acceder a él y no reclama la propiedad de apps de terceros. Para cualquier objeción de derechos, contáctanos para retirar el contenido correspondiente."
          ]
        },
        {
          "title": "Publicidad y enlaces externos",
          "paras": [
            "Más adelante podrían añadirse anuncios o enlaces externos; no somos responsables de su contenido ni de sus prácticas. Los enlaces de los mensajes de soporte se abren en una pestaña nueva con atributos de seguridad, y los sitios externos se rigen por sus propios términos. El botón del grupo de Telegram en Cuenta también es un enlace externo."
          ]
        },
        {
          "title": "Limitación de responsabilidad",
          "paras": [
            "El servicio se ofrece «tal cual» sin garantías expresas o implícitas. El chat de soporte es solo texto, sin imágenes ni notas de voz, y no genera notificaciones internas. No respondemos por daños indirectos o pérdida de datos derivados del uso de la tienda o de la instalación de un archivo, hasta donde lo permita la ley."
          ]
        },
        {
          "title": "Terminación y modificaciones",
          "paras": [
            "Los administradores pueden eliminar definitivamente reseñas, reportes, hilos de soporte y mensajes, cerrar una conversación, modificar estos Términos o interrumpir parte del servicio, indicando la fecha de última actualización. Podemos pedir un nuevo consentimiento tras un cambio sustancial."
          ]
        },
        {
          "title": "Ley aplicable y contacto",
          "paras": [
            "Estos Términos se rigen por la ley aplicable en el país del usuario, y primero buscamos resolver cualquier disputa de forma amistosa mediante la <a class=\"legal-inline-link\" href=\"/support\">página de soporte</a> o a través de <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>."
          ]
        }
      ]
    }
  }
};
  window.GSLegalContent = CONTENT;

  function putText(sel, value) {
    var n = document.querySelector(sel);
    if (n && value != null) n.textContent = value;
  }

  function buildSection(sec, data) {
    sec.textContent = '';
    var h = document.createElement('h3');
    h.textContent = data.title || '';
    sec.appendChild(h);
    (data.paras || []).forEach(function (p) {
      var el = document.createElement('p');
      // Only our own curated strings containing <a> are inserted as HTML.
      if (p.indexOf('<a ') !== -1) el.innerHTML = p;
      else el.textContent = p;
      sec.appendChild(el);
    });
    if (data.items && data.items.length) {
      var ul = document.createElement('ul');
      data.items.forEach(function (i) {
        var li = document.createElement('li');
        li.textContent = i;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    }
  }

  function apply() {
    var main = document.querySelector('main[data-legal-page]');
    var lang = (window.GSI18N && window.GSI18N.lang) || 'ar';
    var host = document.getElementById('legalLang');
    if (host && window.GSI18N && window.GSI18N.switcherEl && !host.firstChild) {
      try { host.appendChild(window.GSI18N.switcherEl()); } catch (e) {}
    }
    if (!main || lang === 'ar' || !CONTENT[lang]) return;   // static Arabic stays
    var page = main.getAttribute('data-legal-page');
    var d = CONTENT[lang][page];
    if (!d) return;

    document.title = d.title;
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
    putText('.legal-kicker', d.kicker);
    putText('#legalTitle', d.h2);
    putText('.legal-topbar-title', d.h2);
    putText('.legal-lead', d.lead);
    putText('.legal-updated', d.updated);
    putText('.legal-toc-title', d.tocTitle);
    putText('.legal-note', d.note);

    var tocLinks = document.querySelectorAll('.legal-toc-list a');
    for (var i = 0; i < tocLinks.length; i++) {
      if (d.toc[i] != null) tocLinks[i].textContent = d.toc[i];   // CSS adds the number
    }
    var sections = main.querySelectorAll('.legal-card .legal-section[data-key]');
    for (var j = 0; j < sections.length; j++) {
      if (d.sections[j]) buildSection(sections[j], d.sections[j]);
    }
  }

  window.GSLegalContentApply = apply;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
