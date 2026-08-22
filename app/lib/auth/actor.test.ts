import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const selectMock = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: selectMock }) }) },
  usersTable: { id: "id", tokenVersion: "tokenVersion" },
}));

vi.mock("./session");

import { resolveActor, readChallengeCookie } from "./actor";
import { getSession } from "./session";
import { signChallenge } from "./jwt";
import { CHALLENGE_COOKIE } from "./cookies";
import type { SessionUser } from "./jwt";

const mockGetSession = vi.mocked(getSession);

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
});

beforeEach(() => {
  selectMock.mockReset();
  mockGetSession.mockReset();
});

/** Queues the row the next users-table tokenVersion lookup resolves to. `null` means no row. */
function mockDbUserRow(row: { tokenVersion: number } | null) {
  selectMock.mockResolvedValueOnce(row ? [row] : []);
}

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    sub: 1, name: "A", username: "a", email: "a@x.com",
    role: "Viewer", isSystem: false, tokenVersion: 0,
    ...overrides,
  };
}

function requestWithChallenge(token?: string): Request {
  const headers: Record<string, string> = token ? { cookie: `${CHALLENGE_COOKIE}=${token}` } : {};
  return new Request("http://localhost/api/x", { headers });
}

describe("resolveActor", () => {
  it("returns the session's sub when its tokenVersion is current", async () => {
    mockGetSession.mockResolvedValueOnce(sessionUser({ sub: 1, tokenVersion: 2 }));
    mockDbUserRow({ tokenVersion: 2 });
    expect(await resolveActor(requestWithChallenge(), "totp_enroll")).toBe(1);
  });

  it("rejects a revoked session (stale tokenVersion) when no challenge cookie is present", async () => {
    mockGetSession.mockResolvedValueOnce(sessionUser({ sub: 1, tokenVersion: 1 }));
    mockDbUserRow({ tokenVersion: 2 }); // token_version was bumped since this session was issued
    expect(await resolveActor(requestWithChallenge(), "totp_enroll")).toBeNull();
  });

  it("falls through to a valid challenge cookie when the session is revoked", async () => {
    // issueChallenge never clears a leftover session cookie (only issueSession/
    // logout do), so a privileged user forced back through enroll_2fa after an
    // admin 2FA reset must still be able to complete it via the fresh
    // challenge, even while their old session cookie is revoked.
    mockGetSession.mockResolvedValueOnce(sessionUser({ sub: 1, tokenVersion: 1 }));
    mockDbUserRow({ tokenVersion: 2 });
    const token = await signChallenge(1, "totp_enroll");
    expect(await resolveActor(requestWithChallenge(token), "totp_enroll")).toBe(1);
  });

  it("succeeds via the challenge path for a user with no session at all", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const token = await signChallenge(5, "totp_enroll");
    expect(await resolveActor(requestWithChallenge(token), "totp_enroll")).toBe(5);
    expect(selectMock).not.toHaveBeenCalled(); // no session means no DB lookup at all
  });

  it("returns null when neither a live session nor a challenge cookie is present", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect(await resolveActor(requestWithChallenge(), "totp_enroll")).toBeNull();
  });

  it("returns null when the challenge cookie was minted for a different purpose", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const token = await signChallenge(5, "password_change");
    expect(await resolveActor(requestWithChallenge(token), "totp_enroll")).toBeNull();
  });
});

describe("readChallengeCookie", () => {
  it("does not match a differently-named cookie that merely ends with the challenge cookie's name", () => {
    // Unanchored, `adops-challenge=([^;]+)` matches inside "xadops-challenge=..."
    // too, since regex has no notion of cookie-name boundaries on its own.
    const req = new Request("http://localhost/api/x", {
      headers: { cookie: "xadops-challenge=attacker-controlled" },
    });
    expect(readChallengeCookie(req)).toBeNull();
  });

  it("matches the real cookie when it is not the first in the header", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { cookie: `foo=1; ${CHALLENGE_COOKIE}=real-token` },
    });
    expect(readChallengeCookie(req)).toBe("real-token");
  });

  it("matches the real cookie when it is the first in the header", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { cookie: `${CHALLENGE_COOKIE}=real-token; foo=1` },
    });
    expect(readChallengeCookie(req)).toBe("real-token");
  });

  it("returns null when there is no cookie header at all", () => {
    expect(readChallengeCookie(new Request("http://localhost/api/x"))).toBeNull();
  });
});
