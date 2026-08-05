// ════════════════════════════════════════════════════════════════════════
//  Shared translation dictionary (NO "use client") so BOTH the client context
//  (i18n.tsx) and the server translator (i18n-server.ts) use the same data.
//  English is the key set; locales override what they translate; missing keys
//  fall back to clean English. Data (names, records, venues) is never a key.
// ════════════════════════════════════════════════════════════════════════
import { type Locale } from "@/lib/config";

type Dict = Record<string, string>;

const MESSAGES: Partial<Record<Locale, Dict>> = {
  es: {
    Rankings: "Clasificación", "P4P": "P4P", Fighters: "Luchadores", Predictions: "Pronósticos",
    Schedule: "Calendario", Results: "Resultados", Champions: "Campeones", Registry: "Registro",
    News: "Noticias", Forums: "Foros", Search: "Buscar", Home: "Inicio",
    "Sign in": "Iniciar sesión", "Sign up": "Registrarse", "Log in": "Entrar",
    "Pound for Pound": "Libra por libra", "Fight Schedule": "Calendario de combates",
    "Live rankings": "Clasificaciones en vivo", "Upcoming Schedule": "Próximos eventos",
    "Breaking News": "Última hora", "News & Analysis": "Noticias y análisis",
    "Highlights & Results": "Resúmenes y resultados",
  },
  fr: {
    Rankings: "Classements", Fighters: "Combattants", Schedule: "Calendrier", Results: "Résultats",
    Champions: "Champions", Registry: "Registre", News: "Actualités", Forums: "Forums", Search: "Rechercher", Home: "Accueil",
    "Sign in": "Connexion", "Sign up": "S'inscrire", "Pound for Pound": "Livre pour livre",
    "Fight Schedule": "Calendrier des combats", "Live rankings": "Classements en direct",
    "Upcoming Schedule": "Prochains événements", "Breaking News": "Dernières nouvelles", "News & Analysis": "Actualités et analyses",
    "Highlights & Results": "Résumés et résultats",
  },
  de: {
    Rankings: "Rangliste", Fighters: "Kämpfer", Schedule: "Termine", Results: "Ergebnisse",
    Champions: "Champions", Registry: "Register", News: "Nachrichten", Forums: "Foren", Search: "Suche", Home: "Start",
    "Sign in": "Anmelden", "Sign up": "Registrieren", "Pound for Pound": "Pound for Pound",
    "Fight Schedule": "Kampfplan", "Live rankings": "Ranglisten live", "Upcoming Schedule": "Kommende Termine",
    "Breaking News": "Eilmeldung", "News & Analysis": "Nachrichten & Analyse",
    "Highlights & Results": "Highlights & Ergebnisse",
  },
  pt: {
    Rankings: "Classificação", Fighters: "Lutadores", Schedule: "Calendário", Results: "Resultados",
    Champions: "Campeões", Registry: "Registro", News: "Notícias", Forums: "Fóruns", Search: "Buscar", Home: "Início",
    "Sign in": "Entrar", "Sign up": "Cadastrar-se", "Pound for Pound": "Peso por peso",
    "Fight Schedule": "Calendário de lutas", "Live rankings": "Classificações ao vivo",
    "Upcoming Schedule": "Próximos eventos", "Breaking News": "Últimas notícias", "News & Analysis": "Notícias e análises",
    "Highlights & Results": "Melhores momentos e resultados",
  },
  it: {
    Rankings: "Classifiche", Fighters: "Combattenti", Schedule: "Calendario", Results: "Risultati",
    Champions: "Campioni", Registry: "Registro", News: "Notizie", Forums: "Forum", Search: "Cerca", Home: "Home",
    "Sign in": "Accedi", "Sign up": "Registrati", "Pound for Pound": "Libbra per libbra",
    "Fight Schedule": "Calendario dei match", "Live rankings": "Classifiche in diretta",
    "Upcoming Schedule": "Prossimi eventi", "Breaking News": "Ultim'ora", "News & Analysis": "Notizie e analisi",
    "Highlights & Results": "Highlights e risultati",
  },
  ar: {
    Rankings: "التصنيفات", Fighters: "المقاتلون", Schedule: "الجدول", Results: "النتائج",
    Champions: "الأبطال", Registry: "السجل", News: "الأخبار", Forums: "المنتديات", Search: "بحث", Home: "الرئيسية",
    "Sign in": "تسجيل الدخول", "Sign up": "إنشاء حساب", "Pound for Pound": "رطل مقابل رطل",
    "Fight Schedule": "جدول النزالات", "Live rankings": "التصنيفات المباشرة",
    "Upcoming Schedule": "الفعاليات القادمة", "Breaking News": "أخبار عاجلة", "News & Analysis": "الأخبار والتحليلات",
    "Highlights & Results": "أبرز اللقطات والنتائج",
  },
  ja: {
    Rankings: "ランキング", Fighters: "ファイター", Schedule: "スケジュール", Results: "結果",
    Champions: "チャンピオン", Registry: "登録名簿", News: "ニュース", Forums: "フォーラム", Search: "検索", Home: "ホーム",
    "Sign in": "サインイン", "Sign up": "新規登録", "Pound for Pound": "パウンド・フォー・パウンド",
    "Fight Schedule": "試合スケジュール", "Live rankings": "ランキングをライブ配信",
    "Upcoming Schedule": "今後の予定", "Breaking News": "速報", "News & Analysis": "ニュースと分析",
    "Highlights & Results": "ハイライトと結果",
  },
  zh: {
    Rankings: "排名", Fighters: "格斗选手", Schedule: "赛程", Results: "成绩",
    Champions: "冠军", Registry: "名录", News: "新闻", Forums: "论坛", Search: "搜索", Home: "主页",
    "Sign in": "登录", "Sign up": "注册", "Pound for Pound": "磅对磅",
    "Fight Schedule": "比赛日程", "Live rankings": "排名实时更新",
    "Upcoming Schedule": "即将到来的赛程", "Breaking News": "突发新闻", "News & Analysis": "新闻与分析",
    "Highlights & Results": "精彩集锦与赛果",
  },
};

