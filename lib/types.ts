export interface App {
  id?: string;
  slug: string;
  name: string;
  name_lower: string;
  search_terms: string[];
  package_name: string;
  short_description?: string;
  description?: string;
  category: string;
  type?: 'app' | 'game'; // distinguishes regular apps from games
  developer?: string;
  version_name?: string;
  version_code?: number;
  min_sdk?: number;
  size_bytes: number;
  apk_key: string;
  icon_key?: string;
  feature_key?: string; // wide "feature graphic" shown in editors-choice carousel
  // Ratings (real, computed from user votes)
  stars: number;          // total number of ratings (kept in sync with rating_count)
  rating_sum?: number;    // sum of all 1–5 star ratings
  rating_count?: number;  // number of ratings received
  rating?: number;        // denormalized average rating (0–5) for sorting/display
  downloads: number;
  created_at: number;
  updated_at: number;
}

export interface Screenshot {
  id?: string;
  app_id: string;
  r2_key: string;
  position: number;
  created_at: number;
}

export interface AppVideo {
  id: string;
  app_id: string;
  video_id: string;
  kind: 'video' | 'short';
  url: string;
  title: string;
  thumb_key: string | null;        // optional custom thumbnail in R2 (vthumb/)
  position: number;
  created_at: number;
}

export interface Category {
  slug: string;
  name: string;
  icon: string;
  position: number;
  /** Browsing shelf this category belongs to (see CATEGORY_GROUPS). */
  group?: string;
  count?: number;
}

// ---- Category groups (Play-Store-style browsing sections) ----
// Groups keep apps and games in separate, clearly labelled shelves instead
// of one long mixed list. `group` on each category points at a slug here.
export interface CategoryGroup { slug: string; name: string; type: 'app' | 'game'; position: number; }

export const APP_CATEGORY_GROUPS: CategoryGroup[] = [
  { slug: 'social',    name: 'التواصل والاجتماعي',      type: 'app',  position: 1 },
  { slug: 'tools',     name: 'الأدوات والإنتاجية',      type: 'app',  position: 2 },
  { slug: 'media',     name: 'الترفيه والوسائط',        type: 'app',  position: 3 },
  { slug: 'learn',     name: 'التعليم والكتب',          type: 'app',  position: 4 },
  { slug: 'money',     name: 'المال والأعمال',          type: 'app',  position: 5 },
  { slug: 'life',      name: 'الصحة وأسلوب الحياة',     type: 'app',  position: 6 },
  { slug: 'travel',    name: 'السفر والمحلّي',          type: 'app',  position: 7 },
  { slug: 'custom',    name: 'التخصيص والنظام',         type: 'app',  position: 8 },
];

export const GAME_CATEGORY_GROUPS: CategoryGroup[] = [
  { slug: 'g_action',    name: 'الحركة والقتال',          type: 'game', position: 1 },
  { slug: 'g_adventure', name: 'المغامرة والقصص',         type: 'game', position: 2 },
  { slug: 'g_puzzle',    name: 'الألغاز والكلمات',        type: 'game', position: 3 },
  { slug: 'g_sport',     name: 'الرياضة والسباق',         type: 'game', position: 4 },
  { slug: 'g_strategy',  name: 'الاستراتيجية والمحاكاة',  type: 'game', position: 5 },
  { slug: 'g_table',     name: 'الورق واللوح',            type: 'game', position: 6 },
  { slug: 'g_family',    name: 'العائلة والتعليم',        type: 'game', position: 7 },
];

export const CATEGORY_GROUPS: CategoryGroup[] = [...APP_CATEGORY_GROUPS, ...GAME_CATEGORY_GROUPS];

