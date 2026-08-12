/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as beautify from "../beautify.js";
import type * as crons from "../crons.js";
import type * as devImages from "../devImages.js";
import type * as export_ from "../export.js";
import type * as extract from "../extract.js";
import type * as http from "../http.js";
import type * as illustrations from "../illustrations.js";
import type * as lib_beautifyJournal from "../lib/beautifyJournal.js";
import type * as lib_blobs from "../lib/blobs.js";
import type * as lib_recipeWrites from "../lib/recipeWrites.js";
import type * as lib_validators from "../lib/validators.js";
import type * as migrations from "../migrations.js";
import type * as rateLimits from "../rateLimits.js";
import type * as recipeAdmin from "../recipeAdmin.js";
import type * as recipes from "../recipes.js";
import type * as retention from "../retention.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  beautify: typeof beautify;
  crons: typeof crons;
  devImages: typeof devImages;
  export: typeof export_;
  extract: typeof extract;
  http: typeof http;
  illustrations: typeof illustrations;
  "lib/beautifyJournal": typeof lib_beautifyJournal;
  "lib/blobs": typeof lib_blobs;
  "lib/recipeWrites": typeof lib_recipeWrites;
  "lib/validators": typeof lib_validators;
  migrations: typeof migrations;
  rateLimits: typeof rateLimits;
  recipeAdmin: typeof recipeAdmin;
  recipes: typeof recipes;
  retention: typeof retention;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
