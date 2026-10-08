import { $ as readCliVersion, A as CN_VARIANT, B as modelWithCurrentPromotion, C as workbuddyImportedDir, D as openAuthField, E as classifyDesktopAuthDocument, G as regionOf, H as parseModelCatalog, I as WORKBUDDY_UPDATE_PATH, J as randomSentinel, K as PROBE_EFFORT_CANDIDATES, L as WorkBuddyUpstreamClient, M as variantFor, O as unwrapDesktopAuthDocument, Q as fallbackChatIdentity, R as classifyUpstreamError, S as importedCredentialPath, T as atRestKeyProviderFor, U as prepareChatBody, V as normalizeCredits, W as prepareInternationalChatBody, X as FALLBACK_CN_APP_VERSION, Y as CN_APP_VERSION_FILENAME, Z as chatUserAgent, _ as desktopAuthCandidatesFor, a as readHostHeartbeat, at as readBundleVersion, b as accountIdOf, c as WORKBUDDY_CONNECT_VERSION, d as WorkBuddyCatalog, et as resolveChatIdentity, f as WORKBUDDY_AUTH_FILENAME, g as defaultDesktopAuthPath, h as defaultDesktopAuthCandidates, i as processStartTimeMs, it as installedAppVersion, j as WORKBUDDY_VARIANTS, k as AI_VARIANT, l as FALLBACK_WORKBUDDY_AI_MODELS, m as WorkBuddyCredentialStore, n as clearHostHeartbeat, nt as WORKBUDDY_APP_VERSION_FILENAME, o as workbuddyHostHeartbeatPath, ot as resolveAppVersion, p as WORKBUDDY_AUTH_FILE_ENV, q as probeModel, r as isHeartbeatProcessAlive, rt as appUserAgent, s as writeHostHeartbeat, st as validAppVersion, t as WORKBUDDY_HOST_HEARTBEAT_FILENAME, tt as validCliVersion, u as FALLBACK_WORKBUDDY_MODELS, v as parseWorkBuddyAuth, w as parseCredentialText, x as discoverAccounts, y as workbuddyOwnAuthPath, z as extractDisplayErrorMessage } from "./host-heartbeat-D08Thq_T.js";
import z from "@deepseek-ai/schemastery";
import { resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { dirname, join, resolve } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";
//#region src/catalog-store.ts
/**
* The last catalog that actually loaded, kept per variant and per account.
*
* Both the plan (§4 "降级顺序为同版同来源的最近成功目录 → 本版内置保守目录")
* and the README promise this fallback, and without it a restart always drops
* the user to the built-in roster even when a good catalog was fetched minutes
* earlier. The built-in roster is a snapshot taken once; a fetched catalog is
* what the upstream actually serves to this account.
*
* What it deliberately is *not*:
*
* - not a cache with a freshness policy — it never prevents a fetch, it only
*   answers when a fetch cannot;
* - not shared across accounts (a different account can see a different roster
*   and different promotions), nor across variants (the CN and international
*   endpoints disagree about rates and windows for the same model id);
* - not a place for secrets: model metadata only, never a token. The account
*   key is a `uid:enterpriseId` identity already visible in the status document.
*
* @module dsh-workbuddy-connect/catalog-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const CATALOG_FORMAT_VERSION = 1;
/** Basename of the CN variant's saved catalog inside the Harness home. */
const WORKBUDDY_CATALOG_FILENAME = ".workbuddy-catalog.json";
/** Plugin-owned saved-catalog path inside the Harness home. */
function workbuddyCatalogPath(filename = WORKBUDDY_CATALOG_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a model row worth keeping. */
function isModel(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const row = value;
	return typeof row["id"] === "string" && row["id"] !== "" && typeof row["name"] === "string" && typeof row["contextWindow"] === "number" && Number.isFinite(row["contextWindow"]) && typeof row["maxTokens"] === "number" && Number.isFinite(row["maxTokens"]) && typeof row["supportsImages"] === "boolean";
}
/** Whether a parsed value is a saved catalog this reader can trust. */
function isSaved$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["source"] !== "string" || entry["source"] === "") return false;
	if (typeof entry["fetchedAtMs"] !== "number" || !Number.isFinite(entry["fetchedAtMs"])) return false;
	const models = entry["models"];
	if (!Array.isArray(models) || models.length === 0) return false;
	return models.every(isModel);
}
/**
* The last successful catalog per account, read once and written atomically.
*
* Malformed content reads as "nothing saved" rather than throwing: this file
* is an optimization for the offline and first-seconds cases, and a corrupt one
* must never be able to stop the plugin from serving models.
*/
var WorkBuddyCatalogStore = class {
	path;
	entries;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyCatalogPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.entries !== void 0) return this.entries;
		const entries = {};
		if (existsSync(this.path)) try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const document = parsed;
				const raw = document["version"] === CATALOG_FORMAT_VERSION ? document["entries"] : void 0;
				if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
					for (const [key, value] of Object.entries(raw)) if (isSaved$1(value)) entries[key] = value;
				}
			}
		} catch {}
		this.entries = entries;
		return entries;
	}
	/** The saved catalog for one account, or `undefined` when there is none. */
	get(account) {
		const entry = this.load()[account];
		return entry === void 0 ? void 0 : entry;
	}
	/**
	* Remember a catalog for an account, replacing whatever was saved before.
	*
	* A failed write is swallowed: the plugin has already served these models,
	* and losing the *memory* of them is not worth surfacing.
	*/
	set(account, catalog) {
		const entries = this.load();
		entries[account] = {
			account,
			...catalog
		};
		this.persist();
	}
	/** Forget one account's catalog — used when that account signs out. */
	delete(account) {
		const entries = this.load();
		if (!(account in entries)) return;
		delete entries[account];
		this.persist();
	}
	persist() {
		const directory = dirname(this.path);
		try {
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			const document = {
				version: CATALOG_FORMAT_VERSION,
				entries: this.load()
			};
			const temporary = resolve(`${this.path}.tmp`);
			writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
			renameSync(temporary, this.path);
		} catch {}
	}
};
//#endregion
//#region src/visibility-store.ts
/**
* Per-account model-visibility preferences: which models the signed-in account
* has hidden from the DSH model picker (issue #36).
*
* A disabled *list*, deliberately not an enabled whitelist: a new account and a
* model the upstream adds both start visible, and an id that temporarily
* disappears from the catalog is kept — when the model returns it stays hidden
* until this account says otherwise. Entries are also kept across sign-outs, so
* returning to an account restores exactly what it left.
*
* One file per variant (the two endpoints share model ids but never
* preferences), keyed by the same `uid:enterpriseId` identity the saved
* catalogs and probe records use. Not a place for secrets: model-id strings
* only, never a token, and never written into the desktop auth file or the
* plugin-owned credential copy — hiding a model is a picker preference, not
* credential state.
*
* Why a plugin-owned file rather than a settings section: the settings sections
* are statically-typed schemastery objects, and `settings.yaml` is account-global
* — a per-uid dynamic map fits neither without weakening the schema or mixing
* one account's preferences into another's config. The saved-catalog and probe
* stores already persist per-account data this way, so this store follows them:
* version-tagged document, atomic write with `0o600`, and a malformed file that
* reads as "nothing saved" rather than throwing.
*
* @module dsh-workbuddy-connect/visibility-store
*/
/** On-disk format this reader accepts; other versions are discarded. */
const VISIBILITY_FORMAT_VERSION = 1;
/** Basename of the CN variant's visibility file inside the Harness home. */
const WORKBUDDY_VISIBILITY_FILENAME = ".workbuddy-model-visibility.json";
/** Plugin-owned visibility-file path inside the Harness home. */
function workbuddyVisibilityPath(filename = WORKBUDDY_VISIBILITY_FILENAME) {
	return join(resolveDshHome(), filename);
}
/** Whether a parsed value is a saved preference entry this reader can trust. */
function isSaved(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const entry = value;
	if (typeof entry["account"] !== "string" || entry["account"] === "") return false;
	if (typeof entry["updatedAtMs"] !== "number" || !Number.isFinite(entry["updatedAtMs"])) return false;
	const disabled = entry["disabled"];
	if (!Array.isArray(disabled)) return false;
	return disabled.every((id) => typeof id === "string" && id !== "");
}
/**
* The per-account hidden-model lists, read once and written atomically.
*
* Unlike the saved-catalog store, a failed *write* propagates: the caller
* reports it to the user rather than answering "hidden" for a preference that
* did not persist. Reads stay forgiving — a corrupt or unreadable file is
* "nothing hidden", which only ever shows models the account can still pick.
*/
var WorkBuddyVisibilityStore = class {
	path;
	accounts;
	constructor(options = {}) {
		this.path = typeof options === "string" ? options : options.path ?? workbuddyVisibilityPath();
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.accounts !== void 0) return this.accounts;
		const accounts = {};
		if (existsSync(this.path)) try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const document = parsed;
				const raw = document["version"] === VISIBILITY_FORMAT_VERSION ? document["accounts"] : void 0;
				if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
					for (const [key, value] of Object.entries(raw)) if (isSaved(value)) accounts[key] = value;
				}
			}
		} catch {}
		this.accounts = accounts;
		return accounts;
	}
	/** The model ids one account has hidden; empty when it never hid any. */
	disabled(account) {
		return this.load()[account]?.disabled ?? [];
	}
	/**
	* Show or hide one model for one account, persisting before committing.
	*
	* Re-enabling (showing) the last hidden model removes the account's entry
	* entirely — an absent entry and an empty list mean the same thing
	* (everything visible), and the file should not accumulate empty buckets.
	* Throws when the write fails, leaving the in-memory state untouched so a
	* re-read cannot lie about what was persisted.
	*/
	setVisible(account, model, visible) {
		const current = this.load()[account]?.disabled ?? [];
		const next = visible ? current.filter((id) => id !== model) : [.../* @__PURE__ */ new Set([...current, model])];
		const accounts = { ...this.load() };
		if (next.length === 0) delete accounts[account];
		else accounts[account] = {
			account,
			disabled: next,
			updatedAtMs: Date.now()
		};
		this.persist(accounts);
		this.accounts = accounts;
	}
	persist(accounts) {
		const directory = dirname(this.path);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
		const document = {
			version: VISIBILITY_FORMAT_VERSION,
			accounts
		};
		const temporary = resolve(`${this.path}.tmp`);
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
		renameSync(temporary, this.path);
	}
};
//#endregion
//#region src/adapter.ts
/**
* The `workbuddy` pi-ai provider: one loopback-backed adapter registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai`
* extension points the way `dsh-codex-connect` assembles its Codex route.
*
* @module dsh-workbuddy-connect/adapter
*/
/** Provider route this bundle owns. */
const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image-request budgets at the dsh-llm-pi-ai defaults; the profile type made
* them required in 0.1.1-rc.2. They bound requests to models whose catalog
* entry declares `supportsImages`; text-only models never receive images.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane. The workbuddy route authenticates only through the
* shim shared secret resolved per request by `resolveApiKey`, so pi-ai's own
* credential lifecycle and ambient discovery must never manufacture a
* credential for it. `PiAiAdapterOptions.auth` is required since 0.1.1-rc.2;
* every ambient question here answers "nothing stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-workbuddy-connect: the workbuddy route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/**
* Translate the request-image contract across the two attachment-service
* generations a link-installed plugin can straddle.
*
* A `link:` install resolves its platform imports from the *repository's*
* node_modules (Node follows the symlink's real path), so this adapter always
* runs against the pi-ai it was built with — while the attachment service
* comes from the host. Those two generations disagree on what
* `readImageRequest(ref, policyOrTarget)` receives:
*
* - dsh-attachment-local ≤0.1.5: a route policy `{ maxPixels, maxBytes }`,
*   and `validatePolicy` throws `Image request maxPixels must be a positive
*   integer.` when `maxPixels` is missing.
* - 0.1.6+: a per-image target `{ width, height, maxBytes }` with no
*   `maxPixels` at all, validated by `validateTarget`.
*
* A 0.1.6-built pi-ai on a 0.1.5 host therefore hands the old store a target
* the old store rejects, and every image-bearing request fails before it is
* sent. The wrapper below fills the route's own pixel budget into a target
* that lacks it: the 0.1.5 store then computes the same dimensions pi-ai's
* budget already chose, and a 0.1.6 store ignores the extra key.
*/
function withLegacyImageBudget(store) {
	return new Proxy(store, { get(target, property, receiver) {
		if (property === "imageHostPath") return target.imageHostPath.bind(target);
		if (property !== "readImageRequest") return Reflect.get(target, property, receiver);
		return (...args) => {
			const [ref, policy, signal] = args;
			const present = policy?.maxPixels;
			const withPixels = Number.isSafeInteger(present) && present > 0 ? policy : {
				...policy,
				maxPixels: REQUEST_IMAGE_BUDGETS.requestImagePixelBudget
			};
			return target.readImageRequest(ref, withPixels, signal);
		};
	} });
}
/**
* The suffix appended to a model's display name so its billing rate is visible
* wherever the name is shown.
*
* The separator is a middle dot rather than a hyphen or colon: model names
* already contain hyphens (`GLM-5.3-Flash`, `Deepseek-V4-Flash`), so a hyphen
* separator would be ambiguous about where the name ends and the rate begins.
*/
const RATE_SEPARATOR = " · ";
/**
* Append the billing rate to one model's display name.
*
* The rate AND the declared promo badges ride the *name* alone: since DSH
* 0.1.2 the composer's model seat (`ModelSelect`) renders `model.name` only —
* `description` is no longer read there at all (the 0.1.1-era client rendered
* it, which is why the badges used to be visible in the seat). The `/model`
* popup renders the name too, so a separate `description` copy would either
* duplicate (rate) or vanish (badges) depending on client generation.
*
* This is display-only and cannot affect routing: the wire request is built
* from `model.id` (pi-ai's completions API sets `model: model.id`), the
* selection a picker submits is `{provider, model: id, reasoningEffort}`, and
* `dsh-llm` validates `name` as a non-empty string without comparing its
* contents. Nothing in the host resolves a model *by* name.
*/
/**
* The catalog display suffix: the billing rate followed by the declared promo
* badges (`限时免费`, `夜间折扣`), or undefined when the row carries neither.
* The badge labels are the upstream's own spellings and the host seam has no
* locale service, so non-Chinese UIs see them verbatim — accepted until the
* picker grows a localized badge slot.
*/
function displaySuffix(info) {
	const parts = [normalizeCredits(info.billing?.credits), ...info.billing?.badges ?? []].filter((part) => part !== void 0 && part !== "");
	return parts.length === 0 ? void 0 : parts.join(" · ");
}
/** Append the catalog display suffix to one model's display name. */
function withCatalogDisplay(name, info) {
	const suffix = displaySuffix(info);
	return suffix === void 0 ? name : `${name}${RATE_SEPARATOR}${suffix}`;
}
/**
* Resolve a WorkBuddy model's reasoning capability into pi-ai's
* `thinkingLevelMap` (every level pinned to its wire spelling or `null` for
* unsupported), mirroring `dsh-llm-pi-ai`'s own `resolveModelReasoning`.
*
* Two sources, strictly ordered (`docs/reasoning-effort-probe-plan.md` §5):
*
* 1. **The declared set.** When the upstream declares a non-empty
*    `supportedEfforts`, exactly those values are offered and nothing else.
*    This always wins: an observation never widens or narrows a declared set.
* 2. **A local observation.** Rows without a declared set (the older
*    `{effort, summary}` shape) normally get no control at all — their
*    selectable set is client-side knowledge the catalog does not carry, and
*    the desktop app differs per model there. If the user authorized a probe
*    and it established that the upstream *validates* the parameter, the
*    verified spellings are offered.
*
* A `non-validating` observation deliberately yields no control: the upstream
* accepts values that cannot exist (measured on `glm-5.2`), so every per-level
* acceptance it produced would be a false positive.
*
* `off` is offered only when the upstream declares `canDisableThinking: true`.
* It is never probed — disabling thinking is a separate capability, and the
* per-model acceptance of `off` cannot be inferred from the row's shape.
*
* The offered set is described internally as "verified accepted", never as
* "verified effective": acceptance proves the upstream did not reject the
* spelling, not that it changes what the model does.
*/
function reasoningFields(info, observed) {
	const reasoning = info.reasoning;
	if (reasoning === void 0 || reasoning.supports !== true) return { reasoning: false };
	const declared = reasoning.supportedEfforts;
	const efforts = declared !== void 0 && declared.length > 0 ? declared : observed?.validation === "validating" && observed.efforts.length > 0 ? observed.efforts : void 0;
	if (efforts === void 0) return { reasoning: false };
	return {
		reasoning: true,
		thinkingLevelMap: {
			off: reasoning.canDisableThinking === true && declared !== void 0 && declared.length > 0 ? "off" : null,
			minimal: null,
			low: efforts.includes("low") ? "low" : null,
			medium: efforts.includes("medium") ? "medium" : null,
			high: efforts.includes("high") ? "high" : null,
			xhigh: efforts.includes("xhigh") ? "xhigh" : null,
			max: efforts.includes("max") ? "max" : null
		}
	};
}
/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl, observed, providerId = WORKBUDDY_PROVIDER) {
	return {
		id: info.id,
		name: info.name,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: info.supportsImages === true ? ["text", "image"] : ["text"],
		...reasoningFields(info, observed),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		compat: { maxTokensField: "max_tokens" }
	};
}
/**
* Assemble the adapter. The provider's `getModels` reads the live catalog,
* and every model's `baseUrl` is re-resolved per read so the shim's
* ephemeral port applies from the first snapshot after startup.
*
* The profile is constructed by hand rather than through dsh-llm-pi-ai's
* internal `resolveProfiles()`: that helper is not part of the package's
* public export surface (root entry, `lib/` deep imports blocked by the
* exports map, `src/` not shipped), so hand-assembly is the only supported
* path and every newly required field must be adopted here explicitly —
* `modelErrors` since 0.1.5-alpha.2 (#12).
*/
function createWorkBuddyAdapter(options) {
	const { shim, store, catalog, resolveAttachments, resolveImageAccess, observe, hidden } = options;
	const providerId = options.providerId ?? "workbuddy";
	const displayName = options.displayName ?? "WorkBuddy";
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.current().map((info) => toPiModel(info, baseUrl, observe?.(info.id), providerId));
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: displayName,
			auth: { apiKey: {
				name: "WorkBuddy OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "WorkBuddy"
					};
				}
			} },
			models: buildModels(),
			api: openAICompletionsApi()
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-workbuddy-connect retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	return {
		adapter: new WorkBuddyPiAiAdapter(catalog, hidden ?? (() => []), {
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			...resolveAttachments === void 0 ? {} : { resolveAttachments: () => {
				const store = resolveAttachments();
				return store === void 0 ? void 0 : withLegacyImageBudget(store);
			} },
			...resolveImageAccess === void 0 ? {} : { resolveImageAccess }
		}),
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		}
	};
}
/**
* The WorkBuddy route's adapter: `PiAiAdapter` with the billing rate folded
* into the catalog answers it returns to the DSH model pickers.
*
* `PiAiAdapter.listModels()` and `.resolveModel()` build their answers straight
* from the pi-ai descriptors, which carry no billing fact, so the rate is
* layered on here by looking the model up in the live catalog. Both overrides
* delegate to `super` and then rewrite only the display fields, so streaming,
* capability resolution, and effort mapping stay exactly as `dsh-llm-pi-ai`
* implements them.
*
* A model missing from the catalog (an id the shim would serve but the last
* upstream refresh did not list) falls through with its name untouched rather
* than being dropped: catalog membership is advisory, and the seam tolerates
* serving an unlisted id.
*/
var WorkBuddyPiAiAdapter = class extends PiAiAdapter {
	catalog;
	hidden;
	constructor(catalog, hidden, options) {
		super(options);
		this.catalog = catalog;
		this.hidden = hidden;
	}
	/** Catalog entry for one model id, or undefined when the catalog omits it. */
	infoFor(model) {
		return this.catalog.current().find((entry) => entry.id === model);
	}
	async listModels(provider) {
		const models = await super.listModels(provider);
		const hidden = new Set(this.hidden());
		return models.flatMap((model) => {
			if (hidden.has(model.id)) return [];
			const info = this.infoFor(model.id);
			if (info === void 0) return [model];
			return [{
				...model,
				name: withCatalogDisplay(model.name, info)
			}];
		});
	}
	async resolveModel(provider, model, signal) {
		const resolved = await super.resolveModel(provider, model, signal);
		const info = this.infoFor(model);
		if (info === void 0) return resolved;
		return {
			...resolved,
			name: withCatalogDisplay(resolved.name, info)
		};
	}
};
/**
* Whether an account's cooldown has elapsed (or was never stated).
*
* The fallback is the only thing a transient outcome relies on: `retryAtMs` is
* attached for a rate limit or a drained quota, never for a transport failure,
* so `atMs + POOL_UNKNOWN_COOLDOWN_MS` is what brings those back.
*/
function retryDue(probe, nowMs) {
	return nowMs >= (probe.retryAtMs ?? probe.atMs + 18e5);
}
/**
* Whether one account can be billed at `nowMs`, or why not.
*
* Order is not arbitrary:
* - `credential-rejected` is excluded regardless of any cooldown: the token is
*   not accepted, so waiting cannot help and the user must sign in again.
* - limited / unreachable / failed outcomes are checked against their stated
*   (or fallback) cooldown, so an account whose limit already reset — or whose
*   gateway blipped once — returns without needing another test first.
* - `ok` and "never measured" are both candidates. The latter matters: a newly
*   discovered account has never been tested and must not be invisible.
*
* `policy-rejected` is a fact about ONE REQUEST, not about the account: the
* server refused that message's content, and the same account will serve a
* different one. Benching it would idle a healthy account over a single tripped
* filter. The measurement is still recorded so the card can explain it.
*/
function exclusionOf(probe, nowMs) {
	if (probe === void 0) return void 0;
	switch (probe.outcome) {
		case "ok": return;
		case "credential-rejected": return "credential-rejected";
		case "unavailable": return retryDue(probe, nowMs) ? void 0 : "unavailable";
		case "failed": return retryDue(probe, nowMs) ? void 0 : "failed";
		case "rate-limited": return retryDue(probe, nowMs) ? void 0 : "rate-limited";
		case "out-of-credit": return retryDue(probe, nowMs) ? void 0 : "out-of-credit";
		case "policy-rejected": return;
		default: return "unusable";
	}
}
/**
* The credit figure used for ordering.
*
* Absent credits rank as zero. Deliberately NOT "unknown ranks first": an
* account whose balance could not be read must never outrank one we positively
* know is full, or a failing credits route would capture all the traffic.
*/
function scoreOf(member) {
	return member.credits?.total ?? 0;
}
/**
* Rank a pool's members best-first.
*
* The rule, in priority order:
*
* 1. **Usability.** Only accounts that can be billed now are candidates; they
*    always outrank every excluded one.
* 2. **Credits, highest first.** Spend the fullest account, so one running low
*    is conserved rather than drained first.
* 3. **Credits expiring soonest first.** Points about to expire are worth zero
*    after they do, so using them earlier is strictly better than saving them.
* 4. **Freshest credential.** Tie-break so a stale token never wins a draw.
* 5. **Account id.** Final tie-break, making the order TOTAL: two accounts
*    equal on every key would otherwise keep the caller's array order, so the
*    same pool could rotate differently between runs.
*
* Excluded accounts are still RETURNED (sorted after the candidates) so the
* card can explain why each is out; they differ by `excludedBy` being set,
* never by being silently dropped.
*
* Pure and total: same input, same order; never throws on missing data.
*/
function rankPool(members, nowMs) {
	const rows = members.map((member) => {
		const excludedBy = exclusionOf(member.probe, nowMs);
		return {
			account: member.account,
			score: scoreOf(member),
			...excludedBy === void 0 ? {} : { excludedBy },
			_usable: excludedBy === void 0,
			_expiring: member.credits?.nearestExpiryMs ?? Number.POSITIVE_INFINITY,
			_tokenExpiresAtMs: member.tokenExpiresAtMs ?? 0
		};
	});
	rows.sort((left, right) => {
		if (left._usable !== right._usable) return left._usable ? -1 : 1;
		if (left.score !== right.score) return right.score - left.score;
		if (left._expiring !== right._expiring) return left._expiring - right._expiring;
		if (left._tokenExpiresAtMs !== right._tokenExpiresAtMs) return right._tokenExpiresAtMs - left._tokenExpiresAtMs;
		return left.account.id < right.account.id ? -1 : left.account.id > right.account.id ? 1 : 0;
	});
	return rows.map(({ account, score, excludedBy }) => ({
		account,
		score,
		...excludedBy === void 0 ? {} : { excludedBy }
	}));
}
//#endregion
//#region src/account-pool-runtime.ts
/**
* Classify an upstream failure into a pool outcome.
*
* Mirrors the distinctions the upstream actually draws: a 401 means this token
* is refused (sign in again), a 429 or the quota code means wait, and a 5xx or
* transport failure is the gateway's problem rather than this account's — which
* is why those get a cooldown instead of a permanent exclusion.
*/
function outcomeOfFailure(status, body, now = Date.now()) {
	const message = body.slice(0, 200);
	if (status === 401 || status === 403) return {
		outcome: "credential-rejected",
		message
	};
	if (isRateLimited(status, body)) {
		const retryAtMs = parseResetTime(body, now);
		return {
			outcome: "rate-limited",
			...retryAtMs === void 0 ? {} : { retryAtMs },
			message
		};
	}
	if (/out of credit|insufficient|quota/iu.test(body)) return {
		outcome: "out-of-credit",
		message
	};
	if (status >= 500 || status === 0) return {
		outcome: "failed",
		message
	};
	return {
		outcome: "unavailable",
		message
	};
}
/**
* Whether a failure is a rate limit.
*
* Three spellings are accepted because the upstream is not consistent: a bare
* 429, the region's business code `6004`, and the sentence that code arrives
* with. Checking the body as well as the status is what keeps the reset time
* reachable when a limit comes back as a 200.
*/
function isRateLimited(status, body) {
	if (status === 429) return true;
	return /"?code"?\s*[:=]\s*6004/u.test(body) || /usage exceeds frequency limit/iu.test(body);
}
/**
* Parse the reset instant out of an upstream message.
*
* The observed form is `... reset at 2026-10-07 00:06:26 UTC+8` — the timezone
* carries no colon, so both spellings are accepted. Returns undefined when no
* time is stated, which the caller must treat as "no answer", never as a
* locally invented countdown.
*/
function parseResetTime(message, now = Date.now()) {
	const match = message.match(/reset at (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*UTC([+-])(\d{1,2})(?::?(\d{2}))?/u);
	if (match === null) return void 0;
	const [, date, time, sign, hours, minutes] = match;
	const utcMs = Date.parse(`${date}T${time}Z`);
	if (Number.isNaN(utcMs)) return void 0;
	const localMs = utcMs - (Number(hours) * 60 + Number(maybe(minutes))) * (sign === "-" ? -1 : 1) * 6e4;
	return Number.isNaN(localMs) ? void 0 : Math.max(now, localMs);
}
/** Coerce a possibly-undefined capture group to a number. */
function maybe(value) {
	return value === void 0 ? 0 : Number(value);
}
/** The live pool for one variant. */
var WorkBuddyAccountPool = class WorkBuddyAccountPool {
	options;
	accounts = [];
	discoveredAtMs = 0;
	/** How long a discovery result is reused before the directory is re-scanned. */
	static DISCOVERY_TTL_MS = 6e4;
	constructor(options) {
		this.options = options;
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	/** The key opener the store already uses, bound to this variant's product. */
	resolveKey = async (keyIds) => this.options.keyProvider.protectorKeyFor([...keyIds]);
	/**
	* Every discovered account, refreshed on a short TTL.
	*
	* The TTL exists because discovery reads a directory and decrypts each file:
	* cheap enough to do occasionally, too expensive to do per request. A failed
	* scan keeps the previous result rather than emptying the pool.
	*/
	async list(force = false) {
		const now = this.now();
		if (!force && this.accounts.length > 0 && now - this.discoveredAtMs < WorkBuddyAccountPool.DISCOVERY_TTL_MS) return this.accounts;
		try {
			const found = await discoverAccounts(this.options.variant, this.resolveKey, this.options.explicitPath?.());
			this.accounts = found;
			this.discoveredAtMs = now;
		} catch {
			if (this.accounts.length === 0) this.accounts = [];
		}
		return this.accounts;
	}
	/** The credential for one account id, if it is currently discovered. */
	async credentialFor(accountId) {
		return (await this.list()).find((account) => accountIdOf(account.credential) === accountId)?.credential;
	}
	/** Ranked members, using the persisted member list and measurements. */
	async ranked(nowMs = this.now()) {
		const accounts = await this.list();
		const members = new Set(this.options.poolStore.members());
		return rankPool(accounts.filter((account) => members.has(accountIdOf(account.credential))).map((account) => {
			const id = accountIdOf(account.credential);
			const probe = this.options.poolStore.probeOf(id);
			return {
				account: {
					id,
					accountName: account.credential.nickname ?? ""
				},
				...probe === void 0 ? {} : { probe },
				tokenExpiresAtMs: account.credential.expiresAtMs
			};
		}), nowMs);
	}
	/**
	* The credential to bill for the next request.
	*
	* With the pool off, or with no members, this returns the store's own
	* resolution — the live sign-in — so the default path is untouched.
	*/
	async select() {
		if (!this.options.enabled()) return this.options.store.resolve();
		const winner = (await this.ranked()).find((row) => row.excludedBy === void 0);
		if (winner === void 0) return this.options.store.resolve();
		return await this.credentialFor(winner.account.id) ?? this.options.store.resolve();
	}
	/** Record a measurement for the account that just served a request. */
	record(accountId, outcome, message, retryAtMs) {
		this.options.poolStore.recordProbe(accountId, {
			outcome,
			atMs: this.now(),
			message,
			...retryAtMs === void 0 ? {} : { retryAtMs }
		}, "live-request");
	}
	/**
	* Run one request with failover.
	*
	* The callback receives a credential and returns a result; a thrown
	* `WorkBuddyPoolUpstreamError` (or any error carrying `poolStatus`) is
	* classified and, when retryable, the next member is tried.
	*
	* A 400 stops immediately: the same request body would be rejected by every
	* account, so retrying spends time and reveals nothing.
	*/
	async run(attempt) {
		if (!this.options.enabled()) {
			const credential = await this.options.store.resolve();
			return attempt(credential, accountIdOf(credential));
		}
		const usable = (await this.ranked()).filter((row) => row.excludedBy === void 0);
		const order = usable.length > 0 ? usable.map((row) => row.account) : [];
		let lastError;
		for (const account of order) {
			const credential = await this.credentialFor(account.id);
			if (credential === void 0) continue;
			try {
				const result = await attempt(credential, account.id);
				this.record(account.id, "ok", "");
				return result;
			} catch (error) {
				const status = statusOf(error);
				if (status === 400) throw error;
				const classified = outcomeOfFailure(status, messageOf$1(error));
				this.record(account.id, classified.outcome, classified.message, classified.retryAtMs);
				lastError = error;
			}
		}
		if (lastError !== void 0) throw lastError;
		const credential = await this.options.store.resolve();
		return attempt(credential, accountIdOf(credential));
	}
	/** Public snapshot for the status document. */
	async snapshot() {
		const accounts = await this.list();
		const members = new Set(this.options.poolStore.members());
		const ranked = await this.ranked();
		const excluded = new Map(ranked.map((row) => [row.account.id, row.excludedBy]));
		const now = this.now();
		return {
			enabled: this.options.enabled(),
			accounts: accounts.map((account) => {
				const id = accountIdOf(account.credential);
				const excludedBy = excluded.get(id);
				const until = this.options.poolStore.probeOf(id)?.retryAtMs;
				return {
					id,
					name: account.credential.nickname ?? "",
					live: account.live,
					member: members.has(id),
					...excludedBy === void 0 ? {} : { excludedBy },
					...excludedBy === void 0 || until === void 0 || until <= now ? {} : { excludedUntilMs: until },
					expiresAtMs: account.credential.expiresAtMs
				};
			})
		};
	}
};
/** Read a `status` off an unknown error, for classification. */
function statusOf(error) {
	if (typeof error === "object" && error !== null) {
		const status = error.poolStatus ?? error.status;
		if (typeof status === "number") return status;
	}
	return 0;
}
/** Read a message off an unknown error. */
function messageOf$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
//#endregion
//#region src/loopback.ts
/**
* Shared browser-trust gates for the plugin's local HTTP surfaces: the
* loopback shim and the same-origin web-status route.
*
* These surfaces are meant to be reached through the machine's loopback
* interface, but a GUI is perfectly entitled to be served on a real hostname:
* `dsh web --host 0.0.0.0 --trusted-host <authority>` binds every interface and
* declares the authorities its own `/api` fence accepts. A browser opening the
* GUI on that authority sends it in both `Host` and `Origin`, so a gate that
* only ever accepted loopback would reject the plugin's own same-origin reads
* with `403 request-not-trusted` — the card and the pool page would render
* their shells and then fail to load any data.
*
* The gate therefore mirrors the host's own fence
* (`@deepseek-ai/dsh-client-connection`): the request authority must be
* loopback *or* a declared trusted authority, and any browser-attached Origin
* must be same-origin with the request authority. Rebinding protection is
* unchanged — a rebound page still presents the attacker's domain in `Host`,
* which is neither loopback nor trusted.
*
* @module dsh-workbuddy-connect/loopback
*/
/** Loopback hostnames a local plugin surface may be addressed by. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** Resolve a {@link TrustedAuthorities} value to its current list. */
function resolveTrusted(trusted) {
	return typeof trusted === "function" ? trusted() : trusted;
}
/** Strip the optional :port from a Host header value, IPv6-bracket aware. */
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && !hostname.slice(0, colon).includes(":") && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/**
* The request's Host header must name the loopback interface. A DNS-rebinding
* page (attacker domain re-resolved to 127.0.0.1) sends its own domain in
* Host, so this check drops those before any routing happens.
*/
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
/**
* A browser-sent Origin (present header) must be loopback. Non-browser
* clients (the plugin's own fetch calls) send no Origin at all and pass.
*/
function originIsLoopback(origin) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}
/** Parse a Host-header authority, or `undefined` when it is not one. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/**
* Canonical form of a parsed authority: `hostname` when no port was written,
* else `hostname:port`. A port written as the scheme default (`:80` for http)
* still counts as explicit, matching the host's own fence.
*/
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/**
* Whether the request authority matches a declared entry.
*
* An entry with an explicit port matches that exact authority; a port-less
* entry matches the hostname on any port — the shape a deployment derives for
* LAN IP literals, where the bound port may be OS-assigned and therefore
* unknowable at configuration time. Both sides compare through WHATWG
* normalization, so case never decides trust.
*/
function hostIsTrusted(host, trusted) {
	const list = resolveTrusted(trusted);
	if (list === void 0 || list.length === 0) return false;
	if (host === void 0 || host.trim() === "") return false;
	const hostUrl = parseAuthority(host.trim());
	if (hostUrl === void 0) return false;
	return list.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* The full browser-trust gate: the request authority must be loopback or a
* declared trusted authority, and an attached browser Origin must be
* same-origin with it.
*
* Same-origin (rather than "also loopback or trusted") is deliberate and
* mirrors the host's fence: a page served from one trusted authority must not
* be able to read another's responses, and a rebound page's Origin still names
* the attacker's domain.
*/
function requestIsTrusted(host, origin, trusted) {
	if (host === void 0 || host.trim() === "") return false;
	const hostUrl = parseAuthority(host.trim());
	if (hostUrl === void 0) return false;
	const hostname = hostnameOfHost(host);
	if (!LOOPBACK_HOSTS.has(hostname) && !hostIsTrusted(host, trusted)) return false;
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/shim.ts
/**
* Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
* shim applies the WorkBuddy wire quirks (forced streaming, string
* `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
* It binds 127.0.0.1 only and never serves another interface.
*
* Inbound hardening: the loopback bind alone is not a trust boundary (any
* local process or a DNS-rebinding page can reach 127.0.0.1), so every
* request must carry a loopback Host header, browser-sent Origins must be
* loopback, chat POSTs must be application/json, and the Authorization
* header must carry the shim's per-process shared secret. The plugin's
* own client satisfies all four by construction; local attackers cannot
* read the secret out of the plugin process's memory.
*
* @module dsh-workbuddy-connect/shim
*/
const REQUEST_BODY_LIMIT = 67108864;
/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	soft_rate: 429,
	session_dead: 401,
	not_found: 502,
	server: 502,
	client: 400
};
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
function writeOpenAIError(res, status, kind, message) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: kind
	} });
}
/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody$3(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Start the loopback endpoint. Requests carry any bearer; the loopback bind
* is the boundary, and the upstream credential comes from the store alone.
*/
function createWorkBuddyShim(options) {
	const { store, client, catalog, pool } = options;
	const logger = options.logger;
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/** Constant-time bearer check; absent or mismatched bearers are rejected. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const presented = match[1];
		const expected = SHARED_SECRET;
		const a = Buffer.from(presented);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", () => resolve());
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch (error) {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
			else res.end();
		}
	}
	async function chatCompletions(req, res) {
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		let credential;
		try {
			credential = pool === void 0 ? await store.resolve() : await pool.select();
		} catch (error) {
			writeOpenAIError(res, 401, "not_signed_in", String(error));
			return;
		}
		const raw = (await readBody$3(req)).toString("utf8");
		const prepared = prepareChatBody(raw);
		const controller = new AbortController();
		req.on("close", () => controller.abort());
		const result = await client.chatStream(credential, prepared, controller.signal);
		if (pool !== void 0) try {
			const accountId = accountIdOf(credential);
			if (result.ok) pool.record(accountId, "ok", "");
			else {
				const classified = outcomeOfFailure(result.status, result.message);
				pool.record(accountId, classified.outcome, classified.message, classified.retryAtMs);
			}
		} catch {}
		if (!result.ok) {
			const detail = extractDisplayErrorMessage(result.message) ?? result.message.slice(0, 400);
			const statusNote = (result.status === 401 || result.status === 403) && result.kind !== "session_dead" ? "" : ` (http ${result.status})`;
			writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, `workbuddy upstream ${result.kind}${statusNote}: ${detail}`);
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no"
		});
		let sawDone = false;
		const body = Readable.fromWeb(result.response.body);
		body.on("data", (chunk) => {
			if (chunk.includes("[DONE]")) sawDone = true;
		});
		body.on("error", (error) => {
			logger?.warn("dsh-workbuddy-connect: upstream stream failed mid-flight", error);
			if (!sawDone && res.writable) res.end("data: [DONE]\n\n");
		});
		body.pipe(res);
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve, reject) => {
			server.close(() => resolve());
			server.closeAllConnections();
			server.once("error", reject);
		})
	};
}
//#endregion
//#region src/probe-store.ts
/**
* Local record of reasoning-effort probes.
*
* What this stores is an *observation*, never a claim about the upstream: a
* model's row is only consulted when the catalog carries no explicit
* `supportedEfforts` set, and it always loses to a declared set. The plan this
* implements (`docs/reasoning-effort-probe-plan.md` §5) requires that a result
* is invalidated whenever the model's catalog row changes, so every record
* carries a fingerprint of the fields the probe depended on.
*
* The file lives beside the plugin's own credential copy under `$DSH_HOME`,
* never in the desktop app's files, and carries no token, prompt, or response
* body — only model ids, effort spellings, and timestamps.
*
* @module dsh-workbuddy-connect/probe-store
*/
/** Basename of the probe record inside the Harness home. */
const WORKBUDDY_PROBE_FILENAME = ".workbuddy-probe.json";
/**
* On-disk format this reader accepts; other versions are discarded.
*
* Version 2 nested the records under the account that produced them
* (`records[account][modelId]`), so two accounts no longer overwrite each
* other's observations for the same model. Version 1 files (flat, one record
* per model) are deliberately not migrated: they read as empty and the
* affected models are re-probed on demand, which keeps the reader free of
* half-understood compatibility paths.
*/
const PROBE_FORMAT_VERSION = 2;
/**
* How long an observation stays usable. Conservative on purpose: the plan's
* whole argument is that upstream metadata moves fast, so a result that has
* outlived its fingerprint's usefulness should not quietly keep granting a
* picker entry.
*/
const DEFAULT_TTL_MS = 12096e5;
/**
* Plugin-owned probe record path inside the Harness home.
*
* One file per variant. Same-named models exist on both endpoints (the
* international catalog repeats `glm-5.3`, `glm-5.2`, `hy3`, `kimi-k2.6`), and
* {@link fingerprintModel} covers only `id`/`reasoning`/`supportsImages` —
* never the provider — so a single shared file would let one variant's
* observation answer for the other. The paths differ; the format does not.
*/
function workbuddyProbePath(filename = WORKBUDDY_PROBE_FILENAME) {
	return join(resolveDshHome(), filename);
}
/**
* Fingerprint the catalog fields a probe depends on.
*
* Deliberately excludes display-only fields (`name`, `billing`, `contextWindow`)
* so a rename or a promo badge does not throw away a valid observation, and
* deliberately includes the whole reasoning object so any change to the
* declared shape re-probes.
*/
function fingerprintModel(info) {
	const basis = JSON.stringify({
		id: info.id,
		reasoning: info.reasoning ?? null,
		supportsImages: info.supportsImages ?? null
	});
	return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
/** Read-and-validate the documents on disk; anything malformed reads as empty. */
function readDocument(path) {
	if (!existsSync(path)) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const wrapped = parsed;
	if (wrapped["version"] !== PROBE_FORMAT_VERSION) return void 0;
	const records = wrapped["records"];
	if (typeof records !== "object" || records === null || Array.isArray(records)) return void 0;
	return parsed;
}
/** One record's shape check; a bad row is dropped rather than trusted. */
function isRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const wrapped = value;
	const validation = wrapped["validation"];
	if (validation !== "validating" && validation !== "non-validating" && validation !== "unknown") return false;
	if (typeof wrapped["fingerprint"] !== "string") return false;
	if (typeof wrapped["probedAtMs"] !== "number" || !Number.isFinite(wrapped["probedAtMs"])) return false;
	if (typeof wrapped["pluginVersion"] !== "string") return false;
	if (typeof wrapped["account"] !== "string" || wrapped["account"] === "") return false;
	const efforts = wrapped["efforts"];
	if (!Array.isArray(efforts) || efforts.some((effort) => typeof effort !== "string")) return false;
	return true;
}
/**
* The plugin's probe records: read once, written atomically, keyed by the
* account that produced each observation, and never trusted across a
* fingerprint change or past the TTL.
*/
var WorkBuddyProbeStore = class {
	path;
	ttlMs;
	pluginVersion;
	now;
	records;
	constructor(options) {
		const opts = typeof options === "string" ? {
			path: options,
			pluginVersion: "0.0.0"
		} : options;
		this.path = opts.path ?? workbuddyProbePath();
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.pluginVersion = opts.pluginVersion;
		this.now = opts.now ?? (() => Date.now());
	}
	/** Resolved state-file path, for the CLI and tests. */
	filePath() {
		return this.path;
	}
	load() {
		if (this.records === void 0) {
			const document = readDocument(this.path);
			const records = {};
			for (const [account, bucket] of Object.entries(document?.records ?? {})) {
				if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) continue;
				const parsed = {};
				for (const [modelId, record] of Object.entries(bucket)) if (isRecord(record)) parsed[modelId] = record;
				records[account] = parsed;
			}
			this.records = records;
		}
		return this.records;
	}
	/**
	* The usable record for one account and model, or `undefined` when there is
	* none, it is expired, it was taken against a different catalog row, or it
	* belongs to a different account.
	*
	* @param account - the account in effect, as `uid:enterpriseId`. Records are
	*   only returned for the account that produced them.
	*/
	get(modelId, fingerprint, account) {
		const record = this.load()[account]?.[modelId];
		if (record === void 0) return void 0;
		if (record.fingerprint !== fingerprint) return void 0;
		if (record.account !== account) return void 0;
		if (this.now() - record.probedAtMs > this.ttlMs) return void 0;
		return record;
	}
	/**
	* Store one observation under the account stamped on it. Only a decisive
	* answer (`validating` / `non-validating`) replaces an existing decisive
	* record *of the same account*: a transient `unknown` must not erase
	* knowledge the user already paid for.
	*/
	set(modelId, record) {
		const records = this.load();
		const bucket = records[record.account] ?? (records[record.account] = {});
		const existing = bucket[modelId];
		if (record.validation === "unknown" && existing !== void 0 && existing.fingerprint === record.fingerprint && existing.validation !== "unknown") return;
		bucket[modelId] = record;
		this.persist();
	}
	/** Drop every record of every account; used by the card's explicit "clear" action. */
	clear() {
		this.records = {};
		this.persist();
	}
	/** Every record currently held, grouped by account, for status display. */
	all() {
		const records = this.load();
		return Object.fromEntries(Object.entries(records).map(([account, bucket]) => [account, { ...bucket }]));
	}
	/** Build a record stamped with this store's clock, version, and account. */
	record(fingerprint, validation, efforts, account) {
		return {
			fingerprint,
			validation,
			efforts: validation === "validating" ? [...efforts] : [],
			probedAtMs: this.now(),
			pluginVersion: this.pluginVersion,
			account
		};
	}
	/**
	* Write through a temporary file and rename, so a crash mid-write cannot
	* leave a half-parsed document that reads as "no records" and silently drops
	* every observation.
	*/
	persist() {
		const directory = dirname(this.path);
		try {
			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			const document = {
				version: PROBE_FORMAT_VERSION,
				records: this.load()
			};
			const temporary = resolve(`${this.path}.tmp`);
			writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 384 });
			renameSync(temporary, this.path);
		} catch {}
	}
};
/**
* Order observations newest-first for display.
*
* The store keeps insertion order so the file reads chronologically, but the
* card wants the most recent detection at the top: a sweep the user just ran
* should not appear below every earlier one, which is what appending to an
* insertion-ordered list does.
*/
function newestFirst(records) {
	return [...records].sort((a, b) => b.probedAt - a.probedAt);
}
//#endregion
//#region src/probe-service.ts
/**
* Serial probe runner. One instance is shared by the manual API and any
* future automatic trigger, so the two can never overlap.
*/
var WorkBuddyProbeService = class {
	options;
	queue = Promise.resolve();
	pending = /* @__PURE__ */ new Map();
	running = false;
	constructor(options) {
		this.options = options;
	}
	/** Whether a sweep is in flight right now. */
	isRunning() {
		return this.running;
	}
	/**
	* The record the adapter may use for this model, or `undefined`.
	*
	* Applies the plan's precedence (§5): a declared set always wins, so a model
	* that declares `supportedEfforts` is never answered from an observation.
	*/
	recordFor(modelId) {
		const info = this.options.catalog.current().find((model) => model.id === modelId);
		if (info === void 0) return void 0;
		if (info.reasoning?.supportedEfforts !== void 0 && info.reasoning.supportedEfforts.length > 0) return;
		const account = this.options.account();
		if (account === void 0) return void 0;
		return this.options.store.get(modelId, fingerprintModel(info), account);
	}
	/**
	* Probe one model, serially.
	*
	* The authenticated manual route supplies one-request consent after UI
	* confirmation. Other callers must pass the configured consent gate.
	* Manual consent never changes the automatic-probing configuration.
	* Explicit requests bypass historical results, but share an ongoing run.
	*/
	async probe(modelId, manualConsent = false) {
		if (!manualConsent && !this.options.consent()) return {
			state: "unavailable",
			reason: "probing is not authorized"
		};
		if (this.options.catalog.current().find((model) => model.id === modelId) === void 0) return {
			state: "unavailable",
			reason: `unknown model: ${modelId}`
		};
		const account = this.options.account();
		if (account === void 0) return {
			state: "unavailable",
			reason: "no WorkBuddy credential"
		};
		const pendingKey = JSON.stringify([account, modelId]);
		const pending = this.pending.get(pendingKey);
		if (pending !== void 0) return pending;
		const run = this.queue.then(async () => {
			const current = this.options.catalog.current().find((model) => model.id === modelId);
			if (current === void 0) return {
				state: "unavailable",
				reason: `unknown model: ${modelId}`
			};
			if (!manualConsent && !this.options.consent()) return {
				state: "unavailable",
				reason: "probing is not authorized"
			};
			if (current.reasoning?.supports !== true || (current.reasoning.supportedEfforts?.length ?? 0) > 0) return {
				state: "unavailable",
				reason: "model does not need detection"
			};
			const cached = this.recordFor(modelId);
			if (!manualConsent && cached !== void 0 && cached.validation !== "unknown") return {
				state: "ok",
				validation: cached.validation,
				efforts: cached.efforts,
				requests: 0
			};
			if (this.options.account() !== account) return {
				state: "unavailable",
				reason: "account changed before detection"
			};
			const credential = await this.options.credentials.current();
			if (credential === void 0) return {
				state: "unavailable",
				reason: "no WorkBuddy credential"
			};
			const send = this.options.send === void 0 ? (effort, signal) => this.options.client.probeEffort(credential, modelId, effort, signal) : this.options.send(modelId);
			this.running = true;
			try {
				const outcome = await probeModel({
					send,
					region: this.options.region,
					...this.options.sentinel === void 0 ? {} : { sentinel: this.options.sentinel }
				});
				if (this.options.account() !== account) return {
					state: "unavailable",
					reason: "account changed during detection"
				};
				const record = this.options.store.record(fingerprintModel(current), outcome.validation, outcome.efforts, account);
				this.options.store.set(modelId, record);
				if (outcome.validation === "unknown") return {
					state: "unavailable",
					reason: outcome.reason
				};
				return {
					state: "ok",
					validation: outcome.validation,
					efforts: record.efforts,
					requests: outcome.requests
				};
			} finally {
				this.running = false;
			}
		});
		this.queue = run.catch(() => void 0);
		this.pending.set(pendingKey, run);
		try {
			return await run;
		} finally {
			this.pending.delete(pendingKey);
		}
	}
};
//#endregion
//#region src/web-status.ts
/** Redact token-like content before it crosses to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 500);
}
function json$4(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* The request must be addressed to this deployment (loopback, or an authority
* the host declared trusted), and a browser-attached Origin must be same-origin
* with it. The Host check drops DNS-rebinding pages (their Host is the
* attacker's domain, which is neither); the card's same-origin fetches carry no
* Origin and pass on Host alone.
*/
function trustedRequest(req, trustedHosts) {
	return requestIsTrusted(req.headers.host, req.headers.origin, trustedHosts);
}
/**
* Assemble the card's status document. Sign-in state is read-only; credit is
* a live billing answer whose failure degrades to `creditsError` rather than
* failing the whole document.
*/
async function workBuddyWebStatus(deps) {
	const authStatus = await deps.store.status();
	if (authStatus.state !== "signed-in") return {
		status: "signed-out",
		...authStatus.reason === void 0 ? {} : { reason: authStatus.reason },
		...authStatus.reasonCode === void 0 ? {} : { reasonCode: authStatus.reasonCode }
	};
	const status = {
		status: "signed-in",
		...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
		...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
		...authStatus.source === void 0 ? {} : { source: authStatus.source },
		...authStatus.expiresAtMs === void 0 ? {} : { expiresAt: authStatus.expiresAtMs }
	};
	const modelsField = deps.models().map((model) => {
		const rate = normalizeCredits(model.billing?.credits);
		const supported = model.supportedContextWindows ?? [];
		const maxContextWindow = supported.length > 0 ? Math.max(...supported) : void 0;
		const defaultContextWindow = model.defaultContextWindow ?? model.contextWindow;
		return {
			id: model.id,
			name: model.name,
			...model.billing?.free === true ? { free: true } : {},
			...model.billing?.badges !== void 0 && model.billing.badges.length > 0 ? { badges: model.billing.badges } : {},
			...rate === void 0 ? {} : { credits: rate },
			...model.billing?.rateUnknown === true ? { rateUnknown: true } : {},
			...typeof model.contextWindow === "number" && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {},
			...typeof defaultContextWindow === "number" && defaultContextWindow > 0 && defaultContextWindow < model.contextWindow ? { defaultContextWindow } : {},
			...maxContextWindow === void 0 || maxContextWindow <= defaultContextWindow ? {} : { maxContextWindow },
			...typeof model.maxInputTokens === "number" && model.maxInputTokens > 0 ? { maxInputTokens: model.maxInputTokens } : {}
		};
	});
	const catalog = deps.catalog?.();
	const withCatalog = catalog === void 0 ? status : {
		...status,
		catalog
	};
	const visibility = deps.visibility?.();
	const withVisibility = visibility === void 0 ? withCatalog : {
		...withCatalog,
		visibility
	};
	const statusWithModels = modelsField.length > 0 ? {
		...withVisibility,
		models: modelsField
	} : withVisibility;
	let probed = statusWithModels;
	if (deps.probe !== void 0) {
		const maximumContextWindow = deps.useMaximumContextWindow?.();
		probed = {
			...statusWithModels,
			probe: deps.probe(),
			...deps.probeKey === void 0 ? {} : { probeKey: deps.probeKey },
			...maximumContextWindow === void 0 ? {} : { useMaximumContextWindow: maximumContextWindow }
		};
	}
	try {
		const credential = await deps.store.current();
		if (credential !== void 0) {
			const credits = await deps.client.fetchCredits(credential);
			return {
				...probed,
				credits
			};
		}
	} catch (error) {
		return {
			...probed,
			creditsError: safeMessage(error)
		};
	}
	return probed;
}
/** The status route's request handler, extracted so tests can mount it on a bare server. */
function workBuddyStatusHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json$4(res, 405, { error: "method not allowed" });
			return;
		}
		if (!trustedRequest(req, deps.trustedHosts)) {
			json$4(res, 403, { error: "request-not-trusted" });
			return;
		}
		try {
			json$4(res, 200, await workBuddyWebStatus(deps));
		} catch (error) {
			json$4(res, 500, { error: safeMessage(error) });
		}
	};
}
/** Mount the GET status route on an optional webServer context. */
function registerWorkBuddyStatusRoute(ctx, deps) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/status";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyStatusHandler(deps)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: Web status route");
}
//#endregion
//#region src/update.ts
/**
* Public update metadata and bounded version checking for WorkBuddy Connect.
*
* Two upstreams, strictly layered so the judgement never depends on the
* enrichment: npm's dist-tags decide whether a newer release exists, and only
* then is GitHub's release list consulted — one request that feeds both the
* "versions behind" count and the per-release notes. Every upstream answer is
* treated as untrusted input: bodies are size-capped while streaming, releases
* are re-validated on the browser side by {@link parseWorkBuddyUpdateResult}
* before anything renders.
*
* This module is host/browser shared and dependency-free by design (the client
* bundle's runtime imports stay React + local modules only).
*
* @module dsh-workbuddy-connect/update
*/
const WORKBUDDY_REPOSITORY_URL = "https://github.com/corrinehu/dsh-workbuddy-connect";
const WORKBUDDY_UPDATE_NPM_METADATA_URL = `https://registry.npmjs.org/-/package/dsh-workbuddy-connect/dist-tags`;
const WORKBUDDY_UPDATE_RELEASES_API_URL = `${WORKBUDDY_REPOSITORY_URL.replace("https://github.com", "https://api.github.com/repos")}/releases?per_page=100`;
const WORKBUDDY_RELEASE_PAGE_BASE = `${WORKBUDDY_REPOSITORY_URL}/releases/tag/`;
const WORKBUDDY_UPDATE_MAX_METADATA_BYTES = 65536;
const WORKBUDDY_UPDATE_MAX_RELEASES_BYTES = 1048576;
/** GitHub caps one page at 100 releases; ours is far below that today. */
const RELEASES_LIST_MAX = 100;
const RELEASE_NAME_MAX_CHARS = 200;
const RELEASE_NOTES_MAX_CHARS = 16e3;
/** Parse one exact SemVer version, accepting the conventional leading `v`. */
function parseWorkBuddyVersion(raw) {
	if (typeof raw !== "string") return void 0;
	const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(normalized);
	if (match === null) return void 0;
	const rawPrerelease = match[4] === void 0 ? [] : match[4].split(".");
	if (rawPrerelease.some((identifier) => /^\d+$/u.test(identifier) && !/^(0|[1-9]\d*)$/u.test(identifier))) return void 0;
	const prerelease = rawPrerelease.map((identifier) => /^(0|[1-9]\d*)$/u.test(identifier) ? Number(identifier) : identifier);
	if (prerelease.some((identifier) => typeof identifier === "number" && !Number.isSafeInteger(identifier))) return void 0;
	const parsed = {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease
	};
	return [
		parsed.major,
		parsed.minor,
		parsed.patch
	].every(Number.isSafeInteger) ? parsed : void 0;
}
/**
* One canonical spelling per SemVer value: leading `v` and build metadata
* fold away, so `v0.6.4`, `0.6.4`, and `0.6.4+build` dedupe as one release.
* Returns `undefined` for unparseable input; callers drop those first.
*/
function canonicalWorkBuddyVersion(version) {
	const parsed = parseWorkBuddyVersion(version);
	if (parsed === void 0) return void 0;
	return `${String(parsed.major)}.${String(parsed.minor)}.${String(parsed.patch)}` + (parsed.prerelease.length === 0 ? "" : `-${parsed.prerelease.join(".")}`);
}
function compareIdentifiers(left, right) {
	if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
	if (typeof left === "number") return -1;
	if (typeof right === "number") return 1;
	return left < right ? -1 : left > right ? 1 : 0;
}
/** Compare two versions using SemVer precedence (build metadata ignored). */
function compareWorkBuddyVersions(left, right) {
	const a = parseWorkBuddyVersion(left);
	const b = parseWorkBuddyVersion(right);
	if (a === void 0 || b === void 0) throw new TypeError("invalid WorkBuddy Connect version");
	for (const [aPart, bPart] of [
		[a.major, b.major],
		[a.minor, b.minor],
		[a.patch, b.patch]
	]) if (aPart !== bPart) return aPart < bPart ? -1 : 1;
	if (a.prerelease.length === 0 && b.prerelease.length !== 0) return 1;
	if (a.prerelease.length !== 0 && b.prerelease.length === 0) return -1;
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
		const aPart = a.prerelease[index];
		const bPart = b.prerelease[index];
		if (aPart === void 0) return -1;
		if (bPart === void 0) return 1;
		const comparison = compareIdentifiers(aPart, bPart);
		if (comparison !== 0) return comparison;
	}
	return 0;
}
function boundedText(value, maxBytes) {
	if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError("update response is too large");
	return value;
}
async function readBoundedText(response, maxBytes) {
	if (response.body === null) return boundedText(await response.text(), maxBytes);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new RangeError("update response is too large");
			}
			chunks.push(decoder.decode(next.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}
async function fetchBounded(fetchImpl, url, maxBytes, timeoutMs, headers) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(/* @__PURE__ */ new Error("update request timed out"));
	}, timeoutMs);
	try {
		const response = await fetchImpl(url, {
			headers,
			signal: controller.signal
		});
		return {
			response,
			text: await readBoundedText(response, maxBytes)
		};
	} finally {
		clearTimeout(timer);
	}
}
/** Strip control characters, normalize newlines, and cap the length. */
function cleanReleaseText(value, maxLength) {
	if (typeof value !== "string" || value.length === 0) return void 0;
	const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").replace(/\r\n?/gu, "\n").trim().slice(0, maxLength);
	return clean.length === 0 ? void 0 : clean;
}
function cleanPublishedAt(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/iu.test(value) ? value.slice(0, 64) : void 0;
}
/**
* The `latest` dist-tag only. Pre-release channels are not this plugin's
* release line, so recommending one would be wrong even when newer.
*/
function latestDistTag(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const tags = value["dist-tags"] ?? value;
	if (typeof tags !== "object" || tags === null || Array.isArray(tags)) return void 0;
	const candidate = tags["latest"];
	return typeof candidate === "string" && parseWorkBuddyVersion(candidate) !== void 0 ? candidate : void 0;
}
function releasePageUrl(version) {
	return `${WORKBUDDY_RELEASE_PAGE_BASE}v${version}`;
}
/**
* Parse GitHub's release-list page into the in-range releases, newest first.
* Unknown entry shapes are skipped, never fatal: the count and the notes both
* degrade per-entry rather than dropping the whole judgement.
*/
function releasesInRange(currentVersion, latestVersion, value) {
	if (!Array.isArray(value) || value.length > RELEASES_LIST_MAX) return void 0;
	const releases = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
		const entry = raw;
		const tag = entry["tag_name"];
		if (typeof tag !== "string") continue;
		if (parseWorkBuddyVersion(tag) === void 0) continue;
		if (compareWorkBuddyVersions(tag, currentVersion) <= 0 || compareWorkBuddyVersions(tag, latestVersion) > 0) continue;
		const canonical = canonicalWorkBuddyVersion(tag);
		if (canonical === void 0 || seen.has(canonical)) continue;
		seen.add(canonical);
		const name = cleanReleaseText(entry["name"], RELEASE_NAME_MAX_CHARS);
		const notes = cleanReleaseText(entry["body"], RELEASE_NOTES_MAX_CHARS);
		const publishedAt = cleanPublishedAt(entry["published_at"]);
		releases.push({
			version: tag,
			...name === void 0 ? {} : { name },
			...notes === void 0 ? {} : { notes },
			...publishedAt === void 0 ? {} : { publishedAt }
		});
	}
	releases.sort((left, right) => compareWorkBuddyVersions(right.version, left.version));
	return releases;
}
/** Enrich an available update from GitHub's release list; degrade on failure. */
async function releaseList(currentVersion, latestVersion, fetchImpl, timeoutMs) {
	try {
		const { response, text } = await fetchBounded(fetchImpl, WORKBUDDY_UPDATE_RELEASES_API_URL, WORKBUDDY_UPDATE_MAX_RELEASES_BYTES, timeoutMs, { accept: "application/vnd.github+json" });
		if (!response.ok) return void 0;
		return releasesInRange(currentVersion, latestVersion, JSON.parse(text));
	} catch {
		return;
	}
}
/** Check npm's public dist-tags and enrich an available update with release notes. */
async function checkWorkBuddyUpdate(options) {
	const { currentVersion } = options;
	if (parseWorkBuddyVersion(currentVersion) === void 0) return {
		status: "unavailable",
		currentVersion,
		reason: "invalid-current-version"
	};
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 8e3;
	let metadata;
	try {
		const { response, text } = await fetchBounded(fetchImpl, WORKBUDDY_UPDATE_NPM_METADATA_URL, WORKBUDDY_UPDATE_MAX_METADATA_BYTES, timeoutMs, { accept: "application/json" });
		if (!response.ok) return {
			status: "unavailable",
			currentVersion,
			reason: "registry-unavailable"
		};
		metadata = JSON.parse(text);
	} catch (error) {
		return {
			status: "unavailable",
			currentVersion,
			reason: error instanceof SyntaxError || error instanceof RangeError ? "invalid-registry-response" : "registry-unavailable"
		};
	}
	const latestVersion = latestDistTag(metadata);
	if (latestVersion === void 0) return {
		status: "unavailable",
		currentVersion,
		reason: "invalid-registry-response"
	};
	if (compareWorkBuddyVersions(latestVersion, currentVersion) <= 0) return {
		status: "up-to-date",
		currentVersion,
		latestVersion: currentVersion
	};
	const releases = await releaseList(currentVersion, latestVersion, fetchImpl, timeoutMs);
	return {
		status: "update-available",
		currentVersion,
		latestVersion,
		releaseUrl: releasePageUrl(latestVersion),
		releases: releases ?? [],
		...releases === void 0 ? {} : { versionsBehind: releases.length }
	};
}
//#endregion
//#region src/update-route.ts
function json$3(res, status, value) {
	const payload = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff"
	});
	res.end(payload);
}
/** The same deployment-trust gate the status route uses: a rebound page dies here. */
function browserRequestAllowed$2(req, trustedHosts) {
	return requestIsTrusted(req.headers.host, req.headers.origin, trustedHosts);
}
/** Build the route handler; the caller owns registration and disposal. */
function workBuddyUpdateHandler(options) {
	return async (req, res) => {
		if (req.method !== "GET") {
			json$3(res, 405, { error: "method not allowed" });
			return;
		}
		if (!browserRequestAllowed$2(req, options.trustedHosts)) {
			json$3(res, 403, { error: "forbidden" });
			return;
		}
		let result;
		try {
			result = await checkWorkBuddyUpdate({
				currentVersion: options.currentVersion,
				...options.fetchImpl === void 0 ? {} : { fetchImpl: options.fetchImpl },
				timeoutMs: options.timeoutMs ?? 8e3
			});
		} catch {
			result = {
				status: "unavailable",
				currentVersion: options.currentVersion,
				reason: "registry-unavailable"
			};
		}
		json$3(res, 200, result);
	};
}
/** Register the update route on the optional host web server. */
function registerWorkBuddyUpdateRoute(ctx, options) {
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_UPDATE_PATH,
			handler: workBuddyUpdateHandler(options)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: update route");
}
//#endregion
//#region src/probe-route.ts
/**
* Probe control route: the only state-changing endpoint the plugin exposes.
*
* Two guards, because they stop different things (see `docs/reasoning-effort-probe-plan.md`
* §6.4 and the v0.3.1 note in AGENTS.md about their exact scope):
*
* 1. **Loopback Host + Origin**, shared with the status route. This drops
*    DNS-rebinding pages, whose requests arrive addressed to the attacker's
*    domain.
* 2. **An in-process random key**, minted per process and handed only to the
*    same-origin card. Loopback alone is *not* authentication — any local
*    process can write `Host: 127.0.0.1` — so a route that spends the user's
*    credit must prove the caller was told the key.
*
* A probe request is never accepted with a prompt, a model id outside the
* live catalog, or a sentinel from the browser: it is assembled entirely
* host-side. (Scope: the `probe` action only — `set-model-visibility`
* deliberately accepts a model id the current catalog no longer lists, since
* a hidden id is kept for when the model returns.)
*
* @module dsh-workbuddy-connect/probe-route
*/
/** Largest control body accepted; these payloads are a few dozen bytes. */
const MAX_BODY_BYTES$1 = 4096;
/** Mint the per-process control key. */
function createProbeKey() {
	return randomBytes(24).toString("hex");
}
/**
* Constant-time key comparison; a length mismatch is a failure, not a crash.
*/
function keyMatches$1(expected, presented) {
	if (presented === void 0 || presented.length !== expected.length) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(presented);
	return a.length === b.length && timingSafeEqual(a, b);
}
function json$2(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Read the request body with a hard ceiling. */
async function readBody$2(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES$1) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** Parse and shape-check an action; unknown fields are ignored, not trusted. */
function parseAction(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const wrapped = parsed;
	const action = wrapped["action"];
	if (action === "clear") return { action: "clear" };
	if (action === "refresh") return { action: "refresh" };
	if (action === "set-maximum-context-window") return typeof wrapped["enabled"] === "boolean" ? {
		action: "set-maximum-context-window",
		enabled: wrapped["enabled"]
	} : void 0;
	if (action === "set-model-visibility") {
		const model = wrapped["model"];
		const account = wrapped["account"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		if (typeof wrapped["visible"] !== "boolean") return void 0;
		if (typeof account !== "string" || account === "") return void 0;
		return {
			action: "set-model-visibility",
			model: model.trim(),
			visible: wrapped["visible"],
			account
		};
	}
	if (action === "probe") {
		const model = wrapped["model"];
		if (typeof model !== "string" || model.trim() === "") return void 0;
		return {
			action: "probe",
			model: model.trim()
		};
	}
}
/**
* The control route's handler, extracted so tests can mount it on a bare
* server with a known key.
*/
function workBuddyProbeHandler(deps, key) {
	return async (req, res) => {
		if (req.method !== "POST") {
			json$2(res, 405, { error: "method not allowed" });
			return;
		}
		if (!requestIsTrusted(req.headers.host, req.headers.origin, deps.trustedHosts)) {
			json$2(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (!keyMatches$1(key, req.headers["x-workbuddy-probe-key"])) {
			json$2(res, 403, { error: "invalid-probe-key" });
			return;
		}
		const body = await readBody$2(req);
		if (body === void 0) {
			json$2(res, 413, { error: "body too large" });
			return;
		}
		const action = parseAction(body);
		if (action === void 0) {
			json$2(res, 400, { error: "invalid action" });
			return;
		}
		try {
			if (action.action === "clear") {
				deps.clear();
				json$2(res, 200, { state: "cleared" });
				return;
			}
			if (action.action === "refresh") {
				if (deps.refresh === void 0) {
					json$2(res, 404, { error: "refresh-not-supported" });
					return;
				}
				json$2(res, 200, await deps.refresh());
				return;
			}
			if (action.action === "set-maximum-context-window") {
				if (deps.setMaximumContextWindow === void 0) {
					json$2(res, 404, { error: "context-window-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setMaximumContextWindow(action.enabled === true));
				return;
			}
			if (action.action === "set-model-visibility") {
				if (deps.setModelVisibility === void 0) {
					json$2(res, 404, { error: "visibility-setting-not-supported" });
					return;
				}
				json$2(res, 200, await deps.setModelVisibility(action.model, action.visible === true, action.account));
				return;
			}
			json$2(res, 200, await deps.probe(action.model));
		} catch (error) {
			json$2(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
/** Mount the POST probe-control route on an optional webServer context. */
function registerWorkBuddyProbeRoute(ctx, deps, key) {
	const path = deps.path ?? "/plugins/dsh-workbuddy-connect/probe";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyProbeHandler(deps, key)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: probe control route");
}
//#endregion
//#region src/legacy-settings.ts
/**
* Narrow one host settings service to the legacy section API, or `undefined`
* when this host's generation does not carry it.
*
* Both members are required: a service with only `installSection` would let
* this plugin install a section whose edits it could never persist, and the
* maximum-context preference is written through `update`. A host that ships
* neither is reported as `undefined` so the caller degrades in one place.
*
* @param settings - the host settings service, whose shape is generation-dependent.
* @returns the legacy API when present, otherwise `undefined`.
*/
function legacySettingsOf(settings) {
	if (typeof settings !== "object" || settings === null) return void 0;
	const candidate = settings;
	if (typeof candidate.installSection !== "function") return void 0;
	if (typeof candidate.update !== "function") return void 0;
	return settings;
}
//#endregion
//#region src/search.ts
/** The CN host that answers `/agenttool/v1/search`. */
const CN_SEARCH_BASE = "https://www.codebuddy.cn";
/** The international host that answers `/agenttool/v1/search`. */
const GLOBAL_SEARCH_BASE = "https://www.workbuddy.ai";
/** Path of the search endpoint, appended to the region's base. */
const SEARCH_PATH = "/agenttool/v1/search";
/**
* The `freshness` grammar the endpoint accepts: `dN` days, `mN` months,
* `yN` years, each with the count optional (`d` = today).
*/
const FRESHNESS_PATTERN = /^(?:d(?:[1-9]|[12]\d|30)?|m(?:[1-9]|1[0-2])?|y[1-5]?)$/u;
/** Resolve the region-appropriate search host for a credential. */
function searchBase(credential) {
	return regionOf(credential.domain) === "global" ? GLOBAL_SEARCH_BASE : CN_SEARCH_BASE;
}
/**
* Fold blocked domains into the query text.
*
* The endpoint accepts only `query`, `type`, `max_results`, `allowed_domains`,
* and `freshness`; there is no negative-domain field, so the client's own
* convention — parenthesized `-site:` terms appended to the query — is what
* carries the intent.
*/
function applyBlockedDomains(query, blockedDomains) {
	const terms = (blockedDomains ?? []).filter((domain) => domain !== "").map((domain) => `-site:${domain}`);
	return terms.length === 0 ? query : `${query} (${terms.join(" ")})`;
}
/** Whether a value is acceptable for the `freshness` field. */
function isValidFreshness(value) {
	return FRESHNESS_PATTERN.test(value);
}
/** Headers for a search request, mirroring the client's own tool call. */
function searchHeaders(credential) {
	return {
		"Accept": "application/json",
		"Content-Type": "application/json;charset=UTF-8",
		"X-Requested-With": "XMLHttpRequest",
		"Authorization": `Bearer ${credential.accessToken}`,
		...credential.uid === "" ? {} : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? {} : {
			"X-Enterprise-Id": credential.enterpriseId,
			"X-Tenant-Id": credential.enterpriseId
		},
		...credential.domain === "" ? {} : { "X-Domain": credential.domain }
	};
}
/**
* Run one search against the WorkBuddy endpoint.
*
* Never throws for an upstream or transport failure: the failure is returned as
* `{ ok: false }` so a tool call can report it as tool output rather than
* turning the whole conversation turn into an error.
*/
async function searchWorkBuddy(credential, options) {
	const query = options.query.trim();
	if (query === "") return {
		ok: false,
		status: 0,
		message: "search query is empty"
	};
	if (options.freshness !== void 0 && !isValidFreshness(options.freshness)) return {
		ok: false,
		status: 0,
		message: `invalid freshness: ${options.freshness}`
	};
	const body = {
		query: applyBlockedDomains(query, options.blockedDomains),
		type: "text2text",
		max_results: Math.max(1, Math.min(options.maxResults ?? 8, 50))
	};
	if (options.allowedDomains !== void 0 && options.allowedDomains.length > 0) body["allowed_domains"] = [...options.allowedDomains];
	if (options.freshness !== void 0) body["freshness"] = options.freshness;
	let response;
	try {
		response = await fetch(`${searchBase(credential)}${SEARCH_PATH}`, {
			method: "POST",
			headers: searchHeaders(credential),
			body: JSON.stringify(body),
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
	} catch (error) {
		return {
			ok: false,
			status: 0,
			message: `transport error: ${String(error)}`
		};
	}
	if (!response.ok) {
		let detail = "";
		try {
			detail = (await response.text()).slice(0, 300);
		} catch {}
		return {
			ok: false,
			status: response.status,
			message: `HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`
		};
	}
	let payload;
	try {
		payload = await response.json();
	} catch (error) {
		return {
			ok: false,
			status: response.status,
			message: `unreadable response body: ${String(error)}`
		};
	}
	if (typeof payload !== "object" || payload === null) return {
		ok: false,
		status: response.status,
		message: "unexpected response shape"
	};
	const record = payload;
	const code = record["code"];
	if (typeof code === "number" && code !== 0) {
		const message = typeof record["msg"] === "string" ? record["msg"] : "unknown error";
		return {
			ok: false,
			status: response.status,
			message: `code=${code}: ${message}`
		};
	}
	const results = [];
	const raw = record["results"];
	if (Array.isArray(raw)) for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const row = item;
		const url = typeof row["url"] === "string" ? row["url"].trim() : "";
		if (url === "") continue;
		results.push({
			url,
			title: typeof row["title"] === "string" ? row["title"] : "",
			snippet: typeof row["snippet"] === "string" ? row["snippet"] : ""
		});
	}
	const total = record["total_results"];
	const elapsed = record["response_time_ms"];
	return {
		ok: true,
		query,
		results,
		totalResults: typeof total === "number" ? total : results.length,
		...typeof elapsed === "number" ? { elapsedMs: elapsed } : {}
	};
}
/** Render one outcome as the text a model reads. */
function formatSearchOutcome(outcome) {
	if (outcome.results.length === 0) return `No results found for “${outcome.query}”.`;
	const lines = [`Search “${outcome.query}” — ${outcome.totalResults} result(s):`, ""];
	outcome.results.forEach((result, index) => {
		lines.push(`${index + 1}. ${result.title === "" ? "(untitled)" : result.title}`);
		lines.push(`   ${result.url}`);
		if (result.snippet !== "") lines.push(`   ${result.snippet}`);
		lines.push("");
	});
	return lines.join("\n").trimEnd();
}
//#endregion
//#region src/search-tool.ts
/** Wire name of the tool, namespaced so it never shadows DSH's own `web_search`. */
const WORKBUDDY_SEARCH_TOOL = "workbuddy_search";
/** Hard cap on queries merged into one call. */
const MAX_QUERIES = 4;
/** The tool's model-facing parameter schema. */
const SEARCH_PARAMETERS = {
	type: "object",
	properties: {
		queries: {
			type: "array",
			items: { type: "string" },
			description: "1–4 search queries; their results are merged and de-duplicated by URL."
		},
		allowed_domains: {
			type: "array",
			items: { type: "string" },
			description: "Only return results from these domains."
		},
		blocked_domains: {
			type: "array",
			items: { type: "string" },
			description: "Never return results from these domains."
		},
		freshness: {
			type: "string",
			description: "Recency window: d1..d30 (days), m1..m12 (months), y1..y5 (years)."
		}
	},
	required: ["queries"]
};
/** Read `queries` from model arguments, tolerating the singular form. */
function readQueries(args) {
	const record = typeof args === "object" && args !== null ? args : {};
	const raw = record["queries"];
	if (Array.isArray(raw)) return raw.filter((value) => typeof value === "string" && value.trim() !== "").slice(0, MAX_QUERIES);
	const single = record["query"];
	if (typeof single === "string" && single.trim() !== "") return [single];
	return [];
}
/** Read a `string[]` argument, ignoring anything else. */
function readStringArray(args, key) {
	const raw = (typeof args === "object" && args !== null ? args : {})[key];
	if (!Array.isArray(raw)) return void 0;
	const values = raw.filter((value) => typeof value === "string" && value !== "");
	return values.length === 0 ? void 0 : values;
}
/** Read a string argument. */
function readString(args, key) {
	const raw = (typeof args === "object" && args !== null ? args : {})[key];
	return typeof raw === "string" && raw !== "" ? raw : void 0;
}
/** Render the canonical value as the text a model reads. */
function renderSearchValue(value) {
	if (value.fatal !== void 0) return value.fatal;
	const body = formatSearchOutcome({
		query: value.queries.join(" / "),
		results: value.results,
		totalResults: value.totalResults
	});
	return value.errors === void 0 || value.errors.length === 0 ? body : `${body}\n\nSome queries failed: ${value.errors.join("; ")}`;
}
/**
* Register the search tool.
*
* @returns the disposer, or `undefined` when the host has no `tools` service
*   (an older or headless profile) — search is additive, so its absence must
*   never fail the plugin's own mount.
*/
function registerWorkBuddySearchTool(ctx, tools, deps) {
	if (typeof tools.register !== "function") return void 0;
	const definition = {
		name: WORKBUDDY_SEARCH_TOOL,
		description: "Search the web through the signed-in WorkBuddy account. Returns titles, URLs, and snippets. Accepts 1–4 queries, which are merged and de-duplicated, plus domain allow/block lists and a recency window.",
		parameters: SEARCH_PARAMETERS,
		output: {
			schema: {
				type: "object",
				properties: {
					queries: {
						type: "array",
						items: { type: "string" }
					},
					totalResults: { type: "number" },
					results: {
						type: "array",
						items: {
							type: "object",
							properties: {
								url: { type: "string" },
								title: { type: "string" },
								snippet: { type: "string" }
							},
							required: ["url"]
						}
					},
					errors: {
						type: "array",
						items: { type: "string" }
					},
					fatal: { type: "string" }
				},
				required: [
					"queries",
					"results",
					"totalResults"
				]
			},
			render: (_args, value) => [{
				type: "text",
				text: renderSearchValue(value)
			}]
		},
		async execute(args, exec) {
			const queries = readQueries(args);
			if (queries.length === 0) return {
				queries: [],
				results: [],
				totalResults: 0,
				fatal: "workbuddy_search needs at least one non-empty query."
			};
			let credential;
			try {
				credential = await deps.credential();
			} catch (error) {
				return {
					queries,
					results: [],
					totalResults: 0,
					fatal: `Could not read the WorkBuddy credential: ${String(error)}`
				};
			}
			if (credential === void 0) return {
				queries,
				results: [],
				totalResults: 0,
				fatal: "No WorkBuddy account is signed in, so web search is unavailable. Sign in to the WorkBuddy desktop app first."
			};
			const allowedDomains = readStringArray(args, "allowed_domains");
			const blockedDomains = readStringArray(args, "blocked_domains");
			const freshness = readString(args, "freshness");
			const merged = [];
			const seen = /* @__PURE__ */ new Set();
			const errors = [];
			let totalResults = 0;
			for (const query of queries) {
				const outcome = await searchWorkBuddy(credential, {
					query,
					...deps.maxResults === void 0 ? {} : { maxResults: deps.maxResults },
					...allowedDomains === void 0 ? {} : { allowedDomains },
					...blockedDomains === void 0 ? {} : { blockedDomains },
					...freshness === void 0 ? {} : { freshness },
					signal: exec.signal
				});
				if (!outcome.ok) {
					errors.push(`${query}: ${outcome.message}`);
					continue;
				}
				totalResults += outcome.totalResults;
				for (const result of outcome.results) {
					if (seen.has(result.url)) continue;
					seen.add(result.url);
					merged.push(result);
				}
			}
			if (merged.length === 0 && errors.length > 0) return {
				queries,
				results: [],
				totalResults: 0,
				fatal: `Search failed:\n${errors.join("\n")}`,
				errors
			};
			return {
				queries,
				results: merged,
				totalResults: totalResults === 0 ? merged.length : totalResults,
				...errors.length === 0 ? {} : { errors }
			};
		}
	};
	const disposer = tools.register(definition);
	try {
		ctx.logger.info(`dsh-workbuddy-connect: registered tool ${WORKBUDDY_SEARCH_TOOL}`);
	} catch {}
	return disposer;
}
/**
* The path the search plugin actually posts to.
*
* `dsh-web-search-deepseek` hardcodes `` `${baseURL}/messages` ``, so the
* configured `baseURL` is one segment above this.
*/
const WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH = `/plugins/dsh-workbuddy-connect/search/messages`;
/** Body ceiling for the gateway; a search request is tiny. */
const BODY_LIMIT_BYTES = 262144;
/** Prefix the plugin wraps around the user's query, stripped before searching. */
const QUERY_PREFIX = "Perform a web search for the query:";
/** Read the whole request body, refusing anything oversized. */
async function readBody$1(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > BODY_LIMIT_BYTES) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** Write a JSON response. */
function json$1(res, status, value) {
	const payload = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff"
	});
	res.end(payload);
}
/** Write an Anthropic-shaped error. */
function errorResponse(res, status, message, type = "invalid_request_error") {
	json$1(res, status, {
		type: "error",
		error: {
			type,
			message
		}
	});
}
/** Whether a browser request is addressed to this deployment (rebinding gate). */
function browserRequestAllowed$1(req, trustedHosts) {
	return requestIsTrusted(req.headers.host, req.headers.origin, trustedHosts);
}
/** Whether the request declares the hosted web-search tool. */
function declaresWebSearch(body) {
	if (typeof body !== "object" || body === null) return false;
	const tools = body["tools"];
	if (!Array.isArray(tools)) return false;
	return tools.some((tool) => {
		if (typeof tool !== "object" || tool === null) return false;
		const record = tool;
		return (typeof record["type"] === "string" ? record["type"] : "").startsWith("web_search") || record["name"] === "web_search";
	});
}
/**
* Recover the real query from the request.
*
* The plugin sends exactly one user message whose text is
* `Perform a web search for the query: <query>`; the prefix is an instruction
* to the auxiliary model and must not be searched for literally.
*/
function extractSearchQuery(body) {
	if (typeof body !== "object" || body === null) return "";
	const messages = body["messages"];
	if (!Array.isArray(messages)) return "";
	const parts = [];
	for (const message of messages) {
		if (typeof message !== "object" || message === null) continue;
		const content = message["content"];
		if (typeof content === "string") {
			parts.push(content);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (typeof block !== "object" || block === null) continue;
			const record = block;
			if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
		}
	}
	const joined = parts.join("\n").trim();
	return joined.startsWith(QUERY_PREFIX) ? joined.slice(35).trim() : joined;
}
/** Build the Anthropic Messages response the search plugin consumes. */
function buildSearchResponse(query, results, model) {
	const items = results.map((result) => ({
		type: "web_search_result",
		url: result.url,
		title: result.title === "" ? result.url : result.title
	}));
	const citations = results.filter((result) => result.snippet !== "").map((result) => ({
		type: "web_search_result_location",
		url: result.url,
		cited_text: result.snippet
	}));
	const content = [{
		type: "web_search_tool_result",
		tool_use_id: "srvtoolu_workbuddy",
		content: items
	}];
	if (citations.length > 0) content.push({
		type: "text",
		text: "",
		citations
	});
	return {
		id: `msg_workbuddy_${Math.random().toString(16).slice(2, 10)}`,
		type: "message",
		role: "assistant",
		model,
		content,
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0
		}
	};
}
/**
* The route handler, extracted so tests can mount it on a bare server.
*
* Always answers a well-formed Anthropic response or a well-formed error; a
* thrown handler would leave the search plugin with an unparseable body.
*/
function workBuddySearchGatewayHandler(deps) {
	return async (req, res) => {
		if (req.method !== "POST") {
			errorResponse(res, 405, "method not allowed");
			return;
		}
		if (!browserRequestAllowed$1(req, deps.trustedHosts)) {
			errorResponse(res, 403, "request-not-trusted");
			return;
		}
		const raw = await readBody$1(req);
		if (raw === void 0) {
			errorResponse(res, 413, "request body too large");
			return;
		}
		let body;
		try {
			body = JSON.parse(raw);
		} catch (error) {
			errorResponse(res, 400, `request body is not valid JSON: ${String(error)}`);
			return;
		}
		if (!declaresWebSearch(body)) {
			errorResponse(res, 400, "request does not declare the web_search tool; this endpoint only serves DSH web search, not chat");
			return;
		}
		const query = extractSearchQuery(body);
		if (query === "") {
			errorResponse(res, 400, "could not read a search query from the request");
			return;
		}
		let credential;
		try {
			credential = await deps.credential();
		} catch (error) {
			errorResponse(res, 502, `could not read the WorkBuddy credential: ${String(error)}`, "api_error");
			return;
		}
		if (credential === void 0) {
			errorResponse(res, 401, "no WorkBuddy account is signed in; sign in to the WorkBuddy desktop app to use web search", "authentication_error");
			return;
		}
		const outcome = await searchWorkBuddy(credential, {
			query,
			...deps.maxResults === void 0 ? {} : { maxResults: deps.maxResults }
		});
		if (!outcome.ok) {
			const status = outcome.status === 401 ? 401 : 502;
			errorResponse(res, status, outcome.message, status === 401 ? "authentication_error" : "api_error");
			return;
		}
		const model = typeof body["model"] === "string" ? body["model"] : "deepseek-v4-flash";
		json$1(res, 200, buildSearchResponse(outcome.query, outcome.results, model));
	};
}
/** Mount the gateway route on an optional webServer context. */
function registerWorkBuddySearchGatewayRoute(ctx, deps) {
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH,
			handler: workBuddySearchGatewayHandler(deps)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: search gateway route");
}
//#endregion
//#region src/pool-store.ts
/**
* Persistence for the account pool: which accounts are members, and what each
* one last measured.
*
* Follows this plugin's existing store conventions (`probe-store.ts`): the file
* lives beside the plugin's own credential copy under `$DSH_HOME`, is written
* atomically, and carries no token, prompt, or response body — only account
* ids, outcome names, timestamps, and the upstream's already-redacted message.
*
* Two kinds of state share the file, and the split matters:
*
*   - **`members`** is a USER DECISION (which accounts may be billed). It is
*     written only when the user changes it.
*   - **`probes`** is an OBSERVATION written by the plugin as requests fail or
*     succeed. Keeping it in the same file but a different field means a
*     measurement can never overwrite the user's selection.
*
* @module dsh-workbuddy-connect/pool-store
*/
/** On-disk format this reader accepts; other versions read as empty. */
const POOL_FORMAT_VERSION = 1;
/** Basename of the pool file inside the Harness home. */
const WORKBUDDY_POOL_FILENAME = ".workbuddy-pool.json";
/** Where one variant's pool file lives. */
function workbuddyPoolPath(variantId) {
	const suffix = variantId === "" ? "" : `-${variantId}`;
	return join(resolveDshHome(), `${WORKBUDDY_POOL_FILENAME.replace(/\.json$/u, "")}${suffix}.json`);
}
function emptyDocument() {
	return {
		version: POOL_FORMAT_VERSION,
		members: [],
		probes: {}
	};
}
/** Read the document, tolerating a missing or unreadable file as empty. */
function readPoolDocument(path) {
	if (!existsSync(path)) return emptyDocument();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return emptyDocument();
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyDocument();
	const record = parsed;
	if (record["version"] !== POOL_FORMAT_VERSION) return emptyDocument();
	const members = Array.isArray(record["members"]) ? record["members"].filter((value) => typeof value === "string" && value !== "") : [];
	const probes = {};
	const rawProbes = record["probes"];
	if (typeof rawProbes === "object" && rawProbes !== null && !Array.isArray(rawProbes)) for (const [id, value] of Object.entries(rawProbes)) {
		if (typeof value !== "object" || value === null) continue;
		const probe = value;
		const outcome = probe["outcome"];
		const atMs = probe["atMs"];
		if (typeof outcome !== "string" || typeof atMs !== "number") continue;
		probes[id] = {
			outcome,
			atMs,
			...typeof probe["source"] === "string" ? { source: probe["source"] } : {},
			...typeof probe["retryAtMs"] === "number" ? { retryAtMs: probe["retryAtMs"] } : {},
			...typeof probe["message"] === "string" ? { message: probe["message"] } : {}
		};
	}
	return {
		version: POOL_FORMAT_VERSION,
		members,
		probes,
		...typeof record["enabled"] === "boolean" ? { enabled: record["enabled"] } : {},
		...typeof record["autoCheckin"] === "boolean" ? { autoCheckin: record["autoCheckin"] } : {}
	};
}
/** Write the document atomically, creating the directory when needed. */
function writePoolDocument(path, document) {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, {
		recursive: true,
		mode: 448
	});
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, {
		encoding: "utf8",
		mode: 384
	});
	renameSync(tmp, path);
}
/**
* The pool's persisted state, as the host and the card use it.
*
* Reads are cached in memory and re-read when the file's mtime changes, so an
* edit from the card applies without a restart while a hot request path does
* not stat the file per call.
*/
var WorkBuddyPoolStore = class {
	path;
	cached;
	cachedMtimeMs = -1;
	constructor(path) {
		this.path = path;
	}
	/** The file this store reads and writes, for diagnostics. */
	filePath() {
		return this.path;
	}
	load() {
		let mtimeMs = -1;
		try {
			mtimeMs = statSync(this.path).mtimeMs;
		} catch {
			mtimeMs = -1;
		}
		if (this.cached === void 0 || mtimeMs !== this.cachedMtimeMs) {
			this.cached = readPoolDocument(this.path);
			this.cachedMtimeMs = mtimeMs;
		}
		return this.cached;
	}
	/** Account ids the user admitted to the pool, in their saved order. */
	members() {
		return [...this.load().members];
	}
	/**
	* Whether rotation is on, or `undefined` when the user never set it.
	*
	* `undefined` rather than `false` on purpose: the caller substitutes the
	* config default, so a profile that enables the pool is not silently
	* overridden by an empty state file.
	*/
	enabled() {
		return this.load().enabled;
	}
	/** Persist the rotation toggle. */
	setEnabled(enabled) {
		this.write({
			...this.load(),
			enabled
		});
	}
	/** Whether startup auto check-in is on, or `undefined` when never set. */
	autoCheckin() {
		return this.load().autoCheckin;
	}
	/** Persist the startup auto check-in toggle. */
	setAutoCheckin(enabled) {
		this.write({
			...this.load(),
			autoCheckin: enabled
		});
	}
	/** Write the document and refresh the cache. */
	write(document) {
		writePoolDocument(this.path, document);
		this.cached = document;
		this.cachedMtimeMs = Date.now();
	}
	/** Replace the member list. This is the only writer of a user decision. */
	setMembers(ids) {
		this.write({
			...this.load(),
			members: [...new Set(ids.filter((id) => id !== ""))]
		});
	}
	/** One account's last measurement, or undefined when never measured. */
	probeOf(accountId) {
		const stored = this.load().probes[accountId];
		if (stored === void 0) return void 0;
		return {
			outcome: stored.outcome,
			atMs: stored.atMs,
			...stored.source === void 0 ? {} : { source: stored.source },
			...stored.retryAtMs === void 0 ? {} : { retryAtMs: stored.retryAtMs },
			...stored.message === void 0 ? {} : { message: stored.message }
		};
	}
	/**
	* Record one measurement.
	*
	* Never overwrites a NEWER observation with an older one: two writers race
	* (a live request failing while a manual test completes), and the later
	* measurement is the one that describes the account now.
	*/
	recordProbe(accountId, probe, source) {
		if (accountId === "") return;
		const document = this.load();
		const existing = document.probes[accountId];
		if (existing !== void 0 && existing.atMs > probe.atMs) return;
		const next = {
			...document,
			probes: {
				...document.probes,
				[accountId]: {
					outcome: probe.outcome,
					atMs: probe.atMs,
					source,
					...probe.retryAtMs === void 0 ? {} : { retryAtMs: probe.retryAtMs },
					...probe.message === void 0 ? {} : { message: probe.message }
				}
			}
		};
		writePoolDocument(this.path, next);
		this.cached = next;
		this.cachedMtimeMs = Date.now();
	}
	/** Forget one account's measurement (e.g. after a successful sign-in). */
	clearProbe(accountId) {
		const document = this.load();
		if (!(accountId in document.probes)) return;
		const probes = { ...document.probes };
		delete probes[accountId];
		const next = {
			...document,
			probes
		};
		writePoolDocument(this.path, next);
		this.cached = next;
		this.cachedMtimeMs = Date.now();
	}
};
//#endregion
//#region src/pool-route.ts
/**
* Control route for the account pool.
*
* Modelled on `probe-route.ts`: loopback-only, and every write requires the
* same in-process key the status document hands the card. The read is a GET so
* the card can poll it; the writes are one POST with an `action` discriminator,
* because they share a guard, a body limit, and an error shape.
*
* Check-in is the one action with a real side effect (it grants credit), so it
* is additionally gated on the user's explicit click — the route never
* auto-claims, and the startup path is a separate opt-in toggle.
*
* @module dsh-workbuddy-connect/pool-route
*/
/** Largest control body accepted; these payloads are a few hundred bytes. */
const MAX_BODY_BYTES = 16384;
/** Mint the per-process control key. */
function createPoolKey() {
	return randomBytes(24).toString("hex");
}
/** Constant-time key comparison; a length mismatch is a failure, not a crash. */
function keyMatches(expected, presented) {
	if (presented === void 0 || presented.length !== expected.length) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(presented);
	return a.length === b.length && timingSafeEqual(a, b);
}
/** Write a JSON response. */
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff"
	});
	res.end(payload);
}
/** Read a request body with a hard ceiling. */
async function readBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** The same deployment-trust gate the status route uses: a rebound page dies here. */
function browserRequestAllowed(req, trustedHosts) {
	return requestIsTrusted(req.headers.host, req.headers.origin, trustedHosts);
}
/**
* Whether a request may act.
*
* Reads are loopback-gated only; writes additionally need the in-process key,
* because the loopback guard protects against a rebinding *page* — it is not
* the same as authorizing a mutation.
*/
function authorized(req, key) {
	const presented = req.headers["x-workbuddy-pool-key"];
	return keyMatches(key, typeof presented === "string" ? presented : void 0);
}
/** The route handler, extracted so tests can mount it on a bare server. */
function workBuddyPoolHandler(options) {
	return async (req, res) => {
		if (!browserRequestAllowed(req, options.trustedHosts)) {
			json(res, 403, { error: "request-not-trusted" });
			return;
		}
		if (req.method === "GET") {
			try {
				json(res, 200, await options.snapshot());
			} catch (error) {
				json(res, 500, { error: String(error) });
			}
			return;
		}
		if (req.method !== "POST") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!authorized(req, options.key)) {
			json(res, 403, { error: "invalid-key" });
			return;
		}
		const raw = await readBody(req);
		if (raw === void 0) {
			json(res, 413, { error: "request body too large" });
			return;
		}
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			json(res, 400, { error: "body is not valid JSON" });
			return;
		}
		if (typeof body !== "object" || body === null) {
			json(res, 400, { error: "body must be an object" });
			return;
		}
		const action = body["action"];
		if (typeof action !== "string") {
			json(res, 400, { error: "missing action" });
			return;
		}
		try {
			json(res, 200, await dispatch(action, body, options));
		} catch (error) {
			json(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
/** Run one action. */
async function dispatch(action, body, options) {
	switch (action) {
		case "set-enabled":
			await options.setEnabled(body["enabled"] === true);
			return {
				state: "ok",
				document: await options.snapshot()
			};
		case "set-members": {
			const ids = Array.isArray(body["accountIds"]) ? body["accountIds"].filter((value) => typeof value === "string" && value !== "") : [];
			await options.setMembers(ids);
			return {
				state: "ok",
				document: await options.snapshot()
			};
		}
		case "rediscover": return {
			state: "ok",
			document: await options.rediscover()
		};
		case "set-auto-checkin":
			if (options.setAutoCheckin === void 0) return {
				state: "failed",
				reason: "auto check-in is not available on this host"
			};
			await options.setAutoCheckin(body["enabled"] === true);
			return {
				state: "ok",
				document: await options.snapshot()
			};
		case "checkin": {
			const ids = Array.isArray(body["accountIds"]) ? body["accountIds"].filter((value) => typeof value === "string" && value !== "") : void 0;
			return await options.checkin(ids);
		}
		case "import-credential": {
			if (options.importCredential === void 0) return {
				state: "failed",
				reason: "importing is not available on this host"
			};
			const text = body["text"];
			if (typeof text !== "string" || text.trim() === "") return {
				state: "failed",
				reason: "no credential text was supplied"
			};
			return await options.importCredential(text);
		}
		case "remove-imported": {
			if (options.removeImported === void 0) return {
				state: "failed",
				reason: "importing is not available on this host"
			};
			const accountId = body["accountId"];
			if (typeof accountId !== "string" || accountId === "") return {
				state: "failed",
				reason: "no account id was supplied"
			};
			return await options.removeImported(accountId);
		}
		default: return {
			state: "failed",
			reason: `unknown action: ${action}`
		};
	}
}
/** Mount the route on an optional webServer context. */
function registerWorkBuddyPoolRoute(ctx, options) {
	const path = options.path ?? "/plugins/dsh-workbuddy-connect/pool";
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "exact",
			path,
			handler: workBuddyPoolHandler(options)
		});
		return () => {
			dispose();
		};
	}, "dsh-workbuddy-connect: account pool route");
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Sleep between accounts. */
function defaultWait(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
/**
* Check in every given account, one at a time.
*
* Serial on purpose: hitting the whole pool at once is the fastest way to trip
* the upstream's volume limit. Never throws — every problem becomes a row.
*/
async function checkinAccounts(accountIds, deps) {
	const rows = [];
	for (const [index, accountId] of accountIds.entries()) {
		if (index > 0) await (deps.wait ?? defaultWait)(400);
		const row = await checkinOne(accountId, deps);
		rows.push(row);
		deps.onRow?.(row);
	}
	return rows;
}
/** One account's check-in, reduced to its row. */
async function checkinOne(accountId, deps) {
	const base = {
		accountId,
		accountName: ""
	};
	let credential;
	try {
		credential = await deps.credentialFor(accountId);
	} catch (error) {
		return {
			...base,
			status: "failed",
			message: messageOf(error)
		};
	}
	if (credential === void 0) return {
		...base,
		status: "failed",
		message: "no stored credential for this account"
	};
	const named = {
		...base,
		accountName: credential.nickname ?? ""
	};
	let status;
	try {
		status = await deps.client.fetchCheckinStatus(credential);
	} catch (error) {
		return {
			...named,
			status: "failed",
			message: messageOf(error)
		};
	}
	if (!status.active) return {
		...named,
		status: "inactive",
		activity: status
	};
	if (status.todayCheckedIn) return {
		...named,
		status: "already",
		activity: status
	};
	try {
		const claim = await deps.client.claimDailyCheckin(credential);
		return {
			...named,
			status: "claimed",
			credit: claim.credit,
			streakDays: claim.streakDays,
			activity: status
		};
	} catch (error) {
		return {
			...named,
			status: "failed",
			message: messageOf(error),
			activity: status
		};
	}
}
//#endregion
//#region src/credential-import.ts
/**
* Imported credentials: a user-supplied auth `.info` copied into the plugin's
* own storage so it survives independently of the WorkBuddy app.
*
* Why this exists. Discovery reads the desktop app's directory, so a credential
* only works while that app keeps the file. A user who has an `.info` from
* another machine, or who wants an account the app no longer signs in, has
* nowhere to put it. Importing copies the file into `$DSH_HOME` and reads it
* from there, which also means the file cannot be clobbered by the app's own
* rotation.
*
* Two rules shape the implementation:
*
*   1. **Validate before storing.** The bytes are parsed and, when they are a
*      5.6 envelope, opened — so a file that cannot produce a credential is
*      refused at import time with a reason, rather than being stored and then
*      silently skipped by discovery on every later scan.
*
*   2. **One file per account, named by account id.** A second import of the
*      same account replaces the first instead of adding a duplicate that the
*      pool would then have to de-duplicate. The name is sanitised because an
*      account id is not a filesystem-safe string by construction.
*
* @module dsh-workbuddy-connect/credential-import
*/
/**
* Import one credential from raw file text.
*
* Text rather than a path because the caller may have received the bytes from a
* paste or an upload; the plugin never needs to know where they came from.
*/
async function importCredentialText(text, resolveKey) {
	if (text.trim() === "") return {
		state: "failed",
		reason: "the file is empty"
	};
	const classification = classifyDesktopAuthDocument(text);
	if (classification.format === "absent") return {
		state: "failed",
		reason: "the file is empty"
	};
	if (classification.format === "unrecognized") return {
		state: "failed",
		reason: "not a WorkBuddy credential: neither a readable auth document nor a decodable 5.6 envelope"
	};
	let plaintext = text;
	if (classification.format === "encrypted") try {
		const key = await resolveKey(classification.wrapped.fields.map((field) => field.envelope.keyId));
		plaintext = unwrapDesktopAuthDocument(classification, (field) => {
			const opened = openAuthField(key, field.envelope);
			if (opened === void 0) throw new Error(`could not decrypt ${field.field}`);
			return opened;
		});
	} catch (error) {
		return {
			state: "failed",
			reason: `the encrypted credential could not be opened (${error instanceof Error ? error.message : String(error)})`
		};
	}
	const credential = parseCredentialText(plaintext);
	if (credential === void 0) return {
		state: "failed",
		reason: "the file carries no access token"
	};
	const accountId = accountIdOf(credential);
	if (accountId === "") return {
		state: "failed",
		reason: "the file carries no account id, so it cannot be told apart from another account"
	};
	const dir = workbuddyImportedDir();
	if (!existsSync(dir)) mkdirSync(dir, {
		recursive: true,
		mode: 448
	});
	const path = importedCredentialPath(accountId);
	const replaced = existsSync(path);
	writeFileSync(path, text, {
		encoding: "utf8",
		mode: 384
	});
	return {
		state: "ok",
		accountId,
		...credential.nickname === void 0 ? {} : { accountName: credential.nickname },
		path,
		...replaced ? { replaced: true } : {}
	};
}
/** List every imported credential, reporting unreadable files rather than hiding them. */
async function listImportedCredentials(resolveKey) {
	const dir = workbuddyImportedDir();
	if (!existsSync(dir)) return [];
	const entries = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".info")) continue;
		const path = join(dir, name);
		let text;
		try {
			text = readFileSync(path, "utf8");
		} catch (error) {
			entries.push({
				path,
				accountId: "",
				readable: false,
				reason: String(error)
			});
			continue;
		}
		const imported = await importableAccount(text, resolveKey);
		entries.push(imported === void 0 ? {
			path,
			accountId: "",
			readable: false,
			reason: "the stored file no longer opens"
		} : {
			path,
			accountId: imported.accountId,
			...imported.accountName === void 0 ? {} : { accountName: imported.accountName },
			readable: true
		});
	}
	return entries;
}
/** Remove one imported credential by account id. */
function removeImportedCredential(accountId) {
	const path = importedCredentialPath(accountId);
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}
/** Read an account id and name out of credential text, or undefined. */
async function importableAccount(text, resolveKey) {
	const classification = classifyDesktopAuthDocument(text);
	if (classification.format === "absent" || classification.format === "unrecognized") return void 0;
	let plaintext = text;
	if (classification.format === "encrypted") try {
		const key = await resolveKey(classification.wrapped.fields.map((field) => field.envelope.keyId));
		plaintext = unwrapDesktopAuthDocument(classification, (field) => {
			const opened = openAuthField(key, field.envelope);
			if (opened === void 0) throw new Error("unreadable");
			return opened;
		});
	} catch {
		return;
	}
	const credential = parseCredentialText(plaintext);
	if (credential === void 0) return void 0;
	const accountId = accountIdOf(credential);
	if (accountId === "") return void 0;
	return {
		accountId,
		...credential.nickname === void 0 ? {} : { accountName: credential.nickname }
	};
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-workbuddy";
/** The model registry required before the provider can register. */
const inject = ["llm"];
/**
* Settings namespace owning the CN card's section.
*
* DSH 0.1.2 dropped the `settingsNamespace()` branding function: a namespace is
* now a nominal string, validated by the type system where it is used rather
* than at runtime by a function call. The brand is compile-time only, so this
* stays the plain string it always was — every comparison, descriptor lookup,
* and `dsh` config file still sees `'workbuddy'`. It is cast once here so the
* public constant carries the seam's type without pulling the brand helper
* into this package (upstream DSH plugins, `dsh-llm-pi-ai` included, pass
* their namespaces as plain string literals).
*/
const WORKBUDDY_SETTINGS_NS = "workbuddy";
/**
* Settings namespace owning the international section.
*
* One namespace per variant, not one shared: each section owns only its own
* fields (`authFile` vs `authFileAI` and `useMaximumContextWindow`), and the
* sections are what `settings.yaml` and the TUI `/settings` read. On DSH 0.1.5
* they carry one more duty — the settings Plugins tab dispatches a card by
* rendering `settings.plugin.item` with `entryKey = ns` for each namespace the
* Host serves, so each variant's card needs a served section whose namespace
* equals its id. DSH 0.1.6+ ignores that pairing (its Plugins page renders the
* bundle's single `plugins.bundle.config` entry, keyed by package name), which
* costs nothing: a section that names no card renders no duplicate.
*/
const WORKBUDDY_AI_SETTINGS_NS = "workbuddy-ai";
/**
* How often the credential files are re-checked, in milliseconds.
*
* A startup-only catalog fetch cannot notice a sign-in that happens while DSH
* is already running, so the model group would not appear until a restart. This
* poll is a cheap existence/parse read of at most a few local files: it never
* contacts the network and never runs a reasoning probe.
*
* `DSH_WORKBUDDY_POLL_MS` overrides it. That exists so the sweep can be
* exercised end to end in tests and shortened while diagnosing a slow sign-in
* on a real machine; it is not a product setting and no UI exposes it. The
* value is clamped to a sane range so a mistaken override cannot turn the poll
* into a busy loop.
*/
const CREDENTIAL_POLL_MS = 3e4;
/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 864e5;
/** Resolve the sweep interval, honoring the override when it is usable. */
function credentialPollMs() {
	const override = Number(process.env["DSH_WORKBUDDY_POLL_MS"]);
	if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS;
	return Math.min(override, MAX_POLL_MS);
}
/**
* How long to wait before retrying a catalog fetch that failed.
*
* The credential sweep deliberately does not re-fetch a catalog it already has
* (a same-identity token rotation carries no new model information). But a
* *failed* fetch must not be treated the same way: without a retry, one
* transient network blip at startup would leave the group on the built-in
* fallback roster until the user noticed and pressed refresh. This bound keeps
* that recovery automatic while still honoring the "not every round" rule — at
* most one attempt per interval, and none at all once a live catalog lands.
*
* Expressed as a multiple of the sweep rather than a fixed duration so the two
* stay in proportion under the `DSH_WORKBUDDY_POLL_MS` override.
*/
const CATALOG_RETRY_SWEEPS = 10;
/** Explicit CN desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_FIELD = z.string().description("WorkBuddy desktop auth file (defaults to the app's own location)");
/** Explicit international desktop auth-file path (shared by the plugin schema and its section). */
const AUTH_FILE_AI_FIELD = z.string().description("WorkBuddy AI desktop auth file (defaults to the app's own location)");
/** Probe authorization (shared by the plugin schema and the CN section). */
const PROBE_CONSENT_FIELD = z.boolean().default(false).description("Authorize reasoning-effort probes (each probe sends real requests that may consume credit)");
const MAXIMUM_CONTEXT_WINDOW_FIELD = z.boolean().default(true).description("Use the largest context window declared by WorkBuddy AI when alternatives are available (on by default)");
/**
* Whether to register the `workbuddy_search` host tool.
*
* On by default: the tool is additive and costs nothing until a conversation
* calls it. Off is for a host whose own `web_search` should be the only search
* surface, and for anyone who would rather not spend WorkBuddy credit there.
*/
const SEARCH_TOOL_FIELD = z.boolean().default(true).description("Register the workbuddy_search tool (searches the web through the signed-in WorkBuddy account)");
/** Per-query result cap for the search tool. */
const SEARCH_MAX_RESULTS_FIELD = z.number().default(8).description(`Maximum results returned per search query (default 8)`);
/**
* Whether the account pool routes requests.
*
* Off by default. Turning it on means the plugin, not the desktop app's current
* sign-in, decides which account is billed — so it is opt-in, and membership is
* an explicit list rather than "every account on this machine".
*/
const ACCOUNT_POOL_FIELD = z.boolean().default(false).description("Route requests across a pool of local WorkBuddy accounts, with automatic failover");
/**
* Whether to check in every pool member at startup.
*
* Off by default. Check-in is a real mutation that grants credit, so the plugin
* never does it unless the user asked — and the upstream currently reports the
* activity closed, so the normal outcome is "not active" rather than a claim.
*/
const AUTO_CHECKIN_FIELD = z.boolean().default(false).description("Attempt the daily WorkBuddy check-in for pool members at startup");
const Config = z.object({
	authFile: AUTH_FILE_FIELD,
	authFileAI: AUTH_FILE_AI_FIELD,
	probeConsent: PROBE_CONSENT_FIELD,
	useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD,
	searchTool: SEARCH_TOOL_FIELD,
	searchMaxResults: SEARCH_MAX_RESULTS_FIELD,
	accountPool: ACCOUNT_POOL_FIELD,
	autoCheckin: AUTO_CHECKIN_FIELD
});
/**
* The CN side's settings section: only the fields that side edits.
*
* The section's namespace is what serves these fields to `settings.yaml` and
* the TUI `/settings`, and it keeps them apart from the international side's.
* `probeConsent` lives here because it predates the second variant; it gates no
* current code path (only manual, per-click-confirmed probes run), so it is left
* where existing users set it rather than moved and re-asked.
*/
const CN_SECTION = z.object({
	authFile: AUTH_FILE_FIELD,
	probeConsent: PROBE_CONSENT_FIELD
});
/** The international card's settings section and its context-window preference. */
const AI_SECTION = z.object({
	authFileAI: AUTH_FILE_AI_FIELD,
	useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD
});
/** Stable identity key used by credentials, probe records, and catalog entries. */
function credentialIdentity(credential) {
	return `${credential.uid}:${credential.enterpriseId ?? ""}`;
}
/**
* The account key model-visibility preferences are stored under: the stable
* identity, but only when it carries a uid.
*
* A credential whose desktop document carried no `account.uid` normalizes to
* an empty string; keying preferences on the resulting `":enterpriseId"` would
* silently share one bucket between every such account. Those accounts get no
* per-account preferences at all — everything stays visible and the control
* route explains the refusal — which is the only honest degradation: it never
* applies one account's hidden list to another.
*/
function visibilityAccountOf(credential) {
	return credential.uid === "" ? void 0 : credentialIdentity(credential);
}
/** Read the configured explicit auth-file path for one variant. */
function configuredAuthFile(config, variant) {
	return variant.id === CN_VARIANT.id ? config.authFile : config.authFileAI;
}
/**
* The static catalog a variant serves before its first successful fetch.
*
* Each variant has its own roster: the two endpoints share several model ids
* but not their billing, context windows, or reasoning sets, so one shared
* fallback would misdescribe whichever variant it was not captured from.
*/
function fallbackFor(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS : FALLBACK_WORKBUDDY_AI_MODELS;
}
/** Build one variant's stores and probe state. */
function createVariantRuntime(config, variant, current, identityOf, accountOf, keyProvider) {
	const client = new WorkBuddyUpstreamClient();
	const configured = configuredAuthFile(config, variant);
	const store = new WorkBuddyCredentialStore({
		variant,
		...configured === void 0 ? {} : { desktopPath: configured },
		...keyProvider === void 0 ? {} : { keyProvider },
		refresh: (credential) => client.refreshToken(credential)
	});
	const fallback = fallbackFor(variant);
	const catalog = new WorkBuddyCatalog(fallback);
	if (variant.id !== CN_VARIANT.id) catalog.setUseMaximumContextWindow(config.useMaximumContextWindow === true);
	catalog.setVisible(false);
	const probeStore = new WorkBuddyProbeStore({
		pluginVersion: WORKBUDDY_CONNECT_VERSION,
		path: workbuddyProbePath(variant.probeFilename)
	});
	const savedCatalogs = new WorkBuddyCatalogStore(workbuddyCatalogPath(variant.catalogFilename));
	const visibilityStore = new WorkBuddyVisibilityStore(workbuddyVisibilityPath(variant.visibilityFilename));
	const poolStore = new WorkBuddyPoolStore(workbuddyPoolPath(variant.id));
	return {
		variant,
		store,
		client,
		catalog,
		probeStore,
		poolStore,
		accountPool: new WorkBuddyAccountPool({
			variant,
			store,
			poolStore,
			keyProvider: atRestKeyProviderFor(variant),
			enabled: () => poolStore.enabled() ?? current().accountPool === true,
			explicitPath: () => configuredAuthFile(current(), variant)
		}),
		probeService: new WorkBuddyProbeService({
			store: probeStore,
			catalog,
			credentials: store,
			client,
			region: variant.id === CN_VARIANT.id ? "cn" : "global",
			consent: () => current().probeConsent === true,
			account: () => identityOf(variant.id)
		}),
		savedCatalogs,
		visibilityStore,
		account: () => accountOf(variant.id),
		fallback,
		catalogSource: "fallback",
		catalogFetchedAtMs: void 0,
		catalogError: void 0,
		lastFetchAtMs: 0,
		catalogGeneration: 0,
		inflightFetch: void 0,
		invalidate: () => {},
		registered: false
	};
}
/** The catalog provenance the card displays. */
/**
* The authorities the host's own browser fence accepts, as a Web deployment
* declares them (`dsh web --trusted-host …`, plus the LAN literals it derives).
*
* `webRuntime` belongs to `@deepseek-ai/dsh-web-app`, which is not a dependency
* of this plugin — importing its type would make a Web-only package a compile
* requirement of a plugin that also runs under TUI and headless profiles. The
* access is therefore checked structurally instead of asserted: an absent
* service, a foreign shape, or a non-string entry all degrade to `undefined`,
* which every route reads as "loopback only". A host that changes this shape
* loses the relaxed fence and returns to the strict one — it never broadens.
*/
function readTrustedHosts(ctx) {
	const runtime = ctx.get?.("webRuntime");
	if (typeof runtime !== "object" || runtime === null) return void 0;
	const list = runtime.trustedHosts;
	if (!Array.isArray(list)) return void 0;
	const entries = list.filter((entry) => typeof entry === "string" && entry.trim() !== "");
	return entries.length === 0 ? void 0 : entries;
}
function catalogSection(runtime) {
	const fetch = runtime.client.lastCatalog;
	return {
		source: runtime.catalogSource,
		...runtime.catalogFetchedAtMs === void 0 ? {} : { fetchedAt: runtime.catalogFetchedAtMs },
		...fetch?.appVersion === void 0 ? {} : { appVersion: fetch.appVersion.version },
		...runtime.catalogError === void 0 ? {} : { error: runtime.catalogError }
	};
}
/**
* Whether a model can be probed by hand: it reasons and the upstream declares
* no effort set for it.
*
* Deliberately *not* filtered by whether a result already exists. Dropping a
* model once it has been detected made the list shrink with use, so
* re-detecting one model — after an upstream change, say — meant clearing every
* other result first. The list stays stable and the card marks which entries
* already have an answer.
*/
function isProbeCandidate(info) {
	if (info.reasoning?.supports !== true) return false;
	return (info.reasoning.supportedEfforts?.length ?? 0) === 0;
}
/** Compact probe state for one card: consent, candidates, observations. */
function probeSection(runtime, consent) {
	const models = runtime.catalog.current();
	const results = models.flatMap((info) => {
		const record = runtime.probeService.recordFor(info.id);
		if (record === void 0) return [];
		return [{
			id: info.id,
			name: info.name,
			validation: record.validation,
			efforts: record.efforts,
			probedAt: record.probedAtMs
		}];
	});
	return {
		consent,
		running: runtime.probeService.isRunning(),
		candidates: models.filter(isProbeCandidate).map((info) => info.id),
		results: newestFirst(results)
	};
}
/**
* Start one variant: its loopback endpoint, provider registration, and
* configuration-card wiring.
*
* Registration waits for the shim to hold a port, because the provider's
* models read the shim origin at construction time. A failure here is
* contained to this variant: the caller logs it and the other keeps working.
*
* @returns whether the provider registered.
*/
async function startVariant(ctx, runtime) {
	const { variant, store, client, catalog, probeService, accountPool } = runtime;
	const shim = createWorkBuddyShim({
		store,
		client,
		catalog,
		logger: ctx.logger,
		pool: {
			select: () => accountPool.select(),
			record: (accountId, outcome, message, retryAtMs) => {
				accountPool.record(accountId, outcome, message, retryAtMs);
			}
		}
	});
	try {
		await shim.ready;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} loopback endpoint failed to start`, error);
		return false;
	}
	try {
		const workbuddy = createWorkBuddyAdapter({
			providerId: variant.id,
			displayName: variant.displayName,
			shim,
			store,
			catalog,
			resolveAttachments: () => ctx.get("attachments"),
			resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => ctx.get("fs")?.processPathFromHostPath(hostPath), ref),
			observe: (modelId) => probeService.recordFor(modelId),
			hidden: () => {
				const account = runtime.account();
				return account === void 0 ? [] : runtime.visibilityStore.disabled(account);
			}
		});
		runtime.invalidate = () => {
			workbuddy.invalidate();
			ctx.emit("llm/adapters-updated");
		};
		const releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter);
		try {
			ctx.effect(() => () => {
				releaseAdapter();
				shim.close();
			});
		} catch {
			releaseAdapter();
			shim.close();
		}
		runtime.registered = true;
		return true;
	} catch (error) {
		ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} provider registration failed`, error);
		shim.close();
		return false;
	}
}
/**
* Start both variants: their loopback endpoints, the `workbuddy` and
* `workbuddy-ai` providers, their configuration cards, and their
* credential-driven catalog lifecycles.
*
* Each variant registers unconditionally; what varies is whether its catalog is
* *visible*. An empty catalog is how DSH hides a model group (the host filters
* out groups with no models), which keeps a sign-in that happens after startup
* working without re-registering the provider.
*/
function apply(ctx, config) {
	let current = () => config;
	/** Timers and in-flight work belonging to this plugin instance. */
	let stopped = false;
	const timers = [];
	/**
	* The account identity each variant last published a catalog for. Keeps a
	* same-identity token rotation from re-fetching, and lets a late response
	* from a previous identity be discarded instead of overwriting a newer one.
	*/
	const lastIdentities = /* @__PURE__ */ new Map();
	/**
	* The visibility account key each variant last adopted, parallel to
	* {@link lastIdentities}: same credential, second key — undefined both when
	* signed out and when the credential carried no uid, which is exactly the
	* case that must not fall back to a shared preference bucket.
	*/
	const lastAccounts = /* @__PURE__ */ new Map();
	const atRestKeysFor = (variant) => atRestKeyProviderFor(variant);
	const runtimes = WORKBUDDY_VARIANTS.map((variant) => createVariantRuntime(config, variant, () => current(), (id) => lastIdentities.get(id), (id) => lastAccounts.get(id), atRestKeysFor(variant)));
	const probeKey = createProbeKey();
	/**
	* Control key for the pool route, minted alongside the probe key.
	*
	* One key for the whole bundle rather than one per variant: the pool page is a
	* single view over both products, so it authenticates once and its writes are
	* fanned out to the runtimes it targets.
	*/
	const poolKey = createPoolKey();
	/**
	* Rotation and auto check-in as the USER last set them.
	*
	* Held here, and persisted in the first runtime's pool file, because DSH
	* 0.2.0 removed the settings-section API that used to carry preferences. The
	* config field supplies the initial value; once the user flips the switch the
	* stored value wins, so a toggle survives a restart.
	*/
	const poolSettings = {
		enabled: () => {
			return runtimes[0]?.poolStore.enabled() ?? config.accountPool === true;
		},
		setEnabled: (enabled) => {
			for (const runtime of runtimes) runtime.poolStore.setEnabled(enabled);
		},
		setMembers: (ids) => {
			for (const runtime of runtimes) runtime.poolStore.setMembers(ids);
		},
		autoCheckin: () => {
			return runtimes[0]?.poolStore.autoCheckin() ?? config.autoCheckin === true;
		},
		setAutoCheckin: (enabled) => {
			for (const runtime of runtimes) runtime.poolStore.setAutoCheckin(enabled);
		}
	};
	/** The most recent check-in run, for the page to render. */
	let lastCheckin;
	/**
	* Remaining credit per account, with the failure that hid it.
	*
	* Cached because the page polls every 15s and the billing route is a real
	* upstream call per account: without a TTL a page left open would issue four
	* requests every fifteen seconds forever. Five minutes is far shorter than
	* any credit movement that matters to this view.
	*
	* A failure is cached too — the route answered HTTP 500 for some accounts
	* here, and retrying a broken endpoint on every poll would be pure noise.
	*/
	const creditsByAccount = /* @__PURE__ */ new Map();
	const CREDITS_TTL_MS = 3e5;
	/** Read one account's credit, from cache when fresh. Never throws. */
	const creditsFor = async (runtime, accountId) => {
		const cached = creditsByAccount.get(accountId);
		const now = Date.now();
		if (cached !== void 0 && now - cached.atMs < CREDITS_TTL_MS) return cached;
		let entry;
		try {
			const credential = await runtime.accountPool.credentialFor(accountId);
			if (credential === void 0) entry = {
				atMs: now,
				error: "no stored credential for this account"
			};
			else {
				const credits = await runtime.client.fetchCredits(credential);
				entry = {
					atMs: now,
					credits: credits.total,
					...credits.unlimited === true ? { unlimited: true } : {}
				};
			}
		} catch (error) {
			entry = {
				atMs: now,
				error: error instanceof Error ? error.message.slice(0, 160) : String(error)
			};
		}
		creditsByAccount.set(accountId, entry);
		return entry;
	};
	/**
	* The imported credentials, as the page lists them.
	*
	* Read fresh each time rather than cached: this is a directory listing of a
	* handful of small files, and a stale list after an import or removal would
	* make the button that just ran look like it did nothing.
	*/
	const importedList = async () => {
		const runtime = runtimes[0];
		if (runtime === void 0) return [];
		return (await listImportedCredentials(async (keyIds) => await atRestKeyProviderFor(runtime.variant).protectorKeyFor([...keyIds]))).map((entry) => ({
			accountId: entry.accountId,
			...entry.accountName === void 0 ? {} : { accountName: entry.accountName },
			readable: entry.readable,
			...entry.reason === void 0 ? {} : { reason: entry.reason }
		}));
	};
	/** Every discovered account across both products, as the page sees it. */
	const poolDocument = async () => {
		const members = new Set(runtimes[0]?.poolStore.members() ?? []);
		const accounts = [];
		for (const runtime of runtimes) {
			const snap = await runtime.accountPool.snapshot();
			for (const account of snap.accounts) {
				const probe = runtime.poolStore.probeOf(account.id);
				const credits = await creditsFor(runtime, account.id);
				accounts.push({
					id: account.id,
					name: account.name,
					live: account.live,
					member: members.has(account.id),
					...account.excludedBy === void 0 ? {} : { excludedBy: account.excludedBy },
					...account.excludedUntilMs === void 0 ? {} : { excludedUntilMs: account.excludedUntilMs },
					...probe?.message === void 0 || probe.message === "" ? {} : { excludedReason: probe.message },
					expiresAtMs: account.expiresAtMs,
					variant: runtime.variant.id,
					...credits.credits === void 0 ? {} : { credits: credits.credits },
					...credits.unlimited === true ? { creditsUnlimited: true } : {},
					...credits.error === void 0 ? {} : { creditsError: credits.error }
				});
			}
		}
		return {
			enabled: poolSettings.enabled(),
			autoCheckin: poolSettings.autoCheckin(),
			accounts,
			imported: await importedList(),
			...lastCheckin === void 0 ? {} : { lastCheckin },
			poolKey
		};
	};
	/**
	* Check in the given accounts (or every member when none are named).
	*
	* Serial across accounts and never throws: each account's outcome is a row.
	* A closed window reports `inactive` — the upstream's current state for every
	* account — and no claim is attempted, so this is safe to call repeatedly.
	*/
	const runCheckin = async (ids) => {
		const members = runtimes[0]?.poolStore.members() ?? [];
		const targets = ids !== void 0 && ids.length > 0 ? [...ids] : members;
		const rows = [];
		for (const runtime of runtimes) {
			const found = await runtime.accountPool.list();
			const byId = new Map(found.map((account) => [accountIdOf(account.credential), account.credential]));
			const scoped = targets.filter((id) => byId.has(id));
			if (scoped.length === 0) continue;
			rows.push(...await checkinAccounts(scoped, {
				credentialFor: async (id) => byId.get(id),
				client: runtime.client
			}));
		}
		lastCheckin = rows.map((row) => ({
			accountId: row.accountId,
			accountName: row.accountName,
			status: row.status,
			...row.credit === void 0 ? {} : { credit: row.credit },
			...row.streakDays === void 0 ? {} : { streakDays: row.streakDays },
			...row.message === void 0 ? {} : { message: row.message }
		}));
		return lastCheckin;
	};
	let setMaximumContextWindow;
	/**
	* Whether this host's settings service carries the 0.1.2-era section API.
	* Decided once, inside the `settings` inject: DSH 0.1.7 removed
	* `installSection` (and `update`) with no replacement this plugin can drive.
	* The maximum-context getter answers `undefined` while this is false, and a
	* status document without the field is what keeps the card from rendering a
	* checkbox that could not be saved.
	*/
	let legacySettingsAvailable = false;
	/**
	* Point a variant at an account identity, invalidating whatever the previous
	* one left behind.
	*
	* One helper for all four transitions (sweep sign-in, sweep sign-out, manual
	* refresh, manual refresh sign-out) because each of them used to do its own
	* partial version, and the manual path forgot pieces the sweep did. Every
	* transition bumps {@link VariantRuntime.catalogGeneration}, which is what
	* makes an in-flight request from before the change refuse to write back.
	*
	* Probe observations are kept across an account change: the store nests them
	* per account, so the departing account's records simply stop being served
	* (every read is account-scoped) and are found intact if that account
	* returns. The "signed out, then in as someone else" sequence that used to
	* look like a first sighting is still safe — a record only ever answers for
	* the account stamped on it, so the new account inherits nothing. Visibility
	* preferences are kept for the same reason, and read through the new
	* account's key immediately: the picker re-lists after the invalidate below
	* and a returning account finds its own hidden list back in force.
	*
	* @param identity - the account now in effect, or `undefined` when signed out.
	* @param account - the visibility key for that same credential (`undefined`
	* also when the credential carries no uid); stored alongside the identity so
	* preference reads never guess it from the identity string.
	*/
	const adoptIdentity = (runtime, identity, account) => {
		const id = runtime.variant.id;
		const known = lastIdentities.get(id);
		if (known === identity) return;
		const hadCredential = known !== void 0;
		if (identity === void 0) lastIdentities.delete(id);
		else lastIdentities.set(id, identity);
		if (account === void 0) lastAccounts.delete(id);
		else lastAccounts.set(id, account);
		runtime.catalogGeneration += 1;
		runtime.inflightFetch?.controller.abort();
		runtime.inflightFetch = void 0;
		if (hadCredential && known !== identity) runtime.invalidate();
		if (identity === void 0) {
			if (known !== void 0) runtime.savedCatalogs.delete(known);
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
			runtime.catalogError = void 0;
			if (runtime.catalog.setVisible(false)) runtime.invalidate();
			return;
		}
		const saved = runtime.savedCatalogs.get(identity);
		if (saved !== void 0) {
			runtime.catalog.set([...saved.models]);
			runtime.catalogSource = "saved";
			runtime.catalogFetchedAtMs = saved.fetchedAtMs;
		} else {
			runtime.catalog.set(runtime.fallback);
			runtime.catalogSource = "fallback";
			runtime.catalogFetchedAtMs = void 0;
		}
		runtime.catalogError = void 0;
		runtime.catalog.setVisible(true);
		runtime.invalidate();
	};
	const resolveSearchCredential = async () => {
		for (const runtime of runtimes) {
			const credential = await runtime.store.current();
			if (credential !== void 0) return credential;
		}
	};
	if (config.searchTool) ctx.inject(["tools"], (toolsCtx) => {
		try {
			const disposer = registerWorkBuddySearchTool(toolsCtx, toolsCtx.tools, {
				credential: resolveSearchCredential,
				...config.searchMaxResults === void 0 ? {} : { maxResults: config.searchMaxResults }
			});
			if (disposer !== void 0) try {
				ctx.effect(() => disposer);
			} catch {
				disposer();
			}
		} catch (error) {
			ctx.logger.warn(`dsh-workbuddy-connect: ${WORKBUDDY_SEARCH_TOOL} registration failed`, error);
		}
	});
	ctx.inject(["webServer"], (webCtx) => {
		/**
		* The deployment's own non-loopback authorities, as the host's browser
		* fence sees them.
		*
		* `dsh web --host 0.0.0.0 --trusted-host <authority>` serves the GUI on a
		* real hostname and tells its own `/api` fence to accept it. The plugin's
		* routes share that deployment, so they must accept it too — otherwise the
		* card and the pool page load their shells and then 403 on every read.
		*
		* Read through `ctx.get` rather than an `inject` so the routes do not
		* acquire a hard dependency on a service a non-Web profile never provides:
		* a headless or TUI host has no `webRuntime`, and those routes are then
		* loopback-only, exactly as before.
		*
		* Resolved through a getter, not once here: `webRuntime` is provided by
		* `@deepseek-ai/dsh-web-app` from inside ITS OWN `webServer` inject, and
		* sibling bundles mounted in the same pass can reach their inject callback
		* first. Reading at mount therefore observed `undefined` and left every
		* route loopback-only on a host that had in fact declared the authority —
		* the 403 this change exists to fix. A getter reads at request time, after
		* the whole tree has settled.
		*/
		const trustedHosts = () => readTrustedHosts(webCtx);
		registerWorkBuddyUpdateRoute(webCtx, {
			currentVersion: WORKBUDDY_CONNECT_VERSION,
			trustedHosts
		});
		registerWorkBuddySearchGatewayRoute(webCtx, {
			credential: resolveSearchCredential,
			trustedHosts,
			...config.searchMaxResults === void 0 ? {} : { maxResults: config.searchMaxResults }
		});
		registerWorkBuddyPoolRoute(webCtx, {
			key: poolKey,
			trustedHosts,
			snapshot: () => poolDocument(),
			setEnabled: (enabled) => {
				poolSettings.setEnabled(enabled);
			},
			setMembers: (ids) => {
				poolSettings.setMembers(ids);
			},
			setAutoCheckin: (enabled) => {
				poolSettings.setAutoCheckin(enabled);
			},
			rediscover: async () => {
				for (const runtime of runtimes) await runtime.accountPool.list(true);
				return await poolDocument();
			},
			checkin: async (ids) => {
				const rows = await runCheckin(ids);
				return {
					state: "ok",
					document: await poolDocument(),
					rows
				};
			},
			importCredential: async (text) => {
				const result = await importCredentialText(text, async (keyIds) => {
					const runtime = runtimes[0];
					if (runtime === void 0) throw new Error("no variant is available to open the credential");
					return await atRestKeyProviderFor(runtime.variant).protectorKeyFor([...keyIds]);
				});
				if (result.state !== "ok") return {
					state: "failed",
					reason: result.reason ?? "the credential could not be imported"
				};
				for (const runtime of runtimes) await runtime.accountPool.list(true);
				return {
					state: "ok",
					document: await poolDocument(),
					imported: {
						...result.accountId === void 0 ? {} : { accountId: result.accountId },
						...result.accountName === void 0 ? {} : { accountName: result.accountName },
						...result.replaced === true ? { replaced: true } : {}
					}
				};
			},
			removeImported: async (accountId) => {
				removeImportedCredential(accountId);
				for (const runtime of runtimes) await runtime.accountPool.list(true);
				return {
					state: "ok",
					document: await poolDocument()
				};
			}
		});
		for (const runtime of runtimes) {
			registerWorkBuddyStatusRoute(webCtx, {
				path: runtime.variant.statusPath,
				store: runtime.store,
				client: runtime.client,
				trustedHosts,
				models: () => runtime.catalog.current(),
				catalog: () => catalogSection(runtime),
				probe: () => probeSection(runtime, current().probeConsent === true),
				probeKey,
				visibility: () => {
					const account = runtime.account();
					return account === void 0 ? void 0 : {
						account,
						disabled: runtime.visibilityStore.disabled(account)
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { useMaximumContextWindow: () => legacySettingsAvailable ? current().useMaximumContextWindow === true : void 0 }
			});
			registerWorkBuddyProbeRoute(webCtx, {
				path: runtime.variant.probePath,
				trustedHosts,
				probe: async (modelId) => {
					const result = await runtime.probeService.probe(modelId, true);
					if (result.state === "ok") runtime.invalidate();
					return result;
				},
				clear: () => {
					runtime.probeStore.clear();
					runtime.invalidate();
				},
				refresh: async () => {
					if (stopped) return {
						state: "failed",
						reason: "plugin is stopping"
					};
					let credential;
					try {
						credential = await runtime.store.current();
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					if (credential === void 0) {
						adoptIdentity(runtime, void 0, void 0);
						return { state: "signed-out" };
					}
					const identity = credentialIdentity(credential);
					adoptIdentity(runtime, identity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, identity);
					return runtime.catalogError === void 0 ? {
						state: "refreshed",
						reason: `${runtime.catalog.current().length} models`
					} : {
						state: "failed",
						reason: runtime.catalogError
					};
				},
				...runtime.variant.id === CN_VARIANT.id ? {} : { setMaximumContextWindow: async (enabled) => {
					if (setMaximumContextWindow === void 0) return {
						state: "failed",
						reason: "settings are unavailable"
					};
					return setMaximumContextWindow(enabled);
				} },
				setModelVisibility: async (modelId, visible, expectedAccount) => {
					const account = runtime.account();
					if (account === void 0) return {
						state: "failed",
						reason: "model visibility needs a signed-in account with a stable user id"
					};
					if (expectedAccount !== account) return {
						state: "stale-account",
						reason: "the signed-in account changed"
					};
					try {
						runtime.visibilityStore.setVisible(account, modelId, visible);
					} catch (error) {
						return {
							state: "failed",
							reason: error instanceof Error ? error.message.slice(0, 300) : String(error)
						};
					}
					runtime.invalidate();
					return { state: "updated" };
				}
			}, probeKey);
		}
	});
	/**
	* Startup check-in, when the user opted in.
	*
	* Deferred rather than run inline: it makes network calls per member, and
	* `apply` must return promptly. Never awaited by anything the user waits on,
	* and it swallows its own failures — a check-in that could not run must not
	* look like a plugin that failed to load. With the activity currently closed
	* upstream, the normal outcome is "inactive" and nothing is claimed.
	*/
	if (poolSettings.autoCheckin()) ctx.effect(() => {
		const timer = setTimeout(() => {
			runCheckin().catch((error) => {
				ctx.logger.warn("dsh-workbuddy-connect: startup check-in failed", error);
			});
		}, 5e3);
		if (typeof timer.unref === "function") timer.unref();
		return () => {
			clearTimeout(timer);
		};
	}, "dsh-workbuddy-connect: startup check-in");
	ctx.inject(["settings"], (settingsCtx) => {
		const legacy = legacySettingsOf(settingsCtx.settings);
		if (legacy === void 0) {
			ctx.logger.warn("dsh-workbuddy-connect: host settings service has no installSection API; per-variant settings and the maximum-context preference are unavailable");
			return;
		}
		legacySettingsAvailable = true;
		/** Section sources; each falls back to its own slice when its side unloads. */
		const sources = {
			cn: () => config,
			ai: () => config
		};
		/** Merge both sections into the whole config the rest of the plugin reads. */
		const merged = () => ({
			...sources.cn().authFile === void 0 ? {} : { authFile: sources.cn().authFile },
			...sources.cn().probeConsent === void 0 ? {} : { probeConsent: sources.cn().probeConsent },
			...sources.ai().authFileAI === void 0 ? {} : { authFileAI: sources.ai().authFileAI },
			...sources.ai().useMaximumContextWindow === void 0 ? {} : { useMaximumContextWindow: sources.ai().useMaximumContextWindow }
		});
		const applyMaximumContextWindow = (next) => {
			const runtime = runtimes.find((candidate) => candidate.variant.id !== CN_VARIANT.id);
			if (runtime?.catalog.setUseMaximumContextWindow(next.useMaximumContextWindow === true)) runtime.invalidate();
		};
		const repointStores = () => {
			const next = merged();
			applyMaximumContextWindow(next);
			for (const runtime of runtimes) runtime.store.setDesktopPath(configuredAuthFile(next, runtime.variant));
		};
		legacy.installSection(ctx, WORKBUDDY_SETTINGS_NS, CN_SECTION, config, {
			setSource(source) {
				sources.cn = source;
				current = merged;
			},
			onChange: repointStores
		});
		legacy.installSection(ctx, WORKBUDDY_AI_SETTINGS_NS, AI_SECTION, config, {
			setSource(source) {
				sources.ai = source;
				current = merged;
			},
			onChange: repointStores
		});
		setMaximumContextWindow = async (enabled) => {
			await legacy.update(WORKBUDDY_AI_SETTINGS_NS, { useMaximumContextWindow: enabled });
			return { state: "updated" };
		};
	});
	ctx.effect(() => () => {
		stopped = true;
		for (const timer of timers) clearInterval(timer);
		timers.length = 0;
		clearHostHeartbeat();
	});
	/**
	* Fetch one variant's catalog for the current credential.
	*
	* Shared by the credential sweep and the card's manual refresh, and written
	* so that concurrent callers cost one request and cannot interleave badly:
	*
	* - **One request at a time.** A second caller joins the in-flight fetch
	*   instead of starting its own (spec §5: one catalog request per variant at
	*   a time).
	* - **Generation-checked write-back.** The request records the generation it
	*   started under and writes nothing if the generation moved on — which is
	*   what a slow answer from a superseded account must not do. Checking only
	*   the *identity* was not enough: two refreshes for the same account can
	*   still finish out of order, and the older one would win.
	* - **`resolve()`, not `current()`.** Only `resolve()` performs the locked,
	*   single-flight token renewal. Reading `current()` meant an expired token
	*   made every catalog request fail until something else happened to refresh
	*   it, leaving the group on the fallback roster.
	*/
	const fetchCatalog = async (runtime, identity) => {
		const inflight = runtime.inflightFetch;
		const generation = runtime.catalogGeneration;
		if (inflight !== void 0 && inflight.identity === identity && inflight.generation === generation) return inflight.promise;
		inflight?.controller.abort();
		const controller = new AbortController();
		let run;
		run = (async () => {
			let models;
			try {
				const credential = await runtime.store.resolve();
				const resolvedIdentity = credentialIdentity(credential);
				if (resolvedIdentity !== identity) {
					adoptIdentity(runtime, resolvedIdentity, visibilityAccountOf(credential));
					await fetchCatalog(runtime, resolvedIdentity);
					return;
				}
				models = await runtime.client.fetchModels(credential, controller.signal);
				const latest = await runtime.store.current();
				const latestIdentity = latest === void 0 ? void 0 : credentialIdentity(latest);
				if (latestIdentity !== identity) {
					adoptIdentity(runtime, latestIdentity, latest === void 0 ? void 0 : visibilityAccountOf(latest));
					if (latestIdentity !== void 0) await fetchCatalog(runtime, latestIdentity);
					return;
				}
			} catch (error) {
				if (stopped || runtime.catalogGeneration !== generation) return;
				runtime.lastFetchAtMs = Date.now();
				runtime.catalogError = error instanceof Error ? error.message.slice(0, 300) : String(error);
				ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} catalog unavailable; serving the fallback list`, error);
				runtime.invalidate();
				return;
			}
			if (stopped || runtime.catalogGeneration !== generation) return;
			runtime.lastFetchAtMs = Date.now();
			runtime.catalog.set([...models]);
			runtime.catalogSource = "live";
			runtime.catalogFetchedAtMs = runtime.client.lastCatalog?.fetchedAtMs ?? Date.now();
			runtime.catalogError = void 0;
			if (lastIdentities.get(runtime.variant.id) === identity) runtime.savedCatalogs.set(identity, {
				source: runtime.client.lastCatalog?.source ?? "unknown",
				fetchedAtMs: runtime.client.lastCatalog?.fetchedAtMs ?? Date.now(),
				models: [...models],
				...runtime.client.lastCatalog?.appVersion === void 0 ? {} : { appVersion: runtime.client.lastCatalog.appVersion.version }
			});
			runtime.invalidate();
		})().finally(() => {
			if (runtime.inflightFetch?.promise === run) runtime.inflightFetch = void 0;
		});
		runtime.inflightFetch = {
			identity,
			generation,
			controller,
			promise: run
		};
		return run;
	};
	/**
	* Reconcile one variant with its credentials.
	*
	* Four transitions matter, and each is a different action:
	*
	* - **none → some** (first sighting): reveal the group and fetch a catalog.
	* - **none → some, identity changed**: additionally drop the previous
	*   account's observations, so another user's probe answers cannot be read as
	*   the new account's.
	* - **some → none**: hide the group and stop serving its models.
	* - **same identity**: nothing to do — the store refreshes tokens on demand,
	*   and re-fetching on every rotation would hit the catalog endpoint for no
	*   new information.
	*/
	const syncVariant = async (runtime) => {
		if (stopped || !runtime.registered) return;
		const credential = await runtime.store.current().catch((error) => {
			ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} credential read failed`, error);
		});
		if (stopped) return;
		if (credential === void 0) {
			adoptIdentity(runtime, void 0, void 0);
			return;
		}
		const identity = credentialIdentity(credential);
		if (lastIdentities.get(runtime.variant.id) === identity && runtime.catalog.isVisible()) {
			const stale = runtime.catalogSource !== "live";
			const due = Date.now() - runtime.lastFetchAtMs >= credentialPollMs() * CATALOG_RETRY_SWEEPS;
			if (stale && due) await fetchCatalog(runtime, identity);
			return;
		}
		adoptIdentity(runtime, identity, visibilityAccountOf(credential));
		await fetchCatalog(runtime, identity);
	};
	/** Run one reconcile sweep across both variants. */
	const syncAll = async () => {
		for (const runtime of runtimes) await syncVariant(runtime);
	};
	Promise.all(runtimes.map(async (runtime) => startVariant(ctx, runtime))).then(() => {
		if (stopped) return;
		if (runtimes.some((runtime) => runtime.registered)) writeHostHeartbeat();
		syncAll();
		const timer = setInterval(() => {
			syncAll();
		}, credentialPollMs());
		timer.unref?.();
		timers.push(timer);
	});
}
//#endregion
export { AI_VARIANT, CN_APP_VERSION_FILENAME, CN_VARIANT, Config, FALLBACK_CN_APP_VERSION, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, PROBE_EFFORT_CANDIDATES, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, WORKBUDDY_VISIBILITY_FILENAME, WorkBuddyCatalog, WorkBuddyCatalogStore, WorkBuddyCredentialStore, WorkBuddyProbeService, WorkBuddyProbeStore, WorkBuddyUpstreamClient, WorkBuddyVisibilityStore, appUserAgent, apply, chatUserAgent, classifyUpstreamError, clearHostHeartbeat, createWorkBuddyAdapter, createWorkBuddyShim, defaultDesktopAuthCandidates, defaultDesktopAuthPath, desktopAuthCandidatesFor, fallbackChatIdentity, fingerprintModel, inject, installedAppVersion, isHeartbeatProcessAlive, modelWithCurrentPromotion, name, normalizeCredits, parseModelCatalog, parseWorkBuddyAuth, prepareChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readCliVersion, readHostHeartbeat, regionOf, resolveAppVersion, resolveChatIdentity, validAppVersion, validCliVersion, variantFor, visibilityAccountOf, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyProbePath, workbuddyVisibilityPath };
