/* RUANGDIGITAL190 — satu konfigurasi publik untuk index, admin, reset.
   Isi URL project dan publishable/anon key dari Supabase > Project Settings > API.
   Jangan pernah memasukkan service_role / secret key / password admin di sini.
   Semua halaman memakai project yang sama bila dua nilai di bawah sudah diisi. */
window.RD_CONFIG = Object.freeze({
  supabaseUrl: "PASTE_PROJECT_URL_HERE",
  supabaseAnonKey: "PASTE_PUBLIC_ANON_KEY_HERE",
  whatsappNumber: "6285725423328",
  storeName: "RUANGDIGITAL190",
  siteUrl: new URL("./", window.location.href).href
});
