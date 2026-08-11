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
import type * as devImages from "../devImages.js";
import type * as export_ from "../export.js";
import type * as extract from "../extract.js";
import type * as http from "../http.js";
import type * as lib_recipeWrites from "../lib/recipeWrites.js";
import type * as lib_validators from "../lib/validators.js";
import type * as rateLimits from "../rateLimits.js";
import type * as recipes from "../recipes.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  devImages: typeof devImages;
  export: typeof export_;
  extract: typeof extract;
  http: typeof http;
  "lib/recipeWrites": typeof lib_recipeWrites;
  "lib/validators": typeof lib_validators;
  rateLimits: typeof rateLimits;
  recipes: typeof recipes;
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