// ---- App categories (Google Play taxonomy, expanded) ----
export const APP_CATEGORIES: Category[] = [
  { slug: 'social',              name: 'تواصل اجتماعي',             icon: 'message',       group: 'social',  position: 1 },
  { slug: 'communication',       name: 'اتصالات',                   icon: 'phone',         group: 'social',  position: 2 },
  { slug: 'messaging',           name: 'مراسلة فورية',              icon: 'send',          group: 'social',  position: 3 },
  { slug: 'email',               name: 'بريد إلكتروني',             icon: 'mail',          group: 'social',  position: 4 },
  { slug: 'dating',              name: 'تعارف وزواج',               icon: 'heart',         group: 'social',  position: 5 },
  { slug: 'forums',              name: 'منتديات ومجتمعات',          icon: 'users',         group: 'social',  position: 6 },
  { slug: 'tools',               name: 'أدوات',                     icon: 'wrench',        group: 'tools',   position: 7 },
  { slug: 'productivity',        name: 'إنتاجية',                   icon: 'clipboard',     group: 'tools',   position: 8 },
  { slug: 'notes',               name: 'ملاحظات',                   icon: 'edit',          group: 'tools',   position: 9 },
  { slug: 'calendar_tasks',      name: 'تقويم ومهام',               icon: 'calendar',      group: 'tools',   position: 10 },
  { slug: 'calculator',          name: 'آلات حاسبة',                icon: 'grid',          group: 'tools',   position: 11 },
  { slug: 'translator',          name: 'ترجمة',                     icon: 'globe',         group: 'tools',   position: 12 },
  { slug: 'scanner',             name: 'ماسح ضوئي و OCR',           icon: 'copy',          group: 'tools',   position: 13 },
  { slug: 'pdf',                 name: 'PDF ومستندات',              icon: 'book',          group: 'tools',   position: 14 },
  { slug: 'files',               name: 'إدارة الملفات',             icon: 'package',       group: 'tools',   position: 15 },
  { slug: 'backup',              name: 'نسخ احتياطي واستعادة',      icon: 'storage',       group: 'tools',   position: 16 },
  { slug: 'cleaner',             name: 'تنظيف وتسريع',              icon: 'refresh',       group: 'tools',   position: 17 },
  { slug: 'battery',             name: 'بطارية وطاقة',              icon: 'spark',         group: 'tools',   position: 18 },
  { slug: 'automation',          name: 'أتمتة',                     icon: 'settings',      group: 'tools',   position: 19 },
  { slug: 'remote',              name: 'تحكم عن بعد',               icon: 'external',      group: 'tools',   position: 20 },
  { slug: 'keyboard',            name: 'لوحات مفاتيح',              icon: 'edit',          group: 'tools',   position: 21 },
  { slug: 'browsers',            name: 'متصفحات',                   icon: 'globe',         group: 'tools',   position: 22 },
  { slug: 'vpn',                 name: 'VPN وخصوصية',               icon: 'shieldCheck',   group: 'tools',   position: 23 },
  { slug: 'security',            name: 'أمان وحماية',               icon: 'lock',          group: 'tools',   position: 24 },
  { slug: 'antivirus',           name: 'مضاد فيروسات',              icon: 'shield',        group: 'tools',   position: 25 },
  { slug: 'connectivity',        name: 'اتصال وشبكات',              icon: 'globe',         group: 'tools',   position: 26 },
  { slug: 'root',                name: 'رووت وصلاحيات',             icon: 'lock',          group: 'tools',   position: 27 },
  { slug: 'emulator',            name: 'محاكيات',                   icon: 'android',       group: 'tools',   position: 28 },
  { slug: 'gaming_tools',        name: 'أدوات الألعاب',             icon: 'gamepad',       group: 'tools',   position: 29 },
  { slug: 'libraries_demo',      name: 'مكتبات وتجارب',             icon: 'database',      group: 'tools',   position: 30 },
  { slug: 'entertainment',       name: 'ترفيه',                     icon: 'film',          group: 'media',   position: 31 },
  { slug: 'video_players',       name: 'مشغّلات ومحرّرات فيديو',    icon: 'film',          group: 'media',   position: 32 },
  { slug: 'video_editors',       name: 'تحرير الفيديو',             icon: 'edit',          group: 'media',   position: 33 },
  { slug: 'photography',         name: 'تصوير',                     icon: 'image',         group: 'media',   position: 34 },
  { slug: 'photo_editors',       name: 'تحرير الصور',               icon: 'image',         group: 'media',   position: 35 },
  { slug: 'music',               name: 'موسيقى وصوتيات',            icon: 'music',         group: 'media',   position: 36 },
  { slug: 'podcast',             name: 'بودكاست',                   icon: 'play',          group: 'media',   position: 37 },
  { slug: 'radio',               name: 'راديو',                     icon: 'music',         group: 'media',   position: 38 },
  { slug: 'streaming',           name: 'بث مباشر',                  icon: 'play',          group: 'media',   position: 39 },
  { slug: 'ringtones',           name: 'نغمات وأصوات',              icon: 'bell',          group: 'media',   position: 40 },
  { slug: 'movies',              name: 'أفلام ومسلسلات',            icon: 'film',          group: 'media',   position: 41 },
  { slug: 'comics',              name: 'قصص مصوّرة',                icon: 'book',          group: 'media',   position: 42 },
  { slug: 'education',           name: 'تعليم',                     icon: 'book',          group: 'learn',   position: 43 },
  { slug: 'languages',           name: 'تعلّم اللغات',              icon: 'globe',         group: 'learn',   position: 44 },
  { slug: 'study',               name: 'دراسة وامتحانات',           icon: 'clipboard',     group: 'learn',   position: 45 },
  { slug: 'dictionary',          name: 'قواميس ومعاجم',             icon: 'book',          group: 'learn',   position: 46 },
  { slug: 'books',               name: 'كتب ومراجع',                icon: 'book',          group: 'learn',   position: 47 },
  { slug: 'kids',                name: 'أطفال',                     icon: 'users',         group: 'learn',   position: 48 },
  { slug: 'religion',            name: 'إسلاميات ودين',             icon: 'moon',          group: 'learn',   position: 49 },
  { slug: 'quran',               name: 'القرآن الكريم',             icon: 'book',          group: 'learn',   position: 50 },
  { slug: 'courses',             name: 'دورات ومهارات',             icon: 'award',         group: 'learn',   position: 51 },
  { slug: 'finance',             name: 'مالية',                     icon: 'trending',      group: 'money',   position: 52 },
  { slug: 'banking',             name: 'بنوك ومحافظ',               icon: 'briefcase',     group: 'money',   position: 53 },
  { slug: 'crypto',              name: 'عملات رقمية',               icon: 'trending',      group: 'money',   position: 54 },
  { slug: 'investing',           name: 'استثمار وأسهم',             icon: 'trending',      group: 'money',   position: 55 },
  { slug: 'accounting',          name: 'محاسبة وفواتير',            icon: 'clipboard',     group: 'money',   position: 56 },
  { slug: 'business',            name: 'أعمال',                     icon: 'briefcase',     group: 'money',   position: 57 },
  { slug: 'jobs',                name: 'وظائف وتوظيف',              icon: 'search',        group: 'money',   position: 58 },
  { slug: 'shopping',            name: 'تسوق',                      icon: 'cart',          group: 'money',   position: 59 },
  { slug: 'deals',               name: 'عروض وكوبونات',             icon: 'gift',          group: 'money',   position: 60 },
  { slug: 'delivery',            name: 'توصيل طلبات',               icon: 'truck',         group: 'money',   position: 61 },
  { slug: 'realestate',          name: 'عقارات',                    icon: 'home',          group: 'money',   position: 62 },
  { slug: 'health',              name: 'صحة ولياقة',                icon: 'heart',         group: 'life',    position: 63 },
  { slug: 'medical',             name: 'طبّي',                      icon: 'shieldCheck',   group: 'life',    position: 64 },
  { slug: 'fitness',             name: 'تمارين ولياقة',             icon: 'trophy',        group: 'life',    position: 65 },
  { slug: 'meditation',          name: 'تأمل واسترخاء',             icon: 'moon',          group: 'life',    position: 66 },
  { slug: 'food',                name: 'طعام وشراب',                icon: 'coffee',        group: 'life',    position: 67 },
  { slug: 'recipes',             name: 'وصفات طبخ',                 icon: 'coffee',        group: 'life',    position: 68 },
  { slug: 'lifestyle',           name: 'أسلوب حياة',                icon: 'sun',           group: 'life',    position: 69 },
  { slug: 'beauty',              name: 'جمال وتجميل',               icon: 'sparkle',       group: 'life',    position: 70 },
  { slug: 'parenting',           name: 'أبوّة وأمومة',              icon: 'users',         group: 'life',    position: 71 },
  { slug: 'house_home',          name: 'منزل',                      icon: 'home',          group: 'life',    position: 72 },
  { slug: 'art_design',          name: 'فنّ وتصميم',                icon: 'image',         group: 'life',    position: 73 },
  { slug: 'travel',              name: 'سفر ومحلّي',                icon: 'globe',         group: 'travel',  position: 74 },
  { slug: 'maps',                name: 'خرائط وملاحة',              icon: 'compass',       group: 'travel',  position: 75 },
  { slug: 'hotels',              name: 'فنادق وحجز',                icon: 'home',          group: 'travel',  position: 76 },
  { slug: 'taxis',               name: 'تاكسي ونقل',                icon: 'truck',         group: 'travel',  position: 77 },
  { slug: 'transport',           name: 'مواصلات عامة',              icon: 'truck',         group: 'travel',  position: 78 },
  { slug: 'auto',                name: 'سيارات ومركبات',            icon: 'truck',         group: 'travel',  position: 79 },
  { slug: 'weather',             name: 'طقس',                       icon: 'cloud',         group: 'travel',  position: 80 },
  { slug: 'events',              name: 'فعاليات',                   icon: 'calendar',      group: 'travel',  position: 81 },
  { slug: 'news',                name: 'أخبار ومجلات',              icon: 'news',          group: 'travel',  position: 82 },
  { slug: 'sports',              name: 'رياضة',                     icon: 'trophy',        group: 'travel',  position: 83 },
  { slug: 'personalization',     name: 'تخصيص',                     icon: 'settings',      group: 'custom',  position: 84 },
  { slug: 'wallpapers',          name: 'خلفيات',                    icon: 'image',         group: 'custom',  position: 85 },
  { slug: 'launchers',           name: 'واجهات إطلاق',              icon: 'home',          group: 'custom',  position: 86 },
  { slug: 'widgets',             name: 'أدوات مصغّرة',              icon: 'grid',          group: 'custom',  position: 87 },
  { slug: 'icons_packs',         name: 'حزم أيقونات',               icon: 'apps',          group: 'custom',  position: 88 },
  { slug: 'themes',              name: 'سمات وخطوط',                icon: 'sparkle',       group: 'custom',  position: 89 },
  { slug: 'system',              name: 'أدوات النظام',              icon: 'settings',      group: 'custom',  position: 90 },
  { slug: 'other',               name: 'أخرى',                      icon: 'sparkle',       group: 'custom',  position: 999 },
];

