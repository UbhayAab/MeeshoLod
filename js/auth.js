// ============================================================
// Meesho LOD — Local auth (skeleton RBAC, no backend yet)
// A "profile" is just a locally stored user with a role + team.
// Swap this module for real SSO later; the API surface is stable.
// ============================================================

import { getSession, setSession, clearSession, getUser, getUsers, saveUser } from './store.js';

let currentUser = null;

export function initAuth() {
  const s = getSession();
  currentUser = s ? getUser(s.userId) : null;
  return currentUser;
}

export function getCurrentUser() { return currentUser; }
export function isAuthed() { return !!currentUser; }
export function getUserRole() { return currentUser?.role || null; }
export function isAdmin() { return getUserRole() === 'admin'; }
export function isLeadOrAdmin() { return ['admin', 'lead'].includes(getUserRole()); }

export function login(userId) {
  const u = getUser(userId);
  if (!u) return null;
  setSession(u.id);
  currentUser = u;
  return u;
}

export function signup({ name, role, teamId }) {
  const u = saveUser({ name, role, teamId });
  setSession(u.id);
  currentUser = u;
  return u;
}

export function logout() {
  clearSession();
  currentUser = null;
}

export function hasAnyUsers() { return getUsers().length > 0; }
