import { betterAuth, type BetterAuthOptions } from "better-auth";
import { dash } from "@better-auth/infra";
import { getDb } from "./db";
import { AppError } from "./errors";

export function isLoginConfigured() {
  return Boolean(
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_URL &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function getAuthOptions() {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) {
    console.error("Missing BETTER_AUTH_SECRET or BETTER_AUTH_URL");
    throw new AppError("登入暫時無法使用，請稍後再試。");
  }
  const baseURL = new URL(process.env.BETTER_AUTH_URL).origin;
  return {
    appName: "早餐被稱讚地圖",
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    plugins: process.env.BETTER_AUTH_API_KEY
      ? [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })]
      : [],
    database: getDb(),
    emailAndPassword: { enabled: false },
    socialProviders: isLoginConfigured()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account",
          },
        }
      : {},
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session", cookieCache: { enabled: false } },
    account: { modelName: "auth_account", encryptOAuthTokens: true },
    verification: { modelName: "auth_verification" },
    rateLimit: { enabled: true },
    advanced: { database: { generateId: "uuid" } },
  } satisfies BetterAuthOptions;
}

function createAuth() {
  return betterAuth(getAuthOptions());
}

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}

export async function getAuthenticatedUser(headers: Headers) {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) return null;
  const session = await getAuth().api.getSession({ headers });
  return session?.user ?? null;
}
