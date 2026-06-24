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
import type * as billingLimits from "../billingLimits.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as passwordReset from "../passwordReset.js";
import type * as preferences from "../preferences.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as stripeClient from "../stripeClient.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  billingLimits: typeof billingLimits;
  crons: typeof crons;
  http: typeof http;
  passwordReset: typeof passwordReset;
  preferences: typeof preferences;
  sessions: typeof sessions;
  stripe: typeof stripe;
  stripeClient: typeof stripeClient;
  subscriptions: typeof subscriptions;
  users: typeof users;
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

export declare const components: {};
