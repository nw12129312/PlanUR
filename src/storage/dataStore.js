// dataStore: the single persistence module.
//
// This file is the ONLY place in the codebase allowed to touch
// window.storage or localStorage. Everything else - UI components, the constraint engine,
// auto-generate - goes through the functions exported here. The engine
// additionally never imports this module: it stays pure and receives data as
// parameters; only App-level code calls the store.
//
// Every plan-related function takes userId FIRST, defaulting to LOCAL_USER.
// Real multi-user accounts later mean passing a real id - no signature
// changes. The key scheme is an internal detail:
//   local-user (legacy, pre-multi-user saves):  plans:{planId} / plan-index
//   any other userId:            users:{userId}:plans:{planId} / users:{userId}:plan-index
// Keeping the legacy keys for LOCAL_USER preserves every plan saved by
// earlier versions of this app.
//
// All stored shapes (Plan, and the plan-index entries returned by listPlans)
// are plain JSON-serializable objects - no framework objects, class
// instances, functions, or storage bookkeeping mixed into the Plan itself.
//
// Backend: the host page's window.storage when the app is embedded in a page
// that provides it, otherwise the browser's localStorage (keys prefixed with
// "planur:"), so a plan survives reloads with no account. The access layer
// feature-detects several method shapes, awaits thenables, wraps every call
// in try/catch, and mirrors writes into an in-memory Map so a storage outage
// degrades to a visible status banner instead of data loss mid-session.
//
// Signed-in users keep a local cache of their account's plans under their
// own userId; src/storage/account.js syncs that cache with the cloud.

import programsData from '../data/programs.json';
import coursesData from '../data/courses.json';
import clustersData from '../data/clusters.json';
import policyData from '../data/policy.json';
import equivalencyGroupsData from '../data/equivalency_groups.json';
import examCreditData from '../data/exam_credit.json';
import rmpData from '../data/rmp.json';
import metaData from '../data/meta.json';

export const LOCAL_USER = 'local-user';

// ---------------------------------------------------------------------------
// static data accessors (bundled JSON; plain objects, safe to share)
// ---------------------------------------------------------------------------

export const getPrograms = () => programsData;
export const getCourses = () => coursesData;
export const getEquivalencyGroups = () => equivalencyGroupsData;
export const getExamCredit = () => examCreditData;
export const getRmp = () => rmpData;
export const getClusters = () => clustersData;
export const getPolicy = () => policyData;
export const getMeta = () => metaData;

// ---------------------------------------------------------------------------
// window.storage access layer (private to this module)
// ---------------------------------------------------------------------------

const memory = new Map();
let available = null; // unknown until first call
let lastError = null;
const listeners = new Set();

const LS_PREFIX = 'planur:';

// localStorage wrapped in the same getItem/setItem/removeItem shape.
function localStorageAdapter(ls) {
  return {
    getItem: (k) => ls.getItem(LS_PREFIX + k),
    setItem: (k, v) => ls.setItem(LS_PREFIX + k, v),
    removeItem: (k) => ls.removeItem(LS_PREFIX + k),
  };
}

function backend() {
  try {
    if (typeof window === 'undefined') return null;
    if (window.storage) return window.storage;
    if (window.localStorage) return localStorageAdapter(window.localStorage);
  } catch {
    /* ignore: localStorage access can throw (blocked site data) */
  }
  return null;
}

// Where plans are kept: 'host', 'browser', or null (session only).
export function storageBackendKind() {
  try {
    if (typeof window === 'undefined') return null;
    if (window.storage) return 'host';
    if (window.localStorage) return 'browser';
  } catch {
    /* ignore */
  }
  return null;
}

async function call(names, args) {
  const s = backend();
  if (!s) throw new Error('browser storage unavailable');
  for (const n of names) {
    if (typeof s[n] === 'function') return await s[n](...args);
  }
  throw new Error(`storage has none of: ${names.join(', ')}`);
}

function unwrapValue(res) {
  if (res == null) return null;
  if (typeof res === 'string') return res;
  if (typeof res === 'object' && 'value' in res) return res.value;
  return res;
}

function notify() {
  const st = storageStatus();
  listeners.forEach((f) => f(st));
}
function markOk() {
  if (available !== true) { available = true; lastError = null; notify(); }
}
function markFail(e) {
  available = false;
  lastError = e?.message || String(e);
  notify();
}

async function kvGet(key) {
  try {
    const raw = unwrapValue(await call(['getItem', 'get'], [key]));
    markOk();
    return raw == null ? null : JSON.parse(raw);
  } catch (e) {
    markFail(e);
    return memory.has(key) ? JSON.parse(memory.get(key)) : null;
  }
}

async function kvSet(key, value) {
  const raw = JSON.stringify(value);
  memory.set(key, raw); // session fallback mirror
  try {
    await call(['setItem', 'set'], [key, raw]);
    markOk();
    return true;
  } catch (e) {
    markFail(e);
    return false;
  }
}

async function kvRemove(key) {
  memory.delete(key);
  try {
    await call(['removeItem', 'deleteItem', 'delete'], [key]);
    markOk();
    return true;
  } catch (e) {
    markFail(e);
    return false;
  }
}

export function storageStatus() {
  return { available, lastError };
}
export function subscribeStorageStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// key scheme (private)
// ---------------------------------------------------------------------------

const planKey = (userId, planId) =>
  userId === LOCAL_USER ? `plans:${planId}` : `users:${userId}:plans:${planId}`;
