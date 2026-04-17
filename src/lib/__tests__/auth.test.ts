// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

// Mock server-only so it doesn't throw in jsdom
vi.mock("server-only", () => ({}));

// Cookie store mock
const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
} from "@/lib/auth";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(payload: Record<string, unknown>, expiresIn = "7d") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// createSession
test("createSession sets httpOnly cookie with JWT", async () => {
  await createSession("user-1", "user@example.com");

  expect(mockCookieStore.set).toHaveBeenCalledOnce();
  const [name, token, options] = mockCookieStore.set.mock.calls[0];
  expect(name).toBe("auth-token");
  expect(typeof token).toBe("string");
  expect(options.httpOnly).toBe(true);
  expect(options.path).toBe("/");
});

test("createSession embeds userId and email in token", async () => {
  await createSession("user-42", "hello@example.com");

  const token = mockCookieStore.set.mock.calls[0][1] as string;
  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, JWT_SECRET);
  expect(payload.userId).toBe("user-42");
  expect(payload.email).toBe("hello@example.com");
});

// getSession
test("getSession returns null when no cookie is present", async () => {
  mockCookieStore.get.mockReturnValue(undefined);
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns session payload for a valid token", async () => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = await makeToken({ userId: "u1", email: "a@b.com", expiresAt });
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("u1");
  expect(session?.email).toBe("a@b.com");
});

test("getSession returns null for an expired token", async () => {
  const token = await makeToken(
    { userId: "u1", email: "a@b.com" },
    "-1s" // already expired
  );
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a tampered token", async () => {
  mockCookieStore.get.mockReturnValue({ value: "not.a.valid.jwt" });
  const session = await getSession();
  expect(session).toBeNull();
});

// deleteSession
test("deleteSession removes the auth-token cookie", async () => {
  await deleteSession();
  expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
});

// verifySession
test("verifySession returns null when no cookie on request", async () => {
  const req = new NextRequest("http://localhost/api/chat");
  const session = await verifySession(req);
  expect(session).toBeNull();
});

test("verifySession returns session payload for a valid token in request", async () => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = await makeToken({ userId: "u2", email: "x@y.com", expiresAt });

  const req = new NextRequest("http://localhost/api/chat", {
    headers: { cookie: `auth-token=${token}` },
  });

  const session = await verifySession(req);
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("u2");
  expect(session?.email).toBe("x@y.com");
});

test("verifySession returns null for an expired token in request", async () => {
  const token = await makeToken({ userId: "u2", email: "x@y.com" }, "-1s");
  const req = new NextRequest("http://localhost/api/chat", {
    headers: { cookie: `auth-token=${token}` },
  });

  const session = await verifySession(req);
  expect(session).toBeNull();
});

test("verifySession returns null for a tampered token in request", async () => {
  const req = new NextRequest("http://localhost/api/chat", {
    headers: { cookie: "auth-token=garbage.token.value" },
  });

  const session = await verifySession(req);
  expect(session).toBeNull();
});
