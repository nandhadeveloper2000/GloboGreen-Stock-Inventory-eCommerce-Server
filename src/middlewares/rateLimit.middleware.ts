import rateLimit from "express-rate-limit";

// 10 login attempts per 15 minutes per IP — blocks brute-force credential attacks
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many login attempts. Please try again later.",
  },
});

// 30 refresh calls per 15 minutes per IP — allows normal usage while blocking token-farming
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many refresh requests. Please try again later.",
  },
});

// 5 reset requests per 60 minutes per IP — prevents email/OTP flooding
export const forgotPinRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many reset requests. Please try again in an hour.",
  },
});

// 10 OTP attempts per 15 minutes per IP
export const otpVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many OTP verification attempts. Please try again later.",
  },
});

// OTP resend: 3 per hour per IP
export const otpResendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many OTP resend requests. Please try again in an hour.",
  },
});

// General API: 500 requests per 15 minutes per IP
export const generalApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please slow down.",
  },
});

// Strict limiter for high-risk operations (password change, PIN change): 5 per hour
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many sensitive requests. Please try again in an hour.",
  },
});