type Lang = Exclude<Locale, "en">;
// Key-first dict (one row per English string, all langs together).
const EXTRA: Record<string, Partial<Record<Lang, string>>> = {
  // Actions / pager / common
  "View all": { es: "Ver todo", fr: "Voir tout", de: "Alle ansehen", pt: "Ver tudo", it: "Vedi tutto", ar: "عرض الكل", ja: "すべて表示", zh: "查看全部" },
  "Full profile": { es: "Perfil completo", fr: "Profil complet", de: "Vollständiges Profil", pt: "Perfil completo", it: "Profilo completo", ar: "الملف الكامل", ja: "プロフィール全体", zh: "完整资料" },
  Next: { es: "Siguiente", fr: "Suivant", de: "Weiter", pt: "Próximo", it: "Successivo", ar: "التالي", ja: "次へ", zh: "下一页" },
  Previous: { es: "Anterior", fr: "Précédent", de: "Zurück", pt: "Anterior", it: "Precedente", ar: "السابق", ja: "前へ", zh: "上一页" },
  Page: { es: "Página", fr: "Page", de: "Seite", pt: "Página", it: "Pagina", ar: "صفحة", ja: "ページ", zh: "页" },
  View: { es: "Ver", fr: "Voir", de: "Ansehen", pt: "Ver", it: "Vedi", ar: "عرض", ja: "表示", zh: "查看" },
  Visit: { es: "Visitar", fr: "Visiter", de: "Besuchen", pt: "Visitar", it: "Visita", ar: "زيارة", ja: "アクセス", zh: "访问" },
  Claim: { es: "Reclamar", fr: "Revendiquer", de: "Beanspruchen", pt: "Reivindicar", it: "Rivendica", ar: "المطالبة", ja: "申請", zh: "认领" },
  "Clear filters": { es: "Limpiar filtros", fr: "Effacer les filtres", de: "Filter zurücksetzen", pt: "Limpar filtros", it: "Cancella filtri", ar: "مسح عوامل التصفية", ja: "フィルターをクリア", zh: "清除筛选" },
  // Status / directory
  Active: { es: "Activo", fr: "Actif", de: "Aktiv", pt: "Ativo", it: "Attivo", ar: "نشط", ja: "現役", zh: "活跃" },
  Inactive: { es: "Inactivo", fr: "Inactif", de: "Inaktiv", pt: "Inativo", it: "Inattivo", ar: "غير نشط", ja: "非現役", zh: "不活跃" },
  Name: { es: "Nombre", fr: "Nom", de: "Name", pt: "Nome", it: "Nome", ar: "الاسم", ja: "名前", zh: "姓名" },
  Sport: { es: "Deporte", fr: "Sport", de: "Sportart", pt: "Esporte", it: "Sport", ar: "الرياضة", ja: "競技", zh: "项目" },
  Record: { es: "Récord", fr: "Bilan", de: "Bilanz", pt: "Cartel", it: "Record", ar: "السجل", ja: "戦績", zh: "战绩" },
  Nationality: { es: "Nacionalidad", fr: "Nationalité", de: "Nationalität", pt: "Nacionalidade", it: "Nazionalità", ar: "الجنسية", ja: "国籍", zh: "国籍" },
  Residence: { es: "Residencia", fr: "Résidence", de: "Wohnsitz", pt: "Residência", it: "Residenza", ar: "الإقامة", ja: "居住地", zh: "居住地" },
  Status: { es: "Estado", fr: "Statut", de: "Status", pt: "Status", it: "Stato", ar: "الحالة", ja: "状態", zh: "状态" },
  Profile: { es: "Perfil", fr: "Profil", de: "Profil", pt: "Perfil", it: "Profilo", ar: "الملف", ja: "プロフィール", zh: "资料" },
  Website: { es: "Sitio web", fr: "Site web", de: "Webseite", pt: "Site", it: "Sito web", ar: "الموقع", ja: "ウェブサイト", zh: "网站" },
  "All Sports": { es: "Todos los deportes", fr: "Tous les sports", de: "Alle Sportarten", pt: "Todos os esportes", it: "Tutti gli sport", ar: "كل الرياضات", ja: "すべての競技", zh: "所有项目" },
  // Rankings / P4P cards
  Divisions: { es: "Divisiones", fr: "Divisions", de: "Gewichtsklassen", pt: "Divisões", it: "Categorie", ar: "الفئات", ja: "階級", zh: "级别" },
  Champion: { es: "Campeón", fr: "Champion", de: "Champion", pt: "Campeão", it: "Campione", ar: "بطل", ja: "チャンピオン", zh: "冠军" },
  "No limit": { es: "Sin límite", fr: "Sans limite", de: "Kein Limit", pt: "Sem limite", it: "Nessun limite", ar: "بلا حد", ja: "無差別", zh: "无限制" },
  "No rankings available yet for this division.": { es: "Aún no hay clasificaciones para esta división.", fr: "Aucun classement pour cette division.", de: "Noch keine Rangliste für diese Gewichtsklasse.", pt: "Ainda não há classificação para esta divisão.", it: "Ancora nessuna classifica per questa categoria.", ar: "لا تصنيفات لهذه الفئة بعد.", ja: "この階級のランキングはまだありません。", zh: "该级别暂无排名。" },
  ranked: { es: "clasificados", fr: "classés", de: "eingestuft", pt: "classificados", it: "classificati", ar: "مصنّف", ja: "ランク入り", zh: "已排名" },
  "Curated rankings": { es: "Clasificaciones curadas", fr: "Classements sélectionnés", de: "Kuratierte Rangliste", pt: "Classificações curadas", it: "Classifiche curate", ar: "تصنيفات منسّقة", ja: "厳選ランキング", zh: "精选排名" },
  "Rating engine · record-based": { es: "Motor de valoración · por récord", fr: "Moteur de notation · basé sur le bilan", de: "Bewertungsmodell · bilanzbasiert", pt: "Motor de avaliação · por cartel", it: "Motore di valutazione · su record", ar: "محرك التقييم · حسب السجل", ja: "レーティング · 戦績ベース", zh: "评分引擎 · 基于战绩" },
  // Schedule / results
  "First bell": { es: "Primer asalto", fr: "Premier gong", de: "Erster Gong", pt: "Primeiro gongo", it: "Primo gong", ar: "الجرس الأول", ja: "開始のゴング", zh: "首回合" },
  "Full card & previews": { es: "Cartelera completa y previas", fr: "Carte complète & aperçus", de: "Komplette Card & Vorschauen", pt: "Card completo e prévias", it: "Card completa e anteprime", ar: "البطاقة الكاملة والمعاينات", ja: "全カードとプレビュー", zh: "完整赛卡与前瞻" },
  Main: { es: "Estelar", fr: "Principal", de: "Hauptkampf", pt: "Principal", it: "Principale", ar: "الرئيسي", ja: "メイン", zh: "主赛" },
  "Co-Main": { es: "Co-estelar", fr: "Co-principal", de: "Co-Hauptkampf", pt: "Co-principal", it: "Co-principale", ar: "المساند", ja: "コメイン", zh: "副主赛" },
  "No upcoming events scheduled.": { es: "No hay eventos próximos programados.", fr: "Aucun événement à venir.", de: "Keine kommenden Veranstaltungen.", pt: "Nenhum evento agendado.", it: "Nessun evento in programma.", ar: "لا فعاليات قادمة مجدولة.", ja: "予定されているイベントはありません。", zh: "暂无即将举行的赛事。" },
  Date: { es: "Fecha", fr: "Date", de: "Datum", pt: "Data", it: "Data", ar: "التاريخ", ja: "日付", zh: "日期" },
  Venue: { es: "Recinto", fr: "Lieu", de: "Veranstaltungsort", pt: "Local", it: "Sede", ar: "المكان", ja: "会場", zh: "场馆" },
  Location: { es: "Ubicación", fr: "Lieu", de: "Standort", pt: "Localização", it: "Località", ar: "الموقع", ja: "場所", zh: "地点" },
  Broadcast: { es: "Transmisión", fr: "Diffusion", de: "Übertragung", pt: "Transmissão", it: "Diretta", ar: "البث", ja: "放送", zh: "转播" },
  "Fight Card": { es: "Cartelera", fr: "Carte des combats", de: "Kampf-Card", pt: "Card de lutas", it: "Card", ar: "بطاقة النزالات", ja: "ファイトカード", zh: "格斗赛卡" },
  // Fighter profile
  Age: { es: "Edad", fr: "Âge", de: "Alter", pt: "Idade", it: "Età", ar: "العمر", ja: "年齢", zh: "年龄" },
  Height: { es: "Altura", fr: "Taille", de: "Größe", pt: "Altura", it: "Altezza", ar: "الطول", ja: "身長", zh: "身高" },
  Reach: { es: "Alcance", fr: "Allonge", de: "Reichweite", pt: "Envergadura", it: "Allungo", ar: "امتداد الذراع", ja: "リーチ", zh: "臂展" },
  Stance: { es: "Postura", fr: "Garde", de: "Auslage", pt: "Guarda", it: "Guardia", ar: "الوقفة", ja: "スタンス", zh: "站架" },
  Gym: { es: "Gimnasio", fr: "Club", de: "Gym", pt: "Academia", it: "Palestra", ar: "النادي", ja: "ジム", zh: "训练馆" },
  Achievements: { es: "Logros", fr: "Palmarès", de: "Erfolge", pt: "Conquistas", it: "Successi", ar: "الإنجازات", ja: "実績", zh: "成就" },
  Sponsors: { es: "Patrocinadores", fr: "Sponsors", de: "Sponsoren", pt: "Patrocinadores", it: "Sponsor", ar: "الرعاة", ja: "スポンサー", zh: "赞助商" },
  Contact: { es: "Contacto", fr: "Contact", de: "Kontakt", pt: "Contato", it: "Contatti", ar: "تواصل", ja: "連絡先", zh: "联系" },
  Champions: { es: "Campeones", fr: "Champions", de: "Champions", pt: "Campeões", it: "Campioni", ar: "الأبطال", ja: "チャンピオン", zh: "冠军" },

  // ── FOOTER + SHELL, complete for Spanish ────────────────────────────────
  // These were already wrapped in t() — the footer calls t(item.label) — so the
  // gap was never missing plumbing, it was missing ENTRIES. Worth knowing before
  // migrating anything: some of the audit's 961 are un-wrapped strings, but
  // surfaces like this one are wired and simply had no Spanish.
  //
  // Spanish only from here down. Adding a half-finished French column is what
  // produced nine broken locales in the first place; a language gets filled in
  // when it is being released, not speculatively.
  Fights: { es: "Combates" },
  "Gyms & Coaches": { es: "Gimnasios y entrenadores" },
  Promoters: { es: "Promotores" },
  Federations: { es: "Federaciones" },
  Commissions: { es: "Comisiones" },
  Community: { es: "Comunidad" },
  Feed: { es: "Novedades" },
  Communities: { es: "Comunidades" },
  "Join / Sign up": { es: "Únete / Registrarse" },
  Legal: { es: "Legal" },
  Privacy: { es: "Privacidad" },
  Terms: { es: "Términos" },
  Cookies: { es: "Cookies" },
  "Community Guidelines": { es: "Normas de la comunidad" },
  "Copyright / Takedown": { es: "Derechos de autor / Retirada" },
  "Data Sources": { es: "Fuentes de datos" },
  Leaderboard: { es: "Clasificación general" },
  Following: { es: "Siguiendo" },
  Events: { es: "Eventos" },
  Notifications: { es: "Notificaciones" },
  Settings: { es: "Ajustes" },
  Security: { es: "Seguridad" },
  Invites: { es: "Invitaciones" },
  Followers: { es: "Seguidores" },
  online: { es: "en línea" },

  // ── Account recovery + auth ─────────────────────────────────────────────
  "Forgot password?": { es: "¿Olvidaste tu contraseña?" },
  "Forgot username?": { es: "¿Olvidaste tu usuario?" },
  "Back to sign in": { es: "Volver a iniciar sesión" },
  "Reset your password": { es: "Restablece tu contraseña" },
  "Recover your username": { es: "Recupera tu usuario" },
  "Send reset link": { es: "Enviar enlace" },
  "Send my username": { es: "Enviar mi usuario" },
  "Email address": { es: "Correo electrónico" },
  "you@example.com": { es: "tu@ejemplo.com" },
  Password: { es: "Contraseña" },
  "Display name": { es: "Nombre visible" },
  "Create account": { es: "Crear cuenta" },
  "Sending…": { es: "Enviando…" },
  "Something went wrong.": { es: "Algo salió mal." },
  "Recovery is temporarily unavailable.": { es: "La recuperación no está disponible temporalmente." },
  "What do you need to recover?": { es: "¿Qué necesitas recuperar?" },
  Username: { es: "Usuario" },
  "Enter your email and we'll send you a link to set a new password.": {
    es: "Introduce tu correo y te enviaremos un enlace para crear una contraseña nueva.",
  },
  "If that email is registered, we've sent a reset link. It expires in 30 minutes and works once.": {
    es: "Si ese correo está registrado, hemos enviado un enlace. Caduca en 30 minutos y solo funciona una vez.",
  },
  "If that email is registered, we've sent the username to it.": {
    es: "Si ese correo está registrado, le hemos enviado el usuario.",
  },
  "Enter your email and we'll send your username to it. You sign in with your email, so you only need this to find your public profile link.": {
    es: "Introduce tu correo y te enviaremos tu usuario. Inicias sesión con el correo, así que esto solo sirve para encontrar el enlace de tu perfil público.",
  },
  "What should people call you?": { es: "¿Cómo quieres que te llamen?" },
  "Shown on your profile, the leaderboard and anything you share.": {
    es: "Se muestra en tu perfil, en la clasificación y en todo lo que compartas.",
  },
  "That's an email address — pick a name other people will see.": {
    es: "Ese es un correo electrónico — elige un nombre que verán los demás.",
  },

  // ── Event / card states ─────────────────────────────────────────────────
  "Fight card": { es: "Cartelera" },
  "Card talk": { es: "Charla de la cartelera" },
  Coverage: { es: "Cobertura" },
  "First bell in": { es: "Primera campana en" },
  "Happening now": { es: "Sucediendo ahora" },
  "Starting soon": { es: "Empieza pronto" },
  "Event complete": { es: "Evento finalizado" },
  "Awaiting results": { es: "Esperando resultados" },
  "Results pending": { es: "Resultados pendientes" },
  "Sources are checked hourly.": { es: "Las fuentes se revisan cada hora." },
  "Live now": { es: "En directo" },
  Final: { es: "Final" },
  "Bout card has not been announced yet": { es: "La cartelera aún no se ha anunciado" },
  "This event was cancelled": { es: "Este evento fue cancelado" },
  "We're still importing this card": { es: "Todavía estamos importando esta cartelera" },
  "We couldn't load this card": { es: "No pudimos cargar esta cartelera" },
  "This promotion isn't fully supported yet": { es: "Esta promotora aún no está totalmente soportada" },
  "Follow this event": { es: "Seguir este evento" },
  "Remind me": { es: "Recordármelo" },
  "Add to calendar": { es: "Añadir al calendario" },
  Share: { es: "Compartir" },
  Watch: { es: "Ver" },
  Tickets: { es: "Entradas" },
  "Upcoming events": { es: "Próximos eventos" },
  "Recent events": { es: "Eventos recientes" },
  "All results →": { es: "Todos los resultados →" },
  "Market implied probability": { es: "Probabilidad implícita del mercado" },
  "Awaiting live betting lines for this bout.": { es: "Esperando líneas de apuestas para este combate." },

  // ── Notifications + empty states ────────────────────────────────────────
  "Mark all read": { es: "Marcar todo como leído" },
  "See all": { es: "Ver todo" },
  "Load older": { es: "Cargar anteriores" },
  "You're all caught up": { es: "Estás al día" },
  "Refresh notifications": { es: "Actualizar notificaciones" },
  "Nothing unread": { es: "Nada sin leer" },
  "Loading…": { es: "Cargando…" },
  "just now": { es: "ahora mismo" },
  "Find fighters": { es: "Buscar luchadores" },
  "Find cards to follow": { es: "Encuentra carteleras para seguir" },
  "Follow fighters, events, promotions and gyms and this is where their news lands.": {
    es: "Sigue luchadores, eventos, promotoras y gimnasios: sus novedades llegan aquí.",
  },

  // ── Invites ─────────────────────────────────────────────────────────────
  "Invite friends": { es: "Invita a tus amigos" },
  "You're invited": { es: "Estás invitado" },
  "Share invite": { es: "Compartir invitación" },
  "Copy link": { es: "Copiar enlace" },
  Copied: { es: "Copiado" },
  "Create your account": { es: "Crea tu cuenta" },
  "See their record": { es: "Ver su récord" },

  // The footer blurbs — the last English text in an otherwise Spanish footer.
  "Independent platform. Data sourced and cached from public records. Not affiliated with any sanctioning body.": {
    es: "Plataforma independiente. Datos obtenidos y almacenados de registros públicos. Sin afiliación a ningún organismo sancionador.",
  },
  "The combat-sports ecosystem registry — fighters, gyms, coaches, promoters, federations, commissions, officials, venues and events across boxing, MMA, Muay Thai and more. Source-backed rankings, records, schedules, results and community.": {
    es: "El registro del ecosistema de los deportes de combate: luchadores, gimnasios, entrenadores, promotores, federaciones, comisiones, oficiales, recintos y eventos de boxeo, MMA, Muay Thai y más. Clasificaciones, récords, calendarios, resultados y comunidad con fuentes verificables.",
  },
};