// ---- Game categories (Google Play taxonomy, expanded) ----
export const GAME_CATEGORIES: Category[] = [
  { slug: 'game_action',             name: 'أكشن',                      icon: 'gamepad',       group: 'g_action',    position: 1 },
  { slug: 'game_shooter',            name: 'إطلاق نار',                 icon: 'shield',        group: 'g_action',    position: 2 },
  { slug: 'game_fighting',           name: 'قتال ومصارعة',              icon: 'shield',        group: 'g_action',    position: 3 },
  { slug: 'game_battle_royale',      name: 'باتل رويال',                icon: 'trophy',        group: 'g_action',    position: 4 },
  { slug: 'game_arcade',             name: 'أركيد',                     icon: 'gamepad',       group: 'g_action',    position: 5 },
  { slug: 'game_adventure',          name: 'مغامرات',                   icon: 'compass',       group: 'g_adventure', position: 6 },
  { slug: 'game_action_adventure',   name: 'حركة ومغامرة',              icon: 'compass',       group: 'g_adventure', position: 7 },
  { slug: 'game_rpg',                name: 'تقمّص الأدوار (RPG)',       icon: 'shield',        group: 'g_adventure', position: 8 },
  { slug: 'game_role_playing',       name: 'أدوار جماعية أونلاين',      icon: 'users',         group: 'g_adventure', position: 9 },
  { slug: 'game_story',              name: 'قصص تفاعلية',               icon: 'book',          group: 'g_adventure', position: 10 },
  { slug: 'game_horror',             name: 'رعب وبقاء',                 icon: 'moon',          group: 'g_adventure', position: 11 },
  { slug: 'game_survival',           name: 'بقاء وصناعة',               icon: 'package',       group: 'g_adventure', position: 12 },
  { slug: 'game_puzzle',             name: 'ألغاز',                     icon: 'grid',          group: 'g_puzzle',    position: 13 },
  { slug: 'game_brain',              name: 'ذكاء وتركيز',               icon: 'info',          group: 'g_puzzle',    position: 14 },
  { slug: 'game_word',               name: 'كلمات',                     icon: 'edit',          group: 'g_puzzle',    position: 15 },
  { slug: 'game_trivia',             name: 'معلومات عامة',              icon: 'info',          group: 'g_puzzle',    position: 16 },
  { slug: 'game_hidden_object',      name: 'أشياء مخفية',               icon: 'search',        group: 'g_puzzle',    position: 17 },
  { slug: 'game_escape',             name: 'هروب وألغاز غرف',           icon: 'lock',          group: 'g_puzzle',    position: 18 },
  { slug: 'game_sports',             name: 'رياضية',                    icon: 'trophy',        group: 'g_sport',     position: 19 },
  { slug: 'game_racing',             name: 'سباقات',                    icon: 'truck',         group: 'g_sport',     position: 20 },
  { slug: 'game_football',           name: 'كرة قدم',                   icon: 'trophy',        group: 'g_sport',     position: 21 },
  { slug: 'game_billiards',          name: 'بلياردو وسنوكر',            icon: 'grid',          group: 'g_sport',     position: 22 },
  { slug: 'game_strategy',           name: 'استراتيجية',                icon: 'layers',        group: 'g_strategy',  position: 23 },
  { slug: 'game_tower_defense',      name: 'دفاع الأبراج',              icon: 'shield',        group: 'g_strategy',  position: 24 },
  { slug: 'game_simulation',         name: 'محاكاة',                    icon: 'globe',         group: 'g_strategy',  position: 25 },
  { slug: 'game_farming',            name: 'زراعة ومزارع',              icon: 'sun',           group: 'g_strategy',  position: 26 },
  { slug: 'game_city',               name: 'بناء مدن',                  icon: 'home',          group: 'g_strategy',  position: 27 },
  { slug: 'game_tycoon',             name: 'إدارة وأعمال',              icon: 'briefcase',     group: 'g_strategy',  position: 28 },
  { slug: 'game_flight',             name: 'طيران وبحرية',              icon: 'globe',         group: 'g_strategy',  position: 29 },
  { slug: 'game_driving',            name: 'قيادة وشاحنات',             icon: 'truck',         group: 'g_strategy',  position: 30 },
  { slug: 'game_board',              name: 'ألعاب لوحية',               icon: 'grid',          group: 'g_table',     position: 31 },
  { slug: 'game_card',               name: 'ورق (كوتشينة)',             icon: 'layers',        group: 'g_table',     position: 32 },
  { slug: 'game_chess',              name: 'شطرنج',                     icon: 'grid',          group: 'g_table',     position: 33 },
  { slug: 'game_domino',             name: 'دومينو وطاولة',             icon: 'layers',        group: 'g_table',     position: 34 },
  { slug: 'game_casino',             name: 'كازينو',                    icon: 'gift',          group: 'g_table',     position: 35 },
  { slug: 'game_casual',             name: 'عادية',                     icon: 'gamepad',       group: 'g_family',    position: 36 },
  { slug: 'game_family',             name: 'عائلية',                    icon: 'users',         group: 'g_family',    position: 37 },
  { slug: 'game_kids',               name: 'أطفال',                     icon: 'users',         group: 'g_family',    position: 38 },
  { slug: 'game_educational',        name: 'تعليمية',                   icon: 'book',          group: 'g_family',    position: 39 },
  { slug: 'game_music',              name: 'موسيقى وإيقاع',             icon: 'music',         group: 'g_family',    position: 40 },
  { slug: 'game_other',              name: 'ألعاب أخرى',                icon: 'gamepad',       group: 'g_family',    position: 999 },
];

// Combined list (legacy compatibility)
export const DEFAULT_CATEGORIES: Category[] = [
  ...APP_CATEGORIES,
  ...GAME_CATEGORIES,
];
