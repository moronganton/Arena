import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { verifyPassword, hashPassword } from "@/lib/password";
import { loginLockedFor, recordLoginFailure, clearLoginFailures } from "@/lib/login-throttle";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// "Continue with Google" is offered only when OAuth credentials are configured,
// so the app runs fine before they're set. Add GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET (and redeploy) to switch it on.
const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // 7-day absolute lifetime with a rolling 24h refresh, rather than NextAuth's
  // 30-day default. A logged-in session can read guest data and open doors, so a
  // forgotten or stolen device should not stay authorised for a month.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();

        // Throttle before touching the database, so a locked key costs an
        // attacker a request and nothing else.
        const lockedSeconds = loginLockedFor(email);
        if (lockedSeconds !== null) {
          throw new Error(
            `Too many failed attempts. Try again in ${Math.ceil(lockedSeconds / 60)} minute(s).`
          );
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !user.password) {
          // Counted too: without this, a missing account is a free oracle for
          // enumerating which email addresses exist.
          recordLoginFailure(email);
          return null;
        }

        const { valid, needsRehash } = await verifyPassword(parsed.data.password, user.password);
        if (!valid) {
          recordLoginFailure(email);
          return null;
        }

        // Silently upgrade a legacy plaintext row now that we know the password
        // is correct — accounts migrate to bcrypt on their next login with no
        // reset required.
        if (needsRehash) {
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { password: await hashPassword(parsed.data.password) },
            });
            console.log(`[auth] migrated password to bcrypt for user ${user.id}`);
          } catch (err) {
            // Never fail a valid login because the upgrade write failed.
            console.error("[auth] password rehash failed:", err);
          }
        }

        clearLoginFailures(email);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // If someone already has a StayHQ account under the same (Google-
            // verified) email, let Google sign them into that same account
            // instead of erroring. Safe because Google verifies email ownership.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Google sign-in must be a way INTO AN EXISTING ACCOUNT, never a way to
    // create one. With the Prisma adapter, an OAuth provider otherwise
    // self-provisions a User on first sign-in, so simply configuring Google
    // turned StayHQ into an open sign-up: any Google account could log in, then
    // spend the owner's Anthropic credits and Resend quota. (Owner-scoped
    // queries meant they saw no existing data, but resource abuse was wide
    // open.) Account creation belongs to the invite flow in Phase 2.
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;

      const email = user.email?.toLowerCase().trim();
      if (!email) return false;

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!existing) {
        console.warn(`[auth] blocked Google sign-in for ${email}: no StayHQ account exists`);
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      // Credentials sign-in provides the id directly; OAuth provides it via the
      // adapter-created user. Fall back to an email lookup so the id is always set.
      if (user?.id) {
        token.id = user.id;
      } else if (!token.id && token.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email } });
        if (dbUser) token.id = dbUser.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
