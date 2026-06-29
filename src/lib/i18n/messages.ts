import type { LocaleCode } from "./locales";

/**
 * Dashboard UI strings, key → per-locale text. English is the source of truth;
 * ar/fr/es/de are hand-checked, and ur/id/tr/bn/ms are machine-quality pending
 * native review (the gate is correctness of the English baseline + that nothing
 * is left untranslated on the core screens). `t()` falls back to English for any
 * gap. Long help-paragraphs (e.g. the full positioning tips) intentionally stay
 * English for now — the labels/buttons/statuses below are what make each screen
 * understandable.
 */
export const MESSAGES = {
  // ── Nav ──
  "nav.record": { en: "Record", ar: "تسجيل", ur: "ریکارڈ", fr: "Enregistrer", es: "Grabar", id: "Rekam", tr: "Kaydet", bn: "রেকর্ড", ms: "Rakam", de: "Aufnehmen" },
  "nav.history": { en: "History", ar: "السجل", ur: "تاریخ", fr: "Historique", es: "Historial", id: "Riwayat", tr: "Geçmiş", bn: "ইতিহাস", ms: "Sejarah", de: "Verlauf" },

  // ── Record ──
  "record.tapToStart": { en: "Tap to start transcribing", ar: "اضغط لبدء التفريغ", ur: "ٹرانسکرپشن شروع کرنے کے لیے ٹیپ کریں", fr: "Touchez pour transcrire", es: "Toca para empezar a transcribir", id: "Ketuk untuk mulai mentranskripsi", tr: "Yazıya dökmek için dokunun", bn: "ট্রান্সক্রিপশন শুরু করতে ট্যাপ করুন", ms: "Ketik untuk mula menyalin", de: "Zum Transkribieren tippen" },
  "record.recording": { en: "Recording", ar: "جارٍ التسجيل", ur: "ریکارڈنگ", fr: "Enregistrement", es: "Grabando", id: "Merekam", tr: "Kaydediliyor", bn: "রেকর্ড হচ্ছে", ms: "Merakam", de: "Aufnahme" },
  "record.paused": { en: "Paused", ar: "متوقف مؤقتًا", ur: "موقوف", fr: "En pause", es: "En pausa", id: "Dijeda", tr: "Duraklatıldı", bn: "বিরতি", ms: "Dijeda", de: "Pausiert" },
  "record.complete": { en: "Session complete", ar: "اكتملت الجلسة", ur: "سیشن مکمل", fr: "Session terminée", es: "Sesión completada", id: "Sesi selesai", tr: "Oturum tamamlandı", bn: "সেশন সম্পন্ন", ms: "Sesi selesai", de: "Sitzung abgeschlossen" },
  "record.generateSummary": { en: "Generate AI summary", ar: "إنشاء ملخص بالذكاء الاصطناعي", ur: "اے آئی خلاصہ بنائیں", fr: "Générer un résumé IA", es: "Generar resumen con IA", id: "Buat ringkasan AI", tr: "Yapay zekâ özeti oluştur", bn: "এআই সারসংক্ষেপ তৈরি করুন", ms: "Jana ringkasan AI", de: "KI-Zusammenfassung erstellen" },
  "record.generating": { en: "Generating…", ar: "جارٍ الإنشاء…", ur: "بن رہا ہے…", fr: "Génération…", es: "Generando…", id: "Membuat…", tr: "Oluşturuluyor…", bn: "তৈরি হচ্ছে…", ms: "Menjana…", de: "Wird erstellt…" },
  "record.noTranscript": { en: "No transcript captured", ar: "لم يتم التقاط نص", ur: "کوئی ٹرانسکرپٹ نہیں", fr: "Aucune transcription", es: "Sin transcripción", id: "Tidak ada transkrip", tr: "Metin yakalanmadı", bn: "কোনো ট্রান্সক্রিপ্ট নেই", ms: "Tiada transkrip", de: "Kein Transkript erfasst" },
  "record.copy": { en: "Copy", ar: "نسخ", ur: "کاپی", fr: "Copier", es: "Copiar", id: "Salin", tr: "Kopyala", bn: "কপি", ms: "Salin", de: "Kopieren" },
  "record.copied": { en: "Copied", ar: "تم النسخ", ur: "کاپی ہو گیا", fr: "Copié", es: "Copiado", id: "Disalin", tr: "Kopyalandı", bn: "কপি হয়েছে", ms: "Disalin", de: "Kopiert" },
  "record.newRecording": { en: "New recording", ar: "تسجيل جديد", ur: "نئی ریکارڈنگ", fr: "Nouvel enregistrement", es: "Nueva grabación", id: "Rekaman baru", tr: "Yeni kayıt", bn: "নতুন রেকর্ডিং", ms: "Rakaman baharu", de: "Neue Aufnahme" },
  "record.listening": { en: "Listening…", ar: "جارٍ الاستماع…", ur: "سن رہا ہے…", fr: "Écoute…", es: "Escuchando…", id: "Mendengarkan…", tr: "Dinleniyor…", bn: "শুনছে…", ms: "Mendengar…", de: "Hört zu…" },
  "record.speakNearby": { en: "Speak or play audio nearby.", ar: "تحدّث أو شغّل الصوت بالقرب.", ur: "قریب بولیں یا آڈیو چلائیں۔", fr: "Parlez ou jouez l'audio à proximité.", es: "Habla o reproduce audio cerca.", id: "Bicara atau putar audio di dekatnya.", tr: "Yakında konuşun veya ses çalın.", bn: "কাছে কথা বলুন বা অডিও চালান।", ms: "Bercakap atau mainkan audio berdekatan.", de: "Sprich oder spiele Audio in der Nähe ab." },
  "record.translationHere": { en: "Translation appears here.", ar: "تظهر الترجمة هنا.", ur: "ترجمہ یہاں ظاہر ہوگا۔", fr: "La traduction apparaît ici.", es: "La traducción aparece aquí.", id: "Terjemahan muncul di sini.", tr: "Çeviri burada görünür.", bn: "অনুবাদ এখানে দেখা যাবে।", ms: "Terjemahan muncul di sini.", de: "Übersetzung erscheint hier." },
  "record.moveCloser": { en: "Move closer to the speaker — signal is weak", ar: "اقترب من مكبر الصوت — الإشارة ضعيفة", ur: "اسپیکر کے قریب جائیں — سگنل کمزور ہے", fr: "Rapprochez-vous du haut-parleur — signal faible", es: "Acércate al altavoz — la señal es débil", id: "Dekati pengeras suara — sinyal lemah", tr: "Hoparlöre yaklaşın — sinyal zayıf", bn: "স্পিকারের কাছে যান — সিগন্যাল দুর্বল", ms: "Dekati pembesar suara — isyarat lemah", de: "Näher ans Mikrofon — Signal schwach" },
  "record.tipsTitle": { en: "For best results", ar: "للحصول على أفضل النتائج", ur: "بہترین نتائج کے لیے", fr: "Pour de meilleurs résultats", es: "Para mejores resultados", id: "Untuk hasil terbaik", tr: "En iyi sonuç için", bn: "সেরা ফলাফলের জন্য", ms: "Untuk hasil terbaik", de: "Für beste Ergebnisse" },
  "record.gotIt": { en: "Got it", ar: "حسنًا", ur: "سمجھ گیا", fr: "Compris", es: "Entendido", id: "Mengerti", tr: "Anladım", bn: "বুঝেছি", ms: "Faham", de: "Verstanden" },

  // ── History ──
  "history.title": { en: "Your sessions", ar: "جلساتك", ur: "آپ کے سیشنز", fr: "Vos sessions", es: "Tus sesiones", id: "Sesi Anda", tr: "Oturumlarınız", bn: "আপনার সেশন", ms: "Sesi anda", de: "Deine Sitzungen" },
  "history.loading": { en: "Loading…", ar: "جارٍ التحميل…", ur: "لوڈ ہو رہا ہے…", fr: "Chargement…", es: "Cargando…", id: "Memuat…", tr: "Yükleniyor…", bn: "লোড হচ্ছে…", ms: "Memuatkan…", de: "Wird geladen…" },
  "history.searchPlaceholder": { en: "Search by title, language, or summary…", ar: "ابحث بالعنوان أو اللغة أو الملخص…", ur: "عنوان، زبان یا خلاصے سے تلاش کریں…", fr: "Rechercher par titre, langue ou résumé…", es: "Buscar por título, idioma o resumen…", id: "Cari berdasarkan judul, bahasa, atau ringkasan…", tr: "Başlık, dil veya özete göre ara…", bn: "শিরোনাম, ভাষা বা সারসংক্ষেপ দিয়ে খুঁজুন…", ms: "Cari ikut tajuk, bahasa atau ringkasan…", de: "Nach Titel, Sprache oder Zusammenfassung suchen…" },
  "history.emptyTitle": { en: "Your recorded sessions will appear here.", ar: "ستظهر جلساتك المسجّلة هنا.", ur: "آپ کے ریکارڈ شدہ سیشنز یہاں ظاہر ہوں گے۔", fr: "Vos sessions enregistrées apparaîtront ici.", es: "Tus sesiones grabadas aparecerán aquí.", id: "Sesi rekaman Anda akan muncul di sini.", tr: "Kaydettiğiniz oturumlar burada görünür.", bn: "আপনার রেকর্ড করা সেশন এখানে দেখা যাবে।", ms: "Sesi rakaman anda akan muncul di sini.", de: "Deine Aufnahmen erscheinen hier." },
  "history.emptySub": { en: "Tap the mic to start your first one.", ar: "اضغط على الميكروفون لبدء أول جلسة.", ur: "اپنا پہلا شروع کرنے کے لیے مائیک پر ٹیپ کریں۔", fr: "Touchez le micro pour commencer.", es: "Toca el micrófono para empezar.", id: "Ketuk mikrofon untuk memulai.", tr: "Başlamak için mikrofona dokunun.", bn: "প্রথমটি শুরু করতে মাইকে ট্যাপ করুন।", ms: "Ketik mikrofon untuk bermula.", de: "Tippe aufs Mikrofon, um zu starten." },
  "history.clearSearch": { en: "Clear search", ar: "مسح البحث", ur: "تلاش صاف کریں", fr: "Effacer la recherche", es: "Borrar búsqueda", id: "Hapus pencarian", tr: "Aramayı temizle", bn: "অনুসন্ধান মুছুন", ms: "Kosongkan carian", de: "Suche löschen" },

  // ── Settings ──
  "settings.title": { en: "Settings", ar: "الإعدادات", ur: "ترتیبات", fr: "Paramètres", es: "Ajustes", id: "Pengaturan", tr: "Ayarlar", bn: "সেটিংস", ms: "Tetapan", de: "Einstellungen" },
  "settings.account": { en: "Account", ar: "الحساب", ur: "اکاؤنٹ", fr: "Compte", es: "Cuenta", id: "Akun", tr: "Hesap", bn: "অ্যাকাউন্ট", ms: "Akaun", de: "Konto" },
  "settings.displayName": { en: "Display name", ar: "اسم العرض", ur: "ڈسپلے نام", fr: "Nom affiché", es: "Nombre visible", id: "Nama tampilan", tr: "Görünen ad", bn: "প্রদর্শন নাম", ms: "Nama paparan", de: "Anzeigename" },
  "settings.addName": { en: "Add your name", ar: "أضف اسمك", ur: "اپنا نام شامل کریں", fr: "Ajoutez votre nom", es: "Añade tu nombre", id: "Tambahkan nama Anda", tr: "Adınızı ekleyin", bn: "আপনার নাম যোগ করুন", ms: "Tambah nama anda", de: "Namen hinzufügen" },
  "settings.defaultLanguages": { en: "Default languages", ar: "اللغات الافتراضية", ur: "ڈیفالٹ زبانیں", fr: "Langues par défaut", es: "Idiomas predeterminados", id: "Bahasa default", tr: "Varsayılan diller", bn: "ডিফল্ট ভাষা", ms: "Bahasa lalai", de: "Standardsprachen" },
  "settings.appLanguage": { en: "App language", ar: "لغة التطبيق", ur: "ایپ کی زبان", fr: "Langue de l'app", es: "Idioma de la app", id: "Bahasa aplikasi", tr: "Uygulama dili", bn: "অ্যাপের ভাষা", ms: "Bahasa aplikasi", de: "App-Sprache" },
  "settings.subscription": { en: "Subscription", ar: "الاشتراك", ur: "سبسکرپشن", fr: "Abonnement", es: "Suscripción", id: "Langganan", tr: "Abonelik", bn: "সাবস্ক্রিপশন", ms: "Langganan", de: "Abonnement" },
  "settings.free": { en: "Free", ar: "مجاني", ur: "مفت", fr: "Gratuit", es: "Gratis", id: "Gratis", tr: "Ücretsiz", bn: "ফ্রি", ms: "Percuma", de: "Kostenlos" },
  "settings.allUnlocked": { en: "All features unlocked", ar: "جميع الميزات مفتوحة", ur: "تمام فیچرز کھلے ہیں", fr: "Toutes les fonctions débloquées", es: "Todas las funciones desbloqueadas", id: "Semua fitur terbuka", tr: "Tüm özellikler açık", bn: "সব ফিচার আনলক", ms: "Semua ciri dibuka", de: "Alle Funktionen freigeschaltet" },
  "settings.audioVoice": { en: "Audio & voice", ar: "الصوت", ur: "آڈیو اور آواز", fr: "Audio et voix", es: "Audio y voz", id: "Audio & suara", tr: "Ses ve konuşma", bn: "অডিও ও ভয়েস", ms: "Audio & suara", de: "Audio & Stimme" },
  "settings.focusSpeaker": { en: "Focus on main speaker", ar: "التركيز على المتحدث الرئيسي", ur: "مرکزی مقرر پر توجہ", fr: "Se concentrer sur l'orateur principal", es: "Enfocar al orador principal", id: "Fokus pada pembicara utama", tr: "Ana konuşmacıya odaklan", bn: "মূল বক্তার উপর ফোকাস", ms: "Fokus pada penceramah utama", de: "Auf Hauptsprecher fokussieren" },
  "settings.onboarding": { en: "Onboarding", ar: "الإعداد", ur: "آن بورڈنگ", fr: "Prise en main", es: "Introducción", id: "Pengenalan", tr: "Başlangıç", bn: "অনবোর্ডিং", ms: "Pengenalan", de: "Einführung" },
  "settings.showTips": { en: "Show positioning tips again", ar: "إظهار نصائح التموضع مجددًا", ur: "پوزیشننگ تجاویز دوبارہ دکھائیں", fr: "Revoir les conseils de placement", es: "Mostrar consejos de posición otra vez", id: "Tampilkan tips posisi lagi", tr: "Konumlandırma ipuçlarını tekrar göster", bn: "পজিশনিং টিপস আবার দেখান", ms: "Tunjuk tip kedudukan semula", de: "Positionierungs-Tipps erneut zeigen" },
  "settings.dangerZone": { en: "Danger zone", ar: "منطقة الخطر", ur: "خطرے کا زون", fr: "Zone sensible", es: "Zona de peligro", id: "Zona berbahaya", tr: "Tehlikeli bölge", bn: "বিপদ অঞ্চল", ms: "Zon bahaya", de: "Gefahrenzone" },
  "settings.deleteAccount": { en: "Delete account", ar: "حذف الحساب", ur: "اکاؤنٹ حذف کریں", fr: "Supprimer le compte", es: "Eliminar cuenta", id: "Hapus akun", tr: "Hesabı sil", bn: "অ্যাকাউন্ট মুছুন", ms: "Padam akaun", de: "Konto löschen" },
} as const satisfies Record<string, Record<LocaleCode, string>>;

export type MessageKey = keyof typeof MESSAGES;
