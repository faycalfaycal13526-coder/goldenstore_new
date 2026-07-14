// Firebase Auth — Google Sign-in module
// Uses Firebase compat SDK loaded from CDN in HTML

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyC8Ea0p8KXudJWyt8_olKrGBjI52P9EoEM",
  authDomain: "ahmed-88be9.firebaseapp.com",
  databaseURL: "https://ahmed-88be9-default-rtdb.firebaseio.com",
  projectId: "ahmed-88be9",
  storageBucket: "ahmed-88be9.firebasestorage.app",
  messagingSenderId: "152065600130",
  appId: "1:152065600130:web:1824f21e11207e0edee29b",
  measurementId: "G-5VN0LTLNGX"
};

var _app = null;
var _auth = null;
var _currentUser = null;
var _resolved = false;
var _listeners = [];
var _redirectPending = false;

function initFirebase() {
  if (_app) return;
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded');
    return;
  }
  _app = firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  _auth.languageCode = 'ar';
  _auth.onAuthStateChanged(function(user) {
    _currentUser = user;
    _resolved = true;
    _listeners.forEach(function(fn) { fn(user); });
  });
  // Complete any pending redirect-based sign-in.
  _auth.getRedirectResult().then(function(result) {
    if (result && result.user) {
      _redirectPending = false;
      // onAuthStateChanged will fire and handle the rest
    }
  }).catch(function(e) {
    _redirectPending = false;
    if (e && e.code) console.error('getRedirectResult', e.code, e.message);
    // Notify listeners so the gate re-renders with button enabled
    _listeners.forEach(function(fn) { fn(null); });
  });
}

function onAuthChange(fn) {
  _listeners.push(fn);
  if (_resolved) fn(_currentUser);
}

// Resolves once Firebase has determined the initial auth state. This lets
// callers (e.g. points earning) wait for the real user object instead of
// racing the optimistic cached render.
function ready() {
  return new Promise(function (resolve) {
    if (_resolved) { resolve(_currentUser); return; }
    var done = false;
    _listeners.push(function (user) { if (!done) { done = true; resolve(user); } });
    // Safety timeout so callers never hang if the SDK never resolves.
    setTimeout(function () { if (!done) { done = true; resolve(_currentUser); } }, 6000);
  });
}

function getUser() {
  return _currentUser;
}

// Returns a fresh Firebase ID token for the signed-in user, or null. Used to
// authenticate sensitive API calls (points earning/withdrawal) server-side.
async function getIdToken(forceRefresh) {
  try {
    if (_currentUser && _currentUser.getIdToken) {
      return await _currentUser.getIdToken(!!forceRefresh);
    }
  } catch (e) {
    console.error('getIdToken failed', e);
  }
  return null;
}

function makeProvider() {
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

// In-app webviews (Facebook, Instagram, TikTok, …) block popups AND break the
// redirect handoff, so Google sign-in cannot complete inside them.
function isInAppBrowser() {
  var ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line|Twitter|Snapchat|TikTok|WebView|; wv\)/i.test(ua);
}

// Detect our native GoldenStore Android app — uses redirect flow instead of
// popup because WebView popups lack window.opener.
function isGoldenStoreApp() {
  var ua = navigator.userAgent || '';
  return /GoldenStoreApp/i.test(ua);
}

// Use a popup in regular browsers. In the GoldenStore app, use redirect flow
// because WebView popup windows don't support window.opener / postMessage
// back to the main WebView, causing a white page after account selection.
async function signInWithGoogle() {
  initFirebase();
  if (!_auth) throw new Error('Firebase not initialized');

  if (isInAppBrowser()) {
    var iae = new Error('in-app-browser');
    iae.code = 'auth/in-app-browser';
    throw iae;
  }

  // Native app: always use redirect (popup can't communicate back)
  if (isGoldenStoreApp()) {
    _redirectPending = true;
    await _auth.signInWithRedirect(makeProvider());
    return null;
  }

  try {
    var result = await _auth.signInWithPopup(makeProvider());
    return result.user;
  } catch (e) {
    var code = e && e.code;
    // User dismissed the popup — not an error.
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return null;
    }
    // Popup blocked/unsupported: fall back to redirect as a last resort. The
    // dedicated /login page processes getRedirectResult on return.
    if (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/web-storage-unsupported') {
      _redirectPending = true;
      await _auth.signInWithRedirect(makeProvider());
      return null;
    }
    // Any other error: throw so the UI shows it
    throw e;
  }
}

async function signOut() {
  if (_auth) await _auth.signOut();
}

window.GAuth = {
  init: initFirebase,
  onAuthChange: onAuthChange,
  ready: ready,
  getUser: getUser,
  getIdToken: getIdToken,
  signInWithGoogle: signInWithGoogle,
  signOut: signOut,
  isRedirectPending: function() { return _redirectPending; },
};

// Auto-init
document.addEventListener('DOMContentLoaded', initFirebase);
