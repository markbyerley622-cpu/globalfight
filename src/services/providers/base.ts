// Abstract base every provider extends. Concrete providers override only the
// entities they actually serve; the rest default to an empty, ok result. When
// credentials are missing every call short-circuits to `configured:false` so
// the aggregator simply skips the source — it never errors the pipeline.

import type {
  CombatDataProvider, Entity, FetchOpts, ProviderResult,
  NormalizedEvent, NormalizedFighter, NormalizedRanking, NormalizedArticle,
} from "./types";
import type { Sport } from "@/lib/types";

export abstract class BaseProvider implements CombatDataProvider {
  abstract readonly key: string;
  abstract readonly label: string;
  abstract readonly sports: readonly Sport[];

  /** Env var names that must all be set for this provider to be "configured". */
  protected abstract readonly envKeys: readonly string[];

  isConfigured(): boolean {
    return this.envKeys.length > 0 && this.envKeys.every((k) => !!process.env[k]?.trim());
  }

  protected env(name: string): string {
    return process.env[name]?.trim() ?? "";
  }

  /** Empty, successful result — used for unconfigured providers / unsupported entities. */
  protected empty<T>(): ProviderResult<T> {
    return { configured: this.isConfigured(), ok: true, latencyMs: 0, rateLimited: false, data: [] };
  }

  /** Guard: returns an empty result when not configured, else null to proceed. */
  protected gate<T>(): ProviderResult<T> | null {
    return this.isConfigured() ? null : this.empty<T>();
  }

  supports(_entity: Entity, sport?: Sport): boolean {
    return !sport || this.sports.includes(sport);
  }

  // Default implementations — overridden per provider as integrations land.
  async getEvents(_opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.empty(); }
  async getFighters(_opts?: FetchOpts): Promise<ProviderResult<NormalizedFighter>> { return this.empty(); }
  async getRankings(_opts?: FetchOpts): Promise<ProviderResult<NormalizedRanking>> { return this.empty(); }
  async getResults(_opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.empty(); }
  async getNews(_opts?: FetchOpts): Promise<ProviderResult<NormalizedArticle>> { return this.empty(); }
}
