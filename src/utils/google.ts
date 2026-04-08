import { OAuth2Client } from "google-auth-library";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const client = new OAuth2Client();

export type GoogleUser = {
  email: string;
  name: string;
  picture?: string;
  sub: string; // Google user id
};

export async function verifyGoogleIdToken(idToken: string, audience?: string) {
  const aud =
    audience ||
    process.env.GOOGLE_MASTER_CLIENT_ID ||
    mustEnv("GOOGLE_CLIENT_ID");

  const ticket = await client.verifyIdToken({
    idToken,
    audience: aud,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload?.sub) {
    throw new Error("Invalid Google token payload");
  }

  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture,
    sub: payload.sub,
  } as GoogleUser;
}