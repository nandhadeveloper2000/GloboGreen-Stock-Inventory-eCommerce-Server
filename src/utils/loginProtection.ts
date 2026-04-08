import { LoginAttemptModel } from "../models/loginAttempt.model";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

function addMinutes(minutes: number) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function normalizeLogin(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIp(value?: string) {
  return String(value || "").trim() || "unknown";
}

function buildAttemptKey(login: string, ipAddress: string) {
  return `${normalizeLogin(login)}::${normalizeIp(ipAddress)}`;
}

export async function assertLoginNotBlocked(params: {
  login: string;
  ipAddress?: string;
}) {
  const login = normalizeLogin(params.login);
  const ipAddress = normalizeIp(params.ipAddress);
  const key = buildAttemptKey(login, ipAddress);

  const record = await LoginAttemptModel.findOne({ key });

  if (!record) return;

  if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
    const secondsLeft = Math.ceil(
      (record.lockedUntil.getTime() - Date.now()) / 1000
    );

    throw new Error(
      `Too many failed attempts. Try again after ${secondsLeft} seconds`
    );
  }

  if (record.lockedUntil && record.lockedUntil.getTime() <= Date.now()) {
    record.failures = 0;
    record.lockedUntil = null;
    record.lastAttemptAt = new Date();
    await record.save();
  }
}

export async function registerLoginFailure(params: {
  login: string;
  ipAddress?: string;
}) {
  const login = normalizeLogin(params.login);
  const ipAddress = normalizeIp(params.ipAddress);
  const key = buildAttemptKey(login, ipAddress);

  const record = await LoginAttemptModel.findOne({ key });

  if (!record) {
    const failures = 1;
    const lockedUntil =
      failures >= LOGIN_MAX_ATTEMPTS
        ? addMinutes(LOGIN_LOCK_MINUTES)
        : null;

    await LoginAttemptModel.create({
      key,
      login,
      ipAddress,
      failures,
      lockedUntil,
      lastAttemptAt: new Date(),
    });

    return;
  }

  record.failures += 1;
  record.lastAttemptAt = new Date();

  if (record.failures >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = addMinutes(LOGIN_LOCK_MINUTES);
  }

  await record.save();
}

export async function clearLoginFailures(params: {
  login: string;
  ipAddress?: string;
}) {
  const login = normalizeLogin(params.login);
  const ipAddress = normalizeIp(params.ipAddress);
  const key = buildAttemptKey(login, ipAddress);

  await LoginAttemptModel.deleteOne({ key });
}