// ── Plurals ────────────────────────────────────────────────────────────────
//  Keyed "one|other", because a count is the single most common reason a UI string
//  gets built by concatenation — and concatenation is what makes a sentence
//  untranslatable. "3" + " " + t("fights") cannot be Spanish: word order, gender
//  and agreement all live in the sentence, not in the noun.
//
//  English and Spanish share the same one/other split, so two forms is correct for
//  both. A language needing more (Arabic has six) gets a wider shape when it is
//  actually released — the API here does not have to change for that.
const PLURALS: Record<string, Partial<Record<Lang, { one: string; other: string }>>> = {
  "{n} fight": { es: { one: "{n} combate", other: "{n} combates" } },
  "{n} bout": { es: { one: "{n} combate", other: "{n} combates" } },
  "{n} fighter": { es: { one: "{n} luchador", other: "{n} luchadores" } },
  "{n} event": { es: { one: "{n} evento", other: "{n} eventos" } },
  "{n} follower": { es: { one: "{n} seguidor", other: "{n} seguidores" } },
  "{n} prediction": { es: { one: "{n} pronóstico", other: "{n} pronósticos" } },
  "{n} notification": { es: { one: "{n} notificación", other: "{n} notificaciones" } },
  "{n} update": { es: { one: "{n} actualización", other: "{n} actualizaciones" } },
  "{n} book": { es: { one: "{n} casa de apuestas", other: "{n} casas de apuestas" } },
  "{n} result": { es: { one: "{n} resultado", other: "{n} resultados" } },
};

