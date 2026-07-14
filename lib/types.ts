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

export interface Category {
  slug: string;
  name: string;
  icon: string;
  position: number;
  count?: number;
}

// ---- App categories (matching Google Play) ----
export const APP_CATEGORIES: Category[] = [
  { slug: 'social',            name: 'تواصل اجتماعي',       icon: 'message',    position: 1 },
  { slug: 'communication',     name: 'اتصالات',             icon: 'phone',      position: 2 },
  { slug: 'tools',             name: 'أدوات',              icon: 'wrench',     position: 3 },
  { slug: 'productivity',      name: 'إنتاجية',             icon: 'clipboard',  position: 4 },
  { slug: 'entertainment',     name: 'ترفيه',              icon: 'film',       position: 5 },
  { slug: 'education',         name: 'تعليم',               icon: 'book',       position: 6 },
  { slug: 'photography',       name: 'تصوير',              icon: 'camera',     position: 7 },
  { slug: 'music',             name: 'موسيقى وصوتيات',      icon: 'music',      position: 8 },
  { slug: 'video_players',     name: 'مشغّلات فيديو',       icon: 'film',       position: 9 },
  { slug: 'finance',           name: 'مالية',               icon: 'coin',       position: 10 },
  { slug: 'shopping',          name: 'تسوق',                icon: 'cart',       position: 11 },
  { slug: 'news',              name: 'أخبار ومجلات',        icon: 'news',       position: 12 },
  { slug: 'health',            name: 'صحة ولياقة',          icon: 'heart',      position: 13 },
  { slug: 'travel',            name: 'سفر ومحلّي',          icon: 'plane',      position: 14 },
  { slug: 'food',              name: 'طعام وشراب',          icon: 'coffee',     position: 15 },
  { slug: 'lifestyle',         name: 'أسلوب حياة',          icon: 'sun',        position: 16 },
  { slug: 'books',             name: 'كتب ومراجع',          icon: 'book',       position: 17 },
  { slug: 'business',          name: 'أعمال',               icon: 'briefcase',  position: 18 },
  { slug: 'dating',            name: 'تعارف',               icon: 'heart',      position: 19 },
  { slug: 'maps',              name: 'خرائط وملاحة',        icon: 'globe',      position: 20 },
  { slug: 'medical',           name: 'طبّي',                icon: 'shieldCheck', position: 21 },
  { slug: 'personalization',   name: 'تخصيص',               icon: 'settings',   position: 22 },
  { slug: 'sports',            name: 'رياضة',               icon: 'trophy',     position: 23 },
  { slug: 'weather',           name: 'طقس',                 icon: 'cloud',      position: 24 },
  { slug: 'auto',              name: 'سيارات ومركبات',      icon: 'truck',      position: 25 },
  { slug: 'beauty',            name: 'جمال وتجميل',         icon: 'sparkle',    position: 26 },
  { slug: 'art_design',        name: 'فنّ وتصميم',          icon: 'image',      position: 27 },
  { slug: 'house_home',        name: 'منزل',                icon: 'home',       position: 28 },
  { slug: 'parenting',         name: 'أبوّة وأمومة',        icon: 'users',      position: 29 },
  { slug: 'events',            name: 'فعاليات',             icon: 'calendar',   position: 30 },
  { slug: 'comics',            name: 'قصص مصوّرة',          icon: 'book',       position: 31 },
  { slug: 'vpn',               name: 'VPN وخصوصية',         icon: 'shieldCheck', position: 32 },
  { slug: 'system',            name: 'أدوات النظام',        icon: 'settings',   position: 33 },
  { slug: 'wallpapers',        name: 'خلفيات',              icon: 'image',      position: 34 },
  { slug: 'files',             name: 'إدارة الملفات',       icon: 'package',    position: 35 },
  { slug: 'connectivity',      name: 'اتصال وشبكات',        icon: 'globe',      position: 36 },
  { slug: 'other',             name: 'أخرى',                icon: 'sparkle',    position: 99 },
];

// ---- Game categories (matching Google Play) ----
export const GAME_CATEGORIES: Category[] = [
  { slug: 'game_action',       name: 'أكشن',               icon: 'gamepad',    position: 1 },
  { slug: 'game_adventure',    name: 'مغامرات',            icon: 'compass',    position: 2 },
  { slug: 'game_arcade',       name: 'أركيد',              icon: 'gamepad',    position: 3 },
  { slug: 'game_board',        name: 'ألعاب لوحية',        icon: 'grid',       position: 4 },
  { slug: 'game_card',         name: 'ورق (كوتشينة)',      icon: 'layers',     position: 5 },
  { slug: 'game_casino',       name: 'كازينو',             icon: 'coin',       position: 6 },
  { slug: 'game_casual',       name: 'عادية',              icon: 'gamepad',    position: 7 },
  { slug: 'game_educational',  name: 'تعليمية',            icon: 'book',       position: 8 },
  { slug: 'game_music',        name: 'موسيقى',             icon: 'music',      position: 9 },
  { slug: 'game_puzzle',       name: 'ألغاز',              icon: 'grid',       position: 10 },
  { slug: 'game_racing',       name: 'سباقات',             icon: 'truck',      position: 11 },
  { slug: 'game_rpg',          name: 'تقمّص أدوار',        icon: 'shield',     position: 12 },
  { slug: 'game_simulation',   name: 'محاكاة',             icon: 'globe',      position: 13 },
  { slug: 'game_sports',       name: 'رياضية',             icon: 'trophy',     position: 14 },
  { slug: 'game_strategy',     name: 'استراتيجية',         icon: 'layers',     position: 15 },
  { slug: 'game_trivia',       name: 'معلومات عامة',       icon: 'info',       position: 16 },
  { slug: 'game_word',         name: 'كلمات',              icon: 'edit',       position: 17 },
  { slug: 'game_family',       name: 'عائلية',             icon: 'users',      position: 18 },
  { slug: 'game_shooter',      name: 'إطلاق نار',          icon: 'shield',     position: 19 },
  { slug: 'game_action_adventure', name: 'حركة ومغامرة',   icon: 'compass',    position: 20 },
  { slug: 'game_role_playing', name: 'ألعاب جماعية',       icon: 'users',      position: 21 },
  { slug: 'game_other',        name: 'ألعاب أخرى',         icon: 'gamepad',    position: 99 },
];

// Combined list (legacy compatibility)
export const DEFAULT_CATEGORIES: Category[] = [
  ...APP_CATEGORIES,
  ...GAME_CATEGORIES,
];
