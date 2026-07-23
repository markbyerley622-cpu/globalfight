-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('BOXING', 'MMA', 'MUAY_THAI', 'KICKBOXING', 'K1', 'BARE_KNUCKLE', 'BJJ', 'BJJ_NOGI', 'WRESTLING', 'JUDO', 'TAEKWONDO', 'SAMBO', 'COMBAT_SAMBO');

-- CreateEnum
CREATE TYPE "Stance" AS ENUM ('ORTHODOX', 'SOUTHPAW', 'SWITCH');

-- CreateEnum
CREATE TYPE "FightResult" AS ENUM ('WIN', 'LOSS', 'DRAW', 'NO_CONTEST', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "FightMethod" AS ENUM ('KO', 'TKO', 'UD', 'SD', 'MD', 'SUB', 'DQ', 'RTD', 'TD', 'NC', 'DRAW');

-- CreateEnum
CREATE TYPE "RankMovement" AS ENUM ('UP', 'DOWN', 'SAME', 'NEW', 'RETURN');

-- CreateEnum
CREATE TYPE "SanctioningBody" AS ENUM ('WBA', 'WBC', 'IBF', 'WBO', 'RING', 'IBO', 'THE_RING', 'UNDISPUTED', 'BKFC', 'ONE', 'PFL', 'UFC');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ANNOUNCED', 'SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PredictionSource" AS ENUM ('AI', 'EXPERT', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'EXPERT', 'EDITOR', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('API', 'SCRAPER', 'MANUAL');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('VERIFIED_ACTIVE', 'ACTIVE_RECURRING', 'ACTIVE_SPORADIC', 'ANNOUNCED', 'ACTIVITY_UNCLEAR', 'DORMANT', 'DEFUNCT');

-- CreateEnum
CREATE TYPE "PromotionSourceType" AS ENUM ('OFFICIAL_SITE', 'NEWS', 'PRESS', 'RSS', 'SCHEDULE', 'RESULTS', 'YOUTUBE', 'INSTAGRAM', 'FACEBOOK', 'TWITTER', 'TIKTOK', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PICK_RESULT', 'CARD_EARNED', 'REP_MILESTONE', 'FIGHT_ANNOUNCED', 'EVENT_LIVE', 'FOLLOW', 'COMMUNITY_REPLY', 'BATTLE_RESULT', 'BATTLE_MATCHED', 'BATTLE_REPLY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('PICK_MADE', 'PICK_CORRECT', 'CARD_EARNED', 'REP_MILESTONE', 'FOLLOW', 'THREAD_CREATED', 'BATTLE_WON');

-- CreateEnum
CREATE TYPE "CardRarity" AS ENUM ('BASE', 'RARE', 'EPIC', 'CHAMPION', 'LEGEND');

-- CreateEnum
CREATE TYPE "BattleState" AS ENUM ('WAITING', 'ACTIVE', 'RESOLVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MapVisibility" AS ENUM ('HIDDEN', 'PUBLIC', 'FOLLOWERS', 'GYM_MEMBERS', 'EVENTS_ONLY');

-- CreateTable
CREATE TABLE "WeightClass" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sport" "Sport" NOT NULL DEFAULT 'BOXING',
    "limitLbs" DOUBLE PRECISION,
    "limitKg" DOUBLE PRECISION,
    "order" INTEGER NOT NULL,

    CONSTRAINT "WeightClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "rtl" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fighter" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "sport" "Sport" NOT NULL DEFAULT 'BOXING',
    "nationality" TEXT,
    "countryCode" TEXT,
    "birthDate" TIMESTAMP(3),
    "birthPlace" TEXT,
    "residence" TEXT,
    "heightCm" INTEGER,
    "reachCm" INTEGER,
    "stance" "Stance",
    "debutDate" TIMESTAMP(3),
    "gym" TEXT,
    "promoter" TEXT,
    "ownerId" TEXT,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "instagram" TEXT,
    "twitter" TEXT,
    "contactEmail" TEXT,
    "tagline" TEXT,
    "profileKind" TEXT NOT NULL DEFAULT 'fighter',
    "beltRank" TEXT,
    "style" TEXT,
    "federation" TEXT,
    "rank" TEXT,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "noContests" INTEGER NOT NULL DEFAULT 0,
    "koWins" INTEGER NOT NULL DEFAULT 0,
    "koLosses" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL DEFAULT 0,
    "thumbUrl" TEXT,
    "imageUrl" TEXT,
    "heroImageUrl" TEXT,
    "photoUrl" TEXT,
    "photoSource" TEXT,
    "photoCredit" TEXT,
    "photoLicense" TEXT,
    "photoLicenseUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bio" TEXT,
    "lastScrapedAt" TIMESTAMP(3),
    "lastProfileScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fighter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "body" "SanctioningBody" NOT NULL,
    "weight" TEXT NOT NULL,
    "wonDate" TIMESTAMP(3),
    "lostDate" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterAchievement" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FighterAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterSponsor" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "logoUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FighterSponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterSocial" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "FighterSocial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterMedia" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FighterMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterClaim" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidenceType" TEXT,
    "evidenceNote" TEXT,
    "evidenceStorageKey" TEXT,
    "evidenceStorageProvider" TEXT,
    "evidenceUploadedAt" TIMESTAMP(3),
    "evidenceDeleteAfter" TIMESTAMP(3),
    "evidenceDeletedAt" TIMESTAMP(3),
    "evidenceDeletionStatus" TEXT,
    "evidenceDeletionError" TEXT,
    "evidenceScanStatus" TEXT,
    "evidenceContentType" TEXT,
    "evidenceByteSize" INTEGER,
    "evidenceUrl" TEXT,
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "FighterClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportConflict" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" TEXT,
    "importedValue" TEXT,
    "source" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ranking" (
    "id" TEXT NOT NULL,
    "weightClassId" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "isPoundForPound" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "movement" "RankMovement" NOT NULL DEFAULT 'SAME',
    "rating" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'import',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ranking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "weightClass" TEXT NOT NULL,
    "isPoundForPound" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Champion" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "weightClassId" TEXT NOT NULL,
    "body" "SanctioningBody" NOT NULL,
    "beltImageUrl" TEXT,
    "since" TIMESTAMP(3),
    "defenses" INTEGER NOT NULL DEFAULT 0,
    "current" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Champion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "Sport" NOT NULL DEFAULT 'BOXING',
    "promotion" TEXT,
    "promotionId" TEXT,
    "venue" TEXT,
    "city" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "broadcaster" TEXT,
    "posterUrl" TEXT,
    "heroUrl" TEXT,
    "description" TEXT,
    "timezone" TEXT,
    "eventUrl" TEXT,
    "ticketUrl" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "broadcastStartAt" TIMESTAMP(3),
    "prelimStartAt" TIMESTAMP(3),
    "mainCardStartAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lockedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fight" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "eventId" TEXT,
    "redId" TEXT NOT NULL,
    "blueId" TEXT NOT NULL,
    "weightClassId" TEXT,
    "scheduledRounds" INTEGER NOT NULL DEFAULT 12,
    "titleFight" BOOLEAN NOT NULL DEFAULT false,
    "interimTitle" BOOLEAN NOT NULL DEFAULT false,
    "mainEvent" BOOLEAN NOT NULL DEFAULT false,
    "coMain" BOOLEAN NOT NULL DEFAULT false,
    "orderOnCard" INTEGER NOT NULL DEFAULT 0,
    "performanceBonus" BOOLEAN NOT NULL DEFAULT false,
    "fightOfTheNight" BOOLEAN NOT NULL DEFAULT false,
    "estimatedStartAt" TIMESTAMP(3),
    "lockedFields" TEXT[],
    "cardSegment" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cardNote" TEXT,
    "result" "FightResult" NOT NULL DEFAULT 'SCHEDULED',
    "winnerId" TEXT,
    "method" "FightMethod",
    "roundEnded" INTEGER,
    "timeEnded" TEXT,
    "scorecards" JSONB,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "picksResolvedAt" TIMESTAMP(3),

    CONSTRAINT "Fight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FightPick" (
    "userId" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "corner" TEXT NOT NULL,
    "method" "FightMethod",
    "confidence" INTEGER,
    "correct" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FightPick_pkey" PRIMARY KEY ("userId","fightId")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "source" "PredictionSource" NOT NULL,
    "authorId" TEXT,
    "predictedWinnerId" TEXT,
    "redProbability" DOUBLE PRECISION NOT NULL,
    "blueProbability" DOUBLE PRECISION NOT NULL,
    "methodPrediction" "FightMethod",
    "roundPrediction" INTEGER,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "bookmaker" TEXT NOT NULL,
    "redOdds" DOUBLE PRECISION NOT NULL,
    "blueOdds" DOUBLE PRECISION NOT NULL,
    "drawOdds" DOUBLE PRECISION,
    "redImplied" DOUBLE PRECISION NOT NULL,
    "blueImplied" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "coverImageUrl" TEXT,
    "sourceUrl" TEXT,
    "promotionId" TEXT,
    "authorId" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "ogImageUrl" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ArticleTag_pkey" PRIMARY KEY ("articleId","tagId")
);

-- CreateTable
CREATE TABLE "ForumCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'forum',
    "city" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "meetsOn" TEXT,

    CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumThread" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'discussion',
    "views" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "videoId" TEXT,
    "fighterId" TEXT,
    "promotion" TEXT,
    "eventId" TEXT,
    "fightId" TEXT,
    "battleId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "lastPostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "attachments" JSONB,
    "quotedId" TEXT,
    "quotedAuthor" TEXT,
    "quotedExcerpt" TEXT,
    "parentId" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'like',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumSubscription" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumBookmark" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReport" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyrightReport" (
    "id" TEXT NOT NULL,
    "contentIdentifier" TEXT NOT NULL,
    "contentUrl" TEXT,
    "reporterName" TEXT NOT NULL,
    "reporterEmail" TEXT NOT NULL,
    "reporterOrg" TEXT,
    "workDescription" TEXT NOT NULL,
    "ownershipClaim" BOOLEAN NOT NULL DEFAULT false,
    "goodFaithClaim" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "actionTaken" TEXT,
    "actionedAt" TIMESTAMP(3),
    "counterNoticeAt" TIMESTAMP(3),
    "counterNoticeBy" TEXT,
    "counterNoticeText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyrightReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMarket" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'who_wins',
    "sport" TEXT NOT NULL,
    "league" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closesAt" TIMESTAMP(3),
    "options" JSONB NOT NULL,
    "tally" JSONB,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "hot" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "providerMarketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityVote" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "username" TEXT,
    "bannerUrl" TEXT,
    "passwordHash" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "ageConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "ageConfirmedAt" TIMESTAMP(3),
    "agePolicyVersion" TEXT,
    "underageFlagged" BOOLEAN NOT NULL DEFAULT false,
    "registryRole" TEXT NOT NULL DEFAULT 'fan',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "picksResolved" INTEGER NOT NULL DEFAULT 0,
    "picksCorrect" INTEGER NOT NULL DEFAULT 0,
    "pickStreak" INTEGER NOT NULL DEFAULT 0,
    "bestPickStreak" INTEGER NOT NULL DEFAULT 0,
    "battleWins" INTEGER NOT NULL DEFAULT 0,
    "battleLosses" INTEGER NOT NULL DEFAULT 0,
    "battleDraws" INTEGER NOT NULL DEFAULT 0,
    "battleStreak" INTEGER NOT NULL DEFAULT 0,
    "bestBattleStreak" INTEGER NOT NULL DEFAULT 0,
    "bio" TEXT,
    "sportPrefs" TEXT[],
    "onboardedAt" TIMESTAMP(3),
    "localePref" TEXT NOT NULL DEFAULT 'en',
    "themePref" TEXT NOT NULL DEFAULT 'dark',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mapVisibility" "MapVisibility" NOT NULL DEFAULT 'HIDDEN',
    "mapCity" TEXT,
    "mapCountryCode" TEXT,
    "mapLat" DOUBLE PRECISION,
    "mapLon" DOUBLE PRECISION,
    "openToSpar" BOOLEAN NOT NULL DEFAULT false,
    "lookingForTraining" BOOLEAN NOT NULL DEFAULT false,
    "notifyFights" BOOLEAN NOT NULL DEFAULT true,
    "notifyPredictions" BOOLEAN NOT NULL DEFAULT true,
    "notifySocial" BOOLEAN NOT NULL DEFAULT true,
    "notifyGym" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "timezone" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "twitter" TEXT,
    "youtube" TEXT,
    "tiktok" TEXT,
    "facebook" TEXT,
    "weightClassPref" TEXT,
    "yearsTraining" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteFighter" (
    "userId" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteFighter_pkey" PRIMARY KEY ("userId","fighterId")
);

-- CreateTable
CREATE TABLE "FavoritePromotion" (
    "userId" TEXT NOT NULL,
    "promotion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoritePromotion_pkey" PRIMARY KEY ("userId","promotion")
);

-- CreateTable
CREATE TABLE "FavoriteEvent" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteEvent_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL DEFAULT 'API',
    "baseConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderHealth" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSync" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sport" TEXT,
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "rateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "fellBackTo" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterExternalId" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FighterExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventExternalId" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterAlias" (
    "id" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FighterAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acronym" TEXT,
    "sport" "Sport" NOT NULL,
    "ruleset" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "scope" TEXT,
    "entityType" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE_RECURRING',
    "officialUrl" TEXT,
    "secondaryUrl" TEXT,
    "confidence" TEXT,
    "evidence" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionSource" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "type" "PromotionSourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "method" TEXT,
    "official" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsOutlet" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "sports" "Sport"[],
    "region" TEXT,
    "language" TEXT,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsOutlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedVideo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelId" TEXT,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER,
    "topic" TEXT,
    "tags" TEXT[],
    "promotion" TEXT,
    "discipline" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "FeedView" (
    "key" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedView_pkey" PRIMARY KEY ("key","videoId")
);

-- CreateTable
CREATE TABLE "FeedHiddenChannel" (
    "key" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "FeedHiddenChannel_pkey" PRIMARY KEY ("key","channelId")
);

-- CreateTable
CREATE TABLE "FeedNotInterested" (
    "key" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,

    CONSTRAINT "FeedNotInterested_pkey" PRIMARY KEY ("key","videoId")
);

-- CreateTable
CREATE TABLE "FeedInterest" (
    "key" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "FeedInterest_pkey" PRIMARY KEY ("key","tag")
);

-- CreateTable
CREATE TABLE "FeedCollection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelId" TEXT,
    "topic" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedCollectionItem_pkey" PRIMARY KEY ("collectionId","videoId")
);

-- CreateTable
CREATE TABLE "ReputationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReputationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "icon" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fighterId" TEXT NOT NULL,
    "rarity" "CardRarity" NOT NULL,
    "reason" TEXT NOT NULL,
    "fightId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Battle" (
    "id" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "challengerCorner" TEXT NOT NULL,
    "challengerMethod" "FightMethod",
    "challengerConfidence" INTEGER,
    "opponentId" TEXT,
    "opponentCorner" TEXT,
    "opponentMethod" "FightMethod",
    "opponentConfidence" INTEGER,
    "state" "BattleState" NOT NULL DEFAULT 'WAITING',
    "winnerId" TEXT,
    "loserId" TEXT,
    "resolvedSource" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rivalry" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "aWins" INTEGER NOT NULL DEFAULT 0,
    "bWins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "currentStreakUserId" TEXT,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreakUserId" TEXT,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "firstBattleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBattleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rivalry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT,
    "props" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gym" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "heroUrl" TEXT,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "disciplines" TEXT[],
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "youtube" TEXT,
    "tiktok" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hoursNote" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymMember" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "isHome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GymMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymClaim" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "evidence" TEXT,
    "note" TEXT,
    "evidenceStorageKey" TEXT,
    "evidenceStorageProvider" TEXT,
    "evidenceUploadedAt" TIMESTAMP(3),
    "evidenceDeleteAfter" TIMESTAMP(3),
    "evidenceDeletedAt" TIMESTAMP(3),
    "evidenceDeletionStatus" TEXT,
    "evidenceDeletionError" TEXT,
    "evidenceScanStatus" TEXT,
    "evidenceContentType" TEXT,
    "evidenceByteSize" INTEGER,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GymClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gymId" TEXT,
    "eventId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymPhoto" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "alt" TEXT,
    "credit" TEXT,
    "takenAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeightClass_slug_key" ON "WeightClass"("slug");

-- CreateIndex
CREATE INDEX "WeightClass_sport_order_idx" ON "WeightClass"("sport", "order");

-- CreateIndex
CREATE UNIQUE INDEX "WeightClass_sport_name_key" ON "WeightClass"("sport", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Language_code_key" ON "Language"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Fighter_slug_key" ON "Fighter"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Fighter_ownerId_key" ON "Fighter"("ownerId");

-- CreateIndex
CREATE INDEX "Fighter_sport_active_idx" ON "Fighter"("sport", "active");

-- CreateIndex
CREATE INDEX "Fighter_countryCode_idx" ON "Fighter"("countryCode");

-- CreateIndex
CREATE INDEX "Fighter_name_idx" ON "Fighter"("name");

-- CreateIndex
CREATE INDEX "Fighter_wins_losses_idx" ON "Fighter"("wins", "losses");

-- CreateIndex
CREATE INDEX "Fighter_lastProfileScrapedAt_idx" ON "Fighter"("lastProfileScrapedAt");

-- CreateIndex
CREATE INDEX "Title_fighterId_idx" ON "Title"("fighterId");

-- CreateIndex
CREATE INDEX "Title_body_current_idx" ON "Title"("body", "current");

-- CreateIndex
CREATE INDEX "FighterAchievement_fighterId_order_idx" ON "FighterAchievement"("fighterId", "order");

-- CreateIndex
CREATE INDEX "FighterSponsor_fighterId_order_idx" ON "FighterSponsor"("fighterId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "FighterSocial_fighterId_platform_key" ON "FighterSocial"("fighterId", "platform");

-- CreateIndex
CREATE INDEX "FighterMedia_fighterId_type_order_idx" ON "FighterMedia"("fighterId", "type", "order");

-- CreateIndex
CREATE INDEX "FighterClaim_status_createdAt_idx" ON "FighterClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FighterClaim_fighterId_idx" ON "FighterClaim"("fighterId");

-- CreateIndex
CREATE INDEX "FighterClaim_evidenceDeleteAfter_idx" ON "FighterClaim"("evidenceDeleteAfter");

-- CreateIndex
CREATE INDEX "FighterClaim_evidenceDeletionStatus_idx" ON "FighterClaim"("evidenceDeletionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "FighterClaim_fighterId_claimantId_key" ON "FighterClaim"("fighterId", "claimantId");

-- CreateIndex
CREATE INDEX "ImportConflict_entityId_resolvedAt_idx" ON "ImportConflict"("entityId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ImportConflict_resolvedAt_idx" ON "ImportConflict"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportConflict_entity_entityId_field_key" ON "ImportConflict"("entity", "entityId", "field");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Ranking_weightClassId_rank_idx" ON "Ranking"("weightClassId", "rank");

-- CreateIndex
CREATE INDEX "Ranking_isPoundForPound_rank_idx" ON "Ranking"("isPoundForPound", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "Ranking_weightClassId_isPoundForPound_fighterId_key" ON "Ranking"("weightClassId", "isPoundForPound", "fighterId");

-- CreateIndex
CREATE INDEX "RankSnapshot_fighterId_capturedAt_idx" ON "RankSnapshot"("fighterId", "capturedAt");

-- CreateIndex
CREATE INDEX "RankSnapshot_weightClass_capturedAt_idx" ON "RankSnapshot"("weightClass", "capturedAt");

-- CreateIndex
CREATE INDEX "Champion_body_idx" ON "Champion"("body");

-- CreateIndex
CREATE UNIQUE INDEX "Champion_weightClassId_body_current_key" ON "Champion"("weightClassId", "body", "current");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_date_status_idx" ON "Event"("date", "status");

-- CreateIndex
CREATE INDEX "Event_country_idx" ON "Event"("country");

-- CreateIndex
CREATE INDEX "Event_promotion_idx" ON "Event"("promotion");

-- CreateIndex
CREATE INDEX "Event_promotionId_idx" ON "Event"("promotionId");

-- CreateIndex
CREATE INDEX "Event_countryCode_idx" ON "Event"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Fight_slug_key" ON "Fight"("slug");

-- CreateIndex
CREATE INDEX "Fight_date_result_idx" ON "Fight"("date", "result");

-- CreateIndex
CREATE INDEX "Fight_redId_idx" ON "Fight"("redId");

-- CreateIndex
CREATE INDEX "Fight_blueId_idx" ON "Fight"("blueId");

-- CreateIndex
CREATE INDEX "Fight_eventId_orderOnCard_idx" ON "Fight"("eventId", "orderOnCard");

-- CreateIndex
CREATE INDEX "Fight_result_picksResolvedAt_idx" ON "Fight"("result", "picksResolvedAt");

-- CreateIndex
CREATE INDEX "Fight_createdAt_idx" ON "Fight"("createdAt");

-- CreateIndex
CREATE INDEX "FightPick_fightId_corner_idx" ON "FightPick"("fightId", "corner");

-- CreateIndex
CREATE INDEX "FightPick_updatedAt_idx" ON "FightPick"("updatedAt");

-- CreateIndex
CREATE INDEX "Prediction_fightId_source_idx" ON "Prediction"("fightId", "source");

-- CreateIndex
CREATE INDEX "Prediction_authorId_idx" ON "Prediction"("authorId");

-- CreateIndex
CREATE INDEX "OddsSnapshot_fightId_capturedAt_idx" ON "OddsSnapshot"("fightId", "capturedAt");

-- CreateIndex
CREATE INDEX "OddsSnapshot_bookmaker_idx" ON "OddsSnapshot"("bookmaker");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Article_category_publishedAt_idx" ON "Article"("category", "publishedAt");

-- CreateIndex
CREATE INDEX "Article_featured_idx" ON "Article"("featured");

-- CreateIndex
CREATE INDEX "Article_promotionId_publishedAt_idx" ON "Article"("promotionId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_name_key" ON "ForumCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_slug_key" ON "ForumCategory"("slug");

-- CreateIndex
CREATE INDEX "ForumCategory_kind_idx" ON "ForumCategory"("kind");

-- CreateIndex
CREATE INDEX "CommunityMember_userId_idx" ON "CommunityMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_communityId_userId_key" ON "CommunityMember"("communityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_slug_key" ON "ForumThread"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_fighterId_key" ON "ForumThread"("fighterId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_promotion_key" ON "ForumThread"("promotion");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_eventId_key" ON "ForumThread"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_fightId_key" ON "ForumThread"("fightId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_battleId_key" ON "ForumThread"("battleId");

-- CreateIndex
CREATE INDEX "ForumThread_categoryId_lastPostAt_idx" ON "ForumThread"("categoryId", "lastPostAt");

-- CreateIndex
CREATE INDEX "ForumThread_pinned_lastPostAt_idx" ON "ForumThread"("pinned", "lastPostAt");

-- CreateIndex
CREATE INDEX "ForumThread_kind_createdAt_idx" ON "ForumThread"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_videoId_idx" ON "ForumThread"("videoId");

-- CreateIndex
CREATE INDEX "ForumThread_createdAt_idx" ON "ForumThread"("createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_visibility_lastPostAt_idx" ON "ForumThread"("visibility", "lastPostAt");

-- CreateIndex
CREATE INDEX "ForumThread_replyCount_idx" ON "ForumThread"("replyCount");

-- CreateIndex
CREATE INDEX "ForumThread_reactionCount_idx" ON "ForumThread"("reactionCount");

-- CreateIndex
CREATE INDEX "ForumPost_threadId_createdAt_idx" ON "ForumPost"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorId_idx" ON "ForumPost"("authorId");

-- CreateIndex
CREATE INDEX "ForumReaction_postId_idx" ON "ForumReaction"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReaction_postId_userId_type_key" ON "ForumReaction"("postId", "userId", "type");

-- CreateIndex
CREATE INDEX "ForumSubscription_userId_idx" ON "ForumSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumSubscription_threadId_userId_key" ON "ForumSubscription"("threadId", "userId");

-- CreateIndex
CREATE INDEX "ForumBookmark_userId_createdAt_idx" ON "ForumBookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumBookmark_threadId_userId_key" ON "ForumBookmark"("threadId", "userId");

-- CreateIndex
CREATE INDEX "ForumReport_status_createdAt_idx" ON "ForumReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ForumReport_targetType_targetId_idx" ON "ForumReport"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReport_targetType_targetId_reporterId_key" ON "ForumReport"("targetType", "targetId", "reporterId");

-- CreateIndex
CREATE INDEX "CopyrightReport_status_createdAt_idx" ON "CopyrightReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CopyrightReport_contentIdentifier_idx" ON "CopyrightReport"("contentIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMarket_slug_key" ON "CommunityMarket"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMarket_seedKey_key" ON "CommunityMarket"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMarket_providerMarketId_key" ON "CommunityMarket"("providerMarketId");

-- CreateIndex
CREATE INDEX "CommunityMarket_sport_status_idx" ON "CommunityMarket"("sport", "status");

-- CreateIndex
CREATE INDEX "CommunityMarket_status_voteCount_idx" ON "CommunityMarket"("status", "voteCount");

-- CreateIndex
CREATE INDEX "CommunityVote_userId_idx" ON "CommunityVote"("userId");

-- CreateIndex
CREATE INDEX "CommunityVote_marketId_choice_idx" ON "CommunityVote"("marketId", "choice");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityVote_marketId_userId_key" ON "CommunityVote"("marketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_reputation_idx" ON "User"("reputation");

-- CreateIndex
CREATE INDEX "User_mapVisibility_mapLat_idx" ON "User"("mapVisibility", "mapLat");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "FavoritePromotion_promotion_idx" ON "FavoritePromotion"("promotion");

-- CreateIndex
CREATE INDEX "FavoriteEvent_eventId_idx" ON "FavoriteEvent"("eventId");

-- CreateIndex
CREATE INDEX "FavoriteEvent_userId_createdAt_idx" ON "FavoriteEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "ScrapeJob_status_createdAt_idx" ON "ScrapeJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeJob_target_idx" ON "ScrapeJob"("target");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");

-- CreateIndex
CREATE INDEX "ProviderHealth_sourceKey_checkedAt_idx" ON "ProviderHealth"("sourceKey", "checkedAt");

-- CreateIndex
CREATE INDEX "ProviderSync_sourceKey_startedAt_idx" ON "ProviderSync"("sourceKey", "startedAt");

-- CreateIndex
CREATE INDEX "ProviderSync_entity_status_idx" ON "ProviderSync"("entity", "status");

-- CreateIndex
CREATE INDEX "FighterExternalId_fighterId_idx" ON "FighterExternalId"("fighterId");

-- CreateIndex
CREATE UNIQUE INDEX "FighterExternalId_source_externalId_key" ON "FighterExternalId"("source", "externalId");

-- CreateIndex
CREATE INDEX "EventExternalId_eventId_idx" ON "EventExternalId"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventExternalId_source_externalId_key" ON "EventExternalId"("source", "externalId");

-- CreateIndex
CREATE INDEX "FighterAlias_normalized_idx" ON "FighterAlias"("normalized");

-- CreateIndex
CREATE INDEX "FighterAlias_fighterId_idx" ON "FighterAlias"("fighterId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_slug_key" ON "Promotion"("slug");

-- CreateIndex
CREATE INDEX "Promotion_sport_status_idx" ON "Promotion"("sport", "status");

-- CreateIndex
CREATE INDEX "Promotion_country_idx" ON "Promotion"("country");

-- CreateIndex
CREATE INDEX "Promotion_active_idx" ON "Promotion"("active");

-- CreateIndex
CREATE INDEX "PromotionSource_type_enabled_idx" ON "PromotionSource"("type", "enabled");

-- CreateIndex
CREATE INDEX "PromotionSource_promotionId_idx" ON "PromotionSource"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSource_promotionId_url_key" ON "PromotionSource"("promotionId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "NewsOutlet_slug_key" ON "NewsOutlet"("slug");

-- CreateIndex
CREATE INDEX "NewsOutlet_enabled_idx" ON "NewsOutlet"("enabled");

-- CreateIndex
CREATE INDEX "FeedVideo_addedAt_idx" ON "FeedVideo"("addedAt");

-- CreateIndex
CREATE INDEX "FeedVideo_topic_idx" ON "FeedVideo"("topic");

-- CreateIndex
CREATE INDEX "FeedVideo_promotion_publishedAt_idx" ON "FeedVideo"("promotion", "publishedAt");

-- CreateIndex
CREATE INDEX "FeedVideo_discipline_publishedAt_idx" ON "FeedVideo"("discipline", "publishedAt");

-- CreateIndex
CREATE INDEX "FeedView_key_idx" ON "FeedView"("key");

-- CreateIndex
CREATE INDEX "FeedCollection_key_idx" ON "FeedCollection"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FeedCollection_key_system_key" ON "FeedCollection"("key", "system");

-- CreateIndex
CREATE INDEX "FeedCollectionItem_videoId_idx" ON "FeedCollectionItem"("videoId");

-- CreateIndex
CREATE INDEX "ReputationEvent_userId_createdAt_idx" ON "ReputationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_dedupeKey_idx" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE INDEX "CardAward_userId_createdAt_idx" ON "CardAward"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CardAward_fighterId_idx" ON "CardAward"("fighterId");

-- CreateIndex
CREATE INDEX "Battle_fightId_state_idx" ON "Battle"("fightId", "state");

-- CreateIndex
CREATE INDEX "Battle_challengerId_state_idx" ON "Battle"("challengerId", "state");

-- CreateIndex
CREATE INDEX "Battle_opponentId_state_idx" ON "Battle"("opponentId", "state");

-- CreateIndex
CREATE INDEX "Rivalry_userAId_idx" ON "Rivalry"("userAId");

-- CreateIndex
CREATE INDEX "Rivalry_userBId_idx" ON "Rivalry"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Rivalry_userAId_userBId_key" ON "Rivalry"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_ts_idx" ON "AnalyticsEvent"("name", "ts");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_ts_idx" ON "AnalyticsEvent"("userId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Gym_slug_key" ON "Gym"("slug");

-- CreateIndex
CREATE INDEX "Gym_countryCode_idx" ON "Gym"("countryCode");

-- CreateIndex
CREATE INDEX "Gym_latitude_longitude_idx" ON "Gym"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "GymMember_userId_isHome_idx" ON "GymMember"("userId", "isHome");

-- CreateIndex
CREATE UNIQUE INDEX "GymMember_gymId_userId_key" ON "GymMember"("gymId", "userId");

-- CreateIndex
CREATE INDEX "GymClaim_status_createdAt_idx" ON "GymClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GymClaim_claimantId_idx" ON "GymClaim"("claimantId");

-- CreateIndex
CREATE INDEX "GymClaim_evidenceDeleteAfter_idx" ON "GymClaim"("evidenceDeleteAfter");

-- CreateIndex
CREATE INDEX "CheckIn_gymId_expiresAt_idx" ON "CheckIn"("gymId", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckIn_eventId_expiresAt_idx" ON "CheckIn"("eventId", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckIn_userId_expiresAt_idx" ON "CheckIn"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "UserFollow_followingId_idx" ON "UserFollow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "GymPhoto_gymId_sortOrder_idx" ON "GymPhoto"("gymId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "Fighter" ADD CONSTRAINT "Fighter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterAchievement" ADD CONSTRAINT "FighterAchievement_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterSponsor" ADD CONSTRAINT "FighterSponsor_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterSocial" ADD CONSTRAINT "FighterSocial_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterMedia" ADD CONSTRAINT "FighterMedia_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterClaim" ADD CONSTRAINT "FighterClaim_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterClaim" ADD CONSTRAINT "FighterClaim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterClaim" ADD CONSTRAINT "FighterClaim_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_weightClassId_fkey" FOREIGN KEY ("weightClassId") REFERENCES "WeightClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Champion" ADD CONSTRAINT "Champion_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Champion" ADD CONSTRAINT "Champion_weightClassId_fkey" FOREIGN KEY ("weightClassId") REFERENCES "WeightClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_redId_fkey" FOREIGN KEY ("redId") REFERENCES "Fighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_blueId_fkey" FOREIGN KEY ("blueId") REFERENCES "Fighter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_weightClassId_fkey" FOREIGN KEY ("weightClassId") REFERENCES "WeightClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FightPick" ADD CONSTRAINT "FightPick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FightPick" ADD CONSTRAINT "FightPick_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_predictedWinnerId_fkey" FOREIGN KEY ("predictedWinnerId") REFERENCES "Fighter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsSnapshot" ADD CONSTRAINT "OddsSnapshot_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "ForumCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ForumCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "FeedVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReaction" ADD CONSTRAINT "ForumReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReaction" ADD CONSTRAINT "ForumReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumSubscription" ADD CONSTRAINT "ForumSubscription_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumSubscription" ADD CONSTRAINT "ForumSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumBookmark" ADD CONSTRAINT "ForumBookmark_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumBookmark" ADD CONSTRAINT "ForumBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReport" ADD CONSTRAINT "ForumReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyrightReport" ADD CONSTRAINT "CopyrightReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityVote" ADD CONSTRAINT "CommunityVote_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "CommunityMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityVote" ADD CONSTRAINT "CommunityVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFighter" ADD CONSTRAINT "FavoriteFighter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFighter" ADD CONSTRAINT "FavoriteFighter_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePromotion" ADD CONSTRAINT "FavoritePromotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteEvent" ADD CONSTRAINT "FavoriteEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteEvent" ADD CONSTRAINT "FavoriteEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderHealth" ADD CONSTRAINT "ProviderHealth_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "DataSource"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSync" ADD CONSTRAINT "ProviderSync_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "DataSource"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterExternalId" ADD CONSTRAINT "FighterExternalId_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventExternalId" ADD CONSTRAINT "EventExternalId_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterAlias" ADD CONSTRAINT "FighterAlias_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSource" ADD CONSTRAINT "PromotionSource_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedCollectionItem" ADD CONSTRAINT "FeedCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "FeedCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReputationEvent" ADD CONSTRAINT "ReputationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAward" ADD CONSTRAINT "CardAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAward" ADD CONSTRAINT "CardAward_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gym" ADD CONSTRAINT "Gym_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymMember" ADD CONSTRAINT "GymMember_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymMember" ADD CONSTRAINT "GymMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymClaim" ADD CONSTRAINT "GymClaim_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymClaim" ADD CONSTRAINT "GymClaim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymClaim" ADD CONSTRAINT "GymClaim_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymPhoto" ADD CONSTRAINT "GymPhoto_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