const indexKey = (userId) =>
  userId === LOCAL_USER ? 'plan-index' : `users:${userId}:plan-index`;

const makePlanId = () =>
  `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Index entries are listing metadata, kept separate from the Plan object:
// { id, name, major, minor, clusters, last_edited }
function indexEntry(plan) {
  const nameOf = (id) => getPrograms().find((p) => p.id === id)?.name;
  return {
    id: plan.id,
    name: plan.name,
    major: plan.majorIds.map(nameOf).filter(Boolean).join(' + ') || null,
    minor: plan.minorIds.map(nameOf).filter(Boolean).join(' + ') || null,
    clusters: plan.clusterIds,
    last_edited: plan.lastEdited,
  };
}

// ---------------------------------------------------------------------------
// plan persistence API
// ---------------------------------------------------------------------------

// Persist a plan and upsert its index entry. Returns { ok, index }.
export async function savePlan(userId = LOCAL_USER, plan) {
  const okPlan = await kvSet(planKey(userId, plan.id), plan);
  const index = [
    ...((await kvGet(indexKey(userId))) || []).filter((e) => e.id !== plan.id),
    indexEntry(plan),
  ];
  const okIndex = await kvSet(indexKey(userId), index);
  return { ok: okPlan && okIndex, index };
}

// Program ids that were renamed (Bio programs moved to spec ids in the
// Bio-tracks batch). Applied when reading stored plans so old saves keep
// resolving; the stored record is untouched until the next save.
const LEGACY_PROGRAM_IDS = {
  'major-bio-ba': 'biol-ba',
  'major-bio-bsg': 'biol-bs-general',
  'major-bio-bbc': 'biol-bs-biochem',
  'major-bio-bcd': 'biol-bs-celldev',
  'major-bio-bcb': 'biol-bs-compbio',
  'major-bio-beb': 'biol-bs-ecoevo',
  'major-bio-bmb': 'biol-bs-microbio',
  'major-bio-bmg': 'biol-bs-molgen',
};

function migrateLegacyIds(plan) {
  if (!plan) return plan;
  const map = (ids) => (ids || []).map((id) => LEGACY_PROGRAM_IDS[id] || id);
  const srcChoices = plan.trackChoices && typeof plan.trackChoices === 'object' ? plan.trackChoices : {};
  const trackChoices = {};
  for (const [pid, groups] of Object.entries(srcChoices)) {
    if (!groups || typeof groups !== 'object') continue;
    const nid = LEGACY_PROGRAM_IDS[pid] || pid;
    trackChoices[nid] = { ...(trackChoices[nid] || {}), ...groups };
  }
  const preferences = {
    scheduleStyle: 'balanced',
    ...(plan.preferences && typeof plan.preferences === 'object' ? plan.preferences : {}),
  };
  if (!['balanced', 'focused', 'frontload-major'].includes(preferences.scheduleStyle)) {
    preferences.scheduleStyle = 'balanced';
  }
  const transferExams = Array.isArray(plan.transferExams) ? plan.transferExams : [];
  return { ...plan, majorIds: map(plan.majorIds), minorIds: map(plan.minorIds), trackChoices, preferences, transferExams };
}

// Fetch one plan (or null).
export async function loadPlan(userId = LOCAL_USER, planId) {
  return migrateLegacyIds(await kvGet(planKey(userId, planId)));
}

// Listing metadata for all of a user's plans (never the full plan bodies).
export async function listPlans(userId = LOCAL_USER) {
  return (await kvGet(indexKey(userId))) || [];
}

// Remove a plan and its index entry. Returns { ok, index }.
export async function deletePlan(userId = LOCAL_USER, planId) {
  const okPlan = await kvRemove(planKey(userId, planId));
  const index = ((await kvGet(indexKey(userId))) || []).filter((e) => e.id !== planId);
  const okIndex = await kvSet(indexKey(userId), index);
  return { ok: okPlan && okIndex, index };
}

// Copy a stored plan under a new id/name. Returns { ok, plan, index };
// plan is null when the source doesn't exist. (To duplicate unsaved
// in-memory state, callers build the copy themselves and use savePlan.)
export async function duplicatePlan(userId = LOCAL_USER, planId) {
  const src = await loadPlan(userId, planId);
  if (!src) return { ok: false, plan: null, index: await listPlans(userId) };
  const copy = { ...src, id: makePlanId(), name: `${src.name} (copy)`, lastEdited: Date.now() };
  const { ok, index } = await savePlan(userId, copy);
  return { ok, plan: copy, index };
}

// Every stored plan body for a user (used when merging with an account).
export async function loadAllPlans(userId = LOCAL_USER) {
  const index = await listPlans(userId);
  const plans = await Promise.all(index.map((e) => loadPlan(userId, e.id)));
  return plans.filter(Boolean);
}

// Remove every plan a user has on this device. Returns { ok }.
export async function clearPlans(userId = LOCAL_USER) {
  const index = await listPlans(userId);
  const results = await Promise.all(index.map((e) => kvRemove(planKey(userId, e.id))));
  const okIndex = await kvRemove(indexKey(userId));
  return { ok: okIndex && results.every(Boolean) };
}

// Small per-device preferences (e.g. which plan was open last).
export async function getSetting(name) {
  return kvGet(`settings:${name}`);
}
export async function setSetting(name, value) {
  return kvSet(`settings:${name}`, value);
}
