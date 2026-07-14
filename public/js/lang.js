// Goldenstore i18n — Arabic (source) + English / French / Spanish.
// UI strings are translated instantly from a curated dictionary; everything
// else (descriptions, dynamic content) is auto-translated via /api/translate
// and cached permanently, so there is no flicker or language mixing.
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
    return LANGS.some(function (x) { return x.code === l; }) ? l : 'ar';
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
    'المميزة': { en: 'Featured', fr: 'En vedette', es: 'Destacados' },
    'أنت': { en: 'You', fr: 'Vous', es: 'Tú' },
    'الفئات': { en: 'Categories', fr: 'Catégories', es: 'Categorías' },
    'التصنيفات': { en: 'Categories', fr: 'Catégories', es: 'Categorías' },
    'تصفح': { en: 'Browse', fr: 'Parcourir', es: 'Explorar' },
    'تصفّح': { en: 'Browse', fr: 'Parcourir', es: 'Explorar' },
    'تصفح حسب الفئة': { en: 'Browse by category', fr: 'Parcourir par catégorie', es: 'Explorar por categoría' },
    'الإعدادات': { en: 'Settings', fr: 'Paramètres', es: 'Ajustes' },
    'مكتبتي': { en: 'My Library', fr: 'Ma bibliothèque', es: 'Mi biblioteca' },
    'مكتبتك فارغة': { en: 'Your library is empty', fr: 'Votre bibliothèque est vide', es: 'Tu biblioteca está vacía' },
    'تصفّح التطبيقات': { en: 'Browse apps', fr: 'Parcourir les apps', es: 'Explorar apps' },
    'إعادة تحميل': { en: 'Reinstall', fr: 'Réinstaller', es: 'Reinstalar' },
    'مسح السجل': { en: 'Clear history', fr: 'Effacer l\'historique', es: 'Borrar historial' },
    'المظهر': { en: 'Appearance', fr: 'Apparence', es: 'Apariencia' },
    'فاتح': { en: 'Light', fr: 'Clair', es: 'Claro' },
    'غامق': { en: 'Dark', fr: 'Sombre', es: 'Oscuro' },
    'اللغة': { en: 'Language', fr: 'Langue', es: 'Idioma' },
    'حول Golden Store': { en: 'About Golden Store', fr: 'À propos de Golden Store', es: 'Acerca de Golden Store' },
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

    // actions (machine translation gets these wrong, e.g. تثبيت -> "stabilisation")
    'تثبيت': { en: 'Install', fr: 'Installer', es: 'Instalar' },
    'تم التثبيت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'مثبت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'مثبّت': { en: 'Installed', fr: 'Installé', es: 'Instalado' },
    'فتح': { en: 'Open', fr: 'Ouvrir', es: 'Abrir' },
    'عرض': { en: 'View', fr: 'Voir', es: 'Ver' },
    'تنزيل': { en: 'Download', fr: 'Télécharger', es: 'Descargar' },
    'جارٍ التحميل…': { en: 'Downloading…', fr: 'Téléchargement…', es: 'Descargando…' },
    'طلب تحديث': { en: 'Request update', fr: 'Demander une mise à jour', es: 'Solicitar actualización' },
    'إرسال الطلب': { en: 'Send request', fr: 'Envoyer la demande', es: 'Enviar solicitud' },
    'إبلاغ': { en: 'Report', fr: 'Signaler', es: 'Reportar' },
    'إبلاغ عن مشكلة': { en: 'Report a problem', fr: 'Signaler un problème', es: 'Reportar un problema' },
    'إبلاغ عن التطبيق': { en: 'Report app', fr: 'Signaler l’application', es: 'Reportar la aplicación' },
    'إرسال البلاغ': { en: 'Send report', fr: 'Envoyer le signalement', es: 'Enviar reporte' },

    'ابحث عن تطبيقات وألعاب': { en: 'Search apps and games', fr: 'Rechercher des applis et jeux', es: 'Buscar apps y juegos' },
    'عرض كل النتائج': { en: 'Show all results', fr: 'Voir tous les résultats', es: 'Ver todos los resultados' },
    'شبكة': { en: 'Grid', fr: 'Grille', es: 'Cuadrícula' },
    'قائمة': { en: 'List', fr: 'Liste', es: 'Lista' },

    // home sections / tabs
    'محتوى يهمك': { en: 'For you', fr: 'Pour vous', es: 'Para ti' },
    'الأكثر رواجا': { en: 'Trending', fr: 'Tendances', es: 'Tendencias' },
    'الأعلى تقييما': { en: 'Top rated', fr: 'Les mieux notés', es: 'Mejor valorados' },
    'موصى به لك': { en: 'Recommended for you', fr: 'Recommandé pour vous', es: 'Recomendado para ti' },
    'قد يعجبك أيضا': { en: 'You may also like', fr: 'Vous aimerez aussi', es: 'También te puede gustar' },
    'تطبيقات أخرى': { en: 'Other apps', fr: 'Autres applications', es: 'Otras aplicaciones' },
    'تطبيقات مماثلة': { en: 'Similar apps', fr: 'Applications similaires', es: 'Apps similares' },
    'ألعاب مماثلة': { en: 'Similar games', fr: 'Jeux similaires', es: 'Juegos similares' },
    'اختيارات المحررين': { en: 'Editors’ choice', fr: 'Choix de la rédaction', es: 'Selección del editor' },
    'ألعاب موصى بها': { en: 'Recommended games', fr: 'Jeux recommandés', es: 'Juegos recomendados' },
    'نتائج البحث': { en: 'Search results', fr: 'Résultats de recherche', es: 'Resultados de búsqueda' },

    // app detail labels
    'نبذة': { en: 'Overview', fr: 'Aperçu', es: 'Resumen' },
    'الوصف': { en: 'Description', fr: 'Description', es: 'Descripción' },
    'لقطات الشاشة': { en: 'Screenshots', fr: 'Captures d’écran', es: 'Capturas de pantalla' },
    'معلومات تقنية': { en: 'Technical info', fr: 'Informations techniques', es: 'Información técnica' },
    'المطور': { en: 'Developer', fr: 'Développeur', es: 'Desarrollador' },
    'المطوّر': { en: 'Developer', fr: 'Développeur', es: 'Desarrollador' },
    'التصنيف': { en: 'Category', fr: 'Catégorie', es: 'Categoría' },
    'الإصدار': { en: 'Version', fr: 'Version', es: 'Versión' },
    'الإصدار الحالي': { en: 'Current version', fr: 'Version actuelle', es: 'Versión actual' },
    'الإصدار الجديد': { en: 'New version', fr: 'Nouvelle version', es: 'Nueva versión' },
    'رابط المصدر': { en: 'Source link', fr: 'Lien source', es: 'Enlace de origen' },
    'سبب البلاغ': { en: 'Reason', fr: 'Motif', es: 'Motivo' },
    'تفاصيل إضافية': { en: 'Additional details', fr: 'Détails supplémentaires', es: 'Detalles adicionales' },
    'الحجم': { en: 'Size', fr: 'Taille', es: 'Tamaño' },
    'آخر تحديث': { en: 'Last updated', fr: 'Dernière mise à jour', es: 'Última actualización' },
    'عدد التنزيلات': { en: 'Downloads', fr: 'Téléchargements', es: 'Descargas' },
    'اسم الحزمة': { en: 'Package name', fr: 'Nom du package', es: 'Nombre del paquete' },

    // account / misc
    'تطبيقاتي وألعابي': { en: 'My apps & games', fr: 'Mes applis et jeux', es: 'Mis apps y juegos' },
    'إدارة التنزيلات': { en: 'Manage downloads', fr: 'Gérer les téléchargements', es: 'Gestionar descargas' },
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
    'تقييمك': { en: 'Your rating', fr: 'Votre note', es: 'Tu valoración' },
    'نجوم': { en: 'stars', fr: 'étoiles', es: 'estrellas' },
    'من': { en: 'of', fr: 'sur', es: 'de' },
    'كن أول من يقيّم هذا التطبيق': { en: 'Be the first to rate this app', fr: 'Soyez le premier à noter cette app', es: 'Sé el primero en valorar esta app' },
    'قيّم واكتب مراجعتك': { en: 'Rate and write your review', fr: 'Notez et écrivez votre avis', es: 'Valora y escribe tu reseña' },
    'تنشر باسم حسابك': { en: 'Published as your account', fr: 'Publié sous votre compte', es: 'Publicado con tu cuenta' },
    'شارك رأيك في هذا التطبيق…': { en: 'Share your thoughts about this app…', fr: 'Partagez votre avis sur cette app…', es: 'Comparte tu opinión sobre esta app…' },
    'نشر المراجعة': { en: 'Post review', fr: 'Publier l’avis', es: 'Publicar reseña' },
    'تم نشر مراجعتك': { en: 'Your review has been posted', fr: 'Votre avis a été publié', es: 'Tu reseña ha sido publicada' },
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
    'تأكد من الرابط أو عد للرئيسية.': { en: 'Check the URL or go back to home.', fr: 'Vérifiez le lien ou retournez à l’accueil.', es: 'Verifica el enlace o vuelve al inicio.' },
    'العودة للرئيسية': { en: 'Go to home', fr: 'Retour à l’accueil', es: 'Ir al inicio' },
    'لمحة عن هذا التطبيق': { en: 'About this app', fr: 'À propos de cette app', es: 'Sobre esta app' },
    'تنزيلات': { en: 'Downloads', fr: 'Téléchargements', es: 'Descargas' },
    'أندرويد': { en: 'Android', fr: 'Android', es: 'Android' },
    'شريحة': { en: 'Chip', fr: 'Puce', es: 'Chip' },
    'تطبيق': { en: 'app', fr: 'application', es: 'aplicación' },
    'يحتوي على عمليات شراء داخل التطبيق': { en: 'Contains in-app purchases', fr: 'Contient des achats intégrés', es: 'Contiene compras dentro de la app' },
    'جار التحميل…': { en: 'Downloading…', fr: 'Téléchargement…', es: 'Descargando…' },
    'اكتمل التحميل وحفظ الملف في جهازك': { en: 'Download complete, file saved', fr: 'Téléchargement terminé, fichier enregistré', es: 'Descarga completa, archivo guardado' },
    'سيتم تنزيل ملف APK': { en: 'APK file will be downloaded', fr: 'Le fichier APK sera téléchargé', es: 'Se descargará el archivo APK' },
    'فعل «تثبيت من مصادر غير معروفة» لإكمال التثبيت.': { en: 'Enable "Install from unknown sources" to complete.', fr: 'Activez « Sources inconnues » pour terminer.', es: 'Habilita "Fuentes desconocidas" para completar.' },
    'تعذر عرض شريط التقدم، وبدأ التنزيل بالطريقة العادية': { en: 'Progress bar unavailable, download started normally', fr: 'Barre de progression indisponible, téléchargement lancé', es: 'Barra de progreso no disponible, descarga iniciada' },
    'مشاركة': { en: 'Share', fr: 'Partager', es: 'Compartir' },
    'تم نسخ الرابط': { en: 'Link copied', fr: 'Lien copié', es: 'Enlace copiado' },
    'خيارات إضافية': { en: 'More options', fr: 'Plus d’options', es: 'Más opciones' },
    'تطبيق مميز مختار لك': { en: 'Featured app picked for you', fr: 'App en vedette choisie pour vous', es: 'App destacada elegida para ti' },

    // report / update request
    'التطبيق فيه فيروس': { en: 'App contains a virus', fr: 'L’application contient un virus', es: 'La app contiene un virus' },
    'رابط التحميل لا يعمل': { en: 'Download link not working', fr: 'Le lien ne fonctionne pas', es: 'El enlace de descarga no funciona' },
    'محتوى غير لائق': { en: 'Inappropriate content', fr: 'Contenu inapproprié', es: 'Contenido inapropiado' },
    'انتهاك حقوق نشر': { en: 'Copyright violation', fr: 'Violation de droits d’auteur', es: 'Violación de derechos de autor' },
    'معلومات خاطئة': { en: 'False information', fr: 'Informations erronées', es: 'Información falsa' },
    'سبب آخر': { en: 'Other reason', fr: 'Autre raison', es: 'Otro motivo' },
    'يرجى ملء الحقول المطلوبة': { en: 'Please fill required fields', fr: 'Veuillez remplir les champs requis', es: 'Completa los campos requeridos' },
    'تم إرسال طلبك إلى الإدارة': { en: 'Your request has been sent', fr: 'Votre demande a été envoyée', es: 'Tu solicitud ha sido enviada' },
    'تعذر الإرسال، حاول مجددا': { en: 'Failed to send, try again', fr: 'Échec, réessayez', es: 'Error al enviar, inténtalo de nuevo' },

    // auth / login
    'متابعة باستخدام Google': { en: 'Continue with Google', fr: 'Continuer avec Google', es: 'Continuar con Google' },
    'سجل الدخول بحساب Google للوصول إلى المتجر وتنزيل التطبيقات.': { en: 'Sign in with Google to access the store.', fr: 'Connectez-vous avec Google pour accéder au store.', es: 'Inicia sesión con Google para acceder a la tienda.' },
    'بالمتابعة فإنك توافق على شروط الاستخدام وسياسة الخصوصية لـ Golden Store.': { en: 'By continuing, you agree to Golden Store terms and privacy policy.', fr: 'En continuant, vous acceptez les conditions de Golden Store.', es: 'Al continuar, aceptas los términos de Golden Store.' },
    'جار تسجيل الدخول…': { en: 'Signing in…', fr: 'Connexion…', es: 'Iniciando sesión…' },
    'حسابك': { en: 'Your account', fr: 'Votre compte', es: 'Tu cuenta' },

    // account / library
    'تطبيق في مكتبتك': { en: 'app in your library', fr: 'app dans votre bibliothèque', es: 'app en tu biblioteca' },
    'حذف سجل التحميلات بالكامل؟': { en: 'Clear entire download history?', fr: 'Effacer tout l’historique ?', es: '¿Borrar todo el historial de descargas?' },
    'تم مسح السجل': { en: 'History cleared', fr: 'Historique effacé', es: 'Historial borrado' },

    // misc
    'ابحث عن التطبيقات والألعاب': { en: 'Search apps & games', fr: 'Rechercher des apps et jeux', es: 'Buscar apps y juegos' },
    'اختيارات المحرّرين المنتقاة لك': { en: 'Editors’ picks curated for you', fr: 'Sélection de la rédaction pour vous', es: 'Selección del editor para ti' },
    'تعذر تحميل البيانات': { en: 'Failed to load data', fr: 'Échec du chargement', es: 'Error al cargar los datos' },
    'تحقق من اتصالك بالإنترنت ثم حدث الصفحة.': { en: 'Check your internet connection and refresh.', fr: 'Vérifiez votre connexion et actualisez.', es: 'Verifica tu conexión y actualiza.' },
    'حاول لاحقا بعد دقائق قليلة.': { en: 'Try again in a few minutes.', fr: 'Réessayez dans quelques minutes.', es: 'Inténtalo en unos minutos.' },
    'حدث الصفحة وحاول مجددا.': { en: 'Refresh the page and try again.', fr: 'Actualisez et réessayez.', es: 'Actualiza la página e inténtalo.' },
    'الخدمة غير متاحة مؤقتا': { en: 'Service temporarily unavailable', fr: 'Service temporairement indisponible', es: 'Servicio temporalmente no disponible' },
    'الرابط غير صحيح.': { en: 'Invalid link.', fr: 'Lien invalide.', es: 'Enlace no válido.' },
    'تصفّح حسب الفئة': { en: 'Browse by category', fr: 'Parcourir par catégorie', es: 'Explorar por categoría' },
    'المميّزة': { en: 'Featured', fr: 'En vedette', es: 'Destacados' },
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
  var cacheKey = 'gs_tr_' + lang;
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
  Object.keys(O).forEach(function (k) { ON[norm(k)] = O[k]; });

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

  function queue(core, applyFn) {
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
        // Cache any non-empty string (even if unchanged) so we never re-request
        // it and never blank out content. Empty results are ignored.
        if (typeof v === 'string' && v) { cache[core] = v; cacheDirty = true; }
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
    btn.setAttribute('aria-label', 'Language');
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
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
