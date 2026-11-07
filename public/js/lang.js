// Goldenstore i18n — Arabic source plus English, French, and Spanish.
// Curated UI strings are instant; other content is translated via /api/translate
// and cached per language.
(function () {
  'use strict';

  var LANGS = [
    { code: 'ar', label: 'العربية', dir: 'rtl' },
    { code: 'en', label: 'English', dir: 'ltr' },
    { code: 'fr', label: 'Français', dir: 'ltr' },
    { code: 'es', label: 'Español', dir: 'ltr' },
  ];

  function readLang() {
    try { var l = localStorage.getItem('gs_lang'); } catch (e) { l = null; }
    if (LANGS.some(function (x) { return x.code === l; })) return l;
    try { if (l) localStorage.setItem('gs_lang', 'ar'); } catch (e) {}
    return 'ar';
  }
  var lang = readLang();
  var dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;

  // ---- Curated overrides: exact Arabic text -> per-language translation. ----
  // Used for short UI terms where machine translation is ambiguous/risky.
  var O = {
    // bottom nav / chrome
    'التطبيقات': { en: 'Apps', fr: 'Applications', es: 'Aplicaciones' },
    'الألعاب': { en: 'Games', fr: 'Jeux', es: 'Juegos' },
    'بحث': { en: 'Search', fr: 'Recherche', es: 'Buscar' },
    'أنت': { en: 'You', fr: 'Vous', es: 'Tú' },
    'الفئات': { en: 'Categories', fr: 'Catégories', es: 'Categorías' },
    'التصنيفات': { en: 'Categories', fr: 'Catégories', es: 'Categorías' },
    'تصفح': { en: 'Browse', fr: 'Parcourir', es: 'Explorar' },
    'تصفّح': { en: 'Browse', fr: 'Parcourir', es: 'Explorar' },
    'الإعدادات': { en: 'Settings', fr: 'Paramètres', es: 'Ajustes' },
    'مكتبتي': { en: 'My Library', fr: 'Ma bibliothèque', es: 'Mi biblioteca' },
    'مكتبتك فارغة': { en: 'Your library is empty', fr: 'Votre bibliothèque est vide', es: 'Tu biblioteca está vacía' },
    'إعادة تحميل': { en: 'Reinstall', fr: 'Réinstaller', es: 'Reinstalar' },
    'مسح السجل': { en: 'Clear history', fr: 'Effacer l\'historique', es: 'Borrar historial' },
    'المظهر': { en: 'Appearance', fr: 'Apparence', es: 'Apariencia' },
    'فاتح': { en: 'Light', fr: 'Clair', es: 'Claro' },
    'غامق': { en: 'Dark', fr: 'Sombre', es: 'Oscuro' },
    'اللغة': { en: 'Language', fr: 'Langue', es: 'Idioma' },
    'تسجيل الخروج': { en: 'Sign out', fr: 'Se déconnecter', es: 'Cerrar sesión' },
    'رجوع': { en: 'Back', fr: 'Retour', es: 'Atrás' },
    'إغلاق': { en: 'Close', fr: 'Fermer', es: 'Cerrar' },
    'مسح': { en: 'Clear', fr: 'Effacer', es: 'Borrar' },
    'حذف': { en: 'Delete', fr: 'Supprimer', es: 'Eliminar' },
    'إلغاء': { en: 'Cancel', fr: 'Annuler', es: 'Cancelar' },
    'إرسال': { en: 'Send', fr: 'Envoyer', es: 'Enviar' },
    'جديد': { en: 'New', fr: 'Nouveau', es: 'Nuevo' },
    'الإشعارات': { en: 'Notifications', fr: 'Notifications', es: 'Notificaciones' },
    'لا توجد إشعارات بعد': { en: 'No notifications yet', fr: 'Aucune notification pour l’instant', es: 'Todavía no hay notificaciones' },
    'تطبيق جديد': { en: 'New app', fr: 'Nouvelle app', es: 'Nueva app' },
    'تحديث': { en: 'Update', fr: 'Mise à jour', es: 'Actualización' },
    'إعلان': { en: 'Announcement', fr: 'Annonce', es: 'Anuncio' },

    // v2: notifications / offline / update checks / new apps / download page
    'العودة إلى الرئيسية': { en: 'Back to home', fr: 'Retour à l’accueil', es: 'Volver al inicio' },
    'أنت غير متصل': { en: 'You are offline', fr: 'Vous êtes hors ligne', es: 'Estás sin conexión' },
    'الاتصال غير مستقر': { en: 'Connection unstable', fr: 'Connexion instable', es: 'Conexión inestable' },
    'تأكّد من تشغيل الواي فاي أو بيانات الهاتف.': { en: 'Make sure Wi‑Fi or mobile data is on.', fr: 'Vérifiez que le Wi‑Fi ou les données mobiles sont activés.', es: 'Asegúrate de que el Wi‑Fi o los datos móviles estén activados.' },
    'جرّب فتح صفحة أخرى للتأكد من عمل الإنترنت.': { en: 'Try opening another page to confirm the internet works.', fr: 'Ouvrez une autre page pour vérifier la connexion.', es: 'Abre otra página para comprobar la conexión.' },
    'أوقف VPN أو البروكسي مؤقتاً ثم أعد المحاولة.': { en: 'Temporarily turn off VPN or proxy, then retry.', fr: 'Désactivez temporairement le VPN ou le proxy, puis réessayez.', es: 'Desactiva temporalmente la VPN o el proxy y vuelve a intentarlo.' },
    'أنت على أحدث إصدار': { en: 'You are up to date', fr: 'Vous êtes à jour', es: 'Estás al día' },
    'نسختك الحالية هي الأحدث. لا يوجد تحديث جديد الآن.': { en: 'Your current version is the latest. No new update right now.', fr: 'Votre version est la plus récente. Aucune mise à jour pour le moment.', es: 'Tu versión es la más reciente. No hay actualizaciones ahora.' },
    'تعذّر التحقق من التحديثات': { en: 'Could not check for updates', fr: 'Impossible de vérifier les mises à jour', es: 'No se pudieron comprobar las actualizaciones' },
    'رابط التحميل الرسمي جاهز في صفحة تحميل Golden Store.': { en: 'The official download is ready on the Golden Store download page.', fr: 'Le lien officiel est prêt sur la page de téléchargement Golden Store.', es: 'El enlace oficial está listo en la página de descarga de Golden Store.' },
    'أحدث إصدار متاح': { en: 'Latest version available', fr: 'Dernière version disponible', es: 'Última versión disponible' },
    'انتقل إلى صفحة التحميل': { en: 'Go to download page', fr: 'Aller à la page de téléchargement', es: 'Ir a la página de descarga' },
    'حسناً': { en: 'OK', fr: 'D’accord', es: 'Aceptar' },
    'إصدارك الحالي': { en: 'Your version', fr: 'Votre version', es: 'Tu versión' },
    'تحميل آمن': { en: 'Safe download', fr: 'Téléchargement sûr', es: 'Descarga segura' },
    'ميزات جديدة': { en: 'New features', fr: 'Nouvelles fonctionnalités', es: 'Novedades' },
    'تثبيت سريع': { en: 'Quick install', fr: 'Installation rapide', es: 'Instalación rápida' },
    'إعادة التحقق من التحديثات': { en: 'Check for updates again', fr: 'Revérifier les mises à jour', es: 'Volver a comprobar actualizaciones' },
    'التحديث الرسمي من Golden Store': { en: 'Official Golden Store update', fr: 'Mise à jour officielle de Golden Store', es: 'Actualización oficial de Golden Store' },
    'التحقق من وجود تحديثات': { en: 'Check for updates', fr: 'Vérifier les mises à jour', es: 'Comprobar actualizaciones' },
    'جارٍ التحقق من التحديثات…': { en: 'Checking for updates…', fr: 'Recherche de mises à jour…', es: 'Buscando actualizaciones…' },
    'الجديد والمحدّث': { en: 'New & updated', fr: 'Nouveautés et mises à jour', es: 'Novedades y actualizaciones' },
    'وصل حديثاً': { en: 'Just added', fr: 'Ajouté récemment', es: 'Recién añadido' },
    'تم تحديثه': { en: 'Recently updated', fr: 'Mis à jour récemment', es: 'Actualizado recientemente' },
    'أحدث التطبيقات والتحديثات': { en: 'The newest apps and updates', fr: 'Les dernières apps et mises à jour', es: 'Las apps y actualizaciones más recientes' },
    'لا توجد تطبيقات جديدة بعد': { en: 'No new apps yet', fr: 'Pas encore de nouvelles apps', es: 'Aún no hay apps nuevas' },
    'لا توجد ألعاب جديدة بعد': { en: 'No new games yet', fr: 'Pas encore de nouveaux jeux', es: 'Aún no hay juegos nuevos' },
    'أحدث الألعاب والتحديثات': { en: 'The newest games and updates', fr: 'Les derniers jeux et mises à jour', es: 'Los juegos y actualizaciones más recientes' },
    'تطبيقات جديدة': { en: 'New apps', fr: 'Nouvelles applications', es: 'Apps nuevas' },
    'تطبيقات محدّثة': { en: 'Updated apps', fr: 'Applications mises à jour', es: 'Apps actualizadas' },
    'اكتشف ما وصل حديثاً إلى المتجر': { en: 'Discover what just arrived in the store', fr: 'Découvrez les nouveautés du store', es: 'Descubre lo nuevo en la tienda' },
    'مركز الإشعارات': { en: 'Notification center', fr: 'Centre de notifications', es: 'Centro de notificaciones' },
    'آخر أخبار المتجر والتحديثات والتطبيقات الجديدة.': { en: 'Store news, updates and new apps.', fr: 'Actualités du store, mises à jour et nouvelles apps.', es: 'Noticias de la tienda, actualizaciones y apps nuevas.' },
    'تحديث المتجر': { en: 'Store update', fr: 'Mise à jour du store', es: 'Actualización de la tienda' },
    'عرض التطبيق': { en: 'View app', fr: 'Voir l’application', es: 'Ver la app' },
    'تحميل التحديث': { en: 'Download update', fr: 'Télécharger la mise à jour', es: 'Descargar actualización' },
    'تحديث الإشعارات': { en: 'Refresh notifications', fr: 'Actualiser les notifications', es: 'Actualizar notificaciones' },
    'جارٍ تحميل الإشعارات…': { en: 'Loading notifications…', fr: 'Chargement des notifications…', es: 'Cargando notificaciones…' },
    'تحميل Golden Store': { en: 'Download Golden Store', fr: 'Télécharger Golden Store', es: 'Descargar Golden Store' },
    'تحميل Golden Store — أحدث إصدار': { en: 'Download Golden Store — Latest version', fr: 'Télécharger Golden Store — Dernière version', es: 'Descargar Golden Store — Última versión' },
    'أحدث إصدار': { en: 'Latest version', fr: 'Dernière version', es: 'Última versión' },
    'حمّل أحدث إصدار من Golden Store بأمان ومجاناً. متجر التطبيقات والألعاب العربي.': { en: 'Download the latest Golden Store release safely and for free. The Arabic apps & games store.', fr: 'Téléchargez la dernière version de Golden Store en toute sécurité et gratuitement. Le store arabe d’apps et de jeux.', es: 'Descarga la última versión de Golden Store de forma segura y gratuita. La tienda árabe de apps y juegos.' },
    'حمّل أحدث إصدار من Golden Store بأمان ومجاناً. متجر التطبيقات والألعاب العربي، بتصميم عصري وتحديثات مستمرة.': { en: 'Download the latest Golden Store release safely and for free. The Arabic apps & games store, with a modern design and continuous updates.', fr: 'Téléchargez la dernière version de Golden Store en toute sécurité et gratuitement. Le store arabe d’apps et de jeux, au design moderne et mis à jour en continu.', es: 'Descarga la última versión de Golden Store de forma segura y gratuita. La tienda árabe de apps y juegos, con diseño moderno y actualizaciones continuas.' },
    'لماذا Golden Store؟': { en: 'Why Golden Store?', fr: 'Pourquoi Golden Store ?', es: '¿Por qué Golden Store?' },
    'تجربة تحميل نظيفة وسريعة دون تعقيد.': { en: 'A clean, fast download experience with no hassle.', fr: 'Une expérience de téléchargement simple, propre et rapide.', es: 'Una experiencia de descarga limpia, rápida y sin complicaciones.' },
    'كل التطبيقات والألعاب متاحة دون أي رسوم أو اشتراكات.': { en: 'All apps and games are available with no fees or subscriptions.', fr: 'Toutes les apps et tous les jeux sont disponibles sans frais ni abonnement.', es: 'Todas las apps y juegos están disponibles sin pagos ni suscripciones.' },
    'الملفات تُحمّل من الخادم الرسمي عبر رابط مباشر وموثوق.': { en: 'Files are served from the official server through a trusted direct link.', fr: 'Les fichiers proviennent du serveur officiel via un lien direct fiable.', es: 'Los archivos se sirven desde el servidor oficial mediante un enlace directo fiable.' },
    'إصدارات جديدة وتحسينات مستمرة تصل إلى جهازك أولاً بأول.': { en: 'New releases and improvements reach your device as soon as they land.', fr: 'Les nouvelles versions et améliorations arrivent sur votre appareil dès leur sortie.', es: 'Las nuevas versiones y mejoras llegan a tu dispositivo en cuanto se publican.' },
    'واجهة هادئة بأسلوب ذهبي وأسود/أبيض، بلا إعلانات مقاطِعة.': { en: 'A calm gold, black and white interface with no interruptive ads.', fr: 'Une interface sobre or, noir et blanc, sans publicités interruptives.', es: 'Una interfaz tranquila en oro, blanco y negro, sin anuncios que interrumpan.' },
    'الدعم': { en: 'Support', fr: 'Assistance', es: 'Soporte' },
    '© Golden Store — جميع الحقوق محفوظة': { en: '© Golden Store — All rights reserved', fr: '© Golden Store — Tous droits réservés', es: '© Golden Store — Todos los derechos reservados' },
    'تعذّر تحميل عدد التنزيلات': { en: 'Could not load the download count', fr: 'Impossible de charger le compteur de téléchargements', es: 'No se pudo cargar el contador de descargas' },
    'العدد الحقيقي للتنزيلات': { en: 'Real download total', fr: 'Total réel des téléchargements', es: 'Total real de descargas' },
    'اتركه فارغاً للإبقاء على العدد الحالي': { en: 'Leave empty to keep the current total', fr: 'Laissez vide pour conserver le total actuel', es: 'Déjalo vacío para mantener el total actual' },
    'العدد الحالي للتنزيلات': { en: 'Current download total', fr: 'Total actuel des téléchargements', es: 'Total actual de descargas' },
    'يمكن زيادة العدد لاستعادة الرقم الحقيقي ولا يمكن إنقاصه': { en: 'You can raise it to restore the real number; it can never decrease', fr: 'Vous pouvez l’augmenter pour restaurer le nombre réel ; il ne peut jamais diminuer', es: 'Puedes aumentarlo para restaurar la cifra real; nunca puede bajar' },
    'متجر التطبيقات والألعاب': { en: 'The apps & games store', fr: 'Le store d’apps et de jeux', es: 'La tienda de apps y juegos' },
    'سيُعاد تحميل الصفحة تلقائياً عند عودة الاتصال.': { en: 'The page will reload automatically when the connection returns.', fr: 'La page se rechargera automatiquement au retour de la connexion.', es: 'La página se recargará automáticamente cuando vuelva la conexión.' },
    'حمّل أحدث إصدار من Golden Store بأمان ومجاناً.': { en: 'Get the latest Golden Store release safely and for free.', fr: 'Téléchargez la dernière version de Golden Store en toute sécurité et gratuitement.', es: 'Descarga la última versión de Golden Store de forma segura y gratuita.' },
    'مجاني بالكامل': { en: 'Completely free', fr: 'Entièrement gratuit', es: 'Totalmente gratis' },
    'تحميل مباشر وآمن': { en: 'Direct, secure download', fr: 'Téléchargement direct et sécurisé', es: 'Descarga directa y segura' },
    'تحديثات مستمرة': { en: 'Regular updates', fr: 'Mises à jour régulières', es: 'Actualizaciones continuas' },
    'بدون إعلانات مزعجة': { en: 'No annoying ads', fr: 'Sans publicités gênantes', es: 'Sin anuncios molestos' },
    'متاح الآن': { en: 'Available now', fr: 'Disponible maintenant', es: 'Disponible ahora' },
    'الصفحة الرئيسية': { en: 'Home page', fr: 'Page d’accueil', es: 'Página de inicio' },
    'الشروط والأحكام': { en: 'Terms & conditions', fr: 'Conditions d’utilisation', es: 'Términos y condiciones' },
    'آخر فحص': { en: 'Last checked', fr: 'Dernière vérification', es: 'Última comprobación' },

    // actions (machine translation gets these wrong, e.g. تثبيت -> "stabilisation")
    'تثبيت': { en: 'Install', fr: 'Installer', es: 'Instalar' },
    'تم التثبيت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'إلغاء التثبيت': { en: 'Uninstall', fr: 'Désinstaller', es: 'Desinstalar' },
    'تم إلغاء تثبيت التطبيق': { en: 'App uninstalled', fr: 'Application désinstallée', es: 'Aplicación desinstalada' },
    'جارٍ إلغاء التثبيت…': { en: 'Uninstalling…', fr: 'Désinstallation…', es: 'Desinstalando…' },
    'التطبيق غير مثبت على هذا الجهاز': { en: 'App is not installed on this device', fr: 'L’application n’est pas installée sur cet appareil', es: 'La aplicación no está instalada en este dispositivo' },
    'تعذّر فتح التطبيق': { en: 'Couldn’t open the app', fr: 'Impossible d’ouvrir l’application', es: 'No se pudo abrir la aplicación' },
    'غير متاح في هذا المتصفح': { en: 'Not available in this browser', fr: 'Non disponible dans ce navigateur', es: 'No disponible en este navegador' },
    'مثبت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'مثبّت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'فتح': { en: 'Open', fr: 'Ouvrir', es: 'Abrir' },
    'عرض': { en: 'View', fr: 'Voir', es: 'Ver' },
    'تنزيل': { en: 'Download', fr: 'Télécharger', es: 'Descargar' },
    'جارٍ التحميل…': { en: 'Downloading…', fr: 'Téléchargement…', es: 'Descargando…' },
    'سيتم التثبيت تلقائياً عند اكتمال التحميل.': { en: 'Installation will start automatically once download completes.', fr: 'L’installation démarrera automatiquement à la fin du téléchargement.', es: 'La instalación comenzará automáticamente al completar la descarga.' },
    'طلب تحديث': { en: 'Request update', fr: 'Demander une mise à jour', es: 'Solicitar actualización' },
    'إرسال الطلب': { en: 'Send request', fr: 'Envoyer la demande', es: 'Enviar solicitud' },
    'إبلاغ': { en: 'Report', fr: 'Signaler', es: 'Reportar' },
    'إبلاغ عن مشكلة': { en: 'Report a problem', fr: 'Signaler un problème', es: 'Reportar un problema' },
    'إبلاغ عن التطبيق': { en: 'Report app', fr: 'Signaler l’application', es: 'Reportar la aplicación' },
    'إرسال البلاغ': { en: 'Send report', fr: 'Envoyer le signalement', es: 'Enviar reporte' },

    'شبكة': { en: 'Grid', fr: 'Grille', es: 'Cuadrícula' },
    'قائمة': { en: 'List', fr: 'Liste', es: 'Lista' },

    // home sections / tabs
    'الأعلى تقييما': { en: 'Top rated', fr: 'Les mieux notés', es: 'Mejor valorados' },
    'موصى به لك': { en: 'Recommended for you', fr: 'Recommandé pour vous', es: 'Recomendado para ti' },
    'تطبيقات مماثلة': { en: 'Similar apps', fr: 'Applications similaires', es: 'Apps similares' },
    'ألعاب مماثلة': { en: 'Similar games', fr: 'Jeux similaires', es: 'Juegos similares' },
    'اختيارات المحررين': { en: 'Editors’ choice', fr: 'Choix de la rédaction', es: 'Selección del editor' },
    'ألعاب موصى بها': { en: 'Recommended games', fr: 'Jeux recommandés', es: 'Juegos recomendados' },
    'نتائج البحث': { en: 'Search results', fr: 'Résultats de recherche', es: 'Resultados de búsqueda' },

    // app detail labels
    'الوصف': { en: 'Description', fr: 'Description', es: 'Descripción' },
    'لقطات الشاشة': { en: 'Screenshots', fr: 'Captures d’écran', es: 'Capturas de pantalla' },
    'المطوّر': { en: 'Developer', fr: 'Développeur', es: 'Desarrollador' },
    'التصنيف': { en: 'Category', fr: 'Catégorie', es: 'Categoría' },
    'الإصدار': { en: 'Version', fr: 'Version', es: 'Versión' },
    'الإصدار الحالي': { en: 'Current version', fr: 'Version actuelle', es: 'Versión actual' },
    'الإصدار الجديد': { en: 'New version', fr: 'Nouvelle version', es: 'Nueva versión' },
    'رابط المصدر': { en: 'Source link', fr: 'Lien source', es: 'Enlace de origen' },
    'سبب البلاغ': { en: 'Reason', fr: 'Motif', es: 'Motivo' },
    'تفاصيل إضافية': { en: 'Additional details', fr: 'Détails supplémentaires', es: 'Detalles adicionales' },
    'الحجم': { en: 'Size', fr: 'Taille', es: 'Tamaño' },
    'اسم الحزمة': { en: 'Package name', fr: 'Nom du package', es: 'Nombre del paquete' },

    // account / misc
    'الوضع الفاتح': { en: 'Light mode', fr: 'Mode clair', es: 'Modo claro' },
    'الوضع الغامق': { en: 'Dark mode', fr: 'Mode sombre', es: 'Modo oscuro' },
    'اللغة': { en: 'Language', fr: 'Langue', es: 'Idioma' },

    // category names
    // App categories
    'ألعاب': { en: 'Games', fr: 'Jeux', es: 'Juegos' },
    'تواصل اجتماعي': { en: 'Social', fr: 'Social', es: 'Social' },
    'اتصالات': { en: 'Communication', fr: 'Communication', es: 'Comunicación' },
    'أدوات': { en: 'Tools', fr: 'Outils', es: 'Herramientas' },
    'إنتاجية': { en: 'Productivity', fr: 'Productivité', es: 'Productividad' },
    'ترفيه': { en: 'Entertainment', fr: 'Divertissement', es: 'Entretenimiento' },
    'تعليم': { en: 'Education', fr: 'Éducation', es: 'Educación' },
    'تصوير': { en: 'Photography', fr: 'Photographie', es: 'Fotografía' },
    'موسيقى وصوتيات': { en: 'Music & Audio', fr: 'Musique et audio', es: 'Música y audio' },
    'مشغّلات فيديو': { en: 'Video Players', fr: 'Lecteurs vidéo', es: 'Reproductores de video' },
    'مالية': { en: 'Finance', fr: 'Finance', es: 'Finanzas' },
    'تسوق': { en: 'Shopping', fr: 'Achats', es: 'Compras' },
    'أخبار ومجلات': { en: 'News & Magazines', fr: 'Actualités et magazines', es: 'Noticias y revistas' },
    'صحة ولياقة': { en: 'Health & Fitness', fr: 'Santé et remise en forme', es: 'Salud y bienestar' },
    'سفر ومحلّي': { en: 'Travel & Local', fr: 'Voyage et local', es: 'Viajes y local' },
    'طعام وشراب': { en: 'Food & Drink', fr: 'Nourriture et boisson', es: 'Comida y bebida' },
    'أسلوب حياة': { en: 'Lifestyle', fr: 'Style de vie', es: 'Estilo de vida' },
    'كتب ومراجع': { en: 'Books & Reference', fr: 'Livres et références', es: 'Libros y referencia' },
    'أعمال': { en: 'Business', fr: 'Affaires', es: 'Negocios' },
    'تعارف': { en: 'Dating', fr: 'Rencontres', es: 'Citas' },
    'خرائط وملاحة': { en: 'Maps & Navigation', fr: 'Cartes et navigation', es: 'Mapas y navegación' },
    'طبّي': { en: 'Medical', fr: 'Médical', es: 'Médico' },
    'تخصيص': { en: 'Personalization', fr: 'Personnalisation', es: 'Personalización' },
    'رياضة': { en: 'Sports', fr: 'Sports', es: 'Deportes' },
    'طقس': { en: 'Weather', fr: 'Météo', es: 'Clima' },
    'سيارات ومركبات': { en: 'Auto & Vehicles', fr: 'Auto et véhicules', es: 'Autos y vehículos' },
    'جمال وتجميل': { en: 'Beauty', fr: 'Beauté', es: 'Belleza' },
    'فنّ وتصميم': { en: 'Art & Design', fr: 'Art et design', es: 'Arte y diseño' },
    'منزل': { en: 'House & Home', fr: 'Maison', es: 'Casa y hogar' },
    'أبوّة وأمومة': { en: 'Parenting', fr: 'Parentalité', es: 'Paternidad' },
    'فعاليات': { en: 'Events', fr: 'Événements', es: 'Eventos' },
    'قصص مصوّرة': { en: 'Comics', fr: 'Bandes dessinées', es: 'Cómics' },
    'أخرى': { en: 'Other', fr: 'Autres', es: 'Otros' },
    // Game categories
    'أكشن': { en: 'Action', fr: 'Action', es: 'Acción' },
    'مغامرات': { en: 'Adventure', fr: 'Aventure', es: 'Aventura' },
    'أركيد': { en: 'Arcade', fr: 'Arcade', es: 'Arcade' },
    'ألعاب لوحية': { en: 'Board', fr: 'Plateau', es: 'Mesa' },
    'ورق (كوتشينة)': { en: 'Card', fr: 'Cartes', es: 'Cartas' },
    'كازينو': { en: 'Casino', fr: 'Casino', es: 'Casino' },
    'عادية': { en: 'Casual', fr: 'Casual', es: 'Casual' },
    'تعليمية': { en: 'Educational', fr: 'Éducatif', es: 'Educativo' },
    'ألغاز': { en: 'Puzzle', fr: 'Puzzle', es: 'Rompecabezas' },
    'سباقات': { en: 'Racing', fr: 'Course', es: 'Carreras' },
    'تقمّص أدوار': { en: 'Role Playing', fr: 'Jeu de rôle', es: 'Rol' },
    'محاكاة': { en: 'Simulation', fr: 'Simulation', es: 'Simulación' },
    'رياضية': { en: 'Sports', fr: 'Sports', es: 'Deportes' },
    'استراتيجية': { en: 'Strategy', fr: 'Stratégie', es: 'Estrategia' },
    'معلومات عامة': { en: 'Trivia', fr: 'Quiz', es: 'Trivia' },
    'كلمات': { en: 'Word', fr: 'Mots', es: 'Palabras' },
    'ألعاب أخرى': { en: 'Other Games', fr: 'Autres jeux', es: 'Otros juegos' },
    'VPN وخصوصية': { en: 'VPN & Privacy', fr: 'VPN et confidentialité', es: 'VPN y privacidad' },
    'أدوات النظام': { en: 'System Tools', fr: 'Outils système', es: 'Herramientas del sistema' },
    'خلفيات': { en: 'Wallpapers', fr: 'Fonds d’écran', es: 'Fondos de pantalla' },
    'إدارة الملفات': { en: 'File Management', fr: 'Gestionnaire de fichiers', es: 'Gestión de archivos' },
    'اتصال وشبكات': { en: 'Connectivity', fr: 'Connectivité', es: 'Conectividad' },
    'عائلية': { en: 'Family', fr: 'Famille', es: 'Familiar' },
    'إطلاق نار': { en: 'Shooter', fr: 'Tir', es: 'Disparos' },
    'حركة ومغامرة': { en: 'Action & Adventure', fr: 'Action et aventure', es: 'Acción y aventura' },
    'ألعاب جماعية': { en: 'Role Playing', fr: 'Jeu de rôle', es: 'Juego de rol' },
    'موسيقى': { en: 'Music', fr: 'Musique', es: 'Música' },

    // empty / status
    'لا توجد نتائج': { en: 'No results', fr: 'Aucun résultat', es: 'Sin resultados' },
    'لا توجد تطبيقات بعد': { en: 'No apps yet', fr: 'Aucune application pour l’instant', es: 'Aún no hay aplicaciones' },
    'لا توجد ألعاب بعد': { en: 'No games yet', fr: 'Aucun jeu pour l’instant', es: 'Aún no hay juegos' },
    'لا توجد ألعاب مقيّمة بعد': { en: 'No rated games yet', fr: 'Aucun jeu noté pour l’instant', es: 'Aún no hay juegos valorados' },
    'لا توجد تطبيقات مقيّمة بعد': { en: 'No rated apps yet', fr: 'Aucune app notée pour l’instant', es: 'Aún no hay apps valoradas' },
    'لا توجد تطبيقات مميّزة بعد': { en: 'No featured apps yet', fr: 'Aucune app en vedette pour l’instant', es: 'Aún no hay apps destacadas' },
    'لا توجد مراجعات بعد. كن أول من يكتب مراجعة!': { en: 'No reviews yet. Be the first to write one!', fr: 'Aucun avis. Soyez le premier !', es: '¡Aún no hay reseñas. Sé el primero!' },
    'لا توجد تطبيقات في هذه الفئة بعد.': { en: 'No apps in this category yet.', fr: 'Aucune app dans cette catégorie.', es: 'Aún no hay apps en esta categoría.' },
    'ستظهر هنا اختيارات المحرّرين فور إضافتها من لوحة الإدارة.': { en: 'Editors’ picks will appear here once added from admin.', fr: 'Les choix de la rédaction apparaîtront ici.', es: 'Las selecciones del editor aparecerán aquí.' },
    'ستظهر هنا التطبيقات التي قمت بتحميلها لتسهيل إعادة تحميلها في أي وقت.': { en: 'Apps you’ve downloaded will appear here for easy reinstall.', fr: 'Les apps téléchargées apparaîtront ici.', es: 'Las apps descargadas aparecerán aquí.' },
    'ميّز تطبيقاً كـ«لعبة» من لوحة التحكم لتظهر هنا.': { en: 'Mark an app as "game" from admin to show here.', fr: 'Marquez une app comme « jeu » depuis l’admin.', es: 'Marca una app como "juego" desde el admin.' },
    'قيّم الألعاب لتظهر هنا الأعلى تقييماً.': { en: 'Rate games to see top-rated ones here.', fr: 'Notez des jeux pour voir les mieux notés ici.', es: 'Valora juegos para ver los mejor valorados aquí.' },
    'قيّم التطبيقات لتظهر هنا الأعلى تقييماً.': { en: 'Rate apps to see top-rated ones here.', fr: 'Notez des apps pour voir les mieux notées ici.', es: 'Valora apps para ver las mejor valoradas aquí.' },
    'لم نجد تطبيقات تطابق': { en: 'No apps matching', fr: 'Aucune app correspondant à', es: 'No encontramos apps que coincidan con' },

    // ratings & reviews
    'تقييم': { en: 'ratings', fr: 'évaluations', es: 'valoraciones' },
    'تقييمات': { en: 'ratings', fr: 'évaluations', es: 'valoraciones' },
    'تقييمك': { en: 'Your rating', fr: 'Votre note', es: 'Tu valoración' },
    'نجوم': { en: 'stars', fr: 'étoiles', es: 'estrellas' },
    'من': { en: 'of', fr: 'sur', es: 'de' },
    'كن أول من يقيّم هذا التطبيق': { en: 'Be the first to rate this app', fr: 'Soyez le premier à noter cette app', es: 'Sé el primero en valorar esta app' },
    'قيّم واكتب مراجعتك': { en: 'Rate and write your review', fr: 'Notez et écrivez votre avis', es: 'Valora y escribe tu reseña' },
    'تنشر باسم حسابك': { en: 'Published as your account', fr: 'Publié sous votre compte', es: 'Publicado con tu cuenta' },
    'شارك رأيك في هذا التطبيق…': { en: 'Share your thoughts about this app…', fr: 'Partagez votre avis sur cette app…', es: 'Comparte tu opinión sobre esta app…' },
    'نشر المراجعة': { en: 'Post review', fr: 'Publier l’avis', es: 'Publicar reseña' },
    'لقد قيّمت هذا التطبيق مسبقاً': { en: 'You’ve already rated this app', fr: 'Vous avez déjà noté cette app', es: 'Ya valoraste esta app' },
    'لقد قيّمت هذا التطبيق': { en: 'You’ve rated this app', fr: 'Vous avez noté cette app', es: 'Ya valoraste esta app' },
    'اختر عدد النجوم أولاً': { en: 'Select a star rating first', fr: 'Sélectionnez d’abord un nombre d’étoiles', es: 'Selecciona estrellas primero' },
    'شكراً لمراجعتك!': { en: 'Thanks for your review!', fr: 'Merci pour votre avis !', es: '¡Gracias por tu reseña!' },
    'تعذّر إرسال المراجعة': { en: 'Failed to submit review', fr: 'Échec de l’envoi de l’avis', es: 'Error al enviar la reseña' },
    'التقييمات والمراجعات': { en: 'Ratings & Reviews', fr: 'Notes et avis', es: 'Valoraciones y reseñas' },
    'مستخدم': { en: 'User', fr: 'Utilisateur', es: 'Usuario' },

    // app detail & install
    'تعذّر الاتصال بالخادم': { en: 'Could not connect to server', fr: 'Impossible de se connecter au serveur', es: 'No se pudo conectar al servidor' },
    'التطبيق غير موجود': { en: 'App not found', fr: 'Application introuvable', es: 'Aplicación no encontrada' },
    'لا يوجد تطبيق محدد': { en: 'No app specified', fr: 'Aucune app spécifiée', es: 'No se especificó una app' },
    'العودة للرئيسية': { en: 'Go to home', fr: 'Retour à l’accueil', es: 'Ir al inicio' },
    'لمحة عن هذا التطبيق': { en: 'About this app', fr: 'À propos de cette app', es: 'Sobre esta app' },
    'تنزيلات': { en: 'Downloads', fr: 'Téléchargements', es: 'Descargas' },
    'أندرويد': { en: 'Android', fr: 'Android', es: 'Android' },
    'شريحة': { en: 'Slide', fr: 'Diapositive', es: 'Diapositiva' },
    'تطبيق': { en: 'app', fr: 'application', es: 'aplicación' },
    'اكتمل التحميل وحفظ الملف في جهازك': { en: 'Download complete, file saved', fr: 'Téléchargement terminé, fichier enregistré', es: 'Descarga completa, archivo guardado' },
    'سيتم تنزيل ملف APK': { en: 'APK file will be downloaded', fr: 'Le fichier APK sera téléchargé', es: 'Se descargará el archivo APK' },
    'تعذر عرض شريط التقدم، وبدأ التنزيل بالطريقة العادية': { en: 'Progress bar unavailable, download started normally', fr: 'Barre de progression indisponible, téléchargement lancé', es: 'Barra de progreso no disponible, descarga iniciada' },
    'مشاركة': { en: 'Share', fr: 'Partager', es: 'Compartir' },
    'تم نسخ الرابط': { en: 'Link copied', fr: 'Lien copié', es: 'Enlace copiado' },
    'خيارات إضافية': { en: 'More options', fr: 'Plus d’options', es: 'Más opciones' },

    // report / update request
    'التطبيق فيه فيروس': { en: 'App contains a virus', fr: 'L’application contient un virus', es: 'La app contiene un virus' },
    'رابط التحميل لا يعمل': { en: 'Download link not working', fr: 'Le lien ne fonctionne pas', es: 'El enlace de descarga no funciona' },
    'محتوى غير لائق': { en: 'Inappropriate content', fr: 'Contenu inapproprié', es: 'Contenido inapropiado' },
    'انتهاك حقوق نشر': { en: 'Copyright violation', fr: 'Violation de droits d’auteur', es: 'Violación de derechos de autor' },
    'معلومات خاطئة': { en: 'False information', fr: 'Informations erronées', es: 'Información falsa' },
    'سبب آخر': { en: 'Other reason', fr: 'Autre raison', es: 'Otro motivo' },
    'يرجى ملء الحقول المطلوبة': { en: 'Please fill required fields', fr: 'Veuillez remplir les champs requis', es: 'Completa los campos requeridos' },
    'تم إرسال طلبك إلى الإدارة': { en: 'Your request has been sent', fr: 'Votre demande a été envoyée', es: 'Tu solicitud ha sido enviada' },

    // auth / login
    'متابعة': { en: 'Continue', fr: 'Continuer', es: 'Continuar' },
    'متابعة باستخدام Google': { en: 'Continue with Google', fr: 'Continuer avec Google', es: 'Continuar con Google' },
    'بالمتابعة فإنك توافق على شروط الاستخدام وسياسة الخصوصية لـ Golden Store.': { en: 'By continuing, you agree to Golden Store terms and privacy policy.', fr: 'En continuant, vous acceptez les conditions de Golden Store.', es: 'Al continuar, aceptas los términos de Golden Store.' },
    'جار تسجيل الدخول…': { en: 'Signing in…', fr: 'Connexion…', es: 'Iniciando sesión…' },
    'حسابك': { en: 'Your account', fr: 'Votre compte', es: 'Tu cuenta' },

    // minimal search (2026-11)
    'ابحث عن تطبيق أو لعبة أو مطوّر': { en: 'Search apps, games or developers', fr: 'Rechercher apps, jeux ou développeurs', es: 'Buscar apps, juegos o desarrolladores' },
    'الأكثر تحميلاً': { en: 'Most downloaded', fr: 'Les plus téléchargés', es: 'Los más descargados' },
    'جرّب كلمة أخرى أو تحقّق من الكتابة.': { en: 'Try another word or check the spelling.', fr: 'Essayez un autre mot ou vérifiez l’orthographe.', es: 'Prueba otra palabra o revisa la ortografía.' },
    'ستظهر التطبيقات هنا فور إضافتها.': { en: 'Apps will appear here as soon as they are added.', fr: 'Les applications apparaîtront ici dès leur ajout.', es: 'Las apps aparecerán aquí en cuanto se añadan.' },
    'نتيجة': { en: 'result', fr: 'résultat', es: 'resultado' },
    'نتائج': { en: 'results', fr: 'résultats', es: 'resultados' },
    'تطبيقات': { en: 'apps', fr: 'applications', es: 'aplicaciones' },
    'بحث — Golden Store': { en: 'Search — Golden Store', fr: 'Recherche — Golden Store', es: 'Buscar — Golden Store' },
    'ابحث عن التطبيقات والألعاب في Golden Store.': {
      en: 'Search apps and games on Golden Store.',
      fr: 'Recherchez des applications et des jeux sur Golden Store.',
      es: 'Busca aplicaciones y juegos en Golden Store.',
    },

    // legal pages / mandatory consent (2026-11)
    'محتويات الصفحة': { en: 'On this page', fr: 'Sommaire', es: 'En esta página' },
    'من نحن — Golden Store': { en: 'About us — Golden Store', fr: 'À propos — Golden Store', es: 'Sobre nosotros — Golden Store' },
    'سياسة الخصوصية — Golden Store': { en: 'Privacy Policy — Golden Store', fr: 'Politique de confidentialité — Golden Store', es: 'Política de privacidad — Golden Store' },
    'شروط الخدمة — Golden Store': { en: 'Terms of Service — Golden Store', fr: 'Conditions d’utilisation — Golden Store', es: 'Términos del servicio — Golden Store' },
    'من نحن': { en: 'About us', fr: 'À propos', es: 'Sobre nosotros' },
    'سياسة الخصوصية': { en: 'Privacy Policy', fr: 'Politique de confidentialité', es: 'Política de privacidad' },
    'شروط الخدمة': { en: 'Terms of Service', fr: 'Conditions d’utilisation', es: 'Términos del servicio' },
    'الصفحات القانونية': { en: 'Legal', fr: 'Mentions légales', es: 'Información legal' },
    'روابط قانونية': { en: 'Legal links', fr: 'Liens légaux', es: 'Enlaces legales' },
    'الموقع الرسمي': { en: 'Official website', fr: 'Site officiel', es: 'Sitio oficial' },
    'جميع الحقوق محفوظة': { en: 'All rights reserved', fr: 'Tous droits réservés', es: 'Todos los derechos reservados' },
    'آخر تحديث': { en: 'Last updated', fr: 'Dernière mise à jour', es: 'Última actualización' },
    'تاريخ النشر': { en: 'Published', fr: 'Publié le', es: 'Publicado el' },
    'أوافق على': { en: 'I agree to the', fr: 'J’accepte les', es: 'Acepto los' },
    'و': { en: 'and', fr: 'et', es: 'y' },
    'يجب الموافقة على شروط الخدمة وسياسة الخصوصية قبل المتابعة.': {
      en: 'You must accept the Terms of Service and Privacy Policy to continue.',
      fr: 'Vous devez accepter les conditions d’utilisation et la politique de confidentialité pour continuer.',
      es: 'Debes aceptar los Términos del servicio y la Política de privacidad para continuar.',
    },

    // account / library
    'تطبيق في مكتبتك': { en: 'app in your library', fr: 'app dans votre bibliothèque', es: 'app en tu biblioteca' },
    'حذف سجل التحميلات بالكامل؟': { en: 'Clear entire download history?', fr: 'Effacer tout l’historique ?', es: '¿Borrar todo el historial de descargas?' },
    'تم مسح السجل': { en: 'History cleared', fr: 'Historique effacé', es: 'Historial borrado' },

    // misc
    'ابحث عن التطبيقات والألعاب': { en: 'Search apps & games', fr: 'Rechercher des apps et jeux', es: 'Buscar apps y juegos' },
    'اختيارات المحرّرين المنتقاة لك': { en: 'Editors’ picks curated for you', fr: 'Sélection de la rédaction pour vous', es: 'Selección del editor para ti' },
    'الخدمة غير متاحة مؤقتا': { en: 'Service temporarily unavailable', fr: 'Service temporairement indisponible', es: 'Servicio temporalmente no disponible' },
    'الرابط غير صحيح.': { en: 'Invalid link.', fr: 'Lien invalide.', es: 'Enlace no válido.' },
    'تصفّح حسب الفئة': { en: 'Browse by category', fr: 'Parcourir par catégorie', es: 'Explorar por categoría' },
    'المميّزة': { en: 'Featured', fr: 'En vedette', es: 'Destacados' },

    // admin UI labels
    'لوحة التحكم': { en: 'Admin panel', fr: 'Panneau d’admin', es: 'Panel de admin' },
    'لوحة المعلومات': { en: 'Dashboard', fr: 'Tableau de bord', es: 'Panel' },
    'التطبيقات': { en: 'Apps', fr: 'Applications', es: 'Aplicaciones' },
    'الألعاب': { en: 'Games', fr: 'Jeux', es: 'Juegos' },
    'إضافة جديد': { en: 'Add new', fr: 'Ajouter', es: 'Añadir' },
    'الطلبات والبلاغات': { en: 'Requests & reports', fr: 'Demandes et signalements', es: 'Solicitudes y reportes' },
    'الإشعارات': { en: 'Notifications', fr: 'Notifications', es: 'Notificaciones' },
    'تحديث التطبيق': { en: 'App update', fr: 'Mise à jour de l’app', es: 'Actualización de la app' },
    'الاسم': { en: 'Name', fr: 'Nom', es: 'Nombre' },
    'التصنيف': { en: 'Category', fr: 'Catégorie', es: 'Categoría' },
    'الإصدار': { en: 'Version', fr: 'Version', es: 'Versión' },
    'الحجم': { en: 'Size', fr: 'Taille', es: 'Tamaño' },
    'التنزيلات': { en: 'Downloads', fr: 'Téléchargements', es: 'Descargas' },
    'الإجراءات': { en: 'Actions', fr: 'Actions', es: 'Acciones' },
    'عرض': { en: 'View', fr: 'Voir', es: 'Ver' },
    'تعديل': { en: 'Edit', fr: 'Modifier', es: 'Editar' },
    'حذف': { en: 'Delete', fr: 'Supprimer', es: 'Eliminar' },
    'دخول مباشر': { en: 'Sign in', fr: 'Connexion', es: 'Iniciar sesión' },
    'كلمة مرور الإدارة': { en: 'Admin password', fr: 'Mot de passe admin', es: 'Contraseña de admin' },
    'كلمة المرور': { en: 'Password', fr: 'Mot de passe', es: 'Contraseña' },
    'كلمة المرور غير صحيحة': { en: 'Incorrect password', fr: 'Mot de passe incorrect', es: 'Contraseña incorrecta' },
    'إجمالي التطبيقات': { en: 'Total apps', fr: 'Total apps', es: 'Total apps' },
    'إجمالي التنزيلات': { en: 'Total downloads', fr: 'Total des téléchargements', es: 'Descargas totales' },
    'حجم التخزين': { en: 'Storage size', fr: 'Espace stockage', es: 'Tamaño de almacenamiento' },
    'الأكثر تنزيلاً': { en: 'Most downloaded', fr: 'Les plus téléchargés', es: 'Más descargados' },
    'صيانة': { en: 'Maintenance', fr: 'Maintenance', es: 'Mantenimiento' },
    'تعيين النوع للعناصر القديمة': { en: 'Set type for old items', fr: 'Définir le type des anciens éléments', es: 'Establecer tipo para elementos antiguos' },
    'لا توجد بيانات بعد': { en: 'No data yet', fr: 'Aucune donnée', es: 'Aún no hay datos' },
    'ارفع تطبيقك الأول لرؤية الإحصائيات.': { en: 'Upload your first app to see stats.', fr: 'Uploadez votre première app.', es: 'Sube tu primera app para ver estadísticas.' },
    'لا توجد طلبات أو بلاغات': { en: 'No requests or reports', fr: 'Aucune demande ni signalement', es: 'No hay solicitudes ni reportes' },
    'ستظهر هنا طلبات التحديث والبلاغات الواردة من المستخدمين.': { en: 'Update requests and reports will appear here.', fr: 'Les demandes de mise à jour et signalements apparaîtront ici.', es: 'Las solicitudes de actualización y reportes aparecerán aquí.' },
    'عنوان الإشعار': { en: 'Notification title', fr: 'Titre de notification', es: 'Título de notificación' },
    'النص': { en: 'Body', fr: 'Texte', es: 'Texto' },
    'نشر إشعار': { en: 'Publish notification', fr: 'Publier notification', es: 'Publicar notificación' },
    'إشعار تجريبي': { en: 'Test notification', fr: 'Notification test', es: 'Notificación de prueba' },
    'تم إرسال إشعار تجريبي': { en: 'Test notification sent', fr: 'Notification test envoyée', es: 'Notificación de prueba enviada' },
    'تم نشر الإشعار': { en: 'Notification published', fr: 'Notification publiée', es: 'Notificación publicada' },
    'لا توجد إشعارات بعد': { en: 'No notifications yet', fr: 'Aucune notification', es: 'Aún no hay notificaciones' },
    'ستظهر هنا الإشعارات المنشورة والتنبيهات الآلية.': { en: 'Published notifications and alerts will appear here.', fr: 'Les notifications publiées apparaîtront ici.', es: 'Las notificaciones publicadas aparecerán aquí.' },
    'أدخل عنوان الإشعار': { en: 'Enter notification title', fr: 'Entrez le titre', es: 'Ingrese el título' },
    'تم الحذف': { en: 'Deleted', fr: 'Supprimé', es: 'Eliminado' },
    'تعذر الحذف': { en: 'Delete failed', fr: 'Échec de suppression', es: 'Error al eliminar' },
    'تعذر النشر': { en: 'Publish failed', fr: 'Échec de publication', es: 'Error al publicar' },
    'إضافة تطبيق': { en: 'Add app', fr: 'Ajouter app', es: 'Añadir app' },
    'إضافة لعبة': { en: 'Add game', fr: 'Ajouter jeu', es: 'Añadir juego' },
    'إضافة تطبيق جديد': { en: 'Add new app', fr: 'Nouvelle app', es: 'Nueva app' },
    'إضافة لعبة جديدة': { en: 'Add new game', fr: 'Nouveau jeu', es: 'Nuevo juego' },
    'اسم الحزمة': { en: 'Package name', fr: 'Nom du package', es: 'Nombre del paquete' },
    'المطوّر': { en: 'Developer', fr: 'Développeur', es: 'Desarrollador' },
    'وصف مختصر': { en: 'Short description', fr: 'Description courte', es: 'Descripción corta' },
    'الوصف الكامل': { en: 'Full description', fr: 'Description complète', es: 'Descripción completa' },
    'اسم الإصدار': { en: 'Version name', fr: 'Nom de version', es: 'Nombre de versión' },
    'رمز الإصدار': { en: 'Version code', fr: 'Code de version', es: 'Código de versión' },
    'الحد الأدنى لـ Android SDK': { en: 'Minimum Android SDK', fr: 'SDK Android minimum', es: 'SDK Android mínimo' },
    'ملف APK': { en: 'APK file', fr: 'Fichier APK', es: 'Archivo APK' },
    'الأيقونة': { en: 'Icon', fr: 'Icône', es: 'Icono' },
    'الصورة العرضية': { en: 'Feature graphic', fr: 'Image de mise en avant', es: 'Imagen destacada' },
    'لقطات الشاشة': { en: 'Screenshots', fr: 'Captures d’écran', es: 'Capturas de pantalla' },
    'رفع التطبيق': { en: 'Upload app', fr: 'Uploader app', es: 'Subir app' },
    'صورة التطبيق': { en: 'App icon', fr: 'Icône de l’application', es: 'Icono de la app' },
    'اضغط لتكبير صورة التطبيق': { en: 'Tap to enlarge the app icon', fr: 'Toucher pour agrandir l’icône', es: 'Toca para ampliar el icono' },
    'الفيديوهات واللقطات': { en: 'Videos & screenshots', fr: 'Vidéos et captures', es: 'Videos y capturas' },
    'فيديو': { en: 'Video', fr: 'Vidéo', es: 'Video' },
    'فيديو يوتيوب': { en: 'YouTube video', fr: 'Vidéo YouTube', es: 'Video de YouTube' },
    'شورت': { en: 'Short', fr: 'Short', es: 'Short' },
    'شورت يوتيوب': { en: 'YouTube Short', fr: 'Short YouTube', es: 'Short de YouTube' },
    'فيديوهات يوتيوب': { en: 'YouTube videos', fr: 'Vidéos YouTube', es: 'Videos de YouTube' },
    'روابط فيديوهات يوتيوب': { en: 'YouTube video links', fr: 'Liens vidéo YouTube', es: 'Enlaces de videos de YouTube' },
    'فيديوهات التطبيق': { en: 'App videos', fr: 'Vidéos de l’application', es: 'Videos de la app' },
    'رابط فيديو يوتيوب': { en: 'YouTube video link', fr: 'Lien vidéo YouTube', es: 'Enlace de video de YouTube' },
    'عنوان الفيديو (اختياري)': { en: 'Video title (optional)', fr: 'Titre de la vidéo (facultatif)', es: 'Título del video (opcional)' },
    'نوع الفيديو': { en: 'Video type', fr: 'Type de vidéo', es: 'Tipo de video' },
    'اكتشاف تلقائي': { en: 'Auto-detect', fr: 'Détection automatique', es: 'Detección automática' },
    'فيديو عادي': { en: 'Regular video', fr: 'Vidéo classique', es: 'Video normal' },
    'إضافة فيديو': { en: 'Add video', fr: 'Ajouter une vidéo', es: 'Añadir video' },
    'حذف الفيديو': { en: 'Delete video', fr: 'Supprimer la vidéo', es: 'Eliminar video' },
    'فتح في يوتيوب': { en: 'Open on YouTube', fr: 'Ouvrir sur YouTube', es: 'Abrir en YouTube' },
    'إغلاق الفيديو': { en: 'Close video', fr: 'Fermer la vidéo', es: 'Cerrar video' },
    'شاهد الفيديو': { en: 'Watch video', fr: 'Regarder la vidéo', es: 'Ver video' },
    'عرض الفيديو': { en: 'Play video', fr: 'Lire la vidéo', es: 'Reproducir video' },
    'صورة مصغّرة للفيديو': { en: 'Video thumbnail', fr: 'Miniature de la vidéo', es: 'Miniatura del video' },
    'صورة مصغّرة مخصّصة (اختياري)': { en: 'Custom thumbnail (optional)', fr: 'Miniature personnalisée (facultatif)', es: 'Miniatura personalizada (opcional)' },
    'تغيير الصورة المصغّرة': { en: 'Change thumbnail', fr: 'Changer la miniature', es: 'Cambiar miniatura' },
    'استخدام صورة يوتيوب': { en: 'Use YouTube thumbnail', fr: 'Utiliser la miniature YouTube', es: 'Usar miniatura de YouTube' },
    'صورة مخصّصة': { en: 'Custom thumbnail', fr: 'Miniature personnalisée', es: 'Miniatura personalizada' },
    'تم تحديث الصورة المصغّرة': { en: 'Thumbnail updated', fr: 'Miniature mise à jour', es: 'Miniatura actualizada' },
    'فشل تحديث الصورة المصغّرة': { en: 'Could not update the thumbnail', fr: 'Impossible de mettre à jour la miniature', es: 'No se pudo actualizar la miniatura' },
    'تُستخدم صورة يوتيوب تلقائياً عند ترك هذا الحقل فارغاً': { en: 'YouTube\'s poster is used automatically when left empty', fr: 'La miniature YouTube est utilisée automatiquement si ce champ est vide', es: 'Se usa la miniatura de YouTube automáticamente si se deja vacío' },
    'يفضّل صورة أفقية 16:9 للفيديو وعمودية 9:16 للشورت': { en: 'Prefer a 16:9 landscape poster for videos and 9:16 portrait for Shorts', fr: 'Préférez une image 16:9 paysage pour les vidéos et 9:16 portrait pour les Shorts', es: 'Prefiere una imagen 16:9 horizontal para videos y 9:16 vertical para Shorts' },
    'فشل رفع الصورة المصغّرة': { en: 'Could not upload the thumbnail', fr: 'Impossible de téléverser la miniature', es: 'No se pudo subir la miniatura' },
    'لا توجد فيديوهات بعد': { en: 'No videos yet', fr: 'Aucune vidéo pour le moment', es: 'Aún no hay videos' },
    'حذف هذا الفيديو؟': { en: 'Delete this video?', fr: 'Supprimer cette vidéo ?', es: '¿Eliminar este video?' },
    'رابط يوتيوب غير صالح': { en: 'Invalid YouTube link', fr: 'Lien YouTube invalide', es: 'Enlace de YouTube no válido' },
    'تمت إضافة الفيديو': { en: 'Video added', fr: 'Vidéo ajoutée', es: 'Video añadido' },
    'تم حذف الفيديو': { en: 'Video deleted', fr: 'Vidéo supprimée', es: 'Video eliminado' },
    'فشل إضافة الفيديو': { en: 'Could not add the video', fr: 'Impossible d’ajouter la vidéo', es: 'No se pudo añadir el video' },
    'فشل حذف الفيديو': { en: 'Could not delete the video', fr: 'Impossible de supprimer la vidéo', es: 'No se pudo eliminar el video' },
    'أضف روابط فيديوهات يوتيوب': { en: 'Add YouTube video links', fr: 'Ajouter des liens vidéo YouTube', es: 'Añadir enlaces de videos de YouTube' },
    'إلغاء': { en: 'Cancel', fr: 'Annuler', es: 'Cancelar' },
    'البيانات الأساسية': { en: 'Basic info', fr: 'Informations de base', es: 'Información básica' },
    'تحديث ملف APK': { en: 'Update APK file', fr: 'Mettre à jour APK', es: 'Actualizar archivo APK' },
    'حفظ التغييرات': { en: 'Save changes', fr: 'Enregistrer', es: 'Guardar cambios' },
    'استبدال الأيقونة': { en: 'Replace icon', fr: 'Remplacer icône', es: 'Reemplazar icono' },
    'حفظ الصورة العرضية': { en: 'Save feature graphic', fr: 'Enregistrer image', es: 'Guardar imagen destacada' },
    'إضافة لقطات': { en: 'Add screenshots', fr: 'Ajouter captures', es: 'Añadir capturas' },
    'تم رفع التطبيق بنجاح': { en: 'App uploaded successfully', fr: 'App uploadée', es: 'App subida' },
    'فشل الرفع': { en: 'Upload failed', fr: 'Échec upload', es: 'Error al subir' },
    'فشل الحذف': { en: 'Delete failed', fr: 'Échec suppression', es: 'Error al eliminar' },
    'حذف «': { en: 'Delete «', fr: 'Supprimer «', es: 'Eliminar «' },
    '» نهائياً؟': { en: '» permanently?', fr: '» définitivement ?', es: '» permanentemente?' },
    'تم الحفظ': { en: 'Saved', fr: 'Enregistré', es: 'Guardado' },
    'فشل الحفظ': { en: 'Save failed', fr: 'Échec enregistrement', es: 'Error al guardar' },
    'تم تحديث APK': { en: 'APK updated', fr: 'APK mis à jour', es: 'APK actualizado' },
    'فشل التحديث': { en: 'Update failed', fr: 'Mise à jour échouée', es: 'Actualización fallida' },
    'تم التحديث بنجاح': { en: 'Update completed', fr: 'Mise à jour terminée', es: 'Actualización completada' },
    'تعارض توقيع الحزمة: ألغِ التطبيق المثبت ثم ثبّت النسخة الجديدة.': { en: 'Signature conflict: uninstall the existing app, then install the new version.', fr: 'Conflit de signature : désinstallez l’application existante, puis installez la nouvelle version.', es: 'Conflicto de firma: desinstale la aplicación existente, luego instale la nueva versión.' },
    'اسم الحزمة غير متطابق مع التطبيق.': { en: 'Package name does not match the app.', fr: 'Le nom du package ne correspond pas à l’application.', es: 'El nombre del paquete no coincide con la aplicación.' },
    'تعذّر قراءة ملف APK.': { en: 'Could not read APK file.', fr: 'Impossible de lire le fichier APK.', es: 'No se pudo leer el archivo APK.' },
    'فشل التثبيت.': { en: 'Installation failed.', fr: 'Échec de l’installation.', es: 'Error de instalación.' },
    'ملف التحميل مفقود.': { en: 'Downloaded file is missing.', fr: 'Le fichier téléchargé est introuvable.', es: 'Falta el archivo descargado.' },
    'تعذّر تحديث التطبيق. حاول إلغاء التثبيت وإعادة المحاولة.': { en: 'Could not update the app. Try uninstalling and retrying.', fr: 'Impossible de mettre à jour l’application. Essayez de la désinstaller et réessayez.', es: 'No se pudo actualizar la aplicación. Intente desinstalar y volver a intentar.' },
    'اختر ملف APK': { en: 'Select APK file', fr: 'Choisir APK', es: 'Seleccionar APK' },
    'اختر صورة': { en: 'Select image', fr: 'Choisir image', es: 'Seleccionar imagen' },
    'اختر صور': { en: 'Select images', fr: 'Choisir images', es: 'Seleccionar imágenes' },
    'حذف هذه اللقطة؟': { en: 'Delete this screenshot?', fr: 'Supprimer cette capture ?', es: '¿Eliminar captura?' },

    // app update feature
    'تحديث جديد متاح': { en: 'New update available', fr: 'Nouvelle mise à jour', es: 'Nueva actualización disponible' },
    'يتوفر إصدار جديد من التطبيق. حمّله الآن للحصول على أحدث الميزات والإصلاحات.': { en: 'A new app version is available. Download now for the latest features and fixes.', fr: 'Une nouvelle version est disponible. Téléchargez maintenant.', es: 'Hay una nueva versión disponible. Descárgala ahora.' },
    'تحميل الآن': { en: 'Download now', fr: 'Télécharger', es: 'Descargar ahora' },
    'لاحقاً': { en: 'Later', fr: 'Plus tard', es: 'Más tarde' },
    'تحديث Golden Store': { en: 'Golden Store update', fr: 'Mise à jour Golden Store', es: 'Actualización de Golden Store' },
    'نسخة جديدة من Golden Store جاهزة للتثبيت.': { en: 'A new Golden Store version is ready to install.', fr: 'Une nouvelle version de Golden Store est prête à installer.', es: 'Hay una nueva versión de Golden Store lista para instalar.' },
    'ما الجديد': { en: "What's new", fr: 'Nouveautés', es: 'Novedades' },
    'لا يوجد اتصال بالإنترنت': { en: 'No internet connection', fr: 'Pas de connexion Internet', es: 'Sin conexión a Internet' },
    'تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.': { en: 'Check your internet connection and try again.', fr: 'Vérifiez votre connexion Internet puis réessayez.', es: 'Verifica tu conexión a Internet e inténtalo de nuevo.' },
    'إصدار التطبيق': { en: 'App version', fr: 'Version de l’app', es: 'Versión de la app' },
    'ملاحظات التحديث': { en: 'Update notes', fr: 'Notes de mise à jour', es: 'Notas de actualización' },
    'رابط تحميل التطبيق': { en: 'App download link', fr: 'Lien de téléchargement', es: 'Enlace de descarga' },
    'تم حفظ الرابط': { en: 'Link saved', fr: 'Lien enregistré', es: 'Enlace guardado' },
    'إرسال إشعار للمستخدمين': { en: 'Send notification to users', fr: 'Envoyer notification', es: 'Enviar notificación' },
    'نشر التحديث': { en: 'Publish update', fr: 'Publier la mise à jour', es: 'Publicar actualización' },
    'رفع تحديث التطبيق': { en: 'Upload app update', fr: 'Uploader la mise à jour', es: 'Subir actualización' },
    'تم نشر التحديث': { en: 'Update published', fr: 'Mise à jour publiée', es: 'Actualización publicada' },
    'فشل نشر التحديث': { en: 'Failed to publish update', fr: 'Échec publication', es: 'Error al publicar' },
    'اختر ملف APK أولاً': { en: 'Select an APK file first', fr: 'Choisissez d’abord un APK', es: 'Seleccione primero un APK' },
    'جارٍ رفع APK…': { en: 'Uploading APK…', fr: 'Upload APK…', es: 'Subiendo APK…' },
    'الإشعار': { en: 'Notification', fr: 'Notification', es: 'Notificación' },
    'الإصدار الحالي': { en: 'Current version', fr: 'Version actuelle', es: 'Versión actual' },
    'إصدار': { en: 'Version', fr: 'Version', es: 'Versión' },
    'إشعار': { en: 'Notification', fr: 'Notification', es: 'Notificación' },
    'إعادة المحاولة': { en: 'Retry', fr: 'Réessayer', es: 'Reintentar' },
    'اختيارات المحرّرين': { en: 'Editor picks', fr: 'Sélection de la rédaction', es: 'Selección del editor' },
    'افتح الرابط في المتصفح الخارجي لتسجيل الدخول': { en: 'Open the link in an external browser to sign in', fr: 'Ouvrez le lien dans un navigateur externe pour vous connecter', es: 'Abre el enlace en un navegador externo para iniciar sesión' },
    'اكتمل التحميل': { en: 'Download completed', fr: 'Téléchargement terminé', es: 'Descarga completada' },
    'الأعلى تقييماً': { en: 'Highest rated', fr: 'Les mieux notés', es: 'Mejor valorados' },
    'الأكثر رواجًا': { en: 'Most popular', fr: 'Les plus populaires', es: 'Más populares' },
    'الخدمة غير متاحة مؤقتاً': { en: 'Service temporarily unavailable', fr: 'Service temporairement indisponible', es: 'Servicio temporalmente no disponible' },
    'بدء رفع الملفات…': { en: 'Start uploading files…', fr: 'Début du téléversement…', es: 'Comenzar a subir archivos…' },
    'بدأ التنزيل…': { en: 'Download started…', fr: 'Téléchargement commencé…', es: 'Descarga iniciada…' },
    'تأكد من الرابط أو عُد للرئيسية.': { en: 'Check the link or return to the home page.', fr: 'Vérifiez le lien ou retournez à l’accueil.', es: 'Verifica el enlace o vuelve a la página principal.' },
    'تحقّق من اتصالك بالإنترنت ثمّ حدّث الصفحة.': { en: 'Check your internet connection then refresh the page.', fr: 'Vérifiez votre connexion Internet puis actualisez la page.', es: 'Verifica tu conexión a Internet y luego actualiza la página.' },
    'تسجيل الدخول': { en: 'Log in', fr: 'Connexion', es: 'Iniciar sesión' },
    'تسجيل الدخول مطلوب': { en: 'Login required', fr: 'Connexion requise', es: 'Inicio de sesión requerido' },
    'تصفح التطبيقات': { en: 'Browse apps', fr: 'Parcourir les applications', es: 'Explorar aplicaciones' },
    'تعذّر الإرسال، حاول مجدداً': { en: 'Could not send, try again', fr: 'Envoi impossible, réessayez', es: 'No se pudo enviar, inténtalo de nuevo' },
    'تعذّر التنزيل، حاول مجدداً': { en: 'Download failed, try again', fr: 'Téléchargement échoué, réessayez', es: 'Descarga fallida, inténtalo de nuevo' },
    'تعذّر الحذف': { en: 'Delete failed', fr: 'Échec de suppression', es: 'Error al eliminar' },
    'تعذّر تحميل البيانات': { en: 'Could not load data', fr: 'Impossible de charger les données', es: 'No se pudieron cargar los datos' },
    'تعذّر تسجيل الدخول، حاول مجدداً': { en: 'Could not log in, try again', fr: 'Impossible de se connecter, réessayez', es: 'No se pudo iniciar sesión, inténtalo de nuevo' },
    'تفعيل': { en: 'Activate', fr: 'Activer', es: 'Activar' },
    'تم تحديث الأيقونة': { en: 'Icon updated', fr: 'Icône mise à jour', es: 'Icono actualizado' },
    'تم تحديث الصورة العرضية': { en: 'Feature image updated', fr: 'Image de mise en avant mise à jour', es: 'Imagen destacada actualizada' },
    'تمت': { en: 'Approved', fr: 'Approuvé', es: 'Aprobado' },
    'تمت الإضافة': { en: 'Added', fr: 'Ajouté', es: 'Añadido' },
    'تواصل معنا': { en: 'Contact us', fr: 'Contactez-nous', es: 'Contáctanos' },
    'جارٍ التثبيت…': { en: 'Installing…', fr: 'Installation…', es: 'Instalando…' },
    'جارٍ التنزيل…': { en: 'Downloading…', fr: 'Téléchargement…', es: 'Descargando…' },
    'جميع التقييمات والمراجعات': { en: 'All ratings and reviews', fr: 'Toutes les notes et avis', es: 'Todas las valoraciones y reseñas' },
    'حاول لاحقاً بعد دقائق قليلة.': { en: 'Try again in a few minutes.', fr: 'Réessayez dans quelques minutes.', es: 'Inténtalo de nuevo en unos minutos.' },
    'حدّث الصفحة وحاول مجدداً.': { en: 'Refresh the page and try again.', fr: 'Actualisez la page et réessayez.', es: 'Actualiza la página e inténtalo de nuevo.' },
    'ستظهر هنا تطبيقات المتجر فور إضافتها من لوحة الإدارة.': { en: 'Store apps will appear here once added from the admin panel.', fr: 'Les applications du store apparaîtront ici une fois ajoutées depuis le panneau d’admin.', es: 'Las aplicaciones de la tienda aparecerán aquí una vez añadidas desde el panel de admin.' },
    'سجّل الدخول بحساب Google لتتمكن من تنزيل التطبيقات والتقييم والمزيد.': { en: 'Sign in with your Google account to download apps, rate them and more.', fr: 'Connectez-vous avec votre compte Google pour télécharger des applications, les noter et plus.', es: 'Inicia sesión con tu cuenta de Google para descargar aplicaciones, valorarlas y más.' },
    'عرض أقل': { en: 'Show less', fr: 'Afficher moins', es: 'Mostrar menos' },
    'عرض المزيد': { en: 'Show more', fr: 'Afficher plus', es: 'Mostrar más' },
    'تحميل المزيد': { en: 'Load more', fr: 'Charger plus', es: 'Cargar más' },
    'فشل التحميل': { en: 'Download failed', fr: 'Téléchargement échoué', es: 'Descarga fallida' },
    'فشل تفعيل الإشعارات: ': { en: 'Failed to enable notifications: ', fr: 'Échec de l’activation des notifications : ', es: 'Error al activar notificaciones: ' },
    'فعّل «تثبيت من مصادر غير معروفة» لإكمال التثبيت.': { en: 'Enable "Install from unknown sources" to complete installation.', fr: 'Activez « Sources inconnues » pour terminer l’installation.', es: 'Habilita "Instalar desde fuentes desconocidas" para completar la instalación.' },
    'لعبة': { en: 'game', fr: 'jeu', es: 'juego' },
    'متاح': { en: 'Available', fr: 'Disponible', es: 'Disponible' },
    'نسخ': { en: 'Copy', fr: 'Copier', es: 'Copiar' },
    'هل تريد بالتأكيد تسجيل الخروج من حسابك؟ ستحتاج لتسجيل الدخول مجدداً للوصول إلى المتجر.': { en: 'Are you sure you want to sign out? You will need to sign in again to access the store.', fr: 'Voulez-vous vraiment vous déconnecter ? Vous devrez vous reconnecter pour accéder au store.', es: '¿Seguro que quieres cerrar sesión? Deberás iniciar sesión de nuevo para acceder a la tienda.' },
    'يجب رفع ملف APK': { en: 'An APK file must be uploaded', fr: 'Un fichier APK doit être téléversé', es: 'Se debe subir un archivo APK' },
    'تم تحديث أنواع العناصر': { en: 'Item types updated', fr: 'Types d’éléments mis à jour', es: 'Tipos de elementos actualizados' },
    'فشل الرفع': { en: 'Upload failed', fr: 'Échec de l’upload', es: 'Error al subir' },
    'مقيّم': { en: 'Rated', fr: 'Évalué', es: 'Valorado' },
    'مثال: 2.5.1': { en: 'e.g. 2.5.1', fr: 'ex. 2.5.1', es: 'ej. 2.5.1' },
    'مثال: https://play.google.com/...': { en: 'e.g. https://play.google.com/...', fr: 'ex. https://play.google.com/...', es: 'ej. https://play.google.com/...' },
    'اشرح المشكلة…': { en: 'Describe the issue…', fr: 'Décrivez le problème…', es: 'Describe el problema…' },
    'خيارات إضافية': { en: 'More options', fr: 'Plus d’options', es: 'Más opciones' },
    'حالة الإشعارات': { en: 'Notifications status', fr: 'État des notifications', es: 'Estado de notificaciones' },
    'إرسال إشعار تجريبي': { en: 'Send a test notification', fr: 'Envoyer une notification test', es: 'Enviar una notificación de prueba' },
    'رمز الإشعارات': { en: 'Push token', fr: 'Jeton push', es: 'Token push' },
    'موجود': { en: 'present', fr: 'présent', es: 'presente' },
    'غير موجود': { en: 'missing', fr: 'manquant', es: 'falta' },
    'صلاحية الإشعارات': { en: 'Notification permission', fr: 'Autorisation de notification', es: 'Permiso de notificaciones' },
    'مفعّلة': { en: 'enabled', fr: 'activée', es: 'activado' },
    'معطّلة': { en: 'disabled — tap to enable', fr: 'désactivée — touchez pour activer', es: 'desactivado — toca para activar' },
    'اختر "السماح" في النافذة التي ستظهر': { en: 'Choose "Allow" in the dialog that appears', fr: 'Choisissez « Autoriser » dans la boîte de dialogue', es: 'Elige "Permitir" en el cuadro que aparecerá' },
    'التسجيل في الخادم': { en: 'Server registration', fr: 'Enregistrement sur le serveur', es: 'Registro en el servidor' },
    'هذا الجهاز مسجّل': { en: 'this device is registered', fr: 'cet appareil est enregistré', es: 'este dispositivo está registrado' },
    'غير مسجّل في الخادم': { en: 'not registered on the server', fr: 'non enregistré sur le serveur', es: 'no registrado en el servidor' },
    'تعذّر التحقق من الخادم': { en: 'could not reach the server', fr: 'serveur injoignable', es: 'no se pudo contactar al servidor' },
    'آخر إشعار وصل الجهاز': { en: 'Last notification received', fr: 'Dernière notification reçue', es: 'Última notificación recibida' },
    'لم يصل أي إشعار بعد': { en: 'no notification received yet', fr: 'aucune notification reçue pour le moment', es: 'aún no se ha recibido ninguna notificación' },
    'تحسين البطارية': { en: 'Battery optimization', fr: 'Optimisation de la batterie', es: 'Optimización de batería' },
    'قد يمنع الإشعارات — استثنِ التطبيق من إعدادات البطارية': { en: 'may block notifications — exempt the app in battery settings', fr: 'peut bloquer les notifications — excluez l’app des réglages batterie', es: 'puede bloquear notificaciones — excluye la app en ajustes de batería' },
    'أُرسل الإشعار إلى جهازك ✓ — يجب أن يظهر الآن. راجع حالته أعلاه بعد لحظات': { en: 'Notification sent to your device ✓ — it should appear now. Check its status above in a moment', fr: 'Notification envoyée à votre appareil ✓ — elle devrait apparaître. Vérifiez son état ci-dessus', es: 'Notificación enviada a tu dispositivo ✓ — debería aparecer ya. Revisa su estado arriba' },
    'لم يُرسل الإشعار': { en: 'Notification not sent', fr: 'Notification non envoyée', es: 'Notificación no enviada' },
    'هذا الجهاز غير مسجّل — سجّل الدخول وانتظر ثوانٍ ثم أعد المحاولة': { en: 'This device is not registered — sign in, wait a few seconds, then retry', fr: 'Cet appareil n’est pas enregistré — connectez-vous, attendez quelques secondes puis réessayez', es: 'Este dispositivo no está registrado — inicia sesión, espera unos segundos y reintenta' },
    'قبل لحظات': { en: 'moments ago', fr: 'à l\u2019instant', es: 'hace un momento' },
    'سبب غير معروف': { en: 'unknown reason', fr: 'raison inconnue', es: 'razón desconocida' },
    'افتح الصفحة في متصفّح مثل Chrome لإتمام تسجيل الدخول.': { en: 'Open the page in a browser like Chrome to finish signing in.', fr: 'Ouvrez la page dans un navigateur comme Chrome pour terminer la connexion.', es: 'Abre la página en un navegador como Chrome para terminar de iniciar sesión.' },
    'المتصفّح حظر النافذة المنبثقة. اسمح بها ثم حاول مجدداً.': { en: 'The browser blocked the popup. Allow it and try again.', fr: 'Le navigateur a bloqué la fenêtre popup. Autorisez-la puis réessayez.', es: 'El navegador bloqueó la ventana emergente. Permítela e inténtalo de nuevo.' },
    'تعذّر الاتصال بالشبكة. تحقّق من الإنترنت وحاول مجدداً.': { en: 'Network error. Check your internet and try again.', fr: 'Erreur réseau. Vérifiez votre connexion et réessayez.', es: 'Error de red. Comprueba tu internet e inténtalo de nuevo.' },
    'تعذّر تسجيل الدخول. حاول مجدداً.': { en: 'Sign-in failed. Try again.', fr: 'Échec de connexion. Réessayez.', es: 'Error al iniciar sesión. Inténtalo de nuevo.' },
    'تعذّر فتح الملف': { en: 'Could not open the file', fr: 'Impossible d’ouvrir le fichier', es: 'No se pudo abrir el archivo' },
    'تم إلغاء التنزيل': { en: 'Download cancelled', fr: 'Téléchargement annulé', es: 'Descarga cancelada' },
    'تم التنزيل — جاهز للتثبيت': { en: 'Downloaded — ready to install', fr: 'Téléchargé — prêt à installer', es: 'Descargado — listo para instalar' },
    'تم تثبيت التطبيق بنجاح': { en: 'App installed successfully', fr: 'Application installée avec succès', es: 'Aplicación instalada correctamente' },
    'تم حذف ملف التحميل': { en: 'Downloaded file deleted', fr: 'Fichier téléchargé supprimé', es: 'Archivo descargado eliminado' },
    'جارٍ التنزيل الآن': { en: 'Downloading now', fr: 'Téléchargement en cours', es: 'Descargando ahora' },
    'جارٍ فتح مثبّت النظام…': { en: 'Opening the system installer…', fr: 'Ouverture de l’installateur système…', es: 'Abriendo el instalador del sistema…' },
    'جاهز للتثبيت': { en: 'Ready to install', fr: 'Prêt à installer', es: 'Listo para instalar' },
    'حذف الملف': { en: 'Delete file', fr: 'Supprimer le fichier', es: 'Eliminar archivo' },
    'سجّل الدخول بحساب Google للوصول إلى المتجر وتطبيقاته وإشعاراته.': { en: 'Sign in with a Google account to access the store, its apps and notifications.', fr: 'Connectez-vous avec un compte Google pour accéder au store, à ses applications et à ses notifications.', es: 'Inicia sesión con una cuenta de Google para acceder a la tienda, sus apps y notificaciones.' },
    'قيد المعالجة…': { en: 'Processing…', fr: 'Traitement…', es: 'Procesando…' },
    'مزوّد Google غير مُفعَّل في Firebase.': { en: 'Google provider is not enabled in Firebase.', fr: 'Le fournisseur Google n’est pas activé dans Firebase.', es: 'El proveedor de Google no está habilitado en Firebase.' },
    'هذا النطاق غير مُصرَّح به في Firebase Authentication.': { en: 'This domain is not authorized in Firebase Authentication.', fr: 'Ce domaine n’est pas autorisé dans Firebase Authentication.', es: 'Este dominio no está autorizado en Firebase Authentication.' },

    // Download flow, publication settings, account switching, and subscription.
    'تحميل': { en: 'Download', fr: 'Télécharger', es: 'Descargar' },
    'عدد التنزيلات': { en: 'Download count', fr: 'Nombre de téléchargements', es: 'Número de descargas' },
    'تنزيلات هذا الإصدار': { en: 'Downloads of this version', fr: 'Téléchargements de cette version', es: 'Descargas de esta versión' },
    'إلغاء التنزيل': { en: 'Cancel download', fr: 'Annuler le téléchargement', es: 'Cancelar descarga' },
    'إعدادات المتجر': { en: 'Store settings', fr: 'Paramètres du store', es: 'Configuración de la tienda' },
    'إعدادات الإشعارات التلقائية': { en: 'Automatic notification settings', fr: 'Paramètres des notifications automatiques', es: 'Configuración de notificaciones automáticas' },
    'تحكّم في الإشعارات التي تُرسل تلقائياً عند نشر تطبيق أو لعبة جديدة.': { en: 'Control notifications sent automatically when a new app or game is published.', fr: 'Gérez les notifications envoyées automatiquement lors de la publication d’une application ou d’un jeu.', es: 'Controla las notificaciones que se envían automáticamente al publicar una nueva aplicación o juego.' },
    'إشعار المستخدمين عند نشر تطبيق أو لعبة': { en: 'Notify users when an app or game is published', fr: 'Notifier les utilisateurs lors de la publication d’une application ou d’un jeu', es: 'Notificar a los usuarios cuando se publique una aplicación o un juego' },
    'عند التعطيل، لن يُحفظ إشعار جديد ولن يصل إشعار فوري للمستخدمين. الإعلانات اليدوية وإشعارات تحديث المتجر لا تتأثر.': { en: 'When disabled, no new in-app notification or push alert is sent. Manual announcements and store-update notifications are unaffected.', fr: 'Si cette option est désactivée, aucune notification dans l’application ni notification push ne sera envoyée. Les annonces manuelles et les mises à jour du store ne sont pas concernées.', es: 'Al desactivarlo, no se guardará una notificación ni se enviará una alerta push. Los anuncios manuales y las actualizaciones de la tienda no se ven afectados.' },
    'مفعّلة': { en: 'Enabled', fr: 'Activées', es: 'Activadas' },
    'معطّلة': { en: 'Disabled', fr: 'Désactivées', es: 'Desactivadas' },
    'جارٍ الحفظ…': { en: 'Saving…', fr: 'Enregistrement…', es: 'Guardando…' },
    'تم تفعيل الإشعارات التلقائية': { en: 'Automatic notifications enabled', fr: 'Notifications automatiques activées', es: 'Notificaciones automáticas activadas' },
    'تم تعطيل الإشعارات التلقائية': { en: 'Automatic notifications disabled', fr: 'Notifications automatiques désactivées', es: 'Notificaciones automáticas desactivadas' },
    'تعذّر حفظ الإعداد': { en: 'Could not save setting', fr: 'Impossible d’enregistrer le paramètre', es: 'No se pudo guardar la configuración' },
    'تعذّر تسجيل الخروج، حاول مرة أخرى': { en: 'Could not sign out. Please try again.', fr: 'Impossible de vous déconnecter. Veuillez réessayer.', es: 'No se pudo cerrar la sesión. Inténtalo de nuevo.' },

    // ---- Chat links (2026-11) ----
    'فتح الرابط': { en: 'Open link', fr: 'Ouvrir le lien', es: 'Abrir enlace' },
    'صورة': { en: 'Image', fr: 'Image', es: 'Imagen' },
    'تم حذف المحادثة وكل محتواها': { en: 'Conversation and all its contents were deleted', fr: 'Conversation et tout son contenu supprimés', es: 'Conversación y todo su contenido eliminados' },

    // ---- Standalone support chat + admin chat UI (2026-11) ----
    'دعم Golden Store': { en: 'Golden Store Support', fr: 'Assistance Golden Store', es: 'Soporte de Golden Store' },
    'دعم Golden Store — محادثة': { en: 'Golden Store Support — Chat', fr: 'Assistance Golden Store — Conversation', es: 'Soporte de Golden Store — Chat' },
    'تواصل مع فريق دعم Golden Store في محادثة مباشرة.': { en: 'Chat directly with the Golden Store support team.', fr: 'Discutez directement avec l’équipe d’assistance Golden Store.', es: 'Chatea directamente con el equipo de soporte de Golden Store.' },
    'فريق دعم المتجر': { en: 'Store support team', fr: 'Équipe d’assistance du store', es: 'Equipo de soporte de la tienda' },
    'مرحباً بك في دعم Golden Store. اكتب رسالتك وسنرد عليك هنا.': { en: 'Welcome to Golden Store Support. Write your message and we will reply right here.', fr: 'Bienvenue dans l’assistance Golden Store. Écrivez votre message, nous vous répondrons ici.', es: 'Bienvenido al soporte de Golden Store. Escribe tu mensaje y te responderemos aquí.' },
    'الرسائل تصل تلقائياً دون إعادة تحميل الصفحة.': { en: 'Messages arrive automatically without reloading the page.', fr: 'Les messages arrivent automatiquement sans recharger la page.', es: 'Los mensajes llegan automáticamente sin recargar la página.' },
    'اكتب رسالة…': { en: 'Write a message…', fr: 'Écrivez un message…', es: 'Escribe un mensaje…' },
    'رسالة جديدة': { en: 'New message', fr: 'Nouveau message', es: 'Mensaje nuevo' },
    'جارٍ تحميل المحادثة…': { en: 'Loading conversation…', fr: 'Chargement de la conversation…', es: 'Cargando conversación…' },
    'تعذّر تحميل المحادثة': { en: 'Could not load the conversation', fr: 'Impossible de charger la conversation', es: 'No se pudo cargar la conversación' },
    'المحادثات': { en: 'Conversations', fr: 'Conversations', es: 'Conversaciones' },
    'عرض المحادثات': { en: 'Back to conversations', fr: 'Retour aux conversations', es: 'Volver a las conversaciones' },

    // ---- Support chat (2026-11): account page + admin replies ----
    'الدعم والمساعدة': { en: 'Help & support', fr: 'Aide et assistance', es: 'Ayuda y soporte' },
    'راسل فريق المتجر وسنرد عليك هنا في نفس المحادثة.': { en: 'Message the store team and we will reply right here in the same conversation.', fr: 'Écrivez à l’équipe du store, nous vous répondrons ici dans la même conversation.', es: 'Escribe al equipo de la tienda y te responderemos aquí en la misma conversación.' },
    'الموضوع (اختياري)': { en: 'Subject (optional)', fr: 'Objet (facultatif)', es: 'Asunto (opcional)' },
    'موضوع الرسالة': { en: 'Message subject', fr: 'Objet du message', es: 'Asunto del mensaje' },
    'رسالة الدعم': { en: 'Support message', fr: 'Message d’assistance', es: 'Mensaje de soporte' },
    'رسالة دعم': { en: 'Support message', fr: 'Message d’assistance', es: 'Mensaje de soporte' },
    'اكتب رسالتك هنا…': { en: 'Write your message here…', fr: 'Écrivez votre message ici…', es: 'Escribe tu mensaje aquí…' },
    'إرسال الرسالة': { en: 'Send message', fr: 'Envoyer le message', es: 'Enviar mensaje' },
    'محادثاتك': { en: 'Your conversations', fr: 'Vos conversations', es: 'Tus conversaciones' },
    'لا توجد محادثات بعد': { en: 'No conversations yet', fr: 'Aucune conversation pour l’instant', es: 'Aún no hay conversaciones' },
    'تعذّر تحميل المحادثات': { en: 'Could not load conversations', fr: 'Impossible de charger les conversations', es: 'No se pudieron cargar las conversaciones' },
    'تم إرسال الرسالة': { en: 'Message sent', fr: 'Message envoyé', es: 'Mensaje enviado' },
    'تعذّر إرسال الرسالة': { en: 'Could not send the message', fr: 'Impossible d’envoyer le message', es: 'No se pudo enviar el mensaje' },
    'فريق الدعم': { en: 'Support team', fr: 'Équipe d’assistance', es: 'Equipo de soporte' },
    'اكتب ردك…': { en: 'Write your reply…', fr: 'Écrivez votre réponse…', es: 'Escribe tu respuesta…' },
    'ردك على المحادثة': { en: 'Your reply', fr: 'Votre réponse', es: 'Tu respuesta' },
    'المحادثة مغلقة': { en: 'This conversation is closed', fr: 'Cette conversation est fermée', es: 'Esta conversación está cerrada' },
    'مفتوحة': { en: 'Open', fr: 'Ouverte', es: 'Abierta' },
    'مغلقة': { en: 'Closed', fr: 'Fermée', es: 'Cerrada' },
    'رسائل الدعم': { en: 'Support messages', fr: 'Messages d’assistance', es: 'Mensajes de soporte' },
    'جارٍ تحميل رسائل الدعم…': { en: 'Loading support messages…', fr: 'Chargement des messages d’assistance…', es: 'Cargando mensajes de soporte…' },
    'لا توجد رسائل دعم': { en: 'No support messages', fr: 'Aucun message d’assistance', es: 'No hay mensajes de soporte' },
    'تظهر هنا رسائل المستخدمين ويمكنك الرد عليها مباشرة.': { en: 'User messages appear here and you can reply directly.', fr: 'Les messages des utilisateurs apparaissent ici et vous pouvez y répondre directement.', es: 'Los mensajes de los usuarios aparecen aquí y puedes responder directamente.' },
    'محادثة': { en: 'conversations', fr: 'conversations', es: 'conversaciones' },
    'اختر محادثة لعرض الرسائل': { en: 'Select a conversation to view its messages', fr: 'Sélectionnez une conversation pour voir les messages', es: 'Selecciona una conversación para ver los mensajes' },
    'الرد على المستخدم': { en: 'Reply to the user', fr: 'Réponse à l’utilisateur', es: 'Respuesta al usuario' },
    'اكتب الرد هنا…': { en: 'Write your reply here…', fr: 'Écrivez votre réponse ici…', es: 'Escribe tu respuesta aquí…' },
    'إرسال الرد': { en: 'Send reply', fr: 'Envoyer la réponse', es: 'Enviar respuesta' },
    'تم إرسال الرد': { en: 'Reply sent', fr: 'Réponse envoyée', es: 'Respuesta enviada' },
    'تعذّر إرسال الرد': { en: 'Could not send the reply', fr: 'Impossible d’envoyer la réponse', es: 'No se pudo enviar la respuesta' },
    'إغلاق المحادثة': { en: 'Close conversation', fr: 'Fermer la conversation', es: 'Cerrar conversación' },
    'إعادة فتح المحادثة': { en: 'Reopen conversation', fr: 'Rouvrir la conversation', es: 'Reabrir conversación' },
    'تعذّر تحديث المحادثة': { en: 'Could not update the conversation', fr: 'Impossible de mettre à jour la conversation', es: 'No se pudo actualizar la conversación' },
    'حذف المحادثة': { en: 'Delete conversation', fr: 'Supprimer la conversation', es: 'Eliminar conversación' },
    'تأكيد حذف المحادثة': { en: 'Delete this conversation and all its messages?', fr: 'Supprimer cette conversation et tous ses messages ?', es: '¿Eliminar esta conversación y todos sus mensajes?' },
    'تم حذف المحادثة': { en: 'Conversation deleted', fr: 'Conversation supprimée', es: 'Conversación eliminada' },
    'تعذّر حذف المحادثة': { en: 'Could not delete the conversation', fr: 'Impossible de supprimer la conversation', es: 'No se pudo eliminar la conversación' },
    'تعذّر تحميل رسائل الدعم': { en: 'Could not load support messages', fr: 'Impossible de charger les messages d’assistance', es: 'No se pudieron cargar los mensajes de soporte' },

    // account / Telegram channel invite (2026-11) — join, not subscribe
    'انضموا إلى قناتنا على تليجرام': { en: 'Join our Telegram channel', fr: 'Rejoignez notre chaîne Telegram', es: 'Únete a nuestro canal de Telegram' },
    'تابع آخر التطبيقات والألعاب والتحديثات وأخبار المتجر على قناتنا في تليجرام.': {
      en: 'Follow new apps and games, updates and store news on our Telegram channel.',
      fr: 'Suivez les nouvelles apps et jeux, les mises à jour et les actualités du store sur notre chaîne Telegram.',
      es: 'Sigue las novedades de apps y juegos, las actualizaciones y las noticias de la tienda en nuestro canal de Telegram.',
    },
    'انضم الى المجموعة': { en: 'Join the group', fr: 'Rejoindre le groupe', es: 'Únete al grupo' },
    'الحسابات المحفوظة': { en: 'Saved accounts', fr: 'Comptes enregistrés', es: 'Cuentas guardadas' },
    'حسابات Google التي استُخدمت سابقاً على هذا الجهاز.': { en: 'Google accounts previously used on this device.', fr: 'Comptes Google déjà utilisés sur cet appareil.', es: 'Cuentas de Google usadas anteriormente en este dispositivo.' },
    'لا توجد حسابات أخرى محفوظة بعد.': { en: 'No other accounts are saved yet.', fr: 'Aucun autre compte n’est encore enregistré.', es: 'Aún no hay otras cuentas guardadas.' },
    'مستخدم الآن': { en: 'Current account', fr: 'Compte actuel', es: 'Cuenta actual' },
    'إزالة الحساب المحفوظ': { en: 'Remove saved account', fr: 'Supprimer le compte enregistré', es: 'Eliminar cuenta guardada' },
    'البريد تلميح لاختيار الحساب فقط؛ وقد يطلب Google تأكيد هويتك.': { en: 'The email is only an account hint; Google may still ask you to verify your identity.', fr: 'L’adresse e-mail sert uniquement d’indice ; Google peut vous demander de vérifier votre identité.', es: 'El correo solo sirve como sugerencia; Google puede pedirte que verifiques tu identidad.' },
    'استخدام حساب Google آخر': { en: 'Use another Google account', fr: 'Utiliser un autre compte Google', es: 'Usar otra cuenta de Google' },
    'تبديل الحساب': { en: 'Switch account', fr: 'Changer de compte', es: 'Cambiar de cuenta' },
    'الرابط غير متاح حالياً': { en: 'Download link is currently unavailable', fr: 'Le lien de téléchargement est momentanément indisponible', es: 'El enlace de descarga no está disponible en este momento' },

    // ---- Review likes / three-dot menu / report modal (JS-generated UI) ----
    // These are created at runtime (toasts, menus, dialogs, confirmations),
    // so they must resolve instantly from this manual dictionary.
    'الإبلاغ عن المراجعة': { en: 'Report review', fr: 'Signaler l’avis', es: 'Denunciar la reseña' },
    'إخفاء المراجعة': { en: 'Hide review', fr: 'Masquer l’avis', es: 'Ocultar la reseña' },
    'على هذا الجهاز فقط': { en: 'On this device only', fr: 'Sur cet appareil uniquement', es: 'Solo en este dispositivo' },
    'خيارات المراجعة': { en: 'Review options', fr: 'Options de l’avis', es: 'Opciones de la reseña' },
    'أعجبني': { en: 'Like', fr: 'J’aime', es: 'Me gusta' },
    'إزالة الإعجاب': { en: 'Unlike', fr: 'Retirer le « J’aime »', es: 'Quitar el « Me gusta »' },
    'تعذّر تسجيل الإعجاب، حاول مجدداً': { en: 'Could not save your like. Please try again.', fr: 'Impossible d’enregistrer le « J’aime ». Réessayez.', es: 'No se pudo guardar el « Me gusta ». Inténtalo de nuevo.' },
    'تم إخفاء المراجعة على هذا الجهاز': { en: 'Review hidden on this device', fr: 'Avis masqué sur cet appareil', es: 'Reseña ocultada en este dispositivo' },
    'تراجع': { en: 'Undo', fr: 'Annuler', es: 'Deshacer' },
    'إظهار المراجعات المخفية': { en: 'Show hidden reviews', fr: 'Afficher les avis masqués', es: 'Mostrar reseñas ocultadas' },
    'تمت استعادة المراجعات المخفية': { en: 'Hidden reviews restored', fr: 'Avis masqués restaurés', es: 'Reseñas ocultadas restauradas' },
    'اختر سبب البلاغ': { en: 'Please select a reason', fr: 'Veuillez choisir un motif', es: 'Selecciona un motivo' },
    'جاري الإرسال...': { en: 'Submitting...', fr: 'Envoi en cours...', es: 'Enviando...' },
    'تم إرسال البلاغ بنجاح': { en: 'Report submitted successfully', fr: 'Signalement envoyé avec succès', es: 'Denuncia enviada correctamente' },
    'لقد أبلغت عن هذه المراجعة مسبقاً': { en: 'You have already reported this review', fr: 'Vous avez déjà signalé cet avis', es: 'Ya has denunciado esta reseña' },
    'حدث خطأ أثناء إرسال البلاغ': { en: 'An error occurred while submitting the report', fr: 'Une erreur est survenue lors de l’envoi du signalement', es: 'Se produjo un error al enviar la denuncia' },
    'تعذّر الإبلاغ عن هذه المراجعة': { en: 'Could not report this review', fr: 'Impossible de signaler cet avis', es: 'No se pudo denunciar esta reseña' },
    // The seven report reasons
    'رسائل مزعجة أو إعلانات': { en: 'Spam or advertising', fr: 'Spam ou publicité', es: 'Spam o publicidad' },
    'إساءة أو تحرش': { en: 'Abuse or harassment', fr: 'Insultes ou harcèlement', es: 'Abuso o acoso' },
    'خطاب كراهية': { en: 'Hate speech', fr: 'Discours haineux', es: 'Discurso de odio' },
    'معلومات مضللة أو احتيال': { en: 'Misleading information or scam', fr: 'Informations trompeuses ou fraude', es: 'Información engañosa o estafa' },
    'محتوى خارج عن الموضوع': { en: 'Off-topic content', fr: 'Contenu hors sujet', es: 'Contenido fuera de tema' },
    // 'محتوى غير لائق' and 'سبب آخر' already exist above.

    // ---- Admin dashboard: review reports tab ----
    'بلاغات المراجعات': { en: 'Review reports', fr: 'Signalements d’avis', es: 'Denuncias de reseñas' },
    'جارٍ تحميل البلاغات…': { en: 'Loading reports…', fr: 'Chargement des signalements…', es: 'Cargando denuncias…' },
    'تحديث القائمة': { en: 'Refresh', fr: 'Actualiser', es: 'Actualizar' },
    'بلاغ': { en: 'reports', fr: 'signalements', es: 'denuncias' },
    'اسم التطبيق': { en: 'App name', fr: 'Nom de l’application', es: 'Nombre de la app' },
    'نص المراجعة': { en: 'Review text', fr: 'Texte de l’avis', es: 'Texto de la reseña' },
    'السبب': { en: 'Reason', fr: 'Motif', es: 'Motivo' },
    'التاريخ': { en: 'Date', fr: 'Date', es: 'Fecha' },
    'إجراء': { en: 'Action', fr: 'Action', es: 'Acción' },
    'فتح صفحة التطبيق': { en: 'Open app page', fr: 'Ouvrir la page de l’application', es: 'Abrir la página de la app' },
    'نص المراجعة غير متوفر': { en: 'Review text unavailable', fr: 'Texte de l’avis indisponible', es: 'Texto de la reseña no disponible' },
    'بواسطة': { en: 'By', fr: 'Par', es: 'Por' },
    'بدون سبب': { en: 'No reason given', fr: 'Sans motif', es: 'Sin motivo' },
    'لا توجد بلاغات على المراجعات': { en: 'No review reports', fr: 'Aucun signalement d’avis', es: 'No hay denuncias de reseñas' },
    'تظهر هنا البلاغات التي يرسلها المستخدمون على التعليقات.': { en: 'Reports submitted by users on reviews appear here.', fr: 'Les signalements envoyés par les utilisateurs sur les avis apparaissent ici.', es: 'Aquí aparecen las denuncias enviadas por los usuarios sobre las reseñas.' },
    'تعذّر تحميل البلاغات': { en: 'Could not load reports', fr: 'Impossible de charger les signalements', es: 'No se pudieron cargar las denuncias' },
    'حاول مجدداً': { en: 'Please try again', fr: 'Veuillez réessayer', es: 'Inténtalo de nuevo' },
    'حذف البلاغ': { en: 'Delete report', fr: 'Supprimer le signalement', es: 'Eliminar la denuncia' },
    'حذف هذا البلاغ فقط': { en: 'Delete only this report', fr: 'Supprimer uniquement ce signalement', es: 'Eliminar solo esta denuncia' },
    'حذف التعليق': { en: 'Delete review', fr: 'Supprimer l’avis', es: 'Eliminar la reseña' },
    'حذف التعليق نهائياً مع الإعجابات والبلاغات المرتبطة به': { en: 'Permanently delete the review, its likes and all related reports', fr: 'Supprimer définitivement l’avis, ses « J’aime » et tous les signalements associés', es: 'Eliminar permanentemente la reseña, sus « Me gusta » y todas las denuncias relacionadas' },
    'هل أنت متأكد من حذف هذا البلاغ؟': { en: 'Are you sure you want to delete this report?', fr: 'Voulez-vous vraiment supprimer ce signalement ?', es: '¿Seguro que quieres eliminar esta denuncia?' },
    'هل أنت متأكد من حذف هذا التعليق نهائياً؟': { en: 'Are you sure you want to permanently delete this review?', fr: 'Voulez-vous vraiment supprimer définitivement cet avis ?', es: '¿Seguro que quieres eliminar esta reseña de forma permanente?' },
    'سيُحذف التعليق مع الإعجابات وجميع البلاغات المرتبطة به.': { en: 'The review, its likes and all related reports will be deleted.', fr: 'L’avis, ses « J’aime » et tous les signalements associés seront supprimés.', es: 'Se eliminarán la reseña, sus « Me gusta » y todas las denuncias relacionadas.' },
    'نعم، احذف': { en: 'Yes, delete', fr: 'Oui, supprimer', es: 'Sí, eliminar' },
    'تم حذف البلاغ': { en: 'Report deleted', fr: 'Signalement supprimé', es: 'Denuncia eliminada' },
    'تعذّر حذف البلاغ': { en: 'Could not delete the report', fr: 'Impossible de supprimer le signalement', es: 'No se pudo eliminar la denuncia' },
    'تم حذف التعليق': { en: 'Review deleted', fr: 'Avis supprimé', es: 'Reseña eliminada' },
    'تعذّر حذف التعليق': { en: 'Could not delete the review', fr: 'Impossible de supprimer l’avis', es: 'No se pudo eliminar la reseña' },

    // ---- Play-style top tabs (Home + Games) ---------------------------------
    // Both shaped and unshaped spellings are registered. norm() already strips
    // diacritics (including the shadda), but listing both guards against future
    // label edits and makes the intent explicit. Without these keys t() falls
    // through to /api/translate and the label stays Arabic in EN/FR/ES.
    'محتوى يهمّك': { en: 'For you', fr: 'Pour vous', es: 'Para ti' },
    'محتوى يهمك': { en: 'For you', fr: 'Pour vous', es: 'Para ti' },
    'العربية': { en: 'Arabic', fr: 'Arabe', es: 'Árabe' },
    'مرسلة': { en: 'Sent', fr: 'Envoyées', es: 'Enviadas' },
    'ناجحة': { en: 'Delivered', fr: 'Livrées', es: 'Entregadas' },

    // ---- Admin upload form (all remaining static t() literals) -------------
    'أضف لقطات جديدة': { en: 'Add new screenshots', fr: 'Ajouter de nouvelles captures', es: 'Añadir nuevas capturas' },
    'اختر أيقونة (PNG/JPG)': { en: 'Choose an icon (PNG/JPG)', fr: 'Choisir une icône (PNG/JPG)', es: 'Elegir un icono (PNG/JPG)' },
    'اختر أيقونة جديدة': { en: 'Choose a new icon', fr: 'Choisir une nouvelle icône', es: 'Elegir un icono nuevo' },
    'اختر صورة عرضية (يفضّل 1024×500)': { en: 'Choose a feature graphic (1024×500 recommended)', fr: 'Choisir une image de présentation (1024×500 recommandé)', es: 'Elegir imagen destacada (1024×500 recomendado)' },
    'اختر لقطات الشاشة (متعددة)': { en: 'Choose screenshots (multiple)', fr: 'Choisir des captures d’écran (plusieurs)', es: 'Elegir capturas de pantalla (varias)' },
    'استبدل ملف APK': { en: 'Replace APK file', fr: 'Remplacer le fichier APK', es: 'Reemplazar el archivo APK' },
    'اسحب أو اختر ملف APK': { en: 'Drag or choose an APK file', fr: 'Glisser ou choisir un fichier APK', es: 'Arrastra o elige un archivo APK' },
    'اسحب أو اختر ملف APK للتطبيق': { en: 'Drag or choose the app APK file', fr: 'Glisser ou choisir le fichier APK de l’application', es: 'Arrastra o elige el archivo APK de la aplicación' },

    // ---- Legendary update dialog + announcement banner + admin console ----
    'تحديث إلزامي': { en: 'Mandatory update', fr: 'Mise à jour obligatoire', es: 'Actualización obligatoria' },
    'تجاهل هذا الإصدار': { en: 'Ignore this version', fr: 'Ignorer cette version', es: 'Omitir esta versión' },
    'حجم التحديث': { en: 'Update size', fr: 'Taille de la mise à jour', es: 'Tamaño de la actualización' },
    'عرض ما الجديد': { en: 'See what\'s new', fr: 'Voir les nouveautés', es: 'Ver novedades' },
    'إصدار جديد من Golden Store متاح': { en: 'A new Golden Store version is available', fr: 'Une nouvelle version de Golden Store est disponible', es: 'Hay una nueva versión de Golden Store disponible' },
    'اضغط لمشاهدة التفاصيل': { en: 'Tap to view details', fr: 'Appuyez pour voir les détails', es: 'Toca para ver los detalles' },
    'يتم الآن تنزيل التحديث': { en: 'Downloading the update', fr: 'Téléchargement de la mise à jour', es: 'Descargando la actualización' },
    'تحديث رسمي وموقّع': { en: 'Official signed update', fr: 'Mise à jour officielle signée', es: 'Actualización oficial firmada' },
    'نظرة عامة': { en: 'Overview', fr: 'Vue d\'ensemble', es: 'Resumen' },
    'المحتوى': { en: 'Content', fr: 'Contenu', es: 'Contenido' },
    'المجتمع': { en: 'Community', fr: 'Communauté', es: 'Comunidad' },
    'النمو': { en: 'Growth', fr: 'Croissance', es: 'Crecimiento' },
    'النظام': { en: 'System', fr: 'Système', es: 'Sistema' },
    'مركز التحديث': { en: 'Update center', fr: 'Centre de mise à jour', es: 'Centro de actualizaciones' },
    'بحث سريع': { en: 'Quick search', fr: 'Recherche rapide', es: 'Búsqueda rápida' },
    'ابحث في الأقسام والتطبيقات': { en: 'Search sections and apps', fr: 'Rechercher dans les sections et les applications', es: 'Buscar en secciones y aplicaciones' },
    'إجراءات سريعة': { en: 'Quick actions', fr: 'Actions rapides', es: 'Acciones rápidas' },
    'صحة الخدمات': { en: 'Service health', fr: 'Santé des services', es: 'Estado de los servicios' },
    'سجل النشاطات': { en: 'Activity log', fr: 'Journal d\'activité', es: 'Registro de actividad' },
    'آخر النشاطات': { en: 'Recent activity', fr: 'Activité récente', es: 'Actividad reciente' },
    'فرز حسب': { en: 'Sort by', fr: 'Trier par', es: 'Ordenar por' },
    'كل التصنيفات': { en: 'All categories', fr: 'Toutes les catégories', es: 'Todas las categorías' },
    'الأحدث': { en: 'Newest', fr: 'Plus récents', es: 'Más recientes' },
    'تحديد الكل': { en: 'Select all', fr: 'Tout sélectionner', es: 'Seleccionar todo' },
    'إلغاء التحديد': { en: 'Clear selection', fr: 'Effacer la sélection', es: 'Borrar selección' },
    'تصدير CSV': { en: 'Export CSV', fr: 'Exporter CSV', es: 'Exportar CSV' },
    'تصدير JSON': { en: 'Export JSON', fr: 'Exporter JSON', es: 'Exportar JSON' },
    'تكرار': { en: 'Duplicate', fr: 'Dupliquer', es: 'Duplicar' },
    'معاينة': { en: 'Preview', fr: 'Aperçu', es: 'Vista previa' },
    'حذف المحدد': { en: 'Delete selected', fr: 'Supprimer la sélection', es: 'Eliminar seleccionados' },
    'سجل الإصدارات': { en: 'Release history', fr: 'Historique des versions', es: 'Historial de versiones' },
    'معاينة النافذة': { en: 'Preview the dialog', fr: 'Prévisualiser la fenêtre', es: 'Previsualizar la ventana' },
    'ملاحظات الإصدار': { en: 'Release notes', fr: 'Notes de version', es: 'Notas de la versión' },
    'إرسال إشعار عند النشر': { en: 'Notify users on publish', fr: 'Notifier les utilisateurs à la publication', es: 'Notificar a los usuarios al publicar' },
    'الخدمات تعمل بشكل طبيعي': { en: 'All services operational', fr: 'Tous les services sont opérationnels', es: 'Todos los servicios operativos' },
    'تعذّر فحص الخدمات': { en: 'Could not check services', fr: 'Impossible de vérifier les services', es: 'No se pudieron verificar los servicios' },
    'لا نشاطات بعد': { en: 'No activity yet', fr: 'Aucune activité', es: 'Sin actividad todavía' },
    'عرض المتجر': { en: 'View store', fr: 'Voir la boutique', es: 'Ver la tienda' },

    // ---- Admin console labels (2026-11-07) ----
    'نشر تحديث جديد': { en: 'Publish new update', fr: 'Publier une nouvelle mise à jour', es: 'Publicar nueva actualización' },
    'الإحصائيات': { en: 'Analytics', fr: 'Statistiques', es: 'Estadísticas' },
    'تصفية': { en: 'Filter', fr: 'Filtrer', es: 'Filtrar' },
    'تم التصدير': { en: 'Exported', fr: 'Exporté', es: 'Exportado' },
    'إشعارات متقدمة': { en: 'Advanced notifications', fr: 'Notifications avancées', es: 'Notificaciones avanzadas' },
    'قاعدة البيانات D1': { en: 'D1 database', fr: 'Base de données D1', es: 'Base de datos D1' },
    'إشعارات FCM': { en: 'FCM notifications', fr: 'Notifications FCM', es: 'Notificaciones FCM' },
    'خدمة التحديث': { en: 'Update service', fr: 'Service de mise à jour', es: 'Servicio de actualización' },

    // ---- Admin Console Phase 2 (2026-11-07) ----
    'النشر والترتيب': { en: 'Publishing & ordering', fr: 'Publication et classement', es: 'Publicación y orden' },
    'المشرفون والصلاحيات': { en: 'Team & permissions', fr: 'Équipe et permissions', es: 'Equipo y permisos' },
    'النسخ الاحتياطي': { en: 'Backup', fr: 'Sauvegarde', es: 'Copia de seguridad' },
    'المشرفون': { en: 'Team members', fr: 'Membres de l’équipe', es: 'Miembros del equipo' },
    'منشور': { en: 'Published', fr: 'Publié', es: 'Publicado' },
    'مسودة': { en: 'Draft', fr: 'Brouillon', es: 'Borrador' },
    'مجدول': { en: 'Scheduled', fr: 'Programmé', es: 'Programado' },
    'حفظ الحالة': { en: 'Save status', fr: 'Enregistrer le statut', es: 'Guardar estado' },
    'حفظ الترتيب': { en: 'Save order', fr: 'Enregistrer l’ordre', es: 'Guardar orden' },
    'اسحب لإعادة الترتيب': { en: 'Drag to reorder', fr: 'Glisser pour réordonner', es: 'Arrastra para reordenar' },
    'معرف الفئة': { en: 'Category slug', fr: 'Identifiant de la catégorie', es: 'Slug de la categoría' },
    'اسم الفئة': { en: 'Category name', fr: 'Nom de la catégorie', es: 'Nombre de la categoría' },
    'النوع': { en: 'Type', fr: 'Type', es: 'Tipo' },
    'إضافة فئة': { en: 'Add category', fr: 'Ajouter une catégorie', es: 'Añadir categoría' },
    'حذف الفئة': { en: 'Delete category', fr: 'Supprimer la catégorie', es: 'Eliminar categoría' },
    'المشرف': { en: 'Admin user', fr: 'Administrateur', es: 'Administrador' },
    'الدور': { en: 'Role', fr: 'Rôle', es: 'Rol' },
    'مالك': { en: 'Owner', fr: 'Propriétaire', es: 'Propietario' },
    'محرر': { en: 'Editor', fr: 'Éditeur', es: 'Editor' },
    'مشاهد': { en: 'Viewer', fr: 'Lecteur', es: 'Lectura' },
    'إضافة مشرف': { en: 'Add admin', fr: 'Ajouter un administrateur', es: 'Añadir administrador' },
    'الإجراء': { en: 'Action', fr: 'Action', es: 'Acción' },
    'تصدير النسخة الاحتياطية': { en: 'Export backup', fr: 'Exporter la sauvegarde', es: 'Exportar copia' },
    'استيراد نسخة احتياطية': { en: 'Import backup', fr: 'Importer une sauvegarde', es: 'Importar copia' },
    'اختر ملف JSON': { en: 'Choose a JSON file', fr: 'Choisir un fichier JSON', es: 'Elegir un archivo JSON' },
    'تم الاستيراد': { en: 'Imported', fr: 'Importé', es: 'Importado' },

    // ---- Responsive overhaul + extra admin features (2026-11-07) ----
    'فحص الجودة': { en: 'Catalogue QA', fr: 'Contrôle qualité du catalogue', es: 'Control de calidad del catálogo' },
    'معاينة الأجهزة': { en: 'Device preview', fr: 'Aperçu sur appareil', es: 'Vista previa en dispositivos' },
    'تثبيت القسم': { en: 'Pin section', fr: 'Épingler la section', es: 'Fijar sección' },
    'اختصارات لوحة المفاتيح': { en: 'Keyboard shortcuts', fr: 'Raccourcis clavier', es: 'Atajos de teclado' },
    'أيقونة مفقودة': { en: 'Missing icon', fr: 'Icône manquante', es: 'Icono faltante' },
    'ملف APK مفقود': { en: 'Missing APK', fr: 'APK manquant', es: 'APK faltante' },
    'وصف مفقود': { en: 'Missing description', fr: 'Description manquante', es: 'Descripción faltante' },
    'وصف مختصر مفقود': { en: 'Missing short description', fr: 'Description courte manquante', es: 'Descripción corta faltante' },
    'فئة مفقودة': { en: 'Missing category', fr: 'Catégorie manquante', es: 'Categoría faltante' },
    'إصدار مفقود': { en: 'Missing version', fr: 'Version manquante', es: 'Versión faltante' },
    'مطوّر مفقود': { en: 'Missing developer', fr: 'Développeur manquant', es: 'Desarrollador faltante' },
    'محدّد': { en: 'selected', fr: 'sélectionné(s)', es: 'seleccionado(s)' },
    'عناصر تحتاج انتباهاً': { en: 'Items needing attention', fr: 'Éléments à vérifier', es: 'Elementos que requieren atención' },
    'لا توجد مشاكل': { en: 'No issues found', fr: 'Aucun problème', es: 'Sin problemas' },
    'أحدث الإضافات': { en: 'Recently added', fr: 'Ajouts récents', es: 'Añadidos recientemente' },
    'توزيع التنزيلات': { en: 'Downloads distribution', fr: 'Répartition des téléchargements', es: 'Distribución de descargas' },
    'إجراء جماعي': { en: 'Bulk action', fr: 'Action groupée', es: 'Acción masiva' },
    'تطبيق الإجراء': { en: 'Apply', fr: 'Appliquer', es: 'Aplicar' },
    'كثافة مريحة': { en: 'Comfortable density', fr: 'Densité confortable', es: 'Densidad cómoda' },
    'كثافة مضغوطة': { en: 'Compact density', fr: 'Densité compacte', es: 'Densidad compacta' },
    'تصدير السجل': { en: 'Export log', fr: 'Exporter le journal', es: 'Exportar registro' },
    'تصفية السجل': { en: 'Filter the log', fr: 'Filtrer le journal', es: 'Filtrar el registro' },
    'معاينة الهاتف': { en: 'Phone preview', fr: 'Aperçu mobile', es: 'Vista previa móvil' },
    'معاينة الجهاز اللوحي': { en: 'Tablet preview', fr: 'Aperçu tablette', es: 'Vista previa tableta' },
    'معاينة الحاسوب': { en: 'Desktop preview', fr: 'Aperçu bureau', es: 'Vista previa escritorio' },
    'فتح المتجر بحجم الجهاز': { en: 'Open the store at this device size', fr: 'Ouvrir la boutique à cette taille', es: 'Abrir la tienda a este tamaño' },

    // ---- Desktop sizing control (2026-11-07) ----
    'عرض المحتوى': { en: 'Content width', fr: 'Largeur du contenu', es: 'Ancho del contenido' },
    'مريح': { en: 'Comfortable', fr: 'Confortable', es: 'Cómodo' },
    'عريض': { en: 'Wide', fr: 'Large', es: 'Ancho' },
    'عرض كامل': { en: 'Full width', fr: 'Pleine largeur', es: 'Ancho completo' },
    'اسمح بالنوافذ المنبثقة': { en: 'Allow pop-ups for this site', fr: 'Autorisez les fenêtres contextuelles', es: 'Permite ventanas emergentes' },

    // ---- Settings Center + Insights + optional demographics (2026-11-07) ----
    'آخر': { en: 'Last', fr: 'Dernier', es: 'Último' },
    'أفضّل عدم التحديد': { en: 'Prefer not to say', fr: 'Je préfère ne pas préciser', es: 'Prefiero no decirlo' },
    'أقصى حجم رفع (م.ب)': { en: 'Max upload size (MB)', fr: 'Taille max. (Mo)', es: 'Tamaño máx. (MB)' },
    'أنثى': { en: 'Female', fr: 'Femme', es: 'Mujer' },
    'أوافق على استخدام هذه البيانات لأغراض إحصائية مجمّعة فقط، دون ربطها بحسابي.': { en: 'I agree to use this data for aggregate statistics only, never linked to my account.', fr: 'J\'accepte l\'utilisation de ces données pour des statistiques agrégées uniquement, sans lien avec mon compte.', es: 'Acepto usar estos datos solo para estadísticas agregadas, sin vincularlos a mi cuenta.' },
    'أيام': { en: 'days', fr: 'jours', es: 'días' },
    'إحصائيات متقدمة': { en: 'Advanced insights', fr: 'Statistiques avancées', es: 'Estadísticas avanzadas' },
    'إشعار تلقائي عند تحديث المتجر': { en: 'Auto-notify on store update', fr: 'Notifier automatiquement lors d’une mise à jour', es: 'Notificar automáticamente al actualizar la tienda' },
    'إشعار عند نشر عنصر جديد': { en: 'Notify on new publication', fr: 'Notifier à la publication', es: 'Notificar al publicar' },
    'إظهار عدّاد التنزيلات': { en: 'Show download counter', fr: 'Afficher le compteur de téléchargements', es: 'Mostrar contador de descargas' },
    'إعادة ضبط الإعدادات': { en: 'Reset settings', fr: 'Réinitialiser les paramètres', es: 'Restablecer ajustes' },
    'ابحث في الإعدادات': { en: 'Search settings', fr: 'Rechercher dans les paramètres', es: 'Buscar en ajustes' },
    'اختر الجنس': { en: 'Choose gender', fr: 'Choisir le genre', es: 'Elegir género' },
    'اختر الفئة العمرية': { en: 'Choose age range', fr: 'Choisir une tranche d’âge', es: 'Elegir rango de edad' },
    'استيراد الإعدادات': { en: 'Import settings', fr: 'Importer les paramètres', es: 'Importar ajustes' },
    'اسم المتجر': { en: 'Store name', fr: 'Nom de la boutique', es: 'Nombre de la tienda' },
    'الأجهزة المسجّلة': { en: 'Registered devices', fr: 'Appareils enregistrés', es: 'Dispositivos registrados' },
    'البيانات اختيارية ومجهولة؛ لا نعرض أرقاماً تقديرية أبداً.': { en: 'Data is optional and anonymous; we never display estimated numbers.', fr: 'Données optionnelles et anonymes ; aucun chiffre estimé n’est affiché.', es: 'Datos opcionales y anónimos; nunca mostramos cifras estimadas.' },
    'التقييمات': { en: 'Ratings', fr: 'Évaluations', es: 'Valoraciones' },
    'التنزيلات اليومية': { en: 'Daily downloads', fr: 'Téléchargements quotidiens', es: 'Descargas diarias' },
    'الجنس': { en: 'Gender', fr: 'Genre', es: 'Género' },
    'الخصوصية والبيانات': { en: 'Privacy & data', fr: 'Confidentialité et données', es: 'Privacidad y datos' },
    'الدول': { en: 'Countries', fr: 'Pays', es: 'Países' },
    'الدولة': { en: 'Country', fr: 'Pays', es: 'País' },
    'الدولة (اختياري)': { en: 'Country (optional)', fr: 'Pays (facultatif)', es: 'País (opcional)' },
    'الذروة': { en: 'Peak', fr: 'Pic', es: 'Pico' },
    'السماح بالتقييمات': { en: 'Allow reviews', fr: 'Autoriser les avis', es: 'Permitir reseñas' },
    'السن والجنس': { en: 'Age & gender', fr: 'Âge et genre', es: 'Edad y género' },
    'العبارة التعريفية': { en: 'Tagline', fr: 'Slogan', es: 'Eslogan' },
    'الفئات العمرية': { en: 'Age ranges', fr: 'Tranches d’âge', es: 'Rangos de edad' },
    'الفئة الافتراضية': { en: 'Default category', fr: 'Catégorie par défaut', es: 'Categoría predeterminada' },
    'الفئة العمرية': { en: 'Age range', fr: 'Tranche d’âge', es: 'Rango de edad' },
    'الفترة': { en: 'Period', fr: 'Période', es: 'Período' },
    'اللغة الافتراضية': { en: 'Default language', fr: 'Langue par défaut', es: 'Idioma predeterminado' },
    'اللون المميز': { en: 'Accent colour', fr: 'Couleur d’accent', es: 'Color de acento' },
    'المحتوى والنشر': { en: 'Content & publishing', fr: 'Contenu et publication', es: 'Contenido y publicación' },
    'المشاركون': { en: 'Participants', fr: 'Participants', es: 'Participantes' },
    'المظهر الافتراضي': { en: 'Default theme', fr: 'Thème par défaut', es: 'Tema predeterminado' },
    'المظهر واللغة': { en: 'Appearance & language', fr: 'Apparence et langue', es: 'Apariencia e idioma' },
    'المنصات': { en: 'Platforms', fr: 'Plateformes', es: 'Plataformas' },
    'النظام والصيانة': { en: 'System & maintenance', fr: 'Système et maintenance', es: 'Sistema y mantenimiento' },
    'النوع الافتراضي': { en: 'Default type', fr: 'Type par défaut', es: 'Tipo predeterminado' },
    'الهوية والعلامة': { en: 'Identity & branding', fr: 'Identité et marque', es: 'Identidad y marca' },
    'الويب': { en: 'Web', fr: 'Web', es: 'Web' },
    'بدء ساعات الهدوء (24h)': { en: 'Quiet hours start (24h)', fr: 'Début des heures calmes (24h)', es: 'Inicio de horas silenciosas (24h)' },
    'بريد الدعم': { en: 'Support email', fr: 'E-mail du support', es: 'Correo de soporte' },
    'بيانات اختيارية مجهولة': { en: 'optional anonymous data', fr: 'données anonymes facultatives', es: 'datos anónimos opcionales' },
    'بيانات اختيارية ومجهولة بالكامل — تُستخدم للأرقام المجمّعة فقط.': { en: 'Fully optional and anonymous — used for aggregate numbers only.', fr: 'Entièrement facultatives et anonymes — utilisées uniquement pour des chiffres agrégés.', es: 'Totalmente opcionales y anónimas: solo para cifras agregadas.' },
    'تصدير الإحصائيات': { en: 'Export analytics', fr: 'Exporter les statistiques', es: 'Exportar estadísticas' },
    'تصدير الإعدادات': { en: 'Export settings', fr: 'Exporter les paramètres', es: 'Exportar ajustes' },
    'تعذّر حفظ البيانات': { en: 'Could not save data', fr: 'Impossible d’enregistrer les données', es: 'No se pudieron guardar los datos' },
    'تغييرات غير محفوظة': { en: 'unsaved changes', fr: 'modifications non enregistrées', es: 'cambios sin guardar' },
    'تفعيل الإشعارات الفورية': { en: 'Enable push notifications', fr: 'Activer les notifications push', es: 'Activar notificaciones push' },
    'تم حفظ الإعدادات': { en: 'Settings saved', fr: 'Paramètres enregistrés', es: 'Ajustes guardados' },
    'تم حفظ بياناتك الاختيارية': { en: 'Your optional data was saved', fr: 'Vos données facultatives sont enregistrées', es: 'Se guardaron tus datos opcionales' },
    'تم سحب الموافقة': { en: 'Consent withdrawn', fr: 'Consentement retiré', es: 'Consentimiento retirado' },
    'توزيع التقييمات': { en: 'Rating distribution', fr: 'Répartition des notes', es: 'Distribución de valoraciones' },
    'توزيع حسب الساعة': { en: 'Hourly distribution', fr: 'Répartition horaire', es: 'Distribución por hora' },
    'توصيات ذكية': { en: 'Smart recommendations', fr: 'Recommandations intelligentes', es: 'Recomendaciones inteligentes' },
    'جمع البيانات الديموغرافية معطّل': { en: 'Demographics collection is disabled', fr: 'La collecte démographique est désactivée', es: 'La recopilación demográfica está desactivada' },
    'جمع بيانات ديموغرافية اختيارية': { en: 'Collect optional demographics', fr: 'Collecter des données démographiques facultatives', es: 'Recopilar datos demográficos opcionales' },
    'حفظ الإعدادات': { en: 'Save settings', fr: 'Enregistrer les paramètres', es: 'Guardar ajustes' },
    'حفظ البيانات الاختيارية': { en: 'Save optional data', fr: 'Enregistrer les données facultatives', es: 'Guardar datos opcionales' },
    'ذكر': { en: 'Male', fr: 'Homme', es: 'Hombre' },
    'رابط تليجرام': { en: 'Telegram link', fr: 'Lien Telegram', es: 'Enlace de Telegram' },
    'رسالة الصيانة': { en: 'Maintenance message', fr: 'Message de maintenance', es: 'Mensaje de mantenimiento' },
    'ساعدنا في تحسين المتجر': { en: 'Help us improve the store', fr: 'Aidez-nous à améliorer la boutique', es: 'Ayúdanos a mejorar la tienda' },
    'سحب الموافقة': { en: 'Withdraw consent', fr: 'Retirer le consentement', es: 'Retirar consentimiento' },
    'طلب تسجيل الدخول': { en: 'Require sign-in', fr: 'Exiger la connexion', es: 'Requerir inicio de sesión' },
    'فعّل جمع البيانات الديموغرافية الاختياري لرؤية السن والجنس': { en: 'Enable optional demographics collection to see age and gender', fr: 'Activez la collecte facultative pour voir l’âge et le genre', es: 'Activa la recopilación opcional para ver edad y género' },
    'فعّله من إعدادات المتجر ← الخصوصية والبيانات، ثم سيملأ المستخدمون بياناتهم اختيارياً.': { en: 'Enable it in Store settings → Privacy & data; users then fill it in voluntarily.', fr: 'Activez-le dans Paramètres → Confidentialité et données ; les utilisateurs le rempliront volontairement.', es: 'Actívalo en Ajustes → Privacidad y datos; los usuarios lo completarán voluntariamente.' },
    'كثافة الواجهة': { en: 'UI density', fr: 'Densité de l’interface', es: 'Densidad de la interfaz' },
    'لا توجد بيانات ديموغرافية بعد': { en: 'No demographic data yet', fr: 'Aucune donnée démographique', es: 'Aún no hay datos demográficos' },
    'لا توجد تغييرات': { en: 'No changes', fr: 'Aucune modification', es: 'Sin cambios' },
    'متوسط التقييم': { en: 'Average rating', fr: 'Note moyenne', es: 'Valoración media' },
    'مدة الجلسة (أيام)': { en: 'Session length (days)', fr: 'Durée de session (jours)', es: 'Duración de sesión (días)' },
    'معاينة مباشرة': { en: 'Live preview', fr: 'Aperçu en direct', es: 'Vista previa en vivo' },
    'نهاية ساعات الهدوء (24h)': { en: 'Quiet hours end (24h)', fr: 'Fin des heures calmes (24h)', es: 'Fin de horas silenciosas (24h)' },
    'وضع الصيانة': { en: 'Maintenance mode', fr: 'Mode maintenance', es: 'Modo mantenimiento' },
    'وضع الصيانة مفعّل حالياً': { en: 'Maintenance mode is currently on', fr: 'Le mode maintenance est activé', es: 'El modo mantenimiento está activado' },
    'يجب الموافقة أولاً': { en: 'Please consent first', fr: 'Veuillez d’abord donner votre accord', es: 'Debes aceptar primero' },
    'يوم': { en: 'day', fr: 'jour', es: 'día' },

    // ---- Privacy: optional demographics ----
    'بيانات ديموغرافية اختيارية': { en: 'Optional demographics', fr: 'Données démographiques facultatives', es: 'Datos demográficos opcionales' },
    'قد نتيح لك مشاركة فئة عمرية وجنس ودولة بشكل اختياري ومجهول، بموافقة صريحة، ولأغراض إحصائية مجمّعة فقط. لا نربط هذه البيانات بحسابك، ولا نجمع الاسم أو البريد أو تاريخ الميلاد، ويمكنك سحب الموافقة أو حذفها في أي وقت من صفحة الحساب. إن لم تُفعّل هذا الخيار من لوحة التحكم فلن يُجمع أي شيء.': { en: 'You may optionally and anonymously share an age range, gender and country, with explicit consent, for aggregate statistics only. We never link it to your account, never collect your name, email or date of birth, and you can withdraw consent or delete it at any time from the Account page. If this option is not enabled in the admin console, nothing is collected.', fr: 'Vous pouvez partager facultativement et anonymement une tranche d’âge, un genre et un pays, avec consentement explicite, uniquement pour des statistiques agrégées. Nous ne lions jamais ces données à votre compte, ne collectons ni nom, ni e-mail, ni date de naissance, et vous pouvez retirer votre consentement à tout moment depuis la page Compte. Si cette option n’est pas activée dans la console d’administration, rien n’est collecté.', es: 'Puedes compartir de forma opcional y anónima un rango de edad, género y país, con consentimiento explícito, solo para estadísticas agregadas. Nunca lo vinculamos a tu cuenta, no recopilamos nombre, correo ni fecha de nacimiento, y puedes retirar el consentimiento o eliminarlo cuando quieras desde la página Cuenta. Si esta opción no está activada en el panel de administración, no se recopila nada.' },

    // ---- Live settings effects ----
    'التقييمات معطّلة حالياً': { en: 'Reviews are currently disabled', fr: 'Les avis sont actuellement désactivés', es: 'Las reseñas están desactivadas' },
    // ---- Centered maintenance modal + countdown ----
    'مدة الصيانة (بالدقائق)': { en: 'Maintenance duration (minutes)', fr: 'Durée de la maintenance (minutes)', es: 'Duración del mantenimiento (minutos)' },
    'وقت انتهاء الصيانة': { en: 'Maintenance end time', fr: 'Fin de la maintenance', es: 'Fin del mantenimiento' },
    'المتجر تحت الصيانة': { en: 'Store under maintenance', fr: 'Boutique en maintenance', es: 'Tienda en mantenimiento' },
    'صيانة مجدولة': { en: 'Scheduled maintenance', fr: 'Maintenance programmée', es: 'Mantenimiento programado' },
    'الوقت المتبقي': { en: 'Time remaining', fr: 'Temps restant', es: 'Tiempo restante' },
    'ينتهي في': { en: 'Ends at', fr: 'Se termine à', es: 'Termina a las' },
    'لا يمكن متابعة التصفح حتى انتهاء الصيانة': { en: 'Browsing is unavailable until maintenance ends', fr: 'La navigation est indisponible jusqu’à la fin de la maintenance', es: 'No se puede navegar hasta que finalice el mantenimiento' },
    'انتهت الصيانة، نعود الآن…': { en: 'Maintenance is over, reloading…', fr: 'Maintenance terminée, rechargement…', es: 'Mantenimiento finalizado, recargando…' },
    'وضع الصيانة مفعّل — معاينة المدير': { en: 'Maintenance on — admin preview', fr: 'Maintenance activée — aperçu admin', es: 'Mantenimiento activo — vista de administrador' },
    'وضع الصيانة مفعّل — الزوار محجوبون': { en: 'Maintenance on — visitors are locked out', fr: 'Maintenance activée — visiteurs bloqués', es: 'Mantenimiento activo — visitantes bloqueados' },
    'لوحة التحكم': { en: 'Admin console', fr: 'Console d’administration', es: 'Panel de administración' },
    'المتجر تحت الصيانة، نعود قريباً.': { en: 'The store is under maintenance, we will be back soon.', fr: 'La boutique est en maintenance, nous revenons bientôt.', es: 'La tienda está en mantenimiento, volvemos pronto.' },
  };

  // Number/size unit labels per language.
  var UNITS = {
    bytes: { ar: ['ب', 'ك.ب', 'م.ب', 'ج.ب'], en: ['B', 'KB', 'MB', 'GB'], fr: ['o', 'Ko', 'Mo', 'Go'], es: ['B', 'KB', 'MB', 'GB'] },
    count: { ar: ['', 'ألف', 'مليون', 'مليار'], en: ['', 'K', 'M', 'B'], fr: ['', 'K', 'M', 'Md'], es: ['', 'K', 'M', 'MM'] },
  };
  function units(kind) { var u = UNITS[kind]; return (u && (u[lang] || u.ar)) || []; }

  var AR = /[\u0600-\u06FF]/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };

  // ---- translation cache (per-language, persisted) ----
  // v2: v1 cached unchanged Arabic results permanently (translation outage).
  // A fresh key lets every string be re-fetched now that failures are not cached.
  var cacheKey = 'gs_tr2_' + lang;
  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch (e) { cache = {}; }
  var cacheDirty = false;
  function saveCache() {
    if (!cacheDirty) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); cacheDirty = false; } catch (e) {}
  }
  setInterval(saveCache, 2000);
  window.addEventListener('beforeunload', saveCache);

  // Normalized override lookup (ignore Arabic diacritics / tatweel) so that
  // "الأعلى تقييماً" and "الأعلى تقييما" both resolve to the same entry.
  function norm(s) { return s.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); }
  var ON = {};
  var LOOKUP = {};
  Object.keys(O).forEach(function (k) {
    ON[norm(k)] = O[k];
    // Build a reverse lookup so dynamic values (like English category names)
    // can be mapped back to the Arabic source key and then translated.
    var vals = O[k];
    if (vals) {
      ['ar', 'en', 'fr', 'es'].forEach(function (l) {
        var v = vals[l] || (l === 'ar' ? k : '');
        if (!v) return;
        var key = v.toLowerCase().trim();
        if (key && !LOOKUP[key]) LOOKUP[key] = k;
      });
    }
  });
  function lookup(text) {
    return LOOKUP[(text || '').toString().toLowerCase().trim()] || null;
  }

  function known(core) {
    var ov = ON[norm(core)];
    if (ov && ov[lang]) return ov[lang];
    if (cache[core] != null) return cache[core];
    return null;
  }

  // pending: core text -> list of apply callbacks
  var pending = {};
  var pendingKeys = [];
  var scheduled = false;
  var applying = false;

  // Short negative cache: avoid hammering the translation endpoint for strings
  // the provider could not translate, while still retrying 10 minutes later.
  var failedUntil = {};
  function queue(core, applyFn) {
    if (failedUntil[core] && failedUntil[core] > Date.now()) return;
    if (!pending[core]) { pending[core] = []; pendingKeys.push(core); }
    pending[core].push(applyFn);
    if (!scheduled) { scheduled = true; setTimeout(flush, 80); }
  }

  function flush() {
    scheduled = false;
    var keys = pendingKeys, map = pending;
    pendingKeys = []; pending = {};
    if (!keys.length) return;
    var todo = keys.filter(function (k) { return cache[k] == null; });
    var applyAll = function () {
      keys.forEach(function (core) {
        var v = known(core);
        if (v == null) return;
        map[core].forEach(function (fn) { applying = true; try { fn(v); } finally { applying = false; } });
      });
    };
    if (!todo.length) { applyAll(); return; }
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: lang, q: todo }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      var t = (data && data.t) || [];
      todo.forEach(function (core, i) {
        var v = t[i];
        // Only cache a REAL translation. Caching an unchanged (still Arabic)
        // string permanently blocks retries once the service recovers.
        if (typeof v === 'string' && v && v !== core) { cache[core] = v; cacheDirty = true; }
        else failedUntil[core] = Date.now() + 10 * 60 * 1000;
      });
      applyAll();
      saveCache();
    }).catch(function () { applyAll(); });
  }

  // Replace the meaningful (trimmed) part of a string, preserving surrounding whitespace.
  function reflow(raw, translated) {
    var core = raw.trim();
    if (!core) return raw;
    var idx = raw.indexOf(core);
    return raw.slice(0, idx) + translated + raw.slice(idx + core.length);
  }

  function doTextNode(node) {
    var raw = node.nodeValue;
    if (!raw || !AR.test(raw)) return;
    var core = raw.trim();
    if (!core) return;
    var hit = known(core);
    if (hit != null) {
      var out = reflow(raw, hit);
      if (out !== node.nodeValue) { applying = true; node.nodeValue = out; applying = false; }
      return;
    }
    queue(core, function (v) {
      // re-read raw in case the node text changed meanwhile
      var cur = node.nodeValue;
      if (cur && AR.test(cur)) node.nodeValue = reflow(cur, v);
    });
  }

  function doAttr(elm, attr) {
    if (!elm.getAttribute) return;
    var raw = elm.getAttribute(attr);
    if (!raw || !AR.test(raw)) return;
    var core = raw.trim();
    if (!core) return;
    var hit = known(core);
    if (hit != null) { applying = true; elm.setAttribute(attr, reflow(raw, hit)); applying = false; return; }
    queue(core, function (v) { applying = true; elm.setAttribute(attr, reflow(raw, v)); applying = false; });
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function walk(root) {
    if (lang === 'ar' || !root) return;
    if (root.nodeType === 3) { doTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest('[data-noi18n]')) return;

    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !AR.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        while (p && p.nodeType === 1) {
          if (SKIP_TAGS[p.tagName] || (p.hasAttribute && p.hasAttribute('data-noi18n'))) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [], cur;
    while ((cur = tw.nextNode())) nodes.push(cur);
    nodes.forEach(doTextNode);

    var elems = [root];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) elems.push(all[i]);
    elems.forEach(function (e) {
      if (e.closest && e.closest('[data-noi18n]')) return;
      for (var a = 0; a < ATTRS.length; a++) if (e.hasAttribute && e.hasAttribute(ATTRS[a])) doAttr(e, ATTRS[a]);
    });
  }

  var observer = new MutationObserver(function (muts) {
    if (applying || lang === 'ar') return;
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') { doTextNode(m.target); }
      else if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) walk(n);
          else if (n.nodeType === 3) doTextNode(n);
        }
      }
    }
  });

  function start() {
    if (lang === 'ar') return;
    walk(document.body);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    if (document.title && AR.test(document.title)) {
      var ttl = document.title, core = ttl.trim();
      var hit = known(core);
      if (hit != null) document.title = reflow(ttl, hit);
      else queue(core, function (v) { document.title = reflow(ttl, v); });
    }
  }

  function setLang(l) {
    if (!LANGS.some(function (x) { return x.code === l; }) || l === lang) return;
    try { localStorage.setItem('gs_lang', l); } catch (e) {}
    location.reload();
  }

  // Language switcher button (globe + menu). Self-contained DOM.
  function switcherEl() {
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.setAttribute('data-noi18n', '');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn lang-btn';
    btn.setAttribute('aria-label', t('اللغة'));
    btn.setAttribute('title', t('اللغة'));
    try { btn.appendChild(window.GSIcons.iconEl('globe', 'icon')); } catch (e) {}
    var code = document.createElement('span');
    code.className = 'lang-code';
    code.textContent = lang.toUpperCase();
    btn.appendChild(code);

    var menu = document.createElement('div');
    menu.className = 'lang-menu';
    LANGS.forEach(function (l) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'lang-item' + (l.code === lang ? ' on' : '');
      it.textContent = l.label;
      it.onclick = function () { setLang(l.code); };
      menu.appendChild(it);
    });

    btn.onclick = function (e) { e.stopPropagation(); wrap.classList.toggle('open'); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  function t(arText) {
    if (lang === 'ar') return arText;
    var hit = known((arText || '').trim());
    return hit != null ? hit : arText;
  }

  window.GSI18N = {
    lang: lang,
    isRTL: dir === 'rtl',
    setLang: setLang,
    switcherEl: switcherEl,
    units: units,
    t: t,
    translate: walk,
    lookup: lookup,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
