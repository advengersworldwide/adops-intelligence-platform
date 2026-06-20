export interface Role {
  name: string;
  permissions: string[];
  isSystem?: boolean;
}

export interface User {
  id?: number;
  name: string;
  email: string;
  password?: string;
  role: string;
  isSystem?: boolean;
}

export const ALL_PERMISSIONS = [
  "View Dashboard",
  "View Clients",
  "Edit Clients",
  "View Partners",
  "Edit Partners",
  "View Buying Houses",
  "Edit Buying Houses",
  "View Transactions",
  "View Billings",
  "View Payments",
  "View Cost",
  "Upload Data",
  "View Analytics",
  "Manage Settings",
];

// Relative base — works in dev (Vite proxy /api → :8080) and in production (same origin)
const API_BASE = "/api";

// ────────────────────────────────────────────────
// JWT token storage
// ────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem("adops-jwt");
}

function setToken(token: string | null) {
  if (token) {
    localStorage.setItem("adops-jwt", token);
  } else {
    localStorage.removeItem("adops-jwt");
  }
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ────────────────────────────────────────────────
// Roles
// ────────────────────────────────────────────────

export async function getRoles(): Promise<Role[]> {
  try {
    const res = await fetch(`${API_BASE}/roles`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to fetch roles");
    return res.json();
  } catch {
    return [];
  }
}

export async function saveRole(role: Role): Promise<void> {
  await fetch(`${API_BASE}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(role),
  });
}

export async function deleteRole(roleName: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/roles/${encodeURIComponent(roleName)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok;
}

// ────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  try {
    const res = await fetch(`${API_BASE}/users`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to fetch users");
    return res.json();
  } catch {
    return [];
  }
}

export async function saveUser(user: User): Promise<void> {
  await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(user),
  });
}

export async function deleteUser(email: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok;
}

// ────────────────────────────────────────────────
// Login — stores JWT and user object
// ────────────────────────────────────────────────

export async function loginUser(email: string, password: string): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!res.ok) return null;
    const { token, user } = await res.json();
    setToken(token);
    setCurrentUser(user as User);
    return user as User;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Active session — stored in localStorage
// ────────────────────────────────────────────────

export function getCurrentUser(): User | null {
  try {
    const data = localStorage.getItem("adops-active-user");
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null) {
  if (user) {
    localStorage.setItem("adops-active-user", JSON.stringify(user));
  } else {
    localStorage.removeItem("adops-active-user");
  }
}

export function logout() {
  setCurrentUser(null);
  setToken(null);
  window.location.href = "/login";
}

// ────────────────────────────────────────────────
// In-memory roles cache
// ────────────────────────────────────────────────

let _rolesCache: Role[] = [];

export function setCachedRoles(roles: Role[]) {
  _rolesCache = roles;
}

export function getCachedRoles(): Role[] {
  return _rolesCache;
}

// ────────────────────────────────────────────────
// Permission check — synchronous, uses cached roles
// System Admin always passes
// ────────────────────────────────────────────────

export function hasPermission(permission: string): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === "System Admin") return true;
  const userRole = _rolesCache.find(r => r.name.toLowerCase() === user.role.toLowerCase());
  return userRole?.permissions.includes(permission) ?? false;
}