/** English fallback for a plural key, so `en` needs no dictionary entry. */
function englishPlural(key: string, n: number): string {
  // "{n} fight" -> "3 fights". Naive -s is correct for every key above; a key whose
  // English plural is irregular gets an explicit entry rather than a rule.
  const singular = key.replace("{n} ", "");
  const word = n === 1 ? singular : `${singular}s`;
  return `${n.toLocaleString()} ${word}`;
}

/** Replace {name} placeholders. Values are inserted verbatim — never re-translated. */
function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

// Warn once per missing (locale,key) in dev so the dictionary can be completed.
const warned = new Set<string>();

function missing(locale: Locale, key: string): void {
  if (process.env.NODE_ENV === "production") return;
  const tag = `${locale}::${key}`;
  if (!warned.has(tag)) {
    warned.add(tag);
    console.warn(`[i18n] missing ${locale} translation: ${JSON.stringify(key)}`);
  }
}

/**
 * Translate a key, with optional interpolation.
 *
 * `vars` values are DATA — a fighter name, a venue, a count — and are inserted
 * without translation. That is the rule that keeps "Berlanga" from being localised
 * while the sentence around it is.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const template = locale === "en" ? key : MESSAGES[locale]?.[key] ?? EXTRA[key]?.[locale as Lang];
  if (locale !== "en" && !template) missing(locale, key);
  const resolved = template ?? key; // clean English fallback
  return vars ? interpolate(resolved, vars) : resolved;
}

/**
 * Translate a COUNTED string. `key` carries the {n} placeholder, e.g. "{n} fight".
 *
 * Exists so no caller ever writes `${n} ${t("fights")}` — that reads fine in English
 * and cannot be translated into a language where the number changes the noun's form
 * or its position.
 */
export function translatePlural(locale: Locale, key: string, n: number): string {
  if (locale === "en") return englishPlural(key, n);
  const forms = PLURALS[key]?.[locale as Lang];
  if (!forms) {
    missing(locale, key);
    return englishPlural(key, n);
  }
  return interpolate(n === 1 ? forms.one : forms.other, { n: n.toLocaleString(locale) });
}
