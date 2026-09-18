// Theme & language init — runs synchronously before render to prevent FOUC.
try {
  var _th = localStorage.getItem('gs_theme') === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', _th);
  var _lg = localStorage.getItem('gs_lang') || 'ar';
  if (['ar', 'en', 'fr', 'es'].indexOf(_lg) < 0) _lg = 'ar';
  document.documentElement.lang = _lg;
  document.documentElement.dir = _lg === 'ar' ? 'rtl' : 'ltr';
} catch (e) {}
