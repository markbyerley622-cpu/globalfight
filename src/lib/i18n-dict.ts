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
  },
  fr: {
    Rankings: "Classements", Fighters: "Combattants", Schedule: "Calendrier", Results: "Résultats",
    Champions: "Champions", Registry: "Registre", News: "Actualités", Forums: "Forums", Search: "Rechercher", Home: "Accueil",
    "Sign in": "Connexion", "Sign up": "S'inscrire", "Pound for Pound": "Livre pour livre",
    "Fight Schedule": "Calendrier des combats", "Live rankings": "Classements en direct",
    "Upcoming Schedule": "Prochains événements", "Breaking News": "Dernières nouvelles", "News & Analysis": "Actualités et analyses",
  },
  de: {
    Rankings: "Rangliste", Fighters: "Kämpfer", Schedule: "Termine", Results: "Ergebnisse",
    Champions: "Champions", Registry: "Register", News: "Nachrichten", Forums: "Foren", Search: "Suche", Home: "Start",
    "Sign in": "Anmelden", "Sign up": "Registrieren", "Pound for Pound": "Pound for Pound",
    "Fight Schedule": "Kampfplan", "Live rankings": "Ranglisten live", "Upcoming Schedule": "Kommende Termine",
    "Breaking News": "Eilmeldung", "News & Analysis": "Nachrichten & Analyse",
  },
  pt: {
    Rankings: "Classificação", Fighters: "Lutadores", Schedule: "Calendário", Results: "Resultados",
    Champions: "Campeões", Registry: "Registro", News: "Notícias", Forums: "Fóruns", Search: "Buscar", Home: "Início",
    "Sign in": "Entrar", "Sign up": "Cadastrar-se", "Pound for Pound": "Peso por peso",
    "Fight Schedule": "Calendário de lutas", "Live rankings": "Classificações ao vivo",
    "Upcoming Schedule": "Próximos eventos", "Breaking News": "Últimas notícias", "News & Analysis": "Notícias e análises",
  },
  it: {
    Rankings: "Classifiche", Fighters: "Combattenti", Schedule: "Calendario", Results: "Risultati",
    Champions: "Campioni", Registry: "Registro", News: "Notizie", Forums: "Forum", Search: "Cerca", Home: "Home",
    "Sign in": "Accedi", "Sign up": "Registrati", "Pound for Pound": "Libbra per libbra",
    "Fight Schedule": "Calendario dei match", "Live rankings": "Classifiche in diretta",
    "Upcoming Schedule": "Prossimi eventi", "Breaking News": "Ultim'ora", "News & Analysis": "Notizie e analisi",
  },
  ar: {
    Rankings: "التصنيفات", Fighters: "المقاتلون", Schedule: "الجدول", Results: "النتائج",
    Champions: "الأبطال", Registry: "السجل", News: "الأخبار", Forums: "المنتديات", Search: "بحث", Home: "الرئيسية",
    "Sign in": "تسجيل الدخول", "Sign up": "إنشاء حساب", "Pound for Pound": "رطل مقابل رطل",
    "Fight Schedule": "جدول النزالات", "Live rankings": "التصنيفات المباشرة",
    "Upcoming Schedule": "الفعاليات القادمة", "Breaking News": "أخبار عاجلة", "News & Analysis": "الأخبار والتحليلات",
  },
  ja: {
    Rankings: "ランキング", Fighters: "ファイター", Schedule: "スケジュール", Results: "結果",
    Champions: "チャンピオン", Registry: "登録名簿", News: "ニュース", Forums: "フォーラム", Search: "検索", Home: "ホーム",
    "Sign in": "サインイン", "Sign up": "新規登録", "Pound for Pound": "パウンド・フォー・パウンド",
    "Fight Schedule": "試合スケジュール", "Live rankings": "ランキングをライブ配信",
    "Upcoming Schedule": "今後の予定", "Breaking News": "速報", "News & Analysis": "ニュースと分析",
  },
  zh: {
    Rankings: "排名", Fighters: "格斗选手", Schedule: "赛程", Results: "成绩",
    Champions: "冠军", Registry: "名录", News: "新闻", Forums: "论坛", Search: "搜索", Home: "主页",
    "Sign in": "登录", "Sign up": "注册", "Pound for Pound": "磅对磅",
    "Fight Schedule": "比赛日程", "Live rankings": "排名实时更新",
    "Upcoming Schedule": "即将到来的赛程", "Breaking News": "突发新闻", "News & Analysis": "新闻与分析",
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
};

// Warn once per missing (locale,key) in dev so the dictionary can be completed.
const warned = new Set<string>();
export function translate(locale: Locale, key: string): string {
  if (locale === "en") return key;
  const hit = MESSAGES[locale]?.[key] ?? EXTRA[key]?.[locale as Lang];
  if (hit) return hit;
  if (process.env.NODE_ENV !== "production") {
    const tag = `${locale}::${key}`;
    if (!warned.has(tag)) { warned.add(tag); console.warn(`[i18n] missing ${locale} translation: ${JSON.stringify(key)}`); }
  }
  return key; // clean English fallback
}
