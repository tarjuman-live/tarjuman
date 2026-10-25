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
import type * as adminAuth from "../adminAuth.js";
import type * as adminMetrics from "../adminMetrics.js";
import type * as adminPanel from "../adminPanel.js";
import type * as adminStats from "../adminStats.js";
import type * as alerts from "../alerts.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as authLinking from "../authLinking.js";
import type * as authThrottle from "../authThrottle.js";
import type * as billingLimits from "../billingLimits.js";
import type * as crons from "../crons.js";
import type * as devAuth from "../devAuth.js";
import type * as emailCode from "../emailCode.js";
import type * as entitlements from "../entitlements.js";
import type * as http from "../http.js";
import type * as passwordReset from "../passwordReset.js";
import type * as preferences from "../preferences.js";
import type * as reporting from "../reporting.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as stripeClient from "../stripeClient.js";
import type * as subscriptions from "../subscriptions.js";
import type * as usage from "../usage.js";
import type * as usageShared from "../usageShared.js";
import type * as userData from "../userData.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminAuth: typeof adminAuth;
  adminMetrics: typeof adminMetrics;
  adminPanel: typeof adminPanel;
  adminStats: typeof adminStats;
  alerts: typeof alerts;
  auth: typeof auth;
  authEmail: typeof authEmail;
  authLinking: typeof authLinking;
  authThrottle: typeof authThrottle;
  billingLimits: typeof billingLimits;
  crons: typeof crons;
  devAuth: typeof devAuth;
  emailCode: typeof emailCode;
  entitlements: typeof entitlements;
  http: typeof http;
  passwordReset: typeof passwordReset;
  preferences: typeof preferences;
  reporting: typeof reporting;
  sessions: typeof sessions;
  stripe: typeof stripe;
  stripeClient: typeof stripeClient;
  subscriptions: typeof subscriptions;
  usage: typeof usage;
  usageShared: typeof usageShared;
  userData: typeof userData;
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
