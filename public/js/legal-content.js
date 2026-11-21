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
      "lead": "An independent Arabic store for apps and games, with a clear interface and ten languages.",
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
            "Ten languages, dark/light themes, and a golden chat design. There are currently no payments or subscriptions in the store."
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
        "Changes to this policy",
        "Optional demographics"
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
        },
        {
          "title": "Optional demographics",
          "paras": [
            "You may optionally share an age group, gender and country anonymously and with explicit consent, for aggregated statistics only. This data is never linked to your account, and we never collect your name, e-mail or date of birth. You can withdraw consent or delete the data at any time from your account page. If this option is not enabled in the dashboard, nothing is collected."
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
      "lead": "Un store arabe indépendant pour applications et jeux, avec une interface claire et dix langues.",
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
            "Dix langues, thèmes clair/sombre et design doré pour le chat. Aucun paiement ni abonnement n’est proposé actuellement."
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
        "Modifications",
        "Données démographiques facultatives"
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
        },
        {
          "title": "Données démographiques facultatives",
          "paras": [
            "Vous pouvez choisir de partager de façon anonyme une tranche d’âge, un genre et un pays, avec un consentement explicite et à des fins statistiques agrégées uniquement. Ces données ne sont jamais liées à votre compte et nous ne collectons ni votre nom, ni votre e-mail, ni votre date de naissance. Vous pouvez retirer votre consentement ou supprimer ces données à tout moment depuis votre page de compte. Si cette option n’est pas activée dans le tableau de bord, aucune donnée n’est collectée."
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
      "lead": "Una tienda árabe independiente de aplicaciones y juegos, con interfaz clara y diez idiomas.",
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
            "Diez idiomas, temas claro/oscuro y diseño dorado en el chat. Actualmente no hay pagos ni suscripciones en la tienda."
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
        "Cambios en la política",
        "Datos demográficos opcionales"
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
        },
        {
          "title": "Datos demográficos opcionales",
          "paras": [
            "Puedes compartir opcionalmente un grupo de edad, género y país de forma anónima y con consentimiento explícito, solo con fines estadísticos agregados. Estos datos nunca se vinculan a tu cuenta y no recopilamos tu nombre, correo electrónico ni fecha de nacimiento. Puedes retirar el consentimiento o eliminar los datos en cualquier momento desde tu página de cuenta. Si esta opción no está activada en el panel, no se recopila nada."
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
  },
  "tr":   {
    "about": {
      "title": "Hakkımızda — Altın Mağaza",
      "h2": "Hakkımızda",
      "kicker": "Yasal",
      "lead": "Anlaşılır bir arayüze ve on dile sahip, uygulamalar ve oyunlar için bağımsız bir Arapça mağazası.",
      "updated": "Son güncelleme: 5 Kasım 2026 — gözden geçirilmiş baskı",
      "tocTitle": "Bu sayfada",
      "note": "Bu maddeler, mağazanın mevcut özelliklerini yansıtacak şekilde revize edilmiştir: Google ile oturum açma, zorunlu izin, derecelendirmeler ve incelemeler, anında arama, yalnızca metinden oluşan destek sohbeti, tıklanabilir bağlantılar ve web bildirimleri. Son ifadeler avukat tarafından gözden geçirilmelidir.",
      "toc": [
        "Hakkımızda",
        "Resmi web sitesi",
        "Misyonumuz",
        "Mevcut özellikler",
        "Destek ve iletişim"
      ],
      "sections": [
        {
          "title": "Hakkımızda",
          "paras": [
            "Golden Store, Android uygulamaları ve oyunlarına yönelik bağımsız bir Arap mağazasıdır. APK dosyalarını net meta verilerle sunar ve koyu ve açık temalarla Arapça, İngilizce, Fransızca ve İspanyolca'yı destekler.",
            "Mağaza derecelendirmeler, incelemeler, beğeniler ve raporlar, anında arama, ekran görüntüleri içeren zengin ayrıntılı sayfalar, bağımsız bir destek sayfası ve oturum açmadan önce zorunlu yasal izin ile güncellendi."
          ]
        },
        {
          "title": "Resmi web sitesi",
          "paras": [
            "Resmi web sitesi mevcut mağaza ve politikaları için tek referanstır:",
            "<a class = \"legal-inline-link\" href = \"https://goldenstore.online\" target = \"_blank\" rel = \"noopener noreferrer\" dir = \"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Misyonumuz",
          "paras": [
            "Basit, güvenli bir indirme deneyimi sağlamak için: Her uygulama gereksiz adımlar olmadan adını, geliştiricisini, kategorisini, sürümünü, boyutunu, derecelendirmelerini ve ekran görüntülerini, ayrıca duruma bağlı olarak yayınlanma tarihini veya son güncellemesini gösterir."
          ]
        },
        {
          "title": "Mevcut özellikler",
          "paras": [
            "Mağaza artık şunları içeriyor:"
          ],
          "items": [
            "Uygulamalara ve oyunlara kategoriye göre göz atma ve yeniden yükleme gerektirmeyen anında arama.",
            "Ekran görüntüleri, derecelendirmeler, incelemeler, beğeniler, raporlar, kategori, sürüm ve yayınlanma/güncelleme tarihini içeren ayrıntılı sayfalar.",
            "Erişimden önce zorunlu Şartlar ve Gizlilik izniyle Google'da oturum açın.",
            "Hesap sayfasında bir indirme kitaplığı, Web Push bildirimleri ve Telegram grubuna katılma düğmesi.",
            "Tam bir bildirim merkezi, özel bir çevrimdışı sayfa, manuel güncelleme kontrolü ve Kategorilerin yanında Yeni ve Güncellenmiş sekmesi.",
            "Yöneticiyle devam eden salt metin sohbeti için bağımsız bir /destek sayfası; bağlantılar yeni bir sekmede açılır, hiçbir resim veya sesli not gönderilmez ve uygulama içi bildirim yoktur.",
            "Dört dil, koyu/açık temalar ve altın sohbet tasarımı. Şu anda mağazada herhangi bir ödeme veya abonelik bulunmamaktadır."
          ]
        },
        {
          "title": "Destek ve iletişim",
          "paras": [
            "Sorularınız veya raporlarınız için mağazadaki <a class=\"legal-inline-link\" href=\"/support\">Destek sayfasını</a>, hesap sayfasındaki Telegram grup düğmesini veya yukarıdaki resmi web sitesini kullanın."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Gizlilik Politikası — Altın Mağaza",
      "h2": "Gizlilik Politikası",
      "kicker": "Yasal",
      "lead": "Bu politikada güncellenen mağazanın neleri topladığı, nasıl kullanıldığı ve nasıl silindiği açıklanmaktadır.",
      "updated": "Son güncelleme: 5 Kasım 2026 — gözden geçirilmiş baskı",
      "tocTitle": "Bu sayfada",
      "note": "Bu maddeler mağazanın mevcut özelliklerini yansıtacak şekilde revize edilmiştir. Son ifadeler avukat tarafından gözden geçirilmelidir.",
      "toc": [
        "giriiş",
        "Topladığımız veriler",
        "Çerezler ve yerel depolama",
        "Firebase Kimlik Doğrulaması ve izni",
        "Bildirimler",
        "Destek sohbeti",
        "Gelecekteki reklamcılık",
        "Paylaşma ve silme",
        "Bu politikadaki değişiklikler",
        "İsteğe bağlı demografik veriler"
      ],
      "sections": [
        {
          "title": "giriiş",
          "paras": [
            "Bu politika, mağazaya göz attığınızda, oturum açtığınızda, bir uygulamayı derecelendirdiğinizde veya mesaj desteği verdiğinizde Golden Store'un verileri nasıl topladığını, kullandığını ve koruduğunu açıklar. Mağazayı kullanarak bu politikayı ve <a class=\"legal-inline-link\" href=\"/terms\">Hizmet Şartları</a>'nı kabul etmiş olursunuz.",
            "Maddeler mevcut özellikler için güncellendi: zorunlu yasal izin, arama, derecelendirmeler ve incelemeler ve ses veya görüntü eklentisi olmayan yalnızca metinden oluşan destek sohbeti."
          ]
        },
        {
          "title": "Topladığımız veriler",
          "paras": [
            "Hizmeti çalıştırmak için gereken minimum tutarı topluyoruz:"
          ],
          "items": [
            "Google hesabı verileri: görünen ad, e-posta, profil resmi ve kullanıcı kimliği (UID).",
            "Gizlemeyi seçtiğiniz derecelendirmeler, incelemeler, beğeniler, raporlar ve incelemeler.",
            "Destek sohbet mesajlarının metni ve zaman damgaları; artık sohbette resim veya ses kayıtlarını kabul etmiyoruz.",
            "İzin verirseniz geçmişi, yerel tercihleri, temayı, dili ve Web Push/FCM cihaz belirteçlerini indirin.",
            "Geçerli Şartlar ve Gizlilik sürümüne verdiğiniz onayı gösteren bir kayıt."
          ]
        },
        {
          "title": "Çerezler ve yerel depolama",
          "paras": [
            "Mağaza, dil, tema, indirme geçmişi ve sohbet taslakları için localStorage/sessionStorage'ın yanı sıra gerektiğinde yasal onay alınması ve kimlik doğrulama oturumları için güvenli bir çerez kullanır. Şu anda üçüncü taraf reklam izleme çerezlerini kullanmıyoruz."
          ]
        },
        {
          "title": "Firebase Kimlik Doğrulaması ve izni",
          "paras": [
            "Kimlik doğrulama, Firebase Kimlik Doğrulamasını bir Google hesabıyla kullanır; şifrenizi asla saklamayız veya görmeyiz. Oturum açmadan önce zorunlu Şartlar ve Gizlilik onay kutusunu işaretlemeniz gerekir ve mevcut sürüme ilişkin bir makbuz /api/legal/consent aracılığıyla kaydedilir."
          ]
        },
        {
          "title": "Bildirimler",
          "paras": [
            "İzin verirseniz, yeni uygulamalar ve güncellemeler hakkında Web Push bildirimleri göndermek için bir cihaz belirteci saklarız. Destek sohbeti uygulama içi bildirimleri tetiklemez; mesajlar yalnızca sayfa açıkken yoklama yapılarak yenilenir. Bildirimleri tarayıcınızdan veya cihaz ayarlarınızdan devre dışı bırakabilirsiniz."
          ]
        },
        {
          "title": "Destek sohbeti",
          "paras": [
            "/support sayfası, yöneticiyle devam eden bir metin görüşmesini açar. Yalnızca metin saklanır; yönetici konuyu ve mesajlarını okuyabilir, yanıtlayabilir veya kalıcı olarak silebilir. Yazdığınız bağlantılar yeni bir sekmede açılan güvenli bağlantılara dönüşür. Hiçbir resim veya ses dosyası yüklenmez ve ek blob'lar artık depolanmaz."
          ]
        },
        {
          "title": "Gelecekteki reklamcılık",
          "paras": [
            "Daha sonra mağazayı desteklemek için reklam veya analiz hizmetleri ekleyebiliriz; öyleyse bu politikayı güncelleyeceğiz, ilgili verileri açıklayacağız ve gerektiğinde izin talep edeceğiz. Şu anda hedefli reklam göstermiyoruz ve mağazanın ödemesi veya aboneliği yok."
          ]
        },
        {
          "title": "Paylaşma ve silme",
          "paras": [
            "Verilerinizi satmıyoruz. Hizmeti çalıştırmak için gerektiğinde veya yasal olarak gerekli olduğunda, yalnızca kimlik doğrulama, barındırma, depolama ve bildirim sağlayıcılarıyla paylaşırız. Yöneticiler incelemeleri, raporları, destek konularını ve bunların mesajlarını kontrol panelinden kalıcı olarak silebilir ve siz de destek aracılığıyla hesap verilerinizin silinmesini veya düzeltilmesini talep edebilirsiniz."
          ]
        },
        {
          "title": "Bu politikadaki değişiklikler",
          "paras": [
            "Özellikler değiştiğinde bu politikayı güncelleyebiliriz; son güncelleme tarihi en üstte görünür ve oturum açmaya devam etmeden önce revize edilmiş bir sürüm için yeni onay talep edebiliriz."
          ]
        },
        {
          "title": "İsteğe bağlı demografik veriler",
          "paras": [
            "Açık rızanızla yaş grubu, cinsiyet ve ülke bilgilerinizi isteğe bağlı olarak anonim şekilde ve yalnızca toplu istatistik amacıyla paylaşabilirsiniz. Bu veriler hesabınıza hiçbir zaman bağlanmaz; adınızı, e-postanızı veya doğum tarihinizi toplamayız. Onayınızı istediğiniz zaman hesap sayfanızdan geri çekebilir veya verileri silebilirsiniz. Bu seçenek panelden etkinleştirilmediyse hiçbir şey toplanmaz."
          ]
        }
      ]
    },
    "terms": {
      "title": "Hizmet Şartları — Altın Mağaza",
      "h2": "Hizmet Şartları",
      "kicker": "Yasal",
      "lead": "Golden Store'un güncel özellikleriyle kullanım koşulları güncellendi.",
      "updated": "Son güncelleme: 5 Kasım 2026 — gözden geçirilmiş baskı",
      "tocTitle": "Bu sayfada",
      "note": "Bu maddeler mağazanın mevcut özelliklerini yansıtacak şekilde revize edilmiştir. Son ifadeler avukat tarafından gözden geçirilmelidir.",
      "toc": [
        "Şartların kabulü",
        "Hizmetin kullanımı",
        "Hesaplar ve izin",
        "APK dosyaları ve indirilenler",
        "Fikri mülkiyet",
        "Reklam ve dış bağlantılar",
        "Sorumluluk reddi beyanı",
        "Fesih ve değişiklikler",
        "Geçerli yasa ve iletişim"
      ],
      "sections": [
        {
          "title": "Şartların kabulü",
          "paras": [
            "Golden Store'u kullanarak veya oturum açarak, bu Şartları ve <a class=\"legal-inline-link\" href=\"/privacy\">Gizlilik Politikası</a>'nı okuyup kabul ettiğinizi onaylamış olursunuz. Zorunlu onay kutusu işaretlenene kadar oturum açma işlemi tamamlanamaz."
          ]
        },
        {
          "title": "Hizmetin kullanımı",
          "paras": [
            "Mağaza yalnızca kişisel ve yasal kullanım içindir. Hizmeti kurcalamayın, agresif bir şekilde kazımayın, erişim kontrollerini atlamayın, başkalarının kimliğine bürünmeyin veya derecelendirmelerde, incelemelerde, raporlarda veya destek mesajlarında kötü amaçlı veya yasa dışı içerik paylaşmayın. Yöneticiler, ihlalde bulunan içeriği gizleyebilir veya kaldırabilir."
          ]
        },
        {
          "title": "Hesaplar ve izin",
          "paras": [
            "Hesaplar Google aracılığıyla oluşturulur ve bir UID ile tanımlanır. Cihazınızdan, hesap güvenliğinizden ve doğru verilerden siz sorumlusunuz. Mevcut Şartlar ve Gizlilik sürümüne ilişkin onay, erişimden önce kaydedilir ve yöneticiler, ihlal eden hesapları askıya alabilir. Şu anda mağazada herhangi bir ödeme veya abonelik bulunmamaktadır."
          ]
        },
        {
          "title": "APK dosyaları ve indirilenler",
          "paras": [
            "Bazı uygulamaları yüklemek \"bilinmeyen kaynaklardan yükleme\" seçeneğinin etkinleştirilmesini gerektirebilir. Bunu kendi sorumluluğunuzda yaparsınız; Yüklemeden önce dosya kaynağını ve istenen izinleri kontrol edin. Mağaza adı, geliştiriciyi, kategoriyi, sürümü, boyutu ve yayınlanma/güncelleme tarihini gösterir ancak bir dosyanın cihazınızda çalıştığını veya hatasız olduğunu garanti etmez."
          ]
        },
        {
          "title": "Fikri mülkiyet",
          "paras": [
            "Ticari markalar, isimler, logolar ve uygulama hakları sahiplerine aittir. Mağaza, içeriği keşif ve erişim için görüntüler ve üçüncü taraf uygulamalarının sahipliğini iddia etmez. Hak itirazlarında ilgili içeriğin kaldırılması için bizimle iletişime geçin."
          ]
        },
        {
          "title": "Reklam ve dış bağlantılar",
          "paras": [
            "Daha sonra reklam veya dış bağlantılar eklenebilir; içeriklerinden veya uygulamalarından sorumlu değiliz. Destek mesajlarındaki bağlantılar, güvenlik özelliklerine sahip yeni bir sekmede açılır ve harici siteler kendi şartlarına tabidir. Hesap sayfasındaki Telegram grubu düğmesi de harici bir bağlantıdır."
          ]
        },
        {
          "title": "Sorumluluk reddi beyanı",
          "paras": [
            "Hizmet, açık veya zımni garantiler olmaksızın \"olduğu gibi\" sağlanır. Destek sohbeti yalnızca metinden oluşur, resim veya sesli not içermez ve uygulama içi bildirim oluşturmaz. Yasaların izin verdiği ölçüde, mağazanın kullanılmasından veya herhangi bir dosyanın yüklenmesinden kaynaklanan dolaylı zararlardan veya veri kayıplarından sorumlu değiliz."
          ]
        },
        {
          "title": "Fesih ve değişiklikler",
          "paras": [
            "Yöneticiler, son güncelleme tarihi gösterilen şekilde incelemeleri, raporları, destek konularını ve mesajlarını kalıcı olarak silebilir, bir destek görüşmesini kapatabilir, bu Koşulları değiştirebilir veya hizmetin bir bölümünü sonlandırabilir. Önemli bir değişiklikten sonra yeni onay talep edebiliriz."
          ]
        },
        {
          "title": "Geçerli yasa ve iletişim",
          "paras": [
            "Bu Şartlar, kullanıcının ülkesinde geçerli yasalara tabidir ve anlaşmazlıkları öncelikle <a class=\"legal-inline-link\" href=\"/support\">Destek sayfası</a> veya <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a> aracılığıyla dostane bir şekilde çözmeye çalışırız."
          ]
        }
      ]
    }
  },
  "de":   {
    "about": {
      "title": "Über uns – Golden Store",
      "h2": "Über uns",
      "kicker": "Legal",
      "lead": "Ein unabhängiger arabischer Store für Apps und Spiele, mit übersichtlicher Oberfläche und zehn Sprachen.",
      "updated": "Letzte Aktualisierung: 5. November 2026 – überarbeitete Ausgabe",
      "tocTitle": "Auf dieser Seite",
      "note": "Diese Klauseln wurden überarbeitet, um die aktuellen Funktionen des Shops widerzuspiegeln: Google-Anmeldung, obligatorische Einwilligung, Bewertungen und Rezensionen, Sofortsuche, Nur-Text-Support-Chat, anklickbare Links und Webbenachrichtigungen. Der endgültige Wortlaut sollte vom Anwalt überprüft werden.",
      "toc": [
        "Über uns",
        "Offizielle Website",
        "Unsere Mission",
        "Aktuelle Funktionen",
        "Support & Kontakt"
      ],
      "sections": [
        {
          "title": "Über uns",
          "paras": [
            "Golden Store ist ein unabhängiger arabischer Store für Android-Apps und -Spiele. Es präsentiert APK-Dateien mit klaren Metadaten und unterstützt Arabisch, Englisch, Französisch und Spanisch mit dunklen und hellen Themen.",
            "Der Store wurde mit Bewertungen, Rezensionen, Likes und Berichten, Sofortsuche, umfangreichen Detailseiten mit Screenshots, einer eigenständigen Support-Seite und einer obligatorischen rechtlichen Zustimmung vor der Anmeldung aktualisiert."
          ]
        },
        {
          "title": "Offizielle Website",
          "paras": [
            "Die offizielle Website ist die einzige Referenz für den aktuellen Shop und seine Richtlinien:",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Unsere Mission",
          "paras": [
            "Um ein einfaches und sicheres Download-Erlebnis zu bieten: Jede App zeigt ihren Namen, Entwickler, Kategorie, Version, Größe, Bewertungen und Screenshots sowie je nach Status ihr Veröffentlichungsdatum oder letztes Update an – ohne unnötige Schritte."
          ]
        },
        {
          "title": "Aktuelle Funktionen",
          "paras": [
            "Der Shop umfasst jetzt:"
          ],
          "items": [
            "Durchsuchen von Apps und Spielen nach Kategorie und sofortige Suche ohne Neuladen.",
            "Detailseiten mit Screenshots, Bewertungen, Rezensionen, Likes, Berichten, Kategorie, Version und Veröffentlichungs-/Aktualisierungsdatum.",
            "Vor dem Zugriff müssen Sie sich bei Google mit den obligatorischen Nutzungsbedingungen und der Datenschutzeinwilligung anmelden.",
            "Eine Download-Bibliothek, Web-Push-Benachrichtigungen und eine Schaltfläche zum Beitreten zur Telegram-Gruppe auf der Kontoseite.",
            "Ein vollständiges Benachrichtigungscenter, eine spezielle Offline-Seite, eine manuelle Aktualisierungsprüfung und eine Registerkarte „Neu und Aktualisiert“ neben den Kategorien.",
            "Eine eigenständige /Support-Seite für einen laufenden Nur-Text-Chat mit dem Administrator; Links werden in einem neuen Tab geöffnet, es werden keine Bilder oder Sprachnotizen gesendet und es gibt keine In-App-Benachrichtigungen.",
            "Vier Sprachen, dunkle/helle Themen und ein goldenes Chat-Design. Derzeit sind im Store keine Zahlungen oder Abonnements möglich."
          ]
        },
        {
          "title": "Support & Kontakt",
          "paras": [
            "Für Fragen oder Berichte nutzen Sie die <a class=\"legal-inline-link\" href=\"/support\">Support-Seite</a> im Store, die Telegram-Gruppenschaltfläche auf der Kontoseite oder die offizielle Website oben."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Datenschutzrichtlinie – Golden Store",
      "h2": "Datenschutzrichtlinie",
      "kicker": "Legal",
      "lead": "In dieser Richtlinie wird erläutert, was der aktualisierte Store sammelt, wie er verwendet und wie er gelöscht wird.",
      "updated": "Letzte Aktualisierung: 5. November 2026 – überarbeitete Ausgabe",
      "tocTitle": "Auf dieser Seite",
      "note": "Diese Klauseln wurden überarbeitet, um den aktuellen Funktionen des Shops Rechnung zu tragen. Der endgültige Wortlaut sollte vom Anwalt überprüft werden.",
      "toc": [
        "Einführung",
        "Daten, die wir sammeln",
        "Cookies und lokale Speicherung",
        "Firebase-Authentifizierung und Einwilligung",
        "Benachrichtigungen",
        "Support-Chat",
        "Zukünftige Werbung",
        "Teilen und Löschen",
        "Änderungen an dieser Richtlinie",
        "Optionale demografische Daten"
      ],
      "sections": [
        {
          "title": "Einführung",
          "paras": [
            "In dieser Richtlinie wird erläutert, wie Golden Store Daten erhebt, verwendet und schützt, wenn Sie im Store stöbern, sich anmelden, eine App bewerten oder dem Support eine Nachricht senden. Durch die Nutzung des Shops stimmen Sie dieser Richtlinie und den <a class=\"legal-inline-link\" href=\"/terms\">Nutzungsbedingungen</a> zu.",
            "Die Klauseln wurden für die aktuellen Funktionen aktualisiert: obligatorische rechtliche Einwilligung, Suche, Bewertungen und Rezensionen sowie ein Nur-Text-Support-Chat ohne Sprach- oder Bildanhänge."
          ]
        },
        {
          "title": "Daten, die wir sammeln",
          "paras": [
            "Wir erheben das zum Betrieb des Dienstes erforderliche Minimum:"
          ],
          "items": [
            "Google-Kontodaten: Anzeigename, E-Mail, Profilbild und Benutzer-ID (UID).",
            "Bewertungen, Rezensionen, Likes, Berichte und Rezensionen, die Sie ausblenden möchten.",
            "Text von Support-Chat-Nachrichten und deren Zeitstempel; Wir akzeptieren keine Bilder oder Sprachaufzeichnungen mehr im Chat.",
            "Laden Sie Verlauf, lokale Einstellungen, Design, Sprache und Web Push/FCM-Geräte-Tokens herunter, wenn Sie die Erlaubnis erteilen.",
            "Eine Aufzeichnung Ihrer Zustimmung zu den aktuellen Nutzungsbedingungen und der Datenschutzversion."
          ]
        },
        {
          "title": "Cookies und lokale Speicherung",
          "paras": [
            "Der Store verwendet localStorage/sessionStorage für Sprache, Design, Download-Verlauf und Chat-Entwürfe sowie bei Bedarf ein sicheres Cookie für den Empfang rechtlicher Einwilligungen und Authentifizierungssitzungen. Wir verwenden derzeit keine Werbe-Tracking-Cookies von Drittanbietern."
          ]
        },
        {
          "title": "Firebase-Authentifizierung und Einwilligung",
          "paras": [
            "Die Authentifizierung erfolgt über die Firebase-Authentifizierung mit einem Google-Konto. Wir speichern oder sehen Ihr Passwort niemals. Bevor Sie sich anmelden, müssen Sie das obligatorische Kästchen „Zustimmung zu Nutzungsbedingungen und Datenschutz“ ankreuzen. Eine Quittung für die aktuelle Version wird über /api/legal/consent erfasst."
          ]
        },
        {
          "title": "Benachrichtigungen",
          "paras": [
            "Wenn Sie die Erlaubnis erteilen, speichern wir ein Geräte-Token, um Web-Push-Benachrichtigungen über neue Apps und Updates zu senden. Der Support-Chat löst keine In-App-Benachrichtigungen aus. Nachrichten werden durch Abfragen nur aktualisiert, während die Seite geöffnet ist. Sie können Benachrichtigungen in Ihren Browser- oder Geräteeinstellungen deaktivieren."
          ]
        },
        {
          "title": "Support-Chat",
          "paras": [
            "Die Seite /support öffnet eine laufende Textkonversation mit dem Administrator. Es wird nur Text gespeichert; Der Administrator kann den Thread und seine Nachrichten lesen, beantworten oder dauerhaft löschen. Von Ihnen eingegebene Links werden zu sicheren Links, die in einem neuen Tab geöffnet werden. Es werden keine Bilder oder Audiodateien hochgeladen und Anhang-Blobs werden nicht mehr gespeichert."
          ]
        },
        {
          "title": "Zukünftige Werbung",
          "paras": [
            "Wir können später Werbe- oder Analysedienste hinzufügen, um den Shop zu unterstützen; Wenn ja, werden wir diese Richtlinie aktualisieren, die betroffenen Daten erläutern und bei Bedarf um Zustimmung bitten. Wir zeigen derzeit keine gezielten Anzeigen an und der Shop verfügt über keine Zahlungen oder Abonnements."
          ]
        },
        {
          "title": "Teilen und Löschen",
          "paras": [
            "Wir verkaufen Ihre Daten nicht. Wir geben sie nur dann an Authentifizierungs-, Hosting-, Speicher- und Benachrichtigungsanbieter weiter, wenn dies für die Ausführung des Dienstes erforderlich ist oder wenn dies gesetzlich vorgeschrieben ist. Administratoren können Bewertungen, Berichte, Support-Threads und deren Nachrichten dauerhaft aus dem Dashboard löschen und Sie können beim Support die Löschung oder Korrektur Ihrer Kontodaten anfordern."
          ]
        },
        {
          "title": "Änderungen an dieser Richtlinie",
          "paras": [
            "Wir können diese Richtlinie aktualisieren, wenn sich Funktionen ändern; Das Datum der letzten Aktualisierung wird oben angezeigt. Möglicherweise fordern wir eine erneute Zustimmung zu einer überarbeiteten Version an, bevor Sie sich weiter anmelden."
          ]
        },
        {
          "title": "Optionale demografische Daten",
          "paras": [
            "Sie können freiwillig eine Altersgruppe, ein Geschlecht und ein Land anonym und mit ausdrücklicher Einwilligung ausschließlich für aggregierte Statistiken teilen. Diese Daten werden niemals mit Ihrem Konto verknüpft, und wir erheben weder Ihren Namen noch Ihre E-Mail-Adresse oder Ihr Geburtsdatum. Sie können Ihre Einwilligung jederzeit über Ihre Kontoseite widerrufen oder die Daten löschen. Ist diese Option im Dashboard nicht aktiviert, werden keine Daten erhoben."
          ]
        }
      ]
    },
    "terms": {
      "title": "Nutzungsbedingungen – Golden Store",
      "h2": "Nutzungsbedingungen",
      "kicker": "Legal",
      "lead": "Aktualisierte Bedingungen für die Nutzung des Golden Store mit seinen aktuellen Funktionen.",
      "updated": "Letzte Aktualisierung: 5. November 2026 – überarbeitete Ausgabe",
      "tocTitle": "Auf dieser Seite",
      "note": "Diese Klauseln wurden überarbeitet, um den aktuellen Funktionen des Shops Rechnung zu tragen. Der endgültige Wortlaut sollte vom Anwalt überprüft werden.",
      "toc": [
        "Akzeptanz der Bedingungen",
        "Nutzung des Dienstes",
        "Konten und Einwilligung",
        "APK-Dateien und Downloads",
        "Geistiges Eigentum",
        "Werbung und externe Links",
        "Haftungsausschluss",
        "Kündigung & Änderungen",
        "Anwendbares Recht & Kontakt"
      ],
      "sections": [
        {
          "title": "Akzeptanz der Bedingungen",
          "paras": [
            "Indem Sie Golden Store nutzen oder sich anmelden, bestätigen Sie, dass Sie diese Bedingungen und die <a class=\"legal-inline-link\" href=\"/privacy\">Datenschutzerklärung</a> gelesen haben und ihnen zustimmen. Die Anmeldung kann erst abgeschlossen werden, wenn das Kontrollkästchen für die obligatorische Zustimmung aktiviert ist."
          ]
        },
        {
          "title": "Nutzung des Dienstes",
          "paras": [
            "Der Shop ist nur für den persönlichen, rechtmäßigen Gebrauch bestimmt. Manipulieren Sie den Dienst nicht, kratzen Sie ihn nicht aggressiv, umgehen Sie keine Zugriffskontrollen, geben Sie sich nicht als andere aus und veröffentlichen Sie keine missbräuchlichen oder illegalen Inhalte in Bewertungen, Rezensionen, Berichten oder Supportnachrichten. Administratoren können verletzende Inhalte ausblenden oder entfernen."
          ]
        },
        {
          "title": "Konten und Einwilligung",
          "paras": [
            "Konten werden über Google erstellt und durch eine UID identifiziert. Sie sind für die Sicherheit Ihres Geräts, Ihres Kontos und korrekte Daten verantwortlich. Die Zustimmung zu den aktuellen Nutzungsbedingungen und der Datenschutzversion wird vor dem Zugriff aufgezeichnet und Administratoren können Konten sperren, die gegen sie verstoßen. Derzeit sind im Store keine Zahlungen oder Abonnements möglich."
          ]
        },
        {
          "title": "APK-Dateien und Downloads",
          "paras": [
            "Für die Installation einiger Apps kann es erforderlich sein, die Option „Aus unbekannten Quellen installieren“ zu aktivieren. Sie tun dies auf eigene Verantwortung; Überprüfen Sie vor der Installation die Dateiquelle und die angeforderten Berechtigungen. Der Store zeigt Name, Entwickler, Kategorie, Version, Größe und Veröffentlichungs-/Aktualisierungsdatum an, garantiert jedoch nicht, dass eine Datei auf Ihrem Gerät funktioniert oder fehlerfrei ist."
          ]
        },
        {
          "title": "Geistiges Eigentum",
          "paras": [
            "Marken, Namen, Logos und App-Rechte gehören ihren Eigentümern. Der Store zeigt Inhalte zur Entdeckung und zum Zugriff an und erhebt keinen Anspruch auf das Eigentum an Apps von Drittanbietern. Bei Einwänden gegen Rechte wenden Sie sich bitte an uns, um den entsprechenden Inhalt zu entfernen."
          ]
        },
        {
          "title": "Werbung und externe Links",
          "paras": [
            "Werbung oder externe Links können später hinzugefügt werden; Wir sind nicht für deren Inhalt oder Praktiken verantwortlich. Links in Supportnachrichten werden in einem neuen Tab mit Sicherheitsattributen geöffnet und für externe Websites gelten ihre eigenen Bedingungen. Der Telegram-Gruppen-Button auf der Kontoseite ist ebenfalls ein externer Link."
          ]
        },
        {
          "title": "Haftungsausschluss",
          "paras": [
            "Der Service wird „wie besehen“ ohne ausdrückliche oder stillschweigende Garantien bereitgestellt. Der Support-Chat besteht nur aus Text, ohne Bilder oder Sprachnotizen und erzeugt keine In-App-Benachrichtigungen. Wir haften nicht für indirekte Schäden oder Datenverluste, die durch die Nutzung des Shops oder die Installation von Dateien entstehen, soweit gesetzlich zulässig."
          ]
        },
        {
          "title": "Kündigung & Änderungen",
          "paras": [
            "Administratoren können Bewertungen, Berichte, Support-Threads und deren Nachrichten dauerhaft löschen, ein Support-Gespräch schließen, diese Bedingungen ändern oder einen Teil des Dienstes einstellen, wobei das Datum der letzten Aktualisierung angezeigt wird. Nach einer wesentlichen Änderung können wir eine erneute Einwilligung anfordern."
          ]
        },
        {
          "title": "Anwendbares Recht & Kontakt",
          "paras": [
            "Diese Bedingungen unterliegen den im Land des Benutzers geltenden Gesetzen und wir versuchen zunächst, Streitigkeiten gütlich über die <a class=\"legal-inline-link\" href=\"/support\">Support-Seite</a> oder über <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a> beizulegen."
          ]
        }
      ]
    }
  },
  "pt":   {
    "about": {
      "title": "Sobre nós - Loja Dourada",
      "h2": "Sobre nós",
      "kicker": "Jurídico",
      "lead": "Uma loja árabe independente de apps e jogos, com interface clara e dez idiomas.",
      "updated": "Última atualização: 5 de novembro de 2026 — edição revisada",
      "tocTitle": "Nesta página",
      "note": "Essas cláusulas foram revisadas para refletir os recursos atuais da loja: login do Google, consentimento obrigatório, classificações e comentários, pesquisa instantânea, chat de suporte somente texto, links clicáveis ​​e notificações da web. A redação final deverá ser revisada pelo advogado.",
      "toc": [
        "Sobre nós",
        "Site oficial",
        "Nossa missão",
        "Recursos atuais",
        "Suporte e contato"
      ],
      "sections": [
        {
          "title": "Sobre nós",
          "paras": [
            "Golden Store é uma loja árabe independente para aplicativos e jogos Android. Apresenta arquivos APK com metadados claros e suporta árabe, inglês, francês e espanhol, com temas claros e escuros.",
            "A loja foi atualizada com classificações, comentários, curtidas e relatórios, pesquisa instantânea, páginas detalhadas com capturas de tela, uma página de suporte independente e consentimento legal obrigatório antes do login."
          ]
        },
        {
          "title": "Site oficial",
          "paras": [
            "O site oficial é a única referência da loja atual e suas políticas:",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Nossa missão",
          "paras": [
            "Para fornecer uma experiência de download simples e segura: cada aplicativo mostra seu nome, desenvolvedor, categoria, versão, tamanho, classificações e capturas de tela, além de sua data de publicação ou última atualização dependendo do status — sem etapas desnecessárias."
          ]
        },
        {
          "title": "Recursos atuais",
          "paras": [
            "A loja agora inclui:"
          ],
          "items": [
            "Navegando em aplicativos e jogos por categoria e pesquisa instantânea sem recarga.",
            "Páginas de detalhes com capturas de tela, classificações, comentários, curtidas, relatórios, categoria, versão e data de publicação/atualização.",
            "Faça login no Google com termos obrigatórios e consentimento de privacidade antes do acesso.",
            "Uma biblioteca de download, notificações Web Push e um botão de ingresso em grupo do Telegram na página da conta.",
            "Uma central de notificações completa, uma página offline dedicada, uma verificação manual de atualizações e uma guia Novo e Atualizado ao lado de Categorias.",
            "Uma página autônoma/de suporte para um bate-papo contínuo somente de texto com o administrador; os links são abertos em uma nova guia, nenhuma imagem ou nota de voz é enviada e não há notificações no aplicativo.",
            "Quatro idiomas, temas claros/escuros e um design de bate-papo dourado. Atualmente não há pagamentos ou assinaturas na loja."
          ]
        },
        {
          "title": "Suporte e contato",
          "paras": [
            "Para dúvidas ou denúncias use a <a class=\"legal-inline-link\" href=\"/support\">página de suporte</a> dentro da loja, o botão do grupo Telegram na página da conta ou o site oficial acima."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Política de Privacidade — Loja Dourada",
      "h2": "política de Privacidade",
      "kicker": "Jurídico",
      "lead": "Esta política explica o que a loja atualizada coleta, como é usada e como é excluída.",
      "updated": "Última atualização: 5 de novembro de 2026 — edição revisada",
      "tocTitle": "Nesta página",
      "note": "Estas cláusulas foram revisadas para refletir as características atuais da loja. A redação final deverá ser revisada pelo advogado.",
      "toc": [
        "Introdução",
        "Dados que coletamos",
        "Cookies e armazenamento local",
        "Autenticação e consentimento do Firebase",
        "Notificações",
        "Bate-papo de suporte",
        "Publicidade futura",
        "Compartilhamento e exclusão",
        "Alterações nesta política",
        "Dados demográficos opcionais"
      ],
      "sections": [
        {
          "title": "Introdução",
          "paras": [
            "Esta política explica como a Golden Store coleta, usa e protege dados quando você navega na loja, faz login, avalia um aplicativo ou envia uma mensagem ao suporte. Ao usar a loja, você concorda com esta política e com os <a class=\"legal-inline-link\" href=\"/terms\">Termos de Serviço</a>.",
            "As cláusulas foram atualizadas para os recursos atuais: consentimento legal obrigatório, pesquisa, classificações e avaliações, e chat de suporte somente em texto, sem anexos de voz ou imagem."
          ]
        },
        {
          "title": "Dados que coletamos",
          "paras": [
            "Coletamos o mínimo necessário para executar o serviço:"
          ],
          "items": [
            "Dados da conta do Google: nome de exibição, e-mail, foto do perfil e ID do usuário (UID).",
            "Avaliações, comentários, curtidas, relatórios e comentários que você escolhe ocultar.",
            "Texto das mensagens do chat de suporte e seus carimbos de data/hora; não aceitamos mais imagens ou gravações de voz no chat.",
            "Baixe histórico, preferências locais, tema, idioma e tokens de dispositivo Web Push/FCM se você conceder permissão.",
            "Um registro do seu consentimento com a versão atual dos Termos e Privacidade."
          ]
        },
        {
          "title": "Cookies e armazenamento local",
          "paras": [
            "A loja usa localStorage/sessionStorage para idioma, tema, histórico de downloads e rascunhos de bate-papo, além de um cookie seguro para recebimento de consentimento legal e sessões de autenticação quando necessário. Atualmente, não utilizamos cookies de rastreamento de publicidade de terceiros."
          ]
        },
        {
          "title": "Autenticação e consentimento do Firebase",
          "paras": [
            "O Authentication usa o Firebase Authentication com uma conta do Google; nunca armazenamos ou vemos sua senha. Antes de fazer login, você deve marcar a caixa obrigatória de consentimento de Termos e Privacidade, e um recibo da versão atual é registrado em /api/legal/consent."
          ]
        },
        {
          "title": "Notificações",
          "paras": [
            "Se você conceder permissão, armazenaremos um token de dispositivo para enviar notificações Web Push sobre novos aplicativos e atualizações. O bate-papo de suporte não aciona notificações no aplicativo; as mensagens são atualizadas por pesquisa apenas enquanto a página está aberta. Você pode desativar as notificações nas configurações do seu navegador ou dispositivo."
          ]
        },
        {
          "title": "Bate-papo de suporte",
          "paras": [
            "A página /support abre uma conversa de texto contínua com o administrador. Somente texto é armazenado; o administrador pode ler, responder ou excluir permanentemente o tópico e suas mensagens. Os links que você digita tornam-se links seguros que abrem em uma nova guia. Nenhuma imagem ou arquivo de áudio é carregado e os blobs de anexos não são mais armazenados."
          ]
        },
        {
          "title": "Publicidade futura",
          "paras": [
            "Posteriormente, poderemos adicionar serviços de publicidade ou análise para apoiar a loja; nesse caso, atualizaremos esta política, explicaremos os dados envolvidos e solicitaremos consentimento quando necessário. Atualmente não exibimos anúncios direcionados e a loja não possui pagamentos ou assinaturas."
          ]
        },
        {
          "title": "Compartilhamento e exclusão",
          "paras": [
            "Não vendemos seus dados. Nós o compartilhamos apenas com provedores de autenticação, hospedagem, armazenamento e notificação conforme necessário para executar o serviço ou quando exigido por lei. Os administradores podem excluir permanentemente avaliações, relatórios, tópicos de suporte e suas mensagens do painel, e você pode solicitar a exclusão ou correção dos dados da sua conta por meio do suporte."
          ]
        },
        {
          "title": "Alterações nesta política",
          "paras": [
            "Poderemos atualizar esta política quando os recursos mudarem; a data da última atualização aparece na parte superior e poderemos solicitar novo consentimento para uma versão revisada antes de você continuar fazendo login."
          ]
        },
        {
          "title": "Dados demográficos opcionais",
          "paras": [
            "Você pode compartilhar opcionalmente uma faixa etária, gênero e país de forma anônima e com consentimento explícito, apenas para estatísticas agregadas. Esses dados nunca são vinculados à sua conta, e não coletamos seu nome, e-mail ou data de nascimento. Você pode retirar o consentimento ou excluir os dados a qualquer momento na página da sua conta. Se esta opção não estiver ativada no painel, nada será coletado."
          ]
        }
      ]
    },
    "terms": {
      "title": "Termos de Serviço — Loja Dourada",
      "h2": "Termos de Serviço",
      "kicker": "Jurídico",
      "lead": "Termos atualizados para usar a Golden Store com seus recursos atuais.",
      "updated": "Última atualização: 5 de novembro de 2026 — edição revisada",
      "tocTitle": "Nesta página",
      "note": "Estas cláusulas foram revisadas para refletir as características atuais da loja. A redação final deverá ser revisada pelo advogado.",
      "toc": [
        "Aceitação dos termos",
        "Uso do serviço",
        "Contas e consentimento",
        "Arquivos APK e downloads",
        "Propriedade intelectual",
        "Publicidade e links externos",
        "Isenção de responsabilidade",
        "Rescisão e alterações",
        "Lei aplicável e contato"
      ],
      "sections": [
        {
          "title": "Aceitação dos termos",
          "paras": [
            "Ao usar a Golden Store ou fazer login, você confirma que leu e concorda com estes Termos e com a <a class=\"legal-inline-link\" href=\"/privacy\">Política de Privacidade</a>. O login não pode ser concluído até que a caixa de consentimento obrigatório seja marcada."
          ]
        },
        {
          "title": "Uso do serviço",
          "paras": [
            "A loja é apenas para uso pessoal e legal. Não altere o serviço, não o raspe de forma agressiva, ignore os controles de acesso, faça-se passar por outra pessoa ou publique conteúdo abusivo ou ilegal em classificações, análises, relatórios ou mensagens de suporte. Os administradores podem ocultar ou remover conteúdo violador."
          ]
        },
        {
          "title": "Contas e consentimento",
          "paras": [
            "As contas são criadas pelo Google e identificadas por um UID. Você é responsável pelo seu dispositivo, segurança da conta e dados precisos. O consentimento com a versão atual dos Termos e Privacidade é registrado antes do acesso, e os administradores podem suspender as contas violadoras. Atualmente não há pagamentos ou assinaturas na loja."
          ]
        },
        {
          "title": "Arquivos APK e downloads",
          "paras": [
            "A instalação de alguns aplicativos pode exigir a ativação de “instalar de fontes desconhecidas”. Você faz isso sob sua própria responsabilidade; verifique a origem do arquivo e as permissões solicitadas antes de instalar. A loja mostra nome, desenvolvedor, categoria, versão, tamanho e data de publicação/atualização, mas não garante que um arquivo funcione em seu dispositivo ou esteja livre de erros."
          ]
        },
        {
          "title": "Propriedade intelectual",
          "paras": [
            "Marcas registradas, nomes, logotipos e direitos de aplicativos pertencem aos seus proprietários. A loja exibe conteúdo para descoberta e acesso e não reivindica propriedade de aplicativos de terceiros. Para objeções de direitos, entre em contato conosco para remover o conteúdo relevante."
          ]
        },
        {
          "title": "Publicidade e links externos",
          "paras": [
            "Publicidade ou links externos poderão ser adicionados posteriormente; não somos responsáveis ​​por seu conteúdo ou práticas. Os links nas mensagens de suporte abrem em uma nova aba com atributos de segurança, e os sites externos são regidos por seus próprios termos. O botão do grupo Telegram na página da conta também é um link externo."
          ]
        },
        {
          "title": "Isenção de responsabilidade",
          "paras": [
            "O serviço é fornecido “como está”, sem garantias expressas ou implícitas. O bate-papo de suporte é somente texto, sem imagens ou notas de voz e não produz notificações no aplicativo. Não nos responsabilizamos por danos indiretos ou perda de dados decorrentes do uso da loja ou da instalação de qualquer arquivo, na medida permitida por lei."
          ]
        },
        {
          "title": "Rescisão e alterações",
          "paras": [
            "Os administradores podem excluir permanentemente avaliações, relatórios, tópicos de suporte e suas mensagens, encerrar uma conversa de suporte, modificar estes Termos ou descontinuar parte do serviço, com a data da última atualização mostrada. Poderemos solicitar novo consentimento após uma alteração material."
          ]
        },
        {
          "title": "Lei aplicável e contato",
          "paras": [
            "Estes Termos são regidos pelas leis aplicáveis ​​no país do usuário, e primeiro procuramos resolver disputas amigavelmente por meio da <a class=\"legal-inline-link\" href=\"/support\">página de suporte</a> ou por meio de <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>."
          ]
        }
      ]
    }
  },
  "ru":   {
    "about": {
      "title": "О нас — Золотой Магазин",
      "h2": "О нас",
      "kicker": "Юридический",
      "lead": "Независимый магазин приложений и игр на арабском языке с понятным интерфейсом и десятью языками.",
      "updated": "Последнее обновление: 5 ноября 2026 г. — исправленное издание.",
      "tocTitle": "На этой странице",
      "note": "Эти положения были пересмотрены, чтобы отразить текущие функции магазина: вход в Google, обязательное согласие, рейтинги и обзоры, мгновенный поиск, текстовый чат поддержки, кликабельные ссылки и веб-уведомления. Окончательная формулировка должна быть рассмотрена адвокатом.",
      "toc": [
        "О нас",
        "Официальный сайт",
        "Наша миссия",
        "Текущие возможности",
        "Поддержка и контакты"
      ],
      "sections": [
        {
          "title": "О нас",
          "paras": [
            "Golden Store — независимый арабский магазин приложений и игр для Android. Он представляет файлы APK с четкими метаданными и поддерживает арабский, английский, французский и испанский языки с темными и светлыми темами.",
            "В магазине появились рейтинги, обзоры, лайки и отчеты, мгновенный поиск, подробные страницы со скриншотами, отдельная страница поддержки и обязательное юридическое согласие перед входом в систему."
          ]
        },
        {
          "title": "Официальный сайт",
          "paras": [
            "Официальный сайт является единственной ссылкой на текущий магазин и его политику:",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "Наша миссия",
          "paras": [
            "Чтобы обеспечить простоту и безопасность загрузки: каждое приложение показывает свое имя, разработчика, категорию, версию, размер, рейтинги и снимки экрана, а также дату публикации или последнего обновления в зависимости от статуса — без лишних действий."
          ]
        },
        {
          "title": "Текущие возможности",
          "paras": [
            "Теперь в магазине есть:"
          ],
          "items": [
            "Просмотр приложений и игр по категориям и мгновенный поиск без перезагрузки.",
            "Подробные страницы со скриншотами, рейтингами, обзорами, лайками, отчетами, категориями, версией и датой публикации/обновления.",
            "Перед доступом войдите в систему Google с обязательным согласием на Условия использования и конфиденциальность.",
            "Библиотека загрузки, уведомления Web Push и кнопка присоединения к группе Telegram на странице учетной записи.",
            "Полноценный центр уведомлений, отдельная автономная страница, проверка обновлений вручную и вкладка «Новые и обновленные» рядом с разделом «Категории».",
            "Отдельная страница/страница поддержки для одного текущего текстового чата с администратором; ссылки открываются в новой вкладке, изображения и голосовые заметки не отправляются, а уведомления в приложении отсутствуют.",
            "Четыре языка, темные/светлые темы и золотой дизайн чата. На данный момент в магазине нет платежей и подписок."
          ]
        },
        {
          "title": "Поддержка и контакты",
          "paras": [
            "Для вопросов или сообщений используйте <a class=\"legal-inline-link\" href=\"/support\">страницу поддержки</a> в магазине, кнопку группы Telegram на странице учетной записи или официальный сайт выше."
          ]
        }
      ]
    },
    "privacy": {
      "title": "Политика конфиденциальности — Золотой Магазин",
      "h2": "политика конфиденциальности",
      "kicker": "Юридический",
      "lead": "Эта политика объясняет, что собирает обновленное хранилище, как оно используется и как оно удаляется.",
      "updated": "Последнее обновление: 5 ноября 2026 г. — исправленное издание.",
      "tocTitle": "На этой странице",
      "note": "Эти положения были пересмотрены с учетом текущих особенностей магазина. Окончательная формулировка должна быть рассмотрена адвокатом.",
      "toc": [
        "Введение",
        "Данные, которые мы собираем",
        "Файлы cookie и локальное хранилище",
        "Аутентификация и согласие Firebase",
        "Уведомления",
        "Чат поддержки",
        "Будущая реклама",
        "Публикация и удаление",
        "Изменения в этой политике",
        "Дополнительные демографические данные"
      ],
      "sections": [
        {
          "title": "Введение",
          "paras": [
            "Эта политика объясняет, как Golden Store собирает, использует и защищает данные, когда вы просматриваете магазин, входите в систему, оцениваете приложение или отправляете сообщения в службу поддержки. Используя магазин, вы соглашаетесь с этой политикой и <a class=\"legal-inline-link\" href=\"/terms\">Условиями использования</a>.",
            "Пункты были обновлены с учетом текущих функций: обязательное юридическое согласие, поиск, рейтинги и обзоры, а также текстовый чат поддержки без вложений голоса или изображений."
          ]
        },
        {
          "title": "Данные, которые мы собираем",
          "paras": [
            "Собираем минимум необходимый для запуска сервиса:"
          ],
          "items": [
            "Данные учетной записи Google: отображаемое имя, адрес электронной почты, изображение профиля и идентификатор пользователя (UID).",
            "Рейтинги, обзоры, лайки, отчеты и обзоры, которые вы решили скрыть.",
            "Текст сообщений чата поддержки и их временные метки; мы больше не принимаем изображения или записи голоса в чате.",
            "Загрузите историю, локальные настройки, тему, язык и токены устройств Web Push/FCM, если вы дадите разрешение.",
            "Запись о вашем согласии с текущей версией Условий и конфиденциальности."
          ]
        },
        {
          "title": "Файлы cookie и локальное хранилище",
          "paras": [
            "Магазин использует localStorage/sessionStorage для языка, темы, истории загрузок и черновиков чата, а также безопасный файл cookie для получения юридического согласия и сеансов аутентификации, когда это необходимо. В настоящее время мы не используем сторонние файлы cookie для отслеживания рекламы."
          ]
        },
        {
          "title": "Аутентификация и согласие Firebase",
          "paras": [
            "Аутентификация использует аутентификацию Firebase с учетной записью Google; мы никогда не храним и не видим ваш пароль. Перед входом в систему вы должны отметить обязательное поле «Условия и согласие на конфиденциальность», а получение текущей версии записывается через /api/legal/consent."
          ]
        },
        {
          "title": "Уведомления",
          "paras": [
            "Если вы дадите разрешение, мы сохраним токен устройства для отправки уведомлений Web Push о новых приложениях и обновлениях. Чат поддержки не вызывает уведомления в приложении; сообщения обновляются путем опроса только тогда, когда страница открыта. Вы можете отключить уведомления в настройках браузера или устройства."
          ]
        },
        {
          "title": "Чат поддержки",
          "paras": [
            "Страница /support открывает один текущий текстовый разговор с администратором. Сохраняется только текст; администратор может читать, отвечать на ветку и ее сообщения или безвозвратно удалять их. Вводимые вами ссылки становятся безопасными ссылками, которые открываются в новой вкладке. Никакие изображения или аудиофайлы не загружаются, а вложения больше не сохраняются."
          ]
        },
        {
          "title": "Будущая реклама",
          "paras": [
            "Позже мы можем добавить рекламные или аналитические услуги для поддержки магазина; в этом случае мы обновим эту политику, объясним используемые данные и при необходимости запросим согласие. В настоящее время мы не показываем таргетированную рекламу, и в магазине нет платежей и подписок."
          ]
        },
        {
          "title": "Публикация и удаление",
          "paras": [
            "Мы не продаем ваши данные. Мы передаем их только поставщикам аутентификации, хостинга, хранения и уведомлений, если это необходимо для запуска службы или когда это требуется по закону. Администраторы могут навсегда удалять отзывы, отчеты, обсуждения поддержки и их сообщения с панели управления, а вы можете запросить удаление или исправление данных вашей учетной записи через службу поддержки."
          ]
        },
        {
          "title": "Изменения в этой политике",
          "paras": [
            "Мы можем обновлять эту политику при изменении функций; дата последнего обновления отображается вверху, и мы можем запросить новое согласие на исправленную версию, прежде чем вы продолжите вход в систему."
          ]
        },
        {
          "title": "Дополнительные демографические данные",
          "paras": [
            "Вы можете по желанию поделиться возрастной группой, полом и страной анонимно и с явного согласия — исключительно для агрегированной статистики. Эти данные никогда не связываются с вашей учётной записью, и мы не собираем ваше имя, адрес электронной почты или дату рождения. Вы можете отозвать согласие или удалить данные в любое время на странице своей учётной записи. Если этот параметр не включён в панели управления, никакие данные не собираются."
          ]
        }
      ]
    },
    "terms": {
      "title": "Условия использования — Golden Store",
      "h2": "Условия использования",
      "kicker": "Юридический",
      "lead": "Обновлены условия использования Golden Store с его текущими функциями.",
      "updated": "Последнее обновление: 5 ноября 2026 г. — исправленное издание.",
      "tocTitle": "На этой странице",
      "note": "Эти положения были пересмотрены с учетом текущих особенностей магазина. Окончательная формулировка должна быть рассмотрена адвокатом.",
      "toc": [
        "Принятие условий",
        "Использование услуги",
        "Аккаунты и согласие",
        "APK-файлы и загрузки",
        "Интеллектуальная собственность",
        "Реклама и внешние ссылки",
        "Отказ от ответственности",
        "Прекращение действия и изменения",
        "Применимое право и контакты"
      ],
      "sections": [
        {
          "title": "Принятие условий",
          "paras": [
            "Используя Golden Store или входя в систему, вы подтверждаете, что прочитали и согласны с настоящими Условиями и <a class=\"legal-inline-link\" href=\"/privacy\">Политикой конфиденциальности</a>. Вход в систему не может быть завершен, пока не будет отмечен флажок обязательного согласия."
          ]
        },
        {
          "title": "Использование услуги",
          "paras": [
            "Магазин предназначен только для личного законного использования. Не вмешивайтесь в работу службы, не подвергайте ее агрессивному анализу, не обходите средства контроля доступа, не выдавайте себя за других и не публикуйте оскорбительный или незаконный контент в рейтингах, обзорах, отчетах или сообщениях поддержки. Администраторы могут скрыть или удалить нарушающий контент."
          ]
        },
        {
          "title": "Аккаунты и согласие",
          "paras": [
            "Учетные записи создаются через Google и идентифицируются по UID. Вы несете ответственность за свое устройство, безопасность учетной записи и точность данных. Согласие с текущей версией Условий и конфиденциальности фиксируется перед доступом, и администраторы могут заблокировать нарушающие учетные записи. На данный момент в магазине нет платежей и подписок."
          ]
        },
        {
          "title": "APK-файлы и загрузки",
          "paras": [
            "Для установки некоторых приложений может потребоваться включить «Установить из неизвестных источников». Вы делаете это под свою ответственность; перед установкой проверьте источник файла и запрошенные разрешения. Магазин показывает имя, разработчика, категорию, версию, размер и дату публикации/обновления, но не гарантирует, что файл работает на вашем устройстве или не содержит ошибок."
          ]
        },
        {
          "title": "Интеллектуальная собственность",
          "paras": [
            "Товарные знаки, названия, логотипы и права на приложения принадлежат их владельцам. Магазин отображает контент для поиска и доступа и не претендует на право собственности на сторонние приложения. В случае возражений по поводу прав свяжитесь с нами, чтобы удалить соответствующий контент."
          ]
        },
        {
          "title": "Реклама и внешние ссылки",
          "paras": [
            "Реклама или внешние ссылки могут быть добавлены позже; мы не несем ответственности за их содержание или практику. Ссылки в сообщениях поддержки открываются в новой вкладке с атрибутами безопасности, а внешние сайты регулируются собственными условиями. Кнопка группы Telegram на странице аккаунта также является внешней ссылкой."
          ]
        },
        {
          "title": "Отказ от ответственности",
          "paras": [
            "Услуга предоставляется «как есть» без явных или подразумеваемых гарантий. Чат службы поддержки содержит только текст, без изображений и голосовых заметок, а также не выдает уведомлений в приложении. Мы не несем ответственности за косвенный ущерб или потерю данных, возникшие в результате использования магазина или установки любого файла, в пределах, разрешенных законом."
          ]
        },
        {
          "title": "Прекращение действия и изменения",
          "paras": [
            "Администраторы могут навсегда удалить обзоры, отчеты, обсуждения поддержки и их сообщения, закрыть беседу со службой поддержки, изменить настоящие Условия или прекратить предоставление части услуги с указанием даты последнего обновления. Мы можем запросить новое согласие после существенного изменения."
          ]
        },
        {
          "title": "Применимое право и контакты",
          "paras": [
            "Настоящие Условия регулируются законодательством, действующим в стране пользователя, и мы в первую очередь стремимся разрешать споры мирным путем через <a class=\"legal-inline-link\" href=\"/support\">страницу поддержки</a> или через <a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>."
          ]
        }
      ]
    }
  },
  "hi":   {
    "about": {
      "title": "हमारे बारे में - गोल्डन स्टोर",
      "h2": "हमारे बारे में",
      "kicker": "कानूनी",
      "lead": "स्पष्ट इंटरफ़ेस और दस भाषाओं के साथ ऐप्स और गेम के लिए एक स्वतंत्र अरबी स्टोर।",
      "updated": "अंतिम अद्यतन: 5 नवंबर 2026 - संशोधित संस्करण",
      "tocTitle": "इस पेज पर",
      "note": "स्टोर की वर्तमान विशेषताओं को प्रतिबिंबित करने के लिए इन खंडों को संशोधित किया गया है: Google साइन-इन, अनिवार्य सहमति, रेटिंग और समीक्षाएं, त्वरित खोज, केवल-पाठ समर्थन चैट, क्लिक करने योग्य लिंक और वेब सूचनाएं। अंतिम शब्दों की समीक्षा वकील द्वारा की जानी चाहिए।",
      "toc": [
        "हमारे बारे में",
        "आधिकारिक वेबसाइट",
        "हमारा विशेष कार्य",
        "वर्तमान सुविधाएँ",
        "समर्थन एवं संपर्क करें"
      ],
      "sections": [
        {
          "title": "हमारे बारे में",
          "paras": [
            "गोल्डन स्टोर एंड्रॉइड ऐप्स और गेम के लिए एक स्वतंत्र अरबी स्टोर है। यह स्पष्ट मेटाडेटा के साथ एपीके फ़ाइलें प्रस्तुत करता है और गहरे और हल्के विषयों के साथ अरबी, अंग्रेजी, फ्रेंच और स्पेनिश का समर्थन करता है।",
            "स्टोर को रेटिंग, समीक्षा, पसंद और रिपोर्ट, त्वरित खोज, स्क्रीनशॉट के साथ समृद्ध विवरण पृष्ठ, एक स्टैंडअलोन समर्थन पृष्ठ और साइन-इन से पहले अनिवार्य कानूनी सहमति के साथ अपडेट किया गया है।"
          ]
        },
        {
          "title": "आधिकारिक वेबसाइट",
          "paras": [
            "आधिकारिक वेबसाइट वर्तमान स्टोर और उसकी नीतियों के लिए एकमात्र संदर्भ है:",
            "<a class='legal-inline-link' href='https://oldenstore.online' target='_blank' rel='noopener noreferrer' dir='ltr'>https://oldenstore.online</a>"
          ]
        },
        {
          "title": "हमारा विशेष कार्य",
          "paras": [
            "एक सरल, सुरक्षित डाउनलोड अनुभव प्रदान करने के लिए: प्रत्येक ऐप अपना नाम, डेवलपर, श्रेणी, संस्करण, आकार, रेटिंग और स्क्रीनशॉट दिखाता है, साथ ही स्थिति के आधार पर इसकी प्रकाशन तिथि या अंतिम अपडेट दिखाता है - अनावश्यक कदमों के बिना।"
          ]
        },
        {
          "title": "वर्तमान सुविधाएँ",
          "paras": [
            "स्टोर में अब शामिल हैं:"
          ],
          "items": [
            "श्रेणी के आधार पर ऐप्स और गेम ब्राउज़ करना और तत्काल नो-रीलोड खोज।",
            "स्क्रीनशॉट, रेटिंग, समीक्षा, पसंद, रिपोर्ट, श्रेणी, संस्करण और प्रकाशन/अपडेट तिथि के साथ विस्तृत पृष्ठ।",
            "पहुंच से पहले अनिवार्य शर्तों और गोपनीयता सहमति के साथ Google साइन-इन करें।",
            "अकाउंट पेज पर एक डाउनलोड लाइब्रेरी, वेब पुश नोटिफिकेशन और एक टेलीग्राम ग्रुप जॉइन बटन।",
            "एक पूर्ण अधिसूचना केंद्र, एक समर्पित ऑफ़लाइन पृष्ठ, एक मैन्युअल अपडेट जांच, और श्रेणियों के बगल में एक नया और अद्यतन टैब।",
            "व्यवस्थापक के साथ चल रही केवल-पाठ चैट के लिए एक स्टैंडअलोन/समर्थन पृष्ठ; लिंक एक नए टैब में खुलते हैं, कोई चित्र या ध्वनि नोट नहीं भेजे जाते हैं, और कोई इन-ऐप सूचनाएं नहीं होती हैं।",
            "चार भाषाएँ, डार्क/लाइट थीम और एक सुनहरा चैट डिज़ाइन। स्टोर में फिलहाल कोई भुगतान या सदस्यता नहीं है।"
          ]
        },
        {
          "title": "समर्थन एवं संपर्क करें",
          "paras": [
            "प्रश्नों या रिपोर्ट के लिए स्टोर के अंदर <a class='legal-inline-link' href='/support'>सहायता पृष्ठ</a>, खाता पृष्ठ पर टेलीग्राम समूह बटन, या ऊपर आधिकारिक वेबसाइट का उपयोग करें।"
          ]
        }
      ]
    },
    "privacy": {
      "title": "गोपनीयता नीति - गोल्डन स्टोर",
      "h2": "गोपनीयता नीति",
      "kicker": "कानूनी",
      "lead": "यह नीति बताती है कि अद्यतन स्टोर क्या एकत्र करता है, इसका उपयोग कैसे किया जाता है और इसे कैसे हटाया जाता है।",
      "updated": "अंतिम अद्यतन: 5 नवंबर 2026 - संशोधित संस्करण",
      "tocTitle": "इस पेज पर",
      "note": "स्टोर की वर्तमान विशेषताओं को प्रतिबिंबित करने के लिए इन खंडों को संशोधित किया गया है। अंतिम शब्दों की समीक्षा वकील द्वारा की जानी चाहिए।",
      "toc": [
        "परिचय",
        "डेटा हम एकत्र करते हैं",
        "कुकीज़ और स्थानीय भंडारण",
        "फायरबेस प्रमाणीकरण और सहमति",
        "सूचनाएं",
        "समर्थन चैट",
        "भविष्य का विज्ञापन",
        "साझा करना और हटाना",
        "इस नीति में परिवर्तन",
        "वैकल्पिक जनसांख्यिकीय डेटा"
      ],
      "sections": [
        {
          "title": "परिचय",
          "paras": [
            "यह नीति बताती है कि जब आप स्टोर ब्राउज़ करते हैं, साइन इन करते हैं, ऐप को रेट करते हैं, या संदेश समर्थन करते हैं तो गोल्डन स्टोर डेटा कैसे एकत्र, उपयोग और सुरक्षा करता है। स्टोर का उपयोग करके आप इस नीति और <a class='legal-inline-link' href='/terms'>सेवा की शर्तों</a> से सहमत होते हैं।",
            "वर्तमान सुविधाओं के लिए खंडों को अद्यतन किया गया था: अनिवार्य कानूनी सहमति, खोज, रेटिंग और समीक्षाएं, और बिना आवाज या छवि अनुलग्नकों के केवल-पाठ समर्थन चैट।"
          ]
        },
        {
          "title": "डेटा हम एकत्र करते हैं",
          "paras": [
            "हम सेवा चलाने के लिए आवश्यक न्यूनतम राशि एकत्र करते हैं:"
          ],
          "items": [
            "Google खाता डेटा: प्रदर्शन नाम, ईमेल, प्रोफ़ाइल चित्र और उपयोगकर्ता आईडी (यूआईडी)।",
            "रेटिंग, समीक्षाएं, पसंद, रिपोर्ट और समीक्षाएं जिन्हें आप छिपाना चुनते हैं।",
            "समर्थन-चैट संदेशों का पाठ और उनके टाइमस्टैम्प; अब हम चैट में चित्र या वॉयस रिकॉर्डिंग स्वीकार नहीं करते हैं।",
            "यदि आप अनुमति देते हैं तो इतिहास, स्थानीय प्राथमिकताएं, थीम, भाषा और वेब पुश/एफसीएम डिवाइस टोकन डाउनलोड करें।",
            "वर्तमान शर्तों और गोपनीयता संस्करण के प्रति आपकी सहमति का रिकॉर्ड।"
          ]
        },
        {
          "title": "कुकीज़ और स्थानीय भंडारण",
          "paras": [
            "स्टोर भाषा, थीम, डाउनलोड इतिहास और चैट ड्राफ्ट के लिए लोकलस्टोरेज/सेशनस्टोरेज का उपयोग करता है, साथ ही जरूरत पड़ने पर कानूनी-सहमति रसीद और प्रमाणीकरण सत्र के लिए एक सुरक्षित कुकी का उपयोग करता है। हम वर्तमान में तृतीय-पक्ष विज्ञापन ट्रैकिंग कुकीज़ का उपयोग नहीं करते हैं।"
          ]
        },
        {
          "title": "फायरबेस प्रमाणीकरण और सहमति",
          "paras": [
            "प्रमाणीकरण Google खाते के साथ फ़ायरबेस प्रमाणीकरण का उपयोग करता है; हम आपका पासवर्ड कभी संग्रहीत नहीं करते या देखते नहीं। साइन इन करने से पहले आपको अनिवार्य शर्तें और गोपनीयता सहमति बॉक्स पर टिक करना होगा, और वर्तमान संस्करण की रसीद /api/legal/consent के माध्यम से दर्ज की जाएगी।"
          ]
        },
        {
          "title": "सूचनाएं",
          "paras": [
            "यदि आप अनुमति देते हैं तो हम नए ऐप्स और अपडेट के बारे में वेब पुश सूचनाएं भेजने के लिए एक डिवाइस टोकन संग्रहीत करते हैं। समर्थन चैट इन-ऐप सूचनाओं को ट्रिगर नहीं करती है; संदेश तभी ताज़ा होते हैं जब पृष्ठ खुला हो। आप अपने ब्राउज़र या डिवाइस सेटिंग में सूचनाएं अक्षम कर सकते हैं।"
          ]
        },
        {
          "title": "समर्थन चैट",
          "paras": [
            "/support पृष्ठ व्यवस्थापक के साथ चल रही एक पाठ वार्तालाप को खोलता है। केवल पाठ संग्रहीत है; व्यवस्थापक थ्रेड और उसके संदेशों को पढ़ सकता है, उत्तर दे सकता है या स्थायी रूप से हटा सकता है। आपके द्वारा टाइप किए गए लिंक सुरक्षित लिंक बन जाते हैं जो एक नए टैब में खुलते हैं। कोई छवि या ऑडियो फ़ाइलें अपलोड नहीं की जाती हैं और अनुलग्नक ब्लॉब अब संग्रहीत नहीं किए जाते हैं।"
          ]
        },
        {
          "title": "भविष्य का विज्ञापन",
          "paras": [
            "हम बाद में स्टोर को समर्थन देने के लिए विज्ञापन या विश्लेषण सेवाएँ जोड़ सकते हैं; यदि ऐसा है तो हम इस नीति को अद्यतन करेंगे, इसमें शामिल डेटा की व्याख्या करेंगे और जहां आवश्यक हो सहमति का अनुरोध करेंगे। वर्तमान में हम कोई लक्षित विज्ञापन नहीं दिखाते हैं और स्टोर में कोई भुगतान या सदस्यता नहीं है।"
          ]
        },
        {
          "title": "साझा करना और हटाना",
          "paras": [
            "हम आपका डेटा नहीं बेचते हैं. हम इसे केवल प्रमाणीकरण, होस्टिंग, भंडारण और अधिसूचना प्रदाताओं के साथ साझा करते हैं, जब सेवा चलाने के लिए आवश्यक हो, या जब कानूनी रूप से आवश्यक हो। व्यवस्थापक डैशबोर्ड से समीक्षाओं, रिपोर्टों, समर्थन थ्रेड्स और उनके संदेशों को स्थायी रूप से हटा सकते हैं, और आप समर्थन के माध्यम से अपने खाता डेटा को हटाने या सुधार का अनुरोध कर सकते हैं।"
          ]
        },
        {
          "title": "इस नीति में परिवर्तन",
          "paras": [
            "सुविधाएँ बदलने पर हम इस नीति को अद्यतन कर सकते हैं; अंतिम अद्यतन तिथि शीर्ष पर दिखाई देती है, और आपके साइन इन करना जारी रखने से पहले हम संशोधित संस्करण के लिए नई सहमति का अनुरोध कर सकते हैं।"
          ]
        },
        {
          "title": "वैकल्पिक जनसांख्यिकीय डेटा",
          "paras": [
            "आप स्पष्ट सहमति के साथ आयु वर्ग, लिंग और देश को गुमनाम रूप से केवल समग्र आंकड़ों के लिए वैकल्पिक रूप से साझा कर सकते हैं। यह डेटा कभी भी आपके खाते से नहीं जोड़ा जाता, और हम आपका नाम, ईमेल या जन्म तिथि एकत्र नहीं करते। आप किसी भी समय अपने खाता पृष्ठ से सहमति वापस ले सकते हैं या डेटा हटा सकते हैं। यदि यह विकल्प डैशबोर्ड में सक्षम नहीं है, तो कुछ भी एकत्र नहीं किया जाता।"
          ]
        }
      ]
    },
    "terms": {
      "title": "सेवा की शर्तें - गोल्डन स्टोर",
      "h2": "सेवा की शर्तें",
      "kicker": "कानूनी",
      "lead": "गोल्डन स्टोर को उसकी वर्तमान सुविधाओं के साथ उपयोग करने की अद्यतन शर्तें।",
      "updated": "अंतिम अद्यतन: 5 नवंबर 2026 - संशोधित संस्करण",
      "tocTitle": "इस पेज पर",
      "note": "स्टोर की वर्तमान विशेषताओं को प्रतिबिंबित करने के लिए इन खंडों को संशोधित किया गया है। अंतिम शब्दों की समीक्षा वकील द्वारा की जानी चाहिए।",
      "toc": [
        "शर्तों की स्वीकृति",
        "सेवा का उपयोग",
        "खाते और सहमति",
        "एपीके फ़ाइलें और डाउनलोड",
        "बौद्धिक संपदा",
        "विज्ञापन एवं बाहरी लिंक",
        "अस्वीकरण",
        "समाप्ति एवं परिवर्तन",
        "लागू कानून एवं संपर्क"
      ],
      "sections": [
        {
          "title": "शर्तों की स्वीकृति",
          "paras": [
            "गोल्डन स्टोर का उपयोग करके या साइन इन करके, आप पुष्टि करते हैं कि आपने इन शर्तों और <a class='legal-inline-link' href='/privacy'>गोपनीयता नीति</a> को पढ़ लिया है और उनसे सहमत हैं। जब तक अनिवार्य सहमति बॉक्स पर टिक नहीं किया जाता तब तक साइन-इन पूरा नहीं हो सकता।"
          ]
        },
        {
          "title": "सेवा का उपयोग",
          "paras": [
            "स्टोर केवल व्यक्तिगत, वैध उपयोग के लिए है। सेवा के साथ छेड़छाड़ न करें, इसे आक्रामक तरीके से परिमार्जन न करें, पहुंच नियंत्रण को बायपास न करें, दूसरों का प्रतिरूपण न करें, या रेटिंग, समीक्षा, रिपोर्ट या समर्थन संदेशों में अपमानजनक या अवैध सामग्री पोस्ट न करें। व्यवस्थापक उल्लंघनकारी सामग्री को छिपा या हटा सकते हैं।"
          ]
        },
        {
          "title": "खाते और सहमति",
          "paras": [
            "खाते Google के माध्यम से बनाए जाते हैं और UID द्वारा पहचाने जाते हैं। आप अपने डिवाइस, खाते की सुरक्षा और सटीक डेटा के लिए ज़िम्मेदार हैं। वर्तमान शर्तों और गोपनीयता संस्करण पर सहमति पहुंच से पहले दर्ज की जाती है, और व्यवस्थापक उल्लंघन करने वाले खातों को निलंबित कर सकते हैं। स्टोर में फिलहाल कोई भुगतान या सदस्यता नहीं है।"
          ]
        },
        {
          "title": "एपीके फ़ाइलें और डाउनलोड",
          "paras": [
            "कुछ ऐप्स इंस्टॉल करने के लिए \"अज्ञात स्रोतों से इंस्टॉल\" सक्षम करने की आवश्यकता हो सकती है। आप ऐसा अपनी जिम्मेदारी पर करते हैं; इंस्टॉल करने से पहले फ़ाइल स्रोत और अनुरोधित अनुमतियों की जाँच करें। स्टोर नाम, डेवलपर, श्रेणी, संस्करण, आकार और प्रकाशन/अद्यतन तिथि दिखाता है, लेकिन यह गारंटी नहीं देता कि कोई फ़ाइल आपके डिवाइस पर काम करती है या त्रुटि-मुक्त है।"
          ]
        },
        {
          "title": "बौद्धिक संपदा",
          "paras": [
            "ट्रेडमार्क, नाम, लोगो और ऐप अधिकार उनके स्वामियों के हैं। स्टोर खोज और पहुंच के लिए सामग्री प्रदर्शित करता है और तीसरे पक्ष के ऐप्स के स्वामित्व का दावा नहीं करता है। अधिकार आपत्तियों के लिए, प्रासंगिक सामग्री को हटाने के लिए हमसे संपर्क करें।"
          ]
        },
        {
          "title": "विज्ञापन एवं बाहरी लिंक",
          "paras": [
            "विज्ञापन या बाहरी लिंक बाद में जोड़े जा सकते हैं; हम उनकी सामग्री या प्रथाओं के लिए ज़िम्मेदार नहीं हैं। समर्थन संदेशों में लिंक सुरक्षा विशेषताओं के साथ एक नए टैब में खुलते हैं, और बाहरी साइटें अपनी शर्तों द्वारा शासित होती हैं। खाता पृष्ठ पर टेलीग्राम समूह बटन भी एक बाहरी लिंक है।"
          ]
        },
        {
          "title": "अस्वीकरण",
          "paras": [
            "सेवा स्पष्ट या निहित वारंटी के बिना \"जैसी है\" प्रदान की जाती है। समर्थन चैट केवल टेक्स्ट है, जिसमें कोई छवि या वॉयस नोट्स नहीं है, और कोई इन-ऐप अधिसूचनाएं उत्पन्न नहीं होती हैं। हम कानून द्वारा अनुमत सीमा तक स्टोर का उपयोग करने या किसी फ़ाइल को स्थापित करने से होने वाली अप्रत्यक्ष क्षति या डेटा हानि के लिए उत्तरदायी नहीं हैं।"
          ]
        },
        {
          "title": "समाप्ति एवं परिवर्तन",
          "paras": [
            "व्यवस्थापक अंतिम अद्यतन तिथि दर्शाकर समीक्षाओं, रिपोर्टों, समर्थन थ्रेडों और उनके संदेशों को स्थायी रूप से हटा सकते हैं, समर्थन वार्तालाप बंद कर सकते हैं, इन शर्तों को संशोधित कर सकते हैं, या सेवा का हिस्सा बंद कर सकते हैं। हम भौतिक परिवर्तन के बाद नई सहमति का अनुरोध कर सकते हैं।"
          ]
        },
        {
          "title": "लागू कानून एवं संपर्क",
          "paras": [
            "ये शर्तें उपयोगकर्ता के देश में लागू कानूनों द्वारा शासित होती हैं, और हम सबसे पहले विवादों को <a class=\"legal-inline-link\" href=\"/support\">समर्थन पृष्ठ</a> या <a class=\"legal-inline-link\" href=\"https://oldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a> के माध्यम से सौहार्दपूर्ण ढंग से हल करना चाहते हैं।"
          ]
        }
      ]
    }
  },
  "zh":   {
    "about": {
      "title": "关于我们 — 黄金店",
      "h2": "关于我们",
      "kicker": "合法的",
      "lead": "一个独立的阿拉伯语应用程序和游戏商店，具有清晰的界面和十种语言。",
      "updated": "最后更新：2026 年 11 月 5 日 — 修订版",
      "tocTitle": "在此页面上",
      "note": "这些条款已经过修改，以反映商店当前的功能：谷歌登录、强制同意、评级和评论、即时搜索、纯文本支持聊天、可点击链接和网络通知。最终措辞应由律师审查。",
      "toc": [
        "关于我们",
        "官方网站",
        "我们的使命",
        "当前功能",
        "支持与联系"
      ],
      "sections": [
        {
          "title": "关于我们",
          "paras": [
            "Golden Store 是一家独立的阿拉伯语 Android 应用程序和游戏商店。它以清晰的元数据呈现 APK 文件，并支持阿拉伯语、英语、法语和西班牙语，以及深色和浅色主题。",
            "该商店已更新了评级、评论、点赞和报告、即时搜索、带有屏幕截图的丰富详细信息页面、独立的支持页面以及登录前的强制法律同意。"
          ]
        },
        {
          "title": "官方网站",
          "paras": [
            "官网是当前店铺及其政策的唯一参考：",
            "<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">https://goldenstore.online</a>"
          ]
        },
        {
          "title": "我们的使命",
          "paras": [
            "为了提供简单、安全的下载体验：每个应用程序都会显示其名称、开发者、类别、版本、大小、评级和屏幕截图，以及根据状态而定的发布日期或上次更新 - 无需不必要的步骤。"
          ]
        },
        {
          "title": "当前功能",
          "paras": [
            "该商店现在包括："
          ],
          "items": [
            "按类别浏览应用程序和游戏以及即时无需重新加载搜索。",
            "包含屏幕截图、评级、评论、喜欢、报告、类别、版本和发布/更新日期的详细信息页面。",
            "在访问之前，请先通过 Google 登录并获得强制性条款和隐私同意。",
            "帐户页面上有下载库、Web 推送通知和 Telegram 群组加入按钮。",
            "完整的通知中心、专用的离线页面、手动更新检查以及类别旁边的新建和更新选项卡。",
            "一个独立/支持页面，用于与管理员进行持续的纯文本聊天；链接在新选项卡中打开，不发送图像或语音注释，也没有应用内通知。",
            "四种语言、深色/浅色主题和金色聊天设计。目前商店中没有付款或订阅。"
          ]
        },
        {
          "title": "支持与联系",
          "paras": [
            "如有疑问或报告，请使用商店内的<a class=\"legal-inline-link\" href=\"/support\">支持页面</a>、帐户页面上的 Telegram 群组按钮或上面的官方网站。"
          ]
        }
      ]
    },
    "privacy": {
      "title": "隐私政策 — Golden Store",
      "h2": "隐私政策",
      "kicker": "合法的",
      "lead": "此政策解释了更新后的商店收集的内容、使用方式以及删除方式。",
      "updated": "最后更新：2026 年 11 月 5 日 — 修订版",
      "tocTitle": "在此页面上",
      "note": "这些条款已经过修改，以反映商店当前的特点。最终措辞应由律师审查。",
      "toc": [
        "介绍",
        "我们收集的数据",
        "Cookie 和本地存储",
        "Firebase 身份验证和同意",
        "通知",
        "支持聊天",
        "未来广告",
        "分享与删除",
        "本政策的变更",
        "可选的人口统计数据"
      ],
      "sections": [
        {
          "title": "介绍",
          "paras": [
            "本政策解释了当您浏览商店、登录、评价应用程序或发送消息支持时，Golden Store 如何收集、使用和保护数据。使用商店即表示您同意本政策和<a class=\"legal-inline-link\" href=\"/terms\">服务条款</a>。",
            "这些条款针对当前功能进行了更新：强制法律同意、搜索、评级和评论，以及不含语音或图像附件的纯文本支持聊天。"
          ]
        },
        {
          "title": "我们收集的数据",
          "paras": [
            "我们收集运行服务所需的最低限度："
          ],
          "items": [
            "Google 帐户数据：显示名称、电子邮件、个人资料图片和用户 ID (UID)。",
            "您选择隐藏的评分、评论、喜欢、报告和评论。",
            "支持聊天消息的文本及其时间戳；我们不再接受聊天中的图像或录音。",
            "如果您授予权限，则下载历史记录、本地首选项、主题、语言和 Web 推送/FCM 设备令牌。",
            "您同意当前条款和隐私版本的记录。"
          ]
        },
        {
          "title": "Cookie 和本地存储",
          "paras": [
            "该商店使用 localStorage/sessionStorage 来存储语言、主题、下载历史记录和聊天草稿，并在需要时使用安全 cookie 来接收法律同意书和进行身份验证会话。我们目前不使用第三方广告跟踪 cookie。"
          ]
        },
        {
          "title": "Firebase 身份验证和同意",
          "paras": [
            "身份验证使用 Firebase 身份验证和 Google 帐户；我们绝不会存储或查看您的密码。登录之前，您必须勾选强制性条款和隐私同意框，并通过 /api/legal/consent 记录当前版本的收据。"
          ]
        },
        {
          "title": "通知",
          "paras": [
            "如果您授予权限，我们将存储设备令牌以发送有关新应用程序和更新的 Web 推送通知。支持聊天不触发应用内通知；仅在页面打开时通过轮询刷新消息。您可以在浏览器或设备设置中禁用通知。"
          ]
        },
        {
          "title": "支持聊天",
          "paras": [
            "/support 页面会打开与管理员的持续文本对话。仅存储文本；管理员可以阅读、回复或永久删除该话题及其消息。您键入的链接将成为在新选项卡中打开的安全链接。不会上传任何图像或音频文件，并且不再存储附件 blob。"
          ]
        },
        {
          "title": "未来广告",
          "paras": [
            "我们稍后可能会添加广告或分析服务来支持商店；如果是这样，我们将更新本政策，解释所涉及的数据，并在需要时请求同意。我们目前没有展示有针对性的广告，商店也没有付款或订阅。"
          ]
        },
        {
          "title": "分享与删除",
          "paras": [
            "我们不会出售您的数据。我们仅根据运行服务的需要或法律要求时与身份验证、托管、存储和通知提供商共享这些信息。管理员可以从仪表板上永久删除评论、报告、支持线程及其消息，您可以通过支持请求删除或更正您的帐户数据。"
          ]
        },
        {
          "title": "本政策的变更",
          "paras": [
            "当功能发生变化时，我们可能会更新本政策；最后更新日期显示在顶部，在您继续登录之前，我们可能会请求您重新同意修订版本。"
          ]
        },
        {
          "title": "可选的人口统计数据",
          "paras": [
            "您可以自愿、匿名并在明确同意的情况下分享年龄段、性别和国家，仅用于汇总统计。这些数据绝不会与您的账户关联，我们也不会收集您的姓名、电子邮件或出生日期。您可以随时从账户页面撤回同意或删除数据。如果此选项未在仪表板中启用，则不会收集任何内容。"
          ]
        }
      ]
    },
    "terms": {
      "title": "服务条款 — Golden Store",
      "h2": "服务条款",
      "kicker": "合法的",
      "lead": "更新了使用 Golden Store 的条款及其当前功能。",
      "updated": "最后更新：2026 年 11 月 5 日 — 修订版",
      "tocTitle": "在此页面上",
      "note": "这些条款已经过修改，以反映商店当前的特点。最终措辞应由律师审查。",
      "toc": [
        "接受条款",
        "使用服务",
        "账户和同意",
        "APK 文件和下载",
        "知识产权",
        "广告和外部链接",
        "免责声明",
        "终止及变更",
        "适用法律和联系方式"
      ],
      "sections": [
        {
          "title": "接受条款",
          "paras": [
            "使用 Golden Store 或登录即表示您确认已阅读并同意这些条款和<a class=\"legal-inline-link\" href=\"/privacy\">隐私政策</a>。在勾选强制同意框之前，登录无法完成。"
          ]
        },
        {
          "title": "使用服务",
          "paras": [
            "该商店仅供个人合法使用。请勿篡改服务、积极抓取服务、绕过访问控制、冒充他人，或在评级、评论、报告或支持消息中发布滥用或非法内容。管理员可以隐藏或删除违规内容。"
          ]
        },
        {
          "title": "账户和同意",
          "paras": [
            "帐户是通过 Google 创建的，并通过 UID 进行标识。您对您的设备、帐户安全和准确数据负责。在访问之前会记录对当前条款和隐私版本的同意，管理员可以暂停违规帐户。目前商店中没有付款或订阅。"
          ]
        },
        {
          "title": "APK 文件和下载",
          "paras": [
            "安装某些应用程序可能需要启用“从未知来源安装”。您这样做需要您自己承担责任；安装前检查文件来源和请求的权限。商店显示名称、开发者、类别、版本、大小和发布/更新日期，但不保证文件在您的设备上运行或没有错误。"
          ]
        },
        {
          "title": "知识产权",
          "paras": [
            "商标、名称、徽标和应用程序权利属于其所有者。该商店显示供发现和访问的内容，并且不声明第三方应用程序的所有权。如有权利异议，请联系我们删除相关内容。"
          ]
        },
        {
          "title": "广告和外部链接",
          "paras": [
            "稍后可能会添加广告或外部链接；我们对其内容或做法不承担任何责任。支持消息中的链接在具有安全属性的新选项卡中打开，外部站点受其自己的条款管辖。帐户页面上的 Telegram 群组按钮也是外部链接。"
          ]
        },
        {
          "title": "免责声明",
          "paras": [
            "该服务按“原样”提供，没有明示或默示的保证。支持聊天仅限文本，没有图像或语音注释，并且不会产生应用内通知。在法律允许的范围内，我们不对因使用商店或安装任何文件而造成的间接损害或数据丢失承担责任。"
          ]
        },
        {
          "title": "终止及变更",
          "paras": [
            "管理员可以永久删除评论、报告、支持线程及其消息、关闭支持对话、修改这些条款或停止部分服务，并显示最后更新日期。重大变更后，我们可能会请求重新同意。"
          ]
        },
        {
          "title": "适用法律和联系方式",
          "paras": [
            "这些条款受用户所在国家/地区适用的法律管辖，我们首先寻求通过<a class=\"legal-inline-link\" href=\"/support\">支持页面</a>或通过<a class=\"legal-inline-link\" href=\"https://goldenstore.online\" target=\"_blank\" rel=\"noopener noreferrer\" dir=\"ltr\">goldenstore.online</a>友好解决争议。"
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
    document.documentElement.dir = 'ltr';   // Arabic is the only RTL language
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
